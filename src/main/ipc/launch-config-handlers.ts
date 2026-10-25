import type { IpcHandlers } from './dispatcher.js';
import type { LaunchConfigService } from '../application/services/launch-config-service.js';
import type { TerminalService } from '../application/services/terminal-service.js';
import { asObject, asString } from './_validators.js';

export function buildLaunchConfigHandlers(
  configService: LaunchConfigService,
  terminalService: TerminalService,
): IpcHandlers {
  return {
    'launchConfig.list': async () => configService.list(),
    // A launch is a terminal that runs the configuration's command; stop/status are the `terminal.*` methods.
    'launchConfig.run': async (params) => {
      const raw = asObject(params, 'launchConfig.run');
      return terminalService.runLaunch(asString(raw['configName'], 'configName'));
    },
  };
}
