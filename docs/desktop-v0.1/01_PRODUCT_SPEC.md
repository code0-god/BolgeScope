# 01 — BolgeScope Desktop 제품 명세

문서 버전: 0.1 · 작성일: 2026-09-27 · 상태: DESIGN_REVIEWED_WITH_GAPS

이 문서는 제품 구현 결과가 아니다. 근거의 식별자와 미확정 항목은 [09_DECISIONS_AND_GAPS.md](09_DECISIONS_AND_GAPS.md)에 있다. `기존 설계`는 제공 자료의 요구, `상세화 제안`은 이번에 정한 구현 계약, `확인 필요`는 출시 전에 해결할 근거·검증 공백이다.

## 1. 제품 정의 — 기존 설계

**Malbolge를 직접 작성하면서 주소별 해독, 메모리 변화, 자기변형 실행을 이해하는 로컬 전용 IDE.**

주 사용자는 재미로 Malbolge를 배우며 작은 프로그램을 직접 작성하는 사람이다. 기본 언어는 한국어이며 영어 전환을 지원한다. macOS에서 먼저 구현·검증하고 Windows/Linux는 이후 확장한다. 실행 대상은 원래의 10-trit Malbolge다. [S1 §1, S2 §3, S3 §2]

중심 흐름은 `명령 작성 → 실제 raw 문자 확인 → Step → 상태 변화 관찰 → 되돌리기 → 다른 시도`다. 사용자가 저장한 `.mb` 또는 `.mal`은 BolgeScope 없이 참조 인터프리터에서 실행되어야 한다. 순수성의 대상은 사용자 프로그램이며 IDE를 Malbolge로 구현하라는 요구가 아니다.

로그인, 소스 업로드, 외부 API, telemetry 없이 기본 기능이 동작한다. 오프라인에서 파일 열기·편집·실행·학습·저장·trace 내보내기가 가능해야 한다. 개발 시 의존성 다운로드와 공개 배포 시 Apple 공증은 앱의 오프라인 실행 요구와 별개의 절차다.

## 2. 해결할 문제와 수용 가능한 경험

| 사용자 문제 | 제품의 동작 | 확인 방법 |
|---|---|---|
| 같은 문자가 주소에 따라 달라 읽기 어렵다 | 주소·raw·ASCII·residue·초기 명령을 함께 보여준다 | 동일 codec 결과가 Editor/Hover/Lens에서 일치한다 |
| 첫 실행과 재방문 때 명령이 다르다 | Initial/Runtime/관찰 이력과 이론 cycle을 분리한다 | 실제 쓰기 사건에서만 Runtime을 갱신한다 |
| 코드 편집이 실행 중 상태와 혼동된다 | 불변 ProgramSnapshot으로 실행하고 revision 차이를 표시한다 | 편집해도 실행 source·메모리가 변하지 않는다 |
| 입력·EOF·LF 차이가 숨겨진다 | byte 미리보기, Send, 명시적 EOF, LF 옵션을 제공한다 | `4A`와 `4A0A`를 다른 결과로 비교한다 |
| 잘못된 실험을 되돌리기 어렵다 | 편집 undo와 VM 역실행을 별도로 제공한다 | Halt 이후 Back/replay 결과가 동일하다 |
| 순수 소스에 설명을 적기 어렵다 | 노트·별칭을 파일 밖의 메타데이터에 저장한다 | `.mb` 저장·복사에 노트가 섞이지 않는다 |

## 3. 첫 버전 전체 범위 — 기존 설계

### 3.1 작성

`.mb/.mal` Raw 편집, `.nmal` 보조 작성, 파일 열기/저장/다른 이름으로 저장, 주소 인식 하이라이팅, Hover, 오류 진단, Address Lens, 초기 명령 선택과 교체, 편집 영향 비교를 제공한다. `.nmal`은 `j i * p < / v o`와 허용 ASCII 공백만 다루며 새 문법을 만들지 않는다.

Source만 편집 가능하다. Initial, Runtime, History, 생성된 Raw는 읽기 전용이다. Normalized 원본에서 생성된 Raw를 편집하려면 명시적으로 별도 Raw 문서로 분리한다. 재인코딩은 초기 명령만 맞추는 작업으로, 전체 실행 의미를 보존한다고 표시하지 않는다. [S1 §§3–4, S2 §§4,6–7]

### 3.2 실행과 디버깅

Run/Continue, Pause, Step, Step Back, Reverse Continue, Restart, Stop, 주소 중단점, 데이터 읽기·쓰기·명령 치환 감시점을 제공한다. 생성 메모리도 주소로 탐색하고 중단점을 설정할 수 있다. Step은 실제 명령 하나이며 함수 스택이나 Step Out을 만들지 않는다.

입력 대기는 EOF가 아니다. Halt는 프로그램 종료, Stop은 세션 폐기다. Pause/budget/output limit/breakpoint는 정상 종료가 아니라 정지 이유다. 참조의 stall·미정의 접근을 정상 NOP/Halt로 바꾸지 않는다. [S2 §9, S3 §§8–9]

### 3.3 관찰

Step Inspector는 fetch/decode, 명령 효과, 치환, 포인터 증가를 나누어 설명한다. Memory Overview는 243×243 표시용 격자와 64/128셀 상세 표를 제공한다. Cell History와 Explain This Value는 보존된 사건만 설명한다. theoretical cycle은 실제 방문 이력과 분리한다.

Timeline 클릭은 조회이며 VM 이동이 아니다. 과거를 보는 모든 패널은 동일한 ViewContext를 따른다. 실제 되돌리기와 입력 변경 branch는 명시적 동작이다. [S1 §§6–8]

### 3.4 저장·학습·테스트

파일 하나만으로 시작할 수 있다. 선택적 프로젝트는 source·노트·테스트·실행 설정을 묶는다. 프로젝트 경로는 상대경로를 사용한다. 외부 파일 변경, 저장 충돌, 자동 복구, 종료 시 dirty 문서 확인을 처리한다.

여섯 학습 주제는 주소와 문자, 입력과 EOF, 포인터, crazy, 명령 변환, 재방문이다. 실제 VM 결과로 답을 판정한다. 테스트 패널은 입력 byte/EOF/한도/기대 byte·상태를 비교한다. trace는 범위와 민감한 입력 포함 여부를 확인한 뒤 내보낸다. [S2 §§12,14–15]

## 4. 비목표 — 기존 설계

AI 코드 생성, 프로그램 자동 합성, 새 Malbolge 변형, Unshackled, HeLL/LMAO 통합, reservoir/ML 성능평가, 범용 IDE 기능, 클라우드 동기화는 첫 버전에서 제외한다. Rust와 TypeScript 양쪽에 제품 VM을 만들지 않는다. DAP는 Desktop 필수 의존성이 아니다.

실행 중 A/C/D·메모리를 임의 수정하는 편집 기능을 넣지 않는다. 입력은 실제 input 명령을 통해서만 계산 상태에 도달한다. 로딩/재시작/기록 기반 undo는 디버거 제어이며 사용자 명령 횟수로 세지 않는다.

## 5. 제품 단위 — 상세화 제안

첫 버전은 한 창, 여러 SourceDocument, **한 개의 대화형 DebugSession**을 지원한다. 문서를 전환해도 세션은 실행 snapshot에 고정된다. 다른 문서 실행은 기존 세션을 정리하는 명시적 전환이다. 테스트 runner는 대화형 세션과 별도 Worker에서 같은 core를 순차 호출하고, 동시에 활성화되는 테스트 VM은 하나로 제한한다. 이는 VM 구현 복제가 아니라 같은 구현의 별도 인스턴스다.

프로젝트가 없는 문서도 모든 편집·실행 기능을 쓸 수 있다. 노트는 우선 앱 관리 저장소에 저장하고 프로젝트로 전환할 때 명시적으로 이관한다. 외부 파일에 대한 자동 실행·자동 덮어쓰기는 없다.

## 6. 첫 연결 시나리오

`fixtures/recurrent_crazy4.mb`를 열고 주소 3을 선택한다. raw `;`, ASCII 59, residue 62, 초기 `p`를 확인한다. `41 42 43 0A`를 공급하고 M[78]의 데이터 쓰기 네 번을 본다. 기대 결과는 출력 `4A` 한 byte, Halt 포함 24명령, A/C/D=`29514/23/80`, M[78]=29514다. Halt에서 Step Back 후 같은 입력으로 replay한다. `.mb` 저장은 Runtime이 아니라 Source를 저장한다. [S3 §15]

이 값은 원문 회귀 기대값이다. 이번 설계 단계에서 실제 VM 또는 설치 앱으로 검증하지 않았다. 확인한 것은 fixture의 논리 길이 87과 제공 SHA-256의 일치뿐이다.

## 7. 완료와 출시의 구분

| 상태 | 의미 |
|---|---|
| DESIGN_REVIEWED_WITH_GAPS | 상세 설계·추적표 작성, 미확정 사항 공개. 현재 상태 |
| A 통과 | core 및 독립 참조 비교 통과. 제품 완료 아님 |
| B 통과 | 실제 Desktop에서 최소 연결 흐름 통과. 제품 완료 아님 |
| C/D 통과 | 전체 작성·디버깅 계약 검증 |
| E_LOCAL 통과 | 지원 Mac의 설치 artifact에서 기능·안전성 검증 |
| E_PUBLIC 통과 | 서명·공증·다른 Mac 설치를 포함한 공개 배포 검증 |

현재 A–E, `.app`, `.dmg`, 코드 서명, 공증, 다른 Mac 설치는 모두 `NOT_RUN`이다. `PASS`는 실제 실행 증거가 있는 개별 검사에만 사용한다. 모든 수용 테스트와 배포 행렬은 [07_TEST_AND_RELEASE.md](07_TEST_AND_RELEASE.md)에 정의한다.

## 8. 기술과 예산 — 기존 설계의 초기 정책

Tauri 2 / React + TypeScript / Monaco / Vite + npm workspaces / TypeScript core / Runtime Web Worker / Rust OS 서비스 구성을 유지한다. [S2 §13]

실행 slice 4,096명령 또는 약 8ms, 연속 UI 알림 최대 20Hz, Run budget 1,000,000명령, history 64MiB, output 1MiB, memory page 64/128셀을 초기값으로 둔다. 이는 측정값이 아니다. 정확한 budget·메모리 회계와 한도 재개 정책은 06번 문서에서 확정한다.

## 9. 주요 제품 위험

`tio-c-safe-v1` 전체 프로필의 loader/fault 원자성은 아직 원문 대조가 필요하다. 의미론 세부 정책을 문서화했다고 참조 호환성이 입증된 것은 아니다. Monaco/Worker/한글 IME/단축키는 실제 WKWebView artifact 검증이 필요하다. 앱의 총 메모리 사용량과 낮은 지연은 도구 선택만으로 보장하지 않는다.

공개 배포 자격 증명은 이번 작업에서 조회하지 않았다. 사용자 프로그램·입력이 trace 및 복구본에 남는 위험을 내보내기/저장 UI에 명시한다.
