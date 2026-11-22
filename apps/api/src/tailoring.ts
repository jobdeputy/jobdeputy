import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AccountRepository,
  AiKeyRepository,
  CompanyLimitRepository,
  DocumentRepository,
  documentClient,
  type GeneratedDocument,
  JobRepository,
  TailoringAllowanceError,
  TailoringBusyError,
  TailoringRepository,
} from '@jobdeputy/db';
import {
  type AiSource,
  aiProvider,
  callerFromEvent,
  compareRank,
  createLogger,
  createTailoringInput,
  DOWNLOAD_URL_SECONDS,
  type HttpResponse,
  json,
  nextUtcMonthStart,
  PLATFORM_TAILORINGS_PER_MONTH,
  parseJsonBody,
  problem,
  structuredResume,
  TAILORING_ERRORS,
  TAILORING_STALE_MS,
  tailoringId,
  tailoringKeys,
  tailoringsQuery,
  validationProblem,
} from '@jobdeputy/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ulid } from 'ulid';
import { refuseWritesWhileDeleting } from './account-guard.js';
import { type UserAudit, userAudit } from './audited.js';
import { attachment } from './documents.js';
import { concurrentUpdateProblem } from './errors.js';

// #51 (decision 0015): tailored résumés, one version per Tailor click.
//   POST /me/tailorings                  ask for a version for a company's shown jobs (202)
//   GET  /me/tailorings?companyKey=…     a company's versions, newest first, and the allowance
//   GET  /me/tailorings/{documentId}     one version: scores, the résumé (to preview), downloads
// The work is asynchronous: the queued version starts the tailoring worker (documents stream).

const logger = createLogger('api-tailoring');

/** The company's top shown jobs a version is made for (decision 0013: 3 shown per company). */
export const TAILORING_JOBS = 3;

export interface TailoringDeps {
  runs: Pick<TailoringRepository, 'request' | 'list' | 'get' | 'platformRunsUsed'>;
  documents: Pick<DocumentRepository, 'list'>;
  shown: Pick<CompanyLimitRepository, 'get'>;
  jobs: Pick<JobRepository, 'getSummaries'>;
  keys: Pick<AiKeyRepository, 'get' | 'getSettings'>;
  /** A stored file's text (a version's résumé JSON). */
  readFile: (key: string) => Promise<string>;
  presignDownload: (key: string, fileName: string) => Promise<string>;
  allowTestProvider: boolean;
  newId: () => string;
  now: () => Date;
  isBeingDeleted: (userId: string) => Promise<boolean>;
  audit: UserAudit;
}

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;

/** A version as the app sees it: no storage keys. A run past its time shows as stopped. */
export function tailoringView(v: GeneratedDocument, now: Date) {
  const stale =
    (v.status === 'queued' || v.status === 'processing') &&
    now.getTime() - Date.parse(v.createdAt) > TAILORING_STALE_MS;
  const status = stale ? 'failed' : v.status;
  const error = stale ? 'stopped' : v.error;
  return {
    documentId: v.documentId,
    companyKey: v.companyKey,
    ...(v.companyName ? { companyName: v.companyName } : {}),
    jobIds: v.jobIds,
    baseDocumentId: v.baseDocumentId,
    aiSource: v.aiSource,
    status,
    ...(error ? { error, message: TAILORING_ERRORS[error] } : {}),
    ...(v.tailoring.result ? { result: v.tailoring.result } : {}),
    ...(v.tailoring.scores ? { scores: v.tailoring.scores } : {}),
    ...(v.tailoring.coverage !== undefined ? { coverage: v.tailoring.coverage } : {}),
    ...(v.fileName ? { fileName: v.fileName } : {}),
    ...(v.sizeBytes !== undefined ? { sizeBytes: v.sizeBytes } : {}),
    createdAt: v.createdAt,
    ...(v.tailoring.finishedAt ? { finishedAt: v.tailoring.finishedAt } : {}),
  };
}

/** The AI source a run uses, or the problem to answer. Tailoring needs a model. */
async function sourceFor(
  userId: string,
  asked: AiSource | undefined,
  deps: TailoringDeps,
  requestId: string,
): Promise<AiSource | HttpResponse> {
  const source = asked ?? (await deps.keys.getSettings(userId))?.defaultSource ?? 'platform';
  if (source === 'none') {
    return problem(422, 'An AI model is needed', {
      detail: 'Tailoring writes with an AI model. Choose the free one, or a key you saved.',
      code: 'model_needed',
      requestId,
    });
  }
  const provider = aiProvider(source, deps.allowTestProvider);
  if (source !== 'platform') {
    const key = provider ? await deps.keys.get(userId, provider) : undefined;
    if (!key || key.status === 'invalid') {
      return problem(422, 'Validation failed', {
        errors: [
          { path: 'aiSource', message: 'Use platform or a provider you saved a working key for' },
        ],
        requestId,
      });
    }
  }
  return source;
}

async function request(
  userId: string,
  body: unknown,
  deps: TailoringDeps,
  requestId: string,
): Promise<HttpResponse> {
  const input = createTailoringInput(deps.allowTestProvider).safeParse(body);
  if (!input.success) return validationProblem(input.error, requestId);
  const { companyKey } = input.data;
  const source = await sourceFor(
    userId,
    input.data.aiSource as AiSource | undefined,
    deps,
    requestId,
  );
  if (typeof source !== 'string') return source;

  // The default résumé: ready, with text.
  const base = (await deps.documents.list(userId)).find(
    (d) => d.isDefault && d.status === 'ready' && d.parsed && !d.parsed.noText,
  );
  if (!base) {
    return problem(422, 'No résumé to tailor', {
      detail: TAILORING_ERRORS.no_resume,
      code: 'no_resume',
      requestId,
    });
  }
  // The company's shown jobs, best first, still open and shown.
  const { shown } = await deps.shown.get(userId, companyKey);
  const ranked = Object.entries(shown)
    .map(([jobId, entry]) => ({ jobId, ...entry }))
    .sort(compareRank)
    .map((r) => r.jobId);
  const found = new Map((await deps.jobs.getSummaries(userId, ranked)).map((j) => [j.jobId, j]));
  const jobs = ranked
    .map((id) => found.get(id))
    .filter(
      (j): j is NonNullable<typeof j> =>
        j !== undefined &&
        j.closedAt === undefined &&
        j.filter?.state !== 'not_relevant' &&
        j.limitState !== 'over_limit',
    )
    .slice(0, TAILORING_JOBS);
  if (jobs.length === 0) {
    return problem(422, 'No jobs to tailor for', {
      detail: TAILORING_ERRORS.no_jobs,
      code: 'no_jobs',
      requestId,
    });
  }
  const documentId = deps.newId();
  const companyName = jobs.find((j) => j.companyName)?.companyName;
  try {
    const doc = await deps.runs.request(
      {
        userId,
        documentId,
        title: `Résumé for ${companyName ?? companyKey}`,
        companyKey,
        ...(companyName ? { companyName } : {}),
        jobIds: jobs.map((j) => j.jobId),
        baseDocumentId: base.documentId,
        aiSource: source,
        platformRun: source === 'platform',
      },
      deps.audit(
        'tailoring.requested',
        { type: 'document', id: documentId },
        `Tailored résumé asked for ${companyName ?? companyKey}`,
      ),
      { perMonth: PLATFORM_TAILORINGS_PER_MONTH, staleMs: TAILORING_STALE_MS },
    );
    logger.info('Tailoring requested', { documentId, jobs: jobs.length, aiSource: source });
    return json(202, { tailoring: tailoringView(doc, deps.now()) });
  } catch (error) {
    if (error instanceof TailoringAllowanceError) {
      const next = nextUtcMonthStart(deps.now());
      const res = problem(429, 'Free tailoring used up', {
        code: 'tailoring_allowance',
        detail: `You've used your free tailored résumés (${PLATFORM_TAILORINGS_PER_MONTH} a month). The next one is available at ${next.toISOString()}. Until then, tailor with your own key.`,
        requestId,
      });
      const seconds = Math.max(1, Math.ceil((next.getTime() - deps.now().getTime()) / 1000));
      return { ...res, headers: { ...res.headers, 'retry-after': String(seconds) } };
    }
    if (error instanceof TailoringBusyError) {
      return problem(409, 'Already tailoring', {
        detail: 'A résumé for this company is being tailored. Wait for it to finish.',
        code: 'tailoring_busy',
        requestId,
      });
    }
    throw error;
  }
}

export async function route(event: Event, deps: TailoringDeps): Promise<HttpResponse> {
  const requestId = event.requestContext.requestId;
  const caller = callerFromEvent(event);
  if (!caller) return problem(401, 'Unauthorized', { requestId });
  const { userId } = caller;
  const blocked = await refuseWritesWhileDeleting(
    event.routeKey,
    userId,
    deps.isBeingDeleted,
    requestId,
  );
  if (blocked) return blocked;
  const notFound = () => problem(404, 'Not found', { requestId });

  switch (event.routeKey) {
    case 'POST /me/tailorings': {
      const body = parseJsonBody(event.body, event.isBase64Encoded);
      if (body === undefined) return problem(400, 'Body must be valid JSON', { requestId });
      return request(userId, body, deps, requestId);
    }
    case 'GET /me/tailorings': {
      const query = tailoringsQuery.safeParse(event.queryStringParameters ?? {});
      if (!query.success) return validationProblem(query.error, requestId);
      const now = deps.now();
      const [versions, used] = await Promise.all([
        deps.runs.list(userId, query.data.companyKey),
        deps.runs.platformRunsUsed(userId, now),
      ]);
      return json(200, {
        tailorings: versions.map((v) => tailoringView(v, now)),
        allowance: {
          used,
          perMonth: PLATFORM_TAILORINGS_PER_MONTH,
          nextAt: nextUtcMonthStart(now).toISOString(),
        },
      });
    }
    case 'GET /me/tailorings/{documentId}': {
      const id = tailoringId.safeParse(event.pathParameters?.documentId);
      if (!id.success) return validationProblem(id.error, requestId);
      const v = await deps.runs.get(userId, id.data);
      if (!v) return notFound();
      const view = tailoringView(v, deps.now());
      if (v.status !== 'ready' || !v.fileName) return json(200, view);
      const keys = tailoringKeys(userId, v.documentId);
      const [resume, pdf, docx] = await Promise.all([
        deps.readFile(keys.json).then((text) => structuredResume.parse(JSON.parse(text))),
        deps.presignDownload(keys.pdf, v.fileName),
        deps.presignDownload(keys.docx, v.fileName.replace(/\.pdf$/, '.docx')),
      ]);
      return json(200, { ...view, resume, downloads: { pdf, docx } });
    }
    default:
      return notFound();
  }
}

function defaultDeps(): TailoringDeps {
  const {
    DOCUMENTS_TABLE_NAME,
    DOCUMENTS_BUCKET_NAME,
    USERS_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USAGE_TABLE_NAME,
    JOBS_TABLE_NAME,
    AI_KEYS_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    ALLOW_TEST_AI_PROVIDER,
  } = process.env;
  if (
    !DOCUMENTS_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME ||
    !USERS_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !JOBS_TABLE_NAME ||
    !AI_KEYS_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME
  ) {
    throw new Error('Table and bucket names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const s3 = new S3Client({});
  return {
    runs: new TailoringRepository(client, {
      documents: DOCUMENTS_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
      jobs: JOBS_TABLE_NAME,
    }),
    documents: new DocumentRepository(client, DOCUMENTS_TABLE_NAME),
    shown: new CompanyLimitRepository(client, USAGE_TABLE_NAME),
    jobs: new JobRepository(client, JOBS_TABLE_NAME),
    keys: new AiKeyRepository(client, {
      aiKeys: AI_KEYS_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
      preferences: PREFERENCES_TABLE_NAME,
    }),
    readFile: async (key) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET_NAME, Key: key }));
      return (await res.Body?.transformToString('utf8')) ?? '';
    },
    presignDownload: (key, fileName) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: DOCUMENTS_BUCKET_NAME,
          Key: key,
          ResponseContentDisposition: attachment(fileName),
        }),
        { expiresIn: DOWNLOAD_URL_SECONDS },
      ),
    allowTestProvider: ALLOW_TEST_AI_PROVIDER === 'true',
    newId: ulid,
    now: () => new Date(),
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    audit: userAudit(AUDIT_TABLE_NAME, ulid),
  };
}

let deps: TailoringDeps | undefined;

export async function handler(event: Event, context: Context): Promise<HttpResponse> {
  logger.addContext(context);
  try {
    deps ??= defaultDeps();
    return await route(event, deps);
  } catch (error) {
    const busy = concurrentUpdateProblem(error, event.requestContext.requestId);
    if (busy) {
      logger.warn('Concurrent update after retries', { error: error as Error });
      return busy;
    }
    logger.error('Unhandled error', { error: error as Error });
    return problem(500, 'Internal error', { requestId: event.requestContext.requestId });
  }
}
