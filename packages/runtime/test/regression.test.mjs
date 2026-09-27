import { readFileSync } from 'node:fs';
import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, expect, it } from 'vitest';
import { RuntimeClient } from '../src/client.ts';
const fixture = readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url), 'utf8');
const bridges = [];
class Bridge {
  onmessage = null;
  onerror = null;
  constructor() {
    this.node = new NodeWorker(new URL('./worker-entry.mjs', import.meta.url));
    this.ready = new Promise((resolve, reject) => {
      this.node.on('message', message => { if (message.ready) resolve(); else this.onmessage?.({ data: message }); });
      this.node.on('error', error => { this.onerror?.({ message: error.message }); reject(error); });
    });
    bridges.push(this);
  }
  postMessage(message) { this.node.postMessage(message); }
  terminate() { return this.node.terminate(); }
}
afterEach(async () => { await Promise.all(bridges.splice(0).map(bridge => bridge.terminate())); });
async function client() { const bridge = new Bridge(); await bridge.ready; const runtime = new RuntimeClient(bridge); await runtime.load(fixture); return runtime; }
async function until(runtime, predicate) {
  for (let n = 0; n < 100; n++) { const state = await runtime.getState(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Expected state was not reached');
}
it('Continue bypasses a stopped breakpoint exactly once in the real Worker', async () => {
  const runtime = await client();
  await runtime.appendInput([65, 66, 67, 10]);
  await runtime.setBreakpoints([3]);
  await runtime.run(100);
  const before = await until(runtime, state => state.reason === 'BREAKPOINT');
  expect(before.head.step).toBe(3);
  await runtime.run(100);
  const after = await until(runtime, state => state.phase !== 'RUNNING');
  expect(after.phase).toBe('HALTED');
  expect(after.head.step).toBe(24);
});
it('waiting Run can be changed to a one-instruction Step', async () => {
  const runtime = await client();
  await runtime.run(100);
  const before = await until(runtime, state => state.phase === 'WAITING_INPUT');
  await runtime.step();
  const after = await runtime.appendInput([65, 66]);
  expect(after.phase).toBe('PAUSED');
  expect(after.head.step).toBe(before.head.step + 1);
  expect(after.head.tape.cursor).toBe(1);
});
it('waiting Step can be changed to Run without inventing EOF', async () => {
  const runtime = await client();
  await runtime.step(); await runtime.step();
  expect((await runtime.step()).phase).toBe('WAITING_INPUT');
  await runtime.run(100);
  await runtime.appendInput([65, 66, 67, 10]);
  expect((await until(runtime, state => state.phase === 'HALTED')).output).toEqual([74]);
});
it('Back cancels a waiting Run and restores the previous instruction', async () => {
  const runtime = await client(); await runtime.run(100);
  const before = await until(runtime, state => state.phase === 'WAITING_INPUT');
  const back = await runtime.stepBack();
  expect(back.head.step).toBe(before.head.step - 1);
  expect(back.phase).toBe('PAUSED');
  // New input at a rewound cursor must be an explicit branch, not an append.
  await expect(runtime.appendInput([65])).rejects.toThrow(/BRANCH_REQUIRED/);
  expect((await runtime.getState()).head.step).toBe(back.head.step);
  expect((await runtime.step()).head.step).toBe(before.head.step);
});
it('selecting the latest Timeline row still returns an explicit history view', async () => {
  const runtime = await client(); const state = await runtime.step();
  const bundle = await runtime.queryView({ eventIndex: state.eventIndex, memoryRanges: [{ start: 0, count: 64 }] });
  expect(bundle.point).not.toBeNull();
  expect(bundle.point?.head).toEqual(state.head);
  expect(bundle.pointEventIndex).toBe(state.eventIndex);
});
it('records the exact parent point when creating a branch', async () => {
  const runtime = await client(); await runtime.appendInput([65, 66]);
  for (let n = 0; n < 4; n++) await runtime.step();
  const parent = await runtime.rewindTo(3);
  const branch = await runtime.createBranch([74], true, 'saved-parent-trace');
  expect(branch.parentBranch).toEqual({ branchId: parent.branchId, eventIndex: parent.eventIndex });
});
it('Stop remains available while trace chunks await acknowledgement', async () => {
  const runtime = await client(); await runtime.step();
  const trace = await runtime.beginTraceExport(true, true);
  expect(trace.bytes.length).toBeGreaterThan(0);
  await runtime.stop();
  expect(runtime.getCurrentState()).toBeNull();
  await runtime.load(fixture);
  expect((await runtime.step()).head.step).toBe(1);
});
it('rewinding a waiting Run clears its old automatic resume intent', async () => {
  const runtime = await client(); await runtime.run(100);
  await until(runtime, state => state.phase === 'WAITING_INPUT');
  await runtime.rewindTo(0);
  await runtime.run(100);
  expect((await until(runtime, state => state.phase === 'WAITING_INPUT')).head.step).toBe(2);
});
