import type { TestCase, TestResult } from '@bolgescope/contracts';

type TestReply = Readonly<{ requestId: string; result: TestResult | null; error: string | null }>;

export class TestWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, { resolve: (result: TestResult) => void; reject: (error: Error) => void }>();
  constructor(worker = new Worker(new URL('./test-worker.ts', import.meta.url), { type: 'module' })) {
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<TestReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.requestId);
      if (!pending) return;
      this.pending.delete(reply.requestId);
      if (reply.result) pending.resolve(reply.result);
      else pending.reject(new Error(reply.error ?? 'TEST_WORKER_ERROR'));
    };
    worker.onerror = event => {
      for (const pending of this.pending.values()) pending.reject(new Error(`TEST_WORKER_CRASH: ${event.message}`));
      this.pending.clear();
    };
  }
  run(testCase: TestCase, sourceBytes: Uint8Array): Promise<TestResult> {
    const requestId = crypto.randomUUID();
    return new Promise<TestResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ command: 'run', requestId, testCase, sourceBytes });
    });
  }
  cancel(requestId?: string): void { this.worker.postMessage(requestId === undefined ? { command: 'cancel' } : { command: 'cancel', requestId }); }
  terminate(): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('TEST_WORKER_CRASH: terminated'));
    this.pending.clear();
  }
}

export function createTestWorkerClient(): TestWorkerClient { return new TestWorkerClient(); }
