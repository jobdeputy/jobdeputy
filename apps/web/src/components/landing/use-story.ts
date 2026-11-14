import { useCallback, useEffect, useState } from 'react';
import { copy, fill } from '@/copy/index.ts';
import { useReducedMotion } from '@/lib/use-reduced-motion.ts';

const STEPS = copy.landing.steps.items;
const LAST = STEPS.length - 1;

/**
 * How long a step plays: 1 s plus 240 ms a word of its title, line and speech, at least 3.4 s,
 * to the nearest 100 ms (the prototype's rule: 4.1 s, 4.4 s, 4.1 s in English).
 */
export function stepDuration(step: { title: string; line: string; speech: string }): number {
  const words = `${step.title} ${step.line} ${step.speech}`.trim().split(/\s+/).length;
  return Math.round(Math.max(3400, 1000 + 240 * words) / 100) * 100;
}

/** What the play button does now, and so what it says. */
export type StoryMode = 'pause' | 'play' | 'replay' | 'advance';

/**
 * The landing story (#14, the prototype's story controller): the deputy works through the steps
 * by himself, once, then holds the last one; nothing loops. Pause stops the timer, Play goes on,
 * Replay starts over. Choosing a step (the arrows or the strip) shows it and pauses. Under
 * reduced motion it never plays by itself: the play button becomes "Advance story", one step a
 * press. `announcement` says where a person moved to ("Step 2 of 3: It finds"); autoplay says
 * nothing.
 */
export function useStory() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [announcement, setAnnouncement] = useState('');

  // Reduced motion turned on mid-story stops it where it is.
  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    if (index >= LAST) {
      // The last step plays to its end and holds; the button offers Replay.
      setPlaying(false);
      return;
    }
    const step = STEPS[index];
    if (!step) return;
    const timer = setTimeout(() => setIndex(index + 1), stepDuration(step));
    return () => clearTimeout(timer);
  }, [playing, index]);

  const goTo = useCallback((target: number) => {
    const next = Math.max(0, Math.min(LAST, target));
    setPlaying(false);
    setIndex(next);
    setAnnouncement(
      fill(copy.landing.story.position, {
        number: String(next + 1),
        total: String(LAST + 1),
        title: STEPS[next]?.title ?? '',
      }),
    );
  }, []);

  const atEnd = index >= LAST;
  const mode: StoryMode = reducedMotion
    ? atEnd
      ? 'replay'
      : 'advance'
    : playing
      ? 'pause'
      : atEnd
        ? 'replay'
        : 'play';

  const toggle = useCallback(() => {
    if (mode === 'pause') {
      setPlaying(false);
    } else if (mode === 'advance') {
      goTo(index + 1);
    } else if (mode === 'replay') {
      if (reducedMotion) {
        goTo(0);
      } else {
        setIndex(0);
        setPlaying(true);
      }
    } else {
      setPlaying(true);
    }
  }, [mode, index, reducedMotion, goTo]);

  return { index, mode, announcement, toggle, goTo };
}
