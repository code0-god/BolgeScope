#!/usr/bin/env python3
"""Real macOS app acceptance: WebDriver + existing Accessibility authorization.

Only controls the BolgeScope QA process that owns localhost:4451. Test files are
inside evidence/supervisor; no user's unrelated app/files/settings are changed.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import time
from native_driver import Driver, OUT

ROOT=OUT.parents[1]

def apple(script):
    return subprocess.run(['osascript','-e',script],capture_output=True,text=True,timeout=15,check=True).stdout.strip()

def picker(pid,path):
    # NSOpenPanel/NSSavePanel: navigate to a known test file/directory via Go To.
    script=f'''tell application "System Events"
  tell (first application process whose unix id is {pid})
    set frontmost to true
    delay 0.25
    keystroke "g" using {{command down, shift down}}
    delay 0.25
    keystroke {json.dumps(str(path))}
    key code 36
    delay 0.35
    key code 36
  end tell
end tell'''
    return apple(script)

def main():
    input_path=OUT/'native-input.mb'
    original=(ROOT/'docs/desktop-v0.1/fixtures/recurrent_crazy4.mb').read_bytes()
    input_path.write_bytes(original)
    savedir=OUT/('native-save-'+str(time.time_ns()))
    savedir.mkdir()
    ids=subprocess.run(['lsof','-nP','-iTCP:4451','-sTCP:LISTEN','-t'],capture_output=True,text=True,check=True).stdout.split()
    assert len(ids)==1,ids
    pid=int(ids[0]); checks=[];d=Driver()
    def record(name,detail=None):
        checks.append({'name':name,'status':'PASS','detail':detail});print('PASS',name,flush=True)
    try:
        runtime=d.script('return {url:location.href,ua:navigator.userAgent,secure:isSecureContext,editor:!!document.querySelector(".monaco-editor")};')
        assert runtime['url'].startswith('tauri://') and 'AppleWebKit' in runtime['ua'] and 'Chrome/' not in runtime['ua'] and runtime['editor']
        record('actual-native-WKWebView-and-Monaco',runtime)
        # Open through the real native picker, not a mock grant or injected source.
        d.button('열기',"//div[contains(@class,'toolbar-actions')]/")
        picker(pid,input_path)
        d.wait("document.querySelector('.status-bar')?.textContent.includes('87 cells')")
        d.wait("document.querySelector('.document-title')?.textContent.includes('native-input.mb')")
        assert 'rev 0' in d.text('.status-bar')
        record('native-file-picker-opens-exact-source',{'path':str(input_path),'sourceSha256':hashlib.sha256(original).hexdigest(),'bytes':len(original)})
        d.button('실행',"//div[contains(@class,'toolbar-actions')]/")
        d.wait("document.querySelector('.status-bar')?.textContent.includes('WAITING_INPUT')")
        record('runtime-worker-loads-and-waits-for-input')
        d.script("const s=document.querySelector('select[aria-label=\"입력 형식\"]');s.value='hex';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value;")
        d.fill('textarea[aria-label="입력 데이터"]','41 42 43 0A')
        d.wait("document.body.innerText.includes('41 42 43 0A')")
        d.button('전송')
        d.wait("document.querySelector('.status-bar')?.textContent.includes('HALTED')")
        d.button('hex')
        output=d.text('.output-box').strip().lower();assert output=='4a',output
        registers=d.script("return Array.from(document.querySelectorAll('.register strong')).map(x=>Number(x.textContent));")
        assert registers==[29514,23,80],registers
        record('native-input-output-halt',{'inputHex':'4142430a','outputHex':output,'registers':registers})
        d.screenshot('native-fixture-halted.png')
        d.button('Back',"//div[contains(@class,'toolbar-actions')]/")
        d.wait("document.querySelector('.status-bar')?.textContent.includes('REWOUND')")
        d.button('Step',"//div[contains(@class,'toolbar-actions')]/")
        d.wait("document.querySelector('.status-bar')?.textContent.includes('HALTED')")
        again=d.script("return Array.from(document.querySelectorAll('.register strong')).map(x=>Number(x.textContent));")
        assert again==registers and d.text('.output-box').strip().lower()=='4a'
        record('native-Halt-StepBack-replay')
        d.button('다른 이름',"//div[contains(@class,'toolbar-actions')]/")
        picker(pid,savedir)
        target=savedir/input_path.name
        start=time.monotonic()
        while not target.exists() and time.monotonic()-start<8:time.sleep(.05)
        assert target.exists(),f'Native Save As did not create {target}'
        assert target.read_bytes()==original,'Saved source must be byte-identical (not runtime memory or extra LF)'
        assert input_path.read_bytes()==original
        record('native-save-as-preserves-source-bytes',{'path':str(target),'bytes':len(original),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        d.screenshot('native-after-save.png')
    except Exception as error:
        checks.append({'name':'current-native-flow','status':'FAIL','error':repr(error)})
        try:d.screenshot('native-failure.png')
        except Exception:pass
        raise
    finally:
        executable=ROOT/'apps/desktop/src-tauri/target/debug/bundle/macos/BolgeScope QA.app/Contents/MacOS/bolgescope-desktop'
        report={'status':'PASS' if all(c['status']=='PASS' for c in checks) else 'FAIL','kind':'actual macOS WKWebView instrumented QA app; real native file picker and disk save, no VM/IPC mocks','time':time.strftime('%Y-%m-%dT%H:%M:%S%z'),'executable':str(executable),'executableSha256':hashlib.sha256(executable.read_bytes()).hexdigest(),'checks':checks,'productionAutomationPlugin':False,'notCovered':['Public Developer ID signing/notarization','Different Mac','Full Korean IME composition/VoiceOver audit']}
        (OUT/'native-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
        d.close()

if __name__=='__main__':main()
