# BolgeScope Desktop — 상세 설계 v0.1

2026-09-27 · **DESIGN_REVIEWED_WITH_GAPS**

사용자가 제공한 Desktop 설계와 설계 프롬프트를 바탕으로 만든 구현 전 계약이다. 제품 코드·의존성 설치·앱 빌드는 포함하지 않는다. 기존 요구, 상세화 제안, 확인 필요 사항을 분리했다.

## 문서 안내

| 문서 | 내용 |
|---|---|
| [01_PRODUCT_SPEC.md](01_PRODUCT_SPEC.md) | 사용자·제품 가치·첫 버전 범위·비목표·완료 판정 |
| [02_UX_SPEC.md](02_UX_SPEC.md) | 여섯 화면 장면·패널 동작·작성·접근성·여섯 학습 계약 |
| [03_ARCHITECTURE.md](03_ARCHITECTURE.md) | 단일 VM·Worker·React·Rust 소유권·저장·모듈 경계 |
| [04_SEMANTICS_CONTRACT.md](04_SEMANTICS_CONTRACT.md) | 참조 의미론·변환표·loader/fault 후보·미확정 프로필 |
| [05_DATA_AND_PROTOCOL.md](05_DATA_AND_PROTOCOL.md) | 공통 타입·식별자·명령·사건·프로젝트·trace·복구 계약 |
| [06_DEBUGGER_SPEC.md](06_DEBUGGER_SPEC.md) | 실행 전이·입력/EOF·breakpoint/watchpoint·history·replay·branch |
| [07_TEST_AND_RELEASE.md](07_TEST_AND_RELEASE.md) | 87셀 회귀·42개 수용 테스트·실제 앱·배포 검증 |
| [08_IMPLEMENTATION_PLAN.md](08_IMPLEMENTATION_PLAN.md) | A–E 작업 의존성·모듈·산출물·수용 기준 |
| [09_DECISIONS_AND_GAPS.md](09_DECISIONS_AND_GAPS.md) | 근거·18개 결정 기록·8개 미확정 항목·42개 요구 추적 |

전체 범위는 01 → 02 → 03 순서로, 첫 구현은 09의 G01 → 04 → 05/06 → 07/08 순서로 읽는다. 05번이 상태·시점·필드 이름의 기준이다.

## 유지한 중심 구조

Tauri 2 + React/TypeScript + Monaco + Vite/npm workspaces, 단일 TypeScript VM과 Runtime Worker, Rust 파일·창·권한 서비스 구조다. Source/Initial/Runtime/History를 분리한다. `.nmal`은 초기 명령 작성 보조이고 실제 실행은 생성된 Raw를 같은 loader/VM에 전달한다.

과거 조회와 실제 되돌리기는 다르다. 입력 append와 EOF도 명령과 별도의 journal 사건으로 기록하고, 같은 입력 replay와 새 입력 branch를 구분한다. 사용자 source에는 runtime 변환이나 노트를 쓰지 않는다.

## 회귀와 검증의 상태

[recurrent_crazy4.mb](fixtures/recurrent_crazy4.mb)는 원본 프롬프트의 87셀 fixture다. 파일 108 bytes, 공백 제거 후 87 cells 및 다음 SHA-256의 일치를 확인했다.

```text
69ed29dde001b80de62e2feaf2a2f5463ec7ee9666b981954ef63a938a854a81
```

출력 `4A`, Halt 포함 24명령, 최종 A/C/D=`29514/23/80`은 **검증할 기대값**이다. VM·독립 참조 실행, 실제 앱·.app/.dmg·서명·공증은 NOT_RUN이다. 문서 검사는 앱 테스트를 대체하지 않는다.

검증 명령은 workspace root에서 다음과 같다.

```bash
python3 docs/desktop-v0.1/evidence/validate_design.py
```

결과는 `evidence/design-validation.json`에 저장된다. 검사 스크립트는 문서·링크·JSON·참조 ID·fixture 무결성만 확인하며 제품 VM을 구현하거나 실행하지 않는다.

## 남은 확인 항목

가장 중요한 것은 전체 legacy `tio-c-safe-v1`의 loader/fault 계약이다. 04번에 적힌 strict loader·full rollback은 **후보 상세화**이지 확보하지 못한 원래 프로필의 사실이 아니다. 정확한 package version, 최소 macOS/Intel 지원, 재방문 학습 fixture, 외부 동시 저장 보호 수준, 실측 성능과 설치 검증도 09번의 gap 표에 구분했다.

A/B만 구현한 뒤 전체 제품 완료로 표시하지 않는다. 로컬 설치 검증 E_LOCAL과 서명·공증·다른 Mac 설치까지 포함하는 E_PUBLIC도 별도로 판정한다.
