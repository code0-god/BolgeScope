#!/usr/bin/env python3
"""Independent review oracle: minimally instrument the pinned public-domain C.

Not a product VM. Original code and patch are retained. Execution stops before
an unsafe encryption index and no state after such a stop is an oracle result.
"""
from __future__ import annotations
import difflib
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
URL = 'https://raw.githubusercontent.com/TryItOnline/malbolge/master/malbolge.c'
EXPECTED = 'fe29a717f9f684d6cc81d5c63273d446d9c65fec73e62164538514d5737b07a6'
FIXTURE_SHA = '69ed29dde001b80de62e2feaf2a2f5463ec7ee9666b981954ef63a938a854a81'

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def change(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f'Patch context occurs {text.count(old)} times: {old[:90]!r}')
    return text.replace(old, new, 1)

HELPERS = r'''
/* Supervisor-only instrumentation; not included in the product. */
static FILE *sup_trace;
static unsigned long sup_steps;
static unsigned sup_order;
static void sup_dump(const char *envkey, unsigned short *mem) {
  const char *path = getenv(envkey);
  if (path) {
    FILE *f = fopen(path, "wb");
    if (!f || fwrite(mem, sizeof(unsigned short), 59049, f) != 59049) exit(72);
    fclose(f);
  }
}
static unsigned short sup_read(unsigned short *mem, unsigned short address) {
  fprintf(sup_trace, "{\"kind\":\"read\",\"role\":\"data-read\",\"order\":%u,\"address\":%u,\"value\":%u}\n", sup_order++, address, mem[address]);
  return mem[address];
}
static void sup_write(const char *role, unsigned short address, unsigned short before, unsigned short after) {
  fprintf(sup_trace, "{\"kind\":\"write\",\"role\":\"%s\",\"order\":%u,\"address\":%u,\"before\":%u,\"after\":%u}\n", role, sup_order++, address, before, after);
}
static void sup_end(unsigned short a, unsigned short c, unsigned short d, int halted) {
  fprintf(sup_trace, "{\"kind\":\"after\",\"step\":%lu,\"a\":%u,\"c\":%u,\"d\":%u,\"halted\":%s}\n", ++sup_steps, a,c,d,halted ? "true" : "false");
}
static void sup_finish(unsigned short *mem, const char *status) {
  fprintf(sup_trace, "{\"kind\":\"terminal\",\"status\":\"%s\",\"step\":%lu}\n", status,sup_steps);
  sup_dump("BOLGE_SUPERVISOR_FINAL", mem);
  fclose(sup_trace);
}
'''

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    original_path = OUT / 'malbolge.original.c'
    if original_path.exists():
        original = original_path.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=20) as response:
            original = response.read()
        if sha(original) != EXPECTED:
            raise RuntimeError('Reference hash changed; refusing to use unpinned code')
        original_path.write_bytes(original)
    assert sha(original) == EXPECTED
    text = original.decode('ascii')
    portable = change(text, '#include <malloc.h>\n', '')
    (OUT / 'malbolge.portable.c').write_text(portable)
    inst = change(portable, 'int main( int argc, char **argv )', HELPERS + '\nint main( int argc, char **argv )')
    inst = change(inst, '  int x;\n  for (;;)', r'''  int x;
  const char *trace_path = getenv("BOLGE_SUPERVISOR_TRACE");
  if (!trace_path || !(sup_trace = fopen(trace_path, "wb"))) exit(71);
  sup_steps = 0;
  fprintf(sup_trace, "{\"kind\":\"tables\",\"xlat1Size\":%zu,\"xlat2Size\":%zu,\"xlat2_94\":%u,\"wordSize\":%zu}\n", sizeof(xlat1),sizeof(xlat2),(unsigned char)xlat2[94],sizeof(unsigned short));
  sup_dump("BOLGE_SUPERVISOR_INITIAL", mem);
  for (;;)''')
    inst = change(inst, '    if ( mem[c] < 33 || mem[c] > 126 ) continue;', r'''    if (sup_steps >= 50000) { sup_finish(mem,"BUDGET"); return; }
    if ( mem[c] < 33 || mem[c] > 126 ) { sup_finish(mem,"STALLED_INVALID_FETCH"); return; }
    sup_order = 0;
    fprintf(sup_trace, "{\"kind\":\"before\",\"step\":%lu,\"a\":%u,\"c\":%u,\"d\":%u,\"raw\":%u,\"decoded\":%u}\n",sup_steps,a,c,d,mem[c],(unsigned char)xlat1[(mem[c]-33+c)%94]);
    fprintf(sup_trace, "{\"kind\":\"read\",\"role\":\"fetch\",\"order\":%u,\"address\":%u,\"value\":%u}\n", sup_order++,c,mem[c]);''')
    inst = change(inst, "case 'j': d = mem[d]; break;", "case 'j': d = sup_read(mem,d); break;")
    inst = change(inst, "case 'i': c = mem[d]; break;", "case 'i': c = sup_read(mem,d); break;")
    inst = change(inst, "case '*': a = mem[d] = mem[d] / 3 + mem[d] % 3 * 19683; break;", "case '*': { unsigned short old = sup_read(mem,d); a = mem[d] = old / 3 + old % 3 * 19683; sup_write(\"data-write\",d,old,mem[d]); break; }")
    inst = change(inst, "case 'p': a = mem[d] = op( a, mem[d] ); break;", "case 'p': { unsigned short old = sup_read(mem,d); a = mem[d] = op(a,old); sup_write(\"data-write\",d,old,mem[d]); break; }")
    inst = change(inst, '        putc( a, stdout );', r'''        putc( a, stdout );
        fprintf(sup_trace, "{\"kind\":\"output\",\"byte\":%u}\n", (unsigned char)a);''')
    inst = change(inst, '        if ( x == EOF ) a = 59048; else a = x;', r'''        if ( x == EOF ) a = 59048; else a = x;
        fprintf(sup_trace, "{\"kind\":\"input\",\"value\":%d,\"eof\":%s}\n",x,x==EOF ? "true":"false");''')
    inst = change(inst, "      case 'v': return;", "      case 'v': sup_end(a,c,d,1); sup_finish(mem,\"HALTED\"); return;")
    inst = change(inst, '    mem[c] = xlat2[mem[c] - 33];', r'''    if (mem[c] < 33 || mem[c] > 127) { sup_finish(mem,"REFERENCE_UNDEFINED"); return; }
    { unsigned short old = mem[c]; mem[c] = xlat2[mem[c] - 33]; sup_write("encryption",c,old,mem[c]); }''')
    inst = change(inst, '    if ( d == 59048 ) d = 0; else d++;', '    if ( d == 59048 ) d = 0; else d++;\n    sup_end(a,c,d,0);')
    (OUT / 'malbolge.instrumented.c').write_text(inst)
    (OUT / 'instrumentation.patch').write_text(''.join(difflib.unified_diff(text.splitlines(True), inst.splitlines(True), fromfile='malbolge.original.c', tofile='malbolge.instrumented.c')))
    commands = []
    for stem in ('portable', 'instrumented'):
        cmd = ['clang','-std=c99','-O2',str(OUT / f'malbolge.{stem}.c'),'-o',str(OUT / f'malbolge.{stem}')]
        subprocess.run(cmd, check=True, capture_output=True, timeout=45)
        commands.append(cmd)
    fixture = ROOT / 'docs/desktop-v0.1/fixtures/recurrent_crazy4.mb'
    logical = bytes(b for b in fixture.read_bytes() if b not in (9,10,11,12,13,32))
    assert len(logical) == 87 and sha(logical) == FIXTURE_SHA
    cases = [('abc-lf', bytes.fromhex('4142430a'), '4a'), ('zeros',b'0000','2d'), ('last-one',b'0001','2c'), ('alternating',b'0101','2c'), ('high-bytes',bytes([0,127,128,255]),None), ('closed-empty',b'',None)]
    results = []
    for name, stdin, expected_out in cases:
        directory = OUT / 'cases' / name
        directory.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, BOLGE_SUPERVISOR_TRACE=str(directory/'trace.jsonl'), BOLGE_SUPERVISOR_INITIAL=str(directory/'initial.u16'), BOLGE_SUPERVISOR_FINAL=str(directory/'final.u16'))
        traced = subprocess.run([str(OUT/'malbolge.instrumented'),str(fixture)], input=stdin, capture_output=True, timeout=10, env=env, check=True)
        untraced = subprocess.run([str(OUT/'malbolge.portable'),str(fixture)], input=stdin, capture_output=True, timeout=10, check=True)
        events = [json.loads(line) for line in (directory/'trace.jsonl').read_text().splitlines()]
        after = [e for e in events if e['kind']=='after']
        writes78 = [e['after'] for e in events if e['kind']=='write' and e['role']=='data-write' and e['address']==78]
        final_mem = struct.unpack(('>' if sys.byteorder=='big' else '<')+'59049H',(directory/'final.u16').read_bytes())
        assertions = {'tracedEqualsOriginal':traced.stdout==untraced.stdout,'halted':events[-1]['status']=='HALTED','steps24':len(after)==24,'xlat2NulBoundary':events[0]['xlat2Size']==95 and events[0]['xlat2_94']==0}
        if expected_out is not None: assertions['expectedOutput'] = traced.stdout.hex() == expected_out
        if name=='abc-lf':
            assertions['registers'] = [after[-1][k] for k in ('a','c','d')]==[29514,23,80]
            assertions['memory78'] = final_mem[78]==29514
            assertions['writes78'] = writes78==[29487,29485,29484,29514]
        result = {'name':name,'inputHex':stdin.hex(),'outputHex':traced.stdout.hex(),'step':len(after),'finalRegisters':{k:after[-1][k] for k in ('a','c','d')},'dataWrites78':writes78,'initialMemorySha256':sha((directory/'initial.u16').read_bytes()),'finalMemorySha256':sha((directory/'final.u16').read_bytes()),'assertions':assertions,'status':'PASS' if all(assertions.values()) else 'FAIL'}
        (directory/'result.json').write_text(json.dumps(result,indent=2)+'\n')
        results.append(result)
    report = {'kind':'independent-supervisor-reference','originalUrl':URL,'originalSha256':EXPECTED,'fixtureLogicalSha256':FIXTURE_SHA,'instrumentedSha256':sha(inst.encode()),'byteOrder':sys.byteorder,'commands':commands,'cases':results,'status':'PASS' if all(x['status']=='PASS' for x in results) else 'FAIL','productVMCompared':False}
    (OUT/'reference-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'referenceCases':len(results),'cases':[{'name':r['name'],'outputHex':r['outputHex'],'step':r['step'],'status':r['status']} for r in results],'report':str(OUT/'reference-results.json')},indent=2))
    if report['status']!='PASS': raise SystemExit(1)

if __name__ == '__main__':
    main()
