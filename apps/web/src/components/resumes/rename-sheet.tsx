import { MAX_DOCUMENT_TITLE } from '@jobdeputy/shared/documents';
import { type FormEvent, type RefObject, useRef, useState } from 'react';
import { Field } from '@/components/auth/fields.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet.tsx';
import { copy, fill } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

/**
 * Rename a résumé (#33 piece 6b3; the round 7 prototype's `#rename-drawer`): the sign-in sheet
 * from the right, with the name to change, selected, and Save name or Cancel. An empty name is
 * refused here; the page saves the rest (`onSave` gets the trimmed name) and says why a save
 * failed in `error`. While `pending`, the sheet stays open (Escape, a click outside and Cancel
 * wait for the save).
 */
export function RenameSheet({
  open,
  onOpenChange,
  name,
  pending,
  error,
  onSave,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The résumé's name when it opened: what the field starts with. */
  name: string;
  pending: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const text = copy.resumesPage.renameSheet;
  const input = useRef<HTMLInputElement>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <SheetContent
        data-slot="rename-sheet"
        className="grid content-start gap-3 px-[18px] pt-[60px] pb-8 md:px-10 md:pt-16 md:pb-10"
        onOpenAutoFocus={(event) => {
          // The name, selected, so typing replaces it (as the prototype). The form is new each
          // time the sheet opens, so the field already holds the name.
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {text.eyebrow}
        </p>
        <SheetTitle className="m-0 font-display text-[clamp(2rem,9vw,2.5rem)] leading-none font-medium tracking-[-0.05em] text-balance">
          {text.title}
        </SheetTitle>
        <SheetDescription className="m-0 max-w-[390px] text-[0.9375rem] leading-normal text-muted-foreground">
          {text.line}
        </SheetDescription>
        <RenameForm
          inputRef={input}
          name={name}
          pending={pending}
          error={error}
          onSave={onSave}
          onCancel={() => {
            if (!pending) onOpenChange(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

/** The sheet's form: new each time the sheet opens, starting from the résumé's name. */
function RenameForm({
  inputRef,
  name,
  pending,
  error,
  onSave,
  onCancel,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  name: string;
  pending: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const text = copy.resumesPage.renameSheet;
  const [typed, setTyped] = useState(name);
  const [tried, setTried] = useState(false);
  const empty = typed.trim() === '';

  function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setTried(true);
    if (empty) {
      inputRef.current?.focus();
      return;
    }
    onSave(typed.trim());
  }

  return (
    <form noValidate onSubmit={save} className="mt-5 grid gap-5">
      <Field
        ref={inputRef}
        label={text.label}
        hint={fill(text.hint, { max: String(MAX_DOCUMENT_TITLE) })}
        error={tried && empty ? text.empty : null}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        maxLength={MAX_DOCUMENT_TITLE}
        autoComplete="off"
        spellCheck={false}
        readOnly={pending}
      />
      <p role="alert" className={cn('m-0 text-sm font-[650] text-danger-ink', !error && 'sr-only')}>
        {error}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending} pendingLabel={text.saving}>
          {text.save}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-disabled={pending || undefined}
          onClick={onCancel}
        >
          {text.cancel}
        </Button>
      </div>
    </form>
  );
}
