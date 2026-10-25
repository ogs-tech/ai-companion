import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { File as FileIcon } from 'lucide-react';
import { OpenEditorsSection } from '../../../../src/renderer/components/workspace/OpenEditorsSection.js';
import type { WorkbenchTab } from '../../../../src/renderer/components/workspace/WorkbenchCanvas.js';
import { renderWithTheme } from '../../test-utils.js';

const tab = (id: string, over: Partial<WorkbenchTab> = {}): WorkbenchTab => ({
  id,
  glyph: FileIcon,
  label: id,
  render: () => null,
  ...over,
});

describe('OpenEditorsSection', () => {
  it('shows an empty state with no close-all control', () => {
    renderWithTheme(<OpenEditorsSection tabs={[]} activeTabId={null} onSelect={vi.fn()} onCloseAll={vi.fn()} />);
    expect(screen.getByTestId('open-editors-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('open-editors-close-all')).toBeNull();
  });

  it('lists the tabs, marks the active and dirty ones, and selects on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithTheme(
      <OpenEditorsSection tabs={[tab('a.ts', { dirty: true }), tab('b.ts')]} activeTabId="b.ts" onSelect={onSelect} onCloseAll={vi.fn()} />,
    );
    expect(screen.getByTestId('open-editor-row-b.ts')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('open-editor-dirty-a.ts')).toBeInTheDocument();
    await user.click(screen.getByTestId('open-editor-row-a.ts'));
    expect(onSelect).toHaveBeenCalledWith('a.ts');
  });

  it("closes one tab through its own X without selecting it, and all through the header's", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onCloseAll = vi.fn();
    renderWithTheme(<OpenEditorsSection tabs={[tab('a.ts', { onClose })]} activeTabId={null} onSelect={onSelect} onCloseAll={onCloseAll} />);
    await user.click(screen.getByTestId('open-editor-close-a.ts'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('open-editors-close-all'));
    expect(onCloseAll).toHaveBeenCalledOnce();
  });
});
