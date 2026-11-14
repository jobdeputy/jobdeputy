/**
 * Every word the UI shows, in English. Keep whole sentences in one entry: word order differs
 * between languages. Components read copy through `@/copy`, never from this file directly.
 */
export const en = {
  /** The locale numbers and dates are formatted in (BCP 47). */
  locale: 'en-US',
  shell: {
    /** The product name as the header's wordmark sets it: two weights, no space between. */
    wordmark: ['Job', 'Deputy'],
    /** The label under the wordmark (no full stop: it is a label, not a sentence). */
    tagline: 'Your job search partner',
  },
  landing: {
    eyebrow: 'Agentic job applications',
    /** The page title, in the two lines it breaks into. */
    titleLines: ['You set it up.', 'Your deputy applies.'],
    body: 'AI already helps you at your job. Now let it find your next job.',
    getStarted: 'Get started free',
    signIn: 'Sign in',
    stage: {
      setupCardTitle: 'Your setup',
      setupRows: ['Roles', 'Résumé', 'Rules'],
    },
    /**
     * The story's chapters: each step's title and line (the strip under the deputy), what he says
     * in it, and his status. Each plays for 1 s plus 240 ms a word of its title, line and speech
     * (at least 3.4 s), so a longer translation plays longer.
     */
    steps: {
      label: 'How your deputy works',
      items: [
        {
          title: 'Set it up',
          line: 'Your roles, résumé, and rules.',
          speech: 'Tell me what you want.',
          status: 'Setting up',
        },
        {
          title: 'It finds',
          line: 'Roles that fit, from sites you choose.',
          speech: 'I search where you choose.',
          status: 'Finding roles',
        },
        {
          title: 'It applies',
          line: 'Tailored, then applied once you approve.',
          speech: 'I apply once you approve.',
          status: 'Applying',
        },
      ],
    },
    /** The story's controls (a fieldset under the deputy). */
    story: {
      controls: 'Story controls',
      play: 'Play story',
      pause: 'Pause story',
      replay: 'Replay story',
      /** Under reduced motion the story never plays itself; the same button moves one step. */
      advance: 'Advance story',
      previous: 'Previous step',
      next: 'Next step',
      previousTo: 'Previous step: {title}',
      nextTo: 'Next step: {title}',
      /** Read out when someone moves to a step: "Step 2 of 3: It finds". */
      position: 'Step {number} of {total}: {title}',
    },
  },
  /** The boot loader (index.html, which reads these through `{{copy.boot.*}}` slots: html-copy.ts). */
  boot: {
    /** Under the logo while the app loads. */
    status: 'Loading…',
    /** The progress bar's name for screen readers. */
    progressLabel: 'Loading JobDeputy',
    /** Shown once the wait passes 8 s, before the reload link. */
    slow: 'This is taking longer than usual.',
    reload: 'Reload',
    /** Shown instead of loading when the browser runs no scripts. */
    noScript: 'JobDeputy needs JavaScript. Turn it on, then reload.',
    /** Read out once the loader, if it was seen, gives way to the app. */
    ready: 'JobDeputy is ready.',
  },
  loading: {
    /** Beside data already on screen while a newer copy loads. */
    refreshing: 'Updating…',
    /** Added once a wait passes 8 s. */
    stillWorking: 'Still working…',
    /** Read out when a region's first load passes 8 s: "Loading your matches. Still working…". */
    stillLoading: '{label}. Still working…',
    /** Added to a long background job (a search, a tailoring) once it passes 8 s. */
    background: 'This keeps going in the background. You can leave this page.',
    /** Read out as a progress bar passes each quarter: "Uploading résumé, 50%". */
    progressMilestone: '{label}, {percent}',
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

/**
 * Same keys as `en`, any text: the shape every future language file must match. Lists keep their
 * length (two wordmark parts, two title lines, three steps), because the UI is built around them.
 */
type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };
export type Copy = Widen<typeof en>;
