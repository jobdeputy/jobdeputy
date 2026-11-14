import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STEP_TOOLS, StoryStrip } from '../src/components/landing/story-strip.tsx';
import { copy } from '../src/copy/index.ts';

afterEach(cleanup);

describe('StoryStrip', () => {
  it('has one tool for every step in the copy', () => {
    expect(STEP_TOOLS.length).toBe(copy.landing.steps.items.length);
  });

  it('marks only the current step', () => {
    render(<StoryStrip current={1} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });
});
