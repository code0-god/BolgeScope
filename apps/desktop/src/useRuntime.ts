import { useCallback, useEffect, useRef, useState } from 'react';
import { MEMORY_SIZE, type JournalEvent, type MachineHead, type MachineState, type RoleCounts, type SourceKind, type Watchpoint } from '@bolgescope/core';
import { createWorkerClient, type TraceChunk, type ViewBundle, type ViewQuery } from '@bolgescope/runtime';
import { OperationOwner } from './operationOwner';

export type MemoryLookup = Readonly<Record<number, number | undefined>>;
export type RoleLookup = Readonly<Record<number, RoleCounts | undefined>>;
type HistoricalView = Readonly<{ eventIndex: number; head: MachineHead; output: Uint8Array; memory: MemoryLookup; roles: RoleLookup }>;
type View = { state: MachineState | null; history: readonly JournalEvent[]; historyLoading: boolean; memory: MemoryLookup; initial: MemoryLookup; roles: RoleLookup; point: HistoricalView | null; snapshotSourceLength: number; overviewComplete: boolean; busy: boolean; error: string | null };
type Focus = { selectedAddress: number | null; memoryPageStart: number; overview: boolean };
type OverviewCache = { branchId: string; eventIndex: number; step: number; memory: Uint16Array };
const empty: View = { state: null, history: [], historyLoading: false, memory: {}, initial: {}, roles: {}, point: null, snapshotSourceLength: 0, overviewComplete: false, busy: false, error: null };

function fullLookup(values: Uint16Array): MemoryLookup {
  const lookup: Record<number, number> = {};
  for (let address = 0; address < values.length; address++) {
    const value = values[address];
    if (value !== undefined) lookup[address] = value;
  }
  return lookup;
}

function pageLookups(bundle: ViewBundle): { memory: MemoryLookup; initial: MemoryLookup; roles: RoleLookup } {
  const memory: Record<number, number> = {};
  const initial: Record<number, number> = {};
  const roles: Record<number, RoleCounts> = {};
  for (const page of bundle.pages) for (let offset = 0; offset < page.current.length; offset++) {
    const address = page.start + offset;
    const current = page.current[offset];
    const first = page.initial[offset];
    if (current !== undefined) memory[address] = current;
    if (first !== undefined) initial[address] = first;
    roles[address] = { fetch: page.roles.fetch[offset] ?? 0, dataRead: page.roles.dataRead[offset] ?? 0,
      dataWrite: page.roles.dataWrite[offset] ?? 0, encryption: page.roles.encryption[offset] ?? 0 };
  }
  return { memory, initial, roles };
}

export function useRuntime() {
  const client = useRef<ReturnType<typeof createWorkerClient> | null>(null);
  const [view, setView] = useState<View>(empty);
  const commands = useRef(new OperationOwner());
  const generation = useRef(0);
  const selectedPoint = useRef<number | null>(null);
  const focus = useRef<Focus>({ selectedAddress: null, memoryPageStart: 0, overview: false });
  const overviewCache = useRef<OverviewCache | null>(null);
  const needsInitial = useRef(false);
  const refreshTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const runtime = client.current;
    if (!runtime) return;
    const current = ++generation.current;
    try {
      const state = runtime.getCurrentState();
      const address = focus.current.selectedAddress;
      const ranges = [{ start: focus.current.memoryPageStart, count: Math.min(128, MEMORY_SIZE - focus.current.memoryPageStart) }];
      for (const pointer of [state?.head.registers.c, state?.head.registers.d]) {
        if (pointer === undefined) continue;
        const start = Math.floor(pointer / 128) * 128;
        if (!ranges.some(range => range.start === start) && ranges.length < 4) ranges.push({ start, count: Math.min(128, MEMORY_SIZE - start) });
      }
      if (address !== null) {
        const start = Math.floor(address / 128) * 128;
        if (!ranges.some(range => range.start === start) && ranges.length < 4) ranges.push({ start, count: Math.min(128, MEMORY_SIZE - start) });
      }
      const query: ViewQuery = { memoryRanges: ranges, historyLimit: 200,
        ...(address === null ? {} : { selectedAddress: address }),
        ...(selectedPoint.current === null ? {} : { eventIndex: selectedPoint.current }),
        ...(needsInitial.current ? { includeInitialOverview: true } : {}),
        ...(focus.current.overview && (overviewCache.current === null || selectedPoint.current !== null) ? { includeOverview: true } : {}),
      };
      let bundle = await runtime.queryView(query);
      if (current !== generation.current || bundle.sessionId !== runtime.getSessionId()) return;
      if (bundle.initialOverview) needsInitial.current = false;
      if (focus.current.overview && selectedPoint.current === null && !bundle.overview) {
        const cache = overviewCache.current;
        if (cache && cache.branchId === bundle.branchId && bundle.liveState.eventIndex >= cache.eventIndex) {
          const nextStep = bundle.liveState.head.step;
          if (nextStep === cache.step || nextStep === cache.step + 1 && bundle.liveState.lastTransaction?.after.step === nextStep) {
            if (nextStep > cache.step) for (const write of bundle.liveState.lastTransaction?.writes ?? []) cache.memory[write.address] = write.after;
            cache.eventIndex = bundle.liveState.eventIndex; cache.step = nextStep;
          }
        }
        if ((!cache || cache.branchId !== bundle.branchId || cache.eventIndex !== bundle.liveState.eventIndex) && bundle.liveState.phase !== 'RUNNING') {
          bundle = await runtime.queryView({ ...query, includeOverview: true });
          if (current !== generation.current || bundle.sessionId !== runtime.getSessionId()) return;
        }
      }
      const lookups = pageLookups(bundle);
      if (bundle.overview && selectedPoint.current === null) overviewCache.current = { branchId: bundle.branchId, eventIndex: bundle.liveState.eventIndex, step: bundle.liveState.head.step, memory: bundle.overview };
      const liveOverview = focus.current.overview && selectedPoint.current === null && overviewCache.current?.branchId === bundle.branchId && overviewCache.current.eventIndex === bundle.liveState.eventIndex ? overviewCache.current.memory : null;
      const memory = bundle.overview ?? liveOverview;
      const initial = bundle.initialOverview ? fullLookup(bundle.initialOverview) : lookups.initial;
      const point = bundle.point ? { ...bundle.point, memory: bundle.overview ? fullLookup(bundle.overview) : lookups.memory, roles: lookups.roles } : null;
      setView(previous => ({ ...previous, state: bundle.liveState,
        history: previous.state?.branchId === bundle.branchId && bundle.history.length && (previous.history.at(-1)?.eventIndex ?? 0) >= (bundle.history[0]?.eventIndex ?? 0) - 1
          ? [...previous.history.filter(entry => entry.eventIndex > bundle.liveState.earliestEventIndex && entry.eventIndex < (bundle.history[0]?.eventIndex ?? 0)), ...bundle.history]
          : bundle.history,
        memory: point ? previous.memory : memory ? fullLookup(memory) : lookups.memory,
        initial: bundle.initialOverview ? initial : { ...previous.initial, ...initial },
        roles: point ? previous.roles : lookups.roles, point, snapshotSourceLength: bundle.snapshotSourceLength,
        overviewComplete: Boolean(memory || bundle.point && bundle.overview), error: null }));
    } catch (error) {
      if (current === generation.current) setView(previous => ({ ...previous, point: selectedPoint.current === null ? previous.point : null, error: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  useEffect(() => {
    const runtime = createWorkerClient();
    client.current = runtime;
    const unsubscribe = runtime.subscribe(() => {
      if (refreshTimer.current !== null) return;
      refreshTimer.current = window.setTimeout(() => { refreshTimer.current = null; void refresh(); }, 0);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
      commands.current.invalidate();
      generation.current++;
      runtime.terminate();
      client.current = null;
    };
  }, [refresh]);

  const command = useCallback(async (action: (runtime: NonNullable<typeof client.current>, owns: () => boolean) => Promise<unknown>) => {
    const runtime = client.current;
    if (!runtime) return;
    const operation = commands.current.begin();
    const owns = (): boolean => commands.current.owns(operation) && client.current === runtime;
    setView(previous => ({ ...previous, busy: true, error: null }));
    try {
      await action(runtime, owns);
      if (!owns()) return;
      await refresh();
    } catch (error) {
      if (owns()) setView(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    } finally {
      if (owns()) setView(previous => ({ ...previous, busy: false }));
    }
  }, [refresh]);

  const configureView = useCallback((next: Focus): void => {
    const previous = focus.current;
    if (previous.selectedAddress === next.selectedAddress && previous.memoryPageStart === next.memoryPageStart && previous.overview === next.overview) return;
    focus.current = next;
    if (client.current?.getCurrentState()) void refresh();
  }, [refresh]);

  return {
    ...view,
    historyHasMore: !!view.state && !!view.history[0] && view.history[0].eventIndex > view.state.earliestEventIndex + 1,
    loadOlderHistory: async () => {
      const runtime = client.current;
      const before = view.history[0]?.eventIndex;
      if (!runtime || before === undefined || view.historyLoading) return;
      const current = generation.current;
      setView(previous => ({ ...previous, historyLoading: true }));
      try {
        const bundle = await runtime.queryView({ memoryRanges: [], historyBeforeEventIndex: before, historyLimit: 200 });
        if (current !== generation.current || bundle.sessionId !== runtime.getSessionId()) return;
        setView(previous => previous.state?.branchId === bundle.branchId
          ? { ...previous, history: [...bundle.history.filter(entry => entry.eventIndex > bundle.liveState.earliestEventIndex && entry.eventIndex < (previous.history[0]?.eventIndex ?? Infinity)), ...previous.history] }
          : previous);
      } catch (error) {
        if (current === generation.current) setView(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        if (current === generation.current) setView(previous => ({ ...previous, historyLoading: false }));
      }
    },
    configureView,
    load: (source: string | Uint8Array, kind: SourceKind) => command(async (runtime, owns) => {
      await runtime.load(source, kind);
      if (!owns()) return;
      needsInitial.current = true; selectedPoint.current = null; overviewCache.current = null;
      setView(previous => ({ ...previous, point: null, initial: {}, memory: {}, roles: {}, history: [], snapshotSourceLength: 0 }));
    }),
    run: () => command(runtime => runtime.run()),
    step: () => command(runtime => runtime.step()),
    pause: () => command(runtime => runtime.pause()),
    back: () => command(runtime => runtime.stepBack()),
    restart: () => command(async (runtime, owns) => {
      await runtime.restart();
      if (!owns()) return;
      needsInitial.current = true; selectedPoint.current = null; overviewCache.current = null;
      setView(previous => ({ ...previous, point: null, initial: {}, memory: {}, roles: {}, history: [], snapshotSourceLength: 0 }));
    }),
    stop: async () => {
      const current = client.current;
      if (!current) return;
      const operation = commands.current.begin();
      generation.current++;
      setView(previous => ({ ...previous, busy: true, error: null }));
      try {
        await current.stop();
        if (!commands.current.owns(operation) || client.current !== current) return;
        selectedPoint.current = null; overviewCache.current = null; needsInitial.current = false;
        setView(empty);
      } catch (error) {
        if (commands.current.owns(operation) && client.current === current) {
          setView(previous => ({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) }));
        }
        throw error;
      }
    },
    send: (bytes: Uint8Array) => command(runtime => runtime.appendInput(Array.from(bytes))),
    eof: () => command(runtime => runtime.closeInput()),
    breakpoints: (addresses: number[]) => command(runtime => runtime.setBreakpoints(addresses)),
    watchpoints: (points: readonly Watchpoint[]) => command(runtime => runtime.setWatchpoints(points)),
    reverse: () => command(runtime => runtime.reverseContinue()),
    branch: (bytes: Uint8Array, closed: boolean, receipt: string) => command(async (runtime, owns) => {
      await runtime.createBranch(Array.from(bytes), closed, receipt);
      if (!owns()) return;
      selectedPoint.current = null; overviewCache.current = null;
      setView(previous => ({ ...previous, point: null, memory: {}, roles: {} }));
    }),
    outputLimit: (bytes: number) => command(runtime => runtime.setOutputLimit(bytes)),
    beginTraceExport: (includeSource: boolean, includeInput: boolean): Promise<TraceChunk> => { const current = client.current; if (!current) return Promise.reject(new Error('No runtime')); return current.beginTraceExport(includeSource, includeInput); },
    ackTraceExport: (exportId: string, chunkIndex: number): Promise<TraceChunk> => { const current = client.current; if (!current) return Promise.reject(new Error('No runtime')); return current.ackTraceExport(exportId, chunkIndex); },
    cancelTraceExport: (exportId: string): Promise<MachineState> => { const current = client.current; if (!current) return Promise.reject(new Error('No runtime')); return current.cancelTraceExport(exportId); },
    viewPoint: async (eventIndex: number | null) => {
      selectedPoint.current = eventIndex;
      setView(previous => ({ ...previous, point: null }));
      await refresh();
    },
    rewind: (eventIndex: number) => command(async (runtime, owns) => {
      await runtime.rewindTo(eventIndex);
      if (!owns()) return;
      selectedPoint.current = null; overviewCache.current = null;
      setView(previous => ({ ...previous, point: null, memory: {}, roles: {} }));
    }),
  };
}
