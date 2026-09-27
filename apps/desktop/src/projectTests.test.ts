import { expect, it } from 'vitest';
import { parseTestCaseFile } from '@bolgescope/contracts';
import { editedTestCase } from './ProjectTestsPanel';

it('runs the edited input, EOF, and budget fields from a loaded test', () => {
  const original = parseTestCaseFile(new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1, testId: crypto.randomUUID(), name: 'edited form',
    source: { path: 'programs/main.mb', kind: 'raw' },
    inputHex: '41', closeInput: false, maxInstructions: 100,
    expected: { outputHex: '41', terminal: 'HALTED' },
  })));
  expect(editedTestCase(original, '42', true, 2)).toMatchObject({ inputHex: '42', closeInput: true, maxInstructions: 2 });
  expect(() => editedTestCase(original, 'GG', true, 2)).toThrow();
});
