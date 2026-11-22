import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Field, TextAreaField } from '@/components/auth/fields.tsx';
import { EditIcon, PersonIcon, TargetIcon } from '@/components/icons.tsx';
import { PageIntro } from '@/components/page-intro.tsx';
import { Fact, LoadFailed, useSaying } from '@/components/setup/parts.tsx';
import { Button } from '@/components/ui/button.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';
import { type Role, useRoles } from '@/lib/api/roles.ts';
import { cn } from '@/lib/utils.ts';
import {
  cityField,
  linkFields,
  MAX_OTHER_LINKS,
  nameFields,
  phoneFields,
  putCity,
  putLinks,
  putPhone,
  putText,
} from './fields.ts';
import { type FormSpec, useProfileForm } from './profile-form.tsx';
import { RolesForm } from './roles-form.tsx';

/**
 * The Profile page (#33, the round 7 prototype's profile-preview): what the deputy knows about the
 * person, by section. Its first section, About you, shows the saved details in the prototype's
 * groups (name and headline, contact and location, links); each group's Edit opens its form in
 * place, and Save or Cancel goes back to the facts. Job preferences holds the target roles,
 * edited with the set-up's editor. The prototype's readiness overview waits for the sections it
 * counts.
 */
export function ProfilePage({ profile }: { profile: Profile }) {
  const text = copy.profilePage;
  // "Name and headline saved.": said once a group's form closes (focus is back on its Edit).
  const { spoken, say } = useSaying();
  return (
    <div className="grid w-full max-w-[880px] content-start gap-8">
      <PageIntro id="profile-title" eyebrow={text.eyebrow} title={text.title} intro={text.intro} />
      <AboutYou profile={profile} say={say} />
      <JobPreferences say={say} />
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}

function AboutYou({ profile, say }: { profile: Profile; say: (words: string) => void }) {
  const text = copy.profilePage.about;
  const facts = factsOf(profile);
  return (
    <Section
      id="about"
      icon={<PersonIcon className="size-[22px]" />}
      title={text.title}
      line={text.line}
    >
      <Group
        id="about-name"
        title={text.name.title}
        view={<Facts facts={facts.name} />}
        say={say}
        editor={(done) => <NameForm profile={profile} {...done} />}
      />
      <Group
        id="about-contact"
        title={text.contact.title}
        view={<Facts facts={facts.contact} />}
        say={say}
        editor={(done) => <ContactForm profile={profile} {...done} />}
      />
      <Group
        id="about-links"
        title={text.links.title}
        view={<Facts facts={facts.links} />}
        say={say}
        editor={(done) => <LinksForm profile={profile} {...done} />}
      />
    </Section>
  );
}

/** A section of the page (the prototype's `.profile-section`): its icon, title and line, then its groups. */
function Section({
  id,
  icon,
  title,
  line,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  line: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="@container min-w-0 rounded-[34px] border border-line-soft bg-surface p-[21px] shadow-panel sm:p-[34px]"
    >
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-[21px]">
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-paper-deep text-ink-soft"
        >
          {icon}
        </span>
        <div className="grid gap-1">
          <h2 id={`${id}-title`} className="m-0 text-xl font-[700] tracking-[-0.02em]">
            {title}
          </h2>
          <p className="m-0 text-sm text-muted-foreground">{line}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Job preferences (#33 piece 6a3): what the deputy looks for. Its Target roles group lists the
 * titles it searches for; Edit opens the set-up's roles editor in place (`RolesForm`).
 */
function JobPreferences({ say }: { say: (words: string) => void }) {
  const text = copy.profilePage.preferences;
  const roles = useRoles();
  return (
    <Section
      id="preferences"
      icon={<TargetIcon className="size-[22px]" />}
      title={text.title}
      line={text.line}
    >
      <Group
        id="preferences-roles"
        title={text.roles.title}
        say={say}
        // Edited once they are read (the editor starts from what is saved).
        editable={roles.data !== undefined}
        view={
          <QueryRegion
            query={roles}
            skeleton={{ kind: 'block', rows: 1 }}
            label={copy.setUp.roles.loading}
            error={
              <LoadFailed
                error={roles.error}
                message={copy.setUp.roles.loadFailed}
                retry={copy.setUp.roles.retry}
                onRetry={() => roles.refetch()}
              />
            }
          >
            {(saved) => <RoleTitles roles={saved} labelledBy="preferences-roles-title" />}
          </QueryRegion>
        }
        editor={(done) => <RolesEditor saved={roles.data ?? []} {...done} />}
      />
    </Section>
  );
}

/** The saved titles, as tags (the prototype's `.tag`), or that none are added yet. */
function RoleTitles({ roles, labelledBy }: { roles: readonly Role[]; labelledBy: string }) {
  if (roles.length === 0) {
    return (
      <p className="m-0 text-[0.9375rem] text-muted-foreground">
        {copy.profilePage.preferences.roles.none}
      </p>
    );
  }
  return (
    <ul aria-labelledby={labelledBy} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {roles.map((role) => (
        <li
          key={role.roleId}
          className="min-w-0 rounded-full border border-line bg-paper px-3 py-1.5 text-sm font-[650] wrap-anywhere text-ink"
        >
          {role.title}
        </li>
      ))}
    </ul>
  );
}

/** The roles editor in a group's form box, opening at its title field; Save and Cancel. */
function RolesEditor({ saved, labelledBy, onSaved, onCancel }: Done & { saved: Role[] }) {
  const text = copy.profilePage;
  const queries = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  useOpenAtFirstField(box);
  return (
    <div ref={box} className={EDITOR_BOX}>
      <RolesForm
        saved={saved}
        place={{
          labelledBy,
          submit: text.save,
          cancel: text.cancel,
          size: 'default',
          tooMany: text.preferences.roles.tooMany,
          changedElsewhere: text.preferences.roles.changedElsewhere,
        }}
        onSaved={onSaved}
        onCancel={() => {
          // A save that failed partway, or whose answer was lost, may have saved some of it: the
          // list is read again, so it shows what is saved (never claimed as Saved here).
          void queries.invalidateQueries({ queryKey: ['roles'] });
          onCancel();
        }}
      />
    </div>
  );
}

/** A group's form opens at its first field (Edit is gone, so focus goes somewhere useful). */
function useOpenAtFirstField(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [ref]);
}

/** A group's form box (the prototype's `.profile-editor`). */
const EDITOR_BOX = 'grid min-w-0 gap-[21px] rounded-[22px] border border-line bg-paper p-[21px]';

/** A group's saved facts (the prototype's `.profile-facts`): label, then value or Not added. */
function Facts({ facts }: { facts: readonly FactRow[] }) {
  const text = copy.profilePage;
  return (
    <dl className="m-0 grid">
      {facts.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-x-[21px] gap-y-1 border-b border-line-soft py-[13px] last:border-b-0 @[560px]:grid-cols-[178px_minmax(0,1fr)] @[560px]:items-baseline"
        >
          <dt className="text-[0.8125rem] font-[650] text-muted-foreground">{label}</dt>
          <dd
            className={
              value?.length
                ? 'm-0 grid min-w-0 text-[0.9375rem] wrap-anywhere text-ink'
                : 'm-0 min-w-0 text-[0.9375rem] text-muted-foreground'
            }
          >
            {!value?.length
              ? text.notAdded
              : typeof value === 'string'
                ? value
                : value.map((line, at) => (
                    // The same address may be listed twice: placed by where it is.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list
                    <span key={at}>{line}</span>
                  ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type FactRow = readonly [label: string, value: string | readonly string[] | undefined];

/** How a group's form ends: saved, or cancelled (not marked Saved). Both go back to what is saved. */
type Done = { labelledBy: string; onSaved: () => void; onCancel: () => void };

/**
 * One group under its heading (the prototype's `.profile-group`), with Edit: the form replaces
 * what is saved and takes focus at its first field; Save or Cancel brings the facts back and
 * focus to Edit, and a save marks the group Saved (and says so) until it is edited again.
 */
function Group({
  id,
  title,
  view,
  say,
  editor,
  editable = true,
}: {
  id: string;
  title: string;
  /** What is saved, shown while the form is closed. */
  view: ReactNode;
  say: (words: string) => void;
  editor: (done: Done) => ReactNode;
  /** Whether Edit is offered yet. */
  editable?: boolean;
}) {
  const text = copy.profilePage;
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  function close(didSave: boolean) {
    // Rendered first, so focus lands on the Edit button that comes back.
    flushSync(() => {
      setEditing(false);
      setSaved(didSave);
    });
    edit.current?.focus();
    if (didSave) say(fill(text.savedSaid, { group: title }));
  }
  return (
    <div className="mt-[34px] grid min-w-0 gap-[13px] border-t border-line pt-[34px]">
      <div className="flex min-h-11 items-center gap-[13px]">
        <h3 id={`${id}-title`} className="m-0 min-w-0 flex-1 text-base font-[700]">
          {title}
        </h3>
        {saved && !editing && (
          <p className="m-0 flex shrink-0 items-center gap-1.5 text-xs font-[650] text-green-ink before:font-[800] before:content-['✓']">
            {text.saved}
          </p>
        )}
        {!editing && editable && (
          <Button
            ref={edit}
            variant="outline"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            <EditIcon />
            {text.edit}
            <span className="sr-only"> {title}</span>
          </Button>
        )}
      </div>
      {editing
        ? editor({
            labelledBy: `${id}-title`,
            onSaved: () => close(true),
            onCancel: () => close(false),
          })
        : view}
    </div>
  );
}

/**
 * A group's form (the prototype's `.profile-editor`): its fields, two to a row where the section
 * is wide enough, then why a save failed, then Save and Cancel. It opens at its first field.
 */
function GroupForm<N extends string>({
  spec,
  profile,
  labelledBy,
  onSaved,
  onCancel,
  children,
}: Done & {
  spec: FormSpec<N>;
  profile: Profile;
  children: (bind: ReturnType<typeof useProfileForm<N>>['bind']) => ReactNode;
}) {
  const text = copy.profilePage;
  const { bind, pending, form, messages } = useProfileForm({ spec, profile, onSaved });
  useOpenAtFirstField(form.ref);
  return (
    <form {...form} aria-labelledby={labelledBy} className={cn(EDITOR_BOX, form.className)}>
      <div className="grid min-w-0 items-start gap-[21px] @[640px]:grid-cols-2">
        {children(bind)}
      </div>
      {messages}
      <div className="flex flex-wrap items-center gap-x-[13px] gap-y-2">
        <Button type="submit" pending={pending} pendingLabel={copy.setUp.saving}>
          {text.save}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {text.cancel}
        </Button>
      </div>
    </form>
  );
}

const nameSpec: FormSpec<'firstName' | 'lastName' | 'preferredName' | 'headline'> = {
  fields: nameFields,
  apply(body, answers) {
    body.firstName = answers.firstName;
    body.lastName = answers.lastName;
    putText(body, 'preferredName', answers.preferredName);
    putText(body, 'headline', answers.headline);
  },
  savedMeanwhile: copy.profilePage.errors.savedMeanwhile,
  changedElsewhere: copy.profilePage.errors.changedElsewhere,
};

function NameForm({ profile, ...done }: Done & { profile: Profile }) {
  const text = copy.profilePage.about.name;
  return (
    <GroupForm spec={nameSpec} profile={profile} {...done}>
      {(bind) => (
        <>
          <Field label={text.firstName} autoComplete="given-name" {...bind('firstName')} />
          <Field label={text.lastName} autoComplete="family-name" {...bind('lastName')} />
          <Field
            label={text.preferredName}
            hint={text.preferredNameHint}
            autoComplete="nickname"
            className="col-span-full"
            {...bind('preferredName')}
          />
          <Field
            label={text.headline}
            hint={text.headlineHint}
            className="col-span-full"
            {...bind('headline')}
          />
        </>
      )}
    </GroupForm>
  );
}

const contactSpec: FormSpec<'phoneCode' | 'phoneNumber' | 'city'> = {
  fields: {
    ...phoneFields,
    city: cityField,
  },
  apply(body, answers) {
    putPhone(body, answers.phoneCode, answers.phoneNumber);
    putCity(body, answers.city);
  },
  savedMeanwhile: copy.profilePage.errors.savedMeanwhile,
  changedElsewhere: copy.profilePage.errors.changedElsewhere,
};

function ContactForm({ profile, ...done }: Done & { profile: Profile }) {
  const text = copy.profilePage.about.contact;
  const email = typeof profile.email === 'string' ? profile.email : '';
  return (
    <GroupForm spec={contactSpec} profile={profile} {...done}>
      {(bind) => (
        <>
          <ul className="col-span-full m-0 grid list-none gap-2 p-0 @[640px]:grid-cols-2">
            <Fact label={text.email} value={email} pill={copy.setUp.locked} />
            <Fact label={text.country} value={copy.setUp.region} pill={copy.setUp.locked} />
          </ul>
          <div className="col-span-full grid items-start gap-[13px] @[440px]:grid-cols-[minmax(89px,0.35fr)_minmax(0,1fr)]">
            <Field
              label={text.phoneCode}
              autoComplete="tel-country-code"
              inputMode="tel"
              {...bind('phoneCode')}
            />
            <Field
              label={text.phoneNumber}
              type="tel"
              autoComplete="tel-national"
              {...bind('phoneNumber')}
            />
          </div>
          <Field label={text.city} autoComplete="address-level2" {...bind('city')} />
        </>
      )}
    </GroupForm>
  );
}

const linksSpec: FormSpec<keyof typeof linkFields> = {
  fields: linkFields,
  apply: putLinks,
  savedMeanwhile: copy.profilePage.errors.savedMeanwhile,
  changedElsewhere: copy.profilePage.errors.changedElsewhere,
};

function LinksForm({ profile, ...done }: Done & { profile: Profile }) {
  const text = copy.profilePage.about.links;
  const url = { type: 'url', inputMode: 'url', autoCapitalize: 'none', spellCheck: false } as const;
  return (
    <GroupForm spec={linksSpec} profile={profile} {...done}>
      {(bind) => (
        <>
          <Field label={text.linkedin} hint={text.linkHint} {...url} {...bind('linkedin')} />
          <Field label={text.github} {...url} {...bind('github')} />
          <Field label={text.portfolio} {...url} {...bind('portfolio')} />
          <Field label={text.website} {...url} {...bind('website')} />
          <TextAreaField
            label={text.other}
            hint={fill(text.otherHint, { max: String(MAX_OTHER_LINKS) })}
            autoCapitalize="none"
            spellCheck={false}
            className="col-span-full"
            {...bind('other')}
          />
        </>
      )}
    </GroupForm>
  );
}

/** The saved details, as the page shows them (the API's shapes: packages/shared/src/profile.ts). */
export function factsOf(profile: Profile) {
  const text = copy.profilePage;
  const about = text.about;
  const location = (profile.location ?? {}) as { city?: string; country?: string };
  const phone = (profile.phone ?? {}) as { countryCode?: string; number?: string };
  const links = (profile.links ?? {}) as {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    website?: string;
    other?: string[];
  };
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  return {
    name: [
      [about.name.firstName, str(profile.firstName)],
      [about.name.lastName, str(profile.lastName)],
      [about.name.preferredName, str(profile.preferredName)],
      [about.name.headline, str(profile.headline)],
    ],
    contact: [
      [about.contact.email, str(profile.email)],
      [
        about.contact.phone,
        phone.number ? [phone.countryCode, phone.number].filter(Boolean).join(' ') : undefined,
      ],
      [about.contact.city, str(location.city)],
      [
        about.contact.country,
        location.country ? (text.countries[location.country] ?? location.country) : undefined,
      ],
    ],
    links: [
      [about.links.linkedin, str(links.linkedin)],
      [about.links.github, str(links.github)],
      [about.links.portfolio, str(links.portfolio)],
      [about.links.website, str(links.website)],
      [about.links.other, links.other ?? []],
    ],
  } satisfies Record<string, FactRow[]>;
}
