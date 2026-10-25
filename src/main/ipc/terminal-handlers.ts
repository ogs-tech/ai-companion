import type { IpcHandlers } from './dispatcher.js';
import type { TerminalService } from '../application/services/terminal-service.js';
import { DomainError } from '../domain/errors.js';
import { asObject, asOptString, asRawString, asString, optParams } from './_validators.js';

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new DomainError('validation', `Missing or invalid '${field}'`);
  }
  return value;
}

export function buildTerminalHandlers(terminalService: TerminalService): IpcHandlers {
  return {
    'terminal.create': async (params) => {
      const raw = optParams(params, 'terminal.create');
      return terminalService.createShell(asOptString(raw['relCwd'], 'relCwd') ?? '');
    },
    'terminal.write': async (params) => {
      const raw = asObject(params, 'terminal.write');
      terminalService.write(asString(raw['terminalId'], 'terminalId'), asRawString(raw['data'], 'data'));
    },
    'terminal.resize': async (params) => {
      const raw = asObject(params, 'terminal.resize');
      terminalService.resize(
        asString(raw['terminalId'], 'terminalId'),
        asPositiveInt(raw['cols'], 'cols'),
        asPositiveInt(raw['rows'], 'rows'),
      );
    },
    'terminal.kill': async (params) => {
      const raw = asObject(params, 'terminal.kill');
      terminalService.kill(asString(raw['terminalId'], 'terminalId'));
    },
    'terminal.restart': async (params) => {
      const raw = asObject(params, 'terminal.restart');
      return terminalService.restart(asString(raw['terminalId'], 'terminalId'));
    },
    'terminal.remove': async (params) => {
      const raw = asObject(params, 'terminal.remove');
      terminalService.remove(asString(raw['terminalId'], 'terminalId'));
    },
    'terminal.list': async () => terminalService.list(),
    'terminal.status': async (params) => {
      const raw = asObject(params, 'terminal.status');
      return terminalService.status(asString(raw['terminalId'], 'terminalId')) ?? null;
    },
  };
}
