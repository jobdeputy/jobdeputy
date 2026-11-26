import { CRAWL_ERRORS, parseCrawlUrl } from '@jobdeputy/shared/crawl';
import {
  createDocumentInput,
  DOCUMENT_TYPES,
  MAX_DOCUMENTS,
  MAX_UPLOAD_BYTES,
  updateDocumentInput,
} from '@jobdeputy/shared/documents';
import { githubListFromUrl } from '@jobdeputy/shared/lists';
import { createRoleInput, MAX_ROLES, profileInput } from '@jobdeputy/shared/profile';
import { type ApiClient, ApiError, type UploadForm, type UploadOptions } from './client.ts';

/** Where the fake's upload forms point: nothing is sent anywhere. */
const UPLOAD_URL = 'https://fake-upload.invalid/';

/**
 * What the fake's server check makes of a file, by its name (the worker's own words,
 * apps/worker/src/document-worker.ts): "malware" in the name fails the scan, "unreadable" can't be
 * read; anything else is ready. "still-checking" never gets past the malware check (a screen
 * shot of the deputy at work needs a frame that holds).
 */
const OUTCOMES = [
  {
    match: /malware/i,
    status: 'rejected',
    error: 'This file failed the malware scan and was deleted.',
  },
  {
    match: /unreadable/i,
    status: 'failed',
    error: 'The file could not be processed. Please upload it again.',
  },
] as const;

/**
 * The fake's download link: the file itself, inline (the API's is a 5-minute S3 link that sends
 * it as an attachment). Nothing is fetched from anywhere.
 */
export const FAKE_DOWNLOAD_URL = `data:application/pdf;base64,${btoa('%PDF-1.4\n%%EOF\n')}`;

/** Counted across every fake, so a résumé's ID is never reused on a page (as ULIDs aren't). */
let lastDocument = 0;

interface FakeDocument {
  view: Record<string, unknown> & { documentId: string; fileName: string };
  /** When its file arrived; the server check runs from then. */
  uploadedAt?: number;
}

/**
 * An in-memory stand-in for the cell's API, for the test build only (`--mode e2e`), as
 * `auth/fake.ts` stands in for Cognito. It answers the routes the screens use so far as the API
 * does (apps/api/src/profile.ts): no profile yet is the defaults at version 0, not a 404; a saved
 * one carries what the server adds (email, homeCell, createdAt, updatedAt); a save with a stale
 * version is a conflict, and a save the API's (strict) schema refuses is refused. Target roles
 * list oldest first, stop at the API's limit (422), and a role already gone is not found. It keeps
 * each account's data apart (by whoever `user` says is signed in); anything else is not found. It
 * forgets everything on reload. Résumés list newest first and stop at 10 (422); an uploaded file
 * is checked for malware for `checkMs`, read for `checkMs` more, then is ready (or not: see
 * `OUTCOMES`); a file over 5 MB is refused by the form, as S3 refuses it. A link is crawled
 * one at a time (429 while one is at work), through the API's own address check (#49).
 */
export function createFakeApi({
  delay = 200,
  checkMs = 1500,
  crawlMs = 1500,
  now = Date.now,
  user = async () => 'someone@example.com',
}: {
  delay?: number;
  /** How long each stage of the server's check of an uploaded file takes. */
  checkMs?: number;
  /** How long each stage of a crawl takes (queued, reading, scoring). */
  crawlMs?: number;
  /** The clock of the server's work (crawls, the résumé check): a test can hold it and move it on. */
  now?: () => number;
  /** Who is signed in; nobody is refused as the API would (401). */
  user?: () => Promise<string | null>;
} = {}): ApiClient {
  const profiles = new Map<string, Record<string, unknown>>();
  const roles = new Map<string, Record<string, unknown>[]>();
  const documents = new Map<string, FakeDocument[]>();
  const crawls = new Map<string, FakeCrawl[]>();
  /** #52: each person's jobs that left `new` (applied to, or later), by job ID. */
  const stages = new Map<string, Map<string, { stage: string; at: string }>>();
  let lastRole = 0;

  /**
   * A crawl as the API shows it now, one `crawlMs` a stage: queued, reading, then succeeded; with
   * AI, its scoring starts a stage later (a separate worker, as in the cell), runs, and is done. A
   * link with "unreachable" in it fails; "still-crawling" never finishes.
   */
  function crawlView(crawl: FakeCrawl): Record<string, unknown> {
    if (crawl.view.kind === 'list') return listView(crawl);
    const { view, startedAt } = crawl;
    const stage = /still-crawling/i.test(String(view.url))
      ? 1
      : Math.floor((now() - startedAt) / crawlMs);
    if (stage < 1) return { ...view, status: 'queued' };
    const startedIso = new Date(startedAt + crawlMs).toISOString();
    if (stage < 2) return { ...view, status: 'running', startedAt: startedIso };
    const finishedAt = new Date(startedAt + 2 * crawlMs).toISOString();
    if (/unreachable/i.test(String(view.url))) {
      return {
        ...view,
        status: 'failed',
        error: { code: 'unreachable', message: CRAWL_ERRORS.unreachable },
        finishedAt,
      };
    }
    const done = {
      ...view,
      status: 'succeeded',
      stats: { jobsFound: 12, jobsNew: 12, jobsUpdated: 0, jobsRelevant: 4 },
      finishedAt,
    };
    if (view.aiSource === 'none' || stage < 3) return done;
    return { ...done, relevance: { status: stage < 4 ? 'running' : 'done' } };
  }

  /**
   * #50: a list run as the API shows it now, one `crawlMs` a step: queued, reading the list, then
   * one company read a step (3 at work at once), then succeeded (its scoring after, as above). The
   * list has 5 companies (the last one's read fails) and 3 skipped. In the link: "not-a-list"
   * fails; "nothing-fits" chooses none; "unreadable" chooses none, all skipped; "all-busy" finds
   * both its companies already being read; "jobs-fit-none" reads them, and none fit;
   * "still-crawling" holds once its first company is read (3 at work).
   */
  function listView({ view, startedAt }: FakeCrawl): Record<string, unknown> {
    const url = String(view.url);
    const elapsed = Math.floor((now() - startedAt) / crawlMs);
    const step = /still-crawling/i.test(url) ? Math.min(elapsed, 3) : elapsed;
    const at = (n: number) => new Date(startedAt + n * crawlMs).toISOString();
    if (step < 1) return { ...view, status: 'queued', updatedAt: at(0) };
    if (step < 2) return { ...view, status: 'running', startedAt: at(1), updatedAt: at(1) };
    if (/not-a-list/i.test(url)) {
      return {
        ...view,
        status: 'failed',
        error: { code: 'not_a_list', message: CRAWL_ERRORS.not_a_list },
        finishedAt: at(2),
        updatedAt: at(2),
      };
    }
    if (/all-busy/i.test(url)) {
      // Both companies chosen were already being read from other links: nothing read.
      return {
        ...view,
        status: 'succeeded',
        list: {
          companies: FAKE_LIST_COMPANIES.slice(0, 2),
          skipped: 0,
          busy: 2,
          waiting: 0,
          running: 0,
          ended: 0,
          crawlIds: [],
        },
        startedAt: at(1),
        updatedAt: at(2),
        finishedAt: at(2),
        stats: { jobsFound: 0, jobsNew: 0, jobsUpdated: 0, companies: { succeeded: 0, failed: 0 } },
      };
    }
    const noJobs = /list-no-jobs/i.test(url);
    const noneFit = noJobs || /jobs-fit-none/i.test(url);
    const chosen = /nothing-fits|unreadable/i.test(url) ? [] : FAKE_LIST_COMPANIES;
    const total = chosen.length;
    const ended = Math.min(total, step - 2);
    const running = Math.min(3, total - ended);
    const list = {
      companies: chosen,
      skipped: /unreadable/i.test(url) ? 4 : /nothing-fits/i.test(url) ? 0 : 3,
      busy: 0,
      waiting: total - ended - running,
      running,
      ended,
      crawlIds: chosen.slice(0, ended + running).map((_, i) => `${String(view.crawlId)}-${i}`),
    };
    if (ended < total) {
      return { ...view, status: 'running', startedAt: at(1), updatedAt: at(step), list };
    }
    const finished = 2 + total;
    const done = {
      ...view,
      status: 'succeeded',
      list,
      startedAt: at(1),
      updatedAt: at(finished),
      finishedAt: at(finished),
      stats:
        total === 0
          ? { jobsFound: 0, jobsNew: 0, jobsUpdated: 0, companies: { succeeded: 0, failed: 0 } }
          : {
              // "list-no-jobs": its companies have no open jobs at all.
              jobsFound: noJobs ? 0 : 46,
              jobsNew: noJobs ? 0 : 46,
              jobsUpdated: 0,
              // "jobs-fit-none": its companies' jobs were read, and none fit.
              jobsRelevant: noneFit ? 0 : 12,
              companies: { succeeded: total - 1, failed: 1 },
            },
    };
    const scored = total > 0 && !noneFit;
    if (view.aiSource === 'none' || !scored || step < finished + 1) return done;
    return { ...done, relevance: { status: step < finished + 2 ? 'running' : 'done' } };
  }

  /** A résumé as the API shows it now: its status moves on with time once its file is in. */
  function documentView({ view, uploadedAt }: FakeDocument): Record<string, unknown> {
    if (uploadedAt === undefined) return view;
    const since = now() - uploadedAt;
    if (since < checkMs || /still-checking/i.test(view.fileName)) {
      return { ...view, status: 'pending' };
    }
    if (since < 2 * checkMs) return { ...view, status: 'processing' };
    const outcome = OUTCOMES.find(({ match }) => match.test(view.fileName));
    return outcome
      ? { ...view, status: outcome.status, error: outcome.error }
      : { ...view, status: 'ready' };
  }

  return {
    async upload(form: UploadForm, file: Blob, { onProgress, signal }: UploadOptions = {}) {
      // Sent in four parts, so the progress is seen moving.
      for (const part of [0.25, 0.5, 0.75]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (signal?.aborted) throw signal.reason;
        onProgress?.(part);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal?.aborted) throw signal.reason;
      if (!form.url.startsWith(UPLOAD_URL)) throw new ApiError('invalid', { status: 403 });
      if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
        throw new ApiError('invalid', { status: 400 });
      }
      const key = form.fields.key;
      for (const mine of documents.values()) {
        const document = mine.find(({ view }) => view.documentId === key);
        if (document) {
          document.uploadedAt = now();
          document.view = { ...document.view, sizeBytes: file.size };
        }
      }
      onProgress?.(1);
    },
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const me = await user();
      if (!me) throw new ApiError('signed-out', { status: 401 });
      const saved = profiles.get(me);
      if (path === '/me/profile' && method === 'GET') {
        return (saved ?? {
          version: 0,
          email: me,
          homeCell: 'iad',
          skills: [],
          languages: [],
          links: { other: [] },
        }) as T;
      }
      if (path === '/me/profile' && method === 'PUT') {
        // The API's own (strict) schema: a field it does not take is refused, as there.
        const checked = profileInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        const { version, ...fields } = checked.data;
        const current = typeof saved?.version === 'number' ? saved.version : 0;
        if (version !== current) throw new ApiError('conflict', { status: 409, code: 'conflict' });
        const now = new Date().toISOString();
        const next = {
          ...fields,
          version: current + 1,
          email: me,
          homeCell: 'iad',
          createdAt: (saved?.createdAt as string | undefined) ?? now,
          updatedAt: now,
        };
        profiles.set(me, next);
        return next as T;
      }
      const mine = roles.get(me) ?? [];
      if (path === '/me/roles' && method === 'GET') return { roles: mine } as T;
      if (path === '/me/roles' && method === 'POST') {
        const checked = createRoleInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        if (mine.length >= MAX_ROLES) throw new ApiError('invalid', { status: 422 });
        const now = new Date().toISOString();
        lastRole += 1;
        // A ULID's shape (26 Crockford characters), counting up so the list stays oldest first.
        const roleId = String(lastRole).padStart(26, '0');
        const role = { ...checked.data, roleId, version: 1, createdAt: now, updatedAt: now };
        roles.set(me, [...mine, role]);
        return role as T;
      }
      const myDocuments = documents.get(me) ?? [];
      if (path === '/me/documents' && method === 'GET') {
        return { documents: myDocuments.map(documentView).reverse() } as T;
      }
      if (path === '/me/documents' && method === 'POST') {
        const checked = createDocumentInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        if (myDocuments.length >= MAX_DOCUMENTS) throw new ApiError('invalid', { status: 422 });
        const now = new Date().toISOString();
        lastDocument += 1;
        const documentId = String(lastDocument).padStart(26, '0');
        const { fileName, contentType } = checked.data;
        const view = {
          documentId,
          title: fileName.replace(/\.(pdf|docx)$/i, ''),
          fileName,
          format: DOCUMENT_TYPES[contentType].format,
          status: 'pending',
          // As the API: the default when there is none (the first, or after the default went).
          isDefault: !myDocuments.some(({ view }) => view.isDefault),
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        documents.set(me, [...myDocuments, { view }]);
        return {
          document: view,
          upload: {
            url: UPLOAD_URL,
            fields: { key: documentId, 'Content-Type': contentType },
            maxBytes: MAX_UPLOAD_BYTES,
            expiresInSeconds: 300,
          },
        } as T;
      }
      const documentId = /^\/me\/documents\/([^/]+)$/.exec(path)?.[1];
      const document = myDocuments.find(({ view }) => view.documentId === documentId);
      if (document && method === 'GET') {
        // As the API: only a ready one has a download link.
        const now = documentView(document);
        return (now.status === 'ready' ? { ...now, downloadUrl: FAKE_DOWNLOAD_URL } : now) as T;
      }
      if (document && method === 'PUT') {
        // As the API: a rename, then the default, each a new version; a stale version is a
        // conflict, and making one the default clears any other.
        const checked = updateDocumentInput.safeParse(body);
        if (!checked.success) throw refused(checked.error.issues);
        const { version, title, isDefault } = checked.data;
        if (version !== document.view.version) {
          throw new ApiError('conflict', { status: 409, code: 'conflict' });
        }
        let next = version;
        if (title !== undefined) {
          next += 1;
          document.view = { ...document.view, title, version: next };
        }
        if (isDefault) {
          for (const each of myDocuments) {
            if (each !== document && each.view.isDefault) {
              each.view = { ...each.view, isDefault: false };
            }
          }
          document.view = { ...document.view, isDefault: true, version: next + 1 };
        }
        return documentView(document) as T;
      }
      if (document && method === 'DELETE') {
        const left = myDocuments.filter((each) => each !== document);
        documents.set(me, left);
        // As the API: the default hands over to the newest ready one (none ready: no default).
        if (document.view.isDefault) {
          const next = left.findLast((each) => documentView(each).status === 'ready');
          if (next) {
            next.view = {
              ...next.view,
              isDefault: true,
              version: (next.view.version as number) + 1,
            };
          }
        }
        return undefined as T;
      }
      const roleId = /^\/me\/roles\/([^/]+)$/.exec(path)?.[1];
      if (roleId && method === 'DELETE' && mine.some((role) => role.roleId === roleId)) {
        roles.set(
          me,
          mine.filter((role) => role.roleId !== roleId),
        );
        return undefined as T;
      }
      const myCrawls = crawls.get(me) ?? [];
      if (path.startsWith('/me/crawls?') && method === 'GET') {
        // Newest first, a page at a time, as the API pages them (`?limit=&cursor=`).
        const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
        const limit = Number(query.get('limit') ?? 20);
        const cursor = query.get('cursor');
        const at = cursor ? myCrawls.findIndex((each) => each.view.crawlId === cursor) : -1;
        // The API's cursor is a key: one it never gave is refused, never read as the start.
        if (cursor && at < 0) throw new ApiError('invalid', { status: 400 });
        const start = at + 1;
        const page = myCrawls.slice(start, start + limit);
        const more = start + limit < myCrawls.length;
        return {
          crawls: page.map(crawlView),
          ...(more ? { nextCursor: page.at(-1)?.view.crawlId } : {}),
        } as T;
      }
      const myStages = stages.get(me) ?? new Map<string, { stage: string; at: string }>();
      stages.set(me, myStages);
      /** The fake's jobs, each with its stage (#52), as the API lists them. */
      const myJobs = (): Record<string, unknown>[] =>
        fakeCompanies(myCrawls.map(crawlView))
          .flatMap((company) => company.jobs as Record<string, unknown>[])
          .map((job) => {
            const moved = myStages.get(String(job.jobId));
            return moved
              ? { ...job, status: moved.stage, appliedAt: moved.at, stageAt: moved.at }
              : { ...job, status: 'new' };
          });
      if (path === '/me/matches' && method === 'GET') {
        // Not applied to, best first (a job not scored yet after the scored ones).
        const jobs = myJobs()
          .filter((job) => job.status === 'new')
          .map((job, at) => ({ job, at, score: (job.relevance as { score?: number })?.score }))
          .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.at - b.at)
          .map(({ job }) => job);
        return { jobs, truncated: false } as T;
      }
      const stageOf = /^\/me\/jobs\/([0-9a-f]{32})\/stage$/.exec(path)?.[1];
      if (stageOf && method === 'PUT') {
        const job = myJobs().find((each) => each.jobId === stageOf);
        if (!job) throw new ApiError('not-found', { status: 404 });
        const { stage, from } = (body ?? {}) as { stage?: string; from?: string };
        // The API's rules (packages/shared `jobStageBody`): new ⇄ applied, onward from applied.
        const allowed =
          from === 'new' ? stage === 'applied' : stage !== 'new' || from === 'applied';
        if (!stage || !from || !allowed) throw new ApiError('invalid', { status: 400 });
        // Changed meanwhile (another tab): refused, never overwritten.
        if (job.status !== from) {
          throw new ApiError('conflict', { status: 409, code: 'stage-changed' });
        }
        if (stage === 'new') myStages.delete(stageOf);
        else {
          const was = myStages.get(stageOf);
          myStages.set(stageOf, { stage, at: was?.at ?? new Date(now()).toISOString() });
        }
        return myJobs().find((each) => each.jobId === stageOf) as T;
      }
      const jobId = /^\/me\/jobs\/([0-9a-f]{32})$/.exec(path)?.[1];
      if (jobId && method === 'GET') {
        const job = myJobs().find((each) => each.jobId === jobId);
        if (!job) throw new ApiError('not-found', { status: 404 });
        // The third job's board shared no description.
        return (
          String(job.title).startsWith('Staff')
            ? { ...job, hasDescription: false }
            : {
                ...job,
                hasDescription: true,
                description: FAKE_DESCRIPTION,
                descriptionTruncated: false,
              }
        ) as T;
      }
      if (path === '/me/crawls' && method === 'POST') {
        // The API's own check of the address (packages/shared/src/crawl.ts), then one at a time.
        const checked = parseCrawlUrl(String((body as { url?: unknown })?.url ?? ''));
        if (!checked.ok) {
          throw new ApiError('invalid', {
            status: 400,
            code: checked.code,
            message: checked.message,
          });
        }
        const aiSource =
          (body as { aiSource?: unknown })?.aiSource === 'none' ? 'none' : 'platform';
        // A link with "ai-limit" in it finds the free AI runs used up (scoring by keywords works).
        if (aiSource === 'platform' && /ai-limit/i.test(checked.normalizedUrl)) {
          throw new ApiError('too-many', {
            status: 429,
            code: 'platform-ai-limit-reached',
            retryAfterSeconds: 3600,
          });
        }
        // #50: a GitHub list. "list-limit" finds the day's lists used; "lists-off" finds them off.
        const list = githubListFromUrl(checked.url);
        if (list && /list-limit/i.test(checked.normalizedUrl)) {
          throw new ApiError('too-many', { status: 429, code: 'daily-list-limit-reached' });
        }
        if (list && /lists-off/i.test(checked.normalizedUrl)) {
          throw new ApiError('conflict', { status: 409, code: 'lists-turned-off' });
        }
        const latest = myCrawls[0];
        if (latest && ['queued', 'running'].includes(String(crawlView(latest).status))) {
          throw new ApiError('too-many', {
            status: 429,
            code: 'too-many-active-crawls',
            retryAfterSeconds: 30,
          });
        }
        lastCrawl += 1;
        const crawl: FakeCrawl = {
          view: {
            crawlId: `fake-crawl-${lastCrawl}`,
            // A list keeps the link's own words (the repository's name), as the API shows it.
            url: list ? `https://github.com/${list.owner}/${list.repo}` : checked.normalizedUrl,
            ...(list ? { kind: 'list' } : {}),
            aiSource,
            createdAt: new Date(now()).toISOString(),
          },
          startedAt: now(),
        };
        crawls.set(me, [crawl, ...myCrawls]);
        return crawlView(crawl) as T;
      }
      throw new ApiError('not-found', { status: 404 });
    },
  };
}

/**
 * The companies the fake's finished crawls found (#49), newest crawl first, one per link:
 * named from the link ("boards.greenhouse.io/acme" is Acme), with three jobs, ranked. A link with
 * "no-ai" in it was ranked without AI (no scores); "nothing-fits" found none that fit.
 */
function fakeCompanies(views: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const companies: Record<string, unknown>[] = [];
  // #50: a list run's companies, each as its own crawl once read (the last one's read failed).
  const crawled = views.flatMap((view) => {
    if (view.kind !== 'list') return [view];
    const list = view.list as { companies: { url: string }[]; ended: number } | undefined;
    const read = Math.min(list?.ended ?? 0, FAKE_LIST_COMPANIES.length - 1);
    return (list?.companies ?? [])
      .slice(0, read)
      .map((company) => ({ status: 'succeeded', url: company.url, createdAt: view.createdAt }));
  });
  for (const crawl of crawled) {
    if (crawl.status !== 'succeeded' || /nothing-fits/i.test(String(crawl.url))) continue;
    const url = new URL(String(crawl.url));
    const slug = url.pathname.split('/').filter(Boolean)[0] ?? url.hostname.split('.')[0] ?? 'x';
    const key = `fake:${slug.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
    const scored = !/no-ai/i.test(url.href);
    companies.push({
      companyKey: key,
      companyName: name,
      jobs: FAKE_JOBS.map((job, i) => ({
        jobId: `${String(companies.length)}${String(i)}`.padEnd(32, 'a'),
        title: job.title,
        companyKey: key,
        companyName: name,
        locations: [{ text: job.place }],
        ...(job.workplace ? { workplace: job.workplace } : {}),
        jobUrl: `${url.origin}${url.pathname.replace(/\/$/, '')}/jobs/${i + 1}`,
        // The first job's board has an application page of its own (Manual apply opens it).
        ...(i === 0
          ? { applyUrl: `${url.origin}${url.pathname.replace(/\/$/, '')}/jobs/${i + 1}/apply` }
          : {}),
        ...(job.posted ? { postedAt: job.posted } : {}),
        firstSeenAt: String(crawl.createdAt),
        // The third job's board shared no text.
        hasDescription: !job.title.startsWith('Staff'),
        ...(scored ? { relevance: { score: job.score, reasons: job.reasons } } : {}),
      })),
    });
  }
  return companies;
}

const FAKE_DESCRIPTION = `About the role
You'll build the services our customers rely on every day, with a small team that owns its work end to end.

What you'll do
- Design and run TypeScript services on AWS
- Work with product and design on what to build next
- Keep things fast, safe and simple

What we look for
- 5+ years building backend systems
- Experience with TypeScript, Node.js and AWS
- Clear writing, and care for the people who use what you build`;

const FAKE_JOBS = [
  {
    title: 'Senior Backend Engineer',
    place: 'New York, NY',
    workplace: 'hybrid',
    // Date only (kept as midnight UTC), as most boards give it.
    posted: '2026-11-20T00:00:00.000Z',
    score: 86,
    reasons: ['Matches your target role Backend engineer', 'Asks for TypeScript and AWS'],
  },
  {
    title: 'Platform Engineer, Developer Experience',
    place: 'Remote, United States',
    workplace: 'remote',
    posted: '2026-11-12T15:30:00.000Z',
    score: 63,
    reasons: ['Close to Platform engineer', 'Kubernetes is not on your résumé'],
  },
  {
    title: 'Staff Software Engineer, Payments',
    place: 'San Francisco, CA',
    workplace: 'onsite',
    // The board gave no date.
    posted: undefined,
    score: 41,
    reasons: ['More senior than your roles'],
  },
] as const;

/** #50: the companies the fake's lists choose, best first (named from their boards' links). */
const FAKE_LIST_COMPANIES = [
  { name: 'Acme', url: 'https://job-boards.greenhouse.io/acme' },
  { name: 'Globex', url: 'https://jobs.lever.co/globex' },
  { name: 'Initech', url: 'https://jobs.ashbyhq.com/initech' },
  { name: 'Umbrella', url: 'https://job-boards.greenhouse.io/umbrella' },
  { name: 'Hooli', url: 'https://jobs.ashbyhq.com/hooli' },
];

interface FakeCrawl {
  view: Record<string, unknown>;
  startedAt: number;
}

/** Counted across every fake, as résumés are. */
let lastCrawl = 0;

/** A body the API's schema refuses: a 400 naming each wrong field. */
function refused(issues: { path: PropertyKey[]; message: string }[]): ApiError {
  return new ApiError('invalid', {
    status: 400,
    fieldErrors: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}
