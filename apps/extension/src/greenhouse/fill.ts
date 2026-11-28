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
  /** Every question on the form, and how many hold an answer now (the person's or ours). */
  total: number;
  answered: number;
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

/** A label as people read it: one line, without the required mark. */
function clean(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\*\s*$/, '')
    .trim();
}

function textOf(node: Element | null | undefined): string {
  return clean(node?.textContent);
}

function labelOf(element: Input): string {
  const doc = element.ownerDocument;
  // A file's own label is its button ("Attach"): the group's heading says what it is.
  const byId = element.id
    ? (doc.getElementById(`${element.id}-label`) ??
      doc.getElementById(`upload-label-${element.id}`) ??
      doc.querySelector(`label[for="${CSS.escape(element.id)}"]`))
    : null;
  return textOf(byId ?? element.closest('label')) || clean(element.getAttribute('aria-label'));
}

/**
 * A radio or checkbox group's question: its fieldset's legend or its group's label, when the
 * group holds this question's boxes. A lone checkbox (a consent box in a "Privacy" section)
 * is its own question: its own label.
 */
function groupLabelOf(element: Input): string {
  const group = element.closest('fieldset, [role="radiogroup"], [role="group"]');
  const named = element.name
    ? group?.querySelectorAll(`input[name="${CSS.escape(element.name)}"]`).length
    : 0;
  if (element.type === 'checkbox' && (named ?? 0) < 2) return labelOf(element);
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
  const { total, answered, open } = syncOutlines(form);
  return { filled, total, answered, left: open.map(leftOf), files };
}

const leftOf = (field: Field) => ({ id: field.key, label: field.label, required: field.required });

/**
 * The form's questions and which are still open. A file question and its "Enter manually" box
 * (Greenhouse's `resume_text` or `resume-text` beside `resume`) are one question, answered
 * either way; only a text box beside a file pairs so. An open pair is the file's.
 */
function questionsOf(form: ParentNode): { total: number; answered: number; open: Field[] } {
  const all = scan(form);
  const files = new Map(all.filter((f) => f.kind === 'file').map((f) => [f.key, f]));
  /** Each file's text box, by the file's key. */
  const textOf = new Map<string, Field>();
  for (const field of all) {
    const base = field.key.replace(/[-_]text$/, '');
    if (field.kind === 'text' && base !== field.key && files.has(base)) textOf.set(base, field);
  }
  const alternatives = new Set(textOf.values());
  const questions = all
    .filter((field) => !alternatives.has(field))
    // A pair is required when either half is.
    .map((field) => {
      const text = textOf.get(field.key);
      return text?.required && !field.required ? { ...field, required: true } : field;
    });
  const open = questions.filter((field) => {
    const text = textOf.get(field.key);
    return isEmpty(field) && (!text || isEmpty(text));
  });
  return { total: questions.length, answered: questions.length - open.length, open };
}

/**
 * Outlines exactly the required questions still open, by the same count the panel shows (a
 * file answered through its text box is answered): ones the page showed since are added,
 * answered ones lose theirs. The panel lists those, and the page matches it.
 */
function syncOutlines(form: ParentNode) {
  const now = questionsOf(form);
  const wanted = new Set(
    now.open.flatMap((field) => {
      const [element] = field.elements;
      return field.required && element ? [wrapperOf(element)] : [];
    }),
  );
  for (const marked of form.querySelectorAll<HTMLElement>(`[${LEFT_MARK}]`)) {
    if (!wanted.has(marked)) marked.removeAttribute(LEFT_MARK);
  }
  for (const wrapper of wanted) wrapper.setAttribute(LEFT_MARK, '');
  return now;
}

/** Where the form stands now: every question, how many hold an answer, and what's left. */
export interface Progress {
  total: number;
  answered: number;
  left: Report['left'];
}

export function progress(form: ParentNode): Progress {
  const { total, answered, open } = questionsOf(form);
  return { total, answered, left: open.map(leftOf) };
}

/**
 * Calls `onChange` with the form's progress whenever the person answers or the page redraws,
 * so the panel stays true after the fill. It follows whichever form the page shows now
 * (`currentForm`), as the page may replace it. Returns a function that stops watching.
 */
export function watchProgress(
  currentForm: () => HTMLElement | null,
  onChange: (now: Progress) => void,
): () => void {
  let frame: number | null = null;
  let stopped = false;
  const update = () => {
    if (frame !== null || stopped) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const form = currentForm();
      if (!stopped && form) onChange(progress(form));
    });
  };
  // Around the form only (its parent, which stays when the page draws the form again), never
  // the whole page.
  const root = currentForm()?.parentElement ?? document.body;
  const types = ['input', 'change', 'click', 'keyup'];
  for (const type of types) root.addEventListener(type, update, true);
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    for (const type of types) root.removeEventListener(type, update, true);
    observer.disconnect();
  };
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
  // Outlines follow the open required questions (syncOutlines). Choices are made by a click or
  // a key and drawn by the page afterwards (no input event), so they're checked again once the
  // page has drawn: after the person's events and the page's changes.
  let queued = false;
  const recheck = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncOutlines(form);
    });
  };
  for (const type of ['input', 'change', 'click', 'keyup'])
    form.addEventListener(type, recheck, true);
  new MutationObserver(recheck).observe(form, { childList: true, subtree: true });
}
