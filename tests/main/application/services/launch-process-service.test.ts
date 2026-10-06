import { describe, it, expect, vi } from 'vitest';
import { LaunchProcessService } from '../../../../src/main/application/services/launch-process-service.js';
import { FakeLaunchProcessPort } from '../../../../src/main/application/services/__fixtures__/fake-launch-process-port.js';
import type { LaunchConfigService } from '../../../../src/main/application/services/launch-config-service.js';
import type { LaunchConfig } from '../../../../src/shared/launch-config.js';

const nodeConfig: LaunchConfig = { name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true };

const setup = (options?: { maxBufferChars?: number }) => {
  const port = new FakeLaunchProcessPort();
  const launchConfigService = {
    getConfig: vi.fn().mockResolvedValue({ config: nodeConfig, projectPath: '/repos/acme' }),
  } as unknown as LaunchConfigService;
  const service = new LaunchProcessService(launchConfigService, port, options);
  return { service, port, launchConfigService };
};

describe('LaunchProcessService', () => {
  it('run resolves the command and spawns it via the port, returning a running snapshot', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    expect(snapshot).toMatchObject({ projectId: 'p1', configName: 'Run', status: 'running', exitCode: null });
    expect(port.spawnCalls).toEqual([{ processId: snapshot.processId, opts: { command: 'node', args: ['index.js'], cwd: '/repos/acme' } }]);
  });

  it('run throws a typed io error when the port fails to spawn, and forgets the process', async () => {
    const { service, port } = setup();
    port.failNextSpawn(new Error('ENOENT'));
    await expect(service.run('p1', 'Run')).rejects.toMatchObject({ kind: 'io' });
    expect(service.list()).toEqual([]);
  });

  it('run throws UnsupportedLaunchTypeError for an unsupported config, never calling the port', async () => {
    const { service, port, launchConfigService } = setup();
    (launchConfigService.getConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      config: { ...nodeConfig, type: 'chrome', supported: false },
      projectPath: '/repos/acme',
    });
    await expect(service.run('p1', 'Run')).rejects.toThrow();
    expect(port.spawnCalls).toEqual([]);
  });

  it('appends streamed output to a capped scrollback buffer, replayed via status', async () => {
    const { service, port } = setup({ maxBufferChars: 10 });
    const snapshot = await service.run('p1', 'Run');
    port.simulateOutput(snapshot.processId, 'stdout', '0123456789');
    port.simulateOutput(snapshot.processId, 'stdout', 'abcde');
    expect(service.status(snapshot.processId)?.outputBuffer).toBe('56789abcde');
  });

  it('fans output out to every onOutput listener, tagged with stream', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    const events: unknown[] = [];
    service.onOutput((event) => events.push(event));
    port.simulateOutput(snapshot.processId, 'stderr', 'oops');
    expect(events).toEqual([{ processId: snapshot.processId, stream: 'stderr', chunk: 'oops' }]);
  });

  it('marks a process exited and fans the exit out once the port reports it', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    const exits: unknown[] = [];
    service.onExit((event) => exits.push(event));
    port.simulateExit(snapshot.processId, 0, null);
    expect(service.status(snapshot.processId)).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(exits).toEqual([{ processId: snapshot.processId, exitCode: 0, signal: null }]);
  });

  it('kill stops a running process immediately and is a no-op for an unknown or already-exited one', async () => {
    const { service, port } = setup();
    const snapshot = await service.run('p1', 'Run');
    service.kill(snapshot.processId);
    expect(port.killed).toEqual([{ processId: snapshot.processId }]);
    expect(service.status(snapshot.processId)?.status).toBe('exited');
    service.kill(snapshot.processId);
    service.kill('unknown-id');
    expect(port.killed).toEqual([{ processId: snapshot.processId }]);
  });

  it('killAll stops every still-running process and leaves exited ones alone', async () => {
    const { service, port } = setup();
    const a = await service.run('p1', 'Run');
    const b = await service.run('p1', 'Run');
    port.simulateExit(b.processId, 0, null);
    service.killAll();
    expect(port.killed).toEqual([{ processId: a.processId }]);
  });

  it('list returns every process, running and exited alike', async () => {
    const { service } = setup();
    const a = await service.run('p1', 'Run');
    expect(service.list().map((p) => p.processId)).toEqual([a.processId]);
  });
});
