import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { Group, usePanelRef } from 'react-resizable-panels';
import { PanelLeft } from 'lucide-react';
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
          glyph={PanelLeft}
          title="Test Panel"
          headerTestId="test-panel-label"
          headerActions={<button type="button">Ação</button>}
        >
          <div data-testid="side-panel-body">Conteúdo</div>
        </SidePanel>
      </Group>
    </ThemeProvider>
  );
}

describe('SidePanel', () => {
  it('renders the header title/icon and the body content', () => {
    render(<Harness />);
    expect(screen.getByTestId('test-panel-label')).toHaveTextContent('Test Panel');
    expect(screen.getByTestId('side-panel-body')).toHaveTextContent('Conteúdo');
  });

  it('renders header actions in the trailing slot', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument();
  });

  it('reflects the collapsed prop as data-collapsed on the underlying Panel (also the panel identity testid, via `id`)', () => {
    const { rerender } = render(<Harness collapsed={false} />);
    expect(screen.getByTestId('test-panel')).toHaveAttribute('data-collapsed', 'false');
    rerender(<Harness collapsed />);
    expect(screen.getByTestId('test-panel')).toHaveAttribute('data-collapsed', 'true');
  });
});
