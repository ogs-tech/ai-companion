import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Globe, SquareTerminal } from 'lucide-react';
import { WorkbenchCanvas } from '../../../../src/renderer/components/workspace/WorkbenchCanvas.js';
import { renderWithTheme } from '../../test-utils.js';

describe('WorkbenchCanvas "+" menu', () => {
  it('is hidden without a menu', () => {
    renderWithTheme(<WorkbenchCanvas tabs={[]} activeTabId={null} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('workbench-new')).toBeNull();
  });

  it('lists the creation shortcuts, even with no tab open, and runs the chosen one', async () => {
    const onTerminal = vi.fn();
    renderWithTheme(
      <WorkbenchCanvas
        tabs={[]}
        activeTabId={null}
        onSelect={vi.fn()}
        newMenu={[
          { key: 'terminal', label: 'Novo terminal', glyph: SquareTerminal, onSelect: onTerminal },
          { key: 'browser', label: 'Novo navegador', glyph: Globe, onSelect: vi.fn(), shortcut: '⌘B' },
        ]}
      />,
    );

    await userEvent.click(screen.getByTestId('workbench-new'));
    expect(screen.getByTestId('workbench-new-browser')).toHaveTextContent('⌘B');
    await userEvent.click(screen.getByTestId('workbench-new-terminal'));
    expect(onTerminal).toHaveBeenCalledOnce();
  });
});

describe('WorkbenchCanvas session tabs', () => {
  const sessionTab = (over: Partial<Parameters<typeof WorkbenchCanvas>[0]['tabs'][number]> = {}): Parameters<typeof WorkbenchCanvas>[0]['tabs'][number] => ({
    id: 's1',
    label: 'refactor-auth',
    glyph: SquareTerminal,
    render: () => null,
    sessionState: 'needs-input',
    sessionDetail: 'Permissão: Bash',
    ...over,
  });

  it('names the state and what it is about in the tab tooltip', async () => {
    renderWithTheme(<WorkbenchCanvas tabs={[sessionTab()]} activeTabId={null} onSelect={vi.fn()} />);
    await userEvent.hover(screen.getByTestId('workbench-tab-s1'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Pergunta — Permissão: Bash');
  });

  it('draws each state with the shared mark', () => {
    renderWithTheme(<WorkbenchCanvas tabs={[sessionTab({ id: 'a', sessionState: 'exited' }), sessionTab({ id: 'b', sessionState: 'idle' })]} activeTabId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId('workbench-tab-state-a')).toHaveAttribute('data-state', 'exited');
    expect(screen.getByTestId('workbench-tab-state-b').querySelector('svg')).not.toBeNull();
  });
});
