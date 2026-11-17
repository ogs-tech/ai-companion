import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { UNDO_DELETE_WINDOW_MS, useUndoableDelete } from '../../../src/renderer/hooks/use-undoable-delete.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useUndoableDelete', () => {
  it('hides the row at once and commits only after the undo window', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useUndoableDelete());
    act(() => result.current.requestDelete({ key: 'skill:tdd', message: '"tdd" excluído', commit }));
    expect(result.current.pendingKeys.has('skill:tdd')).toBe(true);
    expect(result.current.toast).toMatchObject({ message: '"tdd" excluído', action: { label: 'Desfazer' } });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_DELETE_WINDOW_MS); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.current.pendingKeys.has('skill:tdd')).toBe(false);
  });

  it('Desfazer before the window ends never commits and brings the row back', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useUndoableDelete());
    act(() => result.current.requestDelete({ key: 'k', message: 'm', commit }));
    act(() => result.current.toast?.action?.onClick());
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_DELETE_WINDOW_MS * 2); });
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.pendingKeys.size).toBe(0);
    expect(result.current.toast).toBeNull();
  });

  it('a failed commit brings the row back with an error toast', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useUndoableDelete());
    act(() => result.current.requestDelete({ key: 'k', message: 'm', commit }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_DELETE_WINDOW_MS); });
    expect(result.current.pendingKeys.size).toBe(0);
    expect(result.current.toast).toMatchObject({ variant: 'error' });
    expect(result.current.toast?.message).toContain('disk full');
  });

  it('commits every pending delete when unmounted before the window ends (Review Focus 4)', () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useUndoableDelete());
    act(() => {
      result.current.requestDelete({ key: 'a', message: 'a', commit: a });
      result.current.requestDelete({ key: 'b', message: 'b', commit: b });
    });
    unmount();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
