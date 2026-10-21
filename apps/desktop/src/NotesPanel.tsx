import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseNotesFile, type NotesFile } from '@bolgescope/contracts';
import { nativeAvailable, nativeError } from './native';
import {
  captureNoteSave,
  createNoteRevisionToken,
  editNoteState,
  failNoteSave,
  mergeNoteSave,
  noteSaveQueue,
  readNoteDraft,
  settleNoteDraft,
  type Note,
  type NoteEditorState,
  writeNoteDraft,
} from './notePersistence';

type FileNotes = Readonly<{ bytes: number[]; boundDigest: string; notesRevision: string; stale: boolean }>;
type ProjectFile = Readonly<{ bytes: number[]; diskRevision: string }>;
type Props = Readonly<{
  documentId: string;
  grantId: string | null;
  projectGrantId?: string;
  projectId?: string;
  notesTargetId?: string;
  sourceRevision: number;
  logicalSource: Uint8Array;
  sourceValid?: boolean;
  address: number | null;
  t: (ko: string, en: string) => string;
  confirm: (message: string) => Promise<boolean>;
}>;
const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNotes(bytes: Uint8Array): readonly Note[] {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!isRecord(value) || !Array.isArray(value.notes)) throw new Error('Invalid notes file');
  const notes: Note[] = [];
  for (const note of value.notes) {
    if (!isRecord(note) || typeof note.address !== 'number' || !Number.isInteger(note.address) ||
      typeof note.alias !== 'string' || typeof note.text !== 'string') throw new Error('Invalid note record');
    notes.push({
      address: note.address,
      alias: note.alias,
      text: note.text,
      ...(typeof note.annotationId === 'string' ? { annotationId: note.annotationId } : {}),
      ...(typeof note.end === 'number' && Number.isInteger(note.end) ? { end: note.end } : {}),
    });
  }
  return notes;
}

export default function NotesPanel({
  documentId,
  grantId,
  projectGrantId,
  projectId,
  notesTargetId,
  sourceRevision,
  logicalSource,
  sourceValid = true,
  address,
  t,
  confirm,
}: Props) {
  const targetKey = projectGrantId
    ? `project:${notesTargetId ?? projectId ?? projectGrantId}`
    : grantId ? `file:${notesTargetId ?? grantId}` : `browser:${documentId}`;
  const notesDocumentId = projectId ?? (grantId ? targetKey : documentId);
  const draftKey = `bolgescope:notes-draft:${notesDocumentId}`;
  const legacyDraftKey = `bolgescope:notes-draft:${documentId}`;
  const [editor, setEditor] = useState<NoteEditorState | null>(null);
  const editorRef = useRef<NoteEditorState | null>(null);
  const projectFileRef = useRef<NotesFile | null>(null);
  const mounted = useRef(true);
  const [digest, setDigest] = useState('');
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = editor?.notes.find(note => note.address === address);
  const changed = !!editor && digest !== '' && editor.boundDigest !== '' && digest !== editor.boundDigest;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setDigest('');
    if (!sourceValid) return () => { active = false; };
    void crypto.subtle.digest('SHA-256', Uint8Array.from(logicalSource)).then(bytes => {
      if (active) setDigest(Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''));
    });
    return () => { active = false; };
  }, [logicalSource, sourceValid]);

  useEffect(() => {
    if (editorRef.current?.targetKey === targetKey && editorRef.current.documentId === notesDocumentId) return;
    editorRef.current = null;
    projectFileRef.current = null;
    setEditor(null);
    setStale(false);
    setNotice('');
  }, [notesDocumentId, targetKey]);

  useEffect(() => {
    const current = editorRef.current;
    if (!digest || !current || current.currentDigest === digest) return;
    const next = { ...current, currentDigest: digest, dirty: true };
    try {
      writeNoteDraft(localStorage, draftKey, next);
      editorRef.current = next;
      setEditor(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [digest, draftKey]);

  useEffect(() => {
    if (!digest || editorRef.current) return;
    let active = true;
    void (async () => {
      let loadedNotes: readonly Note[] = [];
      let loadedDigest = digest;
      let loadedRevision: string | null = null;
      let loadedStale = false;
      try {
        if (projectGrantId && nativeAvailable) {
          try {
            const file = await invoke<ProjectFile>('read_project_file', { grantId: projectGrantId, relativePath: '.bolge/notes.json' });
            if (!active) return;
            const parsed = parseNotesFile(Uint8Array.from(file.bytes));
            if (projectId && parsed.projectId !== projectId) throw new Error('Project notes belong to another project');
            projectFileRef.current = parsed;
            loadedNotes = parsed.annotations
              .filter(item => item.documentId === notesDocumentId)
              .map(item => ({ address: item.range.start, alias: item.name, text: item.note, annotationId: item.annotationId, end: item.range.end }));
            loadedDigest = loadedNotes.length
              ? parsed.annotations.find(item => item.documentId === notesDocumentId)?.logicalDigest ?? digest
              : digest;
            loadedRevision = file.diskRevision;
          } catch (error) {
            if (nativeError(error).code !== 'NOT_FOUND') throw error;
          }
        } else if (grantId && nativeAvailable) {
          const file = await invoke<FileNotes | null>('read_notes', { grantId, logicalDigest: digest });
          if (!active) return;
          if (file) {
            loadedNotes = parseNotes(Uint8Array.from(file.bytes));
            loadedDigest = file.boundDigest;
            loadedRevision = file.notesRevision;
            loadedStale = file.stale;
          }
        } else {
          const saved = localStorage.getItem(`bolgescope:unsaved-notes:${notesDocumentId}`);
          if (saved) loadedNotes = parseNotes(encoder.encode(saved));
        }
        let draft = readNoteDraft(localStorage, draftKey, { targetKey, documentId: notesDocumentId, currentDigest: digest });
        if (!draft && legacyDraftKey !== draftKey) {
          draft = readNoteDraft(localStorage, legacyDraftKey, { targetKey, documentId: notesDocumentId, currentDigest: digest });
          if (draft) {
            writeNoteDraft(localStorage, draftKey, draft);
            localStorage.removeItem(legacyDraftKey);
          }
        }
        if (draft && draft.targetKey === targetKey && draft.documentId === notesDocumentId) {
          loadedStale ||= draft.observedRevision !== loadedRevision;
          loadedNotes = draft.notes;
          loadedDigest = draft.boundDigest;
          loadedRevision = draft.observedRevision;
        }
        noteSaveQueue.remember(targetKey, loadedRevision);
        const next: NoteEditorState = draft && draft.targetKey === targetKey && draft.documentId === notesDocumentId
          ? { ...draft, currentDigest: digest }
          : {
            targetKey,
            documentId: notesDocumentId,
            noteRevision: 0,
            revisionToken: createNoteRevisionToken(),
            notes: loadedNotes,
            boundDigest: loadedDigest,
            currentDigest: digest,
            observedRevision: loadedRevision,
            dirty: false,
            error: null,
          };
        if (!active) return;
        editorRef.current = next;
        setEditor(next);
        setStale(loadedStale);
      } catch (error) {
        if (active) setNotice(nativeError(error).message);
      }
    })();
    return () => { active = false; };
  }, [digest, draftKey, grantId, legacyDraftKey, notesDocumentId, projectGrantId, projectId, targetKey]);

  function update(patch: Partial<Note>): void {
    const current = editorRef.current;
    if (address === null || !current) return;
    const existing = current.notes.find(note => note.address === address) ?? { address, alias: '', text: '' };
    const notes = [...current.notes.filter(note => note.address !== address), { ...existing, ...patch }];
    try {
      const next = editNoteState(current, notes);
      writeNoteDraft(localStorage, draftKey, next);
      editorRef.current = next;
      setEditor(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function save(): Promise<void> {
    if (!digest || !editorRef.current) return;
    if ((changed || stale) && !await confirm(t('소스의 논리 주소가 바뀌었을 수 있습니다. 선택 주소에 노트를 다시 연결할까요?', 'The logical source may have changed. Rebind notes to current addresses?'))) return;
    const current = editorRef.current;
    if (!current) return;
    const snapshot = captureNoteSave(current, sourceRevision);
    const existingProject = projectFileRef.current;
    const projectFile: NotesFile | null = projectId ? {
      schemaVersion: 1,
      projectId,
      annotations: [
        ...(existingProject?.annotations.filter(item => item.documentId !== notesDocumentId) ?? []),
        ...snapshot.notes.map(note => ({
          annotationId: note.annotationId ?? crypto.randomUUID(),
          documentId: notesDocumentId,
          logicalDigest: snapshot.currentDigest,
          range: { start: note.address, end: note.end ?? note.address + 1 },
          name: note.alias,
          note: note.text,
          origin: 'user' as const,
          sourceRevision: snapshot.sourceRevision,
          binding: 'valid' as const,
        })),
      ],
    } : null;
    const bytes = encoder.encode(`${JSON.stringify(projectFile ?? {
      schemaVersion: 1,
      boundDigest: snapshot.currentDigest,
      notes: snapshot.notes,
    }, null, 2)}\n`);
    try {
      if (projectFile) parseNotesFile(bytes);
      const revision = await noteSaveQueue.run(snapshot, async observedRevision => {
        if (projectGrantId && nativeAvailable) {
          const result = await invoke<{ diskRevision: string }>('save_project_file', {
            grantId: projectGrantId,
            relativePath: '.bolge/notes.json',
            bytes: Array.from(bytes),
            observedDiskRevision: observedRevision,
          });
          return result.diskRevision;
        }
        if (grantId && nativeAvailable) {
          const result = await invoke<{ notesRevision: string }>('write_notes', {
            grantId,
            logicalDigest: snapshot.currentDigest,
            bytes: Array.from(bytes),
            observedNotesRevision: observedRevision,
            allowRebind: changed || stale,
          });
          return result.notesRevision;
        }
        localStorage.setItem(`bolgescope:unsaved-notes:${notesDocumentId}`, new TextDecoder().decode(bytes));
        return `local:${snapshot.noteRevision}`;
      });
      if (projectFile) projectFileRef.current = projectFile;
      settleNoteDraft(localStorage, draftKey, snapshot, revision);
      if (!mounted.current) return;
      const latest = editorRef.current;
      if (!latest) return;
      const merged = mergeNoteSave(latest, snapshot, revision);
      editorRef.current = merged;
      setEditor(merged);
      setStale(false);
      setNotice(merged.dirty
        ? t('이전 revision을 저장했습니다. 최신 초안은 아직 저장 전입니다.', 'An earlier revision was saved. The latest draft is still unsaved.')
        : t('노트를 원문 밖에 저장했습니다.', 'Notes saved outside source.'));
    } catch (error) {
      if (!mounted.current) return;
      const latest = editorRef.current;
      if (latest) {
        const failed = failNoteSave(latest, nativeError(error).message);
        editorRef.current = failed;
        setEditor(failed);
      }
      setNotice(nativeError(error).message);
    }
  }

  return <section className="pane-block notes-panel" aria-label={t('노트와 별칭', 'Notes and aliases')}>
    <div className="section-heading"><h3>{t('노트와 별칭', 'Notes and aliases')}</h3><span>{editor?.dirty ? t('저장 전 초안', 'Unsaved draft') : address === null ? '—' : `#${address}`}</span></div>
    {(changed || stale) && <p className="stale-note">{t('주소 연결 재검토 필요', 'Address binding needs review')}</p>}
    <label>{t('별칭', 'Alias')}<input maxLength={128} disabled={!editor || address === null || !sourceValid} value={selected?.alias ?? ''} onChange={event => update({ alias: event.target.value })} /></label>
    <label>{t('사용자 설명', 'User explanation')}<textarea maxLength={8192} disabled={!editor || address === null || !sourceValid} value={selected?.text ?? ''} onChange={event => update({ text: event.target.value })} /></label>
    <button type="button" disabled={!editor || address === null || !sourceValid} onClick={() => void save()}>{t('노트 저장', 'Save note')}</button>
    {(notice || editor?.error) && <p className="muted" role="status">{notice || editor?.error}</p>}
  </section>;
}
