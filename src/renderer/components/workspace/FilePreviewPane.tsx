import { Alert, Box, Typography } from '@mui/material';
import { FileX } from 'lucide-react';
import { EmptyState } from '../ds/EmptyState.js';
import { useFilePreview } from '../../hooks/use-file-browser.js';
import { fonts } from '../../tokens.js';

interface FilePreviewPaneProps {
  path: string | null;
}

export function FilePreviewPane({ path }: FilePreviewPaneProps): React.ReactElement {
  const { data: preview, isLoading, isError, error } = useFilePreview(path);

  if (path === null) {
    return (
      <Box data-testid="file-preview-empty">
        <EmptyState glyph={FileX} title="Nenhum arquivo selecionado" description="Escolha um arquivo na árvore para visualizar o conteúdo." testId="file-preview-empty-state" />
      </Box>
    );
  }

  if (isError) {
    return (
      <Box data-testid="file-preview-error" sx={{ p: 2 }}>
        <EmptyState
          glyph={FileX}
          title="Não foi possível carregar o arquivo"
          description={error instanceof Error ? error.message : 'Tente novamente.'}
          testId="file-preview-error"
        />
      </Box>
    );
  }

  if (isLoading || !preview) {
    return <Box data-testid="file-preview-loading" sx={{ p: 2 }} />;
  }

  if (!preview.previewable) {
    return (
      <Box data-testid="file-preview-not-previewable" sx={{ p: 2 }}>
        <EmptyState glyph={FileX} title="Não é possível pré-visualizar" description={preview.reason} testId="file-preview-reason" />
      </Box>
    );
  }

  return (
    <Box data-testid="file-preview-content">
      {preview.truncated && (
        <Alert severity="info" data-testid="file-preview-truncated-notice" sx={{ mb: 1.5 }}>
          Arquivo grande — mostrando apenas o início.
        </Alert>
      )}
      <Typography
        component="pre"
        sx={{
          fontFamily: fonts.mono,
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          m: 0,
        }}
      >
        {preview.content}
      </Typography>
    </Box>
  );
}
