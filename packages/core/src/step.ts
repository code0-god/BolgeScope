import { crazy, decode, encrypt, EOF_WORD, MEMORY_SIZE, nextAddress, rotate } from './codec.js';
import type { Fault, MachineHead, Opcode, ReadEvent, Transaction, WriteEvent } from './types.js';

export type PlannedStep = Readonly<{ kind: 'instruction'; transaction: Transaction }> |
  Readonly<{ kind: 'wait' }> | Readonly<{ kind: 'fault'; fault: Fault }>;

export function planStep(memory: Uint16Array, head: MachineHead, input: readonly number[]): PlannedStep {
  const { a, c, d } = head.registers;
  const fetched = memory[c] ?? 0;
  if (fetched < 33 || fetched > 126) return { kind: 'fault', fault: { code: 'STALLED_INVALID_FETCH', stage: 'fetch', address: c, value: fetched } };
  const symbol = decode(fetched, c);
  const opcode: Opcode = symbol === 'i' || symbol === 'j' || symbol === '*' || symbol === 'p' || symbol === '<' || symbol === '/' || symbol === 'v' || symbol === 'o' ? symbol : 'unnamed-nop';
  if (opcode === '/' && head.tape.cursor >= head.tape.visibleLength && !head.tape.closed) return { kind: 'wait' };
  let nextA = a;
  let nextC = c;
  let nextD = d;
  let nextCursor = head.tape.cursor;
  let eofReads = head.tape.eofReads;
  let order = 0;
  const reads: ReadEvent[] = [{ order: order++, role: 'fetch', address: c, value: fetched }];
  const writes: WriteEvent[] = [];
  const output: number[] = [];
  let consumed: Transaction['input'] = null;
  const readData = (): number => {
    const value = writes.findLast(write => write.address === nextD)?.after ?? memory[nextD] ?? 0;
    reads.push({ order: order++, role: 'data-read', address: nextD, value });
    return value;
  };
  const writeData = (value: number): void => {
    writes.push({ order: order++, role: 'data-write', address: nextD, before: writes.findLast(write => write.address === nextD)?.after ?? memory[nextD] ?? 0, after: value });
  };
  switch (opcode) {
    case 'j': nextD = readData(); break;
    case 'i': nextC = readData(); break;
    case '*': nextA = rotate(readData()); writeData(nextA); break;
    case 'p': nextA = crazy(a, readData()); writeData(nextA); break;
    case '<': output.push(a & 255); break;
    case '/': {
      const value = nextCursor < head.tape.visibleLength ? input[nextCursor] : undefined;
      if (value === undefined) { nextA = EOF_WORD; eofReads++; consumed = { kind: 'eof' }; }
      else { nextA = value; nextCursor++; consumed = { kind: 'byte', value }; }
      break;
    }
    case 'v': case 'o': case 'unnamed-nop': break;
  }
  if (nextC < 0 || nextC >= MEMORY_SIZE || nextD < 0 || nextD >= MEMORY_SIZE) return { kind: 'fault', fault: { code: 'REFERENCE_UNDEFINED', stage: 'operation', address: nextC < 0 || nextC >= MEMORY_SIZE ? nextC : nextD, value: nextC < 0 || nextC >= MEMORY_SIZE ? nextC : nextD } };
  if (opcode !== 'v') {
    const current = writes.findLast(write => write.address === nextC)?.after ?? memory[nextC] ?? 0;
    const encrypted = encrypt(current);
    if (encrypted === null) return { kind: 'fault', fault: { code: 'REFERENCE_UNDEFINED', stage: 'encryption', address: nextC, value: current } };
    writes.push({ order: order++, role: 'encryption', address: nextC, before: current, after: encrypted });
    nextC = nextAddress(nextC);
    nextD = nextAddress(nextD);
  }
  const after: MachineHead = {
    registers: { a: nextA, c: nextC, d: nextD }, step: head.step + 1,
    terminal: opcode === 'v' ? 'HALTED' : 'NONE',
    tape: { visibleLength: head.tape.visibleLength, cursor: nextCursor, closed: head.tape.closed, eofReads },
    outputLength: head.outputLength + output.length,
  };
  return { kind: 'instruction', transaction: { before: head, after, fetchAddress: c, fetchedRaw: fetched, decodedSymbol: symbol, opcode, reads, writes, input: consumed, output } };
}
