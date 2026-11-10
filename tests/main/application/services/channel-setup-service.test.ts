import { describe, expect, it, vi } from 'vitest';
import { ChannelSetupService } from '../../../../src/main/application/services/channel-setup-service.js';
import { CHANNELS } from '../../../../src/shared/channel.js';
import type { ChannelProbePort, ProbeResult } from '../../../../src/main/application/ports/channel-probe-port.js';
import type { TerminalPort } from '../../../../src/main/application/ports/terminal-port.js';

const probeReturning = (byBin: (args: readonly string[]) => ProbeResult): ChannelProbePort => ({ run: async (_bin, args) => byBin(args) });

function setup(probe: ChannelProbePort) {
  let onData: (id: string, chunk: string) => void = () => undefined;
  let onExit: (id: string, code: number | null, signal: string | null) => void = () => undefined;
  const port: TerminalPort = {
    spawn: vi.fn(async () => undefined),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (l) => (onData = l),
    onExit: (l) => (onExit = l),
  };
  const openExternal = vi.fn(async () => undefined);
  const service = new ChannelSetupService(probe, port, { shell: '/bin/zsh', cwd: '/home/u', env: () => ({ PATH: '/bin' }), openExternal });
  return { service, port, openExternal, emitData: (id: string, c: string) => onData(id, c), emitExit: (id: string, code: number | null) => onExit(id, code, null) };
}

describe('ChannelSetupService.status', () => {
  it('reports not installed when the binary is missing', async () => {
    const { service } = setup(probeReturning(() => ({ found: false, exitCode: null, output: '' })));
    expect(await service.status('claude')).toEqual({ channelId: 'claude', installed: false, signedIn: false });
  });

  it('reports installed + signed out when the status output lacks the signed-in marker', async () => {
    const { service } = setup(probeReturning((args) => (args[0] === '--version' ? { found: true, exitCode: 0, output: '2.1.4 (Claude Code)\n' } : { found: true, exitCode: 0, output: '{"loggedIn": false}' })));
    expect(await service.status('claude')).toEqual({ channelId: 'claude', installed: true, version: '2.1.4 (Claude Code)', signedIn: false });
  });

  it('reports signed in when the marker is present', async () => {
    const { service } = setup(probeReturning((args) => (args[0] === '--version' ? { found: true, exitCode: 0, output: '1\n' } : { found: true, exitCode: 0, output: '{\n "loggedIn": true }' })));
    expect((await service.status('claude')).signedIn).toBe(true);
  });

  it('reports signedIn null for a channel without accounts', async () => {
    const { service } = setup(probeReturning(() => ({ found: true, exitCode: 0, output: '0.3.1' })));
    expect(await service.status('lmstudio')).toMatchObject({ installed: true, signedIn: null });
  });
});

describe('ChannelSetupService.start', () => {
  it('opens the vendor page for a download-style install, without a terminal', async () => {
    const { service, openExternal, port } = setup(probeReturning(() => ({ found: false, exitCode: null, output: '' })));
    const { setup: channelSetup } = CHANNELS.lmstudio;
    const original = channelSetup.install;
    (channelSetup as { install: unknown }).install = { kind: 'download', url: 'https://example.test/download' };
    try {
      expect(await service.start('lmstudio', 'install')).toEqual({ kind: 'opened', url: 'https://example.test/download' });
    } finally {
      (channelSetup as { install: unknown }).install = original;
    }
    expect(openExternal).toHaveBeenCalledWith('https://example.test/download');
    expect(port.spawn).not.toHaveBeenCalled();
  });

  it('runs the registry command in a login shell and buffers its output', async () => {
    const { service, port, emitData, emitExit } = setup(probeReturning(() => ({ found: false, exitCode: null, output: '' })));
    const started = await service.start('cursor', 'login');
    expect(started.kind).toBe('terminal');
    if (started.kind !== 'terminal') return;
    expect(port.spawn).toHaveBeenCalledWith(started.terminalId, expect.objectContaining({ command: '/bin/zsh', args: ['-lc', 'cursor-agent login'], cwd: '/home/u' }));
    emitData(started.terminalId, 'Open your browser');
    emitExit(started.terminalId, 0);
    expect(service.terminal(started.terminalId)).toMatchObject({ status: 'exited', exitCode: 0, outputBuffer: 'Open your browser' });
  });

  it('refuses a step the channel does not have', async () => {
    const { service } = setup(probeReturning(() => ({ found: false, exitCode: null, output: '' })));
    await expect(service.start('lmstudio', 'login')).rejects.toMatchObject({ kind: 'validation' });
  });

  it('kills a running terminal on close and forgets it', async () => {
    const { service, port } = setup(probeReturning(() => ({ found: false, exitCode: null, output: '' })));
    const started = await service.start('claude', 'install');
    if (started.kind !== 'terminal') throw new Error('expected a terminal');
    service.close(started.terminalId);
    expect(port.kill).toHaveBeenCalledWith(started.terminalId);
    expect(service.terminal(started.terminalId)).toBeNull();
  });
});
