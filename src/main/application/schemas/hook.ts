import { z } from 'zod';
import type { HookId } from '../../domain/hook-id.js';
import type { CustomizationSource } from '../../domain/customization-source.js';

// Claude Code hook event names. Source: https://code.claude.com/docs/en/hooks.
// Kept as a permissive string union via z.string() because the docs list 28+
// events and Anthropic adds more over time — we only constrain to non-empty.
export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'Setup',
  'SessionEnd',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'Stop',
  'StopFailure',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
  'TeammateIdle',
  'InstructionsLoaded',
  'ConfigChange',
  'CwdChanged',
  'FileChanged',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'Elicitation',
  'ElicitationResult',
] as const;

export const hookEventNameSchema = z.string().min(1);
export type HookEventName = string;

const commandHandlerSchema = z
  .object({
    type: z.literal('command'),
    command: z.string().min(1),
    async: z.boolean().optional(),
    asyncRewake: z.boolean().optional(),
    shell: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    if: z.string().optional(),
  })
  .passthrough();

const httpHandlerSchema = z
  .object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    allowedEnvVars: z.array(z.string()).optional(),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    if: z.string().optional(),
  })
  .passthrough();

const mcpToolHandlerSchema = z
  .object({
    type: z.literal('mcp_tool'),
    server: z.string().min(1),
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    if: z.string().optional(),
  })
  .passthrough();

const promptHandlerSchema = z
  .object({
    type: z.literal('prompt'),
    prompt: z.string().min(1),
    model: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    if: z.string().optional(),
  })
  .passthrough();

const agentHandlerSchema = z
  .object({
    type: z.literal('agent'),
    prompt: z.string().min(1),
    model: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    statusMessage: z.string().optional(),
    if: z.string().optional(),
  })
  .passthrough();

export const hookHandlerSchema = z.discriminatedUnion('type', [
  commandHandlerSchema,
  httpHandlerSchema,
  mcpToolHandlerSchema,
  promptHandlerSchema,
  agentHandlerSchema,
]);

export type HookHandler = z.infer<typeof hookHandlerSchema>;

// One Hook entry as the app models it: a flattened tuple of (event, matcher,
// single handler). Claude's on-disk format groups handlers under (event,
// matcher); we expose each handler as its own entity so the UI can list/edit
// them independently. The HookService re-groups on save.
export interface Hook {
  id: HookId;
  event: HookEventName;
  matcher?: string;
  description?: string;
  handler: HookHandler;
  /** Set on the user's own hooks (`HookEntity.enabled`); absent on plugin and detected ones, which are always active. */
  enabled?: boolean;
  source: CustomizationSource;
}

// Persisted shape inside Claude settings.json: groups of handlers per
// (event, matcher).
const claudeHookHandlerEntrySchema = z
  .object({
    matcher: z.string().optional(),
    description: z.string().optional(),
    hooks: z.array(hookHandlerSchema.and(z.object({ _sdeAiId: z.string().optional() }).passthrough())),
  })
  .passthrough();

export const claudeHooksFieldSchema = z.record(
  z.string(),
  z.array(claudeHookHandlerEntrySchema),
);

export type ClaudeHookHandlerEntry = z.infer<typeof claudeHookHandlerEntrySchema>;
export type ClaudeHooksField = z.infer<typeof claudeHooksFieldSchema>;
