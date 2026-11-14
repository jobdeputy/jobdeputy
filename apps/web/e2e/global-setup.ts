import { rmSync } from 'node:fs';
import { SCREENSHOTS_DIR } from './screenshots-dir.ts';

/** Clears the last run's screenshots, so a removed or renamed screen never lingers. */
export default function globalSetup() {
  rmSync(SCREENSHOTS_DIR, { recursive: true, force: true });
}
