import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { REPO_ROOT } from '../lib/constructs/node-function.js';

/**
 * docs/data-model.md must document every table the stack deploys, with the
 * same keys, so the schema documentation cannot silently fall behind.
 */
function documentedTables(): Map<string, { pk: string; sk: string | undefined }> {
  const doc = readFileSync(join(REPO_ROOT, 'docs', 'data-model.md'), 'utf8');
  const section = doc.split('## Physical schema (built tables)')[1]?.split('\n### ')[0] ?? '';
  const rows = new Map<string, { pk: string; sk: string | undefined }>();
  for (const line of section.split('\n')) {
    const m = line.match(/^\| `<stack>-([a-z-]+)` \| `(\w+)` \(S\) \| (?:`(\w+)` \(S\)|—) \|/);
    if (m?.[1] && m[2]) rows.set(m[1], { pk: m[2], sk: m[3] });
  }
  return rows;
}

function deployedTables(): Map<string, { pk: string; sk: string | undefined }> {
  const stack = buildApp({ stage: 'dev', env: {} }).node.findChild('jobdeputy-dev-iad');
  const tables = Template.fromStack(stack as never).findResources('AWS::DynamoDB::Table');
  const rows = new Map<string, { pk: string; sk: string | undefined }>();
  for (const t of Object.values(tables)) {
    const name = String(t.Properties.TableName).replace('jobdeputy-dev-iad-', '');
    const keys = t.Properties.KeySchema as { AttributeName: string; KeyType: string }[];
    rows.set(name, {
      pk: keys.find((k) => k.KeyType === 'HASH')?.AttributeName ?? '',
      sk: keys.find((k) => k.KeyType === 'RANGE')?.AttributeName,
    });
  }
  return rows;
}

describe('docs/data-model.md', () => {
  it('documents every deployed table with its exact keys, and nothing that is not deployed', () => {
    const documented = documentedTables();
    expect(documented.size).toBeGreaterThan(0);
    expect(Object.fromEntries(documented)).toEqual(Object.fromEntries(deployedTables()));
  });
});
