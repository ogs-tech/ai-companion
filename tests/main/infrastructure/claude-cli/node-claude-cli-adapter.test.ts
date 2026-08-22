import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NodeClaudeCliAdapter } from '../../../../src/main/infrastructure/claude-cli/node-claude-cli-adapter.js';
import type { GenerateDraftProgressEvent } from '../../../../src/shared/instruction-generation.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const stub = (name: string): string => path.join(fixturesDir, name);

describe('NodeClaudeCliAdapter', () => {
  it('returns the trimmed final result text on success', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-success.sh'));
    const result = await adapter.generate({ prompt: 'hello' });
    expect(result.text).toBe('STUB_OUTPUT');
  });

  it('calls onEvent with the phase sequence as NDJSON lines arrive', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-success.sh'));
    const events: GenerateDraftProgressEvent[] = [];
    const result = await adapter.generate({ prompt: 'hello', onEvent: (e) => events.push(e) });
    expect(result.text).toBe('STUB_OUTPUT');
    expect(events).toEqual([
      { phase: 'starting' },
      { phase: 'requesting' },
      { phase: 'writing', textDelta: 'STUB' },
      { phase: 'writing', textDelta: '_OUTPUT' },
      { phase: 'done' },
    ]);
  });

  it('passes the prompt through as the argument after -p', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-echo-prompt.sh'));
    const result = await adapter.generate({ prompt: 'write me a poem' });
    expect(result.text).toBe('write me a poem');
  });

  it('throws a clear error when the binary is missing (ENOENT)', async () => {
    const adapter = new NodeClaudeCliAdapter('/definitely/not/a/real/binary-xyz');
    await expect(adapter.generate({ prompt: 'hi' })).rejects.toThrow('claude CLI not found in PATH');
  });

  it('throws a clear error on non-zero exit, including stderr', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-fail.sh'));
    await expect(adapter.generate({ prompt: 'hi' })).rejects.toThrow(/boom/);
  });

  it('throws a clear error on timeout', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-hang.sh'));
    await expect(adapter.generate({ prompt: 'hi', timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });

  it('rejects when the result line reports is_error', async () => {
    const adapter = new NodeClaudeCliAdapter(stub('stub-error-result.sh'));
    await expect(adapter.generate({ prompt: 'hi' })).rejects.toThrow(/claude CLI reported an error/);
  });
});
