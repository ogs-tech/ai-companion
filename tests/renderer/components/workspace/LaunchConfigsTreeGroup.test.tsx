import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaunchConfigsTreeGroup } from '../../../../src/renderer/components/workspace/LaunchConfigsTreeGroup.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { resetLaunchProcessesForTests } from '../../../../src/renderer/lib/launch-process-store.js';
import type { Project } from '../../../../src/shared/project.js';

const project: Project = { id: 'p1', name: 'acme', path: '/repos/acme', createdAt: '' };

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  resetLaunchProcessesForTests();
});

describe('LaunchConfigsTreeGroup', () => {
  it('renders nothing for a project with no launch.json and no error', async () => {
    call.mockImplementation(async (method: string) => (method === 'launchConfig.list' ? ok([{ projectId: 'p1', configs: [] }]) : ok(undefined)));
    const { container } = renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.list', {}));
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a supported config as a clickable row and an unsupported one as disabled', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list'
        ? ok([{
            projectId: 'p1',
            configs: [
              { name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true },
              { name: 'Debug in Chrome', type: 'chrome', request: 'launch', program: 'index.html', args: [], supported: false },
            ],
          }])
        : ok(undefined),
    );
    const user = userEvent.setup();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    expect(await screen.findByTestId('tree-launch-config-acme-Run server')).not.toHaveAttribute('aria-disabled', 'true');
    const unsupportedRow = await screen.findByTestId('tree-launch-config-acme-Debug in Chrome');
    expect(unsupportedRow.closest('.MuiButtonBase-root')).toHaveAttribute('aria-disabled', 'true');
  });

  it('running a supported config calls launchConfig.run and opens it via onOpenProcess', async () => {
    call.mockImplementation(async (method: string) => {
      if (method === 'launchConfig.list') {
        return ok([{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }]);
      }
      if (method === 'launchConfig.run') {
        return ok({ processId: 'proc-1', projectId: 'p1', configName: 'Run server', status: 'running', exitCode: null });
      }
      return ok(undefined);
    });
    const user = userEvent.setup();
    const onOpenProcess = vi.fn();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={onOpenProcess} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    await user.click(await screen.findByTestId('tree-launch-config-acme-Run server'));
    await waitFor(() => expect(call).toHaveBeenCalledWith('launchConfig.run', { projectId: 'p1', configName: 'Run server' }));
    await waitFor(() => expect(onOpenProcess).toHaveBeenCalled());
    expect(onOpenProcess.mock.calls[0]?.[0]).toMatchObject({ processId: 'proc-1' });
  });

  it('shows the reader error instead of an empty-state message when launch.json is malformed', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list' ? ok([{ projectId: 'p1', configs: [], error: 'malformed launch.json' }]) : ok(undefined),
    );
    const user = userEvent.setup();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={vi.fn()} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    expect(await screen.findByTestId('launch-configs-error-acme')).toHaveTextContent('malformed launch.json');
  });

  it('right-clicking a row opens "Edit launch.json" / "Reveal in Finder" for the project', async () => {
    call.mockImplementation(async (method: string) =>
      method === 'launchConfig.list'
        ? ok([{ projectId: 'p1', configs: [{ name: 'Run server', type: 'node', request: 'launch', program: 'server.js', args: [], supported: true }] }])
        : ok(undefined),
    );
    const user = userEvent.setup();
    const onEditLaunchJson = vi.fn();
    renderWithShell(<LaunchConfigsTreeGroup project={project} onOpenProcess={vi.fn()} onEditLaunchJson={onEditLaunchJson} />);
    await user.click(await screen.findByTestId('tree-group-launch-configs-acme'));
    const row = await screen.findByTestId('tree-launch-config-acme-Run server');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await user.click(await screen.findByTestId('row-context-menu-edit-launch-json'));
    expect(onEditLaunchJson).toHaveBeenCalledWith(project);
  });
});
