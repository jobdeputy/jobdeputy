import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Progress } from '../src/components/ui/progress.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Progress', () => {
  it('is a progress bar named by its visible label, with its value', () => {
    render(<Progress label="Uploading résumé" value={40} />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading résumé' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe('40%');
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('holds an out-of-range value to the track', () => {
    render(<Progress label="Uploading" value={104} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('reads out a quarter it first appears past, once its status region has settled', () => {
    vi.useFakeTimers();
    render(<Progress label="Uploading résumé" value={30} />);
    const status = screen.getByRole('status');
    // Empty at first, effects and all: screen readers skip text a live region is born with.
    expect(status.textContent).toBe('');
    act(() => vi.advanceTimersByTime(99));
    expect(status.textContent).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(status.textContent).toBe('Uploading résumé, 25%');
  });

  it('starts a new fill when the length becomes known', () => {
    const { rerender } = render(<Progress label="Uploading" value={null} />);
    const sweep = screen.getByRole('progressbar').firstElementChild;
    rerender(<Progress label="Uploading" value={10} />);
    expect(screen.getByRole('progressbar').firstElementChild).not.toBe(sweep);
  });

  it('reads 100% only when the work is done', () => {
    render(<Progress label="Uploading" value={99.6} />);
    expect(screen.getByText('99%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('99%');
  });

  it('treats a value that is not a number as unknown length', () => {
    render(<Progress label="Uploading" value={Number.NaN} />);
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('has no value and no percentage while the length is unknown', () => {
    render(<Progress label="Preparing your desk" value={null} />);
    const bar = screen.getByRole('progressbar', { name: 'Preparing your desk' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('reads out each quarter once, and again after the value drops back', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Progress label="Uploading résumé" value={10} />);
    act(() => vi.advanceTimersByTime(100));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    rerender(<Progress label="Uploading résumé" value={26} />);
    expect(status.textContent).toBe('Uploading résumé, 25%');
    rerender(<Progress label="Uploading résumé" value={49} />);
    expect(status.textContent).toBe('Uploading résumé, 25%');
    rerender(<Progress label="Uploading résumé" value={100} />);
    expect(status.textContent).toBe('Uploading résumé, 100%');
    rerender(<Progress label="Uploading résumé" value={3} />);
    expect(status.textContent).toBe('');
  });
});
