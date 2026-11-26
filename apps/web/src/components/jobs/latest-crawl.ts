import { useEffect, useReducer, useRef } from 'react';
import {
  type Crawl,
  isCrawling,
  isStalled,
  type useLatestCrawl,
  workDeadline,
} from '@/lib/api/crawls.ts';

/** Following the newest crawl, shared by the Search and Matches tabs (#52). */

/**
 * What the companies list reflects: the newest crawl whose work ended, and how (read, scored, or
 * stalled; a crawl that failed changed nothing). A new version reads the list again from the
 * start, so a crawl that ended in another tab, or later than it seemed to (a stall that then
 * finished), counts too. While a crawl is at work the version stays (a list run's companies
 * are read again in place as each one ends: `listProgressKey` in lib/api/crawls.ts). Undefined
 * until the newest crawl is known, so the list is never read just before a crawl is seen as ended.
 */
export function useListVersion(latest: ReturnType<typeof useLatestCrawl>): string | undefined {
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
export function useRenderAtDeadline(crawl: Crawl | null) {
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
