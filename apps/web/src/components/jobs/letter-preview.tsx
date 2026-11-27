import { type CoverLetter, type LetterBlock, letterBlocks } from '@jobdeputy/shared/cover-letter';
import { type ReactNode, useEffect, useState } from 'react';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useCoverLetterFiles } from '@/lib/api/cover-letters.ts';

const text = copy.matchesPage.letter.preview;

/**
 * #51 PR D3: a ready letter in a wide dialog, laid out from the same blocks as its PDF and DOCX
 * (`letterBlocks`), so what is previewed is what is sent. `footer` (Copy text and the downloads)
 * sits under it. As the résumé's preview (resume-preview.tsx).
 */
export function LetterPreviewButton({
  documentId,
  company,
  footer,
}: {
  documentId: string;
  company: string;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // A rewrite that ends while the dialog is open shows its letter here: said inside the dialog
  // (the page behind it is hidden from screen readers while it is open).
  const [shown, setShown] = useState(documentId);
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (documentId === shown) return;
    setShown(documentId);
    setNewer(open);
  }, [documentId, shown, open]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setNewer(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">{text.open}</Button>
      </DialogTrigger>
      <DialogContent>
        <div className="grid gap-5 p-5 sm:p-8">
          <div className="flex flex-wrap-reverse items-start justify-between gap-3">
            <div className="grid gap-1">
              <DialogTitle className="m-0 font-display text-[clamp(1.375rem,3vw,1.75rem)] leading-tight font-medium tracking-[-0.02em]">
                {fill(text.title, { company })}
              </DialogTitle>
              <DialogDescription className="m-0 text-sm text-muted-foreground">
                {text.line}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="outline">{text.close}</Button>
            </DialogClose>
          </div>
          <p role="status" className={newer ? 'm-0 text-sm font-[650] text-green-ink' : 'sr-only'}>
            {newer ? text.newer : ''}
          </p>
          <LetterSheet documentId={documentId} />
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The letter, read for the dialog (the same read Copy text uses). */
function LetterSheet({ documentId }: { documentId: string }) {
  const files = useCoverLetterFiles(documentId);
  return (
    <QueryRegion
      query={files}
      skeleton={{ kind: 'lines', rows: 10 }}
      label={text.loading}
      error={
        <LoadFailed
          error={files.error}
          message={text.loadFailed}
          retry={text.retry}
          onRetry={() => void files.refetch()}
          retrying={files.isFetching}
        />
      }
    >
      {(data) =>
        data.letter ? (
          <LetterPage letter={data.letter} />
        ) : (
          <p className="m-0 text-sm text-ink-soft">{text.unavailable}</p>
        )
      }
    </QueryRegion>
  );
}

/**
 * The template's blocks as a page: the name as its heading, the contact line, the greeting,
 * the body, the sign-off and the name. Text only, as in the files; its words (the greeting,
 * the sign-off) come from `letterBlocks`, the letter's own words, not `en.ts`.
 */
export function LetterPage({ letter }: { letter: CoverLetter }) {
  const blocks = letterBlocks(letter);
  return (
    <article
      aria-label={text.label}
      className="grid gap-4 rounded-[14px] border border-line bg-white p-5 text-[0.9375rem]/[1.6] text-ink shadow-[0_10px_30px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] [overflow-wrap:anywhere] sm:p-10"
    >
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a ready letter's blocks never move.
        <Block key={i} block={block} />
      ))}
    </article>
  );
}

function Block({ block }: { block: LetterBlock }) {
  switch (block.kind) {
    case 'name':
      return <h3 className="m-0 text-[1.625rem] leading-tight font-[700]">{block.text}</h3>;
    case 'line':
      return <p className="m-0 -mt-3 text-sm text-ink-soft">{block.text}</p>;
    case 'greeting':
      return <p className="m-0 mt-4">{block.text}</p>;
    case 'paragraph':
      return <p className="m-0">{block.text}</p>;
    case 'signoff':
      return <p className="m-0 mt-2">{block.text}</p>;
    case 'signature':
      return <p className="m-0 -mt-3 font-[700]">{block.text}</p>;
  }
}
