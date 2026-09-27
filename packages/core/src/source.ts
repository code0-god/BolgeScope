import { crazy, decode, encode, isInitialOpcode, MEMORY_SIZE, PROFILE_DIGEST, PROFILE_ID } from './codec.js';

export type SourceKind = 'raw' | 'normalized';
export type Span = Readonly<{ utf16Start: number; utf16End: number; byteStart: number; byteEnd: number; line: number; column: number }>;
export type SourceCell = Readonly<{ address: number; raw: number; symbol: string; span: Span }>;
export type Diagnostic = Readonly<{ code: string; message: string; span?: Span; address?: number }>;
export type Analysis = Readonly<{ kind: SourceKind; rawSource: Uint8Array; logicalSource: Uint8Array; sourceMap: readonly SourceCell[]; diagnostics: readonly Diagnostic[] }>;
export type Program = Readonly<{ analysis: Analysis; initialMemory: Uint16Array; profile: Readonly<{ id: typeof PROFILE_ID; contractDigest: typeof PROFILE_DIGEST }> }>;
export type SourceExecutionRelation = 'same-text' | 'same-image' | 'different' | 'invalid';
export type SourceIdentity = Readonly<{
  documentId: string;
  text: string;
  kind: SourceKind;
  analysis: Analysis;
  profile: Readonly<{ id: string; contractDigest: string }>;
}>;

export class LoadError extends Error {
  constructor(readonly diagnostics: readonly Diagnostic[]) { super(diagnostics[0]?.message ?? 'Invalid source'); this.name = 'LoadError'; }
}

function isSpace(byte: number): boolean { return byte === 32 || (byte >= 9 && byte <= 13); }
function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function classifySourceRelation(current: SourceIdentity, executed: SourceIdentity): SourceExecutionRelation {
  if (current.analysis.diagnostics.length || executed.analysis.diagnostics.length) return 'invalid';
  if (current.documentId !== executed.documentId ||
    current.kind !== executed.kind ||
    current.profile.id !== executed.profile.id ||
    current.profile.contractDigest !== executed.profile.contractDigest) return 'different';
  if (current.text === executed.text) return 'same-text';
  return bytesEqual(current.analysis.logicalSource, executed.analysis.logicalSource) ? 'same-image' : 'different';
}

export function analyzeSource(source: string | Uint8Array, kind: SourceKind = 'raw'): Analysis {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source.slice();
  // An IDE resource limit, separate from the 59,049-cell language limit.
  if (bytes.length > 2 * 1024 * 1024) return { kind, rawSource: bytes, logicalSource: new Uint8Array(), sourceMap: [],
    diagnostics: [{ code: 'SOURCE_FILE_TOO_LARGE', message: 'Source file exceeds the IDE 2 MiB limit; original bytes are preserved' }] };
  const cells: SourceCell[] = [];
  const diagnostics: Diagnostic[] = [];
  let omittedDiagnostics = 0;
  const diagnose = (diagnostic: Diagnostic): void => {
    if (diagnostics.length < 200) diagnostics.push(diagnostic); else omittedDiagnostics++;
  };
  const raw = bytes.slice();
  let line = 1;
  let column = 1;
  let utf16 = 0;
  let address = 0;
  for (let offset = 0; offset < bytes.length; offset++) {
    const byte = bytes[offset] ?? 0;
    let width = 1;
    let utf16Width = 1;
    if (byte >= 128) {
      const expected = byte >= 240 && byte <= 244 ? 4 : byte >= 224 && byte <= 239 ? 3 : byte >= 194 && byte <= 223 ? 2 : 1;
      if (expected > 1 && offset + expected <= bytes.length) {
        try {
          const character = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset, offset + expected));
          width = expected;
          utf16Width = character.length;
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      }
    }
    const span: Span = { utf16Start: utf16, utf16End: utf16 + utf16Width, byteStart: offset, byteEnd: offset + width, line, column };
    if (!isSpace(byte)) {
      if (byte < 33 || byte > 126) diagnose({ code: 'LOAD_INVALID_ENCODING', message: `Non-graphical ASCII at byte ${offset}`, span });
      else if (address >= MEMORY_SIZE) diagnose({ code: 'LOAD_TOO_LONG', message: 'Program exceeds 59049 cells', span });
      else {
        const symbol = kind === 'raw' ? decode(byte, address) : String.fromCharCode(byte);
        if (!isInitialOpcode(symbol)) diagnose({ code: 'LOAD_INVALID_OPCODE', message: `Invalid instruction at address ${address}`, span, address });
        const value = kind === 'raw' || !isInitialOpcode(symbol) ? byte : encode(symbol, address);
        cells.push({ address, raw: value, symbol, span });
        if (kind === 'normalized' && isInitialOpcode(symbol)) raw[offset] = value;
      }
      address++;
    }
    if (byte === 13) { line++; column = 1; }
    else if (byte === 10) { if (bytes[offset - 1] !== 13) line++; column = 1; }
    else column += utf16Width;
    utf16 += utf16Width;
    offset += width - 1;
  }
  if (address < 2) diagnostics.unshift({ code: 'LOAD_TOO_SHORT', message: 'Program requires at least two instructions' });
  if (omittedDiagnostics) diagnostics.push({ code: 'DIAGNOSTICS_TRUNCATED', message: `${omittedDiagnostics} additional source errors omitted` });
  return { kind, rawSource: raw, logicalSource: Uint8Array.from(cells.map(cell => cell.raw)), sourceMap: cells, diagnostics };
}

export function loadProgram(source: string | Uint8Array, kind: SourceKind = 'raw'): Program {
  const analysis = analyzeSource(source, kind);
  if (analysis.diagnostics.length) throw new LoadError(analysis.diagnostics);
  const initialMemory = new Uint16Array(MEMORY_SIZE);
  initialMemory.set(analysis.logicalSource);
  for (let address = analysis.logicalSource.length; address < MEMORY_SIZE; address++) {
    initialMemory[address] = crazy(initialMemory[address - 1] ?? 0, initialMemory[address - 2] ?? 0);
  }
  return { analysis, initialMemory, profile: { id: PROFILE_ID, contractDigest: PROFILE_DIGEST } };
}
