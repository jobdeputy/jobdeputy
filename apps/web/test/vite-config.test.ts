// @vitest-environment node
// The config builds file paths from import.meta.url, which is a file: URL only under Node.
import type { UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../vite.config.ts';

function pages(mode: string) {
  const resolved = (config as (env: { mode: string; command: 'build' }) => UserConfig)({
    mode,
    command: 'build',
  });
  return Object.keys(resolved.build?.rolldownOptions?.input ?? {});
}

describe('vite config', () => {
  it('ships only the app page in production', () => {
    expect(pages('production')).toEqual(['app']);
  });

  it('adds the component gallery to the test build', () => {
    expect(pages('e2e')).toEqual(['app', 'gallery']);
  });
});
