import { execFile } from 'node:child_process';
import type { McpHealthProbePort } from '../../application/ports/mcp-probe-port.js';
import type { McpHealth } from '../../../shared/mcp.js';
import { DomainError } from '../../domain/errors.js';

const PROBE_TIMEOUT_MS = 45_000;

// eslint-disable-next-line no-control-regex -- chalk colours the status when stdout is a TTY.
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Parses `cursor-agent mcp list`, one server per line: `<name>: <status>`, where status is `ready`,
 * `requires_authentication`, `loading`, `disabled`, `not loaded (needs approval)` or `Error: <detail>`.
 * `loading` and `disabled` say nothing about the connection, so those servers are left out (unknown).
 */
export function parseCursorMcpList(stdout: string): Map<string, McpHealth> {
  const health = new Map<string, McpHealth>();
  for (const raw of stdout.replace(ANSI, '').split('\n')) {
    const match = /^(.+?):\s+(.+)$/.exec(raw.trim());
    if (!match) continue;
    const [, name, status] = match as unknown as [string, string, string];
    if (status === 'ready') health.set(name, { state: 'ok' });
    else if (status === 'requires_authentication') health.set(name, { state: 'needs-auth' });
    else if (status.startsWith('not loaded'))
      health.set(name, { state: 'warning', detail: 'Aguardando aprovação no Cursor' });
    else if (status.startsWith('Error:')) {
      const detail = status.slice('Error:'.length).trim();
      health.set(name, { state: 'error', ...(detail.length > 0 ? { detail } : {}) });
    }
  }
  return health;
}

/**
 * Runs the user's own `cursor-agent mcp list` — it connects to every server in `~/.cursor/mcp.json` (and the
 * cwd's `.cursor/mcp.json`), so it takes a few seconds.
 */
export class CursorCliMcpProbe implements McpHealthProbePort {
  constructor(private readonly options: { bin?: string; cwd: string; timeoutMs?: number }) {}

  probe(): Promise<Map<string, McpHealth>> {
    const bin = this.options.bin ?? 'cursor-agent';
    return new Promise((resolve, reject) => {
      execFile(
        bin,
        ['mcp', 'list'],
        {
          cwd: this.options.cwd,
          timeout: this.options.timeoutMs ?? PROBE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
        (err, stdout) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            reject(
              code === 'ENOENT'
                ? new DomainError(
                    'not_found',
                    `Command not found: ${bin}. Install Cursor's CLI and make sure it is on PATH.`,
                  )
                : new DomainError('io', `${bin} mcp list failed: ${err.message}`),
            );
            return;
          }
          resolve(parseCursorMcpList(stdout));
        },
      );
    });
  }
}
