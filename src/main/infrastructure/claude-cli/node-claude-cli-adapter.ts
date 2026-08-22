import { spawn } from 'node:child_process';
import type {
  ClaudeCliGenerateParams,
  ClaudeCliGenerateResult,
  ClaudeCliPort,
} from '../../application/ports/claude-cli-port.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

interface StreamJsonLine {
  type?: string;
  subtype?: string;
  status?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  result?: string;
  is_error?: boolean;
}

/**
 * Shells out to the user's locally installed `claude` CLI in headless print
 * mode, parsing its NDJSON stream (`--output-format stream-json
 * --include-partial-messages`) so callers can observe live progress via
 * `onEvent` instead of waiting on the full buffered response. `--tools ""`
 * disables the built-in tool set so the child process only generates text —
 * it never reads/writes files or runs commands on the user's behalf.
 * `--no-session-persistence` and `--disable-slash-commands` keep this
 * one-shot call from leaking into the user's normal Claude Code session
 * history or triggering a skill.
 */
export class NodeClaudeCliAdapter implements ClaudeCliPort {
  // `bin` is overridable so tests can point at a stub script and exercise the
  // real ENOENT/timeout/non-zero-exit branches without depending on `claude`
  // being installed. Production always uses the default (resolved via PATH).
  constructor(private readonly bin = 'claude') {}

  generate({
    prompt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onEvent,
  }: ClaudeCliGenerateParams): Promise<ClaudeCliGenerateResult> {
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--tools', '',
      '--no-session-persistence',
      '--disable-slash-commands',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args);

      let lineBuffer = '';
      let stderr = '';
      let bufferedBytes = 0;
      let finalText: string | null = null;
      let exitCode: number | null = null;
      let timedOut = false;
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      // The timeout must be able to settle the promise on its own: if the
      // process already exited on its own (see the 'exit' handler below) by
      // the time this fires, `child.kill()` is a no-op and no further process
      // event will ever arrive to reject with.
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        finish(() => reject(new Error(`claude CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      const handleLine = (line: string): void => {
        if (line.trim().length === 0) return;
        let parsed: StreamJsonLine;
        try {
          parsed = JSON.parse(line) as StreamJsonLine;
        } catch {
          return; // Malformed/partial line — ignore rather than fail the whole call.
        }

        if (parsed.type === 'system') {
          const phase = parsed.subtype === 'status' && parsed.status === 'requesting'
            ? 'requesting'
            : 'starting';
          onEvent?.({ phase });
          return;
        }

        if (
          parsed.type === 'stream_event' &&
          parsed.event?.type === 'content_block_delta' &&
          parsed.event.delta?.type === 'text_delta'
        ) {
          const text = parsed.event.delta.text ?? '';
          if (text) onEvent?.({ phase: 'writing', textDelta: text });
          return;
        }

        if (parsed.type === 'result') {
          finalText = (parsed.result ?? '').trim();
          if (parsed.is_error) {
            finish(() => reject(new Error(`claude CLI reported an error: ${finalText || 'unknown error'}`)));
            return;
          }
          onEvent?.({ phase: 'done' });
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        bufferedBytes += chunk.length;
        if (bufferedBytes > MAX_BUFFER_BYTES) {
          finish(() => {
            child.kill();
            reject(new Error('claude CLI output exceeded the buffer limit'));
          });
          return;
        }
        lineBuffer += chunk.toString('utf8');
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        finish(() => {
          if (err.code === 'ENOENT') {
            reject(new Error('claude CLI not found in PATH'));
          } else {
            reject(err);
          }
        });
      });

      const finalize = (): void => {
        if (settled) return;
        if (lineBuffer.trim().length > 0) handleLine(lineBuffer);

        finish(() => {
          if (timedOut) {
            reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
            return;
          }
          if (exitCode !== 0) {
            const detail = stderr.trim() || `exited with code ${exitCode}`;
            reject(new Error(`claude CLI failed: ${detail}`));
            return;
          }
          if (finalText === null) {
            reject(new Error('claude CLI closed without producing a result'));
            return;
          }
          resolve({ text: finalText });
        });
      };

      // 'close' waits for every process holding the child's stdio pipes to
      // exit — including a grandchild a hook or MCP server spawned that
      // didn't detach its inherited pipes, which can hang well past the CLI's
      // own completion (observed: a "Gerar com IA" call left hanging for
      // minutes after the model had already finished responding). Once the
      // CLI's own process exits, don't wait on that indefinitely — give
      // already-buffered stdout a brief moment to arrive, then finalize with
      // whatever's been parsed so far.
      child.on('exit', (code) => {
        exitCode = code;
        setTimeout(finalize, 300);
      });

      child.on('close', finalize);
    });
  }
}
