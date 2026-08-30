import { describe, it, expect } from 'vitest';
import { buildSkillHandlers } from '../../../src/main/ipc/skill-handlers.js';
import type { SkillService } from '../../../src/main/application/services/skill-service.js';

function fakeService(overrides: Partial<SkillService> = {}): SkillService {
  return {
    resolvePath: async () => '/home/user/.ai-companion/skills/demo/SKILL.md',
    ...overrides,
  } as unknown as SkillService;
}

describe('skill handlers', () => {
  it('skill.resolvePath returns the absolute path for the given id', async () => {
    const handlers = buildSkillHandlers(fakeService());
    expect(await handlers['skill.resolvePath']!({ id: 'demo' })).toEqual({
      absolutePath: '/home/user/.ai-companion/skills/demo/SKILL.md',
    });
  });

  it('skill.resolvePath rejects a missing id', async () => {
    const handlers = buildSkillHandlers(fakeService());
    await expect(handlers['skill.resolvePath']!({})).rejects.toThrow();
  });
});
