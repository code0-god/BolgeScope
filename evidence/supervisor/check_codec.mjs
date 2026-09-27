import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(out, '../..');
const codec = await import(pathToFileURL(path.join(root, 'packages/core/src/codec.ts')));
const reference = fs.readFileSync(path.join(out, 'malbolge.original.c'), 'utf8');
function cTable(name) {
  const expression = new RegExp(`const char ${name}\\[\\]\\s*=\\s*((?:"(?:\\\\.|[^"\\\\])*"\\s*)+);`, 's');
  const declaration = reference.match(expression);
  assert(declaration, `Reference table ${name} found`);
  return [...declaration[1].matchAll(/"(?:\\.|[^"\\])*"/g)].map(m => JSON.parse(m[0])).join('');
}
const xlat1 = cTable('xlat1');
const xlat2 = cTable('xlat2');
assert.equal(xlat1.length,94); assert.equal(xlat2.length,94);
const checks = {};
for (let address=0; address<94; address++) for(let raw=33;raw<=126;raw++) {
  assert.equal(codec.decode(raw,address), xlat1[(raw-33+address)%94]);
}
checks.decodePairs=94*94;
for (let address=0;address<59049;address++) for(const opcode of 'ji*p</vo') {
  const raw=codec.encode(opcode,address);
  assert(Number.isInteger(raw) && raw>=33 && raw<=126);
  assert.equal(xlat1[(raw-33+address)%94],opcode);
}
checks.encodePairs=59049*8;
for (let raw=33;raw<=126;raw++) assert.equal(codec.encrypt(raw),xlat2.charCodeAt(raw-33));
assert.equal(codec.encrypt(127),0);
for (const raw of [32,128,-1,59048,NaN,Infinity,33.5]) assert.equal(codec.encrypt(raw),null);
checks.encryptionCases=102;
const trits = [[1,0,0],[1,0,2],[2,2,1]];
function independentCrazy(x,y) {
  let value=0,place=1;
  for(let i=0;i<10;i++,place*=3) {
    value += trits[y%3][x%3]*place;
    x=Math.floor(x/3);y=Math.floor(y/3);
  }
  return value;
}
let crazyCases=0;
for(let x=0;x<9;x++)for(let y=0;y<9;y++){assert.equal(codec.crazy(x,y),independentCrazy(x,y));crazyCases++;}
let state=20260927;
function randomWord(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state%59049;}
for(let i=0;i<4096;i++){const x=randomWord(),y=randomWord();assert.equal(codec.crazy(x,y),independentCrazy(x,y));crazyCases++;}
for(const x of [0,1,65,84,19682,19683,29524,59047,59048]) for(const y of [0,1,65,84,19682,19683,29524,59047,59048]) {assert.equal(codec.crazy(x,y),independentCrazy(x,y));crazyCases++;}
checks.crazyPairs=crazyCases;
assert.equal(codec.crazy(65,84),29487);
for(let word=0;word<59049;word++) {
  let rotated=word;
  for(let k=0;k<10;k++)rotated=codec.rotate(rotated);
  assert.equal(rotated,word);
}
checks.rotationRoundTrips=59049;
assert.equal(codec.nextAddress(59048),0);
const report={status:'PASS',kind:'independent-supervisor-codec',checks,reference:'original C xlat strings and independent 3x3 trit arithmetic',productFile:'packages/core/src/codec.ts',timestamp:new Date().toISOString()};
fs.writeFileSync(path.join(out,'codec-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
