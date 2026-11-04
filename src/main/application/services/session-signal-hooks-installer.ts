import type { MergeMaterializer } from './merge-materializer.js';
import { CURSOR_SIGNAL_HOOKS } from '../session-activity.js';

/**
 * Cursor reads hooks only from `hooks.json`, never per invocation, so the
 * activity hooks are merged into it once. Each hook is a no-op unless the
 * app's `AI_COMPANION_SIGNAL_FILE` is set, so Cursor outside the app is
 * unaffected. Goes through {@link MergeMaterializer}: only these two entries
 * are touched, every other key of the user's file is left alone.
 */
export class SessionSignalHooksInstaller {
  constructor(
    private readonly merge: Pick<MergeMaterializer, 'apply'>,
    private readonly hooksFile: string,
  ) {}

  async install(): Promise<void> {
    for (const [event, command] of Object.entries(CURSOR_SIGNAL_HOOKS)) {
      await this.merge.apply({
        file: this.hooksFile,
        target: { shape: 'array-item', path: ['hooks', event], identity: { command }, value: { command } },
        seed: { version: 1 },
      });
    }
  }
}
