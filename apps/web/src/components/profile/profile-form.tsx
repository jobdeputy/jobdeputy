import { profileInput } from '@jobdeputy/shared/profile';
import { useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { refusalText } from '@/components/setup/parts.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { LIVE_REGION_BEAT_MS } from '@/lib/live-region.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';

/** What a save may carry: the API's schema is strict and refuses anything else it is sent. */
const INPUT_KEYS: readonly string[] = profileInput.keyof().options;

/** How long words stay in the status line after being said (they are read when they arrive). */
const SPOKEN_FOR_MS = 5000;

/** The country a new profile gets: the US (the only Region, US-only launch). */
export const COUNTRY = 'US';

/** The body of `PUT /me/profile`: the whole profile, as a save may carry it. */
export type SaveBody = Record<string, unknown> & { version: number };

/** One field a form edits. */
export type FieldSpec = {
  /** The field as the saved profile has it, as it is typed. */
  read: (profile: Profile) => string;
  /** What is typed, as it is saved and compared (trimmed, by default). */
  norm?: (typed: string) => string;
  /** The API's paths (`location.city`) whose problems are this field's; deeper paths count too. */
  paths: readonly string[];
  /** Said when the field is wrong. */
  invalid: string;
  /** Said when the field is needed (always, or with another) and empty. */
  missing?: string;
  /** Said when a list holds too many (`{max}`). */
  tooMany?: string;
};

/** A form's fields, by name, and how their answers go into the profile to save. */
export type FormSpec<N extends string> = {
  fields: Record<N, FieldSpec>;
  /** Puts the answers (as `norm` leaves them) into the body (what is saved; change it in place). */
  apply: (body: SaveBody, answers: Record<N, string>) => void;
  /** Said when the save was refused as out of date, or this form's fields changed elsewhere. */
  savedMeanwhile: string;
  changedElsewhere: string;
};

type Values<N extends string> = Record<N, string>;
type Errors<N extends string> = Partial<Record<N, string>>;

/**
 * A form that edits part of the saved profile (#33): Set it up's step 1 and each group on the
 * Profile page. It is checked with the API's own schema before it is sent, then saved (`PUT
 * /me/profile`, which replaces the whole profile: everything else saved goes along unchanged). A
 * wrong field says why beside itself and takes focus; any other refusal is said above the buttons.
 * A save whose answer is lost, or refused as out of date, reads what is saved and compares it with
 * this form's fields: the same means saved; untouched elsewhere keeps what was typed; changed
 * elsewhere shows what is saved now, so nothing is overwritten unseen.
 */
export function useProfileForm<N extends string>({
  spec,
  profile,
  onSaved,
}: {
  spec: FormSpec<N>;
  /** What is saved (the API's version-0 defaults before anything is). */
  profile: Profile;
  onSaved: (saved: Profile) => void;
}) {
  const api = useApi();
  const queries = useQueryClient();
  const names = Object.keys(spec.fields) as N[];
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values<N>>(() => valuesOf(spec, profile));
  // This form's fields as saved when it opened (or last read them): a refresh of the profile
  // meanwhile (the window regaining focus) can bring a newer version, which must not let a save
  // overwrite these fields changed elsewhere unseen.
  const [opened, setOpened] = useState<Values<N>>(() => valuesOf(spec, profile));
  const [errors, setErrors] = useState<Errors<N>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  // Said politely (not an alert): a saved field this form doesn't show that is wrong.
  const [note, setNote] = useState<string | null>(null);
  // The first wrong field's reason, read out in the status line.
  const [spoken, setSpoken] = useState('');
  const [pending, setPending] = useState(false);
  const waiting = useDelayedPending(pending);
  const refusalId = useId();
  const noteId = useId();
  // A save that ends after the person has left (signed out, say) must not touch anything.
  const here = useRef(true);
  useEffect(() => {
    // Set on every mount: React's development check mounts, unmounts and mounts again.
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);

  /** What waits to be said on the running beat, and the note among it (see `later`). */
  const announcing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unsaidWords = useRef<string | null>(null);
  const unsaidNote = useRef<string | null>(null);
  useEffect(() => () => clearTimeout(announcing.current), []);

  const bind = (name: N) => ({
    name,
    value: values[name],
    error: errors[name] ?? null,
    // Locked while saving, so a reload can't overwrite anything typed meanwhile (the form dims
    // its inputs at once, so the lock shows).
    readOnly: pending,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((current) => ({ ...current, [name]: event.target.value }));
      // A field's reason, about to be said or just said, no longer applies once a field changes;
      // the note about a saved field this form doesn't show still does, so it is still said, on
      // the beat already running (typing doesn't put it off).
      setSpoken('');
      if (unsaidWords.current !== null) {
        if (unsaidNote.current) unsaidWords.current = unsaidNote.current;
        else {
          clearTimeout(announcing.current);
          unsaidWords.current = null;
        }
      }
    },
  });

  /**
   * Shows `note` now and says `words` a beat after the messages were cleared, in a task of its own:
   * cleared and set again in one task, the same words would not change the page, and would not
   * be read again. A newer try cancels a beat still waiting.
   */
  function later(words: string, shownNote: string | null) {
    clearTimeout(announcing.current);
    // The note is shown at once (it is not a live region); only the words wait for the beat.
    setNote(shownNote);
    unsaidNote.current = shownNote;
    unsaidWords.current = words;
    announcing.current = setTimeout(() => {
      if (!here.current) return;
      const saying = unsaidWords.current ?? '';
      unsaidNote.current = null;
      unsaidWords.current = null;
      setSpoken(saying);
      // Said, then gone from the status line, so reading through the form meets each message
      // once (the note and the field errors stay where they are).
      announcing.current = setTimeout(() => {
        if (here.current) setSpoken('');
      }, SPOKEN_FOR_MS);
    }, LIVE_REGION_BEAT_MS);
  }

  /**
   * Moves focus to the first wrong field (its errors already set), which reads its reason. Where
   * focus was already there (Enter pressed in it), a new description is not read, so the reason is
   * said in the status line. A saved field this form doesn't show that is wrong too is said there
   * as well, in the same words as its note: one update, so both are heard.
   */
  function showFieldErrors(first: N, reason: string | undefined, other: boolean) {
    const input = form.current?.querySelector<HTMLElement>(`[name="${first}"]`) ?? null;
    const alreadyThere = input !== null && input === document.activeElement;
    input?.focus();
    const otherText = other ? copy.setUp.errors.cannotSave : null;
    const words = [alreadyThere ? reason : undefined, otherText].filter(Boolean).join(' ');
    later(words, otherText);
  }

  /** Reads the saved profile again; shows it here and returns it (null if it can't be read). */
  async function reload(): Promise<Profile | null> {
    try {
      const fresh = await api.request<Profile>('GET', '/me/profile');
      if (here.current) queries.setQueryData(['profile'], fresh);
      return fresh;
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    // Cleared in a render of its own (and set again a moment later, see `later`), so the same
    // message again is announced again.
    clearTimeout(announcing.current);
    unsaidWords.current = null;
    unsaidNote.current = null;
    flushSync(() => {
      setRefusal(null);
      setNote(null);
      setSpoken('');
    });
    const before = opened;
    const now = valuesOf(spec, profile);
    if (!sameAnswers(spec, now, before)) {
      // This form's fields were saved elsewhere since it opened: show them, so nothing is
      // overwritten unseen.
      setValues(now);
      setOpened(now);
      setErrors({});
      setRefusal(spec.changedElsewhere);
      return;
    }
    const answers = answersOf(spec, values);
    const body = saveBody(spec, profile, values);
    const found = check(spec, body, answers);
    // Rendered before focus moves, so the field is read with its reason.
    flushSync(() => setErrors(found.fields));
    const first = names.find((name) => found.fields[name]);
    if (first) {
      showFieldErrors(first, found.fields[first], found.other);
      return;
    }
    if (found.other) {
      later(copy.setUp.errors.cannotSave, copy.setUp.errors.cannotSave);
      return;
    }
    setPending(true);
    try {
      const next = await api.request<Profile>('PUT', '/me/profile', body);
      if (!here.current) return;
      queries.setQueryData(['profile'], next);
      onSaved(next);
    } catch (error) {
      if (!here.current) return;
      // Compared as saved (a phone's +1 added, an empty number dropped), not as typed.
      await refused(error, valuesOf(spec, body as Profile), before, body.version);
    } finally {
      if (here.current) setPending(false);
    }
  }

  /** Says why a save was refused, in this form's words, and what to do. */
  async function refused(error: unknown, sent: Values<N>, before: Values<N>, sentVersion: number) {
    const errorsText = copy.setUp.errors;
    const kind = error instanceof ApiError ? error.kind : 'server';
    if (kind === 'invalid' && error instanceof ApiError && error.fieldErrors.length > 0) {
      const { fields, other } = fromApi(spec, error);
      const first = names.find((name) => fields[name]);
      // Saving ends before focus moves, so focus never lands on a locked field.
      flushSync(() => {
        setErrors(fields);
        setPending(false);
      });
      if (first) showFieldErrors(first, fields[first], other);
      else later(errorsText.cannotSave, errorsText.cannotSave);
    } else if (kind === 'conflict' && error instanceof ApiError && error.code === 'try-again') {
      // A write that collided: nothing was saved and nothing changed. Keep what was typed.
      setRefusal(errorsText.tryLater);
    } else if (kind === 'conflict' || kind === 'unsure') {
      // A save whose answer was lost, or one refused as out of date: what is saved now says what
      // happened, read by this form's own fields.
      const fresh = await reload();
      if (!here.current) return;
      if (!fresh) {
        // A definite refusal saved nothing; a lost answer may have.
        setRefusal(kind === 'conflict' ? errorsText.saveFailed : errorsText.unknownOutcome);
      } else if (fresh.version > sentVersion && sameAnswers(spec, valuesOf(spec, fresh), sent)) {
        // These answers are saved (this save went through, or an earlier one of this person's).
        onSaved(fresh);
      } else if (sameAnswers(spec, valuesOf(spec, fresh), before)) {
        // Nothing this form shows changed elsewhere: keep what was typed (the newer version is
        // loaded, so trying again works). A lost answer was most likely the connection.
        setRefusal(kind === 'conflict' ? spec.savedMeanwhile : errorsText.saveFailed);
      } else {
        // This form's fields changed elsewhere: show them, so nothing is overwritten unseen.
        setValues(valuesOf(spec, fresh));
        setOpened(valuesOf(spec, fresh));
        setRefusal(spec.changedElsewhere);
      }
    } else {
      setRefusal(refusalText(error));
    }
  }

  const messages = (
    <>
      <p role="status" className="sr-only">
        {pending && waiting ? copy.setUp.saving : spoken}
      </p>
      {/* A saved field this form doesn't show that is wrong: shown, and part of the form's
          description until the next try (the status line above says it). */}
      <p id={noteId} className={cn('m-0 text-sm font-[650] text-danger-ink', !note && 'hidden')}>
        {note}
      </p>
      <p
        id={refusalId}
        role="alert"
        className={cn('m-0 text-sm font-[650] text-danger-ink', !refusal && 'sr-only')}
      >
        {refusal}
      </p>
    </>
  );

  return {
    bind,
    pending,
    /** Spread on the `<form>`. */
    form: {
      ref: form,
      noValidate: true,
      // Only the inputs dim: their labels and messages stay readable. Join with the form's own
      // classes (`cn(form.className, …)`).
      className: pending ? '[&_input]:opacity-60 [&_textarea]:opacity-60' : undefined,
      onSubmit: submit,
      'aria-describedby':
        [refusal && refusalId, note && noteId].filter(Boolean).join(' ') || undefined,
    },
    /** The status line, the note and the refusal: placed above the buttons. */
    messages,
  };
}

/** The form's fields as the saved profile has them. */
function valuesOf<N extends string>(spec: FormSpec<N>, profile: Profile): Values<N> {
  const names = Object.keys(spec.fields) as N[];
  return Object.fromEntries(
    names.map((name) => [name, spec.fields[name].read(profile)]),
  ) as Values<N>;
}

function normOf(field: FieldSpec, typed: string): string {
  return field.norm ? field.norm(typed) : typed.trim();
}

/**
 * The whole profile to save: what is saved, limited to what a save may carry (not the fields the
 * server adds, such as email), with this form's answers on top.
 */
export function saveBody<N extends string>(
  spec: FormSpec<N>,
  profile: Profile,
  values: Values<N>,
): SaveBody {
  const saved = Object.fromEntries(
    Object.entries(profile).filter(([key]) => INPUT_KEYS.includes(key) && key !== 'version'),
  );
  // A copy: `apply` changes nested objects (location, links) in place.
  const body: SaveBody = { ...structuredClone(saved), version: profile.version };
  spec.apply(body, answersOf(spec, values));
  return body;
}

/** What is typed, as it is saved (each field's `norm`). */
function answersOf<N extends string>(spec: FormSpec<N>, values: Values<N>): Values<N> {
  const names = Object.keys(spec.fields) as N[];
  return Object.fromEntries(
    names.map((name) => [name, normOf(spec.fields[name], values[name])]),
  ) as Values<N>;
}

/** The field an API path belongs to (its own path, or one inside it). */
function fieldOf<N extends string>(spec: FormSpec<N>, path: string): N | undefined {
  return (Object.keys(spec.fields) as N[]).find((name) =>
    spec.fields[name].paths.some((own) => path === own || path.startsWith(`${own}.`)),
  );
}

/**
 * The body checked with the API's schema: this form's fields in the person's words, and whether
 * anything else is wrong (a saved field this form does not show).
 */
function check<N extends string>(
  spec: FormSpec<N>,
  body: unknown,
  answers: Values<N>,
): { fields: Errors<N>; other: boolean } {
  const result = profileInput.safeParse(body);
  const fields: Errors<N> = {};
  let other = false;
  if (result.success) return { fields, other };
  for (const issue of result.error.issues) {
    const name = fieldOf(spec, issue.path.join('.'));
    if (!name) {
      other = true;
      continue;
    }
    if (fields[name]) continue;
    const field = spec.fields[name];
    const max = 'maximum' in issue ? String(issue.maximum) : '';
    fields[name] =
      issue.code === 'too_big' && issue.origin === 'array' && field.tooMany
        ? fill(field.tooMany, { max })
        : issue.code === 'too_big'
          ? fill(copy.setUp.errors.tooLong, { max })
          : field.missing && (issue.code === 'too_small' || answers[name] === '')
            ? field.missing
            : field.invalid;
  }
  return { fields, other };
}

/** The API's refusals: on this form's fields, in the person's words, and whether any other. */
function fromApi<N extends string>(
  spec: FormSpec<N>,
  error: ApiError,
): { fields: Errors<N>; other: boolean } {
  const fields: Errors<N> = {};
  let other = false;
  for (const { path } of error.fieldErrors) {
    const name = fieldOf(spec, path);
    if (!name) other = true;
    else if (!fields[name]) fields[name] = spec.fields[name].invalid;
  }
  return { fields, other };
}

/** Whether two readings of this form's fields from saved profiles (or a sent body) agree. */
function sameAnswers<N extends string>(
  spec: FormSpec<N>,
  saved: Values<N>,
  sent: Values<N>,
): boolean {
  return (Object.keys(spec.fields) as N[]).every((name) => {
    const field = spec.fields[name];
    return normOf(field, saved[name]) === normOf(field, sent[name]);
  });
}
