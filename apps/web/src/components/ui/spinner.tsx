import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The small turning ring for short waits: inside a button, beside status text, or in a field
 * (#17). The prototype's `.button-spinner` (round 7): a 2px ring whose head is the full text colour,
 * one turn every 987ms. It takes `currentColor`, so it matches whatever text it sits beside. The
 * track is the text colour at 24% (the alpha of `line-strong`): the prototype's 68% only works as
 * white on ink, so the ink Button sets that itself. It is decorative (`aria-hidden`): the words next to it say
 * what is happening. Reduced motion holds it still. Forced colours drop the head, so the gap still
 * shows where the head would be.
 */
const spinnerVariants = cva(
  'inline-block shrink-0 animate-spinner rounded-full border-2 border-current/24 border-t-current motion-reduce:animate-none forced-colors:border-t-transparent',
  {
    variants: {
      size: {
        /** 15px at the default text size: inside buttons and status text. */
        sm: 'size-3.75',
        /** 21px: beside a heading or in a larger field. */
        md: 'size-5.25',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

function Spinner({
  className,
  size,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & VariantProps<typeof spinnerVariants>) {
  return (
    <span
      data-slot="spinner"
      aria-hidden="true"
      className={cn(spinnerVariants({ size, className }))}
      {...props}
    />
  );
}

export { Spinner };
