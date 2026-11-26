import { useRef, useState } from 'react';
import { ChevronDownIcon } from '@/components/icons.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useApi } from '@/lib/api/index.ts';
import {
  APPLIED_STAGES,
  type AppliedStage,
  companyName,
  type JobSummary,
  setStage,
} from '@/lib/api/jobs.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';

const text = copy.applicationsPage.stage;

/**
 * An applied job's stage, set in its Applications row (#52 PR D): a native select (it suits a
 * phone, and every screen reader knows it). A choice saves at once, from the stage saved before
 * it (`from`), so a job changed in another tab is refused, never overwritten.
 *
 * A closed select can change with each arrow key (Windows, Firefox): every step is a choice. So
 * the newest choice always shows, and saves are one at a time: one made while another saves waits
 * for it, then saves from the stage it saved, and only the newest waiting one is sent. A failure
 * stops there: the stage saved shows again. The list keeps each save (`onSaved`) and says how the
 * choice ended, once (`onDone`, `onFailed`).
 */
export function StageSelect({
  job,
  onSaved,
  onDone,
  onFailed,
}: {
  job: JobSummary;
  onSaved: (job: JobSummary) => void;
  onDone: (job: JobSummary) => void;
  onFailed: (job: JobSummary, error: unknown) => void;
}) {
  const api = useApi();
  // The choice shown until its save ends (null: the stage saved).
  const [wanted, setWanted] = useState<AppliedStage | null>(null);
  const wantedNow = useRef<AppliedStage | null>(null);
  const saving = useRef(false);
  const showSaving = useDelayedPending(wanted !== null);
  const shown = job.status;
  if (!isAppliedStage(shown)) return null;
  async function save(from: AppliedStage) {
    saving.current = true;
    let at = from;
    let last: JobSummary | null = null;
    try {
      // The newest choice, until the stage saved is it.
      for (let next = wantedNow.current; next !== null && next !== at; next = wantedNow.current) {
        last = await setStage(api, job.jobId, next, at);
        onSaved(last);
        if (!isAppliedStage(last.status)) break;
        at = last.status;
      }
      if (last) onDone(last);
    } catch (error) {
      onFailed(job, error);
    } finally {
      saving.current = false;
      wantedNow.current = null;
      setWanted(null);
    }
  }
  return (
    <span className="relative inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
      {/* Drawn by us (appearance-none, our chevron): every browser the same 44px box. */}
      <span className="relative inline-grid max-w-full">
        <select
          value={wanted ?? shown}
          aria-label={fill(text.label, { title: job.title, company: companyName(job) })}
          onChange={(event) => {
            const next = event.target.value;
            if (!isAppliedStage(next)) return;
            wantedNow.current = next;
            setWanted(next);
            if (!saving.current) void save(shown);
          }}
          className="min-h-11 max-w-full cursor-pointer appearance-none rounded-[11px] border border-line bg-surface ps-[13px] pe-[38px] text-sm font-[650] text-ink transition-colors duration-180 outline-none hover:border-line-strong hover:bg-surface-strong focus-visible:border-green focus-visible:shadow-[0_0_0_4px_var(--color-green-wash)] motion-reduce:transition-none forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-solid"
        >
          {APPLIED_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {text.names[stage]}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute end-[13px] top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
      </span>
      {/* Seen only: the list says the outcome out loud. */}
      {showSaving && (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Spinner />
          {text.saving}
        </span>
      )}
    </span>
  );
}

export function isAppliedStage(stage: string | undefined): stage is AppliedStage {
  return (APPLIED_STAGES as readonly string[]).includes(stage ?? '');
}
