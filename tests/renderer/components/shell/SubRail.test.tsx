import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubRail } from '../../../../src/renderer/components/shell/SubRail.js';
import { mockApi, ok, fail, renderWithShell, type CallSpy } from '../../test-utils.js';

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => {
    if (method === 'workspace.getActive') {
      return ok({ id: 'default', name: 'Acme', rootPath: '/repos/acme', isDefault: true, createdAt: '' });
    }
    return ok(undefined);
  });
});

describe('SubRail', () => {
  it('renders nothing for areas without subs', () => {
    const { container } = renderWithShell(<SubRail nav={{ area: 'starter-pack' }} onSelect={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders the five Workspace subs and marks the active one', () => {
    renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'agents' }} onSelect={() => undefined} />);
    expect(screen.getByTestId('nav-visao-geral')).toBeInTheDocument();
    expect(screen.getByTestId('nav-skills')).toBeInTheDocument();
    expect(screen.getByTestId('nav-mcps')).toBeInTheDocument();
    expect(screen.getByTestId('nav-agents')).toHaveAttribute('aria-current', 'page');
  });
  it('selects a sub on click', async () => {
    const onSelect = vi.fn();
    renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('nav-hooks'));
    expect(onSelect).toHaveBeenCalledWith({ area: 'workspace', sub: 'hooks' });
  });
  it('shows the active workspace name, root path and a Global tag above the subs', async () => {
    renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Acme/)).toBeInTheDocument());
    expect(screen.getByText(/Global/)).toBeInTheDocument();
    expect(screen.getByText('/repos/acme')).toBeInTheDocument();
  });
  it('does not show the workspace context strip on the Plugins sub-rail', () => {
    renderWithShell(<SubRail nav={{ area: 'plugins', sub: 'plugins' }} onSelect={() => undefined} />);
    expect(screen.queryByText(/Global/)).not.toBeInTheDocument();
  });

  describe('removing the active workspace', () => {
    const acme = { id: 'w1', name: 'Acme', rootPath: '/repos/acme', isDefault: false, createdAt: '' };

    it('shows a remove action for the active workspace when it is not Default', async () => {
      call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(acme) : ok(undefined)));
      renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      expect(await screen.findByTestId('workspace-context-remove')).toBeInTheDocument();
    });

    it('does not show a remove action for the Default workspace', async () => {
      renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      await waitFor(() => expect(screen.getByText(/Acme/)).toBeInTheDocument());
      expect(screen.queryByTestId('workspace-context-remove')).not.toBeInTheDocument();
    });

    it('confirming removal switches back to Default, then deletes the workspace', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return ok(acme);
        if (method === 'workspace.switchTo') {
          return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
        }
        return ok(undefined);
      });
      renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-confirm-btn'));
      await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.switchTo', { id: 'default' }));
      await waitFor(() => expect(call).toHaveBeenCalledWith('workspace.delete', { id: 'w1' }));
    });

    it('canceling the confirmation calls neither switchTo nor delete', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(acme) : ok(undefined)));
      renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-cancel-btn'));
      await waitFor(() => expect(screen.queryByTestId('workspace-remove-confirm-dialog')).not.toBeInTheDocument());
      expect(call).not.toHaveBeenCalledWith('workspace.switchTo', expect.anything());
      expect(call).not.toHaveBeenCalledWith('workspace.delete', expect.anything());
    });

    it('keeps naming the workspace being removed even if the active workspace changes while the dialog is still open', async () => {
      const user = userEvent.setup();
      let getActiveResult: typeof acme | { id: string; name: string; rootPath: string; isDefault: boolean; createdAt: string } = acme;
      call.mockImplementation(async (method: string) => (method === 'workspace.getActive' ? ok(getActiveResult) : ok(undefined)));
      const { client } = renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      await user.click(await screen.findByTestId('workspace-context-remove'));
      expect(await screen.findByText('Remover Acme?')).toBeInTheDocument();

      // Simulate the active workspace flipping to Default mid-flow (exactly
      // what switchWorkspace's onSuccess does while the confirm dialog is
      // still closing) — the dialog must keep naming the original target.
      getActiveResult = { id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' };
      await client.invalidateQueries({ queryKey: ['workspace', 'active'] });
      await waitFor(() => expect(screen.getByText(/Global/)).toBeInTheDocument());

      expect(screen.getByText('Remover Acme?')).toBeInTheDocument();
    });

    it('shows an error toast when the removal fails', async () => {
      const user = userEvent.setup();
      call.mockImplementation(async (method: string) => {
        if (method === 'workspace.getActive') return ok(acme);
        if (method === 'workspace.switchTo') {
          return ok({ id: 'default', name: 'Default', rootPath: '/home/u', isDefault: true, createdAt: '' });
        }
        if (method === 'workspace.delete') return fail('validation', 'boom');
        return ok(undefined);
      });
      renderWithShell(<SubRail nav={{ area: 'workspace', sub: 'skills' }} onSelect={() => undefined} />);
      await user.click(await screen.findByTestId('workspace-context-remove'));
      await user.click(await screen.findByTestId('workspace-remove-confirm-btn'));
      expect(await screen.findByTestId('toast')).toHaveTextContent('boom');
    });
  });
});
