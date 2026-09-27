import { LoadError, loadProgram, MalbolgeMachine } from '@bolgescope/core';
import type { MachineState, Program, ReverseSearchCursor, SourceKind, StopReason } from '@bolgescope/core';
import type { MemoryRange, Request, Response, RuntimeValue, StateEvent, ViewBundle, ViewPage } from './protocol.js';
import { buildTrace } from './trace.js';

const scope = self as DedicatedWorkerGlobalScope;
let machine: MalbolgeMachine | null = null;
let program: Program | null = null;
let sessionId: string | null = null;
let epoch = 0;
let lastSequence = 0;
let runRemaining = 0;
let intent: 'NONE' | 'STEP' | 'RUN' = 'NONE';
let scheduled = false;
let lastContinuousEmit = 0;
const responses = new Map<string, { fingerprint: string; response: Response }>();
const processing = new Map<string, { fingerprint: string; response: Promise<Response> }>();
let trace: { exportId: string; bytes: Uint8Array; digest: string; nextIndex: number } | null = null;
let exporting = false;
let exportGeneration = 0;
const lifecycleCommands = new Set<Request['command']>(['load', 'restart', 'stop']);
type HistoryJob = {
  readonly generation: number;
  readonly owner: MalbolgeMachine;
  readonly sessionId: string;
  kind: 'search' | 'restore';
  cursor: ReverseSearchCursor | null;
  target: number | null;
  reason: StopReason;
  lastEmit: number;
  emittedProgress: boolean;
  readonly resolve: (state: MachineState) => void;
  readonly reject: (error: Error) => void;
};
let historyGeneration = 0;
let historyJob: HistoryJob | null = null;

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function fail(code: string, message: string): never { throw new WorkerRequestError(code, message); }
class WorkerRequestError extends Error { constructor(readonly code: string, message: string) { super(message); } }
function requireMachine(request: Request): MalbolgeMachine {
  if (!machine || request.sessionId !== sessionId) return fail('SESSION_MISMATCH', 'No matching active session');
  if (request.branchId !== undefined && request.branchId !== machine.getBranchId()) return fail('SESSION_MISMATCH', 'Wrong branch');
  return machine;
}
function emit(state: MachineState): void {
  if (!sessionId) return;
  const event: StateEvent = { protocolVersion: 1, clientEpoch: epoch, sessionId, type: 'state', summary: state };
  scope.postMessage(event);
}
function schedule(): void { if (!scheduled) { scheduled = true; setTimeout(tick, 0); } }
function tick(): void {
  scheduled = false;
  if (!machine || intent !== 'RUN') return;
  const result = machine.runSlice(runRemaining);
  runRemaining -= result.executed;
  if (result.state.phase === 'RUNNING') {
    const now = performance.now();
    if (now - lastContinuousEmit >= 50) { emit(result.state); lastContinuousEmit = now; }
    schedule();
  } else {
    emit(result.state);
    if (result.state.phase !== 'WAITING_INPUT') { intent = 'NONE'; runRemaining = 0; }
  }
}
function scheduleHistory(): void {
  const generation = historyJob?.generation;
  if (generation === undefined) return;
  setTimeout(() => historyTick(generation), 0);
}
function finishHistory(job: HistoryJob, state: MachineState): void {
  if (historyJob !== job) return;
  historyJob = null;
  job.resolve(state);
}
function cancelHistory(error?: Error, state?: MachineState): void {
  const job = historyJob;
  if (!job) return;
  historyJob = null;
  historyGeneration++;
  if (error) job.reject(error);
  else if (state) job.resolve(state);
}
function historyTick(generation: number): void {
  const job = historyJob;
  if (!job || job.generation !== generation || machine !== job.owner || sessionId !== job.sessionId) return;
  try {
    if (job.kind === 'search') {
      const cursor = job.cursor;
      if (!cursor) fail('INVALID_STATE', 'Reverse search cursor is unavailable');
      const slice = job.owner.reverseSearchSlice(cursor, 256, 8);
      job.cursor = slice.cursor;
      if (slice.target) {
        job.kind = 'restore';
        job.target = slice.target.eventIndex;
        job.reason = slice.target.reason;
      }
      const now = performance.now();
      if (now - job.lastEmit >= 50) {
        emit(job.owner.getState());
        job.lastEmit = now;
      }
      scheduleHistory();
      return;
    }
    if (job.target === null) fail('INVALID_STATE', 'Rewind target is unavailable');
    const slice = job.owner.rewindSlice(job.target, 256, 8, job.reason);
    if (slice.done) {
      emit(slice.state);
      finishHistory(job, slice.state);
      return;
    }
    const now = performance.now();
    if (!job.emittedProgress || now - job.lastEmit >= 50) {
      emit(slice.state);
      job.emittedProgress = true;
      job.lastEmit = now;
    }
    scheduleHistory();
  } catch (error) {
    const state = job.owner.pause();
    emit(state);
    cancelHistory(error instanceof Error ? error : new Error('History operation failed'));
  }
}
function startHistory(owner: MalbolgeMachine, kind: HistoryJob['kind'], target: number | null, reason: StopReason): Promise<MachineState> {
  if (historyJob) return Promise.reject(new WorkerRequestError('BUSY', 'History operation is active'));
  intent = 'NONE';
  runRemaining = 0;
  const state = owner.beginRewind();
  emit(state);
  return new Promise<MachineState>((resolve, reject) => {
    historyJob = {
      generation: ++historyGeneration,
      owner,
      sessionId: sessionId ?? '',
      kind,
      cursor: kind === 'search' ? { fromEventIndex: state.eventIndex, nextEventIndex: state.eventIndex } : null,
      target,
      reason,
      lastEmit: performance.now(),
      emittedProgress: false,
      resolve,
      reject,
    };
    scheduleHistory();
  });
}
function traceChunk(index: number): RuntimeValue {
  if (!trace) return fail('EXPORT_CANCELLED', 'No active trace export');
  const start = index * 65536;
  const end = Math.min(start + 65536, trace.bytes.length);
  return { exportId: trace.exportId, chunkIndex: index, bytes: trace.bytes.slice(start, end), done: end >= trace.bytes.length, totalBytes: trace.bytes.length, digest: trace.digest };
}

// Lifecycle requests use strictly increasing epochs. Validation completes before
// commit; a failed replacement leaves the prior machine, session, and epoch live.
function lifecycleCommand(request: Request): RuntimeValue {
  const payload = request.payload;
  if (!record(payload)) return fail('INVALID_REQUEST', 'Payload must be an object');
  if (request.command === 'load') {
    const source = payload.source;
    const kind = payload.kind;
    if (!(typeof source === 'string' || source instanceof Uint8Array) || (kind !== 'raw' && kind !== 'normalized')) return fail('INVALID_REQUEST', 'Invalid source');
    const loaded = loadProgram(source, kind as SourceKind);
    const nextMachine = new MalbolgeMachine(loaded);
    cancelHistory(new WorkerRequestError('OPERATION_CANCELLED', 'Session was replaced'));
    machine = nextMachine;
    program = loaded;
    sessionId = crypto.randomUUID();
  } else if (request.command === 'restart') {
    if (!program || !machine) return fail('SESSION_MISMATCH', 'No source snapshot');
    const nextMachine = new MalbolgeMachine(program);
    cancelHistory(new WorkerRequestError('OPERATION_CANCELLED', 'Session was restarted'));
    machine = nextMachine;
    sessionId = crypto.randomUUID();
  } else if (request.command === 'stop') {
    if (!machine) return fail('SESSION_MISMATCH', 'No active session');
    const state = machine.getState();
    cancelHistory(new WorkerRequestError('OPERATION_CANCELLED', 'Session was stopped'));
    intent = 'NONE'; runRemaining = 0; exportGeneration++; exporting = false; trace = null;
    machine = null; program = null; sessionId = null;
    epoch = request.clientEpoch; lastSequence = request.requestSequence;
    return state;
  } else return fail('INVALID_REQUEST', 'Unknown lifecycle command');
  intent = 'NONE'; runRemaining = 0; exportGeneration++; exporting = false; trace = null;
  epoch = request.clientEpoch; lastSequence = request.requestSequence;
  const state = machine.getState();
  queueMicrotask(() => emit(state));
  return state;
}

async function command(request: Request): Promise<RuntimeValue> {
  const payload = request.payload;
  if (!record(payload)) return fail('INVALID_REQUEST', 'Payload must be an object');
  if (historyJob && !['pause', 'getState', 'queryView', 'queryPoint', 'queryMemory', 'queryInitialMemory', 'getHistory', 'getOutput'].includes(request.command)) return fail('BUSY', 'History operation is active');
  if ((trace || exporting) && !['ackTraceExport', 'cancelTraceExport', 'getState', 'queryView', 'queryPoint', 'queryMemory', 'queryInitialMemory', 'getHistory', 'getOutput', 'pause', 'stop'].includes(request.command)) return fail('BUSY', 'Trace export is active');
  const active = requireMachine(request);
  let state: MachineState;
  if (active.getPhase() === 'RUNNING' && (request.command === 'run' || request.command === 'step' || request.command === 'stepBack' || request.command === 'reverseContinue' || request.command === 'rewindTo' || request.command === 'createBranch')) return fail('BUSY', 'Run is active; pause first');
  switch (request.command) {
    case 'run': {
      const budget = payload.budget === undefined ? 1_000_000 : payload.budget;
      if (!integer(budget, 1, 1_000_000_000)) return fail('INVALID_REQUEST', 'Invalid instruction budget');
      if (intent !== 'NONE' && active.getPhase() !== 'WAITING_INPUT') return fail('BUSY', 'Execution intent is active');
      runRemaining = budget; intent = 'RUN'; lastContinuousEmit = performance.now();
      state = active.beginRun(); emit(state); schedule();
      return state;
    }
    case 'step': intent = 'STEP'; state = active.step(); if (state.phase !== 'WAITING_INPUT') intent = 'NONE'; emit(state); return state;
    case 'pause':
      intent = 'NONE'; runRemaining = 0; state = active.pause(); cancelHistory(undefined, state); emit(state); return state;
    case 'stepBack': intent = 'NONE'; state = active.stepBack(); emit(state); return state;
    case 'reverseContinue': return startHistory(active, 'search', null, 'REWOUND');
    case 'appendInput': {
      const bytes = payload.bytes;
      if (!Array.isArray(bytes) || !bytes.every(byte => integer(byte, 0, 255)) || bytes.length > 1_048_576) return fail('INVALID_REQUEST', 'Invalid input bytes');
      state = active.appendInput(bytes);
      if (state.phase === 'WAITING_INPUT' && intent === 'STEP') { state = active.step(); intent = state.phase === 'WAITING_INPUT' ? 'STEP' : 'NONE'; }
      else if (state.phase === 'WAITING_INPUT' && intent === 'RUN') schedule();
      emit(state); return state;
    }
    case 'closeInput': {
      state = active.closeInput();
      if (state.phase === 'WAITING_INPUT' && intent === 'STEP') { state = active.step(); intent = state.phase === 'WAITING_INPUT' ? 'STEP' : 'NONE'; }
      else if (state.phase === 'WAITING_INPUT' && intent === 'RUN') schedule();
      emit(state); return state;
    }
    case 'setBreakpoints': {
      const addresses = payload.addresses;
      if (!Array.isArray(addresses) || !addresses.every(address => integer(address, 0, 59048))) return fail('INVALID_REQUEST', 'Invalid breakpoint addresses');
      active.setBreakpoints(addresses); return active.getState();
    }
    case 'setWatchpoints': {
      const watchpoints = payload.watchpoints;
      if (!Array.isArray(watchpoints) || !watchpoints.every(item => record(item) && integer(item.address, 0, 59048) && Array.isArray(item.roles) && item.roles.every(role => role === 'data-read' || role === 'data-write' || role === 'encryption'))) return fail('INVALID_REQUEST', 'Invalid watchpoints');
      active.setWatchpoints(watchpoints); return active.getState();
    }
    case 'setOutputLimit': {
      const bytes = payload.bytes;
      if (!integer(bytes, 0, 16 * 1_048_576)) return fail('INVALID_REQUEST', 'Invalid output limit');
      active.setOutputLimit(bytes); return active.getState();
    }
    case 'getState': return active.getState();
    case 'getHistory': return active.getHistory();
    case 'getOutput': return active.getOutput();
    case 'queryMemory': case 'queryInitialMemory': {
      const start = payload.start; const count = payload.count;
      if (!integer(start, 0, 59048) || !integer(count, 0, 59049 - start)) return fail('INVALID_REQUEST', 'Invalid memory range');
      return request.command === 'queryMemory' ? active.getMemory(start, count) : active.getInitialMemory(start, count);
    }
    case 'queryPoint': {
      const eventIndex = payload.eventIndex; const start = payload.start; const count = payload.count;
      if (!integer(eventIndex) || !integer(start, 0, 59048) || !integer(count, 0, 59049 - start)) return fail('INVALID_REQUEST', 'Invalid point query');
      return active.queryPoint(eventIndex, start, count);
    }
    case 'queryView': {
      if (!sessionId || !program || !Array.isArray(payload.memoryRanges) || payload.memoryRanges.length > 4) return fail('INVALID_REQUEST', 'Invalid view ranges');
      const ranges: MemoryRange[] = [];
      for (const item of payload.memoryRanges) {
        if (!record(item) || !integer(item.start, 0, 59048) || !integer(item.count, 1, Math.min(128, 59049 - item.start))) return fail('INVALID_REQUEST', 'Invalid view range');
        ranges.push({ start: item.start, count: item.count });
      }
      const selectedAddress = payload.selectedAddress;
      if (selectedAddress !== undefined) {
        if (!integer(selectedAddress, 0, 59048)) return fail('INVALID_REQUEST', 'Invalid selected address');
        if (!ranges.some(range => selectedAddress >= range.start && selectedAddress < range.start + range.count)) ranges.push({ start: selectedAddress, count: 1 });
      }
      const liveState = active.getState();
      const pointEventIndex = payload.eventIndex === undefined ? liveState.eventIndex : payload.eventIndex;
      if (!integer(pointEventIndex, liveState.earliestEventIndex, liveState.tailEventIndex)) return fail('HISTORY_EXPIRED', 'Point is not retained');
      const historical = pointEventIndex !== liveState.eventIndex;
      const historyLimit = payload.historyLimit === undefined ? 200 : payload.historyLimit;
      const historyBeforeEventIndex = payload.historyBeforeEventIndex === undefined ? liveState.tailEventIndex + 1 : payload.historyBeforeEventIndex;
      if (!integer(historyLimit, 1, 200) || !integer(historyBeforeEventIndex, 0, liveState.tailEventIndex + 1) ||
        payload.includeOverview !== undefined && typeof payload.includeOverview !== 'boolean' ||
        payload.includeInitialOverview !== undefined && typeof payload.includeInitialOverview !== 'boolean') return fail('INVALID_REQUEST', 'Invalid view options');
      // An explicit Timeline selection remains a history view even at the live tail.
      const pointData = payload.eventIndex !== undefined ? active.queryPoint(pointEventIndex, 0, 0) : null;
      // Pointer cells are taken from this same atomic point, never a stale UI summary.
      for (const address of [pointData?.head.registers.c ?? liveState.head.registers.c, pointData?.head.registers.d ?? liveState.head.registers.d]) {
        if (!ranges.some(range => address >= range.start && address < range.start + range.count)) ranges.push({ start: address, count: 1 });
      }
      const pages: ViewPage[] = ranges.map(range => {
        const point = historical ? active.queryPoint(pointEventIndex, range.start, range.count) : null;
        return { start: range.start, current: point?.memory ?? active.getMemory(range.start, range.count),
          initial: active.getInitialMemory(range.start, range.count), roles: point?.roles ?? active.getRolePage(range.start, range.count) };
      });
      const overview = payload.includeOverview ? historical ? active.queryPoint(pointEventIndex, 0, 59049).memory : active.getMemory() : null;
      const bundle: ViewBundle = {
        sessionId, branchId: liveState.branchId, stateVersion: liveState.stateVersion, pointEventIndex,
        liveState, point: pointData ? { eventIndex: pointEventIndex, head: pointData.head, output: pointData.output } : null,
        pages, history: active.getHistoryPage(historyBeforeEventIndex, historyLimit), overview,
        initialOverview: payload.includeInitialOverview ? active.getInitialMemory() : null,
        snapshotSourceLength: program.analysis.sourceMap.length,
      };
      return bundle;
    }
    case 'rewindTo': {
      const eventIndex = payload.eventIndex;
      if (!integer(eventIndex)) return fail('INVALID_REQUEST', 'Invalid event index');
      return startHistory(active, 'restore', eventIndex, 'REWOUND');
    }
    case 'createBranch': {
      const bytes = payload.bytes; const closed = payload.closed; const exportReceipt = payload.exportReceipt;
      if (!Array.isArray(bytes) || !bytes.every(byte => integer(byte, 0, 255)) || typeof closed !== 'boolean' || typeof exportReceipt !== 'string' || exportReceipt.length < 1 || exportReceipt.length > 256) return fail('INVALID_REQUEST', 'Invalid branch request');
      state = active.createBranch(bytes, closed, exportReceipt); intent = 'NONE'; runRemaining = 0; emit(state); return state;
    }
    case 'beginTraceExport': {
      if (intent !== 'NONE') return fail('BUSY', 'Pause before exporting');
      const includeSource = payload.includeSource; const includeInput = payload.includeInput;
      if (typeof includeSource !== 'boolean' || typeof includeInput !== 'boolean' || !program) return fail('INVALID_REQUEST', 'Invalid trace options');
      exporting = true;
      const generation = ++exportGeneration;
      try {
        const built = await buildTrace(program, active, includeSource, includeInput);
        if (generation !== exportGeneration || machine !== active) return fail('EXPORT_CANCELLED', 'The exporting session was stopped');
        trace = { exportId: crypto.randomUUID(), bytes: built.bytes, digest: built.digest, nextIndex: 1 };
        return traceChunk(0);
      } finally { if (generation === exportGeneration) exporting = false; }
    }
    case 'ackTraceExport': {
      const exportId = payload.exportId; const chunkIndex = payload.chunkIndex;
      if (!trace || exportId !== trace.exportId || !integer(chunkIndex) || chunkIndex !== trace.nextIndex - 1) return fail('INVALID_CURSOR', 'Invalid trace acknowledgement');
      const index = trace.nextIndex++;
      if (index * 65536 >= trace.bytes.length) {
        const result = { exportId: trace.exportId, chunkIndex: index, bytes: new Uint8Array(), done: true, totalBytes: trace.bytes.length, digest: trace.digest };
        trace = null;
        return result;
      }
      return traceChunk(index);
    }
    case 'cancelTraceExport': {
      if (trace && payload.exportId === trace.exportId) trace = null;
      return active.getState();
    }
    default: return fail('INVALID_REQUEST', 'Unknown command');
  }
}

async function processRequest(request: Request): Promise<Response> {
  let result: Response['result'];
  const lifecycle = lifecycleCommands.has(request.command);
  if (lifecycle ? request.clientEpoch <= epoch : request.clientEpoch !== epoch || request.requestSequence <= lastSequence) {
    result = { ok: false, code: 'REQUEST_EXPIRED', message: 'Old request generation or sequence' };
  } else {
    if (!lifecycle) lastSequence = request.requestSequence;
    try {
      const value = lifecycle ? lifecycleCommand(request) : await command(request);
      result = { ok: true, value };
    }
    catch (error) {
      if (error instanceof WorkerRequestError) result = { ok: false, code: error.code, message: error.message };
      else if (error instanceof LoadError) result = { ok: false, code: error.diagnostics[0]?.code ?? 'LOAD_INVALID', message: error.message };
      else if (error instanceof Error) result = { ok: false, code: 'INVALID_STATE', message: error.message };
      else result = { ok: false, code: 'WORKER_ERROR', message: 'Unknown worker failure' };
    }
  }
  return { protocolVersion: 1, clientEpoch: request.clientEpoch, committedEpoch: epoch, requestId: request.requestId, sessionId, result };
}

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const raw = event.data;
  if (!record(raw) || raw.protocolVersion !== 1 || !integer(raw.clientEpoch) || typeof raw.requestId !== 'string' || !integer(raw.requestSequence) || typeof raw.command !== 'string') return;
  const request = raw as Request;
  const fingerprint = JSON.stringify([request.clientEpoch, request.command, request.payload, request.sessionId, request.branchId]);
  const invalid: Response = { protocolVersion: 1, clientEpoch: request.clientEpoch, committedEpoch: epoch, requestId: request.requestId, sessionId, result: { ok: false, code: 'INVALID_REQUEST', message: 'Reused request ID' } };
  const prior = responses.get(request.requestId);
  if (prior) { scope.postMessage(prior.fingerprint === fingerprint ? prior.response : invalid); return; }
  const active = processing.get(request.requestId);
  if (active) { scope.postMessage(active.fingerprint === fingerprint ? await active.response : invalid); return; }
  const pending = processRequest(request);
  processing.set(request.requestId, { fingerprint, response: pending });
  const response = await pending;
  processing.delete(request.requestId);
  responses.set(request.requestId, { fingerprint, response });
  if (responses.size > 512) { const first = responses.keys().next().value; if (first) responses.delete(first); }
  scope.postMessage(response);
};
