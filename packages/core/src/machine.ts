import { MEMORY_SIZE } from './codec.js';
import { ObservationCounters } from './counters.js';
import { historicalPoint, matchesWatchpoint, reverseTarget } from './history.js';
import { appendJournal, canRecord } from './journal.js';
import type { JournalDraft } from './journal.js';
import { planStep } from './step.js';
import type { Program } from './source.js';
import type { JournalEvent, MachineHead, MachineState, Phase, PointView, RoleCounterPage, RoleCounts, StopReason, Transaction, Watchpoint } from './types.js';

export class MalbolgeMachine {
  private readonly initial: Uint16Array;
  private readonly memory: Uint16Array;
  private readonly input: number[] = [];
  private readonly output: number[] = [];
  private readonly journal: JournalEvent[] = [];
  private head: MachineHead = { registers: { a: 0, c: 0, d: 0 }, step: 0, terminal: 'NONE', tape: { visibleLength: 0, cursor: 0, closed: false, eofReads: 0 }, outputLength: 0 };
  private phase: Phase = 'READY';
  private reason: StopReason = 'NONE';
  private eventIndex = 0;
  private earliestEventIndex = 0;
  private stateVersion = 0;
  private branchId = crypto.randomUUID();
  private parentBranch: MachineState['parentBranch'] = null;
  private readonly observations = new ObservationCounters();
  private lastTransaction: Transaction | null = null;
  private readonly breakpoints = new Set<number>();
  private watchpoints: readonly Watchpoint[] = [];
  private breakpointBypass: number | null = null;
  private readonly historyBytesLimit: number;
  private historyBytes = 0;
  private outputLimit = 1_048_576;

  constructor(program: Program, historyBytesLimit = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(historyBytesLimit) || historyBytesLimit < 1) throw new RangeError('Invalid history budget');
    this.initial = program.initialMemory.slice();
    this.memory = this.initial.slice();
    this.historyBytesLimit = historyBytesLimit;
  }

  getState(): MachineState {
    return { branchId: this.branchId, parentBranch: this.parentBranch, phase: this.phase, reason: this.reason, head: structuredClone(this.head), eventIndex: this.eventIndex,
      tailEventIndex: this.earliestEventIndex + this.journal.length, earliestEventIndex: this.earliestEventIndex,
      stateVersion: this.stateVersion, output: this.output.slice(0, this.head.outputLength), lastTransaction: this.lastTransaction ? structuredClone(this.lastTransaction) : null };
  }
  getBranchId(): string { return this.branchId; }
  getPhase(): Phase { return this.phase; }
  getMemory(start: number = 0, count: number = MEMORY_SIZE): Uint16Array { this.checkRange(start, count); return this.memory.slice(start, start + count); }
  getInitialMemory(start: number = 0, count: number = MEMORY_SIZE): Uint16Array { this.checkRange(start, count); return this.initial.slice(start, start + count); }
  getOutput(): Uint8Array { return Uint8Array.from(this.output.slice(0, this.head.outputLength)); }
  getHistory(): readonly JournalEvent[] { return structuredClone(this.journal); }
  getHistoryPage(beforeEventIndex: number = this.eventIndex + 1, limit = 200): readonly JournalEvent[] {
    if (!Number.isSafeInteger(beforeEventIndex) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Invalid history page');
    const end = Math.max(0, Math.min(beforeEventIndex - this.earliestEventIndex - 1, this.journal.length));
    return structuredClone(this.journal.slice(Math.max(0, end - limit), end));
  }
  getRoleCounts(address: number): RoleCounts { this.checkRange(address, 1); return this.observations.at(address); }
  getRolePage(start: number, count: number, eventIndex: number = this.eventIndex): RoleCounterPage {
    this.checkRange(start, count); this.checkPoint(eventIndex);
    return this.observations.pageAt(start, count, eventIndex, this.eventIndex, this.earliestEventIndex, this.journal);
  }
  queryPoint(eventIndex: number, start: number = 0, count: number = MEMORY_SIZE): PointView {
    this.checkRange(start, count);
    this.checkPoint(eventIndex);
    const point = historicalPoint({ memory: this.memory, head: this.head, output: this.output, journal: this.journal, liveIndex: this.eventIndex, earliestIndex: this.earliestEventIndex }, eventIndex, start, count);
    return { ...point, roles: this.getRolePage(start, count, eventIndex) };
  }
  rewindTo(eventIndex: number): MachineState {
    this.checkPoint(eventIndex);
    while (this.eventIndex > eventIndex) {
      const event = this.journal[this.eventIndex - this.earliestEventIndex - 1];
      if (!event) throw new RangeError('HISTORY_EXPIRED');
      this.undo(event);
      this.eventIndex--;
    }
    while (this.eventIndex < eventIndex) {
      const event = this.journal[this.eventIndex - this.earliestEventIndex];
      if (!event) throw new RangeError('HISTORY_EXPIRED');
      this.redo(event);
      this.eventIndex++;
    }
    this.phase = this.head.terminal === 'HALTED' ? 'HALTED' : this.head.terminal === 'FAULTED' ? 'FAULTED' : 'PAUSED';
    this.lastTransaction = this.transactionAtCurrentPoint();
    this.reason = 'REWOUND'; this.breakpointBypass = null; this.stateVersion++;
    return this.getState();
  }
  setBreakpoints(addresses: readonly number[]): void {
    for (const address of addresses) this.checkRange(address, 1);
    this.breakpoints.clear();
    for (const address of addresses) this.breakpoints.add(address);
    this.breakpointBypass = null;
  }
  setWatchpoints(watchpoints: readonly Watchpoint[]): void {
    for (const watchpoint of watchpoints) {
      this.checkRange(watchpoint.address, 1);
      if (!watchpoint.roles.length || !watchpoint.roles.every(role => role === 'data-read' || role === 'data-write' || role === 'encryption')) throw new RangeError('Invalid watchpoint role');
    }
    this.watchpoints = structuredClone(watchpoints);
  }
  setOutputLimit(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < this.head.outputLength || bytes > 16 * 1_048_576) throw new RangeError('Invalid output limit');
    this.outputLimit = bytes;
  }
  pause(): MachineState { if (this.head.terminal === 'NONE') { this.phase = 'PAUSED'; this.reason = 'NONE'; this.breakpointBypass = null; this.stateVersion++; } return this.getState(); }
  beginRun(): MachineState {
    if (this.head.terminal === 'NONE') {
      // Capture the stopped breakpoint before the scheduler publishes RUNNING.
      // Keep this one-instruction token across input wait, not across Pause/rewind.
      if (this.reason === 'BREAKPOINT') this.breakpointBypass = this.head.registers.c;
      this.phase = 'RUNNING'; this.reason = 'NONE'; this.stateVersion++;
    }
    return this.getState();
  }

  appendInput(bytes: readonly number[]): MachineState {
    if (this.head.terminal !== 'NONE') throw new Error('Terminal session');
    if (this.eventIndex !== this.earliestEventIndex + this.journal.length) throw new Error('BRANCH_REQUIRED');
    if (this.head.tape.closed) throw new Error('INPUT_CLOSED');
    if (!bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new RangeError('Invalid input byte');
    if (this.head.tape.visibleLength + bytes.length > 1_048_576) throw new RangeError('INPUT_LIMIT');
    if (!bytes.length) return this.getState();
    const before = this.head.tape.visibleLength;
    const draft: JournalDraft = { kind: 'inputAppend', bytes: [...bytes], visibleLengthBefore: before, stepAfter: this.head.step };
    if (!canRecord(draft, this.historyBytesLimit, this.eventIndex)) throw new RangeError('RESOURCE_LIMIT');
    for (const byte of bytes) this.input.push(byte);
    this.head = { ...this.head, tape: { ...this.head.tape, visibleLength: before + bytes.length } };
    this.record(draft);
    return this.getState();
  }
  closeInput(): MachineState {
    if (this.head.terminal !== 'NONE') throw new Error('Terminal session');
    if (this.eventIndex !== this.earliestEventIndex + this.journal.length) throw new Error('BRANCH_REQUIRED');
    if (this.head.tape.closed) return this.getState();
    const draft: JournalDraft = { kind: 'inputClose', closedBefore: false, stepAfter: this.head.step };
    if (!canRecord(draft, this.historyBytesLimit, this.eventIndex)) throw new RangeError('RESOURCE_LIMIT');
    this.head = { ...this.head, tape: { ...this.head.tape, closed: true } };
    this.record(draft);
    return this.getState();
  }

  step(): MachineState {
    this.stepCommit();
    return this.getState();
  }

  private stepCommit(): void {
    if (this.head.terminal !== 'NONE') return;
    // Reaching the cap pauses the whole session until the user raises it.
    if (this.head.outputLength >= this.outputLimit) {
      this.phase = 'PAUSED'; this.reason = 'OUTPUT_LIMIT'; return;
    }
    while (this.eventIndex < this.earliestEventIndex + this.journal.length) {
      const event = this.journal[this.eventIndex - this.earliestEventIndex];
      if (!event) break;
      if (event.kind === 'instruction' || event.kind === 'fault') break;
      this.redoHost(event);
      this.eventIndex = event.eventIndex;
    }
    const planned = planStep(this.memory, this.head, this.input);
    if (planned.kind === 'wait') { this.phase = 'WAITING_INPUT'; this.reason = 'INPUT_EMPTY'; return; }
    const future = this.journal[this.eventIndex - this.earliestEventIndex];
    if (future && (future.kind === 'inputAppend' || future.kind === 'inputClose' || JSON.stringify(future.kind === 'instruction' ? future.transaction : future.fault) !== JSON.stringify(planned.kind === 'instruction' ? planned.transaction : planned.fault))) {
      this.phase = 'PAUSED'; this.reason = 'REPLAY_DIVERGED'; return;
    }
    if (planned.kind === 'fault') {
      if (!future && !canRecord({ kind: 'fault', fault: planned.fault, terminalBefore: 'NONE', stepAfter: this.head.step }, this.historyBytesLimit, this.eventIndex)) { this.phase = 'PAUSED'; this.reason = 'RESOURCE_LIMIT'; return; }
      this.head = { ...this.head, terminal: 'FAULTED' };
      this.phase = 'FAULTED'; this.reason = planned.fault.code;
      if (future) this.eventIndex = future.eventIndex;
      else this.record({ kind: 'fault', fault: planned.fault, terminalBefore: 'NONE', stepAfter: this.head.step });
      this.stateVersion++;
      return;
    }
    if (planned.transaction.after.outputLength > this.outputLimit) { this.phase = 'PAUSED'; this.reason = 'OUTPUT_LIMIT'; return; }
    if (!this.observations.canAdd(planned.transaction) || !future && !canRecord({ kind: 'instruction', transaction: planned.transaction, stepAfter: planned.transaction.after.step }, this.historyBytesLimit, this.eventIndex)) { this.phase = 'PAUSED'; this.reason = 'RESOURCE_LIMIT'; return; }
    for (const write of planned.transaction.writes) this.memory[write.address] = write.after;
    this.observations.apply(planned.transaction, 1);
    this.head = planned.transaction.after;
    this.output.length = this.head.outputLength - planned.transaction.output.length;
    this.output.push(...planned.transaction.output);
    this.lastTransaction = planned.transaction;
    if (future) this.eventIndex = future.eventIndex;
    else this.record({ kind: 'instruction', transaction: planned.transaction, stepAfter: this.head.step });
    this.phase = this.head.terminal === 'HALTED' ? 'HALTED' : 'PAUSED';
    this.reason = this.head.terminal === 'HALTED' ? 'HALT_OPCODE' :
      matchesWatchpoint(planned.transaction, this.watchpoints) ? 'WATCHPOINT' :
      this.head.outputLength === this.outputLimit ? 'OUTPUT_LIMIT' : 'STEP_COMPLETE';
    this.breakpointBypass = null;
    this.stateVersion++;
  }

  run(budget = 1_000_000): MachineState {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError('Invalid budget');
    return this.executeRun(budget, budget, Number.POSITIVE_INFINITY).state;
  }

  runSlice(remaining: number, maxInstructions = 4096, maxMilliseconds = 8): Readonly<{ state: MachineState; executed: number }> {
    if (!Number.isSafeInteger(remaining) || remaining < 1 || !Number.isSafeInteger(maxInstructions) || maxInstructions < 1 || !Number.isFinite(maxMilliseconds) || maxMilliseconds < 0) throw new RangeError('Invalid run slice');
    return this.executeRun(remaining, Math.min(maxInstructions, 4096), Math.min(maxMilliseconds, 8));
  }

  private executeRun(remaining: number, maxInstructions: number, maxMilliseconds: number): Readonly<{ state: MachineState; executed: number }> {
    if (this.head.terminal !== 'NONE') return { state: this.getState(), executed: 0 };
    if (this.reason === 'BREAKPOINT') this.breakpointBypass = this.head.registers.c;
    this.phase = 'RUNNING'; this.reason = 'NONE';
    const started = performance.now();
    let executed = 0;
    while (executed < Math.min(remaining, maxInstructions)) {
      const address = this.head.registers.c;
      if (this.breakpoints.has(address) && this.breakpointBypass !== address) { this.phase = 'PAUSED'; this.reason = 'BREAKPOINT'; break; }
      const before = this.head.step;
      this.stepCommit();
      executed += this.head.step - before;
      if (this.runStopped()) break;
      this.phase = 'RUNNING'; this.reason = 'NONE';
      if (performance.now() - started >= maxMilliseconds) break;
    }
    if (this.phase === 'RUNNING' && executed >= remaining) { this.phase = 'PAUSED'; this.reason = 'BUDGET'; }
    return { state: this.getState(), executed };
  }

  private runStopped(): boolean {
    return this.phase === 'WAITING_INPUT' || this.phase === 'HALTED' || this.phase === 'FAULTED' ||
      this.reason === 'REPLAY_DIVERGED' || this.reason === 'WATCHPOINT' || this.reason === 'OUTPUT_LIMIT' || this.reason === 'RESOURCE_LIMIT';
  }

  stepBack(): MachineState {
    if (!this.journal.some(event => event.eventIndex <= this.eventIndex && event.kind === 'instruction')) {
      this.reason = 'HISTORY_BOUNDARY'; return this.getState();
    }
    let found = false;
    for (let index = this.eventIndex; index > this.earliestEventIndex; index--) {
      const event = this.journal[index - this.earliestEventIndex - 1];
      if (!event) break;
      this.undo(event);
      this.eventIndex = index - 1;
      if (event.kind === 'instruction') { found = true; break; }
    }
    this.phase = this.head.terminal === 'HALTED' ? 'HALTED' : this.head.terminal === 'FAULTED' ? 'FAULTED' : 'PAUSED';
    this.reason = found ? 'REWOUND' : 'HISTORY_BOUNDARY';
    this.lastTransaction = this.transactionAtCurrentPoint();
    this.breakpointBypass = null;
    this.stateVersion++;
    return this.getState();
  }
  reverseContinue(): MachineState {
    const target = reverseTarget(this.journal, this.eventIndex, this.earliestEventIndex, this.breakpoints, this.watchpoints);
    this.rewindTo(target.eventIndex);
    this.reason = target.reason;
    return this.getState();
  }

  createBranch(bytes: readonly number[], closed: boolean, exportReceipt: string): MachineState {
    if (!exportReceipt || this.eventIndex === this.earliestEventIndex + this.journal.length || this.head.terminal !== 'NONE') throw new Error('EXPORT_REQUIRED');
    if (!bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) || this.head.tape.cursor + bytes.length > 1_048_576) throw new RangeError('Invalid branch input');
    const parentPoint = { branchId: this.branchId, eventIndex: this.eventIndex };
    this.input.length = this.head.tape.cursor;
    for (const byte of bytes) this.input.push(byte);
    this.head = { ...this.head, tape: { ...this.head.tape, visibleLength: this.input.length, closed } };
    this.journal.length = 0;
    this.historyBytes = 0;
    this.earliestEventIndex = 0;
    this.eventIndex = 0;
    this.parentBranch = parentPoint;
    this.branchId = crypto.randomUUID();
    this.breakpointBypass = null;
    this.phase = 'PAUSED'; this.reason = 'REWOUND'; this.lastTransaction = null; this.stateVersion++;
    return this.getState();
  }

  private transactionAtCurrentPoint(): Transaction | null {
    for (let index = this.journal.length - 1; index >= 0; index--) {
      const event = this.journal[index];
      if (event && event.eventIndex <= this.eventIndex && event.kind === 'instruction') return event.transaction;
    }
    return null;
  }

  private redoHost(event: JournalEvent): void {
    if (event.kind === 'inputAppend') {
      this.head = { ...this.head, tape: { ...this.head.tape, visibleLength: event.visibleLengthBefore + event.bytes.length } };
    } else if (event.kind === 'inputClose') this.head = { ...this.head, tape: { ...this.head.tape, closed: true } };
  }
  private redo(event: JournalEvent): void {
    if (event.kind === 'instruction') {
      for (const write of event.transaction.writes) this.memory[write.address] = write.after;
      this.observations.apply(event.transaction, 1);
      this.head = event.transaction.after;
      this.output.push(...event.transaction.output);
      this.lastTransaction = event.transaction;
    } else if (event.kind === 'fault') this.head = { ...this.head, terminal: 'FAULTED' };
    else this.redoHost(event);
  }
  private undo(event: JournalEvent): void {
    switch (event.kind) {
      case 'instruction':
        for (let index = event.transaction.writes.length - 1; index >= 0; index--) {
          const write = event.transaction.writes[index];
          if (write) this.memory[write.address] = write.before;
        }
        this.head = event.transaction.before;
        this.observations.apply(event.transaction, -1);
        this.output.length = this.head.outputLength;
        break;
      case 'inputAppend': this.head = { ...this.head, tape: { ...this.head.tape, visibleLength: event.visibleLengthBefore } }; break;
      case 'inputClose': this.head = { ...this.head, tape: { ...this.head.tape, closed: false } }; break;
      case 'fault': this.head = { ...this.head, terminal: event.terminalBefore }; break;
    }
  }
  private record(event: JournalDraft): void {
    const cursor = appendJournal(this.journal, event, { eventIndex: this.eventIndex, earliestEventIndex: this.earliestEventIndex, historyBytes: this.historyBytes }, this.historyBytesLimit);
    this.eventIndex = cursor.eventIndex;
    this.earliestEventIndex = cursor.earliestEventIndex;
    this.historyBytes = cursor.historyBytes;
    this.stateVersion++;
  }
  private checkRange(start: number, count: number): void {
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > MEMORY_SIZE) throw new RangeError('Invalid memory range');
  }
  private checkPoint(eventIndex: number): void {
    if (!Number.isInteger(eventIndex) || eventIndex < this.earliestEventIndex || eventIndex > this.earliestEventIndex + this.journal.length) throw new RangeError('HISTORY_EXPIRED');
  }
}
