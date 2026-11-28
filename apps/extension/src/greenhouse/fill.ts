import type { FillData } from '../fill/data.ts';
import { answerFor, type Question } from './answers.ts';
import { attachFile, choose, chosenText, setText } from './dom.ts';

/**
 * #54 PR C: fills a Greenhouse application form with the person's answers, one field at a time,
 * and reports what it left. It never submits (decision 0013), never changes a field the person
 * already filled, and never guesses (0019). Choosing an answer can show new questions (a race
 * question after "Hispanic or Latino: No"), so it looks again, at most three times (0002).
 */
export interface Report {
  /** Labels of the fields it filled, in page order. */
  filled: string[];
  /** Empty fields it had no answer for, or couldn't fill: the person's to answer. */
  left: { id: string; label: string; required: boolean }[];
}

export const LEFT_MARK = 'data-jobdeputy-left';
export const MAX_PASSES = 3;

type Element = HTMLInputElement | HTMLTextAreaElement;
interface Field {
  question: Question;
  element: Element;
  required: boolean;
}

function labelOf(element: Element): string {
  const doc = element.ownerDocument;
  // A file's own label is its button ("Attach"): the group's heading says what it is.
  const byId = element.id
    ? (doc.getElementById(`${element.id}-label`) ??
      doc.getElementById(`upload-label-${element.id}`) ??
      doc.querySelector(`label[for="${CSS.escape(element.id)}"]`))
    : null;
  const text = byId?.textContent ?? element.getAttribute('aria-label') ?? '';
  return text
    .replace(/\s*\*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', '']);

/** The form's fields a person answers: text boxes, choices, files (no hidden helpers). */
export function scan(form: ParentNode): Field[] {
  const fields: Field[] = [];
  for (const element of form.querySelectorAll<Element>('input, textarea')) {
    if (!element.id || element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
    const type = element instanceof HTMLTextAreaElement ? 'textarea' : element.type;
    const kind: Question['kind'] | null =
      element.getAttribute('role') === 'combobox'
        ? 'choice'
        : type === 'file'
          ? 'file'
          : type === 'textarea' || TEXT_TYPES.has(type)
            ? 'text'
            : null;
    if (!kind) continue;
    fields.push({
      question: { id: element.id, label: labelOf(element), kind },
      element,
      required:
        element.getAttribute('aria-required') === 'true' ||
        element.required ||
        element.closest('[role="group"]')?.getAttribute('aria-required') === 'true',
    });
  }
  return fields;
}

function isEmpty(field: Field): boolean {
  const { element, question } = field;
  if (question.kind === 'choice') return chosenText(element as HTMLInputElement) === '';
  if (question.kind === 'file') return ((element as HTMLInputElement).files?.length ?? 0) === 0;
  return element.value.trim() === '';
}

/** Where to draw the outline: the field's wrapper, so the label is inside it too. */
function wrapperOf(element: Element): HTMLElement {
  return element.closest<HTMLElement>('.field-wrapper') ?? element.parentElement ?? element;
}

export async function fillForm(
  form: ParentNode,
  data: FillData,
  { waitMs = 1500 }: { waitMs?: number } = {},
): Promise<Report> {
  const done = new Set<string>();
  const filled: string[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const fresh = scan(form).filter((field) => !done.has(field.question.id));
    if (fresh.length === 0) break;
    for (const field of fresh) {
      done.add(field.question.id);
      // The person's own answer stays.
      if (!isEmpty(field)) continue;
      const want = answerFor(field.question, data);
      if (!want) continue;
      const ok =
        want.kind === 'text'
          ? setText(field.element, want.value)
          : want.kind === 'file'
            ? attachFile(field.element as HTMLInputElement, want.file)
            : await choose(field.element as HTMLInputElement, want.pick, waitMs);
      if (ok) filled.push(field.question.label || field.question.id);
    }
  }
  for (const marked of form.querySelectorAll(`[${LEFT_MARK}]`)) marked.removeAttribute(LEFT_MARK);
  const left = scan(form)
    .filter(isEmpty)
    .map((field) => {
      // Outlined only when required: the panel lists those, and the page matches it.
      if (field.required) wrapperOf(field.element).setAttribute(LEFT_MARK, '');
      return { id: field.question.id, label: field.question.label, required: field.required };
    });
  return { filled, left };
}

/** The page's outline for what's left: one style, the app's orange, added once. */
export function markStyle(doc: Document): void {
  if (doc.getElementById('jobdeputy-left-style')) return;
  const style = doc.createElement('style');
  style.id = 'jobdeputy-left-style';
  style.textContent = `[${LEFT_MARK}]{outline:2px dashed #f36b3f;outline-offset:6px;border-radius:6px}`;
  doc.head.append(style);
}
