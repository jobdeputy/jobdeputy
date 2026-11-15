import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { SheetDescription, SheetTitle } from '@/components/ui/sheet.tsx';
import { copy, fill } from '@/copy/index.ts';
import { AuthError, useAuth } from '@/lib/auth/index.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { Field, PasswordField } from './fields.tsx';

/** Where the person is in signing in or up. */
export type AuthStep = 'sign-in' | 'sign-up' | 'confirm' | 'reset' | 'reset-confirm';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;
/** The account pool's rule (infra/lib/constructs/auth.ts): length, not composition. */
const MIN_PASSWORD = 12;

const { auth: text } = copy;

type Errors = Partial<Record<'email' | 'password' | 'confirm' | 'code', string>>;

/** The checks a step runs before it calls the server; the first failing field gets focus. */
function check(step: AuthStep, values: Record<string, string>): Errors {
  const errors: Errors = {};
  const { email = '', password = '', confirm = '', code = '' } = values;
  if (step !== 'confirm' && step !== 'reset-confirm') {
    if (!email.trim()) errors.email = text.errors.emailMissing;
    else if (!EMAIL.test(email.trim())) errors.email = text.errors.emailInvalid;
  }
  if (step === 'sign-in' && !password) errors.password = text.errors.passwordMissing;
  if (step === 'sign-up' || step === 'reset-confirm') {
    if (!password) errors.password = text.errors.passwordMissing;
    else if (password.length < MIN_PASSWORD) errors.password = text.errors.passwordShort;
  }
  if (step === 'reset-confirm' && password && confirm !== password) {
    errors.confirm = text.errors.confirmMismatch;
  }
  if ((step === 'confirm' || step === 'reset-confirm') && !CODE.test(code.trim())) {
    errors.code = text.errors.codeInvalid;
  }
  return errors;
}

/**
 * The drawer's forms (#14 slice 2): sign in, create an account, confirm it with the emailed code,
 * and reset a forgotten password with a code. One step shows at a time, with its own title. A
 * wrong field says so beside itself and takes focus; a refusal from the server shows above the
 * button and is read out. The button shows its pending state (#17). Signing in or confirming a new
 * account ends in `onSignedIn`.
 */
export function AuthPanel({
  start,
  onSignedIn,
}: {
  start: 'sign-in' | 'sign-up';
  onSignedIn: (email: string) => void;
}) {
  const auth = useAuth();
  const [step, setStep] = useState<AuthStep>(start);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Sending a new code: its own wait, so the Confirm button does not claim to be checking.
  const [resending, setResending] = useState(false);
  // The fresh code could not be sent: the code step says to use an earlier one.
  const [noFreshCode, setNoFreshCode] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Said in the status line on the button's timing (nothing for 300 ms), so a screen reader hears
  // the wait too: the button's own label change is not reliably read out.
  const busy = pending || resending;
  const waiting = useDelayedPending(busy);
  const refusalId = useId();

  // A new step starts at its first field.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the step changes, to focus that step's first field.
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [step]);

  const email = (values.email ?? '').trim();
  const go = (next: AuthStep, keep?: Record<string, string>) => {
    setStep(next);
    setValues(keep ?? { email: values.email ?? '' });
    setErrors({});
    setRefusal(null);
    setNotice(null);
    setNoFreshCode(false);
  };

  const bind = (name: keyof Errors | 'email') => ({
    name,
    value: values[name] ?? '',
    error: errors[name as keyof Errors] ?? null,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    // A code already in the inbox can be confirmed while a new one is on its way.
    if (pending) return;
    const found = check(step, values);
    setErrors(found);
    setRefusal(null);
    setNotice(null);
    const first = Object.keys(found)[0];
    if (first) {
      form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    try {
      const { password = '', code = '' } = values;
      if (step === 'sign-in') {
        const next = await auth.signIn(email, password);
        if (next === 'confirm') {
          // The code from sign-up may be long gone: send a fresh one before asking for it. If
          // that fails, still go on (a code may be in the inbox), and say why there.
          const resent = await auth.resendSignUpCode(email).then(
            () => null,
            (error: unknown) => text.errors[error instanceof AuthError ? error.kind : 'unknown'],
          );
          go('confirm', { email, password });
          if (resent) {
            setRefusal(resent);
            setNoFreshCode(true);
          }
        } else onSignedIn(email);
      } else if (step === 'sign-up') {
        await auth.signUp(email, password);
        go('confirm', { email, password });
      } else if (step === 'confirm') {
        await auth.confirmSignUp(email, values.password ?? '', code.trim());
        onSignedIn(email);
      } else if (step === 'reset') {
        await auth.resetPassword(email);
        go('reset-confirm', { email });
      } else {
        await auth.confirmResetPassword(email, code.trim(), password);
        go('sign-in', { email });
        setNotice(text.resetConfirm.done);
      }
    } catch (error) {
      const kind = error instanceof AuthError ? error.kind : 'unknown';
      if (kind === 'confirmed') {
        // Confirmed, but not signed in: the code cannot be used again, so on to sign in.
        go('sign-in', { email });
        setNotice(text.errors.confirmed);
      } else {
        setRefusal(text.errors[kind]);
      }
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    if (busy) return;
    // A request like any other (the links wait for it), with its own words.
    setResending(true);
    setRefusal(null);
    setNotice(null);
    try {
      await auth.resendSignUpCode(email);
      setNoFreshCode(false);
      setNotice(text.confirm.resent);
    } catch (error) {
      setRefusal(text.errors[error instanceof AuthError ? error.kind : 'unknown']);
    } finally {
      setResending(false);
    }
  }

  const intro = {
    'sign-in': text.signIn,
    'sign-up': text.signUp,
    confirm: {
      ...text.confirm,
      subtitle: fill(noFreshCode ? text.confirm.subtitleEarlier : text.confirm.subtitle, { email }),
    },
    reset: text.reset,
    'reset-confirm': {
      ...text.resetConfirm,
      subtitle: fill(text.resetConfirm.subtitle, { email }),
    },
  }[step];
  const action = {
    'sign-in': text.signIn,
    'sign-up': text.signUp,
    confirm: text.confirm,
    reset: text.reset,
    'reset-confirm': text.resetConfirm,
  }[step];
  // The status line, after the shared delay: a submit's wait is only read out (the button shows
  // it); sending a new code is shown too, as nothing else on screen moves. Otherwise, the note.
  const shown = waiting && resending ? text.confirm.resending : notice;
  const status = waiting && pending ? action.pending : shown;

  return (
    <>
      <div className="max-w-[430px]">
        <p className="mb-[7px] flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {intro.kicker}
        </p>
        <SheetTitle className="font-display text-[clamp(2.1875rem,10.5vw,2.625rem)] leading-none font-medium tracking-[-0.05em] text-balance md:text-[clamp(2.5rem,4vw,3.25rem)]">
          {intro.title}
        </SheetTitle>
        <SheetDescription className="mt-1 max-w-[390px] text-[0.9375rem] leading-normal tracking-[-0.01em] text-muted-foreground md:mt-2">
          {intro.subtitle}
        </SheetDescription>
      </div>

      <form
        ref={form}
        noValidate
        onSubmit={submit}
        aria-describedby={refusal ? refusalId : undefined}
        className="mt-7 grid max-w-[430px] gap-4"
      >
        {(step === 'sign-in' || step === 'sign-up' || step === 'reset') && (
          <Field
            label={text.email}
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            {...bind('email')}
          />
        )}
        {(step === 'confirm' || step === 'reset-confirm') && (
          <Field
            label={text.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            {...bind('code')}
          />
        )}
        {(step === 'sign-in' || step === 'sign-up' || step === 'reset-confirm') && (
          <PasswordField
            label={step === 'reset-confirm' ? text.newPassword : text.password}
            autoComplete={step === 'sign-in' ? 'current-password' : 'new-password'}
            {...(step === 'sign-in' ? {} : { hint: text.passwordRule })}
            {...bind('password')}
          />
        )}
        {step === 'reset-confirm' && (
          <PasswordField
            label={text.confirmPassword}
            autoComplete="new-password"
            {...bind('confirm')}
          />
        )}

        {/* Live regions stay in the accessibility tree when empty (visually hidden, never
            display:none), so their first words are read. */}
        <p role="status" className={cn('m-0 text-sm text-green-ink', !shown && 'sr-only')}>
          {status}
        </p>
        <p
          id={refusalId}
          role="alert"
          className={cn('m-0 text-sm font-[650] text-danger-ink', !refusal && 'sr-only')}
        >
          {refusal}
        </p>

        <Button type="submit" size="lg" pending={pending} pendingLabel={action.pending}>
          {action.submit}
        </Button>

        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm">
          {step === 'sign-in' && (
            <>
              <LinkButton off={busy} onClick={() => go('reset')}>
                {text.signIn.forgot}
              </LinkButton>
              <LinkButton off={busy} onClick={() => go('sign-up')}>
                {text.signIn.switch}
              </LinkButton>
            </>
          )}
          {step === 'sign-up' && (
            <LinkButton off={busy} onClick={() => go('sign-in')}>
              {text.signUp.switch}
            </LinkButton>
          )}
          {step === 'confirm' && (
            <LinkButton off={busy} onClick={resend}>
              {text.confirm.resend}
            </LinkButton>
          )}
          {(step === 'confirm' || step === 'reset' || step === 'reset-confirm') && (
            <LinkButton off={busy} onClick={() => go('sign-in')}>
              {text.backToSignIn}
            </LinkButton>
          )}
        </div>
      </form>
    </>
  );
}

/**
 * A quiet text button that moves between steps (it changes the form, so it is a button). Off while
 * a request runs, so a late answer cannot land on another step; it keeps its focus (aria-disabled).
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
