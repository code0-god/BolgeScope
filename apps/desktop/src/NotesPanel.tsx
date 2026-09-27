import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseNotesFile, type NotesFile } from '@bolgescope/contracts';
import { nativeAvailable, nativeError } from './native';

type Note = { address: number; alias: string; text: string; annotationId?: string; end?: number };
type FileNotes = { bytes: number[]; boundDigest: string; notesRevision: string; stale: boolean };
type ProjectFile = { bytes: number[]; diskRevision: string };
type Draft = { schemaVersion: 1; boundDigest: string; observedRevision: string | null; notes: Note[] };
type Props = { documentId: string; grantId: string | null; projectGrantId?: string; projectId?: string; sourceRevision: number; logicalSource: Uint8Array; address: number | null; t: (ko: string, en: string) => string };
const encoder = new TextEncoder();

function parseNotes(bytes: Uint8Array): Note[] {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (typeof value !== 'object' || value === null || !('notes' in value) || !Array.isArray(value.notes)) throw new Error('Invalid notes file');
  if (!value.notes.every((note: unknown) => typeof note === 'object' && note !== null && 'address' in note && Number.isInteger(note.address) && 'alias' in note && typeof note.alias === 'string' && 'text' in note && typeof note.text === 'string')) throw new Error('Invalid note record');
  return value.notes as Note[];
}

export default function NotesPanel({ documentId, grantId, projectGrantId, projectId, sourceRevision, logicalSource, address, t }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [digest, setDigest] = useState('');
  const [boundDigest, setBoundDigest] = useState('');
  const [revision, setRevision] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftKey = `bolgescope:notes-draft:${documentId}`;
  const selected = notes.find(note => note.address === address);
  const changed = digest !== '' && boundDigest !== '' && digest !== boundDigest;

  useEffect(() => {
    let active = true;
    void crypto.subtle.digest('SHA-256', Uint8Array.from(logicalSource)).then(bytes => {
      if (active) setDigest(Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''));
    });
    return () => { active = false; };
  }, [logicalSource]);

  useEffect(() => {
    if (!digest || loaded) return;
    let active = true;
    void (async () => {
      let loadedNotes: Note[] = [];
      let loadedDigest = digest;
      let loadedRevision: string | null = null;
      let loadedStale = false;
      try {
        if (projectGrantId && nativeAvailable) {
          const file = await invoke<ProjectFile>('read_project_file', { grantId: projectGrantId, relativePath: '.bolge/notes.json' });
          if (!active) return;
          const bytes = Uint8Array.from(file.bytes);
          const parsed = parseNotesFile(bytes);
          if (projectId && parsed.projectId !== projectId) throw new Error('Project notes belong to another project');
          loadedNotes = parsed.annotations.map(item => ({ address: item.range.start, alias: item.name, text: item.note, annotationId: item.annotationId, end: item.range.end }));
          loadedDigest = parsed.annotations[0]?.logicalDigest ?? digest; loadedRevision = file.diskRevision;
        } else if (grantId && nativeAvailable) {
          const file = await invoke<FileNotes | null>('read_notes', { grantId, logicalDigest: digest });
          if (!active) return;
          if (file) { loadedNotes = parseNotes(Uint8Array.from(file.bytes)); loadedDigest = file.boundDigest; loadedRevision = file.notesRevision; loadedStale = file.stale; }
        } else {
          const saved = localStorage.getItem(`bolgescope:unsaved-notes:${documentId}`);
          if (saved) loadedNotes = parseNotes(encoder.encode(saved));
        }
      } catch (error) {
        if (active && nativeError(error).code !== 'NOT_FOUND') setNotice(nativeError(error).message);
      }
      if (!active) return;
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const draft: unknown = JSON.parse(saved);
          if (typeof draft !== 'object' || draft === null || !('schemaVersion' in draft) || draft.schemaVersion !== 1 || !('boundDigest' in draft) || typeof draft.boundDigest !== 'string' || !('observedRevision' in draft) || (draft.observedRevision !== null && typeof draft.observedRevision !== 'string')) throw new Error('Invalid note draft');
          const notes = parseNotes(encoder.encode(saved));
          loadedStale ||= draft.observedRevision !== loadedRevision;
          loadedDigest = draft.boundDigest;
          loadedNotes = notes;
          setDirty(true);
        }
      } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
      setNotes(loadedNotes); setBoundDigest(loadedDigest); setRevision(loadedRevision); setStale(loadedStale); setLoaded(true);
    })();
    return () => { active = false; };
  }, [digest, loaded, grantId, projectGrantId, documentId, projectId, draftKey]);

  function update(patch: Partial<Note>) {
    if (address === null || !loaded) return;
    const existing = notes.find(note => note.address === address) ?? { address, alias: '', text: '' };
    const next = [...notes.filter(note => note.address !== address), { ...existing, ...patch }];
    try {
      const draft: Draft = { schemaVersion: 1, boundDigest, observedRevision: revision, notes: next };
      localStorage.setItem(draftKey, JSON.stringify(draft));
      setNotes(next); setDirty(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function save() {
    if (!digest || !loaded) return;
    if (changed || stale) {
      if (!window.confirm(t('소스의 논리 주소가 바뀌었을 수 있습니다. 선택 주소에 노트를 다시 연결할까요?', 'The logical source may have changed. Rebind notes to current addresses?'))) return;
    }
    const projectFile: NotesFile | null = projectId ? { schemaVersion: 1, projectId, annotations: notes.map(note => ({ annotationId: note.annotationId ?? crypto.randomUUID(), documentId: projectId, logicalDigest: digest, range: { start: note.address, end: note.end ?? note.address + 1 }, name: note.alias, note: note.text, origin: 'user', sourceRevision, binding: 'valid' })) } : null;
    const bytes = encoder.encode(`${JSON.stringify(projectFile ?? { schemaVersion: 1, boundDigest: digest, notes }, null, 2)}\n`);
    try {
      if (projectFile) parseNotesFile(bytes);
      if (projectGrantId && nativeAvailable) {
        const result = await invoke<{ diskRevision: string }>('save_project_file', { grantId: projectGrantId, relativePath: '.bolge/notes.json', bytes: Array.from(bytes), observedDiskRevision: revision });
        setRevision(result.diskRevision);
      } else if (grantId && nativeAvailable) {
        const result = await invoke<{ notesRevision: string }>('write_notes', { grantId, logicalDigest: digest, bytes: Array.from(bytes), observedNotesRevision: revision, allowRebind: changed || stale });
        setRevision(result.notesRevision);
      } else localStorage.setItem(`bolgescope:unsaved-notes:${documentId}`, new TextDecoder().decode(bytes));
      localStorage.removeItem(draftKey);
      setBoundDigest(digest); setStale(false); setDirty(false); setNotice(t('노트를 원문 밖에 저장했습니다.', 'Notes saved outside source.'));
    } catch (error) { setNotice(nativeError(error).message); }
  }

  return <section className="pane-block notes-panel" aria-label={t('노트와 별칭', 'Notes and aliases')}>
    <div className="section-heading"><h3>{t('노트와 별칭', 'Notes and aliases')}</h3><span>{dirty ? t('저장 전 초안', 'Unsaved draft') : address === null ? '—' : `#${address}`}</span></div>
    {(changed || stale) && <p className="stale-note">{t('주소 연결 재검토 필요', 'Address binding needs review')}</p>}
    <label>{t('별칭', 'Alias')}<input maxLength={128} disabled={!loaded || address === null} value={selected?.alias ?? ''} onChange={event => update({ alias: event.target.value })} /></label>
    <label>{t('사용자 설명', 'User explanation')}<textarea maxLength={8192} disabled={!loaded || address === null} value={selected?.text ?? ''} onChange={event => update({ text: event.target.value })} /></label>
    <button type="button" disabled={!loaded || address === null} onClick={() => void save()}>{t('노트 저장', 'Save note')}</button>
    {notice && <p className="muted" role="status">{notice}</p>}
  </section>;
}
