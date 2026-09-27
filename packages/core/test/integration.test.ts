import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { loadProgram, MalbolgeMachine } from '../src/index.js';

const fixture = readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url));

it('keeps a bounded execution slice running without cloning state per instruction', () => {
  const machine = new MalbolgeMachine(loadProgram(fixture));
  machine.appendInput([65, 66, 67, 10]);
  machine.closeInput();
  const snapshots = vi.spyOn(machine, 'getState');
  const first = machine.runSlice(100, 4, 8);
  expect(first.executed).toBe(4);
  expect(first.state.phase).toBe('RUNNING');
  expect(first.state.reason).toBe('NONE');
  expect(snapshots).toHaveBeenCalledTimes(1);
  const last = machine.runSlice(100, 4096, 8);
  expect(last.state.phase).toBe('HALTED');
  expect(last.state.head.step).toBe(24);
});

it('counts committed access roles and restores them across Back, replay, and history eviction', () => {
  const machine = new MalbolgeMachine(loadProgram(fixture), 800);
  machine.appendInput([65, 66, 67, 10]);
  machine.closeInput();
  for (let index = 0; index < 4; index++) machine.step();
  const after = machine.getState().eventIndex;
  expect(machine.getRoleCounts(3)).toMatchObject({ fetch: 1, encryption: 1 });
  expect(machine.getRoleCounts(78)).toMatchObject({ dataRead: 1, dataWrite: 1 });
  machine.stepBack();
  expect(machine.getRoleCounts(3)).toMatchObject({ fetch: 0, encryption: 0 });
  expect(machine.getRoleCounts(78)).toMatchObject({ dataRead: 0, dataWrite: 0 });
  machine.step();
  expect(machine.getRoleCounts(3)).toMatchObject({ fetch: 1, encryption: 1 });
  expect(machine.queryPoint(after - 1, 78, 1).roles.dataWrite[0]).toBe(0);
  expect(machine.queryPoint(after, 78, 1).roles.dataWrite[0]).toBe(1);
  for (let index = 4; index < 24; index++) machine.step();
  expect(machine.getState().earliestEventIndex).toBeGreaterThan(0);
  expect(machine.getRoleCounts(0).fetch).toBe(1);
  expect(machine.queryPoint(machine.getState().earliestEventIndex, 0, 1).roles.fetch[0]).toBe(1);
});
