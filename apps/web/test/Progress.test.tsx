import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Progress } from '../src/components/ui/progress.tsx';

afterEach(cleanup);

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

  it('has no value and no percentage while the length is unknown', () => {
    render(<Progress label="Preparing your desk" value={null} />);
    const bar = screen.getByRole('progressbar', { name: 'Preparing your desk' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('reads out each quarter once, and again after the value drops back', () => {
    const { rerender } = render(<Progress label="Uploading résumé" value={10} />);
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
