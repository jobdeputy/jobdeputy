import type { JobKeyword, StructuredResume } from '@jobdeputy/shared';
import { describe, expect, it } from 'vitest';
import {
  checkLetter,
  claimable,
  companyName,
  companyNames,
  LETTER_WORDS,
  type LetterContext,
  PUFFERY,
  plainLetter,
  provenSkills,
  provenUsed,
  spelledNumbers,
} from '../src/letter-checks.js';
import { stubSource } from '../src/stub-model.js';
import {
  COVER_LETTER_MAX_ITERATIONS,
  coverLetterOutput,
  coverLetterTask,
  LETTER_DESCRIPTION_CHARS,
  writeCoverLetter,
} from '../src/tasks/cover-letter.js';

const resume: StructuredResume = {
  contact: {
    name: 'Sam Example',
    email: 'sam@example.com',
    headline: 'Backend engineer',
    links: [],
  },
  summary: 'Backend engineer with 5 years of Node.js.',
  skills: [{ group: 'Languages', items: ['TypeScript', 'SQL'] }],
  experience: [
    {
      id: 'e1',
      employer: 'Example Logistics',
      title: 'Software Engineer',
      start: '2022',
      end: 'Present',
      bullets: ['Built APIs in Node.js serving 2 million requests a day.', 'Cut latency by 40%.'],
    },
  ],
  education: [{ id: 'd1', school: 'Example University', degree: 'BSc', details: [] }],
  certifications: [],
  projects: [],
};

const kw = (term: string, kind: JobKeyword['kind'], required = true): JobKeyword => ({
  term,
  kind,
  required,
});

const context: LetterContext = {
  company: 'Example Payments',
  resume,
  evidence: ['Docker'],
  job: {
    title: 'Senior Backend Engineer',
    description: 'Build payment APIs in Node.js and TypeScript with Kafka. Docker is a plus.',
    keywords: [
      kw('Senior Backend Engineer', 'title'),
      kw('Node.js', 'hard_skill'),
      kw('TypeScript', 'hard_skill'),
      kw('Kafka', 'hard_skill'),
      kw('Docker', 'hard_skill', false),
      kw('communication', 'soft_skill', false),
    ],
  },
};

/** 21 words, no numbers and no capitalised word inside a sentence. */
const FILLER =
  'I care about clear code, careful reviews, and steady delivery, and I enjoy working with people who do the same.';

/** An honest letter of about 230 words. */
const honest = () => [
  'I am applying for the Senior Backend Engineer role at Example Payments.',
  'At Example Logistics I built APIs in Node.js serving 2 million requests a day, and I cut latency by 40%. I write TypeScript every day and package services with Docker.',
  Array(9).fill(FILLER).join(' '),
  'Thank you for considering my application to Example Payments.',
];

const kinds = (paragraphs: string[], ctx: LetterContext = context) =>
  checkLetter(ctx, paragraphs).map((i) => i.kind);

describe('checkLetter', () => {
  it('passes an honest letter', () => {
    expect(checkLetter(context, honest())).toEqual([]);
  });

  it('refuses numbers the résumé does not have, but allows the job title and company’s', () => {
    const letter = honest();
    letter[1] = `${letter[1]} I led a team of 9.`;
    expect(checkLetter(context, letter)).toEqual([
      { kind: 'number', message: 'the number 9 is not in the résumé' },
    ]);
    const ctx = { ...context, company: 'Example 3D', job: { ...context.job, title: 'Engineer 2' } };
    const named = honest().map((p) => p.replaceAll('Example Payments', 'Example 3D'));
    named[0] = 'I am applying for the Engineer 2 role at Example 3D.';
    expect(kinds(named, ctx)).toEqual([]);
  });

  it('reads numbers written as words, so they cannot slip past the number check', () => {
    expect(
      spelledNumbers('six years, twenty-five services, Forty two, a dozen teams, one of them'),
    ).toBe('6 years, 25 services, 42, a 12 teams, one of them');
    const letter = honest();
    letter[1] = `${letter[1]} I have five years of Node.js and led seven engineers.`;
    expect(checkLetter(context, letter)).toEqual([
      { kind: 'number', message: 'the number 7 is not in the résumé' },
    ]);
  });

  it('refuses claims of quality the résumé does not state', () => {
    expect(PUFFERY).toContain('scalable');
    const letter = honest();
    letter[1] = `${letter[1]} Scalable and robust systems are what I build.`;
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      'remove "Scalable": the résumé does not say so',
      'remove "robust": the résumé does not say so',
    ]);
    const stated = {
      ...context,
      resume: { ...resume, summary: 'Backend engineer building scalable APIs.' },
    };
    letter[1] = `${honest()[1]} I build scalable systems.`;
    expect(kinds(letter, stated)).toEqual([]);
  });

  it('lets the company’s own name and the job’s title be written, even as unproven skills', () => {
    const ctx: LetterContext = {
      ...context,
      company: 'MongoDB',
      job: {
        ...context.job,
        title: 'Python Developer',
        keywords: [
          kw('MongoDB', 'hard_skill'),
          kw('Python', 'hard_skill'),
          kw('Kafka', 'hard_skill'),
        ],
      },
    };
    expect(claimable(ctx).map((k) => k.term)).toEqual(['Kafka']);
    const letter = honest().map((p) => p.replaceAll('Example Payments', 'MongoDB'));
    letter[0] = 'I am applying for the Python Developer role at MongoDB.';
    expect(kinds(letter, ctx)).toEqual([]);
    expect(coverLetterTask.prompt(ctx)).toContain('never claim: Kafka (required)\n');
  });

  it('accepts the company named without its legal ending', () => {
    expect(companyName('Acme, Inc.')).toBe('Acme');
    expect(companyName('Example Payments Ltd')).toBe('Example Payments');
    expect(companyName('Inc.')).toBe('Inc.');
    const ctx = { ...context, company: 'Example Payments, Inc.' };
    expect(kinds(honest(), ctx)).toEqual([]);
    expect(
      checkLetter(
        ctx,
        honest().map((p) => p.replaceAll('Example Payments', 'you')),
      ),
    ).toEqual([
      { kind: 'company-missing', message: 'name the company, Example Payments, at least once' },
    ]);
  });

  it('checks name-shaped words at a sentence’s start and after a colon', () => {
    const letter = honest();
    letter[1] = `${letter[1]} GraphQL is what I use. My stack: Terraform and Node.js.`;
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      '"GraphQL" is not in the résumé or the job: remove it',
      '"Terraform" is not in the résumé or the job: remove it',
    ]);
  });

  it('refuses words of scale the résumé does not write', () => {
    const letter = honest();
    letter[1] = `${letter[1]} I served hundreds of customers and two million requests.`;
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      '"hundreds" is not in the résumé: use the résumé\'s own numbers',
    ]);
  });

  it('reads no number inside a name, and no comparison as a placeholder', () => {
    const letter = honest();
    letter[1] = `${letter[1]} I kept p99 latency < 40 ms and errors > 2 per day low.`;
    expect(kinds(letter)).toEqual([]);
  });

  it('lets a company named like a domain be named', () => {
    const ctx = { ...context, company: 'Booking.com' };
    const letter = honest().map((p) => p.replaceAll('Example Payments', 'Booking.com'));
    expect(kinds(letter, ctx)).toEqual([]);
  });

  it('reads résumé words after a line break, and names after an abbreviation', () => {
    const ctx = { ...context, resume: { ...resume, summary: 'Built pipelines\nFlink and SQL.' } };
    const letter = honest();
    letter[1] = `${letter[1]} I run tools, e.g. Flink, and compare it vs. Pulsar and Kafka.`;
    expect(checkLetter(ctx, letter).map((i) => i.message)).toEqual([
      '"Kafka" is not shown to be true: remove every mention of it, even as something to learn',
      '"Pulsar" is not in the résumé or the job: remove it',
    ]);
  });

  it('refuses a person or tool only the description names', () => {
    const ctx = {
      ...context,
      job: {
        ...context.job,
        description: `${context.job.description} Report to Jane Doe; we use Pulsar.`,
      },
    };
    const letter = honest();
    letter[1] = `${letter[1]} I look forward to meeting Jane Doe and using Pulsar.`;
    expect(checkLetter(ctx, letter).map((i) => i.message)).toEqual([
      '"Jane" is not in the résumé or the job: remove it',
      '"Doe" is not in the résumé or the job: remove it',
      '"Pulsar" is not in the résumé or the job: remove it',
    ]);
  });

  it('names the company as a whole word, with or without "Company"', () => {
    expect(companyNames('The Coca-Cola Company')).toEqual([
      'The Coca-Cola Company',
      'The Coca-Cola',
    ]);
    expect(companyNames('Bain & Company')).toEqual(['Bain & Company', 'Bain']);
    const meta = { ...context, company: 'Meta' };
    const letter = honest().map((p) => p.replaceAll('Example Payments', 'your metadata team'));
    expect(kinds(letter, meta)).toEqual(['company-missing']);
  });

  it('reads a hype word with or without its hyphen, in the letter and the résumé', () => {
    const stated = {
      ...context,
      resume: { ...resume, summary: 'Built a high performance engine.' },
    };
    const letter = honest();
    letter[1] = `${letter[1]} I like high-performance work.`;
    expect(kinds(letter, stated)).toEqual([]);
    letter[1] = `${honest()[1]} I like world class work.`;
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      'remove "world class": the résumé does not say so',
    ]);
  });

  it('refuses links and emails, even the résumé’s own email (the header has it)', () => {
    const letter = honest();
    letter[3] = 'Reach me at sam@example.com or see www.example-recruit.io for more.';
    expect(kinds(letter)).toEqual(['link', 'link']);
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      'remove "sam@example.com": no links or contact details',
      'remove "www.example-recruit.io": no links or contact details',
    ]);
  });

  it('refuses a job keyword without evidence, but not the job’s title or a soft skill', () => {
    const letter = honest();
    letter[1] = `${letter[1]} I also run Kafka clusters, with good communication.`;
    expect(checkLetter(context, letter)).toEqual([
      {
        kind: 'unsupported-keyword',
        message:
          '"Kafka" is not shown to be true: remove every mention of it, even as something to learn',
      },
    ]);
  });

  it('refuses names inside a sentence that neither the résumé nor the job has', () => {
    const letter = honest();
    letter[1] = `${letter[1]} Before that I worked at Google with Terraform.`;
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      '"Google" is not in the résumé or the job: remove it',
      '"Terraform" is not in the résumé or the job: remove it',
    ]);
  });

  it('allows a sentence’s first word, possessives, months, and its own words', () => {
    const letter = honest();
    letter[1] = `${letter[1]} Reliability matters to me. In May I read about Example Payments’s API, and I'm keen to help the team. I studied at Example University.`;
    expect(kinds(letter)).toEqual([]);
  });

  it('refuses placeholders', () => {
    const letter = honest();
    letter[0] = 'I am applying for the [Job Title] role at Example Payments, {company}.';
    expect(kinds(letter)).toEqual(['placeholder', 'placeholder']);
    expect(checkLetter(context, letter).map((i) => i.message)).toEqual([
      'remove the placeholder "[Job Title]": write the real words or leave it out',
      'remove the placeholder "{company}": write the real words or leave it out',
    ]);
  });

  it('asks for the company to be named', () => {
    const letter = honest().map((p) => p.replaceAll('Example Payments', 'your team'));
    expect(kinds(letter)).toEqual(['company-missing']);
  });

  it(`asks for ${LETTER_WORDS.min} to ${LETTER_WORDS.max} words`, () => {
    expect(kinds(honest().slice(0, 2))).toEqual(['length']);
    const long = [...honest(), Array(10).fill(FILLER).join(' ')];
    expect(checkLetter(context, long)[0]?.message).toMatch(
      /^the letter has \d+ words: write 250 to 350$/,
    );
  });
});

describe('plainLetter', () => {
  it('drops a greeting and sign-off the model added, and Markdown', () => {
    const paragraphs = [
      'Dear Hiring Manager,',
      '**I am applying** for the role.',
      'Thank you for your time. I would welcome the chance to talk about how I can help your team ship.',
      'Sincerely,',
      'Sam Example',
    ];
    expect(plainLetter(paragraphs, 'Sam Example')).toEqual([
      'I am applying for the role.',
      'Thank you for your time. I would welcome the chance to talk about how I can help your team ship.',
    ]);
  });

  it('drops a greeting or sign-off written inside the first or last paragraph', () => {
    expect(
      plainLetter(
        [
          'Dear Hiring Manager, I am applying for the role.',
          'I hope to talk soon. Best regards, Sam Example',
        ],
        'Sam Example',
      ),
    ).toEqual(['I am applying for the role.', 'I hope to talk soon.']);
    expect(plainLetter(['Hello team! Body.', 'Close. Sam Example'], 'Sam Example')).toEqual([
      'Body.',
      'Close.',
    ]);
    expect(plainLetter(['Body.', 'Thank you for your time.'], '')).toEqual([
      'Body.',
      'Thank you for your time.',
    ]);
  });

  it('never cuts the opening words with a greeting', () => {
    expect(
      plainLetter(['Dear Hiring Manager\nI am excited to apply at Acme, because it fits.'], 'Sam'),
    ).toEqual(['I am excited to apply at Acme, because it fits.']);
    expect(plainLetter(['Hi-tech teams like Acme, need people.'], 'Sam')).toEqual([
      'Hi-tech teams like Acme, need people.',
    ]);
    expect(
      plainLetter(
        ['Body.', 'Thank you.\nAll the best,\nSam Example, Senior Engineer'],
        'Sam Example',
      ),
    ).toEqual(['Body.']);
  });

  it('keeps a short last paragraph that is not a sign-off', () => {
    expect(plainLetter(['Body.', 'I hope to hear from you.'], 'Sam')).toEqual([
      'Body.',
      'I hope to hear from you.',
    ]);
  });
});

describe('provenSkills and provenUsed', () => {
  it('lists the hard skills shown to be true, and those the letter uses', () => {
    expect(provenSkills(context)).toEqual(['Node.js', 'TypeScript', 'Docker']);
    expect(provenUsed(context, ['I use Node.js.'])).toEqual(['Node.js']);
  });
});

describe('coverLetterTask prompt', () => {
  it('lists the keywords to use and never claim, without the title, and caps the description', () => {
    const description = `Build APIs. ${'x'.repeat(LETTER_DESCRIPTION_CHARS)}`;
    const prompt = coverLetterTask.prompt({ ...context, job: { ...context.job, description } });
    expect(prompt).toContain('use where true: Node.js (required); TypeScript (required); Docker');
    expect(prompt).toContain('never claim: Kafka (required)\n');
    expect(prompt).not.toContain('Senior Backend Engineer (required)');
    expect(prompt).toContain(`description: ${description.slice(0, LETTER_DESCRIPTION_CHARS)}\n`);
    expect(prompt).toContain('<data name="confirmed_skills">\nDocker\n</data>');
    expect(prompt).not.toContain('previous_draft');
  });

  it('sends a repair with the draft and its fixes', () => {
    const prompt = coverLetterTask.prompt({
      ...context,
      repair: { draft: ['Old.'], fixes: ['the number 9 is not in the résumé'] },
    });
    expect(prompt).toContain('{"paragraphs":["Old."]}');
    expect(prompt).toContain('- the number 9 is not in the résumé');
  });

  it('accepts 1 to 6 paragraphs', () => {
    expect(coverLetterOutput.safeParse({ paragraphs: honest() }).success).toBe(true);
    expect(coverLetterOutput.safeParse({ paragraphs: [] }).success).toBe(false);
    expect(coverLetterOutput.safeParse({ paragraphs: Array(7).fill('A.') }).success).toBe(false);
  });
});

/** Answers the n-th task call with the n-th reply, and records each call's first prompt. */
function perTaskCall(replies: ({ tool: { paragraphs: string[] } } | { text: string })[]) {
  const prompts: string[] = [];
  const source = stubSource((_, messages) => {
    const n = source.maxTokensSeen.length - 1;
    prompts[n] ??= JSON.stringify(messages);
    return replies[n] ?? { text: 'out of replies' };
  });
  return { source, prompts };
}

const letter = (paragraphs = honest()) => ({ tool: { paragraphs } });

describe('writeCoverLetter', () => {
  it('stops after one call when the letter passes', async () => {
    const { source } = perTaskCall([letter()]);
    const stored: number[] = [];
    const run = await writeCoverLetter(context, source, {
      onCall: async (a) => {
        stored.push(a.iteration);
      },
    });
    expect(source.model.calls).toBe(1);
    expect(stored).toEqual([1]);
    expect(run.status).toBe('ok');
    expect(run.best?.paragraphs).toEqual(honest());
  });

  it('repairs a failing letter, naming its issues and those fixed earlier', async () => {
    const nine = honest();
    nine[1] = `${nine[1]} I led a team of 9.`;
    const google = honest();
    google[1] = `${google[1]} I worked at Google.`;
    const { source, prompts } = perTaskCall([letter(nine), letter(google), letter()]);
    const run = await writeCoverLetter(context, source);
    expect(run.attempts.map((a) => a.issues.map((i) => i.kind))).toEqual([
      ['number'],
      ['unknown-name'],
      [],
    ]);
    expect(prompts[1]).toContain('the number 9 is not in the résumé');
    expect(prompts[2]).toContain(
      'keep fixed from an earlier draft: the number 9 is not in the résumé',
    );
    expect(run.best?.iteration).toBe(3);
    expect(run.status).toBe('ok');
  });

  it(`fails after ${COVER_LETTER_MAX_ITERATIONS} letters that all fail a check`, async () => {
    const short = letter(['Too short for Example Payments.']);
    const { source } = perTaskCall([short, short, short, letter()]);
    const run = await writeCoverLetter(context, source);
    expect(source.maxTokensSeen).toHaveLength(COVER_LETTER_MAX_ITERATIONS);
    expect(run.status).toBe('failed');
    expect(run.best).toBeUndefined();
  });

  it('tries again after a call without valid output, and stops after two in a row', async () => {
    const once = perTaskCall([{ text: 'no tool' }, letter()]);
    expect((await writeCoverLetter(context, once.source)).status).toBe('ok');
    const twice = perTaskCall([{ text: 'a' }, { text: 'b' }, letter()]);
    const run = await writeCoverLetter(context, twice.source);
    expect(run.attempts.map((a) => a.result.status)).toEqual(['partial', 'partial']);
    expect(run.status).toBe('failed');
  });

  it('stops after a cancelled call, and before a call when canStart says no', async () => {
    const { source } = perTaskCall([letter(), letter()]);
    const controller = new AbortController();
    controller.abort();
    const run = await writeCoverLetter(context, source, { signal: controller.signal });
    expect(run.attempts).toHaveLength(1);
    expect(run.status).toBe('failed');
    const idle = perTaskCall([letter()]);
    const none = await writeCoverLetter(context, idle.source, { canStart: () => false });
    expect(idle.source.model.calls).toBe(0);
    expect(none.status).toBe('failed');
  });

  it('throws a provider error on the first call, and ends failed on a later one', async () => {
    const fresh = stubSource(() => {
      throw new Error('ThrottlingException');
    });
    await expect(writeCoverLetter(context, fresh)).rejects.toThrow('ThrottlingException');
    const later = stubSource(() => {
      if (later.maxTokensSeen.length > 1) throw new Error('ThrottlingException');
      return letter(['Too short for Example Payments.']);
    });
    const run = await writeCoverLetter(context, later);
    expect(run.attempts).toHaveLength(1);
    expect(run.status).toBe('failed');
  });
});
