import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSource,
  classifySourceRelation,
  PROFILE_DIGEST,
  PROFILE_ID,
  type MachineState,
  type SourceExecutionRelation,
  type SourceIdentity,
  type SourceKind,
  type Watchpoint,
} from '@bolgescope/core';
import { lessons, type LessonId } from '@bolgescope/lessons';
import { Explorer, Lens, LessonPanel, Toolbar, type Dock, type SourceView, type Workspace } from './WorkspaceParts';
import { DiffPanel, IOPanel, MemoryPanel, Registers, SelectedCell, StepInspector, TimelinePanel } from './Panels';
import SourceEditor from './SourceEditor';
import NotesPanel from './NotesPanel';
import ProjectTestsPanel, { type ProjectSource } from './ProjectTestsPanel';
import { nativeAvailable, nativeError, openFile, saveAs, saveFile, saveProjectFile, listRecovery, writeRecovery, removeRecovery, type RecoveryRecord } from './native';
import { inputBytes, parseHex } from './bytes';
import { useRuntime } from './useRuntime';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mergeSavedDocument, queueDocumentSave, saveDocument, type Document } from './documentSave';
import { OperationOwner } from './operationOwner';
import { sourceUiState } from './sourceUiState';

const newDocument = (kind: SourceKind): Document => ({ id: `${kind}:${crypto.randomUUID()}`, name: kind === 'raw' ? 'untitled.mb' : 'untitled.nmal', kind, text: '', revision: 0, dirty: false, grantId: null, diskRevision: null, originalBytes: null, encodingError: false });
// Preserve a BOM in the editor so the strict loader can reject it explicitly.
// TextDecoder's default would silently remove it before validation/execution.
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const executionProfile = { id: PROFILE_ID, contractDigest: PROFILE_DIGEST };

export default function App() {
  const [seed] = useState(() => newDocument('raw'));
  const [documents, setDocuments] = useState<Document[]>([seed]);
  const documentsRef = useRef<Document[]>([seed]);
  const sessionOperations = useRef(new OperationOwner());
  const saveQueue = useRef(new Map<string, Promise<boolean>>());
  const closeApproved = useRef(false);
  const quitPromptPending = useRef(false);
  const updateDocuments = useCallback((change: (items: Document[]) => Document[]) => {
    const next = change(documentsRef.current);
    documentsRef.current = next;
    setDocuments(next);
  }, []);
  const [activeId, setActiveId] = useState(seed.id);
  const activeIdRef = useRef(seed.id);
  const activateDocument = useCallback((id: string): void => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);
  const [workspace, setWorkspace] = useState<Workspace>('write');
  const [sourceView, setSourceView] = useState<SourceView>('source');
  const [dock, setDock] = useState<Dock>('io');
  const [memoryPageStart, setMemoryPageStart] = useState(0);
  const [explorerOpen, setExplorerOpen] = useState(() => window.innerWidth >= 1100);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth > 900);
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);
  const [replacement, setReplacement] = useState<{ address: number; symbol: string; nonce: number } | null>(null);
  const [breakpoints, setBreakpoints] = useState<number[]>([]);
  const [watchpoints, setWatchpoints] = useState<Watchpoint[]>([]);
  const [watchRoles, setWatchRoles] = useState<Watchpoint['roles']>(['data-write', 'encryption']);
  const bindingSource = useRef<SourceIdentity | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [traceReceipt, setTraceReceipt] = useState<{ digest: string; branchId: string; tail: number } | null>(null);
  const [branched, setBranched] = useState(false);
  const [branchInput, setBranchInput] = useState('');
  const [branchMode, setBranchMode] = useState<'text' | 'hex'>('text');
  const [branchClose, setBranchClose] = useState(false);
  const [language, setLanguage] = useState<'ko' | 'en'>(() => localStorage.getItem('bolgescope-language') === 'en' ? 'en' : 'ko');
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryRecords, setRecoveryRecords] = useState<RecoveryRecord[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const [snapshot, setSnapshot] = useState<{ id: string; revision: number; text: string; kind: SourceKind; profile: Readonly<{ id: string; contractDigest: string }> } | null>(null);
  const [lessonContext, setLessonContext] = useState<{ id: LessonId; documentId: string } | null>(null);
  const runtime = useRuntime();
  const configureRuntimeView = runtime.configureView;
  useEffect(() => { configureRuntimeView({ selectedAddress, memoryPageStart, overview: dock === 'memory' || sourceView === 'runtime' || sourceView === 'diff' }); }, [configureRuntimeView, selectedAddress, memoryPageStart, dock, sourceView]);
  const active = documents.find(document => document.id === activeId) ?? seed;
  const analysis = useMemo(() => analyzeSource(active.text, active.kind), [active.text, active.kind]);
  const snapshotAnalysis = useMemo(() => snapshot ? analyzeSource(snapshot.text, snapshot.kind) : null, [snapshot]);
  const currentSource = useMemo<SourceIdentity>(() => ({
    documentId: active.id,
    text: active.text,
    kind: active.kind,
    analysis,
    profile: executionProfile,
  }), [active.id, active.text, active.kind, analysis]);
  const snapshotSource = useMemo<SourceIdentity | null>(() => snapshot && snapshotAnalysis ? {
    documentId: snapshot.id,
    text: snapshot.text,
    kind: snapshot.kind,
    analysis: snapshotAnalysis,
    profile: snapshot.profile,
  } : null, [snapshot, snapshotAnalysis]);
  const sourceRelation: SourceExecutionRelation | null = snapshotSource
    ? active.encodingError ? 'invalid' : classifySourceRelation(currentSource, snapshotSource)
    : null;
  const sourceState = sourceRelation ? sourceUiState(sourceRelation) : null;
  const sourceMatches = sourceState?.exactText ?? false;
  const logicalMatches = sourceState?.projectRuntime ?? false;
  const bindingRelation: SourceExecutionRelation | null = bindingSource.current
    ? active.encodingError ? 'invalid' : classifySourceRelation(currentSource, bindingSource.current)
    : null;
  const bindingStale = !!bindingRelation && (breakpoints.length > 0 || watchpoints.length > 0) && sourceUiState(bindingRelation).binding === 'review-required';
  const valid = !active.encodingError && analysis.diagnostics.length === 0;
  const t = (ko: string, en: string) => language === 'ko' ? ko : en;
  const showError = useCallback((error: unknown) => { const detail = nativeError(error); setNotice(`${detail.code}: ${detail.message}`); }, []);
  const pendingLeave = useRef<{ id: string; resolve: (approved: boolean) => void } | null>(null);
  const [leaveName, setLeaveName] = useState<string | null>(null);
  const requestClose = useRef<() => Promise<boolean>>(async () => true);
  const recoveryScheduled = useRef(new Map<string, number>());
  const recoveryTimers = useRef(new Map<string, number>());
  const recoveryPending = useRef(new Map<string, Promise<string>>());

  useEffect(() => { localStorage.setItem('bolgescope-language', language); }, [language]);
  useEffect(() => { if (nativeAvailable) void listRecovery().then(records => { setRecoveryRecords(records); setShowRecovery(records.length > 0); }).catch(showError); }, [showError]);
  useEffect(() => {
    if (!nativeAvailable) return;
    for (const item of documents) {
      if (!item.dirty || item.encodingError) {
        const timer = recoveryTimers.current.get(item.id);
        if (timer !== undefined) window.clearTimeout(timer);
        recoveryTimers.current.delete(item.id);
        recoveryScheduled.current.delete(item.id);
        continue;
      }
      if (recoveryScheduled.current.get(item.id) === item.revision) continue;
      const previous = recoveryTimers.current.get(item.id);
      if (previous !== undefined) window.clearTimeout(previous);
      recoveryScheduled.current.set(item.id, item.revision);
      recoveryTimers.current.set(item.id, window.setTimeout(() => {
        recoveryTimers.current.delete(item.id);
        const task = writeRecovery(item.id, item.revision, item.diskRevision, new TextEncoder().encode(item.text));
        recoveryPending.current.set(item.id, task);
        void task.then(recoveryId => {
          updateDocuments(items => items.map(current => current.id === item.id && current.revision === item.revision && current.dirty ? { ...current, recoveryId } : current));
        }).catch(showError).finally(() => { if (recoveryPending.current.get(item.id) === task) recoveryPending.current.delete(item.id); });
      }, 800));
    }
  }, [documents, showError, updateDocuments]);
  useEffect(() => () => { for (const timer of recoveryTimers.current.values()) window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    void win.onCloseRequested(async event => {
      if (closeApproved.current) return;
      event.preventDefault();
      if (await requestClose.current()) {
        closeApproved.current = true;
        try { await invoke('finish_quit'); } catch (error) { closeApproved.current = false; showError(error); }
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(showError);
    return () => { disposed = true; unlisten?.(); };
  }, [showError]);
  useEffect(() => {
    if (!nativeAvailable) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('bolgescope:quit-requested', () => {
      if (quitPromptPending.current) return;
      quitPromptPending.current = true;
      void requestClose.current().then(async approved => {
        if (!approved) return;
        closeApproved.current = true;
        try { await invoke('finish_quit'); } catch (error) { closeApproved.current = false; showError(error); }
      }).catch(showError).finally(() => { quitPromptPending.current = false; });
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(showError);
    return () => { disposed = true; unlisten?.(); };
  }, [showError]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closeApproved.current || !documentsRef.current.some(item => item.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => { if (runtime.error) setNotice(runtime.error); }, [runtime.error]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return;
      if (event.key === 'F6') {
        event.preventDefault();
        const targets = Array.from(document.querySelectorAll<HTMLElement>('.toolbar button:not(:disabled), .monaco-editor textarea, .dock-tabs button, .inspector button:not(:disabled)'));
        const current = targets.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current - 1 + targets.length) % targets.length : (current + 1) % targets.length;
        targets[next]?.focus();
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); if (selectedEvent === null && runtime.state && runtime.state.phase !== 'RUNNING' && !runtime.busy && runtime.state.head.step > 0) void runtime.back().catch(showError); return; }
      const key = event.key.toLowerCase();
      if (key === 'o') { event.preventDefault(); void openNative(); }
      if (key === 's') { event.preventDefault(); void (event.shiftKey ? saveAsCurrent() : saveCurrent()); }
      if (key === 'enter') { event.preventDefault(); void (event.shiftKey ? step() : run()); }
      if (key === '.') { event.preventDefault(); if (runtime.state?.phase === 'RUNNING' || runtime.state?.phase === 'REWINDING' || runtime.state?.phase === 'WAITING_INPUT') void runtime.pause().catch(showError); }
      if (key === 'g') { event.preventDefault(); setDock('memory'); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.memory-controls input')?.focus()); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  function edit(text: string) { updateDocuments(items => items.map(item => item.id === active.id ? { ...item, text, revision: item.revision + 1, dirty: true, originalBytes: null } : item)); }
  function saveDocumentId(id: string, as = false): Promise<boolean> {
    return queueDocumentSave(saveQueue.current, id, async () => {
      const timer = recoveryTimers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      recoveryTimers.current.delete(id);
      if (timer !== undefined) recoveryScheduled.current.delete(id);
      const pendingRecovery = recoveryPending.current.get(id);
      if (pendingRecovery) await pendingRecovery.catch(showError);
      const captured = documentsRef.current.find(item => item.id === id);
      if (!captured) return false;
      try {
        const saved = await saveDocument(captured, as, { saveAs, saveFile, saveProjectFile });
        if (!saved) { updateDocuments(items => [...items]); return false; }
        let recoveryId: string | undefined;
        updateDocuments(items => items.map(item => {
          if (item.id !== id) return item;
          if (item.revision === captured.revision) recoveryId = item.recoveryId;
          return mergeSavedDocument(item, captured, saved);
        }));
        if (recoveryId) await removeRecovery(recoveryId).catch(showError);
        setNotice(t('원문을 저장했습니다. Runtime 메모리는 저장하지 않았습니다.', 'Source saved. Runtime memory was not saved.'));
        return true;
      } catch (error) { updateDocuments(items => [...items]); showError(error); return false; }
    });
  }
  function saveAsCurrent(): Promise<boolean> { return saveDocumentId(active.id, true); }
  function saveCurrent(): Promise<boolean> { return saveDocumentId(active.id); }
  async function mayLeaveAll(): Promise<boolean> {
    while (true) {
      const item = documentsRef.current.find(current => current.dirty);
      if (!item) return true;
      const approved = await new Promise<boolean>(resolve => { pendingLeave.current = { id: item.id, resolve }; setLeaveName(item.name); });
      if (!approved) return false;
    }
  }
  requestClose.current = mayLeaveAll;
  async function decideLeave(choice: 'save' | 'discard' | 'cancel') {
    const pending = pendingLeave.current;
    if (!pending) return;
    if (choice === 'save' && !await saveDocumentId(pending.id)) return;
    if (choice === 'discard') {
      const timer = recoveryTimers.current.get(pending.id);
      if (timer !== undefined) window.clearTimeout(timer);
      recoveryTimers.current.delete(pending.id);
      const pendingRecovery = recoveryPending.current.get(pending.id);
      if (pendingRecovery) await pendingRecovery.catch(showError);
      const item = documentsRef.current.find(current => current.id === pending.id);
      if (item?.recoveryId) await removeRecovery(item.recoveryId).catch(showError);
      updateDocuments(items => items.map(current => current.id === pending.id ? { ...current, dirty: false, recoveryId: undefined } : current));
    }
    setLeaveName(null);
    pending.resolve(choice !== 'cancel');
    pendingLeave.current = null;
  }
  async function openNative() {
    try {
      const file = await openFile();
      if (!file) return;
      const bytes = Uint8Array.from(file.bytes);
      let text = ''; let encodingError = false;
      try { text = decoder.decode(bytes); } catch { encodingError = true; text = new TextDecoder().decode(bytes); }
      const kind = file.name.toLowerCase().endsWith('.nmal') ? 'normalized' : 'raw';
      const document: Document = { id: `${kind}:${crypto.randomUUID()}`, name: file.name, kind, text, revision: 0, dirty: false, grantId: file.grantId, notesTargetId: file.targetId, diskRevision: file.diskRevision, originalBytes: bytes, encodingError };
      updateDocuments(items => [...items, document]); activateDocument(document.id); setSourceView('source'); setSelectedAddress(null);
      if (encodingError) setNotice(t('잘못된 UTF-8 바이트를 포함합니다. 원본 바이트는 보존되며 편집은 잠겨 있습니다.', 'Invalid UTF-8 bytes. Original bytes are preserved and editing is locked.'));
    } catch (error) { showError(error); }
  }
  function openProjectSource(file: ProjectSource) {
    let text = ''; let encodingError = false;
    try { text = decoder.decode(file.bytes); } catch { text = new TextDecoder().decode(file.bytes); encodingError = true; }
    const document: Document = { ...newDocument(file.kind), name: file.name, text, notesTargetId: file.projectTargetId, projectGrantId: file.projectGrantId, projectId: file.projectId, relativePath: file.relativePath, diskRevision: file.diskRevision, originalBytes: file.bytes, encodingError, runConfig: file.runConfig };
    updateDocuments(items => [...items, document]); activateDocument(document.id); setSourceView('source'); setSelectedAddress(null);
  }
  function restoreRecovery(record: RecoveryRecord) {
    const kind: SourceKind = record.documentId.startsWith('normalized:') ? 'normalized' : 'raw';
    const bytes = Uint8Array.from(record.bytes);
    let text = ''; let encodingError = false;
    try { text = decoder.decode(bytes); } catch { text = new TextDecoder().decode(bytes); encodingError = true; }
    const document: Document = { ...newDocument(kind), id: record.documentId, name: kind === 'raw' ? 'recovered.mb' : 'recovered.nmal', text, revision: record.sourceRevision, dirty: true, originalBytes: bytes, encodingError, recoveryId: record.recoveryId };
    updateDocuments(items => [...items, document]); activateDocument(document.id); setShowRecovery(false); setNotice(t('복구본을 별도 문서로 열었습니다. 원본 파일은 덮어쓰지 않았습니다.', 'Recovery opened as a separate document. Original file was not overwritten.'));
  }
  function detachRaw() {
    if (active.kind !== 'normalized' || !valid) return;
    const text = new TextDecoder().decode(analysis.rawSource);
    const document: Document = { ...newDocument('raw'), name: active.name.replace(/\.nmal$/i, '.mb'), text, dirty: true };
    updateDocuments(items => [...items, document]); activateDocument(document.id); setSourceView('source');
    setNotice(t('생성 Raw를 별도 문서로 분리했습니다. 초기 명령만 대응하며 실행 전체의 동등성은 보장하지 않습니다.', 'Generated Raw detached as a separate document. Initial opcodes match; full execution equivalence is not guaranteed.'));
  }
  async function exportRaw() {
    if (active.kind !== 'normalized' || !valid) return;
    try { const file = await saveAs(analysis.rawSource, active.name.replace(/\.nmal$/i, '.mb')); if (file) setNotice(t('생성 Raw를 .mb로 내보냈습니다.', 'Generated Raw exported as .mb.')); } catch (error) { showError(error); }
  }
  async function openExample() {
    try {
      const response = await fetch('/examples/recurrent_crazy4.mb');
      if (!response.ok) throw new Error(`Example unavailable (${response.status})`);
      const text = await response.text();
      const document: Document = { ...newDocument('raw'), name: 'recurrent_crazy4.mb', text, originalBytes: new TextEncoder().encode(text) };
      updateDocuments(items => [...items, document]); activateDocument(document.id); setSourceView('source'); setSelectedAddress(3);
    } catch (error) { showError(error); }
  }
  async function createDocument(kind: SourceKind) { const document = newDocument(kind); updateDocuments(items => [...items, document]); activateDocument(document.id); setSourceView('source'); setSelectedAddress(null); }
  async function loadCurrent(): Promise<boolean> {
    if (!valid) { setDock('problems'); return false; }
    const operation = sessionOperations.current.begin();
    const captured = active;
    const capturedSource = currentSource;
    const changed = bindingStale;
    await runtime.load(captured.text, captured.kind, captured.runConfig);
    if (!sessionOperations.current.owns(operation)) return false;
    if (changed) {
      setBreakpoints([]); setWatchpoints([]); bindingSource.current = null;
      setNotice(t('원문이 바뀌어 주소 설정을 해제했습니다. 새 주소를 검토하세요.', 'Source changed; address bindings were cleared. Review the new addresses.'));
    } else {
      await runtime.breakpoints(breakpoints);
      if (!sessionOperations.current.owns(operation)) return false;
      await runtime.watchpoints(watchpoints);
      if (!sessionOperations.current.owns(operation)) return false;
      if (bindingSource.current) bindingSource.current = capturedSource;
    }
    setLessonContext(null);
    setSnapshot({ id: captured.id, revision: captured.revision, text: captured.text, kind: captured.kind, profile: capturedSource.profile });
    setSelectedEvent(null); setBranched(false);
    if (activeIdRef.current === captured.id) setWorkspace('run');
    return true;
  }
  async function run() { if (selectedEvent !== null) return; try { if (!runtime.state && !await loadCurrent()) return; await runtime.run(); } catch (error) { showError(error); } }
  async function step() { if (selectedEvent !== null) return; try { if (!runtime.state && !await loadCurrent()) return; await runtime.step(); } catch (error) { showError(error); } }
  async function stop() {
    if (!window.confirm(t('실행 세션과 기록을 폐기할까요?', 'Discard the session and history?'))) return;
    const operation = sessionOperations.current.begin();
    try {
      await runtime.stop();
      if (!sessionOperations.current.owns(operation)) return;
      setSnapshot(null); setLessonContext(null); setSelectedEvent(null); setBranched(false);
    } catch (error) { if (sessionOperations.current.owns(operation)) showError(error); }
  }
  async function restartSession() {
    const operation = sessionOperations.current.begin();
    try {
      await runtime.restart();
      if (!sessionOperations.current.owns(operation)) return;
      await runtime.breakpoints(breakpoints);
      if (!sessionOperations.current.owns(operation)) return;
      await runtime.watchpoints(watchpoints);
      if (!sessionOperations.current.owns(operation)) return;
      setSelectedEvent(null); setBranched(false);
    } catch (error) { if (sessionOperations.current.owns(operation)) showError(error); }
  }
  async function toggleBreakpoint() {
    if (selectedAddress === null) return;
    if (!valid) { setNotice(t('유효한 원문에서만 주소를 연결할 수 있습니다.', 'Address bindings require valid source.')); return; }
    if (runtime.state && !logicalMatches) { setNotice(t('현재 원문으로 재시작한 뒤 주소를 설정하세요.', 'Restart the current source before changing address bindings.')); return; }
    const stale = bindingStale;
    if (stale) setWatchpoints([]);
    bindingSource.current = currentSource;
    const base = stale ? [] : breakpoints;
    const updated = base.includes(selectedAddress) ? base.filter(address => address !== selectedAddress) : [...base, selectedAddress];
    setBreakpoints(updated);
    if (runtime.state && logicalMatches) try { await runtime.breakpoints(updated); } catch (error) { showError(error); }
  }
  async function toggleWatchpoint() {
    if (selectedAddress === null) return;
    if (!valid) { setNotice(t('유효한 원문에서만 주소를 연결할 수 있습니다.', 'Address bindings require valid source.')); return; }
    if (runtime.state && !logicalMatches) { setNotice(t('현재 원문으로 재시작한 뒤 주소를 설정하세요.', 'Restart the current source before changing address bindings.')); return; }
    const stale = bindingStale;
    if (stale) setBreakpoints([]);
    bindingSource.current = currentSource;
    const base = stale ? [] : watchpoints;
    const updated = base.some(point => point.address === selectedAddress) ? base.filter(point => point.address !== selectedAddress) : [...base, { address: selectedAddress, roles: watchRoles }];
    setWatchpoints(updated);
    if (runtime.state && logicalMatches) try { await runtime.watchpoints(updated); } catch (error) { showError(error); }
  }
  async function branch() {
    const state = runtime.state;
    if (!state || !traceReceipt || traceReceipt.branchId !== state.branchId || traceReceipt.tail !== state.tailEventIndex) { setDock('tests'); setNotice(t('부모 trace를 먼저 내보내세요.', 'Export the parent trace first.')); return; }
    try { await runtime.branch(inputBytes(branchInput, branchMode, false), branchClose, traceReceipt.digest); setBranched(true); setTraceReceipt(null); setBranchInput(''); } catch (error) { showError(error); }
  }
  async function startLesson(id: LessonId) {
    const lesson = lessons.find(item => item.id === id);
    if (!lesson) return;
    const operation = sessionOperations.current.begin();
    const startingDocumentId = activeIdRef.current;
    try {
      const response = await fetch(lesson.fixtureUrl);
      if (!response.ok) throw new Error(`${lesson.fixtureUrl}: ${response.status}`);
      const text = await response.text();
      if (!sessionOperations.current.owns(operation) || activeIdRef.current !== startingDocumentId) return;
      const document: Document = { ...newDocument('raw'), name: lesson.fixtureUrl.split('/').pop() ?? 'lesson.mb', text, originalBytes: new TextEncoder().encode(text) };
      updateDocuments(items => [...items, document]); activateDocument(document.id);
      await runtime.load(text, 'raw');
      if (!sessionOperations.current.owns(operation)) return;
      setBreakpoints([]); setWatchpoints([]); bindingSource.current = null; setBranched(false); setSnapshot({ id: document.id, revision: 0, text, kind: 'raw', profile: executionProfile }); setLessonContext({ id, documentId: document.id }); setSelectedEvent(null);
      if (lesson.inputHex) await runtime.send(parseHex(lesson.inputHex));
      for (let index = 0; index < lesson.setupStep && sessionOperations.current.owns(operation); index++) await runtime.step();
      if (id === 'L02' && sessionOperations.current.owns(operation)) await runtime.step();
    } catch (error) { if (sessionOperations.current.owns(operation)) showError(error); }
  }

  const viewText = sourceView === 'raw' ? analysis.diagnostics.length ? t('유효한 원문이 없어 생성 Raw를 표시할 수 없습니다.', 'Generated Raw unavailable until source is valid.') : new TextDecoder().decode(analysis.rawSource) : sourceView === 'initial' && snapshot ? new TextDecoder().decode(analyzeSource(snapshot.text, snapshot.kind).rawSource) : active.text;
  const viewedPoint = selectedEvent !== null && runtime.point?.eventIndex === selectedEvent ? runtime.point : null;
  const viewState: MachineState | null = selectedEvent === null ? runtime.state : viewedPoint && runtime.state ? { ...runtime.state, head: viewedPoint.head, output: Array.from(viewedPoint.output), eventIndex: viewedPoint.eventIndex,
    phase: viewedPoint.head.terminal === 'HALTED' ? 'HALTED' : viewedPoint.head.terminal === 'FAULTED' ? 'FAULTED' : 'PAUSED', reason: 'REWOUND', lastTransaction: null } : null;
  const executionAddress = sourceView === 'initial' && snapshot ? viewState?.head.registers.c ?? null : logicalMatches && sourceView === 'source' ? viewState?.head.registers.c ?? null : null;
  const snapshotSourceLength = snapshot ? runtime.snapshotSourceLength || analyzeSource(snapshot.text, snapshot.kind).sourceMap.length : analysis.sourceMap.length;
  const viewMemory = selectedEvent === null ? runtime.memory : viewedPoint?.memory ?? {};
  const viewRoles = selectedEvent === null ? runtime.roles : viewedPoint?.roles ?? {};
  const viewHistory = selectedEvent === null ? runtime.history : runtime.history.filter(entry => entry.eventIndex <= selectedEvent);
  const transaction = selectedEvent !== null ? null : runtime.state?.lastTransaction ?? null;
  const selectedEventEntry = runtime.history.find(entry => entry.eventIndex === selectedEvent);
  const snapshotWarning = !snapshot
    ? t('소스 편집은 다음 실행에 적용됩니다.', 'Source edits apply on the next run.')
    : sourceState?.warning === 'layout-only'
      ? t('허용 공백만 바뀌어 실행 이미지는 유지됩니다.', 'Only allowed whitespace changed; the running image remains linked.')
      : sourceState?.warning === 'invalid'
        ? t('현재 원문이 유효하지 않아 실행 위치와 주소 연결을 투영하지 않습니다.', 'Current source is invalid; runtime positions and address bindings are detached.')
        : sourceState?.warning === 'changed'
          ? t('소스 편집: 실행 snapshot은 유지됩니다. 새 소스를 로드하면 실행이 다시 시작됩니다.', 'Source edit: the running snapshot is unchanged. Loading edited source starts a new session.')
          : t('원문은 실행 snapshot과 같지만 파일 변경은 아직 저장 전입니다.', 'Source matches the running snapshot, but file changes remain unsaved.');
  async function selectEvent(index: number | null) { setSelectedEvent(index); await runtime.viewPoint(index); }
  async function rewind(index: number) { try { await runtime.rewind(index); await selectEvent(null); } catch (error) { showError(error); } }
  return <div className="app-shell">
    <Toolbar workspace={workspace} setWorkspace={setWorkspace} title={active.name} dirty={active.dirty} state={runtime.state} busy={runtime.busy} valid={selectedEvent === null && (valid || !!runtime.state)} onOpen={() => void openNative()} onSave={() => void saveCurrent()} onSaveAs={() => void saveAsCurrent()} onRun={() => { if (selectedEvent === null) void run(); }} onStep={() => { if (selectedEvent === null) void step(); }} onPause={() => void runtime.pause().catch(showError)} onBack={() => void runtime.back().catch(showError)} onReverse={() => void runtime.reverse().catch(showError)} historyView={selectedEvent !== null} onRestart={() => void restartSession()} onStop={() => void stop()} language={language} setLanguage={setLanguage} t={t} />
    <div className="workspace-body"><Explorer documents={documents} activeId={active.id} onSelect={activateDocument} onNew={kind => void createDocument(kind)} onExample={() => void openExample()} open={explorerOpen} onToggle={() => setExplorerOpen(!explorerOpen)} t={t} />
      <main className="main-region"><div className="editor-tabs" role="tablist" aria-label={t('소스 보기', 'Source views')}>{(['source', 'initial', 'runtime', 'diff', 'raw'] as const).map(item => <button type="button" role="tab" aria-selected={sourceView === item} key={item} className={sourceView === item ? 'is-active' : ''} onClick={() => setSourceView(item)}>{item === 'source' ? active.kind === 'raw' ? 'Source · Raw' : 'Source · Normalized' : item === 'initial' ? 'Initial snapshot' : item === 'runtime' ? 'Runtime memory' : item === 'diff' ? 'Memory diff' : 'Generated Raw'}</button>)}<span className="tab-spacer" />{active.kind === 'normalized' && valid && <><button type="button" onClick={detachRaw}>{t('Raw 분리', 'Detach Raw')}</button><button type="button" onClick={() => void exportRaw()}>{t('.mb 내보내기', 'Export .mb')}</button></>}<button type="button" className="panel-toggle" onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? t('분석 닫기', 'Hide inspector') : t('분석 열기', 'Show inspector')}</button></div>
        {(active.dirty || bindingStale || snapshot && sourceState?.warning !== 'none') && <div className="snapshot-warning" role="status">{snapshotWarning} {bindingStale && <strong>{t('주소 연결 검토 필요', 'Address bindings need review')}</strong>}{snapshot && !sourceMatches && <><button type="button" onClick={() => setSourceView('initial')}>{t('스냅샷 보기', 'View snapshot')}</button><button type="button" disabled={!valid} onClick={() => void loadCurrent().catch(showError)}>{t('현재 원문으로 재시작', 'Restart current source')}</button></>}</div>}
        <div className="editor-region"><div className="source-editor-layer" hidden={sourceView === 'runtime' || sourceView === 'diff'}><SourceEditor modelKey={`${active.id}:${sourceView}`} text={viewText} kind={sourceView === 'raw' || sourceView === 'initial' ? 'raw' : active.kind} analysis={sourceView === 'initial' && snapshot ? analyzeSource(viewText, 'raw') : sourceView === 'raw' ? analyzeSource(viewText, 'raw') : analysis} readOnly={sourceView !== 'source' || active.encodingError} selectedAddress={selectedAddress} executionAddress={executionAddress} replacement={sourceView === 'source' ? replacement : null} onChange={edit} onSelect={setSelectedAddress} /></div>{sourceView === 'diff' && <DiffPanel state={viewState} memory={viewMemory} initial={runtime.initial} complete={runtime.overviewComplete} onSelect={setSelectedAddress} t={t} />}{sourceView === 'runtime' && <MemoryPanel state={viewState} memory={viewMemory} initial={runtime.initial} roles={viewRoles} selected={selectedAddress} pageStart={memoryPageStart} onPageChange={setMemoryPageStart} overviewComplete={runtime.overviewComplete} onSelect={setSelectedAddress} t={t} />}</div>
        {workspace !== 'learn' && sourceView === 'source' && <Lens analysis={analysis} kind={active.kind} valid={valid} selectedAddress={selectedAddress} onSelect={setSelectedAddress} onReplace={symbol => { if (valid && selectedAddress !== null) setReplacement({ address: selectedAddress, symbol, nonce: Date.now() }); }} t={t} />}
        <div className="dock"><div className="dock-tabs" role="tablist" aria-label={t('하단 패널', 'Bottom panels')}>{(['io','timeline','memory','problems','tests'] as const).map(item => <button type="button" role="tab" aria-selected={dock === item} key={item} className={dock === item ? 'is-active' : ''} onClick={() => setDock(item)}>{item === 'io' ? 'I/O' : item === 'timeline' ? 'Timeline' : item === 'memory' ? 'Memory' : item === 'problems' ? `${t('문제', 'Problems')} ${analysis.diagnostics.length || ''}` : 'Tests'}</button>)}</div>
          <div className="dock-content">{dock === 'io' ? <IOPanel state={viewState} onSend={runtime.send} onEof={runtime.eof} busy={runtime.busy} historical={selectedEvent !== null} t={t} /> : dock === 'timeline' ? <TimelinePanel history={runtime.history} selected={selectedEvent} hasMore={runtime.historyHasMore} loading={runtime.historyLoading} busy={runtime.busy || runtime.state?.phase === 'REWINDING'} onLoadOlder={() => void runtime.loadOlderHistory()} onSelect={index => void selectEvent(index)} onRewind={index => void rewind(index)} t={t} /> : dock === 'memory' ? <MemoryPanel state={viewState} memory={viewMemory} initial={runtime.initial} roles={viewRoles} selected={selectedAddress} pageStart={memoryPageStart} onPageChange={setMemoryPageStart} overviewComplete={runtime.overviewComplete} onSelect={setSelectedAddress} t={t} /> : dock === 'problems' ? <div className="problems-list">{analysis.diagnostics.length ? analysis.diagnostics.map(item => <button type="button" key={`${item.code}:${item.message}:${item.span?.byteStart ?? 'document'}`} onClick={() => item.address !== undefined && setSelectedAddress(item.address)}>{item.code} · {item.message}</button>) : <p className="empty-note">{t('진단이 없습니다.', 'No diagnostics.')}</p>}</div> : null}<div className="project-tests-wrap" hidden={dock !== 'tests'}><ProjectTestsPanel sourceText={active.text} sourceBytes={active.dirty || !active.originalBytes ? new TextEncoder().encode(active.text) : active.originalBytes} sourceKind={active.kind} sourceName={active.name} state={runtime.state} history={runtime.history} snapshotText={snapshot?.text ?? null} snapshotKind={snapshot?.kind ?? null} sourceIdentityMatches={logicalMatches} sourceProjectId={active.projectId ?? null} sourceRelativePath={active.relativePath ?? null} traceInspectionOnly={branched || (runtime.state?.earliestEventIndex ?? 0) > 0} beginTraceExport={runtime.beginTraceExport} ackTraceExport={runtime.ackTraceExport} cancelTraceExport={runtime.cancelTraceExport} onOpenProjectSource={openProjectSource} onTraceExport={digest => { const state = runtime.state; if (state && state.eventIndex === state.tailEventIndex) setTraceReceipt({ digest, branchId: state.branchId, tail: state.tailEventIndex }); }} t={t} /></div></div>
        </div>
      </main>
      {inspectorOpen && <aside className={`inspector ${inspectorOpen ? 'compact-open' : ''}`} aria-label={t('분석기', 'Inspector')}>
        <div className="inspector-title"><h2>{workspace === 'learn' ? t('학습', 'Learn') : t('분석기', 'Inspector')}</h2><span>{workspace === 'learn' ? 'LESSONS' : viewState ? `${selectedEvent !== null ? 'HISTORY' : 'LIVE'} EVENT ${viewState.eventIndex}` : 'READY'}</span><button type="button" onClick={() => setInspectorOpen(false)} aria-label={t('분석 닫기', 'Hide inspector')}>×</button></div>
        {workspace === 'learn'
          ? <LessonPanel state={runtime.state} history={runtime.history} loadedLessonId={lessonContext?.documentId === active.id && logicalMatches ? lessonContext.id : null} onStart={id => void startLesson(id)} t={t} />
          : <>
            <Registers state={viewState} transaction={transaction} t={t} />
            <SelectedCell address={selectedAddress} state={viewState} memory={viewMemory} initial={runtime.initial} roles={viewRoles} sourceLength={snapshotSourceLength} history={viewHistory} t={t} />
            <StepInspector state={viewState} transaction={selectedEvent !== null ? selectedEventEntry?.kind === 'instruction' ? selectedEventEntry.transaction : null : transaction} t={t} />
            <section className="pane-block">
              <div className="section-heading"><h3>{t('중단점', 'Breakpoints')}</h3><span>{breakpoints.length}</span></div>
              <button type="button" disabled={!valid || selectedAddress === null} onClick={() => void toggleBreakpoint()}>{selectedAddress !== null && breakpoints.includes(selectedAddress) ? t('선택 주소 해제', 'Remove selected') : t('선택 주소 추가', 'Add selected address')}</button>
              <p className="muted">{breakpoints.map(address => `#${address}`).join(', ') || t('설정 없음', 'None')}</p>
            </section>
            <section className="pane-block">
              <div className="section-heading"><h3>{t('감시점', 'Watchpoints')}</h3><span>{watchpoints.length}</span></div>
              <div className="watch-roles">{(['data-read','data-write','encryption'] as const).map(role => <label key={role}><input type="checkbox" checked={watchRoles.includes(role)} onChange={() => setWatchRoles(watchRoles.includes(role) ? watchRoles.filter(item => item !== role) : [...watchRoles, role])} />{role}</label>)}</div>
              <button type="button" disabled={!valid || selectedAddress === null || watchRoles.length === 0} onClick={() => void toggleWatchpoint()}>{watchpoints.some(point => point.address === selectedAddress) ? t('선택 주소 해제', 'Remove selected') : t('선택 주소 감시', 'Watch selected')}</button>
              <p className="muted">{watchpoints.map(point => `#${point.address} ${point.roles.join('/')}`).join(', ') || t('설정 없음', 'None')}</p>
            </section>
            {runtime.state && runtime.state.eventIndex < runtime.state.tailEventIndex && runtime.state.head.terminal === 'NONE' && <section className="pane-block branch-panel"><div className="section-heading"><h3>{t('다른 입력으로 분기', 'Branch with new input')}</h3><span>#{runtime.state.eventIndex} / {runtime.state.tailEventIndex}</span></div><p className="muted">{t('부모 trace를 끝 시점에서 내보낸 뒤 이 지점으로 되돌려 새 suffix를 넣습니다.', 'Export the parent trace at its tail, then rewind here to replace the unconsumed suffix.')}</p><select aria-label={t('분기 입력 형식', 'Branch input format')} value={branchMode} onChange={event => setBranchMode(event.target.value as 'text' | 'hex')}><option value="text">Text UTF-8</option><option value="hex">Hex bytes</option></select><input aria-label={t('새 입력 suffix', 'New input suffix')} value={branchInput} onChange={event => setBranchInput(event.target.value)} placeholder={branchMode === 'hex' ? '41 42' : t('새 입력', 'New input')} /><label><input type="checkbox" checked={branchClose} onChange={event => setBranchClose(event.target.checked)} /> Send EOF</label><button type="button" onClick={() => void rewind(runtime.state?.tailEventIndex ?? 0)}>{t('끝 시점으로 이동', 'Move to tail')}</button><button type="button" onClick={() => traceReceipt ? void branch() : setDock('tests')}>{traceReceipt?.branchId === runtime.state.branchId && traceReceipt.tail === runtime.state.tailEventIndex ? t('분기 생성', 'Create branch') : t('먼저 trace 내보내기', 'Export trace first')}</button></section>}
            <NotesPanel key={active.id} documentId={active.id} grantId={active.grantId} projectGrantId={active.projectGrantId} projectId={active.projectId} notesTargetId={active.notesTargetId} sourceRevision={active.revision} logicalSource={analysis.logicalSource} sourceValid={valid} address={selectedAddress} t={t} />
            {runtime.state?.reason === 'OUTPUT_LIMIT' && <section className="pane-block"><p>{t('출력 한도에 도달했습니다.', 'Output limit reached.')}</p><button type="button" onClick={() => void runtime.outputLimit((runtime.state?.head.outputLength ?? 0) + 1048576).catch(showError)}>{t('한도 1 MiB 늘리기', 'Increase limit')}</button></section>}
          </>}
      </aside>}
    </div>
    <footer className="status-bar"><span className={`status-pill ${runtime.state?.phase.toLowerCase() ?? ''}`}>{runtime.state ? `${runtime.state.phase} · ${runtime.state.reason}` : t('소스 대기', 'Source ready')}</span><span>{analysis.sourceMap.length} cells · rev {active.revision}</span><span>{snapshot ? `snapshot rev ${snapshot.revision}` : 'no snapshot'}</span><span className="status-spacer" /><span>{nativeAvailable ? 'macOS' : t('브라우저 미리보기', 'Browser preview')}</span><span>profile bolgescope-tio-safe-v1</span></footer>
    {notice && <div className="notice" role="alert"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t('알림 닫기', 'Dismiss notification')}>×</button></div>}
    {showRecovery && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={t('복구본', 'Recovery copies')}><h2>{t('복구본이 있습니다', 'Recovery copies found')}</h2><p>{t('복구본은 별도 문서로 열며 원본을 자동으로 덮어쓰지 않습니다.', 'Recovered content opens separately and never overwrites the original automatically.')}</p>{recoveryRecords.map(record => <button type="button" key={record.recoveryId} onClick={() => restoreRecovery(record)}>{record.documentId} · rev {record.sourceRevision}</button>)}<button type="button" onClick={() => setShowRecovery(false)}>{t('나중에', 'Later')}</button></div></div>}
    {leaveName && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={t('저장되지 않은 변경', 'Unsaved changes')}><h2>{t('저장되지 않은 변경', 'Unsaved changes')}</h2><p>{leaveName}: {t('변경을 어떻게 처리할까요?', 'What should happen to these changes?')}</p><div className="button-row"><button type="button" className="primary" onClick={() => void decideLeave('save')}>{t('저장', 'Save')}</button><button type="button" onClick={() => void decideLeave('discard')}>{t('버리기', 'Discard')}</button><button type="button" onClick={() => void decideLeave('cancel')}>{t('취소', 'Cancel')}</button></div></div></div>}
  </div>;
}
