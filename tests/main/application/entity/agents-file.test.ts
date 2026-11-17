import { describe, expect, it } from 'vitest';
import { GENERATED_FILE_MARKER, renderAgentsFile } from '../../../../src/main/application/entity/agents-file.js';
import { WORKSPACE_SOURCE, type Instruction } from '../../../../src/shared/entity.js';

const instruction = (content: string): Instruction => ({
  urn: 'urn:instruction:default', kind: 'instruction', enabled: true, name: 'default', description: '',
  scopes: ['personal'], metadata: { version: '0.0.0', createdAt: '', updatedAt: '' },
  source: WORKSPACE_SOURCE, content,
});

describe('renderAgentsFile', () => {
  it('prepends the marker as the first line', () => {
    const out = renderAgentsFile(instruction('Always reply in pt-BR.'));
    expect(out.startsWith(GENERATED_FILE_MARKER)).toBe(true);
  });

  it('separates the marker from the body with a blank line and preserves the body', () => {
    const out = renderAgentsFile(instruction('Line 1\nLine 2'));
    expect(out).toBe(`${GENERATED_FILE_MARKER}\n\nLine 1\nLine 2\n`);
  });

  it('does not double a trailing newline already present in the body', () => {
    const out = renderAgentsFile(instruction('Body\n'));
    expect(out).toBe(`${GENERATED_FILE_MARKER}\n\nBody\n`);
  });
});
