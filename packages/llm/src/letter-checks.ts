import { type JobKeyword, type StructuredResume, TermIndex } from '@jobdeputy/shared';
import { baseText, evidenceText, LINK, numbersIn, plainText } from './resume-checks.js';

// #51 PR D (decision 0015): the honesty checks on a cover letter, in code. A letter may only
// say what the résumé (or the user) shows to be true, about a company and job the posting
// names. A letter with any issue is sent back naming the issues, and is never stored.

/** The body's length in words (the prompt asks for 250 to 350, leaving a margin). */
export const LETTER_WORDS = { min: 200, max: 400 } as const;

export type LetterIssueKind =
  | 'number'
  | 'link'
  | 'unsupported-keyword'
  | 'unknown-name'
  | 'placeholder'
  | 'company-missing'
  | 'length'
  | 'puffery';

export interface LetterIssue {
  kind: LetterIssueKind;
  /** Sent back to the model in the repair call (inside a data block). */
  message: string;
}

export interface LetterContext {
  company: string;
  /** The company's tailored résumé (already checked against the base), or the base. */
  resume: StructuredResume;
  /** Skills the user confirmed that the résumé does not show (profile skills, "I have this"). */
  evidence: readonly string[];
  job: { title: string; description: string; keywords: readonly JobKeyword[] };
}

/** A greeting at the start of the letter, alone or before its first sentence. */
const GREETING = /^(?:dear|hello|hi|to whom it may concern)\b[^,.!?:\n]{0,60}[,:!]\s*/i;
const CLOSINGS =
  'sincerely|best wishes|best regards|kind regards|warm regards|regards|best|yours sincerely|yours truly|yours|thank you|thanks|respectfully';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The model's paragraphs as plain text, without a greeting or sign-off it added anyway (the
 * file adds its own), alone or inside the first or last paragraph: what the checks read is
 * what the reader will.
 */
export function plainLetter(paragraphs: readonly string[], name: string): string[] {
  const list = paragraphs.map(plainText).filter((p) => p !== '');
  if (list[0] !== undefined) list[0] = list[0].replace(GREETING, '');
  const own = escaped(name.trim());
  // A sign-off ("Best regards,", "Sincerely, Sam Example", or the name alone) after the last
  // sentence; "Thank you for your time." is a sentence and stays.
  const signOff = new RegExp(
    `(^|[.!?])\\s*(?:(?:${CLOSINGS})[,.!]?${own ? `(?:\\s*${own})?` : ''}${own ? `|${own}` : ''})\\.?\\s*$`,
    'i',
  );
  for (;;) {
    const last = list.at(-1);
    if (last === undefined) break;
    const cut = last.replace(signOff, '$1').trim();
    if (cut === last) break;
    if (cut === '') list.pop();
    else list[list.length - 1] = cut;
  }
  return list.filter((p) => p !== '');
}

/** Legal endings a company's stored name has but a letter leaves out ("Acme Inc." is "Acme"). */
const LEGAL =
  /[,\s]+(?:inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|ag|sa|bv|pty)\.?$/i;

/** The name a letter uses for the company. */
export function companyName(company: string): string {
  let name = company.trim();
  for (let before = ''; before !== name; ) {
    before = name;
    name = name.replace(LEGAL, '').trim();
  }
  return name || company.trim();
}

/**
 * The job's keywords a letter may not name without evidence: not its title or soft skills, and
 * not one inside the company's name or the job's title ("MongoDB" at MongoDB, "Python" in
 * "Python Developer"), which the letter must be able to write.
 */
export function claimable(context: LetterContext): JobKeyword[] {
  const names = new TermIndex(`${context.company}\n${context.job.title}`);
  return context.job.keywords.filter(
    (k) => k.kind !== 'title' && k.kind !== 'soft_skill' && !names.has(k.term),
  );
}

/** A name's pieces: letters and digits, joined by dots, apostrophes, "&", "+", or "#" (Node.js, C#, AT&T). */
const TOKEN = /\p{L}[\p{L}\p{N}]*(?:[.'’&+#][\p{L}\p{N}]+)*[+#]*/gu;
const tokenKey = (token: string) => token.replace(/['’]s$/i, '').toLowerCase();

/** Capitalised words a letter may use without a source: its own words, months, and days. */
const COMMON = new Set(
  [
    "i i'm i've i'd i'll i’m i’ve i’d i’ll dear hiring manager team",
    'january february march april may june july august september october november december',
    'monday tuesday wednesday thursday friday saturday sunday',
  ]
    .join(' ')
    .split(' '),
);

/** Placeholders a model leaves for the reader to fill ("[Company]", "<Your name>"): never sent. */
const PLACEHOLDER =
  /\[[^\]]{1,60}\]|\{[^}]{1,60}\}|<[A-Za-z][^<>\n]{0,58}[A-Za-z]>|\b(?:XXX+|TBD|lorem ipsum)\b/gi;

/**
 * A word shaped like a name whatever its place: capitals after the first letter, digits, or
 * joining marks (GraphQL, AWS, K8s, Node.js, C#). A plain word starting a sentence ("Reliability")
 * is not checked: without a dictionary it cannot be told from a name.
 */
const NAME_SHAPED = /^.\S*(?:\p{Lu}|\p{N}|[.&+#])/u;

/** Words of scale a letter may write only when the résumé does ("hundreds of", "a million"). */
const SCALE = /\b(?:hundreds?|thousands?|millions?|billions?|dozens)\b/gi;

const UNITS = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const UNIT_VALUE = new Map(UNITS.map((w, i) => [w, i + 2]));
const TENS_VALUE = new Map(TENS.map((w, i) => [w, (i + 2) * 10]));
const SPELLED = new RegExp(
  `\\b(?:(${TENS.join('|')})(?:[- ](${UNITS.slice(0, 8).join('|')}|one))?|(${UNITS.join('|')})|dozen)\\b`,
  'gi',
);

/**
 * Numbers written as words, as digits ("six years" is "6 years", "twenty-five" is "25", "a
 * dozen" is "12"), so the number check reads them. "One" stays a word ("one of the team").
 */
export function spelledNumbers(text: string): string {
  return text.replace(SPELLED, (match, tens?: string, unit?: string, alone?: string) => {
    if (tens) {
      const t = TENS_VALUE.get(tens.toLowerCase()) ?? 0;
      const u = unit
        ? unit.toLowerCase() === 'one'
          ? 1
          : (UNIT_VALUE.get(unit.toLowerCase()) ?? 0)
        : 0;
      return String(t + u);
    }
    if (alone) return String(UNIT_VALUE.get(alone.toLowerCase()));
    return match.toLowerCase() === 'dozen' ? '12' : match;
  });
}

/**
 * Words that claim a quality or scale a résumé rarely proves (the prompt forbids them): one in
 * a letter must be in the résumé or the confirmed skills.
 */
export const PUFFERY = [
  'expert',
  'world-class',
  'best-in-class',
  'cutting-edge',
  'scalable',
  'high-performance',
  'high-performing',
  'robust',
  'unparalleled',
  'exceptional',
  'rockstar',
  'ninja',
  'guru',
] as const;
const PUFF = new RegExp(`\\b(?:${PUFFERY.join('|')})\\b`, 'gi');

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Checks a letter's paragraphs (plainLetter's) against the résumé, the confirmed skills, and the
 * job. Returns every issue found; an empty list means the letter may be stored.
 */
export function checkLetter(context: LetterContext, paragraphs: readonly string[]): LetterIssue[] {
  const { company, resume, evidence, job } = context;
  const issues: LetterIssue[] = [];
  const add = (kind: LetterIssueKind, message: string) => {
    if (!issues.some((i) => i.message === message)) issues.push({ kind, message });
  };
  const text = paragraphs.join('\n');
  const original = baseText(resume);

  const count = words(text);
  if (count < LETTER_WORDS.min || count > LETTER_WORDS.max)
    add('length', `the letter has ${count} words: write 250 to 350`);

  for (const match of text.match(PLACEHOLDER) ?? [])
    add('placeholder', `remove the placeholder "${match}": write the real words or leave it out`);

  // Numbers: only the résumé's (a job title or company may have one: "Engineer 2", "3M"),
  // and words of scale only when the résumé writes them ("2 million requests").
  const facts = [original, ...evidence, job.title, company].join('\n');
  const known = numbersIn(spelledNumbers(facts));
  for (const n of numbersIn(spelledNumbers(text))) {
    if (!known.has(n)) add('number', `the number ${n} is not in the résumé`);
  }
  const scales = new Set((facts.match(SCALE) ?? []).map((w) => w.toLowerCase().replace(/s$/, '')));
  for (const word of text.match(SCALE) ?? []) {
    if (!scales.has(word.toLowerCase().replace(/s$/, '')))
      add('number', `"${word}" is not in the résumé: use the résumé's own numbers`);
  }

  // Links, emails, and domains: none but those the user wrote (the job may plant them); the
  // file's header has the contact details.
  const allowed = `${original}\n${evidence.join('\n')}`.toLowerCase();
  for (const link of text.match(LINK) ?? []) {
    if (!allowed.includes(link.toLowerCase()))
      add('link', `remove "${link}": no links or contact details`);
  }

  // The job's keywords: never claimed without evidence (claimable: the title, soft skills, and
  // the company's own name may be written).
  const letterIndex = new TermIndex(text);
  const evidenceIndex = new TermIndex(evidenceText(resume, evidence));
  const claims = new Map<string, string>();
  for (const k of claimable(context)) claims.set(k.term.toLowerCase(), k.term);
  for (const term of claims.values()) {
    if (letterIndex.has(term) && !evidenceIndex.has(term))
      add(
        'unsupported-keyword',
        `"${term}" is not shown to be true: remove every mention of it, even as something to learn`,
      );
  }

  // Names: a capitalised word (an employer, school, tool, or person) must come from the résumé,
  // the confirmed skills, the job, or the company; after a colon too. A sentence's first word
  // is capitalised anyway, so there only a name-shaped word is checked (NAME_SHAPED).
  const sources = new Set(
    [JSON.stringify(resume), ...evidence, job.title, job.description, company]
      .join('\n')
      .match(TOKEN)
      ?.map(tokenKey) ?? [],
  );
  // A placeholder's words are its own issue.
  const named = text.replace(PLACEHOLDER, (p) => ' '.repeat(p.length));
  for (const match of named.matchAll(TOKEN)) {
    const token = match[0];
    if (!/^\p{Lu}/u.test(token)) continue;
    const before = named.slice(0, match.index).trimEnd();
    const key = tokenKey(token);
    const first = before === '' || /[.!?]["”’)]?$/.test(before);
    if (first && !NAME_SHAPED.test(token)) continue;
    // Plurals fold: "API" is in a résumé that says "APIs", and "APIs" in one that says "API".
    const known = (k: string) =>
      sources.has(k) || sources.has(`${k}s`) || (k.endsWith('s') && sources.has(k.slice(0, -1)));
    if (!COMMON.has(key) && !known(key))
      add('unknown-name', `"${token}" is not in the résumé or the job: remove it`);
  }

  // Qualities and scale: only those the résumé states.
  const stated = `${original}\n${evidence.join('\n')}`.toLowerCase();
  for (const match of text.match(PUFF) ?? []) {
    if (!new RegExp(`\\b${match.toLowerCase()}\\b`).test(stated))
      add('puffery', `remove "${match}": the résumé does not say so`);
  }

  const name = companyName(company);
  if (!letterIndex.has(name) && !text.toLowerCase().includes(name.toLowerCase()))
    add('company-missing', `name the company, ${name}, at least once`);
  return issues;
}

/** The job's skills the user has shown to be true (hard skills in the résumé or confirmed). */
export function provenSkills(context: LetterContext): string[] {
  const evidenceIndex = new TermIndex(evidenceText(context.resume, context.evidence));
  return context.job.keywords
    .filter((k) => k.kind === 'hard_skill' && evidenceIndex.has(k.term))
    .map((k) => k.term);
}

/** The proven skills a letter uses (the eval's measure). */
export function provenUsed(context: LetterContext, paragraphs: readonly string[]): string[] {
  const letterIndex = new TermIndex(paragraphs.join('\n'));
  return provenSkills(context).filter((term) => letterIndex.has(term));
}
