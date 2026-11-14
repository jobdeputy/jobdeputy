import { type Copy, en } from './en.ts';

export type { Copy };

/**
 * The copy the UI shows. English only for now (US launch); a second language adds a sibling of
 * en.ts typed as `Copy` and picks it here, so no component changes.
 */
export const copy: Copy = en;
