import type {
  ClaudeCliGenerateParams,
  ClaudeCliGenerateResult,
  ClaudeCliPort,
} from '../../ports/claude-cli-port.js';
import type { GenerateDraftProgressEvent } from '../../../../shared/instruction-generation.js';

export class FakeClaudeCliPort implements ClaudeCliPort {
  private nextText = 'fake generated content';
  private nextFailure: Error | null = null;
  lastPrompt: string | undefined;
  lastOnEvent: ((event: GenerateDraftProgressEvent) => void) | undefined;

  seedResponse(text: string): void {
    this.nextText = text;
  }

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  async generate(params: ClaudeCliGenerateParams): Promise<ClaudeCliGenerateResult> {
    this.lastPrompt = params.prompt;
    this.lastOnEvent = params.onEvent;
    if (this.nextFailure !== null) {
      const err = this.nextFailure;
      this.nextFailure = null;
      throw err;
    }
    return { text: this.nextText };
  }
}
