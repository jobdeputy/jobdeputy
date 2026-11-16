/**
 * How far apart live-region updates are made, so each is read on its own: a region filled in the
 * same moment as another (or cleared and refilled in one task) may not be read at all. Shared by
 * DeputyWorking and the set-up's steps.
 */
export const LIVE_REGION_BEAT_MS = 100;
