export type Note = Readonly<{
  address: number;
  alias: string;
  text: string;
  annotationId?: string;
  end?: number;
}>;

export type NoteEditorState = Readonly<{
  targetKey: string;
  documentId: string;
  noteRevision: number;
  revisionToken: string;
  notes: readonly Note[];
  boundDigest: string;
  currentDigest: string;
  observedRevision: string | null;
  dirty: boolean;
  error: string | null;
}>;

export type NoteSaveSnapshot = Readonly<{
  targetKey: string;
  documentId: string;
  noteRevision: number;
  revisionToken: string;
  notes: readonly Note[];
  boundDigest: string;
  currentDigest: string;
  observedRevision: string | null;
  sourceRevision: number;
}>;

type KeyValueStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}>;

type PersistedDraft = Readonly<{
  schemaVersion: 3;
  targetKey: string;
  documentId: string;
  noteRevision: number;
  revisionToken: string;
  notes: readonly Note[];
  boundDigest: string;
  currentDigest: string;
  observedRevision: string | null;
}>;
type DraftIdentity = Readonly<{ targetKey: string; documentId: string; currentDigest: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNote(value: unknown): value is Note {
  return isRecord(value) &&
    isSafeInteger(value.address) &&
    typeof value.alias === 'string' &&
    typeof value.text === 'string' &&
    (value.annotationId === undefined || typeof value.annotationId === 'string') &&
    (value.end === undefined || isSafeInteger(value.end));
}

export function createNoteRevisionToken(): string {
  return crypto.randomUUID();
}

function persistedDraft(value: unknown, identity?: DraftIdentity): PersistedDraft {
  if (isRecord(value) &&
    value.schemaVersion === 1 &&
    identity &&
    typeof value.boundDigest === 'string' &&
    (value.observedRevision === null || typeof value.observedRevision === 'string') &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote)) {
    return {
      schemaVersion: 3,
      targetKey: identity.targetKey,
      documentId: identity.documentId,
      noteRevision: 1,
      revisionToken: createNoteRevisionToken(),
      notes: value.notes.map(note => ({ ...note })),
      boundDigest: value.boundDigest,
      currentDigest: identity.currentDigest,
      observedRevision: value.observedRevision,
    };
  }
  if (isRecord(value) &&
    value.schemaVersion === 2 &&
    typeof value.targetKey === 'string' &&
    typeof value.documentId === 'string' &&
    isSafeInteger(value.noteRevision) &&
    typeof value.boundDigest === 'string' &&
    typeof value.currentDigest === 'string' &&
    (value.observedRevision === null || typeof value.observedRevision === 'string') &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote)) {
    return {
      schemaVersion: 3,
      targetKey: value.targetKey,
      documentId: value.documentId,
      noteRevision: value.noteRevision,
      revisionToken: createNoteRevisionToken(),
      notes: value.notes.map(note => ({ ...note })),
      boundDigest: value.boundDigest,
      currentDigest: value.currentDigest,
      observedRevision: value.observedRevision,
    };
  }
  if (!isRecord(value) ||
    value.schemaVersion !== 3 ||
    typeof value.targetKey !== 'string' ||
    typeof value.documentId !== 'string' ||
    !isSafeInteger(value.noteRevision) ||
    typeof value.revisionToken !== 'string' ||
    value.revisionToken.length === 0 ||
    typeof value.boundDigest !== 'string' ||
    typeof value.currentDigest !== 'string' ||
    (value.observedRevision !== null && typeof value.observedRevision !== 'string') ||
    !Array.isArray(value.notes) ||
    !value.notes.every(isNote)) {
    throw new Error('Invalid note draft');
  }
  return {
    schemaVersion: 3,
    targetKey: value.targetKey,
    documentId: value.documentId,
    noteRevision: value.noteRevision,
    revisionToken: value.revisionToken,
    notes: value.notes.map(note => ({ ...note })),
    boundDigest: value.boundDigest,
    currentDigest: value.currentDigest,
    observedRevision: value.observedRevision,
  };
}

export function captureNoteSave(state: NoteEditorState, sourceRevision = 0): NoteSaveSnapshot {
  return {
    targetKey: state.targetKey,
    documentId: state.documentId,
    noteRevision: state.noteRevision,
    revisionToken: state.revisionToken,
    notes: state.notes.map(note => ({ ...note })),
    boundDigest: state.boundDigest,
    currentDigest: state.currentDigest,
    observedRevision: state.observedRevision,
    sourceRevision,
  };
}

export function editNoteState(state: NoteEditorState, notes: readonly Note[]): NoteEditorState {
  return {
    ...state,
    noteRevision: state.noteRevision + 1,
    revisionToken: createNoteRevisionToken(),
    notes: notes.map(note => ({ ...note })),
    dirty: true,
    error: null,
  };
}

export function mergeNoteSave(current: NoteEditorState, saved: NoteSaveSnapshot, observedRevision: string): NoteEditorState {
  if (current.targetKey !== saved.targetKey || current.documentId !== saved.documentId) return current;
  const currentSnapshot = current.noteRevision === saved.noteRevision &&
    current.revisionToken === saved.revisionToken &&
    current.currentDigest === saved.currentDigest;
  return {
    ...current,
    observedRevision,
    boundDigest: currentSnapshot ? saved.currentDigest : current.boundDigest,
    dirty: !currentSnapshot,
    error: null,
  };
}

export function failNoteSave(current: NoteEditorState, error: string): NoteEditorState {
  return { ...current, dirty: true, error };
}

export function writeNoteDraft(storage: KeyValueStorage, key: string, state: NoteEditorState): void {
  const draft: PersistedDraft = {
    schemaVersion: 3,
    targetKey: state.targetKey,
    documentId: state.documentId,
    noteRevision: state.noteRevision,
    revisionToken: state.revisionToken,
    notes: state.notes.map(note => ({ ...note })),
    boundDigest: state.boundDigest,
    currentDigest: state.currentDigest,
    observedRevision: state.observedRevision,
  };
  storage.setItem(key, JSON.stringify(draft));
}

export function readNoteDraft(storage: KeyValueStorage, key: string, identity?: DraftIdentity): NoteEditorState | null {
  const encoded = storage.getItem(key);
  if (encoded === null) return null;
  const draft = persistedDraft(JSON.parse(encoded), identity);
  return {
    targetKey: draft.targetKey,
    documentId: draft.documentId,
    noteRevision: draft.noteRevision,
    revisionToken: draft.revisionToken,
    notes: draft.notes,
    boundDigest: draft.boundDigest,
    currentDigest: draft.currentDigest,
    observedRevision: draft.observedRevision,
    dirty: true,
    error: null,
  };
}

export function settleNoteDraft(
  storage: KeyValueStorage,
  key: string,
  saved: NoteSaveSnapshot,
  observedRevision: string,
): void {
  const current = readNoteDraft(storage, key);
  if (!current || current.targetKey !== saved.targetKey || current.documentId !== saved.documentId) return;
  if (current.noteRevision === saved.noteRevision &&
    current.revisionToken === saved.revisionToken &&
    current.currentDigest === saved.currentDigest) {
    storage.removeItem(key);
    return;
  }
  writeNoteDraft(storage, key, { ...current, observedRevision });
}

export class NoteSaveQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly revisions = new Map<string, string | null>();

  remember(targetKey: string, observedRevision: string | null): void {
    if (!this.tails.has(targetKey)) this.revisions.set(targetKey, observedRevision);
  }

  run(snapshot: NoteSaveSnapshot, write: (observedRevision: string | null) => Promise<string>): Promise<string> {
    const start = async (): Promise<string> => {
      const observedRevision = this.revisions.has(snapshot.targetKey)
        ? this.revisions.get(snapshot.targetKey) ?? null
        : snapshot.observedRevision;
      const nextRevision = await write(observedRevision);
      this.revisions.set(snapshot.targetKey, nextRevision);
      return nextRevision;
    };
    const previous = this.tails.get(snapshot.targetKey);
    const task = previous ? previous.catch(() => undefined).then(start) : start();
    const tail = task.then(() => undefined, () => undefined);
    this.tails.set(snapshot.targetKey, tail);
    void tail.then(() => {
      if (this.tails.get(snapshot.targetKey) === tail) this.tails.delete(snapshot.targetKey);
    });
    return task;
  }
}

export const noteSaveQueue = new NoteSaveQueue();
