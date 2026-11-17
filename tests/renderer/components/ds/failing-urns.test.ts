import { describe, expect, it } from 'vitest';
import { failingUrns } from '../../../../src/renderer/components/ds/ChannelMarks.js';
import type { ChannelProblems } from '../../../../src/renderer/lib/entity-health.js';

describe('failingUrns', () => {
  const problems: ChannelProblems = new Map([
    ['urn:plugin:figma', ['claude']],
    ['urn:plugin:marketing', ['claude']],
    ['urn:mcp:remote', ['cursor']],
  ]);

  it('counts only the urns a group lists, not every problem of the same kind', () => {
    expect(failingUrns(problems, { urns: ['urn:plugin:figma', 'urn:plugin:github'] }, 'claude')).toEqual(['urn:plugin:figma']);
  });

  it('keeps to the channel asked for', () => {
    expect(failingUrns(problems, { urns: ['urn:mcp:remote'] }, 'claude')).toEqual([]);
    expect(failingUrns(problems, { urns: ['urn:mcp:remote'] }, 'cursor')).toEqual(['urn:mcp:remote']);
  });

  it('speaks for a single item', () => {
    expect(failingUrns(problems, { urn: 'urn:plugin:marketing' }, 'claude')).toEqual(['urn:plugin:marketing']);
  });
});
