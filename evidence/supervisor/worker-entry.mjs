// Node task-queue harness around the unmodified product Runtime Worker.
// This is protocol integration coverage, not macOS WKWebView coverage.
import './typescript-hook.mjs';
import {parentPort} from 'node:worker_threads';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
globalThis.self=globalThis;
globalThis.postMessage=value=>parentPort.postMessage(value);
parentPort.on('message',data=>globalThis.onmessage?.({data}));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
await import(pathToFileURL(root+'/packages/runtime/src/worker.ts'));
parentPort.postMessage({supervisorReady:true});
