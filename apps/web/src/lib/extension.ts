import type { AutoApplyAnswer, ExtensionHello } from '@jobdeputy/shared/extension';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { readConfig } from './config.ts';

/**
 * #54 PR D (decision 0020): the browser extension, as Auto apply sees it. The page reaches it
 * through Chrome's `chrome.runtime.sendMessage(id, …)`, which Chrome gives a page only when an
 * installed extension lets its origin in (`externally_connectable`). Only the IDs this cell trusts
 * (`/config.json` `extensionIds`) are asked. Nothing the extension answers is trusted beyond its
 * shape: it checks the job itself, and opens the form itself.
 */
export type ExtensionState =
  /** This site has no extension to hand jobs to yet (prod before the store item). */
  | { state: 'unsupported' }
  /** None answered: not installed, or turned off. */
  | { state: 'missing' }
  | ({ state: 'ready' } & ExtensionHello);

/**
 * The extension's answer to Auto apply, or `no-answer`: it was reached but said nothing in time
 * (or closed the reply), so it may have opened the form all the same. Never sent again then.
 */
export type AutoApplyResult =
  | AutoApplyAnswer
  | { ok: false; reason: 'no-answer' }
  /** No trusted extension could be reached at all: nothing opened. */
  | { ok: false; reason: 'unreachable' };

export interface ExtensionLink {
  check(): Promise<ExtensionState>;
  autoApply(jobId: string, url: string): Promise<AutoApplyResult>;
}

/**
 * How long an extension may take to say hello, and to open a form: well past its own worst case
 * (a sign-in without a window, at most 5 seconds, then the tab), so an answer is never missed.
 */
const HELLO_MS = 3000;
const AUTO_APPLY_MS = 30_000;

interface Runtime {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

/**
 * Chrome's words when no extension with that ID is there to receive. Any other error (its reply
 * closed: the worker stopped or updated) means it was reached, and may have acted.
 */
const NOT_THERE = /Could not establish connection|Receiving end does not exist/i;

function runtime(): Runtime | null {
  const chrome = (globalThis as { chrome?: { runtime?: Partial<Runtime> } }).chrome;
  return typeof chrome?.runtime?.sendMessage === 'function' ? (chrome.runtime as Runtime) : null;
}

/**
 * What came back: the extension's answer; `gone`, no extension with that ID (Chrome says so at
 * once); or `silent`, none in time.
 */
type Sent = { answer: unknown } | 'gone' | 'silent';

function send(id: string, message: unknown, ms: number): Promise<Sent> {
  const chrome = runtime();
  if (!chrome) return Promise.resolve('gone');
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('silent'), ms);
    try {
      chrome.sendMessage(id, message, (response) => {
        clearTimeout(timer);
        // Read, so Chrome doesn't log it as unchecked: an extension not installed is expected.
        const error = chrome.lastError;
        if (!error) resolve({ answer: response });
        else resolve(NOT_THERE.test(error.message ?? '') ? 'gone' : { answer: undefined });
      });
    } catch {
      clearTimeout(timer);
      resolve('gone');
    }
  });
}

const answerOf = (sent: Sent) => (typeof sent === 'object' ? sent.answer : undefined);

function isHello(value: unknown): value is ExtensionHello {
  const hello = value as Partial<ExtensionHello> | null;
  return typeof hello?.version === 'string' && typeof hello.signedIn === 'boolean';
}

const REASONS = new Set(['signed-out', 'not-greenhouse', 'wrong-job', 'failed']);
function isAnswer(value: unknown): value is AutoApplyAnswer {
  const answer = value as { ok?: unknown; reason?: unknown } | null;
  return answer?.ok === true || (answer?.ok === false && REASONS.has(answer.reason as string));
}

export function createExtensionLink(ids: () => Promise<readonly string[]>): ExtensionLink {
  /** The ID that last answered hello: the one to hand jobs to. */
  let answering: string | undefined;
  async function check(): Promise<ExtensionState> {
    const trusted = await ids();
    if (trusted.length === 0) return { state: 'unsupported' };
    // All at once (a dev site trusts more than one): the first in the list that answers.
    const hellos = await Promise.all(
      trusted.map(async (id) => ({
        id,
        hello: answerOf(await send(id, { type: 'hello' }, HELLO_MS)),
      })),
    );
    const found = hellos.find(({ hello }) => isHello(hello));
    answering = found?.id;
    if (!found || !isHello(found.hello)) return { state: 'missing' };
    return { state: 'ready', version: found.hello.version, signedIn: found.hello.signedIn };
  }
  /** One send; reached but silent is `no-answer`, never sent again (a tab may be open). */
  async function handOver(id: string, message: unknown): Promise<AutoApplyResult | 'gone'> {
    const sent = await send(id, message, AUTO_APPLY_MS);
    if (sent === 'gone') return 'gone';
    const answer = answerOf(sent);
    if (isAnswer(answer)) return answer;
    return { ok: false, reason: 'no-answer' };
  }
  return {
    check,
    async autoApply(jobId, url) {
      const message = { type: 'auto-apply', jobId, url };
      if (answering !== undefined) {
        const result = await handOver(answering, message);
        if (result !== 'gone') return result;
      }
      // None answered yet, or the one that did is gone (removed, turned off): look again, once.
      if ((await check()).state !== 'ready' || answering === undefined) {
        return { ok: false, reason: 'unreachable' };
      }
      const result = await handOver(answering, message);
      return result === 'gone' ? { ok: false, reason: 'unreachable' } : result;
    },
  };
}

/**
 * The cell's trusted extension IDs from /config.json, kept once a config is read; with none (no
 * config there) read again next time; a failed read throws, and is read again next time.
 */
let trustedIds: Promise<readonly string[]> | undefined;
function readTrustedIds(): Promise<readonly string[]> {
  trustedIds ??= readConfig()
    .then((config) => {
      if (!config) trustedIds = undefined;
      return config?.extensionIds ?? [];
    })
    .catch((error: unknown) => {
      // Not "none trusted": couldn't tell. The state stays unknown (checking) until asked again.
      trustedIds = undefined;
      throw error;
    });
  return trustedIds;
}

const deployed = createExtensionLink(readTrustedIds);

/**
 * The test build (`--mode e2e`) has an extension that is installed and signed in, and opens
 * nothing; the unit tests', unless a test provides its own, has none to hand jobs to.
 */
const testBuild: ExtensionLink = {
  check: async () => ({ state: 'ready', version: '0.1.0', signedIn: true }),
  autoApply: async () => ({ ok: true }),
};
const unitTests: ExtensionLink = {
  check: async () => ({ state: 'unsupported' }),
  autoApply: async () => ({ ok: false, reason: 'unreachable' }) as const,
};

/** A tree may provide its own link (the unit tests do). */
export const ExtensionContext = createContext<ExtensionLink | null>(null);

export function useExtensionLink(): ExtensionLink {
  const provided = useContext(ExtensionContext);
  if (provided) return provided;
  if (import.meta.env.MODE === 'e2e') return testBuild;
  if (import.meta.env.MODE === 'test') return unitTests;
  return deployed;
}

/**
 * The extension's state, asked again when the page has the focus back: the person may have just
 * installed it, or signed in to it.
 */
export function useExtension() {
  const link = useExtensionLink();
  return useQuery({
    queryKey: ['extension'],
    queryFn: () => link.check(),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
