import { shell } from 'electron';
import type { TrashPort } from '../../application/ports/trash-port.js';

export class ElectronTrash implements TrashPort {
  async trash(absPath: string): Promise<void> {
    await shell.trashItem(absPath);
  }
}
