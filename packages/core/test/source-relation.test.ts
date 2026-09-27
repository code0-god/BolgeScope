import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  classifySourceRelation,
  encode,
  loadProgram,
  PROFILE_DIGEST,
  PROFILE_ID,
  type SourceKind,
} from '../src/index';

const source = readFileSync(
  new URL('../../../docs/desktop-v0.1/fixtures/recurrent_crazy4.mb', import.meta.url),
  'utf8',
);
const profile = { id: PROFILE_ID, contractDigest: PROFILE_DIGEST };

function descriptor(
  documentId: string,
  text: string,
  kind: SourceKind = 'raw',
  executionProfile: Readonly<{ id: string; contractDigest: string }> = profile,
) {
  return {
    documentId,
    text,
    kind,
    analysis: analyzeSource(text, kind),
    profile: executionProfile,
  };
}

describe('source and execution image relation', () => {
  it('distinguishes same text, same image, and different identities', () => {
    // Given one executed source snapshot.
    const executed = descriptor('raw:one', source);
    const noWhitespace = source.replace(/[\t\n\v\f\r ]/g, '');

    // When current documents vary by layout, program, document, or profile.
    const relations = {
      exact: classifySourceRelation(descriptor('raw:one', source), executed),
      whitespace: classifySourceRelation(descriptor('raw:one', ` \t${noWhitespace}\r\n`), executed),
      changedProgram: classifySourceRelation(
        descriptor('raw:one', `${String.fromCharCode(encode('o', 0))}${noWhitespace.slice(1)}`),
        executed,
      ),
      otherDocument: classifySourceRelation(descriptor('raw:two', source), executed),
      otherProfile: classifySourceRelation(
        descriptor('raw:one', source, 'raw', { id: 'other-profile', contractDigest: PROFILE_DIGEST }),
        executed,
      ),
    };

    // Then only exact text and valid ASCII-whitespace layout reuse execution.
    expect(relations).toEqual({
      exact: 'same-text',
      whitespace: 'same-image',
      changedProgram: 'different',
      otherDocument: 'different',
      otherProfile: 'different',
    });
  });

  it.each([
    ['NBSP', '\u00a0'],
    ['BOM', '\ufeff'],
    ['Korean', '가'],
    ['emoji', '😀'],
    ['NUL', '\0'],
    ['control', '\u0001'],
  ])('classifies %s as invalid at prefix, middle, and suffix positions', (_label, invalid) => {
    // Given one valid executed image and an ASCII-only source layout.
    const plain = source.replace(/[\t\n\v\f\r ]/g, '');
    const executed = descriptor('raw:one', plain);
    const offsets = [0, Math.floor(plain.length / 2), plain.length];

    for (const offset of offsets) {
      // When one forbidden character is inserted at a tracked UTF-16 offset.
      const text = `${plain.slice(0, offset)}${invalid}${plain.slice(offset)}`;
      const current = descriptor('raw:one', text);
      const diagnostic = current.analysis.diagnostics.find(item => item.code === 'LOAD_INVALID_ENCODING');

      // Then invalid text never aliases the execution image and retains its location.
      expect(classifySourceRelation(current, executed)).toBe('invalid');
      expect(diagnostic?.span?.utf16Start).toBe(offset);
    }

    // Removing the character restores the original identity.
    expect(classifySourceRelation(descriptor('raw:one', plain), executed)).toBe('same-text');
  });

  it('keeps all 59049 initial cells identical across allowed ASCII whitespace layouts', () => {
    // Given one valid logical program with no authored whitespace.
    const plain = source.replace(/[\t\n\v\f\r ]/g, '');
    const executed = descriptor('raw:one', plain);
    const initial = loadProgram(plain).initialMemory;
    const middle = Math.floor(plain.length / 2);
    const layouts = [
      ` ${plain}`,
      `${plain}\t`,
      `${plain.slice(0, middle)}\n${plain.slice(middle)}`,
      `\r${plain}\v`,
      `${plain.slice(0, middle)}\f${plain.slice(middle)}`,
      ` \t\r\n\v\f${plain}\r\n`,
    ];

    for (const text of layouts) {
      // When only SP, HT, LF, CR, VT, or FF placement changes.
      const current = descriptor('raw:one', text);
      const candidate = loadProgram(text).initialMemory;

      // Then the relation is same-image and every initial memory cell matches.
      expect(classifySourceRelation(current, executed)).toBe('same-image');
      expect(candidate).toEqual(initial);
    }
  });
});
