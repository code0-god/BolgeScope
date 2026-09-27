import { loadProgram, MalbolgeMachine } from '@bolgescope/core';
import type { JournalEvent, MachineState } from '@bolgescope/core';
import type { TestCase } from './schema.js';

export type TestResult = Readonly<{
  testId: string;
  status: 'PASSED' | 'FAILED' | 'CANCELLED';
  failures: readonly string[];
  state: MachineState | null;
}>;

function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function logicalDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return toHex(new Uint8Array(digest)).toLowerCase();
}

function compareExpected(test: TestCase, machine: MalbolgeMachine, state: MachineState): string[] {
  const failures: string[] = [];
  const expected = test.expected;
  if (expected.outputHex !== undefined && toHex(machine.getOutput()) !== expected.outputHex.toUpperCase()) failures.push(`output: ${toHex(machine.getOutput())} ≠ ${expected.outputHex.toUpperCase()}`);
  if (expected.terminal !== undefined && state.head.terminal !== expected.terminal) failures.push(`terminal: ${state.head.terminal} ≠ ${expected.terminal}`);
  if (expected.stopReason !== undefined && state.reason !== expected.stopReason) failures.push(`reason: ${state.reason} ≠ ${expected.stopReason}`);
  if (expected.step !== undefined && state.head.step !== expected.step) failures.push(`step: ${state.head.step} ≠ ${expected.step}`);
  for (const key of ['a', 'c', 'd'] as const) {
    const value = expected.registers?.[key];
    if (value !== undefined && state.head.registers[key] !== value) failures.push(`${key}: ${state.head.registers[key]} ≠ ${value}`);
  }
  for (const item of expected.memory ?? []) {
    const value = machine.getMemory(item.address, 1)[0];
    if (value !== item.value) failures.push(`M[${item.address}]: ${value} ≠ ${item.value}`);
  }
  if (expected.dataWriteValues?.length) {
    if (state.earliestEventIndex > 0) failures.push('data-write history was evicted');
    else {
      const history: readonly JournalEvent[] = machine.getHistory();
      for (const item of expected.dataWriteValues) {
        const actual = history.flatMap(event => event.kind === 'instruction' ? event.transaction.writes.filter(write => write.role === 'data-write' && write.address === item.address).map(write => write.after) : []);
        if (JSON.stringify(actual) !== JSON.stringify(item.values)) failures.push(`M[${item.address}] data writes: ${actual.join(',')} ≠ ${item.values.join(',')}`);
      }
    }
  }
  return failures;
}

export async function executeTestCase(test: TestCase, sourceBytes: Uint8Array, signal?: AbortSignal): Promise<TestResult> {
  const program = loadProgram(sourceBytes, test.source.kind);
  if (test.source.logicalDigest && await logicalDigest(program.analysis.logicalSource) !== test.source.logicalDigest) {
    return { testId: test.testId, status: 'FAILED', failures: ['logical source digest mismatch'], state: null };
  }
  const machine = new MalbolgeMachine(program);
  const input = Uint8Array.from(test.inputHex.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? []);
  if (input.length) machine.appendInput(Array.from(input));
  if (test.closeInput) machine.closeInput();
  while (machine.getState().head.step < test.maxInstructions) {
    if (signal?.aborted) return { testId: test.testId, status: 'CANCELLED', failures: [], state: machine.getState() };
    const before = machine.getState().head.step;
    const state = machine.run(Math.min(4096, test.maxInstructions - before));
    if (state.phase === 'HALTED' || state.phase === 'FAULTED' || state.phase === 'WAITING_INPUT' || state.head.step === before) break;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const state = machine.getState();
  const failures = compareExpected(test, machine, state);
  return { testId: test.testId, status: failures.length ? 'FAILED' : 'PASSED', failures, state };
}
