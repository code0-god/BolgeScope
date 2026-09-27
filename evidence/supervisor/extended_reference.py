#!/usr/bin/env python3
"""Bounded original-C cases and a real revisited-cell teaching fixture.

All programs here are ordinary legal Malbolge source. The offline test-fixture
search is not an application feature and never injects runtime machine state.
"""
from __future__ import annotations
import ast
import json
import os
from pathlib import Path
import random
import re
import struct
import subprocess
import sys
from prepare_reference import OUT, ROOT, sha

source = (OUT/'malbolge.original.c').read_text()
match = re.search(r'const char xlat1\[\]\s*=\s*((?:"(?:\\.|[^"\\])*"\s*)+);', source, re.S)
assert match
XLAT1 = ''.join(ast.literal_eval(s) for s in re.findall(r'"(?:\\.|[^"\\])*"',match[1]))
assert len(XLAT1)==94

def enc(op: str, address: int) -> str:
    return next(chr(v) for v in range(33,127) if XLAT1[(v-33+address)%94]==op)

def program(ops: list[str]) -> str:
    return ''.join(enc(op,i) for i,op in enumerate(ops))

def execute(name: str, raw: str, data: bytes, max_steps: int=1000) -> dict:
    folder = OUT/'extended'/name
    folder.mkdir(parents=True,exist_ok=True)
    path=folder/'program.mb'; path.write_text(raw,encoding='ascii')
    assert all(XLAT1[(ord(c)-33+i)%94] in 'ji*p</vo' for i,c in enumerate(raw))
    env = dict(os.environ,BOLGE_SUPERVISOR_TRACE=str(folder/'trace.jsonl'),BOLGE_SUPERVISOR_INITIAL=str(folder/'initial.u16'),BOLGE_SUPERVISOR_FINAL=str(folder/'final.u16'))
    r=subprocess.run([str(OUT/'malbolge.bounded'),str(path)],input=data,capture_output=True,timeout=5,check=True,env=env)
    ev=[json.loads(x) for x in (folder/'trace.jsonl').read_text().splitlines()]
    states=[x for x in ev if x['kind']=='after']
    seen={}; revisits=[]
    for e in ev:
        if e['kind']!='before':continue
        if e['c'] in seen:
            first=seen[e['c']]
            revisits.append({'address':e['c'],'firstStep':first['step'],'nextStep':e['step'],'firstRaw':first['raw'],'nextRaw':e['raw'],'firstDecoded':chr(first['decoded']),'nextDecoded':chr(e['decoded'])})
        else:seen[e['c']]=e
    relative = folder.relative_to(OUT)
    result={'name':name,'raw':raw,'sourceSha256':sha(raw.encode()),'inputHex':data.hex(),'outputHex':r.stdout.hex(),'terminal':ev[-1]['status'],'step':len(states),'final':states[-1] if states else None,'revisits':revisits,'tracePath':str(relative/'trace.jsonl'),'initialPath':str(relative/'initial.u16'),'finalPath':str(relative/'final.u16')}
    (folder/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def main():
    bounded=(OUT/'malbolge.instrumented.c').read_text().replace('sup_steps >= 50000','sup_steps >= 1000')
    (OUT/'malbolge.bounded.c').write_text(bounded)
    subprocess.run(['clang','-std=c99','-O2',str(OUT/'malbolge.bounded.c'),'-o',str(OUT/'malbolge.bounded')],check=True,capture_output=True,timeout=45)
    cases=[]
    def add(name,ops,data=b''):
        result=execute(name,program(ops),data); cases.append(result); return result
    e=add('single-byte-echo',list('/<v'),b'\xff'); assert e['terminal']=='HALTED' and e['outputHex']=='ff' and e['step']==3
    e=add('zero-byte-output',list('<v')); assert e['outputHex']=='00'
    e=add('movd-post-increment',list('jv')); assert e['final']['d']==41 and e['final']['c']==1
    ops=['o']*100;ops[0]='i';ops[99]='v'
    e=add('jump-encrypt-target',ops);assert e['step']==2 and e['final']['c']==99
    ev=[json.loads(x) for x in (OUT/e['tracePath']).read_text().splitlines()]; w=[x for x in ev if x['kind']=='write']; assert w[0]['address']==98
    ops=['o']*36;ops[34]='*';ops[35]='v'
    e=add('ordered-same-cell-writes',ops);assert e['step']==36 and e['terminal']=='HALTED'
    ev=[json.loads(x) for x in (OUT/e['tracePath']).read_text().splitlines()]; w=[x for x in ev if x['kind']=='write' and x['address']==34]; assert [(x['before'],x['after']) for x in w]==[(99,33),(33,53)]
    e=add('unsafe-rotate-rollback-boundary',list('*v'));assert e['terminal']=='REFERENCE_UNDEFINED' and e['step']==0
    e=add('invalid-generated-fetch',list('oo'));assert e['terminal']=='STALLED_INVALID_FETCH' and e['step']==2
    rng=random.Random(20260927); found=None
    for attempt in range(128):
        ops=[rng.choice('ji*p</vo') for _ in range(128)]
        e=execute(f'revisit-search-{attempt:03}',program(ops),b'ABC\n')
        if e['terminal']=='HALTED' and any(x['firstDecoded']!=x['nextDecoded'] for x in e['revisits']):
            found=e;found['synthesis']={'seed':20260927,'attempt':attempt,'length':128,'method':'bounded offline fixture search, not app feature'}
            (OUT/'revisit.mb').write_text(e['raw'],encoding='ascii')
            (OUT/'revisit-result.json').write_text(json.dumps(found,indent=2)+'\n')
            break
    report={'status':'PASS','edgeCases':cases,'revisit':found,'reference':'original-C bounded instrumented','productCompared':False}
    (OUT/'extended-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'edgeCases':[{'name':x['name'],'terminal':x['terminal'],'step':x['step']} for x in cases],'revisitFound':found is not None,'revisit':{'path':str(OUT/'revisit.mb'),'step':found['step'],'changedVisits':[x for x in found['revisits'] if x['firstDecoded']!=x['nextDecoded']][:5]} if found else None},indent=2))

if __name__=='__main__':main()
