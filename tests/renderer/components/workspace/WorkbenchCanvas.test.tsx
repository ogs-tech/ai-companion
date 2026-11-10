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

  it('draws one channel mark badged with the state, not the channel glyph next to the state mark', () => {
    renderWithTheme(<WorkbenchCanvas tabs={[sessionTab({ id: 'c', sessionState: 'working', sessionChannel: 'claude' })]} activeTabId={null} onSelect={vi.fn()} />);
    const badge = screen.getByTestId('workbench-tab-state-c');
    expect(badge).toHaveAttribute('data-state', 'working');
    // Channel mark + badge live in one wrapper: the tab holds exactly those two svgs before its label.
    expect(screen.getByTestId('workbench-tab-c').querySelectorAll('svg').length).toBe(2);
  });

  describe('tab strip', () => {
    const tabs = [sessionTab({ id: 'a', label: 'alpha' }), sessionTab({ id: 'b', label: 'beta' })];

    it('keeps the "+" outside the scrolling strip', () => {
      renderWithTheme(<WorkbenchCanvas tabs={tabs} activeTabId="a" onSelect={vi.fn()} newMenu={[{ key: 'x', label: 'Novo', glyph: SquareTerminal, onSelect: vi.fn() }]} />);
      expect(screen.getByTestId('workbench-tabs')).not.toContainElement(screen.getByTestId('workbench-new'));
    });

    it('renders no breadcrumb row when the active tab has no path', () => {
      renderWithTheme(<WorkbenchCanvas tabs={tabs} activeTabId="a" onSelect={vi.fn()} />);
      expect(screen.queryByTestId('workbench-breadcrumb')).toBeNull();
    });

    it('offers "all tabs" only when the strip overflows, and selects from it', async () => {
      const onSelect = vi.fn();
      const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
      const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
      try {
        renderWithTheme(<WorkbenchCanvas tabs={tabs} activeTabId="a" onSelect={onSelect} />);
        await userEvent.click(await screen.findByTestId('workbench-all-tabs'));
        await userEvent.click(await screen.findByTestId('workbench-all-tabs-b'));
        expect(onSelect).toHaveBeenCalledWith('b');
      } finally {
        scrollWidth.mockRestore();
        clientWidth.mockRestore();
      }
    });

    it('hides "all tabs" when nothing overflows', () => {
      renderWithTheme(<WorkbenchCanvas tabs={tabs} activeTabId="a" onSelect={vi.fn()} />);
      expect(screen.queryByTestId('workbench-all-tabs')).toBeNull();
    });
  });
});
