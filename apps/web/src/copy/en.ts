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
    email: 'Email',
    password: 'Password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    code: 'Code from your email',
    /** The password toggle: its visible word, inside its name ("Show" in "Show password"). */
    show: 'Show',
    hide: 'Hide',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    passwordRule: 'At least 12 characters.',
    signIn: {
      kicker: 'Secure sign-in',
      title: 'Welcome back.',
      subtitle: 'Your searches, saved roles, and next steps are right where you left them.',
      submit: 'Sign in',
      pending: 'Signing in…',
      forgot: 'Forgot password?',
      switch: 'New here? Create an account',
    },
    signUp: {
      kicker: 'Create account',
      title: 'Set up your search desk.',
      subtitle:
        'Start with secure access. Your profile, résumés, and search preferences come next.',
      submit: 'Create account',
      pending: 'Creating your account…',
      switch: 'Have an account? Sign in',
    },
    /** The 6-digit code that confirms a new account. */
    confirm: {
      kicker: 'Check your email',
      title: 'Enter your code.',
      subtitle: 'We sent a 6-digit code to {email}.',
      submit: 'Confirm',
      pending: 'Checking…',
      /** When a fresh code could not be sent: one sent earlier may still be in the inbox. */
      subtitleEarlier: 'Use the latest 6-digit code we sent to {email}, or send a new one.',
      resend: 'Send a new code',
      resending: 'Sending a new code…',
      resent: 'A new code is on its way.',
    },
    reset: {
      kicker: 'Reset password',
      title: 'Forgot your password?',
      subtitle: 'We’ll email you a code to set a new one.',
      submit: 'Send code',
      pending: 'Sending…',
    },
    resetConfirm: {
      kicker: 'Reset password',
      title: 'Set a new password.',
      subtitle: 'Enter the latest code we sent to {email}, if an account uses it.',
      resent: 'If an account uses {email}, a new code is on its way.',
      submit: 'Save password',
      pending: 'Saving password…',
      done: 'Your new password is ready. Sign in with it.',
    },
    backToSignIn: 'Back to sign in',
    /** Next to a field, or above the button for the whole form. */
    errors: {
      emailMissing: 'Enter your email.',
      emailInvalid: 'Enter an email like name@example.com.',
      passwordMissing: 'Enter your password.',
      passwordShort: 'Use at least 12 characters.',
      confirmMismatch: 'The passwords don’t match.',
      codeInvalid: 'Enter the 6 digits from the email.',
      'wrong-details': 'That email and password don’t match an account.',
      'account-exists': 'An account already uses this email. Sign in instead.',
      'wrong-code': 'That code isn’t right. Check the email and try again.',
      'expired-code': 'That code has expired. Send a new one.',
      'too-many-tries': 'Too many tries. Wait a few minutes, then try again.',
      'weak-password': 'Choose a longer or less common password.',
      offline: 'Can’t reach JobDeputy. Check your connection and try again.',
      'no-answer': 'JobDeputy didn’t answer in time. A code may still arrive; if not, try again.',
      'not-set-up': 'Sign-in isn’t available here yet.',
      /** Not a failure: the code worked, but signing in straight after did not (shown as a note). */
      confirmed: 'Your account is confirmed. Sign in to continue.',
      unknown: 'Something went wrong. Try again.',
    },
  },
  /** The guided set-up after the first sign-in (#33): a welcome, three short steps, then the app. */
  setUp: {
    /** Beside the header's step bar on the welcome, before the steps begin. */
    progress: '3 short steps',
    /** Beside the step bar during the steps: where the person is. */
    step: 'Step {current} of {total}',
    eyebrow: 'Getting started',
    title: 'Hi, I’m your deputy.',
    intro: 'About two minutes, so I search the right places.',
    speech: 'Let’s get going.',
    status: 'Ready',
    accountTitle: 'Your account is ready.',
    signedInAs: 'Signed in as',
    homeRegion: 'Home Region',
    /** The Region every account lives in for now (US-only launch). */
    region: 'United States (US)',
    locked: 'Locked',
    regionNote: 'Your profile, searches, and files stay in this Region.',
    start: 'Let’s start',
  },
  /** Loading the signed-in person's profile, and failing to. */
  profile: {
    loading: 'Opening your search desk',
    /** While the browser is offline: the load waits for the network. */
    offline: 'Waiting for a connection…',
    failed: 'Your search desk didn’t open.',
    failedReason:
      'Check your connection, then try again. If it still won’t open, sign out and back in.',
    retry: 'Try again',
    retrying: 'Trying again…',
  },
  /** The page a signed-in person sees until the app's own screens arrive. */
  signedIn: {
    kicker: 'Signed in',
    title: 'You’re in.',
    body: 'Signed in as {email}. Your search desk is on its way.',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
  },
} as const;

/**
 * Same keys as `en`, any text: the shape every future language file must match. Lists keep their
 * length (two wordmark parts, two title lines, three steps), because the UI is built around them.
 */
type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };
export type Copy = Widen<typeof en>;
