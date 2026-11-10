import { execFile } from 'node:child_process';
import { delimiter } from 'node:path';
import type { ChannelProbePort, ProbeResult } from '../../application/ports/channel-probe-port.js';

const PROBE_TIMEOUT_MS = 8_000;

/** `execFile` with the directories GUI-launched apps usually lack (`~/.local/bin`, `~/.lmstudio/bin`, Homebrew). */
export class ExecChannelProbe implements ChannelProbePort {
  constructor(private readonly extraPath: readonly string[]) {}

  run(bin: string, args: readonly string[]): Promise<ProbeResult> {
    const PATH = [process.env['PATH'], ...this.extraPath].filter(Boolean).join(delimiter);
    return new Promise((resolve) => {
      execFile(bin, [...args], { env: { ...process.env, PATH }, timeout: PROBE_TIMEOUT_MS }, (err, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        if (!err) return resolve({ found: true, exitCode: 0, output });
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return resolve({ found: false, exitCode: null, output });
        resolve({ found: true, exitCode: typeof code === 'number' ? code : 1, output });
      });
    });
  }
}
