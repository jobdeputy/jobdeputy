import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Template tests do not need real Lambda bundles. Skipping esbuild bundling
    // (the CDK "bundling-stacks" context, read from CDK_CONTEXT_JSON) keeps
    // synth fast and deterministic on cold CI runners. `pnpm synth` and
    // deploys still bundle.
    env: { CDK_CONTEXT_JSON: JSON.stringify({ 'aws:cdk:bundling-stacks': [] }) },
    // Buffer for synthesizing several stacks on slow runners (docs/testing.md).
    testTimeout: 30_000,
  },
});
