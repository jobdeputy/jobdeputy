import { type MouseEvent, useEffect, useState } from 'react';

/**
 * The signed-in app's pages by path (#33): real URLs, through the History API (the site serves
 * the app for any path, see infra/lib/web-stack.ts). Two pages don't need a router library; this
 * grows with them.
 */
const CHANGE = 'jobdeputy:navigate';

/** The current path; follows Back and Forward, and `navigate`. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(CHANGE, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(CHANGE, update);
    };
  }, []);
  return path;
}

/** Goes to `path` (a new history entry, or `replace` the current one, for a redirect). */
export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(CHANGE));
}

/**
 * A link's click, handled in the app: a plain click goes to the page without reloading; a click
 * with a modifier (a new tab or window) is the browser's.
 */
export function followLink(event: MouseEvent<HTMLAnchorElement>, path: string): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}
