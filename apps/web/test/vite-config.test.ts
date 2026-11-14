// @vitest-environment node
// The config builds file paths from import.meta.url, which is a file: URL only under Node.
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../vite.config.ts';

function build(mode: string) {
  return (config as (env: { mode: string; command: 'build' }) => UserConfig)({
    mode,
    command: 'build',
  }).build;
}

function pages(mode: string) {
  return Object.keys(build(mode)?.rolldownOptions?.input ?? {});
}

describe('vite config', () => {
  it('builds only the app page in every mode but the test one', () => {
    expect(pages('production')).toEqual(['app']);
    expect(pages('staging')).toEqual(['app']);
  });

  it('adds the component gallery to the test build, in its own folder', () => {
    expect(pages('e2e')).toEqual(['app', 'gallery']);
    expect(build('e2e')?.outDir).toBe('dist-e2e');
    expect(build('production')?.outDir).toBeUndefined();
  });
});
