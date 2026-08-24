import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { queryClient } from '../../../../src/renderer/lib/query-client.js';
import * as ipc from '../../../../src/renderer/lib/ipc.js';
import { createAppTheme } from '../../../../src/renderer/theme.js';
import { FilePreviewPane } from '../../../../src/renderer/components/workspace/FilePreviewPane.js';

const renderPane = (path: string | null) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <FilePreviewPane path={path} />
      </ThemeProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('FilePreviewPane', () => {
  it('shows an empty placeholder when no file is selected', () => {
    renderPane(null);
    expect(screen.getByTestId('file-preview-empty')).toBeInTheDocument();
  });

  it('renders previewable text content', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, content: 'hello world', truncated: false });
    renderPane('a.txt');
    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('shows a truncated notice when the preview was cut off', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: true, content: 'partial', truncated: true });
    renderPane('big.txt');
    expect(await screen.findByTestId('file-preview-truncated-notice')).toBeInTheDocument();
  });

  it('shows the not-previewable placeholder with the given reason', async () => {
    vi.spyOn(ipc, 'callIpc').mockResolvedValue({ previewable: false, reason: 'File appears to be binary' });
    renderPane('image.png');
    expect(await screen.findByText('File appears to be binary')).toBeInTheDocument();
  });
});
