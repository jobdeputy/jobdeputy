import { Field } from '@/components/auth/fields.tsx';
import { cityField, nameFields, putCity } from '@/components/profile/fields.ts';
import { type FormSpec, useProfileForm } from '@/components/profile/profile-form.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { cn } from '@/lib/utils.ts';
import { Fact, StepIntro } from './parts.tsx';

/** Step 1's fields: first and last name, and the city (its location keeps the rest saved). */
export const youSpec: FormSpec<'firstName' | 'lastName' | 'city'> = {
  fields: {
    firstName: nameFields.firstName,
    lastName: nameFields.lastName,
    city: cityField,
  },
  apply(body, answers) {
    body.firstName = answers.firstName;
    body.lastName = answers.lastName;
    putCity(body, answers.city);
  },
  savedMeanwhile: copy.setUp.errors.savedMeanwhile,
  changedElsewhere: copy.setUp.errors.changedElsewhere,
};

/**
 * Set it up, step 1 (#33): who the person is. First and last name (the API needs both) and,
 * optionally, the city they are based in; the country is the United States, as their Region.
 * Saved as the Profile page's groups are (`useProfileForm`).
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
  const { bind, pending, form, messages } = useProfileForm({ spec: youSpec, profile, onSaved });
  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <form {...form} aria-labelledby="set-up-title" className={cn('grid gap-4', form.className)}>
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
        {messages}
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
