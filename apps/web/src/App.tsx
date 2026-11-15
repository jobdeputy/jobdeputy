import { useEffect, useRef, useState } from 'react';
import { SignedIn } from '@/components/auth/signed-in.tsx';
import { type AuthControl, AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';
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
  if (user) return <SignedIn email={user} onSignedOut={() => setUser(null)} />;
  return <Landing onSignedIn={setUser} />;
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
