/**
 * Whether this is a dev build (unpacked, the dev key, a dev stack) rather than the store's:
 * set by wxt.config.ts at build time. Dev builds say so in the toolbar, the popup and the
 * panel, so a dev copy is never mistaken for the real one. Unit tests run as the store build;
 * the browser tests (e2e) run a dev build.
 */
declare const __JD_DEV_BUILD__: boolean | undefined;
export const DEV_BUILD: boolean = typeof __JD_DEV_BUILD__ !== 'undefined' && __JD_DEV_BUILD__;
