import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    const pupils = container.querySelectorAll<SVGGElement>('g.duration-\\[380ms\\]');
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
