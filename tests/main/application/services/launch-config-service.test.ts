import { describe, it, expect, vi } from 'vitest';
import { LaunchConfigService } from '../../../../src/main/application/services/launch-config-service.js';
import type { LaunchConfigReaderPort } from '../../../../src/main/application/ports/launch-config-reader-port.js';

const WORKSPACE = { id: 'ws-1', rootPath: '/repos/acme' };
const runConfig = { name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true };

describe('LaunchConfigService', () => {
  it("list reads the open workspace root's launch.json", async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs: [runConfig] }) };
    const service = new LaunchConfigService(WORKSPACE, reader);
    const result = await service.list();
    expect(reader.read).toHaveBeenCalledWith('/repos/acme');
    expect(result).toEqual({ workspaceId: 'ws-1', configs: [runConfig] });
  });

  it('list surfaces a reader error without configs', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const service = new LaunchConfigService(WORKSPACE, reader);
    expect(await service.list()).toEqual({ workspaceId: 'ws-1', configs: [], error: 'malformed launch.json' });
  });

  it('list returns null at Início (no workspace open) without reading anything', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn() };
    const service = new LaunchConfigService(null, reader);
    expect(await service.list()).toBeNull();
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('getConfig finds a config by name and returns it with the workspace root', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs: [runConfig] }) };
    const service = new LaunchConfigService(WORKSPACE, reader);
    expect(await service.getConfig('Run')).toEqual({ config: runConfig, workspaceId: 'ws-1', rootPath: '/repos/acme' });
  });

  it('getConfig throws not_found for an unknown config name', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs: [] }) };
    const service = new LaunchConfigService(WORKSPACE, reader);
    await expect(service.getConfig('Missing')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('getConfig throws io when launch.json is malformed', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const service = new LaunchConfigService(WORKSPACE, reader);
    await expect(service.getConfig('Run')).rejects.toMatchObject({ kind: 'io' });
  });

  it('getConfig throws validation at Início', async () => {
    const service = new LaunchConfigService(null, { read: vi.fn() });
    await expect(service.getConfig('Run')).rejects.toMatchObject({ kind: 'validation' });
  });
});
