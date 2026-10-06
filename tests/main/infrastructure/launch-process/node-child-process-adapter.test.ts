import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodeChildProcessAdapter } from '../../../../src/main/infrastructure/launch-process/node-child-process-adapter.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string): string => path.join(fixturesDir, name);

describe('NodeChildProcessAdapter', () => {
  it('spawns a process, relays stdout/stderr on separate streams, and reports its exit code', async () => {
    const adapter = new NodeChildProcessAdapter();
    const outputs: Array<[string, 'stdout' | 'stderr', string]> = [];
    const exits: Array<[string, number | null, NodeJS.Signals | null]> = [];
    adapter.onOutput((processId, stream, chunk) => outputs.push([processId, stream, chunk]));
    adapter.onExit((processId, exitCode, signal) => exits.push([processId, exitCode, signal]));

    await adapter.spawn('proc-1', { command: fixture('print-and-exit.sh'), args: [], cwd: process.cwd() });

    await vi.waitFor(() => {
      expect(exits).toEqual([['proc-1', 3, null]]);
    });
    expect(outputs).toContainEqual(['proc-1', 'stdout', 'out:hello\n']);
    expect(outputs).toContainEqual(['proc-1', 'stderr', 'err:oops\n']);
  });

  it('passes cwd and merged env through to the spawned process', async () => {
    const adapter = new NodeChildProcessAdapter();
    const outputs: string[] = [];
    adapter.onOutput((_processId, _stream, chunk) => outputs.push(chunk));
    await adapter.spawn('proc-2', {
      command: fixture('print-env-and-cwd.sh'),
      args: [],
      cwd: process.cwd(),
      env: { LAUNCH_TEST_VAR: 'custom-value' },
    });
    await vi.waitFor(() => {
      expect(outputs.join('')).toContain('LAUNCH_TEST_VAR=custom-value');
    });
    expect(outputs.join('')).toContain(`CWD=${process.cwd()}`);
  });

  it('kill on an unknown processId is a no-op', () => {
    const adapter = new NodeChildProcessAdapter();
    expect(() => adapter.kill('nope')).not.toThrow();
  });

  it('kill terminates a running process, which then reports its exit via the exit listener', async () => {
    const adapter = new NodeChildProcessAdapter();
    const exits: Array<[string, number | null, NodeJS.Signals | null]> = [];
    adapter.onExit((processId, exitCode, signal) => exits.push([processId, exitCode, signal]));
    await adapter.spawn('proc-3', { command: fixture('sleep-forever.sh'), args: [], cwd: process.cwd() });
    adapter.kill('proc-3');
    await vi.waitFor(() => {
      expect(exits).toEqual([['proc-3', null, 'SIGTERM']]);
    });
  });

  it('spawn rejects when the binary does not exist', async () => {
    const adapter = new NodeChildProcessAdapter();
    await expect(
      adapter.spawn('proc-4', { command: '/definitely/not/a/real/binary-xyz', args: [], cwd: process.cwd() }),
    ).rejects.toThrow();
  });
});
