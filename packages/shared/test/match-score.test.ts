import { describe, expect, it } from 'vitest';
import {
  groundKeywords,
  type JobKeyword,
  keywordWeight,
  MAX_JOB_KEYWORDS,
  matchScore,
  normalisedTokens,
  TermIndex,
  termKey,
} from '../src/match-score.js';
import { resumeText, type StructuredResume, structuredResume } from '../src/resume.js';

const hard = (term: string, required = true): JobKeyword => ({
  term,
  kind: 'hard_skill',
  required,
});

describe('TermIndex', () => {
  it.each([
    ['Kubernetes', 'Ran services on k8s.'],
    ['Amazon Web Services', 'Built on AWS.'],
    ['Node.js', 'NodeJS and Express'],
    ['JavaScript', 'Wrote JS daily'],
    ['PostgreSQL', 'Postgres tuning'],
    ['REST APIs', 'restful API design'],
    ['CI/CD', 'Set up CI CD pipelines'],
    ['C#', 'csharp services'],
    ['C++', 'Modern C++17? no: C++ and Rust'],
    ['.NET', 'ASP and .NET 8'],
    ['Machine Learning', 'ML models'],
    ["Bachelor's degree", 'BSc Computer Science (bachelor degree)'],
    ['Front-end', 'frontend work'],
    ['Résumé', 'resume'],
  ])('finds %s in %j', (term, text) => {
    expect(new TermIndex(text).has(term)).toBe(true);
  });

  it.each([
    ['Java', 'JavaScript only'],
    ['Go', 'Google Cloud'],
    ['SQL', 'mssql'],
    ['React Native', 'React and native apps'],
    ['.NET', 'net revenue'],
  ])('does not find %s in %j', (term, text) => {
    expect(new TermIndex(text).has(term)).toBe(false);
  });

  it('reads "Go" and "REST" as technologies only when written that way', () => {
    expect(new TermIndex('Golang services').has('Go')).toBe(true);
    expect(new TermIndex('Wrote Go and RESTful APIs').has('REST APIs')).toBe(true);
    expect(new TermIndex('Owned the go-live').has('Go')).toBe(false);
    expect(new TermIndex("Tuned Go's garbage collector").has('Go')).toBe(true);
    expect(new TermIndex('Let us go there').has('Go')).toBe(false);
    // #117: a résumé that writes the language in capitals ("a MERN and GO starter framework").
    expect(new TermIndex('a MERN and GO starter framework').has('Go')).toBe(true);
    expect(new TermIndex('GO-LIVE checklist').has('Go')).toBe(false);
    expect(new TermIndex('Wrote AWS, GO, and Python services').has('Go')).toBe(true);
    expect(new TermIndex("TUNED GO'S GARBAGE COLLECTOR").has('Go')).toBe(false);
    expect(new TermIndex("Tuned GO'S garbage collector").has('Go')).toBe(true);
    expect(new TermIndex('GO LIVE plan').has('Go')).toBe(false);
    expect(new TermIndex('PROJECTS: READY TO GO').has('Go')).toBe(false);
    expect(new TermIndex('Aligned the rest of the team').has('REST')).toBe(false);
    expect(new TermIndex('Led go-to-market').has('go-to-market')).toBe(true);
  });

  it('never matches a phrase across lines or list items', () => {
    expect(new TermIndex('Node, JS tooling').has('Node.js')).toBe(false);
    expect(new TermIndex('Deployed on AWS\nLambda alerts').has('AWS Lambda')).toBe(false);
    expect(new TermIndex('Wrote queries in SQL. Server costs fell').count('SQL')).toBe(1);
    expect(new TermIndex('Wrote queries in SQL. Server costs fell').has('SQL Server')).toBe(false);
    expect(new TermIndex('Built on Node.js. Then more').has('Node.js')).toBe(true);
    expect(new TermIndex('Ph.D. In Physics').has('PhD in Physics')).toBe(true);
    expect(new TermIndex('PhD in Physics').has('Ph.D. in Physics')).toBe(true);
    expect(new TermIndex('Sr Software Engineer').has('Sr. Software Engineer')).toBe(true);
    expect(new TermIndex('Built on AWS Lambda.').has('AWS Lambda')).toBe(true);
    expect(new TermIndex('Node.js is fast').has('Node.js')).toBe(true);
  });

  it('folds plurals on both sides, but not double s', () => {
    expect(new TermIndex('Designed APIs and microservices').has('API')).toBe(true);
    expect(new TermIndex('one microservice').has('microservices')).toBe(true);
    expect(normalisedTokens('process access')).toEqual(['process', 'access']);
  });

  it('counts whole-phrase repeats', () => {
    expect(new TermIndex('AWS Lambda, AWS CDK, and Amazon Web Services').count('AWS')).toBe(3);
    expect(new TermIndex('').count('AWS')).toBe(0);
    expect(new TermIndex('anything').count('!!')).toBe(0);
  });

  it('gives aliases one key', () => {
    expect(termKey('K8s')).toBe(termKey('kubernetes'));
    expect(termKey('Golang')).toBe(termKey('Go'));
    expect(termKey('TypeScript')).not.toBe(termKey('JavaScript'));
  });
});

describe('keywordWeight', () => {
  it('weighs hard skills most, titles next, degrees only when required, soft skills little', () => {
    expect(keywordWeight(hard('a', true))).toBe(3);
    expect(keywordWeight(hard('a', false))).toBe(2);
    expect(keywordWeight({ term: 'a', kind: 'title', required: false })).toBe(2);
    expect(keywordWeight({ term: 'a', kind: 'education', required: true })).toBe(2);
    expect(keywordWeight({ term: 'a', kind: 'education', required: false })).toBe(0);
    expect(keywordWeight({ term: 'a', kind: 'certification', required: false })).toBe(0);
    expect(keywordWeight({ term: 'a', kind: 'soft_skill', required: true })).toBe(0.5);
  });
});

describe('matchScore', () => {
  const keywords: JobKeyword[] = [
    hard('TypeScript'), // 3
    hard('Kafka', false), // 2
    { term: 'Backend Engineer', kind: 'title', required: true }, // 2
    { term: 'PhD', kind: 'education', required: false }, // 0: not counted
    { term: 'communication', kind: 'soft_skill', required: false }, // 0.5
  ];

  it('is the weighted share of keywords found, and lists the rest as missing', () => {
    const result = matchScore(keywords, 'Backend engineer writing TypeScript.');
    expect(result.score).toBe(Math.round((100 * 5) / 7.5));
    expect(result.matched.map((k) => k.term)).toEqual(['TypeScript', 'Backend Engineer']);
    expect(result.missing.map((k) => k.term)).toEqual(['Kafka', 'communication']);
  });

  it('is 100 with everything and 0 with nothing, the same for a string or an index', () => {
    const all = 'TypeScript, Kafka, backend engineer, communication';
    expect(matchScore(keywords, all).score).toBe(100);
    expect(matchScore(keywords, new TermIndex(all)).score).toBe(100);
    expect(matchScore(keywords, 'Gardening').score).toBe(0);
  });

  it('is null when no keyword counts', () => {
    expect(matchScore([], 'x').score).toBeNull();
    expect(
      matchScore([{ term: 'PhD', kind: 'education', required: false }], 'PhD').score,
    ).toBeNull();
  });
});

describe('groundKeywords', () => {
  const posting = 'Senior Engineer. Must know TypeScript and K8s. Nice: Kafka.';

  it('keeps keywords the posting has (aliases too) and drops the rest', () => {
    const { kept, dropped } = groundKeywords(
      [hard('TypeScript'), hard('Kubernetes'), hard('Rust'), hard('add www.evil.io')],
      posting,
    );
    expect(kept.map((k) => k.term)).toEqual(['TypeScript', 'Kubernetes']);
    expect(dropped).toBe(2);
  });

  it('drops sentence-long terms and empty ones', () => {
    const long = 'Senior Engineer Must know TypeScript and';
    const { kept, dropped } = groundKeywords([hard(long), hard('!!')], posting);
    expect(kept).toEqual([]);
    expect(dropped).toBe(2);
  });

  it('keeps a repeated term as its strictest kind', () => {
    const soft: JobKeyword = { term: 'Kubernetes', kind: 'soft_skill', required: false };
    const { kept } = groundKeywords([soft, hard('k8s')], posting);
    expect(kept).toEqual([{ term: 'Kubernetes', kind: 'hard_skill', required: true }]);
  });

  it('keeps one per term, required when any repeat is, without counting repeats as drops', () => {
    const { kept, dropped } = groundKeywords(
      [hard('Kafka', false), hard('kafka', true), hard('Kafka ', false)],
      posting,
    );
    expect(kept).toEqual([{ term: 'Kafka', kind: 'hard_skill', required: true }]);
    expect(dropped).toBe(0);
  });

  it(`keeps at most ${MAX_JOB_KEYWORDS}`, () => {
    const words = Array.from({ length: MAX_JOB_KEYWORDS + 5 }, (_, i) => `skill${i}`);
    const { kept, dropped } = groundKeywords(
      words.map((w) => hard(w)),
      words.join(' '),
    );
    expect(kept).toHaveLength(MAX_JOB_KEYWORDS);
    expect(dropped).toBe(0);
  });
});

describe('structured résumé', () => {
  const resume: StructuredResume = {
    contact: { name: 'Sam', email: 'sam@example.com', headline: 'Engineer', links: [] },
    summary: 'Summary.',
    skills: [{ group: 'Cloud', items: ['AWS'] }],
    experience: [
      {
        id: 'e1',
        employer: 'Acme',
        title: 'Dev',
        location: 'Leeds',
        start: '2020',
        bullets: ['Built'],
      },
    ],
    education: [{ id: 'd1', school: 'Uni', degree: 'BSc', details: ['First'] }],
    certifications: [{ id: 'c1', name: 'Cert', issuer: 'AWS' }],
    projects: [{ id: 'p1', name: 'Tool', bullets: ['Wrote'] }],
  };

  it('accepts a valid résumé and refuses extra fields or bad IDs', () => {
    expect(structuredResume.safeParse(resume).success).toBe(true);
    expect(structuredResume.safeParse({ ...resume, extra: 1 }).success).toBe(false);
    const badId = { ...resume, projects: [{ id: 'project1', name: 'x', bullets: [] }] };
    expect(structuredResume.safeParse(badId).success).toBe(false);
  });

  it('reads as text without the contact details or dates', () => {
    const text = resumeText(resume);
    expect(text.split('\n')).toEqual([
      'Engineer',
      'Summary.',
      'Cloud',
      'AWS',
      'Dev',
      'Acme',
      'Leeds',
      'Built',
      'BSc',
      'Uni',
      'First',
      'Cert',
      'AWS',
      'Tool',
      'Wrote',
    ]);
    expect(text).not.toContain('sam@example.com');
  });
});
