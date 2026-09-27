import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(out,'../..');
registerHooks({resolve(specifier,context,nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(pathToFileURL(root+'/').href)) {
    const url=new URL(specifier.slice(0,-3)+'.ts',context.parentURL);
    if(fs.existsSync(fileURLToPath(url)))return nextResolve(url.href,context);
  }
  return nextResolve(specifier,context);
}});
const {MalbolgeMachine}=await import(pathToFileURL(path.join(root,'packages/core/src/machine.ts')));
const {planStep}=await import(pathToFileURL(path.join(root,'packages/core/src/step.ts')));
const {encode}=await import(pathToFileURL(path.join(root,'packages/core/src/codec.ts')));
const ref=JSON.parse(fs.readFileSync(path.join(out,'reference-results.json'),'utf8'));
function words(file) {
 const bytes=fs.readFileSync(file); assert.equal(bytes.length,59049*2);
 const values=new Uint16Array(59049);
 for(let i=0;i<59049;i++)values[i]=ref.byteOrder==='little'?bytes.readUInt16LE(i*2):bytes.readUInt16BE(i*2);
 return values;
}
const tests=[];
function check(name,fn) {try{const detail=fn();tests.push({name,status:'PASS',detail});}catch(error){tests.push({name,status:'FAIL',error:String(error),stack:error.stack?.split('\n').slice(0,5).join('\n')});}}
function committedFromC(file) {
 const events=fs.readFileSync(file,'utf8').trim().split('\n').map(x=>JSON.parse(x));
 let group=null;const result=[];
 for(const e of events) {
  if(e.kind==='before')group={before:e,accesses:[],input:null,output:[]};
  else if(group && (e.kind==='read'||e.kind==='write')) {const {kind,...access}=e;group.accesses.push(access);}
  else if(group && e.kind==='input')group.input=e.eof?{kind:'eof'}:{kind:'byte',value:e.value};
  else if(group && e.kind==='output')group.output.push(e.byte);
  else if(group && e.kind==='after') {group.after=e;result.push(group);group=null;}
 }
 return {transactions:result,terminal:events.at(-1)};
}
const cases=ref.cases.map(c=>({name:c.name,inputHex:c.inputHex,directory:path.join(out,'cases',c.name)}));
const extended=JSON.parse(fs.readFileSync(path.join(out,'extended-results.json'),'utf8'));
for(const c of extended.edgeCases)cases.push({name:c.name,inputHex:c.inputHex,directory:path.dirname(path.resolve(out,c.tracePath))});
if(extended.revisit)cases.push({name:'actual-revisit',inputHex:extended.revisit.inputHex,directory:path.dirname(path.resolve(out,extended.revisit.tracePath))});
let comparedInstructions=0;
for(const c of cases)check('reference-'+c.name,()=>{
 const initial=words(path.join(c.directory,'initial.u16'));
 // This test isolates the product VM. The C initial image is not a substitute
 // for the separate source-loader differential check run by the build suite.
 const vm=new MalbolgeMachine({initialMemory:initial});
 vm.appendInput([...Buffer.from(c.inputHex,'hex')]); vm.closeInput();
 const oracle=committedFromC(path.join(c.directory,'trace.jsonl'));
 for(const [i,expected] of oracle.transactions.entries()) {
  const before=vm.getState().head;
  assert.deepEqual(before.registers,{a:expected.before.a,c:expected.before.c,d:expected.before.d},`${c.name} before ${i}`);
  vm.step();const tx=vm.getState().lastTransaction;
  assert(tx,`${c.name} transaction ${i}`);
  assert.equal(tx.fetchedRaw,expected.before.raw);
  assert.equal(tx.decodedSymbol,String.fromCharCode(expected.before.decoded));
  assert.deepEqual([...tx.reads,...tx.writes].sort((a,b)=>a.order-b.order),expected.accesses,`${c.name} ordered accesses ${i}`);
  assert.deepEqual(tx.input,expected.input); assert.deepEqual(tx.output,expected.output);
  assert.deepEqual(tx.after.registers,{a:expected.after.a,c:expected.after.c,d:expected.after.d});
  assert.equal(tx.after.step,expected.after.step);assert.equal(tx.after.terminal,expected.after.halted?'HALTED':'NONE');
  comparedInstructions++;
 }
 if(oracle.terminal.status==='REFERENCE_UNDEFINED') {
  const before=structuredClone(vm.getState().head);const memory=vm.getMemory();
  vm.step();assert.equal(vm.getState().reason,'REFERENCE_UNDEFINED');
  assert.deepEqual(vm.getMemory(),memory,'Unsafe step must roll back all attempted writes');
  assert.deepEqual(vm.getState().head.registers,before.registers);assert.deepEqual(vm.getState().head.tape,before.tape);
 } else {
  if(oracle.terminal.status==='STALLED_INVALID_FETCH') {vm.step();assert.equal(vm.getState().reason,'STALLED_INVALID_FETCH');}
  assert.deepEqual(vm.getMemory(),words(path.join(c.directory,'final.u16')),`${c.name} all 59049 final cells`);
 }
 const finalHead=structuredClone(vm.getState().head);const finalMemory=vm.getMemory();const output=vm.getOutput();
 for(let i=0;i<oracle.transactions.length;i++)vm.stepBack();
 assert.deepEqual(vm.getMemory(),initial,`${c.name} full undo`);
 assert.equal(vm.getState().head.step,0);
 for(let i=0;i<oracle.transactions.length;i++)vm.step();
 if(oracle.terminal.status==='STALLED_INVALID_FETCH'||oracle.terminal.status==='REFERENCE_UNDEFINED')vm.step();
 assert.deepEqual(vm.getMemory(),finalMemory,`${c.name} replay memory`);
 assert.deepEqual(vm.getOutput(),output,`${c.name} replay output`);
 assert.deepEqual(vm.getState().head,finalHead,`${c.name} replay head`);
 return {instructions:oracle.transactions.length,initialization:'reference-image (loader tested separately)'};
});
check('stepBack-without-instruction-is-no-op',()=>{
 const initial=words(cases[0].directory+'/initial.u16');const vm=new MalbolgeMachine({initialMemory:initial});
 vm.appendInput([65]);vm.closeInput();const head=structuredClone(vm.getState().head);const point=vm.getState().eventIndex;
 vm.stepBack();assert.deepEqual(vm.getState().head,head);assert.equal(vm.getState().eventIndex,point);
});
check('closed-tape-cannot-read-invisible-future-byte',()=>{
 const memory=new Uint16Array(59049);memory[0]=encode('/',0);
 const head={registers:{a:0,c:0,d:0},step:0,terminal:'NONE',tape:{visibleLength:0,cursor:0,closed:true,eofReads:0},outputLength:0};
 const planned=planStep(memory,head,[65]);assert.equal(planned.kind,'instruction');
 assert.deepEqual(planned.transaction.input,{kind:'eof'});assert.equal(planned.transaction.after.registers.a,59048);assert.equal(planned.transaction.after.tape.cursor,0);
});
check('input-wait-repeated-is-machine-invariant',()=>{
 const memory=new Uint16Array(59049);memory[0]=encode('/',0);memory[1]=encode('v',1);
 const vm=new MalbolgeMachine({initialMemory:memory});const before=structuredClone(vm.getState().head);
 for(let i=0;i<10;i++){vm.step();assert.equal(vm.getState().phase,'WAITING_INPUT');assert.deepEqual(vm.getState().head,before);assert.deepEqual(vm.getMemory(),memory);}
});
check('max-sized-input-append-does-not-exhaust-call-stack',()=>{
 const initial=words(cases[0].directory+'/initial.u16');const vm=new MalbolgeMachine({initialMemory:initial});
 const bytes=new Array(1024*1024).fill(65);vm.appendInput(bytes);assert.equal(vm.getState().head.tape.visibleLength,bytes.length);
});
const report={status:tests.every(t=>t.status==='PASS')?'PASS':'FAIL',timestamp:new Date().toISOString(),kind:'supervisor-independent-machine',referenceCases:cases.length,comparedInstructions,passed:tests.filter(t=>t.status==='PASS').length,failed:tests.filter(t=>t.status==='FAIL').length,tests};
fs.writeFileSync(out+'/machine-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=report.status==='PASS'?0:1;
