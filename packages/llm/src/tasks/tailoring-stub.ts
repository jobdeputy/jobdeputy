import type { Message } from '@strands-agents/sdk';
import type { ModelSource } from '../models.js';
import { StubModel } from '../stub-model.js';
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
