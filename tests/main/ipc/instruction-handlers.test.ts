import { describe, it, expect, vi } from 'vitest';
import { buildInstructionHandlers } from '../../../src/main/ipc/instruction-handlers.js';
import type { InstructionService } from '../../../src/main/application/services/instruction-service.js';

function fakeService(overrides: Partial<InstructionService> = {}): InstructionService {
  return {
    resolvePath: vi.fn(async () => '/home/user/.ai-companion/instructions/default.md'),
    ...overrides,
  } as unknown as InstructionService;
}

describe('instruction handlers', () => {
  it('instruction.resolvePath defaults to the personal instruction when no id is given', async () => {
    const service = fakeService();
    const handlers = buildInstructionHandlers(service);
    expect(await handlers['instruction.resolvePath']!(undefined)).toEqual({
      absolutePath: '/home/user/.ai-companion/instructions/default.md',
    });
    expect(service.resolvePath).toHaveBeenCalledWith(undefined);
  });

  it('instruction.resolvePath passes a given project slug through', async () => {
    const service = fakeService({
      resolvePath: vi.fn(async () => '/home/user/.ai-companion/instructions/project/acme/INSTRUCTION.md'),
    });
    const handlers = buildInstructionHandlers(service);
    expect(await handlers['instruction.resolvePath']!({ id: 'acme' })).toEqual({
      absolutePath: '/home/user/.ai-companion/instructions/project/acme/INSTRUCTION.md',
    });
    expect(service.resolvePath).toHaveBeenCalledWith('acme');
  });
});
