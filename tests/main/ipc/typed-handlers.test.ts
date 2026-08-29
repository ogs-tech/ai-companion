import { describe, it, expect, vi } from 'vitest';
import { buildSkillHandlers } from '../../../src/main/ipc/skill-handlers.js';
import { buildAgentHandlers } from '../../../src/main/ipc/agent-handlers.js';
import { buildInstructionHandlers } from '../../../src/main/ipc/instruction-handlers.js';
import { buildMarketplaceHandlers } from '../../../src/main/ipc/marketplace-handlers.js';
import { SkillService } from '../../../src/main/application/services/skill-service.js';
import { AgentService } from '../../../src/main/application/services/agent-service.js';
import { InstructionService } from '../../../src/main/application/services/instruction-service.js';
import { EntityService } from '../../../src/main/application/services/entity-service.js';
import { InMemoryEntityRepository } from '../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { FixedClock } from '../../../src/main/infrastructure/clock/fixed-clock.js';
import type { AdapterManager } from '../../../src/main/application/services/adapter-manager.js';
import type { MarketplaceService } from '../../../src/main/application/services/marketplace-service.js';
import { WORKSPACE_SOURCE, type Skill, type Agent, type Instruction } from '../../../src/shared/entity.js';
import { buildWorkspaceHandlers } from '../../../src/main/ipc/workspace-handlers.js';
import { FileBrowserService } from '../../../src/main/application/services/file-browser-service.js';
import { WorkspaceService } from '../../../src/main/application/services/workspace-service.js';
import { InMemoryWorkspaceRegistry } from '../../../src/main/infrastructure/workspace/in-memory-workspace-registry.js';
import type { Workspace } from '../../../src/shared/workspace.js';
import { buildProjectHandlers } from '../../../src/main/ipc/project-handlers.js';
import { ProjectService } from '../../../src/main/application/services/project-service.js';
import { InMemoryProjectRegistry } from '../../../src/main/infrastructure/project/in-memory-project-registry.js';

const skill = (name = 'foo'): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill',
  name,
  description: 'd',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: 'b',
});

const setupSkillService = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return new SkillService(base);
};

const agent = (name = 'reviewer'): Agent => ({
  urn: `urn:agent:${name}`,
  kind: 'agent',
  name,
  description: 'd',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  systemPrompt: 'You review.',
});

const setupAgentService = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return new AgentService(base);
};

const instruction = (): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: '',
  scopes: ['personal'],
  metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE,
  content: '# Instructions\n',
});

const setupInstructionService = () => {
  const repo = new InMemoryEntityRepository();
  const adapterManager = {
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  } as unknown as AdapterManager;
  const base = new EntityService(repo, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), adapterManager);
  return new InstructionService(base, { findOrCreateByPath: vi.fn() });
};

describe('skill-handlers', () => {
  it('skill.list calls service.list', async () => {
    const svc = setupSkillService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildSkillHandlers(svc);
    await h['skill.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('skill.get brands the id', async () => {
    const svc = setupSkillService();
    await svc.save({ skill: skill('foo'), isCreate: true });
    const spy = vi.spyOn(svc, 'get');
    const h = buildSkillHandlers(svc);
    await h['skill.get']!({ id: 'foo' });
    expect(spy).toHaveBeenCalledWith('foo');
  });

  it('skill.delete passes branded id and removeSymlinks', async () => {
    const svc = setupSkillService();
    await svc.save({ skill: skill('foo'), isCreate: true });
    const spy = vi.spyOn(svc, 'delete');
    const h = buildSkillHandlers(svc);
    await h['skill.delete']!({ id: 'foo', removeSymlinks: true });
    expect(spy).toHaveBeenCalledWith({ id: 'foo', removeSymlinks: true });
  });

  it('skill.save passes through skill payload', async () => {
    const svc = setupSkillService();
    const spy = vi.spyOn(svc, 'save');
    const h = buildSkillHandlers(svc);
    await h['skill.save']!({ skill: skill('foo'), isCreate: true });
    expect(spy).toHaveBeenCalled();
  });

  it('skill.get rejects empty id', async () => {
    const h = buildSkillHandlers(setupSkillService());
    await expect(h['skill.get']!({ id: '' })).rejects.toMatchObject({ kind: 'validation' });
  });
});

describe('agent-handlers', () => {
  it('agent.list calls service.list', async () => {
    const svc = setupAgentService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildAgentHandlers(svc);
    await h['agent.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('agent.get brands the id', async () => {
    const svc = setupAgentService();
    await svc.save({ agent: agent('reviewer'), isCreate: true });
    const spy = vi.spyOn(svc, 'get');
    const h = buildAgentHandlers(svc);
    await h['agent.get']!({ id: 'reviewer' });
    expect(spy).toHaveBeenCalledWith('reviewer');
  });

  it('agent.delete brands the id', async () => {
    const svc = setupAgentService();
    await svc.save({ agent: agent('reviewer'), isCreate: true });
    const spy = vi.spyOn(svc, 'delete');
    const h = buildAgentHandlers(svc);
    await h['agent.delete']!({ id: 'reviewer', removeSymlinks: false });
    expect(spy).toHaveBeenCalledWith({ id: 'reviewer', removeSymlinks: false });
  });

  it('agent.save passes through agent payload', async () => {
    const svc = setupAgentService();
    const spy = vi.spyOn(svc, 'save');
    const h = buildAgentHandlers(svc);
    await h['agent.save']!({ agent: agent('reviewer'), isCreate: true });
    expect(spy).toHaveBeenCalled();
  });
});

describe('instruction-handlers', () => {
  it('instruction.get returns not_found for a non-existent slug (project slots may exist for any slug)', async () => {
    const svc = setupInstructionService();
    const h = buildInstructionHandlers(svc);
    await expect(h['instruction.get']!({ id: 'other' })).rejects.toThrow(/not found/i);
  });

  it('instruction.get returns the saved default instruction', async () => {
    const svc = setupInstructionService();
    await svc.save({ instruction: instruction(), isCreate: true });
    const spy = vi.spyOn(svc, 'get');
    const h = buildInstructionHandlers(svc);
    const result = await h['instruction.get']!({ id: 'default' });
    expect(spy).toHaveBeenCalledWith('default');
    expect(result).toMatchObject({ urn: 'urn:instruction:default', content: expect.stringContaining('# Instructions') });
  });

  it('instruction.save passes through instruction payload', async () => {
    const svc = setupInstructionService();
    const spy = vi.spyOn(svc, 'save');
    const h = buildInstructionHandlers(svc);
    await h['instruction.save']!({ instruction: instruction(), isCreate: true });
    expect(spy).toHaveBeenCalled();
  });
});

describe('marketplace-handlers', () => {
  it('marketplace.list calls service with scope', async () => {
    const svc = {
      list: vi.fn().mockResolvedValue([]),
    } as unknown as MarketplaceService;
    const h = buildMarketplaceHandlers(svc);
    await h['marketplace.list']!({ scope: 'personal' });
    expect(svc.list).toHaveBeenCalledWith('personal');
  });

  it('marketplace.add validates source path', async () => {
    const svc = {
      add: vi.fn().mockResolvedValue(undefined),
    } as unknown as MarketplaceService;
    const h = buildMarketplaceHandlers(svc);
    await h['marketplace.add']!({
      scope: 'personal',
      id: 'foo',
      source: { path: '/x' },
    });
    expect(svc.add).toHaveBeenCalledWith('personal', {
      id: 'foo',
      source: { kind: 'directory', path: '/x' },
    });
  });

  it('marketplace.remove validates scope', async () => {
    const svc = {
      remove: vi.fn().mockResolvedValue(undefined),
    } as unknown as MarketplaceService;
    const h = buildMarketplaceHandlers(svc);
    await expect(
      h['marketplace.remove']!({ scope: 'invalid', id: 'foo' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('marketplace.refresh calls service.refresh', async () => {
    const svc = {
      refresh: vi.fn().mockResolvedValue(null),
    } as unknown as MarketplaceService;
    const h = buildMarketplaceHandlers(svc);
    await h['marketplace.refresh']!({ scope: 'personal', id: 'foo' });
    expect(svc.refresh).toHaveBeenCalledWith('personal', 'foo');
  });
});

const setupWorkspaceService = () => {
  const registry = new InMemoryWorkspaceRegistry();
  const bootstrap = { create: vi.fn().mockResolvedValue(undefined) };
  return new WorkspaceService(registry, new FixedClock(new Date('2026-04-26T10:00:00.000Z')), bootstrap, '/home/u');
};

const setupFileBrowserService = () =>
  new FileBrowserService(
    {
      listDir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'x', truncated: false }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn(async (p: string) => p),
    },
    '/repos/acme',
  );

describe('workspace-handlers', () => {
  it('workspace.list calls service.list', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildWorkspaceHandlers(svc, vi.fn(), setupFileBrowserService());
    await h['workspace.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('workspace.getActive calls service.getActive', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'getActive');
    const h = buildWorkspaceHandlers(svc, vi.fn(), setupFileBrowserService());
    await h['workspace.getActive']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('workspace.create passes name and rootPath through', async () => {
    const svc = setupWorkspaceService();
    const spy = vi.spyOn(svc, 'create');
    const h = buildWorkspaceHandlers(svc, vi.fn(), setupFileBrowserService());
    await h['workspace.create']!({ name: 'Acme', rootPath: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith({ name: 'Acme', rootPath: '/repos/acme' });
  });

  it('workspace.switchTo calls the injected switchActiveWorkspace, not service.switchTo directly', async () => {
    const svc = setupWorkspaceService();
    const serviceSpy = vi.spyOn(svc, 'switchTo');
    const orchestrated: Workspace = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };
    const switchActiveWorkspace = vi.fn().mockResolvedValue(orchestrated);
    const h = buildWorkspaceHandlers(svc, switchActiveWorkspace, setupFileBrowserService());
    const result = await h['workspace.switchTo']!({ id: 'w1' });
    expect(switchActiveWorkspace).toHaveBeenCalledWith('w1');
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(result).toEqual(orchestrated);
  });

  it('workspace.delete passes the id through', async () => {
    const svc = setupWorkspaceService();
    // Stubbed rather than a plain call-through spy: `service.delete` rejects with
    // not_found for any id not already in the (freshly-seeded) registry, and
    // `WorkspaceService.create` only ever assigns random UUIDs, so a known id like
    // 'w1' can't be pre-created. This test only cares that the id is forwarded.
    const spy = vi.spyOn(svc, 'delete').mockResolvedValue(undefined);
    const h = buildWorkspaceHandlers(svc, vi.fn(), setupFileBrowserService());
    await h['workspace.delete']!({ id: 'w1' });
    expect(spy).toHaveBeenCalledWith('w1');
  });

  it('workspace.create rejects a missing name', async () => {
    const h = buildWorkspaceHandlers(setupWorkspaceService(), vi.fn(), setupFileBrowserService());
    await expect(h['workspace.create']!({ rootPath: '/repos/acme' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('workspace.listDir delegates to fileBrowserService.listDir', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn().mockResolvedValue([{ name: 'a.txt', kind: 'file' }]), readFile: vi.fn(), writeFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.listDir']!({ path: 'sub' });
    expect(result).toEqual([{ name: 'a.txt', kind: 'file' }]);
  });

  it('workspace.readFile delegates to fileBrowserService.readFile', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'hi', truncated: false }), writeFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.readFile']!({ path: 'a.txt' });
    expect(result).toEqual({ previewable: true, content: 'hi', truncated: false });
  });

  it('workspace.writeFile delegates to fileBrowserService.writeFile', async () => {
    const svc = setupWorkspaceService();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), writeFile, realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    await h['workspace.writeFile']!({ path: 'a.txt', content: 'hello' });
    expect(writeFile).toHaveBeenCalledWith('/repos/acme/a.txt', 'hello');
  });

  it('workspace.writeFile accepts an empty content string', async () => {
    const svc = setupWorkspaceService();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), writeFile, realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    await h['workspace.writeFile']!({ path: 'a.txt', content: '' });
    expect(writeFile).toHaveBeenCalledWith('/repos/acme/a.txt', '');
  });

  it('workspace.writeFile rejects a missing content field', async () => {
    const h = buildWorkspaceHandlers(setupWorkspaceService(), vi.fn(), setupFileBrowserService());
    await expect(h['workspace.writeFile']!({ path: 'a.txt' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('workspace.resolvePath returns the resolved absolute path', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    const result = await h['workspace.resolvePath']!({ path: 'sub' });
    expect(result).toEqual({ absolutePath: '/repos/acme/sub' });
  });

  it('workspace.listDir rejects a path escaping the root', async () => {
    const svc = setupWorkspaceService();
    const fileBrowserService = new FileBrowserService(
      { listDir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), realpath: vi.fn(async (p: string) => p) },
      '/repos/acme',
    );
    const h = buildWorkspaceHandlers(svc, vi.fn(), fileBrowserService);
    await expect(h['workspace.listDir']!({ path: '../etc' })).rejects.toMatchObject({ kind: 'validation' });
  });
});

const setupProjectService = () =>
  new ProjectService(new InMemoryProjectRegistry(), new FixedClock(new Date('2026-04-26T10:00:00.000Z')), {
    symlinkManager: { create: vi.fn().mockResolvedValue({ status: 'ok' }), removeIfPointsToWorkspace: vi.fn().mockResolvedValue('removed') },
    sourcePath: '/home/u/.ai-companion/index.md',
    dataDir: '/home/u/.ai-companion',
  });

const fakeFileBrowserPort = () => ({
  listDir: vi.fn().mockResolvedValue([{ name: 'a.txt', kind: 'file' }]),
  readFile: vi.fn().mockResolvedValue({ previewable: true, content: 'hi', truncated: false }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  realpath: vi.fn(async (p: string) => p),
});

describe('project-handlers', () => {
  it('project.list calls service.list', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'list');
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await h['project.list']!({});
    expect(spy).toHaveBeenCalled();
  });

  it('project.create passes name and path through', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'create');
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await h['project.create']!({ name: 'acme', path: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith({ name: 'acme', path: '/repos/acme' });
  });

  it('project.update passes id and optional fields through', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const spy = vi.spyOn(svc, 'update');
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await h['project.update']!({ id: created.id, name: 'acme-renamed' });
    expect(spy).toHaveBeenCalledWith({ id: created.id, name: 'acme-renamed' });
  });

  it('project.delete passes the id through', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const spy = vi.spyOn(svc, 'delete');
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await h['project.delete']!({ id: created.id });
    expect(spy).toHaveBeenCalledWith(created.id);
  });

  it('project.create rejects a missing path', async () => {
    const h = buildProjectHandlers(setupProjectService(), fakeFileBrowserPort());
    await expect(h['project.create']!({ name: 'acme' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('project.findOrCreateByPath passes the path through', async () => {
    const svc = setupProjectService();
    const spy = vi.spyOn(svc, 'findOrCreateByPath');
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await h['project.findOrCreateByPath']!({ path: '/repos/acme' });
    expect(spy).toHaveBeenCalledWith('/repos/acme');
  });

  it('project.listDir resolves the project root and delegates to the file browser port', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const port = fakeFileBrowserPort();
    const h = buildProjectHandlers(svc, port);
    const result = await h['project.listDir']!({ projectId: created.id, path: 'sub' });
    expect(port.listDir).toHaveBeenCalledWith('/repos/acme/sub');
    expect(result).toEqual([{ name: 'a.txt', kind: 'file' }]);
  });

  it('project.readFile resolves the project root and delegates to the file browser port', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const port = fakeFileBrowserPort();
    const h = buildProjectHandlers(svc, port);
    const result = await h['project.readFile']!({ projectId: created.id, path: 'a.txt' });
    expect(port.readFile).toHaveBeenCalledWith('/repos/acme/a.txt');
    expect(result).toEqual({ previewable: true, content: 'hi', truncated: false });
  });

  it('project.writeFile resolves the project root and delegates to the file browser port', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const port = fakeFileBrowserPort();
    const h = buildProjectHandlers(svc, port);
    await h['project.writeFile']!({ projectId: created.id, path: 'a.txt', content: 'hello' });
    expect(port.writeFile).toHaveBeenCalledWith('/repos/acme/a.txt', 'hello');
  });

  it('project.writeFile rejects an unknown projectId', async () => {
    const h = buildProjectHandlers(setupProjectService(), fakeFileBrowserPort());
    await expect(
      h['project.writeFile']!({ projectId: 'nope', path: 'a.txt', content: 'x' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('project.resolvePath returns the absolute path under the project root', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    const result = await h['project.resolvePath']!({ projectId: created.id, path: 'sub' });
    expect(result).toEqual({ absolutePath: '/repos/acme/sub' });
  });

  it('project.listDir rejects a path escaping the project root', async () => {
    const svc = setupProjectService();
    const created = await svc.create({ name: 'acme', path: '/repos/acme' });
    const h = buildProjectHandlers(svc, fakeFileBrowserPort());
    await expect(
      h['project.listDir']!({ projectId: created.id, path: '../etc' }),
    ).rejects.toMatchObject({ kind: 'validation' });
  });

  it('project.listDir rejects an unknown projectId', async () => {
    const h = buildProjectHandlers(setupProjectService(), fakeFileBrowserPort());
    await expect(h['project.listDir']!({ projectId: 'nope', path: '' })).rejects.toMatchObject({ kind: 'not_found' });
  });
});
