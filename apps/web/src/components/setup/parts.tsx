import { useCallback, useEffect, useRef, useState } from 'react';
import { PageIntro } from '@/components/page-intro.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill, plural } from '@/copy/index.ts';
import { ApiError, DEFAULT_RETRY_AFTER_SECONDS, isFinal } from '@/lib/api/index.ts';
import { LIVE_REGION_BEAT_MS } from '@/lib/live-region.ts';

/** How long words stay in a step's status line after being said (they are read when they arrive). */
const SPOKEN_FOR_MS = 5000;

/** A step's heading: the page intro, under the set-up's title id (each step's section is named by it). */
export function StepIntro(props: { eyebrow: string; title: string; intro: string }) {
  return <PageIntro id="set-up-title" {...props} />;
}

/** One fact about the account: what it is, its value, and a pill where it is fixed. */
export function Fact({ label, value, pill }: { label: string; value: string; pill?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[15px] border border-line-soft bg-surface px-4 py-3">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-xs font-[650] text-muted-foreground">{label}</span>
        <strong className="min-w-0 text-[0.9375rem] font-[650] wrap-anywhere">{value}</strong>
      </span>
      {pill && (
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-[650] text-muted-foreground">
          {pill}
        </span>
      )}
    </li>
  );
}

/**
 * Why a step's save was refused, in the person's words, for the refusals every step meets the
 * same way (a step reads conflicts, lost answers and wrong fields itself first).
 */
export function refusalText(error: unknown): string {
  const errors = copy.setUp.errors;
  const kind = error instanceof ApiError ? error.kind : 'server';
  if (kind === 'too-many' && error instanceof ApiError) {
    return fill(errors.tooMany, {
      wait: waitText(error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS),
    });
  }
  if (kind === 'forbidden') return errors.accountClosed;
  if (kind === 'signed-out') return errors.signedOut;
  if (kind === 'offline') return errors.saveFailed;
  return errors.tryLater;
}

/** A wait in words: "1 second", "30 seconds", "2 minutes". */
function waitText(seconds: number): string {
  const units = copy.setUp.errors.units;
  return seconds < 60
    ? plural(units.seconds, seconds)
    : plural(units.minutes, Math.ceil(seconds / 60));
}

/**
 * A step's status line: `say(words)` clears it, then says `words` a beat later, so the same words
 * said again are read again; then clears it, so reading through the step doesn't meet them twice.
 * `hush()` clears it now (what was said, or about to be, no longer holds). `spoken` is what the
 * line says now.
 */
export function useSaying(): {
  spoken: string;
  say: (words: string) => void;
  hush: () => void;
} {
  const [spoken, setSpoken] = useState('');
  const saying = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(saying.current), []);
  const say = useCallback((words: string) => {
    clearTimeout(saying.current);
    setSpoken('');
    saying.current = setTimeout(() => {
      setSpoken(words);
      saying.current = setTimeout(() => setSpoken(''), SPOKEN_FOR_MS);
    }, LIVE_REGION_BEAT_MS);
  }, []);
  const hush = useCallback(() => {
    clearTimeout(saying.current);
    setSpoken('');
  }, []);
  return { spoken, say, hush };
}

/**
 * What a step loaded could not be read: say why, and offer to try again where that can help (not
 * once the session has ended or the account is closed; Sign out is in the header).
 */
export function LoadFailed({
  error,
  message,
  retry,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  /** Why, when trying again can help. */
  message: string;
  retry: string;
  onRetry: () => void;
  /** The retry is on its way: its button shows it (#49). */
  retrying?: boolean;
}) {
  const final = isFinal(error);
  return (
    <div className="grid justify-items-start gap-3">
      <p role="alert" className="m-0 text-sm font-[650] text-danger-ink">
        {final ? refusalText(error) : message}
      </p>
      {!final && (
        <Button variant="outline" pending={retrying} onClick={onRetry}>
          {retry}
        </Button>
      )}
    </div>
  );
}
