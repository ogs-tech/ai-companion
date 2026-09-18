import { describe, it, expect, vi, afterEach } from 'vitest';
import { openWorkspaceArea, registerAreaOpener } from '../../../src/renderer/lib/workspace-area-store.js';

afterEach(() => {
  registerAreaOpener(null);
});

describe('workspace-area-store', () => {
  it('is a no-op when no opener is registered', () => {
    expect(() => openWorkspaceArea('diagnostico')).not.toThrow();
  });

  it('calls the registered opener with the requested area', () => {
    const opener = vi.fn();
    registerAreaOpener(opener);
    openWorkspaceArea('marketplaces');
    expect(opener).toHaveBeenCalledWith('marketplaces');
  });

  it('stops calling the opener once unregistered', () => {
    const opener = vi.fn();
    registerAreaOpener(opener);
    registerAreaOpener(null);
    openWorkspaceArea('starter-pack');
    expect(opener).not.toHaveBeenCalled();
  });
});
