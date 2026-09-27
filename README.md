# BolgeScope Desktop

**Write. Decode. Mutate. Debug Malbolge.**

실제 10-trit Malbolge 프로그램을 작성하고, 주소별 해독·레지스터·메모리·자기변형·실행 이력을 관찰하는 로컬 데스크톱 IDE입니다. Tauri 2, React/TypeScript, Monaco를 사용하며 실제 실행은 Web Worker 안의 단일 TypeScript VM이 담당합니다. Rust는 파일 대화상자, 승인된 파일 접근, 저장과 복구만 담당합니다.

현재 배포 등급은 **로컬 개발 프리뷰 0.1.0**입니다. 원래 설계의 모든 수용 항목 또는 공개 배포 심사가 완료되었다는 의미는 아닙니다. 실제 실행 결과와 남은 검증은 `evidence/current/`의 최신 보고서를 확인하세요. 이전 `docs/desktop-v0.1`은 설계 기록이며 당시의 NOT_RUN 표시는 해당 설계 시점의 상태입니다.

## 맥북에서 실행

`bash scripts/package-macos.sh`를 실행하면 빌드 산출물이 `release/` 아래에 생성됩니다. 최신 결과의 정확한 위치는 `release/latest-build.json`에 기록됩니다.

```bash
cd ~/Projects/BolgeScope
open "$(python3 -c 'import json; print(json.load(open("release/latest-build.json"))["app"])')"
```

`.app`은 더블클릭으로 실행합니다. `.dmg`를 사용할 때는 앱을 Applications로 끌어 옮겨 설치합니다. ZIP도 앱 번들을 포함합니다. 기본 기능은 로그인·API 키·서버·인터넷 연결 없이 사용합니다. 로컬 ad-hoc 서명과 Apple Developer ID 서명/공증은 다른 절차입니다. 이 프리뷰를 공증된 공개 배포판으로 간주하지 마세요.

## 첫 실행: 87셀 예제

탐색기의 **회귀 예제 열기**를 누른 뒤 **실행**을 누릅니다. 입력 대기가 되면 I/O 형식을 Hex로 바꾸어 `41 42 43 0A`를 전송합니다. 출력 형식을 hex로 선택하면 `4A` 한 바이트를 확인할 수 있습니다. 최종 레지스터는 A=29514, C=23, D=80, 명령 수는 Halt 포함 24입니다.

주소 3에 중단점을 설정하면 `p` 실행 직전 A=65, C=3, D=78에서 정지합니다. Step Inspector에서 데이터 쓰기와 명령 치환을 구분하고, Memory에서 주소 78을 확인하세요. 정상 예제의 데이터 쓰기는 `84 → 29487 → 29485 → 29484 → 29514`입니다. 이 값들은 UI 상수가 아니라 VM 실행 결과이며 독립 C 인터프리터와 대조합니다.

Halt 뒤 Back은 종료 명령을 되돌립니다. 한 번 더 Back하면 출력도 되돌릴 수 있습니다. Step으로 같은 입력을 재생하면 같은 결과가 나옵니다. Timeline 행 선택은 읽기 전용 조회이며, 실제 VM 이동은 **이 시점으로 되돌리기**로 구분합니다.

## 작성과 실행의 구분

- **Source**만 편집 가능합니다. Initial/Runtime/History는 별도 보기입니다. 자기변형으로 원문 파일을 바꾸지 않습니다.
- `.mb/.mal`은 Raw, `.nmal`은 `j i * p < / v o`와 ASCII 공백만 쓰는 보조 작성 형식입니다. 생성 Raw를 편집하려면 별도 Raw 문서로 분리합니다.
- Address Lens와 Hover는 같은 codec을 사용합니다. 명령 교체는 현재 주소에 맞는 실제 문자를 생성합니다. 초기 명령 재인코딩은 전체 실행 의미 보존이 아닙니다.
- 입력은 byte tape입니다. LF는 체크한 경우에만 추가하고, EOF는 별도 버튼으로 보냅니다. Step 중 입력 대기는 입력을 받으면 한 명령만 완료합니다.
- 중단점은 주소 기준, 감시점은 data-read/data-write/encryption별로 구별합니다. 코드와 데이터는 같은 메모리입니다.
- 노트·별칭은 원문 밖에 보존합니다. 논리 소스 변경으로 주소 연결이 달라질 수 있으면 재검토해야 합니다.

## 프로젝트·테스트·학습

파일 하나만 열어 사용해도 됩니다. Tests 탭의 프로젝트 폴더 선택으로 프로젝트를 열거나 현재 문서로 생성할 수 있습니다. 프로젝트는 `project.bolgeproj.json`, `programs/`, `.bolge/notes.json`, `tests/*.btest.json` 등 상대경로를 사용합니다. `.nmal`의 Raw 출력은 명시적인 내보내기를 사용합니다.

Tests는 대화형 VM과 분리된 Worker에서 실행합니다. 기대 출력은 문자열 모양이 아닌 정확한 byte로 비교합니다. 현재 실행 결과로 테스트를 생성할 때는 입력 Hex·EOF·한도를 함께 확인하세요. Trace는 JSONL과 무결성 footer를 사용합니다. **입력을 제외해도 레지스터·메모리·출력으로 입력 내용이 드러날 수 있습니다.** 내보내기 전 포함 범위를 확인하세요.

학습에는 주소, 입력/EOF, 포인터, crazy, 치환, 재방문 여섯 주제가 있습니다. 예측 후 실제 Step으로 확인하며 임의로 VM 상태를 주입하지 않습니다. 4회 상태 갱신 예제는 무한 루프나 장기기억의 증명이 아닙니다.

## 소스에서 개발·검증

현재 개발 맥에서 확인한 도구는 Node 26.7.0, npm 12.0.2, Rust/Cargo 1.94.0, Xcode 개발 도구입니다. 정확한 JavaScript/Rust 의존성은 두 lockfile에 기록되어 있습니다.

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run tauri:dev
```

`npm run dev`는 브라우저 미리보기이며 macOS 파일 대화상자를 대신하지 않습니다.

```bash
# 공개 배포 자격 증명 없이 로컬 .app, ZIP, DMG 생성
bash scripts/package-macos.sh

# 독립 검증: codec, 실제 C와의 상태/메모리/쓰기 비교 등
node evidence/supervisor/check_codec.mjs
node evidence/supervisor/check_machine.mjs
node evidence/supervisor/check_debugger.mjs

# Rust 경계 및 정적 검사
cd apps/desktop/src-tauri
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
```

macOS Acceptance 빌드는 `tests/e2e/tauri.acceptance.conf.json`과 Cargo의 `e2e-webdriver` feature를 명시적으로 사용하는 테스트 전용 앱입니다. 일반 패키징 스크립트는 이 feature를 사용하지 않습니다. 테스트 HTTP listener를 배포 앱에 넣지 마세요.

## 실행 계약과 한계

이 구현의 프로필은 **`bolgescope-tio-safe-v1`**입니다. 제공되지 않은 기존 `tio-c-safe-v1`의 모든 경계 정책과 동일하다고 주장하지 않기 위해 별도 식별자를 사용합니다. `packages/core/profile-v1.json`과 codec의 SHA-256으로 계약을 고정했습니다. 정상 원본 C 실행을 따르며 invalid fetch는 stall 진단, 미정의 접근은 staged effect 롤백 후 진단으로 멈춥니다. 치환 시 C 문자열의 정의된 127→NUL 경계도 구분합니다.

실행 slice는 최대 4,096명령/약 8ms, 연속 상태 알림은 최대 20Hz, Run 기본 한도는 100만 명령입니다. 입력과 출력은 기본 1MiB입니다. 소스는 IDE 파일 한도 2MiB, 언어 메모리 한도는 59,049셀입니다. History는 JSON 직렬화 크기로 계수한 제한을 사용하며 앱 전체 RSS 또는 JavaScript 객체 heap의 64MiB 보장이 아닙니다. 이력 제거 후 남은 범위만 조회·되돌릴 수 있습니다.

외부 동시 수정은 해시 재검사로 탐지하고 create-only 저장은 경쟁 생성물을 덮어쓰지 않습니다. 기존 파일 교체에서 마지막 검사와 rename 사이의 모든 외부 프로세스 경쟁을 완전히 제거하는 compare-and-swap 보장은 아닙니다. 완전한 한국어 IME/VoiceOver 감사, 다른 Mac 및 구형 macOS 검증, Developer ID 서명과 공증은 별도 출시 검증입니다.
