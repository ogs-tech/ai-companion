import { describe, expect, it, vi } from 'vitest';
import { QuitCoordinator } from '../../../../src/main/application/desktop/quit-coordinator.js';

function setup(deliver = true) {
  let timerCallback: (() => void) | null = null;
  const sent: string[] = [];
  let n = 0;
  const clearTimer = vi.fn(() => {
    timerCallback = null;
  });
  const coordinator = new QuitCoordinator({
    send: (id) => {
      sent.push(id);
      return deliver;
    },
    newId: () => `req-${++n}`,
    setTimer: (cb) => {
      timerCallback = cb;
      return 'timer';
    },
    clearTimer,
    timeoutMs: 3000,
  });
  return { coordinator, sent, clearTimer, fire: () => timerCallback?.() };
}

describe('QuitCoordinator', () => {
  it('resolves true when the renderer says proceed', async () => {
    const { coordinator, sent, clearTimer } = setup();
    const result = coordinator.request();
    coordinator.respond(sent[0]!, true);
    await expect(result).resolves.toBe(true);
    expect(clearTimer).toHaveBeenCalled();
  });

  it('resolves false when the renderer cancels', async () => {
    const { coordinator, sent } = setup();
    const result = coordinator.request();
    coordinator.respond(sent[0]!, false);
    await expect(result).resolves.toBe(false);
  });

  it('proceeds without asking when the renderer cannot be reached', async () => {
    const { coordinator } = setup(false);
    await expect(coordinator.request()).resolves.toBe(true);
  });

  it('proceeds when the renderer does not answer in time', async () => {
    const { coordinator, fire } = setup();
    const result = coordinator.request();
    fire();
    await expect(result).resolves.toBe(true);
  });

  it('proceeds when sending throws', async () => {
    const coordinator = new QuitCoordinator({
      send: () => {
        throw new Error('destroyed');
      },
      newId: () => 'x',
      setTimer: () => 't',
      clearTimer: () => undefined,
    });
    await expect(coordinator.request()).resolves.toBe(true);
  });

  it('ignores answers for an unknown or stale request id', async () => {
    const { coordinator, sent } = setup();
    const result = coordinator.request();
    coordinator.respond('other', false);
    coordinator.respond(sent[0]!, true);
    await expect(result).resolves.toBe(true);
    coordinator.respond(sent[0]!, false); // late duplicate: no effect, no throw
  });

  it('shares one question between concurrent requests', async () => {
    const { coordinator, sent } = setup();
    const a = coordinator.request();
    const b = coordinator.request();
    expect(sent).toHaveLength(1);
    coordinator.respond(sent[0]!, true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  it('asks again after the previous question settled', async () => {
    const { coordinator, sent } = setup();
    const first = coordinator.request();
    coordinator.respond(sent[0]!, false);
    await first;
    void coordinator.request();
    expect(sent).toEqual(['req-1', 'req-2']);
  });
});
