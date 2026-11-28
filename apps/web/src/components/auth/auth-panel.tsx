import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet.tsx';
import { copy } from '@/copy/index.ts';
import {
  AuthError,
  type AuthErrorKind,
  rememberSignInMode,
  type SignInMode,
  useAuth,
} from '@/lib/auth/index.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

const { auth: text } = copy;

/**
 * The drawer's way in (#14, #111): one button that leaves for the secure
 * sign-in page (Cognito managed login, shared with the extension), where people sign in, create
 * an account, confirm it and reset a password, with a note under it saying so. A link switches
 * between signing in and creating an
 * account. The button shows its pending state (#17) until the page has gone; a failure to leave,
 * or a sign-in that came back unfinished (`failed`), shows above the button and is read out.
 */
export function AuthPanel({
  start,
  failed,
}: {
  start: SignInMode;
  /** Why the last sign-in did not finish, when the drawer opens for that. */
  failed?: AuthErrorKind;
}) {
  const auth = useAuth();
  const [mode, setMode] = useState<SignInMode>(start);
  const [refusal, setRefusal] = useState<string | null>(failed ? text.errors[failed] : null);
  const [pending, setPending] = useState(false);
  const waiting = useDelayedPending(pending);
  const noteId = useId();
  const action = mode === 'sign-in' ? text.signIn : text.signUp;

  // Back from the sign-in page with the browser's back button, this page may come back as it was
  // (the back-forward cache): the button is ready again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);

  const leave = async () => {
    if (pending) return;
    setPending(true);
    setRefusal(null);
    try {
      // On success the browser leaves: the button stays pending until it has.
      rememberSignInMode(mode);
      await auth.signIn(mode);
    } catch (error) {
      setRefusal(text.errors[error instanceof AuthError ? error.kind : 'unknown']);
      setPending(false);
    }
  };

  return (
    <>
      <div className="max-w-[430px]">
        <p className="mb-[7px] flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {action.kicker}
        </p>
        <SheetTitle className="font-display text-[clamp(2.1875rem,10.5vw,2.625rem)] leading-none font-medium tracking-[-0.05em] text-balance md:text-[clamp(2.5rem,4vw,3.25rem)]">
          {action.title}
        </SheetTitle>
        <SheetDescription className="mt-1 max-w-[390px] text-[0.9375rem] leading-normal tracking-[-0.01em] text-muted-foreground md:mt-2">
          {action.subtitle}
        </SheetDescription>
      </div>

      <div className="mt-7 grid max-w-[430px] gap-4">
        {/* Live regions stay in the accessibility tree when empty (visually hidden, never
            display:none), so their first words are read. */}
        <p role="status" className="sr-only">
          {pending && waiting ? action.pending : ''}
        </p>
        <p
          role="alert"
          className={cn('m-0 text-sm font-[650] text-danger-ink', !refusal && 'sr-only')}
        >
          {refusal}
        </p>

        <div className="grid gap-2">
          <Button
            size="lg"
            pending={pending}
            pendingLabel={action.pending}
            onClick={leave}
            aria-describedby={noteId}
          >
            {action.submit}
          </Button>
          <p id={noteId} className="m-0 text-[0.8125rem] leading-normal text-muted-foreground">
            {action.note}
          </p>
        </div>

        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm">
          <LinkButton
            off={pending}
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setRefusal(null);
            }}
          >
            {action.switch}
          </LinkButton>
        </div>
      </div>
    </>
  );
}

/**
 * A quiet text button that switches between signing in and creating an account (it changes the
 * drawer, so it is a button). Off while the page is leaving; it keeps its focus (aria-disabled).
 */
function LinkButton({
  onClick,
  off = false,
  children,
}: {
  onClick: () => void;
  off?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-disabled={off || undefined}
      onClick={() => {
        if (!off) onClick();
      }}
      className="cursor-pointer rounded-xs font-[650] text-green-ink underline underline-offset-2 hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring focus-visible:outline-solid"
    >
      {children}
    </button>
  );
}
