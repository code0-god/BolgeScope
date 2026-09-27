export type Registers = Readonly<{ a: number; c: number; d: number }>;
export type TapeState = Readonly<{ visibleLength: number; cursor: number; closed: boolean; eofReads: number }>;
export type MachineHead = Readonly<{ registers: Registers; step: number; terminal: 'NONE' | 'HALTED' | 'FAULTED'; tape: TapeState; outputLength: number }>;
export type ReadEvent = Readonly<{ order: number; role: 'fetch' | 'data-read'; address: number; value: number }>;
export type WriteEvent = Readonly<{ order: number; role: 'data-write' | 'encryption'; address: number; before: number; after: number }>;
export type Opcode = 'j' | 'i' | '*' | 'p' | '<' | '/' | 'v' | 'o' | 'unnamed-nop';
export type Transaction = Readonly<{
  before: MachineHead; after: MachineHead; fetchAddress: number; fetchedRaw: number;
  decodedSymbol: string; opcode: Opcode; reads: readonly ReadEvent[];
  writes: readonly WriteEvent[]; input: null | Readonly<{ kind: 'byte'; value: number }> | Readonly<{ kind: 'eof' }>;
  output: readonly number[];
}>;
export type Fault = Readonly<{ code: 'STALLED_INVALID_FETCH' | 'REFERENCE_UNDEFINED'; stage: 'fetch' | 'operation' | 'encryption'; address: number; value: number }>;
export type JournalEvent = Readonly<{ eventIndex: number; stepAfter: number; kind: 'instruction'; transaction: Transaction }> |
  Readonly<{ eventIndex: number; stepAfter: number; kind: 'inputAppend'; bytes: readonly number[]; visibleLengthBefore: number }> |
  Readonly<{ eventIndex: number; stepAfter: number; kind: 'inputClose'; closedBefore: false }> |
  Readonly<{ eventIndex: number; stepAfter: number; kind: 'fault'; fault: Fault; terminalBefore: MachineHead['terminal'] }>;
export type Phase = 'READY' | 'RUNNING' | 'PAUSED' | 'WAITING_INPUT' | 'HALTED' | 'FAULTED';
export type StopReason = 'NONE' | 'STEP_COMPLETE' | 'INPUT_EMPTY' | 'HALT_OPCODE' | 'BUDGET' | 'HISTORY_BOUNDARY' | 'REWOUND' | 'STALLED_INVALID_FETCH' | 'REFERENCE_UNDEFINED' | 'REPLAY_DIVERGED' | 'OUTPUT_LIMIT' | 'RESOURCE_LIMIT' | 'BREAKPOINT' | 'WATCHPOINT';
export type Watchpoint = Readonly<{ address: number; roles: readonly ('data-read' | 'data-write' | 'encryption')[] }>;
export type RoleCounts = Readonly<{ fetch: number; dataRead: number; dataWrite: number; encryption: number }>;
export type RoleCounterPage = Readonly<{ fetch: Float64Array; dataRead: Float64Array; dataWrite: Float64Array; encryption: Float64Array }>;
export type MachineState = Readonly<{
  branchId: string; phase: Phase; reason: StopReason; head: MachineHead; eventIndex: number;
  tailEventIndex: number; earliestEventIndex: number; stateVersion: number;
  parentBranch: Readonly<{ branchId: string; eventIndex: number }> | null;
  output: readonly number[]; lastTransaction: Transaction | null;
}>;
export type PointView = Readonly<{ eventIndex: number; head: MachineHead; memory: Uint16Array; roles: RoleCounterPage; output: Uint8Array }>;
