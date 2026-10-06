import { useState } from 'react';
import { Alert, Box, Button, Collapse, MenuItem, TextField, Typography } from '@mui/material';
import { GitBranch } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { ChangeList, groupChanges } from './ChangeList.js';
import { CommitBox } from './CommitBox.js';
import { DiscardConfirmDialog } from './DiscardConfirmDialog.js';
import { IpcCallError } from '../../../lib/ipc.js';
import {
  useGitCommit,
  useGitDiscard,
  useGitInit,
  useGitStage,
  useGitStatus,
  useGitUnstage,
} from '../../../hooks/use-git.js';
import type { GitBranchHead, GitDiffSource, GitFileChange } from '../../../../shared/git.js';
import type { Project } from '../../../../shared/project.js';

const WORKSPACE_ROOT = '__workspace__';

interface GitViewProps {
  /** Target repo; `undefined` = the active workspace's root. */
  projectId: string | undefined;
  /** Status polls only while the view is on screen. */
  visible: boolean;
  /** More than one registered Project → a picker at the top, since status is per repo. */
  projects: ReadonlyArray<Project>;
  onSelectProject: (projectId: string | null) => void;
  onOpenDiff: (args: { projectId?: string; path: string; source: GitDiffSource }) => void;
}

interface ErrorReport {
  message: string;
  stderr?: string;
  files?: string[];
}

function toReport(err: unknown): ErrorReport {
  if (!(err instanceof IpcCallError))
    return { message: err instanceof Error ? err.message : String(err) };
  const stderr = err.details?.['stderr'];
  const files = err.details?.['files'];
  return {
    message: err.message,
    ...(typeof stderr === 'string' && stderr.length > 0 ? { stderr } : {}),
    ...(Array.isArray(files)
      ? { files: files.filter((f): f is string => typeof f === 'string') }
      : {}),
  };
}

/** The Explorer Panel's "Git" view: working-tree status, stage/unstage/discard, commit. */
export function GitView({
  projectId,
  visible,
  projects,
  onSelectProject,
  onOpenDiff,
}: GitViewProps): React.ReactElement {
  const status = useGitStatus(projectId, { visible });
  const stage = useGitStage(projectId);
  const unstage = useGitUnstage(projectId);
  const discard = useGitDiscard(projectId);
  const commit = useGitCommit(projectId);
  const init = useGitInit(projectId);
  const [error, setError] = useState<ErrorReport | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<GitFileChange[] | null>(null);

  const busy =
    stage.isPending || unstage.isPending || discard.isPending || commit.isPending || init.isPending;

  const run = <T,>(promise: Promise<T>): Promise<T> => {
    setError(null);
    return promise.catch((err: unknown) => {
      setError(toReport(err));
      throw err;
    });
  };
  const fireAndReport = (promise: Promise<unknown>): void =>
    void run(promise).catch(() => undefined);

  const picker =
    projects.length > 1 ? (
      <Box sx={{ px: 1.5, pt: 1 }}>
        <TextField
          select
          size="small"
          fullWidth
          label="Repositório"
          value={projectId ?? WORKSPACE_ROOT}
          onChange={(e) =>
            onSelectProject(e.target.value === WORKSPACE_ROOT ? null : e.target.value)
          }
          slotProps={{ htmlInput: { 'data-testid': 'git-project-picker' } }}
        >
          <MenuItem value={WORKSPACE_ROOT}>Raiz do workspace</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>
    ) : null;

  const body = (() => {
    if (status.isPending) return <Message testId="git-loading">Lendo status…</Message>;
    if (status.isError) {
      const notFound = status.error.message === 'GitNotFound';
      return (
        <Message testId={notFound ? 'git-not-found' : 'git-status-error'}>
          {notFound
            ? 'O git não foi encontrado no PATH. Instale o git (ex.: xcode-select --install ou Homebrew) e reabra o app.'
            : `Não foi possível ler o status: ${status.error.message}`}
        </Message>
      );
    }
    const data = status.data;
    if (!data.isRepo) {
      return (
        <Box
          data-testid="git-not-a-repo"
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            alignItems: 'flex-start',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Esta pasta não é um repositório git.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            data-testid="git-init-btn"
            onClick={() => fireAndReport(init.mutateAsync({}))}
          >
            Inicializar repositório
          </Button>
        </Box>
      );
    }

    const stagedCount = groupChanges(data.files).staged.length;
    return (
      <>
        <HeadLine head={data.head} />
        {data.state !== 'clean' && (
          <Alert severity="warning" sx={{ mx: 1.5, mb: 1 }} data-testid="git-state-banner">
            Operação em andamento ({data.state}). Resolva ou aborte pelo terminal.
          </Alert>
        )}
        <CommitBox
          stagedCount={stagedCount}
          busy={busy}
          onCommit={(message, amend) =>
            run(commit.mutateAsync({ message, amend })).then(() => undefined)
          }
        />
        {data.truncated && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 1.5 }}
            data-testid="git-truncated"
          >
            Mostrando os primeiros {data.files.length} arquivos.
          </Typography>
        )}
        <ChangeList
          files={data.files}
          busy={busy}
          onOpen={(file, source) =>
            onOpenDiff({
              ...(projectId !== undefined ? { projectId } : {}),
              path: file.path,
              source: { kind: source },
            })
          }
          onStage={(paths) => fireAndReport(stage.mutateAsync({ paths }))}
          onUnstage={(paths) => fireAndReport(unstage.mutateAsync({ paths }))}
          onDiscard={setPendingDiscard}
        />
      </>
    );
  })();

  return (
    <Box data-testid="git-view">
      {picker}
      {error && <ErrorAlert report={error} onClose={() => setError(null)} />}
      {body}
      <DiscardConfirmDialog
        files={pendingDiscard}
        onCancel={() => setPendingDiscard(null)}
        onConfirm={() => {
          const files = pendingDiscard ?? [];
          setPendingDiscard(null);
          fireAndReport(discard.mutateAsync({ paths: files.map((f) => f.path) }));
        }}
      />
    </Box>
  );
}

function HeadLine({ head }: { head: GitBranchHead }): React.ReactElement {
  const label =
    head.name ?? (head.oid ? `HEAD destacado (${head.oid.slice(0, 7)})` : 'HEAD destacado');
  return (
    <Box
      data-testid="git-head"
      sx={{
        px: 1.5,
        pt: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        color: 'text.secondary',
      }}
    >
      <Icon glyph={GitBranch} size={13} />
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {head.oid === null && <Typography variant="caption">· sem commits</Typography>}
      {(head.ahead > 0 || head.behind > 0) && (
        <Typography variant="caption">
          · ↑{head.ahead} ↓{head.behind}
        </Typography>
      )}
    </Box>
  );
}

function ErrorAlert({
  report,
  onClose,
}: {
  report: ErrorReport;
  onClose: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hasDetails = report.stderr !== undefined || (report.files?.length ?? 0) > 0;
  return (
    <Alert
      severity="error"
      onClose={onClose}
      data-testid="git-error"
      sx={{ mx: 1.5, mt: 1, '& .MuiAlert-message': { minWidth: 0, flex: 1 } }}
    >
      <Box sx={{ wordBreak: 'break-word' }}>{report.message}</Box>
      {hasDetails && (
        <>
          <Button
            size="small"
            color="inherit"
            sx={{ px: 0, minWidth: 0 }}
            onClick={() => setOpen((v) => !v)}
            data-testid="git-error-details-toggle"
          >
            {open ? 'Ocultar detalhes' : 'Ver detalhes'}
          </Button>
          <Collapse in={open}>
            <Box
              component="pre"
              data-testid="git-error-details"
              sx={(theme) => ({
                m: 0,
                fontFamily: theme.ogs.fonts.mono,
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              })}
            >
              {[
                ...(report.files ?? []),
                ...(report.stderr !== undefined ? [report.stderr] : []),
              ].join('\n')}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}

function Message({
  testId,
  children,
}: {
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Typography data-testid={testId} variant="body2" color="text.secondary" sx={{ p: 2 }}>
      {children}
    </Typography>
  );
}
