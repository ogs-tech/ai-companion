import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomizationViewDrawer } from '../../../src/renderer/components/CustomizationViewDrawer.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../src/shared/entity.js';
import { renderWithTheme } from '../test-utils.js';

const skill = (name: string, source = WORKSPACE_SOURCE): Skill => ({
  urn: `urn:skill:${name}`,
  kind: 'skill', enabled: true,
  name,
  description: `${name} description`,
  scopes: ['personal'],
  metadata: { version: '0.1.0', createdAt: '', updatedAt: '' },
  source,
  content: `# ${name}\n`,
});

const workspace: Skill = { ...skill('Skill A'), description: 'a skill', content: '# Skill body' };

const plugin: Skill = {
  ...skill('Skill B', { kind: 'plugin', pluginId: 'my-plugin', provenance: 'workspace-managed' }),
  description: 'plugin-provided',
  content: '# Plugin body',
};

describe('<CustomizationViewDrawer>', () => {
  it('does not render when entity is null', () => {
    renderWithTheme(
      <CustomizationViewDrawer
        entity={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(/detail-drawer/i)).not.toBeInTheDocument();
  });

  it('renders Edit button for workspace items', async () => {
    const onEdit = vi.fn();
    renderWithTheme(
      <CustomizationViewDrawer
        entity={workspace}
        onClose={vi.fn()}
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText('Skill body')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(workspace);
  });

  it('hides Edit button and shows read-only notice for plugin items', () => {
    renderWithTheme(
      <CustomizationViewDrawer
        entity={plugin}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/my-plugin/).length).toBeGreaterThan(0);
  });
});
