import { useState } from 'react';
import { Box, Chip, Collapse, List, Typography } from '@mui/material';
import { FileDiff, FolderGit2, Minus, Plus, Undo2 } from 'lucide-react';
import { TreeRow } from '../../ds/TreeRow.js';
import { TreeGroupRow } from '../TreeGroup.js';
import { RowAction } from './RowAction.js';
import type { GitChange, GitFileChange } from '../../../../shared/git.js';

export interface ChangeGroups {
  /** Files with an index-side change, opened as the HEAD → index diff. */
  staged: GitFileChange[];
  /** Files with a worktree-side change (untracked included) or a conflict, opened as the index → worktree diff. */
  changes: GitFileChange[];
}

/**
 * Splits status into the two groups. A file with both staged and unstaged
 * edits appears in both. Conflicted files only appear under "Alterações" —
 * their index columns describe the merge stages, not something the user staged.
 */
export function groupChanges(files: GitFileChange[]): ChangeGroups {
  return {
    staged: files.filter(
      (f) => !f.conflicted && f.index !== 'unmodified' && f.index !== 'untracked',
    ),
    changes: files.filter((f) => f.conflicted || f.worktree !== 'unmodified'),
  };
}

const LETTER: Record<GitChange, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  unmodified: '',
};

const COLOR: Partial<Record<GitChange, string>> = {
  modified: 'warning.main',
  added: 'success.main',
  untracked: 'success.main',
  deleted: 'error.main',
  renamed: 'info.main',
  copied: 'info.main',
};

interface ChangeListProps {
  files: GitFileChange[];
  busy: boolean;
  onOpen: (file: GitFileChange, source: 'index' | 'worktree') => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (files: GitFileChange[]) => void;
}

export function ChangeList({
  files,
  busy,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: ChangeListProps): React.ReactElement {
  const { staged, changes } = groupChanges(files);
  const paths = (list: GitFileChange[]): string[] => list.map((f) => f.path);

  return (
    <>
      {staged.length > 0 && (
        <ChangeGroup
          testId="staged"
          label="Alterações em stage"
          count={staged.length}
          actions={
            <RowAction
              glyph={Minus}
              label="Remover tudo do stage"
              testId="git-unstage-all"
              disabled={busy}
              onAction={() => onUnstage(paths(staged))}
            />
          }
        >
          {staged.map((f) => (
            <ChangeRow
              key={f.path}
              group="staged"
              file={f}
              change={f.index}
              onOpen={() => onOpen(f, 'index')}
              actions={
                <RowAction
                  glyph={Minus}
                  label="Remover do stage"
                  testId={`git-unstage-${f.path}`}
                  disabled={busy}
                  onAction={() => onUnstage([f.path])}
                />
              }
            />
          ))}
        </ChangeGroup>
      )}
      <ChangeGroup
        testId="changes"
        label="Alterações"
        count={changes.length}
        actions={
          changes.length > 0 ? (
            <>
              <RowAction
                glyph={Undo2}
                label="Descartar tudo"
                testId="git-discard-all"
                disabled={busy}
                onAction={() => onDiscard(changes)}
              />
              <RowAction
                glyph={Plus}
                label="Adicionar tudo ao stage"
                testId="git-stage-all"
                disabled={busy}
                onAction={() => onStage(paths(changes))}
              />
            </>
          ) : null
        }
      >
        {changes.map((f) => (
          <ChangeRow
            key={f.path}
            group="changes"
            file={f}
            change={f.worktree}
            onOpen={() => onOpen(f, 'worktree')}
            actions={
              <>
                <RowAction
                  glyph={Undo2}
                  label="Descartar alterações"
                  testId={`git-discard-${f.path}`}
                  disabled={busy}
                  onAction={() => onDiscard([f])}
                />
                <RowAction
                  glyph={Plus}
                  label="Adicionar ao stage"
                  testId={`git-stage-${f.path}`}
                  disabled={busy}
                  onAction={() => onStage([f.path])}
                />
              </>
            }
          />
        ))}
      </ChangeGroup>
    </>
  );
}

interface ChangeGroupProps {
  testId: string;
  label: string;
  count: number;
  actions: React.ReactNode;
  children: React.ReactNode;
}

/** Like `TreeGroup`, but open by default and with group-wide actions in the header. */
function ChangeGroup({
  testId,
  label,
  count,
  actions,
  children,
}: ChangeGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <TreeRow
        testId={`git-group-${testId}`}
        pl={1.5}
        chevron={expanded ? 'expanded' : 'collapsed'}
        glyph={FolderGit2}
        primary={label}
        onClick={() => setExpanded((v) => !v)}
        badge={
          <Chip
            size="small"
            label={count}
            sx={{ height: 18, fontSize: '0.6875rem', '& .MuiChip-label': { px: 0.75 } }}
          />
        }
        actions={actions}
      />
      <Collapse in={expanded} unmountOnExit>
        {count === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid={`git-group-empty-${testId}`}
            sx={{ display: 'block', pl: 5.75, py: 0.75 }}
          >
            Nenhuma alteração
          </Typography>
        ) : (
          <List disablePadding>{children}</List>
        )}
      </Collapse>
    </>
  );
}

interface ChangeRowProps {
  group: 'staged' | 'changes';
  file: GitFileChange;
  change: GitChange;
  onOpen: () => void;
  actions: React.ReactNode;
}

function ChangeRow({ group, file, change, onOpen, actions }: ChangeRowProps): React.ReactElement {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = slash === -1 ? '' : file.path.slice(0, slash);
  const letter = file.conflicted ? '!' : LETTER[change];
  const color = file.conflicted ? 'error.main' : (COLOR[change] ?? 'text.secondary');

  return (
    <TreeGroupRow
      testId={`git-row-${group}-${file.path}`}
      glyph={FileDiff}
      onClick={onOpen}
      actions={actions}
      primary={
        <Box component="span" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
          {name}
          {dir && (
            <Box component="span" sx={{ color: 'text.secondary', ml: 0.75, fontSize: '0.75rem' }}>
              {dir}
            </Box>
          )}
        </Box>
      }
      badge={
        <Box
          component="span"
          data-testid={`git-badge-${group}-${file.path}`}
          sx={(theme) => ({
            color,
            fontFamily: theme.ogs.fonts.mono,
            fontSize: '0.75rem',
            fontWeight: 600,
            ml: 'auto',
          })}
        >
          {letter}
        </Box>
      }
    />
  );
}
