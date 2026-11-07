import { describe, expect, it } from 'vitest';
import { conversationIdOf, harnessOf, terminalOf } from '../../../src/main/infrastructure/external-sessions/ps-process-scan-adapter.js';
import { cwdFromTail, titleFromTail } from '../../../src/main/infrastructure/external-sessions/fs-claude-transcript-watch.js';

describe('process scan helpers', () => {
  it('matches the executable, not an argument that merely mentions claude', () => {
    expect(harnessOf('/usr/local/bin/claude --resume abc')).toBe('claude');
    expect(harnessOf('/Users/x/.local/bin/cursor-agent')).toBe('cursor');
    expect(harnessOf('vim claude.md')).toBeNull();
    expect(harnessOf('node /x/claude-helper.js')).toBeNull();
  });
  it('reads the conversation id from the command line', () => {
    expect(conversationIdOf('claude --resume 123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(conversationIdOf('claude --model opus')).toBeNull();
  });
  it('finds the hosting terminal, and flags the app\'s own descendants', () => {
    const rows = new Map([
      [10, { pid: 10, ppid: 5, command: 'claude' }],
      [5, { pid: 5, ppid: 2, command: '-zsh' }],
      [2, { pid: 2, ppid: 1, command: '/Applications/iTerm.app/Contents/MacOS/iTerm2' }],
    ]);
    expect(terminalOf(10, rows, 999)).toEqual({ terminal: 'iTerm2', ownedByApp: false });
    expect(terminalOf(10, rows, 5)).toEqual({ terminal: null, ownedByApp: true });
  });
});

describe('transcript tail', () => {
  it('takes cwd from the newest entry that has one, tolerating a partial last line', () => {
    const tail = ['{"cwd":"/old"}', '{"cwd":"/new","type":"user"}', '{"type":"assistant","cw'].join('\n');
    expect(cwdFromTail(tail)).toBe('/new');
    expect(cwdFromTail('{"type":"x"}')).toBeNull();
  });
});

describe('titleFromTail', () => {
  it('takes the newest ai-title, and a custom title (/rename) over it', () => {
    const ai = (t: string) => JSON.stringify({ type: 'ai-title', aiTitle: t });
    expect(titleFromTail([ai('First'), '{"type":"user"}', ai('Second')].join('\n'))).toBe('Second');
    expect(titleFromTail([ai('Generated'), JSON.stringify({ type: 'custom-title', customTitle: 'Mine' }), ai('Later')].join('\n'))).toBe('Mine');
  });
  it('is null with no title or only a partial line', () => {
    expect(titleFromTail('{"type":"user"}\n{"aiTitle":"cut')).toBeNull();
  });
});
