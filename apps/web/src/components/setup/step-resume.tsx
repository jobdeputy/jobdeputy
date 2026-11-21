import { MAX_DOCUMENTS } from '@jobdeputy/shared/documents';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import {
  ACCEPT,
  checkFile,
  type Document,
  isChecking,
  markUploadedHere,
  type StartedUpload,
  startingDocument,
  useDocument,
  useDocuments,
} from '@/lib/api/documents.ts';
import { ApiError, isFinal, useApi } from '@/lib/api/index.ts';
import { useLongWait } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { LoadFailed, refusalText, StepIntro, useSaying } from './parts.tsx';

/** What the deputy beside the step shows: at rest, at work on the file, or pleased with it. */
export type ResumeMood = 'idle' | 'working' | 'ready';

/**
 * Set it up, step 3 (#33): the résumé, optional. A PDF or DOCX file is dropped or chosen, checked
 * here first (type, size, name), then started with the API (`POST /me/documents`), sent to the
 * presigned form with its progress shown, and followed while the server checks it for malware and
 * reads its text, until it is ready (or not, with the server's reason). The step holds one résumé:
 * to change it, remove it first (more are managed on the Profile page). Continue is offered once a
 * file is in (the server's check carries on if the person moves on); until then, Skip for now.
 */
export function StepResume({
  onDone,
  onBack,
  onMood,
  checkEvery,
}: {
  onDone: () => void;
  onBack: () => void;
  onMood: (mood: ResumeMood) => void;
  /** How often a résumé being checked is asked about (2 s; the tests ask faster). */
  checkEvery?: number;
}) {
  const text = copy.setUp.resume;
  const documents = useDocuments();
  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <QueryRegion
        query={documents}
        skeleton={{ kind: 'block', rows: 2 }}
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
          <ResumeForm
            saved={saved}
            onDone={onDone}
            onBack={onBack}
            onMood={onMood}
            checkEvery={checkEvery}
          />
        )}
      </QueryRegion>
    </>
  );
}

/** What the step holds: nothing yet, a file on its way up, or a résumé the API has. */
type Held =
  | { kind: 'none' }
  | { kind: 'uploading'; name: string; progress: number }
  | { kind: 'document'; document: Document };

function ResumeForm({
  saved,
  onDone,
  onBack,
  onMood,
  checkEvery,
}: {
  /** The person's résumés, newest first; the step starts from `startingDocument`'s pick. */
  saved: Document[];
  onDone: () => void;
  onBack: () => void;
  onMood: (mood: ResumeMood) => void;
  checkEvery: number | undefined;
}) {
  const text = copy.setUp.resume;
  const api = useApi();
  const queries = useQueryClient();
  const [held, setHeld] = useState<Held>(() => {
    const document = startingDocument(saved);
    return document ? { kind: 'document', document } : { kind: 'none' };
  });
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { spoken, say, hush } = useSaying();
  const picker = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // The step went back to choosing a file and focus moves to its button once it is there (always
  // after the person's own Cancel or Remove; after a removal elsewhere, only if it was on the résumé).
  const refocus = useRef(false);
  const choose = useRef<HTMLButtonElement>(null);
  // The upload under way, stopped by Cancel or by leaving the step.
  const sending = useRef<AbortController | null>(null);
  // An upload or removal that ends after the person has left must not touch anything.
  const here = useRef(true);
  useEffect(() => {
    // Set on every mount: React's development check mounts, unmounts and mounts again.
    here.current = true;
    return () => {
      here.current = false;
      sending.current?.abort();
    };
  }, []);

  // A file dropped beside the zone would be opened by the browser, leaving the app: anywhere else
  // on the page, a drop does nothing.
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      // The zone takes its own drops.
      if (zone.current?.contains(event.target as Node | null)) return;
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      // Shown as not allowed here (the zone takes it), rather than seeming to take it.
      event.dataTransfer.dropEffect = 'none';
    };
    globalThis.document.addEventListener('dragover', refuse);
    globalThis.document.addEventListener('drop', refuse);
    return () => {
      globalThis.document.removeEventListener('dragover', refuse);
      globalThis.document.removeEventListener('drop', refuse);
    };
  }, []);

  /** Shows why something didn't work; a line still to be said no longer holds. */
  function fail(reason: string) {
    hush();
    setError(reason);
  }

  const polled = useDocument(held.kind === 'document' ? held.document : null, checkEvery);
  const document = held.kind === 'document' ? (polled.data ?? held.document) : null;
  const checking = document !== null && isChecking(document);
  const unusable = document?.status === 'rejected' || document?.status === 'failed';
  // The polling stopped because asking again can't help.
  const pollEnded = isFinal(polled.error) ? refusalText(polled.error) : null;
  const long = useLongWait(checking);

  const mood: ResumeMood =
    held.kind === 'uploading' || checking
      ? 'working'
      : document?.status === 'ready'
        ? 'ready'
        : 'idle';
  useEffect(() => onMood(mood), [mood, onMood]);

  // Each stage the server's check reaches is said as it comes (a file already done when the step
  // opened is not news). A failure is said by the alert below the list.
  const lastStatus = useRef(document?.status);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = document?.status;
    if (!document || before === document.status || before === undefined) return;
    const name = document.fileName;
    if (document.status === 'processing') say(fill(text.said.reading, { name }));
    if (document.status === 'ready') say(fill(text.said.ready, { name }));
  }, [document, say, text]);

  /** Puts the step back to choosing a file; focus goes to its button once it is back (`focus`). */
  const startOver = useCallback((focus = true) => {
    refocus.current = focus;
    setHeld({ kind: 'none' });
  }, []);
  useEffect(() => {
    if (held.kind !== 'none' || !refocus.current) return;
    refocus.current = false;
    choose.current?.focus();
  }, [held]);

  /** The résumé is gone (removed here, or elsewhere): forgotten, the step starts over, and says so. */
  const cleared = useCallback(
    (document: Document, focus: boolean) => {
      forget(queries, document.documentId);
      setError(null);
      setRemoving(false);
      startOver(focus);
      say(fill(text.said.removed, { name: document.fileName }));
    },
    [queries, say, startOver, text],
  );

  // Removed somewhere else while being followed here (a Remove under way here settles it itself).
  const gone = polled.error instanceof ApiError && polled.error.kind === 'not-found';
  useEffect(() => {
    if (!gone || removing || held.kind !== 'document') return;
    cleared(held.document, list.current?.contains(globalThis.document.activeElement) ?? false);
  }, [gone, removing, held, cleared]);

  async function add(file: File) {
    setError(null);
    const checked = checkFile(file);
    if (!checked.ok) {
      fail(fill(PICK_REFUSALS[checked.reason], { name: file.name }));
      return;
    }
    const name = checked.input.fileName;
    const controller = new AbortController();
    sending.current = controller;
    setHeld({ kind: 'uploading', name, progress: 0 });
    say(fill(text.said.uploading, { name }));
    let started: StartedUpload | undefined;
    try {
      started = await api.request<StartedUpload>('POST', '/me/documents', checked.input);
      if (controller.signal.aborted) throw controller.signal.reason;
      await api.upload(started.upload, file, {
        signal: controller.signal,
        onProgress: (fraction) => {
          if (here.current) {
            setHeld((now) => (now.kind === 'uploading' ? { ...now, progress: fraction } : now));
          }
        },
      });
    } catch (failure) {
      sending.current = null;
      // Started but never finished: it would wait a day as an upload that never came, so it goes.
      if (started) {
        const { documentId } = started.document;
        api.request('DELETE', `/me/documents/${documentId}`).catch(() => undefined);
      }
      if (!here.current) return;
      if (controller.signal.aborted) {
        startOver();
        say(fill(text.said.cancelled, { name }));
        return;
      }
      fail(uploadRefusal(failure, started === undefined));
      startOver();
      return;
    }
    sending.current = null;
    if (!here.current) return;
    // In: the server checks it now (the API's next read says so too).
    const document: Document = { ...started.document, status: 'pending', sizeBytes: file.size };
    markUploadedHere(document.documentId);
    queries.setQueryData<Document[]>(['documents'], (all) => [document, ...(all ?? [])]);
    setHeld({ kind: 'document', document });
    say(fill(text.said.checking, { name }));
  }

  async function remove(document: Document) {
    setError(null);
    setRemoving(true);
    try {
      await api.request('DELETE', `/me/documents/${document.documentId}`);
    } catch (failure) {
      // Already gone is what was asked for.
      if (!(failure instanceof ApiError && failure.kind === 'not-found')) {
        if (!here.current) return;
        setRemoving(false);
        fail(isFinal(failure) ? refusalText(failure) : text.removeFailed);
        return;
      }
    }
    if (!here.current) {
      forget(queries, document.documentId);
      return;
    }
    cleared(document, true);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const [file] = event.dataTransfer.files;
    if (file) void add(file);
  }

  const uploading = held.kind === 'uploading';
  const busy = uploading || removing;
  // A file is in (being checked, or ready): the server carries on if the person moves on.
  const canContinue = document !== null && !unusable;
  const alert = error ?? pollEnded ?? (unusable ? (document?.error ?? text.unusable) : null);
  return (
    <div className="grid gap-6">
      {held.kind === 'none' ? (
        // The zone takes a dropped file; its button (and the hidden picker) is the way in for
        // everyone else, so the zone itself is not a control.
        // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside is the control.
        <div
          ref={zone}
          data-dragging={dragging || undefined}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            // Leaving for one of its own children is still over the zone.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={onDrop}
          className="group grid justify-items-center gap-2 rounded-[22px] border-[1.5px] border-dashed border-line-strong bg-surface p-[21px] text-center transition-colors duration-180 data-dragging:border-green-line data-dragging:bg-green-wash sm:p-[34px]"
        >
          <span
            aria-hidden="true"
            className="mb-1 grid size-[55px] place-items-center rounded-full bg-paper-deep text-ink-soft transition-colors duration-180 group-data-dragging:bg-green-soft group-data-dragging:text-green-ink"
          >
            <UploadIcon />
          </span>
          <p className="m-0 text-[0.9375rem] font-[700]">{text.dropTitle}</p>
          <p
            id="resume-drop-meta"
            className="m-0 max-w-[440px] text-xs text-muted-foreground group-data-dragging:text-ink-soft"
          >
            {text.dropMeta}
          </p>
          <Button
            ref={choose}
            variant="outline"
            className="mt-2"
            aria-describedby="resume-drop-meta"
            onClick={() => picker.current?.click()}
          >
            {text.choose}
          </Button>
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(event) => {
              const [file] = event.target.files ?? [];
              // Cleared, so choosing the same file again (after removing it) still counts.
              event.target.value = '';
              if (file) void add(file);
            }}
          />
        </div>
      ) : (
        <ol
          ref={list}
          aria-label={text.listName}
          className="@container m-0 grid list-none gap-2 p-0"
        >
          <li
            data-state={uploading ? 'uploading' : document?.status}
            // On a narrow card the actions go under the name, so a long name keeps its width.
            className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-x-[13px] gap-y-2 rounded-[13px] border border-line bg-surface p-[13px] @sm:grid-cols-[34px_minmax(0,1fr)_auto]"
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-[34px] place-items-center rounded-[11px] bg-paper-deep text-ink-soft',
                document?.status === 'ready' && 'bg-green-soft text-green-ink',
                unusable && 'text-danger-ink',
              )}
            >
              {unusable ? <AlertIcon /> : <DocumentIcon />}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="text-[0.9375rem] font-[650] wrap-anywhere">
                {held.kind === 'uploading' ? held.name : document?.fileName}
              </span>
              <span className="text-[0.8125rem] text-muted-foreground">
                {document ? statusLine(document) : stageLine('uploading')}
              </span>
            </span>
            <span className="col-start-2 flex flex-wrap items-center gap-2 @sm:col-start-auto @sm:justify-end">
              {document?.status === 'ready' && (
                <span className="inline-flex min-h-7 items-center rounded-full bg-green-wash px-[11px] text-xs font-[650] whitespace-nowrap text-green-ink">
                  {text.ready}
                </span>
              )}
              {uploading ? (
                <Button variant="outline" onClick={() => sending.current?.abort()}>
                  {text.cancel}
                  <span className="sr-only"> {held.name}</span>
                </Button>
              ) : (
                document && (
                  <Button
                    variant="outline"
                    pending={removing}
                    pendingLabel={text.removing}
                    onClick={() => remove(document)}
                  >
                    {text.remove}
                    <span className="sr-only"> {document.fileName}</span>
                  </Button>
                )
              )}
            </span>
            {held.kind === 'uploading' && (
              <Progress
                label={text.uploading}
                value={held.progress * 100}
                className="col-span-full"
              />
            )}
          </li>
        </ol>
      )}
      <p
        role="status"
        className={cn('m-0 -mt-3 text-sm text-muted-foreground', !(checking && long) && 'sr-only')}
      >
        {checking && long ? copy.loading.background : ''}
      </p>
      <p role="status" className="sr-only">
        {spoken}
      </p>
      <p role="alert" className={cn('m-0 text-sm font-[650] text-danger-ink', !alert && 'sr-only')}>
        {alert}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={onDone} disabled={busy}>
          {canContinue ? copy.setUp.continue : text.skip}
        </Button>
        <Button variant="outline" size="lg" onClick={onBack} disabled={busy}>
          {copy.setUp.back}
        </Button>
      </div>
    </div>
  );
}

/** Drops a résumé from what the app has loaded (it is gone from the API). */
function forget(queries: QueryClient, documentId: string) {
  queries.setQueryData<Document[]>(['documents'], (list) =>
    list?.filter((each) => each.documentId !== documentId),
  );
  queries.removeQueries({ queryKey: ['documents', documentId], exact: true });
}

/** Why a picked file can't be used, by what `checkFile` found. */
const PICK_REFUSALS = {
  type: copy.setUp.resume.wrongType,
  empty: copy.setUp.resume.empty,
  size: copy.setUp.resume.tooLarge,
  name: copy.setUp.resume.badName,
} as const;

/** Why an upload didn't happen: refused when starting it (`starting`), or while sending it. */
function uploadRefusal(failure: unknown, starting: boolean): string {
  const text = copy.setUp.resume;
  if (!(failure instanceof ApiError)) return text.uploadFailed;
  if (starting && failure.status === 422) return fill(text.full, { max: String(MAX_DOCUMENTS) });
  if (starting && failure.kind === 'invalid') return text.badName;
  if (!starting && failure.kind === 'invalid') return text.uploadRefused;
  if (isFinal(failure) || failure.kind === 'too-many') return refusalText(failure);
  return text.uploadFailed;
}

/** Under a résumé's name: its stage while the server checks it, its kind and size once ready. */
function statusLine(document: Document): string {
  const text = copy.setUp.resume;
  if (document.status === 'pending') return stageLine('checking');
  if (document.status === 'processing') return stageLine('reading');
  if (document.status !== 'ready') return text.notUsed;
  const format = document.format.toUpperCase();
  return document.sizeBytes === undefined
    ? format
    : fill(text.readyLine, { format, size: sizeText(document.sizeBytes) });
}

const STAGES = ['uploading', 'checking', 'reading'] as const;

function stageLine(stage: (typeof STAGES)[number]): string {
  const text = copy.setUp.resume;
  return fill(text.stage, {
    stage: text.stages[stage],
    current: String(STAGES.indexOf(stage) + 1),
  });
}

const kilobytes = new Intl.NumberFormat(copy.locale, {
  style: 'unit',
  unit: 'kilobyte',
  maximumFractionDigits: 0,
});
const megabytes = new Intl.NumberFormat(copy.locale, {
  style: 'unit',
  unit: 'megabyte',
  maximumFractionDigits: 1,
});

/** A file's size as people read it: "180 kB", "2.4 MB" (in 1,024s, as the 5 MB limit counts). */
export function sizeText(bytes: number): string {
  return bytes < 1024 * 1024
    ? kilobytes.format(Math.max(1, Math.round(bytes / 1024)))
    : megabytes.format(bytes / (1024 * 1024));
}

/** The prototype's line icons (24 viewBox, 1.75 stroke). */
function UploadIcon() {
  return (
    <Icon>
      <path d="M12 15.5v-11M7.5 9 12 4.5 16.5 9M4.5 14.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5" />
    </Icon>
  );
}

function DocumentIcon() {
  return (
    <Icon className="size-5">
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </Icon>
  );
}

function AlertIcon() {
  return (
    <Icon className="size-5">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V13M12 16.5h.01" />
    </Icon>
  );
}

function Icon({
  className = 'size-6',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}
