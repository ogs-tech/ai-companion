import { describe, expect, it, vi } from 'vitest';
import { SessionNotifier } from '../../../../src/main/application/services/session-notifier.js';
import type { ExternalSession } from '../../../../src/shared/external-session.js';
import type { SessionSnapshot } from '../../../../src/shared/session.js';
import type { Settings } from '../../../../src/shared/settings.js';

const app = (activity: SessionSnapshot['activity'], over: Partial<SessionSnapshot> = {}): SessionSnapshot =>
  ({ sessionId: 'a', label: 'checkout', status: 'running', activity, activitySince: 0, ...over }) as SessionSnapshot;

function setup(settings: Partial<Settings['sessions']> = {}) {
  let sessions: SessionSnapshot[] = [];
  let external: ExternalSession[] = [];
  let focused: string | null = null;
  let clock = 0;
  const notify = vi.fn(async (_args: { title: string; body: string; onClick?: () => void }) => {});
  const setCount = vi.fn();
  const open = vi.fn();
  const notifier = new SessionNotifier({
    notification: { notify },
    badge: { setCount },
    settings: async () => ({ sessions: settings }) as Settings,
    appSessions: () => sessions,
    externalSessions: () => external,
    isFocused: (id) => id === focused,
    open,
    now: () => clock,
  });
  return {
    notifier, notify, setCount, open,
    set: (next: SessionSnapshot[]) => (sessions = next),
    setExternal: (next: ExternalSession[]) => (external = next),
    focus: (id: string | null) => (focused = id),
    at: (ms: number) => (clock = ms),
  };
}

describe('SessionNotifier', () => {
  it('notifies on Trabalhando → Pergunta and badges the count', async () => {
    const t = setup();
    t.set([app('working')]);
    await t.notifier.evaluate();
    t.set([app('needs-input')]);
    await t.notifier.evaluate();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ title: 'Sessão precisa de você', body: 'checkout' });
    expect(t.setCount).toHaveBeenLastCalledWith(1);
  });

  it('is silent for a session first seen already asking, and on an unchanged re-evaluation', async () => {
    const t = setup();
    t.set([app('needs-input')]);
    await t.notifier.evaluate();
    await t.notifier.evaluate();
    expect(t.notify).not.toHaveBeenCalled();
    expect(t.setCount).toHaveBeenLastCalledWith(1);
  });

  it('never notifies for a merely idle session', async () => {
    const t = setup();
    t.set([app('working')]);
    await t.notifier.evaluate();
    t.set([app('idle')]);
    await t.notifier.evaluate();
    expect(t.notify).not.toHaveBeenCalled();
    expect(t.setCount).toHaveBeenLastCalledWith(0);
  });

  it('silences the focused session, and respects notifyAsk=false', async () => {
    const focused = setup();
    focused.focus('a');
    focused.set([app('working')]);
    await focused.notifier.evaluate();
    focused.set([app('needs-input')]);
    await focused.notifier.evaluate();
    expect(focused.notify).not.toHaveBeenCalled();

    const off = setup({ notifyAsk: false });
    off.set([app('working')]);
    await off.notifier.evaluate();
    off.set([app('needs-input')]);
    await off.notifier.evaluate();
    expect(off.notify).not.toHaveBeenCalled();
  });

  it('includes external sessions by default and marks them in the body; excludes them when turned off', async () => {
    const ext = (activity: ExternalSession['activity']): ExternalSession =>
      ({ id: 'e', label: 'api', closed: false, activity, activitySince: 0 }) as ExternalSession;
    const t = setup();
    t.setExternal([ext('working')]);
    await t.notifier.evaluate();
    t.setExternal([ext('needs-input')]);
    await t.notifier.evaluate();
    expect(t.notify.mock.calls[0]?.[0]).toMatchObject({ body: 'api (externa)' });
    t.notify.mock.calls[0]?.[0].onClick?.();
    expect(t.open).toHaveBeenCalledWith({ id: 'e', external: true });

    const off = setup({ notifyExternal: false });
    off.setExternal([ext('needs-input')]);
    await off.notifier.evaluate();
    expect(off.setCount).toHaveBeenLastCalledWith(0);
  });

  it('long-turn notification is off by default and fires over 2 minutes when on', async () => {
    const on = setup({ notifyLongTurn: true });
    on.at(0);
    on.set([app('working', { activitySince: 0 })]);
    await on.notifier.evaluate();
    on.at(3 * 60_000);
    on.set([app('idle', { activitySince: 3 * 60_000 })]);
    await on.notifier.evaluate();
    expect(on.notify.mock.calls[0]?.[0]).toMatchObject({ title: 'Turno concluído' });

    const off = setup();
    off.set([app('working', { activitySince: 0 })]);
    await off.notifier.evaluate();
    off.at(3 * 60_000);
    off.set([app('idle')]);
    await off.notifier.evaluate();
    expect(off.notify).not.toHaveBeenCalled();
  });
});

describe('SessionNotifier metrics', () => {
  const withMetrics = (metrics: NonNullable<SessionSnapshot['metrics']>): SessionSnapshot => app('idle', { metrics });

  it('announces each cost band once, and stays quiet for a session first seen already past it', async () => {
    const t = setup({ notifyCost: true });
    t.set([withMetrics({ costUsd: 6 })]);
    await t.notifier.evaluate();
    expect(t.notify).not.toHaveBeenCalled();
    t.set([withMetrics({ costUsd: 11 })]);
    await t.notifier.evaluate();
    await t.notifier.evaluate();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]?.[0].title).toBe('Sessão passou de US$ 10');
  });

  it('cost notifications are off by default', async () => {
    const t = setup();
    t.set([withMetrics({ costUsd: 1 })]);
    await t.notifier.evaluate();
    t.set([withMetrics({ costUsd: 12 })]);
    await t.notifier.evaluate();
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('warns once when the context passes 90%, on by default', async () => {
    const t = setup();
    t.set([withMetrics({ contextTokens: 185_000, contextWindow: 200_000 })]);
    await t.notifier.evaluate();
    await t.notifier.evaluate();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0]?.[0].title).toBe('Contexto acima de 90%');
  });
});
