# 05 — 데이터 모델·Worker 프로토콜·파일 계약

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

근거: [S2 §§4,13–14, S3 §§3,13–14]. 아래 타입·필드·전이 번호·파일 schema는 **상세화 제안**이다. 실행 core는 미구현이며 예시는 실제 앱 응답이 아니다. 이 문서가 다른 문서의 상태·식별자·시점 이름에 대한 기준이다.

## 1. 공통 수치·시점 규약

address/word는 정수 0..59048, byte는 0..255다. UTF-16/file byte offset과 address는 0부터, 화면 line/column은 1부터다. API 주소 범위는 `[start,end)`이며 표시용 inclusive end와 경계에서 변환한다. `step`은 **커밋된 명령 수, Halt 포함**이다. 입력 append/close, fault 진단, Pause, query는 step을 올리지 않는다.

`eventIndex=0`은 branch의 root point다. 이후 journal의 instruction/inputAppend/inputClose/fault 한 건마다 증가한다. row는 해당 사건 **이후** 상태를 가리킨다. 명령 실행 전 상태는 transaction.before와 직전 point다. host 입력 사건이 있으므로 step과 eventIndex는 같다고 가정하지 않는다.

되돌리면 live point/step은 감소할 수 있지만 `stateVersion`은 증가한다. 이는 관측 가능한 세션 mutation을 구분하는 번호이며 machine 명령 수가 아니다. breakpoint/settings 변경은 별도 `controlVersion`으로 관리한다. 모든 Number counter는 safe integer이며 overflow 전에 RESOURCE_LIMIT로 정지한다.

## 2. 기본 모델

```typescript
type Id = string;
type Digest = string; // 소문자 hex SHA-256, 정확히 64자
type Address = number;
type Phase = 'UNLOADED' | 'READY' | 'RUNNING' | 'PAUSED'
  | 'WAITING_INPUT' | 'HALTED' | 'FAULTED' | 'DISPOSED';
type Intent = 'NONE' | 'STEP' | 'RUN';
type StopReason = 'NONE' | 'STEP_COMPLETE' | 'USER_PAUSE'
  | 'INPUT_EMPTY' | 'HALT_OPCODE' | 'BREAKPOINT' | 'WATCHPOINT'
  | 'BUDGET' | 'OUTPUT_LIMIT' | 'HISTORY_BOUNDARY' | 'REWOUND'
  | 'RESOURCE_LIMIT' | 'STALLED_INVALID_FETCH'
  | 'REFERENCE_UNDEFINED' | 'WORKER_CRASH' | 'REPLAY_DIVERGED';
type Terminal = 'NONE' | 'HALTED' | 'FAULTED';
interface StatePoint { branchId: Id; eventIndex: number }
interface Registers { a: number; c: Address; d: Address }
interface Span {
  utf16Start: number; utf16End: number;
  byteStart: number | null; byteEnd: number | null;
  line: number; column: number;
}
interface SourceCell { address: Address; raw: number; span: Span }
interface Diagnostic {
  code: string; severity: 'error' | 'warning'; message: string;
  revision: number; span?: Span; address?: Address;
}
interface SourceDocument {
  documentId: Id; kind: 'raw' | 'normalized'; displayName: string;
  grantId: Id | null; sourceText: string; revision: number;
  dirty: boolean; diskRevision: Digest | null;
  rawBytesDigest: Digest | null; logicalDigest: Digest | null;
  analysisRevision: number | null; sourceMap: readonly SourceCell[];
  diagnostics: readonly Diagnostic[];
}
interface ProfileRef {
  id: 'tio-c-safe-v1'; contractDigest: Digest | null;
  contractStatus: 'pending' | 'verified';
}
interface ProgramSnapshot {
  snapshotId: Id; documentId: Id; sourceRevision: number;
  sourceKind: 'raw' | 'normalized'; authoredText: string;
  rawSource: Uint8Array; rawFileDigest: Digest; logicalSource: Uint8Array;
  logicalDigest: Digest; profile: ProfileRef;
  authoredMap: readonly SourceCell[]; rawMap: readonly SourceCell[];
  initialMemory: Uint16Array; // Worker 내부 전용. UI에 소유권을 넘기지 않는다.
}
interface TapeState {
  visibleLength: number; cursor: number; closed: boolean; eofReads: number;
}
interface MachineHead {
  registers: Registers; step: number; terminal: Terminal;
  tape: TapeState; outputLength: number;
}
interface RunLimits {
  instructionBudget: number; outputBytes: number;
  historyBytes: number; inputBytes: number;
}
interface DebugSession {
  sessionId: Id; snapshotId: Id; branchId: Id;
  phase: Phase; reason: StopReason; intent: Intent;
  stateVersion: number; controlVersion: number;
  livePoint: StatePoint; tailPoint: StatePoint; earliestPoint: StatePoint;
  head: MachineHead; limits: RunLimits; runRemaining: number;
  historyStorageBytes: number;
}
interface ViewContext {
  viewGeneration: number; mode: 'source' | 'initial' | 'live' | 'history';
  point: StatePoint | null; selectedAddress: Address | null;
  documentId: Id; sourceRevision: number; snapshotId: Id | null;
}
```

ProgramSnapshot의 배열은 private owner가 유지하고 외부에 mutable reference를 노출하지 않는다. `readonly`나 Object.freeze만으로 ArrayBuffer 내용이 불변이라고 가정하지 않는다. Initial과 live memory는 다른 버퍼다. pending ProfileRef는 정식 release에서 허용하는 검증 상태가 아니다. G01 해결로 새 profile ID가 필요하면 이 타입도 명시적으로 변경한다.

SourceCell.raw는 해당 주소에 생성·로딩될 raw byte다. normalized 원문의 글자는 authoredText와 span으로 얻는다. authoredMap의 span은 `.nmal`, rawMap의 span은 생성된 Raw에 속한다. 생성 원문의 양쪽 좌표를 하나의 map으로 혼합하지 않는다.

## 3. transaction과 journal

```typescript
type AccessRole = 'fetch' | 'data-read' | 'data-write' | 'encryption';
interface ReadEvent {
  order: number; role: 'fetch' | 'data-read'; address: Address; value: number;
}
interface WriteEvent {
  order: number; role: 'data-write' | 'encryption';
  address: Address; before: number; after: number;
}
interface CounterDelta { role: AccessRole; address: Address; delta: number }
interface Transaction {
  instructionId: Id; before: MachineHead; after: MachineHead;
  fetchAddress: Address; fetchedRaw: number; decodedSymbol: string;
  opcode: 'j' | 'i' | '*' | 'p' | '<' | '/' | 'v' | 'o' | 'unnamed-nop';
  reads: readonly ReadEvent[]; writes: readonly WriteEvent[];
  operands: readonly number[]; counterDeltas: readonly CounterDelta[];
  input: null | { kind: 'byte'; value: number; cursorBefore: number }
    | { kind: 'eof' };
  output: readonly number[]; // 명령 하나에서 0 또는 1 byte
}
interface FaultRecord {
  code: 'STALLED_INVALID_FETCH' | 'REFERENCE_UNDEFINED';
  stage: 'fetch' | 'operation' | 'encryption';
  registersBefore: Registers; address?: number; value?: number;
  attemptedReads: readonly ReadEvent[];
  attemptedWrites: readonly WriteEvent[];
  effectsCommitted: boolean; // full rollback 후보에서는 false. G01 해결 전 미동결
}
type JournalPayload =
  | { kind: 'instruction'; transaction: Transaction }
  | { kind: 'inputAppend'; bytes: readonly number[]; visibleLengthBefore: number }
  | { kind: 'inputClose'; closedBefore: false }
  | { kind: 'fault'; fault: FaultRecord; terminalBefore: Terminal };
interface JournalEntry {
  point: StatePoint; stepAfter: number; payload: JournalPayload;
}
```

reads/writes의 order는 transaction 안에서 공유하는 증가 번호다. 배열을 분리해도 order로 전체 접근 순서를 재구성할 수 있다. 같은 셀의 두 write는 합치지 않는다. before/after는 tape cursor/output length/terminal을 포함하며 관찰 counter도 역순으로 복원한다. opcode 집계는 transaction.opcode에 대응하는 count를 커밋 시 +1, undo 시 -1 한다.

WAITING_INPUT은 instruction record를 만들지 않는다. fault는 별도 event이며 step을 늘리지 않는다. Pause/breakpoint처럼 scheduler만 바꾸는 조작은 machine journal에 섞지 않고 stateVersion/summary를 갱신한다. 불완전한 attempted effects를 정상 instruction으로 집계하지 않는다.

## 4. 노트·중단점·학습·테스트

```typescript
interface Annotation {
  annotationId: Id; documentId: Id; logicalDigest: Digest;
  range: { start: Address; end: number }; name: string; note: string;
  origin: 'user'; sourceRevision: number;
  binding: 'valid' | 'content-changed' | 'review-required';
}
interface Breakpoint {
  breakpointId: Id; address: Address; enabled: boolean;
  bindingDigest: Digest; binding: 'valid' | 'review-required';
}
interface Watchpoint {
  watchpointId: Id; range: { start: Address; end: number };
  roles: readonly ('data-read' | 'data-write' | 'encryption')[];
  enabled: boolean;
}
interface TestCase {
  schemaVersion: 1; testId: Id; name: string;
  source: { path: string; kind: 'raw' | 'normalized'; logicalDigest?: Digest };
  inputHex: string; closeInput: boolean; maxInstructions: number;
  expected: {
    outputHex?: string; terminal?: Terminal; stopReason?: StopReason;
    step?: number; registers?: Partial<Registers>;
    memory?: readonly { address: Address; value: number }[];
    dataWriteValues?: readonly { address: Address; values: readonly number[] }[];
  };
}
interface LessonDefinition {
  lessonId: Id; titleKey: string; objectiveKey: string;
  fixturePath: string; fixtureLogicalDigest: Digest | null;
  inputHex: string; closeInput: boolean;
  setup: { stopBeforeAddress?: Address; maxInstructions: number };
  question: { kind: 'decode' | 'next-registers' | 'data-write'
    | 'encryption' | 'input-wait' | 'revisit'; promptKey: string };
  hints: readonly string[];
  judge: 'codec-result' | 'committed-transaction' | 'observed-revisit';
  availability: 'verified' | 'unverified';
}
```

TestCase.memory는 기대 관측값이지 state injection 명령이 아니다. dataWriteValues는 초기값을 제외한 실제 data-write 결과를 순서대로 비교한다. 임의 judge 문자열을 eval하지 않고 앱이 구현한 판정 종류의 열거만 허용한다. 학습 setup은 실제 명령으로 목표 지점에 도달하며 레지스터를 설정하는 계약이 아니다.

## 5. Worker wire envelope

```typescript
interface RequestEnvelope<T> {
  protocolVersion: 1; clientEpoch: number; requestId: Id;
  requestSequence: number; command: string;
  sessionId?: Id; snapshotId?: Id; branchId?: Id;
  expectedStateVersion?: number; expectedControlVersion?: number;
  viewGeneration?: number; payload: T;
}
interface ResponseEnvelope<T> {
  protocolVersion: 1; clientEpoch: number; requestId: Id;
  sessionId?: Id; snapshotId?: Id; branchId?: Id;
  stateVersion?: number; controlVersion?: number;
  viewGeneration?: number;
  result: { ok: true; value: T }
    | { ok: false; code: string; message: string; retryable: boolean };
}
interface SessionEvent {
  protocolVersion: 1; clientEpoch: number;
  sessionId: Id; snapshotId: Id; branchId: Id; stateVersion: number;
  type: 'state' | 'invalidated' | 'exportChunk' | 'workerError';
  summary?: DebugSession;
}
```

load는 새 clientEpoch로 준비하고 성공한 새 세션만 활성화한다. 실패하면 이전 활성 epoch/session을 유지하고 다시 resync한다. 기존 세션 요청에는 sessionId/snapshotId/branchId가 모두 일치해야 한다. 같은 requestId와 payload를 재송신하면 보관된 응답을 반환하고 두 번 실행하지 않는다. 같은 ID를 다른 payload로 쓰면 INVALID_REQUEST다.

중복 제거 cache는 한도가 있다. cache에서 빠진 오래된 requestSequence를 새로운 요청으로 실행하지 않고 REQUEST_EXPIRED를 반환한다. 처리 여부가 불명확한 입력을 UI가 새 ID로 자동 재전송하지 않는다. 데이터 손실 없이 resync 또는 명시적 사용자 재시도를 요구한다.

stateVersion 조건은 run/step/rewind/branch 등 상태 의존 조작에 사용한다. 실행 중 sendInput/closeInput은 scope ID와 순서로 수용하므로 직전 summary version 일치를 강제하지 않는다. Pause/dispose도 동일 세션이면 현재 version과 무관하게 유효하다. breakpoint는 자주 바뀌는 stateVersion 대신 controlVersion으로 충돌을 검출한다.

## 6. 명령 계약

아래 payload는 envelope 내부다. 성공 후 필요한 state event를 발행한다. 모든 메시지는 수신 시 runtime validation을 하며 TypeScript cast를 검증으로 대체하지 않는다.

| command | payload | 성공 응답·효과 | 주요 실패 |
|---|---|---|---|
| load | documentId/revision/kind/authoredText/rawSource/profile/limits | snapshot metadata와 READY summary. 자동 실행 없음 | LOAD_INVALID_*, PROFILE_UNRESOLVED |
| run | instructionBudget? | intent=RUN, 명령 경계에서 재개 | BUSY, INVALID_STATE, STALE_STATE |
| step | 없음 | 명령 한 개 커밋 또는 wait/fault/limit | BUSY, INVALID_STATE, STALE_STATE |
| pause | 없음 | intent=NONE, 경계에서 PAUSED/USER_PAUSE. terminal이면 유지 | SESSION_MISMATCH |
| stepBack | 없음 | 가장 최근 실행한 명령의 직전 point로 이동 | HISTORY_BOUNDARY, BUSY |
| reverseContinue | 없음 | 이전 breakpoint/watchpoint/boundary까지 역행 | BUSY, INVALID_STATE |
| restart | mode:snapshot/current, current일 때 새 source | 새 load 성공 후 이전 세션 폐기, 새 세션 READY | LOAD_INVALID_*, UNSAVED_DECISION_REQUIRED |
| dispose | 없음 | DISPOSED, buffer/query 해제. 동일 scope에서 반복해도 결과 동일 | SESSION_MISMATCH |
| sendInput | bytes:byte[] | inputAppend 사건, 대기하던 intent가 있으면 재개 | INPUT_CLOSED, INPUT_LIMIT, BRANCH_REQUIRED |
| closeInput | 없음 | inputClose 사건. 남은 byte 뒤에 EOF. 중복 close는 no-op | BRANCH_REQUIRED, INVALID_STATE |
| setBreakpoints | breakpoints[], expectedControlVersion | 목록 전체 교체, resolved address 반환 | INVALID_ADDRESS, STALE_CONTROL |
| setWatchpoints | watchpoints[], expectedControlVersion | 목록 전체 교체 | INVALID_RANGE, STALE_CONTROL |
| updateLimits | limits 부분 변경 | 한도 갱신, 자동 재개 없음 | INVALID_LIMIT, STALE_CONTROL |
| subscribeState | enabled:boolean | 현재 summary 반환, 구독 시작/해제 | SESSION_MISMATCH |
| queryView | point/mode, memoryRanges[], selectedAddress | 같은 point의 head·memory·output lengths 반환 | HISTORY_EXPIRED, INVALID_RANGE |
| queryMemory | point/start/count:64 또는 128 | initial/current/trits/roles를 point와 함께 반환 | HISTORY_EXPIRED, INVALID_ADDRESS |
| queryHistory | point/beforeEvent?/limit<=200/address?/roles? | entry page, hasMore, next cursor, 보존 범위 | HISTORY_EXPIRED, INVALID_CURSOR |
| queryOutput | point/offset/limit<=65536 | 지정 시점에 보이는 byte slice | HISTORY_EXPIRED, INVALID_RANGE |
| rewindTo | point | 조회와 별도로 live를 해당 사건 이후로 이동 | HISTORY_EXPIRED, BUSY, STALE_STATE |
| createBranch | point/new suffix bytes/close/exportReceipt | 소비한 prefix를 유지한 새 branchId | EXPORT_REQUIRED, BUSY, STALE_STATE |
| exportTrace | from/to/includeSource/includeInput/mode | exportId/header/크기 추정, chunk 전송 시작 | HISTORY_EXPIRED, BUSY, INVALID_RANGE |
| ackExportChunk | exportId/chunkIndex | 다음 chunk 전송 | EXPORT_CANCELLED, INVALID_CURSOR |
| cancelRequest | targetRequestId 또는 exportId | query/export만 중단, VM 결과를 undo하지 않음 | REQUEST_ALREADY_DONE |
| resync | 없음 | 현재 summary·보존 범위·control config | SESSION_MISMATCH |

마지막 memory page는 59049를 넘지 않게 짧게 반환한다. restart의 source 검사는 교체용 load transaction으로 묶고 실패 시 기존 문서·세션을 보존한다. version mismatch인 payload를 새 상태에 몰래 적용하지 않는다. profile·숫자 범위·history 제한은 validation 단계에서 확인한다.

각 오류는 machine fault, 요청 충돌, 파일 I/O 오류, 조회 범위 만료로 구분한다. REQUEST_EXPIRED를 입력 성공으로 간주하지 않고, WORKER_CRASH를 프로그램 Halt로 표시하지 않는다. request/response의 command별 실제 discriminated union은 구현 단계에서 이 표를 기준으로 작성한다.

## 7. 입력 대기 후 Step의 요청 예

```json
{
  "protocolVersion": 1,
  "clientEpoch": 2,
  "requestId": "input-17",
  "requestSequence": 17,
  "command": "sendInput",
  "sessionId": "session-example",
  "snapshotId": "snapshot-example",
  "branchId": "branch-example",
  "payload": { "bytes": [65] }
}
```

ID는 설명용이며 실제로는 새로 생성한다. WAITING_INPUT/STEP에서 수신하면 input append 후 명령 한 개만 실행하고 PAUSED/STEP_COMPLETE를 보낸다. Pause가 먼저 적용되었다면 append만 한다. 여러 byte를 전송해도 나머지를 임의로 소비하지 않는다.

## 8. 동시성·전송량 제어

동일 Worker의 명령 경계에서 command를 적용한다. 미처리 dispose가 있으면 새 run/step/input을 적용하지 않고 세션을 닫는다. Pause는 자동 재개 intent를 먼저 없앤다. sendInput과 closeInput은 수신 순서를 유지하고 EOF를 입력보다 앞으로 재배치하지 않는다.

연속 state event는 최대 20Hz로 최신 summary에 합칠 수 있다. 최종 paused/wait/halt/fault 전이는 즉시 전송한다. instruction journal은 합치거나 누락시키지 않는다. query는 최대 4건까지 기다리게 하고 UI의 mutation request는 한 번에 하나만 in-flight로 둔다. Run은 수용 응답 뒤 계속 실행하므로 입력과 Pause 요청을 막지 않는다.

export chunk는 최대 64KiB이며 ACK를 받은 뒤 다음 chunk를 보내는 방식으로 전송량을 제한한다. 대상은 고정 범위이며 원칙적으로 Pause 후 내보내기를 시작한다. export 중 run/rewind/branch는 BUSY다. cancel은 원래 세션 상태를 바꾸지 않는다. 디스크 쓰기 실패는 EXPORT_IO_ERROR이며 완료 receipt를 발급하지 않는다.

## 9. 프로젝트와 부속 파일

schemaVersion은 모두 1부터 시작하지만 각 파일 형식의 독립 version이다. 알 수 없는 major version은 read-only/unsupported로 처리한다. 필수 field 누락·범위 오류는 FILE_SCHEMA_ERROR다. 알 수 없는 optional field는 왕복 저장 시 보존하며 실행 권한이나 임의 코드로 해석하지 않는다.

```json
{
  "schemaVersion": 1,
  "projectId": "project-example",
  "name": "Crazy Playground",
  "source": { "kind": "raw", "path": "programs/main.mb" },
  "semanticsProfile": "tio-c-safe-v1",
  "run": {
    "inputHex": "4142430a",
    "closeInput": true,
    "maxInstructions": 1000000,
    "historyLimitMiB": 64,
    "outputLimitBytes": 1048576
  }
}
```

source.path는 project root 기준 상대경로다. normalized의 build output은 `build/main.mb`이며 source로 역동기화하지 않는다. 프로젝트 외부 source는 copy/import를 명시적으로 확인한다. 실행 중 사용하는 grantId 같은 OS token을 project file에 영구 저장하지 않는다.

notes.json은 `schemaVersion, projectId, annotations[]`, btest.json은 TestCase, btrace.jsonl은 header 뒤에 ordered events와 선택적 checkpoint, 마지막에 footer를 둔다. notes는 plain text이며 HTML/JS expression을 허용하지 않는다. 실제 schema validation과 migration 테스트는 T23/T31이다.

## 10. trace 계약

```typescript
interface TraceHeader {
  format: 'bolgescope-trace'; schemaVersion: 1;
  snapshotId: Id; branchId: Id; profileId: string;
  profileContractDigest: Digest | null; logicalDigest: Digest;
  from: StatePoint; to: StatePoint; firstStep: number; lastStep: number;
  sourceIncluded: boolean; inputIncluded: boolean;
  replayMode: 'from-source' | 'from-checkpoint' | 'inspection-only';
  parent?: { branchId: Id; point: StatePoint };
}
```

`from-source`는 필요한 source/profile/input 사건이 모두 있을 때만 표시한다. earliest>0이고 initial부터의 journal이 없으면 완전한 checkpoint를 포함한 from-checkpoint로 제한한다. registers·memory·counters·tape bytes와 상태·output bytes·terminal을 복원할 자료가 없다면 inspection-only다. 외부 trace import는 첫 버전에서 조회만 지원하며 임의 trace를 신뢰하여 VM에 복원하지 않는다. replayMode는 자료의 충분성을 설명하는 필드이지 모든 import 실행 기능이 구현됐다는 뜻이 아니다.

입력을 제외해도 input 값이 A/memory/transaction에 남을 수 있다. `includeInput=false`를 익명화와 같은 뜻으로 사용하지 않는다. privacy 모드는 source·입력·register·operand·write 값·주소별 상세 이력을 빼고 허용된 집계만 내보내는 inspection-only 형태로 구분한다. opcode/count 등 집계도 입력의 성질을 드러낼 수 있으므로 **민감 정보가 완전히 제거된다고 보장하지 않는다**. 내보내기 전에 실제 포함 필드를 보여준다.

footer는 line count·event range·digest를 기록한다. digest는 footer를 제외한 모든 UTF-8 JSONL bytes를 파일 순서대로 SHA-256한 값이며 각 line의 LF를 포함한다. 잘린 파일이나 range gap은 complete로 표시하지 않는다. 앱 자체 branch exportReceipt는 native가 close/flush 성공 후 발급하며 from/to/file digest와 연결한다. UI가 임의 문자열을 만들어 receipt를 대신하지 못하게 한다.

## 11. 파일 I/O와 복구

native API 후보는 `selectFile`, `selectProject`, `readGrantedFile`, `saveGrantedFile`, `saveAs`, `checkExternalRevision`, `writeRecovery`, `listRecovery`, `removeRecovery`다. 각 read/save는 grantId와 observedDiskRevision을 사용하고 permission/conflict/not-found/encoding/io-error를 구분한다. 실제 Tauri SDK signature는 B0에서 version을 고정한 뒤 확인한다.

단일 파일의 노트는 앱 관리 영역에 documentId별로 저장하고 canonical identity와 logicalDigest로 연결 후보를 확인한다. 경로만 같다는 이유로 다른 내용에 노트를 몰래 연결하지 않는다. 프로젝트로 변환할 때 `.bolge/notes.json`에 옮기고 성공 후 기존 관리 기록을 정리한다.

recovery는 source revision/bytes/notes/기준 disk hash를 갖고 원본과 별도로 쓴다. crash 이후 복원 비교 화면을 띄우며 원본을 자동 덮어쓰지 않는다. source와 notes 등 복수 파일 저장 중 부분 성공은 각 saved revision으로 보고한다. 파일 묶음 전체의 원자적 저장을 보장하지 않는다. invalid Malbolge 작성 중에도 원문 저장은 허용하되 실행·생성 Raw 내보내기와 구분한다.

## 12. 크기 상한 — 추가 제안

source 편집 파일 2MiB, project/notes/test의 각 JSON 1MiB, 입력 tape 1MiB/branch, output 기본 1MiB, annotation 본문 8KiB, queryHistory 200건, export chunk 64KiB를 초기 방어 한도로 제안한다. source의 논리 cell 상한 59049와 별도의 파일 용량 제한이며, 공백만 많은 거대 파일의 부하를 막기 위한 것이다. 추가 제한은 기존 Malbolge 의미론이 아니라 앱 자원 제한으로 표시한다.
