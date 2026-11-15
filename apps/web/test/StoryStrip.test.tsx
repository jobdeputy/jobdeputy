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
  /** What the bar asks the Web Animations API for, and a handle to finish it as a browser would. */
  function recordBar() {
    const bars: (Animation & { calls: string[]; options: KeyframeAnimationOptions })[] = [];
    vi.spyOn(Element.prototype, 'animate').mockImplementation(((
      _keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const calls: string[] = [];
      const fake = {
        calls,
        options,
        currentTime: 0 as number | null,
        onfinish: null as ((event: AnimationPlaybackEvent) => void) | null,
        play: () => calls.push('play'),
        pause: () => calls.push('pause'),
        cancel: () => calls.push('cancel'),
      };
      bars.push(fake as unknown as (typeof bars)[number]);
      return fake as unknown as Animation;
    }) as Element['animate']);
    const finish = (index = bars.length - 1) =>
      bars[index]?.onfinish?.call(bars[index], {} as AnimationPlaybackEvent);
    return { bars, finish };
  }

  afterEach(() => vi.restoreAllMocks());

  it("fills the current step's bar over the step's time", () => {
    const { bars } = recordBar();
    render(<Strip current={1} progress="filling" duration={4400} />);
    const steps = screen.getAllByRole('button');
    expect(steps.map((step) => step.dataset.progress)).toEqual([undefined, 'filling', undefined]);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.options).toMatchObject({ duration: 4400, easing: 'linear', fill: 'both' });
    expect(bars[0]?.calls.at(-1)).toBe('play');
  });

  it('holds the bar on Pause, shows it empty while waiting and full otherwise', () => {
    const { bars } = recordBar();
    const { rerender } = render(<Strip current={0} progress="filling" />);
    rerender(<Strip current={0} progress="held" />);
    expect(bars[0]?.calls.at(-1)).toBe('pause');
    rerender(<Strip current={0} progress="waiting" />);
    expect(bars[0]?.currentTime).toBe(0);
    rerender(<Strip current={0} progress="full" />);
    expect(bars[0]?.currentTime).toBe(4100);
    // Play goes on from where it was: the same animation, played.
    rerender(<Strip current={0} progress="filling" />);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.calls.at(-1)).toBe('play');
  });

  it('starts the bar over for a new run, and keeps it for the same one', () => {
    const { bars } = recordBar();
    const { rerender } = render(<Strip current={0} progress="filling" run={1} />);
    rerender(<Strip current={0} progress="held" run={1} />);
    expect(bars).toHaveLength(1);
    rerender(<Strip current={0} progress="filling" run={2} />);
    expect(bars).toHaveLength(2);
    expect(bars[0]?.calls).toContain('cancel');
  });

  it('tells the story when the bar has filled while playing, and only then', () => {
    const { finish } = recordBar();
    const onStepEnd = vi.fn();
    const { rerender } = render(<Strip current={1} progress="full" onStepEnd={onStepEnd} />);
    finish();
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).not.toHaveBeenCalled();
    finish();
    expect(onStepEnd).toHaveBeenCalledTimes(1);
  });

  it('moves the story on as soon as Play comes, when the bar filled just as it was paused', () => {
    const { finish } = recordBar();
    const onStepEnd = vi.fn();
    const { rerender } = render(<Strip current={1} progress="held" onStepEnd={onStepEnd} />);
    finish();
    expect(onStepEnd).not.toHaveBeenCalled();
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).toHaveBeenCalledTimes(1);
  });

  it('forgets a bar that filled during a hold the story left another way', () => {
    const { finish } = recordBar();
    const onStepEnd = vi.fn();
    const { rerender } = render(<Strip current={1} progress="held" onStepEnd={onStepEnd} />);
    finish();
    rerender(<Strip current={1} progress="full" onStepEnd={onStepEnd} />);
    rerender(<Strip current={1} progress="filling" onStepEnd={onStepEnd} />);
    expect(onStepEnd).not.toHaveBeenCalled();
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
