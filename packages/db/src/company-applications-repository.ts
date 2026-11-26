import type { DynamoDBDocumentClient, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { JobStage } from '@jobdeputy/shared/applications';
import { cooldownUntil } from '@jobdeputy/shared/applications';

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/**
 * `usage` → `APPLIED#<companyKey>` (#52 PR E, 0013): when the user applied to each of one
 * company's jobs, `jobId → appliedAt`, kept while it counts toward the cooldown. Written
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

/** What a stage change must also write, or why it is refused (JobRepository.setStage). */
export type StageGuardCheck = { item?: TransactItem } | { refuse: { until: string } };

export interface StageGuard {
  /**
   * Read before each try, with the job as read and the time its stage change records. A
   * failed condition on `item` means the company's applications changed meanwhile: the
   * change is tried again from a fresh read.
   */
  check(
    job: { jobId: string; companyKey: string },
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
   * Every company's applications, by company key, for Matches. One small item per company
   * applied to in the cooldown window (older ones expire), so this stays small; eventually
   * consistent is enough for a list (the stage change re-checks).
   */
  async list(userId: string): Promise<Map<string, string[]>> {
    const byCompany = new Map<string, string[]>();
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
        const applied = Object.values((item.applied as CompanyApplied['applied']) ?? {});
        if (applied.length > 0) byCompany.set(String(item.sk).slice('APPLIED#'.length), applied);
      }
      start = res.LastEvaluatedKey;
    } while (start);
    return byCompany;
  }

  /**
   * The cooldown, for JobRepository.setStage: applying (new → applied) is refused while the
   * company cools down, else adds the job; undoing it (applied → new) takes it out again.
   * Later stages leave the count as it is.
   */
  guard(userId: string, rule: CooldownRule): StageGuard {
    return {
      check: async (job, change, now) => {
        const applying = change.from === 'new' && change.stage === 'applied';
        const undoing = change.from === 'applied' && change.stage === 'new';
        if (!applying && !undoing) return {};
        const current = await this.get(userId, job.companyKey);
        // Only what still counts is kept: the item never grows past the window.
        const span = rule.days * 86_400_000;
        const applied = Object.fromEntries(
          Object.entries(current.applied).filter(
            ([id, at]) => id !== job.jobId && Date.parse(at) + span > now.getTime(),
          ),
        );
        if (applying) {
          const until = cooldownUntil(Object.values(applied), now, rule.limit, rule.days);
          if (until !== undefined) return { refuse: { until } };
          applied[job.jobId] = now.toISOString();
        } else if (!(job.jobId in current.applied)) {
          // Applied before the cooldown existed, or already aged out: nothing to take out.
          return {};
        }
        return { item: this.put(userId, job.companyKey, applied, current.version, rule.days) };
      },
    };
  }

  private put(
    userId: string,
    companyKey: string,
    applied: CompanyApplied['applied'],
    expectedVersion: number,
    days: number,
  ): TransactItem {
    const newest = Math.max(0, ...Object.values(applied).map((at) => Date.parse(at)));
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
          // Gone once nothing in it counts any more (an empty one at once).
          ttl: Math.floor((newest + days * 86_400_000) / 1000),
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
