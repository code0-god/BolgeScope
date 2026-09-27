import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeClient } from '../src/client.ts';
import { TestWorkerClient } from '../src/test-client.ts';
import { encode } from '@bolgescope/core';

const fixture = readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url), 'utf8');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const bridges = [];

class Bridge {
  onmessage = null;
  onerror = null;
  constructor(testRunner = false) {
    this.node = new NodeWorker(new URL('./worker-entry.mjs', import.meta.url), { workerData: { testRunner } });
    this.ready = new Promise((resolve, reject) => {
      this.node.on('message', message => { if (message.ready) resolve(); else this.onmessage?.({ data: message }); });
      this.node.on('error', error => { this.onerror?.({ message: error.message }); reject(error); });
    });
    bridges.push(this);
  }
  postMessage(value) { this.node.postMessage(value); }
  terminate() { return this.node.terminate(); }
}
afterEach(async () => { await Promise.all(bridges.splice(0).map(bridge => bridge.terminate())); });

async function client() { const bridge = new Bridge(); await bridge.ready; return new RuntimeClient(bridge); }
async function until(runtime, predicate) {
  for (let i = 0; i < 300; i++) { const state = await runtime.getState(); if (predicate(state)) return state; await delay(10); }
  throw new Error('State timeout');
}

describe('real runtime worker', () => {
  it('waits for one byte and commits exactly one Step', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    let state = await runtime.step();
    while (state.phase !== 'WAITING_INPUT' && state.phase !== 'HALTED') state = await runtime.step();
    expect(state.phase).toBe('WAITING_INPUT');
    const before = state.head.step;
    state = await runtime.appendInput([65, 66]);
    expect(state.head.step).toBe(before + 1);
    expect(state.head.tape.cursor).toBe(1);
  });
  it('preserves a session after failed load and clears it after stop', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    const before = await runtime.step();
    await expect(runtime.load('!')).rejects.toThrow();
    expect((await runtime.getState()).head).toEqual(before.head);
    await runtime.stop();
    expect(runtime.getCurrentState()).toBeNull();
    await expect(runtime.getState()).rejects.toThrow(/SESSION_MISMATCH/);
  });
  it('finishes the fixture on Run with a live memory query', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    await runtime.appendInput([65, 66, 67, 10]);
    await runtime.closeInput();
    await runtime.run();
    const state = await until(runtime, current => current.phase === 'HALTED');
    expect(state.head.step).toBe(24);
    expect(Array.from(await runtime.queryMemory(78, 1))).toEqual([29514]);
    expect(Array.from(await runtime.getOutput())).toEqual([0x4a]);
  });
  it('stops a write watchpoint and keeps a historical query read-only', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    await runtime.appendInput([65, 66, 67, 10]);
    await runtime.closeInput();
    await runtime.setWatchpoints([{ address: 78, roles: ['data-write'] }]);
    await runtime.run(100);
    const state = await until(runtime, current => current.reason === 'WATCHPOINT');
    const point = await runtime.queryPoint(2, 78, 1);
    expect(point.head.step).toBe(0);
    expect((await runtime.getState()).eventIndex).toBe(state.eventIndex);
    await runtime.rewindTo(2);
    expect((await runtime.getState()).head.step).toBe(0);
  });
  it('exports a bounded trace with a verifiable footer', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    await runtime.appendInput([65, 66, 67, 10]);
    await runtime.closeInput();
    await runtime.run();
    await until(runtime, state => state.phase === 'HALTED');
    let chunk = await runtime.beginTraceExport(false, false);
    const parts = [];
    while (chunk.bytes.length) {
      expect(chunk.bytes.length).toBeLessThanOrEqual(65536);
      parts.push(chunk.bytes);
      chunk = await runtime.ackTraceExport(chunk.exportId, chunk.chunkIndex);
    }
    const text = Buffer.concat(parts).toString('utf8');
    const lines = text.trimEnd().split('\n');
    const footer = JSON.parse(lines.at(-1));
    const body = `${lines.slice(0, -1).join('\n')}\n`;
    expect(footer.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(JSON.parse(lines[0]).privacyWarning).toContain('may reveal input');
    expect(text).toContain('"bytes":null');
  });
  it('deduplicates an in-flight input request by ID', async () => {
    const bridge = new Bridge();
    await bridge.ready;
    const responses = [];
    bridge.node.on('message', message => { if (message.requestId) responses.push(message); });
    bridge.postMessage({ protocolVersion: 1, clientEpoch: 1, requestId: 'load', requestSequence: 1, command: 'load', payload: { source: fixture, kind: 'raw' } });
    for (let i = 0; responses.length < 1 && i < 100; i++) await delay(10);
    const sessionId = responses[0]?.sessionId;
    expect(sessionId).toBeTruthy();
    const append = { protocolVersion: 1, clientEpoch: 1, requestId: 'input', requestSequence: 2, sessionId, command: 'appendInput', payload: { bytes: [65] } };
    bridge.postMessage(append);
    bridge.postMessage(append);
    for (let i = 0; responses.length < 3 && i < 100; i++) await delay(10);
    expect(responses[1]?.result).toEqual(responses[2]?.result);
    bridge.postMessage({ protocolVersion: 1, clientEpoch: 1, requestId: 'state', requestSequence: 3, sessionId, command: 'getState', payload: {} });
    for (let i = 0; responses.length < 4 && i < 100; i++) await delay(10);
    expect(responses[3]?.result.value.head.tape.visibleLength).toBe(1);
  });
  it('branches after a receipt and rejects stale branch requests', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    await runtime.appendInput([65]);
    await runtime.step();
    await runtime.rewindTo(1);
    const old = await runtime.getState();
    await expect(runtime.createBranch([74], true, '')).rejects.toThrow();
    const branch = await runtime.createBranch([74], true, 'native-save-complete');
    expect(branch.branchId).not.toBe(old.branchId);
    expect(branch.eventIndex).toBe(0);
    expect((await runtime.getState()).branchId).toBe(branch.branchId);
  });
  it('runs the regression case in a separate test Worker', async () => {
    const bridge = new Bridge(true);
    await bridge.ready;
    const tests = new TestWorkerClient(bridge);
    const result = await tests.run({
      schemaVersion: 1, testId: 'recurrent-87', name: '87-cell C fixture',
      source: { path: 'program.mb', kind: 'raw' }, inputHex: '4142430a', closeInput: true,
      maxInstructions: 100, expected: { outputHex: '4a', terminal: 'HALTED', step: 24,
        registers: { a: 29514, c: 23, d: 80 }, memory: [{ address: 78, value: 29514 }] },
    }, Buffer.from(fixture));
    expect(result.status).toBe('PASSED');
    expect(result.failures).toEqual([]);
  });
  it('returns one bounded point-consistent view bundle', async () => {
    const runtime = await client();
    await runtime.load(fixture);
    await runtime.appendInput([65]);
    for (let index = 0; index < 4; index++) await runtime.step();
    const live = await runtime.getState();
    const point = await runtime.queryView({ eventIndex: live.eventIndex - 1, memoryRanges: [{ start: 78, count: 1 }], selectedAddress: 78, historyLimit: 200 });
    expect(point.sessionId).toBeTruthy();
    expect(point.liveState.eventIndex).toBe(live.eventIndex);
    expect(point.point?.head.step).toBe(3);
    expect(point.pages[0]?.current[0]).toBe(84);
    expect(point.pages[0]?.roles.dataWrite[0]).toBe(0);
    expect(point.history.length).toBeLessThanOrEqual(200);
    expect((await runtime.getState()).eventIndex).toBe(live.eventIndex);
    await expect(runtime.queryView({ memoryRanges: [{ start: 0, count: 59049 }] })).rejects.toThrow(/INVALID_REQUEST/);
  });
  it('keeps Run active across bounded slices and rejects overlapping Step', async () => {
    const runtime = await client();
    const source = Array.from({ length: 20_000 }, (_, address) => String.fromCharCode(encode(address === 19_999 ? 'v' : 'o', address))).join('');
    await runtime.load(source);
    const running = await runtime.run(20_000);
    expect(running.phase).toBe('RUNNING');
    await expect(runtime.step()).rejects.toThrow(/BUSY/);
    const state = await until(runtime, current => current.phase === 'HALTED');
    expect(state.head.step).toBe(20_000);
  });
});
