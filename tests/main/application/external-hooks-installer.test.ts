import { describe, expect, it, vi } from 'vitest';
import { ExternalHooksInstaller } from '../../../src/main/application/services/external-hooks-installer.js';
import { CLAUDE_EXTERNAL_HOOKS } from '../../../src/main/application/external-hooks.js';

function setup(consent: string, validate: 'ok' | 'missing') {
  const merge = { apply: vi.fn(async () => {}), remove: vi.fn(async () => {}), validate: vi.fn(async () => validate) };
  const fs = {
    readFile: async () => consent,
    writeFile: async () => {},
    mkdir: async () => {},
    remove: async () => {},
  };
  const installer = new ExternalHooksInstaller(merge as never, fs as never, '/home/u');
  return { installer, merge };
}

describe('ExternalHooksInstaller.heal', () => {
  it('installs the entries a newer version added, under exact consent', async () => {
    const t = setup('exact', 'missing');
    await t.installer.heal(['claude']);
    expect(t.merge.apply).toHaveBeenCalledTimes(Object.keys(CLAUDE_EXTERNAL_HOOKS).length);
  });
  it('does nothing when everything is installed, or without exact consent', async () => {
    const complete = setup('exact', 'ok');
    await complete.installer.heal(['claude']);
    expect(complete.merge.apply).not.toHaveBeenCalled();
    const estimated = setup('estimated', 'missing');
    await estimated.installer.heal(['claude']);
    expect(estimated.merge.apply).not.toHaveBeenCalled();
  });
});
