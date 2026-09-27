export const MEMORY_SIZE = 59049 as const;
export const EOF_WORD = 59048 as const;
export const PROFILE_ID = 'bolgescope-tio-safe-v1' as const;
export const PROFILE_DIGEST = '89a6017fcef25accef972c9fc4cd444f911b41f54e8db694c4722012443edb74' as const;

const XLAT1 = '+b(29e*j1VMEKLyC})8&m#~W>qxdRp0wkrUo[D7,XTcA"lI' +
  '.v%{gJh4G\\-=O@5`_3i<?Z\';FNQuY]szf$!BS/|t:Pn6^Ha';
const XLAT2 = '5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1C' +
  'B6v^=I_0/8|jsb9m<.TVac`uY*MK\'X~xDl}REokN:#?G"i@';
const VALID = new Set(['i', '<', '/', '*', 'j', 'p', 'o', 'v']);
const CRAZY = [
  [4, 3, 3, 1, 0, 0, 1, 0, 0],
  [4, 3, 5, 1, 0, 2, 1, 0, 2],
  [5, 5, 4, 2, 2, 1, 2, 2, 1],
  [4, 3, 3, 1, 0, 0, 7, 6, 6],
  [4, 3, 5, 1, 0, 2, 7, 6, 8],
  [5, 5, 4, 2, 2, 1, 8, 8, 7],
  [7, 6, 6, 7, 6, 6, 4, 3, 3],
  [7, 6, 8, 7, 6, 8, 4, 3, 5],
  [8, 8, 7, 8, 8, 7, 5, 5, 4],
] as const;

export function decode(raw: number, address: number): string {
  if (!Number.isInteger(raw) || raw < 33 || raw > 126 || !Number.isInteger(address) || address < 0 || address >= MEMORY_SIZE) return '';
  return XLAT1[(raw - 33 + address) % 94] ?? '';
}

export function encode(symbol: string, address: number): number {
  if (!VALID.has(symbol) || !Number.isInteger(address) || address < 0 || address >= MEMORY_SIZE) throw new RangeError('Invalid instruction or address');
  const residue = XLAT1.indexOf(symbol) + 33;
  return 33 + (((residue - address - 33) % 94) + 94) % 94;
}

export function isInitialOpcode(symbol: string): boolean { return VALID.has(symbol); }

export function encrypt(value: number): number | null {
  if (!Number.isInteger(value) || value < 33 || value > 127) return null;
  return value === 127 ? 0 : XLAT2.charCodeAt(value - 33);
}

export function crazy(x: number, y: number): number {
  let result = 0;
  for (let place = 1; place < MEMORY_SIZE; place *= 9) {
    result += (CRAZY[Math.floor(y / place) % 9]?.[Math.floor(x / place) % 9] ?? 0) * place;
  }
  return result;
}

export function rotate(value: number): number { return Math.floor(value / 3) + (value % 3) * 19683; }

export function nextAddress(value: number): number { return value === EOF_WORD ? 0 : value + 1; }
