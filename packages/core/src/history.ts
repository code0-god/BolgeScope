import type { JournalEvent, MachineHead, PointView, Transaction, Watchpoint } from './types.js';

export type HistorySource = Readonly<{
  memory: Uint16Array; head: MachineHead; output: readonly number[];
  journal: readonly JournalEvent[]; liveIndex: number; earliestIndex: number;
}>;
export type ReverseTarget = Readonly<{ eventIndex: number; reason: 'BREAKPOINT' | 'WATCHPOINT' | 'HISTORY_BOUNDARY' }>;
export type ReverseSearchCursor = Readonly<{ fromEventIndex: number; nextEventIndex: number }>;
export type ReverseSearchSlice = Readonly<{
  cursor: ReverseSearchCursor;
  scanned: number;
  target: ReverseTarget | null;
  done: boolean;
}>;

export function historicalPoint(source: HistorySource, eventIndex: number, start: number, count: number): Omit<PointView, 'roles'> {
  const memory = source.memory.slice(start, start + count);
  const end = start + count;
  const writeMemory = (address: number, value: number): void => {
    if (address >= start && address < end) memory[address - start] = value;
  };
  let head = source.head;
  const output = source.output.slice(0, head.outputLength);
  if (eventIndex < source.liveIndex) for (let index = source.liveIndex; index > eventIndex; index--) {
    const event = source.journal[index - source.earliestIndex - 1];
    if (!event) throw new RangeError('HISTORY_EXPIRED');
    if (event.kind === 'instruction') {
      for (let writeIndex = event.transaction.writes.length - 1; writeIndex >= 0; writeIndex--) {
        const write = event.transaction.writes[writeIndex];
        if (write) writeMemory(write.address, write.before);
      }
      head = event.transaction.before;
      output.length = head.outputLength;
    } else if (event.kind === 'inputAppend') head = { ...head, tape: { ...head.tape, visibleLength: event.visibleLengthBefore } };
    else if (event.kind === 'inputClose') head = { ...head, tape: { ...head.tape, closed: false } };
    else head = { ...head, terminal: event.terminalBefore };
  }
  if (eventIndex > source.liveIndex) for (let index = source.liveIndex + 1; index <= eventIndex; index++) {
    const event = source.journal[index - source.earliestIndex - 1];
    if (!event) throw new RangeError('HISTORY_EXPIRED');
    if (event.kind === 'instruction') {
      for (const write of event.transaction.writes) writeMemory(write.address, write.after);
      head = event.transaction.after;
      output.push(...event.transaction.output);
    } else if (event.kind === 'inputAppend') head = { ...head, tape: { ...head.tape, visibleLength: event.visibleLengthBefore + event.bytes.length } };
    else if (event.kind === 'inputClose') head = { ...head, tape: { ...head.tape, closed: true } };
    else head = { ...head, terminal: 'FAULTED' };
  }
  return { eventIndex, head: structuredClone(head), memory, output: Uint8Array.from(output) };
}

export function matchesWatchpoint(transaction: Transaction, watchpoints: readonly Watchpoint[]): boolean {
  return watchpoints.some(watchpoint => transaction.reads.some(read => read.role === 'data-read' && watchpoint.address === read.address && watchpoint.roles.includes('data-read')) ||
    transaction.writes.some(write => watchpoint.address === write.address && watchpoint.roles.includes(write.role)));
}

export function reverseTargetSlice(
  journal: readonly JournalEvent[],
  cursor: ReverseSearchCursor,
  earliest: number,
  breakpoints: ReadonlySet<number>,
  watchpoints: readonly Watchpoint[],
  maxEvents = 512,
  maxMilliseconds = 8,
): ReverseSearchSlice {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || !Number.isFinite(maxMilliseconds) || maxMilliseconds < 0) throw new RangeError('Invalid reverse search slice');
  const started = performance.now();
  let index = cursor.nextEventIndex;
  let scanned = 0;
  while (index > earliest && scanned < maxEvents) {
    const event = journal[index - earliest - 1];
    if (!event) throw new RangeError('HISTORY_EXPIRED');
    scanned++;
    const nextEventIndex = index - 1;
    if (event.kind === 'instruction') {
      if (breakpoints.has(event.transaction.fetchAddress)) {
        return { cursor: { ...cursor, nextEventIndex }, scanned, target: { eventIndex: nextEventIndex, reason: 'BREAKPOINT' }, done: true };
      }
      if (index < cursor.fromEventIndex && matchesWatchpoint(event.transaction, watchpoints)) {
        return { cursor: { ...cursor, nextEventIndex }, scanned, target: { eventIndex: index, reason: 'WATCHPOINT' }, done: true };
      }
    }
    index = nextEventIndex;
    if (performance.now() - started >= Math.min(maxMilliseconds, 8)) break;
  }
  const next = { ...cursor, nextEventIndex: index };
  return index === earliest
    ? { cursor: next, scanned, target: { eventIndex: earliest, reason: 'HISTORY_BOUNDARY' }, done: true }
    : { cursor: next, scanned, target: null, done: false };
}

export function reverseTarget(journal: readonly JournalEvent[], from: number, earliest: number, breakpoints: ReadonlySet<number>, watchpoints: readonly Watchpoint[]): ReverseTarget {
  let cursor: ReverseSearchCursor = { fromEventIndex: from, nextEventIndex: from };
  while (true) {
    const slice = reverseTargetSlice(journal, cursor, earliest, breakpoints, watchpoints, Number.MAX_SAFE_INTEGER, 8);
    if (slice.target) return slice.target;
    cursor = slice.cursor;
  }
}
