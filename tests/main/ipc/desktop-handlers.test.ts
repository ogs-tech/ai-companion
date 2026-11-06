import { describe, expect, it, vi } from 'vitest';
import { buildDesktopHandlers } from '../../../src/main/ipc/desktop-handlers.js';
import { DomainError } from '../../../src/main/domain/errors.js';

function setup() {
  const deps = {
    logger: { directory: '/logs', error: vi.fn(), info: vi.fn() },
    setWindowTitle: vi.fn(),
    respondToQuit: vi.fn(),
    openLogsFolder: vi.fn().mockResolvedValue(undefined),
  };
  return { deps, handlers: buildDesktopHandlers(deps) };
}

describe('desktop handlers', () => {
  it('desktop.setWindowTitle forwards title and edited flag', async () => {
    const { deps, handlers } = setup();
    await handlers['desktop.setWindowTitle']!({ title: 'a.md - acme', edited: true });
    expect(deps.setWindowTitle).toHaveBeenCalledWith('a.md - acme', true);
  });

  it('desktop.setWindowTitle rejects a non-boolean edited flag', async () => {
    const { handlers } = setup();
    await expect(handlers['desktop.setWindowTitle']!({ title: 't', edited: 'yes' })).rejects.toBeInstanceOf(DomainError);
  });

  it('desktop.respondToQuit forwards requestId and proceed', async () => {
    const { deps, handlers } = setup();
    await handlers['desktop.respondToQuit']!({ requestId: 'r1', proceed: false });
    expect(deps.respondToQuit).toHaveBeenCalledWith('r1', false);
  });

  it('desktop.respondToQuit requires a requestId', async () => {
    const { handlers } = setup();
    await expect(handlers['desktop.respondToQuit']!({ proceed: true })).rejects.toBeInstanceOf(DomainError);
  });

  it('desktop.reportError logs a renderer entry', async () => {
    const { deps, handlers } = setup();
    await handlers['desktop.reportError']!({ source: 'renderer', message: 'bad', stack: 'at x' });
    expect(deps.logger.error).toHaveBeenCalledWith({ process: 'renderer', message: 'bad', stack: 'at x' });
  });

  it('desktop.reportError accepts a missing stack and rejects another source', async () => {
    const { deps, handlers } = setup();
    await handlers['desktop.reportError']!({ source: 'renderer', message: 'bad' });
    expect(deps.logger.error).toHaveBeenCalledWith({ process: 'renderer', message: 'bad', stack: undefined });
    await expect(handlers['desktop.reportError']!({ source: 'main', message: 'x' })).rejects.toBeInstanceOf(DomainError);
  });

  it('desktop.openLogsFolder delegates', async () => {
    const { deps, handlers } = setup();
    await handlers['desktop.openLogsFolder']!(undefined);
    expect(deps.openLogsFolder).toHaveBeenCalled();
  });
});
