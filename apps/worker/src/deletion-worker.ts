import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { AccountRepository, documentClient, eraseUserItems, type UserTable } from '@jobdeputy/db';
import { createLogger, DERIVED_PREFIX, SCANNED_PREFIX } from '@jobdeputy/shared';
import type { Context, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { z } from 'zod';

const logger = createLogger('deletion-worker');

/** Matches the queue's maxReceiveCount (3 tries, then the dead-letter queue). */
export const MAX_RECEIVES = 3;
/**
 * T12: writes are blocked from the moment of the request, so one final sweep only
 * has to catch work already in flight. 900 s is SQS's longest native delay.
 */
export const FINAL_SWEEP_DELAY_SECONDS = 900;

const message = z.object({
  /** From the Pipe: the `userId` of the DELETION item. */
  id: z.string().regex(/^[0-9a-f-]{36}$/),
  /** Set on the delayed final sweep. */
  sweep: z.boolean().optional(),
});

export interface DeletionDeps {
  account: Pick<AccountRepository, 'getDeletion' | 'setDeletionStatus'>;
  eraseItems: (userId: string) => Promise<number>;
  eraseFiles: (userId: string) => Promise<number>;
  /** Revokes refresh tokens everywhere, then deletes the login. Both ignore "user not found". */
  signOutAndDeleteLogin: (username: string) => Promise<void>;
  scheduleFinalSweep: (userId: string) => Promise<void>;
}

export type DeletionOutcome = 'erased' | 'swept' | 'nothing-to-do';

export async function handleDeletion(body: unknown, deps: DeletionDeps): Promise<DeletionOutcome> {
  const parsed = message.safeParse(body);
  if (!parsed.success) throw new Error('Malformed message');
  const { id: userId, sweep } = parsed.data;

  const request = await deps.account.getDeletion(userId);
  // Expired or never requested: nothing may be deleted without a request.
  if (!request) return 'nothing-to-do';

  if (sweep) {
    const items = await deps.eraseItems(userId);
    const files = await deps.eraseFiles(userId);
    await deps.account.setDeletionStatus(userId, 'done');
    logger.info('Final sweep done', { userId, items, files });
    return 'swept';
  }
  if (request.status === 'done') return 'nothing-to-do';

  await deps.account.setDeletionStatus(userId, 'deleting');
  // The login goes first: no new sign-ins or refreshed sessions while data is erased.
  await deps.signOutAndDeleteLogin(request.username);
  const items = await deps.eraseItems(userId);
  const files = await deps.eraseFiles(userId);
  await deps.scheduleFinalSweep(userId);
  logger.info('Account erased; final sweep scheduled', { userId, items, files });
  return 'erased';
}

function ignoreUserNotFound(error: unknown): void {
  if ((error as Error).name !== 'UserNotFoundException') throw error;
}

function defaultDeps(): DeletionDeps {
  const { USERS_TABLE_NAME, USER_TABLES, DOCUMENTS_BUCKET_NAME, USER_POOL_ID, QUEUE_URL } =
    process.env;
  if (!USERS_TABLE_NAME || !USER_TABLES || !DOCUMENTS_BUCKET_NAME || !USER_POOL_ID || !QUEUE_URL) {
    throw new Error('Deletion worker environment is incomplete');
  }
  const tables = JSON.parse(USER_TABLES) as UserTable[];
  const client = documentClient();
  const s3 = new S3Client({});
  const cognito = new CognitoIdentityProviderClient({});
  const sqs = new SQSClient({});

  return {
    account: new AccountRepository(client, USERS_TABLE_NAME),
    eraseItems: (userId) => eraseUserItems(client, tables, userId),
    eraseFiles: async (userId) => {
      let deleted = 0;
      for (const prefix of [`${SCANNED_PREFIX}${userId}/`, `${DERIVED_PREFIX}${userId}/`]) {
        let token: string | undefined;
        do {
          const page = await s3.send(
            new ListObjectsV2Command({
              Bucket: DOCUMENTS_BUCKET_NAME,
              Prefix: prefix,
              ...(token ? { ContinuationToken: token } : {}),
            }),
          );
          const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
          if (keys.length > 0) {
            const res = await s3.send(
              new DeleteObjectsCommand({
                Bucket: DOCUMENTS_BUCKET_NAME,
                Delete: { Objects: keys, Quiet: true },
              }),
            );
            if (res.Errors?.length) throw new Error(`Could not delete ${res.Errors.length} files`);
            deleted += keys.length;
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
      }
      return deleted;
    },
    signOutAndDeleteLogin: async (username) => {
      await cognito
        .send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username }))
        .catch(ignoreUserNotFound);
      await cognito
        .send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }))
        .catch(ignoreUserNotFound);
    },
    scheduleFinalSweep: async (userId) => {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({ id: userId, sweep: true }),
          DelaySeconds: FINAL_SWEEP_DELAY_SECONDS,
        }),
      );
    },
  };
}

export async function processRecord(
  record: SQSRecord,
  deps: DeletionDeps,
): Promise<DeletionOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(record.body);
  } catch {
    throw new Error('Malformed message');
  }
  try {
    return await handleDeletion(body, deps);
  } catch (error) {
    // Retried by SQS; after the last try the message goes to the dead-letter queue (alarm).
    logger.error('Deletion attempt failed', {
      receiveCount: record.attributes.ApproximateReceiveCount,
      reason: (error as Error).message,
    });
    throw error;
  }
}

let deps: DeletionDeps | undefined;
const processor = new BatchProcessor(EventType.SQS);

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  logger.addContext(context);
  deps ??= defaultDeps();
  const current = deps;
  return processPartialResponse(event, (r: SQSRecord) => processRecord(r, current), processor, {
    context,
  });
}
