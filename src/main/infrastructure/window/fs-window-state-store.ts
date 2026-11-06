import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WindowState, WindowStatePort } from '../../application/ports/window-state-port.js';
import { parseWindowState } from '../../application/desktop/window-bounds.js';

export class FsWindowStateStore implements WindowStatePort {
  constructor(private readonly filePath: string) {}

  load(): WindowState | null {
    try {
      return parseWindowState(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  save(state: WindowState): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(state), 'utf8');
    } catch (error) {
      console.error('[window-state] could not save:', error);
    }
  }
}
