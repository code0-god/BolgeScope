import type { JournalEvent } from './types.js';

export type JournalDraft = { [K in JournalEvent['kind']]: Omit<Extract<JournalEvent, { kind: K }>, 'eventIndex'> }[JournalEvent['kind']];
type JournalCursor = Readonly<{ eventIndex: number; earliestEventIndex: number; historyBytes: number }>;
const encoder = new TextEncoder();
function encodedBytes(event: JournalDraft | JournalEvent): number { return encoder.encode(JSON.stringify(event)).length; }

export function canRecord(event: JournalDraft, limit: number, eventIndex: number): boolean {
  return encodedBytes({ ...event, eventIndex: eventIndex + 1 }) <= limit;
}

export function appendJournal(entries: JournalEvent[], event: JournalDraft, cursor: JournalCursor, limit: number): JournalCursor {
  const indexed: JournalEvent = { ...event, eventIndex: cursor.eventIndex + 1 };
  entries.push(indexed);
  let historyBytes = cursor.historyBytes + encodedBytes(indexed);
  let earliestEventIndex = cursor.earliestEventIndex;
  while (historyBytes > limit && entries.length > 1) {
    const removed = entries.shift();
    if (!removed) break;
    historyBytes -= encodedBytes(removed);
    earliestEventIndex = removed.eventIndex;
  }
  return { eventIndex: indexed.eventIndex, earliestEventIndex, historyBytes };
}
