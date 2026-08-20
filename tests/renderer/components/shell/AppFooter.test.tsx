import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { AppFooter } from '../../../../src/renderer/components/shell/AppFooter.js';
import { renderWithTheme } from '../../test-utils.js';

describe('AppFooter', () => {
  it('carries the OGS Tech brand line with link', () => {
    renderWithTheme(<AppFooter />);
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /OGS Tech/i });
    expect(link).toHaveAttribute('href', 'https://www.useogs.com/');
  });
});
