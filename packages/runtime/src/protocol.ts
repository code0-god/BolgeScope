import type { JournalEvent, MachineHead, MachineState, PointView, RoleCounterPage, SourceKind, Watchpoint } from '@bolgescope/core';
import type { ProjectFile } from '@bolgescope/contracts';

export type MemoryRange = Readonly<{ start: number; count: number }>;
export type ViewQuery = Readonly<{
  eventIndex?: number; memoryRanges: readonly MemoryRange[]; selectedAddress?: number;
  historyBeforeEventIndex?: number; historyLimit?: number;
  includeOverview?: boolean; includeInitialOverview?: boolean;
}>;
export type ViewPage = Readonly<{ start: number; current: Uint16Array; initial: Uint16Array; roles: RoleCounterPage }>;
export type ViewBundle = Readonly<{
  sessionId: string; branchId: string; stateVersion: number; pointEventIndex: number;
  liveState: MachineState; point: Readonly<{ eventIndex: number; head: MachineHead; output: Uint8Array }> | null;
  pages: readonly ViewPage[]; history: readonly JournalEvent[];
  overview: Uint16Array | null; initialOverview: Uint16Array | null;
  snapshotSourceLength: number;
}>;

export type Command =
  | Readonly<{ command: 'load'; payload: { source: string | Uint8Array; kind: SourceKind; run?: ProjectFile['run'] } }>
  | Readonly<{ command: 'run'; payload: { budget?: number } }>
  | Readonly<{ command: 'step' | 'pause' | 'stepBack' | 'reverseContinue' | 'restart' | 'stop' | 'closeInput' | 'getState' | 'getHistory' | 'getOutput'; payload: Record<string, never> }>
  | Readonly<{ command: 'appendInput'; payload: { bytes: readonly number[] } }>
  | Readonly<{ command: 'setBreakpoints'; payload: { addresses: readonly number[] } }>
  | Readonly<{ command: 'setWatchpoints'; payload: { watchpoints: readonly Watchpoint[] } }>
  | Readonly<{ command: 'setOutputLimit'; payload: { bytes: number } }>
  | Readonly<{ command: 'queryMemory' | 'queryInitialMemory'; payload: { start: number; count: number } }>
  | Readonly<{ command: 'queryPoint'; payload: { eventIndex: number; start: number; count: number } }>
  | Readonly<{ command: 'queryView'; payload: ViewQuery }>
  | Readonly<{ command: 'rewindTo'; payload: { eventIndex: number } }>
  | Readonly<{ command: 'createBranch'; payload: { bytes: readonly number[]; closed: boolean; exportReceipt: string } }>
  | Readonly<{ command: 'beginTraceExport'; payload: { includeSource: boolean; includeInput: boolean } }>
  | Readonly<{ command: 'ackTraceExport'; payload: { exportId: string; chunkIndex: number } }>
  | Readonly<{ command: 'cancelTraceExport'; payload: { exportId: string } }>;
export type Request = Readonly<{ protocolVersion: 1; clientEpoch: number; requestId: string; requestSequence: number; sessionId?: string; branchId?: string; command: Command['command']; payload: unknown }>;
export type Response = Readonly<{
  protocolVersion: 1;
  clientEpoch: number;
  committedEpoch: number;
  requestId: string;
  sessionId: string | null;
  result: { ok: true; value: RuntimeValue } | { ok: false; code: string; message: string };
}>;
export type TraceChunk = Readonly<{ exportId: string; chunkIndex: number; bytes: Uint8Array; done: boolean; totalBytes: number; digest: string }>;
export type RuntimeValue = MachineState | PointView | ViewBundle | TraceChunk | readonly JournalEvent[] | Uint8Array | Uint16Array;
export type StateEvent = Readonly<{ protocolVersion: 1; clientEpoch: number; sessionId: string; type: 'state'; summary: MachineState }>;
export type WorkerMessage = Response | StateEvent;
