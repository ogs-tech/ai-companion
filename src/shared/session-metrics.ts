import type { ChannelId } from './channel.js';

/** Live numbers read off a session's transcript; every field is absent until the transcript says it. */
export interface SessionMetrics {
  /** The CLI's own running total for the conversation (US$). */
  costUsd?: number;
  /** The model that wrote the last assistant message, as the transcript names it. */
  model?: string;
  /** Tokens in the context window after the last assistant message (input + cache). */
  contextTokens?: number;
  /** The model's window; absent when unknown — the bar is then hidden, never guessed. */
  contextWindow?: number;
  /** Rate limit hit: shown as detail of Ocioso, never a state of its own. */
  rateLimit?: { message: string; /** Epoch ms, when the transcript carried it. */ resetsAt?: number };
  /** The last sentence the assistant wrote — context for a permission prompt. */
  lastAssistantText?: string;
}

/** Fixed model → window table, maintained here. Anything not matched is unknown (`null`). */
const WINDOWS: ReadonlyArray<[RegExp, number]> = [
  [/\[1m\]|-1m\b/i, 1_000_000],
  [/claude|opus|sonnet|haiku|fable/i, 200_000],
  [/gemini/i, 1_000_000],
  [/gpt-5/i, 400_000],
];

export function contextWindowFor(model: string | null | undefined, harness: ChannelId): number | null {
  if (!model) return null;
  // The Claude CLI only ever runs Claude models; for anything else the table decides.
  for (const [pattern, window] of WINDOWS) if (pattern.test(model)) return window;
  return harness === 'claude' ? 200_000 : null;
}

export type ContextLevel = 'ok' | 'warn' | 'danger';

/** Amber over 70%, red over 90% (starting values). */
export function contextLevel(fraction: number): ContextLevel {
  if (fraction > 0.9) return 'danger';
  if (fraction > 0.7) return 'warn';
  return 'ok';
}

export function contextFraction(metrics: SessionMetrics | undefined): number | null {
  if (!metrics?.contextTokens || !metrics.contextWindow) return null;
  return Math.min(1, metrics.contextTokens / metrics.contextWindow);
}
