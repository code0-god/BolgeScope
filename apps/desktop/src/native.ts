import { invoke } from '@tauri-apps/api/core';

export type GrantedFile = { grantId: string; targetId: string; requestId: string | null; name: string; bytes: number[]; diskRevision: string };
export type NativeError = { code: string; message: string };
export const nativeAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function requireNative(): void {
  if (!nativeAvailable) throw new Error('파일 대화상자는 macOS 앱에서 사용할 수 있습니다.');
}

export async function openFile(): Promise<GrantedFile | null> {
  requireNative();
  const requestId = crypto.randomUUID();
  const file = await invoke<GrantedFile | null>('select_file', { requestId });
  if (file && file.requestId !== requestId) throw new Error('IPC_SCHEMA: native open request ID mismatch');
  return file;
}

export async function saveFile(grantId: string, bytes: Uint8Array, observedDiskRevision: string): Promise<string> {
  requireNative();
  const result = await invoke<{ diskRevision: string }>('save_granted_file', { grantId, bytes: Array.from(bytes), observedDiskRevision });
  return result.diskRevision;
}

export async function saveAs(bytes: Uint8Array, suggestedName: string): Promise<GrantedFile | null> {
  requireNative();
  return invoke<GrantedFile | null>('save_as', { bytes: Array.from(bytes), suggestedName });
}

export function nativeError(error: unknown): NativeError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return { code: String(error.code), message: String(error.message) };
  }
  return { code: 'IO_ERROR', message: error instanceof Error ? error.message : String(error) };
}

export async function saveProjectFile(grantId: string, relativePath: string, bytes: Uint8Array, observedDiskRevision: string | null): Promise<string> {
  requireNative();
  const result = await invoke<{ diskRevision: string }>('save_project_file', { grantId, relativePath, bytes: Array.from(bytes), observedDiskRevision });
  return result.diskRevision;
}

export type RecoveryRecord = { recoveryId: string; documentId: string; sourceRevision: number; observedDiskRevision: string | null; bytes: number[] };
export async function listRecovery(): Promise<RecoveryRecord[]> { requireNative(); return invoke<RecoveryRecord[]>('list_recovery'); }
export async function writeRecovery(documentId: string, sourceRevision: number, observedDiskRevision: string | null, bytes: Uint8Array): Promise<string> {
  requireNative();
  return invoke<string>('write_recovery', { documentId, sourceRevision, observedDiskRevision, bytes: Array.from(bytes) });
}
export async function removeRecovery(recoveryId: string): Promise<void> { requireNative(); await invoke('remove_recovery', { recoveryId }); }
