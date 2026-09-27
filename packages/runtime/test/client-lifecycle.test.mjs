import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeClient } from '../src/client.ts';

const clients = [];

function machineState(branchId, step = 0) {
  return {
    branchId,
    parentBranch: null,
    phase: 'READY',
    reason: 'NONE',
    head: {
      registers: { a: 0, c: 0, d: 0 },
      step,
      terminal: 'NONE',
      tape: { visibleLength: 0, cursor: 0, closed: false, eofReads: 0 },
      outputLength: 0,
    },
    eventIndex: 0,
    tailEventIndex: 0,
    earliestEventIndex: 0,
    stateVersion: step,
    output: [],
    lastTransaction: null,
  };
}

class ControlledWorker {
  onmessage = null;
  onerror = null;
  requests = [];
  committedEpoch = 0;
  sessionId = null;

  postMessage(request) {
    this.requests.push(request);
  }

  terminate() {}

  succeed(request, value, sessionId) {
    if (['load', 'restart', 'stop'].includes(request.command) && request.clientEpoch >= this.committedEpoch) {
      this.committedEpoch = request.clientEpoch;
      this.sessionId = request.command === 'stop' ? null : sessionId;
    }
    this.onmessage?.({
      data: {
        protocolVersion: 1,
        clientEpoch: request.clientEpoch,
        committedEpoch: this.committedEpoch,
        requestId: request.requestId,
        sessionId: this.sessionId,
        result: { ok: true, value },
      },
    });
  }

  fail(request, code, message, sessionId) {
    this.onmessage?.({
      data: {
        protocolVersion: 1,
        clientEpoch: request.clientEpoch,
        committedEpoch: this.committedEpoch,
        requestId: request.requestId,
        sessionId: this.sessionId ?? sessionId,
        result: { ok: false, code, message },
      },
    });
  }

  crash(message = 'worker failed') {
    this.onerror?.({ message });
  }
}

function client() {
  const worker = new ControlledWorker();
  const runtime = new RuntimeClient(worker);
  clients.push(runtime);
  return { runtime, worker };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function establish(runtime, worker) {
  const loading = runtime.load('established');
  const request = worker.requests.at(-1);
  const state = machineState('branch-established', 1);
  worker.succeed(request, state, 'session-established');
  await expect(loading).resolves.toEqual(state);
  return { request, state };
}

afterEach(() => {
  for (const runtime of clients.splice(0)) runtime.terminate();
});

describe('RuntimeClient replacement ownership', () => {
  it('keeps the latest generation after an older cancellation continuation runs', async () => {
    // Given two overlapping loads whose latest response wins immediately.
    const { runtime, worker } = client();
    const first = runtime.load('first');
    const second = runtime.load('second');
    const secondRequest = worker.requests[1];
    const expected = machineState('branch-second', 2);

    // When load B completes before load A's rejection continuation runs.
    worker.succeed(secondRequest, expected, 'session-second');
    await expect(second).resolves.toEqual(expected);
    await expect(first).rejects.toThrow(/STALE_SESSION/);
    await flushMicrotasks();
    const followUp = runtime.getState();
    void followUp.catch(() => undefined);
    const followUpRequest = worker.requests[2];

    // Then later commands still target B's committed generation and session.
    expect(followUpRequest.clientEpoch).toBe(secondRequest.clientEpoch);
    expect(followUpRequest.sessionId).toBe('session-second');
    worker.succeed(followUpRequest, expected, 'session-second');
    await expect(followUp).resolves.toEqual(expected);
    expect(runtime.getCurrentState()).toEqual(expected);
  });

  it('settles the latest load when stale and current responses arrive out of order', async () => {
    // Given load A superseded by load B before either Worker response.
    const { runtime, worker } = client();
    const first = runtime.load('first');
    const firstRequest = worker.requests[0];
    const second = runtime.load('second');
    const secondRequest = worker.requests[1];
    let completed = false;
    let result;
    void second.then(
      value => {
        completed = true;
        result = value;
      },
      () => undefined,
    );
    await expect(first).rejects.toThrow(/STALE_SESSION/);
    await flushMicrotasks();

    // When A's stale response arrives before B's successful response.
    worker.succeed(firstRequest, machineState('branch-first', 1), 'session-first');
    const expected = machineState('branch-second', 2);
    worker.succeed(secondRequest, expected, 'session-second');
    await flushMicrotasks();

    // Then B resolves exactly once and remains the current session.
    expect(completed).toBe(true);
    expect(result).toEqual(expected);
    expect(runtime.getSessionId()).toBe('session-second');
    expect(runtime.getCurrentState()).toEqual(expected);
  });

  it('keeps the committed session usable when the latest load fails validation', async () => {
    // Given an established session and a replacement load attempt.
    const { runtime, worker } = client();
    const established = await establish(runtime, worker);
    const invalid = runtime.load('invalid');
    const invalidRequest = worker.requests.at(-1);

    // When the Worker rejects the replacement without changing its session.
    worker.fail(invalidRequest, 'LOAD_INVALID_OPCODE', 'Invalid source', 'session-established');
    await expect(invalid).rejects.toThrow(/LOAD_INVALID_OPCODE/);
    const followUp = runtime.getState();
    const followUpRequest = worker.requests.at(-1);

    // Then the prior committed epoch, state, and session remain usable.
    expect(runtime.getCurrentState()).toEqual(established.state);
    expect(followUpRequest.clientEpoch).toBe(established.request.clientEpoch);
    expect(followUpRequest.sessionId).toBe('session-established');
    worker.succeed(followUpRequest, established.state, 'session-established');
    await expect(followUp).resolves.toEqual(established.state);
  });

  it.each([
    ['load then restart', runtime => runtime.load('replacement'), runtime => runtime.restart()],
    ['restart then load', runtime => runtime.restart(), runtime => runtime.load('replacement')],
  ])('settles only the latest replacement for %s', async (_name, startFirst, startSecond) => {
    // Given an established session and two overlapping replacement operations.
    const { runtime, worker } = client();
    await establish(runtime, worker);
    const first = startFirst(runtime);
    const second = startSecond(runtime);
    const secondRequest = worker.requests.at(-1);
    let completed = false;
    let result;
    void second.then(
      value => {
        completed = true;
        result = value;
      },
      () => undefined,
    );

    // When the cancelled operation settles before the latest Worker response.
    await expect(first).rejects.toThrow(/STALE_SESSION/);
    await flushMicrotasks();
    const expected = machineState(`branch-${_name}`, 2);
    worker.succeed(secondRequest, expected, `session-${_name}`);
    await flushMicrotasks();

    // Then only the latest replacement commits.
    expect(completed).toBe(true);
    expect(result).toEqual(expected);
    expect(runtime.getCurrentState()).toEqual(expected);
  });

  it('stops an in-flight load once and ignores its late success', async () => {
    // Given an established session with a replacement load still pending.
    const { runtime, worker } = client();
    const established = await establish(runtime, worker);
    const loading = runtime.load('replacement');
    const loadRequest = worker.requests.at(-1);
    let settlements = 0;
    void loading.then(
      () => { settlements++; },
      () => { settlements++; },
    );
    const stopping = runtime.stop();
    const stopRequest = worker.requests.at(-1);

    // When Stop completes before the replacement response.
    worker.succeed(stopRequest, established.state, 'session-established');
    await expect(stopping).resolves.toEqual(established.state);
    await expect(loading).rejects.toThrow(/STALE_SESSION/);
    worker.succeed(loadRequest, machineState('branch-late', 3), 'session-late');
    await flushMicrotasks();

    // Then the load settles once and cannot resurrect the stopped session.
    expect(settlements).toBe(1);
    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.getCurrentState()).toBeNull();
  });

  it('clears session state and rejects future requests after Worker failure', async () => {
    // Given an established session with one request pending.
    const { runtime, worker } = client();
    await establish(runtime, worker);
    const pending = runtime.getState();

    // When the Worker reports a terminal error.
    worker.crash('boom');
    await expect(pending).rejects.toThrow(/WORKER_CRASH: boom/);
    const requestCount = worker.requests.length;
    let rejected = false;
    void runtime.getState().catch(() => { rejected = true; });
    await flushMicrotasks();

    // Then no stale session remains and later requests fail without posting.
    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.getCurrentState()).toBeNull();
    expect(worker.requests).toHaveLength(requestCount);
    expect(rejected).toBe(true);
  });
});
