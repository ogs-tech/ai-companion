import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { PropertiesForm } from '../../../../src/renderer/components/workspace/PropertiesForm.js';
import { mockApi, ok, renderWithShell, type CallSpy } from '../../test-utils.js';
import { WORKSPACE_SOURCE, type Skill } from '../../../../src/shared/entity.js';

const settings = { adapters: { claude: { enabled: true }, cursor: { enabled: false }, lmstudio: { enabled: false } } };
const report = { generatedAt: '', worst: 'ok', counts: { ok: 0, warning: 0, error: 0 }, checks: [] };
const skill = (enabled: boolean): Skill => ({
  urn: 'urn:skill:tdd', kind: 'skill', name: 'tdd', description: 'd', scopes: ['personal'], enabled,
  metadata: { version: '1.0.0', createdAt: '', updatedAt: '' }, source: WORKSPACE_SOURCE, content: '',
});

let call: CallSpy;
beforeEach(() => {
  call = mockApi();
  call.mockImplementation(async (method: string) => ok(method === 'settings.get' ? settings : report));
});

describe('PropertiesForm — sync section', () => {
  it('a disabled entity shows only the disabled line', async () => {
    renderWithShell(<PropertiesForm entity={skill(false)} onChange={() => undefined} readOnly={false} syncUrn="urn:skill:tdd" />);
    expect(await screen.findByText('Desativado — não vai para nenhum canal')).toBeInTheDocument();
    expect(screen.queryByTestId('channel-sync-claude')).not.toBeInTheDocument();
  });

  it('an enabled entity lists its channels', async () => {
    renderWithShell(<PropertiesForm entity={skill(true)} onChange={() => undefined} readOnly={false} syncUrn="urn:skill:tdd" />);
    expect(await screen.findByTestId('channel-sync-claude')).toBeInTheDocument();
  });
});
