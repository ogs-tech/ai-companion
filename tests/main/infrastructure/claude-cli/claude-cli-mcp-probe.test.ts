import { describe, expect, it } from 'vitest';
import { normalizeMcpName, parseMcpList } from '../../../../src/main/infrastructure/claude-cli/claude-cli-mcp-probe.js';

const OUTPUT = `Checking MCP server health…

claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:context7:context7: https://mcp.context7.com/mcp?client=claude-code-plugin (HTTP) - ! Needs authentication
plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✘ Failed to connect — HTTP 400: bad request
`;

describe('parseMcpList', () => {
  it('maps each line to a runtime name and state, skipping the banner', () => {
    expect(parseMcpList(OUTPUT)).toEqual([
      { name: 'claude-ai-Google-Drive', state: 'connected' },
      { name: 'plugin-context7-context7', state: 'needs-auth' },
      { name: 'plugin-github-github', state: 'failed', detail: 'HTTP 400: bad request' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseMcpList('')).toEqual([]);
  });
});

describe('normalizeMcpName', () => {
  it('matches the runtime naming for claude.ai connectors', () => {
    expect(normalizeMcpName('claude.ai Google Calendar')).toBe('claude-ai-Google-Calendar');
  });
});
