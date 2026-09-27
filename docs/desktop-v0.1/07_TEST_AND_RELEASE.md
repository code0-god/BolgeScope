# 07 — 검증·회귀·배포 수용 기준

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

근거: [S1 §13, S2 §15, S3 §§15–16]. 이 문서는 실행할 테스트 계약이다. **제품 VM·앱 빌드·설치본 테스트는 실행하지 않았다.** 문서 및 fixture 무결성 검사는 runtime conformance와 별개다.

## 1. 회귀 fixture의 출처와 무결성

Library 원본 `BolgeScope_Desktop_Design_Prompt.md` §15에서 전체 source와 기대 hash를 확보했다. 첨부 두 텍스트에는 기대값은 있으나 같은 형태의 전체 87문자 source가 없어 원본을 추가로 읽었다. [S3 §15]

파일: [fixtures/recurrent_crazy4.mb](fixtures/recurrent_crazy4.mb)

```text
('s;

@?>=<;:

{i1

6

we-

2

sa)M:

,+*)('&%$#"!~}|{zL

xwvutsrqponmlkjihgfedcba`_^]\[ZYXWVUT

SL

QPONML
```

ASCII whitespace bytes 09/0A/0B/0C/0D/20을 제거한 기대 SHA-256:

```text
69ed29dde001b80de62e2feaf2a2f5463ec7ee9666b981954ef63a938a854a81
```

실제 Workspace 파일은 108 bytes이며 공백 제거 후 87 cells와 기대 hash의 일치를 확인했다. 이는 **FIXTURE_FILE_INTEGRITY=PASS**이며 프로그램 실행 PASS가 아니다. hash 불일치를 입력·출력 기대값 수정으로 숨기지 않는다.

| 회귀 항목 | 원문 기대값 | 현재 검증 |
|---|---|---|
| 입력 | 41 42 43 0A | 실행 NOT_RUN |
| 출력 | 4A, 정확히 1 byte, 추가 LF 없음 | NOT_RUN |
| 종료 | HALTED / HALT_OPCODE | NOT_RUN |
| 명령 수 | Halt 포함 step=24 | NOT_RUN |
| A/C/D | 29514 / 23 / 80 | NOT_RUN |
| M[78] | 29514 | NOT_RUN |
| data-write 순서 | 초기 84 → 29487 → 29485 → 29484 → 29514 | NOT_RUN |
| 주소 3의 p 직전 | A=65, C=3, D=78, M[78]=84 | NOT_RUN |
| 주소 3 치환 | 59→92 | NOT_RUN |

fixture가 실패하면 source/profile digest, 첫 불일치 event, registers, ordered writes, tape cursor, output hex를 남긴다. 기대값을 화면에 직접 넣어 통과시키지 않는다.

## 2. 테스트 파일의 계약 예

```json
{
  "schemaVersion": 1,
  "testId": "regression-recurrent-crazy4",
  "name": "87-cell recurrent crazy four updates",
  "source": {
    "path": "fixtures/recurrent_crazy4.mb",
    "kind": "raw",
    "logicalDigest": "69ed29dde001b80de62e2feaf2a2f5463ec7ee9666b981954ef63a938a854a81"
  },
  "inputHex": "4142430a",
  "closeInput": true,
  "maxInstructions": 1000000,
  "expected": {
    "outputHex": "4a",
    "terminal": "HALTED",
    "stopReason": "HALT_OPCODE",
    "step": 24,
    "registers": { "a": 29514, "c": 23, "d": 80 },
    "memory": [{ "address": 78, "value": 29514 }],
    "dataWriteValues": [{ "address": 78, "values": [29487, 29485, 29484, 29514] }]
  }
}
```

이 JSON은 검증할 기대값이며 실행 로그가 아니다. 실제 앱은 TestCase.schemaVersion과 각 field를 검증해야 한다. source path는 이 예시 테스트를 놓는 project root 기준이다. dataWriteValues는 초기값 84를 제외한 실제 데이터 쓰기의 결과만 순서대로 비교한다.

## 3. 테스트 계층과 독립성

core unit은 DOM/Tauri 없이 실행한다. session integration은 실제 Worker scheduling과 message queue를 테스트한다. native integration은 파일 grants·저장 실패·외부 변경을 테스트한다. browser UI 테스트는 편집·표시 일부를 확인하지만 native Desktop 통과가 아니다. 최종 artifact는 WKWebView에서 별도로 시험한다.

C oracle은 production VM과 독립된 구현이어야 한다. source, input bytes, EOF timing, budgets, profile, reference hash를 고정한다. 원본 C의 `malloc.h` 이식 변경 등은 최소 patch로 보존한다. 안전 guard/trace 계측도 별도 patch로 남기고 원본을 변경한 사실을 숨기지 않는다. UB 이후 결과는 oracle로 비교하지 않는다.

## 4. 수용 테스트 목록

각 테스트는 ID별 PASS/FAIL/NOT_RUN 및 evidence 경로를 기록한다. 아래 제품 테스트는 **아직 실행하지 않은 계획**이다. T40의 문서 검사는 별도로 실행하고 결과를 evidence에 남긴다.

| ID | 계층·검증 | 구체적인 통과 조건 |
|---|---|---|
| T01 | source map | SP/TAB/CR/LF/CRLF/VT/FF 편집 후 논리 주소 유지, 정확한 UTF-16·byte offset, 공백에는 주소 없음 |
| T02 | codec | 주소 residue 94개 × printable 94개 검사. fixture #2 s→/, #19 s→j, #3 ;→p |
| T03 | loader | 0/1/2/59049/59050 cells, BOM/NUL/DEL/비ASCII/잘못된 UTF-8/opcode를 고정 계약대로 처리 |
| T04 | crazy | 독립 3×3 trit과 C 9×9 비교. 81개 ditrit 조합, 경계값, 고정 seed 입력 쌍 |
| T05 | rotate/포인터 | 10회 rotate로 원상복원, 각 trit 위치, C/D=59048 wrap, j/i 뒤 증가 |
| T06 | 초기 memory | 여러 source의 59049셀 전체를 독립 C와 비교하며 Source는 보존 |
| T07 | 명령 | 8개 opcode와 runtime unnamed NOP. input/output symbol을 뒤집지 않음 |
| T08 | jump | 명령 효과 이후 C의 셀을 치환. fetch 주소와 다를 때 두 주소를 구분 |
| T09 | input wait | empty+open에서 반복 Step해도 registers/memory/step/counters/tape/output 완전 불변 |
| T10 | 복수 쓰기 | 같은 셀의 data-write→encryption 순서와 undo의 역순 복원 |
| T11 | fault 경계 | 치환 값 32/33/126/127/128, 127→NUL과 OOB 구분, G01의 원자성 계약 |
| T12 | 원문 회귀 | §1의 모든 기대값, M78의 ordered writes, Halt 포함 24명령, 출력 1 byte를 C/TS에서 검증 |
| T13 | I/O | UTF-8/Hex/LF, byte 0/127/128/255, 남은 byte 뒤 EOF, 반복 EOF의 cursor 불변 |
| T14 | intent 경합 | Step-wait 후 한 명령, Run-wait 후 잔여 budget, Pause 뒤 Send는 실행 없음, Stop 뒤 입력 거부 |
| T15 | scheduler | Run 호출별 budget, wait 중 잔여 보존, output cap 전·도달·초과·상향, Pause yield |
| T16 | breakpoint | 한 줄의 여러 셀·생성 주소·줄/열 해석, 한 번의 bypass, 같은 주소 재방문 시 재정지 |
| T17 | watchpoint | read/write/encryption 구분, 같은 값 쓰기도 감지, 다중 감시점, 명령 완료 후 정지 |
| T18 | undo/replay | registers·전체 memory·tape visible/cursor/EOF·output·counters·terminal 복원과 불일치 검출 |
| T19 | History 조회 | 조회가 live를 변경하지 않고 모든 패널이 같은 point를 표시 |
| T20 | branch | export 취소/실패 시 부모 유지, 소비한 prefix 고정, 새 branchId/root, 미소비 suffix만 변경 |
| T21 | retention | 작은 한도로 강제 eviction, 연속 earliest checkpoint, 만료 조회 거부, 집계와 상세 구분 |
| T22 | stale 응답 | session/snapshot/branch/epoch/generation/version 불일치 응답 폐기, Restart 뒤 옛 memory 표시 금지 |
| T23 | wire 검증 | 중복 입력은 한 번만 append, 오래된 sequence 재실행 금지, 잘못된 주소·enum·크기 거부 |
| T24 | Worker 장애 | 실제 Worker 종료 오류 노출, source 보존, 자동 실행 없음, resync/요청 실패 명확 |
| T25 | Raw/Normalized | 같은 encoder, 생성 Raw 읽기 전용, 분리 후 새 documentId, 잘못된 생성물 실행 금지 |
| T26 | editor | 자동 괄호/따옴표/주석/LF 금지, 교체의 단일 undo, codec/token 일치, 고대비 명령 구분 |
| T27 | notes | `.mb`에 메모 비혼입, 공백 연결 유지, 모호한 편집은 stale, 사용자 설명과 관찰 구별 |
| T28 | 파일 저장 | 외부 hash 충돌·쓰기 실패·권한·부분 성공·rename 실패를 처리하고 원문 보존 |
| T29 | 보안 | ../·절대경로·symlink 탈출·grant 위조 차단, source/notes를 코드로 실행하지 않음 |
| T30 | 복구/종료 | 저장 실패 시 close 취소, 복구본으로 원본 자동 덮어쓰기 금지, source/trace 확인 분리 |
| T31 | 프로젝트 | 폴더 이동 후 상대경로 동작, 모르는 schema는 read-only, normalized 연결, 노트 이관 |
| T32 | 학습 | 여섯 lesson을 실제 VM/codec으로 판정. state injection 금지, 데이터 쓰기와 치환 질문 구분 |
| T33 | Tests 패널 | byte·terminal·coverage 비교, 명시적 취소, 대화형 세션에 영향 없음 |
| T34 | macOS E2E | 설치 앱에서 열기→fixture 실행→M78→Halt→Back→replay→source 저장을 오프라인 완주 |
| T35 | macOS UX | 한글 IME, 단축키, VoiceOver, 200% 확대, 패널 접기, reduced-motion |
| T36 | artifact | `.app/.dmg` 각각 생성·실행·architecture 확인, production CSP에서 두 Worker 로딩 |
| T37 | 배포 격리 | release에 automation plugin·test IPC·listener 없음. 테스트 앱과 artifact hash 구분 |
| T38 | 공개 배포 | Developer ID 서명, 공증 승인/staple, quarantine 상태로 다른 Mac에 설치 |
| T39 | 성능 | OS/build 조건과 idle/run/긴 source/eviction의 RSS·Pause 지연·조회 시간·bundle 크기 실측 |
| T40 | 문서 무결성 | 9개 문서, 상대 링크, JSON, fixture hash, 테스트·상태·근거 ID, 누락 및 언어 혼입 검사 |
| T41 | revisit fixture | 출처·라이선스·hash, 반복 fetch의 실제 decode 변화, C/TS 단계별 일치로 L06 지원 |
| T42 | trace | footer/range/digest·잘린 파일 검출, privacy 경고, bounded chunks/취소/내보내기 실패 |

경계 unit은 합성 state로 연산을 고립 시험할 수 있으나 `synthetic-state-unit`으로 표시한다. 실제 Malbolge source나 학습 초기 상태로 가장하지 않는다. source 기반 독립 실행인 T12/T41을 대체하지 않는다.

## 5. 회귀·property 테스트 전략

unit 기대값을 production codec 호출로 다시 생성하지 않는다. 참조값·독립 알고리즘·고정 raw fixture 중 어디에서 온 값인지 표시한다. seed와 실패 입력을 보존한다. 59049²개의 모든 word pair를 검사했다고 주장하지 않고 실제 검사한 범위를 보고한다.

초기 문자가 모두 합법인 source도 실행 중 stall/UB로 갈 수 있다. 성공한 명령만 남겨 평균내지 않고 정상/Halt/stall/undefined/budget과 coverage를 구분한다. 같은 source/input에서 trace 활성화 여부에 따른 machine 결과는 같아야 한다.

undo property는 forward N→back N→forward N의 memory·정수 counters·tape·output·terminal을 비교한다. eviction 뒤에는 보존 범위에서만 검사하며 earliest boundary를 넘을 수 없음을 확인한다. replay 불일치는 기존 기록을 새 결과로 덮어쓰지 않고 마지막 일치 point에서 멈춘다.

## 6. 실제 macOS 자동화 경로

2026-09-27 확인한 Tauri 공식 문서는 WebdriverIO `@wdio/tauri-service`의 embedded provider와 `tauri-plugin-wdio-webdriver`가 macOS를 포함하는 테스트 경로라고 설명한다. `tauri-plugin-wdio`는 backend 접근·mocking 등 별도 기능이다. plain tauri-driver를 macOS에서 바로 사용할 수 있다고 가정하지 않는다. [W6]

테스트용 Cargo feature `e2e-webdriver`와 별도 capability/config를 제안한다. 일반 release는 해당 feature·등록·permissions를 제외한다. IPC mocking 성공은 native 저장 검증이 아니다. T34는 실제 core와 native 서비스를 사용한다.

도구의 공식 지원 설명과 **이 프로젝트의 설치본 테스트 성공은 다르다**. version 조합은 B0/E4에서 lock하며 현재 NOT_RUN이다. instrumentation이 없는 최종 `.app`에도 실제 launch/menu/open/save/IME smoke를 수행한다. 자동화가 native dialog나 IME를 충분히 다루지 못하면 해당 범위를 수동 실행 기록으로 보완한다.

## 7. 배포 artifact별 판정

| 결과물·검증 | 통과 증거 | 현재 |
|---|---|---|
| browser dev | 프런트엔드 테스트 로그 | NOT_RUN |
| instrumented macOS 앱 | 실제 WKWebView+embedded E2E 로그 | NOT_RUN |
| release .app | 부팅·architecture·오프라인 핵심 흐름 | NOT_RUN |
| .dmg | 이미지 생성·mount·설치·실행 | NOT_RUN |
| ad-hoc 서명 | 해당 artifact의 서명 검사 | NOT_RUN |
| Developer ID 서명 | 인증서 chain·서명 검사 | NOT_RUN |
| 공증 | 제출 ID·승인 결과·staple 검사 | NOT_RUN |
| 다른 Mac 설치 | quarantine·OS·architecture·실행 기록 | NOT_RUN |

서명과 공증은 별도 절차다. 로컬 실행만으로 공개 배포 성공을 보고하지 않는다. 자격 증명 조회나 공증 서버 업로드는 이번 설계 범위에서 수행하지 않았다. [W7]

macOS 최소 지원 버전과 Intel 지원 여부는 G03이다. 현재 확인한 arm64/macOS 26.5.2는 개발 host 하나이며 전체 지원 행렬이 아니다.

## 8. 증거 형식과 성능 목표

각 실제 검사는 `testId, status, timestamp, sourceDigest, profileDigest, command, toolVersions, os, arch, artifactDigest, assertions, failures, logPath`를 기록한다. 비밀키·tokens·개인 입력은 넣지 않는다. trace가 필요하면 테스트용 공개 입력을 쓴다.

추가 제안 목표는 foreground Pause p95<100ms, summary≤20Hz, 긴 source 편집 시 명령 입력 유실 0이다. 보장된 측정값이 아니다. 고정 host에서 p50/p95/max/표본 수/부하 조건을 함께 보고하고 power mode·warmup·tracing 여부를 기록한다. 총 RSS, Worker buffers, encoded history storage를 구분한다.

## 9. 출시 차단 기준

참조와 VM 불일치, source 자동 오염, undo 데이터 손실, 입력/EOF 순서 손상, 다른 snapshot의 값 표시, 범위 밖 파일 쓰기, release의 테스트 listener는 출시 차단 결함이다. 설치본 확인 없이 browser 성공으로 E gate를 통과시키지 않는다.

E_LOCAL은 전체 기능과 실제 artifact 검증이 필요하다. E_PUBLIC에는 T38과 다른 Mac 설치 검증이 추가된다. A/B만 통과한 상태는 prototype으로 표시한다. 현재는 설계 산출물이며 A–E는 NOT_RUN이다.
