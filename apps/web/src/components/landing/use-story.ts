import { useCallback, useState, useSyncExternalStore } from 'react';
import { copy, fill } from '@/copy/index.ts';
import { useRevealed } from '@/lib/boot-loader.ts';
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

/** Each step's time, worked out once: the copy is fixed. */
const DURATIONS = STEPS.map(stepDuration);

/**
 * The current step's bar in the strip: `filling` while the step plays (over its duration),
 * `held` when Pause stopped it part-way, `waiting` (empty) while the story waits for someone to
 * watch, `full` otherwise (a chosen step, the story's end, reduced motion).
 */
export type StepProgress = 'filling' | 'held' | 'waiting' | 'full';

/** What the play button does now, and so what it says. */
export type StoryMode = 'pause' | 'play' | 'replay' | 'advance';

function onVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/**
 * The landing story (#14, the prototype's story controller): the deputy works through the steps
 * by himself, once, then holds the last one; nothing loops. Pause stops the step's bar, Play goes
 * on, Replay starts over. Choosing a step (the arrows or the strip) shows it and pauses. Under
 * reduced motion it never plays by itself: the play button becomes "Advance story", one step a
 * press. `announcement` says where a person moved to ("Step 2 of 3: It finds"); autoplay says
 * nothing, and clears it. `held`: paused by the Pause button, so the step's flourish holds
 * mid-way (choosing a step plays its flourish to the end). It waits while no one can watch: until the page shows from under the
 * boot loader, and while the tab is hidden (a step then starts over when the tab comes back).
 */
export function useStory() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  // Paused by the Pause button: the step's flourish holds where it is (a chosen step instead
  // plays its flourish to the end).
  const [held, setHeld] = useState(false);
  const revealed = useRevealed();
  const hidden = useSyncExternalStore(
    onVisibility,
    () => document.hidden,
    () => false,
  );
  // Reduced motion turned on mid-story stops it for good: turning it off again later does not
  // restart it unasked. (Adjusting state while rendering: React's pattern for this.)
  if (reducedMotion && playing) setPlaying(false);
  // …and lets go of a hold: under reduced motion the bar shows full, not paused part-way.
  if (reducedMotion && held) setHeld(false);

  // The clock is the current step's bar in the strip: it fills over the step's time while the
  // story plays, stops with Pause, and starts over when shown again; when it is full the strip
  // calls this, and the story moves on (the last step holds, offering Replay).
  const onStepEnd = useCallback(() => {
    if (index >= LAST) {
      setPlaying(false);
      return;
    }
    setIndex(index + 1);
    setAnnouncement('');
  }, [index]);

  const goTo = useCallback((target: number) => {
    const next = Math.max(0, Math.min(LAST, target));
    setPlaying(false);
    setHeld(false);
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
      : held || !atEnd
        ? // A paused step goes on from where it stopped, even the last one.
          'play'
        : 'replay';

  const toggle = useCallback(() => {
    if (mode === 'pause') {
      setPlaying(false);
      setHeld(true);
    } else if (mode === 'advance') {
      goTo(index + 1);
    } else if (mode === 'replay') {
      if (reducedMotion) {
        goTo(0);
      } else {
        setIndex(0);
        setPlaying(true);
        setHeld(false);
        setAnnouncement('');
      }
    } else {
      setPlaying(true);
      setHeld(false);
      setAnnouncement('');
    }
  }, [mode, index, reducedMotion, goTo]);

  // Moving while someone can watch: the deputy breathes and blinks only then.
  const animating = playing && revealed && !hidden;
  const progress: StepProgress = animating
    ? 'filling'
    : playing
      ? 'waiting'
      : held
        ? 'held'
        : 'full';
  const duration = DURATIONS[index] ?? 0;
  // A new run each time the story comes back from waiting (a hidden tab, the boot loader), so the
  // bar starts over then, as the step does; a resumed Pause keeps the run, and the bar goes on.
  const [run, setRun] = useState(0);
  const [waited, setWaited] = useState(false);
  if (progress === 'waiting' && !waited) setWaited(true);
  if (progress !== 'waiting' && waited) {
    setWaited(false);
    setRun(run + 1);
  }
  return {
    index,
    mode,
    animating,
    held,
    progress,
    duration,
    run,
    announcement,
    toggle,
    goTo,
    onStepEnd,
  };
}
