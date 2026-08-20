import { describe, expect, it } from 'vitest';
import { brand, legacyOwnershipMarkers, productLabel, workspacePathHint } from '../../src/shared/brand.js';
import {
  cursorPluginPath,
  legacyCursorPluginPath,
  legacyWorkspacePath,
  workspacePath,
} from '../../src/shared/brand-paths.js';

describe('brand', () => {
  it('exposes the AI Companion display name', () => {
    expect(brand.displayName).toBe('AI Companion');
  });

  it('builds notification titles with the product prefix', () => {
    expect(productLabel('a problem was detected')).toBe('AI Companion — a problem was detected');
  });

  it('formats the workspace path hint for UI copy', () => {
    expect(workspacePathHint()).toBe('~/.ai-companion');
  });

  it('includes legacy ownership markers for migration', () => {
    expect(legacyOwnershipMarkers()).toContain(brand.legacy.generatedFileMarker);
    expect(legacyOwnershipMarkers()).toContain(brand.legacy.cursorPluginJsonMarker);
  });
});

describe('brand-paths', () => {
  it('resolves the current workspace path', () => {
    expect(workspacePath('/home/u')).toBe('/home/u/.ai-companion');
  });

  it('resolves the legacy workspace path', () => {
    expect(legacyWorkspacePath('/home/u')).toBe('/home/u/.superset-ai-app');
  });

  it('resolves cursor plugin paths', () => {
    expect(cursorPluginPath('/home/u')).toBe('/home/u/.cursor/plugins/ai-companion');
    expect(legacyCursorPluginPath('/home/u')).toBe('/home/u/.cursor/plugins/superset-ai');
  });
});
