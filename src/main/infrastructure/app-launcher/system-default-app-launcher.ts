import { shell } from 'electron';
import type { AppLauncherPort, AppQueryResult } from '../../application/ports/app-launcher-port.js';
import { DomainError } from '../../domain/errors.js';

/**
 * The launcher for platforms where application discovery isn't implemented.
 * Opening and revealing still work — those are Electron's own, and portable —
 * so the context menu degrades to "abrir com o aplicativo padrão" and
 * "revelar no gerenciador de arquivos" rather than disappearing.
 */
export class SystemDefaultAppLauncher implements AppLauncherPort {
  async listApplicationsFor(): Promise<AppQueryResult> {
    return { candidates: [] };
  }

  async identify(): Promise<undefined> {
    return undefined;
  }

  async iconFor(): Promise<string | undefined> {
    return undefined;
  }

  async openWith(): Promise<void> {
    throw new DomainError(
      'validation',
      'Escolher o aplicativo só é suportado no macOS nesta versão',
    );
  }

  async openDefault(absolutePath: string): Promise<void> {
    const failure = await shell.openPath(absolutePath);
    if (failure !== '') {
      throw new DomainError('io', `Não foi possível abrir com o aplicativo padrão: ${failure}`);
    }
  }

  async reveal(absolutePath: string): Promise<void> {
    shell.showItemInFolder(absolutePath);
  }
}
