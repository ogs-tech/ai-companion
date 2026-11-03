import type { TranscriptModelUsage } from '../ports/session-transcript-port.js';

/**
 * Cursor records no token counts, so usage is reconstructed from the message
 * text. What IS real: the model, which Cursor stamps on every assistant part as
 * `providerOptions.cursor.modelName`. What is NOT: the token numbers — roughly
 * 4 characters per token — and the billing, which assumes no prompt caching
 * (every turn re-sends the whole history at the full input rate). Both push the
 * result up, so every surface labels it *estimado*.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Cursor spells reasoning effort as suffixes on the base id; none changes the
 * rate. `-fast` is NOT one of them: it is a separate, pricier tier
 * (`composer-2.5-fast` costs 6x `composer-2.5`), so it is kept and gets its own
 * table entry. It trails the effort (`grok-4.7-high-fast`), so it is peeled off
 * first and put back after the effort is stripped.
 */
const EFFORT_SUFFIX = /-(thinking|low|medium|high|xhigh|max)$/;

export function normalizeCursorModelId(model: string): string {
  // `cursor-grok-4.6-fast` is the same model family Cursor hosts under its own prefix.
  let id = model.trim().toLowerCase().replace(/^cursor-/, '');
  const fast = id.endsWith('-fast');
  if (fast) id = id.slice(0, -'-fast'.length);
  for (let next = id.replace(EFFORT_SUFFIX, ''); next !== id; next = id.replace(EFFORT_SUFFIX, '')) id = next;
  return fast ? `${id}-fast` : id;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** The text a model actually reads for one content part — never signatures or provider metadata. */
function partText(part: unknown): string {
  if (typeof part === 'string') return part;
  const record = asRecord(part);
  if (!record) return '';
  if (typeof record['text'] === 'string') return record['text'];
  if (record['type'] === 'tool-call') {
    return `${String(record['toolName'] ?? '')}${JSON.stringify(record['args'] ?? {})}`;
  }
  if (record['type'] === 'tool-result') return JSON.stringify(record['result'] ?? record['output'] ?? '');
  return '';
}

function messageText(content: unknown): string {
  return Array.isArray(content) ? content.map(partText).join('') : partText(content);
}

function modelNameOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    const name = asRecord(asRecord(asRecord(part)?.['providerOptions'])?.['cursor'])?.['modelName'];
    if (typeof name === 'string' && name.trim() !== '') return name;
  }
  return null;
}

/**
 * Per-model token usage for one Cursor chat, from its raw JSON messages.
 *
 * Each assistant message is one model call: its input is everything said
 * before it (cumulative, since the history is re-sent every turn) and its
 * output is its own text, reasoning included.
 *
 * Returns `[]` — "cannot price" — when no model is known or an assistant turn
 * cannot be attributed to one. A partial sum would be confidently too low.
 */
export function estimateCursorUsage(rawMessages: readonly string[]): TranscriptModelUsage[] {
  const byModel = new Map<string, TranscriptModelUsage>();
  let context = 0;
  let model: string | null = null;

  for (const raw of rawMessages) {
    let message: Record<string, unknown> | null;
    try {
      message = asRecord(JSON.parse(raw));
    } catch {
      continue; // A half-written blob during a live session is normal.
    }
    if (!message) continue;
    const tokens = estimateTokens(messageText(message['content']));

    if (message['role'] === 'assistant') {
      const named = modelNameOf(message['content']);
      model = named ? normalizeCursorModelId(named) : model;
      if (!model) return [];
      const usage = byModel.get(model) ?? {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reportedCostUsd: null,
      };
      usage.inputTokens += context;
      usage.outputTokens += tokens;
      byModel.set(model, usage);
    }
    context += tokens;
  }
  return [...byModel.values()];
}
