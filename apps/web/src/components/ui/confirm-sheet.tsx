import { AlertDialog } from 'radix-ui';
import { Button } from '@/components/ui/button.tsx';
import { SHEET_OVERLAY, SHEET_PANEL } from '@/components/ui/sheet.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * A question to answer before something that can't be undone (#33: deleting a résumé), in the
 * prototype's drawer (round 7 `.drawer`, as its Delete your account): the same sheet as sign-in,
 * from the right, but a Radix alert dialog, so it is read out as one and a click outside doesn't
 * dismiss it. The safe answer (`keep`) takes focus when it opens. While `pending`, the question
 * stays open (Escape and Keep do nothing) until the change has gone through or failed; `error`
 * says why it failed, inside the sheet.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  confirm,
  pendingLabel,
  keep,
  pending,
  error,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  description: string;
  confirm: string;
  pendingLabel: string;
  keep: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  /** Where focus goes once it has closed (Radix's default: back where it was). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={SHEET_OVERLAY} />
        <AlertDialog.Content
          data-slot="confirm-sheet"
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            SHEET_PANEL,
            'grid content-start gap-3 px-[18px] pt-[60px] pb-8 md:px-10 md:pt-16 md:pb-10',
          )}
        >
          <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
            {eyebrow}
          </p>
          <AlertDialog.Title className="m-0 font-display text-[clamp(2rem,9vw,2.5rem)] leading-none font-medium tracking-[-0.05em] text-balance wrap-anywhere">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 max-w-[390px] text-[0.9375rem] leading-normal text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <p
            role="alert"
            className={cn('m-0 text-sm font-[650] text-danger-ink', !error && 'sr-only')}
          >
            {error}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button pending={pending} pendingLabel={pendingLabel} onClick={onConfirm}>
              {confirm}
            </Button>
            <AlertDialog.Cancel asChild>
              <Button variant="outline" aria-disabled={pending || undefined}>
                {keep}
              </Button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
