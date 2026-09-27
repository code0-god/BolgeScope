import { useState } from 'react';
import { encode, type Analysis, type JournalEvent, type MachineState } from '@bolgescope/core';
import { judgeLesson, lessons, type LessonId } from '@bolgescope/lessons';

type T = (ko: string, en: string) => string;
export type Workspace = 'write' | 'run' | 'learn';
export type SourceView = 'source' | 'initial' | 'runtime' | 'diff' | 'raw';
export type Dock = 'io' | 'timeline' | 'memory' | 'problems' | 'tests';

export function Toolbar({ workspace, setWorkspace, title, dirty, state, busy, valid, onOpen, onSave, onSaveAs, onRun, onStep, onPause, onBack, onReverse, onRestart, onStop, historyView, language, setLanguage, t }: {
  workspace: Workspace; setWorkspace: (value: Workspace) => void; title: string; dirty: boolean; state: MachineState | null; busy: boolean; valid: boolean;
  onOpen: () => void; onSave: () => void; onSaveAs: () => void; onRun: () => void; onStep: () => void; onPause: () => void; onBack: () => void; onReverse: () => void; onRestart: () => void; onStop: () => void; historyView: boolean;
  language: 'ko' | 'en'; setLanguage: (value: 'ko' | 'en') => void; t: T;
}) {
  const loaded = !!state;
  const running = state?.phase === 'RUNNING';
  const rewinding = state?.phase === 'REWINDING';
  const moving = running || rewinding;
  const terminal = state?.phase === 'HALTED' || state?.phase === 'FAULTED';
  return <header className="toolbar">
    <div className="brand"><span className="brand-mark">B</span><span>BolgeScope</span></div>
    <div className="document-title" title={title}>{title}{dirty && <span title={t('저장되지 않음', 'Unsaved')}> ●</span>}</div>
    <nav className="workspace-tabs" aria-label={t('작업 공간', 'Workspace')}>{(['write', 'run', 'learn'] as const).map(item => <button type="button" key={item} className={workspace === item ? 'is-active' : ''} onClick={() => setWorkspace(item)}>{item === 'write' ? t('작성', 'Write') : item === 'run' ? t('실행', 'Run') : t('학습', 'Learn')}</button>)}</nav>
    <div className="toolbar-actions"><button type="button" onClick={onOpen} title="Cmd+O">{t('열기', 'Open')}</button><button type="button" onClick={onSave} title="Cmd+S">{t('저장', 'Save')}</button><button type="button" className="secondary-action" onClick={onSaveAs} title="Cmd+Shift+S">{t('다른 이름', 'Save As')}</button><span className="toolbar-divider" />
      <button type="button" className="primary" onClick={onRun} disabled={!valid || busy || terminal || moving || historyView} title="Cmd+Enter">{t('실행', 'Run')}</button><button type="button" onClick={onStep} disabled={!valid || busy || terminal || moving || historyView} title="Cmd+Shift+Enter">Step</button><button type="button" onClick={onPause} disabled={!loaded || (!moving && state.phase !== 'WAITING_INPUT')} title="Cmd+.">{t('일시정지', 'Pause')}</button><button type="button" onClick={onBack} disabled={!loaded || busy || moving || historyView || state.head.step === 0}>Back</button><button type="button" className="secondary-action" onClick={onReverse} disabled={!loaded || busy || moving || historyView || state.head.step === 0}>{t('역방향 계속', 'Reverse')}</button><button type="button" className="secondary-action" onClick={onRestart} disabled={!loaded || busy || moving || historyView}>{t('재시작', 'Restart')}</button><button type="button" className="secondary-action" onClick={onStop} disabled={!loaded}>{t('중지', 'Stop')}</button>
    </div>
    <select className="language-select" aria-label={t('언어', 'Language')} value={language} onChange={event => setLanguage(event.target.value as 'ko' | 'en')}><option value="ko">한국어</option><option value="en">English</option></select>
  </header>;
}

export function Explorer({ documents, activeId, onSelect, onNew, onExample, open, onToggle, t }: { documents: readonly { id: string; name: string; dirty: boolean }[]; activeId: string; onSelect: (id: string) => void; onNew: (kind: 'raw' | 'normalized') => void; onExample: () => void; open: boolean; onToggle: () => void; t: T }) {
  return <aside className={`explorer ${open ? '' : 'collapsed'}`} aria-label={t('탐색기', 'Explorer')}>
    <div className="side-heading"><h2>{t('탐색기', 'Explorer')}</h2><button type="button" onClick={onToggle} aria-label={open ? t('탐색기 접기', 'Collapse explorer') : t('탐색기 열기', 'Open explorer')}>{open ? '‹' : '›'}</button></div>
    {open && <><div className="explorer-group"><div className="group-label">{t('열린 문서', 'Open documents')}</div>{documents.map(document => <button type="button" key={document.id} className={`file-entry ${activeId === document.id ? 'is-active' : ''}`} onClick={() => onSelect(document.id)}><span className="file-dot" />{document.name}{document.dirty && <span className="dirty-mark">●</span>}</button>)}</div>
      <div className="explorer-group"><div className="group-label">{t('시작', 'Start')}</div><button type="button" onClick={() => onNew('raw')}>{t('새 Raw 문서', 'New Raw document')}</button><button type="button" onClick={() => onNew('normalized')}>{t('새 Normalized 문서', 'New Normalized document')}</button><button type="button" onClick={onExample}>{t('회귀 예제 열기', 'Open regression example')}</button></div>
      <div className="explorer-foot">MALBOLGE · 10 TRITS<br />59,049 CELLS</div></>}
  </aside>;
}

export function Lens({ analysis, selectedAddress, onSelect, onReplace, kind, valid, t }: { analysis: Analysis; selectedAddress: number | null; onSelect: (address: number) => void; onReplace: (symbol: string) => void; kind: 'raw' | 'normalized'; valid: boolean; t: T }) {
  const selectedIndex = selectedAddress === null ? -1 : analysis.sourceMap.findIndex(cell => cell.address === selectedAddress);
  const anchor = Math.max(0, Math.min(analysis.sourceMap.length - 1, selectedIndex < 0 ? 0 : selectedIndex));
  const start = Math.max(0, anchor - 8);
  const cells = analysis.sourceMap.slice(start, start + 24);
  const active = selectedAddress === null ? null : analysis.sourceMap.find(cell => cell.address === selectedAddress) ?? null;
  const [symbol, setSymbol] = useState('p');
  let preview = '';
  if (active) {
    const raw = encode(symbol, active.address);
    preview = `raw ${String.fromCharCode(raw)} · ASCII ${raw} · opcode ${symbol} · (${raw} + ${active.address}) mod 94 = ${(raw + active.address) % 94}`;
  }
  return <div className="lens"><div className="lens-header"><strong>Address Lens</strong><span>{active ? `#${active.address} · ${active.span.line}:${active.span.column}` : t('셀 없음', 'No cell')}</span></div>
    <div className="lens-cells">{cells.map(cell => <button type="button" key={cell.address} className={selectedAddress === cell.address ? 'is-active' : ''} onClick={() => onSelect(cell.address)} aria-label={`${t('주소', 'Address')} ${cell.address}, ${cell.symbol}`}><small>#{cell.address}</small><strong>{String.fromCharCode(cell.raw)}</strong><em>{cell.symbol}</em></button>)}</div>
    <div className="lens-footer"><span>{active ? `raw ${active.raw} · residue ${(active.raw + active.address) % 94} · initial ${active.symbol}` : t('주소를 선택하세요', 'Select an address')}</span><div><select aria-label={t('초기 명령 선택', 'Choose initial instruction')} value={symbol} onChange={event => setSymbol(event.target.value)}>{[['j','Move D'],['i','Jump C'],['*','Rotate'],['p','Crazy'],['<','Output'],['/','Input'],['v','Halt'],['o','NOP']].map(([value, label]) => <option key={value} value={value}>{value} · {label}</option>)}</select><span className="preview">{preview}</span><button type="button" disabled={!active || !valid} onClick={() => onReplace(symbol)}>{t('교체', 'Replace')}</button></div><span className="lens-caution">{kind === 'normalized' ? t('생성 Raw는 초기 명령만 보존합니다. 전체 실행 동등성은 보장되지 않습니다.', 'Generated Raw preserves initial opcodes, not full execution behavior.') : t('초기 명령 교체는 이후 실행 동등성을 보장하지 않습니다.', 'Preserving an initial opcode does not preserve execution behavior.')}</span></div>
  </div>;
}

export function LessonPanel({ state, history, loadedLessonId, onStart, t }: { state: MachineState | null; history: readonly JournalEvent[]; loadedLessonId: LessonId | null; onStart: (id: LessonId) => void; t: T }) {
  const [selected, setSelected] = useState<LessonId>('L01');
  const [answer, setAnswer] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const lesson = lessons.find(item => item.id === selected) ?? lessons[0];
  if (!lesson) return null;
  return <section className="lesson-panel"><div className="section-heading"><h3>{t('학습', 'Learn')}</h3><span className="muted">6 {t('주제', 'topics')}</span></div>
    <div className="lesson-list">{lessons.map(item => <button type="button" key={item.id} className={item.id === selected ? 'is-active' : ''} onClick={() => { setSelected(item.id); setAnswer(''); setResult(null); setShowHint(false); }}><span>{item.id}</span>{item.title}</button>)}</div>
    <h4>{lesson.title}</h4><p>{lesson.goal}</p><p className="lesson-question">{lesson.question}</p>
    <button type="button" onClick={() => { setResult(null); onStart(selected); }}>{t('실제 VM으로 시작', 'Start in real VM')}</button>
    <label className="lesson-answer">{t('예측', 'Prediction')}<input value={answer} onChange={event => setAnswer(event.target.value)} placeholder={lesson.answerExample} /></label>
    <div className="button-row"><button type="button" disabled={!state || loadedLessonId !== selected} onClick={() => { if (!state || loadedLessonId !== selected) return; const judged = judgeLesson(selected, answer, state, history); setResult(judged.observed ? judged.correct ? t('정답입니다. 실제 실행 결과와 일치합니다.', 'Correct. This matches actual execution.') : `${t('다릅니다. 관찰된 값:', 'Different. Observed:')} ${judged.expected}` : t('아직 필요한 실행 사건이 없습니다.', 'The needed VM event has not happened yet.')); }}>{t('실제 결과로 확인', 'Check actual result')}</button><button type="button" onClick={() => setShowHint(!showHint)}>{t('힌트', 'Hint')}</button></div>
    {showHint && <p className="lesson-hint">{lesson.hint}</p>}{result && <p className="lesson-result" role="status">{result}</p>}
  </section>;
}
