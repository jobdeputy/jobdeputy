import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryStrip } from '../src/components/landing/story-strip.tsx';

afterEach(cleanup);

describe('StoryStrip', () => {
  it('marks only the current step', () => {
    render(<StoryStrip current={1} onSelect={() => {}} />);
    const steps = screen.getAllByRole('button');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });

  it('names each step by its number, title and line, and shows its chapter when pressed', () => {
    const onSelect = vi.fn();
    render(<StoryStrip current={0} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole('button', { name: '3 It applies Tailored, then applied once you approve.' }),
    );
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
