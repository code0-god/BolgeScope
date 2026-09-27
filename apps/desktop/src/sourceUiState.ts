import type { SourceExecutionRelation } from '@bolgescope/core';

export type SourceUiState = Readonly<{
  projectRuntime: boolean;
  exactText: boolean;
  binding: 'valid' | 'review-required';
  warning: 'none' | 'layout-only' | 'changed' | 'invalid';
}>;

export function sourceUiState(relation: SourceExecutionRelation): SourceUiState {
  switch (relation) {
    case 'same-text':
      return { projectRuntime: true, exactText: true, binding: 'valid', warning: 'none' };
    case 'same-image':
      return { projectRuntime: true, exactText: false, binding: 'valid', warning: 'layout-only' };
    case 'different':
      return { projectRuntime: false, exactText: false, binding: 'review-required', warning: 'changed' };
    case 'invalid':
      return { projectRuntime: false, exactText: false, binding: 'review-required', warning: 'invalid' };
  }
}
