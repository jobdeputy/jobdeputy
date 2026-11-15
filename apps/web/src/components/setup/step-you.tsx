import { profileInput } from '@jobdeputy/shared/profile';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { Field } from '@/components/auth/fields.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy, fill } from '@/copy/index.ts';
import { ApiError, useApi } from '@/lib/api/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { useDelayedPending } from '@/lib/use-delayed-pending.ts';
import { cn } from '@/lib/utils.ts';
import { Fact, StepIntro } from './parts.tsx';

type Name = 'firstName' | 'lastName' | 'city';
type Errors = Partial<Record<Name, string>>;

/** The longest each field may be (the API's limits, packages/shared/src/profile.ts). */
const LIMITS: Record<Name, number> = { firstName: 100, lastName: 100, city: 100 };

/** The country every profile has for now: the US (the only Region, US-only launch). */
const COUNTRY = 'US';

/**
 * Set it up, step 1 (#33): who the person is. First and last name (the API needs both) and,
 * optionally, the city they are based in; the country is the United States, as their Region.
 * Checked with the API's own schema before it is sent, then saved (`PUT /me/profile`), so the
 * next step starts from a saved profile. A wrong field says why beside itself and takes focus; a
 * refusal from the API is said above the buttons.
 */
export function StepYou({
  profile,
  onSaved,
  onBack,
}: {
  profile: Profile | null;
  onSaved: () => void;
  onBack: () => void;
}) {
  const text = copy.setUp.you;
  const api = useApi();
  const queries = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const location = profile?.location as { city?: string } | undefined;
  const [values, setValues] = useState<Record<Name, string>>({
    firstName: typeof profile?.firstName === 'string' ? profile.firstName : '',
    lastName: typeof profile?.lastName === 'string' ? profile.lastName : '',
    city: location?.city ?? '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const waiting = useDelayedPending(pending);
  const refusalId = useId();

  const bind = (name: Name) => ({
    name,
    value: values[name],
    error: errors[name] ?? null,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setRefusal(null);
    const city = values.city.trim();
    // What this step owns, on top of what is saved (a later step's answers stay as they are).
    const { version = 0, ...saved } = profile ?? {};
    const body = {
      ...saved,
      version,
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      location: { ...(city ? { city } : {}), country: COUNTRY },
    };
    const found = check(body);
    setErrors(found);
    const first = (Object.keys(found) as Name[])[0];
    if (first) {
      form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    try {
      const next = await api.request<Profile>('PUT', '/me/profile', body);
      queries.setQueryData(['profile'], next);
      onSaved();
    } catch (error) {
      const kind = error instanceof ApiError ? error.kind : 'server';
      if (error instanceof ApiError && kind === 'invalid' && error.fieldErrors.length > 0) {
        setErrors(fromApi(error));
      } else if (kind === 'conflict' || kind === 'unsure') {
        // Saved meanwhile (here, or elsewhere): read it again, then let the person check it.
        await queries.invalidateQueries({ queryKey: ['profile'] });
        setRefusal(copy.setUp.errors.changedElsewhere);
      } else {
        setRefusal(
          kind === 'signed-out' ? copy.setUp.errors.signedOut : copy.setUp.errors.saveFailed,
        );
      }
    } finally {
      setPending(false);
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

/** This step's fields, checked with the API's schema, in the person's words. */
function check(body: unknown): Errors {
  const result = profileInput.safeParse(body);
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const name = fieldOf(issue.path.join('.'));
    if (!name || errors[name]) continue;
    errors[name] =
      issue.code === 'too_big'
        ? fill(copy.setUp.errors.tooLong, { max: String(LIMITS[name]) })
        : name === 'lastName'
          ? copy.setUp.errors.lastNameMissing
          : name === 'firstName'
            ? copy.setUp.errors.firstNameMissing
            : issue.message;
  }
  return errors;
}

/** The API's refusals, per field, where they are this step's. */
function fromApi(error: ApiError): Errors {
  const errors: Errors = {};
  for (const { path, message } of error.fieldErrors) {
    const name = fieldOf(path);
    if (name && !errors[name]) errors[name] = message;
  }
  return errors;
}

function fieldOf(path: string): Name | undefined {
  if (path === 'firstName' || path === 'lastName') return path;
  if (path === 'location.city') return 'city';
  return undefined;
}
