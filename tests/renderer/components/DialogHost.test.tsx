import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogHost } from '../../../src/renderer/components/DialogHost.js';
import { askConfirm, askUnsaved } from '../../../src/renderer/lib/dialog-host.js';

describe('DialogHost', () => {
  it('lists several dirty tabs and offers Salvar tudo', async () => {
    render(<DialogHost />);
    const answer = askUnsaved(['a.md', 'b.md']);
    expect(await screen.findByTestId('unsaved-dialog-list')).toHaveTextContent('a.md');
    expect(screen.getByTestId('unsaved-save-btn')).toHaveTextContent('Salvar tudo');
    await userEvent.click(screen.getByTestId('unsaved-save-btn'));
    await expect(answer).resolves.toBe('save');
  });

  it('Esc cancels', async () => {
    render(<DialogHost />);
    const answer = askUnsaved(['a.md']);
    await screen.findByTestId('unsaved-dialog');
    await userEvent.keyboard('{Escape}');
    await expect(answer).resolves.toBe('cancel');
  });

  it('shows queued dialogs one at a time', async () => {
    render(<DialogHost />);
    const first = askUnsaved(['a.md']);
    const second = askConfirm({ title: 'Encerrar?', message: 'x', confirmLabel: 'Encerrar' });
    await screen.findByTestId('unsaved-dialog');
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('unsaved-discard-btn'));
    await expect(first).resolves.toBe('discard');
    await userEvent.click(await screen.findByTestId('confirm-ok-btn'));
    await expect(second).resolves.toBe(true);
  });
});
