import { Dialog as SheetPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * shadcn/ui's Sheet (a Radix dialog), tuned to the prototype's sign-in drawer (round 7
 * `.auth-panel`): it slides in from the right over a dimmed, blurred page. Radix traps focus,
 * closes on Escape or a click outside, hides the page from screen readers, and stops it scrolling.
 * It is pinned to the physical right (not `end`) because its slide keyframes move along x.
 */
const Sheet = SheetPrimitive.Root;
const SheetTitle = SheetPrimitive.Title;
const SheetDescription = SheetPrimitive.Description;
const SheetClose = SheetPrimitive.Close;

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-ink/32 backdrop-blur-[3px] motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 right-0 z-50 h-dvh w-[min(500px,100vw)] overflow-y-auto sm:border-l border-line bg-paper shadow-[-30px_0_80px_color-mix(in_oklab,var(--color-ink)_18%,transparent)] outline-none motion-safe:data-[state=closed]:animate-drawer-out motion-safe:data-[state=open]:animate-drawer-in',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle };
