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
    /** On a first load paused while the browser is offline. */
    offline: 'Waiting for a connection…',
    /** Read out then: "Opening your search desk. Waiting for a connection…". */
    offlineLoading: '{label}. Waiting for a connection…',
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
    /** Step 1: who the person is, so the deputy can address them and fill in applications. */
    you: {
      eyebrow: 'You',
      title: 'First, what should I call you?',
      intro: 'Your name goes on the applications I prepare. You can change it later in Profile.',
      speech: 'Nice to meet you.',
      firstName: 'First name',
      lastName: 'Last name',
      city: 'City (optional)',
      cityHint: 'Where you are based, so I look for roles near you too.',
      country: 'Country',
    },
    /** Step 2: the job titles the deputy searches for (each saved as a target role). */
    roles: {
      eyebrow: 'Target roles',
      title: 'What roles should I look for?',
      intro: 'I search for these titles. Add up to {max}.',
      speech: 'I’ll search for these titles.',
      jobTitle: 'Job title',
      placeholder: 'e.g. Staff engineer',
      hint: 'Press Enter to add it, or pick one below.',
      add: 'Add',
      chosen: 'Roles to look for',
      count: '{count} of {max} added',
      added: 'Added {title}. {count} of {max} roles.',
      /** Picked with a tap (the round 7 prototype's six). */
      picks: [
        'Software engineer',
        'Product engineer',
        'Engineering manager',
        'Backend engineer',
        'Platform engineer',
        'Site reliability engineer',
      ],
      /** Offered as the person types. */
      suggestions: [
        'Software engineer',
        'Senior software engineer',
        'Staff engineer',
        'Principal engineer',
        'Product engineer',
        'Engineering manager',
        'Backend engineer',
        'Frontend engineer',
        'Full-stack engineer',
        'Platform engineer',
        'Site reliability engineer',
        'Data engineer',
        'Machine learning engineer',
        'Mobile engineer',
        'Security engineer',
        'Solutions architect',
        'Technical program manager',
        'Product manager',
      ],
      empty: 'Type a job title first, or pick one below.',
      duplicate: '{title} is already on your list.',
      full: 'You can add up to {max} roles. Remove one to add another.',
      tooMany: 'Up to {max} roles fit, and {count} are chosen. Remove {extra} to continue.',
      none: 'Add at least one role, or pick a suggestion.',
      invalid: 'Check this title.',
      /** The API refused a title this page let through (its rules are newer). */
      refused: '“{title}” can’t be saved as it is. Change it or remove it.',
      changedElsewhere:
        'Your roles changed somewhere else. They show here now: check them, then continue.',
      loading: 'Loading your roles',
      loadFailed: 'Your roles didn’t load. Check your connection, then try again.',
      retry: 'Try again',
    },
    /** Step 3: the résumé the deputy reads (optional; uploaded, then checked by the server). */
    resume: {
      eyebrow: 'Your résumé',
      title: 'Add your résumé.',
      intro: 'I read it to judge fit and draft tailored versions. You can skip this for now.',
      speech: 'I check every file first.',
      /** While the file is sent and checked: the deputy's line and status pill. */
      workingSpeech: 'I check it before reading.',
      workingStatus: 'Checking your file',
      readySpeech: 'I’ll tailor from this one.',
      dropTitle: 'Drop your résumé here',
      dropMeta: 'PDF or DOCX, up to 5 MB, kept in your United States home Region.',
      choose: 'Choose a file',
      /** The list holding the one résumé. */
      listName: 'Your résumé',
      /** The upload's progress bar (read out at each quarter: "Uploading résumé, 50%"). */
      uploading: 'Uploading résumé',
      /** Where the file is in its three stages, under its name. */
      stage: '{stage} · step {current} of 3',
      stages: {
        uploading: 'Uploading',
        checking: 'Checking it for malware',
        reading: 'Reading the text',
      },
      /** Under a ready file's name: "PDF · 180 KB". */
      readyLine: '{format} · {size}',
      ready: 'Ready',
      /** Under the name of a file the server couldn't use (the reason is said below the list). */
      notUsed: 'Couldn’t be used',
      cancel: 'Cancel',
      remove: 'Remove',
      removing: 'Removing…',
      /** What the status line says as things happen. */
      said: {
        uploading: 'Uploading {name}.',
        checking: '{name} is uploaded. Checking it for malware.',
        reading: 'Checking done. Reading the text of {name}.',
        ready: '{name} is ready.',
        cancelled: 'Upload of {name} cancelled.',
        removed: '{name} removed.',
      },
      /** Why a file can't be used, before it is sent. */
      wrongType: '{name} isn’t a PDF or DOCX file. Choose a PDF or DOCX file under 5 MB.',
      empty: '{name} is empty. Choose a PDF or DOCX file under 5 MB.',
      tooLarge: '{name} is larger than 5 MB. Choose a smaller PDF or DOCX file.',
      badName: 'Rename {name} to a plain file name (5 to 200 characters, no slashes or quotes).',
      /** The server couldn't use it and gave no reason. */
      unusable: 'This file couldn’t be used. Remove it, then choose another.',
      /** At the API's limit (unfinished uploads count until the server clears them, within a day). */
      full: 'You’ve reached the limit of {max} résumés. Unfinished uploads count until they clear, within a day.',
      uploadFailed: 'The upload didn’t finish. Check your connection, then try again.',
      uploadRefused: 'The upload was refused. Try again.',
      removeFailed: 'That didn’t remove. Check your connection, then try again.',
      loading: 'Loading your résumé',
      loadFailed: 'Your résumé didn’t load. Check your connection, then try again.',
      retry: 'Try again',
      skip: 'Skip for now',
    },
    continue: 'Continue',
    saving: 'Saving…',
    back: 'Back',
    /** What is wrong with a field, or with saving. */
    errors: {
      firstNameMissing: 'Enter your first name.',
      lastNameMissing: 'Enter your last name.',
      firstNameInvalid: 'Check your first name.',
      lastNameInvalid: 'Check your last name.',
      cityInvalid: 'Check the city.',
      tooLong: 'Use at most {max} characters.',
      saveFailed: 'That didn’t save. Check your connection, then try again.',
      tryLater: 'That didn’t save. Try again in a moment.',
      /** Refused as out of date: something this step doesn't show was saved meanwhile. */
      savedMeanwhile:
        'Something else in your profile was saved meanwhile. Press Continue to save this too.',
      /** A save's answer was lost, and what is saved can't be read either. */
      unknownOutcome: 'We couldn’t tell whether that saved. Check your connection, then try again.',
      unknownOutcomeLater: 'We couldn’t tell whether that saved. Try again in a moment.',
      tooMany: 'Too many saves for now. Try again in {wait}.',
      /** The wait in tooMany, by count. */
      units: {
        seconds: { one: '{count} second', other: '{count} seconds' },
        minutes: { one: '{count} minute', other: '{count} minutes' },
      },
      changedElsewhere:
        'Your profile changed somewhere else. It shows here now: check it, then continue.',
      /** Something saved that this step doesn't show no longer fits the rules. */
      cannotSave:
        'Part of your saved profile no longer fits the rules, so this can’t be saved yet.',
      accountClosed: 'This account can’t be changed any more. Sign out to continue.',
      signedOut: 'Your session has ended. Sign in again to continue.',
    },
  },
  /** Loading the signed-in person's profile, and failing to. */
  profile: {
    loading: 'Opening your search desk',
    failed: 'Your search desk didn’t open.',
    failedReason:
      'Check your connection, then try again. If it still won’t open, sign out and back in.',
    retry: 'Try again',
  },
  /** The signed-in app's page list (the sidebar; across the top on phones). */
  nav: {
    label: 'Primary',
    profile: 'Profile',
    /** The browser tab's title on a page: "Profile · JobDeputy". */
    pageTitle: '{page} · JobDeputy',
  },
  /** The Profile page: what the deputy knows about the person (#33). */
  profilePage: {
    eyebrow: 'Profile',
    title: 'What your deputy knows about you.',
    intro: 'Everything your deputy uses to apply. Nothing reaches an employer without you.',
    /** A fact with nothing saved yet. */
    notAdded: 'Not added',
    about: {
      title: 'About you',
      line: 'How you introduce yourself on drafts and application forms.',
      name: {
        title: 'Name and headline',
        firstName: 'First name',
        lastName: 'Last name',
        preferredName: 'Preferred name',
        headline: 'Headline',
      },
      contact: {
        title: 'Contact and location',
        email: 'Email',
        phone: 'Phone',
        city: 'City',
        country: 'Country',
      },
      links: {
        title: 'Links',
        linkedin: 'LinkedIn',
        github: 'GitHub',
        portfolio: 'Portfolio',
        other: 'Other links',
      },
    },
    /** Country codes as shown (the US-only launch). */
    countries: { US: 'United States' } as Record<string, string>,
  },
  /** Signing out (the header's button, on every signed-in page). */
  signedIn: {
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
