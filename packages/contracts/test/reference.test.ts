import { readFileSync } from 'node:fs';
import { loadProgram, MalbolgeMachine } from '@bolgescope/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = new URL('../../../evidence/supervisor/', import.meta.url);
const beforeSchema = z.object({ kind: z.literal('before'), step: z.number(), a: z.number(), c: z.number(), d: z.number(), raw: z.number(), decoded: z.number() });
const afterSchema = z.object({ kind: z.literal('after'), step: z.number(), a: z.number(), c: z.number(), d: z.number(), halted: z.boolean() });
const readSchema = z.object({ kind: z.literal('read'), role: z.enum(['fetch', 'data-read']), order: z.number(), address: z.number(), value: z.number() });
const writeSchema = z.object({ kind: z.literal('write'), role: z.enum(['data-write', 'encryption']), order: z.number(), address: z.number(), before: z.number(), after: z.number() });
const inputSchema = z.object({ kind: z.literal('input'), value: z.number(), eof: z.boolean() });
const outputSchema = z.object({ kind: z.literal('output'), byte: z.number() });
const kindSchema = z.object({ kind: z.string() });

type Step = { before: z.infer<typeof beforeSchema>; after: z.infer<typeof afterSchema>; events: unknown[] };
function parseTrace(path: URL): Step[] {
  const steps: Step[] = [];
  let before: Step['before'] | null = null;
  let events: unknown[] = [];
  for (const line of readFileSync(path, 'utf8').trimEnd().split('\n')) {
    const event: unknown = JSON.parse(line);
    switch (kindSchema.parse(event).kind) {
      case 'before': before = beforeSchema.parse(event); events = []; break;
      case 'after': {
        if (!before) throw new Error('C trace has an after without before');
        steps.push({ before, after: afterSchema.parse(event), events });
        before = null;
        events = [];
        break;
      }
      case 'read': case 'write': case 'input': case 'output': events.push(event); break;
    }
  }
  return steps;
}

function checkMemory(machine: Uint16Array, path: URL): void {
  const expected = readFileSync(path);
  expect(expected.length).toBe(59049 * 2);
  for (let address = 0; address < 59049; address++) {
    expect(machine[address], `M[${address}]`).toBe(expected.readUInt16LE(address * 2));
  }
}

const cases = [
  { name: 'abc-lf', source: 'cases/abc-lf', input: '4142430a' },
  { name: 'zeros', source: 'cases/zeros', input: '30303030' },
  { name: 'last-one', source: 'cases/last-one', input: '30303031' },
  { name: 'alternating', source: 'cases/alternating', input: '30313031' },
  { name: 'high-bytes', source: 'cases/high-bytes', input: '007f80ff' },
  { name: 'closed-empty', source: 'cases/closed-empty', input: '' },
  { name: 'single-byte-echo', source: 'extended/single-byte-echo', input: 'ff' },
  { name: 'zero-byte-output', source: 'extended/zero-byte-output', input: '' },
  { name: 'movd-post-increment', source: 'extended/movd-post-increment', input: '' },
  { name: 'jump-encrypt-target', source: 'extended/jump-encrypt-target', input: '' },
  { name: 'ordered-same-cell-writes', source: 'extended/ordered-same-cell-writes', input: '' },
  { name: 'revisit', source: 'extended/revisit-search-003', input: '4142430a' },
] as const;

describe('independent bounded C interpreter differential', () => {
  for (const item of cases) it(item.name, () => {
    const source = item.source.startsWith('cases/')
      ? readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url))
      : readFileSync(new URL(`${item.source}/program.mb`, root));
    const program = loadProgram(source);
    const machine = new MalbolgeMachine(program);
    checkMemory(program.initialMemory, new URL(`${item.source}/initial.u16`, root));
    const input = item.input.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? [];
    if (input.length) machine.appendInput(input);
    machine.closeInput();
    for (const expected of parseTrace(new URL(`${item.source}/trace.jsonl`, root))) {
      const state = machine.step();
      const tx = state.lastTransaction;
      expect(tx, `step ${expected.after.step}`).not.toBeNull();
      if (!tx) continue;
      expect(tx.before.registers).toEqual({ a: expected.before.a, c: expected.before.c, d: expected.before.d });
      expect(tx.fetchAddress).toBe(expected.before.c);
      expect(tx.fetchedRaw).toBe(expected.before.raw);
      expect(tx.decodedSymbol).toBe(String.fromCharCode(expected.before.decoded));
      expect(tx.reads).toEqual(expected.events.filter(event => kindSchema.parse(event).kind === 'read').map(event => {
        const read = readSchema.parse(event);
        return { role: read.role, order: read.order, address: read.address, value: read.value };
      }));
      expect(tx.writes).toEqual(expected.events.filter(event => kindSchema.parse(event).kind === 'write').map(event => {
        const write = writeSchema.parse(event);
        return { role: write.role, order: write.order, address: write.address, before: write.before, after: write.after };
      }));
      const inputEvent = expected.events.find(event => kindSchema.parse(event).kind === 'input');
      if (inputEvent) {
        const read = inputSchema.parse(inputEvent);
        expect(tx.input).toEqual(read.eof ? { kind: 'eof' } : { kind: 'byte', value: read.value });
      } else expect(tx.input).toBeNull();
      expect(tx.output).toEqual(expected.events.filter(event => kindSchema.parse(event).kind === 'output').map(event => outputSchema.parse(event).byte));
      expect(tx.after.registers).toEqual({ a: expected.after.a, c: expected.after.c, d: expected.after.d });
      expect(state.head.step).toBe(expected.after.step);
      expect(state.head.terminal === 'HALTED').toBe(expected.after.halted);
    }
    checkMemory(machine.getMemory(), new URL(`${item.source}/final.u16`, root));
  });
});
