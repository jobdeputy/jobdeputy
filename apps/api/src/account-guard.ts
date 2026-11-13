import { ACCOUNT_DELETED_DETAIL, type HttpResponse, problem } from '@jobdeputy/shared';

const WRITE = /^(POST|PUT|PATCH|DELETE) /;

/**
 * T12: once an account deletion is requested, every write from that user is refused,
 * so a session that is still open cannot add data back. Reads are left alone.
 */
export async function refuseWritesWhileDeleting(
  routeKey: string,
  userId: string,
  isBeingDeleted: (userId: string) => Promise<boolean>,
  requestId: string,
): Promise<HttpResponse | undefined> {
  if (!WRITE.test(routeKey)) return undefined;
  if (!(await isBeingDeleted(userId))) return undefined;
  return problem(410, 'Account deleted', {
    detail: ACCOUNT_DELETED_DETAIL,
    code: 'account-deleted',
    requestId,
  });
}
