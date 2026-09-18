import { vi, describe, it, expect, beforeEach } from 'vitest';
import { DomainError } from '../../../../src/main/domain/errors.js';

const openPathMock = vi.hoisted(() => vi.fn());
const showItemInFolderMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  shell: { openPath: openPathMock, showItemInFolder: showItemInFolderMock },
}));

const { SystemDefaultAppLauncher } = await import(
  '../../../../src/main/infrastructure/app-launcher/system-default-app-launcher.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  openPathMock.mockResolvedValue('');
});

describe('SystemDefaultAppLauncher', () => {
  it('offers no applications, so the menu falls back to the default handler', async () => {
    await expect(new SystemDefaultAppLauncher().listApplicationsFor()).resolves.toEqual({ candidates: [] });
  });

  it('identifies nothing, since it cannot read bundles', async () => {
    await expect(new SystemDefaultAppLauncher().identify()).resolves.toBeUndefined();
  });

  it('has no icons to offer', async () => {
    await expect(new SystemDefaultAppLauncher().iconFor()).resolves.toBeUndefined();
  });

  it('refuses to launch a specific application, with a validation error naming why', async () => {
    const error = await new SystemDefaultAppLauncher().openWith().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).kind).toBe('validation');
    expect((error as DomainError).message).toMatch(/macOS/);
  });

  it('still opens with the default handler, which is portable', async () => {
    await new SystemDefaultAppLauncher().openDefault('/repos/acme/README.md');

    expect(openPathMock).toHaveBeenCalledWith('/repos/acme/README.md');
  });

  it('reports a refused default-handler launch as an io error', async () => {
    openPathMock.mockResolvedValue('no application knows this type');

    const error = await new SystemDefaultAppLauncher()
      .openDefault('/repos/acme/README.md')
      .catch((err: unknown) => err);

    expect((error as DomainError).kind).toBe('io');
  });

  it('still reveals in the file manager, which is portable too', async () => {
    await new SystemDefaultAppLauncher().reveal('/repos/acme/README.md');

    expect(showItemInFolderMock).toHaveBeenCalledWith('/repos/acme/README.md');
  });
});
