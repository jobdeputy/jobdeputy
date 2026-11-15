import { profileInput } from '@jobdeputy/shared/profile';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Field } from '@/components/auth/fields.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import { DEFAULT_RETRY_AFTER_SECONDS } from '@/lib/api/client.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { Fact, StepIntro } from './parts.tsx';

type Name = 'firstName' | 'lastName' | 'city';
type Values = Record<Name, string>;
type Errors = Partial<Record<Name, string>>;

/** What a save may carry: the API's schema is strict and refuses anything else it is sent. */
const INPUT_KEYS: readonly string[] = profileInput.keyof().options;

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
  const [pending, setPending] = useState(false);
  const waiting = useDelayedPending(pending);
  const refusalId = useId();
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
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });

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
    setRefusal(null);
    const body = saveBody(profile, values);
    const found = check(body);
    setErrors(found.fields);
    const first = (Object.keys(found.fields) as Name[])[0];
    if (first) {
      form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    if (found.other) {
      setRefusal(copy.setUp.errors.cannotSave);
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
      await refused(error, { ...values, version: body.version });
    } finally {
      if (here.current) setPending(false);
    }
  }

  /** Says why a save was refused, in this step's words, and what to do. */
  async function refused(error: unknown, sent: Values & { version: number }) {
    const errorsText = copy.setUp.errors;
    const kind = error instanceof ApiError ? error.kind : 'server';
    if (kind === 'invalid' && error instanceof ApiError && error.fieldErrors.length > 0) {
      const { fields, other } = fromApi(error);
      setErrors(fields);
      // Refused on a field it doesn't show too: say so, as well as the fields here.
      if (other || Object.keys(fields).length === 0) setRefusal(errorsText.cannotSave);
      // The first refused field takes focus, so its reason is read out.
      const first = (Object.keys(fields) as Name[])[0];
      if (first) form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    } else if (kind === 'conflict' && error instanceof ApiError && error.code === 'try-again') {
      // A write that collided: nothing was saved and nothing changed. Keep what was typed.
      setRefusal(errorsText.tryLater);
    } else if (kind === 'conflict') {
      // Changed meanwhile: show what is saved now, so nothing is overwritten unseen.
      const fresh = await reload();
      if (!here.current) return;
      if (fresh) setValues(valuesOf(fresh));
      setRefusal(fresh ? errorsText.changedElsewhere : errorsText.saveFailed);
    } else if (kind === 'unsure') {
      // The answer was lost: if what is saved now is what was sent, the save went through.
      const fresh = await reload();
      if (!here.current) return;
      if (fresh && fresh.version > sent.version && sameAnswers(valuesOf(fresh), sent)) onSaved();
      else setRefusal(errorsText.saveFailed);
    } else if (kind === 'too-many' && error instanceof ApiError) {
      setRefusal(
        fill(errorsText.tooMany, {
          wait: waitText(error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS),
        }),
      );
    } else if (kind === 'forbidden') {
      setRefusal(errorsText.accountClosed);
    } else if (kind === 'signed-out') {
      setRefusal(errorsText.signedOut);
    } else if (kind === 'offline') {
      setRefusal(errorsText.saveFailed);
    } else {
      setRefusal(errorsText.tryLater);
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
        aria-describedby={refusal ? refusalId : undefined}
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
          {pending && waiting ? text.saving : ''}
        </p>
        <p
          id={refusalId}
          role="alert"
          className={cn('m-0 text-sm font-[650] text-danger-ink', !refusal && 'sr-only')}
        >
          {refusal}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" pending={pending} pendingLabel={text.saving}>
            {text.continue}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={pending}>
            {text.back}
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

/** A wait in words: "1 second", "30 seconds", "2 minutes". */
function waitText(seconds: number): string {
  const units = copy.setUp.errors.units;
  const plural = new Intl.PluralRules('en');
  if (seconds < 60) {
    return fill(units.seconds[plural.select(seconds) === 'one' ? 'one' : 'other'], {
      count: String(seconds),
    });
  }
  const minutes = Math.ceil(seconds / 60);
  return fill(units.minutes[plural.select(minutes) === 'one' ? 'one' : 'other'], {
    count: String(minutes),
  });
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
