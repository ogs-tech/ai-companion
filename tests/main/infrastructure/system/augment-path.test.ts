import { describe, expect, it } from 'vitest';
import { augmentPath } from '../../../../src/main/infrastructure/system/augment-path.js';

describe('augmentPath', () => {
  it("appends Homebrew bin dirs to launchd's minimal macOS PATH", () => {
    expect(augmentPath('/usr/bin:/bin:/usr/sbin:/sbin', 'darwin')).toBe(
      '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
    );
  });

  it('keeps an inherited order and adds nothing already present', () => {
    expect(augmentPath('/opt/homebrew/bin:/usr/bin', 'darwin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/usr/local/bin',
    );
  });

  it('handles a missing PATH on macOS', () => {
    expect(augmentPath(undefined, 'darwin')).toBe('/opt/homebrew/bin:/usr/local/bin');
  });

  it('leaves other platforms untouched', () => {
    expect(augmentPath('/usr/bin', 'linux')).toBe('/usr/bin');
    expect(augmentPath(undefined, 'win32')).toBeUndefined();
  });
});
