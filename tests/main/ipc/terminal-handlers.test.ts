import { describe, it, expect, vi } from 'vitest';
import { buildTerminalHandlers } from '../../../src/main/ipc/terminal-handlers.js';
import type { TerminalService } from '../../../src/main/application/services/terminal-service.js';

const setup = () => {
  const service = {
    createShell: vi.fn().mockResolvedValue({ terminalId: 't1' }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    restart: vi.fn().mockResolvedValue({ terminalId: 't1' }),
    remove: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    status: vi.fn().mockReturnValue(undefined),
  } as unknown as TerminalService;
  return { service, handlers: buildTerminalHandlers(service) };
};

describe('terminal-handlers', () => {
  it('terminal.create defaults to the root and passes a relative folder through', async () => {
    const { handlers, service } = setup();
    await handlers['terminal.create']!(undefined);
    await handlers['terminal.create']!({ relCwd: 'apps/console' });
    expect(service.createShell).toHaveBeenNthCalledWith(1, '');
    expect(service.createShell).toHaveBeenNthCalledWith(2, 'apps/console');
  });

  it('terminal.write accepts an empty-looking payload but requires a terminalId', async () => {
    const { handlers, service } = setup();
    await handlers['terminal.write']!({ terminalId: 't1', data: '\r' });
    expect(service.write).toHaveBeenCalledWith('t1', '\r');
    await expect(handlers['terminal.write']!({ data: 'x' })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('terminal.resize requires positive integer dimensions', async () => {
    const { handlers, service } = setup();
    await handlers['terminal.resize']!({ terminalId: 't1', cols: 100, rows: 30 });
    expect(service.resize).toHaveBeenCalledWith('t1', 100, 30);
    await expect(handlers['terminal.resize']!({ terminalId: 't1', cols: 0, rows: 30 })).rejects.toMatchObject({ kind: 'validation' });
    await expect(handlers['terminal.resize']!({ terminalId: 't1', cols: 1.5, rows: 30 })).rejects.toMatchObject({ kind: 'validation' });
  });

  it.each(['kill', 'restart', 'remove', 'status'] as const)('terminal.%s validates terminalId and delegates', async (verb) => {
    const { handlers, service } = setup();
    await handlers[`terminal.${verb}`]!({ terminalId: 't1' });
    expect(service[verb]).toHaveBeenCalledWith('t1');
    await expect(handlers[`terminal.${verb}`]!({})).rejects.toMatchObject({ kind: 'validation' });
  });

  it('terminal.status returns null for an unknown terminal', async () => {
    const { handlers } = setup();
    expect(await handlers['terminal.status']!({ terminalId: 'nope' })).toBeNull();
  });

  it('terminal.list delegates', async () => {
    const { handlers, service } = setup();
    await handlers['terminal.list']!({});
    expect(service.list).toHaveBeenCalled();
  });
});
