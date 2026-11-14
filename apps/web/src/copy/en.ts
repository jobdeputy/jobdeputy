/**
 * Every word the UI shows, in English. Keep whole sentences in one entry: word order differs
 * between languages. Components read copy through `@/copy`, never from this file directly.
 */
export const en = {
  shell: {
    productName: 'JobDeputy',
    tagline: 'Your search partner.',
  },
} as const;

/** Same keys as `en`, any text: the shape every future language file must match. */
type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Copy = Widen<typeof en>;
