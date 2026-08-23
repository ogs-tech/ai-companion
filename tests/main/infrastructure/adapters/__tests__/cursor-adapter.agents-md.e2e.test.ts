import { describe, expect, it } from 'vitest';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { AdapterManager } from '../../../../../src/main/application/services/adapter-manager.js';
import { FileMaterializer } from '../../../../../src/main/application/services/file-materializer.js';
import { SymlinkManager } from '../../../../../src/main/application/services/symlink-manager.js';
import { SettingsService } from '../../../../../src/main/application/services/settings-service.js';
import { InMemoryEntityRepository } from '../../../../../src/main/infrastructure/entity/in-memory-entity-repository.js';
import { InMemorySettingsRepository } from '../../../../../src/main/infrastructure/settings/in-memory-settings-repository.js';
import { InMemoryFileSystem } from '../../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../../src/main/infrastructure/clock/fixed-clock.js';
import { GENERATED_FILE_MARKER } from '../../../../../src/main/application/entity/agents-file.js';
import {
  CURSOR_PLUGIN_ID,
  CURSOR_PLUGIN_JSON_MARKER,
  CURSOR_PLUGIN_MANIFEST_SUBPATH,
  CURSOR_PLUGIN_PERSONAL_RULE_FILE,
  CURSOR_PLUGIN_RULES_SUBPATH,
} from '../../../../../src/main/application/entity/cursor-plugin-manifest.js';
import type { Adapter } from '../../../../../src/main/application/ports/adapter.js';
import type { Settings } from '../../../../../src/shared/settings.js';
import { join } from 'node:path';
import {
  WORKSPACE_SOURCE,
  type Entity,
  type Instruction,
} from '../../../../../src/shared/entity.js';

const personal: Instruction = {
  urn: 'urn:instruction:default', kind: 'instruction', name: 'default',
  description: 'Global rules', scopes: ['personal'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'Reply in pt-BR.',
};

const project: Instruction = {
  urn: 'urn:instruction:acme', kind: 'instruction', name: 'acme',
  description: 'Acme project rules', scopes: ['project'],
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content: 'Only in acme.',
  scopeId: 'acme',
};

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async (id: string) => ({ id, name: 'acme', path: '/repos/acme', createdAt: '' }) },
};

const settings: Settings = {
  adapters: { claude: { enabled: true }, cursor: { enabled: true } },  ui: { theme: 'system' }, language: 'off',
};

const pluginRoot = join('/home/u', '.cursor', 'plugins', CURSOR_PLUGIN_ID);
const manifestPath = join(pluginRoot, CURSOR_PLUGIN_MANIFEST_SUBPATH);
const rulePath = join(pluginRoot, CURSOR_PLUGIN_RULES_SUBPATH, CURSOR_PLUGIN_PERSONAL_RULE_FILE);

function makeManager(fs: InMemoryFileSystem, entities: Entity[]): AdapterManager {
  const clock = new FixedClock(new Date('2026-07-02T10:00:00.000Z'));
  const settingsRepo = new InMemorySettingsRepository();
  const settingsService = new SettingsService(settingsRepo);
  void settingsRepo.save(settings);
  const entityRepository = new InMemoryEntityRepository();
  for (const e of entities) void entityRepository.save(e);
  return new AdapterManager({
    settingsService, entityRepository,
    symlinkManager: new SymlinkManager(fs, clock, '/workspace'),
    fileMaterializer: new FileMaterializer(fs, clock, '/workspace'),
    workspacePath: '/workspace',
    adapters: new Map<string, Adapter>([
      ['claude', new ClaudeAdapter({ homedir: '/home/u', ...scopeDeps })],
      ['cursor', new CursorAdapter({ homedir: '/home/u', ...scopeDeps })],
    ]),
  });
}

describe('Cursor instruction sync (e2e)', () => {
  it('materializes the personal instruction as a plugin (manifest + rule) on syncAll', async () => {
    const fs = new InMemoryFileSystem();
    const manager = makeManager(fs, [personal]);

    await manager.syncAll({ adapterId: 'cursor' });
    const manifest = await fs.readFile(manifestPath);
    const rule = await fs.readFile(rulePath);
    expect(manifest).toContain(CURSOR_PLUGIN_JSON_MARKER);
    expect(manifest).toContain(`"name": "${CURSOR_PLUGIN_ID}"`);
    expect(rule.startsWith('---\n')).toBe(true);
    expect(rule).toContain('alwaysApply: true');
    expect(rule).toContain('Reply in pt-BR.');

    await manager.removeAll({ adapterId: 'cursor' });
    expect(await fs.pathExists(manifestPath)).toBe(false);
    expect(await fs.pathExists(rulePath)).toBe(false);
  });

  it('materializes a project instruction as <repoPath>/AGENTS.md and removes it on removeAll', async () => {
    const fs = new InMemoryFileSystem();
    const manager = makeManager(fs, [project]);

    await manager.syncAll({ adapterId: 'cursor' });
    expect(await fs.readFile('/repos/acme/AGENTS.md')).toBe(`${GENERATED_FILE_MARKER}\n\nOnly in acme.\n`);

    await manager.removeAll({ adapterId: 'cursor' });
    expect(await fs.pathExists('/repos/acme/AGENTS.md')).toBe(false);
  });
});
