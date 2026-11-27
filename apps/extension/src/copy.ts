import { fill } from '@jobdeputy/shared/text';

export { fill };

/** The extension's words (decision 0020; the web app's live in its copy/en.ts). */
export const copy = {
  popup: {
    title: 'JobDeputy',
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
      add: 'Add in JobDeputy',
      offline: 'Couldn’t reach JobDeputy. Check your connection.',
      failed: 'Couldn’t read your details.',
      retry: 'Try again',
    },
  },
};
