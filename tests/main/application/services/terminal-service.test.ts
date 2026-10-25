import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalService } from '../../../../src/main/application/services/terminal-service.js';
import { FakeTerminalPort } from '../../../../src/main/application/services/__fixtures__/fake-terminal-port.js';
import type { LaunchConfig } from '../../../../src/shared/launch-config.js';

const ROOT = '/work/acme';
const WORKSPACE = { id: 'w1', rootPath: ROOT };

const nodeConfig: LaunchConfig = {
  name: 'Run server', type: 'node', request: 'launch', program: '${workspaceFolder}/server.js', args: ['--port', '3000'],
  env: { A: '1' }, supported: true,
};

function setup(options?: { maxBufferChars?: number; workspace?: typeof WORKSPACE | null }) {
  const port = new FakeTerminalPort();
  const launch = {
    getConfig: async (name: string) => {
      if (name !== nodeConfig.name) throw new Error('not found');
      return { config: nodeConfig, workspaceId: 'w1', rootPath: ROOT };
    },
  };
  const service = new TerminalService(
    options?.workspace === undefined ? WORKSPACE : options.workspace,
    launch,
    port,
    { shell: '/bin/zsh', ...(options?.maxBufferChars !== undefined ? { maxBufferChars: options.maxBufferChars } : {}) },
  );
  return { port, service };
}

describe('TerminalService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  describe('createShell', () => {
    it('starts the login shell at the workspace root, named after the shell', async () => {
      const snap = await ctx.service.createShell();
      expect(snap).toMatchObject({ kind: 'shell', name: 'zsh', relCwd: '', status: 'running', exitCode: null, workspaceId: 'w1', generation: 0 });
      expect(ctx.port.spawnCalls[0]?.opts).toMatchObject({ command: '/bin/zsh', cwd: ROOT });
    });

    it('starts it in a workspace subfolder and reports the relative cwd', async () => {
      const snap = await ctx.service.createShell('apps/console');
      expect(snap.relCwd).toBe('apps/console');
      expect(ctx.port.spawnCalls[0]?.opts.cwd).toBe('/work/acme/apps/console');
    });

    it.each(['../outside', '/etc', 'apps/../../outside'])('refuses a folder outside the workspace: %s', async (rel) => {
      await expect(ctx.service.createShell(rel)).rejects.toMatchObject({ kind: 'validation' });
      expect(ctx.port.spawnCalls).toHaveLength(0);
    });

    it('fails validation at Início', async () => {
      const { service } = setup({ workspace: null });
      await expect(service.createShell()).rejects.toMatchObject({ kind: 'validation' });
      expect(() => service.list()).toThrowError(/No workspace is open/);
    });

    it('surfaces a spawn failure as io and keeps no row', async () => {
      ctx.port.failNextSpawn(new Error('posix_spawnp failed'));
      await expect(ctx.service.createShell()).rejects.toMatchObject({ kind: 'io' });
      expect(ctx.service.list()).toEqual([]);
    });
  });

  describe('runLaunch', () => {
    it('runs the resolved command directly (no shell) in a launch terminal named after the configuration', async () => {
      const snap = await ctx.service.runLaunch('Run server');
      expect(snap).toMatchObject({ kind: 'launch', name: 'Run server', relCwd: '', status: 'running' });
      expect(ctx.port.spawnCalls[0]?.opts).toMatchObject({
        command: 'node', args: ['/work/acme/server.js', '--port', '3000'], cwd: ROOT, env: { A: '1' },
      });
    });

    it('two runs of the same configuration are two independent terminals', async () => {
      const a = await ctx.service.runLaunch('Run server');
      const b = await ctx.service.runLaunch('Run server');
      expect(a.terminalId).not.toBe(b.terminalId);
      expect(ctx.service.list()).toHaveLength(2);
    });
  });

  describe('output and scrollback', () => {
    it('forwards output to listeners and replays it through status', async () => {
      const snap = await ctx.service.createShell();
      const seen: string[] = [];
      ctx.service.onOutput((e) => seen.push(`${e.terminalId}:${e.chunk}`));
      ctx.port.simulateOutput(snap.terminalId, 'hello ');
      ctx.port.simulateOutput(snap.terminalId, 'world');
      expect(seen).toEqual([`${snap.terminalId}:hello `, `${snap.terminalId}:world`]);
      expect(ctx.service.status(snap.terminalId)?.outputBuffer).toBe('hello world');
    });

    it('trims the scrollback from the head past the cap', async () => {
      const { service, port } = setup({ maxBufferChars: 5 });
      const snap = await service.createShell();
      port.simulateOutput(snap.terminalId, 'abcdef');
      port.simulateOutput(snap.terminalId, 'gh');
      expect(service.status(snap.terminalId)?.outputBuffer).toBe('defgh');
    });

    it('keeps list() free of the buffer', async () => {
      const snap = await ctx.service.createShell();
      ctx.port.simulateOutput(snap.terminalId, 'x');
      expect(ctx.service.list()[0]).not.toHaveProperty('outputBuffer');
    });
  });

  describe('lifecycle', () => {
    it('records the exit code and notifies listeners', async () => {
      const snap = await ctx.service.createShell();
      const exits: unknown[] = [];
      ctx.service.onExit((e) => exits.push(e));
      ctx.port.simulateExit(snap.terminalId, 2, 'SIGTERM');
      expect(ctx.service.list()[0]).toMatchObject({ status: 'exited', exitCode: 2 });
      expect(exits).toEqual([{ terminalId: snap.terminalId, exitCode: 2, signal: 'SIGTERM' }]);
    });

    it('kill only signals a running terminal and leaves the row until the process really exits', async () => {
      const snap = await ctx.service.createShell();
      ctx.service.kill(snap.terminalId);
      expect(ctx.port.killed).toEqual([snap.terminalId]);
      expect(ctx.service.list()[0]?.status).toBe('running');
      ctx.port.simulateExit(snap.terminalId, 0);
      ctx.service.kill(snap.terminalId);
      expect(ctx.port.killed).toHaveLength(1);
    });

    it('forwards write and resize to the port', async () => {
      const snap = await ctx.service.createShell();
      ctx.service.write(snap.terminalId, 'ls\r');
      ctx.service.resize(snap.terminalId, 100, 30);
      expect(ctx.port.writes).toEqual([{ terminalId: snap.terminalId, data: 'ls\r' }]);
      expect(ctx.port.resizes).toEqual([{ terminalId: snap.terminalId, cols: 100, rows: 30 }]);
    });

    it('restart re-runs the same command in the same row with a clean buffer and a bumped generation', async () => {
      const snap = await ctx.service.runLaunch('Run server');
      ctx.port.simulateOutput(snap.terminalId, 'old');
      ctx.port.simulateExit(snap.terminalId, 1);
      const restarted = await ctx.service.restart(snap.terminalId);
      expect(restarted).toMatchObject({ terminalId: snap.terminalId, name: 'Run server', status: 'running', exitCode: null, generation: 1 });
      expect(ctx.port.spawnCalls[1]?.opts).toMatchObject(ctx.port.spawnCalls[0]!.opts);
      expect(ctx.service.status(snap.terminalId)?.outputBuffer).toBe('');
      expect(ctx.service.list()).toHaveLength(1);
    });

    it('restart refuses a running terminal and an unknown one', async () => {
      const snap = await ctx.service.createShell();
      await expect(ctx.service.restart(snap.terminalId)).rejects.toMatchObject({ kind: 'validation' });
      await expect(ctx.service.restart('nope')).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('a failed restart leaves the row exited', async () => {
      const snap = await ctx.service.createShell();
      ctx.port.simulateExit(snap.terminalId, 0);
      ctx.port.failNextSpawn(new Error('boom'));
      await expect(ctx.service.restart(snap.terminalId)).rejects.toMatchObject({ kind: 'io' });
      expect(ctx.service.list()[0]?.status).toBe('exited');
    });

    it('remove drops only exited terminals', async () => {
      const snap = await ctx.service.createShell();
      expect(() => ctx.service.remove(snap.terminalId)).toThrowError(/still running/);
      ctx.port.simulateExit(snap.terminalId, 0);
      ctx.service.remove(snap.terminalId);
      expect(ctx.service.list()).toEqual([]);
    });

    it('killAll stops every running terminal and skips exited ones', async () => {
      const a = await ctx.service.createShell();
      const b = await ctx.service.createShell();
      ctx.port.simulateExit(b.terminalId, 0);
      ctx.service.killAll();
      expect(ctx.port.killed).toEqual([a.terminalId]);
    });
  });
});
