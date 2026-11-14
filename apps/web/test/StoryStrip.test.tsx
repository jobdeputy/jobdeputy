import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryStrip } from '../src/components/landing/story-strip.tsx';

afterEach(cleanup);

describe('StoryStrip', () => {
  it('marks only the current step', () => {
    render(<StoryStrip current={1} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });
});
