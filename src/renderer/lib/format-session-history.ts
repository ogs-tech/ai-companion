import type { CostSource } from '../../shared/session-history.js';

/**
 * A cost, in the width it will hold at in a right-aligned mono column.
 *
 * Sub-cent spend rounds to `$0.00` rather than disappearing, because a row
 * that shows nothing reads as "unknown", which is a different fact — and one
 * this app reserves for `—`.
 */
export function formatCostUsd(costUsd: number | null): string {
  if (costUsd === null) return '—';
  return `$${costUsd.toFixed(2)}`;
}

/** Spells out what a cost figure actually is, for the row's title attribute. */
export function describeCostSource(source: CostSource): string {
  if (source === 'reported') return 'Custo informado pelo próprio claude';
  if (source === 'estimated') return 'Custo estimado a partir dos tokens';
  return 'Modelo sem preço publicado — não dá para estimar';
}

/** Compact wall-clock length: `4s`, `3min`, `1h12`. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) return '—';
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${`${minutes % 60}`.padStart(2, '0')}`;
}

/**
 * When it happened, at the resolution that is actually useful: a clock time
 * today, a weekday this week, a date before that.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const daysAgo = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (daysAgo >= 0 && daysAgo < 7) {
    return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Drops the parts of a model id that are noise in a 260px column — the vendor
 * prefix, the release date, the context-window suffix — leaving what actually
 * distinguishes one row's model from another's.
 */
export function formatModel(model: string | null): string {
  if (!model) return '—';
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/\[(\w+)\]$/, ' $1');
}

/** Token counts at a glance: `1.2k`, `4.5M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** `YYYY-MM-DD` → `10/09`, for a chart axis that has no room for a year. */
export function formatDayShort(day: string): string {
  const [, month, date] = day.split('-');
  return month && date ? `${date}/${month}` : day;
}
