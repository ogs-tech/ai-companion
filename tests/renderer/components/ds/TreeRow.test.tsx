import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { Folder } from 'lucide-react';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { TreeRow } from '../../../../src/renderer/components/ds/TreeRow.js';

const wrap = (ui: React.ReactElement) => render(<ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>);

describe('TreeRow', () => {
  it('renders the icon, primary label and badge', () => {
    wrap(<TreeRow testId="row-content" pl={1.5} glyph={Folder} primary="src" badge={<span>3</span>} />);
    const row = screen.getByTestId('row-content');
    expect(row).toHaveTextContent('src');
    expect(row).toHaveTextContent('3');
  });

  it('fires onClick and onContextMenu', () => {
    const onClick = vi.fn();
    const onContextMenu = vi.fn();
    wrap(<TreeRow testId="row-events" pl={1.5} glyph={Folder} primary="src" onClick={onClick} onContextMenu={onContextMenu} />);
    const row = screen.getByTestId('row-events');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(row);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('renders no chevron by default, a spacer when chevron="spacer", and a chevron icon when expandable', () => {
    const { rerender } = wrap(<TreeRow testId="row-chevron" pl={1.5} glyph={Folder} primary="a" />);
    expect(screen.getByTestId('row-chevron').querySelectorAll('svg')).toHaveLength(1);

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <TreeRow testId="row-chevron" pl={1.5} glyph={Folder} primary="a" chevron="spacer" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('row-chevron').querySelectorAll('svg')).toHaveLength(1);

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <TreeRow testId="row-chevron" pl={1.5} glyph={Folder} primary="a" chevron="collapsed" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('row-chevron').querySelectorAll('svg')).toHaveLength(2);
  });

  it('renders always-visible actions without the hover-reveal wrapper', () => {
    wrap(
      <TreeRow
        testId="row-actions"
        pl={1.5}
        glyph={Folder}
        primary="a"
        actions={<button type="button">Ação</button>}
        actionsVisibility="always"
      />,
    );
    const button = screen.getByRole('button', { name: 'Ação' });
    expect(button.closest('.tree-row-actions')).toBeNull();
  });

  it('wraps hover-mode actions (the default) in the hover-reveal container', () => {
    wrap(<TreeRow testId="row-hover-actions" pl={1.5} glyph={Folder} primary="a" actions={<button type="button">Ação</button>} />);
    const button = screen.getByRole('button', { name: 'Ação' });
    expect(button.closest('.tree-row-actions')).not.toBeNull();
  });
});
