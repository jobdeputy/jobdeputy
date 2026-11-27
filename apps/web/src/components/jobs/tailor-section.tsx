import { COVERAGE_WARNING } from '@jobdeputy/shared/tailoring';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { momentHere } from '@/components/jobs/cooldown.ts';
import { ResumePreviewButton } from '@/components/jobs/resume-preview.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy, fill } from '@/copy/index.ts';
import { coverLetterListsKey } from '@/lib/api/cover-letters.ts';
import { ApiError, isFinal, useApi } from '@/lib/api/index.ts';
import { companyName, type JobSummary, matchesKey } from '@/lib/api/jobs.ts';
import { useProfile } from '@/lib/api/profile.ts';
import {
  addSkill,
  isTailoring,
  READY_SCORE,
  requestTailoring,
  type Tailoring,
  type Tailorings,
  tailoringFiles,
  tailoringsKey,
  useTailorings,
} from '@/lib/api/tailorings.ts';
import { followLink } from '@/lib/router.ts';
import { saveFile } from '@/lib/save-file.ts';
import { cn } from '@/lib/utils.ts';

const text = copy.matchesPage.tailor;

/** A message the section says, with a link to fix it where there is one. */
export interface Said {
  words: string;
  link?: { label: string; path: string };
  /** A new failure is a new alert, read out again. */
  count: number;
}

/**
 * #51 PR C (decision 0015, the plan agreed on #51): the job pane's "Your résumé for {company}".
 * One version a run covers the company's top shown jobs; this shows the newest ready one's score
 * for **this** job (the tailored one, with the base résumé's beside it) and the 80% line, the
 * keywords still missing (those the résumé backs; those it doesn't, each with **I have this**,
 * which saves the skill to the profile and offers Re-tailor), and the PDF and DOCX downloads
 * (their 5-minute links read on the click). A run at work is followed every 5 s; the score
 * already there stays meanwhile. A run seen at work is handed to `onWorking`, so Matches follows
 * it to its end even once the pane closes (`RunWatcher`), and then reads its scores again.
 */
export function TailorSection({
  job,
  onWorking,
}: {
  job: JobSummary;
  /** A run for the company is at work: Matches follows it (`RunWatcher`). */
  onWorking?: (companyKey: string) => void;
}) {
  const api = useApi();
  const queries = useQueryClient();
  const list = useTailorings(job.companyKey);
  const ids = { title: useId(), status: useId() };
  const company = companyName(job);
  const [starting, setStarting] = useState(false);
  const [refusal, setRefusal] = useState<Said | null>(null);
  const versions = list.data?.tailorings ?? [];
  const newest = versions[0];
  const working = isTailoring(newest);
  const ready = versions.find((v) => v.status === 'ready');
  const failed = newest?.status === 'failed' ? newest : undefined;

  useEffect(() => {
    if (working) onWorking?.(job.companyKey);
  }, [working, onWorking, job.companyKey]);
  // A run seen at work here that ends ready is said (the score shows outside the status region).
  const wasWorking = useRef(working);
  const [justReady, setJustReady] = useState<{ score: number | null } | null>(null);
  useEffect(() => {
    // A refusal is about the run it met (another tab's): once a run at work ends, it no longer
    // holds. Not when a run is first seen: that is the run the refusal is about.
    if (wasWorking.current && !working) {
      setRefusal(null);
      // A run that ends failed before any AI call gives its free run back: the letter section,
      // which counts the same runs, reads the count again.
      void queries.invalidateQueries({ queryKey: coverLetterListsKey });
    }
    if (wasWorking.current && !working && newest?.status === 'ready') {
      const score = newest.scores?.find((s) => s.jobId === job.jobId)?.tailored;
      setJustReady({ score: score ?? null });
    }
    if (working) setJustReady(null);
    wasWorking.current = working;
  }, [working, newest, job.jobId, queries]);

  async function start() {
    setStarting(true);
    setRefusal(null);
    try {
      const { tailoring } = await requestTailoring(api, job.companyKey);
      // Shown at once (and followed), before the list is read again.
      queries.setQueryData<Tailorings>(tailoringsKey(job.companyKey), (was) =>
        was ? { ...was, tailorings: [tailoring, ...was.tailorings] } : was,
      );
      // Cover letters use the same free runs: their sections read the count again.
      void queries.invalidateQueries({ queryKey: coverLetterListsKey });
    } catch (error) {
      setRefusal((was) => ({
        ...refusalOf(error, list.data?.allowance),
        count: (was?.count ?? 0) + 1,
      }));
      // Refused as out of runs (used elsewhere): the letter section's count is out of date too.
      void queries.invalidateQueries({ queryKey: coverLetterListsKey });
    } finally {
      setStarting(false);
      // The allowance (a run counted), or a run found at work: the list as the API has it.
      void list.refetch();
    }
  }

  if (list.isPending) {
    return (
      <section aria-labelledby={ids.title} aria-busy="true" className={SECTION_CLASS}>
        <Heading id={ids.title} company={company} />
        <Skeleton kind="lines" rows={2} />
      </section>
    );
  }
  if (list.isError && !list.data) {
    return (
      <section aria-labelledby={ids.title} className={SECTION_CLASS}>
        <Heading id={ids.title} company={company} />
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
        <Heading id={ids.title} company={company} />
        {!ready && <p className="m-0 text-sm text-muted-foreground">{text.intro}</p>}
      </div>
      {/* Always there, so the run's progress and its end (ready or failed) are read out. */}
      <div id={ids.status} role="status" className={working || failed ? 'grid gap-1' : 'sr-only'}>
        {working && (
          <>
            <p className="m-0 flex items-center gap-2 font-[650] text-ink">
              <Spinner />
              {fill(text.working, { company })}
            </p>
            <p className="m-0 text-sm text-muted-foreground">{text.workingLine}</p>
          </>
        )}
        {/* Said only (the score shows below): the run seen at work here ended ready. */}
        {!working && !failed && justReady && (
          <p className="m-0">
            {justReady.score === null
              ? fill(text.readyNow, { company })
              : fill(text.readyNowScore, { company, score: String(justReady.score) })}
          </p>
        )}
        {failed && (
          <>
            <p className="m-0 font-[650] text-danger-ink">{text.failedTitle}</p>
            {failed.message && <p className="m-0 text-sm text-ink-soft">{failed.message}</p>}
          </>
        )}
      </div>
      {/*
       * Not keyed by version: an open Preview stays open (showing the new version) when a
       * re-tailor ends. Its parts that say something about a version are keyed by it.
       */}
      {ready && <ReadyVersion version={ready} job={job} company={company} working={working} />}
      <div className="grid justify-items-start gap-2">
        <Button
          variant={ready ? 'outline' : 'default'}
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
            ? fill(text.allowance, { left: String(left), perMonth: String(allowance.perMonth) })
            : fill(text.allowanceNone, {
                perMonth: String(allowance.perMonth),
                date: momentHere(allowance.nextAt),
              })}
        </p>
      </div>
      <Alert said={refusal} />
    </section>
  );
}

// A plain section of the pane, as Why it fits: the score's panel is the one box in it.
const SECTION_CLASS = 'grid gap-4';

function Heading({ id, company }: { id: string; company: string }) {
  return (
    <h3 id={id} className="m-0 text-base font-[700] [overflow-wrap:anywhere]">
      {fill(text.title, { company })}
    </h3>
  );
}

/** Always there, so a failure is read out when it comes. */
export function Alert({ said }: { said: Said | null }) {
  return (
    <div
      key={said?.count ?? 0}
      role="alert"
      className={said ? 'grid justify-items-start gap-2' : 'sr-only'}
    >
      {said && (
        <>
          <p className="m-0 text-sm font-[650] text-danger-ink">{said.words}</p>
          {said.link && (
            <a
              href={said.link.path}
              onClick={(event) => followLink(event, said.link?.path ?? '/')}
              className="text-sm font-[650] text-green-ink"
            >
              {said.link.label}
            </a>
          )}
        </>
      )}
    </div>
  );
}

/** Why a Tailor click started nothing (apps/api/src/tailoring.ts codes). */
function refusalOf(
  error: unknown,
  allowance: Tailorings['allowance'] | undefined,
): Omit<Said, 'count'> {
  if (!(error instanceof ApiError)) return { words: text.startFailed };
  switch (error.code) {
    case 'tailoring_allowance':
      // The list read again after it says the same, with the day more come.
      return allowance
        ? {
            words: fill(text.allowanceNone, {
              perMonth: String(allowance.perMonth),
              date: momentHere(allowance.nextAt),
            }),
          }
        : { words: text.startFailed };
    case 'tailoring_busy':
      return { words: text.busy };
    case 'model_needed':
      return { words: text.modelNeeded };
    case 'no_resume':
      return { words: text.noResume, link: { label: text.toResumes, path: '/resumes' } };
    case 'no_jobs':
      return { words: text.noJobs };
  }
  return { words: error.kind === 'offline' ? text.offline : text.startFailed };
}

/** The newest ready version, as it reads for this job. */
function ReadyVersion({
  version,
  job,
  company,
  working,
}: {
  version: Tailoring;
  job: JobSummary;
  company: string;
  /** A new run is at work: "Re-tailor to use it" is being done. */
  working: boolean;
}) {
  const score = version.scores?.find((s) => s.jobId === job.jobId);
  const downloads = useDownloads(version);
  return (
    <div className="grid gap-4">
      {score ? (
        <ScoreBox base={score.base} tailored={score.tailored} />
      ) : (
        <p className="m-0 text-sm font-[650] text-ink-soft">{text.notIncluded}</p>
      )}
      {version.coverage !== undefined && version.coverage < COVERAGE_WARNING && (
        <p className="m-0 text-sm text-ink-soft">{text.coverage}</p>
      )}
      {score && score.missingProven.length > 0 && (
        <div className="grid gap-2">
          <h4 className="m-0 text-sm font-[700]">{text.missingProven}</h4>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {score.missingProven.map((keyword) => (
              <li key={keyword} className={CHIP_CLASS}>
                {keyword}
              </li>
            ))}
          </ul>
        </div>
      )}
      {score && score.missingUnproven.length > 0 && (
        <MissingSkills
          key={version.documentId}
          keywords={score.missingUnproven}
          working={working}
        />
      )}
      <Downloads
        version={version}
        state={downloads}
        preview={
          <ResumePreviewButton
            version={version}
            company={company}
            footer={<Downloads version={version} state={downloads} />}
          />
        }
      />
    </div>
  );
}

const CHIP_CLASS =
  'rounded-full border border-line bg-paper px-3 py-1 text-[0.8125rem] font-[620] text-ink-soft';

/** This job's score: the tailored résumé's, large, with the base résumé's under it. */
function ScoreBox({ base, tailored }: { base: number | null; tailored: number | null }) {
  const isReady = tailored !== null && tailored >= READY_SCORE;
  return (
    <div
      className={cn(
        'grid gap-1 rounded-[14px] border p-3',
        tailored === null
          ? 'border-line bg-paper'
          : isReady
            ? 'border-green-line bg-green-wash'
            : 'border-orange-soft bg-paper',
      )}
    >
      {/* Ink-soft, not muted: muted text is below 4.5:1 on the green wash. */}
      <p className="m-0 text-xs font-[750] tracking-[0.12em] text-ink-soft uppercase">
        {text.scoreLabel}
      </p>
      <p className="m-0 font-display text-[2rem] leading-none font-medium tracking-[-0.03em]">
        {tailored === null ? text.scoreNone : fill(text.score, { score: String(tailored) })}
      </p>
      <p className="m-0 text-sm text-ink-soft">
        {base === null ? text.baseNone : fill(text.base, { score: String(base) })}
      </p>
      {/* Nothing to measure: neither ready nor short of it. */}
      {tailored !== null && (
        <p className={cn('m-0 text-sm font-[650]', isReady ? 'text-green-ink' : 'text-ink-soft')}>
          {isReady ? text.ready : text.below}
        </p>
      )}
    </div>
  );
}

/**
 * The keywords the résumé doesn't show, each with I have this: it saves the skill to the profile
 * (`POST /me/profile/skills`), so the next run may use it; once added, the chip says so.
 */
function MissingSkills({ keywords, working }: { keywords: string[]; working: boolean }) {
  const api = useApi();
  const queries = useQueryClient();
  const profile = useProfile();
  const [addedHere, setAdded] = useState<ReadonlySet<string>>(new Set());
  // Added here, or already on the profile (added before, in another pane or tab).
  const onProfile = new Set(
    ((profile.data?.skills as string[] | undefined) ?? []).map((s) => s.toLocaleLowerCase('en')),
  );
  const added = (skill: string) =>
    addedHere.has(skill) || onProfile.has(skill.toLocaleLowerCase('en'));
  const [adding, setAdding] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lineId = useId();
  async function have(skill: string) {
    if (adding !== null) return;
    setAdding(skill);
    setSaid(null);
    try {
      await addSkill(api, skill);
      setAdded((was) => new Set(was).add(skill));
      setDone(fill(text.added, { skill }));
      void queries.invalidateQueries({ queryKey: ['profile'] });
    } catch (error) {
      setDone(null);
      setSaid((was) => ({ ...skillRefusal(error, skill), count: (was?.count ?? 0) + 1 }));
    } finally {
      setAdding(null);
    }
  }
  return (
    <div className="grid gap-2">
      <h4 className="m-0 text-sm font-[700]">{text.missingUnproven}</h4>
      <p id={lineId} className="m-0 text-sm text-muted-foreground">
        {text.missingUnprovenLine}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {keywords.map((skill) => (
          <li key={skill} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-[650] [overflow-wrap:anywhere]">{skill}</span>
            {added(skill) ? (
              <span className="text-[0.8125rem] font-[650] text-green-ink">{text.addedShort}</span>
            ) : (
              <Button
                variant="outline"
                pending={adding === skill}
                pendingLabel={text.adding}
                aria-disabled={(adding !== null && adding !== skill) || undefined}
                aria-describedby={lineId}
                aria-label={fill(text.haveName, { skill })}
                onClick={() => void have(skill)}
              >
                {text.have}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {/* One element, its words changed: a status region mounted with its words is often not read. */}
      <p role="status" className={done && !working ? 'm-0 text-sm text-green-ink' : 'sr-only'}>
        {working ? '' : (done ?? '')}
      </p>
      <Alert said={said} />
    </div>
  );
}

function skillRefusal(error: unknown, skill: string): Omit<Said, 'count'> {
  if (error instanceof ApiError && error.code === 'profile-needed') {
    return { words: text.profileNeeded, link: { label: text.toProfile, path: '/profile' } };
  }
  if (error instanceof ApiError && error.code === 'skills-full') {
    return { words: text.skillsFull, link: { label: text.toProfile, path: '/profile' } };
  }
  return { words: fill(text.addFailed, { skill }) };
}

/**
 * The downloads' state, shared by the pane's buttons and the preview's: a download asked for in
 * the dialog is said in the pane when the dialog has closed. A result for a version that is no
 * longer the newest (a re-tailor ended meanwhile) is dropped, and a new version starts clean.
 */
function useDownloads(version: Tailoring) {
  const api = useApi();
  const [getting, setGetting] = useState<'pdf' | 'docx' | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const current = useRef(version.documentId);
  useEffect(() => {
    if (current.current === version.documentId) return;
    current.current = version.documentId;
    setGetting(null);
    setSaid(null);
  }, [version.documentId]);
  async function download(kind: 'pdf' | 'docx') {
    if (getting !== null) return;
    const asked = version.documentId;
    setGetting(kind);
    setSaid(null);
    try {
      const files = await tailoringFiles(api, asked);
      const url = files.downloads?.[kind];
      if (!url) throw new Error('no download');
      // Saved even if a re-tailor ended meanwhile: it is the file that was asked for.
      const pdfName = version.fileName ?? text.fileNameFallback;
      saveFile(url, kind === 'pdf' ? pdfName : pdfName.replace(/\.pdf$/, '.docx'));
    } catch {
      if (current.current !== asked) return;
      setSaid((was) => ({ words: text.downloadFailed, count: (was?.count ?? 0) + 1 }));
    } finally {
      if (current.current === asked) setGetting(null);
    }
  }
  return { getting, said, download };
}

type DownloadsState = ReturnType<typeof useDownloads>;

/** PDF (the default) and DOCX: each click reads fresh 5-minute links, then starts the download. */
function Downloads({
  version,
  state,
  preview,
}: {
  version: Tailoring;
  state: DownloadsState;
  preview?: ReactNode;
}) {
  const { getting, said, download } = state;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {preview}
        <Button
          variant="outline"
          pending={getting === 'pdf'}
          pendingLabel={text.downloading}
          onClick={() => void download('pdf')}
        >
          {text.downloadPdf}
        </Button>
        <Button
          variant="outline"
          pending={getting === 'docx'}
          pendingLabel={text.downloading}
          onClick={() => void download('docx')}
        >
          {text.downloadDocx}
        </Button>
      </div>
      {version.finishedAt && (
        <p className="m-0 text-sm text-muted-foreground">
          {fill(text.made, { date: momentHere(version.finishedAt) })}
        </p>
      )}
      <Alert said={said} />
    </div>
  );
}

/**
 * Follows a company's run from Matches itself, so its end is seen even once the pane that
 * started it closes (or shows another job): Matches then reads its scores again (the Score
 * column), and `onDone` stops following.
 */
export function RunWatcher({
  companyKey,
  onDone,
}: {
  companyKey: string;
  onDone: (companyKey: string) => void;
}) {
  const queries = useQueryClient();
  const list = useTailorings(companyKey);
  const working = isTailoring(list.data?.tailorings[0]);
  const stopped = isFinal(list.error);
  useEffect(() => {
    // Signed out (or the account closed): the run can't be read any more, so it isn't followed.
    // Signed out, or the first read failed (nothing to poll from): not followed any more.
    if (stopped || (list.isError && !list.data)) {
      onDone(companyKey);
      return;
    }
    if (!list.data || working) return;
    void queries.invalidateQueries({ queryKey: matchesKey });
    onDone(companyKey);
  }, [list.data, list.isError, working, stopped, queries, onDone, companyKey]);
  return null;
}
