import type { HarnessId } from '../../../shared/harness.js';
import type { SessionSignal } from './session-signal-port.js';

/** A hook signal written by a session the app did not spawn. */
export interface ExternalSignal {
  harness: HarnessId;
  /** The harness's conversation id, taken from the file name the hook wrote to. */
  id: string;
  signal: SessionSignal;
}

/** One OS-level watcher on `~/.ai-companion/signals/external/`; no polling. */
export interface ExternalSignalSourcePort {
  onSignal(listener: (signal: ExternalSignal) => void): void;
  start(): Promise<void>;
  stop(): void;
}

/** A transcript that just grew: only its tail was read. */
export interface TranscriptChange {
  id: string;
  harness: HarnessId;
  cwd: string | null;
  /** Epoch ms of the file's last modification. */
  modifiedAt: number;
  /** The CLI's own title for the conversation (`customTitle` wins over `aiTitle`), when the tail carries one. */
  title?: string;
}

/** Fallback for sessions with no hooks: a watcher on the harness's transcript directory. */
export interface TranscriptWatchPort {
  onChange(listener: (change: TranscriptChange) => void): void;
  start(): Promise<void>;
  stop(): void;
  /** The last readable lines of one conversation, for the read-only "Observar" view. */
  tail(id: string, maxBytes: number): Promise<string>;
}

export interface LiveProcess {
  pid: number;
  harness: HarnessId;
  cwd: string | null;
  /** Hosting terminal / editor, from the process ancestry. */
  terminal: string | null;
  /** Conversation id when the command line names it (`--resume <id>`, `--session-id <id>`). */
  conversationId: string | null;
}

/** `ps`-style listing of live `claude` / `cursor-agent` processes. */
export interface ProcessScanPort {
  scan(): Promise<LiveProcess[]>;
}
