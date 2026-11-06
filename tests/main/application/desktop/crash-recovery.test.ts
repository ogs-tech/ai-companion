import { describe, expect, it, vi } from 'vitest';
import {
  CrashRecovery,
  RELOAD_COOLDOWN_MS,
  UNRESPONSIVE_GRACE_MS,
  type CrashChoice,
} from '../../../../src/main/application/desktop/crash-recovery.js';

function setup(choice: CrashChoice = 'reload') {
  let time = 1_000_000;
  const timers: Array<{ cb: () => void; ms: number; cleared: boolean }> = [];
  const deps = {
    now: () => time,
    log: vi.fn(),
    reload: vi.fn(),
    askUser: vi.fn(async () => choice),
    quit: vi.fn(),
    setTimer: (cb: () => void, ms: number) => {
      const timer = { cb, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return { recovery: new CrashRecovery(deps), deps, timers, advance: (ms: number) => (time += ms) };
}

describe('CrashRecovery', () => {
  it('logs and reloads on the first crash, then hands the details over once', () => {
    const { recovery, deps } = setup();
    recovery.onGone('crashed (exit code 133)');
    expect(deps.log).toHaveBeenCalled();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(recovery.takeRecovery()).toContain('crashed');
    expect(recovery.takeRecovery()).toBeNull();
  });

  it('asks the user instead of reloading again inside the cooldown', async () => {
    const { recovery, deps, advance } = setup('quit');
    recovery.onGone('first');
    advance(RELOAD_COOLDOWN_MS - 1);
    recovery.onGone('second');
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.askUser).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.quit).toHaveBeenCalled();
  });

  it('reloads automatically again once the cooldown passed', () => {
    const { recovery, deps, advance } = setup();
    recovery.onGone('first');
    advance(RELOAD_COOLDOWN_MS);
    recovery.onGone('second');
    expect(deps.reload).toHaveBeenCalledTimes(2);
    expect(deps.askUser).not.toHaveBeenCalled();
  });

  it('reloads after the user picks Reload in the dialog', async () => {
    const { recovery, deps } = setup('reload');
    recovery.onGone('first');
    recovery.onGone('second');
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.reload).toHaveBeenCalledTimes(2);
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('waits a grace period before acting on an unresponsive renderer', () => {
    const { recovery, deps, timers } = setup();
    recovery.onUnresponsive();
    expect(deps.reload).not.toHaveBeenCalled();
    expect(timers[0]?.ms).toBe(UNRESPONSIVE_GRACE_MS);
    timers[0]?.cb();
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending action when the renderer becomes responsive again', () => {
    const { recovery, timers } = setup();
    recovery.onUnresponsive();
    recovery.onResponsive();
    expect(timers[0]?.cleared).toBe(true);
  });
});
