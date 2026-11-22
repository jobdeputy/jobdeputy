// #51 (decision 0015): the ATS match score. The LLM only lists a job's keywords (the
// `job-keywords` task); this code keeps those the posting really contains and computes the
// score, so the same résumé and job always get the same score, whichever model tailored it.

export const KEYWORD_KINDS = [
  'hard_skill',
  'title',
  'certification',
  'education',
  'soft_skill',
] as const;
export type KeywordKind = (typeof KEYWORD_KINDS)[number];

export interface JobKeyword {
  /** As the posting writes it, for example "Kubernetes" or "Bachelor's degree". */
  term: string;
  kind: KeywordKind;
  /** The posting asks for it ("must", "required"), rather than prefers it ("nice to have"). */
  required: boolean;
}

/** The recommended score before applying (decision 0013). */
export const MATCH_THRESHOLD = 80;
/** At most this many keywords are kept per job. */
export const MAX_JOB_KEYWORDS = 30;
/** Longer "keywords" are sentences, not keywords. */
const MAX_TERM_TOKENS = 5;

/**
 * Weights (decision 0015, after Jobscan's order): hard skills count most, then titles; a
 * certification or degree counts only when required; soft skills count a little.
 */
export function keywordWeight(keyword: JobKeyword): number {
  switch (keyword.kind) {
    case 'hard_skill':
      return keyword.required ? 3 : 2;
    case 'title':
      return 2;
    case 'certification':
    case 'education':
      return keyword.required ? 2 : 0;
    case 'soft_skill':
      return 0.5;
  }
}

/**
 * Names that mean the same thing. The first name is the canonical one; every name is
 * normalised like the text, so "Amazon Web Services" in a job matches "AWS" in a résumé.
 */
const ALIASES: string[][] = [
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['nodejs', 'node.js', 'node js'],
  ['react', 'react.js', 'reactjs'],
  ['vue', 'vue.js', 'vuejs'],
  ['nextjs', 'next.js'],
  ['kubernetes', 'k8s'],
  ['postgresql', 'postgres', 'psql'],
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud platform', 'google cloud'],
  ['azure', 'microsoft azure'],
  ['ml', 'machine learning'],
  ['ai', 'artificial intelligence'],
  ['llm', 'large language model'],
  ['nlp', 'natural language processing'],
  ['cicd', 'ci cd', 'continuous integration continuous delivery'],
  ['frontend', 'front end'],
  ['backend', 'back end'],
  ['fullstack', 'full stack'],
  ['csharp', 'c#'],
  ['cpp', 'c++'],
  ['mssql', 'sql server', 'ms sql'],
  ['ux', 'user experience'],
  ['bachelor', 'bachelors', 'bsc', 'b.sc', 'b.s', 'btech', 'b.tech', 'undergraduate degree'],
  ['master', 'masters', 'msc', 'm.sc', 'm.s', 'mtech', 'm.tech'],
  ['phd', 'ph.d', 'doctorate'],
];

const TOKEN = /[a-z0-9+#]+(?:\.[a-z0-9+#]+)*/g;

function rawTokens(text: string): string[] {
  const plain = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[’`]/g, "'")
    .replace(/'s\b/g, '')
    // ".NET" would otherwise lose its dot and read as "net".
    .replace(/(^|[^a-z0-9])\.net\b/g, '$1dotnet');
  return (plain.match(TOKEN) ?? []).map(stem);
}

/** A light plural fold, applied to both sides: "APIs" matches "API", "services" "service". */
function stem(token: string): string {
  return token.length >= 4 && token.endsWith('s') && !token.endsWith('ss') && !token.includes('.')
    ? token.slice(0, -1)
    : token;
}

/** Each alias as normalised tokens, longest first, with its canonical token. */
const ALIAS_TABLE: { tokens: string[]; canonical: string }[] = ALIASES.flatMap((names) => {
  const canonical = `=${names[0]}`;
  return names.map((name) => ({ tokens: rawTokens(name), canonical }));
}).sort((a, b) => b.tokens.length - a.tokens.length);

/**
 * Technology names that are also common words ("the go-live", "the rest of the team") count
 * only as written for the technology: "Go" or "golang", "REST" or "RESTful".
 */
const CASED: [RegExp, string][] = [
  [/\bGo\b(?!-)(?!['’](?!s\b))/g, 'golang'],
  [/\bREST(?:ful)?\b|\bRest[Ff]ul\b|\brestful\b/g, 'restful'],
];

/**
 * Where a phrase cannot continue: a new line or list punctuation. Not a full stop: it also ends
 * abbreviations ("Ph.D. in Physics", "Sr. Engineer"), which must match their undotted forms.
 */
const BOUNDARY = /[\n,;:|•()[\]]/;
/**
 * A full stop then a capital starts a new sentence ("in SQL. Server costs" is not SQL Server),
 * unless it ends an abbreviation ("Sr. Software Engineer").
 */
const SENTENCE_END = /\b([A-Za-z][\w.]*)\.(?=\s+[A-Z])/g;
const ABBREVIATIONS = new Set(
  [
    'sr',
    'jr',
    'dr',
    'mr',
    'ms',
    'mrs',
    'st',
    'no',
    'vs',
    'inc',
    'ltd',
    'co',
    'corp',
    'dept',
  ].concat([
    'ph.d',
    'b.s',
    'm.s',
    'b.sc',
    'm.sc',
    'b.a',
    'm.a',
    'b.tech',
    'm.tech',
    'e.g',
    'i.e',
    'etc',
  ]),
);

/** Stands for a boundary among the tokens; no word normalises to it. */
const BREAK = '¦';

/**
 * Text as normalised tokens: lower case, no accents, plurals folded, every alias replaced by
 * one canonical token (marked with `=`, so it never collides with an ordinary word), and a
 * BREAK at every boundary, so "Node, JS tooling" never reads as "Node.js".
 */
export function normalisedTokens(text: string): string[] {
  let cased = text.replace(SENTENCE_END, (all, word: string) =>
    ABBREVIATIONS.has(word.toLowerCase()) ? all : `${word}\n`,
  );
  for (const [pattern, word] of CASED) cased = cased.replace(pattern, word);
  const out: string[] = [];
  for (const segment of cased.split(BOUNDARY)) {
    const tokens = rawTokens(segment);
    if (tokens.length === 0) continue;
    if (out.length > 0) out.push(BREAK);
    for (let i = 0; i < tokens.length; ) {
      const alias = ALIAS_TABLE.find(({ tokens: a }) => a.every((t, k) => tokens[i + k] === t));
      if (alias) {
        out.push(alias.canonical);
        i += alias.tokens.length;
      } else {
        out.push(tokens[i] as string);
        i += 1;
      }
    }
  }
  return out;
}

/** The key two terms share when they mean the same thing ("K8s" and "kubernetes"). */
export function termKey(term: string): string {
  return normalisedTokens(term).join(' ');
}

/** A text, normalised once, that terms are looked up in as whole-word phrases. */
export class TermIndex {
  private readonly tokens: string[];

  constructor(text: string) {
    this.tokens = normalisedTokens(text);
  }

  /** How many times the term appears. */
  count(term: string): number {
    const needle = normalisedTokens(term);
    if (needle.length === 0) return 0;
    let found = 0;
    for (let i = 0; i + needle.length <= this.tokens.length; i++) {
      if (needle.every((t, k) => this.tokens[i + k] === t)) found += 1;
    }
    return found;
  }

  has(term: string): boolean {
    return this.count(term) > 0;
  }
}

/**
 * Prompt-injection rule 4 (decision 0010) for keywords: keeps only terms the posting really
 * contains, of a sensible length, once each (a repeat makes the kept one required if either is,
 * and of the stricter kind), at most MAX_JOB_KEYWORDS. Returns the kept keywords and how many were dropped for
 * not being in the posting or being too long (repeats and those past the cap are not counted).
 */
export function groundKeywords(
  keywords: readonly JobKeyword[],
  posting: string,
): { kept: JobKeyword[]; dropped: number } {
  const index = new TermIndex(posting);
  const byKey = new Map<string, JobKeyword>();
  let dropped = 0;
  for (const keyword of keywords) {
    const key = termKey(keyword.term);
    const size = key.split(' ').length;
    const known = byKey.get(key);
    if (key === '' || size > MAX_TERM_TOKENS || !index.has(keyword.term)) {
      dropped += 1;
    } else if (known) {
      if (keyword.required) known.required = true;
      if (STRICTNESS[keyword.kind] > STRICTNESS[known.kind]) known.kind = keyword.kind;
    } else if (byKey.size < MAX_JOB_KEYWORDS) {
      byKey.set(key, { term: keyword.term.trim(), kind: keyword.kind, required: keyword.required });
    }
  }
  return { kept: [...byKey.values()], dropped };
}

/** A term listed twice keeps its strictest kind (a hard skill is never checked as a soft one). */
const STRICTNESS: Record<KeywordKind, number> = {
  hard_skill: 4,
  certification: 3,
  education: 2,
  title: 1,
  soft_skill: 0,
};

export interface MatchScore {
  /** 0–100, or null when the job has no keyword that counts. */
  score: number | null;
  matched: JobKeyword[];
  missing: JobKeyword[];
}

/** Weighted keyword coverage of a résumé's text (decision 0015). */
export function matchScore(
  keywords: readonly JobKeyword[],
  resume: string | TermIndex,
): MatchScore {
  const index = typeof resume === 'string' ? new TermIndex(resume) : resume;
  let total = 0;
  let found = 0;
  const matched: JobKeyword[] = [];
  const missing: JobKeyword[] = [];
  for (const keyword of keywords) {
    const weight = keywordWeight(keyword);
    if (weight === 0) continue;
    total += weight;
    if (index.has(keyword.term)) {
      found += weight;
      matched.push(keyword);
    } else {
      missing.push(keyword);
    }
  }
  return { score: total === 0 ? null : Math.round((100 * found) / total), matched, missing };
}
