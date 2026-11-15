import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import { AuthError, useAuth } from '@/lib/auth/index.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/**
 * Where a signed-in person lands until the app's own screens arrive (#14 slice 2): who they are
 * signed in as, and Sign out. Its title takes focus, so the change of page is announced.
 */
export function SignedIn({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const waiting = useDelayedPending(pending);
  const title = useRef<HTMLHeadingElement>(null);
  // Once, on arrival: the change of page is announced, and focus is not pulled back later.
  useEffect(() => {
    title.current?.focus();
  }, []);
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
          ref={title}
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
            if (pending) return;
            setPending(true);
            setFailed(null);
            let signedOut = false;
            try {
              await auth.signOut();
              signedOut = true;
            } catch (error) {
              // Still signed in (the session is still stored): say so, rather than pretend.
              setFailed(copy.auth.errors[error instanceof AuthError ? error.kind : 'unknown']);
            } finally {
              setPending(false);
            }
            if (signedOut) onSignedOut();
          }}
        >
          {text.signOut}
        </Button>
        <p role="status" className="sr-only">
          {pending && waiting ? text.signingOut : ''}
        </p>
        <p
          role="alert"
          className={cn('m-0 text-sm font-[650] text-danger-ink', !failed && 'sr-only')}
        >
          {failed}
        </p>
      </section>
    </main>
  );
}
