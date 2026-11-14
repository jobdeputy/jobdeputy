import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panda, type PandaPose } from '../src/components/deputy/panda.tsx';

afterEach(() => {
  cleanup();
  // Even when a test fails part-way: real timers and an unmocked Math.random for the next.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Each prop's first path, which tells it apart. */
const PROP_MARKS = {
  pencil: 'path.stroke-orange[d="M-8 9L34 -33"]',
  magnifier: 'path.stroke-blue[d="M3 -4L20 -26"]',
  approval: 'rect.fill-paper[y="-110"]',
  hourglass: 'path.stroke-line-strong[d^="M2 -84"]',
} as const;

function shownProps(container: HTMLElement) {
  return Object.entries(PROP_MARKS)
    .filter(([, mark]) => container.querySelector(mark)?.closest('g.opacity-100'))
    .map(([name]) => name);
}

const armTurn = (container: HTMLElement) =>
  (container.querySelector('g.origin-\\[257\\.3px_261\\.16px\\]') as SVGGElement | null)?.style
    .transform;

describe('Panda', () => {
  it.each<[PandaPose, string, string]>([
    ['setup', 'pencil', 'rotate(-48.5deg)'],
    ['search', 'magnifier', 'rotate(-80.5deg)'],
    ['apply', 'approval', 'rotate(22deg)'],
    ['pending', 'hourglass', 'rotate(-34deg)'],
  ])('holds one prop in the %s pose', (pose, prop, arm) => {
    const { container } = render(<Panda pose={pose} />);
    expect(shownProps(container)).toEqual([prop]);
    expect(armTurn(container)).toBe(arm);
  });

  it('defaults to setting up', () => {
    const { container } = render(<Panda />);
    expect(shownProps(container)).toEqual(['pencil']);
  });

  it('looks where the pose looks: up while pending', () => {
    const { container } = render(<Panda pose="pending" />);
    const pupils = container.querySelectorAll<SVGGElement>('g[clip-path] g.duration-\\[380ms\\]');
    expect([...pupils].map((pupil) => pupil.style.transform)).toEqual([
      'translate(0px, -3px)',
      'translate(0px, -3px)',
    ]);
  });

  it('turns its head with the pose', () => {
    const { container, rerender } = render(<Panda pose="setup" />);
    const head = () =>
      (container.querySelector('g.origin-\\[210px_158px\\]') as SVGGElement).style.transform;
    expect(head()).toBe('translate(-4px, 4px) rotate(-8deg)');
    rerender(<Panda pose="apply" />);
    expect(head()).toBe('translate(2px, -2px) rotate(5deg)');
  });
});

describe('Panda flourishes', () => {
  it('writes with the pencil to set up, scans with the magnifier to find, and holds otherwise', () => {
    const { container, rerender } = render(<Panda pose="setup" />);
    expect(container.querySelector('.animate-tailor-paw')).not.toBeNull();
    expect(container.querySelector('.animate-tailor-pencil')).not.toBeNull();
    rerender(<Panda pose="search" />);
    expect(container.querySelector('.animate-tailor-paw')).toBeNull();
    expect(container.querySelector('.animate-magnifier-scan')).not.toBeNull();
    for (const pose of ['apply', 'pending'] as const) {
      rerender(<Panda pose={pose} />);
      expect(
        container.querySelector(
          '.animate-tailor-paw, .animate-tailor-pencil, .animate-magnifier-scan',
        ),
      ).toBeNull();
    }
  });
});

describe('Panda, alive', () => {
  const body = (container: HTMLElement) =>
    container.querySelector('g.origin-\\[210px_391px\\]') as SVGGElement;
  const eyes = (container: HTMLElement) =>
    [...container.querySelectorAll('g.origin-center')].filter((eye) =>
      eye.classList.contains('animate-panda-blink'),
    ).length;

  it('lifts his whole body 7px while pending, and only then', () => {
    const { container, rerender } = render(<Panda pose="pending" />);
    expect(body(container).style.transform).toBe('translate(0px, -7px) rotate(1deg)');
    // The head and arms ride on the body.
    expect(body(container).querySelector('g.origin-\\[210px_158px\\]')).not.toBeNull();
    rerender(<Panda pose="setup" />);
    expect(body(container).style.transform).toBe('');
  });

  /** Records what the panda asks the Web Animations API for (happy-dom runs no animations). */
  function recordAnimations() {
    const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
    const cancel = vi.fn();
    vi.spyOn(Element.prototype, 'animate').mockImplementation(((
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      calls.push({ keyframes, options });
      return { cancel } as unknown as Animation;
    }) as Element['animate']);
    return { calls, cancel };
  }

  /** getComputedStyle as the breath stops: first with the breath, then the pose alone. */
  function computedStyle(withBreath: string, pose = 'none', transitionProperty = 'transform') {
    let reads = 0;
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      reads += 1;
      return {
        transform: reads === 1 ? withBreath : pose,
        transitionDuration: '0.38s',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        transitionProperty,
      } as CSSStyleDeclaration;
    });
  }

  it('breathes only while alive, on top of the pose, and eases back when the breath stops', () => {
    const { calls, cancel } = recordAnimations();
    const { rerender } = render(<Panda />);
    expect(calls).toHaveLength(0);
    rerender(<Panda alive />);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({
      iterations: Number.POSITIVE_INFINITY,
      composite: 'add',
    });
    computedStyle('matrix(1, 0, 0, 1, 0, -3)');
    rerender(<Panda alive={false} />);
    expect(cancel).toHaveBeenCalled();
    // The breath's own part (3px up) back to nothing, on the body's own transition, on top of
    // whatever the pose is doing.
    expect(calls[1]?.keyframes).toEqual([
      { transform: 'matrix(1, 0, 0, 1, 0, -3)' },
      { transform: 'none' },
    ]);
    expect(calls[1]?.options).toEqual({
      duration: 380,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      composite: 'add',
    });
  });

  it('eases back only the breath, not the pose under it', () => {
    const { calls } = recordAnimations();
    const { rerender } = render(<Panda pose="pending" alive />);
    // Lifted 7px by the pose, 3px more by the breath.
    computedStyle('matrix(1, 0, 0, 1, 0, -10)', 'matrix(1, 0, 0, 1, 0, -7)');
    rerender(<Panda pose="pending" alive={false} />);
    expect(calls[1]?.keyframes[0]).toEqual({ transform: 'matrix(1, 0, 0, 1, 0, -3)' });
  });

  it('does not ease back from a breath at rest, or where transitions are off', () => {
    const { calls } = recordAnimations();
    const { rerender } = render(<Panda alive />);
    // At rest over a lifted pose, give or take rounding.
    computedStyle('matrix(1, 0, 0, 1, 0, -7.0000000001)', 'matrix(1, 0, 0, 1, 0, -7)');
    rerender(<Panda alive={false} />);
    rerender(<Panda alive />);
    computedStyle('matrix(1, 0, 0, 1, 0, -3)', 'none', 'none');
    rerender(<Panda alive={false} />);
    // Two breaths, no ease-back.
    expect(calls).toHaveLength(2);
  });

  it('never breathes under reduced motion', () => {
    const { calls } = recordAnimations();
    // The page keeps one media query list (useReducedMotion), so answer for every list.
    const lists = Object.getPrototypeOf(window.matchMedia('(prefers-reduced-motion: reduce)'));
    vi.spyOn(lists, 'matches', 'get').mockReturnValue(true);
    render(<Panda alive />);
    expect(calls).toHaveLength(0);
  });

  it('blinks now and then while alive, both eyes at once, and never otherwise', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const { container, rerender } = render(<Panda />);
    // Not alive: still no blink at the moment one would have come.
    act(() => vi.advanceTimersByTime(7800));
    expect(eyes(container)).toBe(0);
    rerender(<Panda alive />);
    act(() => vi.advanceTimersByTime(7799));
    expect(eyes(container)).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(eyes(container)).toBe(2);
    act(() => vi.advanceTimersByTime(220));
    expect(eyes(container)).toBe(0);
    // Stopped mid-blink: the eyes open at once and stay open.
    act(() => vi.advanceTimersByTime(7800));
    expect(eyes(container)).toBe(2);
    rerender(<Panda alive={false} />);
    expect(eyes(container)).toBe(0);
    act(() => vi.advanceTimersByTime(20_000));
    expect(eyes(container)).toBe(0);
  });
});
