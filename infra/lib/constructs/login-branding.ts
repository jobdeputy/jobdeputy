import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CfnManagedLoginBranding } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import { REPO_ROOT } from './node-function.js';

/**
 * #54, #111: managed login's look (each client has its own branding, the same for both), in the web app's colours
 * (apps/web/src/styles/tokens.css). Managed login takes `RRGGBBAA` colours and fills in every
 * setting left out with its own default; the web app is light only, so is this. Fonts can't be
 * changed there.
 */
const ink = '1b1a18ff';
const inkSoft = '2d2b27ff';
const white = 'ffffffff';
const paper = 'faf8f3ff';
const paperDeep = 'f0ece3ff';
const muted = '706d66ff';
const line = '1b1a181f'; // ink at 12%
const lineSoft = '1b1a1814'; // ink at 8%
const lineStrong = '1b1a183d'; // ink at 24%
const green = '2f9e77ff';
const greenInk = '23795bff';
const greenSoft = 'ccebdcff';
const dangerInk = '9c4028ff';
const dangerWash = 'fdf0ebff';

export const LOGIN_BRANDING_SETTINGS = {
  categories: {
    global: {
      colorSchemeMode: 'LIGHT',
      pageHeader: { enabled: false },
      pageFooter: { enabled: false },
      spacingDensity: 'REGULAR',
    },
    // No stock password and email pictures: the logo says whose page this is.
    form: { displayGraphics: false, languageSelector: { enabled: false } },
  },
  componentClasses: {
    buttons: { borderRadius: 24.0 },
    input: {
      lightMode: {
        defaults: { backgroundColor: white, borderColor: lineStrong },
        placeholderColor: muted,
      },
      borderRadius: 13.0,
    },
    inputLabel: { lightMode: { textColor: ink } },
    inputDescription: { lightMode: { textColor: muted } },
    link: {
      lightMode: { defaults: { textColor: greenInk }, hover: { textColor: ink } },
    },
    focusState: { lightMode: { borderColor: green } },
    divider: { lightMode: { borderColor: lineSoft } },
    optionControls: {
      lightMode: {
        defaults: { backgroundColor: white, borderColor: lineStrong },
        selected: { backgroundColor: ink, foregroundColor: white },
      },
    },
    dropDown: {
      lightMode: {
        defaults: { itemBackgroundColor: white },
        hover: { itemBackgroundColor: paperDeep, itemBorderColor: lineStrong, itemTextColor: ink },
        match: { itemBackgroundColor: greenSoft, itemTextColor: ink },
      },
      borderRadius: 13.0,
    },
    statusIndicator: {
      lightMode: {
        success: { backgroundColor: greenSoft, borderColor: greenInk, indicatorColor: greenInk },
        error: { backgroundColor: dangerWash, borderColor: dangerInk, indicatorColor: dangerInk },
      },
    },
  },
  components: {
    pageBackground: { lightMode: { color: paper }, image: { enabled: false } },
    pageText: { lightMode: { headingColor: ink, bodyColor: inkSoft, descriptionColor: muted } },
    form: {
      lightMode: { backgroundColor: white, borderColor: line },
      borderRadius: 21.0,
      backgroundImage: { enabled: false },
      logo: { enabled: true, location: 'CENTER', position: 'TOP', formInclusion: 'IN' },
    },
    primaryButton: {
      lightMode: {
        defaults: { backgroundColor: ink, textColor: white },
        hover: { backgroundColor: inkSoft, textColor: white },
        active: { backgroundColor: inkSoft, textColor: white },
        disabled: { backgroundColor: paperDeep, borderColor: paperDeep },
      },
    },
    secondaryButton: {
      lightMode: {
        defaults: { backgroundColor: white, borderColor: lineStrong, textColor: ink },
        hover: { backgroundColor: paperDeep, borderColor: lineStrong, textColor: ink },
        active: { backgroundColor: paperDeep, borderColor: ink, textColor: ink },
      },
    },
    alert: {
      lightMode: { error: { backgroundColor: dangerWash, borderColor: dangerInk } },
      borderRadius: 13.0,
    },
    favicon: { enabledTypes: ['SVG'] },
  },
};

/** The web app's mark, as the form's logo and the tab's icon. */
const MARK = join(REPO_ROOT, 'apps/web/public/jobdeputy-mark.svg');

/**
 * Managed login checks uploaded SVGs and refuses `role` and `aria-*` on the root `<svg>` and
 * filter effects such as `feDropShadow` ("not allowed"). It shows the logo as a plain image, so
 * the copy for it drops those and the mark's two faint shadows; the artwork is unchanged.
 */
export function brandingSvg(svg: string): string {
  return svg
    .replace(/<svg\b[^>]*>/, (root) => root.replace(/\s+(?:role|aria-[a-z]+)="[^"]*"/g, ''))
    .replace(/\s+data-[a-z-]+="[^"]*"/g, '')
    .replace(/<filter\b[\s\S]*?<\/filter>\s*/g, '')
    .replace(/\s+filter="[^"]*"/g, '');
}

/** The favicon must be square: pads the shorter side of the `viewBox`, keeping the art centred. */
export function squareSvg(svg: string): string {
  const box = /viewBox="([^"]+)"/.exec(svg);
  const numbers =
    box?.[1]
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  if (!box || numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error('The mark needs a viewBox of four numbers to square its favicon');
  }
  const [minX, minY, width, height] = numbers as [number, number, number, number];
  const side = Math.max(width, height);
  const square = `${minX - (side - width) / 2} ${minY - (side - height) / 2} ${side} ${side}`;
  return svg.replace(box[0], `viewBox="${square}"`);
}

export function loginBranding(
  scope: Construct,
  id: string,
  props: { userPoolId: string; clientId: string },
): CfnManagedLoginBranding {
  const mark = brandingSvg(readFileSync(MARK, 'utf8'));
  const asset = (category: string, svg: string) => ({
    category,
    colorMode: 'LIGHT',
    extension: 'SVG',
    bytes: Buffer.from(svg).toString('base64'),
  });
  return new CfnManagedLoginBranding(scope, id, {
    userPoolId: props.userPoolId,
    clientId: props.clientId,
    useCognitoProvidedValues: false,
    settings: LOGIN_BRANDING_SETTINGS,
    assets: [asset('FORM_LOGO', mark), asset('FAVICON_SVG', squareSvg(mark))],
  });
}
