import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const errors = [];
const base = process.env.BOLGE_BASE_URL ?? 'http://127.0.0.1:1421';

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell').waitFor();
  await page.getByRole('combobox', { name: '언어' }).selectOption('en');
  return page;
}

async function scenario(name, run) {
  const page = await fresh();
  try { await run(page); results.push({ name, status: 'PASS' }); }
  finally { await page.close(); }
}

function sourceRevision(page) {
  return page.locator('.status-bar span').nth(1).textContent();
}

async function openExample(page) {
  await page.getByRole('button', { name: 'Open regression example' }).click();
  await page.getByText('87 cells', { exact: false }).first().waitFor();
}

try {
  await scenario('source, normalized, snapshot and CRLF model changes keep source revision', async page => {
    await page.getByRole('button', { name: 'New Normalized document' }).click();
    await page.locator('.monaco-editor').click({ position: { x: 130, y: 35 } });
    await page.keyboard.insertText('j\r\nv');
    const edited = await sourceRevision(page);
    assert.match(edited, /rev [1-9]/);
    await page.getByRole('tab', { name: 'Generated Raw' }).click();
    await page.getByRole('tab', { name: 'Source · Normalized' }).click();
    assert.equal(await sourceRevision(page), edited);
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByRole('tab', { name: 'Initial snapshot' }).click();
    await page.getByRole('tab', { name: 'Source · Normalized' }).click();
    assert.equal(await sourceRevision(page), edited);
  });

  await scenario('EOF closes input and disables Send', async page => {
    await openExample(page);
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('WAITING_INPUT', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Send EOF' }).click();
    await page.getByRole('textbox', { name: 'Input data' }).fill('A');
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  });

  await scenario('note draft survives document, inspector and Learn switches without changing source', async page => {
    await openExample(page);
    await page.getByRole('button', { name: 'Address 3, p' }).click();
    const originalRevision = await sourceRevision(page);
    await page.getByRole('textbox', { name: 'Alias' }).fill('draft alias');
    await page.getByRole('textbox', { name: 'User explanation' }).fill('draft explanation');
    await page.getByText('Unsaved draft').waitFor();
    await page.getByRole('button', { name: 'New Raw document' }).click();
    const restoredAfterDocumentSwitch = page.waitForFunction(() => document.querySelector('.notes-panel input')?.value === 'draft alias');
    await page.getByRole('button', { name: 'recurrent_crazy4.mb' }).click();
    await page.getByRole('button', { name: 'Address 3, p' }).click();
    await restoredAfterDocumentSwitch;
    assert.equal(await page.getByRole('textbox', { name: 'Alias' }).inputValue(), 'draft alias');
    await page.getByRole('button', { name: 'Hide inspector' }).click();
    const restoredAfterInspectorSwitch = page.waitForFunction(() => document.querySelector('.notes-panel textarea')?.value === 'draft explanation');
    await page.getByRole('button', { name: 'Show inspector' }).click();
    await restoredAfterInspectorSwitch;
    assert.equal(await page.getByRole('textbox', { name: 'User explanation' }).inputValue(), 'draft explanation');
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    const restoredAfterWorkspaceSwitch = page.waitForFunction(() => document.querySelector('.notes-panel input')?.value === 'draft alias');
    await page.getByRole('button', { name: 'Write', exact: true }).click();
    await restoredAfterWorkspaceSwitch;
    assert.equal(await page.getByRole('textbox', { name: 'Alias' }).inputValue(), 'draft alias');
    assert.equal(await sourceRevision(page), originalRevision);
    assert.equal(await page.locator('.document-title').textContent(), 'recurrent_crazy4.mb');
    assert.doesNotMatch(await page.locator('.monaco-editor .view-lines').textContent(), /draft explanation/);
  });

  await scenario('latest Timeline event is a read-only historical point', async page => {
    await openExample(page);
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    await page.getByText('STEP_COMPLETE', { exact: false }).first().waitFor();
    const live = await page.locator('.status-bar').textContent();
    await page.getByRole('tab', { name: 'Timeline' }).click();
    await page.locator('.timeline-list button').first().click();
    await page.getByText(/HISTORY EVENT/).waitFor();
    assert.equal(await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Step', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.status-bar').textContent(), live);
  });

  await scenario('Continue passes the current breakpoint once', async page => {
    await openExample(page);
    await page.getByRole('button', { name: 'Address 0, j' }).click();
    await page.getByRole('button', { name: 'Add selected address' }).click();
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('BREAKPOINT', { exact: false }).first().waitFor();
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('WAITING_INPUT', { exact: false }).first().waitFor();
    assert.doesNotMatch(await page.locator('.status-bar').textContent(), /BREAKPOINT/);
  });

  await scenario('whitespace keeps address bindings; changed cells request review', async page => {
    await openExample(page);
    await page.getByRole('button', { name: 'Address 0, j' }).click();
    await page.getByRole('button', { name: 'Add selected address' }).click();
    await page.locator('.monaco-editor').click({ position: { x: 130, y: 35 } });
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.insertText(' ');
    assert.equal(await page.locator('.pane-block').filter({ has: page.getByRole('heading', { name: 'Breakpoints' }) }).locator('.section-heading span').textContent(), '1');
    await page.locator('.toolbar-actions').getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('BREAKPOINT', { exact: false }).first().waitFor();
    await page.locator('.monaco-editor').click({ position: { x: 130, y: 35 } });
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.insertText('X');
    await page.getByText('Address bindings need review').waitFor();
  });

  await scenario('compact toolbar keeps secondary actions scrollable', async page => {
    await page.setViewportSize({ width: 700, height: 650 });
    for (const label of ['Save As', 'Reverse', 'Restart', 'Stop']) {
      const button = page.getByRole('button', { name: label, exact: true });
      assert.notEqual(await button.evaluate(element => getComputedStyle(element).display), 'none');
    }
    assert.equal(await page.locator('.toolbar-actions').evaluate(element => element.scrollWidth > element.clientWidth), true);
  });

  assert.deepEqual(errors, []);
  writeFileSync(new URL('../../evidence/current/ui-browser.json', import.meta.url), JSON.stringify({ status: 'PASS', results, errors }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', results }));
} finally {
  await browser.close();
}
