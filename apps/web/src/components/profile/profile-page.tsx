import { useEffect, useRef } from 'react';
import { copy } from '@/copy/index.ts';
import type { Profile } from '@/lib/api/profile.ts';

/**
 * The Profile page (#33, the round 7 prototype's profile-preview): what the deputy knows about the
 * person, by section. Its first section, About you, shows the saved details in the prototype's
 * groups (name and headline, contact and location, links). Editing them, and the Target roles
 * section, come next (#33 pieces 6a2, 6a3); the prototype's readiness overview waits for the
 * sections it counts.
 */
export function ProfilePage({ profile }: { profile: Profile }) {
  const text = copy.profilePage;
  // The page's title takes focus when it opens, so the change of page is announced.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <div className="mx-auto grid w-full max-w-[880px] content-start gap-8 px-[17px] py-8 sm:px-[clamp(21px,4vw,55px)] md:py-14">
      <div className="grid gap-2">
        <p className="m-0 flex items-center gap-2 text-xs font-[750] tracking-[0.12em] uppercase before:block before:h-[3px] before:w-[13px] before:rounded-full before:bg-green">
          {text.eyebrow}
        </p>
        <h1
          ref={title}
          tabIndex={-1}
          className="m-0 font-display text-[clamp(2.25rem,8vw,3rem)] leading-none font-medium tracking-[-0.05em] text-balance outline-none"
        >
          {text.title}
        </h1>
        <p className="m-0 text-[0.9375rem] text-muted-foreground">{text.intro}</p>
      </div>
      <AboutYou profile={profile} />
    </div>
  );
}

function AboutYou({ profile }: { profile: Profile }) {
  const text = copy.profilePage.about;
  const facts = factsOf(profile);
  return (
    <section
      aria-labelledby="about-title"
      className="@container min-w-0 rounded-[34px] border border-line-soft bg-surface p-[21px] shadow-panel sm:p-[34px]"
    >
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-[21px]">
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-paper-deep text-ink-soft"
        >
          <PersonIcon />
        </span>
        <div className="grid gap-1">
          <h2 id="about-title" className="m-0 text-xl font-[700] tracking-[-0.02em]">
            {text.title}
          </h2>
          <p className="m-0 text-sm text-muted-foreground">{text.line}</p>
        </div>
      </div>
      <Group id="about-name" title={text.name.title} facts={facts.name} />
      <Group id="about-contact" title={text.contact.title} facts={facts.contact} />
      <Group id="about-links" title={text.links.title} facts={facts.links} />
    </section>
  );
}

type Fact = readonly [label: string, value: string | undefined];

/** One group of facts under its heading (the prototype's `.profile-group`). */
function Group({ id, title, facts }: { id: string; title: string; facts: readonly Fact[] }) {
  return (
    <div className="mt-[34px] grid min-w-0 gap-[13px] border-t border-line pt-[34px]">
      <h3 id={`${id}-title`} className="m-0 text-base font-[700]">
        {title}
      </h3>
      <dl aria-labelledby={`${id}-title`} className="m-0 grid">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-x-[21px] gap-y-1 border-b border-line-soft py-[13px] last:border-b-0 @[560px]:grid-cols-[178px_minmax(0,1fr)] @[560px]:items-baseline"
          >
            <dt className="text-[0.8125rem] font-[650] text-muted-foreground">{label}</dt>
            <dd
              className={
                value
                  ? 'm-0 min-w-0 text-[0.9375rem] wrap-anywhere text-ink'
                  : 'm-0 min-w-0 text-[0.9375rem] text-muted-foreground'
              }
            >
              {value || copy.profilePage.notAdded}
            </dd>
          </div>
        ))}
      </dl>
    </div>
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
      [about.links.other, links.other?.length ? links.other.join(', ') : undefined],
    ],
  } satisfies Record<string, Fact[]>;
}

function PersonIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[22px]"
    >
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20c.6-3.75 3.4-6 7.25-6s6.65 2.25 7.25 6" />
    </svg>
  );
}
