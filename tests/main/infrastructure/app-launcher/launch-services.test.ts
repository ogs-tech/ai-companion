import { describe, it, expect } from 'vitest';
import { parseApplicationsOutput } from '../../../../src/main/infrastructure/app-launcher/launch-services.js';

describe('parseApplicationsOutput', () => {
  it('parses the applications and the default the script reported', () => {
    const stdout = JSON.stringify({
      defaultAppId: 'com.microsoft.VSCode',
      candidates: [
        { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
        { id: 'com.apple.TextEdit', name: 'Editor de Texto', path: '/System/Applications/TextEdit.app' },
      ],
    });

    expect(parseApplicationsOutput(stdout)).toEqual({
      defaultAppId: 'com.microsoft.VSCode',
      candidates: [
        { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
        { id: 'com.apple.TextEdit', name: 'Editor de Texto', path: '/System/Applications/TextEdit.app' },
      ],
    });
  });

  it('drops an entry with no bundle identifier, which nothing downstream could key on', () => {
    const stdout = JSON.stringify({
      candidates: [
        { id: null, name: 'Broken', path: '/Applications/Broken.app' },
        { id: 'com.apple.TextEdit', name: 'Editor de Texto', path: '/System/Applications/TextEdit.app' },
      ],
    });

    expect(parseApplicationsOutput(stdout).candidates).toEqual([
      { id: 'com.apple.TextEdit', name: 'Editor de Texto', path: '/System/Applications/TextEdit.app' },
    ]);
  });

  it('omits defaultAppId when the OS named no handler', () => {
    const stdout = JSON.stringify({ defaultAppId: null, candidates: [] });

    expect(parseApplicationsOutput(stdout)).not.toHaveProperty('defaultAppId');
  });

  it('degrades to no applications rather than throwing on empty output', () => {
    expect(parseApplicationsOutput('')).toEqual({ candidates: [] });
  });

  it('degrades to no applications rather than throwing on unparseable output', () => {
    expect(parseApplicationsOutput('execution error: -1743')).toEqual({ candidates: [] });
  });

  it('degrades to no applications when the payload is not the expected shape', () => {
    expect(parseApplicationsOutput('"just a string"')).toEqual({ candidates: [] });
  });
});

// Proves the script text survives TypeScript escaping and that the macOS APIs
// it calls still exist — the parser tests above can't catch either.
describe.skipIf(process.platform !== 'darwin')('LIST_APPLICATIONS_SCRIPT against the real Launch Services', () => {
  it('reports well-formed candidates for a path that exists', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { LIST_APPLICATIONS_SCRIPT } = await import(
      '../../../../src/main/infrastructure/app-launcher/launch-services.js'
    );

    const { stdout } = await promisify(execFile)(
      'osascript',
      ['-l', 'JavaScript', '-e', LIST_APPLICATIONS_SCRIPT, process.cwd()],
      { timeout: 10_000 },
    );
    const result = parseApplicationsOutput(stdout);

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.path.endsWith('.app')).toBe(true);
      expect(candidate.name).not.toMatch(/\.app$/);
    }
  });
});

describe('parseApplicationOutput', () => {
  it('parses a single identified application', async () => {
    const { parseApplicationOutput } = await import(
      '../../../../src/main/infrastructure/app-launcher/launch-services.js'
    );

    const stdout = JSON.stringify({ id: 'dev.zed.Zed', name: 'Zed', path: '/Applications/Zed.app' });

    expect(parseApplicationOutput(stdout)).toEqual({
      id: 'dev.zed.Zed',
      name: 'Zed',
      path: '/Applications/Zed.app',
    });
  });

  it('returns undefined for a bundle with no identifier', async () => {
    const { parseApplicationOutput } = await import(
      '../../../../src/main/infrastructure/app-launcher/launch-services.js'
    );

    expect(parseApplicationOutput(JSON.stringify({ id: null, name: 'X', path: '/X.app' }))).toBeUndefined();
  });

  it('returns undefined rather than throwing on unparseable output', async () => {
    const { parseApplicationOutput } = await import(
      '../../../../src/main/infrastructure/app-launcher/launch-services.js'
    );

    expect(parseApplicationOutput('execution error')).toBeUndefined();
  });
});

describe.skipIf(process.platform !== 'darwin')('IDENTIFY_APPLICATION_SCRIPT against a real bundle', () => {
  it('reads the bundle identifier of a system application', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { IDENTIFY_APPLICATION_SCRIPT, parseApplicationOutput } = await import(
      '../../../../src/main/infrastructure/app-launcher/launch-services.js'
    );

    const { stdout } = await promisify(execFile)(
      'osascript',
      ['-l', 'JavaScript', '-e', IDENTIFY_APPLICATION_SCRIPT, '/System/Library/CoreServices/Finder.app'],
      { timeout: 10_000 },
    );

    expect(parseApplicationOutput(stdout)).toMatchObject({ id: 'com.apple.finder' });
  });
});
