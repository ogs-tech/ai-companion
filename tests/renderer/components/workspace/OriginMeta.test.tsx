import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OriginMeta } from '../../../../src/renderer/components/workspace/OriginMeta.js';

describe('OriginMeta', () => {
  it('shows a plugin\'s short name, without its marketplace suffix', () => {
    render(<OriginMeta pluginId="superpowers@claude-plugins-official" />);
    expect(screen.getByTestId('origin-meta-superpowers@claude-plugins-official')).toHaveTextContent(/^superpowers$/);
  });

  it('renders nothing for the user\'s own item', () => {
    const { container } = render(<OriginMeta />);
    expect(container).toBeEmptyDOMElement();
  });
});
