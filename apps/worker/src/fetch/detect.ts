/**
 * Best-effort page checks (0007). They decide failure reasons only; a wrong guess ends
 * a crawl with a clear reason, never by fetching anything more.
 */

/** Hosts that only ever show a sign-in form. */
const LOGIN_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'www.facebook.com',
];
const LOGIN_HOST_SUFFIXES = ['.okta.com', '.auth0.com', '.onelogin.com'];

/** A path segment that names a sign-in page: `/login`, `/sign-in`, `/users/sign_in`, `/auth/…`, `/sso`. */
const LOGIN_PATH = /(^|\/)(log-?in|sign-?in|sign_in|signin|auth|oauth2?|sso|saml)(\/|\.[a-z]+$|$)/i;

/** Where a redirect goes to a sign-in page, the page needs a login. */
export function isLoginUrl(url: URL): boolean {
  const host = url.hostname;
  if (LOGIN_HOSTS.includes(host) || LOGIN_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return LOGIN_PATH.test(url.pathname);
}

const MAX_TAG_CHARS = 2000;

/** Lowercases ASCII only, so every index still points at the same character in the original. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** A password field in the served HTML means a sign-in form. Linear: each `<input` is checked on its own. */
export function hasPasswordField(html: string): boolean {
  const lower = asciiLower(html);
  for (let at = lower.indexOf('<input'); at !== -1; at = lower.indexOf('<input', at + 6)) {
    const window = lower.slice(at, at + MAX_TAG_CHARS);
    const end = window.indexOf('>');
    const tag = end === -1 ? window : window.slice(0, end);
    if (/\btype\s*=\s*["']?password\b/.test(tag)) return true;
  }
  return false;
}

/** Data some frameworks embed for the page's own scripts; T07 can read jobs from it. */
const EMBEDDED_DATA = /application\/ld\+json|__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__/i;

/** Below this much visible text, a page with scripts is an empty shell. */
export const SHELL_MAX_TEXT_CHARS = 200;
/** Shells are small; a larger page has content or data for T07 to judge (and stays cheap to scan). */
export const SHELL_MAX_HTML_CHARS = 512 * 1024;

const HIDDEN_ELEMENT = /^<(script|style|noscript|template|svg|head)\b/;

/**
 * The text a reader would see, without scripts, styles, comments, or tags. A linear
 * scan: an unclosed comment or element ends the text instead of being searched for
 * again from every later position (hostile pages cannot make it slow).
 */
export function visibleText(html: string): string {
  const lower = asciiLower(html);
  const parts: string[] = [];
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, open));
    let close: number;
    if (lower.startsWith('<!--', open)) {
      close = html.indexOf('-->', open + 4);
      if (close === -1) break;
      i = close + 3;
      continue;
    }
    const hidden = HIDDEN_ELEMENT.exec(lower.slice(open, open + 12));
    if (hidden !== null) {
      close = lower.indexOf(`</${hidden[1]}`, open);
      if (close === -1) break;
    } else {
      close = open;
    }
    const end = html.indexOf('>', close);
    if (end === -1) break;
    parts.push(' ');
    i = end + 1;
  }
  return parts
    .join('')
    .replace(/&(nbsp|#160|#xa0);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Element IDs single-page apps mount into (React, Vue, Next.js, Nuxt, Angular, Svelte, Ember). */
const MOUNT_IDS = [
  'root',
  'app',
  '__next',
  '__nuxt',
  'react-root',
  'svelte',
  'ember-app',
  'application',
  'main-app',
];
const MOUNT_MARKERS = [
  ...MOUNT_IDS.flatMap((id) => [` id="${id}"`, ` id='${id}'`, ` id=${id}>`, ` id=${id} `]),
  '<app-root',
];

/** A mount point, or a `<noscript>` note about JavaScript: signs the page is built by script. */
function hasShellMarker(lower: string): boolean {
  if (MOUNT_MARKERS.some((marker) => lower.includes(marker))) return true;
  for (let at = lower.indexOf('<noscript'); at !== -1; at = lower.indexOf('<noscript', at + 9)) {
    if (lower.slice(at, at + 1000).includes('javascript')) return true;
  }
  return false;
}

/**
 * An HTML page that only shows content by running JavaScript (`needs_browser`): almost
 * no visible text, scripts, a sign of a script-built page (a mount point or a
 * "please enable JavaScript" note), and no embedded data another step could read
 * instead. A page that is simply short (a few lines and a script) is not a shell.
 */
export function looksLikeJavaScriptShell(html: string): boolean {
  if (html.length > SHELL_MAX_HTML_CHARS) return false;
  const lower = asciiLower(html);
  if (!lower.includes('<script') || EMBEDDED_DATA.test(html) || !hasShellMarker(lower))
    return false;
  return visibleText(html).length < SHELL_MAX_TEXT_CHARS;
}
