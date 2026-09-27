import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeTestCase, FileSchemaError, parseProjectFile, parseTestCaseFile, requireExecutableProject } from '../src/index.js';

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const project = {
  schemaVersion: 1, projectId: 'test-project', name: 'Test',
  source: { kind: 'raw', path: 'programs/main.mb' }, semanticsProfile: 'bolgescope-tio-safe-v1',
  run: { inputHex: '4142430A', closeInput: true, maxInstructions: 1_000_000, historyLimitMiB: 64, outputLimitBytes: 1_048_576 },
};

describe('portable file contracts', () => {
  it('rejects path traversal and keeps legacy profile explicit', () => {
    expect(() => parseProjectFile(bytes({ ...project, source: { kind: 'raw', path: '../escape.mb' } }))).toThrow(FileSchemaError);
    const legacy = parseProjectFile(bytes({ ...project, semanticsProfile: 'tio-c-safe-v1' }));
    expect(() => requireExecutableProject(legacy)).toThrowError(/Legacy profile/);
    expect(requireExecutableProject(parseProjectFile(bytes(project))).source.path).toBe('programs/main.mb');
  });

  it('runs the 87-cell case through the real core and compares ordered writes', async () => {
    const test = parseTestCaseFile(bytes({
      schemaVersion: 1, testId: 'recurrent', name: '87-cell regression',
      source: { path: 'programs/recurrent_crazy4.mb', kind: 'raw' },
      inputHex: '4142430A', closeInput: true, maxInstructions: 100,
      expected: {
        outputHex: '4A', terminal: 'HALTED', stopReason: 'HALT_OPCODE', step: 24,
        registers: { a: 29514, c: 23, d: 80 }, memory: [{ address: 78, value: 29514 }],
        dataWriteValues: [{ address: 78, values: [29487, 29485, 29484, 29514] }],
      },
    }));
    const fixture = readFileSync('../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb');
    const result = await executeTestCase(test, fixture);
    expect(result.status, result.failures.join('\n')).toBe('PASSED');
  });
});
