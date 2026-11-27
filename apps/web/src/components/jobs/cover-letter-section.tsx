import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { momentHere } from '@/components/jobs/cooldown.ts';
import { LetterPreviewButton } from '@/components/jobs/letter-preview.tsx';
import { Alert, type Said } from '@/components/jobs/tailor-section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy, fill } from '@/copy/index.ts';
import {
  type CoverLetter,
  type CoverLetters,
  coverLetterFiles,
  coverLettersKey,
  isWriting,
  requestCoverLetter,
  useCoverLetterFiles,
  useCoverLetters,
} from '@/lib/api/cover-letters.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import { companyName, type JobSummary } from '@/lib/api/jobs.ts';
import { tailoringsKey } from '@/lib/api/tailorings.ts';
import { saveFile } from '@/lib/save-file.ts';

const text = copy.matchesPage.letter;
const shared = copy.matchesPage.tailor;

/**
 * #51 PR D3 (the plan agreed on #51): the job pane's "Cover letter for this job", below the
 * résumé. Write cover letter starts one run (1 free run, shared with tailoring); a run at work is
 * followed every 5 s. A ready letter has Preview (a dialog laid out as its files), Copy text (the
 * body, for a form's box), the PDF and DOCX downloads (their 5-minute links read on the click),
 * and Rewrite. The newest ready letter stays shown while a rewrite works.
 */
export function CoverLetterSection({ job }: { job: JobSummary }) {
  const api = useApi();
  const queries = useQueryClient();
  const list = useCoverLetters(job.jobId);
  const ids = { title: useId(), status: useId() };
  const company = companyName(job);
  const [starting, setStarting] = useState(false);
  const [refusal, setRefusal] = useState<Said | null>(null);
  const letters = list.data?.coverLetters ?? [];
  const newest = letters[0];
  const working = isWriting(newest);
  const ready = letters.find((v) => v.status === 'ready');
  const failed = newest?.status === 'failed' ? newest : undefined;

  // A run seen at work here that ends ready is said (the letter shows outside the status region).
  const wasWorking = useRef(working);
  const [justReady, setJustReady] = useState(false);
  useEffect(() => {
    // A refusal is about the run it met (another tab's): once that run ends, it no longer holds.
    if (wasWorking.current && !working) setRefusal(null);
    if (wasWorking.current && !working && newest?.status === 'ready') setJustReady(true);
    if (working) setJustReady(false);
    wasWorking.current = working;
  }, [working, newest]);

  async function start() {
    setStarting(true);
    setRefusal(null);
    try {
      const { coverLetter } = await requestCoverLetter(api, job.jobId);
      // Shown at once (and followed), before the list is read again.
      queries.setQueryData<CoverLetters>(coverLettersKey(job.jobId), (was) =>
        was ? { ...was, coverLetters: [coverLetter, ...was.coverLetters] } : was,
      );
      // The résumé section above counts the same free runs.
      void queries.invalidateQueries({ queryKey: tailoringsKey(job.companyKey) });
    } catch (error) {
      setRefusal((was) => ({
        ...refusalOf(error, list.data?.allowance),
        count: (was?.count ?? 0) + 1,
      }));
    } finally {
      setStarting(false);
      // The allowance (a run counted), or a run found at work: the list as the API has it.
      void list.refetch();
    }
  }

  if (list.isPending) {
    return (
      <section aria-labelledby={ids.title} aria-busy="true" className={SECTION_CLASS}>
        <Heading id={ids.title} />
        <Skeleton kind="lines" rows={2} />
      </section>
    );
  }
  if (list.isError && !list.data) {
    return (
      <section aria-labelledby={ids.title} className={SECTION_CLASS}>
        <Heading id={ids.title} />
        <LoadFailed
          error={list.error}
          message={text.loadFailed}
          retry={text.retry}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      </section>
    );
  }
  const allowance = list.data.allowance;
  const left = Math.max(0, allowance.perMonth - allowance.used);
  return (
    <section aria-labelledby={ids.title} className={SECTION_CLASS}>
      <div className="grid gap-1">
        <Heading id={ids.title} />
        {!ready && (
          <p className="m-0 text-sm text-muted-foreground">{fill(text.intro, { company })}</p>
        )}
      </div>
      {/* Always there, so the run's progress and its end (ready or failed) are read out. */}
      <div id={ids.status} role="status" className={working || failed ? 'grid gap-1' : 'sr-only'}>
        {working && (
          <>
            <p className="m-0 flex items-center gap-2 font-[650] text-ink">
              <Spinner />
              {text.working}
            </p>
            <p className="m-0 text-sm text-muted-foreground">{text.workingLine}</p>
          </>
        )}
        {!working && !failed && justReady && <p className="m-0">{text.readyNow}</p>}
        {failed && (
          <>
            <p className="m-0 font-[650] text-danger-ink">{text.failedTitle}</p>
            {failed.message && <p className="m-0 text-sm text-ink-soft">{failed.message}</p>}
          </>
        )}
      </div>
      {ready && <ReadyLetter letter={ready} company={company} />}
      <div className="grid justify-items-start gap-2">
        {/* Outline either way: Manual apply stays the pane's one main action. */}
        <Button
          variant="outline"
          pending={starting}
          pendingLabel={text.starting}
          aria-disabled={working || undefined}
          data-unavailable={working || undefined}
          aria-describedby={working ? ids.status : undefined}
          onClick={() => {
            if (!working) void start();
          }}
        >
          {ready ? text.again : text.start}
        </Button>
        <p className="m-0 text-sm text-muted-foreground">
          {left > 0
            ? text.allowance
            : fill(text.allowanceNone, { date: momentHere(allowance.nextAt) })}
        </p>
      </div>
      <Alert said={refusal} />
    </section>
  );
}

const SECTION_CLASS = 'grid gap-4';

function Heading({ id }: { id: string }) {
  return (
    <h3 id={id} className="m-0 text-base font-[700]">
      {text.title}
    </h3>
  );
}

/** Why a Write click started nothing (apps/api/src/cover-letters.ts codes). */
function refusalOf(
  error: unknown,
  allowance: CoverLetters['allowance'] | undefined,
): Omit<Said, 'count'> {
  if (!(error instanceof ApiError)) return { words: shared.startFailed };
  switch (error.code) {
    case 'tailoring_allowance':
      return allowance
        ? {
            words: fill(text.allowanceRefused, {
              perMonth: String(allowance.perMonth),
              date: momentHere(allowance.nextAt),
            }),
          }
        : { words: shared.startFailed };
    case 'cover_letter_busy':
      return { words: text.busy };
    case 'model_needed':
      return { words: text.modelNeeded };
    case 'no_resume':
      return { words: shared.noResume, link: { label: shared.toResumes, path: '/resumes' } };
    case 'no_jobs':
      return { words: text.noJobs };
    case 'no_company':
      return { words: text.noCompany };
  }
  return { words: error.kind === 'offline' ? shared.offline : shared.startFailed };
}

/** The newest ready letter: what it was written from, Preview, Copy text, and its files. */
function ReadyLetter({ letter, company }: { letter: CoverLetter; company: string }) {
  const actions = useLetterActions(letter);
  const date = momentHere(letter.finishedAt ?? letter.createdAt);
  return (
    <div className="grid gap-2">
      <Actions
        state={actions}
        preview={
          <LetterPreviewButton
            documentId={letter.documentId}
            company={company}
            footer={<Actions state={actions} />}
          />
        }
      />
      <p className="m-0 text-sm text-muted-foreground">
        {letter.from === 'tailored'
          ? fill(text.fromTailored, { date, company })
          : fill(text.fromBase, { date })}
      </p>
    </div>
  );
}

/**
 * Copy text and the downloads' state, shared by the pane's buttons and the preview's, so what was
 * asked for in the dialog is said in the pane once it closes. The letter's text is read when it
 * shows (once; it never changes), so Copy writes it in the click itself: browsers refuse a
 * clipboard write that waits on the network. A result for a letter that is no longer the newest
 * (a rewrite ended meanwhile) is dropped, and a new letter starts clean.
 */
function useLetterActions(letter: CoverLetter) {
  const api = useApi();
  const files = useCoverLetterFiles(letter.documentId);
  const [getting, setGetting] = useState<'pdf' | 'docx' | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [copied, setCopied] = useState(false);
  const current = useRef(letter.documentId);
  useEffect(() => {
    if (current.current === letter.documentId) return;
    current.current = letter.documentId;
    setGetting(null);
    setSaid(null);
    setCopied(false);
  }, [letter.documentId]);
  const fail = (words: string) => setSaid((was) => ({ words, count: (was?.count ?? 0) + 1 }));

  async function copyText() {
    setSaid(null);
    setCopied(false);
    const body = files.data?.text;
    if (!body) {
      // Not read (it failed): read again, so Preview, or the next click, has it.
      void files.refetch();
      fail(text.copyFailed);
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(body);
      if (current.current === letter.documentId) setCopied(true);
    } catch {
      if (current.current === letter.documentId) fail(text.copyFailed);
    }
  }

  async function download(kind: 'pdf' | 'docx') {
    if (getting !== null) return;
    const asked = letter.documentId;
    setGetting(kind);
    setSaid(null);
    setCopied(false);
    try {
      const read = await coverLetterFiles(api, asked);
      const url = read.downloads?.[kind];
      if (!url) throw new Error('no download');
      // Saved even if a rewrite ended meanwhile: it is the file that was asked for.
      const pdfName = letter.fileName ?? text.fileNameFallback;
      saveFile(url, kind === 'pdf' ? pdfName : pdfName.replace(/\.pdf$/, '.docx'));
    } catch {
      if (current.current === asked) fail(shared.downloadFailed);
    } finally {
      if (current.current === asked) setGetting(null);
    }
  }
  return { getting, said, copied, reading: files.isPending, copyText, download };
}

type ActionsState = ReturnType<typeof useLetterActions>;

/** Preview (in the pane only), Copy text, PDF (the default) and DOCX. */
function Actions({ state, preview }: { state: ActionsState; preview?: ReactNode }) {
  const { getting, said, copied, reading, copyText, download } = state;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {preview}
        <Button
          variant="outline"
          pending={reading}
          pendingLabel={shared.downloading}
          onClick={() => void copyText()}
        >
          {text.copyText}
        </Button>
        <Button
          variant="outline"
          pending={getting === 'pdf'}
          pendingLabel={shared.downloading}
          onClick={() => void download('pdf')}
        >
          {shared.downloadPdf}
        </Button>
        <Button
          variant="outline"
          pending={getting === 'docx'}
          pendingLabel={shared.downloading}
          onClick={() => void download('docx')}
        >
          {shared.downloadDocx}
        </Button>
      </div>
      {/* One element, its words changed: a status region mounted with its words is often not read. */}
      <p role="status" className={copied ? 'm-0 text-sm text-green-ink' : 'sr-only'}>
        {copied ? text.copied : ''}
      </p>
      <Alert said={said} />
    </div>
  );
}
