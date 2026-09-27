import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseProjectFile, parseTestCaseFile, requireExecutableProject } from '@bolgescope/contracts';
import type { ProjectFile, TestCase, TestResult } from '@bolgescope/contracts';
import type { JournalEvent, MachineState, SourceKind } from '@bolgescope/core';
import { createTestWorkerClient } from '@bolgescope/runtime';
import type { TestWorkerClient, TraceChunk } from '@bolgescope/runtime';
import { nativeAvailable, nativeError } from './native';

type GrantedFile = Readonly<{ grantId: string; name: string; bytes: number[]; diskRevision: string }>;
type ProjectGrant = Readonly<{ grantId: string; name: string }>;
type SavedFile = Readonly<{ diskRevision: string }>;
type ProjectSource = Readonly<{ name: string; kind: SourceKind; bytes: Uint8Array; projectId: string; projectGrantId: string; relativePath: string; diskRevision: string }>;
type Props = Readonly<{
  sourceText: string;
  sourceBytes: Uint8Array;
  sourceKind: SourceKind;
  sourceName: string;
  state: MachineState | null;
  history: readonly JournalEvent[];
  snapshotText: string | null;
  snapshotKind: SourceKind | null;
  sourceIdentityMatches: boolean;
  sourceProjectId: string | null;
  sourceRelativePath: string | null;
  traceInspectionOnly: boolean;
  onOpenProjectSource: (source: ProjectSource) => void;
  onTraceExport: (receipt: string) => void;
  beginTraceExport: (includeSource: boolean, includeInput: boolean) => Promise<TraceChunk>;
  ackTraceExport: (exportId: string, chunkIndex: number) => Promise<TraceChunk>;
  cancelTraceExport: (exportId: string) => Promise<MachineState>;
  t: (ko: string, en: string) => string;
}>;

const encoder = new TextEncoder();
const hex = (bytes: readonly number[]): string => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
const message = (error: unknown): string => error instanceof Error ? error.message : nativeError(error).message;
export function editedTestCase(testCase: TestCase, inputHex: string, closeInput: boolean, maxInstructions: number): TestCase {
  return parseTestCaseFile(encoder.encode(JSON.stringify({ ...testCase, inputHex, closeInput, maxInstructions })));
}

export default function ProjectTestsPanel(props: Props) {
  const { t } = props;
  const worker = useRef<TestWorkerClient | null>(null);
  const [grant, setGrant] = useState<ProjectGrant | null>(null);
  const [project, setProject] = useState<ProjectFile | null>(null);
  const [testPath, setTestPath] = useState('tests/main.btest.json');
  const [testInputHex, setTestInputHex] = useState('');
  const [testCloseInput, setTestCloseInput] = useState(false);
  const [testBudget, setTestBudget] = useState(1_000_000);
  const [testCase, setTestCase] = useState<TestCase | null>(null);
  const [testStatus, setTestStatus] = useState<'NOT_RUN' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED'>('NOT_RUN');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [includeSource, setIncludeSource] = useState(false);
  const [includeInput, setIncludeInput] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const client = createTestWorkerClient();
    worker.current = client;
    return () => { client.terminate(); worker.current = null; };
  }, []);

  async function readProjectFile(grantId: string, path: string): Promise<GrantedFile> {
    return invoke<GrantedFile>('read_project_file', { grantId, relativePath: path });
  }

  async function saveProjectFile(grantId: string, path: string, bytes: Uint8Array, revision: string | null): Promise<SavedFile> {
    return invoke<SavedFile>('save_project_file', { grantId, relativePath: path, bytes: Array.from(bytes), observedDiskRevision: revision });
  }

  async function selectProject(): Promise<void> {
    if (!nativeAvailable) { setNotice(t('프로젝트 폴더는 macOS 앱에서 선택할 수 있습니다.', 'Project folders require the macOS app.')); return; }
    try {
      const selected = await invoke<ProjectGrant | null>('select_project');
      if (!selected) return;
      setGrant(selected); setProject(null); setTestCase(null); setTestStatus('NOT_RUN');
      try {
        const file = await readProjectFile(selected.grantId, 'project.bolgeproj.json');
        const parsed = requireExecutableProject(parseProjectFile(Uint8Array.from(file.bytes)));
        const source = await readProjectFile(selected.grantId, parsed.source.path);
        setProject(parsed);
        props.onOpenProjectSource({ name: parsed.source.path.split('/').pop() ?? 'program.mb', kind: parsed.source.kind, bytes: Uint8Array.from(source.bytes), projectId: parsed.projectId, projectGrantId: selected.grantId, relativePath: parsed.source.path, diskRevision: source.diskRevision });
        setNotice(t('프로젝트 원문을 열었습니다.', 'Project source opened.'));
      } catch (error) {
        if (nativeError(error).code === 'NOT_FOUND') setNotice(t('새 폴더입니다. 현재 문서로 프로젝트를 만들 수 있습니다.', 'New folder. Create a project from the current document.'));
        else setNotice(message(error));
      }
    } catch (error) { setNotice(message(error)); }
  }

  async function createProject(): Promise<void> {
    if (!grant) return;
    const path = props.sourceKind === 'normalized' ? 'programs/main.nmal' : 'programs/main.mb';
    const config = {
      schemaVersion: 1, projectId: crypto.randomUUID(), name: grant.name,
      source: { kind: props.sourceKind, path }, semanticsProfile: 'bolgescope-tio-safe-v1',
      run: { inputHex: '', closeInput: false, maxInstructions: 1_000_000, historyLimitMiB: 64, outputLimitBytes: 1_048_576 },
    };
    try {
      const source = await saveProjectFile(grant.grantId, path, props.sourceBytes, null);
      await saveProjectFile(grant.grantId, 'project.bolgeproj.json', encoder.encode(`${JSON.stringify(config, null, 2)}\n`), null);
      const parsed = requireExecutableProject(parseProjectFile(encoder.encode(JSON.stringify(config))));
      setProject(parsed);
      props.onOpenProjectSource({ name: path.split('/').pop() ?? props.sourceName, kind: props.sourceKind, bytes: props.sourceBytes, projectId: parsed.projectId, projectGrantId: grant.grantId, relativePath: path, diskRevision: source.diskRevision });
      setNotice(t('프로젝트를 만들었습니다.', 'Project created.'));
    } catch (error) { setNotice(`${t('일부 파일이 저장되었을 수 있습니다. 내용을 확인하세요.', 'Some files may have been saved. Check the folder.')} ${message(error)}`); }
  }

  async function loadTest(): Promise<void> {
    if (!grant) return;
    try {
      const file = await readProjectFile(grant.grantId, testPath);
      const parsed = parseTestCaseFile(Uint8Array.from(file.bytes));
      setTestCase(parsed); setTestInputHex(parsed.inputHex); setTestCloseInput(parsed.closeInput); setTestBudget(parsed.maxInstructions);
      setTestResult(null); setTestStatus('NOT_RUN'); setNotice(t('테스트 파일을 열었습니다.', 'Test file opened.'));
    } catch (error) { setNotice(message(error)); }
  }

  async function createTest(): Promise<void> {
    if (!grant || !project || !props.state || !props.sourceIdentityMatches || props.sourceProjectId !== project.projectId || props.sourceRelativePath !== project.source.path) {
      setNotice(t('실행 snapshot과 프로젝트 원문이 일치해야 합니다.', 'The running snapshot must match the project source.'));
      return;
    }
    const state = props.state;
    const definition = {
      schemaVersion: 1, testId: crypto.randomUUID(), name: props.sourceName,
      source: project.source, inputHex: testInputHex, closeInput: testCloseInput,
      maxInstructions: testBudget,
      expected: { outputHex: hex(state.output), terminal: state.head.terminal, step: state.head.step, registers: state.head.registers },
    };
    try {
      const parsed = parseTestCaseFile(encoder.encode(JSON.stringify(definition)));
      await saveProjectFile(grant.grantId, testPath, encoder.encode(`${JSON.stringify(definition, null, 2)}\n`), null);
      setTestCase(parsed); setTestResult(null); setTestStatus('NOT_RUN');
      setNotice(t('현재 실행 결과를 기대값으로 저장했습니다. 입력 설정을 검토하세요.', 'Current result saved as expected values. Review the input configuration.'));
    } catch (error) { setNotice(message(error)); }
  }

  async function runTest(): Promise<void> {
    if (!grant || !testCase || !worker.current) return;
    setTestStatus('RUNNING'); setTestResult(null);
    try {
      const edited = editedTestCase(testCase, testInputHex, testCloseInput, testBudget);
      const source = await readProjectFile(grant.grantId, testCase.source.path);
      const result = await worker.current.run(edited, Uint8Array.from(source.bytes));
      setTestResult(result); setTestStatus(result.status);
    } catch (error) { setTestStatus('FAILED'); setNotice(message(error)); }
  }

  async function exportTrace(): Promise<void> {
    if (props.state && props.state.eventIndex < props.state.tailEventIndex) {
      setNotice(t('전체 기록을 내보내려면 먼저 Live 끝점으로 돌아가세요.', 'Return to the live tail before exporting the full trace.'));
      return;
    }
    if (!nativeAvailable || !props.state || props.snapshotText === null || props.snapshotKind === null) {
      setNotice(t('실행 중인 설치 앱에서 trace를 내보낼 수 있습니다.', 'Trace export requires a running installed app.'));
      return;
    }
    if (!window.confirm(t('Trace에는 입력을 제외해도 레지스터와 메모리 값에 민감한 정보가 남을 수 있습니다. 내보낼까요?', 'A trace can reveal sensitive data through registers and memory even when input is excluded. Export?'))) return;
    let exportId: string | null = null;
    try {
      let chunk = await props.beginTraceExport(includeSource, includeInput);
      exportId = chunk.exportId;
      const expectedDigest = chunk.digest;
      if (chunk.totalBytes > 64 * 1024 * 1024) throw new RangeError('Trace exceeds the native 64 MiB limit.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        if (chunk.bytes.length > 65_536 || chunk.chunkIndex !== chunks.length) throw new Error('TRACE_CHUNK_INVALID');
        chunks.push(chunk.bytes);
        length += chunk.bytes.length;
        const next = await props.ackTraceExport(chunk.exportId, chunk.chunkIndex);
        if (chunk.done) break;
        chunk = next;
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
      const receipt = await invoke<{ fileDigest: string; byteLength: number; name: string } | null>('export_trace', { bytes: Array.from(bytes), suggestedName: `${props.sourceName}.btrace.jsonl` });
      if (receipt) {
        if (receipt.fileDigest !== expectedDigest || receipt.byteLength !== bytes.length) throw new Error('TRACE_EXPORT_INTEGRITY');
        props.onTraceExport(receipt.fileDigest);
        setNotice(`${t('Trace 저장 완료', 'Trace saved')}: ${receipt.name} · ${receipt.byteLength} bytes · ${receipt.fileDigest.slice(0, 12)}${props.traceInspectionOnly ? ` · ${t('검사 전용', 'inspection only')}` : ''}`);
      }
    } catch (error) {
      if (exportId) await props.cancelTraceExport(exportId).catch(() => undefined);
      setNotice(message(error));
    }
  }

  return <div className="project-tests-panel">
    <div className="project-row"><strong>{project ? project.name : grant ? grant.name : t('단일 파일 작업', 'Standalone document')}</strong><button type="button" onClick={() => void selectProject()}>{t('프로젝트 폴더 선택', 'Choose project folder')}</button>{grant && !project && <button type="button" onClick={() => void createProject()}>{t('현재 문서로 생성', 'Create from document')}</button>}</div>
    {project && <p className="muted">{project.source.path} · {project.semanticsProfile}</p>}
    <div className="test-row"><label>{t('테스트 상대 경로', 'Relative test path')} <input value={testPath} onChange={event => setTestPath(event.target.value)} spellCheck={false} /></label><button type="button" disabled={!project} onClick={() => void loadTest()}>{t('열기', 'Open')}</button><button type="button" disabled={!project || !props.state || !props.sourceIdentityMatches || props.sourceProjectId !== project.projectId || props.sourceRelativePath !== project.source.path} onClick={() => void createTest()}>{t('현재 결과로 만들기', 'Create from result')}</button></div>
    <div className="test-row"><label>{t('입력 Hex', 'Input Hex')} <input value={testInputHex} onChange={event => setTestInputHex(event.target.value)} spellCheck={false} placeholder="4142430A" /></label><label><input type="checkbox" checked={testCloseInput} onChange={event => setTestCloseInput(event.target.checked)} /> EOF</label><label>{t('최대 명령', 'Instruction limit')} <input type="number" min={1} max={1_000_000} value={testBudget} onChange={event => setTestBudget(Number(event.target.value))} /></label></div>
    <div className="test-row"><span role="status">{testStatus}{testCase ? ` · ${testCase.name}` : ''}</span><button type="button" disabled={!testCase || testStatus === 'RUNNING'} onClick={() => void runTest()}>{t('테스트 실행', 'Run test')}</button><button type="button" disabled={testStatus !== 'RUNNING'} onClick={() => worker.current?.cancel()}>{t('취소', 'Cancel')}</button></div>
    {testResult?.failures.map(failure => <p className="test-failure" key={failure}>{failure}</p>)}
    <div className="trace-row"><label><input type="checkbox" checked={includeSource} onChange={event => setIncludeSource(event.target.checked)} /> {t('원문 포함', 'Include source')}</label><label><input type="checkbox" checked={includeInput} onChange={event => setIncludeInput(event.target.checked)} /> {t('입력 포함', 'Include input')}</label><button type="button" disabled={!props.state || props.state.eventIndex < props.state.tailEventIndex} onClick={() => void exportTrace()}>{t('Trace 내보내기', 'Export trace')}</button></div>
    <p className="muted">{t('입력을 빼도 상태·쓰기 값으로 데이터가 드러날 수 있습니다.', 'Excluding input does not anonymize registers or memory writes.')}</p>
    {props.traceInspectionOnly && <p className="muted" role="status">{t('보존 경계 또는 분기 이후의 trace는 검사 전용입니다. 전체 재생은 보장하지 않습니다.', 'Trace after retention or branching is inspection only; full replay is unavailable.')}</p>}
    {notice && <p className="test-notice" role="status">{notice}</p>}
  </div>;
}
