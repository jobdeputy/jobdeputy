import { MAX_DOCUMENTS } from '@jobdeputy/shared/documents';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type Ref, useEffect, useRef, useState } from 'react';
import { AlertIcon, DocumentIcon } from '@/components/icons.tsx';
import { PageIntro } from '@/components/page-intro.tsx';
import { Section } from '@/components/section.tsx';
import { LoadFailed, refusalText, useSaying } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ConfirmSheet } from '@/components/ui/confirm-sheet.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import {
  CHECK_EVERY_MS,
  type Document,
  documentsQuery,
  isUnusable,
  wasUploadedHere,
} from '@/lib/api/documents.ts';
import { ApiError, isFinal, useApi } from '@/lib/api/index.ts';
import { cn } from '@/lib/utils.ts';
import { AddResumes } from './add-resumes.tsx';
import { statusLine } from './document-status.ts';

/**
 * The Résumés page (#33 piece 6b, the round 7 prototype's documents-preview Library): every résumé
 * the person keeps, newest first, with its stage or kind and size, the default marked, and how
 * many of the 10 are used. Delete asks first (the file is deleted for good); deleting the default
 * hands it to the newest ready résumé (the API does, in the same step), and the page says which.
 */
export function ResumesPage({
  checkEvery = CHECK_EVERY_MS,
}: {
  /** How often résumés being checked are asked about (2 s; the tests ask faster). */
  checkEvery?: number;
} = {}) {
  const text = copy.resumesPage;
  const api = useApi();
  const queryClient = useQueryClient();
  const documents = useQuery({
    ...documentsQuery(api),
    retry: (failures, error) =>
      failures < 1 && error instanceof ApiError && error.kind === 'offline',
    // Read again every 2 s while one is known to be on its way to ready (not a `pending` one
    // whose upload started elsewhere: it may never come, and the server forgets it in a day).
    refetchInterval: ({ state }) => (state.data?.some(onItsWay) ? checkEvery : false),
  });
  const { spoken, say } = useSaying();
  const heading = useRef<HTMLHeadingElement>(null);
  // The résumé Delete asked about (kept while the sheet slides away), what deleting it means
  // (set when asked, so it can't change under the person while the list is read again), and
  // whether the sheet is open.
  const [asked, setAsked] = useState<Document | null>(null);
  const [meaning, setMeaning] = useState('');
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where focus goes back to once the sheet closes: the Delete that opened it (named here, since
  // Safari doesn't focus a clicked button), or the library's title once its row is gone.
  const opener = useRef<HTMLElement | null>(null);
  const deleted = useRef(false);

  /** A file is in: it joins the library at the top, and is followed while the server checks it. */
  async function sent(document: Document) {
    const { queryKey } = documentsQuery(api);
    // A read already on its way began before the upload: dropped, so it can't leave the row out.
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<Document[]>(queryKey, (list) =>
      list?.some((each) => each.documentId === document.documentId)
        ? list
        : [document, ...(list ?? [])],
    );
  }

  // Each stage a résumé sent from here reaches is said as it comes (the library's first read
  // is not news).
  const stages = useRef<Map<string, Document['status']> | null>(null);
  useEffect(() => {
    const list = documents.data;
    if (!list) return;
    const before = stages.current;
    stages.current = new Map(list.map((each) => [each.documentId, each.status]));
    if (!before) return;
    // Said in one line: a line said after another in the same moment would cut it off.
    const lines: string[] = [];
    for (const each of list) {
      const was = before.get(each.documentId);
      if (was === undefined || was === each.status || !wasUploadedHere(each.documentId)) continue;
      const name = each.title;
      const said = copy.setUp.resume.said;
      if (each.status === 'processing') lines.push(fill(said.reading, { name }));
      else if (each.status === 'ready') lines.push(fill(said.ready, { name }));
      else if (isUnusable(each)) lines.push(fill(text.upload.said.unusable, { name }));
    }
    if (lines.length) say(lines.join(' '));
  }, [documents.data, say]);

  function ask(document: Document, from: HTMLElement) {
    opener.current = from;
    setAsked(document);
    setMeaning(question(document, documents.data ?? []));
    setError(null);
    setOpen(true);
  }

  async function remove(document: Document) {
    setError(null);
    setDeleting(true);
    try {
      await api.request('DELETE', `/me/documents/${document.documentId}`);
    } catch (failure) {
      // Already gone is what was asked for.
      if (!(failure instanceof ApiError && failure.kind === 'not-found')) {
        setDeleting(false);
        setError(isFinal(failure) ? refusalText(failure) : text.deleteFailed);
        return;
      }
    }
    const { queryKey } = documentsQuery(api);
    // A read already on its way began before the delete: dropped, so it can't bring the row back.
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData<Document[]>(queryKey, (list) =>
      list?.filter((each) => each.documentId !== document.documentId),
    );
    deleted.current = true;
    setDeleting(false);
    setOpen(false);
    const name = document.title;
    if (!document.isDefault) {
      say(fill(text.said.deleted, { name }));
      return;
    }
    // The default went: read the list again for the one the API handed it to.
    // Asked of the API itself, not through the list's query: a file coming in meanwhile cancels
    // the list's reads (see `sent`).
    const { queryKey: key, queryFn } = documentsQuery(api);
    const now = await queryFn().catch(() => undefined);
    if (now) queryClient.setQueryData(key, now);
    const next = now?.find((each) => each.isDefault && each.documentId !== document.documentId);
    say(
      now === undefined
        ? fill(text.said.deleted, { name })
        : next
          ? fill(text.said.newDefault, { name, next: next.title })
          : fill(text.said.noDefault, { name }),
    );
  }

  return (
    <div className="grid w-full max-w-[880px] content-start gap-8">
      <PageIntro id="resumes-title" eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <QueryRegion
        query={documents}
        skeleton={{ kind: 'block', rows: 3 }}
        label={text.loading}
        error={
          <LoadFailed
            error={documents.error}
            message={text.loadFailed}
            retry={text.retry}
            onRetry={() => documents.refetch()}
          />
        }
      >
        {(saved) => (
          <Library saved={saved} headingRef={heading} onDelete={ask} onSent={sent} say={say} />
        )}
      </QueryRegion>
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        eyebrow={text.confirm.eyebrow}
        title={fill(text.confirm.title, { name: asked?.title ?? '' })}
        description={meaning}
        confirm={text.confirm.confirm}
        pendingLabel={text.deleting}
        keep={text.confirm.keep}
        pending={deleting}
        error={error}
        onConfirm={() => asked && remove(asked)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (deleted.current ? heading.current : opener.current)?.focus();
          deleted.current = false;
        }}
      />
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}

/**
 * What deleting it means. For the default, which one takes over is not named here: the API picks
 * the newest ready one as it deletes, and this list may be behind (one being checked elsewhere is
 * not followed); the page says which once it is done.
 */
function question(asked: Document, saved: readonly Document[]): string {
  const text = copy.resumesPage.confirm;
  if (!asked.isDefault) return text.line;
  // Only one that is, or may yet be, ready can take over: not one the server couldn't use, nor
  // an upload started elsewhere (it may never come).
  return saved.some(
    (each) => each.documentId !== asked.documentId && (each.status === 'ready' || onItsWay(each)),
  )
    ? text.handOver
    : text.noHandOver;
}

/** Being checked or read, and known to be: worth asking about again. */
function onItsWay(document: Document): boolean {
  return (
    document.status === 'processing' ||
    (document.status === 'pending' && wasUploadedHere(document.documentId))
  );
}

function Library({
  saved,
  headingRef,
  onDelete,
  onSent,
  say,
}: {
  saved: Document[];
  headingRef: Ref<HTMLHeadingElement>;
  onDelete: (document: Document, from: HTMLElement) => void;
  /** A file added here is in. */
  onSent: (document: Document) => Promise<void>;
  say: (words: string) => void;
}) {
  const text = copy.resumesPage.library;
  return (
    <Section
      id="library"
      icon={<DocumentIcon className="size-[22px]" />}
      title={text.title}
      line={fill(text.line, { max: String(MAX_DOCUMENTS) })}
      headingRef={headingRef}
      aside={<Count count={saved.length} />}
    >
      <div className="mt-6">
        <AddResumes count={saved.length} onSent={onSent} say={say}>
          {saved.length === 0 ? (
            <div className="mx-auto grid max-w-[440px] justify-items-center gap-2 px-[21px] py-[34px] text-center">
              <span
                aria-hidden="true"
                className="mb-1 grid size-[55px] place-items-center rounded-full bg-paper-deep text-ink-soft"
              >
                <DocumentIcon className="size-6" />
              </span>
              <h3 className="m-0 text-[0.9375rem] font-[700]">{text.emptyTitle}</h3>
              <p className="m-0 text-sm text-muted-foreground">{text.emptyLine}</p>
            </div>
          ) : (
            <ul aria-label={text.listName} className="m-0 grid list-none gap-2 p-0">
              {saved.map((document) => (
                <Row key={document.documentId} document={document} onDelete={onDelete} />
              ))}
            </ul>
          )}
        </AddResumes>
      </div>
    </Section>
  );
}

/** How many of the 10 are used: the words, and the prototype's stepped bar (for the eye only). */
function Count({ count }: { count: number }) {
  const text = copy.resumesPage.library;
  return (
    <div className="grid w-[144px] gap-1">
      <p className="m-0 text-xs text-muted-foreground">{text.countName}</p>
      <p className="m-0 text-sm font-[700]">
        {fill(text.count, { count: String(count), max: String(MAX_DOCUMENTS) })}
      </p>
      <span aria-hidden="true" className="mt-1 flex gap-[3px]">
        {Array.from({ length: MAX_DOCUMENTS }, (_, step) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed steps, never reordered.
            key={step}
            className={cn('h-1.5 flex-1 rounded-full bg-paper-deep', step < count && 'bg-green')}
          />
        ))}
      </span>
    </div>
  );
}

function Row({
  document,
  onDelete,
}: {
  document: Document;
  onDelete: (document: Document, from: HTMLElement) => void;
}) {
  const text = copy.resumesPage;
  const unusable = isUnusable(document);
  return (
    <li
      data-state={document.status}
      // On a narrow card the actions go under the name, so a long name keeps its width.
      className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-x-[13px] gap-y-2 rounded-[13px] border border-line bg-surface p-[13px] @md:grid-cols-[34px_minmax(0,1fr)_auto]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-[34px] place-items-center rounded-[11px] bg-paper-deep text-ink-soft',
          document.status === 'ready' && 'bg-green-soft text-green-ink',
          unusable && 'text-danger-ink',
        )}
      >
        {unusable ? <AlertIcon /> : <DocumentIcon />}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[0.9375rem] font-[650] wrap-anywhere">{document.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted-foreground">
          {document.isDefault && (
            <span className="inline-flex min-h-6 items-center rounded-full bg-green-wash px-[9px] text-xs font-[650] whitespace-nowrap text-green-ink">
              {text.library.default}
            </span>
          )}
          <span>{statusLine(document)}</span>
        </span>
        {unusable && document.error && (
          <span className="text-[0.8125rem] text-danger-ink">{document.error}</span>
        )}
      </span>
      <span className="col-start-2 flex flex-wrap items-center gap-2 @md:col-start-auto @md:justify-end">
        <Button
          variant="outline"
          className="text-danger-ink"
          onClick={(event) => onDelete(document, event.currentTarget)}
        >
          {text.delete}
          <span className="sr-only"> {document.title}</span>
        </Button>
      </span>
    </li>
  );
}
