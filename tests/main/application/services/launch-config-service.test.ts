import { describe, it, expect, vi } from 'vitest';
import { LaunchConfigService } from '../../../../src/main/application/services/launch-config-service.js';
import type { LaunchConfigReaderPort } from '../../../../src/main/application/ports/launch-config-reader-port.js';
import type { Project } from '../../../../src/shared/project.js';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '', ...overrides,
});

describe('LaunchConfigService', () => {
  it('listForProject resolves the project path and returns its configs', async () => {
    const reader: LaunchConfigReaderPort = {
      read: vi.fn().mockResolvedValue({ configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }] }),
    };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listForProject('p1');
    expect(reader.read).toHaveBeenCalledWith('/repos/acme');
    expect(result).toEqual({
      projectId: 'p1',
      configs: [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }],
    });
  });

  it('listForProject surfaces a reader error without configs, keyed to the project', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listForProject('p1');
    expect(result).toEqual({ projectId: 'p1', configs: [], error: 'malformed launch.json' });
  });

  it("listAll isolates one project's malformed launch.json from the others", async () => {
    const projects = [project({ id: 'p1', path: '/repos/a' }), project({ id: 'p2', path: '/repos/b' })];
    const reader: LaunchConfigReaderPort = {
      read: vi.fn().mockImplementation(async (path: string) =>
        path === '/repos/a' ? { error: 'malformed launch.json' } : { configs: [] },
      ),
    };
    const projectService = { get: vi.fn(), list: vi.fn().mockResolvedValue(projects) };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.listAll();
    expect(result).toEqual([
      { projectId: 'p1', configs: [], error: 'malformed launch.json' },
      { projectId: 'p2', configs: [] },
    ]);
  });

  it('getConfig finds a config by name and returns it with the project path', async () => {
    const configs = [{ name: 'Run', type: 'node', request: 'launch', program: 'index.js', args: [], supported: true }];
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    const result = await service.getConfig('p1', 'Run');
    expect(result).toEqual({ config: configs[0], projectPath: '/repos/acme' });
  });

  it('getConfig throws not_found for an unknown config name', async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ configs: [] }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    await expect(service.getConfig('p1', 'Missing')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it("getConfig throws io when the project's launch.json is malformed", async () => {
    const reader: LaunchConfigReaderPort = { read: vi.fn().mockResolvedValue({ error: 'malformed launch.json' }) };
    const projectService = { get: vi.fn().mockResolvedValue(project()), list: vi.fn() };
    const service = new LaunchConfigService(projectService, reader);
    await expect(service.getConfig('p1', 'Run')).rejects.toMatchObject({ kind: 'io' });
  });
});
