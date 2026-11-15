import type * as React from 'react';
import { AuthPanel } from '@/components/auth/auth-panel.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet.tsx';
import { copy } from '@/copy/index.ts';

export type AuthMode = 'sign-in' | 'sign-up';

const DRAWER_ID = 'auth-drawer';

/** What a button that opens the drawer needs: whether it is open, and how to open it. */
export type AuthControl = {
  open: boolean;
  /** `opener` gets focus back on close (Safari and Firefox do not focus a clicked button). */
  openAuth: (mode: AuthMode, opener: HTMLElement) => void;
};

/** A button that opens the drawer in one mode, announced as a dialog trigger. */
export function AuthButton({
  control,
  mode,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  'onClick' | 'asChild' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls'
> & { control: AuthControl; mode: AuthMode }) {
  // Every opener reports the same open state. That is safe: while the drawer is open, Radix
  // hides the rest of the page from assistive technology, so only the closed state is heard.
  return (
    <Button
      {...props}
      aria-haspopup="dialog"
      aria-expanded={control.open}
      aria-controls={control.open ? DRAWER_ID : undefined}
      onClick={(event) => control.openAuth(mode, event.currentTarget)}
    />
  );
}

/**
 * The sign-in / sign-up drawer the landing page opens (round 7 `.auth-panel`): the forms, one step
 * at a time (AuthPanel). Its content mounts afresh each time it opens, so a new opening starts
 * clean, in the mode its button asked for.
 */
export function AuthDrawer({
  mode,
  open,
  onOpenChange,
  onCloseAutoFocus,
  onSignedIn,
}: {
  mode: AuthMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes once the drawer has closed; Radix cannot know which button opened it. */
  onCloseAutoFocus: (event: Event) => void;
  onSignedIn: (email: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        id={DRAWER_ID}
        className="px-[18px] pt-[60px] pb-8 md:px-10 md:pt-16 md:pb-10"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <SheetClose asChild>
          <Button
            variant="outline"
            size="icon"
            className="absolute end-4 top-4"
            aria-label={copy.auth.close}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </SheetClose>
        <AuthPanel start={mode} onSignedIn={onSignedIn} />
      </SheetContent>
    </Sheet>
  );
}
