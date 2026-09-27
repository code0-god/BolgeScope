#!/usr/bin/env python3
"""Actual macOS WKWebView acceptance. No VM or native file IPC mocks.
Run only against this workspace's optional Acceptance app on port 4452.
All test documents and screenshots are kept under evidence/current/native/.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'evidence/current/native'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'evidence/supervisor'))
import native_driver
from check_native import picker as navigate_picker

def picker(pid, path):
    # NSOpenPanel is created asynchronously on macOS; wait before Go To.
    time.sleep(1.0)
    return navigate_picker(pid, path)

native_driver.BASE = 'http://127.0.0.1:4452'
native_driver.OUT = OUT

def main():
    original = (ROOT / 'docs/desktop-v0.1/fixtures/recurrent_crazy4.mb').read_bytes()
    fixture = OUT / 'fixture.mb'
    fixture.write_bytes(original)
    save_dir = OUT / ('saved-' + str(time.time_ns()))
    save_dir.mkdir()
    pids = subprocess.check_output(['lsof', '-nP', '-iTCP:4452', '-sTCP:LISTEN', '-t'], text=True).split()
    assert len(pids) == 1, pids
    pid = int(pids[0])
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
    executable = ROOT / 'apps/desktop/src-tauri/target/debug/bundle/macos/BolgeScope Acceptance.app/Contents/MacOS/bolgescope-desktop'
    loaded_images = subprocess.check_output(['lsof','-a','-p',str(pid),'-d','txt','-Fn'], text=True)
    assert ('n'+str(executable)) in loaded_images.splitlines(), command
    d = native_driver.Driver()
    checks = []
    def passed(name, detail=None):
        checks.append({'name': name, 'status': 'PASS', 'detail': detail})
        print('PASS', name, flush=True)
    def toolbar(name):
        d.button(name, "//div[contains(@class,'toolbar-actions')]/")
    def registers():
        return d.script("return Array.from(document.querySelectorAll('.register strong')).map(e=>Number(e.textContent));")
    def halted():
        return d.wait("document.querySelector('.status-bar')?.textContent.includes('HALTED')")
    try:
        d.wait("!!document.querySelector('.monaco-editor')")
        info = d.script('return {url:location.href,userAgent:navigator.userAgent,secure:isSecureContext};')
        assert info['url'].startswith('tauri://') and info['secure'] and 'AppleWebKit' in info['userAgent'] and 'Chrome/' not in info['userAgent'], info
        passed('actual-WKWebView-offline-assets-and-Monaco', info)
        toolbar('열기'); picker(pid, fixture)
        d.wait("document.querySelector('.document-title')?.textContent.includes('fixture.mb') && document.querySelector('.status-bar')?.textContent.includes('87 cells')")
        assert 'rev 0' in d.text('.status-bar')
        passed('real-native-file-picker-no-auto-execution', {'bytes':len(original),'sha256':hashlib.sha256(original).hexdigest()})
        d.click('.lens-cells button[aria-label^="주소 3,"]')
        d.button('선택 주소 추가')
        toolbar('실행')
        d.wait("document.querySelector('.status-bar')?.textContent.includes('WAITING_INPUT')")
        d.script("const s=document.querySelector('.io-column select'); s.value='hex'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value;")
        d.fill('textarea[aria-label="입력 데이터"]', '41 42 43 0A')
        d.button('전송')
        d.wait("document.querySelector('.status-bar')?.textContent.includes('BREAKPOINT')")
        assert registers() == [65,3,78], registers()
        passed('address-breakpoint-before-crazy', {'registers':registers()})
        toolbar('실행'); halted()
        d.button('hex')
        assert d.text('.output-box').strip().lower() == '4a'
        assert registers() == [29514,23,80], registers()
        assert 'STEP 24' in d.text('.inspector')
        passed('continue-input-crazy-one-byte-output-and-Halt', {'inputHex':'4142430a','outputHex':'4a','registers':registers(),'steps':24})
        d.screenshot('halted.png')
        d.click('.dock-tabs button[role="tab"]:nth-child(3)')
        d.fill('.memory-controls input','78')
        d.script("document.querySelector('.memory-controls input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;")
        d.wait("document.querySelector('.selected-row')?.textContent.includes('29514')")
        row = d.text('.selected-row')
        assert '84' in row and '29514' in row, row
        passed('runtime-memory-78-from-Worker', row)
        d.click('.dock-tabs button[role="tab"]:nth-child(2)')
        d.click('.timeline-list button:first-child')
        d.wait("document.querySelector('.inspector-title')?.textContent.includes('HISTORY')")
        assert registers() == [29514,23,80], registers()
        passed('latest-history-row-remains-a-valid-read-only-view')
        eid = d.xpath("//div[contains(@class,'timeline-list')]/button[contains(.,'fetch 3 · p')]")
        d.call('POST','/element/'+eid+'/click',{})
        d.wait("Array.from(document.querySelectorAll('.register strong')).map(e=>e.textContent).join(',')==='29487,4,79'")
        assert 'HALTED' in d.text('.status-bar')
        passed('historical-registers-consistent-with-live-Halt-unchanged')
        d.screenshot('history.png')
        d.button('현재로 돌아가기')
        d.click('.dock-tabs button[role="tab"]:nth-child(1)')
        toolbar('Back')
        d.wait("document.querySelector('.status-bar')?.textContent.includes('REWOUND')")
        toolbar('Back')
        d.wait("document.querySelector('.output-box')?.textContent.trim()==='' ")
        toolbar('Step'); toolbar('Step'); halted()
        d.button('hex')
        assert registers() == [29514,23,80] and d.text('.output-box').strip().lower() == '4a'
        passed('undo-Halt-and-output-then-exact-replay')
        toolbar('다른 이름'); picker(pid, save_dir)
        target = save_dir / fixture.name
        deadline = time.monotonic()+10
        while not target.exists() and time.monotonic()<deadline: time.sleep(.05)
        assert target.exists(), f'Native Save As did not create {target}'
        assert target.read_bytes() == original and fixture.read_bytes() == original
        passed('native-Save-As-preserves-exact-Source-not-Runtime', {'path':str(target.relative_to(ROOT)), 'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        crlf = OUT/'crlf.mb'; crlf_bytes=original.replace(b'\n',b'\r\n'); crlf.write_bytes(crlf_bytes)
        toolbar('열기'); picker(pid,crlf)
        d.wait("document.querySelector('.document-title')?.textContent.includes('crlf.mb')")
        assert 'rev 0' in d.text('.status-bar')
        toolbar('다른 이름'); picker(pid,save_dir)
        target=save_dir/'crlf.mb'; deadline=time.monotonic()+10
        while not target.exists() and time.monotonic()<deadline:time.sleep(.05)
        assert target.read_bytes()==crlf_bytes
        passed('native-CRLF-file-roundtrip-is-byte-exact', {'bytes':len(crlf_bytes)})
        d.screenshot('after-save.png')
    except Exception as error:
        detail = None
        try: detail = d.script("return {title:document.querySelector('.document-title')?.textContent, status:document.querySelector('.status-bar')?.textContent, notices:Array.from(document.querySelectorAll('.notice')).map(e=>e.textContent), text:document.body.innerText.slice(-4000)};")
        except Exception: pass
        checks.append({'name':'native-flow','status':'FAIL','error':repr(error),'diagnostic':detail})
        try:d.screenshot('failure.png')
        except Exception:pass
        raise
    finally:
        report={'status':'PASS' if checks and all(c['status']=='PASS' for c in checks) else 'FAIL',
                'kind':'actual macOS WKWebView, optional test-only WebDriver, real native pickers and disk I/O; no VM/IPC mocks',
                'timestamp':time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'process':command, 'pid':pid,
                'executableSha256':hashlib.sha256(executable.read_bytes()).hexdigest(), 'checks':checks,
                'notCovered':['Developer ID signing and notarization','Other Mac / older macOS','Full Korean IME composition and VoiceOver audit','Final uninstrumented release interaction (separate smoke)']}
        (OUT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
        d.close()
if __name__=='__main__':main()
