import type { DynamoDBDocumentClient, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { JobStage } from '@jobdeputy/shared/applications';
import { cooldownUntil, MAX_APPLY_COOLDOWN_DAYS } from '@jobdeputy/shared/applications';

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/**
 * `usage` → `APPLIED#<companyKey>` (#52 PR E, 0013): when the user applied to each of one
 * company's jobs, `jobId → appliedAt`, kept 365 days (the longest window an admin can set);
 * an apply undone before any later stage is taken out, one undone after it stays. Written
 * only in the same transaction as the job's stage, whole, if still at `version`: two
 * applies at once can never both take the last place. Its own item, not the `COMPANY#`
 * one, which each crawl replaces whole.
 */
export interface CompanyApplied {
  applied: Record<string, string>;
  /** 0 when the item does not exist yet. */
  version: number;
}

export interface CooldownRule {
  /** Applications to one company… */
  limit: number;
  /** …in this many days, rolling. */
  days: number;
}

/**
 * Applications are kept this long (the admin's longest window), whatever the window now: a
 * window raised later still counts the ones already made. Counting uses the current window.
 */
export const APPLIED_KEEP_DAYS = MAX_APPLY_COOLDOWN_DAYS;

/** What a stage change must also write, or why it is refused (JobRepository.setStage). */
export type StageGuardCheck =
  | { item?: TransactItem }
  | { refuse: { until: string; limit: number; days: number } };

export interface StageGuard {
  /**
   * Read before each try, with the job as read and the time its stage change records. A
   * failed condition on `item` means the company's applications changed meanwhile: the
   * change is tried again from a fresh read.
   */
  check(
    job: { jobId: string; companyKey: string; appliedAt?: string; stageAt?: string },
    change: { stage: JobStage; from: JobStage },
    now: Date,
  ): Promise<StageGuardCheck>;
}

export const appliedSk = (companyKey: string) => `APPLIED#${companyKey}`;

export class CompanyApplicationsRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async get(userId: string, companyKey: string): Promise<CompanyApplied> {
    const res = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { userId, sk: appliedSk(companyKey) },
        ConsistentRead: true,
      }),
    );
    return {
      applied: (res.Item?.applied as CompanyApplied['applied'] | undefined) ?? {},
      version: (res.Item?.version as number | undefined) ?? 0,
    };
  }

  /**
   * Every company's applications (`jobId → appliedAt`), by company key, for Matches. One
   * small item per company applied to in the last 365 days, so this stays small; eventually
   * consistent is enough for a list (the stage change re-checks).
   */
  async list(userId: string): Promise<Map<string, CompanyApplied['applied']>> {
    const byCompany = new Map<string, CompanyApplied['applied']>();
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'userId = :u AND begins_with(sk, :p)',
          ExpressionAttributeValues: { ':u': userId, ':p': 'APPLIED#' },
          ProjectionExpression: 'sk, applied',
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      for (const item of res.Items ?? []) {
        const applied = (item.applied as CompanyApplied['applied'] | undefined) ?? {};
        if (Object.keys(applied).length > 0)
          byCompany.set(String(item.sk).slice('APPLIED#'.length), applied);
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return byCompany;
  }

  /**
   * The cooldown, for JobRepository.setStage: applying (new → applied) is refused while the
   * company cools down, else adds the job; undoing it (applied → new) takes it out again.
   * Later stages leave the count as it is, and so does undoing an application that went past
   * applied (it was at interviewing or later, then set back): the company saw it. The admin's
   * rule is read only when applying. A job's own entry never counts against applying to it
   * again (Matches counts the same way).
   */
  guard(userId: string, rule: () => Promise<CooldownRule>): StageGuard {
    return {
      check: async (job, change, now) => {
        const applying = change.from === 'new' && change.stage === 'applied';
        const undoing = change.from === 'applied' && change.stage === 'new';
        if (!applying && !undoing) return {};
        // Its stage moved after the apply: no longer a "Yes" given by mistake. An undo takes out
        // only the entry this apply wrote (same time as the job's appliedAt).
        if (undoing && job.stageAt !== job.appliedAt) return {};
        const [current, counting] = await Promise.all([
          this.get(userId, job.companyKey),
          applying ? rule() : undefined,
        ]);
        const keep = APPLIED_KEEP_DAYS * 86_400_000;
        const applied = Object.fromEntries(
          Object.entries(current.applied).filter(
            ([id, at]) => id !== job.jobId && Date.parse(at) + keep > now.getTime(),
          ),
        );
        if (counting) {
          const { limit, days } = counting;
          const until = cooldownUntil(Object.values(applied), now, limit, days);
          if (until !== undefined) return { refuse: { until, limit, days } };
          // Its own earlier entry (applied, undone after a later stage, applied again) keeps its
          // time: the company saw that application, and an undo of this one never removes it.
          const earlier = current.applied[job.jobId];
          applied[job.jobId] =
            earlier !== undefined && Date.parse(earlier) + keep > now.getTime()
              ? earlier
              : now.toISOString();
        } else if (
          current.applied[job.jobId] === undefined ||
          current.applied[job.jobId] !== job.appliedAt
        ) {
          // Not this apply's entry: applied before the cooldown existed, aged out, or an earlier
          // application kept by a re-apply. Nothing to take out.
          return {};
        }
        return { item: this.put(userId, job.companyKey, applied, current.version, now) };
      },
    };
  }

  private put(
    userId: string,
    companyKey: string,
    applied: CompanyApplied['applied'],
    expectedVersion: number,
    now: Date,
  ): TransactItem {
    // An empty item from now: TTL skips times more than five years past (Math.max(0) = 1970).
    const newest = Math.max(
      now.getTime() - APPLIED_KEEP_DAYS * 86_400_000,
      ...Object.values(applied).map((at) => Date.parse(at)),
    );
    return {
      Put: {
        TableName: this.table,
        Item: {
          userId,
          sk: appliedSk(companyKey),
          type: 'company_applied',
          companyKey,
          applied,
          version: expectedVersion + 1,
          // Gone once nothing in it is kept any more (an empty one at once).
          ttl: Math.floor((newest + APPLIED_KEEP_DAYS * 86_400_000) / 1000),
          schemaVersion: 1,
        },
        ConditionExpression:
          expectedVersion === 0 ? 'attribute_not_exists(userId)' : 'version = :expected',
        ...(expectedVersion === 0
          ? {}
          : { ExpressionAttributeValues: { ':expected': expectedVersion } }),
      },
    };
  }
}
