export interface HookHandler {
  type: 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';
  command?: string;
  url?: string;
  prompt?: string;
}

export function describeHookHandler(handler: HookHandler): string {
  switch (handler.type) {
    case 'command':
      return handler.command ?? '(empty command)';
    case 'http':
      return `HTTP → ${handler.url ?? '(no url)'}`;
    case 'mcp_tool':
      return 'MCP tool';
    case 'prompt':
      return `prompt: ${(handler.prompt ?? '').slice(0, 60)}`;
    case 'agent':
      return `agent: ${(handler.prompt ?? '').slice(0, 60)}`;
    default:
      return handler.type;
  }
}

/**
 * A short row label for a hook — `Event · script` for a command hook (the
 * script's file name, without directories or extension), falling back to the
 * full description for every other handler type.
 */
export function hookRowLabel(hook: { event: string; handler: HookHandler }): string {
  const { handler } = hook;
  if (handler.type !== 'command' || !handler.command) return `${hook.event} · ${describeHookHandler(handler)}`;
  const tokens = [...handler.command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  const script = tokens.find((t) => t.includes('/')) ?? tokens[0] ?? handler.command;
  const base = script.split('/').pop() ?? script;
  return `${hook.event} · ${base.replace(/\.[^.]+$/, '')}`;
}
