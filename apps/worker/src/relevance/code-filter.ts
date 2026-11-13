/**
 * T08c: the free code filter. Marks each crawled job `candidate` or `not_relevant` from
 * what the list says (title, place, workplace, job type, salary) against the user's
 * target roles and search settings, and says why.
 *
 * Lenient on purpose: what the job does not say is never held against it (many lists
 * have no description, workplace, or type), and the LLM step (T08d) judges candidates
 * properly. A job is dropped only on evidence.
 */

export const FILTER_VERSION = 1;

export type Seniority =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'lead'
  | 'principal'
  | 'manager'
  | 'director'
  | 'executive';

export interface FilterPlace {
  city?: string | undefined;
  region?: string | undefined;
  country: string;
}

export interface FilterRole {
  roleId: string;
  title: string;
  altTitles: string[];
  seniority: Seniority[];
  locations?: FilterPlace[] | undefined;
  exclude: string[];
  priority: number;
}

export interface FilterSearch {
  locations: FilterPlace[];
  workplace: string[];
  employmentTypes: string[];
  minSalary?: { amount: number; currency: string; period: string } | undefined;
  seniority: Seniority[];
  excludeKeywords: string[];
}

/** What the filter knows about the user: active roles only. */
export interface FilterProfile {
  roles: FilterRole[];
  search?: FilterSearch | undefined;
  /** Used only when there are no active roles. */
  headline?: string | undefined;
  skills: string[];
}

export interface FilterJob {
  title: string;
  locations: {
    text: string;
    city?: string | undefined;
    region?: string | undefined;
    country?: string | undefined;
  }[];
  workplace?: string | undefined;
  employmentType?: string | undefined;
  salary?:
    | { min?: number | undefined; max?: number | undefined; currency: string; period: string }
    | undefined;
}

/** Why a job was kept or dropped (codes; `excluded_word:<word>` names the word). */
export type FilterReason =
  | 'title_match'
  | 'headline_match'
  | 'skill_in_title'
  | 'no_target_roles'
  | 'title_no_match'
  | 'seniority'
  | 'place'
  | 'workplace'
  | 'employment_type'
  | 'salary_below'
  | `excluded_word:${string}`;

export interface JobFilter {
  state: 'candidate' | 'not_relevant';
  /** The roles the job matched (empty when matched from the profile, or with no roles). */
  roleIds: string[];
  reasons: FilterReason[];
  /** For the per-company ranking: the best matching role's priority (1–100). */
  priority: number;
  version: number;
}

const DEFAULT_PRIORITY = 50;

/** Level words ignored when matching a title ("Senior Backend Engineer" is a "Backend Engineer"). */
const LEVEL_WORDS = new Set([
  'senior',
  'junior',
  'staff',
  'principal',
  'mid',
  'associate',
  'entry',
  'level',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  '1',
  '2',
  '3',
  '4',
  '5',
]);
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'of',
  'the',
  'for',
  'in',
  'at',
  'to',
  'with',
  'or',
  '&',
]);

/** One spelling per word, so "Sr. Software Dev" matches "Senior Software Developer". */
const CANONICAL: Record<string, string> = {
  sr: 'senior',
  snr: 'senior',
  jr: 'junior',
  jnr: 'junior',
  mgr: 'manager',
  eng: 'engineer',
  engr: 'engineer',
  engineering: 'engineer',
  engineers: 'engineer',
  dev: 'developer',
  devs: 'developer',
  developers: 'developer',
  programmer: 'developer',
  swe: 'software engineer',
  sde: 'software developer engineer',
  // Written as one word, two, or with a hyphen: always two.
  frontend: 'front end',
  'front-end': 'front end',
  backend: 'back end',
  'back-end': 'back end',
  fullstack: 'full stack',
  'full-stack': 'full stack',
  devops: 'dev ops',
  qa: 'quality assurance',
  ml: 'machine learning',
  ai: 'artificial intelligence',
  ui: 'user interface',
  ux: 'user experience',
  vp: 'vice president',
  internship: 'intern',
  trainee: 'intern',
  analytics: 'analyst',
  scientists: 'scientist',
  managers: 'manager',
  designers: 'designer',
  analysts: 'analyst',
};
/** Developers and engineers do the same work in job titles. */
const EQUIVALENT: Record<string, string> = { developer: 'engineer' };

/** Words that tell a job's level, and the levels each can mean. */
const LEVEL_OF: Record<string, Seniority[]> = {
  intern: ['intern'],
  junior: ['junior'],
  graduate: ['junior'],
  entry: ['junior'],
  associate: ['junior', 'mid'],
  senior: ['senior'],
  staff: ['senior', 'lead', 'principal'],
  lead: ['lead'],
  principal: ['principal'],
  manager: ['manager'],
  head: ['director'],
  director: ['director'],
  president: ['executive'],
  chief: ['executive'],
  cto: ['executive'],
  ceo: ['executive'],
  cfo: ['executive'],
  coo: ['executive'],
};

export function tokens(text: string): string[] {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Keep what names technologies: c++, c#, .net, node.js.
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const canonical = CANONICAL[word];
    if (canonical !== undefined) {
      out.push(...canonical.split(' '));
      continue;
    }
    // Hyphenated words also count as their parts ("full-stack" is "full stack").
    if (word.includes('-')) {
      out.push(word.replaceAll('-', ''), ...word.split('-').filter(Boolean));
      continue;
    }
    out.push(word);
  }
  return out.map((w) => EQUIVALENT[w] ?? w);
}

/** The words a title must contain: no level or filler words (unless it is only those). */
function titleWords(title: string): string[] {
  const all = tokens(title).filter((w) => !STOP_WORDS.has(w));
  const core = all.filter((w) => !LEVEL_WORDS.has(w));
  return core.length > 0 ? core : all;
}

function containsAll(haystack: Set<string>, needles: string[]): boolean {
  return needles.length > 0 && needles.every((w) => haystack.has(w));
}

/** Whether `phrase` appears in `words` as consecutive words. */
function containsPhrase(words: string[], phrase: string): boolean {
  const needle = tokens(phrase);
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= words.length; i++) {
    if (needle.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/** Levels the job title states, ignoring words that belong to the role's own title. */
function jobLevels(jobWords: string[], roleWords: Set<string>): Set<Seniority> {
  const levels = new Set<Seniority>();
  for (const word of jobWords) {
    if (roleWords.has(word)) continue;
    for (const level of LEVEL_OF[word] ?? []) levels.add(level);
  }
  return levels;
}

// --- Places ---

/** Codes the region names also cover that are not ISO countries ("United Kingdom" is GB, not UK). */
const NOT_COUNTRIES = new Set([
  'AN',
  'BU',
  'CS',
  'DD',
  'DY',
  'EU',
  'EZ',
  'FX',
  'HV',
  'NH',
  'NT',
  'QO',
  'RH',
  'SU',
  'TP',
  'UK',
  'UN',
  'VD',
  'YD',
  'YU',
  'ZR',
  'ZZ',
]);

/** English country names and common codes, to find a country in free text. */
const COUNTRY_NAMES: Map<string, string> = (() => {
  const names = new Map<string, string>();
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code && !NOT_COUNTRIES.has(code)) names.set(name.toLowerCase(), code);
    }
  }
  const aliases: Record<string, string> = {
    usa: 'US',
    'united states of america': 'US',
    america: 'US',
    uk: 'GB',
    'great britain': 'GB',
    england: 'GB',
    scotland: 'GB',
    wales: 'GB',
    'northern ireland': 'GB',
    britain: 'GB',
    ind: 'IN',
    bharat: 'IN',
    deutschland: 'DE',
    uae: 'AE',
    holland: 'NL',
    'the netherlands': 'NL',
  };
  for (const [name, code] of Object.entries(aliases)) names.set(name, code);
  return names;
})();

/** "Austin, TX" and "Toronto, ON": a trailing US state or Canadian province code. */
const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  ),
);
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

export function countryInText(text: string): string | undefined {
  const parts = text
    .split(/[,;|/()–—]|\s-\s/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of [...parts].reverse()) {
    const lower = part
      .toLowerCase()
      .replace(/^remote\s*[-:]?\s*/, '')
      .trim();
    const code = COUNTRY_NAMES.get(lower);
    if (code) return code;
    // Upper-case codes only: "IN" is India, "in" is a word.
    const bare = part.replace(/^remote\s*[-:]?\s*/i, '').trim();
    if (bare === 'US' || bare === 'USA') return 'US';
    if (bare === 'UK') return 'GB';
    if (US_STATES.has(bare)) return 'US';
    if (CA_PROVINCES.has(bare)) return 'CA';
  }
  return undefined;
}

type Tri = 'yes' | 'no' | 'unknown';

function isRemote(job: FilterJob): boolean {
  return (
    job.workplace === 'remote' ||
    job.locations.some((l) => /\b(remote|anywhere|work from home|wfh)\b/i.test(l.text))
  );
}

function placeMatch(
  location: FilterJob['locations'][number],
  place: FilterPlace,
  remote: boolean,
): Tri {
  const country = location.country ?? countryInText(location.text);
  if (country !== undefined && country !== place.country) return 'no';
  // A remote job in the user's country (or with no country) fits any city there.
  if (remote) return country === place.country ? 'yes' : 'unknown';
  if (place.city === undefined) return country === place.country ? 'yes' : 'unknown';
  const city = tokens(place.city).join(' ');
  const where = tokens([location.city, location.text].filter(Boolean).join(' ')).join(' ');
  if (` ${where} `.includes(` ${city} `)) return 'yes';
  return country === place.country ? 'no' : 'unknown';
}

/** `no` only when every place the job names is known to be outside every place the user wants. */
function placesMatch(job: FilterJob, places: FilterPlace[]): Tri {
  if (places.length === 0 || job.locations.length === 0) return 'unknown';
  const remote = isRemote(job);
  let unknown = false;
  for (const location of job.locations) {
    for (const place of places) {
      const result = placeMatch(location, place, remote);
      if (result === 'yes') return 'yes';
      if (result === 'unknown') unknown = true;
    }
  }
  return unknown ? 'unknown' : 'no';
}

// --- Salary ---

const PER_YEAR: Record<string, number> = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };

function salaryBelow(job: FilterJob, min: FilterSearch['minSalary']): boolean {
  if (!min || !job.salary || job.salary.currency !== min.currency) return false;
  const top = job.salary.max ?? job.salary.min;
  const jobRate = PER_YEAR[job.salary.period];
  const minRate = PER_YEAR[min.period];
  if (top === undefined || jobRate === undefined || minRate === undefined) return false;
  return top * jobRate < min.amount * minRate;
}

// --- The filter ---

interface Candidate {
  roleId?: string;
  titles: string[];
  seniority: Seniority[];
  places: FilterPlace[];
  exclude: string[];
  priority: number;
  matchedBy: FilterReason;
}

/** Roles to match against: the active roles; without any, what the profile says the user does. */
function candidatesFrom(profile: FilterProfile): Candidate[] {
  const search = profile.search;
  if (profile.roles.length > 0) {
    return profile.roles.map((r) => ({
      roleId: r.roleId,
      titles: [r.title, ...r.altTitles],
      seniority: r.seniority.length > 0 ? r.seniority : (search?.seniority ?? []),
      places: r.locations ?? search?.locations ?? [],
      exclude: r.exclude,
      priority: r.priority,
      matchedBy: 'title_match',
    }));
  }
  const common = {
    seniority: search?.seniority ?? [],
    places: search?.locations ?? [],
    exclude: [],
    priority: DEFAULT_PRIORITY,
  };
  const out: Candidate[] = [];
  // "Backend engineer | Kafka, AWS" or "Backend engineer at Acme": the first part is the job.
  const headline = profile.headline?.split(/\s[|·•@–—-]\s|[|·•,]|\sat\s/i)[0]?.trim();
  if (headline) out.push({ ...common, titles: [headline], matchedBy: 'headline_match' });
  return out;
}

export function filterJob(job: FilterJob, profile: FilterProfile): JobFilter {
  const search = profile.search;
  const jobWords = tokens(job.title);
  const jobSet = new Set(jobWords);
  const result = (
    state: JobFilter['state'],
    reasons: FilterReason[],
    roleIds: string[] = [],
    priority = DEFAULT_PRIORITY,
  ): JobFilter => ({ state, roleIds, reasons, priority, version: FILTER_VERSION });

  // Settings that apply to every role.
  const global: FilterReason[] = [];
  const excluded = search?.excludeKeywords.find((w) => containsPhrase(jobWords, w));
  if (excluded !== undefined) global.push(`excluded_word:${excluded.toLowerCase()}`);
  if (
    search &&
    search.workplace.length > 0 &&
    job.workplace &&
    !search.workplace.includes(job.workplace)
  ) {
    global.push('workplace');
  }
  if (
    search &&
    search.employmentTypes.length > 0 &&
    job.employmentType &&
    !search.employmentTypes.includes(job.employmentType)
  ) {
    global.push('employment_type');
  }
  if (salaryBelow(job, search?.minSalary)) global.push('salary_below');

  const candidates = candidatesFrom(profile);
  if (candidates.length === 0) {
    // No roles and no headline: skills in the title add a reason; nothing is dropped for
    // lacking one (titles rarely name skills). The search settings still apply.
    if (placesMatch(job, search?.locations ?? []) === 'no') global.push('place');
    if (global.length > 0) return result('not_relevant', global);
    const skill = profile.skills.some((s) => containsPhrase(jobWords, s));
    return result('candidate', [skill ? 'skill_in_title' : 'no_target_roles']);
  }

  const matched: Candidate[] = [];
  /** Reasons from the first role whose title matched but something else did not. */
  let closest: FilterReason[] | undefined;
  for (const c of candidates) {
    const titleHit = c.titles.map(titleWords).find((words) => containsAll(jobSet, words));
    if (!titleHit) continue;
    const reasons: FilterReason[] = [];
    const word = c.exclude.find((w) => containsPhrase(jobWords, w));
    if (word !== undefined) reasons.push(`excluded_word:${word.toLowerCase()}`);
    if (c.seniority.length > 0) {
      const levels = jobLevels(jobWords, new Set(titleHit));
      if (levels.size > 0 && ![...levels].some((l) => c.seniority.includes(l))) {
        reasons.push('seniority');
      }
    }
    if (placesMatch(job, c.places) === 'no') reasons.push('place');
    if (reasons.length === 0) matched.push(c);
    else closest ??= reasons;
  }

  // Only from the profile (no roles): a skill in the title also counts as a match.
  if (matched.length === 0 && profile.roles.length === 0) {
    const places = search?.locations ?? [];
    const skill = profile.skills.some((s) => containsPhrase(jobWords, s));
    if (skill && placesMatch(job, places) !== 'no') {
      matched.push({
        ...candidates[0],
        priority: DEFAULT_PRIORITY,
        matchedBy: 'skill_in_title',
      } as Candidate);
    }
  }

  if (matched.length === 0) {
    return result('not_relevant', [...new Set([...global, ...(closest ?? ['title_no_match'])])]);
  }
  if (global.length > 0) return result('not_relevant', global);
  const roleIds = matched.flatMap((c) => (c.roleId ? [c.roleId] : []));
  const reasons = [...new Set(matched.map((c) => c.matchedBy))];
  return result('candidate', reasons, roleIds, Math.max(...matched.map((c) => c.priority)));
}
