import { useListVersion, useRenderAtDeadline } from '@/components/jobs/latest-crawl.ts';
import { MatchesList } from '@/components/jobs/matches-list.tsx';
import { PageIntro } from '@/components/page-intro.tsx';
import { copy } from '@/copy/index.ts';
import { listProgressKey, useLatestCrawl } from '@/lib/api/crawls.ts';

const text = copy.matchesPage;

/**
 * The Matches tab (#52), where the app opens: the jobs not applied to yet (MatchesList), read
 * again whenever a crawl's work ends, and in place as a list run's companies are read, so a link
 * given in Search shows here as it is read.
 */
export function MatchesPage({ checkEvery }: { checkEvery?: number }) {
  const latest = useLatestCrawl(checkEvery);
  const crawl = latest.data ?? null;
  useRenderAtDeadline(crawl);
  const listVersion = useListVersion(latest);
  return (
    // Wide enough for the table beside a job's pane; the intro keeps its measure.
    <div className="grid w-full max-w-[1240px] content-start gap-8">
      <div className="max-w-[880px]">
        <PageIntro
          id="matches-title"
          eyebrow={text.eyebrow}
          title={text.title}
          intro={text.intro}
        />
      </div>
      <MatchesList
        version={listVersion}
        progress={listProgressKey(crawl)}
        offline={latest.isPaused}
      />
    </div>
  );
}
