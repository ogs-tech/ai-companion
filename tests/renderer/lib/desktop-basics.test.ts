import { describe, expect, it } from 'vitest';
import { describeFailure } from '../../../src/renderer/lib/operation-error.js';
import { composeWindowTitle } from '../../../src/renderer/lib/window-title.js';
import { formatAccelerator } from '../../../src/renderer/lib/shortcut-labels.js';
import { publishShellStatus, getShellStatus, resetShellStatus } from '../../../src/renderer/lib/shell-status-store.js';
import type { ShellStatus } from '../../../src/renderer/lib/shell-status-store.js';

const base: ShellStatus = { workspaceName: null, tab: null, cursor: null, settingsOpen: false };
const tab = (over: Partial<NonNullable<ShellStatus['tab']>> = {}): NonNullable<ShellStatus['tab']> => ({
  title: 'a.md',
  dirty: false,
  editable: true,
  savedAt: null,
  ...over,
});

describe('describeFailure', () => {
  const cases: Array<[string, string]> = [
    ['ENOENT: no such file or directory', 'não existe mais'],
    ['EACCES: permission denied', 'permissão da pasta'],
    ['ENOSPC: no space left on device', 'disco está cheio'],
    ['connect ETIMEDOUT 1.2.3.4', 'demorou demais'],
    ['getaddrinfo ENOTFOUND github.com', 'Sem conexão'],
    ['something odd', 'Veja os detalhes'],
  ];
  it.each(cases)('maps %s to a human hint', (raw, hint) => {
    const failure = describeFailure(new Error(raw), 'Não foi possível salvar a.md');
    expect(failure.message).toContain('Não foi possível salvar a.md');
    expect(failure.message).toContain(hint);
    expect(failure.details).toContain(raw);
  });
});

describe('composeWindowTitle', () => {
  it('follows the spec table', () => {
    expect(composeWindowTitle(base)).toBe('Início — AI Companion');
    expect(composeWindowTitle({ ...base, workspaceName: 'acme' })).toBe('acme');
    expect(composeWindowTitle({ ...base, workspaceName: 'acme', tab: tab() })).toBe('a.md — acme');
    expect(composeWindowTitle({ ...base, workspaceName: 'acme', tab: tab({ dirty: true }) })).toBe('a.md ● — acme');
    expect(composeWindowTitle({ ...base, tab: tab({ title: 'minha-skill' }) })).toBe('minha-skill — Início');
    expect(composeWindowTitle({ ...base, workspaceName: 'acme', settingsOpen: true })).toBe('Configurações — AI Companion');
  });
});

describe('formatAccelerator', () => {
  it('uses glyphs on macOS and words elsewhere', () => {
    expect(formatAccelerator('Shift+CmdOrCtrl+N', true)).toBe('⇧⌘N');
    expect(formatAccelerator('Alt+CmdOrCtrl+S', true)).toBe('⌥⌘S');
    expect(formatAccelerator('Shift+CmdOrCtrl+N', false)).toBe('Shift+Ctrl+N');
    expect(formatAccelerator('CmdOrCtrl+K', false)).toBe('Ctrl+K');
  });
});

describe('shell-status-store', () => {
  it('keeps the same snapshot when nothing changed', () => {
    resetShellStatus();
    publishShellStatus({ cursor: { line: 1, column: 1 } });
    const before = getShellStatus();
    publishShellStatus({ cursor: { line: 1, column: 1 } });
    expect(getShellStatus()).toBe(before);
    resetShellStatus();
  });
});
