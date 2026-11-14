import { expect, type Page, test } from '@playwright/test';
import { expectNoAccessibilityViolations, expectNoHorizontalScroll } from './checks.ts';

const TITLE = 'You set it up. Your deputy applies.';

/** The visible button with this name: phones hide the header's "Get started free". */
function visibleButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

/**
 * The hero starts under the header and fills the rest of the screen: exactly from `lg` up when
 * the screen leaves it at least its 600px minimum (its content fits there); at least, otherwise,
 * where its content or minimum can be taller than the screen.
 */
async function expectHeroFillsScreen(page: Page) {
  const header = await page.locator('header').boundingBox();
  const hero = await page.locator('main > section').boundingBox();
  const viewport = page.viewportSize();
  if (!header || !hero || !viewport) throw new Error('No header, hero, or viewport size.');
  expect(hero.y).toBeCloseTo(header.y + header.height, 0);
  // Tailwind's lg is 64rem (not overridden in the theme); 600px is the hero's lg:min-h.
  const isLarge = await page.evaluate(() => matchMedia('(width >= 64rem)').matches);
  const roomForMinimum = viewport.height - (header.y + header.height) >= 600;
  if (isLarge && roomForMinimum) {
    expect(hero.y + hero.height).toBeCloseTo(viewport.height, 0);
  } else {
    expect(hero.y + hero.height).toBeGreaterThanOrEqual(viewport.height - 0.5);
  }
}

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the promise, the two ways in, and the three steps', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: /^JobDeputy/ })).toBeVisible();
    await expect(visibleButton(page, 'Get started free')).toBeVisible();
    await expect(visibleButton(page, 'Sign in')).toBeVisible();
    const steps = page.getByRole('list', { name: 'How your deputy works' }).getByRole('button');
    await expect(steps).toHaveText([/Set it up/, /It finds/, /It applies/]);
    // The story plays on its own, so whichever step it is on: exactly one is current.
    await expect(steps.and(page.locator('[aria-current="step"]'))).toHaveCount(1);
  });

  test('uses the brand tokens from the Tailwind theme', async ({ page }) => {
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 248, 243)');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(27, 26, 24)');
  });

  test('fits the screen without sideways scrolling', async ({ page }) => {
    await expectNoHorizontalScroll(page);
  });

  test('fills the screen under the header', async ({ page }) => {
    await expectHeroFillsScreen(page);
  });

  test('keeps the header usable with text at 200%', async ({ page }) => {
    // Doubles the root font, so every rem-sized part grows (WCAG 1.4.4). Unlike a browser's
    // text-size setting it leaves the breakpoints where they are, so each device keeps its layout.
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const header = page.locator('header');
    const box = await header.boundingBox();
    if (!box) throw new Error('The header has no box.');
    const minimum = await header.evaluate((element) => ({
      header: Number.parseFloat(getComputedStyle(element).minHeight),
      root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    expect(minimum.header, 'the minimum height scales with the text').toBeCloseTo(
      4.5 * minimum.root,
      0,
    );
    for (const part of await header.locator('a, button').filter({ visible: true }).all()) {
      const partBox = await part.boundingBox();
      if (!partBox) throw new Error('A header control has no box.');
      expect(partBox.x).toBeGreaterThanOrEqual(box.x);
      expect(partBox.x + partBox.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(partBox.y + partBox.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    }
    // The header publishes its measured height, and focused content stops below it (plus 8px
    // for the focus ring). Checking the published value itself: the CSS fallback would match a
    // one-row header even if the measuring hook were broken.
    const offsets = () =>
      page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
        // How far each is off, to 0.01px.
        const off = (value: number) => Math.round(Math.abs(value) * 100) / 100;
        return [
          off(Number.parseFloat(root.getPropertyValue('--header-offset')) - headerHeight),
          off(Number.parseFloat(root.scrollPaddingTop) - headerHeight - 8),
        ];
      });
    // One read for both, polled together, so a late relayout cannot split them.
    await expect.poll(offsets).toEqual([0, 0]);
    await expectNoHorizontalScroll(page);
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await expectNoAccessibilityViolations(page);
  });

  test('"Get started free" opens the sign-up drawer', async ({ page }) => {
    await visibleButton(page, 'Get started free').click();
    const drawer = page.getByRole('dialog', { name: 'Set up your search desk.' });
    await expect(drawer).toBeVisible();
    await expectNoAccessibilityViolations(page);
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
  });

  test('"Sign in" opens the sign-in drawer; Escape closes it and focus goes back', async ({
    page,
  }) => {
    const signIn = visibleButton(page, 'Sign in');
    await signIn.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Welcome back.' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(signIn).toBeFocused();
  });
});

/**
 * Stops the page's installed clock about a second on; after this only fastForward moves time. The
 * margin keeps the target ahead of the clock, which runs on until the pause lands (a target in the
 * past throws). Call it once the story is paused, so no step can pass in that second.
 */
async function freezeClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
}

/** The strip's step buttons, in order. */
function stripSteps(page: Page) {
  return page.getByRole('list', { name: 'How your deputy works' }).getByRole('button');
}

test.describe('the story', () => {
  // Real time, waiting on facts: the story's steps are 4 s, so a step changes well inside the
  // 15 s these waits allow, and nothing depends on how fast the page loaded.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('plays each step once by itself, then offers Replay', async ({ page }) => {
    // Wherever it has got to, it moves on to the last step and stops there.
    await expect(stripSteps(page).nth(1)).toHaveAttribute('aria-current', 'step', {
      timeout: 15_000,
    });
    await expect(stripSteps(page).nth(2)).toHaveAttribute('aria-current', 'step', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Replay story' })).toBeVisible();
  });

  test('steps back and forth by its arrows', async ({ page }) => {
    // Choosing a step pauses the story there, wherever it had got to.
    await stripSteps(page).nth(0).click();
    await expect(page.getByRole('button', { name: 'Play story' })).toBeVisible();
    // The first step has no step before it; the button stays focusable.
    await expect(page.getByRole('button', { name: 'Previous step' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.getByRole('button', { name: 'Next step: It finds' }).click();
    await expect(stripSteps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('status').filter({ hasText: 'Step 2 of 3' })).toHaveText(
      'Step 2 of 3: It finds',
    );
    await expect(page.getByRole('button', { name: 'Previous step: Set it up' })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});

test.describe('the story, on the page clock', () => {
  // Each test first chooses a step (which pauses the story), then freezes the page's clock there,
  // so from then on only fastForward moves time: nothing races real time.
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
  });

  test('holds a step chosen in the strip', async ({ page }) => {
    // The middle step: the last one would hold by itself.
    await stripSteps(page).nth(1).click();
    await freezeClock(page);
    await page.clock.fastForward(20_000);
    await expect(stripSteps(page).nth(1)).toHaveAttribute('aria-current', 'step');
    await stripSteps(page).nth(2).click();
    // The last step: no step after it, and its state passes axe too.
    await expect(page.getByRole('button', { name: 'Next step' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expectNoAccessibilityViolations(page);
  });

  test('pauses on Pause story, and plays on from there on Play story', async ({ page }) => {
    await stripSteps(page).nth(0).click();
    await freezeClock(page);
    await page.getByRole('button', { name: 'Play story' }).click();
    await page.getByRole('button', { name: 'Pause story' }).click();
    await page.clock.fastForward(20_000);
    await expect(stripSteps(page).nth(0)).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: 'Play story' }).click();
    // Past step 1 (4.1 s in English), short of steps 1 and 2 together (8.5 s).
    await page.clock.fastForward(6000);
    await expect(stripSteps(page).nth(1)).toHaveAttribute('aria-current', 'step');
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the story never plays by itself; its button advances a step', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    // Well past every step's time: under reduced motion nothing has moved.
    await page.clock.fastForward(20_000);
    await expect(stripSteps(page).nth(0)).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: 'Advance story' }).click();
    await expect(stripSteps(page).nth(1)).toHaveAttribute('aria-current', 'step');
  });

  test('the drawer appears without sliding', async ({ page }) => {
    await page.goto('/');
    await visibleButton(page, 'Sign in').click();
    const drawer = page.getByRole('dialog', { name: 'Welcome back.' });
    await expect(drawer).toHaveCSS('animation-name', 'none');
  });
});
