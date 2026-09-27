import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeSource } from '../src/source.js';
const source = readFileSync(new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url), 'utf8');
it('keeps a BOM visible in rejected-source UTF-16 mapping', () => {
  const result = analyzeSource(`\uFEFF${source}`);
  expect(result.diagnostics[0]?.code).toBe('LOAD_INVALID_ENCODING');
  expect(result.diagnostics[0]?.span).toMatchObject({ utf16Start: 0, utf16End: 1, byteStart: 0, byteEnd: 3 });
  expect(result.sourceMap[0]?.span.utf16Start).toBe(1);
});
it('bounds oversized editor input before per-character analysis', () => {
  const result = analyzeSource(' '.repeat(2 * 1024 * 1024 + 1));
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]?.code).toBe('SOURCE_FILE_TOO_LARGE');
  expect(result.rawSource.length).toBe(2 * 1024 * 1024 + 1);
});
it('caps diagnostic payload without turning invalid input valid', () => {
  const result = analyzeSource('\0'.repeat(4000));
  expect(result.diagnostics.length).toBeLessThanOrEqual(201);
  expect(result.diagnostics.at(-1)?.code).toBe('DIAGNOSTICS_TRUNCATED');
});
