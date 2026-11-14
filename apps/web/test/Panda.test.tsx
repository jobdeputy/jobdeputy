import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Panda, type PandaPose } from '../src/components/deputy/panda.tsx';

afterEach(cleanup);

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

  it('breathes only while alive', () => {
    const { container, rerender } = render(<Panda />);
    expect(body(container).classList.contains('animate-panda-breathe')).toBe(false);
    rerender(<Panda alive />);
    expect(body(container).classList.contains('animate-panda-breathe')).toBe(true);
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});
