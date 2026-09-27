import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const typescript = createRequire(new URL('../../../package.json', import.meta.url))('typescript');
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(pathToFileURL(fileURLToPath(new URL('../../../', import.meta.url))).href)) {
    const url = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    if (fs.existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
  }
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.startsWith(pathToFileURL(root).href) && /\.(ts|tsx)$/.test(url) && !url.includes('/node_modules/')) {
    const file = fileURLToPath(url);
    const output = typescript.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: typescript.ScriptTarget.ES2023, module: typescript.ModuleKind.ESNext, verbatimModuleSyntax: true } });
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
} });
globalThis.self = globalThis;
globalThis.postMessage = value => parentPort.postMessage(value);
parentPort.on('message', data => globalThis.onmessage?.({ data }));
await import(workerData?.testRunner ? '../src/test-worker.ts' : '../src/worker.ts');
parentPort.postMessage({ ready: true });
