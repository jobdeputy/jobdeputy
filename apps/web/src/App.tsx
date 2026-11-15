import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { SignedIn } from '@/components/auth/signed-in.tsx';
import { type AuthControl, AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';
import { SetUp } from '@/components/setup/set-up.tsx';
import { SignedInLayout } from '@/components/signed-in-layout.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy } from '@/copy/index.ts';
import { useProfile } from '@/lib/api/profile.ts';
import { useAuth } from '@/lib/auth/index.ts';
import { useFinishBoot } from '@/lib/boot-loader.ts';

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
  const settingUp = profile.data === null && !started;
  return (
    <SignedInLayout onSignedOut={signedOut}>
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
        {() =>
          settingUp ? (
            <SetUp email={email} onStart={() => setStarted(true)} />
          ) : (
            <SignedIn email={email} />
          )
        }
      </QueryRegion>
    </SignedInLayout>
  );
}

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
