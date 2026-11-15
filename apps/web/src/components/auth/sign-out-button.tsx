import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { AuthError, useAuth } from '@/lib/auth/index.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/**
 * Sign out, with its wait read out (after the shared 300 ms) and its failure said: a sign-out that
 * fails leaves the session stored, so the person is still signed in and is told so. `onSignedOut`
 * runs only once it worked. The failure line sits under the button (`messageClassName` places it).
 */
export function SignOutButton({
  onSignedOut,
  className,
  messageClassName,
}: {
  onSignedOut: () => void;
  className?: string;
  messageClassName?: string;
}) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const waiting = useDelayedPending(pending);
  const text = copy.signedIn;
  return (
    <>
      <Button
        variant="outline"
        className={className}
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
        className={cn(
          'm-0 text-sm font-[650] text-danger-ink',
          !failed && 'sr-only',
          messageClassName,
        )}
      >
        {failed}
      </p>
    </>
  );
}
