import { MEMORY_SIZE } from './codec.js';
import type { JournalEvent, RoleCounterPage, RoleCounts, Transaction } from './types.js';

type Role = keyof RoleCounts;
const readRole = { fetch: 'fetch', 'data-read': 'dataRead' } as const;
const writeRole = { 'data-write': 'dataWrite', encryption: 'encryption' } as const;

export class ObservationCounters {
  private readonly values: Record<Role, Float64Array> = {
    fetch: new Float64Array(MEMORY_SIZE), dataRead: new Float64Array(MEMORY_SIZE),
    dataWrite: new Float64Array(MEMORY_SIZE), encryption: new Float64Array(MEMORY_SIZE),
  };

  canAdd(transaction: Transaction): boolean {
    const increments: Record<Role, Map<number, number>> = {
      fetch: new Map(), dataRead: new Map(), dataWrite: new Map(), encryption: new Map(),
    };
    for (const read of transaction.reads) {
      const role = readRole[read.role];
      increments[role].set(read.address, (increments[role].get(read.address) ?? 0) + 1);
    }
    for (const write of transaction.writes) {
      const role = writeRole[write.role];
      increments[role].set(write.address, (increments[role].get(write.address) ?? 0) + 1);
    }
    for (const role of ['fetch', 'dataRead', 'dataWrite', 'encryption'] as const)
      for (const [address, amount] of increments[role])
        if ((this.values[role][address] ?? Number.MAX_SAFE_INTEGER) + amount > Number.MAX_SAFE_INTEGER) return false;
    return true;
  }

  apply(transaction: Transaction, delta: 1 | -1): void {
    for (const read of transaction.reads) this.adjust(readRole[read.role], read.address, delta);
    for (const write of transaction.writes) this.adjust(writeRole[write.role], write.address, delta);
  }

  at(address: number): RoleCounts {
    return {
      fetch: this.values.fetch[address] ?? 0, dataRead: this.values.dataRead[address] ?? 0,
      dataWrite: this.values.dataWrite[address] ?? 0, encryption: this.values.encryption[address] ?? 0,
    };
  }

  pageAt(start: number, count: number, point: number, live: number, earliest: number, journal: readonly JournalEvent[]): RoleCounterPage {
    const page: Record<Role, Float64Array> = {
      fetch: this.values.fetch.slice(start, start + count), dataRead: this.values.dataRead.slice(start, start + count),
      dataWrite: this.values.dataWrite.slice(start, start + count), encryption: this.values.encryption.slice(start, start + count),
    };
    const end = start + count;
    const adjustPage = (role: Role, address: number, delta: 1 | -1): void => {
      const index = address - start;
      page[role][index] = (page[role][index] ?? 0) + delta;
    };
    const adjust = (transaction: Transaction, delta: 1 | -1): void => {
      for (const read of transaction.reads) if (read.address >= start && read.address < end) adjustPage(readRole[read.role], read.address, delta);
      for (const write of transaction.writes) if (write.address >= start && write.address < end) adjustPage(writeRole[write.role], write.address, delta);
    };
    if (point < live) for (let index = live; index > point; index--) {
      const event = journal[index - earliest - 1];
      if (event?.kind === 'instruction') adjust(event.transaction, -1);
    }
    if (point > live) for (let index = live + 1; index <= point; index++) {
      const event = journal[index - earliest - 1];
      if (event?.kind === 'instruction') adjust(event.transaction, 1);
    }
    return page;
  }

  private adjust(role: Role, address: number, delta: 1 | -1): void {
    const values = this.values[role];
    const next = (values[address] ?? 0) + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw new RangeError('Observation counter overflow');
    values[address] = next;
  }
}
