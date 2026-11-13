import type { AuditInput, AuditWrite } from '@jobdeputy/db';

/**
 * Builds the audit entry for a user's own action (T06d). Summaries are short and hold
 * no personal details: IDs, and at most a target-role title.
 */
export type UserAudit = (
  name: string,
  entity: AuditInput['entity'],
  summary: string,
  detail?: AuditInput['detail'],
) => AuditWrite;

export function userAudit(table: string, newId: () => string): UserAudit {
  return (name, entity, summary, detail) => ({
    table,
    entry: {
      auditId: newId(),
      name,
      entity,
      actor: 'user',
      summary,
      ...(detail ? { detail } : {}),
    },
  });
}
