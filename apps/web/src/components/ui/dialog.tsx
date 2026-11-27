import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { SHEET_OVERLAY } from '@/components/ui/sheet.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * shadcn/ui's Dialog (a Radix dialog), centred over the same dimmed, blurred page as the Sheet:
 * for content wider than the sheet's 500px, such as a résumé's preview (#51). Radix traps focus,
 * closes on Escape or a click outside, hides the page from screen readers, and stops it
 * scrolling. On a phone it fills the screen; wider, it is a panel at most `max-w` wide, which
 * scrolls on its own when taller than the window.
 */
const Dialog = DialogPrimitive.Root;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;
const DialogClose = DialogPrimitive.Close;
/** Opens the dialog; the focus comes back to it when the dialog closes. */
const DialogTrigger = DialogPrimitive.Trigger;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className={SHEET_OVERLAY} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed inset-0 z-50 overflow-y-auto bg-paper outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-3rem)] sm:w-[min(52rem,calc(100vw-3rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border sm:border-line sm:shadow-[0_30px_80px_color-mix(in_oklab,var(--color-ink)_18%,transparent)] motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
