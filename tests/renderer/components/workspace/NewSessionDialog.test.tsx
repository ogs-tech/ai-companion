import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSessionDialog } from '../../../../src/renderer/components/workspace/NewSessionDialog.js';
import { renderWithTheme } from '../../test-utils.js';

const FOLDERS = ['/r/web', '/r/api'];
const ALIASES = { '/r/web': 'web', '/r/api': 'api' };

const setup = (defaultFolder?: string) => {
  const onStart = vi.fn();
  renderWithTheme(
    <NewSessionDialog
      open
      folders={FOLDERS}
      aliases={ALIASES}
      {...(defaultFolder ? { defaultFolder } : {})}
      onStart={onStart}
      onCancel={() => undefined}
    />,
  );
  return { onStart, user: userEvent.setup() };
};

describe('NewSessionDialog', () => {
  it('starts with only the default folder ticked', async () => {
    const { onStart, user } = setup('/r/api');
    await user.click(screen.getByTestId('new-session-start'));
    expect(onStart).toHaveBeenCalledWith(['/r/api']);
  });

  it('"Todas as pastas" ticks everything, in workspace order', async () => {
    const { onStart, user } = setup('/r/api');
    await user.click(screen.getByTestId('new-session-all'));
    await user.click(screen.getByTestId('new-session-start'));
    expect(onStart).toHaveBeenCalledWith(['/r/web', '/r/api']);
  });

  it('cannot start with nothing ticked', async () => {
    const { user } = setup('/r/web');
    await user.click(screen.getByTestId('new-session-folder-web'));
    expect(screen.getByTestId('new-session-start')).toBeDisabled();
  });
});
