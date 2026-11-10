import type { ChannelId } from './channel.js';

/** Where a channel stands on this machine. `signedIn: null` = the channel has no account to sign in to. */
export interface ChannelStatus {
  channelId: ChannelId;
  installed: boolean;
  /** First line of the CLI's `--version` output; absent when not installed. */
  version?: string;
  signedIn: boolean | null;
}

export type ChannelSetupAction = 'install' | 'login';

/** `terminal` = a PTY was started (stream it with `terminal:output` under `terminalId`); `opened` = the vendor page was opened. */
export type ChannelSetupStart =
  | { kind: 'terminal'; terminalId: string; title: string }
  | { kind: 'opened'; url: string };

export interface ChannelSetupTerminal {
  terminalId: string;
  status: 'running' | 'exited';
  exitCode: number | null;
  outputBuffer: string;
}
