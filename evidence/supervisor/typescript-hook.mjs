// Test-only loader: compile current product TypeScript without changing its files.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'package.json'));
const ts=require('typescript');
registerHooks({
 resolve(specifier,context,nextResolve) {
  if(specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(pathToFileURL(root+'/').href)) {
   const url=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
   if(fs.existsSync(fileURLToPath(url)))return nextResolve(url.href,context);
  }
  return nextResolve(specifier,context);
 },
 load(url,context,nextLoad) {
  if(url.startsWith(pathToFileURL(root+'/').href) && /\.(ts|tsx)$/.test(url) && !url.includes('/node_modules/')) {
   const input=fs.readFileSync(fileURLToPath(url),'utf8');
   const result=ts.transpileModule(input,{fileName:fileURLToPath(url),compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,verbatimModuleSyntax:true}});
   return {format:'module',source:result.outputText,shortCircuit:true};
  }
  return nextLoad(url,context);
 }
});
