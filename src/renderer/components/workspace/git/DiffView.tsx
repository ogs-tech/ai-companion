import { alpha, Box, Typography } from '@mui/material';
import { useGitDiff } from '../../../hooks/use-git.js';
import type { GitDiffLine, GitDiffSource, GitFileDiff } from '../../../../shared/git.js';

interface DiffViewProps {
  projectId?: string;
  path: string;
  source: GitDiffSource;
}

/** A Workbench tab's body: one file's diff, fetched for its own target. */
export function DiffView({ projectId, path, source }: DiffViewProps): React.ReactElement {
  const query = useGitDiff(projectId, path, source);

  if (query.isPending) return <Notice testId="git-diff-loading">Carregando diff…</Notice>;
  if (query.isError)
    return (
      <Notice testId="git-diff-error">
        Não foi possível carregar o diff: {query.error.message}
      </Notice>
    );
  return <DiffBody diff={query.data} />;
}

/** Read-only unified diff: old/new line-number gutters, a +/- marker column, tinted add/del rows. */
export function DiffBody({ diff }: { diff: GitFileDiff }): React.ReactElement {
  if (diff.kind === 'binary')
    return <Notice testId="git-diff-binary">Arquivo binário — sem diff de texto.</Notice>;
  if (diff.kind === 'too-large') {
    return (
      <Notice testId="git-diff-too-large">
        Diff grande demais para exibir ({Math.round(diff.bytes / 1024)} KB).
      </Notice>
    );
  }
  if (diff.hunks.length === 0) {
    return <Notice testId="git-diff-empty">Sem alterações de texto neste arquivo.</Notice>;
  }

  return (
    <Box
      data-testid="git-diff"
      sx={(theme) => ({
        fontFamily: theme.ogs.fonts.mono,
        fontSize: '0.8125rem',
        lineHeight: 1.6,
        overflow: 'auto',
        height: '100%',
      })}
    >
      {diff.oldPath !== undefined && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 2, py: 1 }}
        >
          Renomeado de {diff.oldPath}
        </Typography>
      )}
      {diff.hunks.map((hunk, h) => (
        <Box key={h} component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <tbody>
            <Box component="tr" sx={{ color: 'text.secondary', bgcolor: 'action.hover' }}>
              <Box component="td" colSpan={4} sx={{ px: 2, py: 0.25, whiteSpace: 'pre' }}>
                {hunk.header}
              </Box>
            </Box>
            {hunk.lines.map((line, i) => (
              <DiffRow key={i} line={line} />
            ))}
          </tbody>
        </Box>
      ))}
    </Box>
  );
}

const MARKER: Record<GitDiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };

function DiffRow({ line }: { line: GitDiffLine }): React.ReactElement {
  return (
    <Box
      component="tr"
      data-testid={`git-diff-line-${line.kind}`}
      sx={(theme) => {
        const color =
          line.kind === 'add'
            ? theme.palette.success.main
            : line.kind === 'del'
              ? theme.palette.error.main
              : null;
        return color ? { bgcolor: alpha(color, 0.12), '& .marker': { color } } : {};
      }}
    >
      <Gutter value={line.oldNo} />
      <Gutter value={line.newNo} />
      <Box
        component="td"
        className="marker"
        sx={{ width: 16, pl: 1, userSelect: 'none', color: 'text.secondary' }}
      >
        {MARKER[line.kind]}
      </Box>
      <Box component="td" sx={{ pr: 2, whiteSpace: 'pre' }}>
        {line.text}
      </Box>
    </Box>
  );
}

function Gutter({ value }: { value: number | undefined }): React.ReactElement {
  return (
    <Box
      component="td"
      sx={{
        width: 48,
        px: 1,
        textAlign: 'right',
        color: 'text.disabled',
        userSelect: 'none',
        borderRight: 1,
        borderColor: 'divider',
      }}
    >
      {value ?? ''}
    </Box>
  );
}

function Notice({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Typography data-testid={testId} variant="body2" color="text.secondary" sx={{ p: 3 }}>
      {children}
    </Typography>
  );
}
