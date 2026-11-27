import { test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';
import { SCREENS, showScreen } from './screens.ts';

/**
 * #51 PR C: the job pane's tailoring states pass axe (WCAG 2.2 AA) and fit the screen: ready
 * (the green panel, the open row's Score cell), below 80% (I have this), and the résumé's
 * preview dialog (C2); the cover letter, ready, and its preview dialog (PR D3).
 */
for (const name of [
  'matches-tailored',
  'matches-tailored-below',
  'matches-resume-preview',
  'matches-cover-letter',
  'matches-letter-preview',
]) {
  test(`tailoring: ${name} has no accessibility violations`, async ({ page }) => {
    const screen = SCREENS.find((each) => each.name === name);
    if (!screen) throw new Error(`No screen ${name}`);
    await showScreen(page, screen);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });
}
