import { fileURLToPath } from 'node:url';

/** Where screenshots land (apps/web/screenshots/, git-ignored), whatever directory runs the tests. */
export const SCREENSHOTS_DIR = fileURLToPath(new URL('../screenshots/', import.meta.url));
