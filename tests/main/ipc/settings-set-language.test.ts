import { describe, it, expect, vi } from 'vitest';
import { buildHandlers, type IpcDeps } from '../../../src/main/ipc/registry.js';
import { createDispatcher } from '../../../src/main/ipc/dispatcher.js';
import { getDefaults, type Settings } from '../../../src/shared/settings.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../src/shared/entity.js';

const makeInstruction = (content: string): Instruction => ({
  urn: 'urn:instruction:default',
  kind: 'instruction',
  name: 'default',
  description: 'test',
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  source: WORKSPACE_SOURCE,
  content,
});

const baseDeps = (): IpcDeps => {
  const settings: Settings = { ...getDefaults() };
  const instruction = makeInstruction('# Global instructions\n\nSome content.\n');

  return {
    settingsService: {
      load: vi.fn().mockResolvedValue(settings),
      save: vi.fn().mockResolvedValue(undefined),
      merge: vi.fn().mockImplementation(async (partial) => ({ ...settings, ...partial })),
      getDefaults: vi.fn().mockReturnValue(getDefaults()),
    } as unknown as IpcDeps['settingsService'],
    instructionService: {
      get: vi.fn().mockResolvedValue(instruction),
      save: vi.fn().mockResolvedValue({ instruction, syncReport: [] }),
    } as unknown as IpcDeps['instructionService'],
    sessionService: {} as IpcDeps['sessionService'],
    repoService: {} as IpcDeps['repoService'],
    adapterManager: {} as IpcDeps['adapterManager'],
    dialogPort: {} as IpcDeps['dialogPort'],
    pluginService: {} as IpcDeps['pluginService'],
    credentialStore: {} as IpcDeps['credentialStore'],
    skillService: {} as IpcDeps['skillService'],
    agentService: {} as IpcDeps['agentService'],
    hookService: {} as IpcDeps['hookService'],
    marketplaceService: {} as IpcDeps['marketplaceService'],
    healthService: {} as IpcDeps['healthService'],
    mcpService: {} as IpcDeps['mcpService'],
    notificationPort: {} as IpcDeps['notificationPort'],
    workspaceTeardownService: {} as IpcDeps['workspaceTeardownService'],
    appQuit: vi.fn(),
  };
};

describe('settings.setLanguage', () => {
  it('updates settings and injects language block into the default instruction', async () => {
    const deps = baseDeps();
    const dispatch = createDispatcher(buildHandlers(deps));

    const result = await dispatch('settings.setLanguage', { language: 'pt-BR' });

    expect(result.ok).toBe(true);

    expect(deps.settingsService.merge).toHaveBeenCalledWith({ language: 'pt-BR' });
    expect(deps.instructionService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          content: expect.stringContaining('<language>'),
        }),
      }),
    );
  });

  it('removes language block when set to off', async () => {
    const deps = baseDeps();
    const instructionWithBlock = makeInstruction(
      '# Global instructions\n\n<language>\nReply in pt-BR.\n</language>\n',
    );
    (deps.instructionService.get as ReturnType<typeof vi.fn>).mockResolvedValue(instructionWithBlock);
    const dispatch = createDispatcher(buildHandlers(deps));

    const result = await dispatch('settings.setLanguage', { language: 'off' });

    expect(result.ok).toBe(true);
    expect(deps.instructionService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          content: expect.not.stringContaining('<language>'),
        }),
      }),
    );
  });

  it('rejects invalid language value', async () => {
    const deps = baseDeps();
    const dispatch = createDispatcher(buildHandlers(deps));

    const result = await dispatch('settings.setLanguage', { language: 'klingon' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
    }
  });
});
