import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalSessionService } from '../../../../src/main/application/services/external-session-service.js';
import type {
  ExternalSignal,
  LiveProcess,
  TranscriptChange,
} from '../../../../src/main/application/ports/external-session-ports.js';

function setup(live: LiveProcess[] = []) {
  let onSignal: (s: ExternalSignal) => void = () => {};
  let onChange: (c: TranscriptChange) => void = () => {};
  let clock = 1_000_000;
  const started: string[] = [];
  const service = new ExternalSessionService({
    signals: { onSignal: (l) => (onSignal = l), start: async () => void started.push('signals'), stop: () => {} },
    transcripts: { onChange: (l) => (onChange = l), start: async () => void started.push('transcripts'), stop: () => {}, tail: async () => 'tail' },
    processes: { scan: async () => live },
    now: () => clock,
    isOwnConversation: (id) => id === 'own',
  });
  return {
    service,
    started,
    signal: (s: ExternalSignal) => onSignal(s),
    transcript: (c: TranscriptChange) => onChange(c),
    advance: (ms: number) => (clock += ms),
    setLive: (next: LiveProcess[]) => (live = next),
    get now() {
      return clock;
    },
  };
}

const hook = (id: string, signal: ExternalSignal['signal'], harness: 'claude' | 'cursor' = 'claude'): ExternalSignal => ({ id, harness, signal });

describe('ExternalSessionService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('listens to hook files only in exact mode, never when off', async () => {
    const t = setup();
    await t.service.setMode('estimated');
    expect(t.started).toEqual(['transcripts']);
    await t.service.setMode('exact');
    expect(t.started).toEqual(['transcripts', 'signals', 'transcripts']);
    await t.service.setMode('off');
    expect(t.service.list()).toEqual([]);
  });

  it('follows hook signals as a measured session with cwd, tool detail and the right state', () => {
    const t = setup();
    t.signal(hook('s1', { event: 'working', payload: { cwd: '/w/app' } }));
    t.signal(hook('s1', { event: 'tool', payload: { tool_name: 'Edit', tool_input: { file_path: '/w/app/a.ts' } } }));
    expect(t.service.list()[0]).toMatchObject({ id: 's1', label: 'app', cwd: '/w/app', precision: 'measured', activity: 'working', activityDetail: 'Edit a.ts', editingFile: '/w/app/a.ts' });
    t.signal(hook('s1', { event: 'idle' }));
    expect(t.service.list()[0]).toMatchObject({ activity: 'idle', changedFiles: ['/w/app/a.ts'] });
  });

  it('goes to Pergunta only for a real permission notification, never for idle_prompt', () => {
    const t = setup();
    t.signal(hook('s1', { event: 'working', payload: { cwd: '/w' } }));
    t.signal(hook('s1', { event: 'notification', payload: { notification_type: 'idle_prompt' } }));
    expect(t.service.list()[0]?.activity).toBe('working');
    t.signal(hook('s1', { event: 'notification', payload: { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } }));
    expect(t.service.list()[0]).toMatchObject({ activity: 'needs-input', attention: { kind: 'permission', detail: 'Bash' } });
  });

  it('ignores conversations the app itself runs', () => {
    const t = setup();
    t.signal(hook('own', { event: 'working', payload: {} }));
    t.transcript({ id: 'own', harness: 'claude', cwd: '/w', modifiedAt: t.now });
    expect(t.service.list()).toEqual([]);
  });

  it('estimates from a transcript: working while fresh, settling to idle, never Pergunta', async () => {
    const t = setup();
    await t.service.setMode('estimated');
    t.transcript({ id: 'tx', harness: 'claude', cwd: '/w/x', modifiedAt: t.now });
    expect(t.service.list()[0]).toMatchObject({ precision: 'estimated', activity: 'working', label: 'x' });
    t.advance(3000);
    vi.advanceTimersByTime(3000);
    expect(t.service.list()[0]?.activity).toBe('idle');
  });

  it('lets a hook override a transcript estimate, and then ignores the transcript', () => {
    const t = setup();
    t.transcript({ id: 's1', harness: 'claude', cwd: '/w', modifiedAt: t.now });
    t.signal(hook('s1', { event: 'idle', payload: { cwd: '/w' } }));
    expect(t.service.list()[0]).toMatchObject({ precision: 'measured', activity: 'idle' });
    t.transcript({ id: 's1', harness: 'claude', cwd: '/w', modifiedAt: t.now });
    expect(t.service.list()[0]?.activity).toBe('idle');
  });

  it('marks a hook session closed once its process is gone past the grace period, and reopens it on a new signal', async () => {
    const t = setup([]);
    await t.service.setMode('exact');
    t.signal(hook('s1', { event: 'working', payload: { cwd: '/w' } }));
    await t.service.scanProcesses();
    expect(t.service.list()[0]?.closed).toBe(false); // inside the grace window
    t.advance(11_000);
    await t.service.scanProcesses();
    expect(t.service.list()[0]).toMatchObject({ closed: true });
    t.signal(hook('s1', { event: 'working', payload: { cwd: '/w' } }));
    expect(t.service.list()[0]?.closed).toBe(false);
  });

  it('shows a live process nobody reported as an estimated Ocioso, with its terminal', async () => {
    const t = setup([{ pid: 7, harness: 'cursor', cwd: '/w/c', terminal: 'iTerm2', conversationId: null }]);
    await t.service.setMode('estimated');
    await t.service.scanProcesses();
    expect(t.service.list()[0]).toMatchObject({ id: 'cursor-proc:7', harness: 'cursor', activity: 'idle', precision: 'estimated', terminal: 'iTerm2' });
  });

  it('does not duplicate a reported session as a process entry', async () => {
    const t = setup([{ pid: 7, harness: 'claude', cwd: '/w', terminal: 'Terminal', conversationId: null }]);
    await t.service.setMode('exact');
    t.signal(hook('s1', { event: 'working', payload: { cwd: '/w' } }));
    await t.service.scanProcesses();
    expect(t.service.list()).toHaveLength(1);
    expect(t.service.list()[0]?.terminal).toBe('Terminal');
  });

  it('emits only on real change', () => {
    const t = setup();
    const changes = vi.fn();
    t.service.onChange(changes);
    t.signal(hook('s1', { event: 'idle', payload: { cwd: '/w' } }));
    expect(changes).toHaveBeenCalledTimes(1);
  });
});
