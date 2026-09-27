import './typescript-hook.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../..');
const {RuntimeClient}=await import(pathToFileURL(root+'/packages/runtime/src/client.ts'));
const echo=fs.readFileSync(out+'/extended/single-byte-echo/program.mb','utf8');
const fixture=fs.readFileSync(root+'/docs/desktop-v0.1/fixtures/recurrent_crazy4.mb','utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class Bridge {
 onmessage=null;onerror=null;
 constructor(){this.node=new NodeWorker(new URL('./worker-entry.mjs',import.meta.url));this.ready=new Promise((resolve,reject)=>{this.node.on('message',message=>{if(message.supervisorReady)resolve();else this.onmessage?.({data:message});});this.node.on('error',error=>{this.onerror?.({message:error.message});reject(error);});});}
 postMessage(value){this.node.postMessage(value);}
 terminate(){return this.node.terminate();}
}
const tests=[];
async function check(name,fn){let bridge,client;try{bridge=new Bridge();await bridge.ready;client=new RuntimeClient(bridge);const detail=await fn(client,bridge);tests.push({name,status:'PASS',detail});}catch(e){tests.push({name,status:'FAIL',error:String(e)});}finally{await bridge?.terminate();}}
async function until(client,predicate,timeout=3000){const start=Date.now();let s;do{s=await client.getState();if(predicate(s))return s;await delay(10);}while(Date.now()-start<timeout);throw new Error('State timeout: '+JSON.stringify(s));}
await check('step-wait-then-send-executes-only-one',async c=>{await c.load(echo,'raw');let s=await c.step();assert.equal(s.phase,'WAITING_INPUT');s=await c.appendInput([65,66]);assert.equal(s.head.step,1);assert.equal(s.head.registers.a,65);assert.equal(s.head.tape.cursor,1);assert.equal(s.phase,'PAUSED');assert.equal(s.head.outputLength,0);});
await check('run-wait-then-send-resumes',async c=>{await c.load(echo,'raw');await c.run();await until(c,s=>s.phase==='WAITING_INPUT');await c.appendInput([65]);const s=await until(c,s=>s.phase==='HALTED');assert.equal(s.head.step,3);assert.equal(Buffer.from(await c.getOutput()).toString('hex'),'41');});
await check('pause-cancels-waiting-run-intent',async c=>{await c.load(echo,'raw');await c.run();await until(c,s=>s.phase==='WAITING_INPUT');await c.pause();await c.appendInput([65]);await delay(40);const s=await c.getState();assert.equal(s.head.step,0);assert.equal(s.phase,'PAUSED');assert.equal(s.head.tape.cursor,0);assert.equal(s.head.tape.visibleLength,1);});
await check('empty-closed-input-is-eof-not-halt',async c=>{await c.load(echo,'raw');await c.step();const s=await c.closeInput();assert.equal(s.head.step,1);assert.equal(s.head.registers.a,59048);assert.equal(s.head.tape.cursor,0);assert.equal(s.head.tape.eofReads,1);assert.equal(s.phase,'PAUSED');});
await check('core-regression-through-real-worker',async c=>{await c.load(fixture,'raw');await c.appendInput([65,66,67,10]);await c.closeInput();await c.run();const s=await until(c,s=>s.phase==='HALTED');assert.equal(s.head.step,24);assert.deepEqual(s.head.registers,{a:29514,c:23,d:80});assert.deepEqual(Array.from(await c.queryMemory(78,1)),[29514]);assert.equal(Buffer.from(await c.getOutput()).toString('hex'),'4a');await c.stepBack();assert.equal((await c.getState()).head.step,23);await c.step();assert.deepEqual((await c.getState()).head,s.head);});
await check('failed-load-keeps-previous-session-usable',async c=>{await c.load(fixture,'raw');await c.step();const before=(await c.getState()).head;await assert.rejects(c.load('!','raw'));assert.deepEqual((await c.getState()).head,before);});
await check('restart-then-old-replies-cannot-replace-new-session',async c=>{await c.load(fixture,'raw');await c.step();await c.restart();const s=await c.getState();assert.equal(s.head.step,0);await c.appendInput([65]);assert.equal((await c.getState()).head.tape.visibleLength,1);});
await check('stop-invalidates-current-client-view',async c=>{await c.load(fixture,'raw');await delay(10);await c.stop();assert.equal(c.getCurrentState(),null,'Stopped session must not remain the displayed current state');await assert.rejects(c.getState());});
await check('epoch-change-rejects-pending-old-requests',async c=>{await c.load(fixture,'raw');const old=c.getHistory();const next=c.load(echo,'raw');const result=await Promise.race([old.then(()=> 'resolved',()=> 'rejected'),delay(800).then(()=> 'timeout')]);await next;assert.notEqual(result,'timeout','Old promise must settle when session epoch changes');});
const report={status:tests.every(t=>t.status==='PASS')?'PASS':'FAIL',timestamp:new Date().toISOString(),kind:'actual-worker-node-task-queue-integration (not WKWebView)',passed:tests.filter(t=>t.status==='PASS').length,failed:tests.filter(t=>t.status==='FAIL').length,tests};fs.writeFileSync(out+'/worker-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
