import { describe, it, expect, vi } from 'vitest';
import { OpenWithService } from '../../../../src/main/application/services/open-with-service.js';
import { SettingsService } from '../../../../src/main/application/services/settings-service.js';
import type { SettingsRepository } from '../../../../src/main/application/ports/settings-repository.js';
import type { AppLauncherPort, AppCandidate } from '../../../../src/main/application/ports/app-launcher-port.js';
import { OPEN_WITH_PRIMARY_LIMIT } from '../../../../src/shared/open-with.js';
import type { Settings } from '../../../../src/shared/settings.js';

const app = (id: string, name: string, path: string): AppCandidate => ({ id, name, path });

const fakeLauncher = (overrides: Partial<AppLauncherPort> = {}): AppLauncherPort => ({
  listApplicationsFor: vi.fn().mockResolvedValue({ candidates: [] }),
  identify: vi.fn().mockResolvedValue(undefined),
  iconFor: vi.fn().mockResolvedValue(undefined),
  openWith: vi.fn().mockResolvedValue(undefined),
  openDefault: vi.fn().mockResolvedValue(undefined),
  reveal: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const baseSettings = (): Settings => ({
  adapters: { claude: { enabled: true }, cursor: { enabled: false } },
  ui: { theme: 'system' },
  language: 'off',
});

function settingsService(initial: Settings = baseSettings()): { service: SettingsService; saved: Settings[] } {
  let current = initial;
  const saved: Settings[] = [];
  const repo: SettingsRepository = {
    load: async () => current,
    save: async (s) => {
      current = s;
      saved.push(s);
    },
  };
  return { service: new SettingsService(repo), saved };
}

const names = (apps: { name: string }[]): string[] => apps.map((a) => a.name);

describe('OpenWithService.suggest', () => {
  it('asks the launcher about the path it was given', async () => {
    const launcher = fakeLauncher();
    const service = new OpenWithService(launcher, settingsService().service);

    await service.suggest('/repos/acme/README.md', 'file');

    expect(launcher.listApplicationsFor).toHaveBeenCalledWith('/repos/acme/README.md');
  });

  it('drops an application bundled inside a dot-prefixed directory', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.example.Editor', 'Editor', '/Users/me/.vscode/extensions/x/Editor.app'),
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['TextEdit']);
  });

  it('drops an application cached under Library/Caches', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.google.Chrome', 'Chrome for Testing', '/Users/me/Library/Caches/ms-playwright/chromium-1234/Google Chrome for Testing.app'),
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['TextEdit']);
  });

  it('drops an application inside node_modules', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.example.Bundled', 'Bundled', '/repos/acme/node_modules/electron/dist/Electron.app'),
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['TextEdit']);
  });

  it('keeps one entry per bundle id, preferring the copy in /Applications', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Volumes/Backup/Visual Studio Code.app'),
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/index.ts', 'file');

    expect(result.primary).toHaveLength(1);
    expect(result.primary[0]?.path).toBe('/Applications/Visual Studio Code.app');
  });

  it('puts the OS default first and marks it', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
        ],
        defaultAppId: 'com.apple.TextEdit',
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['TextEdit', 'Visual Studio Code']);
    expect(result.primary[0]?.isDefault).toBe(true);
    expect(result.primary[1]?.isDefault).toBe(false);
  });

  it('puts the remembered application above the OS default and marks it', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
        ],
        defaultAppId: 'com.apple.TextEdit',
      }),
    });
    const { service: settings } = settingsService({ ...baseSettings(), openWith: { '.md': 'com.microsoft.VSCode' } });
    const service = new OpenWithService(launcher, settings);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['Visual Studio Code', 'TextEdit']);
    expect(result.primary[0]?.isRemembered).toBe(true);
  });

  it('orders curated applications by catalog rank below the default', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app'),
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(names(result.primary)).toEqual(['Visual Studio Code', 'TextEdit']);
  });

  it('orders applications the catalog does not know alphabetically, after the curated ones', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [
          app('com.example.Zeta', 'Zeta', '/Applications/Zeta.app'),
          app('com.example.Alpha', 'Alpha', '/Applications/Alpha.app'),
          app('com.microsoft.VSCode', 'Visual Studio Code', '/Applications/Visual Studio Code.app'),
        ],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/index.ts', 'file');

    expect(names(result.primary)).toEqual(['Visual Studio Code', 'Alpha', 'Zeta']);
  });

  it('caps the primary list and spills the remainder into more', async () => {
    const candidates = Array.from({ length: OPEN_WITH_PRIMARY_LIMIT + 3 }, (_, i) =>
      app(`com.example.App${i}`, `App ${String(i).padStart(2, '0')}`, `/Applications/App${i}.app`),
    );
    const launcher = fakeLauncher({ listApplicationsFor: vi.fn().mockResolvedValue({ candidates }) });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/index.ts', 'file');

    expect(result.primary).toHaveLength(OPEN_WITH_PRIMARY_LIMIT);
    expect(result.more).toHaveLength(3);
    expect(result.primary[0]?.name).toBe('App 00');
    expect(result.more[0]?.name).toBe(`App ${String(OPEN_WITH_PRIMARY_LIMIT).padStart(2, '0')}`);
  });

  it('attaches the icon the launcher reports for each application', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app')],
      }),
      iconFor: vi.fn().mockResolvedValue('data:image/png;base64,AAA'),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(launcher.iconFor).toHaveBeenCalledWith('/System/Applications/TextEdit.app');
    expect(result.primary[0]?.iconDataUrl).toBe('data:image/png;base64,AAA');
  });

  it('omits the icon field entirely when the launcher cannot read one', async () => {
    const launcher = fakeLauncher({
      listApplicationsFor: vi.fn().mockResolvedValue({
        candidates: [app('com.apple.TextEdit', 'TextEdit', '/System/Applications/TextEdit.app')],
      }),
    });
    const service = new OpenWithService(launcher, settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(result.primary[0]).not.toHaveProperty('iconDataUrl');
  });

  it('returns empty suggestions when the platform offers none', async () => {
    const service = new OpenWithService(fakeLauncher(), settingsService().service);

    const result = await service.suggest('/repos/acme/README.md', 'file');

    expect(result).toEqual({ primary: [], more: [] });
  });
});

describe('OpenWithService.open', () => {
  it('launches the chosen application with the path', async () => {
    const launcher = fakeLauncher();
    const service = new OpenWithService(launcher, settingsService().service);

    await service.open('/repos/acme/README.md', 'file', {
      id: 'com.microsoft.VSCode',
      path: '/Applications/Visual Studio Code.app',
    });

    expect(launcher.openWith).toHaveBeenCalledWith('/repos/acme/README.md', '/Applications/Visual Studio Code.app');
  });

  it('remembers the choice under the extension key', async () => {
    const { service: settings, saved } = settingsService();
    const service = new OpenWithService(fakeLauncher(), settings);

    await service.open('/repos/acme/README.md', 'file', {
      id: 'com.microsoft.VSCode',
      path: '/Applications/Visual Studio Code.app',
    });

    expect(saved.at(-1)?.openWith).toEqual({ '.md': 'com.microsoft.VSCode' });
  });

  it('remembers a folder choice under the shared dir key', async () => {
    const { service: settings, saved } = settingsService();
    const service = new OpenWithService(fakeLauncher(), settings);

    await service.open('/repos/acme/src', 'dir', {
      id: 'com.apple.finder',
      path: '/System/Library/CoreServices/Finder.app',
    });

    expect(saved.at(-1)?.openWith).toEqual({ dir: 'com.apple.finder' });
  });

  it('does not remember anything when the launch itself failed', async () => {
    const { service: settings, saved } = settingsService();
    const launcher = fakeLauncher({ openWith: vi.fn().mockRejectedValue(new Error('app is gone')) });
    const service = new OpenWithService(launcher, settings);

    await expect(
      service.open('/repos/acme/README.md', 'file', { id: 'com.microsoft.VSCode', path: '/Applications/Visual Studio Code.app' }),
    ).rejects.toThrow('app is gone');
    expect(saved).toHaveLength(0);
  });
});

describe('OpenWithService delegation', () => {
  it('openDefault delegates to the launcher', async () => {
    const launcher = fakeLauncher();
    await new OpenWithService(launcher, settingsService().service).openDefault('/repos/acme/README.md');
    expect(launcher.openDefault).toHaveBeenCalledWith('/repos/acme/README.md');
  });

  it('reveal delegates to the launcher', async () => {
    const launcher = fakeLauncher();
    await new OpenWithService(launcher, settingsService().service).reveal('/repos/acme/README.md');
    expect(launcher.reveal).toHaveBeenCalledWith('/repos/acme/README.md');
  });
});

describe('OpenWithService.openByPath', () => {
  it('identifies the picked bundle so the choice is remembered by bundle id', async () => {
    const { service: settings, saved } = settingsService();
    const launcher = fakeLauncher({
      identify: vi.fn().mockResolvedValue(app('dev.zed.Zed', 'Zed', '/Applications/Zed.app')),
    });
    const service = new OpenWithService(launcher, settings);

    await service.openByPath('/repos/acme/README.md', 'file', '/Applications/Zed.app');

    expect(launcher.openWith).toHaveBeenCalledWith('/repos/acme/README.md', '/Applications/Zed.app');
    expect(saved.at(-1)?.openWith).toEqual({ '.md': 'dev.zed.Zed' });
  });

  it('opens but remembers nothing when the application cannot be identified', async () => {
    const { service: settings, saved } = settingsService();
    const launcher = fakeLauncher();
    const service = new OpenWithService(launcher, settings);

    await service.openByPath('/repos/acme/README.md', 'file', '/Applications/Mystery.app');

    expect(launcher.openWith).toHaveBeenCalledWith('/repos/acme/README.md', '/Applications/Mystery.app');
    // A path stored where a bundle id belongs could never match a future
    // suggestion — it would be permanent dead weight in settings.json.
    expect(saved).toHaveLength(0);
  });
});
