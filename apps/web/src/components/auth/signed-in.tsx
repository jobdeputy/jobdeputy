import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useAuth } from '@/lib/auth/index.ts';

/**
 * Where a signed-in person lands until the app's own screens arrive (#14 slice 2): who they are
 * signed in as, and Sign out. Its title takes focus, so the change of page is announced.
 */
export function SignedIn({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const { signedIn: text } = copy;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[21px]">
      <section aria-labelledby="signed-in-title" className="grid max-w-[480px] gap-3">
        <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {text.kicker}
        </p>
        <h1
          id="signed-in-title"
          tabIndex={-1}
          ref={(heading) => heading?.focus()}
          className="m-0 font-display text-[clamp(2.5rem,9vw,3.25rem)] leading-none font-medium tracking-[-0.05em] outline-none"
        >
          {text.title}
        </h1>
        <p className="m-0 text-[0.9375rem] text-muted-foreground">{fill(text.body, { email })}</p>
        <Button
          variant="outline"
          className="mt-2 justify-self-start"
          pending={pending}
          pendingLabel={text.signingOut}
          onClick={async () => {
            setPending(true);
            try {
              await auth.signOut();
            } finally {
              setPending(false);
              onSignedOut();
            }
          }}
        >
          {text.signOut}
        </Button>
      </section>
    </main>
  );
}
