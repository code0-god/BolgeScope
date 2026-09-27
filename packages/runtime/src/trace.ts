import type { MalbolgeMachine, Program } from '@bolgescope/core';

const encoder = new TextEncoder();
function hex(bytes: ArrayLike<number>): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
async function digest(bytes: Uint8Array): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))); }

export async function buildTrace(program: Program, machine: MalbolgeMachine, includeSource: boolean, includeInput: boolean): Promise<{ bytes: Uint8Array; digest: string }> {
  const state = machine.getState();
  const history = machine.getHistory();
  const header = {
    kind: 'header', schemaVersion: 1, profile: program.profile,
    profileId: program.profile.id, profileContractDigest: program.profile.contractDigest,
    branchId: state.branchId, parentBranch: state.parentBranch,
    earliestEventIndex: state.earliestEventIndex, tailEventIndex: state.tailEventIndex,
    snapshotSourceLength: program.analysis.sourceMap.length,
    logicalDigest: await digest(program.analysis.logicalSource), rawDigest: await digest(program.analysis.rawSource),
    replayMode: state.earliestEventIndex > 0 || state.parentBranch || !includeSource || !includeInput ? 'inspection-only' : 'from-source',
    sourceHex: includeSource ? hex(program.analysis.rawSource) : null,
    includesInput: includeInput,
    privacyWarning: 'Machine registers, memory writes, and output may reveal input even when direct input bytes are omitted.',
  };
  const lines = [JSON.stringify(header)];
  for (const event of history) {
    if (includeInput) lines.push(JSON.stringify(event));
    else if (event.kind === 'inputAppend') lines.push(JSON.stringify({ ...event, bytes: null, byteCount: event.bytes.length }));
    else if (event.kind === 'instruction' && event.transaction.input?.kind === 'byte') lines.push(JSON.stringify({ ...event, transaction: { ...event.transaction, input: { kind: 'byte', value: null } } }));
    else lines.push(JSON.stringify(event));
  }
  const body = encoder.encode(`${lines.join('\n')}\n`);
  const bodyDigest = await digest(body);
  const bytes = encoder.encode(`${lines.join('\n')}\n${JSON.stringify({ kind: 'footer', sha256: bodyDigest, eventCount: history.length })}\n`);
  // Footer verifies preceding JSONL bytes; native receipt verifies the complete file.
  return { bytes, digest: await digest(bytes) };
}
