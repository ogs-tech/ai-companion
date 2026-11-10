import { contextWindowFor, type SessionMetrics } from '../../shared/session-metrics.js';
import type { ChannelId } from '../../shared/channel.js';

type Line = Record<string, unknown>;

const isRecord = (v: unknown): v is Line => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function textOf(message: Line): string {
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string' ? part['text'] : ''))
    .join(' ')
    .trim();
}

/** Last sentence of a text: what the assistant said right before asking. */
export function lastSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const sentences = flat.match(/[^.!?]+[.!?]*/g) ?? [flat];
  const last = sentences.map((s) => s.trim()).filter(Boolean).pop() ?? '';
  return last.length > 280 ? `${last.slice(0, 279)}…` : last;
}

/** `usage limit reached|1731024000` (epoch seconds) → epoch ms; anything else → undefined. */
function resetOf(text: string): number | undefined {
  const piped = /\|\s*(\d{9,13})\s*$/.exec(text)?.[1];
  if (!piped) return undefined;
  const n = Number(piped);
  return n < 1e11 ? n * 1000 : n;
}

/**
 * Reads the tail of a Claude transcript (already parsed to lines, oldest first):
 * the CLI's own `cost-state` total, the last assistant message's usage for the
 * context bar, its last sentence, and a rate-limit error entry when the last
 * turn ended on one. Pure: no I/O.
 */
export function metricsFromLines(lines: readonly Line[], harness: ChannelId, now: number): SessionMetrics {
  const metrics: SessionMetrics = {};
  let model: string | null = null;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (metrics.costUsd === undefined && line['type'] === 'cost-state' && line['hasUnknownModelCost'] !== true) {
      const total = line['totalCostUSD'];
      if (typeof total === 'number' && Number.isFinite(total)) metrics.costUsd = total;
    }
    if (line['type'] !== 'assistant' || !isRecord(line['message'])) continue;
    const message = line['message'];
    const text = textOf(message);

    // The newest assistant entry decides the rate-limit state: a later normal reply means the limit is over.
    if (metrics.rateLimit === undefined && metrics.contextTokens === undefined && line['isApiErrorMessage'] === true && /limit/i.test(text)) {
      const resetsAt = resetOf(text);
      if (resetsAt === undefined || resetsAt > now) {
        metrics.rateLimit = { message: text.split('|')[0]!.trim(), ...(resetsAt !== undefined ? { resetsAt } : {}) };
      }
      continue;
    }
    if (line['isApiErrorMessage'] === true) continue;

    const usage = message['usage'];
    if (metrics.contextTokens === undefined && isRecord(usage)) {
      const tokens = num(usage['input_tokens']) + num(usage['cache_read_input_tokens']) + num(usage['cache_creation_input_tokens']);
      if (tokens > 0) {
        metrics.contextTokens = tokens;
        model = typeof message['model'] === 'string' ? message['model'] : null;
      }
    }
    if (metrics.lastAssistantText === undefined && text) metrics.lastAssistantText = lastSentence(text);
    if (metrics.contextTokens !== undefined && metrics.lastAssistantText !== undefined && metrics.costUsd !== undefined) break;
  }

  const window = contextWindowFor(model, harness);
  if (window !== null && metrics.contextTokens !== undefined) metrics.contextWindow = window;
  else delete metrics.contextTokens; // no known window: hide the bar rather than guess
  return metrics;
}
