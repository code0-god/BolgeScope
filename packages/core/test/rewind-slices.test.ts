import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProgram, MalbolgeMachine } from '../src/index';
import { planStep } from '../src/step';

const fixture = readFileSync(
  new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url),
);
const orderedSameCellFixture = "DCBA@?>=<;:9876543210/.-,+*)('&%$#c.";

function moveOneEventAtATime(machine: MalbolgeMachine, target: number): void {
  let done = false;
  while (!done) {
    const slice = machine.rewindSlice(target, 1, 8);
    expect(slice.moved).toBe(1);
    done = slice.done;
  }
}

describe('sliced journal restoration', () => {
  it('crosses input and Halt boundaries with exact undo and redo state', () => {
    // Given a completed real fixture with input append, close, output, and Halt.
    const machine = new MalbolgeMachine(loadProgram(fixture));
    machine.appendInput([0x41, 0x42, 0x43, 0x0a]);
    machine.closeInput();
    machine.run();
    const final = machine.getState();
    const finalMemory = machine.getMemory();
    const finalRoles = machine.getRolePage(0, 59049);

    // When every undo and redo slice is limited to one journal event.
    moveOneEventAtATime(machine, 0);
    const initial = machine.getState();
    expect(initial.eventIndex).toBe(0);
    expect(initial.head).toMatchObject({
      registers: { a: 0, c: 0, d: 0 },
      step: 0,
      terminal: 'NONE',
      tape: { visibleLength: 0, cursor: 0, closed: false, eofReads: 0 },
      outputLength: 0,
    });
    expect(machine.getMemory(78, 1)[0]).toBe(84);
    expect(machine.getOutput()).toEqual(new Uint8Array());
    moveOneEventAtATime(machine, final.eventIndex);

    // Then full machine state, memory, output, and observations return exactly.
    expect(machine.getState().head).toEqual(final.head);
    expect(machine.getMemory()).toEqual(finalMemory);
    expect(machine.getOutput()).toEqual(Uint8Array.of(0x4a));
    expect(machine.getRolePage(0, 59049)).toEqual(finalRoles);
  });

  it('keeps ordered writes atomic when one event is sliced backward and forward', () => {
    // Given a C-verified event with two ordered writes to address 34.
    const machine = new MalbolgeMachine(loadProgram(orderedSameCellFixture));
    machine.setWatchpoints([{ address: 34, roles: ['data-write'] }]);
    const stopped = machine.run();
    expect(stopped.lastTransaction?.writes.map(write => [write.before, write.after])).toEqual([
      [99, 33],
      [33, 53],
    ]);
    expect(machine.getMemory(34, 1)[0]).toBe(53);

    // When exactly that complete event is undone and redone as separate slices.
    const beforeEvent = stopped.eventIndex - 1;
    moveOneEventAtATime(machine, beforeEvent);
    expect(machine.getMemory(34, 1)[0]).toBe(99);
    moveOneEventAtATime(machine, stopped.eventIndex);

    // Then no partial write value escapes an event boundary.
    expect(machine.getMemory(34, 1)[0]).toBe(53);
    expect(machine.getState().lastTransaction?.writes.map(write => [write.before, write.after])).toEqual([
      [99, 33],
      [33, 53],
    ]);
  });

  it('preserves reverse write order when rotate and encryption share C and D', () => {
    // Given C=D=16 and M[16]=117, the controlled rotate boundary from review.
    const memory = new Uint16Array(59049);
    memory[16] = 117;
    const head = {
      registers: { a: 0, c: 16, d: 16 },
      step: 0,
      terminal: 'NONE' as const,
      tape: { visibleLength: 0, cursor: 0, closed: false, eofReads: 0 },
      outputLength: 0,
    };

    // When one instruction is planned and its ordered writes are applied.
    const planned = planStep(memory, head, []);
    expect(planned.kind).toBe('instruction');
    if (planned.kind !== 'instruction') return;
    expect(planned.transaction.writes.map(write => [write.before, write.after])).toEqual([
      [117, 39],
      [39, 116],
    ]);
    for (const write of planned.transaction.writes) memory[write.address] = write.after;
    expect(memory[16]).toBe(116);

    // Then reverse application restores the original value, not the intermediate one.
    for (let index = planned.transaction.writes.length - 1; index >= 0; index--) {
      const write = planned.transaction.writes[index];
      if (write) memory[write.address] = write.before;
    }
    expect(memory[16]).toBe(117);
  });
});
