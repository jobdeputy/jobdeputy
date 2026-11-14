import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryStrip } from '../src/components/landing/story-strip.tsx';

afterEach(cleanup);

describe('StoryStrip', () => {
  it('marks only the current step', () => {
    render(<Strip current={1} />);
    const steps = screen.getAllByRole('button');
    expect(steps.map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });

  it('names each step by its number, title and line, and shows its chapter when pressed', () => {
    const onSelect = vi.fn();
    render(<Strip current={0} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole('button', { name: '3 It applies Tailored, then applied once you approve.' }),
    );
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});

describe('StoryStrip progress', () => {
  const bar = () => document.querySelector<HTMLElement>('[data-bar]');

  it("gives the current step a bar that fills over the step's time", () => {
    render(<Strip current={1} progress="filling" duration={4400} />);
    const steps = screen.getAllByRole('button');
    expect(steps.map((step) => step.dataset.progress)).toEqual([undefined, 'filling', undefined]);
    expect(steps[1]?.contains(bar())).toBe(true);
    expect(bar()?.style.animationDuration).toBe('4400ms');
    expect(bar()?.className).toContain('animate-strip-fill');
  });

  it('holds the bar part-way on Pause, empties it while waiting, and shows it full otherwise', () => {
    const { rerender } = render(<Strip current={0} progress="held" />);
    expect(bar()?.style.animationPlayState).toBe('paused');
    rerender(<Strip current={0} progress="waiting" />);
    expect(bar()?.className).toContain('scale-x-0');
    rerender(<Strip current={0} progress="full" />);
    expect(bar()?.className).not.toContain('animate-strip-fill');
  });

  it('starts the bar over for a new run, and keeps it for the same one', () => {
    const { rerender } = render(<Strip current={0} progress="filling" run={1} />);
    const first = bar();
    rerender(<Strip current={0} progress="held" run={1} />);
    expect(bar()).toBe(first);
    rerender(<Strip current={0} progress="filling" run={2} />);
    expect(bar()).not.toBe(first);
  });

  it('moves the story on as soon as Play comes, when the bar filled just as it was paused', () => {
    const onStepEnd = vi.fn();
    const { rerender } = render(<Strip current={1} progress="held" onStepEnd={onStepEnd} />);
    bar()?.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(onStepEnd).not.toHaveBeenCalled();
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).toHaveBeenCalledTimes(1);
  });

  it('forgets a bar that filled during a hold the story left another way', () => {
    const onStepEnd = vi.fn();
    const { rerender } = render(<Strip current={1} progress="held" onStepEnd={onStepEnd} />);
    bar()?.dispatchEvent(new Event('animationend', { bubbles: true }));
    // The same step chosen again (or reduced motion): its bar shows full, then plays afresh.
    rerender(<Strip current={1} progress="full" onStepEnd={onStepEnd} />);
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).not.toHaveBeenCalled();
  });

  it('tells the story when the bar has filled while playing, and only then', () => {
    const onStepEnd = vi.fn();
    const end = () => new Event('animationend', { bubbles: true });
    // A full bar (a chosen step) does not move the story on.
    const { rerender } = render(<Strip current={1} progress="full" onStepEnd={onStepEnd} />);
    bar()?.dispatchEvent(end());
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).not.toHaveBeenCalled();
    bar()?.dispatchEvent(end());
    expect(onStepEnd).toHaveBeenCalledTimes(1);
  });
});

/** The strip with every prop it needs; tests change what they look at. */
function Strip(props: Partial<Parameters<typeof StoryStrip>[0]>) {
  return (
    <StoryStrip
      current={0}
      progress="full"
      duration={4100}
      run={0}
      onSelect={() => {}}
      onStepEnd={() => {}}
      {...props}
    />
  );
}
