/**
 * Every word the UI shows, in English. Components read copy from here rather than writing it
 * inline, so adding a language later means adding a sibling file with the same keys, not
 * editing components. Keep whole sentences in one entry: word order differs between languages.
 */
export const en = {
  shell: {
    productName: 'JobDeputy',
    tagline: 'Your search partner.',
  },
} as const;

/** The shape every future language file must match. */
export type Copy = typeof en;
