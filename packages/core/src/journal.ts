import type { JournalEvent } from './types.js';

export type JournalDraft = { [K in JournalEvent['kind']]: Omit<Extract<JournalEvent, { kind: K }>, 'eventIndex'> }[JournalEvent['kind']];
type JournalCursor = Readonly<{ eventIndex: number; earliestEventIndex: number; historyBytes: number }>;
const encoder = new TextEncoder();
// History is budgeted by UTF-8 JSON size; each retained event is measured once.
const retainedBytes = new WeakMap<JournalEvent, number>();
function jsonBytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).length; }

export function journalBytes(event: JournalDraft, eventIndex: number): number {
  return jsonBytes({ ...event, eventIndex: eventIndex + 1 });
}

export function appendJournal(entries: JournalEvent[], event: JournalDraft, cursor: JournalCursor, limit: number, bytes = journalBytes(event, cursor.eventIndex)): JournalCursor {
  const indexed: JournalEvent = { ...event, eventIndex: cursor.eventIndex + 1 };
  entries.push(indexed);
  retainedBytes.set(indexed, bytes);
  let historyBytes = cursor.historyBytes + bytes;
  let earliestEventIndex = cursor.earliestEventIndex;
  while (historyBytes > limit && entries.length > 1) {
    const removed = entries.shift();
    if (!removed) break;
    historyBytes -= retainedBytes.get(removed) ?? jsonBytes(removed);
    earliestEventIndex = removed.eventIndex;
  }
  return { eventIndex: indexed.eventIndex, earliestEventIndex, historyBytes };
}
