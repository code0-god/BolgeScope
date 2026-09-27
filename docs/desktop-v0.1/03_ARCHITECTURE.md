# 03 — 아키텍처와 상태 소유권

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

기존 구조의 근거: [S1 §10, S2 §13, S3 §13]. 하위 모듈·저장·동기화 정책은 상세화 제안이다. 타입의 기준 문서는 [05_DATA_AND_PROTOCOL.md](05_DATA_AND_PROTOCOL.md)다.

## 1. 고정 기술 선택

Tauri 2 / React + TypeScript / Monaco Editor / Vite + npm workspaces / TypeScript Malbolge core / Runtime Web Worker / Rust OS integration을 유지한다. SwiftUI/Electron 전환, Rust 제품 VM, DAP 내부 의존성을 추가하지 않는다. 독립 C interpreter는 테스트 oracle로만 사용한다.

이번 작업에서 npm/Cargo 패키지를 설치하거나 lockfile을 생성하지 않았다. 정확한 의존성 버전 조합은 A0/B0에서 선택·고정한다. 로컬에 설치된 Node/Rust/Xcode 버전은 [09_DECISIONS_AND_GAPS.md](09_DECISIONS_AND_GAPS.md)의 관측값일 뿐 앱 지원 범위가 아니다.

## 2. 모듈 경계

```text
Tauri main process / Rust
  file grants · open/save · conflict detection · menu · lifecycle · recovery
                    ↕ typed IPC
React application / Monaco
  SourceDocument · analysis view model · ViewContext · user intents
                    ↕ bounded request/response + coalesced state events
Runtime Web Worker
  DebugSession · scheduling · tape · journal · history · queries
                    ↓ pure interfaces
@bolgescope/core
  codec · source map · loader · VM transaction
```

| 모듈 | 소유 데이터 | 할 일 | 금지 |
|---|---|---|---|
| core/codec | 불변 표와 ProfileContract | decode/encode/rotate/crazy/이론 cycle | DOM·Tauri·network·file 접근 |
| core/source | 분석 결과와 map | byte/UTF-16/주소 매핑, 진단, normalized 인코딩 | 원문에 자동 주석/정렬 삽입 |
| core/vm | 활성 memory, registers, terminal flag | 단일 명령의 단계적 계획·원자 커밋 | UI callback, hidden input, ML 상태 |
| runtime/session | sessionId/snapshotId/branchId, phase/reason/intent | 실행 생명주기와 검증된 core 호출 | React state에 VM 소유권 위임 |
| runtime/scheduler | slice/budget/취소 토큰 | yield, Pause/Stop, throttling | 무한 동기 while로 message queue 봉쇄 |
| runtime/history | journal/checkpoints/retention | read-only 시점 복원, undo/replay/branch | 이력 없는 시점 추정 |
| runtime/tape | byte chunks·visibleLength·cursor·closed | 입력 append·소비·EOF와 undo | UI 문자열을 byte로 암묵 변환 |
| editor adapter | Monaco models·revision·selection | semantic tokens, hover, edits, undo | 메모리 self-modification을 source에 쓰기 |
| app state | docs·panels·ViewContext·latest summaries | 표시와 사용자 의도 | 명령 결과/레지스터 계산 재구현 |
| native services | 승인된 file grants·디스크 revision·recovery | 안전한 파일 I/O·창 종료 | 임의 shell 실행·전역 filesystem grant |
| lessons/tests | declarative definitions·결과 | 동일 core 기반 질문/검증 | 답에 맞춰 A/C/D/memory 주입 |

## 3. SourceDocument와 ProgramSnapshot

SourceDocument는 편집 원문, 파일 identity, revision, dirty와 분석 상태를 가진다. ProgramSnapshot은 **로드 요청 당시**의 원문, 정규화된 논리 bytes, 두 source map, profile 계약 digest, 초기 memory를 묶은 불변 객체다.

원문 SHA-256은 exact file bytes를, logical digest는 프로필이 허용하는 공백만 제거한 bytes를 식별한다. snapshotId는 매 로드마다 새 opaque ID이고 digest를 대체하지 않는다. `.nmal` 실행에는 authored 원문과 생성 Raw 및 양쪽 map을 함께 보존한다. 동일 raw가 생성되어도 source revision이 다르면 표시용 mapping을 재사용하지 않는다.

UI 분석과 Worker 실행은 같은 `core/source`와 `codec` 구현을 사용하지만 계산 소유권은 다르다. 편집 미리보기는 실행 VM이 아니다. loader가 실패하면 새 snapshot/session을 publish하지 않고 이전 실행은 유지한다.

## 4. 실행 시 상태 전파

1. UI는 SourceDocument의 분석을 완료하고 immutable load payload를 만든다.
2. Worker는 profile과 raw를 검증하고 Initial을 생성한다. 성공 시 새 sessionId와 snapshotId를 반환한다.
3. Run/Step은 Worker intent다. `core.step()`의 transaction이 완전히 커밋된 후 history와 counters를 갱신한다.
4. Worker는 registers, phase/reason, step, point, output length, history bounds 등 작은 summary를 보낸다.
5. UI는 보이는 memory page·cell history 등을 그 summary의 point로 조회한다.
6. 동일 view generation/point의 응답 묶음이 도착하면 패널들을 함께 교체한다. 값 일부만 다른 시점으로 렌더링하지 않는다.

React에 59,049셀 전체를 step마다 넣지 않는다. Runtime 표는 64/128셀 page, 개요는 243×243 role bitmap을 on-demand 전송한다. overview 전체 전송은 탭 진입/재동기화에 한정하고 이후 dirty tile delta를 합친다. 색상 계산은 source origin과 관찰 roles의 조합이지 code/data 영구 분류가 아니다.

## 5. 일관된 조회와 stale 응답

모든 요청은 `requestId`, 현재 세션 요청에는 `sessionId/snapshotId/branchId`를 포함한다. 구조 변경 요청은 `expectedStateVersion`도 검사한다. `stateVersion`은 되돌리더라도 감소하지 않고, `eventIndex`와 `step`은 되돌아갈 수 있다.

UI ViewContext는 `viewGeneration + mode + point + selectedAddress`다. 탭/선택/시점을 바꾸면 generation을 올린다. 새 세션의 응답에 이전 sessionId, 다른 branchId, 오래된 generation이 섞이면 버린다. 동일 generation에서도 point가 다르면 렌더하지 않는다.

queryView는 단일 worker 경계에서 registers/terminal/output lengths/history bounds와 요청한 memory pages를 한 묶음으로 반환한다. 추가 queryMemory/queryHistory도 같은 point를 요구한다. 해당 point가 보존 범위 밖이면 `HISTORY_EXPIRED`를 반환한다. 임의 최신값으로 성공시키지 않는다.

live 실행 중 UI가 뒤처지면 중간 summary는 병합할 수 있다. machine journal은 병합하지 않는다. 요청 queue/출력 전송이 포화되면 조회 응답을 늦추거나 `BUSY`를 반환하고 명령 자체를 조용히 누락시키지 않는다.

## 6. Worker 실행과 오류

slice는 4,096개의 committed instruction 또는 약 8ms에서 끝내고 task queue로 yield한다. microtask만 연속 연결해 메시지 처리를 굶기지 않는다. 네트워크/SharedArrayBuffer/COOP·COEP를 요구하지 않는 기본 Worker 방식을 채택한다.

Run/Step 중 중복 실행 요청은 BUSY, Pause/Stop은 다음 명령 경계에서 처리한다. history query는 현재 slice 이후 처리하며 heavy 복원은 취소 가능한 분할 작업이다. 명령 하나 중간에 Pause가 끼어 partial state를 publish하지 않는다.

Worker 예외는 세션을 `FAULTED / WORKER_CRASH`로 표시한다. SourceDocument와 디스크 파일은 UI/native 쪽에 남는다. heartbeat timeout은 장애 의심이지 Halt 증거가 아니다. 새 Worker 생성 후 자동 실행하지 않으며 사용자가 Restart를 선택하게 한다. 디버그 로그에는 입력 내용·파일 원문을 기본 기록하지 않는다.

Vite의 Worker 생성 방식과 Monaco ESM Worker 설정을 각각 확인했다. Runtime Worker와 Monaco editor Worker는 다른 역할이다. native 패키징 후 두 경로의 실제 로딩은 별도 검증이 필요하다. [W4, W5]

## 7. history 구현 선택

상세화 제안은 **bounded binary journal + checkpoint + copy-on-query 재구성**이다. 명령마다 전체 memory를 복사하지 않는다. transaction은 작은 레지스터 before/after, 순서 있는 read/write, I/O delta, counter delta를 가진다. checkpoint에는 memory, counters, registers, tape 상태, output 및 terminal state를 포함한다.

journal은 고정 크기 byte-buffer segment로 보관한다. root checkpoint와 주기 checkpoint(초기 제안: 4,096 committed instructions마다)를 유지하고 메모리 한도에 따라 간격/개수를 조절한다. 오래된 segment 제거 전 새 earliest checkpoint를 확정한다. gap이 생기는 segment 삭제는 금지한다.

64MiB는 **encoded history storage의 버퍼 한도**로 정의한다. VM live/Initial, UI, JS object overhead를 포함한 앱 총 메모리 한도가 아니다. history reconstruction용 임시 buffer와 pinned checkpoint도 이 회계에 넣는다. 주소별 role counters는 Float64Array를 제안하고 safe-integer 범위를 넘기기 전 진단 정지한다. opcode counters는 별도 고정 길이 배열로 보관하고 checkpoint와 undo에 포함한다. 계산상 16-bit memory 한 장은 118,098 bytes다. 실제 프로세스 사용량은 별도로 측정한다.

입력/output byte chunks는 immutable 공유와 참조 회계를 사용한다. 기록을 제거해도 현재 VM이 필요로 하는 tape/output은 보존한다. earliest 이전의 누적 관찰 counters는 baseline 집계로 남되 세부 인과 사건을 설명하는 근거로 사용하지 않는다.

## 8. Native 파일과 프로젝트 서비스

UI가 임의 경로로 read/write하지 않도록 Rust의 FileGrantRegistry가 사용자가 선택한 파일/프로젝트에 opaque grantId를 발급한다. grant에는 실제 filesystem identity와 canonical scope를 저장한다. canonical path의 구성요소로 검증하고 문자열 prefix 비교를 사용하지 않는다. project 상대경로의 `..`, absolute 경로, symlink scope escape는 거부한다. 존재하지 않는 파일은 승인된 parent directory에서 생성한다.

저장은 동일 디렉터리에 임시 파일을 쓰고 flush한 뒤 rename하는 방식을 제안한다. 기존 file identity/hash를 다시 확인해 알려진 충돌을 막는다. **다른 프로세스의 동시 변경과 비교·교체 사이 race까지 완전히 제거했다고 주장하지 않는다.** 실제 보호 수준을 T28/T30 및 G06으로 검증하며 백업/다른 이름 저장 경로를 제공한다.

Tauri capabilities는 주창에 필요한 command만 노출한다. capabilities의 존재가 자체 Rust command 내부의 scope 검사를 대신하지 않는다. 등록된 app command의 기본 노출에 주의하여 AppManifest/permission을 구성하고 확인한다. [W2]

## 9. 의존성 및 저장소 구조 — 제안, 아직 생성하지 않음

```text
BolgeScope/
  docs/desktop-v0.1/             이번 설계와 fixture/evidence
  apps/desktop/
    src/app/                    React + workspace/layout
    src/editor/                 Monaco adapter
    src/runtime.worker.ts       session worker entry
    src-tauri/                  Rust + capabilities + packaging
  packages/core/src/            codec, source, loader, transaction, vm
  packages/runtime/src/         session, scheduler, tape, journal, queries
  packages/contracts/src/       wire models, file schema validators
  packages/lessons/              declarative lessons
  tests/core/                   pure contract tests
  tests/reference/              pinned original C + minimal patches
  tests/integration/            session/files/protocol
  tests/e2e/                    browser/embedded/native-artifact distinction
  fixtures/                     verified program bytes + provenance
```

core는 runtime/editor에 역의존하지 않는다. contracts는 type/schema만 제공하며 실제 VM 구현을 가져오지 않는다. runtime은 core/contracts에 의존한다. editor는 core의 pure analysis만, app은 worker client를 사용한다. 이 구조의 제품 코드/테스트 디렉터리는 이번 설계 단계에서 만들지 않는다.

## 10. 선택하지 않은 대안과 영향

| 대안 | 거부 이유 | 재검토 조건 |
|---|---|---|
| 두 언어의 제품 VM | 의미론·테스트·bug fix가 갈라짐 | 실측 성능 결함과 단일 구현으로의 이관 계획이 있을 때 |
| 모든 state를 React에 저장 | execution ownership과 렌더링 비용 혼합 | 없음, core 경계를 유지 |
| 매 명령 full snapshot | history가 짧아지고 memory 복제 증가 | 특정 snapshot sampling 실험만 별도 |
| Desktop 내부 DAP | 필요한 세션 명령보다 간접 계층이 큼 | 외부 VS Code adapter를 별도 추가할 때 |
| 외부 CDN Monaco/font | 오프라인·정확한 bundle 재현 위반 | 기본 동작에서는 재검토하지 않음 |
| 오류 뒤 자동 restart | 사용자 의도·Halt/fault를 숨길 위험 | 명시적 Restart 없이는 금지. 입력 대기 뒤 재개는 기존 STEP/RUN intent에 한정 |

새 세부 결정의 수용 테스트와 열린 질문은 08·09번 문서에 연결한다.
