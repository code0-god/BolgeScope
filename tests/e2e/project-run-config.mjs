import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Native dialogs are the only substituted boundary; App and Workers run unchanged.
const base = process.env.BOLGE_BASE_URL ?? 'http://127.0.0.1:1420';
const mocksUrl = `/@fs${fileURLToPath(import.meta.resolve('@tauri-apps/api/mocks'))}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Given a native project with settings different from every execution default.
  await page.goto(new URL('/package.json', base).href);
  await page.evaluate(async mocksUrl => {
    const { mockIPC, mockWindows } = await import(mocksUrl);
    const source = Array.from(new Uint8Array(await (await fetch('/examples/recurrent_crazy4.mb')).arrayBuffer()));
    const project = {
      schemaVersion: 1, projectId: 'project-run-regression', name: 'Run settings',
      source: { kind: 'raw', path: 'programs/main.mb' }, semanticsProfile: 'bolgescope-tio-safe-v1',
      run: { inputHex: '4142430A', closeInput: true, maxInstructions: 1, historyLimitMiB: 1, outputLimitBytes: 1 },
    };
    mockIPC((command, args) => {
      switch (command) {
        case 'list_recovery': return [];
        case 'select_project': return { grantId: 'project-grant', targetId: 'project-target', name: project.name };
        case 'read_project_file':
          if (args.relativePath === 'project.bolgeproj.json') return { bytes: Array.from(new TextEncoder().encode(JSON.stringify(project))), diskRevision: 'project-revision' };
          if (args.relativePath === project.source.path) return { bytes: source, diskRevision: 'source-revision' };
          throw { code: 'NOT_FOUND', message: 'No notes file' };
        default: throw new Error(`Unexpected native command: ${command}`);
      }
    }, { shouldMockEvents: true });
    mockWindows('main');
    document.body.innerHTML = '<div id="root"></div>';
    const { injectIntoGlobalHook } = await import('/@react-refresh');
    injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    await import('/src/main.tsx');
  }, mocksUrl);
  await page.getByRole('tab', { name: 'Tests', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 폴더 선택', exact: true }).click();
  await page.locator('.document-title').filter({ hasText: 'main.mb' }).waitFor();
  await page.getByRole('tab', { name: 'I/O', exact: true }).click();

  // When the project is run through its normal toolbar action.
  await page.locator('.toolbar-actions button.primary').click();
  await page.locator('.status-pill').filter({ hasText: /BUDGET|INPUT_EMPTY/ }).waitFor();

  // Then configuration survived project parsing, document creation and Worker load.
  assert.equal(await page.locator('.status-pill').textContent(), 'PAUSED · BUDGET');
  assert.equal(await page.locator('[aria-label="레지스터"] .section-heading span').textContent(), 'STEP 1');
  assert.equal(await page.locator('.io-column .section-heading span').first().textContent(), '0/4 · EOF');

  // Given that paused project, switching the editor must not replace its session settings.
  await page.getByRole('button', { name: '새 Raw 문서', exact: true }).click();
  await page.getByRole('button', { name: '재시작', exact: true }).click();
  await page.locator('[aria-label="레지스터"] .section-heading span').filter({ hasText: 'STEP 0' }).waitFor();

  // When the original snapshot is run again from the other document.
  await page.locator('.toolbar-actions button.primary').click();
  await page.locator('.status-pill').filter({ hasText: /BUDGET|INPUT_EMPTY/ }).waitFor();

  // Then restart uses the original settings and does not duplicate its input tape.
  assert.equal(await page.locator('.status-pill').textContent(), 'PAUSED · BUDGET');
  assert.equal(await page.locator('[aria-label="레지스터"] .section-heading span').textContent(), 'STEP 1');
  assert.equal(await page.locator('.io-column .section-heading span').first().textContent(), '0/4 · EOF');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', projectBudget: 1, inputBytes: 4, eof: true, restartAcrossDocuments: true, errors }));
} finally {
  await browser.close();
}
