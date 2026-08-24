import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { SessionDialog } from '../../../../src/renderer/components/workspace/SessionDialog.js';
import { mockApi, renderWithTheme } from '../../test-utils.js';

vi.mock('@xterm/xterm', () => {
  class Terminal {
    write = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  }
  return { FitAddon };
});

beforeEach(() => {
  mockApi();
});

describe('SessionDialog', () => {
  it('renders nothing interactive when closed', () => {
    renderWithTheme(<SessionDialog open={false} anchor={{ kind: 'workspace', workspaceId: 'w1' }} title="Workspace" onClose={vi.fn()} />);
    expect(screen.queryByTestId('session-panel')).not.toBeInTheDocument();
  });

  it('renders the SessionPanel with the given anchor when open', () => {
    renderWithTheme(<SessionDialog open anchor={{ kind: 'project', projectId: 'p1' }} title="acme" onClose={vi.fn()} />);
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
  });
});
