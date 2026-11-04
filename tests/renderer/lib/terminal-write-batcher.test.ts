import { describe, expect, it, vi } from 'vitest';
import { createTerminalWriteBatcher } from '../../../src/renderer/lib/terminal-write-batcher.js';

function setup() {
  const write = vi.fn();
  let queued: (() => void) | null = null;
  const unschedule = vi.fn(() => {
    queued = null;
  });
  const batcher = createTerminalWriteBatcher(
    write,
    (cb) => {
      queued = cb;
      return 1;
    },
    unschedule,
  );
  return { write, batcher, runFrame: () => queued?.(), unschedule };
}

describe('createTerminalWriteBatcher', () => {
  it('coalesces chunks pushed within a frame into one ordered write', () => {
    const { write, batcher, runFrame } = setup();
    batcher.push('a');
    batcher.push('b');
    batcher.push('c');
    expect(write).not.toHaveBeenCalled();
    runFrame();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('abc');
  });

  it('schedules a new frame after a flush', () => {
    const { write, batcher, runFrame } = setup();
    batcher.push('a');
    runFrame();
    batcher.push('b');
    runFrame();
    expect(write.mock.calls).toEqual([['a'], ['b']]);
  });

  it('flush writes pending data immediately and cancels the frame', () => {
    const { write, batcher, unschedule } = setup();
    batcher.push('x');
    batcher.flush();
    expect(write).toHaveBeenCalledWith('x');
    expect(unschedule).toHaveBeenCalled();
  });

  it('cancel discards pending data', () => {
    const { write, batcher, runFrame } = setup();
    batcher.push('x');
    batcher.cancel();
    runFrame();
    expect(write).not.toHaveBeenCalled();
  });
});
