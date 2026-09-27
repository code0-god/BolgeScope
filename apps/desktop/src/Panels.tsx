import { useEffect, useMemo, useRef, useState } from 'react';
import { MEMORY_SIZE, decode, encrypt, type JournalEvent, type MachineState, type Transaction } from '@bolgescope/core';
import type { MemoryLookup, RoleLookup } from './useRuntime';
import { escapedBytes, hexBytes, inputBytes, outputText } from './bytes';

type T = (ko: string, en: string) => string;
type RuntimeProps = { state: MachineState | null; transaction: Transaction | null; t: T };

export function Registers({ state, transaction, t }: RuntimeProps) {
  const registers = state?.head.registers;
  return <section className="pane-block" aria-label={t('레지스터', 'Registers')}>
    <div className="section-heading"><h3>{t('레지스터', 'Registers')}</h3><span className="muted">{state ? `STEP ${state.head.step}` : '—'}</span></div>
    <div className="register-grid">
      {(['a', 'c', 'd'] as const).map(key => <div className="register" key={key}>
        <span>{key.toUpperCase()}</span><strong>{registers?.[key] ?? '—'}</strong>
        {transaction && <small>{transaction.before.registers[key]} → {transaction.after.registers[key]}</small>}
      </div>)}
    </div>
  </section>;
}

export function StepInspector({ state, transaction, t }: RuntimeProps) {
  return <section className="pane-block" aria-label={t('명령 분석', 'Step inspector')}>
    <div className="section-heading"><h3>{t('명령 분석', 'Step inspector')}</h3><span className="muted">{transaction ? `#${transaction.fetchAddress}` : '—'}</span></div>
    {!transaction ? <p className="empty-note">{state?.phase === 'WAITING_INPUT' ? t('입력 명령이 아직 실행되지 않았습니다.', 'Input instruction has not executed yet.') : t('Step을 실행하면 실제 효과가 표시됩니다.', 'Step to inspect actual effects.')}</p> : <ol className="step-list">
      <li><span>FETCH</span><p>#{transaction.fetchAddress} · {transaction.fetchedRaw} ({String.fromCharCode(transaction.fetchedRaw)}) → <b>{transaction.opcode}</b></p></li>
      <li><span>EFFECT</span><p>{transaction.writes.filter(write => write.role === 'data-write').map(write => `M[${write.address}] ${write.before} → ${write.after}`).join(' · ') || (transaction.input?.kind === 'byte' ? `Input ${transaction.input.value}` : transaction.input?.kind === 'eof' ? 'EOF' : transaction.output.length ? `Output ${hexBytes(transaction.output)}` : t('데이터 쓰기 없음', 'No data write'))}</p></li>
      <li><span>ENCRYPT</span><p>{transaction.writes.filter(write => write.role === 'encryption').map(write => `M[${write.address}] ${write.before} → ${write.after}`).join(' · ') || t('Halt: 치환 없음', 'Halt: no encryption')}</p></li>
      <li><span>ADVANCE</span><p>C {transaction.before.registers.c} → {transaction.after.registers.c} · D {transaction.before.registers.d} → {transaction.after.registers.d}</p></li>
    </ol>}
  </section>;
}

export function SelectedCell({ address, state, memory, initial, roles, sourceLength, history, t }: { address: number | null; state: MachineState | null; memory: MemoryLookup; initial: MemoryLookup; roles: RoleLookup; sourceLength: number; history: readonly JournalEvent[]; t: T }) {
  const current = address !== null ? memory[address] : undefined;
  const first = address !== null ? initial[address] : undefined;
  const symbol = first !== undefined && address !== null ? decode(first, address) : '';
  const visits = address === null ? [] : history.filter(event => event.kind === 'instruction' && event.transaction.fetchAddress === address);
  const writes = address === null ? [] : history.flatMap(event => event.kind === 'instruction' ? event.transaction.writes.filter(write => write.address === address).map(write => ({ event: event.eventIndex, write })) : []);
  const counts = address === null ? undefined : roles[address];
  const theoretical: number[] = [];
  if (first !== undefined) { let value = first; for (let index = 0; index < 94; index++) { const next = encrypt(value); if (next === null || theoretical.includes(next)) break; theoretical.push(next); value = next; } }
  return <section className="pane-block" aria-label={t('선택 셀', 'Selected cell')}>
    <div className="section-heading"><h3>{t('선택 셀', 'Selected cell')}</h3><span className="muted">{address === null ? '—' : `#${address}`}</span></div>
    {address === null ? <p className="empty-note">{t('소스나 메모리에서 주소를 선택하세요.', 'Select an address in source or memory.')}</p> : <div className="data-rows">
      <div><span>{t('기원', 'Origin')}</span><strong>{address < sourceLength ? t('소스', 'Source') : t('생성 메모리', 'Generated')}</strong></div>
      <div><span>Initial</span><strong>{first ?? '—'} {first !== undefined && first >= 33 && first <= 126 ? `· ${String.fromCharCode(first)}` : ''}</strong></div>
      <div><span>{t('초기 명령', 'Initial opcode')}</span><strong>{symbol || '—'}</strong></div>
      <div><span>Runtime</span><strong>{state ? current ?? '—' : '—'}</strong></div>
      <div><span>Δ</span><strong>{state && current !== undefined && first !== undefined ? current - first : '—'}</strong></div>
      <div><span>TRITS</span><strong>{current === undefined ? '—' : current.toString(3).padStart(10, '0')}</strong></div>
      <div><span>{t('실제 접근', 'Observed accesses')}</span><strong>{counts ? `F ${counts.fetch} · R ${counts.dataRead} · W ${counts.dataWrite} · E ${counts.encryption}` : '—'}</strong></div>
      <div className="history-row"><span>{t('기록된 방문', 'Retained visits')}</span><strong>{visits.length ? `${visits.length} · ${visits.slice(-3).map(event => `#${event.eventIndex}`).join(', ')}` : t('불러온 이력에 없음', 'None in loaded history')}</strong></div>
      <div className="history-row"><span>{t('기록된 쓰기', 'Retained writes')}</span><strong>{writes.length ? `${writes.length} · ${writes.slice(-2).map(({ event, write }) => `#${event} ${write.role} ${write.before}→${write.after}`).join(' · ')}` : t('불러온 이력에 없음', 'None in loaded history')}</strong></div>
      <div><span>{t('이론 치환', 'Theoretical xlat2')}</span><strong>{theoretical.slice(0, 4).join(' → ') || '—'}{theoretical.length > 4 ? ' …' : ''}</strong></div>
    </div>}
  </section>;
}

export function IOPanel({ state, onSend, onEof, busy, t, historical = false }: { state: MachineState | null; onSend: (bytes: Uint8Array) => Promise<void>; onEof: () => Promise<void>; busy: boolean; t: T; historical?: boolean }) {
  const [mode, setMode] = useState<'text' | 'hex'>('text');
  const [value, setValue] = useState('');
  const [lf, setLf] = useState(false);
  const [outputMode, setOutputMode] = useState<'text' | 'escaped' | 'hex'>('text');
  let preview: Uint8Array<ArrayBufferLike> = new Uint8Array(); let error = '';
  try { preview = inputBytes(value, mode, lf); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const output = state?.output ?? [];
  const canSend = !!state && !historical && state.phase !== 'HALTED' && state.phase !== 'FAULTED' && !busy;
  return <div className="io-layout">
    <section className="io-column"><div className="section-heading"><h3>{t('입력', 'Input')}</h3><span className="muted">{state ? `${state.head.tape.cursor}/${state.head.tape.visibleLength} · ${state.head.tape.closed ? 'EOF' : 'OPEN'}` : '—'}</span></div>
      <div className="inline-controls"><label><span className="sr-only">{t('입력 형식', 'Input format')}</span><select value={mode} onChange={event => setMode(event.target.value as 'text' | 'hex')}><option value="text">Text UTF-8</option><option value="hex">Hex bytes</option></select></label><label className="check"><input type="checkbox" checked={lf} onChange={event => setLf(event.target.checked)} /> {t('LF 추가', 'Append LF')}</label></div>
      <textarea aria-label={t('입력 데이터', 'Input data')} value={value} onChange={event => setValue(event.target.value)} spellCheck={false} placeholder={mode === 'hex' ? '41 42 43 0A' : t('입력할 텍스트', 'Text to send')} />
      <div className="byte-preview">{error || (preview.length ? `${hexBytes(Array.from(preview))} · ${preview.length} bytes` : t('입력 byte 없음', 'No input bytes'))}</div>
      <div className="button-row"><button type="button" disabled={!canSend || !!error || preview.length === 0} onClick={() => void onSend(preview).then(() => setValue('')).catch(() => {})}>{t('전송', 'Send')}</button><button type="button" disabled={!canSend || state?.head.tape.closed} onClick={() => void onEof().catch(() => {})}>Send EOF</button></div>
      {state?.phase === 'WAITING_INPUT' && <p className="input-wait">{t('입력 대기 중: 명령은 아직 실행되지 않았습니다.', 'Waiting for input: the instruction has not executed.')}</p>}
    </section>
    <section className="io-column"><div className="section-heading"><h3>{t('출력', 'Output')}</h3><span className="muted">{output.length} bytes</span></div>
      <fieldset className="inline-controls output-modes"><legend className="sr-only">{t('출력 형식', 'Output format')}</legend>{(['text', 'escaped', 'hex'] as const).map(option => <button type="button" className={outputMode === option ? 'is-active' : ''} key={option} onClick={() => setOutputMode(option)}>{option}</button>)}</fieldset>
      <pre className="output-box">{outputMode === 'text' ? outputText(output) : outputMode === 'hex' ? hexBytes(output) : escapedBytes(output)}</pre>
    </section>
  </div>;
}

export function MemoryPanel({ state, memory, initial, roles, selected, pageStart, onPageChange, overviewComplete, onSelect, t }: { state: MachineState | null; memory: MemoryLookup; initial: MemoryLookup; roles: RoleLookup; selected: number | null; pageStart: number; onPageChange: (start: number) => void; overviewComplete: boolean; onSelect: (address: number) => void; t: T }) {
  const overview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = overview.current; const context = canvas?.getContext('2d');
    if (!context) return;
    const image = context.createImageData(243, 243);
    for (let address = 0; address < MEMORY_SIZE; address++) {
      const offset = address * 4;
      const changed = state && memory[address] !== undefined && initial[address] !== undefined && memory[address] !== initial[address];
      const color = address === selected ? [233, 232, 228] : address === state?.head.registers.c ? [112, 196, 182] : changed ? [230, 163, 111] : [54, 59, 64];
      image.data[offset] = color[0] ?? 0; image.data[offset + 1] = color[1] ?? 0; image.data[offset + 2] = color[2] ?? 0; image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [state, memory, initial, selected]);
  const [addressText, setAddressText] = useState('');
  const start = Math.min(pageStart, MEMORY_SIZE - 1);
  const rows = useMemo(() => Array.from({ length: Math.min(128, MEMORY_SIZE - start) }, (_, index) => start + index), [start]);
  return <div className="memory-layout"><div className="memory-controls"><label>{t('주소', 'Address')} <input inputMode="numeric" value={addressText} onChange={event => setAddressText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { const address = Number(addressText); if (Number.isInteger(address) && address >= 0 && address < MEMORY_SIZE) { onSelect(address); onPageChange(Math.floor(address / 128) * 128); } } }} placeholder="0–59048" /></label><button type="button" onClick={() => onPageChange(Math.max(0, start - 128))} disabled={start === 0}>‹</button><span>{start}–{Math.min(start + 127, MEMORY_SIZE - 1)}</span><button type="button" onClick={() => onPageChange(Math.min(Math.floor((MEMORY_SIZE - 1) / 128) * 128, start + 128))} disabled={start + 128 >= MEMORY_SIZE}>›</button></div>
    {!overviewComplete && state && <p className="muted">{t('개요를 조회 중입니다. 미조회 셀은 중립색입니다.', 'Loading overview. Unqueried cells are neutral.')}</p>}
    <div className="memory-content"><canvas ref={overview} className="memory-overview" width={243} height={243} role="img" aria-label={t('메모리 개요. 주소 표에서도 탐색할 수 있습니다.', 'Memory overview. The address table also supports navigation.')} onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); const column = Math.min(242, Math.floor((event.clientX - bounds.left) * 243 / bounds.width)); const row = Math.min(242, Math.floor((event.clientY - bounds.top) * 243 / bounds.height)); onSelect(row * 243 + column); onPageChange(Math.floor((row * 243 + column) / 128) * 128); }} /><div className="memory-table-wrap"><table><thead><tr><th>{t('주소', 'Address')}</th><th>Initial</th><th>Runtime</th><th>Δ</th><th>Trits</th><th>F/R/W/E</th></tr></thead><tbody>{rows.map(address => <tr key={address} className={selected === address ? 'selected-row' : ''} onClick={() => onSelect(address)}><th><button type="button" onClick={() => onSelect(address)}>#{address}</button></th><td>{initial[address] ?? '—'}</td><td>{state ? memory[address] ?? '—' : '—'}</td><td>{state && memory[address] !== undefined && initial[address] !== undefined && memory[address] !== initial[address] ? 'changed' : '—'}</td><td>{state && memory[address] !== undefined ? memory[address]?.toString(3).padStart(10, '0') : '—'}</td><td>{roles[address] ? `${roles[address]?.fetch}/${roles[address]?.dataRead}/${roles[address]?.dataWrite}/${roles[address]?.encryption}` : '—'}</td></tr>)}</tbody></table></div></div>
  </div>;
}

export function TimelinePanel({ history, selected, hasMore, loading, busy, onLoadOlder, onSelect, onRewind, t }: { history: readonly JournalEvent[]; selected: number | null; hasMore: boolean; loading: boolean; busy: boolean; onLoadOlder: () => void; onSelect: (eventIndex: number | null) => void; onRewind: (eventIndex: number) => void; t: T }) {
  const visible = history.slice().reverse();
  return <div className="timeline-layout" aria-busy={busy}><div className="timeline-heading"><span>{busy ? t('되돌리는 중', 'Rewinding') : t('불러온 이력', 'Loaded history')} · {history.length}</span>{selected !== null && <div><button type="button" disabled={busy} onClick={() => onSelect(null)}>{t('현재로 돌아가기', 'Back to live')}</button><button type="button" disabled={busy} onClick={() => onRewind(selected)}>{t('이 시점으로 되돌리기', 'Rewind here')}</button></div>}</div>
    <div className="timeline-list">{visible.length ? visible.map(event => <button type="button" disabled={busy} key={event.eventIndex} className={selected === event.eventIndex ? 'is-active' : ''} onClick={() => onSelect(event.eventIndex)}><span>#{event.eventIndex}</span><span>{event.kind}</span><span>step {event.stepAfter}</span>{event.kind === 'instruction' && <span>fetch {event.transaction.fetchAddress} · {event.transaction.opcode}</span>}</button>) : <p className="empty-note">{t('기록된 사건이 없습니다.', 'No recorded events.')}</p>}{hasMore && <button type="button" className="history-more" disabled={loading || busy} onClick={onLoadOlder}>{loading ? t('불러오는 중', 'Loading') : t('이전 사건 200개 불러오기', 'Load 200 earlier events')}</button>}</div>
    {selected !== null && <p className="history-note">{t('선택한 사건 뒤의 보존된 상태를 조회합니다. 실행하려면 현재로 돌아가거나 명시적으로 되돌리세요.', 'Viewing retained state after this event. Return to live or explicitly rewind to execute.')}</p>}
  </div>;
}

export function DiffPanel({ state, memory, initial, complete, onSelect, t }: { state: MachineState | null; memory: MemoryLookup; initial: MemoryLookup; complete: boolean; onSelect: (address: number) => void; t: T }) {
  const changes = useMemo(() => {
    if (!state) return [];
    const addresses: number[] = [];
    for (const key of Object.keys(memory)) { const address = Number(key); if (memory[address] !== undefined && initial[address] !== undefined && memory[address] !== initial[address]) addresses.push(address); }
    return addresses;
  }, [state, memory, initial]);
  return <div className="diff-panel"><div className="diff-heading"><h3>{t('Initial → 선택 시점의 메모리 변화', 'Initial → selected point memory changes')}</h3><span>{changes.length} cells</span></div>
    {!state ? <p className="empty-note">{t('실행 snapshot을 로드하세요.', 'Load a program snapshot.')}</p> : !complete ? <p className="empty-note">{t('선택 시점의 메모리를 조회 중입니다.', 'Loading memory for this point.')}</p> : changes.length === 0 ? <p className="empty-note">{t('이 시점에 값이 달라진 셀이 없습니다.', 'No cells differ at this point.')}</p> : <div className="diff-list"><table><thead><tr><th>{t('주소', 'Address')}</th><th>Initial</th><th>Runtime</th><th>Δ</th></tr></thead><tbody>{changes.slice(0, 1000).map(address => <tr key={address}><th><button type="button" onClick={() => onSelect(address)}>#{address}</button></th><td>{initial[address]}</td><td>{memory[address]}</td><td>{(memory[address] ?? 0) - (initial[address] ?? 0)}</td></tr>)}</tbody></table>{changes.length > 1000 && <p className="muted">{t('첫 1,000개 변화만 표시합니다. Memory에서 전체 주소를 조회하세요.', 'Showing the first 1,000 changes. Use Memory to inspect any address.')}</p>}</div>}
  </div>;
}
