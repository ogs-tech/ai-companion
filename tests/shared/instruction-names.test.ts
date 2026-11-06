import { describe, expect, it } from 'vitest';
import { folderInstructionName, instructionSlug, workspaceInstructionName } from '../../src/shared/instruction-names.js';

const workspace = { rootPath: '/r/core-services', extraFolders: ['/r/ui-core', '/r/Vendors Bees'] };

describe('instruction names', () => {
  it('slugs a folder name the way instruction slugs are validated', () => {
    expect(instructionSlug('Vendors Bees')).toBe('vendors-bees');
    expect(instructionSlug('///')).toBe('scope');
  });

  it('names the workspace-wide instruction after the primary folder', () => {
    expect(workspaceInstructionName(workspace)).toBe('core-services');
  });

  it("names a folder's instruction after its alias", () => {
    expect(folderInstructionName(workspace, '/r/ui-core', new Set())).toBe('ui-core');
    expect(folderInstructionName(workspace, '/r/Vendors Bees', new Set())).toBe('vendors-bees');
  });

  it('adds -folder when the name is taken, e.g. by the workspace-wide instruction of the primary folder', () => {
    expect(folderInstructionName(workspace, '/r/core-services', new Set(['core-services']))).toBe('core-services-folder');
  });
});
