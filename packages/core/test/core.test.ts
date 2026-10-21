import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeSource, crazy, decode, encode, loadProgram, MalbolgeMachine, PROFILE_DIGEST, rotate } from '../src/index.js';
import { planStep } from '../src/step.js';

const fixture = readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url));
const revisitFixture = readFileSync(new URL('../fixtures/revisit.mb', import.meta.url));

describe('Malbolge core', () => {
  it('pins the exact new profile contract digest', () => {
    const bytes = readFileSync(new URL('../profile-v1.json', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PROFILE_DIGEST);
  });
  it('decodes and encodes every printable address residue', () => {
    for (let address = 0; address < 94; address++) for (let raw = 33; raw <= 126; raw++) {
      const symbol = decode(raw, address);
      if ('i</ *jpov'.replace(' ', '').includes(symbol)) expect(encode(symbol, address)).toBe(raw);
    }
    expect(decode('s'.charCodeAt(0), 2)).toBe('/');
    expect(decode('s'.charCodeAt(0), 19)).toBe('j');
    expect(decode(';'.charCodeAt(0), 3)).toBe('p');
  });

  it('matches an independent trit crazy operation', () => {
    function tritCrazy(x: number, y: number): number {
      const table = [[1, 0, 0], [1, 0, 2], [2, 2, 1]];
      let result = 0;
      let place = 1;
      for (let i = 0; i < 10; i++) {
        result += (table[Math.floor(y / place) % 3]?.[Math.floor(x / place) % 3] ?? 0) * place;
        place *= 3;
      }
      return result;
    }
    for (let x = 0; x < 59049; x += 79) for (let y = 0; y < 59049; y += 83) expect(crazy(x, y)).toBe(tritCrazy(x, y));
    let word = 1;
    for (let i = 0; i < 10; i++) word = rotate(word);
    expect(word).toBe(1);
  });

  it('rejects malformed source without losing the raw bytes', () => {
    const analysis = analyzeSource(Uint8Array.from([0xef, 0xbb, 0xbf, 0, 127]), 'raw');
    expect(analysis.rawSource).toEqual(Uint8Array.from([0xef, 0xbb, 0xbf, 0, 127]));
    expect(analysis.diagnostics.some(diagnostic => diagnostic.code === 'LOAD_INVALID_ENCODING')).toBe(true);
    expect(() => loadProgram('i')).toThrow();
  });

  it('keeps source addresses and UTF-16 spans after invalid characters', () => {
    const logical = new TextDecoder().decode(fixture).replace(/[\t\n\v\f\r ]/g, '');
    const invalid = analyzeSource(`!${logical.slice(1)}`);
    expect(invalid.sourceMap.find(cell => cell.span.utf16Start === 2)).toMatchObject({ address: 2, raw: 115, symbol: '/' });
    const emoji = analyzeSource(`😀${logical}`);
    expect(emoji.diagnostics[0]?.span).toMatchObject({ utf16Start: 0, utf16End: 2, byteEnd: 4 });
    expect(emoji.sourceMap.find(cell => cell.raw === 40)?.span).toMatchObject({ utf16Start: 2, byteStart: 4, column: 3 });
    const korean = analyzeSource(`가${logical}`);
    expect(korean.diagnostics[0]?.span).toMatchObject({ utf16Start: 0, utf16End: 1, byteEnd: 3 });
    expect(korean.sourceMap.find(cell => cell.raw === 40)?.span).toMatchObject({ utf16Start: 1, byteStart: 3, column: 2 });
  });

  it('keeps host-only history and handles a full input tape', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput(new Array(1024 * 1024).fill(65));
    machine.closeInput();
    const before = machine.getState();
    machine.stepBack();
    expect(machine.getState().eventIndex).toBe(before.eventIndex);
    expect(machine.getState().head).toEqual(before.head);
  });

  it('uses the C string terminator for encryption 127 and rolls back 128', () => {
    const memory = new Uint16Array(59049);
    memory[0] = encode('i', 0);
    memory[1] = 2;
    memory[2] = 127;
    const head = { registers: { a: 0, c: 0, d: 1 }, step: 0, terminal: 'NONE' as const,
      tape: { visibleLength: 0, cursor: 0, closed: true, eofReads: 0 }, outputLength: 0 };
    const planned = planStep(memory, head, []);
    expect(planned.kind).toBe('instruction');
    if (planned.kind === 'instruction') expect(planned.transaction.writes.at(-1)).toMatchObject({ role: 'encryption', address: 2, before: 127, after: 0 });
    memory[2] = 128;
    const invalid = planStep(memory, head, []);
    expect(invalid.kind).toBe('fault');
    if (invalid.kind === 'fault') expect(invalid.fault.code).toBe('REFERENCE_UNDEFINED');
  });

  it('runs the 87-cell reference fixture and reverses Halt', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([0x41, 0x42, 0x43, 0x0a]);
    machine.closeInput();
    const writes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const state = machine.step();
      for (const write of state.lastTransaction?.writes ?? []) if (write.role === 'data-write' && write.address === 78) writes.push(write.after);
      if (state.phase === 'HALTED' || state.phase === 'FAULTED') break;
    }
    const state = machine.getState();
    expect(state.phase).toBe('HALTED');
    expect(state.head.step).toBe(24);
    expect(state.head.registers).toEqual({ a: 29514, c: 23, d: 80 });
    expect(machine.getOutput()).toEqual(Uint8Array.of(0x4a));
    expect(machine.getMemory(78, 1)[0]).toBe(29514);
    expect(writes).toEqual([29487, 29485, 29484, 29514]);
    machine.stepBack();
    expect(machine.getState().head.terminal).toBe('NONE');
    expect(machine.step().phase).toBe('HALTED');
  });

  it('observes a separately C-verified generated-memory revisit', () => {
    const machine = new MalbolgeMachine(loadProgram(revisitFixture));
    machine.appendInput([65, 66, 67, 10]);
    machine.closeInput();
    const visits = new Map<number, string[]>();
    for (let i = 0; i < 100; i++) {
      const state = machine.step();
      const tx = state.lastTransaction;
      if (tx && tx.fetchAddress >= 99 && tx.fetchAddress <= 101) {
        const values = visits.get(tx.fetchAddress) ?? [];
        values.push(tx.decodedSymbol);
        visits.set(tx.fetchAddress, values);
      }
      if (state.phase === 'HALTED' || state.phase === 'FAULTED') break;
    }
    expect(machine.getState().head.step).toBe(27);
    expect(machine.getState().head.registers).toEqual({ a: 29550, c: 62, d: 86 });
    expect(machine.getOutput()).toEqual(Uint8Array.from([0xd2, 0x41, 0x41, 0x42, 0x7c]));
    expect(visits.get(99)).toEqual(['o', 'C']);
    expect(visits.get(100)).toEqual(['*', 'x']);
    expect(visits.get(101)).toEqual(['<', 'n']);
  });

  it('queries a historical point without moving live and rewinds explicitly', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([65, 66, 67, 10]);
    machine.closeInput();
    for (let i = 0; i < 4; i++) machine.step();
    const live = machine.getState();
    const first = machine.getHistory().find(event => event.kind === 'instruction');
    expect(first).toBeDefined();
    if (!first) return;
    const historical = machine.queryPoint(first.eventIndex, 78, 1);
    expect(historical.head.step).toBe(1);
    expect(machine.getState()).toEqual(live);
    machine.rewindTo(first.eventIndex);
    expect(machine.getState().head).toEqual(historical.head);
    expect(machine.getMemory(78, 1)).toEqual(historical.memory);
    machine.rewindTo(live.eventIndex);
    expect(machine.getState().head).toEqual(live.head);
  });

  it('stops watchpoints after an atomic write and pauses before output overflow', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([65, 66, 67, 10]);
    machine.closeInput();
    machine.setWatchpoints([{ address: 78, roles: ['data-write'] }]);
    let state = machine.run(100);
    expect(state.reason).toBe('WATCHPOINT');
    expect(state.lastTransaction?.writes.some(write => write.role === 'data-write' && write.address === 78)).toBe(true);
    machine.setWatchpoints([]);
    machine.setOutputLimit(0);
    state = machine.run(100);
    expect(state.reason).toBe('OUTPUT_LIMIT');
    expect(machine.getOutput()).toEqual(new Uint8Array());
    const before = state.head.step;
    machine.setOutputLimit(1);
    state = machine.run(100);
    expect(state.head.step).toBeGreaterThan(before);
    expect(machine.getOutput()).toEqual(Uint8Array.of(0x4a));
  });
  it('branches from a rewound point only after an export receipt', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([65, 66]);
    machine.closeInput();
    machine.step();
    machine.rewindTo(2);
    const parent = machine.getState();
    expect(() => machine.createBranch([74], true, '')).toThrow();
    expect(machine.getState()).toEqual(parent);
    const branch = machine.createBranch([74], true, 'saved-trace-receipt');
    expect(branch.branchId).not.toBe(parent.branchId);
    expect(branch.eventIndex).toBe(0);
    expect(branch.head.step).toBe(parent.head.step);
    expect(branch.head.tape.visibleLength).toBe(1);
    expect(branch.head.tape.closed).toBe(true);
  });
  it('reverse-continues to the previous address breakpoint', () => {
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([65]);
    for (let i = 0; i < 4; i++) machine.step();
    machine.setBreakpoints([3]);
    const state = machine.reverseContinue();
    expect(state.reason).toBe('BREAKPOINT');
    expect(state.head.registers.c).toBe(3);
    expect(state.head.step).toBe(3);
  });
  it('evicts the oldest history by exact UTF-8 JSON size', () => {
    const program = loadProgram(fixture);
    const runToHalt = (machine: MalbolgeMachine): MalbolgeMachine => {
      machine.appendInput([0x41, 0x42, 0x43, 0x0a]);
      machine.closeInput();
      machine.run();
      return machine;
    };
    const events = runToHalt(new MalbolgeMachine(program)).getHistory();
    const kept = events.slice(-10);
    const limit = kept.reduce((total, event) => total + new TextEncoder().encode(JSON.stringify(event)).length, 0);
    const bounded = runToHalt(new MalbolgeMachine(program, limit));
    expect(bounded.getHistory()).toEqual(kept);
    expect(bounded.getState().earliestEventIndex).toBe(events.at(-11)?.eventIndex);
  });
});
