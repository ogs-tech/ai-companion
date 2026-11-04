const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "5 min", "2 h", "ontem", "3 d", then a short date — how long ago an ISO timestamp was. `''` when absent or invalid. */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (iso === undefined) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'agora';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'ontem';
  if (days < 30) return `${days} d`;
  return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
