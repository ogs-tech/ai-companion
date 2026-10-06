import { describe, it, expect } from 'vitest';
import { resolveLaunchCommand, substituteVariables, UnsupportedLaunchTypeError } from '../../../src/main/domain/launch-config-command.js';
import type { LaunchConfig } from '../../../src/shared/launch-config.js';

const nodeConfig = (overrides: Partial<LaunchConfig> = {}): LaunchConfig => ({
  name: 'Run script',
  type: 'node',
  request: 'launch',
  program: '${workspaceFolder}/index.js',
  args: [],
  supported: true,
  ...overrides,
});

describe('substituteVariables', () => {
  it('replaces every ${workspaceFolder} occurrence', () => {
    expect(substituteVariables('${workspaceFolder}/a/${workspaceFolder}/b', { workspaceFolder: '/repo' })).toBe('/repo/a//repo/b');
  });

  it('returns the value unchanged when it has no ${workspaceFolder} placeholder', () => {
    expect(substituteVariables('plain', { workspaceFolder: '/repo' })).toBe('plain');
  });
});

describe('resolveLaunchCommand', () => {
  it('resolves a node/launch config to a node invocation with substituted program/args/cwd', () => {
    const config = nodeConfig({
      program: '${workspaceFolder}/dist/server.js',
      args: ['--port', '${workspaceFolder}-suffix'],
      cwd: '${workspaceFolder}/sub',
    });
    const resolved = resolveLaunchCommand(config, '/repo');
    expect(resolved).toEqual({ command: 'node', args: ['/repo/dist/server.js', '--port', '/repo-suffix'], cwd: '/repo/sub' });
  });

  it('defaults cwd to the project path when the config has none', () => {
    const resolved = resolveLaunchCommand(nodeConfig(), '/repo');
    expect(resolved.cwd).toBe('/repo');
  });

  it('carries env through unchanged when present', () => {
    const resolved = resolveLaunchCommand(nodeConfig({ env: { NODE_ENV: 'development' } }), '/repo');
    expect(resolved.env).toEqual({ NODE_ENV: 'development' });
  });

  it('throws UnsupportedLaunchTypeError for a non-node type', () => {
    expect(() => resolveLaunchCommand(nodeConfig({ type: 'chrome' }), '/repo')).toThrow(UnsupportedLaunchTypeError);
  });

  it('throws UnsupportedLaunchTypeError for a non-launch request', () => {
    expect(() => resolveLaunchCommand(nodeConfig({ request: 'attach' }), '/repo')).toThrow(UnsupportedLaunchTypeError);
  });

  it('UnsupportedLaunchTypeError carries kind "validation" for the IPC dispatcher mapping', () => {
    try {
      resolveLaunchCommand(nodeConfig({ type: 'python' }), '/repo');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedLaunchTypeError);
      expect((err as UnsupportedLaunchTypeError).kind).toBe('validation');
    }
  });
});
