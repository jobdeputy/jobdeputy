import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/fingerprint.js';
import { promptVersion } from '../src/task.js';
import { TASKS } from '../src/tasks/index.js';

// Prompt versioning (T08b): a task's prompt, schema, or limits cannot change without a new
// version, and every version has a saved eval baseline.
const versions = JSON.parse(
  readFileSync(new URL('../eval/versions.json', import.meta.url), 'utf8'),
) as Record<string, string>;

describe.each(TASKS.map((entry) => [promptVersion(entry.task), entry] as const))(
  '%s',
  (version, { task, sample }) => {
    it('matches the fingerprint recorded for its version', () => {
      const now = fingerprint(task, sample);
      const recorded = versions[version];
      const help =
        recorded === undefined
          ? `new version: add "${version}": "${now}" to eval/versions.json`
          : `the prompt, schema, or limits changed: raise the task's version and add "${task.name}@v${task.version + 1}": "${now}" to eval/versions.json (keep the old entry)`;
      expect(now, help).toBe(recorded);
    });

    it('has a saved eval baseline', () => {
      const baseline = new URL(`../eval/baselines/${version}.json`, import.meta.url);
      expect(existsSync(baseline), `run the eval with --update-baseline for ${version}`).toBe(true);
    });
  },
);

describe('eval/versions.json', () => {
  it('keeps each fingerprint for one version only', () => {
    const hashes = Object.values(versions);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
