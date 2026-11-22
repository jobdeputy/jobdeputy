import { parseCrawlUrl } from '@jobdeputy/shared/crawl';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import { Field } from '@/components/auth/fields.tsx';
import { DeputyWorking } from '@/components/deputy/deputy-working.tsx';
import { LinkIcon } from '@/components/icons.tsx';
import { CompanyList } from '@/components/jobs/company-list.tsx';
import { PageIntro } from '@/components/page-intro.tsx';
import { Section } from '@/components/section.tsx';
import { refusalText } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { copy, fill, plural } from '@/copy/index.ts';
import {
  type Crawl,
  crawlName,
  crawlStage,
  isCrawling,
  isStalled,
  latestCrawlQuery,
  listProgress,
  listProgressKey,
  startCrawl,
  useLatestCrawl,
  workDeadline,
} from '@/lib/api/crawls.ts';
import { ApiError, isFinal, useApi } from '@/lib/api/index.ts';

const text = copy.jobsPage;

/**
 * The Job matches page (#49): a link in, the best jobs at each company out. Find jobs takes one
 * careers page; the deputy reads it in the background (the crawl), and the page follows the
 * newest crawl, so one started before a reload or in another tab is followed too. Under it, the
 * companies and their best jobs (CompanyList), read again whenever a crawl's work ends.
 */
export function JobsPage({ checkEvery }: { checkEvery?: number }) {
  const latest = useLatestCrawl(checkEvery);
  const crawl = latest.data ?? null;
  useRenderAtDeadline(crawl);
  const listVersion = useListVersion(latest);
  return (
    // Wide enough for the companies beside a job's preview; the link form keeps its measure.
    <div className="grid w-full max-w-[1120px] content-start gap-8">
      <div className="grid w-full max-w-[880px] content-start gap-8">
        <PageIntro id="jobs-title" eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
        <Section
          id="find-jobs"
          icon={<LinkIcon className="size-[22px]" />}
          title={text.find.title}
          line={text.find.line}
        >
          <div className="mt-6 grid gap-6">
            <FindJobs />
            {latest.isError && latest.data === undefined ? (
              <ReadFailed
                // A new failure is a new alert, so the same words are read out again.
                key={latest.errorUpdateCount}
                error={latest.error}
                retrying={latest.isFetching}
                onRetry={() => latest.refetch()}
              />
            ) : (
              <CrawlProgress crawl={crawl} />
            )}
          </div>
        </Section>
      </div>
      <CompanyList
        version={listVersion}
        progress={listProgressKey(crawl)}
        offline={latest.isPaused}
      />
    </div>
  );
}

/**
 * What the companies list reflects: the newest crawl whose work ended, and how (read, scored, or
 * stalled; a crawl that failed changed nothing). A new version reads the list again from the
 * start, so a crawl that ended in another tab, or later than it seemed to (a stall that then
 * finished), counts too. While a crawl is at work the version stays (a list run's companies
 * are read again in place as each one ends: `listProgressKey` in lib/api/crawls.ts). Undefined
 * until the newest crawl is known, so the list is never read just before a crawl is seen as ended.
 */
function useListVersion(latest: ReturnType<typeof useLatestCrawl>): string | undefined {
  const last = useRef<string | undefined>(undefined);
  if (latest.data === undefined && !latest.isError) return undefined;
  const crawl = latest.data ?? null;
  if (crawl && (isCrawling(crawl) || crawl.status === 'failed')) {
    last.current ??= 'open';
    return last.current;
  }
  last.current = crawl
    ? [
        crawl.crawlId,
        crawl.status,
        crawl.relevance?.status ?? '',
        isStalled(crawl) ? 'stalled' : '',
      ].join(':')
    : 'none';
  return last.current;
}

/**
 * Draws the page again when the deputy's current stage stops counting as work (a scoring that
 * never started, a crawl or scoring that stalled): nothing else changes then, so nothing else
 * would draw it.
 */
function useRenderAtDeadline(crawl: Crawl | null) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const deadline = crawl ? workDeadline(crawl) : null;
  useEffect(() => {
    if (deadline === null || Number.isNaN(deadline)) return;
    const wait = deadline - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(redraw, wait + 1);
    return () => clearTimeout(timer);
  }, [deadline]);
}

/**
 * The link form: one careers page. The address is checked here as the API checks it (the same
 * rules, packages/shared/src/crawl.ts), so a typo is caught at once, beside the field; a link
 * without its `https://` gets one. Everything else (links at work, the daily limit, the free AI
 * runs) is the API's to decide, and is said under the buttons, not as a wrong field. When the free
 * AI runs are used up, the same link can be sent to be ranked by keywords only.
 */
function FindJobs() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiUsedUp, setAiUsedUp] = useState(false);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function clear() {
    setFieldError(null);
    setNotice(null);
    setAiUsedUp(false);
  }

  async function send({ withoutAi = false }: { withoutAi?: boolean } = {}) {
    if (pending) return;
    const typed = draft.trim();
    const problem = typed ? checkLink(typed) : text.find.errors.empty;
    // The keywords-only button stays while its link is on its way (it may hold the focus).
    setFieldError(null);
    setNotice(null);
    if (problem) {
      setAiUsedUp(false);
      setFieldError(problem);
      input.current?.focus();
      return;
    }
    const latestKey = latestCrawlQuery(api).queryKey;
    setPending(true);
    try {
      const crawl = await startCrawl(api, withScheme(typed), { withoutAi });
      // A read of the newest crawl still on its way would put the one before back.
      await queryClient.cancelQueries({ queryKey: latestKey });
      queryClient.setQueryData(latestKey, crawl);
      setDraft('');
      setAiUsedUp(false);
      // Ready for the next link (the keywords-only button, if pressed, is gone).
      input.current?.focus();
    } catch (failure) {
      const usedUp = failure instanceof ApiError && failure.code === 'platform-ai-limit-reached';
      setAiUsedUp(usedUp);
      if (usedUp) {
        setNotice(text.find.errors.aiUsedUp);
      } else if (failure instanceof ApiError && failure.kind === 'invalid') {
        // The address: the API's reason, beside the field.
        setFieldError(linkError(failure.code));
      } else {
        setNotice(refusal(failure));
      }
      // Back to the link, to change it or send it again (and off a button that may be gone).
      if (!usedUp) input.current?.focus();
      // Another tab's link, or one whose answer was lost, may be at work: follow it.
      if (
        failure instanceof ApiError &&
        (failure.code === 'too-many-active-crawls' || failure.kind === 'unsure')
      ) {
        void queryClient.invalidateQueries({ queryKey: latestKey });
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby="find-jobs-title" className="grid gap-5">
      <Field
        ref={input}
        name="url"
        type="url"
        inputMode="url"
        autoComplete="url"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="go"
        label={text.find.label}
        hint={text.find.hint}
        placeholder={text.find.placeholder}
        error={fieldError}
        value={draft}
        readOnly={pending}
        className={pending ? '[&_input]:opacity-60' : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          clear();
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending} pendingLabel={text.find.sending}>
          {text.find.submit}
        </Button>
        {aiUsedUp && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void send({ withoutAi: true })}
          >
            {text.find.withoutAi}
          </Button>
        )}
      </div>
      {/* Always there, so a notice is read out when it comes. */}
      <p role="alert" className={notice ? 'm-0 text-sm font-[650] text-danger-ink' : 'sr-only'}>
        {notice}
      </p>
    </form>
  );
}

/** A link as typed, with `https://` when it has no scheme of its own. */
export function withScheme(typed: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
}

/** Why this link can't be read, by the API's own rules, in the page's words; null when it can. */
function checkLink(typed: string): string | null {
  const checked = parseCrawlUrl(withScheme(typed));
  return checked.ok ? null : linkError(checked.code);
}

/** A reason the API gives for a link (CRAWL_ERRORS), in the page's words. */
export function linkError(code: string | undefined): string {
  return (code && (text.linkErrors as Record<string, string>)[code]) || text.find.errors.refused;
}

/** Why the API turned the link away (not its address), in the page's words. */
function refusal(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.code === 'too-many-active-crawls') return text.find.errors.busy;
    if (failure.code === 'daily-limit-reached') return text.find.errors.daily;
    if (failure.code === 'daily-list-limit-reached') return text.find.errors.dailyLists;
    if (failure.code === 'lists-turned-off') return text.find.errors.listsOff;
    if (failure.kind === 'offline' || failure.kind === 'server' || failure.kind === 'unsure') {
      return text.find.errors.tryLater;
    }
  }
  return refusalText(failure);
}

/** The newest crawl couldn't be read: say so, and try again where that can help. */
function ReadFailed({
  error,
  retrying,
  onRetry,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) {
  const final = isFinal(error);
  return (
    <div className="grid justify-items-start gap-3">
      <p role="alert" className="m-0 text-sm font-[650] text-danger-ink">
        {final ? refusalText(error) : text.find.readFailed}
      </p>
      {!final && (
        <Button
          variant="outline"
          pending={retrying}
          pendingLabel={text.find.retrying}
          onClick={onRetry}
        >
          {text.find.retry}
        </Button>
      )}
    </div>
  );
}

/**
 * The newest crawl: the deputy at work while it runs (waiting its turn, reading, scoring), then
 * how it went. The result line is a status region, so it is read out when the work ends. #50: a
 * GitHub list is read, then its companies, with a bar of how many are read.
 */
function CrawlProgress({ crawl }: { crawl: Crawl | null }) {
  if (!crawl) return null;
  const host = crawlName(crawl);
  const working = isCrawling(crawl);
  const stage = crawlStage(crawl);
  const progress = crawl.list ? listProgress(crawl.list) : undefined;
  return (
    <div className="grid">
      <DeputyWorking
        active={working}
        background
        status={text.working.status}
        speech={text.working.speech}
        step={fill(text.working[stage], { host })}
        // Space under the deputy only while he shows (his live regions stay, empty, after).
        className="data-shown:mb-3"
      />
      {working && stage === 'companies' && progress && progress.total > 0 && (
        <Progress
          className="mb-3"
          label={fill(plural(text.working.companiesBar, progress.total), {
            done: String(progress.done),
          })}
          value={(progress.done / progress.total) * 100}
        />
      )}
      <div role="status" className="grid gap-1">
        {!working && <Outcome crawl={crawl} host={host} />}
      </div>
    </div>
  );
}

function Outcome({ crawl, host }: { crawl: Crawl; host: string }) {
  if (crawl.status === 'failed' || isStalled(crawl)) {
    const reason =
      crawl.status === 'failed'
        ? fill(text.result.failed, { host, reason: linkError(crawl.error?.code) })
        : fill(text.result.stalled, { host });
    return (
      <>
        <p className="m-0 text-sm font-[650] text-danger-ink">{reason}</p>
        {crawl.status === 'failed' && (
          <p className="m-0 text-sm text-muted-foreground">{text.result.tryAnother}</p>
        )}
      </>
    );
  }
  if (crawl.kind === 'list') return <ListOutcome crawl={crawl} host={host} />;
  const found = crawl.stats?.jobsFound ?? 0;
  const line =
    found === 0
      ? fill(text.result.doneEmpty, { host })
      : crawl.stats?.jobsRelevant === 0
        ? fill(text.result.doneNone, { host })
        : fill(plural(text.result.done, found), { host });
  return (
    <>
      <p className="m-0 text-sm font-[650] text-ink">{line}</p>
      <NoScore crawl={crawl} />
    </>
  );
}

/** Why the AI didn't score a crawl's jobs, when it didn't: the deputy ranked them by keywords. */
function NoScore({ crawl }: { crawl: Crawl }) {
  const scoring = crawl.relevance?.status === 'failed' ? crawl.relevance.error?.code : undefined;
  if (!scoring) return null;
  return (
    <p className="m-0 text-sm text-muted-foreground">
      {fill(text.result.noScore, {
        reason:
          (text.scoringErrors as Record<string, string>)[scoring] ??
          text.scoringErrors.model_unavailable,
      })}
    </p>
  );
}

/**
 * #50: how a list run went: the jobs read at how many companies, then what it passed over (sites
 * that can't be read yet, companies whose read failed, boards already being read).
 */
function ListOutcome({ crawl, host }: { crawl: Crawl; host: string }) {
  const list = crawl.list;
  const read = crawl.stats?.companies?.succeeded ?? 0;
  const found = crawl.stats?.jobsFound ?? 0;
  const chosen = list?.companies.length ?? 0;
  const skipped = list?.skipped ?? 0;
  const line =
    chosen === 0
      ? fill(skipped > 0 ? text.result.listNoneReadable : text.result.listNoMatch, { host })
      : read === 0
        ? fill(text.result.listNoneRead, { host })
        : crawl.stats?.jobsFound === 0
          ? fill(text.result.listNoJobs, { host, companies: plural(text.result.companies, read) })
          : crawl.stats?.jobsRelevant === 0
            ? fill(text.result.listNoneFit, {
                host,
                companies: plural(text.result.companies, read),
              })
            : fill(plural(text.result.listDone, found), {
                host,
                companies: plural(text.result.companies, read),
              });
  const notes = [
    chosen > 0 && skipped > 0 ? plural(text.result.listSkipped, skipped) : null,
    (crawl.stats?.companies?.failed ?? 0) > 0
      ? plural(text.result.listFailed, crawl.stats?.companies?.failed ?? 0)
      : null,
    (list?.busy ?? 0) > 0 ? plural(text.result.listBusy, list?.busy ?? 0) : null,
  ].filter((note): note is string => note !== null);
  return (
    <>
      <p className="m-0 text-sm font-[650] text-ink">{line}</p>
      {notes.map((note) => (
        <p key={note} className="m-0 text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      <NoScore crawl={crawl} />
    </>
  );
}
