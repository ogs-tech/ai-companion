import { dialog, BrowserWindow, type OpenDialogOptions } from 'electron';
import type {
  DialogPort,
  SelectApplicationResult,
  SelectFolderParams,
  SelectFolderResult,
} from '../../application/ports/dialog-port.js';

export class ElectronDialogAdapter implements DialogPort {
  async selectFolder(params: SelectFolderParams): Promise<SelectFolderResult> {
    const focused = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
    };
    if (params.defaultPath !== undefined) {
      options.defaultPath = params.defaultPath;
    }

    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);

    const picked = result.filePaths[0];
    if (result.canceled || picked === undefined) {
      return { canceled: true };
    }
    return { canceled: false, path: picked };
  }

  async selectApplication(): Promise<SelectApplicationResult> {
    const focused = BrowserWindow.getFocusedWindow();
    // An .app is a directory, so it only shows up as a selectable *file* with
    // treatPackageAsDirectory left off — otherwise the picker descends into it.
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      defaultPath: '/Applications',
      filters: [{ name: 'Applications', extensions: ['app'] }],
    };

    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);

    const picked = result.filePaths[0];
    if (result.canceled || picked === undefined) {
      return { canceled: true };
    }
    return { canceled: false, path: picked };
  }
}
