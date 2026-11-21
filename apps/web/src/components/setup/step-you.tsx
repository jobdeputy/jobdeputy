import { profileInput } from '@jobdeputy/shared/profile';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Field } from '@/components/auth/fields.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { LIVE_REGION_BEAT_MS } from '@/lib/live-region.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { Fact, refusalText, StepIntro } from './parts.tsx';

type Name = 'firstName' | 'lastName' | 'city';
type Values = Record<Name, string>;
type Errors = Partial<Record<Name, string>>;

/** What a save may carry: the API's schema is strict and refuses anything else it is sent. */
const INPUT_KEYS: readonly string[] = profileInput.keyof().options;

/** How long words stay in the status line after being said (they are read when they arrive). */
const SPOKEN_FOR_MS = 5000;

/** The country a new profile gets: the US (the only Region, US-only launch). */
const COUNTRY = 'US';

type Location = { city?: string; region?: string; postalCode?: string; country?: string };

/**
 * Set it up, step 1 (#33): who the person is. First and last name (the API needs both) and,
 * optionally, the city they are based in; the country is the United States, as their Region.
 * Checked with the API's own schema before it is sent, then saved (`PUT /me/profile`, which
 * replaces the whole profile: everything else saved goes along unchanged). A wrong field says why
 * beside itself and takes focus; any other refusal is said above the buttons.
 */
export function StepYou({
  profile,
  onSaved,
  onBack,
}: {
  /** What is saved (the API's version-0 defaults before anything is). */
  profile: Profile;
  onSaved: () => void;
  onBack: () => void;
}) {
  const text = copy.setUp.you;
  const api = useApi();
  const queries = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(() => valuesOf(profile));
  const [errors, setErrors] = useState<Errors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  // Said politely (not an alert): a saved field this step doesn't show that is wrong.
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

  const bind = (name: Name) => ({
    name,
    value: values[name],
    error: errors[name] ?? null,
    // Locked while saving, so a reload can't overwrite anything typed meanwhile; the input (only:
    // its label and messages stay readable) dims at once, so the lock shows.
    readOnly: pending,
    className: pending ? '[&_input]:opacity-60' : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({ ...current, [name]: event.target.value }));
      // A field's reason, about to be said or just said, no longer applies once a field changes;
      // the note about a saved field this step doesn't show still does, so it is still said, on
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
   * Shows `note` now and says `spoken` a beat after the messages were cleared, in a task of its own:
   * cleared and set again in one task, the same words would not change the page, and would not
   * be read again. A newer try cancels a beat still waiting.
   */
  const announcing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What waits to be said on the running beat, and the note among it (a keystroke drops a
  // field's reason from it, not the note).
  const unsaidWords = useRef<string | null>(null);
  const unsaidNote = useRef<string | null>(null);
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
   * said in the status line. A saved field this step doesn't show that is wrong too is said there
   * as well, in the same words as its note: one update, so both are heard.
   */
  function showFieldErrors(first: Name, reason: string | undefined, other: boolean) {
    const input = form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`);
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
    const body = saveBody(profile, values);
    const found = check(body);
    // Rendered before focus moves, so the field is read with its reason.
    flushSync(() => setErrors(found.fields));
    const first = (Object.keys(found.fields) as Name[])[0];
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
      onSaved();
    } catch (error) {
      if (!here.current) return;
      await refused(error, values, valuesOf(profile), body.version);
    } finally {
      if (here.current) setPending(false);
    }
  }

  /** Says why a save was refused, in this step's words, and what to do. */
  async function refused(error: unknown, sent: Values, before: Values, sentVersion: number) {
    const errorsText = copy.setUp.errors;
    const kind = error instanceof ApiError ? error.kind : 'server';
    if (kind === 'invalid' && error instanceof ApiError && error.fieldErrors.length > 0) {
      const { fields, other } = fromApi(error);
      const first = (Object.keys(fields) as Name[])[0];
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
      // happened, read by this step's own fields.
      const fresh = await reload();
      if (!here.current) return;
      if (!fresh) {
        // A definite refusal saved nothing; a lost answer may have.
        setRefusal(kind === 'conflict' ? errorsText.saveFailed : errorsText.unknownOutcome);
      } else if (fresh.version > sentVersion && sameAnswers(valuesOf(fresh), sent)) {
        // These answers are saved (this save went through, or an earlier one of this person's).
        onSaved();
      } else if (sameAnswers(valuesOf(fresh), before)) {
        // Nothing this step shows changed elsewhere: keep what was typed (the newer version is
        // loaded, so trying again works). A lost answer was most likely the connection.
        setRefusal(kind === 'conflict' ? errorsText.savedMeanwhile : errorsText.saveFailed);
      } else {
        // This step's fields changed elsewhere: show them, so nothing is overwritten unseen.
        setValues(valuesOf(fresh));
        setRefusal(errorsText.changedElsewhere);
      }
    } else {
      setRefusal(refusalText(error));
    }
  }

  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <form
        ref={form}
        noValidate
        onSubmit={submit}
        aria-labelledby="set-up-title"
        aria-describedby={
          [refusal && refusalId, note && noteId].filter(Boolean).join(' ') || undefined
        }
        className="grid gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={text.firstName} autoComplete="given-name" {...bind('firstName')} />
          <Field label={text.lastName} autoComplete="family-name" {...bind('lastName')} />
        </div>
        <Field
          label={text.city}
          hint={text.cityHint}
          autoComplete="address-level2"
          {...bind('city')}
        />
        <ul className="m-0 grid list-none p-0">
          <Fact label={text.country} value={copy.setUp.region} pill={copy.setUp.locked} />
        </ul>
        <p role="status" className="sr-only">
          {pending && waiting ? copy.setUp.saving : spoken}
        </p>
        {/* A saved field this step doesn't show that is wrong: shown, and part of the form's
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" pending={pending} pendingLabel={copy.setUp.saving}>
            {copy.setUp.continue}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={pending}>
            {copy.setUp.back}
          </Button>
        </div>
      </form>
    </>
  );
}

/** This step's fields as the saved profile has them. */
function valuesOf(profile: Profile): Values {
  const location = profile.location as Location | undefined;
  return {
    firstName: typeof profile.firstName === 'string' ? profile.firstName : '',
    lastName: typeof profile.lastName === 'string' ? profile.lastName : '',
    city: location?.city ?? '',
  };
}

/**
 * The whole profile to save: what is saved, limited to what a save may carry (not the fields the
 * server adds, such as email), with this step's answers on top. The location keeps its saved
 * region and postal code; only its city is this step's.
 */
export function saveBody(profile: Profile, values: Values) {
  const saved = Object.fromEntries(
    Object.entries(profile).filter(([key]) => INPUT_KEYS.includes(key) && key !== 'version'),
  );
  const { city: _city, ...place } = (profile.location as Location | undefined) ?? {};
  const city = values.city.trim();
  return {
    ...saved,
    version: profile.version,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    location: { ...place, country: place.country ?? COUNTRY, ...(city ? { city } : {}) },
  };
}

/**
 * The body checked with the API's schema: this step's fields in the person's words, and whether
 * anything else is wrong (a saved field this step does not show).
 */
function check(body: unknown): { fields: Errors; other: boolean } {
  const result = profileInput.safeParse(body);
  const fields: Errors = {};
  let other = false;
  if (result.success) return { fields, other };
  for (const issue of result.error.issues) {
    const name = fieldOf(issue.path.join('.'));
    if (!name) {
      other = true;
      continue;
    }
    if (fields[name]) continue;
    fields[name] =
      issue.code === 'too_big'
        ? fill(copy.setUp.errors.tooLong, { max: String(issue.maximum) })
        : issue.code === 'too_small' && name === 'firstName'
          ? copy.setUp.errors.firstNameMissing
          : issue.code === 'too_small' && name === 'lastName'
            ? copy.setUp.errors.lastNameMissing
            : invalid(name);
  }
  return { fields, other };
}

/** The API's refusals: on this step's fields, in the person's words, and whether any other. */
function fromApi(error: ApiError): { fields: Errors; other: boolean } {
  const fields: Errors = {};
  let other = false;
  for (const { path } of error.fieldErrors) {
    const name = fieldOf(path);
    if (!name) other = true;
    else if (!fields[name]) fields[name] = invalid(name);
  }
  return { fields, other };
}

/** Whether a saved profile holds these answers (trimmed, as they are sent). */
function sameAnswers(saved: Values, sent: Values): boolean {
  return (['firstName', 'lastName', 'city'] as const).every(
    (name) => saved[name] === sent[name].trim(),
  );
}

function invalid(name: Name): string {
  const errors = copy.setUp.errors;
  return name === 'firstName'
    ? errors.firstNameInvalid
    : name === 'lastName'
      ? errors.lastNameInvalid
      : errors.cityInvalid;
}

function fieldOf(path: string): Name | undefined {
  if (path === 'firstName' || path === 'lastName') return path;
  if (path === 'location.city') return 'city';
  return undefined;
}
