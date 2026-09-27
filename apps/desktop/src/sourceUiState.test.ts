import { describe, expect, it } from 'vitest';
import { sourceUiState } from './sourceUiState';

describe('source execution UI projection', () => {
  it.each([
    ['same-text', { projectRuntime: true, exactText: true, binding: 'valid', warning: 'none' }],
    ['same-image', { projectRuntime: true, exactText: false, binding: 'valid', warning: 'layout-only' }],
    ['different', { projectRuntime: false, exactText: false, binding: 'review-required', warning: 'changed' }],
    ['invalid', { projectRuntime: false, exactText: false, binding: 'review-required', warning: 'invalid' }],
  ] as const)('maps %s to one shared projection policy', (relation, expected) => {
    // Given a core source-to-execution relation.
    // When all UI consumers ask for its projection policy.
    const state = sourceUiState(relation);

    // Then runtime decorations, bindings, notes, lessons, and warnings agree.
    expect(state).toEqual(expected);
  });
});
