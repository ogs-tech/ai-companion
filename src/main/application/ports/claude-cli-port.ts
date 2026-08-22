import type { GenerateDraftProgressEvent } from '../../../shared/instruction-generation.js';

export interface ClaudeCliGenerateParams {
  prompt: string;
  timeoutMs?: number;
  /** Called synchronously as the CLI streams progress; omit for a plain one-shot call. */
  onEvent?: (event: GenerateDraftProgressEvent) => void;
}

export interface ClaudeCliGenerateResult {
  text: string;
}

/** Runs a one-shot, tool-free prompt through the user's locally installed `claude` CLI. */
export interface ClaudeCliPort {
  generate(params: ClaudeCliGenerateParams): Promise<ClaudeCliGenerateResult>;
}
