import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { CodeEditorView } from '../../../../src/renderer/components/ds/CodeEditorView.js';

function renderEditor(props: Partial<React.ComponentProps<typeof CodeEditorView>> & { value: string; onChange: (v: string) => void }) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CodeEditorView testId="ce" {...props} />
    </ThemeProvider>,
  );
}

describe('CodeEditorView', () => {
  it('renders the given value', () => {
    renderEditor({ value: 'hello', onChange: vi.fn() });
    const content = screen.getByTestId('ce').querySelector('.cm-content');
    expect(content?.textContent).toBe('hello');
  });

  it('calls onChange when the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Starting from an empty doc sidesteps CodeMirror's cursor-movement
    // commands (e.g. End/Home), which need real layout measurement that
    // jsdom doesn't provide — see the risk this codebase's own architecture
    // notes flag for CodeMirror 6 under jsdom.
    renderEditor({ value: '', onChange });
    const content = screen.getByTestId('ce').querySelector('.cm-content') as HTMLElement;
    content.focus();
    // skipClick: user-event's default type() clicks first to resolve a caret
    // position, which needs real layout — jsdom has none.
    await user.type(content, 'hi', { skipClick: true });
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('hi');
  });

  it('is not editable when readOnly is set', () => {
    renderEditor({ value: 'hello', onChange: vi.fn(), readOnly: true });
    const content = screen.getByTestId('ce').querySelector('.cm-content');
    expect(content?.getAttribute('contenteditable')).toBe('false');
  });
});
