import { spawn } from 'node:child_process';
import type { CommitMessageGeneratorPort } from '../../application/ports/commit-message-generator-port.js';
import { DomainError } from '../../domain/errors.js';

export const CLAUDE_TIMEOUT_MS = 60_000;
const STDERR_MAX_CHARS = 4_096;

export interface ClaudeCliGeneratorOptions {
  /** Executable name or path; overridable so tests can point at a fake. */
  bin?: string;
  /** Working directory of the spawned CLI — the workspace root. */
  cwd: string;
  timeoutMs?: number;
}

/**
 * Generates text with the user's own `claude` CLI, headless (`-p`). The prompt
 * goes through stdin, never argv. Tools are off, nothing is persisted under
 * `~/.claude`, and user-level settings/memory are skipped so personal rules
 * don't leak into a project's commit message.
 */
export class ClaudeCliCommitMessageGenerator implements CommitMessageGeneratorPort {
  private readonly bin: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: ClaudeCliGeneratorOptions) {
    this.bin = options.bin ?? 'claude';
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  }

  generate(prompt: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.bin,
        ['-p', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--setting-sources', 'project,local'],
        { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], ...(signal ? { signal } : {}) },
      );
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() => reject(new DomainError('io', 'ClaudeTimeout')));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.once('error', (err: NodeJS.ErrnoException) => {
        settle(() => {
          if (err.code === 'ENOENT') {
            reject(new DomainError('not_found', `Command not found: ${this.bin}. Install Claude Code and make sure it is on PATH.`));
          } else {
            reject(new DomainError('io', err.name === 'AbortError' ? 'Aborted' : err.message));
          }
        });
      });
      child.once('close', (code) => {
        settle(() => {
          if (code !== 0) {
            reject(new DomainError('io', `${this.bin} exited with code ${code}`, { stderr: stderr.slice(0, STDERR_MAX_CHARS) }));
            return;
          }
          const message = cleanOutput(stdout);
          if (message.length === 0) reject(new DomainError('io', `${this.bin} returned an empty message`));
          else resolve(message);
        });
      });
      // A child that dies early closes stdin; the exit code reports the failure.
      child.stdin.on('error', () => undefined);
      child.stdin.end(prompt);
    });
  }
}

/** Strips a wrapping code fence and wrapping quotes the model sometimes adds despite instructions. */
export function cleanOutput(raw: string): string {
  let text = raw.trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(text);
  if (quoted?.[2] !== undefined && !quoted[2].includes(quoted[1] ?? '')) text = quoted[2].trim();
  return text;
}
