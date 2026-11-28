import { configure } from '@testing-library/react';

// Generous waits (docs/testing.md): a full parallel `pnpm verify` on a busy machine can take
// longer than the 1 s default to render, and a passing test still ends as soon as it can.
configure({ asyncUtilTimeout: 5_000 });
