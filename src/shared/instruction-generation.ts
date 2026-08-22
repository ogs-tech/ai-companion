/** Lifecycle phases surfaced while `instruction.generateDraft` streams from the local `claude` CLI. */
export type GenerateDraftPhase = 'starting' | 'requesting' | 'writing' | 'done';

export interface GenerateDraftProgressEvent {
  phase: GenerateDraftPhase;
  /** Incremental text as the model writes the draft — only set on `writing` events. */
  textDelta?: string;
}

/** Push channel main→renderer for live `instruction.generateDraft` progress (outside the request/response `ipc:call` envelope). */
export const INSTRUCTION_GENERATE_PROGRESS_CHANNEL = 'instruction:generateDraft:progress' as const;
