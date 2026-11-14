import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryRegion, type QueryState } from '../src/components/ui/query-region.tsx';
import { Skeleton } from '../src/components/ui/skeleton.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const loading: QueryState<string[]> = {
  data: undefined,
  isLoading: true,
  isFetching: true,
  isError: false,
};
const loaded: QueryState<string[]> = {
  data: ['Staff engineer'],
  isLoading: false,
  isFetching: false,
  isError: false,
};

function Region({ query }: { query: QueryState<string[]> }) {
  return (
    <QueryRegion
      query={query}
      skeleton={{ kind: 'rows', rows: 2 }}
      label="Loading your matches"
      error={<p>Could not load.</p>}
    >
      {(jobs) => <p>{jobs.join(', ')}</p>}
    </QueryRegion>
  );
}

const region = () => document.querySelector('[data-slot="query-region"]') as HTMLElement;
/** The part screen readers are told is busy: the content, not the status line beside it. */
const content = () => document.querySelector('[data-slot="query-region-content"]') as HTMLElement;
const skeleton = () => document.querySelector('[data-slot="skeleton"]');
const status = () => screen.getByRole('status').textContent;

describe('Skeleton', () => {
  it('is decorative and stands for its rows', () => {
    render(<Skeleton kind="cards" rows={4} />);
    expect(skeleton()?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton()?.getAttribute('data-kind')).toBe('cards');
    expect((skeleton() as HTMLElement).style.getPropertyValue('--skeleton-rows')).toBe('4');
  });

  it('keeps its rows between 1 and 48', () => {
    const { rerender } = render(<Skeleton rows={0} />);
    expect((skeleton() as HTMLElement).style.getPropertyValue('--skeleton-rows')).toBe('1');
    rerender(<Skeleton rows={500} />);
    expect((skeleton() as HTMLElement).style.getPropertyValue('--skeleton-rows')).toBe('48');
    rerender(<Skeleton rows={Number.NaN} />);
    expect((skeleton() as HTMLElement).style.getPropertyValue('--skeleton-rows')).toBe('1');
  });

  it('defaults to one block', () => {
    render(<Skeleton />);
    expect(skeleton()?.getAttribute('data-kind')).toBe('block');
    expect((skeleton() as HTMLElement).style.getPropertyValue('--skeleton-rows')).toBe('3');
  });
});

describe('QueryRegion', () => {
  it('holds a first load blank and busy for 300 ms, then shows the skeleton and says what loads', () => {
    render(<Region query={loading} />);
    expect(content().getAttribute('aria-busy')).toBe('true');
    expect(skeleton()?.className).toContain('invisible');
    expect(status()).toBe('');

    act(() => vi.advanceTimersByTime(299));
    expect(skeleton()?.className).toContain('invisible');
    act(() => vi.advanceTimersByTime(1));
    expect(skeleton()?.className).not.toContain('invisible');
    expect(region().dataset.state).toBe('loading');
    expect(status()).toBe('Loading your matches');
  });

  it('shows data that arrives within 300 ms at once, with no skeleton', () => {
    const { rerender } = render(<Region query={loading} />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<Region query={loaded} />);
    expect(screen.getByText('Staff engineer')).toBeTruthy();
    expect(skeleton()).toBeNull();
    expect(content().hasAttribute('aria-busy')).toBe(false);
    expect(status()).toBe('');
  });

  it('keeps a shown skeleton 500 ms even when the data comes sooner', () => {
    const { rerender } = render(<Region query={loading} />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<Region query={loaded} />);
    act(() => vi.advanceTimersByTime(499));
    expect(skeleton()).not.toBeNull();
    expect(screen.queryByText('Staff engineer')).toBeNull();
    expect(content().getAttribute('aria-busy')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(skeleton()).toBeNull();
    expect(screen.getByText('Staff engineer')).toBeTruthy();
    expect(content().hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps data on screen while it refreshes, adding a quiet note after 300 ms', () => {
    render(<Region query={{ ...loaded, isFetching: true }} />);
    expect(screen.getByText('Staff engineer')).toBeTruthy();
    expect(content().getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Updating…')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('Updating…').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(region().dataset.state).toBe('refreshing');
    expect(skeleton()).toBeNull();
    // Nothing read out for a background refresh.
    expect(status()).toBe('');
  });

  it('hands a failed first load to its error', () => {
    render(<Region query={{ ...loading, isLoading: false, isFetching: false, isError: true }} />);
    expect(screen.getByText('Could not load.')).toBeTruthy();
    expect(content().hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps the data it has when a refresh fails', () => {
    render(<Region query={{ ...loaded, isError: true }} />);
    expect(screen.getByText('Staff engineer')).toBeTruthy();
    expect(screen.queryByText('Could not load.')).toBeNull();
  });

  it('shows nothing for a query that is not running and has no data', () => {
    render(<Region query={{ ...loading, isLoading: false, isFetching: false }} />);
    expect(skeleton()).toBeNull();
    expect(content().hasAttribute('aria-busy')).toBe(false);
    expect(region().textContent).toBe('');
  });

  it('keeps its status line outside the busy content', () => {
    render(<Region query={loading} />);
    expect(content().contains(screen.getByRole('status'))).toBe(false);
  });
});
