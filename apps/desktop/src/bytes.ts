export function parseHex(text: string): Uint8Array {
  const compact = text.replace(/[\s,]+/g, '');
  if (compact.length % 2 !== 0) throw new Error('Hex 입력은 두 자리씩 입력하세요.');
  if (!/^[0-9a-fA-F]*$/.test(compact)) throw new Error('Hex 입력에는 0–9와 A–F만 사용할 수 있습니다.');
  return Uint8Array.from(compact.match(/../g)?.map(pair => Number.parseInt(pair, 16)) ?? []);
}

export function inputBytes(text: string, mode: 'text' | 'hex', appendLf: boolean): Uint8Array {
  const bytes = mode === 'text' ? new TextEncoder().encode(text) : parseHex(text);
  return appendLf ? Uint8Array.from([...bytes, 10]) : bytes;
}

export function hexBytes(bytes: readonly number[]): string {
  return bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function escapedBytes(bytes: readonly number[]): string {
  return bytes.map(byte => byte >= 32 && byte <= 126 && byte !== 92 ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('');
}

export function outputText(bytes: readonly number[]): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
}
