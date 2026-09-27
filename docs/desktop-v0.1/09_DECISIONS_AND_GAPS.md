# 09 — 결정 기록·근거·미확정 사항·요구사항 추적

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

이 문서는 기존 설계에서 계승한 요구, 이번 상세화 제안, 아직 검증되지 않은 계약을 구분한다. **앱 구현 완료 보고서가 아니다.** 01–08번 문서의 세부 필드·범위·상태 전이 이름이 원래부터 존재했던 공식 Malbolge 표준인 것처럼 표현하지 않는다.

## 1. 제공 자료의 식별자

| ID | 자료 | 사용 범위 |
|---|---|---|
| S1 | 사용자 첨부 `붙여넣은 텍스트(1).txt` — BolgeScope Desktop 상세 설계, 761행 | 제품 범위, UI, Source/Initial/Runtime/History, 단일 VM, 작성·디버깅·학습, A–E 관문 |
| S2 | 사용자 첨부 `붙여넣은 텍스트(2).txt` — 제품·UX·기술 상세 설계 프롬프트, 781행 | 이번 산출물이 설계라는 작업 범위, 요구된 9개 문서, 상태·프로토콜·안전성·출시 수용 기준 |
| S3 | Library에서 읽은 `BolgeScope_Desktop_Design_Prompt.md`, version 1, file id `file_00000000cc44820994bf00059c2dbd74` | 위 프롬프트의 원본 Markdown. 특히 §15에 있는 전체 87문자 fixture와 기대 SHA-256 |

S1/S2의 내부 `chatgpt-content-reference` 표기는 원문에서 온 불완전한 인용 표식이다. 이를 독립적으로 확인한 출처로 사용하지 않았다. 원문에 적힌 옛 sandbox 링크의 존재만으로 파일을 확보했다고 하지 않고, S3를 Library에서 찾아 전체 내용을 읽었다.

S2와 S3는 전체 `tio-c-safe-v1` legacy 명세가 없다고 명시한다. 이번 검색에서 원본 VS Code 확장 명세 또는 그 profile 전체를 별도로 확보하지 못했다. 따라서 원래의 loader/fault 정책을 알고 있는 것처럼 보충하지 않는다.

## 2. 외부 확인 자료

확인일: 2026-09-27. 아래는 제공 자료와 별도로 확인한 공개 1차 자료다. 제품 요구의 근거와 구현 API 확인의 근거를 구별한다. 문서 URL의 내용은 이후 바뀔 수 있으므로 실제 구현 시 package lock 및 참조 source digest를 함께 고정한다.

### W1 — Olmstead 계열 Malbolge C interpreter

```text
https://raw.githubusercontent.com/TryItOnline/malbolge/master/malbolge.c
https://www.lscheffer.com/malbolge_interp.html
https://www.lscheffer.com/malbolge_spec.html
```

Workspace에서 읽은 raw C는 4,738 bytes, SHA-256 `fe29a717f9f684d6cc81d5c63273d446d9c65fec73e62164538514d5737b07a6`이었다. 원문의 public-domain 선언, xlat1/xlat2, crazy 인자 방향, 입력·출력, jump 뒤 치환, Halt를 확인했다. prose specification과 interpreter가 다를 때 혼합하지 않는다. **원본을 컴파일하거나 실행하지 않았다.**

### W2 — Tauri capabilities와 자체 command 경계

```text
https://v2.tauri.app/security/capabilities/
```

capability가 잘못 작성된 Rust 로직이나 자체 scope 검사를 대신 보호하지 않는다는 경계를 확인했다. app command 권한 설정과 최소 grant를 함께 검증해야 한다. capability 파일을 만들었다는 사실만으로 T29 통과가 아니다.

### W4 — Vite Worker bundling

```text
https://vite.dev/guide/features.html
```

`new Worker(new URL(..., import.meta.url), ...)`를 통한 Worker 처리 방식을 확인했다. 런타임·Monaco Worker 모두 실제 production bundle과 Tauri WebView에서 로딩되는지는 별도 테스트다.

### W5 — Monaco ESM 통합과 언어 provider

```text
https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md
https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.languages.setMonarchTokensProvider.html
```

ESM/Worker 통합 문서와 언어 provider 설명을 확인했다. `registerDocumentSemanticTokensProvider`의 전용 현재 API 페이지는 이번 조회에서 확보하지 못했다. 따라서 세부 signature·theme 동작을 검증 완료라고 하지 않는다. 주소 인식 semantic tokens라는 설계 방향은 유지하며 설치한 Monaco 버전의 typings 및 실제 동작으로 B0/C1에서 확인한다.

### W6 — Tauri macOS WebDriver 경로

```text
https://v2.tauri.app/develop/tests/webdriver/
```

확인한 공식 문서는 `@wdio/tauri-service`의 embedded provider와 `tauri-plugin-wdio-webdriver`를 이용한 macOS 포함 경로를 안내한다. `tauri-plugin-wdio`는 backend 접근·mocking 등 별도 기능이다. plain `tauri-driver`를 macOS에서 같은 방식으로 사용할 수 있다고 가정하지 않는다. **이 프로젝트에 설치하거나 실행하지 않았으며** 릴리스 앱에서 automation plugin·listener·test permission은 제외해야 한다.

### W7 — macOS 서명·공증

```text
https://v2.tauri.app/distribute/sign/macos/
```

`.app`/`.dmg` 생성, ad-hoc 서명, Developer ID 서명, 공증 및 다른 Mac 설치는 별도 검증으로 둔다. 자격 증명이나 인증서를 이번 작업에서 조회하지 않았다.

## 3. 작업환경: 관측값과 지원 정책의 차이

2026-09-27 Catdesk의 현재 workspace에서 직접 확인한 값이다.

| 항목 | 관측값 |
|---|---|
| Workspace | `/Users/zerogod/Projects/BolgeScope` |
| 초기 파일 상태 | 빈 폴더. 루트 `AGENTS.md` 없음 |
| OS | macOS 26.5.2, build 25F84 |
| Architecture | arm64 |
| Node / npm | v26.7.0 / 12.0.2 |
| Rust / Cargo | 1.94.0 / 1.94.0 |
| Developer directory | `/Applications/Xcode.app/Contents/Developer` |
| Swift | 6.3.3 |

앞선 대화의 Swift 6.2.4·Command Line Tools만 설치되어 있다는 설명은 이 관측값과 맞지 않아 정정한다. 앱의 기술 선택은 SwiftUI가 아니라 제공 설계의 Tauri/TypeScript다. 이 표는 빌드 성공이나 지원 OS 전체를 의미하지 않는다. 패키지 설치, Git 초기화·commit·push, 인증서 변경을 수행하지 않았다.

## 4. 핵심 결정 기록

| ID | 기존 결정 → 이번 상세화 | 이유·영향 | 검증 |
|---|---|---|---|
| D01 | Tauri/React/Monaco/TS Worker 유지 | macOS 전용 SwiftUI로 임의 변경하지 않는다. 단일 제품 VM 유지 | T34, T36 |
| D02 | 네 상태 분리 → immutable snapshot + 문서 revision + ViewContext | source 편집과 실행·과거 표시에 다른 시점이 섞이는 것을 방지 | T19, T22, T25 |
| D03 | Step/Back → 편집 undo와 실행 journal 독립 | Cmd+Z가 실행을 되돌리거나 runtime이 source를 덮어쓰지 않게 한다 | T18, T26 |
| D04 | byte tape → append/close도 별도 ordered event | EOF·미래 입력 visibility·같은 입력 replay를 재현 | T09, T13, T14, T18 |
| D05 | 과거 조회/복귀 구분 → point 고정 조회와 rewindTo 분리 | Timeline 클릭만으로 live machine을 변경하지 않는다 | T19, T22 |
| D06 | 역실행 → bounded binary journal + checkpoint | 매 명령 전체 memory 복사 대신 ordered delta를 보존 | T10, T18, T21 |
| D07 | 입력 변경 branch → export 성공 receipt 후 새 branch | export 취소/실패 시 부모 기록이 유실되지 않게 한다 | T20, T42 |
| D08 | 주소 breakpoint → 같은 point 한 명령 bypass | input wait에서도 breakpoint 무한 재정지를 방지하며 재방문은 잡는다 | T16 |
| D09 | 감시점 → data-read/data-write/encryption role 분리 | fetch를 데이터 read로 세거나 두 write를 합치지 않는다 | T10, T17 |
| D10 | 실행 한도 → Run 호출당 budget, wait 중 잔여 보존 | 명시적 Continue와 자동 입력 재개를 구별한다 | T14, T15 |
| D11 | 64MiB history → encoded buffer 회계의 상한 | 전체 앱 RAM 64MiB 보장으로 오해하지 않게 한다 | T21, T39 |
| D12 | 노트 외부 저장 → 단일 파일은 앱 관리 영역, 프로젝트 이관 명시 | standalone 사용을 강제 sidecar/project 생성 없이 지원 | T27, T31 |
| D13 | 파일 승인 범위 → Rust opaque grant와 구성요소 검증 | UI가 임의 경로를 내보내거나 symlink로 탈출하는 것을 방지 | T28, T29 |
| D14 | schema 추가 → 형식별 version·validation·read-only unknown major | 기록과 프로젝트를 옮겨도 원문을 조용히 잃지 않게 한다 | T23, T31, T42 |
| D15 | 여섯 학습 유지 → L06 별도 검증 fixture 필요 | 네 번 갱신 예제를 실제 반복 명령 재방문 증거로 잘못 쓰지 않는다 | T32, T41 |
| D16 | 실제 앱 검증 → instrumented 앱과 release artifact 분리 | 브라우저·mock 테스트 또는 test plugin 포함 앱으로 배포 성공을 대체하지 않는다 | T34–T38 |
| D17 | trace 입력 포함 선택 → privacy 집계 모드 별도 | tape를 빼도 registers/writes에 input이 남을 수 있다 | T42 |
| D18 | 전체 first version → E_LOCAL/E_PUBLIC 별도 판정 | 기능·로컬 설치 성공과 공증된 공개 배포를 분리한다 | T34–T38 |

D02–D18의 구체적인 필드·알고리즘·전이 정책은 새 상세화 제안이다. 기존 요구를 완성 가능한 계약으로 만들기 위한 결정이지 이미 구현·검증되었다는 뜻이 아니다.

## 5. 의미론 후보와 원안 변경 관리

현재 자료만으로 legacy profile의 전체 계약을 동결하지 않는다. 04번 문서는 정상 C 동작을 확인한 부분과 다음 후보를 분리했다.

| 기존 결정 | 후보 상세화/변경 | 이유 | 영향 문서·검증 |
|---|---|---|---|
| `tio-c-safe-v1`, 정확한 loader 미제공 | 6종 ASCII 공백, strict graphic source, BOM/NUL/비ASCII reject | 문서·파일 encoding 경계의 결정론적 처리 | 04/05/07, T01/T03, G01 해소 필요 |
| 원본 stall/undefined를 구분 | invalid fetch는 safe-stop, 잘못된 치환 접근은 별도 진단 | NOP/Halt로 오인하지 않음 | 04/06/07, T09/T11 |
| fault의 partial commit 미제공 | staged effects 후 unsafe access에는 full rollback 후보 | I/O·write·undo 원자성 정의 | 04/05/06/07, T10/T11/T18, G01 해소 필요 |
| post-operation C에 치환 | C 문자열의 index94 종단 NUL 경계, 값127→0을 구분 | C에서 정의된 접근을 OOB로 오판하지 않음 | 04/07, T11, legacy 정책 대조 필요 |

127 경계는 읽은 C의 배열 선언·접근으로부터 도출한 분석이며 실행 검증 결과가 아니다. 원본 profile과 다른 정책이 확인되면 `기존 계약 → 변경 사유 → 새 revision/digest → 영향 테스트`를 기록한다. 새 정책을 기존 이름 아래 몰래 적용하지 않는다.

## 6. 미확정 사항과 구현 차단 범위

| ID | 확인 필요 | 영향·권장 방향 | 필요한 자료/검증 | 차단 범위 |
|---|---|---|---|---|
| G01 | legacy `tio-c-safe-v1` 전체 loader/fault/치환 경계 | strict/rollback 후보는 명시했지만 원래 정책으로 확정하지 않는다 | 원본 확장 명세 또는 명시적 새 계약 동결, 참조 hash·T03/T11 | A의 최종 통과와 호환성 release 주장 차단. UI/정상 core 분석 전체를 막지 않음 |
| G02 | Node/Vite/React/Monaco/Tauri/WDIO 정확한 버전 조합 | package managers의 실제 호환 조합을 lock한다. 최신이라는 이유로 임의 추정하지 않음 | 공식 요구사항, installed typings, clean install/build | B0 및 재현 가능한 빌드 차단. 디자인 문서 작성은 가능 |
| G03 | 최소 macOS 버전·Intel 지원 | 현재 arm64 host와 지원 제품 범위를 분리 | Tauri/WebView/Monaco 조합의 minimum 요구, 지원할 실제 Mac 테스트 | E_LOCAL 지원 행렬 동결 차단 |
| G04 | L06 재방문 fixture | C/TS가 반복 fetch·decode 변화를 동일하게 관찰하는 별도 source 확보 | provenance/license/hash, T41 | L06 활성화와 E2 전체 통과 차단. 87셀 회귀를 대체하지 않음 |
| G05 | Developer ID·공증 자격·다른 Mac 검증 환경 | 사용자 배포 계정/서명 권한을 실제 배포 단계에 확인 | 서명·공증 제출/승인·staple·quarantine 설치 evidence | E_PUBLIC만 차단. E_LOCAL 또는 설계 작성과 별개 |
| G06 | 외부 저장 경쟁에서 보호 수준 | hash 비교+atomic rename만으로 모든 외부 동시 쓰기 race를 제거했다고 하지 않음 | 실제 concurrent writer 테스트, backup/충돌 UX, T28/T30 | 원본 무손실 보장 수준의 동결과 저장 release 검증 차단 |
| G07 | 앱 총 RAM·Pause latency·큰 source 성능 | 64MiB는 encoded history, 20Hz/8ms는 초기 정책으로만 표현 | pinned host의 T39, idle/run/replay/eviction 표본 | 성능 주장 차단. correctness 계약과 별개 |
| G08 | 실제 macOS bundle의 Worker·Monaco·IME·자동화 | official support 설명은 프로젝트 실행 성공이 아님 | T34–T37, browser와 instrumented/native artifact 구분 | B/E의 실제 Desktop 성공 판정 차단 |

G01은 제품의 의미론을 바꾸는 중요한 확인 항목이다. 다만 나머지 문서를 목차만 남기거나 전체 작업을 중단하는 이유가 아니다. 이번 산출물은 각 gap의 영향과 수용 테스트를 갖춘 설계다.

## 7. 요구사항 추적표

source 범위는 문서의 섹션 번호다. `계승+상세화`는 기존 요구를 유지하면서 이 패키지에서 세부 정책을 정했다는 뜻이다.

| 요구 ID | 요구사항 | 출처·계승 여부 | 모듈·화면 | 수용 테스트 |
|---|---|---|---|---|
| R01 | 로컬·오프라인, 순수 `.mb` | S1§1/S2§3, 계승 | native/core/배포 | T12, T34, T36 |
| R02 | 한국어 기본·영어·macOS 우선 | S2§3, 계승 | app/i18n/editor | T35, T36 |
| R03 | AI/새언어/ML 플랫폼 제외 | S2§3, 계승 | 제품·dependency 경계 | T40 및 범위 리뷰 |
| R04 | 네 상태·immutable snapshot | S2§4, 계승+상세화 | documents/runtime/ViewContext | T19, T22, T25 |
| R05 | 선택 주소와 C/D/과거 위치 분리 | S2§4, 계승+상세화 | selection/Inspector | T19, T22 |
| R06 | 여섯 UI 장면·빈/로딩/오류 | S2§5, 계승+상세화 | workspace/panels | T34, T35, T40 |
| R07 | Raw 언어 자동 편집 차단 | S2§6, 계승 | Monaco adapter | T26 |
| R08 | 주소 인식 decode/Lens/hover | S2§6, 계승+상세화 | core/codec/source, editor | T01, T02, T26 |
| R09 | UTF-16/byte/주소 map | S2§6, 계승+상세화 | core/source | T01, T03 |
| R10 | 명령 교체 preview와 undo | S2§7, 계승+상세화 | editor/command palette | T25, T26 |
| R11 | Normalized 단일 원본 | S2§7, 계승 | authored/generated model | T25 |
| R12 | 초기 재인코딩≠의미 보존 | S2§7, 계승 | edit-impact/preview | T25, T26 |
| R13 | 외부 노트·stale 연결 | S2§8, 계승+상세화 | annotations/project | T27, T31 |
| R14 | 단일 TS VM·Rust OS만 | S2§13, 계승 | packages/core/runtime, native | T12, T34, 경계 리뷰 |
| R15 | 참조·profile 구분 | S2§9/S3§8, 계승+확인 필요 | semantics/reference harness | T03–T12 |
| R16 | wait 무변화·EOF 구분 | S2§9, 계승 | core/input tape/session | T09, T13, T14 |
| R17 | jump 이후 치환 | S2§9, 계승 | core/vm | T08, T11 |
| R18 | Halt 후 유지·Back | S2§9, 계승 | session/history | T12, T18 |
| R19 | 동일 셀 ordered writes | S2§9, 계승 | transaction/journal | T10, T18 |
| R20 | Step/Run 의도·Pause/Stop 경합 | S2§9, 계승+상세화 | scheduler | T14, T15, T24 |
| R21 | 주소 중단점·재개·generated 영역 | S2§9, 계승+상세화 | debugger/Memory | T16 |
| R22 | role별 watchpoint | S2§9, 계승+상세화 | debugger/transactions | T17 |
| R23 | Step Inspector 네 단계 | S2§10, 계승 | Inspector | T07, T10, T12 |
| R24 | 243×243 Memory와 겹치는 roles | S2§10, 계승 | Memory Overview/table | T17, T19, T35 |
| R25 | 실제 이력/이론 cycle 분리 | S2§10, 계승 | Cell History/Cycle | T19, T21, T41 |
| R26 | 조회와 rewind 분리·동일 시점 | S2§11, 계승+상세화 | queryView/Timeline | T19, T22 |
| R27 | undo의 tape/output/counters 복원 | S2§11, 계승+상세화 | history/tape | T10, T18 |
| R28 | input/EOF event와 replay | S2§11, 계승+상세화 | journal/session | T13, T18, T23 |
| R29 | branch는 내보내기 후 변경 | S2§11, 계승+상세화 | exporter/native/history | T20, T42 |
| R30 | 이력 한도·earliest point | S2§11, 계승+상세화 | checkpoint/retention | T21, T39 |
| R31 | 여섯 실제 VM 학습 | S2§12, 계승+상세화 | lessons/codec/core | T32, T41 |
| R32 | Worker request/IDs/stale 차단 | S2§13, 계승+상세화 | contracts/worker client | T22, T23, T24 |
| R33 | 단일 파일과 선택적 프로젝트 | S2§14, 계승+상세화 | project/native | T28, T31 |
| R34 | 저장 충돌·복구·종료 | S2§14, 계승+상세화 | native/recovery | T28, T30 |
| R35 | file grants·경로·불신 텍스트 | S2§14, 계승+상세화 | Rust boundary/renderer | T29 |
| R36 | 실행·UI·출력·memory query 한도 | S2§14, 계승+상세화 | scheduler/query/export | T15, T21, T39 |
| R37 | 87셀 source/hash·회귀 기대 | S3§15, 계승 | fixtures/reference/core | T12, T40 |
| R38 | 계층별 테스트·독립 oracle | S2§15, 계승 | tests/reference/integration | T04–T24, T34 |
| R39 | 실제 설치본·서명·공증 분리 | S2§15, 계승+상세화 | release/e2e | T34–T38 |
| R40 | 아홉 문서와 A–E 의존 작업 | S2§16, 계승 | docs/planning | T40 |
| R41 | trace 제외 옵션과 privacy 경계 | S2§14, 계승+상세화 | export dialog/serializer | T42 |
| R42 | serialized history 회계와 전체 RAM 분리 | 초기 한도에서 상세화 | history/perf | T21, T39 |

## 8. 교차 검토 규칙

05번의 상태·시점 타입을 기준으로 02/03/06의 표시·전이를 대조한다. step은 Halt 포함 committed instruction 수이고 eventIndex는 host 입력 사건을 포함한 journal 위치다. branch root에서 step을 0으로 가정하지 않는다. input tape의 visibleLength/cursor/closed를 따로 복원하며 future 기록이 있다고 미래 byte를 먼저 읽지 않는다.

03의 storage 방식과 06의 undo/replay 절차가 같은 ordered delta와 checkpoint를 가정하는지 확인한다. 07의 기대값·test schema가 05의 필드와 일치하는지 검토한다. 08의 테스트 ID는 07에서 정의한 T01–T42만 참조한다. 서명/공증/앱 실행을 문서 검사 PASS와 혼동하지 않는다.

검증 스크립트는 파일 존재·링크·JSON·fixture hash·참조 ID·언어 혼입 등 **문서의 기계적 무결성**을 확인한다. 동작 설계의 완전한 정당성이나 TypeScript 컴파일·VM conformance를 증명하지 않는다. 실제 실행 결과는 `evidence/design-validation.json`에 기록한다.

## 9. 이번 작업과 이후 구현의 경계

이번에 생성한 것은 9개 상세 설계, 문서 index, source fixture와 문서 검증 자료다. 회귀 fixture의 길이·hash만 직접 확인했다. VM 실행 기대값, 성능, 앱 build, .app/.dmg, 자동화, 서명·공증은 NOT_RUN이다.

최종 구현 첫 작업은 A0의 profile 계약 고정과 A1–A5의 independent conformance 경로다. 초기 source와 실행 결과를 한 화면으로 연결하는 B3를 그 뒤에 검증한다. 설계 단계가 끝났다는 이유로 A–E 전체가 끝났다고 표현하지 않는다.
