import { Button } from '@/components/ui/button.tsx';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet.tsx';
import { copy } from '@/copy/index.ts';

export type AuthMode = 'sign-in' | 'sign-up';

const intro = { 'sign-in': copy.auth.signIn, 'sign-up': copy.auth.signUp } as const;

/**
 * The sign-in / sign-up drawer the landing page opens (round 7 `.auth-panel`). The forms come
 * next (#14); this holds the frame and each mode's introduction.
 */
export function AuthDrawer({
  mode,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  mode: AuthMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes once the drawer has closed; Radix cannot know which button opened it. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  const text = intro[mode];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
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
        <div className="max-w-[430px]">
          <p className="mb-[7px] flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
            {text.kicker}
          </p>
          <SheetTitle className="font-display text-[clamp(35px,10.5vw,42px)] leading-none font-medium tracking-[-0.05em] text-balance md:text-[clamp(40px,4vw,52px)]">
            {text.title}
          </SheetTitle>
          <SheetDescription className="mt-1 max-w-[390px] text-[15px] leading-normal tracking-[-0.01em] text-muted-foreground md:mt-2">
            {text.subtitle}
          </SheetDescription>
        </div>
      </SheetContent>
    </Sheet>
  );
}
