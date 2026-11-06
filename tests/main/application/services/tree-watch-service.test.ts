import { describe, expect, it, vi } from 'vitest';
import { FileBrowserService } from '../../../../src/main/application/services/file-browser-service.js';
import { TreeWatchService } from '../../../../src/main/application/services/tree-watch-service.js';
import type { TreeWatcherPort } from '../../../../src/main/application/ports/tree-watcher-port.js';
import { NodeFileBrowserAdapter } from '../../../../src/main/infrastructure/filesystem/node-file-browser-adapter.js';

function setup(folders: string[]) {
  let emit: (p: string) => void = () => undefined;
  const close = vi.fn(async () => undefined);
  const watcher: TreeWatcherPort = { watch: (_roots, _ignored, cb) => ((emit = cb), { close }) };
  const service = new TreeWatchService(watcher, new FileBrowserService(new NodeFileBrowserAdapter(), folders[0]!, folders), 10);
  const events: string[][] = [];
  service.onTreeChanged((e) => events.push(e.dirs));
  service.start();
  return { service, emit: (p: string) => emit(p), events, close };
}

describe('TreeWatchService', () => {
  it('debounces and reports parent dirs workspace-relative', async () => {
    const { emit, events, service, close } = setup(['/ws']);
    emit('/ws/src/a.ts');
    emit('/ws/src/b.ts');
    emit('/ws/top.txt');
    await new Promise((r) => setTimeout(r, 40));
    expect(events).toHaveLength(1);
    expect(events[0]!.sort()).toEqual(['', 'src']);
    await service.stop();
    expect(close).toHaveBeenCalled();
  });

  it('prefixes aliases with several folders', async () => {
    const { emit, events } = setup(['/one/api', '/two/web']);
    emit('/one/api/x/y.ts');
    emit('/two/web/z.ts');
    await new Promise((r) => setTimeout(r, 40));
    expect(events[0]!.sort()).toEqual(['api/x', 'web']);
  });
});
