import './typescript-hook.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../..');
const {analyzeSource,loadProgram}=await import(pathToFileURL(root+'/packages/core/src/source.ts'));
const {encode}=await import(pathToFileURL(root+'/packages/core/src/codec.ts'));
const ref=JSON.parse(fs.readFileSync(out+'/reference-results.json','utf8'));
const extended=JSON.parse(fs.readFileSync(out+'/extended-results.json','utf8'));
const fixture=fs.readFileSync(root+'/docs/desktop-v0.1/fixtures/recurrent_crazy4.mb','utf8');
const logical=fixture.replace(/[\t\n\v\f\r ]/g,'');
const tests=[];
function check(name,fn){try{const detail=fn();tests.push({name,status:'PASS',detail});}catch(e){tests.push({name,status:'FAIL',error:String(e)});}}
function memory(file){const b=fs.readFileSync(file),m=new Uint16Array(59049);for(let i=0;i<m.length;i++)m[i]=ref.byteOrder==='little'?b.readUInt16LE(i*2):b.readUInt16BE(i*2);return m;}
check('regression-full-initial-memory',()=>{const p=loadProgram(fixture);assert.deepEqual(p.initialMemory,memory(out+'/cases/abc-lf/initial.u16'));return {cells:59049};});
for(const c of [...extended.edgeCases,extended.revisit].filter(Boolean))check('source-initial-'+c.name,()=>{const p=loadProgram(c.raw);assert.deepEqual(p.initialMemory,memory(c.initialPath));return {cells:59049};});
check('invalid-graphic-does-not-renumber-following-cells',()=>{const a=analyzeSource('!'+logical.slice(1));assert(a.diagnostics.length>0);const s=a.sourceMap.find(c=>c.span.utf16Start===2);assert(s,'Address-two s remains present for diagnostics');assert.equal(s.address,2);assert.equal(s.raw,115);assert.equal(s.symbol,'/');});
check('emoji-diagnostic-uses-two-utf16-units',()=>{const a=analyzeSource('😀'+logical);const d=a.diagnostics.find(d=>d.span?.utf16Start===0);assert(d);assert.equal(d.span.utf16End,2);const first=a.sourceMap.find(c=>c.raw===40);assert(first);assert.equal(first.span.utf16Start,2);assert.equal(first.span.byteStart,4);assert.equal(first.span.column,3);});
check('korean-diagnostic-uses-one-utf16-unit',()=>{const a=analyzeSource('가'+logical);const d=a.diagnostics.find(d=>d.span?.utf16Start===0);assert(d);assert.equal(d.span.utf16End,1);const first=a.sourceMap.find(c=>c.raw===40);assert(first);assert.equal(first.span.utf16Start,1);assert.equal(first.span.byteStart,3);assert.equal(first.span.column,2);});
check('crlf-map-and-raw-bytes-preserved',()=>{const raw="(\r\n'\t\ns;";const a=analyzeSource(raw);assert.equal(a.diagnostics.length,0);assert.equal(a.sourceMap[1].span.line,2);assert.equal(a.sourceMap[1].span.column,1);assert.equal(a.sourceMap[1].span.utf16Start,3);assert.equal(a.sourceMap[2].span.line,3);assert.equal(new TextDecoder().decode(a.rawSource),raw);});
check('all-six-ascii-spaces-preserve-image',()=>{const spaced=[...logical].join(' \t\r\n\v\f');assert.deepEqual(loadProgram(spaced).initialMemory,loadProgram(logical).initialMemory);});
check('normalized-uses-the-same-raw-loader',()=>{const raw="(\r\n'\n s;";const normalized='j\r\nj\n /p';const a=loadProgram(normalized,'normalized'),b=loadProgram(raw);assert.deepEqual(a.initialMemory,b.initialMemory);assert.equal(new TextDecoder().decode(a.analysis.rawSource),raw);});
check('loader-short-long-encoding-boundaries',()=>{for(const s of ['', '(', '\ufeff'+logical, logical+'\0', logical+'\x7f', logical+'é'])assert.throws(()=>loadProgram(s));let raw='';for(let i=0;i<59049;i++)raw+=String.fromCharCode(encode('o',i));assert.equal(loadProgram(raw).analysis.logicalSource.length,59049);assert.throws(()=>loadProgram(raw+'!'));});
const report={status:tests.every(t=>t.status==='PASS')?'PASS':'FAIL',timestamp:new Date().toISOString(),kind:'independent-supervisor-loader',passed:tests.filter(t=>t.status==='PASS').length,failed:tests.filter(t=>t.status==='FAIL').length,tests};
fs.writeFileSync(out+'/source-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='PASS'?0:1;
