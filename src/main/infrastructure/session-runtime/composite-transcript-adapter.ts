import type { HarnessId } from '../../../shared/harness.js';
import type { SessionMetrics } from '../../../shared/session-metrics.js';
import type {
  SessionTranscriptPort,
  TranscriptRef,
  TranscriptUsage,
} from '../../application/ports/session-transcript-port.js';

/** One history over several harnesses: lists them all and routes each reading to the harness that wrote it. */
export class CompositeTranscriptAdapter implements SessionTranscriptPort {
  constructor(private readonly byHarness: Readonly<Partial<Record<HarnessId, SessionTranscriptPort>>>) {}

  async listRefs(): Promise<TranscriptRef[]> {
    const lists = await Promise.all(Object.values(this.byHarness).map((port) => port.listRefs()));
    return lists.flat();
  }

  readUsage(ref: TranscriptRef): Promise<TranscriptUsage> {
    const port = this.byHarness[ref.harness];
    if (!port) return Promise.reject(new Error(`No transcript reader for harness '${ref.harness}'`));
    return port.readUsage(ref);
  }

  async readLiveMetrics(conversationId: string): Promise<SessionMetrics | null> {
    for (const port of Object.values(this.byHarness)) {
      const metrics = await port.readLiveMetrics(conversationId);
      if (metrics) return metrics;
    }
    return null;
  }
}
