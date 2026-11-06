import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INLINE_ANSWER_MARKER, SIGNAL_HOOK_COMMANDS } from '../../../src/main/application/session-activity.js';
import { CLAUDE_EXTERNAL_HOOKS, CURSOR_EXTERNAL_HOOKS, parseExternalLine } from '../../../src/main/application/external-hooks.js';

describe('parseExternalLine', () => {
  it('keeps the payload for every event (cwd lives there)', () => {
    expect(parseExternalLine('{"harness":"claude","event":"working","payload":{"cwd":"/w","session_id":"a"}}')).toEqual({
      harness: 'claude',
      signal: { event: 'working', payload: { cwd: '/w', session_id: 'a' } },
    });
  });
  it('rejects malformed lines, unknown harnesses and payload-less tool events', () => {
    expect(parseExternalLine('nope')).toBeNull();
    expect(parseExternalLine('{"harness":"x","event":"idle"}')).toBeNull();
    expect(parseExternalLine('{"harness":"claude","event":"tool","payload":null}')).toBeNull();
  });
});

describe('external hook commands (run for real)', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ext-hook-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const run = (command: string, stdin: string, env: Record<string, string> = {}): string =>
    execFileSync('sh', ['-c', command], { input: stdin, env: { PATH: process.env['PATH'] ?? '', HOME: home, ...env }, encoding: 'utf8' });
  const consent = (): void => {
    mkdirSync(join(home, '.ai-companion', 'signals'), { recursive: true });
    writeFileSync(join(home, '.ai-companion', 'signals', 'external-enabled'), '');
  };
  const out = (id: string): string => join(home, '.ai-companion', 'signals', 'external', `${id}.jsonl`);

  it('writes nothing until the consent marker exists', () => {
    run(CLAUDE_EXTERNAL_HOOKS.Stop, '{"session_id":"abc","cwd":"/w"}');
    expect(existsSync(out('abc'))).toBe(false);
  });

  it('records the event with the whole stdin JSON once consented', () => {
    consent();
    run(CLAUDE_EXTERNAL_HOOKS.PreToolUse, '{"session_id":"abc-1","cwd":"/w","tool_name":"Edit","tool_input":{"file_path":"/w/a.ts"}}');
    const line = parseExternalLine(readFileSync(out('abc-1'), 'utf8').trim());
    expect(line?.harness).toBe('claude');
    expect(line?.signal).toMatchObject({ event: 'tool', payload: { cwd: '/w', tool_name: 'Edit' } });
  });

  it('stays silent inside an app-spawned session (its own signal file covers it)', () => {
    consent();
    run(CLAUDE_EXTERNAL_HOOKS.Stop, '{"session_id":"abc"}', { AI_COMPANION_SIGNAL_FILE: '/tmp/x' });
    expect(existsSync(out('abc'))).toBe(false);
  });

  it('reads Cursor\'s conversation_id and prints nothing to stdout', () => {
    consent();
    const stdout = run(CURSOR_EXTERNAL_HOOKS.beforeSubmitPrompt, '{"conversation_id":"chat-9","workspace_roots":["/w"]}');
    expect(stdout).toBe('');
    expect(parseExternalLine(readFileSync(out('chat-9'), 'utf8').trim())).toMatchObject({ harness: 'cursor', signal: { event: 'working' } });
  });

  it('ignores a payload with no session id', () => {
    consent();
    run(CLAUDE_EXTERNAL_HOOKS.Stop, '{"cwd":"/w"}');
    expect(existsSync(join(home, '.ai-companion', 'signals', 'external'))).toBe(false);
  });
});

describe('permission hook (run for real)', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'perm-hook-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const permission = SIGNAL_HOOK_COMMANDS.permission;
  const enable = (): void => {
    mkdirSync(join(home, '.ai-companion', 'signals'), { recursive: true });
    writeFileSync(join(home, '.ai-companion', INLINE_ANSWER_MARKER), '');
  };
  it('returns at once, printing nothing, when the inline-answer marker is absent', () => {
    const out = execFileSync('sh', ['-c', permission], { input: '{"tool_name":"Bash"}', env: { PATH: process.env['PATH'] ?? '', HOME: home, AI_COMPANION_SIGNAL_FILE: join(home, 'sig.jsonl') }, encoding: 'utf8' });
    expect(out).toBe('');
  });

  it('publishes the request, then prints the allow decision the app drops next to the signal file', async () => {
    enable();
    const file = join(home, 'sig.jsonl');
    writeFileSync(file, '');
    const child = execFile('sh', ['-c', permission], { env: { PATH: process.env['PATH'] ?? '', HOME: home, AI_COMPANION_SIGNAL_FILE: file }, encoding: 'utf8' });
    const done = new Promise<string>((resolve) => {
      let out = '';
      child.stdout?.on('data', (d: string) => (out += d));
      child.on('close', () => resolve(out));
    });
    child.stdin?.end('{"tool_name":"Bash","tool_input":{"command":"ls"}}');
    // The hook has written its request line before it starts waiting.
    // The line is written in pieces; wait for its newline (the app's tailer buffers partial lines the same way).
    for (let i = 0; i < 100 && !readFileSync(file, 'utf8').endsWith('\n'); i += 1) await new Promise((r) => setTimeout(r, 40));
    expect(JSON.parse(readFileSync(file, 'utf8').trim())).toMatchObject({ event: 'permission', payload: { tool_name: 'Bash' } });
    writeFileSync(`${file}.decision`, 'allow');
    expect(JSON.parse(await done)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  });

  it('is a no-op outside the app (no signal file env)', () => {
    enable();
    const out = execFileSync('sh', ['-c', permission], { input: '{}', env: { PATH: process.env['PATH'] ?? '', HOME: home }, encoding: 'utf8' });
    expect(out).toBe('');
  });
});
