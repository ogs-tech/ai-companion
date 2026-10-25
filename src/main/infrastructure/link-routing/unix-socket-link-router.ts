import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { delimiter, join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import type { LinkListener, LinkRoutingPort } from '../../application/ports/link-routing-port.js';

const MAX_URL_LENGTH = 8 * 1024;
const MAX_URLS_PER_SECOND = 5;
/** macOS `sun_path` holds 104 bytes including the NUL. */
const MAX_SOCKET_PATH_LENGTH = 100;
const SOCKET_NAME = 'link.sock';

export const SOCKET_ENV = 'AI_COMPANION_LINK_SOCKET';
/** Overrides the real opener the shim falls back to — lets tests avoid launching a browser. */
export const FALLBACK_OPENER_ENV = 'AI_COMPANION_OPEN_FALLBACK';

/**
 * Forwards a bare http(s) URL to the app's socket; everything else (flags,
 * files, apps) and any delivery failure goes to the real opener, so the shim
 * can shadow `open` on PATH without breaking it and a link is never lost.
 */
export const SHIM_SCRIPT = `#!/bin/sh
fallback="\${${FALLBACK_OPENER_ENV}:-/usr/bin/open}"
if [ "$#" -eq 1 ] && [ -n "\${${SOCKET_ENV}:-}" ]; then
  case "$1" in
    http://*|https://*)
      printf '%s\\n' "$1" | /usr/bin/nc -U -w 1 "$${SOCKET_ENV}" 2>/dev/null && exit 0
      ;;
  esac
fi
exec "$fallback" "$@"
`;

export interface UnixSocketLinkRouterOptions {
  /** App data dir (`~/.ai-companion`): holds `bin/` (the shim) and, when the path is short enough, `run/` (the socket). */
  baseDir: string;
}

export class UnixSocketLinkRouter implements LinkRoutingPort {
  private server: Server | null = null;
  private listener: LinkListener | null = null;
  private readonly binDir: string;
  private readonly shimPath: string;
  private socketPath: string | null = null;
  private recent: number[] = [];

  constructor(private readonly options: UnixSocketLinkRouterOptions) {
    this.binDir = join(options.baseDir, 'bin');
    this.shimPath = join(this.binDir, 'open');
  }

  onUrl(listener: LinkListener): void {
    this.listener = listener;
  }

  shimEnv(): Record<string, string> {
    if (this.socketPath === null) return {};
    return {
      [SOCKET_ENV]: this.socketPath,
      // A: CLIs that honor $BROWSER. B: those that call `open` directly.
      BROWSER: this.shimPath,
      PATH: `${this.binDir}${delimiter}${process.env['PATH'] ?? ''}`,
    };
  }

  async start(): Promise<void> {
    await mkdir(this.binDir, { recursive: true });
    await writeFile(this.shimPath, SHIM_SCRIPT, { mode: 0o755 });
    await chmod(this.shimPath, 0o755);

    const socketDir = await this.resolveSocketDir();
    const socketPath = join(socketDir, SOCKET_NAME);
    await unlink(socketPath).catch(() => undefined);

    const server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
    this.server = server;
    this.socketPath = socketPath;
  }

  async stop(): Promise<void> {
    const server = this.server;
    const socketPath = this.socketPath;
    this.server = null;
    this.socketPath = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (socketPath) await unlink(socketPath).catch(() => undefined);
  }

  /** `<base>/run`, or a per-user tmp dir when `$HOME` is deep enough to overflow `sun_path`. */
  private async resolveSocketDir(): Promise<string> {
    const preferred = join(this.options.baseDir, 'run');
    const dir =
      join(preferred, SOCKET_NAME).length <= MAX_SOCKET_PATH_LENGTH
        ? preferred
        : join(tmpdir(), `ai-companion-${userInfo().uid}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    return dir;
  }

  private handle(socket: Socket): void {
    let buffered = '';
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        this.accept(buffered.slice(0, newline).trim());
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf('\n');
      }
      // No newline within the cap: not a URL line, stop buffering it.
      if (buffered.length > MAX_URL_LENGTH) socket.destroy();
    });
    socket.on('end', () => {
      if (buffered.trim() !== '') this.accept(buffered.trim());
    });
  }

  private accept(url: string): void {
    if (url.length === 0 || url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url)) return;
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 1000);
    if (this.recent.length >= MAX_URLS_PER_SECOND) return;
    this.recent.push(now);
    this.listener?.(url);
  }
}
