import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SyncDot } from '../../../../src/renderer/components/ds/SyncDot.js';
import { renderWithQuery } from '../../test-utils.js';

describe('<SyncDot>', () => {
  it.each([
    ['synced', 'Sincronizado'],
    ['pending', 'Pendente de sincronização'],
    ['detected', 'Detectado, ainda não aplicado'],
  ] as const)('exposes %s with a text alternative', (state, label) => {
    renderWithQuery(<SyncDot state={state} />);
    expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-state', state);
  });
});
