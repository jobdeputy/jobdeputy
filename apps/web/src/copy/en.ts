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
      /** Under the name of a file whose upload started elsewhere: being checked, or never sent. */
      notReady: 'Not ready yet',
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
    jobs: 'Jobs',
    profile: 'Profile',
    resumes: 'Résumés',
    /** The browser tab's title on a page: "Profile · JobDeputy". */
    pageTitle: '{page} · JobDeputy',
  },
  /** The Jobs page's tabs (#52): each is a page of its own. */
  jobsTabs: {
    label: 'Jobs',
    search: 'Search',
    matches: 'Matches',
    applications: 'Applications',
  },
  /** The jobs area's one table (#52), on every tab. */
  jobsTable: {
    /** Read out when a column is sorted. */
    sorted: {
      ascending: 'Sorted by {column}, ascending.',
      descending: 'Sorted by {column}, descending.',
    },
  },
  /** The Search tab (#52): Find jobs, and the runs so far. */
  searchPage: {
    eyebrow: 'Search',
    title: 'Point your deputy at a company.',
    intro:
      'Paste a careers page or a GitHub list. Your deputy reads it and keeps the 3 roles that fit you best at each company, in Matches.',
    runs: {
      title: 'Your searches',
      loading: 'Loading your searches',
      loadFailed: 'Your searches didn’t load.',
      retry: 'Try again',
      emptyTitle: 'No searches yet',
      emptyLine: 'Each link you give your deputy shows here, with how it went.',
      more: 'More searches',
      moreFailed: 'More searches didn’t load. Press More searches to try again.',
      loadingMore: 'Loading more…',
      columns: {
        link: 'Link',
        started: 'Started',
        status: 'Status',
        companies: 'Companies',
        jobs: 'Jobs found',
      },
      /** Under a run's name: what was given. */
      kind: { page: 'Careers page', list: 'GitHub list' },
      states: {
        waiting: 'Waiting',
        reading: 'Reading',
        scoring: 'Scoring',
        stalled: 'Stalled',
        failed: 'Failed',
        done: 'Done',
      },
      /** A count not known: a run at work, stalled, or failed. */
      none: 'Not known',
    },
  },
  /** The Matches tab (#52), where the app opens: the best jobs at each company. */
  matchesPage: {
    eyebrow: 'Matches',
    title: 'The best jobs at each company.',
    intro: 'The 3 roles that fit you best at each company your deputy has read.',
    /** The jobs not applied to yet, in the jobs table (#52 PR C). */
    list: {
      title: 'Your matches',
      loading: 'Loading your matches',
      loadFailed: 'Your matches didn’t load.',
      retry: 'Try again',
      emptyTitle: 'No matches yet',
      emptyLine:
        'Give your deputy a careers page in Search. The best roles at each company land here.',
      /** The empty Matches tab points to Search. */
      toSearch: 'Go to Search',
      /** Past the API's most (500): the rest are not shown. */
      truncated: 'Showing your best {count} matches.',
      columns: {
        job: 'Job',
        company: 'Company',
        where: 'Where',
        fit: 'Fit',
        posted: 'Posted',
      },
      /** The board gave no date. */
      postedNone: 'Not given',
      /** The board gave no place. */
      whereNone: 'Not given',
      /** A job opened here left Matches without this page's doing (another tab, or a crawl). */
      left: '{title} at {company} is no longer in Matches: it was marked as applied elsewhere, or its posting closed.',
    },
    /** In the job pane: applying (#52 PR C; the prototype's "Did you apply?" check). */
    apply: {
      manual: 'Manual apply',
      manualHint: 'Opens the employer’s application in a new tab. You apply there yourself.',
      auto: 'Auto apply',
      soon: 'Soon',
      autoHint: 'Soon your deputy fills in applications for you, through its browser extension.',
      /** Asked once Manual apply has opened the employer's page. */
      ask: 'Did you apply on the employer site?',
      askLine: 'Confirm only if you sent the application yourself.',
      yes: 'I applied',
      no: 'Not yet',
      saving: 'Saving…',
      failed: 'That didn’t save. Try again.',
      offline: 'You’re offline, so that didn’t save. Try again once you’re back online.',
      /** Said once it is saved: the job leaves Matches. */
      applied: 'Marked as applied: {title} at {company}. It left Matches.',
      undo: 'Undo',
      undoing: 'Undoing…',
      undone: '{title} at {company} is back in Matches.',
      undoFailed: 'Couldn’t undo that. Try again.',
      /** The job moved on elsewhere (another tab): Undo goes. */
      undoChanged: 'Couldn’t undo: this job was changed elsewhere.',
    },
  },
  /** The Applications tab (#52 PR D): the jobs applied to, each with its stage. */
  applicationsPage: {
    eyebrow: 'Applications',
    title: 'Every job you’ve applied to.',
    intro: 'Keep each one’s stage up to date as you hear back.',
    list: {
      title: 'Your applications',
      loading: 'Loading your applications',
      loadFailed: 'Your applications didn’t load.',
      retry: 'Try again',
      emptyTitle: 'No applications yet',
      emptyLine: 'When you mark a job as applied in Matches, it moves here.',
      /** The empty Applications tab points to Matches. */
      toMatches: 'Go to Matches',
      more: 'More applications',
      loadingMore: 'Loading more…',
      moreFailed: 'More applications didn’t load. Press More applications to try again.',
      columns: {
        job: 'Job',
        company: 'Company',
        applied: 'Applied',
        stage: 'Stage',
      },
    },
    /** A job's stage, set in its row. */
    stage: {
      /** The stage picker's name, read out. */
      label: 'Stage for {title} at {company}',
      names: {
        applied: 'Applied',
        interviewing: 'Interviewing',
        offer: 'Offer',
        rejected: 'Rejected',
        withdrawn: 'Withdrawn',
      },
      saving: 'Saving…',
      /** Read out once saved. */
      saved: '{title} at {company}: {stage}.',
      failed: 'The stage for {title} at {company} didn’t save. Try again.',
      offline:
        'You’re offline, so the stage for {title} at {company} didn’t save. Try again once you’re back online.',
      /** Changed in another tab or device meanwhile: the list is read again. */
      changed: '{title} at {company} was changed elsewhere. It shows as it is now.',
    },
  },
  /** Find jobs, its progress and outcome, and the companies (#49), shared by the jobs tabs. */
  jobsPage: {
    find: {
      title: 'Find jobs',
      line: 'A company’s careers page or job board, or a GitHub list of open roles.',
      label: 'Careers page link',
      placeholder: 'boards.greenhouse.io/acme',
      hint: 'Public pages only, not LinkedIn. From a list, your deputy reads the 20 companies that fit you best.',
      submit: 'Find jobs',
      /** Read out while the link is sent. */
      sending: 'Sending the link…',
      errors: {
        empty: 'Paste a link to a careers page.',
        busy: 'Your deputy is already reading a link. Paste the next one when it’s done.',
        daily: 'You’ve used today’s links. More from midnight UTC.',
        /** #50: the day's GitHub lists (2) are used; single links may still work. */
        dailyLists: 'You’ve used today’s lists. More from midnight UTC; company links still work.',
        /** #50: list runs are switched off for now. */
        listsOff: 'Lists can’t be read right now. Paste a company’s careers link instead.',
        tryLater: 'That didn’t go through. Try again in a moment.',
        /** The API's own words for a refusal it gives no reason for. */
        refused: 'That link can’t be read. Check it, or try another page.',
        /** The free AI runs are used up for now (the platform model). */
        aiUsedUp:
          'You’ve used your AI scoring for now. Your deputy can still rank this link by keywords.',
      },
      /** Beside an AI refusal: send the same link, ranked by keywords only (no AI scores). */
      withoutAi: 'Find jobs without AI scores',
      /** The newest link couldn't be checked on. */
      readFailed: 'Couldn’t check on your last link.',
      retry: 'Check again',
      retrying: 'Checking…',
    },
    /**
     * Why a link can't be read, by the API's reason (packages/shared/src/crawl.ts CRAWL_ERRORS): when
     * it is sent, or when the deputy tried it. A test keeps every reason here.
     */
    linkErrors: {
      invalid_url: 'This is not a web address your deputy can read.',
      blocked_address:
        'This address points to a private or internal network, which your deputy never reads.',
      unsafe_redirect: 'The page sent your deputy somewhere it doesn’t follow.',
      too_many_redirects: 'The page redirected too many times.',
      blocked_by_robots: 'The site asks automated visitors not to read this page.',
      login_required: 'This page needs a sign-in. Your deputy only reads public pages.',
      blocked: 'The site turned your deputy away.',
      not_found: 'The page isn’t there (any more).',
      http_error: 'The site answered with an error.',
      unsupported_content: 'This isn’t a web page (for example a PDF or an image).',
      too_large: 'The page is too large to read.',
      needs_browser:
        'This page only shows its jobs with JavaScript, which your deputy can’t run yet.',
      unreadable_feed:
        'Your deputy couldn’t read this job board’s list. Its format may have changed.',
      not_a_list: 'Your deputy couldn’t find a list of open roles in this repository.',
      tls_error: 'The site’s secure connection is broken (for example an expired certificate).',
      timeout: 'The site took too long to answer.',
      unreachable: 'The site couldn’t be reached.',
      internal: 'Something went wrong on our side.',
    },
    /** Why the AI didn't score a crawl's jobs (packages/shared/src/ai.ts RELEVANCE_ERRORS). */
    scoringErrors: {
      key_missing: 'Its AI key was deleted, so the jobs weren’t scored.',
      key_invalid: 'Its AI key doesn’t work, so the jobs weren’t scored.',
      key_rejected: 'The AI provider turned the key away while scoring.',
      model_unavailable: 'The AI model was unavailable, so some jobs weren’t scored.',
    },
    /** The deputy at work on the link. */
    working: {
      status: 'Finding jobs',
      speech: 'On it.',
      waiting: 'Waiting for my turn to read {host}…',
      reading: 'Reading {host}…',
      scoring: 'Scoring the jobs at {host} against your roles…',
      /** #50: a GitHub list. */
      readingList: 'Reading the list {host} and choosing the companies that fit you…',
      companies: 'Reading the companies from {host}…',
      /** #50: the bar under the deputy while a list's companies are read. */
      companiesBar: {
        one: '{done} of {count} company read',
        other: '{done} of {count} companies read',
      },
    },
    /** A job's facts, wherever it shows (#49). */
    job: {
      /** Where a job is worked (the API's `onsite`, `hybrid`, `remote`). */
      workplace: { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' },
      /** How well a job fits, from the AI's score (#49). */
      fit: {
        strong: 'Strong fit',
        good: 'Good fit',
        stretch: 'Stretch',
        unscored: 'Not scored yet',
      },
    },
    /** The job open beside the list (#49 PR D): what it is, why it fits, the posting. */
    preview: {
      label: 'The job you opened',
      back: 'Back to Matches',
      close: 'Close',
      posted: 'Posted {date}',
      score: 'Scored {score} of 100 against your roles.',
      whyTitle: 'Why it fits',
      whyNone: 'Your deputy ranked this one by keywords only: it has no AI reasons yet.',
      /** The AI scored it, and gave no reasons. */
      whyNoReasons: 'The AI scored it without giving its reasons.',
      postingTitle: 'What the posting says',
      postingNone: 'The job board didn’t share this posting’s text. Open it on their site.',
      postingCut: 'The posting is longer: the rest is on their site.',
      loading: 'Loading the posting',
      loadFailed: 'The posting didn’t load.',
      /** The job was taken down since the list was read. */
      gone: 'This job isn’t on its board any more.',
      retry: 'Try again',
      openPosting: 'Open the posting',
      /** Read after Open the posting: it opens on the company's site. */
      newTab: '(opens in a new tab)',
    },
    /** How the last link went. */
    result: {
      /** #52: after a run that found jobs, to the Matches tab. */
      toMatches: 'See your matches',
      /** `{count}` is how many jobs the page listed. */
      done: {
        one: 'Done with {host}: {count} job read.',
        other: 'Done with {host}: {count} jobs read.',
      },
      doneEmpty: 'Done with {host}: no jobs on that page.',
      stalled: 'Your deputy couldn’t finish {host}. Send the link again to start over.',
      doneNone: 'Done with {host}: no jobs there fit your roles.',
      noScore: 'Your deputy ranked them without AI: {reason}',
      failed: 'Couldn’t read {host}. {reason}',
      tryAnother: 'Check the link, or try another page.',
      /** #50: a list. `{count}` is jobs read; `{companies}` the companies read ("1 company"). */
      listDone: {
        one: 'Done with {host}: {count} job read at {companies}.',
        other: 'Done with {host}: {count} jobs read at {companies}.',
      },
      companies: { one: '{count} company', other: '{count} companies' },
      listNoMatch: 'Done with {host}: none of its roles fit your roles.',
      listNoneRead: 'Done with {host}: none of its companies could be read this time.',
      listNoneFit: 'Done with {host}: no jobs at {companies} fit your roles.',
      listNoJobs: 'Done with {host}: no open jobs at {companies}.',
      listNoneReadable: 'Done with {host}: none of its companies’ sites can be read yet.',
      listSkipped: {
        one: '{count} company skipped: its site can’t be read yet.',
        other: '{count} companies skipped: their sites can’t be read yet.',
      },
      listFailed: {
        one: '{count} company couldn’t be read.',
        other: '{count} companies couldn’t be read.',
      },
      listBusy: {
        one: '{count} company was already being read from another link.',
        other: '{count} companies were already being read from other links.',
      },
    },
  },
  /** The Résumés page: the files the deputy tailors from (#33). */
  resumesPage: {
    eyebrow: 'Résumés',
    title: 'The résumés your deputy tailors from.',
    intro: 'Your deputy tailors each role from your default. Your originals never change.',
    library: {
      title: 'Library',
      line: 'One is your default. Keep up to {max}.',
      /** Beside the title: "3 of 10". */
      count: '{count} of {max}',
      countName: 'Résumés in your library',
      listName: 'Your résumés',
      default: 'Default',
      emptyTitle: 'No résumés yet',
      emptyLine: 'Add a résumé so your deputy has something to tailor from.',
    },
    /** The Library's upload zone, and the files on their way in. */
    upload: {
      dropTitle: 'Drop résumés here',
      dropMeta: 'PDF or DOCX, up to 5 MB each, kept in your United States home Region.',
      choose: 'Choose files',
      fullTitle: 'Your library is full',
      fullMeta: 'Delete a résumé to add another. Your deputy keeps up to {max}.',
      listName: 'Files you are adding',
      /** Each upload's progress bar. */
      uploading: 'Uploading {name}',
      /** Under the name of a file that wasn't added (why follows). */
      notAdded: 'Not added',
      noRoom: 'There’s no room for {name}. Your deputy keeps up to {max} résumés.',
      retry: 'Try again',
      dismiss: 'Dismiss',
      said: {
        full: 'Your library is full. Delete a résumé to add another.',
        failed: '{name} wasn’t added. {reason}',
        dismissed: '{name} dismissed.',
        unusable: '{name} couldn’t be used.',
      },
    },
    /** A row's actions; its résumé's name follows each, for screen readers. */
    makeDefault: 'Make default',
    makingDefault: 'Saving…',
    download: 'Download',
    downloading: 'Getting it…',
    rename: 'Rename',
    delete: 'Delete',
    deleting: 'Deleting…',
    /** Why a row's action didn't go through, under its name. */
    failed: {
      makeDefault: 'That didn’t change your default. Check your connection, then try again.',
      download: 'That didn’t download. Check your connection, then try again.',
      /** Résumés changed elsewhere meanwhile: the list is read again, and the person can try again. */
      changed: 'Your résumés changed elsewhere. Look again, then try again.',
      /** No longer ready (it was a download): read again, the row says why. */
      notReady: 'This résumé isn’t ready to download.',
    },
    renameSheet: {
      eyebrow: 'Library',
      title: 'Rename résumé',
      line: 'Change the name you see. The file stays exactly as it is.',
      label: 'Name',
      hint: 'Up to {max} characters.',
      empty: 'Enter a name.',
      save: 'Save name',
      saving: 'Saving…',
      cancel: 'Cancel',
      changed: 'This résumé changed elsewhere since you opened this. Save again to use your name.',
      failed: 'That didn’t save. Check your connection, then try again.',
    },
    confirm: {
      eyebrow: 'Library',
      title: 'Delete {name}?',
      /** The file is deleted for good; a default hands over to the newest ready résumé. */
      line: 'The file is deleted for good. This can’t be undone.',
      /** Deleting the default, with others kept (the newest ready one takes over), or the last. */
      handOver:
        'The file is deleted for good. This can’t be undone. Your newest ready résumé becomes your default.',
      noHandOver: 'The file is deleted for good. This can’t be undone.',
      confirm: 'Delete résumé',
      keep: 'Keep it',
    },
    said: {
      deleted: '{name} deleted.',
      newDefault: '{name} deleted. {next} is your default now.',
      noDefault: '{name} deleted. You have no default résumé now.',
      madeDefault: '{name} is your default now. Your deputy tailors from it.',
      renamed: 'Renamed {name} to {next}.',
      keptName: '{name} kept its name.',
      downloading: 'Downloading {name}.',
      gone: '{name} is gone. It was deleted elsewhere.',
    },
    deleteFailed: 'That didn’t delete. Check your connection, then try again.',
    loading: 'Loading your résumés',
    loadFailed: 'Your résumés didn’t load. Check your connection, then try again.',
    retry: 'Try again',
  },
  /** The Profile page: what the deputy knows about the person (#33). */
  profilePage: {
    eyebrow: 'Profile',
    title: 'What your deputy knows about you.',
    intro: 'Everything your deputy uses to apply. Nothing reaches an employer without you.',
    /** A fact with nothing saved yet. */
    notAdded: 'Not added',
    /** A group's button that opens its form; the group's title follows it, for screen readers. */
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    /** Beside a group's title once its form saved (and said: "{group} saved."). */
    saved: 'Saved',
    savedSaid: '{group} saved.',
    about: {
      title: 'About you',
      line: 'How you introduce yourself on drafts and application forms.',
      name: {
        title: 'Name and headline',
        firstName: 'First name',
        lastName: 'Last name',
        preferredName: 'Preferred name',
        headline: 'Headline',
        preferredNameHint: 'What your deputy calls you. Forms use your full name.',
        headlineHint: 'One line about the work you do best.',
      },
      contact: {
        title: 'Contact and location',
        email: 'Email',
        phone: 'Phone',
        city: 'City',
        country: 'Country',
        /** The phone's two parts, in its form. */
        phoneCode: 'Country code',
        phoneNumber: 'Phone number',
      },
      links: {
        title: 'Links',
        linkedin: 'LinkedIn',
        github: 'GitHub',
        portfolio: 'Portfolio',
        website: 'Website',
        other: 'Other links',
        linkHint: 'A web address, like linkedin.com/in/your-name.',
        otherHint: 'One address per line, up to {max}.',
      },
    },
    errors: {
      preferredNameInvalid: 'Check your preferred name.',
      headlineInvalid: 'Check your headline.',
      phoneCodeInvalid: 'Use a code like +1, +44, or +91.',
      phoneNumberInvalid: 'Use digits, spaces, dashes, or brackets.',
      phoneNumberMissing: 'Enter the number, or clear the country code.',
      linkInvalid: 'Enter a web address, like linkedin.com/in/your-name (https only).',
      otherLinksInvalid: 'Check each address: one per line, https only.',
      otherLinksTooMany: 'Add at most {max} addresses.',
      /** Refused as out of date: something this form doesn't show was saved meanwhile. */
      savedMeanwhile:
        'Something else in your profile was saved meanwhile. Press Save to save this too.',
      changedElsewhere:
        'Your profile changed somewhere else. It shows here now: check it, then save.',
    },
    preferences: {
      title: 'Job preferences',
      line: 'What your deputy looks for.',
      roles: {
        title: 'Target roles',
        none: 'None yet. Add the job titles your deputy should look for.',
        tooMany: 'Up to {max} roles fit, and {count} are chosen. Remove {extra} to save.',
        changedElsewhere:
          'Your roles changed somewhere else. They show here now: check them, then save.',
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
