import { useRef, useState } from 'react';
import { AuthDrawer, type AuthMode } from '@/components/landing/auth-drawer.tsx';
import { Hero } from '@/components/landing/hero.tsx';
import { SiteHeader } from '@/components/landing/site-header.tsx';

/** The public landing page: the story of what the deputy does, and the way in (sign up or sign in). */
export function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('sign-up');
  const [authOpen, setAuthOpen] = useState(false);
  // Four buttons open the drawer; focus returns to whichever one did.
  const opener = useRef<HTMLElement | null>(null);

  function openAuth(mode: AuthMode) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAuthMode(mode);
    setAuthOpen(true);
  }

  return (
    <>
      <SiteHeader onOpenAuth={openAuth} />
      <main>
        <Hero onOpenAuth={openAuth} />
      </main>
      <AuthDrawer
        mode={authMode}
        open={authOpen}
        onOpenChange={setAuthOpen}
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
