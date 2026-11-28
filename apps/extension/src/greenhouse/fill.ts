import type { FillData } from '../fill/data.ts';
import { answerFor, type Question } from './answers.ts';
import { attachFile, choose, hasChoice, isMulti, setText } from './dom.ts';

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
  /**
   * Each file field on the form: attached now, already holding the person's file, empty (none
   * to attach), or failed (the page didn't take the file).
   */
  files: Record<string, 'attached' | 'kept' | 'empty' | 'failed'>;
}

export const LEFT_MARK = 'data-jobdeputy-left';
export const MAX_PASSES = 3;

type Input = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
/** What the filler answers, or `other`: a field only the person answers (a checkbox, a date…). */
type Kind = Question['kind'] | 'other';
interface Field {
  /** The element's ID, or `name:<name>` for a checkbox or radio group without one. */
  key: string;
  kind: Kind;
  label: string;
  /** The field's inputs: one, or each radio button or checkbox of a group. */
  elements: Input[];
  required: boolean;
}

function textOf(node: Element | null | undefined): string {
  return (node?.textContent ?? '')
    .replace(/\s*\*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function labelOf(element: Input): string {
  const doc = element.ownerDocument;
  // A file's own label is its button ("Attach"): the group's heading says what it is.
  const byId = element.id
    ? (doc.getElementById(`${element.id}-label`) ??
      doc.getElementById(`upload-label-${element.id}`) ??
      doc.querySelector(`label[for="${CSS.escape(element.id)}"]`))
    : null;
  return textOf(byId ?? element.closest('label')) || (element.getAttribute('aria-label') ?? '');
}

/** A radio or checkbox group's question: its fieldset's legend or its group's label. */
function groupLabelOf(element: Input): string {
  const group = element.closest('fieldset, [role="radiogroup"], [role="group"]');
  const labelledBy = group?.getAttribute('aria-labelledby');
  return (
    textOf(group?.querySelector('legend')) ||
    textOf(labelledBy ? element.ownerDocument.getElementById(labelledBy) : null) ||
    labelOf(element)
  );
}

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', '']);
const SKIPPED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

function isRequired(element: Input): boolean {
  return (
    element.getAttribute('aria-required') === 'true' ||
    element.required ||
    element
      .closest('[role="group"], [role="radiogroup"], fieldset')
      ?.getAttribute('aria-required') === 'true'
  );
}

/**
 * The form's fields a person answers, in page order: text boxes, choices and files, which the
 * filler may fill, and every other kind (checkboxes, radio groups, dates…), which only count
 * when left empty. Hidden helpers are not fields.
 */
export function scan(form: ParentNode): Field[] {
  const fields: Field[] = [];
  const groups = new Map<string, Field>();
  for (const element of form.querySelectorAll<Input>('input, textarea, select')) {
    if (element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
    const type =
      element instanceof HTMLTextAreaElement
        ? 'textarea'
        : element instanceof HTMLSelectElement
          ? 'select'
          : element.type;
    if (SKIPPED_TYPES.has(type)) continue;
    // A group of radio buttons, or of checkboxes ("select all that apply"), is one question.
    if (type === 'radio' || (type === 'checkbox' && element.name)) {
      const key = element.name ? `name:${element.name}` : element.id;
      if (!key) continue;
      const group = groups.get(key);
      if (group) {
        group.elements.push(element);
        group.required ||= isRequired(element);
        continue;
      }
      const field: Field = {
        key,
        kind: 'other',
        // A lone checkbox's question is its own label: groupLabelOf falls back to it.
        label: groupLabelOf(element),
        elements: [element],
        required: isRequired(element),
      };
      groups.set(key, field);
      fields.push(field);
      continue;
    }
    const key = element.id || (element.name ? `name:${element.name}` : '');
    if (!key) continue;
    const kind: Kind =
      element.getAttribute('role') === 'combobox'
        ? 'choice'
        : type === 'file'
          ? 'file'
          : type === 'textarea' || TEXT_TYPES.has(type)
            ? 'text'
            : 'other';
    fields.push({
      key,
      kind,
      label: labelOf(element),
      elements: [element],
      required: isRequired(element),
    });
  }
  return fields;
}

function isEmpty(field: Field): boolean {
  const [element] = field.elements;
  if (!element) return true;
  if (field.kind === 'choice') return !hasChoice(element as HTMLInputElement);
  if (element instanceof HTMLInputElement) {
    if (element.type === 'file') return (element.files?.length ?? 0) === 0;
    if (element.type === 'checkbox' || element.type === 'radio') {
      return !field.elements.some((box) => (box as HTMLInputElement).checked);
    }
  }
  return element.value.trim() === '';
}

/** Where to draw the outline: the field's wrapper, so the label is inside it too. */
function wrapperOf(element: Input): HTMLElement {
  return (
    element.closest<HTMLElement>('.field-wrapper') ??
    element.closest<HTMLElement>('fieldset') ??
    element.parentElement ??
    element
  );
}

export async function fillForm(
  form: ParentNode,
  data: FillData,
  { waitMs = 1500 }: { waitMs?: number } = {},
): Promise<Report> {
  const done = new Set<string>();
  const filled: string[] = [];
  const files: Report['files'] = {};
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const fresh = scan(form).filter((field) => !done.has(field.key));
    if (fresh.length === 0) break;
    for (const field of fresh) {
      done.add(field.key);
      const [element] = field.elements;
      if (!element || field.kind === 'other') continue;
      // The person's own answer stays.
      if (!isEmpty(field)) {
        if (field.kind === 'file') files[field.key] = 'kept';
        continue;
      }
      if (field.kind === 'file') files[field.key] = 'empty';
      // A question taking several answers is the person's to answer.
      if (field.kind === 'choice' && isMulti(element as HTMLInputElement)) continue;
      const want = answerFor({ id: field.key, label: field.label, kind: field.kind }, data);
      if (!want) continue;
      const ok =
        want.kind === 'text'
          ? setText(element as HTMLInputElement | HTMLTextAreaElement, want.value)
          : want.kind === 'file'
            ? attachFile(element as HTMLInputElement, want.file)
            : await choose(element as HTMLInputElement, want.pick, waitMs);
      if (!ok) {
        if (field.kind === 'file') files[field.key] = 'failed';
        continue;
      }
      filled.push(field.label || field.key);
      if (field.kind === 'file') files[field.key] = 'attached';
    }
  }
  for (const marked of form.querySelectorAll(`[${LEFT_MARK}]`)) marked.removeAttribute(LEFT_MARK);
  const left = scan(form)
    .filter(isEmpty)
    .map((field) => {
      // Outlined only when required: the panel lists those, and the page matches it.
      const [element] = field.elements;
      if (field.required && element) wrapperOf(element).setAttribute(LEFT_MARK, '');
      return { id: field.key, label: field.label, required: field.required };
    });
  return { filled, left, files };
}

/**
 * The page's outline for what's left, added once: the page can't see the panel's styles, so
 * this one rule is written here, in the token colour the panel reads (`--color-orange`). Once
 * the person answers an outlined field, its outline goes.
 */
export function markLeft(form: HTMLElement, color: string): void {
  const doc = form.ownerDocument;
  if (!doc.getElementById('jobdeputy-left-style')) {
    const style = doc.createElement('style');
    style.id = 'jobdeputy-left-style';
    // Without the token (it should always be there), the system's highlight colour.
    style.textContent = `[${LEFT_MARK}]{outline:2px dashed ${color || 'Highlight'};outline-offset:6px;border-radius:6px}`;
    doc.head.append(style);
  }
  if (form.dataset.jobdeputyWatch) return;
  form.dataset.jobdeputyWatch = '1';
  // Only once every field in that outline holds an answer: typing a search, or ticking then
  // unticking a box, leaves it.
  const answered = (event: Event) => {
    const wrapper = (event.target as Element | null)?.closest?.(`[${LEFT_MARK}]`);
    if (wrapper && !scan(wrapper).some(isEmpty)) wrapper.removeAttribute(LEFT_MARK);
  };
  form.addEventListener('input', answered, true);
  form.addEventListener('change', answered, true);
}
