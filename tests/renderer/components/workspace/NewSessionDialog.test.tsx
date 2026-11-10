import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSessionDialog } from '../../../../src/renderer/components/workspace/NewSessionDialog.js';
import { renderWithTheme } from '../../test-utils.js';
import type { RunHarnessOption } from '../../../../src/renderer/hooks/use-run-channels.js';

const FOLDERS = ['/r/web', '/r/api'];
const ALIASES = { '/r/web': 'web', '/r/api': 'api' };

const BOTH: RunHarnessOption[] = [
  { id: 'claude', available: true },
  { id: 'cursor', available: true },
];

const setup = (defaultFolder?: string, harnesses?: RunHarnessOption[], folders: string[] = FOLDERS) => {
  const onStart = vi.fn();
  renderWithTheme(
    <NewSessionDialog
      open
      folders={folders}
      aliases={ALIASES}
      {...(harnesses ? { harnesses } : {})}
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
    expect(onStart).toHaveBeenCalledWith(['/r/api'], 'claude');
  });

  it('"Todas as pastas" ticks everything, in workspace order', async () => {
    const { onStart, user } = setup('/r/api');
    await user.click(screen.getByTestId('new-session-all'));
    await user.click(screen.getByTestId('new-session-start'));
    expect(onStart).toHaveBeenCalledWith(['/r/web', '/r/api'], 'claude');
  });

  it('cannot start with nothing ticked', async () => {
    const { user } = setup('/r/web');
    await user.click(screen.getByTestId('new-session-folder-web'));
    expect(screen.getByTestId('new-session-start')).toBeDisabled();
  });

  describe('harness selector', () => {
    it('is hidden while only one harness is enabled', () => {
      setup('/r/web');
      expect(screen.queryByTestId('new-session-harness')).toBeNull();
    });

    it('always opens on Claude and starts the session in the chosen harness', async () => {
      const { onStart, user } = setup('/r/web', BOTH);
      expect(screen.getByTestId('new-session-harness-claude')).toHaveAttribute('aria-pressed', 'true');
      await user.click(screen.getByTestId('new-session-harness-cursor'));
      await user.click(screen.getByTestId('new-session-start'));
      expect(onStart).toHaveBeenCalledWith(['/r/web'], 'cursor');
    });

    it('shows an enabled harness whose CLI is missing as disabled, and cannot start on it', () => {
      setup('/r/web', [
        { id: 'claude', available: true },
        { id: 'cursor', available: false },
      ]);
      expect(screen.getByTestId('new-session-harness-cursor')).toBeDisabled();
    });

    it('offers only the harness choice, without folders, for a single-folder workspace', async () => {
      const { onStart, user } = setup(undefined, BOTH, []);
      expect(screen.queryByTestId('new-session-all')).toBeNull();
      await user.click(screen.getByTestId('new-session-harness-cursor'));
      await user.click(screen.getByTestId('new-session-start'));
      expect(onStart).toHaveBeenCalledWith([], 'cursor');
    });
  });
});
