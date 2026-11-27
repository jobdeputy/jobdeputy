import type { Message } from '@strands-agents/sdk';
import type { ModelSource } from '../models.js';
import { StubModel } from '../stub-model.js';
import type { CoverLetterOutput } from './cover-letter.js';
import type { JobKeywordsOutput } from './job-keywords.js';
import type { StructureResumeOutput } from './structure-resume.js';
import type { TailorResumeOutput } from './tailor-resume.js';

/**
 * Dev stacks only (never prod): what the pretend `stub` provider (T08b2) answers for the
 * tailoring tasks (#51), so integration tests tailor a résumé without calling a provider.
 * Fixed rules, each on the prompt its task built:
 * - structure-resume: the first line is the name, a second without a comma the headline;
 *   "Title, Employer" lines are jobs; lines
 *   starting "•" are the job's bullets; "Skills: a, b" and "Education: School" lines.
 * - job-keywords: each job's title (a required title), and the words of its description
 *   with a capital after the first letter or all in capitals ("TypeScript", "AWS", "APIs").
 * - tailor-resume: the base résumé's own summary (or headline), skills, and bullets,
 *   unchanged: honest by construction.
 * - cover-letter (PR D): the job's title and the company, the résumé's own bullets and skills,
 *   and fixed plain sentences that name nothing: honest by construction, 200–400 words.
 */
export function stubTailoringSource(modelId: string): ModelSource {
  return {
    keySource: 'own',
    provider: 'stub',
    modelId,
    create: () =>
      new StubModel((_, messages) => {
        const prompt = promptText(messages);
        if (prompt.includes('Copy this whole résumé')) return { tool: stubStructure(prompt) };
        if (prompt.includes('List the keywords of all')) return { tool: stubKeywords(prompt) };
        if (prompt.includes('Tailor the résumé for these')) return { tool: stubTailor(prompt) };
        if (prompt.includes('Write the cover letter body')) return { tool: stubLetter(prompt) };
        return { text: 'The stub provider has no answer for this prompt.' };
      }),
  };
}

function promptText(messages: Message[]): string {
  const first = messages[0];
  return (first?.content ?? [])
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

const block = (prompt: string, name: string) =>
  new RegExp(`<data name="${name}">\\n([\\s\\S]*?)\\n</data>`).exec(prompt)?.[1] ?? '';

export function stubStructure(prompt: string): StructureResumeOutput {
  const lines = block(prompt, 'resume')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const skills: { group: string; items: string[] }[] = [];
  const experience: { title: string; employer: string; bullets: string[] }[] = [];
  const education: { school: string }[] = [];
  const second = lines[1];
  const headline = second && !second.includes(',') && !second.includes(':') ? second : undefined;
  for (const line of lines.slice(headline ? 2 : 1)) {
    const skillLine = /^Skills: (.+)$/.exec(line);
    const school = /^Education: (.+)$/.exec(line);
    const job = /^([^,•]+), (.+)$/.exec(line);
    if (skillLine) skills.push({ group: 'Skills', items: (skillLine[1] ?? '').split(', ') });
    else if (school) education.push({ school: school[1] ?? '' });
    else if (line.startsWith('•')) experience.at(-1)?.bullets.push(line.slice(1).trim());
    else if (job) experience.push({ title: job[1] ?? '', employer: job[2] ?? '', bullets: [] });
  }
  return {
    contact: { name: lines[0] ?? '', ...(headline ? { headline } : {}) },
    skills,
    experience,
    education,
  };
}

export function stubKeywords(prompt: string): JobKeywordsOutput {
  const output: JobKeywordsOutput = { j1: [], j2: [], j3: [] };
  for (const m of block(prompt, 'jobs').matchAll(
    /^id: (j[123])\ntitle: (.*)\ndescription: ([\s\S]*?)(?=\n\nid: j|(?![\s\S]))/gm,
  )) {
    const id = m[1] as keyof JobKeywordsOutput;
    const words = [...new Set((m[3] ?? '').match(/\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b/g) ?? [])];
    output[id] = [
      { term: m[2] ?? '', kind: 'title', required: true },
      ...words.map((term) => ({ term, kind: 'hard_skill' as const, required: true })),
    ];
  }
  return output;
}

export function stubTailor(prompt: string): TailorResumeOutput {
  const resume = block(prompt, 'resume');
  const field = (name: string) => new RegExp(`^${name}: (.+)$`, 'm').exec(resume)?.[1];
  const skills = [
    ...(/^skills:\n((?: {2}.+\n?)+)/m.exec(resume)?.[1] ?? '').matchAll(/^ {2}(.+?): (.+)$/gm),
  ].map((m) => ({ group: m[1] ?? '', items: (m[2] ?? '').split(', ') }));
  const entries = (prefix: string) =>
    [...resume.matchAll(new RegExp(`^(${prefix}\\d+): .*\\n((?: {2}- .+\\n?)*)`, 'gm'))].map(
      (m) => ({
        id: m[1] ?? '',
        bullets: [...(m[2] ?? '').matchAll(/^ {2}- (.+)$/gm)].map((b) => b[1] ?? ''),
      }),
    );
  return {
    summary: field('summary') ?? `${field('headline') ?? 'Professional'}.`,
    skills,
    experience: entries('e'),
    projects: entries('p'),
  };
}

/** Plain sentences that name no tool, person, or number, to bring the stub's letter to length. */
const LETTER_FILLER = [
  'I care about clear work that other people can read and change.',
  'When a problem comes up, I look for its cause before I try a fix.',
  'I work well with others, and I ask for help when I need it.',
  'I explain my work in plain words, so the whole team can follow it.',
  'I plan my work in small steps and finish each one before the next.',
  'I read the work around a change before I make it.',
  'I welcome a review of my work and learn from what it shows.',
  'I keep notes on what I learn, so the next person can start faster.',
  'I check my own work with care before I share it with the team.',
  'I like to understand what the people who use my work need from it.',
];

export function stubLetter(prompt: string): CoverLetterOutput {
  const company = block(prompt, 'company').trim();
  const title = /^title: (.+)$/m.exec(block(prompt, 'job'))?.[1] ?? 'open';
  const resume = block(prompt, 'resume');
  // A few of each, so the letter stays within its limits (1,500 characters a paragraph,
  // 200–400 words) however long the résumé is.
  const bullets = [...resume.matchAll(/^ {2}- (.+)$/gm)]
    .map((m) => (m[1] ?? '').trim())
    .filter((b) => b.length <= 300)
    .slice(0, 3);
  const skills = [...resume.matchAll(/^ {2}[^-\s][^:]*: (.+)$/gm)]
    .flatMap((m) => (m[1] ?? '').split(', '))
    .slice(0, 8);
  const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  const paragraphs = [
    `I am writing to apply for the ${title} role at ${company}. The role fits the work I have done so far, and I would like to bring that work to your team.`,
    ...(bullets.length > 0 ? [`In my recent work: ${bullets.map(sentence).join(' ')}`] : []),
    ...(skills.length > 0 ? [`My skills include ${skills.join(', ')}.`] : []),
  ];
  const words = (texts: string[]) => texts.join(' ').split(/\s+/).filter(Boolean).length;
  const close = `Thank you for reading my letter. I would be glad to talk about how I could help ${company} in this role.`;
  // Filler until 230 words (within 200–400 whatever the résumé gave), each line at most twice.
  const filler: string[] = [];
  for (const line of [...LETTER_FILLER, ...LETTER_FILLER]) {
    if (words([...paragraphs, ...filler, close]) >= 230) break;
    filler.push(line);
  }
  return { paragraphs: [...paragraphs, filler.join(' '), close].filter(Boolean) };
}
