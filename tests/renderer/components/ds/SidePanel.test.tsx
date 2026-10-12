import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { Group, usePanelRef } from 'react-resizable-panels';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { SidePanel } from '../../../../src/renderer/components/ds/SidePanel.js';

function Harness({ collapsed = false }: { collapsed?: boolean }): React.ReactElement {
  const panelRef = usePanelRef();
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <Group orientation="horizontal">
        <SidePanel
          panelId="test-panel"
          panelRef={panelRef}
          defaultSize="30"
          minSize="10"
          maxSize="60"
          collapsed={collapsed}
          cardTestId="test-panel-card"
        >
          <div data-testid="side-panel-body">Conteúdo</div>
        </SidePanel>
      </Group>
    </ThemeProvider>
  );
}

describe('SidePanel', () => {
  it('renders the body content inside the card carrying the panel-identity testid', () => {
    render(<Harness />);
    expect(screen.getByTestId('test-panel-card')).toContainElement(screen.getByTestId('side-panel-body'));
    expect(screen.getByTestId('side-panel-body')).toHaveTextContent('Conteúdo');
  });

  it('no longer renders a title header', () => {
    render(<Harness />);
    expect(screen.getByTestId('test-panel-card')).toHaveTextContent(/^Conteúdo$/);
  });

  it('reflects the collapsed prop as data-collapsed on the underlying Panel (also the panel identity testid, via `id`)', () => {
    const { rerender } = render(<Harness collapsed={false} />);
    expect(screen.getByTestId('test-panel')).toHaveAttribute('data-collapsed', 'false');
    rerender(<Harness collapsed />);
    expect(screen.getByTestId('test-panel')).toHaveAttribute('data-collapsed', 'true');
  });
});
