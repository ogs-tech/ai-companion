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
  // Skip shell noise (`[`, `&&`, `test`, flags, `KEY=value`) so the label names the script, never a bare operator.
  const candidates = tokens.filter((t) => /[A-Za-z0-9]/.test(t) && !t.startsWith('-') && !SHELL_WORDS.has(t) && !/^\w+=/.test(t));
  // Prefer a real script file (path with an extension), then any path, then the first word.
  const script = candidates.find((t) => t.includes('/') && /\.\w+$/.test(t)) ?? candidates.find((t) => t.includes('/')) ?? candidates[0];
  const base = script?.split('/').pop()?.replace(/\.[^.]+$/, '');
  if (base === undefined || base === '') return `${hook.event} · ${handler.command.trim().slice(0, 40)}`;
  return `${hook.event} · ${base}`;
}

const SHELL_WORDS = new Set(['test', 'if', 'then', 'else', 'fi', 'bash', 'sh', 'zsh', 'env', 'exec']);
