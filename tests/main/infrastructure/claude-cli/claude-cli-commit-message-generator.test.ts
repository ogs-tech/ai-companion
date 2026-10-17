import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClaudeCliCommitMessageGenerator,
  cleanOutput,
} from '../../../../src/main/infrastructure/claude-cli/claude-cli-commit-message-generator.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-claude-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fakeCli(script: string): Promise<string> {
  const bin = join(dir, 'fake-claude');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return bin;
}

const make = (bin: string, timeoutMs?: number) =>
  new ClaudeCliCommitMessageGenerator({ bin, cwd: dir, ...(timeoutMs ? { timeoutMs } : {}) });

describe('ClaudeCliCommitMessageGenerator', () => {
  it('sends the prompt on stdin, with the isolating flags, and returns stdout', async () => {
    const bin = await fakeCli('printf "ARGS:%s|STDIN:" "$*"; cat');
    const out = await make(bin).generate('hello prompt');
    expect(out).toContain('-p --tools  --no-session-persistence');
    expect(out).toContain('--setting-sources project,local');
    expect(out).toContain('STDIN:hello prompt');
  });

  it('strips code fences from the output', async () => {
    const bin = await fakeCli('printf "\\`\\`\\`\\nfeat: x\\n\\`\\`\\`\\n"');
    await expect(make(bin).generate('p')).resolves.toBe('feat: x');
  });

  it('maps a missing executable to not_found naming the command', async () => {
    await expect(make(join(dir, 'does-not-exist')).generate('p')).rejects.toMatchObject({
      kind: 'not_found',
      message: expect.stringContaining('does-not-exist'),
    });
  });

  it('maps a non-zero exit to io with truncated stderr', async () => {
    const bin = await fakeCli('head -c 10000 /dev/zero | tr "\\0" "e" >&2; exit 3');
    const err = await make(bin).generate('p').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'io' });
    expect((err as { details: { stderr: string } }).details.stderr.length).toBe(4_096);
  });

  it('rejects empty output as io', async () => {
    const bin = await fakeCli('printf "  \\n"');
    await expect(make(bin).generate('p')).rejects.toMatchObject({ kind: 'io' });
  });

  it('times out as ClaudeTimeout', async () => {
    const bin = await fakeCli('sleep 5');
    await expect(make(bin, 100).generate('p')).rejects.toMatchObject({ kind: 'io', message: 'ClaudeTimeout' });
  });

  it('can be aborted', async () => {
    const bin = await fakeCli('sleep 5');
    const controller = new AbortController();
    const pending = make(bin).generate('p', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'io' });
  });
});

describe('cleanOutput', () => {
  it.each([
    ['plain', 'feat: x', 'feat: x'],
    ['fenced', '```\nfeat: x\n```', 'feat: x'],
    ['fenced with lang', '```text\nfeat: x\n```', 'feat: x'],
    ['quoted', '"feat: x"', 'feat: x'],
    ['inner quotes kept', '"feat: say "hi""', '"feat: say "hi""'],
  ])('%s', (_name, input, expected) => {
    expect(cleanOutput(input)).toBe(expected);
  });
});
