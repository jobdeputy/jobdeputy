import {
  type ApplicantAnswers,
  applicantInput,
  type VoluntaryAnswers,
  voluntaryInput,
} from '@jobdeputy/shared/applicant';
import { z } from 'zod';
import type { Api, ApiResult } from '../api.ts';
import type { SilentOutcome } from '../auth/session.ts';
import type { FileData, Files } from './files.ts';
import { jobIdFor, type Posting } from './posting.ts';

/**
 * #54 PR C: everything the Greenhouse filler fills one application with, read by the service
 * worker for the posting the page is (decision 0020: the page never sees a token). Only the
 * answers a form asks for: no résumé text, no job details. Nothing here is stored: the worker
 * reads it when asked and hands it over (voluntary answers included, 0019).
 */
export interface FillData {
  person: Person;
  /** The application answers (#53) this build can read, or null when none are saved. */
  applicant: Partial<ApplicantAnswers> | null;
  /**
   * The self-ID answers, only once the person saved them (never the defaults), and only those
   * the API could read back: one it read as `decline` for that reason is left out (unread).
   */
  voluntary: Partial<VoluntaryAnswers> | null;
  /** The company's newest ready tailored résumé, else the default résumé. */
  resume: (FileData & { from: 'tailored' | 'default' }) | null;
  /** This job's newest ready cover letter; never one written for the page. */
  coverLetter: FileData | null;
  /** What couldn't be read just now: the rest still fills, and the panel says so. */
  unread: Unread[];
}
export type Unread = 'answers' | 'voluntary' | 'resume' | 'cover-letter';

// Read defensively: an odd shape counts as not there (or unread), never as a crash. Unknown
// fields (version, updatedAt) are dropped.
const text = z.string().trim().min(1).max(2000);
/** The profile as the filler reads it (the popup counts with it too, so the two agree). */
export const person = z.object({
  firstName: text.optional().catch(undefined),
  lastName: text.optional().catch(undefined),
  preferredName: text.optional().catch(undefined),
  email: text.optional().catch(undefined),
  phone: z.object({ countryCode: text, number: text }).optional().catch(undefined),
  // Field by field, so one odd value drops only itself (the country is the location's key).
  location: z
    .object({
      city: text.optional().catch(undefined),
      region: text.optional().catch(undefined),
      country: z.string().regex(/^[A-Z]{2}$/),
      postalCode: text.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  links: z
    .object({
      linkedin: text.optional().catch(undefined),
      github: text.optional().catch(undefined),
      portfolio: text.optional().catch(undefined),
      website: text.optional().catch(undefined),
    })
    .catch({}),
});
/** The person's details a form asks for (#49 profile). */
export type Person = z.infer<typeof person>;

const { version: _a, ...applicantShape } = applicantInput.shape;
const { version: _v, ...voluntaryShape } = voluntaryInput.shape;

/**
 * Saved answers read one by one: a value this build doesn't know (an option added since it was
 * released, say) drops only that answer, never its neighbours, and is counted as dropped.
 */
function answersOf<S extends Record<string, z.ZodType>>(shape: S) {
  return z
    .object({ version: z.number().int() })
    .loose()
    .transform((raw) => {
      const fields = raw as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      let dropped = false;
      for (const [key, schema] of Object.entries(shape)) {
        const field = schema.safeParse(fields[key]);
        if (field.success) {
          if (field.data !== undefined) values[key] = field.data;
        } else if (fields[key] !== undefined) dropped = true;
      }
      const { unreadable } = fields;
      return {
        version: raw.version,
        values: values as Partial<{ [K in keyof S]: z.infer<S[K]> }>,
        dropped,
        unreadable: Array.isArray(unreadable) ? unreadable.map(String) : [],
      };
    });
}
/** The application answers as the filler reads them (the popup counts with it too). */
export const applicant = answersOf(applicantShape);
/** Every application answer a form may ask, from the shared schema. */
export const APPLICANT_KEYS = Object.keys(applicantShape);
const voluntary = answersOf(voluntaryShape);

const generated = z.object({
  documentId: z.string(),
  status: z.string(),
  fileName: z.string().optional(),
  createdAt: z.string(),
});
const tailorings = z.object({ tailorings: z.array(generated) });
const coverLetters = z.object({ coverLetters: z.array(generated) });
/** The documents list as the filler reads it (the popup checks the résumé with it too). */
export const documents = z.object({
  documents: z.array(
    z.object({
      documentId: z.string(),
      status: z.string(),
      isDefault: z.boolean().optional(),
      fileName: z.string(),
    }),
  ),
});
const downloads = z.object({ downloads: z.object({ pdf: z.string() }) });
const download = z.object({ downloadUrl: z.string() });

/** A read that failed for a reason other than being signed out. */
const FAILED = Symbol('failed');
type Read<T> = T | typeof FAILED;
type Failure = Extract<ApiResult<never>, { ok: false }>['reason'];

/**
 * The résumé the filler attaches when a company has no tailored one: the default, once ready.
 * The popup's "résumé ready" uses the same rule, so it never promises a file the filler lacks.
 */
export function isAttachable(doc: { status?: unknown; isDefault?: unknown } | null): boolean {
  return doc?.isDefault === true && doc.status === 'ready';
}

/** The newest ready version with a file name (ISO times sort as text). */
function newestReady(list: z.infer<typeof generated>[]) {
  return list
    .filter((v) => v.status === 'ready' && v.fileName)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function readFillData(
  api: Api,
  files: Files,
  posting: Posting,
): Promise<ApiResult<FillData>> {
  let signedOut = false;
  /** The body, parsed; FAILED when it failed or has an odd shape; signed out is noted. */
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    onFailure?: (reason: Failure) => void,
  ): Promise<Read<T>> {
    const res = await api.get<unknown>(path);
    if (!res.ok) {
      if (res.reason === 'signed-out') signedOut = true;
      onFailure?.(res.reason);
      return FAILED;
    }
    const parsed = schema.safeParse(res.body);
    return parsed.success ? parsed.data : FAILED;
  }

  /** A generated file (tailored résumé or letter): undefined when none is ready. */
  async function newestFile(
    list: Read<z.infer<typeof generated>[]>,
    path: (id: string) => string,
  ): Promise<Read<FileData | undefined>> {
    if (list === FAILED) return FAILED;
    const newest = newestReady(list);
    if (!newest?.fileName) return undefined;
    const one = await read(path(newest.documentId), downloads);
    if (one === FAILED) return FAILED;
    return (await files.read(one.downloads.pdf, newest.fileName)) ?? FAILED;
  }

  const jobId = await jobIdFor(posting);
  const company = encodeURIComponent(posting.companyKey);
  // The profile's own reason, if it fails: another read being offline says nothing about it.
  let profileFailure = 'failed' as Failure;
  const [profile, answers, selfId, tailored, letters, docs] = await Promise.all([
    read('/me/profile', person, (reason) => {
      profileFailure = reason;
    }),
    read('/me/applicant', applicant),
    read('/me/voluntary', voluntary),
    read(`/me/tailorings?companyKey=${company}`, tailorings),
    read(`/me/cover-letters?jobId=${jobId}`, coverLetters),
    read('/me/documents', documents),
  ]);
  // Nothing to fill with: no file is downloaded only to be dropped.
  if (signedOut) return { ok: false, reason: 'signed-out' };
  if (profile === FAILED)
    return { ok: false, reason: profileFailure === 'offline' ? 'offline' : 'failed' };

  const [tailoredFile, letterFile] = await Promise.all([
    newestFile(tailored === FAILED ? FAILED : tailored.tailorings, (id) => `/me/tailorings/${id}`),
    newestFile(
      letters === FAILED ? FAILED : letters.coverLetters,
      (id) => `/me/cover-letters/${id}`,
    ),
  ]);

  // The default résumé, only when the company has no tailored one ready. If the tailored one
  // couldn't be read, nothing is attached: the default instead would quietly be the wrong file.
  let resume: FillData['resume'] | typeof FAILED = null;
  if (tailoredFile === FAILED || (!tailoredFile && docs === FAILED)) resume = FAILED;
  else if (tailoredFile) resume = { ...tailoredFile, from: 'tailored' };
  else if (docs !== FAILED) {
    const chosen = docs.documents.find(isAttachable);
    if (chosen) {
      const one = await read(`/me/documents/${chosen.documentId}`, download);
      const file = one === FAILED ? null : await files.read(one.downloadUrl, chosen.fileName);
      resume = file ? { ...file, from: 'default' } : FAILED;
    }
  }

  // Signed out only while reading the files: still nothing handed over.
  if (signedOut) return { ok: false, reason: 'signed-out' };
  const unread: Unread[] = [];
  if (answers === FAILED || answers.dropped) unread.push('answers');
  // Only what the API read back as saved: an answer it couldn't is never sent as decline.
  const saved =
    selfId === FAILED
      ? {}
      : (Object.fromEntries(
          Object.entries(selfId.values).filter(([key]) => !selfId.unreadable.includes(key)),
        ) as Partial<VoluntaryAnswers>);
  if (selfId === FAILED || selfId.dropped || selfId.unreadable.length > 0) unread.push('voluntary');
  if (resume === FAILED) unread.push('resume');
  if (letterFile === FAILED) unread.push('cover-letter');
  return {
    ok: true,
    body: {
      person: profile,
      applicant: answers !== FAILED && answers.version > 0 ? answers.values : null,
      voluntary:
        selfId !== FAILED && selfId.version > 0 && Object.keys(saved).length > 0 ? saved : null,
      resume: resume === FAILED ? null : resume,
      coverLetter: letterFile === FAILED ? null : (letterFile ?? null),
      unread,
    },
  };
}

/**
 * A form's answers. Signed out here, it first tries signing in without a window (#111: the person
 * may be signed in on the site), then reads once more; otherwise the form hears it is signed out.
 */
export async function readFillDataSigningIn(
  api: Api,
  files: Files,
  posting: Posting,
  signInSilently: () => Promise<SilentOutcome>,
): Promise<ApiResult<FillData>> {
  const first = await readFillData(api, files, posting);
  if (first.ok || first.reason !== 'signed-out') return first;
  if ((await signInSilently()) !== 'signed-in') return first;
  return readFillData(api, files, posting);
}
