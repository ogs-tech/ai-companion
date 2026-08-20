import { useEffect, useRef } from 'react';
import { callIpc } from '../lib/ipc.js';
import type { HealthReport } from '../../shared/health.js';
import { productLabel } from '../../shared/brand.js';

/**
 * Fires an OS notification (via health.notify) only when a NEW error id appears
 * while the app is open. The first report primes the seen-set WITHOUT notifying,
 * so pre-existing errors at launch don't spam the user.
 */
export function useHealthNotifications(report: HealthReport | undefined): void {
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (!report) return;

    const errorIds = report.checks.filter((c) => c.severity === 'error').map((c) => c.id);

    if (!primed.current) {
      seen.current = new Set(errorIds);
      primed.current = true;
      return;
    }

    const fresh = errorIds.filter((id) => !seen.current.has(id));
    for (const id of errorIds) seen.current.add(id);
    if (fresh.length === 0) return;

    const first = report.checks.find((c) => c.id === fresh[0]);
    const body =
      fresh.length === 1 && first
        ? `${first.title} (${first.id})`
        : `${fresh.length} new problems detected: ${fresh.join(', ')}`;

    void callIpc('health.notify', {
      title: productLabel('a problem was detected'),
      body,
    });
  }, [report]);
}
