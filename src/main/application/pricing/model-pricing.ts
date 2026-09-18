import type { TranscriptModelUsage, TranscriptUsage } from '../ports/session-transcript-port.js';

/** USD per million tokens, for one model. */
export interface ModelRate {
  input: number;
  output: number;
}

/**
 * Published rates, in USD per million tokens, as of 2026-09-17.
 *
 * Bundled rather than fetched: this app has no backend, no API and no
 * telemetry (see CLAUDE.md), so a price table is data that ships with a
 * release and is corrected by a release — or, for a user on rates of their
 * own, overridden from Settings.
 *
 * Keys are normalized ids (see `normalizeModelId`), so one entry covers every
 * spelling of a model that a transcript can carry: `claude-opus-5`,
 * `claude-opus-5[1m]` and `claude-opus-5-20260114` all resolve here.
 */
export const BUNDLED_MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
};

/** A cache write costs more than a plain input token; a cache read costs a fraction of one. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const PER_MILLION = 1_000_000;

/**
 * Reduces a transcript's model id to the key the rate table uses.
 *
 * Transcripts spell the same model several ways: a context-window suffix
 * (`claude-opus-5[1m]`) and a release date (`claude-haiku-4-5-20251001`) are
 * both attached to the id the API returns. Neither changes the rate, so both
 * are stripped. Anything left unrecognized is returned as-is and will simply
 * not be found in the table — which is the point: an unknown model must read
 * as unknown, not as a near-miss priced at the wrong rate.
 */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '') // context-window suffix: `[1m]`
    .replace(/-\d{8}$/, ''); // release date: `-20251001`
}

export function rateFor(
  model: string,
  overrides?: Readonly<Record<string, ModelRate>>,
): ModelRate | null {
  const id = normalizeModelId(model);
  return overrides?.[id] ?? overrides?.[model] ?? BUNDLED_MODEL_RATES[id] ?? null;
}

/**
 * What one model's tokens cost, or `null` when that model has no published
 * rate — never `0`, and never a guess from a similar-looking id.
 *
 * Cache writes are billed at the 5-minute rate. The CLI's own `cost-state`
 * does not record which of the two cache TTLs a write used, and this function
 * only ever runs on transcripts that have no `cost-state` to begin with — so
 * a conversation that used 1-hour caching is under-estimated here. That
 * imprecision is the reason every surface labels this number *estimado*.
 */
export function estimateModelCost(
  usage: TranscriptModelUsage,
  overrides?: Readonly<Record<string, ModelRate>>,
): number | null {
  const rate = rateFor(usage.model, overrides);
  if (!rate) return null;
  const inputCost =
    (usage.inputTokens +
      usage.cacheCreationTokens * CACHE_WRITE_MULTIPLIER +
      usage.cacheReadTokens * CACHE_READ_MULTIPLIER) *
    (rate.input / PER_MILLION);
  const outputCost = usage.outputTokens * (rate.output / PER_MILLION);
  return inputCost + outputCost;
}

/**
 * What a whole conversation cost.
 *
 * Prefers the total the CLI itself recorded — that is a reading, not an
 * estimate, and it covers the large majority of transcripts. Only a
 * transcript written before the CLI kept its own accounting falls through to
 * the price table.
 *
 * Returns `null` if *any* model in the conversation is unpriced. Summing only
 * the models that happen to be known would produce a confident number that is
 * silently too low, which is worse than an honest blank.
 */
export function resolveCostUsd(
  usage: TranscriptUsage,
  overrides?: Readonly<Record<string, ModelRate>>,
): number | null {
  if (usage.reportedCostUsd !== null) return usage.reportedCostUsd;
  if (usage.models.length === 0) return 0;

  let total = 0;
  for (const model of usage.models) {
    const cost = model.reportedCostUsd ?? estimateModelCost(model, overrides);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

/** The model a conversation should be labelled with: the one it spent the most output on. */
export function primaryModel(usage: TranscriptUsage): string | null {
  let best: TranscriptModelUsage | null = null;
  for (const model of usage.models) {
    if (!best || model.outputTokens > best.outputTokens) best = model;
  }
  return best?.model ?? null;
}
