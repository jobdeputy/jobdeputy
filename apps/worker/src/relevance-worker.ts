import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountRepository,
  AiKeyRepository,
  CompanyLimitRepository,
  type Crawl,
  type CrawlLlm,
  CrawlRepository,
  CrawlSettingsRepository,
  DocumentRepository,
  documentClient,
  type Job,
  type JobRelevance,
  JobRepository,
  PreferencesRepository,
  ProfileRepository,
  type RelevanceDecision,
  type RelevanceFailure,
  RelevanceRepository,
  type RelevanceStats,
  ssmCrawlLimits,
} from '@jobdeputy/db';
import {
  invalidReason,
  type ModelSource,
  promptVersion,
  RELEVANCE_MAX_CALLS,
  RELEVANCE_RESUME_CHARS,
  recordTaskMetrics,
  relevanceTask,
  resolveModel,
  scoreRelevance,
  stubRelevanceSource,
} from '@jobdeputy/llm';
import {
  type AiSource,
  aiProvider,
  crawlMessage,
  createLogger,
  RELEVANCE_ERRORS,
} from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { ulid } from 'ulid';
import { type FitInputs, fitInputsLoader, rankCompany, type ShownStore } from './relevance/fit.js';
import { inputsHash, modelJob, modelProfile } from './relevance/llm-inputs.js';

// T08d: scores a crawl's candidate jobs with the LLM, then hides low scores and ranks each
// company's jobs by score. crawls (succeeded, with an AI source and candidates) → stream →
// Pipe → queue → this worker. Each task call is stored with its tokens before the next
// starts, so a retried message never sends a job twice or counts tokens twice.

const logger = createLogger('relevance-worker');

/** Same as the queue's maxReceiveCount: the last attempt ends the run instead of throwing. */
export const MAX_RECEIVES = 3;
/**
 * A new Pipe reads the crawls stream from its start (24 hours): crawls that finished
 * longer ago than this without a run are left alone (they were never meant to be scored).
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Stop starting task calls this long before Lambda's own timeout. */
export const SAFETY_MARGIN_MS = 10_000;
export const LOW_SCORE_REASON = 'llm_low_score';

export interface RelevanceWorkerDeps {
  isBeingDeleted: (userId: string) => Promise<boolean>;
  getCrawl: (userId: string, crawlId: string) => Promise<Crawl | undefined>;
  runs: Pick<RelevanceRepository, 'begin' | 'saveCall' | 'finish'>;
  /** The model for the crawl's AI source, or why there is none. */
  model: (userId: string, aiSource: AiSource) => Promise<ModelSource | RelevanceFailure>;
  fitInputs: (userId: string) => Promise<FitInputs>;
  /** The start of the default résumé's text, when there is one. */
  resume: (userId: string) => Promise<string | undefined>;
  jobs: Pick<JobRepository, 'getMany' | 'applyRelevance' | 'markOverLimit'>;
  shown: ShownStore;
  recordMetrics: typeof recordTaskMetrics;
  auditTable: string;
  newId: () => string;
  now: () => Date;
  remainingMs: () => number;
}

export type RelevanceOutcome = 'skipped' | 'done' | 'failed';

export async function processRecord(
  record: SQSRecord,
  deps: RelevanceWorkerDeps,
): Promise<RelevanceOutcome> {
  const parsed = crawlMessage.safeParse(safeJson(record.body));
  if (!parsed.success) {
    // Nothing to retry: let it fail through to the dead-letter queue for inspection.
    logger.error('Malformed message', { messageId: record.messageId });
    throw new Error('Malformed message');
  }
  const { userId, crawlId } = parsed.data;
  if (await deps.isBeingDeleted(userId)) {
    logger.info('Account is being deleted; skipping', { crawlId });
    return 'skipped';
  }
  let crawl = await deps.getCrawl(userId, crawlId);
  if (!crawl || crawl.status !== 'succeeded' || !crawl.aiSource || crawl.aiSource === 'none') {
    logger.info('Nothing to score', { crawlId });
    return 'skipped';
  }
  if (!crawl.relevance) {
    const finished = Date.parse(crawl.finishedAt ?? '');
    if (!(deps.now().getTime() - finished < STALE_AFTER_MS)) {
      logger.info('Crawl finished too long ago (a replayed stream record); skipping', { crawlId });
      return 'skipped';
    }
    await deps.runs.begin(userId, crawlId);
    crawl = await deps.getCrawl(userId, crawlId);
  }
  const run = crawl?.relevance;
  if (!crawl || run?.status !== 'running') {
    logger.info('Run already ended', { crawlId });
    return 'skipped';
  }
  const aiSource = crawl.aiSource as AiSource;

  const [inputs, resume] = await Promise.all([deps.fitInputs(userId), deps.resume(userId)]);
  const candidates = crawl.candidates ?? [];
  const order = new Map(candidates.map((id, i) => [id, i]));
  // Still open and still kept by the filter (a later crawl or the user may have changed it).
  const jobs = (await deps.jobs.getMany(userId, candidates))
    .filter((j) => j.filter?.state === 'candidate' && j.closedAt === undefined)
    .sort((a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0));

  const version = promptVersion(relevanceTask);
  const user = modelProfile(inputs.profile, resume);
  const hashes = new Map(jobs.map((j) => [j.jobId, inputsHash(j, user.hash, version)]));
  const scores = new Map<string, JobRelevance>();
  for (const j of jobs) {
    if (j.relevance && j.relevance.inputsHash === hashes.get(j.jobId))
      scores.set(j.jobId, j.relevance);
  }
  const reused = scores.size;
  const sentBefore = new Set(run.sent);
  const toScore = jobs.filter((j) => !scores.has(j.jobId) && !sentBefore.has(j.jobId));

  const end = async (status: 'done' | 'failed', scored: number, reason?: RelevanceFailure) => {
    const applied = await applyScores(userId, jobs, scores, inputs, deps);
    const stats: RelevanceStats = {
      candidates: jobs.length,
      scored,
      reused,
      unscored: jobs.length - scores.size,
      ...applied,
    };
    await deps.runs.finish({
      userId,
      crawlId,
      status,
      ...(reason ? { reason } : {}),
      stats,
      audit: {
        table: deps.auditTable,
        entry: {
          auditId: deps.newId(),
          name: 'crawl.scored',
          entity: { type: 'crawl', id: crawlId },
          actor: 'system',
          summary: reason
            ? `AI scoring stopped: ${RELEVANCE_ERRORS[reason]}`
            : `AI scored ${scored} jobs (${reused} unchanged): ${applied.hidden} hidden`,
          detail: { ...stats, ...(reason ? { reason } : {}) },
        },
      },
    });
    logger.info('Scoring ended', { crawlId, status, reason, ...stats });
    return status;
  };

  if (toScore.length === 0) return end('done', 0);
  const model = await deps.model(userId, aiSource);
  if (typeof model === 'string') return end('failed', 0, model);

  const short = new Map(toScore.map((j, i) => [`j${i + 1}`, j]));
  let calls = run.calls;
  let llm: CrawlLlm = crawl.llm ?? {
    keySource: model.keySource,
    provider: model.provider,
    model: model.modelId,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  let scored = 0;
  // Errors while storing a call are ours, not the model's: the queue retries them, and
  // the last one goes to the dead-letter queue.
  let storing = false;
  try {
    await scoreRelevance(
      user.profile,
      [...short].map(([id, job]) => modelJob(job, id, user)),
      model,
      {
        // A fixed worst case per crawl, across retries too (RELEVANCE_MAX_CALLS task calls).
        canStart: () =>
          calls < RELEVANCE_MAX_CALLS &&
          deps.remainingMs() > relevanceTask.limits.timeoutMs + SAFETY_MARGIN_MS,
        onCall: async (call) => {
          const values = call.scored.map((s) => s.score);
          deps.recordMetrics(call.result, {
            groundingRejections: call.groundingRejections,
            ...(values.length > 0
              ? { scoreSpread: Math.max(...values) - Math.min(...values) }
              : {}),
          });
          const { usage } = call.result;
          llm = {
            ...llm,
            calls: llm.calls + usage.calls,
            inputTokens: llm.inputTokens + usage.inputTokens,
            outputTokens: llm.outputTokens + usage.outputTokens,
          };
          const at = deps.now().toISOString();
          const results = call.scored.map((s) => {
            const job = short.get(s.id) as Job;
            const bestRoleId = s.bestRoleId ? user.roleIds.get(s.bestRoleId) : undefined;
            const relevance: JobRelevance = {
              score: s.score,
              ...(bestRoleId ? { bestRoleId } : {}),
              reasons: s.reasons,
              model: model.modelId,
              promptVersion: version,
              inputsHash: hashes.get(job.jobId) as string,
              scoredAt: at,
            };
            return { jobId: job.jobId, relevance };
          });
          storing = true;
          await deps.runs.saveCall({
            userId,
            crawlId,
            callsBefore: calls,
            sent: call.sent.map((id) => (short.get(id) as Job).jobId),
            llm,
            usage: {
              keySource: model.keySource,
              provider: model.provider,
              modelId: model.modelId,
              task: relevanceTask.name,
              ...usage,
              runs: calls === 0 ? 1 : 0,
            },
            scores: results,
          });
          storing = false;
          calls += 1;
          for (const r of results) scores.set(r.jobId, r.relevance);
          scored += results.length;
        },
      },
    );
  } catch (error) {
    if (storing) throw error;
    // The user's key stopped working: no retry helps.
    if (model.keySource === 'own' && invalidReason(error)) {
      return end('failed', scored, 'key_rejected');
    }
    if (Number(record.attributes.ApproximateReceiveCount) < MAX_RECEIVES) {
      logger.warn('Scoring failed; the queue tries again', {
        crawlId,
        error: (error as Error).name,
      });
      throw error;
    }
    return end('failed', scored, 'model_unavailable');
  }
  return end('done', scored);
}

/**
 * Hides jobs scored below the admin's minimum, and ranks each company's other scored jobs
 * by score through its shown list (T08c's limit). Jobs without a score keep their verdict.
 */
async function applyScores(
  userId: string,
  jobs: Job[],
  scores: Map<string, JobRelevance>,
  inputs: FitInputs,
  deps: Pick<RelevanceWorkerDeps, 'jobs' | 'shown' | 'now'>,
): Promise<Pick<RelevanceStats, 'hidden' | 'overLimit'>> {
  const decisions: RelevanceDecision[] = [];
  const byCompany = new Map<string, Job[]>();
  for (const job of jobs) {
    if (!scores.has(job.jobId)) continue;
    byCompany.set(job.companyKey, [...(byCompany.get(job.companyKey) ?? []), job]);
  }
  const pushedOut: string[] = [];
  let hidden = 0;
  let overLimit = 0;
  for (const [companyKey, companyJobs] of byCompany) {
    const kept = companyJobs.filter(
      (j) => (scores.get(j.jobId) as JobRelevance).score >= inputs.relevanceMinScore,
    );
    for (const j of companyJobs) {
      if (kept.includes(j)) continue;
      hidden += 1;
      const reasons = j.filter?.reasons ?? [];
      decisions.push({
        jobId: j.jobId,
        hide: {
          reasons: reasons.includes(LOW_SCORE_REASON) ? reasons : [...reasons, LOW_SCORE_REASON],
        },
      });
    }
    const result = await rankCompany(
      deps.shown,
      userId,
      companyKey,
      new Set(companyJobs.map((j) => j.jobId)),
      kept.map((j) => ({
        jobId: j.jobId,
        p: j.filter?.priority ?? 0,
        s: (scores.get(j.jobId) as JobRelevance).score,
        ...(j.postedAt ? { t: j.postedAt } : {}),
      })),
      inputs.companyLimit,
    );
    for (const jobId of result.counted) decisions.push({ jobId, limitState: 'counted' });
    for (const jobId of result.overLimit) decisions.push({ jobId, limitState: 'over_limit' });
    overLimit += result.overLimit.length;
    pushedOut.push(...result.pushedOut);
  }
  const expiresAt = Math.floor(deps.now().getTime() / 1000) + inputs.expiryDays * 86_400;
  await deps.jobs.applyRelevance(userId, decisions, expiresAt);
  await deps.jobs.markOverLimit(userId, pushedOut, expiresAt);
  return { hidden, overLimit };
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function defaultDeps(): RelevanceWorkerDeps {
  const {
    CRAWLS_TABLE_NAME,
    SOURCES_TABLE_NAME,
    JOBS_TABLE_NAME,
    USAGE_TABLE_NAME,
    AUDIT_TABLE_NAME,
    USERS_TABLE_NAME,
    PREFERENCES_TABLE_NAME,
    DOCUMENTS_TABLE_NAME,
    DOCUMENTS_BUCKET_NAME,
    AI_KEYS_TABLE_NAME,
    CRAWL_LIMITS_PARAMETER,
    ALLOW_TEST_AI_PROVIDER,
    AWS_REGION,
  } = process.env;
  if (
    !CRAWLS_TABLE_NAME ||
    !SOURCES_TABLE_NAME ||
    !JOBS_TABLE_NAME ||
    !USAGE_TABLE_NAME ||
    !AUDIT_TABLE_NAME ||
    !USERS_TABLE_NAME ||
    !PREFERENCES_TABLE_NAME ||
    !DOCUMENTS_TABLE_NAME ||
    !DOCUMENTS_BUCKET_NAME ||
    !AI_KEYS_TABLE_NAME ||
    !CRAWL_LIMITS_PARAMETER ||
    !AWS_REGION
  ) {
    throw new Error('Table, bucket, parameter, and Region names must be set');
  }
  const client = documentClient();
  const account = new AccountRepository(client, USERS_TABLE_NAME);
  const crawls = new CrawlRepository(client, {
    crawls: CRAWLS_TABLE_NAME,
    sources: SOURCES_TABLE_NAME,
    audit: AUDIT_TABLE_NAME,
    usage: USAGE_TABLE_NAME,
  });
  const documents = new DocumentRepository(client, DOCUMENTS_TABLE_NAME);
  const keys = new AiKeyRepository(client, {
    aiKeys: AI_KEYS_TABLE_NAME,
    usage: USAGE_TABLE_NAME,
    preferences: PREFERENCES_TABLE_NAME,
  });
  const allowTestProvider = ALLOW_TEST_AI_PROVIDER === 'true';
  const s3 = new S3Client({});
  const kms = new KMSClient({});
  return {
    isBeingDeleted: (userId) => account.isBeingDeleted(userId),
    getCrawl: (userId, crawlId) => crawls.getCrawl(userId, crawlId),
    runs: new RelevanceRepository(client, {
      crawls: CRAWLS_TABLE_NAME,
      jobs: JOBS_TABLE_NAME,
      usage: USAGE_TABLE_NAME,
      audit: AUDIT_TABLE_NAME,
    }),
    model: async (userId, aiSource) => {
      if (aiSource === 'platform') return resolveModel({ source: 'platform', region: AWS_REGION });
      const provider = aiProvider(aiSource, allowTestProvider);
      if (!provider) return 'key_missing';
      const key = await keys.get(userId, provider);
      if (!key) return 'key_missing';
      if (key.status !== 'valid') return 'key_invalid';
      // Dev stacks only: the pretend provider answers by a fixed rule, with no outside call.
      if (provider === 'stub') return stubRelevanceSource(key.modelId);
      // KMS refuses unless the context matches the one used to encrypt: this user, this provider.
      const res = await kms.send(
        new DecryptCommand({
          CiphertextBlob: key.ciphertext,
          EncryptionContext: { userId, provider },
        }),
      );
      if (!res.Plaintext) throw new Error('KMS returned no plaintext');
      const apiKey = new TextDecoder().decode(res.Plaintext);
      return resolveModel({ source: 'own', provider, modelId: key.modelId, apiKey });
    },
    fitInputs: fitInputsLoader({
      preferences: new PreferencesRepository(client, PREFERENCES_TABLE_NAME),
      profiles: new ProfileRepository(client, USERS_TABLE_NAME),
      crawlSettings: new CrawlSettingsRepository(client, PREFERENCES_TABLE_NAME),
      limits: ssmCrawlLimits(CRAWL_LIMITS_PARAMETER),
    }),
    resume: async (userId) => {
      const doc = (await documents.list(userId)).find(
        (d) => d.isDefault && d.status === 'ready' && d.parsed && !d.parsed.noText,
      );
      if (!doc?.parsed) return undefined;
      // Up to 4 bytes per character in UTF-8: enough bytes for the characters sent.
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: DOCUMENTS_BUCKET_NAME,
          Key: doc.parsed.textS3Key,
          Range: `bytes=0-${RELEVANCE_RESUME_CHARS * 4 - 1}`,
        }),
      );
      const text = (await res.Body?.transformToString('utf8')) ?? '';
      // A cut in the middle of a character leaves a replacement mark at the end: drop it.
      return text.replace(/�+$/, '').slice(0, RELEVANCE_RESUME_CHARS) || undefined;
    },
    jobs: new JobRepository(client, JOBS_TABLE_NAME),
    shown: new CompanyLimitRepository(client, USAGE_TABLE_NAME),
    recordMetrics: recordTaskMetrics,
    auditTable: AUDIT_TABLE_NAME,
    newId: ulid,
    now: () => new Date(),
    remainingMs: () => currentContext?.getRemainingTimeInMillis() ?? 60_000,
  };
}

const processor = new BatchProcessor(EventType.SQS);
let deps: RelevanceWorkerDeps | undefined;
let currentContext: Context | undefined;

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  currentContext = context;
  deps ??= defaultDeps();
  const current = deps;
  return processPartialResponse(
    event,
    (record: SQSRecord) => processRecord(record, current),
    processor,
    { context },
  );
}
