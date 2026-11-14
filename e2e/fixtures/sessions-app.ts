import { test } from '@playwright/test';
import { join } from 'node:path';
import {
  expect,
  launchApp,
  seedGitWorkspace,
  seedWorkspaceRegistry,
  type AppSession,
} from './app.js';

/**
 * Shared setup for the specs that drive sessions through the real app: two git workspaces ("acme-api" and "beta-web"),
 * every channel CLI as the interactive stub (`cli-stubs.ts`), and thin helpers over the `session.*` IPC. The PTY, the
 * signal file, the state machine and the IPC are the real ones.
 *
 * Call `useSessionsApp()` once at the top of a spec file: it registers the `beforeAll`/`afterAll` that launch and close
 * the app, and returns helpers that are safe to destructure at module level (they read the live session on each call).
 */

export interface SnapshotDto {
  sessionId: string;
  conversationId: string;
  scopeId: string | null;
  harness: string;
  label: string;
  status: 'running' | 'exited';
  activity?: 'needs-input' | 'working' | 'idle';
  permissionRequest?: { tool: string; command: string };
}

export interface SnapshotWithOutput extends SnapshotDto {
  outputBuffer: string;
}

export interface SessionsApp {
  /** The running app; only valid inside tests (after `beforeAll`). */
  readonly session: AppSession;
  readonly acmeRoot: string;
  readonly betaRoot: string;
  call: <T>(method: string, params?: unknown) => Promise<T>;
  list: () => Promise<SnapshotDto[]>;
  find: (sessionId: string) => Promise<SnapshotDto | undefined>;
  /** Everything the PTY has printed so far. */
  output: (sessionId: string) => Promise<string>;
  spawn: (workspaceId: string, channel?: string) => Promise<SnapshotWithOutput>;
  /** Keystrokes into the session's terminal (`\r` submits). */
  type: (sessionId: string, data: string) => Promise<void>;
  /** Starts a session and waits until it reports idle (the CLI is ready for a prompt). */
  idle: (workspaceId: string, channel?: string) => Promise<SnapshotWithOutput>;
  /** Sessions that exist now but not in `before`. */
  newSince: (before: string[]) => Promise<SnapshotDto[]>;
}

export function useSessionsApp(): SessionsApp {
  let session: AppSession | undefined;
  let acmeRoot = '';
  let betaRoot = '';

  const live = (): AppSession => {
    if (!session)
      throw new Error(
        'useSessionsApp(): the app is not running yet — use it inside a test or hook.',
      );
    return session;
  };
  const call = <T>(method: string, params?: unknown): Promise<T> => live().call<T>(method, params);
  const list = (): Promise<SnapshotDto[]> => call<SnapshotDto[]>('session.list');
  const find = async (id: string): Promise<SnapshotDto | undefined> =>
    (await list()).find((s) => s.sessionId === id);
  const output = async (id: string): Promise<string> =>
    (await call<SnapshotWithOutput>('session.status', { sessionId: id }))?.outputBuffer ?? '';
  const spawn = (workspaceId: string, channel = 'claude'): Promise<SnapshotWithOutput> =>
    call<SnapshotWithOutput>('session.spawn', {
      anchor: { kind: 'workspace', workspaceId },
      harness: channel,
    });
  const type = (id: string, data: string): Promise<void> =>
    call('session.write', { sessionId: id, data });
  const idle = async (workspaceId: string, channel = 'claude'): Promise<SnapshotWithOutput> => {
    const s = await spawn(workspaceId, channel);
    await expect.poll(async () => (await find(s.sessionId))?.activity).toBe('idle');
    return s;
  };
  const newSince = async (before: string[]): Promise<SnapshotDto[]> =>
    (await list()).filter((s) => !before.includes(s.sessionId));

  test.beforeAll(async () => {
    session = await launchApp({
      cli: {
        claude: { signedIn: true, interactive: true },
        'cursor-agent': { signedIn: true, interactive: true },
        lms: { signedIn: true, interactive: true },
      },
      settings: {
        adapters: {
          claude: { enabled: true },
          cursor: { enabled: true },
          lmstudio: { enabled: true },
        },
      },
      seed: (home) => {
        acmeRoot = join(home, 'Projects', 'acme-api');
        betaRoot = join(home, 'Projects', 'beta-web');
        seedGitWorkspace(acmeRoot);
        seedGitWorkspace(betaRoot);
        seedWorkspaceRegistry(
          home,
          [
            { id: 'acme', name: 'acme-api', rootPath: acmeRoot },
            { id: 'beta', name: 'beta-web', rootPath: betaRoot },
          ],
          'acme',
        );
      },
    });
  });

  test.afterAll(async () => {
    await session?.close();
  });

  return {
    get session() {
      return live();
    },
    get acmeRoot() {
      return acmeRoot;
    },
    get betaRoot() {
      return betaRoot;
    },
    call,
    list,
    find,
    output,
    spawn,
    type,
    idle,
    newSince,
  };
}
