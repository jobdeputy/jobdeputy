import { type ComponentProps, useId, useState } from 'react';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/** The input's box (the prototype's `.field input`), shared by one-line and multi-line fields. */
const BOX =
  'min-h-13 w-full rounded-[14px] border border-line bg-surface px-[15px] text-[0.9375rem] text-ink shadow-[inset_0_1px_0_var(--color-surface-strong)] outline-none transition-[border-color,box-shadow,background-color] duration-[180ms] placeholder:text-muted-foreground hover:border-line-strong hover:bg-surface-strong focus:border-green focus:bg-white focus:shadow-[0_0_0_4px_var(--color-green-wash)] motion-reduce:transition-none forced-colors:focus:outline-2 forced-colors:focus:outline-solid aria-invalid:border-orange';

/**
 * A form field (round 7 `.field`): its label above, the input, then its hint and, once the form
 * has been tried, its error, both tied to the input (`aria-describedby`); an error also marks it
 * `aria-invalid`. The input is the prototype's: 52px, 14px corners, a green ring on focus, an
 * orange edge when wrong.
 */
export function Field({
  label,
  hint,
  error,
  className,
  children,
  action,
  ...input
}: Omit<ComponentProps<'input'>, 'children'> & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Inside the input's box, at its end (the password toggle). */
  children?: React.ReactNode;
  /** Beside the input, at its end (a button that acts on what was typed, such as Add). */
  action?: React.ReactNode;
}) {
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className}>
      {(tie) => (
        <div className={cn('relative', action && 'flex gap-2')}>
          <input
            {...tie}
            className={cn(BOX, children && 'pe-[67px]', action && 'min-w-0 flex-1')}
            {...input}
          />
          {children}
          {action}
        </div>
      )}
    </FieldFrame>
  );
}

/**
 * What every field shares: its label above, the control, then its hint and, once the form has
 * been tried, its error, both tied to the control (`aria-describedby`); an error also marks it
 * `aria-invalid`. `children` places the control, given the attributes that tie it.
 */
function FieldFrame({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  className?: string | undefined;
  children: (tie: {
    id: string;
    'aria-invalid': true | undefined;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // An error replaces the hint while it shows (it says what the hint would, as a fix).
  const showHint = hint && !error;
  const described = [showHint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-[0.8125rem] font-[680] tracking-[0.01em]">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': described,
      })}
      {showHint && (
        <p id={hintId} className="m-0 text-[0.8125rem] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="m-0 text-[0.8125rem] font-[650] text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** A password field with a show / hide toggle (the prototype's `.password-toggle`). */
export function PasswordField(props: Omit<ComponentProps<typeof Field>, 'type' | 'children'>) {
  const [shown, setShown] = useState(false);
  return (
    <Field {...props} type={shown ? 'text' : 'password'}>
      <button
        type="button"
        aria-label={shown ? copy.auth.hidePassword : copy.auth.showPassword}
        onClick={() => setShown((value) => !value)}
        className="absolute end-2.5 top-1/2 grid min-h-11 min-w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-[11px] px-[7px] text-xs font-[680] text-muted-foreground hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <span aria-hidden="true">{shown ? copy.auth.hide : copy.auth.show}</span>
      </button>
    </Field>
  );
}

/**
 * A multi-line field (several web addresses, one per line), as `Field` is: its label, the box, then
 * its hint or its error, tied to it.
 */
export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...input
}: ComponentProps<'textarea'> & { label: string; hint?: string; error?: string | null }) {
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className}>
      {(tie) => (
        <textarea
          rows={3}
          {...tie}
          className={cn(BOX, 'resize-y py-[13px] leading-normal')}
          {...input}
        />
      )}
    </FieldFrame>
  );
}
