import type { FileData } from '../fill/files.ts';

/**
 * #54 PR C (decision 0020): filling a field the way a person would, so the page's own code (React
 * on Greenhouse's form) sees the change: the native value setter and the page's own events. Each
 * returns whether the field now holds the value.
 */

/** A text box or text area, through the native setter (React ignores a plain `value =`). */
export function setText(field: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  const view = field.ownerDocument.defaultView;
  const proto =
    field instanceof (view?.HTMLTextAreaElement ?? HTMLTextAreaElement)
      ? (view?.HTMLTextAreaElement ?? HTMLTextAreaElement).prototype
      : (view?.HTMLInputElement ?? HTMLInputElement).prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  field.focus();
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  field.blur();
  return field.value === value;
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A file input, as if the person chose the file. */
export function attachFile(field: HTMLInputElement, file: FileData): boolean {
  const view = field.ownerDocument.defaultView ?? window;
  const transfer = new view.DataTransfer();
  transfer.items.add(new view.File([bytesOf(file.base64)], file.name, { type: file.type }));
  field.files = transfer.files;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return field.files?.length === 1 && field.files[0]?.name === file.name;
}

/** Waits for a fact, checking each animation frame, up to `ms`. */
async function until<T>(view: Window, fact: () => T | null, ms: number): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    const found = fact();
    if (found) return found;
    if (Date.now() > end) return null;
    await new Promise((resolve) => view.setTimeout(resolve, 25));
  }
}

/** The options a react-select combobox shows once opened (in place or in a portal). */
function optionsOf(combobox: HTMLInputElement): HTMLElement[] {
  const listbox = combobox.getAttribute('aria-controls');
  const scope = listbox ? combobox.ownerDocument.getElementById(listbox) : null;
  const found = scope
    ? [...scope.querySelectorAll<HTMLElement>('[role="option"]')]
    : [
        ...combobox.ownerDocument.querySelectorAll<HTMLElement>(
          `[id^="react-select-${CSS.escape(combobox.id)}-option-"]`,
        ),
      ];
  return found;
}

/** The value a react-select combobox shows, or '' when none is chosen. */
export function chosenText(combobox: HTMLInputElement): string {
  const single = controlOf(combobox)?.querySelector('[class*="single-value"]');
  return single?.textContent?.trim() ?? '';
}

function controlOf(combobox: HTMLInputElement): Element | null {
  return combobox.closest('[class*="control"]') ?? combobox.parentElement?.parentElement ?? null;
}

/** A combobox that takes several answers (react-select's `isMulti`): never filled by us. */
export function isMulti(combobox: HTMLInputElement): boolean {
  return Boolean(controlOf(combobox)?.querySelector('[class*="value-container--is-multi"]'));
}

/** Whether a combobox holds any answer: its one value, or any of several. */
export function hasChoice(combobox: HTMLInputElement): boolean {
  return (
    chosenText(combobox) !== '' ||
    Boolean(controlOf(combobox)?.querySelector('[class*="multi-value"]'))
  );
}

/**
 * A react-select combobox (Greenhouse's choice questions): open it, read its options, choose the
 * one `pick` names, and check it was taken. Nothing is chosen when the options don't appear
 * (a search-as-you-type question, say) or `pick` names none.
 */
export async function choose(
  combobox: HTMLInputElement,
  pick: (options: string[]) => number | null,
  ms = 1500,
): Promise<boolean> {
  const view = combobox.ownerDocument.defaultView;
  if (!view) return false;
  combobox.focus();
  combobox.dispatchEvent(
    new view.KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }),
  );
  const options = await until(
    view,
    () => {
      const now = optionsOf(combobox);
      return now.length > 0 ? now : null;
    },
    ms,
  );
  const close = () =>
    combobox.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  if (!options) {
    close();
    return false;
  }
  const texts = options.map((option) => option.textContent?.trim() ?? '');
  const index = pick(texts);
  const option = index === null ? undefined : options[index];
  if (!option) {
    close();
    combobox.blur();
    return false;
  }
  option.click();
  const taken = await until(
    view,
    () => (chosenText(combobox) === texts[index ?? -1] ? true : null),
    ms,
  );
  combobox.blur();
  return taken === true;
}
