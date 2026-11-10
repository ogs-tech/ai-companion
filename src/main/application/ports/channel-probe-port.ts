export interface ProbeResult {
  /** False when the executable could not be found or started. */
  found: boolean;
  exitCode: number | null;
  output: string;
}

/** Runs a channel's own CLI once (version, auth status) and reports what it printed. Never throws. */
export interface ChannelProbePort {
  run(bin: string, args: readonly string[]): Promise<ProbeResult>;
}
