import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SignedIn } from '@/components/auth/signed-in.tsx';
import { type AuthControl, AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';
import { SetUp } from '@/components/setup/set-up.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy } from '@/copy/index.ts';
import { useProfile } from '@/lib/api/profile.ts';
import { useAuth } from '@/lib/auth/index.ts';
import { useFinishBoot } from '@/lib/boot-loader.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

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
  const signedOut = () => {
    queryClient.clear();
    onSignedOut();
  };
  if (profile.isPending) return <ProfileLoading />;
  if (profile.isError) return <ProfileFailed onRetry={() => profile.refetch()} />;
  if (profile.data === null && !started) {
    return <SetUp email={email} onStart={() => setStarted(true)} onSignedOut={signedOut} />;
  }
  return <SignedIn email={email} onSignedOut={signedOut} />;
}

/** While the profile loads: nothing for 300 ms, then a quiet turning ring and what is opening. */
function ProfileLoading() {
  const shown = useDelayedPending(true);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[21px]">
      <p
        role="status"
        className={cn(
          'm-0 inline-flex items-center gap-2 text-sm text-muted-foreground',
          !shown && 'invisible',
        )}
      >
        {shown && <Spinner />}
        {shown ? copy.profile.loading : ''}
      </p>
    </main>
  );
}

/** The profile could not be read: say so, and offer to try again. */
function ProfileFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[21px]">
      <section role="alert" className="grid justify-items-start gap-3">
        <h1 className="m-0 font-display text-[clamp(1.75rem,6vw,2.25rem)] leading-tight font-medium tracking-[-0.03em]">
          {copy.profile.failed}
        </h1>
        <Button variant="outline" onClick={onRetry}>
          {copy.profile.retry}
        </Button>
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
