import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * shadcn/ui's Button, tuned to the prototype's pill buttons (round 7 `.header-cta`, `.hero-cta`,
 * `.header-signin`). Every size is at least 40px tall so it stays easy to tap on a phone. Heights
 * are minimums and labels may wrap, so enlarged text grows a button instead of overflowing it.
 */
const buttonVariants = cva(
  'inline-flex max-w-full cursor-pointer items-center justify-center gap-1.5 rounded-full text-center font-semibold transition-[translate,background-color] duration-180 ease-settle outline-none hover:-translate-y-px focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-3 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-control',
        outline: 'border border-input bg-secondary text-secondary-foreground',
      },
      size: {
        default: 'min-h-10 px-4 py-2 text-sm/tight',
        lg: 'min-h-12 px-6 py-2.5 text-base/tight',
        /** A round 40px button holding one glyph, such as a dialog's close button. */
        icon: 'size-10 shrink-0 text-[22px] font-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (for example a link) with the button's look instead of a <button>. */
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      // A native button inside a form submits it unless told otherwise; only an explicit
      // type="submit" should do that.
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
