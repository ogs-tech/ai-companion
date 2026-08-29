import { Box, Button } from '@mui/material';
import { Eye, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Icon } from './Icon.js';
import { CodeEditorView } from './CodeEditorView.js';
import type { CodeLanguage } from '../../lib/code-language.js';

export type MarkdownBodyMode = 'edit' | 'preview';

interface MarkdownPreviewButtonProps {
  mode: MarkdownBodyMode;
  onModeChange: (mode: MarkdownBodyMode) => void;
}

/**
 * A single "Prévia"/"Editar" action, not a segmented control — a Markdown
 * document (entity body or plain file) opens straight into its source, the
 * same plain reading experience as any other open file; this is the one
 * affordance layered on top for the cases where seeing it rendered helps.
 */
export function MarkdownPreviewButton({ mode, onModeChange }: MarkdownPreviewButtonProps): React.ReactElement {
  const isPreview = mode === 'preview';
  return (
    <Button
      size="small"
      variant="text"
      startIcon={<Icon glyph={isPreview ? Pencil : Eye} size={14} />}
      onClick={() => onModeChange(isPreview ? 'edit' : 'preview')}
      data-testid="markdown-mode-toggle"
    >
      {isPreview ? 'Editar' : 'Prévia'}
    </Button>
  );
}

interface MarkdownBodyProps {
  mode: MarkdownBodyMode;
  body: string;
  onChangeBody: (value: string) => void;
  disabled?: boolean;
  /** CodeMirror language for the edit-mode surface. Defaults to 'markdown' — every entity body is Markdown. */
  language?: CodeLanguage;
}

/** The document itself — its editable source (CodeMirror), or its rendered form, never both at once. */
export function MarkdownBody({ mode, body, onChangeBody, disabled, language }: MarkdownBodyProps): React.ReactElement {
  if (mode === 'preview') {
    return (
      <Box
        data-testid="markdown-preview"
        sx={{
          '& h1, & h2, & h3': { mt: 1.5, mb: 1 }, '& p': { my: 1 },
          '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace' },
          '& pre': { bgcolor: 'action.hover', p: 1.5, borderRadius: 1, overflow: 'auto' },
        }}
      >
        <ReactMarkdown>{body}</ReactMarkdown>
      </Box>
    );
  }
  return (
    <CodeEditorView
      value={body}
      onChange={onChangeBody}
      language={language ?? 'markdown'}
      readOnly={disabled}
      testId="body-editor"
    />
  );
}
