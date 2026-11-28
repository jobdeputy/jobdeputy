import { WEB_SIGN_IN_CALLBACK_PATH } from '@jobdeputy/shared/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppNav, HOME_PAGE, isPageAt, PAGES, pageAt } from '@/components/app-shell.tsx';
import { JobsArea } from '@/components/jobs/jobs-area.tsx';
import { tabAt } from '@/components/jobs/tabs.ts';
import { type AuthControl, AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';
import { ProfilePage } from '@/components/profile/profile-page.tsx';
import { ResumesPage } from '@/components/resumes/resumes-page.tsx';
import { SetUp, type SetUpStep } from '@/components/setup/set-up.tsx';
import { SignedInLayout } from '@/components/signed-in-layout.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { hasProfile, useProfile } from '@/lib/api/profile.ts';
import { AuthError, type AuthErrorKind, lastSignInMode, useAuth } from '@/lib/auth/index.ts';
import { useFinishBoot } from '@/lib/boot-loader.ts';
import { navigate, usePath } from '@/lib/router.ts';

/**
 * The app: the public landing page (the story of what the deputy does, and the way in), or, for a
 * signed-in person, their page. The boot ends once it knows which. Back from the secure sign-in
 * page (#111) at `/auth/callback`, it first finishes that sign-in, then goes home; one that did not
 * finish reopens the drawer saying so.
 */
export function App() {
  const session = useAuth();
  // undefined: not known yet; null: nobody signed in.
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState<AuthErrorKind | undefined>(undefined);
  useEffect(() => {
    let current = true;
    const returning = window.location.pathname === WEB_SIGN_IN_CALLBACK_PATH;
    const found = returning
      ? session.finishSignIn().catch((error: unknown) => {
          if (current) setFailed(error instanceof AuthError ? error.kind : 'unknown');
          return null;
        })
      : session.currentUser();
    found.then((email) => {
      if (!current) return;
      // The callback's address (and its one-time code) is never kept, nor offered by Back.
      if (returning) navigate('/', { replace: true });
      setUser(email);
    });
    return () => {
      current = false;
    };
  }, [session]);
  useFinishBoot(user !== undefined);

  if (user === undefined) return null;
  if (user) return <SignedInApp email={user} onSignedOut={() => setUser(null)} />;
  return <Landing {...(failed ? { failed } : {})} />;
}

/**
 * A signed-in person's app: their profile decides where they start. No profile yet (a new account)
 * starts the guided set-up (#33); otherwise their page. Signing out forgets everything the app
 * loaded for them, so the next person in this tab starts clean.
 */
function SignedInApp({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const profile = useProfile();
  const queryClient = useQueryClient();
  // The set-up is entered when the person has no profile yet, and then stays until it is done,
  // even once its first step has saved one. Null: not entered (or done).
  const [setUpStep, setSetUpStep] = useState<SetUpStep | 'done' | null>(null);
  const signedOut = () => {
    queryClient.clear();
    onSignedOut();
  };
  const step =
    setUpStep === 'done'
      ? null
      : (setUpStep ?? (profile.data !== undefined && !hasProfile(profile.data) ? 'welcome' : null));
  // The app's pages, once the profile is read and the set-up is done.
  const pages = !step && profile.data !== undefined;
  const path = usePath();
  // The page shown is the one marked: Matches also at an address that is no page.
  const page = pageAt(path);
  // #52: in Jobs, the tab at this address (Matches, Jobs' own, at any other).
  const tab = tabAt(path);
  usePageAddress(pages, path, page === HOME_PAGE ? tab.label : page.label);
  return (
    <SignedInLayout onSignedOut={signedOut} nav={pages ? <AppNav path={page.path} /> : undefined}>
      {/* The shared loading states (#17): nothing for 300 ms, then a skeleton read out as
          "Opening your search desk", "Still working…" after 8 s, "Waiting for a connection…"
          while offline. The region holds the page's width and gutters. */}
      <QueryRegion
        query={profile}
        skeleton={{ kind: 'block', rows: 4 }}
        label={copy.profile.loading}
        error={<ProfileFailed onRetry={() => profile.refetch()} />}
        className="mx-auto w-full max-w-[1120px] px-[17px] py-8 sm:px-[clamp(21px,4vw,55px)] md:py-14"
      >
        {(data) =>
          step ? (
            <SetUp
              // A new step is a new form, started from what is saved.
              key={step}
              email={email}
              step={step}
              profile={data}
              onNext={() => setSetUpStep(SET_UP_NEXT[step])}
              onBack={() => setSetUpStep(SET_UP_BACK[step])}
            />
          ) : page === HOME_PAGE ? (
            <JobsArea path={tab.path} />
          ) : page.path === '/resumes' ? (
            <ResumesPage />
          ) : (
            <ProfilePage profile={data} />
          )
        }
      </QueryRegion>
    </SignedInLayout>
  );
}

/**
 * The address and title of the app's pages (#33), once they are shown: arriving at a path that is
 * no page (the landing's `/`, an old link such as #49's `/jobs`) goes to Matches, once (Back past
 * it later is left alone, and still shows Matches); the tab's title names the page shown.
 */
function usePageAddress(pages: boolean, path: string, label: string) {
  const arrived = useRef(false);
  useEffect(() => {
    if (!pages || arrived.current) return;
    arrived.current = true;
    if (!PAGES.some((page) => isPageAt(page, path))) navigate(HOME_PAGE.path, { replace: true });
  }, [pages, path]);
  useEffect(() => {
    if (!pages) return;
    const before = document.title;
    document.title = fill(copy.nav.pageTitle, { page: label });
    return () => {
      document.title = before;
    };
  }, [pages, label]);
}

/** The set-up's order (#33); the last step saved ends it. */
const SET_UP_NEXT: Record<SetUpStep, SetUpStep | 'done'> = {
  welcome: 'you',
  you: 'roles',
  roles: 'resume',
  resume: 'done',
};
const SET_UP_BACK: Record<SetUpStep, SetUpStep> = {
  welcome: 'welcome',
  you: 'welcome',
  roles: 'you',
  resume: 'roles',
};

/**
 * The profile could not be read: say so, and offer to try again (Sign out is in the header, so an
 * account that can no longer be read never traps its person). The section takes focus each time
 * it shows, named by its title and reason, so a failed retry is announced again.
 */
function ProfileFailed({ onRetry }: { onRetry: () => void }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.focus();
  }, []);
  return (
    <section
      ref={section}
      tabIndex={-1}
      // Named by its title and reason, so taking focus reads both on every screen reader
      // (a description can be read late, or only as a hint).
      aria-labelledby="profile-failed-title profile-failed-reason"
      className="grid max-w-[480px] justify-items-start gap-3 outline-none"
    >
      <h1
        id="profile-failed-title"
        className="m-0 font-display text-[clamp(1.75rem,6vw,2.25rem)] leading-tight font-medium tracking-[-0.03em]"
      >
        {copy.profile.failed}
      </h1>
      <p id="profile-failed-reason" className="m-0 text-[0.9375rem] text-muted-foreground">
        {copy.profile.failedReason}
      </p>
      <Button onClick={onRetry}>{copy.profile.retry}</Button>
    </section>
  );
}

/** The public landing page: the story of what the deputy does, and the way in (sign up or sign in). */
function Landing({ failed }: { failed?: AuthErrorKind }) {
  // A sign-in that came back unfinished opens the drawer as it was left, saying so.
  const [authMode, setAuthMode] = useState<AuthMode>(() => (failed ? lastSignInMode() : 'sign-up'));
  const [authOpen, setAuthOpen] = useState(failed !== undefined);
  // Said only the first time the drawer opens.
  const [failure, setFailure] = useState(failed);
  // The landing page is at /: after signing out, or opening a signed-in page's address while
  // signed out, the address says so.
  useEffect(() => navigate('/', { replace: true }), []);
  // Four buttons open the drawer; focus returns to whichever one did.
  const opener = useRef<HTMLElement | null>(null);

  const auth: AuthControl = {
    open: authOpen,
    openAuth(mode, button) {
      opener.current = button;
      setAuthMode(mode);
      setFailure(undefined);
      setAuthOpen(true);
    },
  };

  return (
    <>
      {/* The header takes its height; the main area (and the hero in it) fills the rest. Page
          content (a footer too) goes inside this wrapper: it bounds where the header sticks.
          minmax(0,1fr) columns keep wide content from widening the page. */}
      <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
        <SiteHeader auth={auth} />
        <main className="grid grid-cols-[minmax(0,1fr)]">
          <Hero auth={auth} />
        </main>
      </div>
      <AuthDrawer
        mode={authMode}
        open={authOpen}
        onOpenChange={setAuthOpen}
        {...(failure ? { failed: failure } : {})}
        onCloseAutoFocus={(event) => {
          if (opener.current) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      />
    </>
  );
}
