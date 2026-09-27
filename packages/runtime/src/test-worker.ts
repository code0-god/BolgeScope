import { executeTestCase, testCaseSchema } from '@bolgescope/contracts';

const scope = self as DedicatedWorkerGlobalScope;
let current: { id: string; controller: AbortController } | null = null;

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (typeof value !== 'object' || value === null || !('command' in value)) return;
  if (value.command === 'cancel') {
    if (current && (!('requestId' in value) || value.requestId === current.id)) current.controller.abort();
    return;
  }
  if (value.command !== 'run' || !('requestId' in value) || typeof value.requestId !== 'string') return;
  const requestId = value.requestId;
  if (current) { scope.postMessage({ requestId, result: null, error: 'TEST_BUSY' }); return; }
  const parsed = 'testCase' in value ? testCaseSchema.safeParse(value.testCase) : null;
  const sourceBytes = 'sourceBytes' in value ? value.sourceBytes : null;
  if (!parsed?.success || !(sourceBytes instanceof Uint8Array)) { scope.postMessage({ requestId, result: null, error: 'INVALID_TEST_REQUEST' }); return; }
  const controller = new AbortController();
  current = { id: requestId, controller };
  try { scope.postMessage({ requestId, result: await executeTestCase(parsed.data, sourceBytes, controller.signal), error: null }); }
  catch (error) { scope.postMessage({ requestId, result: null, error: error instanceof Error ? error.message : 'TEST_WORKER_ERROR' }); }
  finally { current = null; }
};
