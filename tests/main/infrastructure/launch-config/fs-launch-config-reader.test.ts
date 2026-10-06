import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FsLaunchConfigReader } from '../../../../src/main/infrastructure/launch-config/fs-launch-config-reader.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const project = (name: string): string => path.join(fixturesDir, name);

describe('FsLaunchConfigReader', () => {
  it('parses a JSONC launch.json with comments and trailing commas, marking supported vs unsupported configs', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('valid-project'));
    if ('error' in result) throw new Error(`expected configs, got error: ${result.error}`);
    expect(result.configs).toEqual([
      { name: 'Run server', type: 'node', request: 'launch', program: '${workspaceFolder}/server.js', args: ['--port', '3000'], supported: true },
      { name: 'Debug in Chrome', type: 'chrome', request: 'launch', program: '${workspaceFolder}/index.html', args: [], supported: false },
      { name: 'Attach to process', type: 'node', request: 'attach', program: '${workspaceFolder}/server.js', args: [], supported: false },
    ]);
  });

  it('reports a malformed launch.json as an explicit error rather than guessing', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('malformed-project'));
    expect(result).toEqual({ error: 'malformed launch.json' });
  });

  it('reports valid JSON missing a "configurations" array as malformed', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('no-configurations-project'));
    expect(result).toEqual({ error: 'malformed launch.json' });
  });

  it('returns an empty config list, not an error, when the project has no .vscode/launch.json at all', async () => {
    const reader = new FsLaunchConfigReader();
    const result = await reader.read(project('does-not-exist'));
    expect(result).toEqual({ configs: [] });
  });
});
