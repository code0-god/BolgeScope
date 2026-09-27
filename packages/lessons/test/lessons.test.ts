import { readFileSync } from 'node:fs';
import { loadProgram, MalbolgeMachine } from '@bolgescope/core';
import { expect, it } from 'vitest';
import { judgeLesson } from '../src/index.js';

it('judges the first five lessons from codec and actual VM events', () => {
  const fixture = readFileSync('../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb');
  const machine = new MalbolgeMachine(loadProgram(fixture));
  expect(judgeLesson('L01', '/,j', machine.getState(), [])).toMatchObject({ correct: true, observed: true });
  machine.step();
  expect(judgeLesson('L03', '41,1', machine.getState(), machine.getHistory()).correct).toBe(true);
  machine.step();
  machine.step();
  expect(judgeLesson('L02', 'WAITING_INPUT', machine.getState(), machine.getHistory()).correct).toBe(true);
  machine.appendInput([65]);
  machine.step();
  machine.step();
  expect(judgeLesson('L04', '78,29487', machine.getState(), machine.getHistory()).correct).toBe(true);
  expect(judgeLesson('L05', '59,92', machine.getState(), machine.getHistory()).correct).toBe(true);
});

it('judges a C-verified actual revisit from two observed fetches', () => {
  const source = readFileSync('../core/fixtures/revisit.mb');
  const machine = new MalbolgeMachine(loadProgram(source));
  machine.appendInput([0x41, 0x42, 0x43, 0x0a]);
  machine.closeInput();
  for (let index = 0; index < 9; index++) machine.step();
  expect(judgeLesson('L06', 'o,C', machine.getState(), machine.getHistory())).toMatchObject({ correct: true, observed: true });
  expect(judgeLesson('L06', 'o,c', machine.getState(), machine.getHistory()).correct).toBe(false);
});
