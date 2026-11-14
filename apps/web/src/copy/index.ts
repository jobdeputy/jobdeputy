import { type Copy, en } from './en.ts';

export type { Copy };

/**
 * The copy the UI shows. English only for now (US launch); a second language adds a sibling of
 * en.ts typed as `Copy` and picks it here, so no component changes.
 */
export const copy: Copy = en;

/**
 * One `V` per entry of the copy list `T`, with the same length, for data paired with copy (such as
 * each step's icon): a language with a different count fails to compile. Generic, so tuples stay
 * tuples.
 */
export type OnePer<T, V> = { readonly [K in keyof T]: V };
