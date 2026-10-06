import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  DiffBody,
  DiffView,
} from '../../../../../src/renderer/components/workspace/git/DiffView.js';
import { mockApi, ok, renderWithQuery, renderWithTheme } from '../../../test-utils.js';
import type { GitFileDiff } from '../../../../../src/shared/git.js';

const text: GitFileDiff = {
  kind: 'text',
  path: 'a.ts',
  hunks: [
    {
      header: '@@ -1,2 +1,2 @@',
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: 'context', text: 'keep', oldNo: 1, newNo: 1 },
        { kind: 'del', text: 'old', oldNo: 2 },
        { kind: 'add', text: 'new', newNo: 2 },
      ],
    },
  ],
};

describe('DiffBody', () => {
  it('renders hunk headers and add/del/context rows with line numbers', () => {
    renderWithTheme(<DiffBody diff={text} />);
    expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeInTheDocument();
    expect(screen.getAllByTestId('git-diff-line-context')).toHaveLength(1);
    expect(screen.getByTestId('git-diff-line-del')).toHaveTextContent('2-old');
    expect(screen.getByTestId('git-diff-line-add')).toHaveTextContent('2+new');
  });

  it.each([
    [{ kind: 'binary', path: 'i.png' } as GitFileDiff, 'git-diff-binary'],
    [{ kind: 'too-large', path: 'b', bytes: 2_000_000 } as GitFileDiff, 'git-diff-too-large'],
    [{ kind: 'text', path: 's.sh', hunks: [] } as GitFileDiff, 'git-diff-empty'],
  ])('renders a notice for %o', (diff, testId) => {
    renderWithTheme(<DiffBody diff={diff} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});

describe('DiffView', () => {
  it('fetches the diff for its own target and source', async () => {
    const call = mockApi();
    call.mockResolvedValue(ok(text));
    renderWithQuery(<DiffView projectId="p1" path="a.ts" source={{ kind: 'index' }} />);

    expect(await screen.findByTestId('git-diff')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('git.diff', {
      projectId: 'p1',
      path: 'a.ts',
      source: { kind: 'index' },
    });
  });
});
