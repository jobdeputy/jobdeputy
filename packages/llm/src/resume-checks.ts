import {
  type JobKeyword,
  printable,
  RESUME_HEADINGS,
  resumeText,
  type StructuredResume,
  TermIndex,
  termKey,
} from '@jobdeputy/shared';

// #51 (decision 0015): the honesty checks on a tailored résumé, in code. Tailoring may only
// rephrase, reorder, and emphasise what the base résumé (or the user) says is true. A draft
// with any issue is sent back once more naming the issues, and is never stored.

/** What the model rewrites; everything else comes from the base résumé unchanged. */
export interface TailoredParts {
  summary: string;
  skills: StructuredResume['skills'];
  experience: { id: string; bullets: string[] }[];
  projects: { id: string; bullets: string[] }[];
}

export type IssueKind =
  | 'unknown-entry'
  | 'number'
  | 'unsupported-skill'
  | 'unsupported-keyword'
  | 'new-in-entry'
  | 'repeated-keyword'
  | 'link';

export interface Issue {
  kind: IssueKind;
  /** Sent back to the model in the repair call (inside a data block). */
  message: string;
}

/**
 * A keyword may appear this many times in a tailored résumé (no keyword stuffing): the skills
 * list, the summary, and two bullets. The prompt asks for at most 3, leaving a margin.
 */
export const KEYWORD_REPEAT_CAP = 4;

/**
 * Repeats allowed for a keyword the base résumé has `before` times: the cap, or two more than
 * the base when the base already reaches it ("AWS" in "AWS Lambda", "AWS CDK", …).
 */
export function repeatsAllowed(before: number): number {
  return before >= KEYWORD_REPEAT_CAP ? before + 2 : KEYWORD_REPEAT_CAP;
}

/**
 * Model text as plain text: no Markdown emphasis or code marks, no bullet markers, and only
 * characters a file can hold (`printable`: no control characters), so the scores and checks
 * read what the file will.
 */
export function plainText(text: string): string {
  return printable(text)
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-•*]\s+)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The model's parts as plain text (the file and the checks see what the reader will). */
export function plainParts(parts: TailoredParts): TailoredParts {
  const list = (items: string[]) => items.map(plainText).filter((t) => t !== '');
  return {
    // Never the raw text back: what is left after cleaning is what the file will show.
    summary: plainText(parts.summary),
    skills: parts.skills
      .map((g) => ({ group: plainText(g.group) || RESUME_HEADINGS.skills, items: list(g.items) }))
      .filter((g) => g.items.length > 0),
    experience: parts.experience.map((e) => ({ id: e.id, bullets: list(e.bullets) })),
    projects: parts.projects.map((p) => ({ id: p.id, bullets: list(p.bullets) })),
  };
}

/** The base résumé with the model's parts in place: entries, names, and dates stay the base's. */
export function assembleResume(base: StructuredResume, parts: TailoredParts): StructuredResume {
  const bullets = (list: { id: string; bullets: string[] }[], id: string) =>
    list.find((entry) => entry.id === id && entry.bullets.length > 0)?.bullets;
  return {
    ...base,
    summary: parts.summary,
    skills: parts.skills,
    experience: base.experience.map((e) => ({
      ...e,
      bullets: bullets(parts.experience, e.id) ?? e.bullets,
    })),
    projects: base.projects.map((p) => ({
      ...p,
      bullets: bullets(parts.projects, p.id) ?? p.bullets,
    })),
  };
}

/** Numbers, not digits inside names such as K8s, EC2, S3, or Web3 ("2x" and "10k" count). */
const NUMBER = /(?<![A-Za-z])\d+(?:[.,]\d+)*/g;
const LINK =
  /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b[a-z0-9-]+\.(?:com|io|net|org|dev|ai|app|co|uk|in)\b/gi;

/** The numbers a text writes, without thousands separators ("1,200" is "1200"). */
export const numbersIn = (text: string) =>
  new Set((text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, '')));

/** Every date and number the base résumé writes, contact excluded. */
function baseText(base: StructuredResume): string {
  const dates = [
    ...base.experience.flatMap((e) => [e.start, e.end]),
    ...base.education.flatMap((d) => [d.start, d.end]),
    ...base.certifications.map((c) => c.date),
  ].filter((v): v is string => v !== undefined);
  return [resumeText(base), ...dates].join('\n');
}

/**
 * What a résumé shows the person can do: headline, summary, skills, titles, bullets, degrees,
 * certifications, and projects; plus the skills they confirmed. Not employers, schools,
 * places, or dates: "Spring, TX", "Oracle" the employer, or "Spring 2019" prove no skill.
 */
export function evidenceText(base: StructuredResume, confirmed: readonly string[]): string {
  const optional = (...values: (string | undefined)[]) =>
    values.filter((v): v is string => v !== undefined);
  return [
    ...optional(base.contact.headline, base.summary),
    ...base.skills.flatMap((g) => g.items),
    ...base.experience.flatMap((e) => [e.title, ...e.bullets]),
    ...base.education.flatMap((d) => [...optional(d.degree, d.field), ...d.details]),
    ...base.certifications.map((c) => c.name),
    ...base.projects.flatMap((p) => [p.name, ...p.bullets]),
    ...confirmed,
  ].join('\n');
}

/**
 * Checks a draft against the base résumé, the skills the user confirmed (`evidence`), and the
 * jobs' keywords. Returns every issue found; an empty list means the draft may be stored.
 */
export function checkTailored(
  base: StructuredResume,
  parts: TailoredParts,
  evidence: readonly string[],
  keywords: readonly JobKeyword[],
): Issue[] {
  const issues: Issue[] = [];
  const add = (kind: IssueKind, message: string) => {
    if (!issues.some((i) => i.message === message)) issues.push({ kind, message });
  };

  // Entries: only base IDs, each once.
  for (const [list, known, label] of [
    [parts.experience, base.experience, 'experience'],
    [parts.projects, base.projects, 'project'],
  ] as const) {
    const ids = new Set(known.map((e) => e.id));
    const seen = new Set<string>();
    for (const entry of list) {
      if (!ids.has(entry.id)) add('unknown-entry', `${label} id ${entry.id} is not in the résumé`);
      else if (seen.has(entry.id)) add('unknown-entry', `${label} id ${entry.id} is given twice`);
      seen.add(entry.id);
    }
  }

  const tailored = assembleResume(base, parts);
  const written = [
    parts.summary,
    ...parts.skills.flatMap((g) => [g.group, ...g.items]),
    ...parts.experience.flatMap((e) => e.bullets),
    ...parts.projects.flatMap((p) => p.bullets),
  ].join('\n');
  const original = baseText(base);

  // Numbers: no invented metrics, years, or sizes ("Python 3" may come from a confirmed skill).
  const known = numbersIn(`${original}\n${evidence.join('\n')}`);
  for (const n of numbersIn(written)) {
    if (!known.has(n)) add('number', `the number ${n} is not in the résumé`);
  }

  // Links, emails, and domains: only those the user wrote (job text may plant them); a
  // confirmed "ASP.NET" or "Socket.IO" is a skill, not a link.
  const allowed = `${original}\n${evidence.join('\n')}`.toLowerCase();
  for (const link of written.match(LINK) ?? []) {
    if (!allowed.includes(link.toLowerCase()))
      add('link', `remove "${link}": no links or contact details`);
  }

  // Skills listed: each must be in the résumé or confirmed by the user.
  const evidenceIndex = new TermIndex(evidenceText(base, evidence));
  for (const item of parts.skills.flatMap((g) => g.items)) {
    if (!evidenceIndex.has(item))
      add('unsupported-skill', `the skill "${item}" is not shown to be true`);
  }

  // The jobs' keywords: never claimed without evidence, never stuffed, and a job's bullets
  // name only what that entry already said (confirmed skills go in the skills list instead).
  // A term listed by several jobs is checked as its strictest kind.
  const tailoredIndex = new TermIndex(resumeText(tailored));
  // Claims are judged in what the model wrote: a keyword that is only in a base field it
  // cannot change (an employer, a place) is not its claim.
  const writtenIndex = new TermIndex(written);
  const originalIndex = new TermIndex(original);
  const entries = [
    ...parts.experience.map((e) => ({ e, before: base.experience.find((b) => b.id === e.id) })),
    ...parts.projects.map((e) => ({ e, before: base.projects.find((b) => b.id === e.id) })),
  ].flatMap(({ e, before }) =>
    before
      ? [
          {
            id: e.id,
            now: new TermIndex(e.bullets.join('\n')),
            said: new TermIndex(
              [
                ...('title' in before ? [before.title, before.employer] : [before.name]),
                ...before.bullets,
              ].join('\n'),
            ),
          },
        ]
      : [],
  );
  const terms = new Map<string, { term: string; soft: boolean; named: boolean }>();
  for (const keyword of keywords) {
    const key = termKey(keyword.term);
    const known = terms.get(key) ?? { term: keyword.term, soft: true, named: false };
    if (keyword.kind !== 'soft_skill') known.soft = false;
    if (keyword.kind === 'hard_skill' || keyword.kind === 'certification') known.named = true;
    terms.set(key, known);
  }
  for (const { term, soft, named } of terms.values()) {
    if (!writtenIndex.has(term)) continue;
    const count = tailoredIndex.count(term);
    if (!soft && !evidenceIndex.has(term)) {
      add('unsupported-keyword', `"${term}" is not shown to be true: remove it`);
      continue;
    }
    const cap = repeatsAllowed(originalIndex.count(term));
    if (count > cap) add('repeated-keyword', `"${term}" appears ${count} times: at most ${cap}`);
    if (!named) continue;
    for (const entry of entries) {
      if (entry.now.has(term) && !entry.said.has(term)) {
        add(
          'new-in-entry',
          `${entry.id}'s bullets name "${term}", which that entry never mentioned: put it in the skills list instead`,
        );
      }
    }
  }
  return issues;
}
