import type { IpcHandlers } from './dispatcher.js';
import type { CustomizationStatusService } from '../application/services/customization-status-service.js';

export function buildCustomizationStatusHandlers(service: CustomizationStatusService): IpcHandlers {
  return {
    'customization.status': async () => service.getReport(),
  };
}
