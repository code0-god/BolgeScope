import type { JournalEvent, MachineState, PointView, SourceKind, Watchpoint } from '@bolgescope/core';
import type { Command, Request, Response, StateEvent, TraceChunk, ViewBundle, ViewQuery } from './protocol.js';

type Pending = Readonly<{ resolve: (value: unknown) => void; reject: (error: Error) => void }>;

export class RuntimeClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(state: MachineState) => void>();
  private sequence = 0;
  private epoch = 1;
  private sessionId: string | null = null;
  private latest: MachineState | null = null;

  constructor(worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<Response | StateEvent>) => {
      const message = event.data;
      if (message.clientEpoch !== this.epoch) return;
      if ('type' in message) {
        if (message.sessionId !== this.sessionId) return;
        if (this.latest && message.summary.branchId !== this.latest.branchId) return;
        this.latest = message.summary;
        for (const listener of this.listeners) listener(message.summary);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.result.ok) {
        if (message.sessionId) this.sessionId = message.sessionId;
        pending.resolve(message.result.value);
      } else pending.reject(new Error(`${message.result.code}: ${message.result.message}`));
    };
    worker.onerror = event => {
      for (const pending of this.pending.values()) pending.reject(new Error(`WORKER_CRASH: ${event.message}`));
      this.pending.clear();
    };
  }
  subscribe(listener: (state: MachineState) => void): () => void { this.listeners.add(listener); if (this.latest) listener(this.latest); return () => this.listeners.delete(listener); }
  getCurrentState(): MachineState | null { return this.latest; }
  getSessionId(): string | null { return this.sessionId; }
  load(source: string | Uint8Array, kind: SourceKind = 'raw'): Promise<MachineState> {
    for (const pending of this.pending.values()) pending.reject(new Error('STALE_SESSION: replaced by load'));
    this.pending.clear();
    const previousEpoch = this.epoch;
    this.epoch++;
    return this.request<MachineState>({ command: 'load', payload: { source, kind } }).then(state => {
      this.latest = state;
      return state;
    }, error => {
      this.epoch = previousEpoch;
      throw error;
    });
  }
  run(budget?: number): Promise<MachineState> { return this.request({ command: 'run', payload: budget === undefined ? {} : { budget } }); }
  step(): Promise<MachineState> { return this.request({ command: 'step', payload: {} }); }
  pause(): Promise<MachineState> { return this.request({ command: 'pause', payload: {} }); }
  stepBack(): Promise<MachineState> { return this.request({ command: 'stepBack', payload: {} }); }
  reverseContinue(): Promise<MachineState> { return this.request({ command: 'reverseContinue', payload: {} }); }
  restart(): Promise<MachineState> {
    for (const pending of this.pending.values()) pending.reject(new Error('STALE_SESSION: replaced by restart'));
    this.pending.clear();
    const previousEpoch = this.epoch;
    this.epoch++;
    return this.request<MachineState>({ command: 'restart', payload: {} }).then(state => { this.latest = state; return state; }, error => { this.epoch = previousEpoch; throw error; });
  }
  stop(): Promise<MachineState> { return this.request<MachineState>({ command: 'stop', payload: {} }).then(state => {
    this.sessionId = null; this.latest = null;
    for (const pending of this.pending.values()) pending.reject(new Error('STALE_SESSION: stopped'));
    this.pending.clear();
    return state;
  }); }
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
    for (const pending of this.pending.values()) pending.reject(new Error('STALE_BRANCH: replaced by branch'));
    this.pending.clear();
    return this.request<MachineState>({ command: 'createBranch', payload: { bytes, closed, exportReceipt } }).then(state => { this.latest = state; return state; });
  }
  beginTraceExport(includeSource: boolean, includeInput: boolean): Promise<TraceChunk> { return this.request({ command: 'beginTraceExport', payload: { includeSource, includeInput } }); }
  ackTraceExport(exportId: string, chunkIndex: number): Promise<TraceChunk> { return this.request({ command: 'ackTraceExport', payload: { exportId, chunkIndex } }); }
  cancelTraceExport(exportId: string): Promise<MachineState> { return this.request({ command: 'cancelTraceExport', payload: { exportId } }); }
  terminate(): void { this.worker.terminate(); for (const pending of this.pending.values()) pending.reject(new Error('WORKER_CRASH: terminated')); this.pending.clear(); this.sessionId = null; this.latest = null; }

  private request<T>(command: Command): Promise<T> {
    const requestId = crypto.randomUUID();
    const request: Request = { protocolVersion: 1, clientEpoch: this.epoch, requestId, requestSequence: ++this.sequence,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}), ...(this.sessionId && this.latest ? { branchId: this.latest.branchId } : {}), command: command.command, payload: command.payload };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject });
      this.worker.postMessage(request);
    });
  }
}

export function createWorkerClient(): RuntimeClient { return new RuntimeClient(); }
