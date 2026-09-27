# 08 — 구현 순서·의존성·수용 작업

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

근거: [S1 §13, S2 §15, S3 §16]. 아래는 **이후 구현 계획**이며 작업 완료 목록이 아니다. 현재 제품 코드·의존성 설치·앱 빌드는 NOT_RUN이다. 전체 첫 버전 범위를 A–E로 나눌 뿐 A/B를 전체 완료로 부르지 않는다.

## 1. 현재 산출물과 다음 시작점

현재 산출물은 01–09번 상세 설계, 원문 회귀 fixture, 문서·fixture 무결성 증거다. 시작 작업은 A0다. A0에서 legacy 프로필을 확보하지 못하면 정상 실행의 독립 참조 확인과 UI skeleton은 진행할 수 있으나 **미확정 safety profile을 검증 완료로 표시하는 작업은 차단**한다.

명세의 세부 safety 선택은 04번 후보와 09번 G01에 명시되어 있다. 실제 구현에서 다른 선택을 하면 04/05/06/07 문서를 함께 변경한다. 기존 profile id 아래 의미론을 조용히 바꾸지 않는다.

## 2. 작업 그래프

```text
A0 ─ A1 ─ A2 ─ A3 ─ A4 ─ A5 ─ A6
│     │                              │
│     └ C1 ─ C2 ─ C3                 │
│                                    ▼
└ B0 ─ B1 ─ B2 ─ B3 ─ D1 ─ D2 ─ D3
                    │                │
                    └ E1 ─ E2 ─ E3 ─ E4 ─ E5
```

이 그림은 요약이다. 정확한 의존성은 아래 표를 따른다. 특히 B3의 실제 실행은 A5/A6가 필요하고, C1의 parser/codec 결과는 A1에 의존한다. 독립 가능한 문서 UI와 native service는 병행할 수 있으나 core/API 합의 전 VM을 별도 구현하지 않는다.

## 3. A — 실행 정확성

| 작업 | 선행조건 | 담당 모듈 | 산출물 | 수용 테스트 |
|---|---|---|---|---|
| A0 profile 확정 | 04·09 검토 | core 계약 + reference harness | original source/hash, legacy profile 대조, loader/fault/127 경계 결정, contract digest | T03/T11의 기대 정책 고정. G01 미해결 시 A 통과 불가 |
| A1 codec/map | A0의 명령표·주소 규약 | core/codec, core/source | decode/encode/표 검증, UTF-16/byte/source map | T01, T02, T04, T05 |
| A2 loader | A0, A1 | core/loader | strict/profiling loader, normalized→raw load, 전체 초기 memory | T03, T06 |
| A3 단일 VM step | A1, A2 | core/vm, transaction | staged ordered reads/writes, A/C/D, byte I/O, Halt | T07, T08, T09, T10, T13 |
| A4 안전 원자성 | A0, A3 | core/vm, runtime diagnostics | fetch stall/치환 범위/fault commit 정책 | T11, T09, T10 |
| A5 독립 참조 | A2–A4 | tests/reference | 플랫폼 이식·trace patch, reproducible differential log | T04, T06–T13; 첫 불일치 trace 저장 |
| A6 실제 fixtures | A5 | fixtures, lessons inputs | 회귀 source 검증, 별도 revisit fixture와 provenance | T12, T41 |

A 통과 조건은 정의된 참조 실행 구간에서 일치하고, safe-stop 확장 구간이 계약대로 분리되며, 원문 fixture의 모든 기대값이 실제 실행에서 맞는 것이다. 숫자 output 하나만 일치한다고 통과하지 않는다.

## 4. B — 실제 Desktop 연결

| 작업 | 선행조건 | 담당 모듈 | 산출물 | 수용 테스트 |
|---|---|---|---|---|
| B0 toolchain 고정 | 기술 선택 유지 | apps/desktop, manifests | npm workspaces/Vite/Tauri/React/Monaco version·lockfiles, minimum OS 결정 | T36의 build prerequisite, G02/G03 검토 |
| B1 Worker protocol | B0, 05 | packages/runtime, worker client | IDs/version validation, scheduler, intent, request dedup, state subscribe | T14, T15, T22, T23, T24 |
| B2 native 파일 | B0, 05 native contract | Rust file grants/menu | 실제 open/save/saveAs, 최소 permissions, 충돌·dirty 처리 | T28–T30 |
| B3 최소 연결 흐름 | A5/A6 회귀, B1/B2 | desktop/app integration | 파일→Worker→Step→I/O→Halt→source 저장을 실제 앱에서 연결 | T12, T14, T34의 기본 subset |

B3에는 임시 hardcoded registers/output이 없어야 한다. 핵심 undo/replay를 B3에서 smoke할 수 있지만 전체 역실행 수용은 D1/T18이다. browser preview만으로 B를 통과하지 않는다.

## 5. C — 작성 경험

| 작업 | 선행조건 | 담당 모듈 | 산출물 | 수용 테스트 |
|---|---|---|---|---|
| C1 Raw editor/Lens | A1, B0 | editor adapter, Inspector | semantic tokens/hover/problems/source-only undo/Lens | T01, T02, T26 |
| C2 보조 작성 | A1/A2, C1 | editor/compiler preview | normalized 원본과 Raw 생성물 분리, 명령 교체·영향 preview | T25, T26 |
| C3 notes/bindings | C1/C2, B2 | annotations/native store | 외부 노트, block overlay, stale bindings, snapshot mismatch | T27, T31, T22 |

Source를 수정해도 현재 VM과 immutable snapshot이 바뀌지 않는 것을 C gate의 필수 regression으로 둔다. 텍스트 복사/파일 저장에 Lens/노트가 섞이지 않아야 한다.

## 6. D — 디버깅 완성

| 작업 | 선행조건 | 담당 모듈 | 산출물 | 수용 테스트 |
|---|---|---|---|---|
| D1 journal/undo | A4/A5, B1 | history/tape/VM transactions | bounded journal/checkpoint, visible tape, StepBack/replay | T18, T21 |
| D2 debugger/시각화 | D1, B3 | controls, Memory/Timeline/Inspector | breakpoint/watchpoint/reverseContinue, point 일관성, cycle/visits | T16, T17, T19, T22 |
| D3 branch/trace | D1/D2, B2 | history exporter/native service | ACK chunk export, exportReceipt, parent branch 보존 | T20, T42, T28 |

D 통과에는 halted VM 되돌리기뿐 아니라 input append/EOF/복수 쓰기/counters/output의 복원이 포함된다. 인과관계 설명은 retained 사건 범위를 넘어가지 않는다. 삭제된 이력에서 역실행이 성공하는 것처럼 보이지 않아야 한다.

## 7. E — 전체 제품·설치·배포

| 작업 | 선행조건 | 담당 모듈 | 산출물 | 수용 테스트 |
|---|---|---|---|---|
| E1 프로젝트/테스트 | C3, D1, B2 | contracts, project, tests runner | schemas, 이동 가능한 상대경로, isolated test Worker, byte diff | T31, T33, T28 |
| E2 여섯 학습 | A6, C2, D2 | lessons/UI judge | 목표·입력·setup·질문·힌트·판정·reset, unverified lesson 차단 | T32, T41 |
| E3 접근성/한글 | B3, C/D/E1/E2 | UI/editor/accessibility | IME·focus·VoiceOver·고대비·compact·reduced-motion | T35, T26 |
| E4 E_LOCAL | 모든 A–D, E1–E3 | release/test infrastructure | 실제 .app/.dmg, offline smoke, test plugin 격리, 성능 report | T34–T37, T39, T42 |
| E5 E_PUBLIC | E4, 사용자 배포 자격 증명 | release/signing | Developer ID 서명, 공증/staple, 다른 Mac 설치 evidence | T38 |

E4의 artifact와 E5의 최종 artifact는 각각 SHA-256으로 추적한다. 서명/공증으로 artifact bytes가 바뀌면 이전 digest를 재사용하지 않는다. 공개 배포와 제품 기능 검증을 별도의 release 행으로 보고한다.

## 8. 작업 결과의 형식

각 작업은 `taskId, changeSummary, affectedFiles, assumptions, testIds, status, evidencePaths, remainingRisks`를 기록한다. 단계별로 필요한 lint/typecheck/test/static analysis를 실행하고, 실행하지 못한 검사는 NOT_RUN이다. Git commit/push는 별도 요청이 있을 때 수행하며 이번 단계에서 저장소를 초기화하거나 remote를 만들지 않는다.

구현 명령 예시는 의존성/스크립트가 실제 생긴 뒤 확정한다. 현재 없는 `npm run test`를 실행했다고 보고하지 않는다. 명령이 1분 이상 걸릴 수 있으면 Catdesk start_command/poll_command로 동일 작업을 끝까지 추적하고 중복 시작하지 않는다.

## 9. 수용 테스트 우선순위

가장 먼저 고정할 실패 사례는 input wait의 무변화, jump 이후 치환 대상, Halt 이후 Back, same-cell write 순서, stale response다. 그다음 file overwrite 충돌과 branch/export 실패를 검증한다. 이 순서를 지키면 화려한 시각화가 잘못된 상태를 보여주는 위험을 먼저 줄일 수 있다.

UI 추가 전에 core 경계 테스트를 통과시키고, storage/branch 변경 전에는 기존 undo/replay regression을 유지한다. 한도나 fault 원자성을 바꾸면 semantics contract digest와 기대 trace 변경을 함께 리뷰한다.

## 10. 원안에서 제외하지 않은 범위

이번 계획은 ML 플랫폼·AI 생성기·HeLL assembler를 추가하지 않는다. 반대로 프로젝트·학습·테스트·macOS 설치 검증을 후순위라는 이유로 첫 버전 완료 기준에서 빼지 않는다. 서명/공증 자격이 없으면 E_PUBLIC만 NOT_RUN으로 남기고 E_LOCAL 결과와 혼동하지 않는다.

수용 테스트 ID는 [07_TEST_AND_RELEASE.md](07_TEST_AND_RELEASE.md)에 한 번만 정의하며 요구사항별 연결은 [09_DECISIONS_AND_GAPS.md](09_DECISIONS_AND_GAPS.md)의 추적표를 따른다.
