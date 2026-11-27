import { test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';
import { SCREENS, showScreen } from './screens.ts';

/**
 * #51 PR C: the job pane's tailoring states pass axe (WCAG 2.2 AA) and fit the screen: ready
 * (the green panel, the open row's Score cell) and below 80% (I have this).
 */
for (const name of ['matches-tailored', 'matches-tailored-below']) {
  test(`tailoring: ${name} has no accessibility violations`, async ({ page }) => {
    const screen = SCREENS.find((each) => each.name === name);
    if (!screen) throw new Error(`No screen ${name}`);
    await showScreen(page, screen);
    await expectNoAccessibilityViolations(page);
    await expectNoHorizontalScroll(page);
  });
}
