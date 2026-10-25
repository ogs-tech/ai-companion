import { describe, it, expect, vi } from 'vitest';
import { buildLaunchConfigHandlers } from '../../../src/main/ipc/launch-config-handlers.js';
import type { LaunchConfigService } from '../../../src/main/application/services/launch-config-service.js';
import type { TerminalService } from '../../../src/main/application/services/terminal-service.js';

const setup = () => {
  const configService = { list: vi.fn().mockResolvedValue(null) } as unknown as LaunchConfigService;
  const terminalService = {
    runLaunch: vi.fn().mockResolvedValue({ terminalId: 'x', workspaceId: 'ws-1', kind: 'launch', name: 'Run', relCwd: '', status: 'running', exitCode: null, generation: 0 }),
  } as unknown as TerminalService;
  return { configService, terminalService, handlers: buildLaunchConfigHandlers(configService, terminalService) };
};

describe('launch-config-handlers', () => {
  it('launchConfig.list delegates to LaunchConfigService.list', async () => {
    const { handlers, configService } = setup();
    await handlers['launchConfig.list']!({});
    expect(configService.list).toHaveBeenCalled();
  });

  it('launchConfig.run validates params and spawns a terminal through TerminalService', async () => {
    const { handlers, terminalService } = setup();
    await handlers['launchConfig.run']!({ configName: 'Run' });
    expect(terminalService.runLaunch).toHaveBeenCalledWith('Run');
  });

  it('launchConfig.run rejects missing params', async () => {
    const { handlers } = setup();
    await expect(handlers['launchConfig.run']!({})).rejects.toMatchObject({ kind: 'validation' });
    await expect(handlers['launchConfig.run']!({ configName: '' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('no longer exposes kill/status — those are terminal.* now', () => {
    const { handlers } = setup();
    expect(handlers['launchConfig.kill']).toBeUndefined();
    expect(handlers['launchConfig.status']).toBeUndefined();
  });
});
