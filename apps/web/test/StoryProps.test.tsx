import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Panda } from '../src/components/deputy/panda.tsx';
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
