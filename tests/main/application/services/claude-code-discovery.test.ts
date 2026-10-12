import { describe, it, expect, vi } from 'vitest';
import { SkillService } from '../../../../src/main/application/services/skill-service.js';
import { EntityService } from '../../../../src/main/application/services/entity-service.js';
import { PluginProvenanceService } from '../../../../src/main/application/services/plugin-provenance.js';
import { scopedRepository } from '../../helpers/scoped-repository.js';
import { InMemoryFileSystem } from '../../../../src/main/infrastructure/filesystem/in-memory-filesystem.js';
import { FixedClock } from '../../../../src/main/infrastructure/clock/fixed-clock.js';
import { FakePluginCachePort } from '../../../../src/main/application/services/__fixtures__/fake-plugin-cache-port.js';
import { pluginId } from '../../../../src/main/domain/plugin-id.js';
import { skillId } from '../../../../src/main/domain/skill-id.js';
import { OperationNotAllowedForOriginError } from '../../../../src/main/domain/plugin-errors.js';
import type { AdapterManager } from '../../../../src/main/application/services/adapter-manager.js';
import type { ClaudeCodePluginRegistryPort } from '../../../../src/main/application/ports/claude-code-plugin-registry-port.js';

const FROZEN = new Date('2026-06-07T10:00:00.000Z');

const fakeAdapterManager = () =>
  ({
    syncEntity: vi.fn().mockResolvedValue([]),
    removeEntity: vi.fn().mockResolvedValue([]),
  }) as unknown as AdapterManager;

const skillFile = (name: string) =>
  `---\nname: ${name}\ntype: skill\ndescription: cc skill\nscopes:\n  - personal\nversion: 1.0.0\ncreatedAt: ${FROZEN.toISOString()}\nupdatedAt: ${FROZEN.toISOString()}\n---\ncc skill body\n`;

const registry = (installPath: string): ClaudeCodePluginRegistryPort => ({
  list: async () => [
    { pluginId: pluginId('feature-dev'), marketplace: 'mp', installPath, version: '1', scope: 'user' },
  ],
});

const makeSkillService = (fs: InMemoryFileSystem, claudeCodeRegistry: ClaudeCodePluginRegistryPort) => {
  const cache = new FakePluginCachePort();
  const base = new EntityService(
    scopedRepository().scoped,
    new FixedClock(FROZEN),
    fakeAdapterManager(),
  );
  const provenance = new PluginProvenanceService({ cache, fs, claudeCodeRegistry });
  return new SkillService(base, { provenance, fs });
};

describe('SkillService — Claude Code discovery', () => {
  it('lists a Claude Code skill, read-only, tagged claude-code', async () => {
    const fs = new InMemoryFileSystem();
    fs.createFile('/cc/feature-dev/skills/research/SKILL.md', skillFile('research'));
    const skills = makeSkillService(fs, registry('/cc/feature-dev'));

    const listed = await skills.list('personal');
    const research = listed.find((s) => s.name === 'research');
    expect(research?.source).toEqual({
      kind: 'plugin',
      pluginId: 'feature-dev',
      provenance: 'claude-code',
    });
  });

  it('save throws OperationNotAllowedForOriginError for a claude-code-sourced skill', async () => {
    const fs = new InMemoryFileSystem();
    fs.createFile('/cc/feature-dev/skills/research/SKILL.md', skillFile('research'));
    const skills = makeSkillService(fs, registry('/cc/feature-dev'));

    const listed = await skills.list('personal');
    const research = listed.find((s) => s.name === 'research')!;

    await expect(
      skills.save({
        skill: research,
        scope: 'personal',
      }),
    ).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
  });

  it('delete throws OperationNotAllowedForOriginError for a claude-code-sourced skill name', async () => {
    const fs = new InMemoryFileSystem();
    fs.createFile('/cc/feature-dev/skills/research/SKILL.md', skillFile('research'));
    const skills = makeSkillService(fs, registry('/cc/feature-dev'));

    await expect(
      skills.delete({ id: skillId('research'), removeSymlinks: false, scope: 'personal' }),
    ).rejects.toBeInstanceOf(OperationNotAllowedForOriginError);
  });
});
