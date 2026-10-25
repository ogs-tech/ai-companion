import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, connect, type Server } from 'node:net';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  FALLBACK_OPENER_ENV,
  SOCKET_ENV,
  UnixSocketLinkRouter,
} from '../../../../src/main/infrastructure/link-routing/unix-socket-link-router.js';

const run = promisify(execFile);

let baseDir: string;
let router: UnixSocketLinkRouter;
let received: string[];

beforeEach(async () => {
  // Short prefix: a unix socket path must fit in `sun_path`.
  baseDir = await mkdtemp(join(tmpdir(), 'lr-'));
  received = [];
  router = new UnixSocketLinkRouter({ baseDir });
  router.onUrl((url) => received.push(url));
});

afterEach(async () => {
  await router.stop();
  await rm(baseDir, { recursive: true, force: true });
});

function send(socketPath: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => socket.end(payload));
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}

describe('UnixSocketLinkRouter', () => {
  it('accepts http(s) URLs and drops other schemes, empty and oversize lines', async () => {
    await router.start();
    const socket = router.shimEnv()[SOCKET_ENV]!;
    await send(socket, `https://a.test/x\nfile:///etc/passwd\njavascript:alert(1)\n\nHTTP://b.test\n`);
    await send(socket, `https://${'a'.repeat(9000)}\n`);
    expect(received).toEqual(['https://a.test/x', 'HTTP://b.test']);
  });

  it('caps the burst rate', async () => {
    await router.start();
    const socket = router.shimEnv()[SOCKET_ENV]!;
    await send(socket, Array.from({ length: 12 }, (_, i) => `https://a.test/${i}\n`).join(''));
    expect(received).toHaveLength(5);
  });

  it('serves the socket with mode 0600 and replaces a stale one', async () => {
    await router.start();
    const socket = router.shimEnv()[SOCKET_ENV]!;
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    // Simulate a crash: socket file left behind, no listener.
    const second = new UnixSocketLinkRouter({ baseDir });
    await second.start();
    await second.stop();
    await router.stop();
    await writeFile(socket, '');
    await expect(router.start()).resolves.toBeUndefined();
  });

  it('writes the shim idempotently with mode 0755 and exposes env for both opener variants', async () => {
    await router.start();
    const shim = join(baseDir, 'bin', 'open');
    const first = await readFile(shim, 'utf8');
    await chmod(shim, 0o600);
    await router.stop();
    await router.start();
    expect(await readFile(shim, 'utf8')).toBe(first);
    expect((await stat(shim)).mode & 0o777).toBe(0o755);
    const env = router.shimEnv();
    expect(env['BROWSER']).toBe(shim);
    expect(env['PATH']!.startsWith(`${join(baseDir, 'bin')}:`)).toBe(true);
  });

  it('exposes no env until started', () => {
    expect(router.shimEnv()).toEqual({});
  });
});

describe('shim script', () => {
  let fallbackLog: string;
  let fallbackBin: string;
  let fakeServer: Server | null = null;

  beforeEach(async () => {
    fallbackLog = join(baseDir, 'fallback.log');
    fallbackBin = join(baseDir, 'fake-open');
    await writeFile(fallbackBin, `#!/bin/sh\nprintf '%s|' "$@" >> "${fallbackLog}"\n`, { mode: 0o755 });
    await router.start();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (fakeServer ? fakeServer.close(() => resolve()) : resolve()));
    fakeServer = null;
  });

  const shim = (...args: string[]) =>
    run(join(baseDir, 'bin', 'open'), args, {
      env: { ...process.env, ...router.shimEnv(), [FALLBACK_OPENER_ENV]: fallbackBin },
    });
  const fallbackCalls = async (): Promise<string> => readFile(fallbackLog, 'utf8').catch(() => '');

  it('forwards a bare http(s) URL to the app and does not call the real opener', async () => {
    await shim('https://login.test/oauth');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual(['https://login.test/oauth']);
    expect(await fallbackCalls()).toBe('');
  });

  it.each([
    [['-a', 'Foo']],
    [['file.txt']],
    [['--help']],
    [['https://a.test', 'extra']],
    [['file:///etc/hosts']],
  ])('passes %j through to the real opener untouched', async (args) => {
    await shim(...args);
    expect(await fallbackCalls()).toBe(args.map((a) => `${a}|`).join(''));
    expect(received).toEqual([]);
  });

  it('falls back to the real opener when the socket is dead', async () => {
    await router.stop();
    await run(join(baseDir, 'bin', 'open'), ['https://dead.test'], {
      env: {
        ...process.env,
        [SOCKET_ENV]: join(baseDir, 'run', 'link.sock'),
        [FALLBACK_OPENER_ENV]: fallbackBin,
      },
    });
    expect(await fallbackCalls()).toBe('https://dead.test|');
  });

  it('forwards to any server speaking the line protocol', async () => {
    const socketPath = join(baseDir, 'fake.sock');
    const lines: string[] = [];
    fakeServer = createServer((s) => s.on('data', (d) => lines.push(String(d))));
    await new Promise<void>((resolve) => fakeServer!.listen(socketPath, resolve));
    await run(join(baseDir, 'bin', 'open'), ['https://x.test'], {
      env: { ...process.env, [SOCKET_ENV]: socketPath, [FALLBACK_OPENER_ENV]: fallbackBin },
    });
    expect(lines.join('')).toBe('https://x.test\n');
    expect(await fallbackCalls()).toBe('');
  });
});
