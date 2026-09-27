import { describe, expect, it } from 'vitest';
import {
  captureNoteSave,
  editNoteState,
  failNoteSave,
  mergeNoteSave,
  NoteSaveQueue,
  readNoteDraft,
  settleNoteDraft,
  type NoteEditorState,
  writeNoteDraft,
} from './notePersistence.js';

const digestOne = '1'.repeat(64);
const digestTwo = '2'.repeat(64);

function editorState(): NoteEditorState {
  return {
    targetKey: 'file:grant-one',
    documentId: 'raw:one',
    noteRevision: 1,
    revisionToken: 'mount-one-v1',
    notes: [{ address: 3, alias: 'v1', text: 'first' }],
    boundDigest: digestOne,
    currentDigest: digestOne,
    observedRevision: 'disk-old',
    dirty: true,
    error: null,
  };
}

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('note revision persistence', () => {
  it('keeps V2 dirty when V1 finishes saving', () => {
    // Given a V1 save snapshot and a V2 edit made while it is pending.
    const first = editorState();
    const saving = captureNoteSave(first);
    const edited = editNoteState(first, [{ address: 3, alias: 'v2', text: 'second' }]);

    // When V1 succeeds with a new opaque disk revision.
    const completed = mergeNoteSave(edited, saving, 'disk-v1');

    // Then only V1 was written, while V2 and its dirty state remain current.
    expect(saving.notes).toEqual([{ address: 3, alias: 'v1', text: 'first' }]);
    expect(completed).toMatchObject({
      noteRevision: 2,
      notes: [{ address: 3, alias: 'v2', text: 'second' }],
      observedRevision: 'disk-v1',
      dirty: true,
      error: null,
    });
  });

  it('restores the newer draft after save completion and panel re-entry', () => {
    // Given V2 persisted while the V1 save is still in flight.
    const storage = new MemoryStorage();
    const key = 'bolgescope:notes-draft:raw:one';
    const first = editorState();
    const saving = captureNoteSave(first);
    const edited = editNoteState(first, [{ address: 3, alias: 'v2', text: 'second' }]);
    writeNoteDraft(storage, key, edited);

    // When V1 completes after the panel has switched away.
    settleNoteDraft(storage, key, saving, 'disk-v1');
    const restored = readNoteDraft(storage, key);

    // Then re-entry restores V2 and advances its conflict baseline to V1.
    expect(restored).toMatchObject({
      targetKey: 'file:grant-one',
      documentId: 'raw:one',
      noteRevision: 2,
      notes: [{ address: 3, alias: 'v2', text: 'second' }],
      observedRevision: 'disk-v1',
      dirty: true,
    });
  });

  it('keeps a remounted draft when an older matching numeric revision settles', () => {
    // Given V1 was saved, its draft was cleared, and another V1 save remains queued.
    const storage = new MemoryStorage();
    const key = 'bolgescope:notes-draft:raw:one';
    const first = editorState();
    const olderSave = captureNoteSave(first);
    writeNoteDraft(storage, key, first);
    settleNoteDraft(storage, key, olderSave, 'disk-v1');
    expect(readNoteDraft(storage, key)).toBeNull();

    // When a remounted editor restarts its counter and creates a different V2 draft.
    const remounted = {
      ...first,
      noteRevision: 0,
      observedRevision: 'disk-v1',
      dirty: false,
    };
    const newer = editNoteState(remounted, [{ address: 3, alias: 'v2', text: 'new unsaved work' }]);
    expect(newer.noteRevision).toBe(olderSave.noteRevision);
    expect(newer.revisionToken).not.toBe(olderSave.revisionToken);
    writeNoteDraft(storage, key, newer);
    settleNoteDraft(storage, key, olderSave, 'disk-v1-late');

    // Then the old save must not delete the newer draft despite its repeated counter.
    expect(readNoteDraft(storage, key)).toMatchObject({
      notes: [{ address: 3, alias: 'v2', text: 'new unsaved work' }],
      dirty: true,
    });
  });

  it('serializes same-target saves and advances the next conflict revision', async () => {
    // Given V1 and V2 saves queued for one physical notes target.
    const queue = new NoteSaveQueue();
    const firstState = editorState();
    const first = captureNoteSave(firstState);
    const secondState = editNoteState(firstState, [{ address: 3, alias: 'v2', text: 'second' }]);
    const second = captureNoteSave(secondState);
    const writes: Array<{ alias: string; observed: string | null }> = [];
    let finishFirst: ((revision: string) => void) | undefined;
    const savingFirst = queue.run(first, (observed: string | null) => {
      writes.push({ alias: first.notes[0]?.alias ?? '', observed });
      return new Promise<string>(resolve => { finishFirst = resolve; });
    });
    const savingSecond = queue.run(second, async (observed: string | null) => {
      writes.push({ alias: second.notes[0]?.alias ?? '', observed });
      return 'disk-v2';
    });

    // When V1 completes and releases V2.
    await Promise.resolve();
    expect(writes).toEqual([{ alias: 'v1', observed: 'disk-old' }]);
    finishFirst?.('disk-v1');
    await expect(savingFirst).resolves.toBe('disk-v1');
    await expect(savingSecond).resolves.toBe('disk-v2');

    // Then writes stay ordered and V2 observes V1's returned disk revision.
    expect(writes).toEqual([
      { alias: 'v1', observed: 'disk-old' },
      { alias: 'v2', observed: 'disk-v1' },
    ]);
    expect(mergeNoteSave(secondState, second, 'disk-v2')).toMatchObject({
      notes: [{ address: 3, alias: 'v2', text: 'second' }],
      observedRevision: 'disk-v2',
      dirty: false,
    });
  });

  it('keeps the latest draft dirty after save failure or conflict', () => {
    // Given a newer draft than the captured save.
    const first = editorState();
    const edited = editNoteState(first, [{ address: 3, alias: 'v2', text: 'second' }]);

    // When native persistence reports a conflict.
    const failed = failNoteSave(edited, 'CONFLICT: notes changed on disk');

    // Then no current content or dirty state is discarded.
    expect(failed).toMatchObject({
      noteRevision: 2,
      notes: [{ address: 3, alias: 'v2', text: 'second' }],
      observedRevision: 'disk-old',
      dirty: true,
      error: 'CONFLICT: notes changed on disk',
    });
  });

  it('does not bind an old save to a changed digest or different identity', () => {
    // Given a save snapshot for document one and digest one.
    const first = editorState();
    const saving = captureNoteSave(first);
    const changedDigest: NoteEditorState = {
      ...first,
      currentDigest: digestTwo,
      dirty: true,
    };
    const otherDocument: NoteEditorState = {
      ...first,
      targetKey: 'file:grant-two',
      documentId: 'raw:two',
      observedRevision: 'disk-other',
    };

    // When the old save completes after source or document identity changed.
    const digestResult = mergeNoteSave(changedDigest, saving, 'disk-v1');
    const identityResult = mergeNoteSave(otherDocument, saving, 'disk-v1');

    // Then only the matching target learns its disk revision; neither is rebound.
    expect(saving.currentDigest).toBe(digestOne);
    expect(digestResult).toMatchObject({
      currentDigest: digestTwo,
      boundDigest: digestOne,
      observedRevision: 'disk-v1',
      dirty: true,
    });
    expect(identityResult).toBe(otherDocument);
  });
});
