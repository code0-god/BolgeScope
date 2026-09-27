import { describe, expect, it } from 'vitest';
import { OperationOwner } from './operationOwner.js';

describe('UI operation ownership', () => {
  it('prevents an older load completion and finally block from changing latest UI state', () => {
    // Given load A followed by load B.
    const owner = new OperationOwner();
    let snapshot = 'original';
    let busy = true;
    const loadA = owner.begin();
    const loadB = owner.begin();

    // When A completes after B has become current.
    if (owner.owns(loadA)) snapshot = 'document-a';
    if (owner.owns(loadA)) busy = false;

    // Then A cannot replace B's snapshot or clear B's busy state.
    expect(snapshot).toBe('original');
    expect(busy).toBe(true);
    if (owner.owns(loadB)) snapshot = 'document-b';
    if (owner.owns(loadB)) busy = false;
    expect(snapshot).toBe('document-b');
    expect(busy).toBe(false);
  });

  it('invalidates a pending document load during a document or lesson switch', () => {
    // Given one active document load.
    const owner = new OperationOwner();
    const load = owner.begin();

    // When navigation switches the owning document.
    owner.invalidate();

    // Then the old load no longer owns follow-up UI mutations.
    expect(owner.owns(load)).toBe(false);
  });
});
