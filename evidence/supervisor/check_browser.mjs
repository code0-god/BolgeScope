import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({channel:'chrome',headless:true});
const tests=[];const errors=[];
async function pageFor(){const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(8000);page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.goto('http://127.0.0.1:1421/',{waitUntil:'domcontentloaded'});await page.locator('.monaco-editor').waitFor({state:'visible'});return page;}
async function check(name,fn){console.log('START',name);let page;try{page=await pageFor();const detail=await fn(page);tests.push({name,status:'PASS',detail});}catch(e){tests.push({name,status:'FAIL',error:String(e)});if(page)await page.screenshot({path:out+'/'+name+'-failure.png'});}finally{await page?.close();console.log(JSON.stringify(tests.at(-1)));}}
async function status(page){return page.locator('.status-bar').innerText();}
async function source(page){return page.evaluate(async()=>{const loaded=performance.getEntriesByType('resource').map(x=>x.name).find(url=>/monaco-editor(?:\.js|_editor_editor__api__js\.js|\/editor\/editor\.api\.js)/.test(url));if(!loaded)throw Error('Loaded Monaco module URL not found');const monaco=await import(loaded);const editor=monaco.editor.getEditors()[0];if(!editor)throw Error('Active Monaco editor not found');return editor.getValue();});}
await check('view-switch-preserves-normalized-authored-source',async page=>{
 await page.getByRole('button',{name:'새 Normalized 문서',exact:true}).click();
 await page.locator('.monaco-editor').click({position:{x:130,y:35}});
 await page.keyboard.insertText('j\nj\n/\np');
 await page.waitForTimeout(100);
 const before=await source(page),revision=await status(page);
 await page.getByRole('tab',{name:'Generated Raw',exact:true}).click();
 await page.waitForTimeout(100);
 await page.getByRole('tab',{name:/Source · Normalized/}).click();
 await page.waitForTimeout(100);
 assert.equal(await source(page),before,'Generated Raw view must not overwrite .nmal origin');
 assert.equal(await status(page),revision,'Read-only view switch must not change document revision');
});
await check('opening-example-is-not-an-editor-mutation',async page=>{
 await page.getByRole('button',{name:'회귀 예제 열기',exact:true}).click();await page.waitForTimeout(100);
 assert.match(await status(page),/87 cells/);
 assert.match(await status(page),/rev 0\b/,'Loading source into editor is not an edit');
 assert.equal(await page.locator('.document-title').getByLabel('저장되지 않음').count(),0);
});
await check('fixture-run-input-halt-back-replay',async page=>{
 await page.getByRole('button',{name:'회귀 예제 열기',exact:true}).click();
 await page.locator('.toolbar-actions').getByRole('button',{name:'실행',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('WAITING_INPUT'));
 await page.getByLabel('입력 형식').selectOption('hex');await page.getByLabel('입력 데이터').fill('41 42 43 0A');await page.getByRole('button',{name:'전송',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('HALTED'));
 await page.getByRole('button',{name:'hex',exact:true}).click();assert.equal((await page.locator('.output-box').innerText()).trim().toLowerCase(),'4a');
 assert.deepEqual(await page.locator('.register strong').allTextContents(),['29514','23','80']);
 await page.locator('.toolbar-actions').getByRole('button',{name:'Back',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('REWOUND'));
 await page.locator('.toolbar-actions').getByRole('button',{name:'Step',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('HALTED'));
 assert.deepEqual(await page.locator('.register strong').allTextContents(),['29514','23','80']);
 await page.screenshot({path:out+'/browser-fixture-halted.png'});
 return {outputHex:'4a',registers:[29514,23,80]};
});
await check('history-selection-uses-one-time-context',async page=>{
 await page.getByRole('button',{name:'회귀 예제 열기',exact:true}).click();
 await page.locator('.toolbar-actions').getByRole('button',{name:'실행',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('WAITING_INPUT'));
 await page.getByLabel('입력 데이터').fill('ABC');await page.getByLabel('LF 추가').check();await page.getByRole('button',{name:'전송',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent?.includes('HALTED'));
 await page.getByRole('tab',{name:'Timeline',exact:true}).click();
 const row=page.locator('.timeline-list button').filter({hasText:'fetch 3 · p'});await row.click();
 await page.waitForTimeout(100);
 assert.deepEqual(await page.locator('.register strong').allTextContents(),['29487','4','79'],'Historical registers must match selected p transaction, not live Halt');
 assert(await page.getByRole('button',{name:/되돌리기|Rewind/}).count()>0,'Historical view must provide explicit rewind');
});
await check('read-only-snapshot-does-not-discard-source-edit',async page=>{
 await page.getByRole('button',{name:'회귀 예제 열기',exact:true}).click();
 await page.locator('.toolbar-actions').getByRole('button',{name:'Step',exact:true}).click();await page.waitForTimeout(100);
 await page.getByRole('tab',{name:'Source · Raw',exact:true}).click();await page.locator('.monaco-editor').click({position:{x:150,y:35}});await page.keyboard.press('Meta+End');await page.keyboard.insertText('\n ');await page.waitForTimeout(100);
 const before=await source(page),revision=await status(page);
 await page.getByRole('tab',{name:'Initial snapshot',exact:true}).click();await page.waitForTimeout(100);
 await page.getByRole('tab',{name:'Source · Raw',exact:true}).click();await page.waitForTimeout(100);
 assert.equal(await source(page),before);assert.equal(await status(page),revision);
});
await check('compact-layout-retains-main-controls',async page=>{
 await page.setViewportSize({width:1000,height:700});
 for(const name of ['실행','Step','일시정지'])assert(await page.locator('.toolbar-actions').getByRole('button',{name,exact:true}).isVisible());
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 await page.screenshot({path:out+'/browser-compact.png'});
});
const report={status:tests.every(t=>t.status==='PASS')&&errors.length===0?'PASS':'FAIL',timestamp:new Date().toISOString(),kind:'Chromium actual UI (NOT native WKWebView)',passed:tests.filter(t=>t.status==='PASS').length,failed:tests.filter(t=>t.status==='FAIL').length,errors,tests};fs.writeFileSync(out+'/browser-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await browser.close();process.exitCode=report.status==='PASS'?0:1;
