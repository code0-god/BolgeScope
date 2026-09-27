#!/usr/bin/env python3
"""Drive the actual local WKWebView QA app over test-only W3C WebDriver.
No VM/IPC mocks. Use only the parent-owned test app at loopback port4451.
"""
from __future__ import annotations
import base64
import json
from pathlib import Path
import time
import urllib.request
import urllib.error

OUT=Path(__file__).resolve().parent
BASE='http://127.0.0.1:4451'

def request(method:str,path:str,payload=None):
    data=None if payload is None else json.dumps(payload).encode()
    r=urllib.request.Request(BASE+path,data=data,method=method,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(r,timeout=15) as response:
            body=json.load(response)
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()) from e
    value=body.get('value',body)
    if isinstance(value,dict) and 'error' in value:raise RuntimeError(json.dumps(value))
    return value

class Driver:
    def __init__(self):
        result=request('POST','/session',{'capabilities':{'alwaysMatch':{}}})
        self.id=result['sessionId'];self.capabilities=result.get('capabilities',{})
    def call(self,method,path,payload=None):return request(method,'/session/'+self.id+path,payload)
    def script(self,script,*args):return self.call('POST','/execute/sync',{'script':script,'args':list(args)})
    def element(self,selector):
        r=self.call('POST','/element',{'using':'css selector','value':selector})
        return r['element-6066-11e4-a52e-4f735466cecf']
    def xpath(self,xpath):
        r=self.call('POST','/element',{'using':'xpath','value':xpath})
        return r['element-6066-11e4-a52e-4f735466cecf']
    def click(self,selector):self.call('POST','/element/'+self.element(selector)+'/click',{})
    def button(self,text,ancestor=''):
        prefix=ancestor if ancestor else '//'
        xpath=prefix+"button[normalize-space(.)="+json.dumps(text,ensure_ascii=False)+"]"
        self.call('POST','/element/'+self.xpath(xpath)+'/click',{})
    def text(self,selector):return self.call('GET','/element/'+self.element(selector)+'/text')
    def fill(self,selector,text):
        eid=self.element(selector);self.call('POST','/element/'+eid+'/clear',{});self.call('POST','/element/'+eid+'/value',{'text':text})
    def wait(self,condition,timeout=8):
        start=time.monotonic();last=None
        while time.monotonic()-start<timeout:
            try:
                last=self.script('return ('+condition+');')
                if last:return last
            except RuntimeError as e:last=str(e)
            time.sleep(.05)
        raise RuntimeError('Native condition timeout: '+condition+' last='+repr(last))
    def screenshot(self,name):
        encoded=self.call('GET','/screenshot');(OUT/name).write_bytes(base64.b64decode(encoded))
    def close(self):self.call('DELETE','')

if __name__=='__main__':
    d=Driver()
    try:
        result={'capabilities':d.capabilities,'runtime':d.script('return {url:location.href,userAgent:navigator.userAgent,secure:isSecureContext,monaco:!!document.querySelector(".monaco-editor"),buttons:Array.from(document.querySelectorAll("button")).map(e=>e.textContent.trim()),body:document.body.innerText.slice(0,5000)};')}
        (OUT/'native-discovery.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(result,ensure_ascii=False,indent=2))
        d.screenshot('native-start.png')
    finally:d.close()
