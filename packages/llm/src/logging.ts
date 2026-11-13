import { configureLogging } from '@strands-agents/sdk';

// Strands prints its own warnings and errors to the console. Users' keys must never reach a
// log (decision 0009), so anything shaped like a key is masked first; debug and info are off.

const KEY_LIKE = /\b(sk-|stub-)[A-Za-z0-9_-]{6,}/g;

export function redact(value: unknown): string {
  const text =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === 'string'
        ? value
        : safeStringify(value);
  return text.replace(KEY_LIKE, '$1[redacted]');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

configureLogging({
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => console.warn(...args.map(redact)),
  error: (...args: unknown[]) => console.error(...args.map(redact)),
});
