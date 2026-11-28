import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from './api.ts';
import type { SignInOutcome } from './auth/session.ts';
import { copy, fill } from './copy.ts';
import { DevTag } from './dev-tag.tsx';
import type { Request, Responses, Status } from './messages.ts';
import type { Readiness } from './readiness.ts';

/** Asks the service worker (`browser.runtime.sendMessage`), or a fake in tests. */
export type Send = <R extends Request>(request: R) => Promise<Responses[R['type']] | null>;

/** The worker's answer, or null when it failed or couldn't be reached (never a throw). */
async function ask<R extends Request>(send: Send, request: R) {
  try {
    return (await send(request)) ?? null;
  } catch {
    return null;
  }
}

const text = copy.popup;

const primary =
  'inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-[translate,background-color] duration-180 ease-settle hover:-translate-y-px hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none';
const quiet =
  'cursor-pointer rounded-full text-sm font-semibold text-accent-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring';

/**
 * The toolbar popup (#54): sign in, who is signed in, and what the deputy can fill in for them.
 * The fill status of the open application comes with the Greenhouse filler (PR C).
 */
export function Popup({
  version,
  send,
  siteUrl,
}: {
  version: string;
  send: Send;
  siteUrl?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [broken, setBroken] = useState(false);
  const [outcome, setOutcome] = useState<
    Exclude<SignInOutcome, 'signed-in'> | 'interrupted' | null
  >(null);

  const refresh = useCallback(async () => {
    const next = await ask(send, { type: 'status' });
    setBroken(next === null);
    // Nothing stale beside the alert: the view shows only what the worker just said.
    setStatus(next);
    if (next?.state === 'signed-out' && next.interrupted) setOutcome('interrupted');
  }, [send]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Opened while a sign-in is at work (Chrome closed the popup when its window opened): wait for
  // that one (asking again joins it) and show how it went.
  const [startedHere, setStartedHere] = useState(false);
  const atWork = status?.state === 'signed-out' && status.signingIn && !startedHere;
  useEffect(() => {
    if (!atWork) return;
    let current = true;
    void ask(send, { type: 'sign-in-wait' }).then(async (result) => {
      if (!current) return;
      if (result && result !== 'signed-in') setOutcome(result);
      await refresh();
    });
    return () => {
      current = false;
    };
  }, [atWork, send, refresh]);

  const signIn = async (different: boolean) => {
    setOutcome(null);
    setStartedHere(true);
    setStatus((now) => (now && now.state !== 'unconfigured' ? { ...now, signingIn: true } : now));
    const result = (await ask(send, { type: 'sign-in', different })) ?? 'failed';
    setStartedHere(false);
    if (result !== 'signed-in') setOutcome(result);
    await refresh();
  };

  const signOut = async () => {
    setOutcome(null);
    await ask(send, { type: 'sign-out' });
    await refresh();
  };

  const primaryLabel =
    status?.state !== 'signed-out'
      ? ''
      : status.signingIn
        ? text.signingIn
        : status.lastEmail
          ? fill(text.continueAs, { email: status.lastEmail })
          : text.signIn;

  return (
    <main className="grid w-[340px] grid-cols-1 gap-3 p-[21px]">
      <header className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="m-0 font-display text-[1.75rem] leading-none font-medium tracking-[-0.04em]">
            {text.title}
          </h1>
          <DevTag />
        </div>
        <p className="m-0 text-sm leading-normal text-muted-foreground">{text.line}</p>
      </header>

      {broken && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {text.broken}
        </p>
      )}
      {status?.state === 'unconfigured' && <p className="m-0 text-sm">{text.unconfigured}</p>}

      {status?.state === 'signed-out' && (
        <section className="grid grid-cols-1 gap-2" aria-label={text.signIn}>
          <button
            type="button"
            className={primary}
            disabled={status.signingIn}
            title={primaryLabel}
            onClick={() => void signIn(false)}
          >
            {/* One line: a long email is cut, and said whole in the title. */}
            <span className="min-w-0 truncate">{primaryLabel}</span>
          </button>
          {status.lastEmail && !status.signingIn && (
            <button
              type="button"
              className={`${quiet} justify-self-center`}
              onClick={() => void signIn(true)}
            >
              {text.differentAccount}
            </button>
          )}
          <p className="m-0 text-xs text-muted-foreground">
            {status.signingIn ? text.signingInNote : text.signInNote}
          </p>
          {outcome && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {text.outcomes[outcome]}
            </p>
          )}
        </section>
      )}

      {status?.state === 'signed-in' && (
        <SignedIn
          email={status.email}
          send={send}
          onSignOut={() => void signOut()}
          onSignedOut={refresh}
          {...(siteUrl ? { siteUrl } : {})}
        />
      )}

      <p className="m-0 text-xs text-quiet">{fill(text.version, { version })}</p>
    </main>
  );
}

const PLACES: { key: keyof Readiness; label: string; path: string }[] = [
  { key: 'details', label: text.ready.details, path: '/profile' },
  { key: 'resume', label: text.ready.resume, path: '/resumes' },
  { key: 'answers', label: text.ready.answers, path: '/profile' },
];

function SignedIn({
  email,
  send,
  siteUrl,
  onSignOut,
  onSignedOut,
}: {
  email: string | undefined;
  send: Send;
  siteUrl?: string;
  onSignOut: () => void;
  /** Stable (a `useCallback`): reading again depends on it. */
  onSignedOut: () => unknown;
}) {
  const [readiness, setReadiness] = useState<ApiResult<Readiness> | null>(null);

  const read = useCallback(async () => {
    setReadiness(null);
    const result: ApiResult<Readiness> = (await ask(send, { type: 'readiness' })) ?? {
      ok: false,
      reason: 'failed',
    };
    // Never left on "Checking…": signed out shows as a failed read until sign-in shows.
    setReadiness(
      result.ok || result.reason !== 'signed-out' ? result : { ok: false, reason: 'failed' },
    );
    if (!result.ok && result.reason === 'signed-out') onSignedOut();
  }, [send, onSignedOut]);
  useEffect(() => {
    void read();
  }, [read]);

  return (
    <>
      <p className="m-0 truncate text-sm font-[650]">
        {email ? fill(text.signedInAs, { email }) : text.signedIn}
      </p>
      <section
        aria-labelledby="ready-heading"
        aria-busy={readiness === null}
        className="grid gap-2 rounded-[13px] border border-border bg-card p-3"
      >
        <h2
          id="ready-heading"
          className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {text.ready.heading}
        </h2>
        {readiness === null && (
          <p className="m-0 text-sm text-muted-foreground">{text.ready.checking}</p>
        )}
        {readiness && !readiness.ok && (
          <div className="grid justify-items-start gap-1">
            <p role="alert" className="m-0 text-sm text-destructive">
              {readiness.reason === 'offline' ? text.ready.offline : text.ready.failed}
            </p>
            <button type="button" className={quiet} onClick={() => void read()}>
              {text.ready.retry}
            </button>
          </div>
        )}
        {readiness?.ok && (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {PLACES.map(({ key, label, path }) => {
              const value = readiness.body[key];
              // Details and answers are counted ("3 of 10 saved"); the résumé is there or not.
              const counted = typeof value === 'object' ? value : null;
              // Ticked once what nearly every form asks is saved; the count says the rest.
              const done = counted ? counted.ready : value === true;
              const more = counted !== null && counted.answered < counted.total;
              const status = counted
                ? fill(text.ready.count, {
                    answered: String(counted.answered),
                    total: String(counted.total),
                  })
                : done
                  ? text.ready.done
                  : text.ready.missing;
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`grid size-4 shrink-0 place-items-center rounded-full text-[0.625rem] leading-none ${done ? 'bg-accent-foreground text-primary-foreground' : 'border border-input'}`}
                  >
                    {done ? '✓' : ''}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span>
                      {label}
                      <span className="sr-only">: </span>
                    </span>
                    {counted && done && more && siteUrl ? (
                      // Ready, with more a form might ask: the count leads to where they're added.
                      <a
                        className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        href={`${siteUrl}${path}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {status}
                      </a>
                    ) : counted ? (
                      <span className="text-xs text-muted-foreground">{status}</span>
                    ) : (
                      <span className="sr-only">{status}</span>
                    )}
                  </span>
                  {!done && siteUrl && (
                    <a
                      className={quiet}
                      href={`${siteUrl}${path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {text.ready.add}
                    </a>
                  )}
                  {!done && !siteUrl && !counted && (
                    <span aria-hidden="true" className="text-xs text-muted-foreground">
                      {text.ready.missing}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <button type="button" className={`${quiet} justify-self-start`} onClick={onSignOut}>
        {text.signOut}
      </button>
    </>
  );
}
