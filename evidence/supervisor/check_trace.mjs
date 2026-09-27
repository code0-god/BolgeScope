import './typescript-hook.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../..');
const {loadProgram,MalbolgeMachine}=await import(pathToFileURL(root+'/packages/core/src/index.ts'));
const {buildTrace}=await import(pathToFileURL(root+'/packages/runtime/src/trace.ts'));
const program=loadProgram(fs.readFileSync(root+'/docs/desktop-v0.1/fixtures/recurrent_crazy4.mb','utf8'));
const vm=new MalbolgeMachine(program);vm.appendInput([65,66,67,10]);vm.closeInput();vm.run();
const checks=[];
for(const [source,input] of [[true,true],[true,false],[false,true],[false,false]]){
 try{
  const before=vm.getState();const built=await buildTrace(program,vm,source,input);
  const text=new TextDecoder().decode(built.bytes),lines=text.trimEnd().split('\n');
  const parsed=lines.map(x=>JSON.parse(x)),header=parsed[0],footer=parsed.at(-1);
  assert.equal(header.kind,'header');assert.equal(footer.kind,'footer');assert.equal(header.includesInput,input);
  assert.equal(header.sourceHex!==null,source);
  const body=Buffer.from(lines.slice(0,-1).join('\n')+'\n');
  assert.equal(footer.sha256,createHash('sha256').update(body).digest('hex'));
  assert.equal(built.digest,createHash('sha256').update(built.bytes).digest('hex'),'Native disk receipt hashes the whole file including footer');
  assert.equal(footer.eventCount,parsed.length-2);
  if(!input)for(const e of parsed){if(e.kind==='inputAppend')assert.equal(e.bytes,null);if(e.kind==='instruction'&&e.transaction.input?.kind==='byte')assert.equal(e.transaction.input.value,null);}
  assert.deepEqual(vm.getState(),before);
  checks.push({name:`trace-source-${source}-input-${input}`,status:'PASS',bytes:built.bytes.length});
 }catch(e){checks.push({name:`trace-source-${source}-input-${input}`,status:'FAIL',error:String(e)});}
}
const report={status:checks.every(x=>x.status==='PASS')?'PASS':'FAIL',kind:'supervisor-JSONL-file-integrity',checks};fs.writeFileSync(out+'/trace-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
