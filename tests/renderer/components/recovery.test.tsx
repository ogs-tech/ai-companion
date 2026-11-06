import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecoveryScreen } from '../../../src/renderer/components/RecoveryScreen.js';
import { AppErrorBoundary } from '../../../src/renderer/components/AppErrorBoundary.js';
import { mockApi, ok } from '../test-utils.js';

describe('RecoveryScreen', () => {
  it('says sessions keep running, reloads on demand and reveals the details', async () => {
    const onReload = vi.fn();
    render(<RecoveryScreen details="boom" onReload={onReload} />);
    expect(screen.getByRole('alert')).toHaveTextContent('encontrou um problema');
    expect(screen.getByRole('alert')).toHaveTextContent('Suas sessões nos terminais continuam rodando.');
    expect(screen.queryByTestId('recovery-details')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('recovery-details-toggle'));
    expect(screen.getByTestId('recovery-details')).toHaveTextContent('boom');
    await userEvent.click(screen.getByTestId('recovery-reload'));
    expect(onReload).toHaveBeenCalledOnce();
  });
});

describe('AppErrorBoundary', () => {
  it('replaces a crashing child with the recovery screen and reports the error to main', () => {
    const call = mockApi();
    call.mockResolvedValue(ok(undefined));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = (): never => {
      throw new Error('render exploded');
    };
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByTestId('recovery-screen')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('desktop.reportError', expect.objectContaining({ source: 'renderer', message: 'render exploded' }));
    spy.mockRestore();
  });
});
