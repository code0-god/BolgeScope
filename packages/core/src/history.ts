import type { JournalEvent, MachineHead, PointView, Transaction, Watchpoint } from './types.js';

export type HistorySource = Readonly<{
  memory: Uint16Array; head: MachineHead; output: readonly number[];
  journal: readonly JournalEvent[]; liveIndex: number; earliestIndex: number;
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

export function reverseTarget(journal: readonly JournalEvent[], from: number, earliest: number, breakpoints: ReadonlySet<number>, watchpoints: readonly Watchpoint[]): { eventIndex: number; reason: 'BREAKPOINT' | 'WATCHPOINT' | 'HISTORY_BOUNDARY' } {
  for (let index = from; index > earliest; index--) {
    const event = journal[index - earliest - 1];
    if (event?.kind !== 'instruction') continue;
    if (breakpoints.has(event.transaction.fetchAddress)) return { eventIndex: index - 1, reason: 'BREAKPOINT' };
    if (index < from && matchesWatchpoint(event.transaction, watchpoints)) return { eventIndex: index, reason: 'WATCHPOINT' };
  }
  return { eventIndex: earliest, reason: 'HISTORY_BOUNDARY' };
}
