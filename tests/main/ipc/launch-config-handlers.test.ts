import { describe, it, expect, vi } from 'vitest';
import { buildLaunchConfigHandlers } from '../../../src/main/ipc/launch-config-handlers.js';
import type { LaunchConfigService } from '../../../src/main/application/services/launch-config-service.js';
import type { LaunchProcessService } from '../../../src/main/application/services/launch-process-service.js';

const setup = () => {
  const configService = { listAll: vi.fn().mockResolvedValue([]) } as unknown as LaunchConfigService;
  const processService = {
    run: vi.fn().mockResolvedValue({ processId: 'x', projectId: 'p1', configName: 'Run', status: 'running', exitCode: null }),
    kill: vi.fn(),
    status: vi.fn().mockReturnValue(undefined),
  } as unknown as LaunchProcessService;
  return { configService, processService, handlers: buildLaunchConfigHandlers(configService, processService) };
};

describe('launch-config-handlers', () => {
  it('launchConfig.list delegates to LaunchConfigService.listAll', async () => {
    const { handlers, configService } = setup();
    await handlers['launchConfig.list']!({});
    expect(configService.listAll).toHaveBeenCalled();
  });

  it('launchConfig.run validates params and delegates to LaunchProcessService.run', async () => {
    const { handlers, processService } = setup();
    await handlers['launchConfig.run']!({ projectId: 'p1', configName: 'Run' });
    expect(processService.run).toHaveBeenCalledWith('p1', 'Run');
  });

  it('launchConfig.run rejects missing params', async () => {
    const { handlers } = setup();
    await expect(handlers['launchConfig.run']!({})).rejects.toMatchObject({ kind: 'validation' });
    await expect(handlers['launchConfig.run']!({ projectId: 'p1' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('launchConfig.kill validates params and delegates to LaunchProcessService.kill', async () => {
    const { handlers, processService } = setup();
    await handlers['launchConfig.kill']!({ processId: 'x' });
    expect(processService.kill).toHaveBeenCalledWith('x');
  });

  it('launchConfig.status returns null for an unknown processId', async () => {
    const { handlers } = setup();
    const result = await handlers['launchConfig.status']!({ processId: 'nope' });
    expect(result).toBeNull();
  });
});
