import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SignOutButton } from '@/components/auth/sign-out-button.tsx';
import { SignedIn } from '@/components/auth/signed-in.tsx';
import { type AuthControl, AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';
import { SetUp } from '@/components/setup/set-up.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useProfile } from '@/lib/api/profile.ts';
import { useAuth } from '@/lib/auth/index.ts';
import { useFinishBoot } from '@/lib/boot-loader.ts';
import { useDelayedPending, useLongWait } from '@/lib/use-delayed-pending.ts';

/**
 * The app: the public landing page (the story of what the deputy does, and the way in), or, for a
 * signed-in person, their page. The boot ends once it knows which.
 */
export function App() {
  const session = useAuth();
  // undefined: not known yet; null: nobody signed in.
  const [user, setUser] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    session.currentUser().then((email) => {
      if (current) setUser(email);
    });
    return () => {
      current = false;
    };
  }, [session]);
  useFinishBoot(user !== undefined);

  if (user === undefined) return null;
  if (user) return <SignedInApp email={user} onSignedOut={() => setUser(null)} />;
  return <Landing onSignedIn={setUser} />;
}

/**
 * A signed-in person's app: their profile decides where they start. No profile yet (a new account)
 * starts the guided set-up (#33); otherwise their page. Signing out forgets everything the app
 * loaded for them, so the next person in this tab starts clean.
 */
function SignedInApp({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const profile = useProfile();
  const queryClient = useQueryClient();
  const [started, setStarted] = useState(false);
  // The shared timing (#17): nothing for 300 ms, then shown at least 500 ms.
  const loadingShown = useDelayedPending(profile.isPending);
  const signedOut = () => {
    queryClient.clear();
    onSignedOut();
  };
  if (profile.isPending || loadingShown) {
    return <ProfileLoading shown={loadingShown} paused={profile.isPaused} />;
  }
  // Only with nothing loaded: a failed refresh of a profile on screen keeps the page.
  if (profile.data === undefined) {
    return (
      <ProfileFailed
        retrying={profile.isFetching}
        onRetry={() => profile.refetch()}
        onSignedOut={signedOut}
      />
    );
  }
  if (profile.data === null && !started) {
    return <SetUp email={email} onStart={() => setStarted(true)} onSignedOut={signedOut} />;
  }
  return <SignedIn email={email} onSignedOut={signedOut} />;
}

/**
 * While the profile loads: once `shown`, a quiet turning ring and what is opening, read out
 * through a status line that is there from the start (a live region's first words are not read);
 * after 8 s "Still working…" is added, and while the browser is offline it says it is waiting.
 */
function ProfileLoading({ shown, paused }: { shown: boolean; paused: boolean }) {
  const long = useLongWait(shown && !paused);
  const text = copy.profile;
  const said = paused
    ? text.offline
    : long
      ? fill(copy.loading.stillLoading, { label: text.loading })
      : text.loading;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[21px]">
      <p role="status" className="m-0 inline-flex items-center gap-2 text-sm text-muted-foreground">
        {shown && <Spinner />}
        {shown ? said : ''}
      </p>
    </main>
  );
}

/**
 * The profile could not be read: say so, and offer to try again or sign out (an account that can
 * no longer be read must not trap its person here). The title takes focus on arrival; the reason
 * is an alert, emptied while a retry runs so a second failure is read out again.
 */
function ProfileFailed({
  retrying,
  onRetry,
  onSignedOut,
}: {
  retrying: boolean;
  onRetry: () => void;
  onSignedOut: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[21px]">
      <section
        aria-labelledby="profile-failed-title"
        className="grid max-w-[480px] justify-items-start gap-3"
      >
        <h1
          id="profile-failed-title"
          tabIndex={-1}
          ref={title}
          className="m-0 font-display text-[clamp(1.75rem,6vw,2.25rem)] leading-tight font-medium tracking-[-0.03em] outline-none"
        >
          {copy.profile.failed}
        </h1>
        <p role="alert" className="m-0 text-[0.9375rem] text-muted-foreground">
          {retrying ? '' : copy.profile.failedReason}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button pending={retrying} pendingLabel={copy.profile.retrying} onClick={onRetry}>
            {copy.profile.retry}
          </Button>
          <SignOutButton onSignedOut={onSignedOut} messageClassName="basis-full" />
        </div>
      </section>
    </main>
  );
}

/** The public landing page: the story of what the deputy does, and the way in (sign up or sign in). */
function Landing({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [authMode, setAuthMode] = useState<AuthMode>('sign-up');
  const [authOpen, setAuthOpen] = useState(false);
  // Four buttons open the drawer; focus returns to whichever one did.
  const opener = useRef<HTMLElement | null>(null);

  const auth: AuthControl = {
    open: authOpen,
    openAuth(mode, button) {
      opener.current = button;
      setAuthMode(mode);
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
        onSignedIn={onSignedIn}
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
