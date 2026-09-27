import { z } from 'zod';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.number().int().min(0).max(59048);
const word = address;
const id = z.string().min(1).max(128);
const sourceKind = z.enum(['raw', 'normalized']);
const profile = z.enum(['bolgescope-tio-safe-v1', 'tio-c-safe-v1']);
const hex = z.string().regex(/^(?:[0-9a-fA-F]{2})*$/).max(2 * 1024 * 1024);

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.includes('\\')) return false;
  return path.split('/').every(component => component !== '' && component !== '.' && component !== '..' && component !== '\0');
}

const relativePath = z.string().max(4096).refine(isSafeRelativePath, 'Unsafe project path');
const runConfig = z.looseObject({
  inputHex: hex,
  closeInput: z.boolean(),
  maxInstructions: z.number().int().min(1).max(1_000_000),
  historyLimitMiB: z.number().int().min(1).max(256),
  outputLimitBytes: z.number().int().min(1).max(16 * 1024 * 1024),
});
export const projectSchema = z.looseObject({
  schemaVersion: z.literal(1),
  projectId: id,
  name: z.string().min(1).max(256),
  source: z.looseObject({ kind: sourceKind, path: relativePath }),
  semanticsProfile: profile,
  run: runConfig,
});
export type ProjectFile = z.infer<typeof projectSchema>;

const annotation = z.looseObject({
  annotationId: id,
  documentId: id,
  logicalDigest: digest,
  range: z.object({ start: address, end: z.number().int().min(1).max(59049) }).refine(range => range.end > range.start),
  name: z.string().max(128),
  note: z.string().max(8192),
  origin: z.literal('user'),
  sourceRevision: z.number().int().min(0),
  binding: z.enum(['valid', 'content-changed', 'review-required']),
});
export const notesSchema = z.looseObject({
  schemaVersion: z.literal(1),
  projectId: id,
  annotations: z.array(annotation).max(59049),
});
export type NotesFile = z.infer<typeof notesSchema>;

const expected = z.looseObject({
  outputHex: hex.optional(),
  terminal: z.enum(['NONE', 'HALTED', 'FAULTED']).optional(),
  stopReason: z.string().min(1).max(64).optional(),
  step: z.number().int().min(0).optional(),
  registers: z.object({ a: word.optional(), c: address.optional(), d: address.optional() }).optional(),
  memory: z.array(z.object({ address, value: word })).max(59049).optional(),
  dataWriteValues: z.array(z.object({ address, values: z.array(word).max(1_000_000) })).max(59049).optional(),
});
export const testCaseSchema = z.looseObject({
  schemaVersion: z.literal(1),
  testId: id,
  name: z.string().min(1).max(256),
  source: z.looseObject({ path: relativePath, kind: sourceKind, logicalDigest: digest.optional() }),
  inputHex: hex,
  closeInput: z.boolean(),
  maxInstructions: z.number().int().min(1).max(1_000_000),
  expected,
});
export type TestCase = z.infer<typeof testCaseSchema>;

export class FileSchemaError extends Error {
  constructor(readonly code: 'FILE_TOO_LARGE' | 'FILE_ENCODING' | 'FILE_SCHEMA_ERROR' | 'LEGACY_PROFILE_UNVERIFIED', message: string) {
    super(message);
    this.name = 'FileSchemaError';
  }
}

function parseFile<T>(bytes: Uint8Array, maxBytes: number, schema: z.ZodType<T>): T {
  if (bytes.length > maxBytes) throw new FileSchemaError('FILE_TOO_LARGE', `File exceeds ${maxBytes} bytes`);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) {
    if (error instanceof TypeError) throw new FileSchemaError('FILE_ENCODING', 'Invalid UTF-8');
    throw new FileSchemaError('FILE_SCHEMA_ERROR', 'Invalid JSON');
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new FileSchemaError('FILE_SCHEMA_ERROR', result.error.message);
  return result.data;
}

export function parseProjectFile(bytes: Uint8Array): ProjectFile { return parseFile(bytes, 1024 * 1024, projectSchema); }
export function parseNotesFile(bytes: Uint8Array): NotesFile { return parseFile(bytes, 1024 * 1024, notesSchema); }
export function parseTestCaseFile(bytes: Uint8Array): TestCase { return parseFile(bytes, 1024 * 1024, testCaseSchema); }
export function requireExecutableProject(project: ProjectFile): ProjectFile {
  if (project.semanticsProfile === 'tio-c-safe-v1') throw new FileSchemaError('LEGACY_PROFILE_UNVERIFIED', 'Legacy profile requires explicit migration');
  return project;
}
