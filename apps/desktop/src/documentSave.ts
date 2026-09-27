import type { SourceKind } from '@bolgescope/core';

export type Document = {
  id: string; name: string; kind: SourceKind; text: string; revision: number; dirty: boolean;
  grantId: string | null; diskRevision: string | null; originalBytes: Uint8Array | null;
  encodingError: boolean; recoveryId?: string; projectGrantId?: string; projectId?: string; relativePath?: string;
};

export type SaveAdapter = {
  saveAs: (bytes: Uint8Array, name: string) => Promise<{ name: string; grantId: string; diskRevision: string } | null>;
  saveFile: (grantId: string, bytes: Uint8Array, revision: string) => Promise<string>;
  saveProjectFile: (grantId: string, path: string, bytes: Uint8Array, revision: string | null) => Promise<string>;
};

export async function saveDocument(document: Document, as: boolean, adapter: SaveAdapter): Promise<Document | null> {
  const bytes = document.dirty || !document.originalBytes ? new TextEncoder().encode(document.text) : document.originalBytes;
  if (as || (!document.projectGrantId && (!document.grantId || !document.diskRevision))) {
    const file = await adapter.saveAs(bytes, document.name);
    return file && { ...document, name: file.name, grantId: file.grantId, diskRevision: file.diskRevision,
      originalBytes: bytes, dirty: false, projectGrantId: undefined, projectId: undefined, relativePath: undefined };
  }
  if (document.projectGrantId && document.relativePath) {
    const diskRevision = await adapter.saveProjectFile(document.projectGrantId, document.relativePath, bytes, document.diskRevision);
    return { ...document, diskRevision, originalBytes: bytes, dirty: false };
  }
  if (!document.grantId || !document.diskRevision) throw new Error('Missing save grant');
  const diskRevision = await adapter.saveFile(document.grantId, bytes, document.diskRevision);
  return { ...document, diskRevision, originalBytes: bytes, dirty: false };
}

export function mergeSavedDocument(current: Document, captured: Document, saved: Document): Document {
  return { ...current, name: saved.name, grantId: saved.grantId, diskRevision: saved.diskRevision,
    originalBytes: current.revision === captured.revision ? saved.originalBytes : null,
    dirty: current.revision !== captured.revision, projectGrantId: saved.projectGrantId,
    projectId: saved.projectId, relativePath: saved.relativePath,
    recoveryId: current.revision === captured.revision ? undefined : current.recoveryId };
}

export function queueDocumentSave(queue: Map<string, Promise<boolean>>, id: string, work: () => Promise<boolean>): Promise<boolean> {
  const previous = queue.get(id) ?? Promise.resolve(true);
  const task = previous.then(work);
  queue.set(id, task);
  void task.then(() => { if (queue.get(id) === task) queue.delete(id); }, () => { if (queue.get(id) === task) queue.delete(id); });
  return task;
}
