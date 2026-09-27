import { describe, expect, it, vi } from 'vitest';
import { mergeSavedDocument, queueDocumentSave, saveDocument, type Document, type SaveAdapter } from './documentSave';

const document: Document = {
  id: 'raw:one', name: 'main.mb', kind: 'raw', text: 'first', revision: 1, dirty: true,
  grantId: null, diskRevision: 'old', originalBytes: null, encodingError: false,
  projectGrantId: 'project', projectId: 'project-id', relativePath: 'programs/main.mb', recoveryId: 'recovery',
};

describe('document saving', () => {
  it('keeps an edit made during project save dirty while updating the observed disk revision', async () => {
    let finish: ((revision: string) => void) | undefined;
    const adapter: SaveAdapter = {
      saveAs: vi.fn(), saveFile: vi.fn(),
      saveProjectFile: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })),
    };
    const pending = saveDocument(document, false, adapter);
    const later = { ...document, text: 'second', revision: 2 };
    finish?.('new');
    const saved = await pending;
    expect(saved).not.toBeNull();
    if (!saved) return;
    expect(mergeSavedDocument(later, document, saved)).toMatchObject({ text: 'second', revision: 2, dirty: true, diskRevision: 'new', originalBytes: null, recoveryId: 'recovery' });
    expect(adapter.saveProjectFile).toHaveBeenCalledWith('project', 'programs/main.mb', new TextEncoder().encode('first'), 'old');
  });

  it('detaches Save As from the project so the next Save targets the new file', async () => {
    const adapter: SaveAdapter = {
      saveAs: vi.fn(async () => ({ name: 'copy.mb', grantId: 'copy', targetId: 'copy-target', diskRevision: 'copy-rev' })),
      saveFile: vi.fn(async () => 'next-rev'), saveProjectFile: vi.fn(),
    };
    const saved = await saveDocument(document, true, adapter);
    expect(saved).toMatchObject({ name: 'copy.mb', grantId: 'copy', projectGrantId: undefined, relativePath: undefined, dirty: false });
    if (!saved) return;
    await saveDocument({ ...saved, text: 'later', revision: 2, dirty: true }, false, adapter);
    expect(adapter.saveFile).toHaveBeenCalledWith('copy', new TextEncoder().encode('later'), 'copy-rev');
    expect(adapter.saveProjectFile).not.toHaveBeenCalled();
  });

  it('serializes saves for one document so the second captures the later revision', async () => {
    const queue = new Map<string, Promise<boolean>>();
    const revisions: number[] = [];
    let revision = 1;
    let finish: (() => void) | undefined;
    const first = queueDocumentSave(queue, document.id, async () => {
      revisions.push(revision);
      await new Promise<void>(resolve => { finish = resolve; });
      return true;
    });
    const second = queueDocumentSave(queue, document.id, async () => { revisions.push(revision); return true; });
    await Promise.resolve();
    expect(revisions).toEqual([1]);
    revision = 2;
    finish?.();
    await Promise.all([first, second]);
    expect(revisions).toEqual([1, 2]);
    expect(queue.size).toBe(0);
  });
});
