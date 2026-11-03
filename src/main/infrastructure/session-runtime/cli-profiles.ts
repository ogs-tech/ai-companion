import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Everything that differs between harness CLIs when one PTY runs a
 * conversation: how a conversation is named, started and reattached. The
 * `NodePtySessionAdapter` owns the PTY mechanics once; a profile owns the
 * flags.
 */
export interface CliProfile {
  /** Obtains the id of a brand-new conversation, before the process starts. */
  newConversationId(ctx: { bin: string; cwd: string; env: NodeJS.ProcessEnv }): Promise<string>;
  /** Args that create the conversation `conversationId`. */
  startArgs(conversationId: string): string[];
  /** Args that reattach to the conversation `conversationId`. */
  resumeArgs(conversationId: string): string[];
  /**
   * Output the CLI prints when asked to resume a conversation it cannot find.
   * When set, a `resume` that hits it is retried once as a `start` under the
   * same id; `null` disables the retry.
   */
  missingConversationMarker: string | null;
  /** Whether the CLI accepts the embedded browser's `--mcp-config` file. */
  supportsMcpConfig: boolean;
}

/** `claude` accepts a caller-chosen UUID, so the transcript's name is known up front. */
export const CLAUDE_PROFILE: CliProfile = {
  newConversationId: async () => randomUUID(),
  startArgs: (id) => ['--session-id', id],
  resumeArgs: (id) => ['--resume', id],
  // `claude` refuses rather than falling back: `--resume <id>` prints
  // "No conversation found with session ID: <id>" and exits 1.
  missingConversationMarker: 'No conversation found',
  supportsMcpConfig: true,
};

/**
 * `cursor-agent` cannot be told which id to use, but `create-chat` mints one
 * and prints it; `--resume <id>` then opens that empty chat, so starting and
 * resuming are the same invocation.
 */
export const CURSOR_PROFILE: CliProfile = {
  newConversationId: ({ bin, cwd, env }) =>
    new Promise((resolve, reject) => {
      execFile(bin, ['create-chat'], { cwd, env, timeout: 15_000 }, (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const id = stdout.trim().split('\n').pop()?.trim() ?? '';
        if (id === '') reject(new Error('cursor-agent create-chat returned no chat id'));
        else resolve(id);
      });
    }),
  startArgs: (id) => ['--resume', id],
  resumeArgs: (id) => ['--resume', id],
  missingConversationMarker: null,
  supportsMcpConfig: false,
};
