import {
  applicantInput,
  DECLINE,
  DISABILITY_STATUSES,
  GENDERS,
  HEARD_ABOUT,
  HISPANIC_LATINO,
  RACES,
  SECURITY_CLEARANCES,
  VETERAN_STATUSES,
  voluntaryInput,
  WORK_SETUPS,
} from '@jobdeputy/shared/applicant';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ChoicesField, Field, SelectField } from '@/components/auth/fields.tsx';
import { ClipboardIcon } from '@/components/icons.tsx';
import { Section } from '@/components/section.tsx';
import { LoadFailed } from '@/components/setup/parts.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import {
  APPLICANT_KEY,
  type SavedAnswers,
  useApplicant,
  useVoluntary,
  VOLUNTARY_KEY,
} from '@/lib/api/answers.ts';
import { type Done, type FactRow, Facts, Group, GroupForm } from './group.tsx';
import type { FieldSpec, FormSpec, Resource, SaveBody } from './profile-form.tsx';

/**
 * The Profile page's Application answers (#53, decision 0019): what application forms ask every
 * time, in groups edited as About you's are, then the voluntary self-identification (every
 * answer "I don't wish to answer" until the person changes it). Anything left unanswered is left
 * for the person on the form; the line below says what is never answered for them.
 */
export function ApplicationAnswers({ say }: { say: (words: string) => void }) {
  const text = copy.profilePage.answers;
  const applicant = useApplicant();
  const voluntary = useVoluntary();
  const groups: {
    id: string;
    title: string;
    query: UseQueryResult<SavedAnswers, unknown>;
    facts: (saved: SavedAnswers) => ReactNode;
    form: (saved: SavedAnswers, done: Done) => ReactNode;
  }[] = [
    {
      id: 'answers-work',
      title: text.work.title,
      query: applicant,
      facts: (saved) => (
        <Facts empty={copy.profilePage.answers.notAnswered} facts={workFacts(saved)} />
      ),
      form: (saved, done) => <WorkForm saved={saved} {...done} />,
    },
    {
      id: 'answers-availability',
      title: text.availability.title,
      query: applicant,
      facts: (saved) => (
        <Facts empty={copy.profilePage.answers.notAnswered} facts={availabilityFacts(saved)} />
      ),
      form: (saved, done) => <AvailabilityForm saved={saved} {...done} />,
    },
    {
      id: 'answers-pay',
      title: text.pay.title,
      query: applicant,
      facts: (saved) => (
        <Facts empty={copy.profilePage.answers.notAnswered} facts={payFacts(saved)} />
      ),
      form: (saved, done) => <PayForm saved={saved} {...done} />,
    },
    {
      id: 'answers-setup',
      title: text.setup.title,
      query: applicant,
      facts: (saved) => (
        <Facts empty={copy.profilePage.answers.notAnswered} facts={setupFacts(saved)} />
      ),
      form: (saved, done) => <SetupForm saved={saved} {...done} />,
    },
    {
      id: 'answers-other',
      title: text.other.title,
      query: applicant,
      facts: (saved) => (
        <Facts empty={copy.profilePage.answers.notAnswered} facts={otherFacts(saved)} />
      ),
      form: (saved, done) => <OtherForm saved={saved} {...done} />,
    },
    {
      id: 'answers-voluntary',
      title: text.voluntary.title,
      query: voluntary,
      facts: (saved) => <VoluntaryFacts saved={saved} />,
      form: (saved, done) => <VoluntaryForm saved={saved} {...done} />,
    },
  ];
  return (
    <Section
      id="answers"
      icon={<ClipboardIcon className="size-[22px]" />}
      title={text.title}
      line={text.line}
    >
      {groups.map((group, at) => (
        <Group
          key={group.id}
          id={group.id}
          title={group.title}
          say={say}
          // Edited once read (each form starts from what is saved).
          editable={group.query.data !== undefined}
          view={
            // The applicant groups share one read: only the first says it is loading or failed
            // (one alert, one Try again); the others wait quietly for it.
            at > 0 &&
            groups[at - 1]?.query === group.query &&
            group.query.data === undefined ? null : (
              <QueryRegion
                query={group.query}
                skeleton={{ kind: 'block', rows: 2 }}
                label={text.loading}
                error={
                  <LoadFailed
                    error={group.query.error}
                    message={text.loadFailed}
                    retry={text.retry}
                    onRetry={() => group.query.refetch()}
                  />
                }
              >
                {(saved) => group.facts(saved)}
              </QueryRegion>
            )
          }
          editor={(done) => group.query.data && group.form(group.query.data, done)}
        />
      ))}
      <p className="mt-[34px] mb-0 border-t border-line pt-[21px] text-sm text-muted-foreground">
        {text.neverGuessed}
      </p>
    </Section>
  );
}

const APPLICANT_RESOURCE: Resource = {
  path: '/me/applicant',
  queryKey: APPLICANT_KEY,
  schema: applicantInput as unknown as Resource['schema'],
  inputKeys: applicantInput.keyof().options,
};

const VOLUNTARY_RESOURCE: Resource = {
  path: '/me/voluntary',
  queryKey: VOLUNTARY_KEY,
  schema: voluntaryInput as unknown as Resource['schema'],
  inputKeys: voluntaryInput.keyof().options,
};

const errors = copy.profilePage.answers.errors;
const applicantSpec = <N extends string>(
  fields: Record<N, FieldSpec>,
  apply: FormSpec<N>['apply'],
): FormSpec<N> => ({
  fields,
  apply,
  resource: APPLICANT_RESOURCE,
  savedMeanwhile: errors.savedMeanwhile,
  changedElsewhere: errors.changedElsewhere,
});

// ---- What is saved, as a form types it, and back -----------------------------------------

/** A yes/no answer as a choice: `yes`, `no`, or '' (not answered). */
function yesNoOf(value: unknown): string {
  return value === true ? 'yes' : value === false ? 'no' : '';
}
function putYesNo(body: SaveBody, key: string, answer: string) {
  if (answer === '') delete body[key];
  else body[key] = answer === 'yes';
}
/** A choice from a list, or '' when not answered. */
function choiceOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
/**
 * A choice the list still offers, or '': a saved value the form doesn't offer (renamed since)
 * reads as unanswered, so a save never sends back a value the person can't see.
 */
function offeredOf(value: unknown, offered: readonly string[]): string {
  const choice = choiceOf(value);
  return offered.includes(choice) ? choice : '';
}
function putChoice(body: SaveBody, key: string, answer: string) {
  if (answer === '') delete body[key];
  else body[key] = answer;
}
/** Whole numbers are sent as numbers; anything else as typed, so the schema says it's wrong. */
function wholeOrTyped(answer: string): number | string | undefined {
  if (answer === '') return undefined;
  return /^\d+$/.test(answer) ? Number(answer) : answer;
}
/** Money as typed, without its commas, dollar sign, and spaces. */
const plainNumber = (typed: string) => typed.replace(/[\s,$]/g, '');

type UsAuthorization = { country: string; authorized?: boolean; needsSponsorship?: boolean };
function workList(saved: SavedAnswers): UsAuthorization[] {
  return Array.isArray(saved.workAuthorization)
    ? (saved.workAuthorization as UsAuthorization[])
    : [];
}
const US = 'US';
const usOf = (saved: SavedAnswers) => workList(saved).find((w) => w.country === US);

type Salary = { min?: number; max?: number; currency?: string; period?: string };
const salaryOf = (saved: SavedAnswers) => (saved.expectedSalary ?? {}) as Salary;
/** The pay's currency: as saved, or US dollars. */
const currencyOf = (saved: SavedAnswers) => salaryOf(saved).currency ?? 'USD';

const yesNoOptions = () => {
  const text = copy.profilePage.answers;
  return [
    { value: '', label: text.notAnswered },
    { value: 'yes', label: text.yes },
    { value: 'no', label: text.no },
  ];
};
const listOptions = (values: readonly string[], names: Record<string, string>) => [
  { value: '', label: copy.profilePage.answers.notAnswered },
  ...values.map((value) => ({ value, label: names[value] ?? value })),
];
/** The voluntary choices: "I don't wish to answer" first, as forms put it. */
const voluntaryOptions = (values: readonly string[], names: Record<string, string>) => [
  { value: DECLINE, label: copy.profilePage.answers.voluntary.decline },
  ...values
    .filter((value) => value !== DECLINE)
    .map((value) => ({ value, label: names[value] ?? value })),
];

// ---- Work authorization -------------------------------------------------------------------

const workSpec = applicantSpec(
  {
    authorized: {
      read: (saved) => yesNoOf(usOf(saved)?.authorized),
      paths: ['workAuthorization.0.authorized'],
      invalid: errors.choiceInvalid,
      missing: errors.bothWork,
    },
    sponsorship: {
      read: (saved) => yesNoOf(usOf(saved)?.needsSponsorship),
      paths: ['workAuthorization.0.needsSponsorship'],
      invalid: errors.choiceInvalid,
      missing: errors.bothWork,
    },
  },
  (body, answers) => {
    const others = workList(body as SavedAnswers).filter((w) => w.country !== US);
    if (answers.authorized === '' && answers.sponsorship === '') {
      body.workAuthorization = others;
      return;
    }
    // The US first, so the schema's paths (`workAuthorization.0…`) are this form's fields; an
    // unanswered half is sent empty, and the schema asks for it.
    const us: UsAuthorization = { country: US };
    if (answers.authorized !== '') us.authorized = answers.authorized === 'yes';
    if (answers.sponsorship !== '') us.needsSponsorship = answers.sponsorship === 'yes';
    body.workAuthorization = [us, ...others];
  },
);

function WorkForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.work;
  return (
    <GroupForm spec={workSpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <SelectField
            label={text.authorized}
            options={yesNoOptions()}
            className="col-span-full"
            {...bind('authorized')}
          />
          <SelectField
            label={text.sponsorship}
            options={yesNoOptions()}
            className="col-span-full"
            {...bind('sponsorship')}
          />
        </>
      )}
    </GroupForm>
  );
}

// ---- Availability -------------------------------------------------------------------------

const availabilitySpec = applicantSpec(
  {
    notice: {
      read: (saved) =>
        typeof saved.noticePeriodDays === 'number' ? String(saved.noticePeriodDays) : '',
      paths: ['noticePeriodDays'],
      invalid: errors.noticeInvalid,
    },
    start: {
      read: (saved) => choiceOf(saved.earliestStartDate),
      paths: ['earliestStartDate'],
      invalid: errors.startInvalid,
    },
  },
  (body, answers) => {
    const notice = wholeOrTyped(answers.notice);
    if (notice === undefined) delete body.noticePeriodDays;
    else body.noticePeriodDays = notice;
    putChoice(body, 'earliestStartDate', answers.start);
  },
);

function AvailabilityForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.availability;
  return (
    <GroupForm spec={availabilitySpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <Field
            label={text.notice}
            hint={text.noticeHint}
            inputMode="numeric"
            {...bind('notice')}
          />
          <Field label={text.start} type="date" {...bind('start')} />
        </>
      )}
    </GroupForm>
  );
}

// ---- Pay ----------------------------------------------------------------------------------

const paySpec = applicantSpec(
  {
    min: {
      read: (saved) => (salaryOf(saved).min === undefined ? '' : String(salaryOf(saved).min)),
      norm: plainNumber,
      paths: ['expectedSalary.min', 'expectedSalary.currency'],
      invalid: errors.minInvalid,
      missing: errors.minMissing,
    },
    max: {
      read: (saved) => (salaryOf(saved).max === undefined ? '' : String(salaryOf(saved).max)),
      norm: plainNumber,
      paths: ['expectedSalary.max'],
      invalid: errors.maxInvalid,
    },
    period: {
      read: (saved) => offeredOf(salaryOf(saved).period, ['year', 'hour']) || 'year',
      paths: ['expectedSalary.period'],
      invalid: errors.choiceInvalid,
    },
  },
  (body, answers) => {
    // No amounts: no pay (the period means nothing without one).
    if (answers.min === '' && answers.max === '') {
      delete body.expectedSalary;
      return;
    }
    // In the currency the fields name: the saved one, else US dollars (the US-only launch).
    const salary: Record<string, unknown> = {
      currency: currencyOf(body as SavedAnswers),
      period: answers.period,
    };
    const min = wholeOrTyped(answers.min);
    const max = wholeOrTyped(answers.max);
    if (min !== undefined) salary.min = min;
    if (max !== undefined) salary.max = max;
    body.expectedSalary = salary;
  },
);

function PayForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.pay;
  const periods = Object.entries(text.periods).map(([value, label]) => ({ value, label }));
  return (
    <GroupForm spec={paySpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <Field
            label={fill(text.min, { currency: currencyOf(saved) })}
            inputMode="numeric"
            {...bind('min')}
          />
          <Field
            label={fill(text.max, { currency: currencyOf(saved) })}
            hint={text.maxHint}
            inputMode="numeric"
            {...bind('max')}
          />
          <SelectField label={text.period} options={periods} {...bind('period')} />
          <p className="col-span-full m-0 text-[0.8125rem] text-muted-foreground">{text.note}</p>
        </>
      )}
    </GroupForm>
  );
}

// ---- Work setup ---------------------------------------------------------------------------

const setupSpec = applicantSpec(
  {
    setups: {
      read: (saved) =>
        Array.isArray(saved.workSetups)
          ? saved.workSetups.filter((s) => WORK_SETUPS.includes(s)).join(',')
          : '',
      paths: ['workSetups'],
      invalid: errors.choiceInvalid,
    },
    relocate: {
      read: (saved) => yesNoOf(saved.willingToRelocate),
      paths: ['willingToRelocate'],
      invalid: errors.choiceInvalid,
    },
  },
  (body, answers) => {
    body.workSetups = answers.setups ? answers.setups.split(',') : [];
    putYesNo(body, 'willingToRelocate', answers.relocate);
  },
);

function SetupForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.setup;
  const setups = WORK_SETUPS.map((value) => ({ value, label: text.setupNames[value] ?? value }));
  return (
    <GroupForm spec={setupSpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <ChoicesField
            label={text.setups}
            options={setups}
            className="col-span-full"
            {...bind('setups')}
          />
          <SelectField label={text.relocate} options={yesNoOptions()} {...bind('relocate')} />
        </>
      )}
    </GroupForm>
  );
}

// ---- Other questions ----------------------------------------------------------------------

const otherSpec = applicantSpec(
  {
    over18: {
      read: (saved) => yesNoOf(saved.over18),
      paths: ['over18'],
      invalid: errors.choiceInvalid,
    },
    clearance: {
      read: (saved) => offeredOf(saved.securityClearance, SECURITY_CLEARANCES),
      paths: ['securityClearance'],
      invalid: errors.choiceInvalid,
    },
    pronouns: {
      read: (saved) => choiceOf(saved.pronouns),
      paths: ['pronouns'],
      invalid: errors.pronounsInvalid,
    },
    heard: {
      read: (saved) => offeredOf(saved.heardAbout, HEARD_ABOUT),
      paths: ['heardAbout'],
      invalid: errors.choiceInvalid,
    },
  },
  (body, answers) => {
    putYesNo(body, 'over18', answers.over18);
    putChoice(body, 'securityClearance', answers.clearance);
    putChoice(body, 'pronouns', answers.pronouns);
    putChoice(body, 'heardAbout', answers.heard);
  },
);

function OtherForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.other;
  return (
    <GroupForm spec={otherSpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <SelectField label={text.over18} options={yesNoOptions()} {...bind('over18')} />
          <SelectField
            label={text.clearance}
            options={listOptions(SECURITY_CLEARANCES, text.clearances)}
            {...bind('clearance')}
          />
          <Field label={text.pronouns} hint={text.pronounsHint} {...bind('pronouns')} />
          <SelectField
            label={text.heard}
            hint={text.heardHint}
            options={listOptions(HEARD_ABOUT, text.heardNames)}
            {...bind('heard')}
          />
        </>
      )}
    </GroupForm>
  );
}

// ---- Voluntary self-identification --------------------------------------------------------

type VoluntaryKey = 'gender' | 'hispanicLatino' | 'race' | 'veteran' | 'disability';

/** Each voluntary question: its label, its choices, and their names. */
function voluntaryQuestions() {
  const text = copy.profilePage.answers.voluntary;
  const yesNo = { yes: copy.profilePage.answers.yes, no: copy.profilePage.answers.no };
  return [
    ['gender', text.gender, GENDERS, text.genders],
    ['hispanicLatino', text.hispanicLatino, HISPANIC_LATINO, yesNo],
    ['race', text.race, RACES, text.races],
    ['veteran', text.veteran, VETERAN_STATUSES, text.veterans],
    ['disability', text.disability, DISABILITY_STATUSES, text.disabilities],
  ] as const satisfies readonly (readonly [
    VoluntaryKey,
    string,
    readonly string[],
    Record<string, string>,
  ])[];
}

const VOLUNTARY_CHOICES: Record<VoluntaryKey, readonly string[]> = {
  gender: GENDERS,
  hispanicLatino: HISPANIC_LATINO,
  race: RACES,
  veteran: VETERAN_STATUSES,
  disability: DISABILITY_STATUSES,
};

const voluntaryField = (key: VoluntaryKey): FieldSpec => ({
  read: (saved) => offeredOf(saved[key], VOLUNTARY_CHOICES[key]) || DECLINE,
  paths: [key],
  invalid: errors.choiceInvalid,
});

const voluntarySpec: FormSpec<VoluntaryKey> = {
  fields: {
    gender: voluntaryField('gender'),
    hispanicLatino: voluntaryField('hispanicLatino'),
    race: voluntaryField('race'),
    veteran: voluntaryField('veteran'),
    disability: voluntaryField('disability'),
  },
  apply(body, answers) {
    for (const [key, answer] of Object.entries(answers)) body[key] = answer;
  },
  resource: VOLUNTARY_RESOURCE,
  savedMeanwhile: errors.savedMeanwhile,
  changedElsewhere: errors.changedElsewhere,
};

function VoluntaryForm({ saved, ...done }: Done & { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.voluntary;
  return (
    <GroupForm spec={voluntarySpec} profile={saved} {...done}>
      {(bind) => (
        <>
          <p className="col-span-full m-0 text-[0.8125rem] text-muted-foreground">{text.why}</p>
          {voluntaryQuestions().map(([key, label, values, names]) => (
            <SelectField
              key={key}
              label={label}
              options={voluntaryOptions(values, names)}
              className={key === 'race' ? 'col-span-full' : undefined}
              {...bind(key)}
            />
          ))}
        </>
      )}
    </GroupForm>
  );
}

/** While every answer is declined, one line says nothing is shared; otherwise the answers. */
function VoluntaryFacts({ saved }: { saved: SavedAnswers }) {
  const text = copy.profilePage.answers.voluntary;
  const questions = voluntaryQuestions();
  const shared = questions.some(
    ([key]) => (offeredOf(saved[key], VOLUNTARY_CHOICES[key]) || DECLINE) !== DECLINE,
  );
  if (!shared) {
    return (
      <div className="grid gap-1.5">
        <p className="m-0 text-[0.9375rem] text-ink">{text.off}</p>
        <p className="m-0 text-[0.8125rem] text-muted-foreground">{text.why}</p>
      </div>
    );
  }
  return (
    <Facts
      facts={questions.map(([key, question, , names]) => {
        const label = key === 'hispanicLatino' ? text.hispanicLatinoFact : question;
        const answer = offeredOf(saved[key], VOLUNTARY_CHOICES[key]) || DECLINE;
        return [
          label,
          answer === DECLINE ? text.decline : (names as Record<string, string>)[answer],
        ];
      })}
    />
  );
}

// ---- The saved answers, as the groups show them -------------------------------------------

const yesNoText = (value: unknown) => {
  const text = copy.profilePage.answers;
  return value === true ? text.yes : value === false ? text.no : undefined;
};

function workFacts(saved: SavedAnswers): FactRow[] {
  const text = copy.profilePage.answers.work;
  const us = usOf(saved);
  return [
    [text.authorizedFact, yesNoText(us?.authorized)],
    [text.sponsorshipFact, yesNoText(us?.needsSponsorship)],
  ];
}

function availabilityFacts(saved: SavedAnswers): FactRow[] {
  const text = copy.profilePage.answers.availability;
  const days = saved.noticePeriodDays;
  const start = choiceOf(saved.earliestStartDate);
  return [
    [
      text.noticeFact,
      typeof days === 'number'
        ? days === 1
          ? text.oneDay
          : fill(text.days, { days: String(days) })
        : undefined,
    ],
    [text.start, start ? dateText(start) : undefined],
  ];
}

/** A yyyy-mm-dd date as words ("Jan 4, 2027"), read as the calendar day it names. */
function dateText(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  // Anything but a real yyyy-mm-dd day is shown as saved, never thrown on.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function payFacts(saved: SavedAnswers): FactRow[] {
  const text = copy.profilePage.answers.pay;
  const salary = salaryOf(saved);
  if (salary.min === undefined) return [[text.expected, undefined]];
  const money = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: salary.currency ?? 'USD',
    maximumFractionDigits: 0,
  });
  const per = text.per[salary.period ?? 'year'] ?? '';
  return [
    [
      text.expected,
      salary.max === undefined || salary.max === salary.min
        ? fill(text.from, { from: money.format(salary.min), per })
        : fill(text.range, {
            from: money.format(salary.min),
            to: money.format(salary.max),
            per,
          }),
    ],
  ];
}

function setupFacts(saved: SavedAnswers): FactRow[] {
  const text = copy.profilePage.answers.setup;
  // Only the setups the form offers, as it keeps them on a save.
  const setups = Array.isArray(saved.workSetups)
    ? (saved.workSetups as string[]).filter((s) => (WORK_SETUPS as readonly string[]).includes(s))
    : [];
  return [
    [
      text.setups,
      setups.length ? setups.map((s) => text.setupNames[s] ?? s).join(', ') : undefined,
    ],
    [text.relocateFact, yesNoText(saved.willingToRelocate)],
  ];
}

function otherFacts(saved: SavedAnswers): FactRow[] {
  const text = copy.profilePage.answers.other;
  const clearance = choiceOf(saved.securityClearance);
  const heard = choiceOf(saved.heardAbout);
  return [
    [text.over18Fact, yesNoText(saved.over18)],
    [text.clearance, clearance ? text.clearances[clearance] : undefined],
    [text.pronouns, choiceOf(saved.pronouns) || undefined],
    [text.heardFact, heard ? text.heardNames[heard] : undefined],
  ];
}
