import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithTheme } from '../test-utils.js';
import { LaunchProcessStatusBadge } from '../../../src/renderer/components/LaunchProcessStatusBadge.js';

describe('LaunchProcessStatusBadge', () => {
  it('renders nothing when the process has never run', () => {
    const { container } = renderWithTheme(<LaunchProcessStatusBadge status={undefined} testId="p1-Run" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a running pill', () => {
    renderWithTheme(<LaunchProcessStatusBadge status="running" testId="p1-Run" />);
    expect(screen.getByTestId('status-pill-p1-Run')).toHaveTextContent('Rodando');
  });

  it('renders an exited pill', () => {
    renderWithTheme(<LaunchProcessStatusBadge status="exited" testId="p1-Run" />);
    expect(screen.getByTestId('status-pill-p1-Run')).toHaveTextContent('Encerrado');
  });
});
