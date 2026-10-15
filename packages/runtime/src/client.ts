import type { JournalEvent, MachineState, PointView, SourceKind, Watchpoint } from '@bolgescope/core';
import type { ProjectFile } from '@bolgescope/contracts';
import type { Command, Request, Response, RuntimeValue, StateEvent, TraceChunk, ViewBundle, ViewQuery } from './protocol.js';

type Pending = {
  active: boolean;
  readonly clientEpoch: number;
  readonly command: Command['command'];
  readonly lifecycle: boolean;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

function isMachineState(value: RuntimeValue): value is MachineState {
  return typeof value === 'object' && value !== null && 'branchId' in value && 'stateVersion' in value && 'head' in value;
}

export class RuntimeClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(state: MachineState) => void>();
  private sequence = 0;
  private nextEpoch = 0;
  private committedEpoch = 0;
  private lifecycleEpoch: number | null = null;
  private workerFailure: Error | null = null;
  private transportSessionId: string | null = null;
  private transportLatest: MachineState | null = null;
  private sessionId: string | null = null;
  private latest: MachineState | null = null;

  constructor(worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<Response | StateEvent>) => {
      const message = event.data;
      if ('type' in message) {
        if (this.lifecycleEpoch !== null || message.clientEpoch !== this.committedEpoch) return;
        if (message.sessionId !== this.sessionId) return;
        if (this.latest && message.summary.branchId !== this.latest.branchId) return;
        this.publish(message.summary);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending || message.clientEpoch !== pending.clientEpoch) return;
      this.pending.delete(message.requestId);
      this.applyCommitted(message, pending);
      if (!pending.active) return;
      if (pending.lifecycle && pending.clientEpoch !== this.lifecycleEpoch) {
        pending.active = false;
        pending.reject(new Error('STALE_SESSION: lifecycle request was superseded'));
        return;
      }
      if (pending.lifecycle) {
        this.lifecycleEpoch = null;
        this.sessionId = this.transportSessionId;
        this.latest = null;
        if (this.transportLatest) this.publish(this.transportLatest);
      }
      if (message.result.ok) {
        pending.resolve(message.result.value);
      } else pending.reject(new Error(`${message.result.code}: ${message.result.message}`));
    };
    worker.onerror = event => {
      this.failWorker(new Error(`WORKER_CRASH: ${event.message}`));
    };
  }
  subscribe(listener: (state: MachineState) => void): () => void { this.listeners.add(listener); if (this.latest) listener(this.latest); return () => this.listeners.delete(listener); }
  getCurrentState(): MachineState | null { return this.latest; }
  getSessionId(): string | null { return this.sessionId; }
  load(source: string | Uint8Array, kind: SourceKind = 'raw', run?: ProjectFile['run']): Promise<MachineState> {
    return this.lifecycleRequest({ command: 'load', payload: { source, kind, ...(run === undefined ? {} : { run }) } }, 'STALE_SESSION: replaced by load');
  }
  run(budget?: number): Promise<MachineState> { return this.request({ command: 'run', payload: budget === undefined ? {} : { budget } }); }
  step(): Promise<MachineState> { return this.request({ command: 'step', payload: {} }); }
  pause(): Promise<MachineState> { return this.request({ command: 'pause', payload: {} }); }
  stepBack(): Promise<MachineState> { return this.request({ command: 'stepBack', payload: {} }); }
  reverseContinue(): Promise<MachineState> { return this.request({ command: 'reverseContinue', payload: {} }); }
  restart(): Promise<MachineState> {
    return this.lifecycleRequest({ command: 'restart', payload: {} }, 'STALE_SESSION: replaced by restart');
  }
  stop(): Promise<MachineState> { return this.lifecycleRequest({ command: 'stop', payload: {} }, 'STALE_SESSION: stopped'); }
  appendInput(bytes: readonly number[]): Promise<MachineState> { return this.request({ command: 'appendInput', payload: { bytes } }); }
  closeInput(): Promise<MachineState> { return this.request({ command: 'closeInput', payload: {} }); }
  setBreakpoints(addresses: readonly number[]): Promise<MachineState> { return this.request({ command: 'setBreakpoints', payload: { addresses } }); }
  setWatchpoints(watchpoints: readonly Watchpoint[]): Promise<MachineState> { return this.request({ command: 'setWatchpoints', payload: { watchpoints } }); }
  setOutputLimit(bytes: number): Promise<MachineState> { return this.request({ command: 'setOutputLimit', payload: { bytes } }); }
  getState(): Promise<MachineState> { return this.request({ command: 'getState', payload: {} }); }
  getHistory(): Promise<readonly JournalEvent[]> { return this.request({ command: 'getHistory', payload: {} }); }
  getOutput(): Promise<Uint8Array> { return this.request({ command: 'getOutput', payload: {} }); }
  queryMemory(start: number, count: number): Promise<Uint16Array> { return this.request({ command: 'queryMemory', payload: { start, count } }); }
  queryInitialMemory(start: number, count: number): Promise<Uint16Array> { return this.request({ command: 'queryInitialMemory', payload: { start, count } }); }
  queryPoint(eventIndex: number, start: number, count: number): Promise<PointView> { return this.request({ command: 'queryPoint', payload: { eventIndex, start, count } }); }
  queryView(query: ViewQuery): Promise<ViewBundle> { return this.request({ command: 'queryView', payload: query }); }
  rewindTo(eventIndex: number): Promise<MachineState> { return this.request({ command: 'rewindTo', payload: { eventIndex } }); }
  createBranch(bytes: readonly number[], closed: boolean, exportReceipt: string): Promise<MachineState> {
    this.cancelPending(new Error('STALE_BRANCH: replaced by branch'));
    return this.request<MachineState>({ command: 'createBranch', payload: { bytes, closed, exportReceipt } }).then(state => {
      this.latest = state;
      this.transportLatest = state;
      return state;
    });
  }
  beginTraceExport(includeSource: boolean, includeInput: boolean): Promise<TraceChunk> { return this.request({ command: 'beginTraceExport', payload: { includeSource, includeInput } }); }
  ackTraceExport(exportId: string, chunkIndex: number): Promise<TraceChunk> { return this.request({ command: 'ackTraceExport', payload: { exportId, chunkIndex } }); }
  cancelTraceExport(exportId: string): Promise<MachineState> { return this.request({ command: 'cancelTraceExport', payload: { exportId } }); }
  terminate(): void {
    this.worker.terminate();
    this.failWorker(new Error('WORKER_CRASH: terminated'));
  }

  private lifecycleRequest<T>(command: Command, reason: string): Promise<T> {
    this.cancelPending(new Error(reason));
    const clientEpoch = ++this.nextEpoch;
    this.lifecycleEpoch = clientEpoch;
    return this.request(command, { clientEpoch, lifecycle: true });
  }

  private request<T>(command: Command, options?: Readonly<{ clientEpoch: number; lifecycle: boolean }>): Promise<T> {
    if (this.workerFailure) return Promise.reject(this.workerFailure);
    const lifecycle = options?.lifecycle ?? false;
    if (!lifecycle && this.lifecycleEpoch !== null) return Promise.reject(new Error('BUSY: session replacement is active'));
    const requestId = crypto.randomUUID();
    const clientEpoch = options?.clientEpoch ?? this.committedEpoch;
    const request: Request = { protocolVersion: 1, clientEpoch, requestId, requestSequence: ++this.sequence,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...(this.sessionId && this.latest ? { branchId: this.latest.branchId } : {}), command: command.command, payload: command.payload };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { active: true, clientEpoch, command: command.command, lifecycle, resolve: value => resolve(value as T), reject });
      this.worker.postMessage(request);
    });
  }

  private applyCommitted(message: Response, pending: Pending): void {
    if (message.committedEpoch < this.committedEpoch) return;
    if (message.committedEpoch > this.committedEpoch) {
      this.committedEpoch = message.committedEpoch;
      this.nextEpoch = Math.max(this.nextEpoch, message.committedEpoch);
      if (message.sessionId !== this.transportSessionId) this.transportLatest = null;
      this.transportSessionId = message.sessionId;
    }
    if (!message.result.ok || message.committedEpoch !== pending.clientEpoch) return;
    if (pending.command === 'stop') {
      this.transportSessionId = null;
      this.transportLatest = null;
    } else if ((pending.command === 'load' || pending.command === 'restart') && isMachineState(message.result.value)) {
      this.transportSessionId = message.sessionId;
      this.transportLatest = message.result.value;
    }
  }

  private publish(state: MachineState): void {
    if (this.latest?.branchId === state.branchId) {
      if (this.latest.stateVersion > state.stateVersion) return;
      if (this.latest.stateVersion === state.stateVersion &&
        this.latest.phase === state.phase &&
        this.latest.reason === state.reason) return;
    }
    this.latest = state;
    this.transportLatest = state;
    for (const listener of this.listeners) listener(state);
  }

  private cancelPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      if (!pending.active) continue;
      pending.active = false;
      pending.reject(error);
      if (!pending.lifecycle) this.pending.delete(requestId);
    }
  }

  private failWorker(error: Error): void {
    if (this.workerFailure) return;
    this.workerFailure = error;
    for (const pending of this.pending.values()) if (pending.active) pending.reject(error);
    this.pending.clear();
    this.lifecycleEpoch = null;
    this.transportSessionId = null;
    this.transportLatest = null;
    this.sessionId = null;
    this.latest = null;
  }
}

export function createWorkerClient(): RuntimeClient { return new RuntimeClient(); }
