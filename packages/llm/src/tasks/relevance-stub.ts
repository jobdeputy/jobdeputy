import type { Message } from '@strands-agents/sdk';
import type { ModelSource } from '../models.js';
import { StubModel } from '../stub-model.js';

/**
 * Dev stacks only (never prod): what the pretend `stub` provider (T08b2) answers for the
 * relevance task, so integration tests score jobs without calling a provider. Fixed rule:
 * a job scores 90 when the first word of its title appears in the profile's headline, else
 * 10; its best role is the role with exactly its title, else none.
 */
export function stubRelevanceSource(modelId: string): ModelSource {
  return {
    keySource: 'own',
    provider: 'stub',
    modelId,
    create: () => new StubModel((_, messages) => ({ tool: stubScores(promptText(messages)) })),
  };
}

function promptText(messages: Message[]): string {
  const first = messages[0];
  return (first?.content ?? [])
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Reads the prompt relevanceTask built (its own format) and scores each job by the rule. */
export function stubScores(prompt: string) {
  const headline = new Set(words(/^headline: (.*)$/m.exec(prompt)?.[1] ?? ''));
  const roles = [...prompt.matchAll(/^(r\d+): (.*)$/gm)].map((m) => ({
    id: m[1] as string,
    title: (m[2] as string).toLowerCase(),
  }));
  const results = [...prompt.matchAll(/^id: (\S+)\ntitle: (.*)$/gm)].map((m) => {
    const title = m[2] as string;
    const first = words(title)[0];
    const fits = first !== undefined && headline.has(first);
    return {
      id: m[1] as string,
      score: fits ? 90 : 10,
      bestRoleId: roles.find((r) => r.title === title.toLowerCase())?.id ?? null,
      reasons: [fits ? 'Stub: the title matches the headline' : 'Stub: no match'],
    };
  });
  return { results };
}
