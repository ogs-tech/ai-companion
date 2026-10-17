import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { GitInitCard } from '../../../../../src/renderer/components/workspace/git/GitInit.js';
import { createAppTheme } from '../../../../../src/renderer/theme.js';

const ui = (workspaceId: string, onInit = vi.fn()) => (
  <ThemeProvider theme={createAppTheme('light')}>
    <GitInitCard workspaceId={workspaceId} busy={false} onInit={onInit} />
  </ThemeProvider>
);

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('GitInitCard', () => {
  it('shows, runs git init, and dismisses', async () => {
    const onInit = vi.fn();
    render(ui('w1', onInit));
    await userEvent.click(screen.getByTestId('git-init-card-btn'));
    expect(onInit).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('git-init-card-dismiss'));
    expect(screen.queryByTestId('git-init-card')).not.toBeInTheDocument();
  });

  it('stays dismissed after a remount, per workspace', async () => {
    const first = render(ui('w1'));
    await userEvent.click(screen.getByTestId('git-init-card-dismiss'));
    first.unmount();

    const second = render(ui('w1'));
    expect(screen.queryByTestId('git-init-card')).not.toBeInTheDocument();
    second.unmount();

    render(ui('w2'));
    expect(screen.getByTestId('git-init-card')).toBeInTheDocument();
    expect(window.localStorage.getItem('ai-companion.git-init-card-dismissed.w1')).toBe('1');
  });

  it('survives a failing localStorage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(ui('w1'));
    expect(screen.getByTestId('git-init-card')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('git-init-card-dismiss'));
    expect(screen.queryByTestId('git-init-card')).not.toBeInTheDocument();
  });
});
