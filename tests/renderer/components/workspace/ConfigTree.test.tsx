import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigTree } from '../../../../src/renderer/components/workspace/ConfigTree.js';
import { configGroups, configTabId, configPageOfTabId, findConfigPage, DEFAULT_CONFIG_PAGE } from '../../../../src/renderer/screens/config/config-pages.js';
import { CHANNEL_IDS } from '../../../../src/shared/channel.js';
import { renderWithShell } from '../../test-utils.js';

describe('config pages registry', () => {
  it('gives every registered channel a leaf under Canais', () => {
    const channels = configGroups().find((g) => g.id === 'channels');
    expect(channels?.pages.map((p) => p.id)).toEqual(CHANNEL_IDS.map((id) => `channel:${id}`));
  });

  it('puts Idioma and GitHub under App', () => {
    const app = configGroups().find((g) => g.id === 'app');
    expect(app?.pages.map((p) => p.id)).toEqual(['editor', 'git-ignore', 'language', 'github']);
  });

  it('hides the danger zone outside dev builds', () => {
    window.api = { ...(window.api ?? {}), isDev: false } as typeof window.api;
    expect(configGroups().some((g) => g.id === 'maintenance')).toBe(false);
    window.api = { ...(window.api ?? {}), isDev: true } as typeof window.api;
    expect(findConfigPage('danger')).toBeDefined();
  });

  it('round-trips tab ids and resolves the default page', () => {
    expect(configPageOfTabId(configTabId('language'))).toBe('language');
    expect(findConfigPage(DEFAULT_CONFIG_PAGE)).toBeDefined();
    expect(findConfigPage('nope')).toBeUndefined();
  });
});

describe('<ConfigTree>', () => {
  it('opens the clicked page and marks the active one', async () => {
    const onOpenPage = vi.fn();
    renderWithShell(<ConfigTree activePage="language" onOpenPage={onOpenPage} />);
    await userEvent.click(screen.getByTestId('config-leaf-github'));
    expect(onOpenPage).toHaveBeenCalledWith('github');
    expect(screen.getByTestId('config-leaf-language')).toBeInTheDocument();
  });
});
