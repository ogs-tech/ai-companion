import type { HistoryFilters } from '../../shared/session-history.js';

export type PeriodId = '7' | '30' | '90' | 'all' | 'custom';

export const PERIODS: { id: Exclude<PeriodId, 'custom'>; label: string }[] = [
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: '90', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

/** The tab always opens on the last 30 days; `Tudo` is one click away. */
export const DEFAULT_PERIOD: PeriodId = '30';

function toLocalDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Date-time without a zone: `new Date('YYYY-MM-DD')` would parse as UTC and
// shift the day for anyone west of Greenwich.
const dayStart = (day: string): string => `${day}T00:00:00.000`;
const dayEnd = (day: string): string => `${day}T23:59:59.999`;

/** The `from`/`to` bounds (inclusive local days) a period selects; empty means unbounded. */
export function periodRange(
  period: PeriodId,
  today: Date,
  customFrom: string,
  customTo: string,
): Pick<HistoryFilters, 'from' | 'to'> {
  if (period === 'all') return {};
  if (period === 'custom') {
    return {
      ...(customFrom ? { from: dayStart(customFrom) } : {}),
      ...(customTo ? { to: dayEnd(customTo) } : {}),
    };
  }
  const start = new Date(today);
  start.setDate(start.getDate() - (Number(period) - 1));
  return { from: dayStart(toLocalDay(start)), to: dayEnd(toLocalDay(today)) };
}

/** What the right panel lists, so its count matches the tab it opens. */
export function defaultHistoryFilters(today: Date): HistoryFilters {
  return periodRange(DEFAULT_PERIOD, today, '', '');
}
