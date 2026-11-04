import { Box, Tooltip, Typography } from '@mui/material';
import { Minus, Plus, Undo2, type LucideIcon } from 'lucide-react';
import { Icon } from '../../ds/Icon.js';
import { SectionAction, SectionHeader } from '../../ds/ContainerChrome.js';
import { COLOR, LETTER, groupChanges } from './git-decorations.js';
import type { GitDiffSource, GitFileChange } from '../../../../shared/git.js';

interface GitChangesListProps {
  files: GitFileChange[];
  busy: boolean;
  /** Paths are the repository's own (folder-relative in a multi-folder workspace). */
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (files: GitFileChange[]) => void;
  onOpenDiff: (path: string, source: GitDiffSource) => void;
}

function RowButton({ label, testId, glyph, disabled, onClick }: { label: string; testId: string; glyph: LucideIcon; disabled: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Tooltip title={label}>
      <Box
        component="button"
        type="button"
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onClick();
        }}
        sx={{ display: 'inline-flex', p: 0.5, border: 'none', bgcolor: 'transparent', color: 'text.secondary', cursor: 'pointer', borderRadius: 0.5, '&:hover:not(:disabled)': { color: 'text.primary', bgcolor: 'action.hover' } }}
      >
        <Icon glyph={glyph} size={13} />
      </Box>
    </Tooltip>
  );
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

interface ChangeRowProps {
  file: GitFileChange;
  side: 'staged' | 'changes';
  busy: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (files: GitFileChange[]) => void;
  onOpenDiff: (path: string, source: GitDiffSource) => void;
}

function ChangeRow({ file, side, busy, onStage, onUnstage, onDiscard, onOpenDiff }: ChangeRowProps): React.ReactElement {
  const staged = side === 'staged';
  const kind = file.conflicted ? null : staged ? file.index : file.worktree;
  const letter = file.conflicted ? '!' : LETTER[kind ?? 'unmodified'];
  const color = file.conflicted ? 'error.main' : (COLOR[kind ?? 'unmodified'] ?? 'text.secondary');
  const { name, dir } = splitPath(file.path);
  const testId = `git-change-${side}-${file.path}`;
  const open = (): void => onOpenDiff(file.path, { kind: staged ? 'index' : 'worktree' });
  return (
    <Box
      data-testid={testId}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open();
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: 1.5,
        pr: 0.5,
        py: 0.125,
        cursor: 'pointer',
        '&:hover, &:focus-within': { bgcolor: 'action.hover' },
        '& .row-actions': { visibility: 'hidden' },
        '&:hover .row-actions, &:focus-within .row-actions': { visibility: 'visible' },
      }}
    >
      <Typography component="span" sx={{ width: 12, fontSize: '0.7rem', fontWeight: 600, color, flexShrink: 0, textAlign: 'center' }}>
        {letter}
      </Typography>
      <Typography component="span" sx={{ fontSize: '0.8rem' }} noWrap title={file.path}>
        {name}
      </Typography>
      <Typography component="span" sx={{ fontSize: '0.7rem', color: 'text.disabled', flex: 1, minWidth: 0 }} noWrap>
        {dir}
      </Typography>
      <Box className="row-actions" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        {!staged && !file.conflicted && (
          <RowButton label={`Descartar ${name}…`} testId={`${testId}-discard`} glyph={Undo2} disabled={busy} onClick={() => onDiscard([file])} />
        )}
        {staged ? (
          <RowButton label={`Unstage ${name}`} testId={`${testId}-unstage`} glyph={Minus} disabled={busy} onClick={() => onUnstage([file.path])} />
        ) : (
          <RowButton label={`Stage ${name}`} testId={`${testId}-stage`} glyph={Plus} disabled={busy} onClick={() => onStage([file.path])} />
        )}
      </Box>
    </Box>
  );
}

/**
 * A repository's working state as two groups: Staged (index side, opens the
 * HEAD → index diff) and Alterações (worktree side and conflicts, opens
 * index → worktree). A file edited on both sides appears in both.
 */
export function GitChangesList({ files, busy, onStage, onUnstage, onDiscard, onOpenDiff }: GitChangesListProps): React.ReactElement {
  const { staged, changes } = groupChanges(files);
  if (staged.length === 0 && changes.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" data-testid="git-clean" sx={{ display: 'block', px: 1.5, py: 1 }}>
        Nenhuma alteração
      </Typography>
    );
  }
  // Conflicted files can't be discarded in one click — same rule as the per-row button.
  const discardable = changes.filter((f) => !f.conflicted);
  const rowProps = { busy, onStage, onUnstage, onDiscard, onOpenDiff };
  return (
    <Box data-testid="git-changes-list">
      {staged.length > 0 && (
        <>
          <SectionHeader
            title="Staged"
            testId="git-group-staged"
            count={staged.length}
            actions={
              <SectionAction label="Unstage all" testId="git-unstage-all" glyph={Minus} disabled={busy} onClick={() => onUnstage(staged.map((f) => f.path))} />
            }
          />
          {staged.map((f) => (
            <ChangeRow key={`s:${f.path}`} file={f} side="staged" {...rowProps} />
          ))}
        </>
      )}
      {changes.length > 0 && (
        <>
          <SectionHeader
            title="Changes"
            testId="git-group-changes"
            count={changes.length}
            actions={
              <>
                <SectionAction label="Stage all" testId="git-stage-all" glyph={Plus} disabled={busy} onClick={() => onStage(changes.map((f) => f.path))} />
                <SectionAction
                  label="Descartar tudo…"
                  testId="git-discard-all"
                  glyph={Undo2}
                  disabled={busy || discardable.length === 0}
                  onClick={() => onDiscard(discardable)}
                />
              </>
            }
          />
          {changes.map((f) => (
            <ChangeRow key={`c:${f.path}`} file={f} side="changes" {...rowProps} />
          ))}
        </>
      )}
    </Box>
  );
}
