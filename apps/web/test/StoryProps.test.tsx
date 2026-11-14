import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryProps } from '../src/components/landing/story-props.tsx';

afterEach(cleanup);

const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-shown]')].map((rig) => rig.textContent?.trim() || 'map');

describe('StoryProps', () => {
  it("shows only the current step's props", () => {
    const { container, rerender } = render(<StoryProps scene="setup" />);
    expect(shown(container)).toEqual(['Your setupRolesRésuméRules']);
    rerender(<StoryProps scene="search" />);
    expect(shown(container)).toEqual(['map']);
    rerender(<StoryProps scene="apply" />);
    expect(shown(container)).toEqual(['✓✓']);
  });

  it("plays each step's flourish only while that step is on", () => {
    const { container, rerender } = render(<StoryProps scene="setup" />);
    expect(container.querySelectorAll('.animate-setup-tick')).toHaveLength(3);
    expect(container.querySelector('.animate-search-sweep')).toBeNull();
    expect(container.querySelector('.animate-send-application')).toBeNull();
    rerender(<StoryProps scene="search" />);
    expect(container.querySelector('.animate-setup-tick')).toBeNull();
    expect(container.querySelector('.animate-search-sweep')).not.toBeNull();
    rerender(<StoryProps scene="apply" />);
    expect(container.querySelector('.animate-search-sweep')).toBeNull();
    expect(container.querySelector('.animate-send-application')).not.toBeNull();
  });

  it('rests the setup checks empty, and ticks them green while "Set it up" is on', () => {
    const { container, rerender } = render(<StoryProps scene="search" />);
    const checks = () => [...container.querySelectorAll('.size-\\[22px\\]')];
    expect(checks()).toHaveLength(3);
    expect(checks().every((check) => !check.classList.contains('bg-green-soft'))).toBe(true);
    rerender(<StoryProps scene="setup" />);
    expect(checks().every((check) => check.classList.contains('bg-green-soft'))).toBe(true);
  });

  it('ticks the setup rows in turn', () => {
    const { container } = render(<StoryProps scene="setup" />);
    const delays = [...container.querySelectorAll('.animate-setup-tick')].map((tick) =>
      [...tick.classList].find((name) => name.startsWith('[animation-delay')),
    );
    expect(delays).toEqual([
      '[animation-delay:640ms]',
      '[animation-delay:900ms]',
      '[animation-delay:1160ms]',
    ]);
  });
});
