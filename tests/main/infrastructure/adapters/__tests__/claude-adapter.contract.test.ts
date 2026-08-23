import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../../../../src/main/infrastructure/adapters/claude-adapter.js';
import { DomainError } from '../../../../../src/main/domain/errors.js';

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('ClaudeAdapter — Adapter port contract', () => {
  it('exposes adapterId === "claude"', () => {
    const adapter = new ClaudeAdapter({ homedir: '/home/user', ...scopeDeps });
    expect(adapter.adapterId).toBe('claude');
  });

  it('exposes a resolveEntityDestinations function', () => {
    const adapter = new ClaudeAdapter({ homedir: '/home/user', ...scopeDeps });
    expect(typeof adapter.resolveEntityDestinations).toBe('function');
  });

  it('throws DomainError(internal, missing-homedir) when homedir is undefined', () => {
    expect(() => new ClaudeAdapter({ homedir: undefined as unknown as string, ...scopeDeps })).toThrow(
      DomainError,
    );
    try {
      new ClaudeAdapter({ homedir: undefined as unknown as string, ...scopeDeps });
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      const domainErr = err as DomainError;
      expect(domainErr.kind).toBe('internal');
      expect(domainErr.details).toMatchObject({ reason: 'missing-homedir' });
    }
  });

  it('throws DomainError(internal, missing-homedir) when homedir is null', () => {
    expect(() => new ClaudeAdapter({ homedir: null as unknown as string, ...scopeDeps })).toThrow(
      DomainError,
    );
  });

  it('throws DomainError(internal, missing-homedir) when homedir is an empty string', () => {
    expect(() => new ClaudeAdapter({ homedir: '', ...scopeDeps })).toThrow(DomainError);
  });
});
