import { describe, expect, it } from 'vitest';
import { CursorAdapter } from '../../../../../src/main/infrastructure/adapters/cursor-adapter.js';
import { DomainError } from '../../../../../src/main/domain/errors.js';

const scopeDeps = {
  workspaceService: { get: async () => { throw new Error('not stubbed'); } },
  projectService: { get: async () => { throw new Error('not stubbed'); } },
};

describe('CursorAdapter — Adapter port contract', () => {
  it('exposes adapterId === "cursor"', () => {
    expect(new CursorAdapter({ homedir: '/home/user', ...scopeDeps }).adapterId).toBe('cursor');
  });

  it('exposes a resolveEntityDestinations function', () => {
    expect(typeof new CursorAdapter({ homedir: '/home/user', ...scopeDeps }).resolveEntityDestinations).toBe(
      'function',
    );
  });

  it('throws DomainError(internal, missing-homedir) for empty homedir', () => {
    try {
      new CursorAdapter({ homedir: '', ...scopeDeps });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).kind).toBe('internal');
      expect((err as DomainError).details).toMatchObject({ reason: 'missing-homedir' });
    }
  });

  it('throws for undefined and null homedir', () => {
    expect(() => new CursorAdapter({ homedir: undefined as unknown as string, ...scopeDeps })).toThrow(DomainError);
    expect(() => new CursorAdapter({ homedir: null as unknown as string, ...scopeDeps })).toThrow(DomainError);
  });
});
