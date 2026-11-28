import { fill } from '@jobdeputy/shared/text';

export { fill };

/** The extension's words (decision 0020; the web app's live in its copy/en.ts). */
export const copy = {
  popup: {
    title: 'JobDeputy',
    /** On a dev build: beside the title, on the toolbar button, and as its name. */
    dev: 'Dev',
    devBadge: 'DEV',
    devName: 'JobDeputy Dev',
    devLabel: 'Development build',
    line: 'Your deputy fills in job applications with your saved answers. You review and click Submit.',
    version: 'Version {version}',
    broken: 'Something went wrong in the extension. Close this and open it again.',
    unconfigured: 'This build can’t sign in: it was built without its sign-in settings.',
    signIn: 'Sign in',
    continueAs: 'Continue as {email}',
    differentAccount: 'Use a different account',
    signInNote: 'Opens JobDeputy’s sign-in in a window of its own.',
    signingIn: 'Signing in…',
    signingInNote: 'Finish signing in in the window that opened.',
    outcomes: {
      cancelled: 'Sign-in was closed before it finished.',
      offline: 'Couldn’t reach the sign-in page. Check your connection and try again.',
      failed: 'Sign-in didn’t work. Try again.',
      interrupted: 'Sign-in was interrupted before it finished. Sign in again.',
    },
    signedInAs: 'Signed in as {email}',
    signedIn: 'Signed in',
    signOut: 'Sign out',
    ready: {
      heading: 'What your deputy can fill in',
      checking: 'Checking your details…',
      details: 'Your details',
      resume: 'A résumé to attach',
      answers: 'Application answers',
      done: 'Ready',
      missing: 'Not added yet',
      /** Details and application answers: how many of those forms ask for are saved. */
      count: '{answered} of {total} saved',
      /** The count, said with whether the section is ready (screen readers). */
      readyCount: 'Ready, {count}',
      missingCount: 'Not ready yet, {count}',
      /** The count as a link to add the rest. */
      addRest: 'Add the rest in JobDeputy',
      /** What a section still needs before it's ready, shown beside its count. */
      needs: {
        details: 'name and email needed',
        answers: 'work authorization needed',
      },
      add: 'Add in JobDeputy',
      offline: 'Couldn’t reach JobDeputy. Check your connection.',
      failed: 'Couldn’t read your details.',
      retry: 'Try again',
    },
  },
  /** #54 PR C: the panel on a Greenhouse application form. */
  panel: {
    title: 'JobDeputy',
    line: 'Fill this application with your saved answers. You review it and click Submit.',
    fill: 'Fill this application',
    filling: 'Filling…',
    again: 'Fill again',
    hide: 'Hide JobDeputy',
    show: 'JobDeputy',
    progress: '{answered} of {total} questions answered',
    progressLabel: 'Questions answered',
    filled: 'JobDeputy filled {count} fields.',
    filledOne: 'JobDeputy filled 1 field.',
    filledNone: 'Nothing to fill: every field your answers cover is already filled.',
    leftHeading: 'Left for you',
    leftNote: 'Outlined on the page. Select one to go to it.',
    optionalEmpty: '{count} optional fields are empty.',
    optionalEmptyOne: '1 optional field is empty.',
    resume: {
      tailored: 'Attached your résumé tailored for this company.',
      default: 'Attached your default résumé.',
      none: 'No résumé attached: add one in JobDeputy, or attach it here.',
      failed: 'This page didn’t take your résumé: attach it yourself.',
    },
    coverLetter: 'Attached your cover letter for this job.',
    unread: {
      answers: 'Couldn’t read all your application answers.',
      voluntary: 'Couldn’t read all your self-ID answers, so those are left for you.',
      resume: 'Couldn’t get your résumé, so none is attached.',
      'cover-letter': 'Couldn’t get your cover letter, so none is attached.',
    },
    review: 'Check every answer, then click Submit yourself.',
    signedOut: 'Sign in from the JobDeputy button in your toolbar, then fill again.',
    offline: 'Couldn’t reach JobDeputy. Check your connection and try again.',
    failed: 'Couldn’t get your answers. Try again.',
  },
};
