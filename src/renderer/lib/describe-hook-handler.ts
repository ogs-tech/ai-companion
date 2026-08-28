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
