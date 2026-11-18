import { execFile } from 'node:child_process';
import type { McpProbePort, McpProbeResult } from '../../application/ports/mcp-probe-port.js';
import { DomainError } from '../../domain/errors.js';

const PROBE_TIMEOUT_MS = 45_000;

/**
 * The runtime's own naming: `claude.ai Google Drive` → `claude-ai-Google-Drive`. A plugin's server keeps its
 * `plugin:<plugin>:<server>` form — it is the name `claude mcp login` takes, and hyphenating it cannot be
 * undone (`plugin-customer-support-guru`).
 */
export function normalizeMcpName(display: string): string {
  if (/^plugin:[^:]+:.+$/.test(display)) return display;
  return display.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Parses `claude mcp list` output, one server per line:
 * `<name>: <target> - ✔ Connected | ! Needs authentication | ✘ Failed to connect — <detail>`.
 * Lines that do not match (the "Checking…" banner, blanks) are skipped.
 */
export function parseMcpList(stdout: string): McpProbeResult[] {
  const results: McpProbeResult[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^(.+?):\s.*\s-\s(✔|!|✘)\s*(.*)$/u.exec(line.trim());
    if (!match) continue;
    const [, name, mark, rest] = match as unknown as [string, string, string, string];
    if (mark === '✔') results.push({ name: normalizeMcpName(name), state: 'connected' });
    else if (mark === '!') results.push({ name: normalizeMcpName(name), state: 'needs-auth' });
    else {
      const detail = rest.replace(/^Failed to connect\s*[—-]?\s*/u, '').trim();
      results.push({ name: normalizeMcpName(name), state: 'failed', ...(detail.length > 0 ? { detail } : {}) });
    }
  }
  return results;
}

/** Runs the user's own `claude mcp list` — it health-checks every server, so it takes a few seconds. */
export class ClaudeCliMcpProbe implements McpProbePort {
  constructor(private readonly options: { bin?: string; cwd: string; timeoutMs?: number }) {}

  probe(): Promise<McpProbeResult[]> {
    const bin = this.options.bin ?? 'claude';
    return new Promise((resolve, reject) => {
      execFile(
        bin,
        ['mcp', 'list'],
        { cwd: this.options.cwd, timeout: this.options.timeoutMs ?? PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) {
            const code = (err as NodeJS.ErrnoException).code;
            reject(
              code === 'ENOENT'
                ? new DomainError('not_found', `Command not found: ${bin}. Install Claude Code and make sure it is on PATH.`)
                : new DomainError('io', `${bin} mcp list failed: ${err.message}`),
            );
            return;
          }
          resolve(parseMcpList(stdout));
        },
      );
    });
  }
}
