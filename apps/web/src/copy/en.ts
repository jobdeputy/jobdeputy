/**
 * Every word the UI shows, in English. Keep whole sentences in one entry: word order differs
 * between languages. Components read copy through `@/copy`, never from this file directly.
 */
export const en = {
  shell: {
    productName: 'JobDeputy',
    tagline: 'Your job search partner.',
    /** The tagline as the small label under the header wordmark (no full stop). */
    taglineShort: 'Your job search partner',
  },
  landing: {
    eyebrow: 'Agentic job applications',
    /** The page title, in the two lines it breaks into. */
    titleLines: ['You set it up.', 'Your deputy applies.'],
    body: 'Agents already help you work. Now one finds roles, tailors your résumé, and applies for you, with your approval.',
    getStarted: 'Get started free',
    signIn: 'Sign in',
    note: 'Nothing is sent until you approve it.',
    stage: {
      status: 'Setting up',
      speech: 'Tell me what you want.',
      setupCardTitle: 'Your setup',
      setupRows: ['Roles', 'Résumé', 'Rules'],
    },
    steps: {
      label: 'How your deputy works',
      items: [
        { title: 'Set it up', line: 'Your roles, résumé, and rules.' },
        { title: 'It finds', line: 'Roles that fit, from sites you choose.' },
        { title: 'It applies', line: 'Tailored, and sent once you approve.' },
      ],
    },
  },
  auth: {
    close: 'Close',
    signIn: {
      kicker: 'Secure sign-in',
      title: 'Welcome back.',
      subtitle: 'Your searches, saved roles, and next steps are right where you left them.',
    },
    signUp: {
      kicker: 'Create account',
      title: 'Set up your search desk.',
      subtitle:
        'Start with secure access. Your profile, résumés, and search preferences come next.',
    },
  },
} as const;

/** Same keys as `en`, any text: the shape every future language file must match. */
type Widen<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly (infer U)[]
      ? readonly (U extends string ? string : Widen<U>)[]
      : Widen<T[K]>;
};
export type Copy = Widen<typeof en>;
