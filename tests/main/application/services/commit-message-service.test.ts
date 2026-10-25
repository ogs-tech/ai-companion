import { describe, expect, it, vi } from 'vitest';
import { CommitMessageService } from '../../../../src/main/application/services/commit-message-service.js';
import { FakeRepoGitPort } from '../../../../src/main/application/services/__fixtures__/fake-repo-git-port.js';
import { DomainError } from '../../../../src/main/domain/errors.js';

const ROOT = '/ws';

function setup(files: Record<string, string> = {}, dirs: Record<string, string[]> = {}) {
  const git = new FakeRepoGitPort();
  git.repos.add(ROOT);
  git.stagedStatText = ' a.ts | 1 +';
  git.stagedDiffResult = { diff: 'DIFF-BODY', truncated: false };
  const generate = vi.fn().mockResolvedValue('feat: do it');
  const sources = {
    list: async (_root: string, dir: string) => dirs[dir] ?? [],
    read: async (_root: string, path: string) => files[path] ?? null,
  };
  const service = new CommitMessageService(git, sources, () => ({ generate }), { activeWorkspace: { rootPath: ROOT } });
  return { git, generate, service, sources };
}

describe('CommitMessageService', () => {
  it('fails validation at Início', async () => {
    const { git, sources } = setup();
    const service = new CommitMessageService(git, sources, () => ({ generate: vi.fn() }), { activeWorkspace: null });
    await expect(service.generate()).rejects.toMatchObject({ kind: 'validation' });
  });

  it('fails not_found outside a repository', async () => {
    const { git, service } = setup();
    git.repos.clear();
    await expect(service.generate()).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('fails validation when nothing is staged and never calls the model', async () => {
    const { git, generate, service } = setup();
    git.stagedStatText = '  \n';
    await expect(service.generate()).rejects.toMatchObject({ kind: 'validation' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('builds the prompt from diff, stat, guidance, config and package.json commitlint', async () => {
    const { git, generate, service } = setup(
      {
        'CLAUDE.md': '## Commits\nUSE-PROJECT-RULES',
        'commitlint.config.js': 'module.exports = {}',
        'package.json': JSON.stringify({ commitlint: { extends: ['x'] } }),
        'docs/contributing.md': '# Commit style\nDOC-RULE',
      },
      { '': ['commitlint.config.js', 'README.md'], docs: ['contributing.md', 'other.md'] },
    );
    git.template = 'TEMPLATE-TEXT';
    await expect(service.generate()).resolves.toEqual({ message: 'feat: do it' });
    const prompt = generate.mock.calls[0]![0] as string;
    for (const part of ['DIFF-BODY', 'a.ts | 1 +', 'USE-PROJECT-RULES', 'DOC-RULE', 'module.exports', '"extends"', 'TEMPLATE-TEXT']) {
      expect(prompt).toContain(part);
    }
  });

  it('survives an unparsable package.json', async () => {
    const { service } = setup({ 'package.json': '{nope' });
    await expect(service.generate()).resolves.toBeDefined();
  });

  it('passes generator errors through unchanged', async () => {
    const { generate, service } = setup();
    generate.mockRejectedValueOnce(new DomainError('not_found', 'Command not found: claude'));
    await expect(service.generate()).rejects.toMatchObject({ kind: 'not_found' });
  });
});
