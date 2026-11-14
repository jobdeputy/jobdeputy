import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { Spinner } from '@/components/ui/spinner.tsx';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/**
 * shadcn/ui's Button, tuned to the prototype's pill buttons (round 7 `.header-cta`, `.hero-cta`,
 * `.header-signin`). Every size is at least 40px tall so it stays easy to tap on a phone. Heights
 * are minimums and labels may wrap, so enlarged text grows a button instead of overflowing it. Each
 * size sets its line height with its text size (`text-sm/tight`, `text-[1.375rem]/none`). A caller
 * overriding the text size gets that size's default line height unless it names one
 * (`text-lg/tight`).
 *
 * `pending` and `success` are the prototype's submit states (round 7 `.is-submitting`,
 * `.is-success`; #17). A pending button ignores presses at once, so work never starts twice, but
 * it shows the spinner and `pendingLabel` only after the shared delay (useDelayedPending). It uses
 * `aria-disabled`, not `disabled`, so focus stays on it. Once the work ends the button takes presses
 * again, even while the spinner finishes its minimum time on screen. The caller announces the change through a
 * status region; a button's own name change is not reliably read out.
 */
const buttonVariants = cva(
  'inline-flex max-w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-center font-semibold transition-[translate,background-color] duration-180 ease-settle outline-none hover:-translate-y-px focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-3 disabled:pointer-events-none disabled:opacity-50 data-pending:cursor-wait data-pending:hover:translate-y-0 data-success:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-control data-pending:bg-ink-soft data-success:inset-ring-2 data-success:inset-ring-green-wash',
        outline: 'border border-input bg-secondary text-secondary-foreground',
      },
      size: {
        default: 'min-h-10 px-4 py-2 text-sm/tight',
        lg: 'min-h-12 px-6 py-2.5 text-base/tight',
        /** A round 40px button holding one glyph, such as a dialog's close button. */
        icon: 'size-10 text-[1.375rem]/none font-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> &
  (
    | {
        /** Render the child element (for example a link) with the button's look instead of a <button>. */
        asChild: true;
        pending?: never;
        pendingLabel?: never;
        success?: never;
        successLabel?: never;
      }
    | {
        asChild?: false;
        /** The button's work is running (pass `mutation.isPending`). */
        pending?: boolean;
        /** What the button says while pending, such as "Signing in…". Defaults to its label. */
        pendingLabel?: React.ReactNode;
        /** The work finished well: a ✓ and `successLabel` show until the caller moves on. */
        success?: boolean;
        successLabel?: React.ReactNode;
      }
  );

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  pending = false,
  pendingLabel,
  success = false,
  successLabel,
  onClick,
  children,
  'aria-disabled': ariaDisabled,
  ...props
}: ButtonProps) {
  const showPending = useDelayedPending(pending);
  // Presses are ignored from the first moment of the work until its success state is gone. Not
  // during the spinner's minimum hold after the work ends: a failed sign-in must take a retry at once.
  const blocked = pending || success;
  const Comp = asChild ? Slot.Root : 'button';

  let content = children;
  if (success) {
    content = (
      <>
        <span
          aria-hidden="true"
          className={variant === 'outline' ? 'text-green-ink' : 'text-green-soft'}
        >
          ✓
        </span>
        {successLabel ?? children}
      </>
    );
  } else if (showPending) {
    content = (
      <>
        {/* On ink, the prototype's track: white at 68% (`on-ink-muted`). */}
        <Spinner
          className={variant === 'outline' ? undefined : 'border-on-ink-muted border-t-current'}
        />
        {pendingLabel ?? children}
      </>
    );
  }

  return (
    <Comp
      data-slot="button"
      // A native button inside a form submits it unless told otherwise; only an explicit
      // type="submit" should do that.
      type={asChild ? type : (type ?? 'button')}
      data-pending={(!success && showPending) || undefined}
      data-success={success || undefined}
      aria-busy={(!success && showPending) || undefined}
      aria-disabled={blocked || ariaDisabled}
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        // Also stops a submit button's form submitting (Enter in a field clicks it too).
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {content}
    </Comp>
  );
}

export { Button, buttonVariants };
