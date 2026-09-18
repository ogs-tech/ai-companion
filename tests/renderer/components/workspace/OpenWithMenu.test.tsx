import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { OpenWithMenu } from '../../../../src/renderer/components/workspace/OpenWithMenu.js';
import type { ExternalApp, OpenWithSuggestions } from '../../../../src/shared/open-with.js';

const app = (overrides: Partial<ExternalApp> & Pick<ExternalApp, 'id' | 'name' | 'path'>): ExternalApp => ({
  isDefault: false,
  isRemembered: false,
  ...overrides,
});

const VSCODE = app({
  id: 'com.microsoft.VSCode',
  name: 'Visual Studio Code',
  path: '/Applications/Visual Studio Code.app',
  isDefault: true,
});
const ZED = app({ id: 'dev.zed.Zed', name: 'Zed', path: '/Applications/Zed.app' });

function mockIpc(suggestions: OpenWithSuggestions): ReturnType<typeof vi.fn> {
  const callIpc = vi.fn(async (method: string) => {
    if (method === 'openWith.suggest') return suggestions;
    if (method === 'openWith.chooseApp') return { canceled: false };
    return undefined;
  });
  vi.spyOn(ipc, 'callIpc').mockImplementation(callIpc as unknown as typeof ipc.callIpc);
  return callIpc;
}

function renderMenu(onDone = vi.fn()): { onDone: ReturnType<typeof vi.fn> } {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <OpenWithMenu
          anchorEl={anchor}
          target={{ relPath: 'docs/README.md', kind: 'file' }}
          onClose={vi.fn()}
          onDone={onDone}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onDone };
}

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.restoreAllMocks();
});

describe('OpenWithMenu', () => {
  it('lists the applications the main process suggested', async () => {
    mockIpc({ primary: [VSCODE, ZED], more: [] });
    renderMenu();

    expect(await screen.findByText('Visual Studio Code')).toBeInTheDocument();
    expect(screen.getByText('Zed')).toBeInTheDocument();
  });

  it('marks the one the system would use itself', async () => {
    mockIpc({ primary: [VSCODE, ZED], more: [] });
    renderMenu();

    const defaultRow = await screen.findByTestId('open-with-app-com.microsoft.VSCode');
    expect(defaultRow).toHaveTextContent('padrão');
    expect(screen.getByTestId('open-with-app-dev.zed.Zed')).not.toHaveTextContent('padrão');
  });

  it('asks the main process to resolve the row path, never an absolute one', async () => {
    const callIpc = mockIpc({ primary: [VSCODE], more: [] });
    renderMenu();
    await screen.findByText('Visual Studio Code');

    expect(callIpc).toHaveBeenCalledWith('openWith.suggest', {
      path: 'docs/README.md',
      kind: 'file',
    });
  });

  it('opens the file with the application that was clicked', async () => {
    const callIpc = mockIpc({ primary: [VSCODE, ZED], more: [] });
    const { onDone } = renderMenu();

    await userEvent.click(await screen.findByTestId('open-with-app-dev.zed.Zed'));

    await waitFor(() =>
      expect(callIpc).toHaveBeenCalledWith('openWith.open', {
        path: 'docs/README.md',
        kind: 'file',
        appId: 'dev.zed.Zed',
        appPath: '/Applications/Zed.app',
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('keeps the overflow applications behind "Mais apps"', async () => {
    const overflow = app({ id: 'com.apple.TextEdit', name: 'Editor de Texto', path: '/System/Applications/TextEdit.app' });
    mockIpc({ primary: [VSCODE], more: [overflow] });
    renderMenu();

    await screen.findByText('Visual Studio Code');
    expect(screen.queryByText('Editor de Texto')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('open-with-more'));

    expect(await screen.findByText('Editor de Texto')).toBeInTheDocument();
  });

  it('offers no overflow entry when everything already fits', async () => {
    mockIpc({ primary: [VSCODE], more: [] });
    renderMenu();

    await screen.findByText('Visual Studio Code');
    expect(screen.queryByTestId('open-with-more')).not.toBeInTheDocument();
  });

  it('falls back to the system default when no application could be suggested', async () => {
    const callIpc = mockIpc({ primary: [], more: [] });
    const { onDone } = renderMenu();

    await userEvent.click(await screen.findByTestId('open-with-default'));

    await waitFor(() =>
      expect(callIpc).toHaveBeenCalledWith('openWith.openDefault', { path: 'docs/README.md' }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('lets the user pick an application the list does not offer', async () => {
    const callIpc = mockIpc({ primary: [VSCODE], more: [] });
    renderMenu();

    await userEvent.click(await screen.findByTestId('open-with-choose'));

    await waitFor(() =>
      expect(callIpc).toHaveBeenCalledWith('openWith.chooseApp', {
        path: 'docs/README.md',
        kind: 'file',
      }),
    );
  });

  it('shows the application icon the main process read from the bundle', async () => {
    mockIpc({ primary: [{ ...VSCODE, iconDataUrl: 'data:image/png;base64,AAA' }], more: [] });
    renderMenu();

    const icon = await screen.findByTestId('open-with-icon-com.microsoft.VSCode');
    expect(icon).toHaveAttribute('src', 'data:image/png;base64,AAA');
  });
});
