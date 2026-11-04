import { useState } from 'react';
import { Alert, Box, Skeleton, Tooltip, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CircleAlert, Folder, RefreshCw } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { SectionAction, SectionHeader } from '../../ds/ContainerChrome.js';
import { ExplorerToolbar, GIT_NOT_FOUND_MESSAGE } from '../ExplorerToolbar.js';
import { CommitBar } from './CommitBar.js';
import { DiscardConfirmDialog } from './DiscardConfirmDialog.js';
import { GitChangesList } from './GitChangesList.js';
import { GitErrorAlert } from './GitErrorAlert.js';
import { GitInitCard } from './GitInit.js';
import { RepoMeta } from './RepoMeta.js';
import { groupChanges } from './git-decorations.js';
import { useGitActions } from './use-git-actions.js';
import { useGitStatus } from '../../../hooks/use-git.js';
import type { FolderRouting } from '../../../hooks/use-folder-routing.js';
import type { GitDiffSource } from '../../../../shared/git.js';

interface GitViewProps {
  gitPolling: boolean;
  onOpenGitDiff: (args: { path: string; source: GitDiffSource }) => void;
}

/**
 * The Git view of a single-folder workspace: header (branch, sync), the
 * Staged and Changes sections, and one primary "Commit (n)" pinned at the
 * bottom. `workspaceId` is only for the init card's dismissal.
 */
export function SingleRepoGitView({ workspaceId, gitPolling, onOpenGitDiff }: GitViewProps & { workspaceId: string | undefined }): React.ReactElement {
  const status = useGitStatus({ visible: gitPolling });
  const actions = useGitActions();
  const data = status.data;
  const repo = data?.isRepo ? data : null;
  const staged = repo ? groupChanges(repo.files).staged : [];

  return (
    <>
      <ExplorerToolbar status={{ isPending: status.isPending, error: status.error, data }} actions={actions} />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {actions.error && <GitErrorAlert report={actions.error} onClose={actions.clearError} onPullAndRetry={actions.sync} />}
        {repo && repo.state !== 'clean' && (
          <Alert severity="warning" sx={{ mx: 1.5, mt: 1, mb: 1 }} data-testid="git-state-banner">
            Operação em andamento ({repo.state}). Resolva ou aborte pelo terminal.
          </Alert>
        )}
        {repo && (
          <GitChangesList
            files={repo.files}
            busy={actions.busy}
            onStage={actions.stage}
            onUnstage={actions.unstage}
            onDiscard={actions.requestDiscard}
            onOpenDiff={(path, source) => onOpenGitDiff({ path, source })}
          />
        )}
        {repo?.truncated && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }} data-testid="git-truncated">
            Mostrando os primeiros {repo.files.length} arquivos.
          </Typography>
        )}
        {data && !data.isRepo && workspaceId !== undefined && <GitInitCard workspaceId={workspaceId} busy={actions.busy} onInit={actions.init} />}
      </Box>
      {repo && <CommitBar variant="primary" stagedCount={staged.length} actions={actions} />}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </>
  );
}

interface RepoRowProps extends GitViewProps {
  folder: string;
  alias: string;
  /** Folder-relative path → workspace-relative, the form diff tabs use. */
  toWorkspacePath: (path: string) => string;
}

/**
 * One folder of a multi-folder workspace. Dirty folders open with their
 * files; clean ones stay collapsed; a folder without git is a single muted
 * line that initialises it on click.
 */
function RepoRow({ folder, alias, gitPolling, toWorkspacePath, onOpenGitDiff }: RepoRowProps): React.ReactElement {
  const status = useGitStatus({ visible: gitPolling, folder });
  const actions = useGitActions(folder);
  // `null` follows the folder's state (dirty = open); a click pins the choice for this view.
  const [override, setOverride] = useState<boolean | null>(null);
  const data = status.data;
  const repo = data?.isRepo ? data : null;
  const dirty = repo !== null && repo.files.length > 0;
  const expanded = override ?? dirty;
  const testId = `folder-git-${alias}`;

  if (status.error) {
    const message = status.error.message === 'GitNotFound' ? GIT_NOT_FOUND_MESSAGE : `Não foi possível ler o status: ${status.error.message}`;
    return (
      <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5, pr: 1, py: 0.5 }}>
        <Icon glyph={Folder} size={14} />
        <Typography component="span" noWrap sx={{ fontSize: '0.8rem', flex: 1 }}>{alias}</Typography>
        <Tooltip title={message}>
          <Box component="span" role="img" aria-label={message} data-testid={`folder-git-error-${alias}`} sx={{ display: 'inline-flex', color: 'warning.main' }}>
            <Icon glyph={CircleAlert} size={14} />
          </Box>
        </Tooltip>
      </Box>
    );
  }
  if (status.isPending || !data) {
    return (
      <Box data-testid={testId} sx={{ pl: 1.5, pr: 1, py: 0.75 }}>
        <Skeleton variant="rounded" height={18} />
      </Box>
    );
  }
  if (!data.isRepo) {
    return (
      <Box
        data-testid={testId}
        role="button"
        tabIndex={0}
        aria-label={`Iniciar git em ${alias}`}
        onClick={() => actions.init()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            actions.init();
          }
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1.5, pr: 1, py: 0.5, opacity: 0.6, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Icon glyph={Folder} size={14} />
        <Typography component="span" noWrap sx={{ fontSize: '0.8rem' }}>{alias}</Typography>
        <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary', ml: 'auto', flexShrink: 0 }}>sem git · iniciar</Typography>
      </Box>
    );
  }

  const staged = groupChanges(repo?.files ?? []).staged;
  return (
    <Box data-testid={testId}>
      <Box
        data-testid={`${testId}-header`}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setOverride(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOverride(!expanded);
          }
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 1, pr: 1, py: 0.5, cursor: 'pointer', opacity: dirty ? 1 : 0.6, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Icon glyph={expanded ? ChevronDown : ChevronRight} size={14} />
        <Icon glyph={Folder} size={14} />
        <Typography component="span" noWrap sx={{ fontSize: '0.8rem' }} title={folder}>{alias}</Typography>
        <RepoMeta status={data} testId={`${testId}-meta`} />
        {!dirty && <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.secondary', flexShrink: 0 }}>· limpo</Typography>}
      </Box>
      {expanded && repo && (
        <Box>
          {actions.error && <GitErrorAlert report={actions.error} onClose={actions.clearError} onPullAndRetry={actions.sync} />}
          {repo.state !== 'clean' && (
            <Alert severity="warning" sx={{ mx: 1.5, mt: 1, mb: 1 }}>
              {alias}: operação em andamento ({repo.state}). Resolva ou aborte pelo terminal.
            </Alert>
          )}
          <GitChangesList
            files={repo.files}
            busy={actions.busy}
            onStage={(paths) => actions.stage(paths)}
            onUnstage={(paths) => actions.unstage(paths)}
            onDiscard={(files) => actions.requestDiscard(files)}
            onOpenDiff={(path, source) => onOpenGitDiff({ path: toWorkspacePath(path), source })}
          />
          {repo.truncated && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.5 }}>
              {alias}: mostrando os primeiros {repo.files.length} arquivos.
            </Typography>
          )}
          {dirty && <CommitBar variant="link" stagedCount={staged.length} actions={actions} folderLabel={alias} />}
        </Box>
      )}
      <DiscardConfirmDialog files={actions.pendingDiscard} onCancel={actions.cancelDiscard} onConfirm={actions.confirmDiscard} />
    </Box>
  );
}

/** The Git view of a multi-folder workspace: one list of repositories. Each folder is its own repository, so commit stays per folder. */
export function RepositoriesView({ routing, gitPolling, onOpenGitDiff }: GitViewProps & { routing: FolderRouting }): React.ReactElement {
  const queryClient = useQueryClient();
  return (
    <>
      <SectionHeader
        title="Repositórios"
        testId="git-repositories-header"
        actions={
          <SectionAction
            label="Atualizar repositórios"
            testId="git-repositories-refresh"
            glyph={RefreshCw}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['git'] })}
          />
        }
      />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {routing.folders.map((folder) => (
          <RepoRow
            key={folder}
            folder={folder}
            alias={routing.aliases[folder] as string}
            gitPolling={gitPolling}
            toWorkspacePath={(path) => routing.join(folder, path)}
            onOpenGitDiff={onOpenGitDiff}
          />
        ))}
      </Box>
    </>
  );
}
