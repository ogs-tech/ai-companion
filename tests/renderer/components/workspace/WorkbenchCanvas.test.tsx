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
