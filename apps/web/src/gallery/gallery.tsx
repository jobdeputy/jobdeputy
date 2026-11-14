import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Spinner } from '@/components/ui/spinner.tsx';

/**
 * Every shared component in every state, on one page, for review and for the screenshots CI posts
 * on UI pull requests (#17). Dev and test builds only: the production build leaves gallery.html
 * out (vite.config.ts). Its words are for developers and never ship, so they stay here: en.ts is
 * part of the production bundle, and the copy rule (decision 0012) covers words users see.
 */
export function Gallery() {
  return (
    <main className="mx-auto grid max-w-3xl gap-10 px-4 py-10 sm:px-8">
      <header className="grid gap-2">
        <h1 className="m-0 font-display text-[2.5rem]/[1.1] font-normal">Component gallery</h1>
        <p className="m-0 text-muted-foreground">
          Loading states (#17). Waits under 300 ms show nothing; once shown, a state stays at least
          500 ms.
        </p>
      </header>

      <Section title="Spinner">
        <div className="flex flex-wrap items-center gap-6">
          <Spinner />
          <Spinner size="md" />
          <p className="m-0 inline-flex items-center gap-2 text-sm">
            <Spinner /> Checking your sources now.
          </p>
          <p className="m-0 inline-flex items-center gap-2 text-sm text-green-ink">
            <Spinner /> Saving…
          </p>
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Sign in</Button>
          <Button pending pendingLabel="Signing in…">
            Sign in
          </Button>
          <Button success successLabel="Signed in">
            Sign in
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline">Save draft</Button>
          <Button variant="outline" pending pendingLabel="Saving…">
            Save draft
          </Button>
          <Button variant="outline" success successLabel="Saved">
            Save draft
          </Button>
        </div>
        <LiveButton />
      </Section>

      <Section title="Progress">
        <Progress label="Uploading résumé" value={0} />
        <Progress label="Uploading résumé" value={40} />
        <Progress label="Uploading résumé" value={100} />
        <Progress label="Preparing your desk" value={null} />
        <LiveProgress />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="m-0 border-b border-line pb-2 font-display text-2xl font-normal">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The whole cycle, live: "Try a save" starts fake work that runs until "Finish the save" ends it
 * in success, which stays until "Start over". No timers, so a test decides when each step ends.
 */
function LiveButton() {
  const [state, setState] = useState<'idle' | 'pending' | 'success'>('idle');
  const [runs, setRuns] = useState(0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="lg"
        data-testid="live-button"
        pending={state === 'pending'}
        pendingLabel="Saving…"
        success={state === 'success'}
        successLabel="Saved"
        onClick={() => {
          setRuns((n) => n + 1);
          setState('pending');
        }}
      >
        Try a save
      </Button>
      <Button
        variant="outline"
        aria-disabled={state === 'idle' || undefined}
        onClick={() => setState(state === 'pending' ? 'success' : 'idle')}
      >
        {state === 'success' ? 'Start over' : 'Finish the save'}
      </Button>
      <p className="m-0 text-sm text-muted-foreground" data-testid="live-button-runs">
        Started {runs} {runs === 1 ? 'time' : 'times'}
      </p>
    </div>
  );
}

/** A bar that fills over 4s, for watching the easing and the quarter announcements. */
function LiveProgress() {
  const [value, setValue] = useState<number | null>(null);
  const running = value !== null && value < 100;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setValue((v) => Math.min(100, (v ?? 0) + 5)), 200);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <div className="grid gap-3">
      <Button variant="outline" className="justify-self-start" onClick={() => setValue(0)}>
        Run an upload
      </Button>
      {value !== null && <Progress label="Uploading cover letter" value={value} />}
    </div>
  );
}
