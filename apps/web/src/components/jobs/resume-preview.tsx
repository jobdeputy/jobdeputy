import { type ResumeBlock, resumeBlocks, type StructuredResume } from '@jobdeputy/shared/resume';
import { useQuery } from '@tanstack/react-query';
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
import { ApiError, useApi } from '@/lib/api/index.ts';
import { type Tailoring, tailoringFiles } from '@/lib/api/tailorings.ts';

const text = copy.matchesPage.tailor.preview;

/**
 * #51 PR C2 (agreed on #51): a ready version's résumé in a wide dialog, laid out from the same
 * blocks as its PDF and DOCX (`resumeBlocks`, decision 0015), so what is previewed is what is
 * sent. The résumé is read when the dialog opens; `footer` (the downloads) sits under it.
 */
export function ResumePreviewButton({
  version,
  company,
  footer,
}: {
  version: Tailoring;
  company: string;
  footer: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // A re-tailor that ends while the dialog is open shows its version here: said inside the
  // dialog (the page behind it is hidden from screen readers while it is open).
  const [shown, setShown] = useState(version.documentId);
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (version.documentId === shown) return;
    setShown(version.documentId);
    setNewer(open);
  }, [version.documentId, shown, open]);
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
          {/* Radix keeps the content mounted while it fades out: the résumé stays with it. */}
          <ResumeSheet documentId={version.documentId} />
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The résumé, read for the dialog: a white page in the template's single column. */
function ResumeSheet({ documentId }: { documentId: string }) {
  const api = useApi();
  const files = useQuery({
    queryKey: ['tailorings', 'resume', documentId],
    queryFn: () => tailoringFiles(api, documentId),
    // A ready version never changes: once read, it is kept while the page is open.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
  });
  return (
    <QueryRegion
      query={files}
      skeleton={{ kind: 'lines', rows: 12 }}
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
        data.resume ? (
          <ResumePage resume={data.resume} />
        ) : (
          // Not expected (a ready version always has its résumé): said, without a retry that
          // would read the same answer.
          <p className="m-0 text-sm text-ink-soft">{text.unavailable}</p>
        )
      }
    </QueryRegion>
  );
}

/**
 * The template's blocks as a page: the name as its heading, then each section's heading and
 * entries. Text only (never markup), as in the files. Its words (the section headings, the
 * fallback name, the separators) come from `resumeBlocks`, not `en.ts`: they are the résumé's
 * own words, the same as in the PDF and DOCX it previews.
 */
export function ResumePage({ resume }: { resume: StructuredResume }) {
  const sections = grouped(resumeBlocks(resume));
  return (
    <article
      aria-label={text.label}
      className="grid gap-5 rounded-[14px] border border-line bg-white p-5 text-[0.9375rem]/[1.5] text-ink shadow-[0_10px_30px_color-mix(in_oklab,var(--color-ink)_6%,transparent)] [overflow-wrap:anywhere] sm:p-10"
    >
      {sections.map((section, at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the sections never move.
        <Section key={at} blocks={section} />
      ))}
    </article>
  );
}

/** The blocks cut into the head (name, lines) and one group a section heading. */
function grouped(blocks: ResumeBlock[]): ResumeBlock[][] {
  const groups: ResumeBlock[][] = [[]];
  for (const block of blocks) {
    if (block.kind === 'heading') groups.push([]);
    groups.at(-1)?.push(block);
  }
  return groups.filter((g) => g.length > 0);
}

function Section({ blocks }: { blocks: ResumeBlock[] }) {
  const items: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    items.push(
      <ul key={`b${items.length}`} className="m-0 grid list-disc gap-1 pl-5">
        {bullets.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bullets never move.
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  blocks.forEach((block, i) => {
    if (block.kind === 'bullet') {
      bullets.push(block.text);
      return;
    }
    flush();
    // biome-ignore lint/suspicious/noArrayIndexKey: a ready résumé's blocks never move.
    items.push(<Block key={i} block={block} />);
  });
  flush();
  return <section className="grid gap-1.5">{items}</section>;
}

function Block({ block }: { block: Exclude<ResumeBlock, { kind: 'bullet' }> }) {
  switch (block.kind) {
    case 'name':
      return <h3 className="m-0 text-[1.625rem] leading-tight font-[700]">{block.text}</h3>;
    case 'line':
      return <p className="m-0 text-sm text-ink-soft">{block.text}</p>;
    case 'heading':
      return (
        <h4 className="m-0 border-b border-line pb-1 text-xs font-[750] tracking-[0.12em] uppercase">
          {block.text}
        </h4>
      );
    case 'entry':
      return <p className="m-0 mt-2 font-[700]">{block.text}</p>;
    case 'meta':
      return <p className="m-0 text-sm text-muted-foreground">{block.text}</p>;
    case 'paragraph':
      return <p className="m-0">{block.text}</p>;
    case 'skills':
      return (
        <p className="m-0">
          <span className="font-[700]">{block.group}:</span> {block.items}
        </p>
      );
  }
}
