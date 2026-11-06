import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LiveProcess, ProcessScanPort } from '../../application/ports/external-session-ports.js';
import type { HarnessId } from '../../../shared/harness.js';

const run = promisify(execFile);

interface Row {
  pid: number;
  ppid: number;
  command: string;
}

const TERMINALS: ReadonlyArray<[RegExp, string]> = [
  [/iTerm/i, 'iTerm2'],
  [/Terminal\.app/i, 'Terminal'],
  [/ghostty/i, 'Ghostty'],
  [/WezTerm/i, 'WezTerm'],
  [/Alacritty/i, 'Alacritty'],
  [/kitty/i, 'kitty'],
  [/Warp/, 'Warp'],
  [/Cursor( Helper|\.app)/, 'Cursor'],
  [/Code( Helper|\.app)|Visual Studio Code/, 'VS Code'],
  [/tmux/, 'tmux'],
];

/** Which harness a command line is, or `null`. Matches the executable, not an argument that merely contains "claude". */
export function harnessOf(command: string): HarnessId | null {
  const exe = command.trim().split(/\s+/)[0] ?? '';
  const base = exe.split('/').pop() ?? '';
  if (base === 'claude') return 'claude';
  if (base === 'cursor-agent') return 'cursor';
  return null;
}

/** `--resume <id>` / `--session-id <id>` / `-r <id>` when the command line carries a UUID. */
export function conversationIdOf(command: string): string | null {
  const match = /(?:--resume|--session-id|-r)[ =]([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(command);
  return match?.[1] ?? null;
}

export function terminalOf(pid: number, rows: ReadonlyMap<number, Row>, ownPid: number): { terminal: string | null; ownedByApp: boolean } {
  let current = rows.get(pid)?.ppid;
  for (let depth = 0; current !== undefined && current > 1 && depth < 25; depth += 1) {
    if (current === ownPid) return { terminal: null, ownedByApp: true };
    const row = rows.get(current);
    if (!row) break;
    for (const [pattern, label] of TERMINALS) if (pattern.test(row.command)) return { terminal: label, ownedByApp: false };
    current = row.ppid;
  }
  return { terminal: null, ownedByApp: false };
}

/** `ps` for the candidates + one `lsof` for their working directories. Processes descended from this app are the app's own sessions and are left out. */
export class PsProcessScanAdapter implements ProcessScanPort {
  constructor(private readonly ownPid: number = process.pid) {}

  async scan(): Promise<LiveProcess[]> {
    const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024 });
    const rows = new Map<number, Row>();
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (match) rows.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' });
    }
    const found: Array<{ row: Row; harness: HarnessId; terminal: string | null }> = [];
    for (const row of rows.values()) {
      const harness = harnessOf(row.command);
      if (!harness) continue;
      const { terminal, ownedByApp } = terminalOf(row.pid, rows, this.ownPid);
      if (!ownedByApp) found.push({ row, harness, terminal });
    }
    const cwds = await this.cwds(found.map((f) => f.row.pid));
    return found.map(({ row, harness, terminal }) => ({
      pid: row.pid,
      harness,
      cwd: cwds.get(row.pid) ?? null,
      terminal,
      conversationId: conversationIdOf(row.command),
    }));
  }

  private async cwds(pids: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (pids.length === 0) return result;
    try {
      const { stdout } = await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')]);
      let pid = 0;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1));
        else if (line.startsWith('n') && pid) result.set(pid, line.slice(1));
      }
    } catch {
      // lsof missing or denied: cwd stays unknown, matching falls back to ids.
    }
    return result;
  }
}
