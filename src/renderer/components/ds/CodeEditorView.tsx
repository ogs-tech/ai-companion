import CodeMirror from '@uiw/react-codemirror';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { useTheme } from '@mui/material/styles';
import { fonts } from '../../tokens.js';
import { publishShellStatus } from '../../lib/shell-status-store.js';
import type { CodeLanguage } from '../../lib/code-language.js';

const LANGUAGE_EXTENSIONS: Partial<Record<CodeLanguage, Extension>> = {
  markdown: markdown(),
  javascript: javascript({ typescript: true }),
  json: json(),
  css: css(),
  html: html(),
};

/** The focused editor tells the status bar where its cursor is; unfocused (hidden-tab) editors stay silent. */
function publishCursor(update: ViewUpdate): void {
  if (!update.view.hasFocus || !(update.selectionSet || update.focusChanged)) return;
  const head = update.state.selection.main.head;
  const line = update.state.doc.lineAt(head);
  publishShellStatus({ cursor: { line: line.number, column: head - line.from + 1 } });
}

const fontTheme = EditorView.theme({
  '&': { fontSize: '0.85rem' },
  '.cm-content, .cm-gutters': { fontFamily: fonts.mono },
});

interface CodeEditorViewProps {
  value: string;
  onChange: (value: string) => void;
  /** Defaults to 'markdown' — the shape every entity body (skill/agent/instruction) needs. */
  language?: CodeLanguage;
  readOnly?: boolean | undefined;
  testId?: string;
}

/** Controlled CodeMirror 6 surface — the raw-editing half of every open tab's body, plain-file or entity. */
export function CodeEditorView({
  value,
  onChange,
  language = 'markdown',
  readOnly = false,
  testId = 'code-editor-view',
}: CodeEditorViewProps): React.ReactElement {
  const { palette } = useTheme();
  const langExtension = LANGUAGE_EXTENSIONS[language];
  const extensions: Extension[] = [fontTheme, EditorView.lineWrapping, ...(langExtension ? [langExtension] : [])];

  return (
    <div data-testid={testId}>
      <CodeMirror
        value={value}
        onChange={onChange}
        theme={palette.mode}
        editable={!readOnly}
        readOnly={readOnly}
        extensions={extensions}
        onUpdate={publishCursor}
        minHeight="240px"
        basicSetup={{ foldGutter: false }}
      />
    </div>
  );
}
