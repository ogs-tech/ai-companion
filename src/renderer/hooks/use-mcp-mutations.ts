import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { callIpc } from '../lib/ipc.js';
import { mcpListQueryKey } from './use-mcp-list.js';
import type { McpServerInput } from '../../shared/mcp.js';

/** Every health scope shows the same global MCP state, so refresh them all. */
const HEALTH_QUERY_ROOT = ['health'] as const;

export function useSaveMcp(): UseMutationResult<{ ok: true }, Error, { server: McpServerInput; isCreate?: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc<{ ok: true }>('mcp.save', vars),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: mcpListQueryKey() }), qc.invalidateQueries({ queryKey: HEALTH_QUERY_ROOT })]),
  });
}

export function useDeleteMcp(): UseMutationResult<{ ok: true }, Error, { id: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => callIpc<{ ok: true }>('mcp.delete', vars),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: mcpListQueryKey() }), qc.invalidateQueries({ queryKey: HEALTH_QUERY_ROOT })]),
  });
}

// Opens the external claude.ai connectors page; the actual OAuth happens there.
// Health is re-probed separately (`useRefreshMcpHealth`) once the user comes back from the browser.
export function useAuthenticateMcp(): UseMutationResult<{ ok: true }, Error, { id: string }> {
  return useMutation({
    mutationFn: (vars) => callIpc<{ ok: true }>('mcp.authenticate', vars),
  });
}

/** Re-probes every server's live state (`claude mcp list`), then refreshes the list and the warnings. */
export function useRefreshMcpHealth(): UseMutationResult<{ ok: true }, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callIpc<{ ok: true }>('mcp.refreshHealth', {}),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: mcpListQueryKey() }), qc.invalidateQueries({ queryKey: HEALTH_QUERY_ROOT })]),
  });
}
