import type { Plugin } from 'vite';
import { en } from './src/copy/en.ts';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Fills an HTML page's `{{copy.<path>}}` slots from en.ts, escaped, so words the page shows before
 * any script runs (the boot loader's) live with the rest of the copy. A slot naming no text fails
 * the build instead of shipping the slot.
 */
export function fillHtmlCopy(html: string, copy: object = en): string {
  return html.replace(/\{\{copy\.([\w.]+)\}\}/g, (_slot, path: string) => {
    const value = path
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], copy);
    if (typeof value !== 'string') {
      throw new Error(`index.html names {{copy.${path}}}, which is not a text in en.ts.`);
    }
    return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
  });
}

/** Runs fillHtmlCopy on every page Vite serves or builds. */
export function htmlCopy(): Plugin {
  return {
    name: 'jobdeputy-html-copy',
    transformIndexHtml: { order: 'pre', handler: (html) => fillHtmlCopy(html) },
  };
}
