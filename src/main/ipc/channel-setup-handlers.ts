import type { IpcHandlers } from './dispatcher.js';
import type { ChannelSetupService } from '../application/services/channel-setup-service.js';
import { isChannelId, type ChannelId } from '../../shared/channel.js';
import type { ChannelSetupAction } from '../../shared/channel-setup.js';
import { DomainError } from '../domain/errors.js';
import { asObject, asRawString, asString } from './_validators.js';

function asChannel(value: unknown): ChannelId {
  const id = asString(value, 'channelId');
  if (!isChannelId(id)) throw new DomainError('validation', `Unknown channel '${id}'`);
  return id;
}

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new DomainError('validation', `Invalid '${field}'`);
  return value;
}

export function buildChannelSetupHandlers(service: ChannelSetupService): IpcHandlers {
  return {
    'channelSetup.status': async (params) => service.status(asChannel(asObject(params, 'channelSetup.status')['channelId'])),
    'channelSetup.start': async (params) => {
      const p = asObject(params, 'channelSetup.start');
      const action = asString(p['action'], 'action');
      if (action !== 'install' && action !== 'login') throw new DomainError('validation', "Invalid 'action': expected 'install' | 'login'");
      return service.start(asChannel(p['channelId']), action as ChannelSetupAction);
    },
    'channelSetup.terminal': async (params) => service.terminal(asString(asObject(params, 'channelSetup.terminal')['terminalId'], 'terminalId')),
    'channelSetup.write': async (params) => {
      const p = asObject(params, 'channelSetup.write');
      service.write(asString(p['terminalId'], 'terminalId'), asRawString(p['data'], 'data'));
    },
    'channelSetup.resize': async (params) => {
      const p = asObject(params, 'channelSetup.resize');
      service.resize(asString(p['terminalId'], 'terminalId'), asPositiveInt(p['cols'], 'cols'), asPositiveInt(p['rows'], 'rows'));
    },
    'channelSetup.close': async (params) => service.close(asString(asObject(params, 'channelSetup.close')['terminalId'], 'terminalId')),
  };
}
