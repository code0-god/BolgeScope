# 02 — 화면·상호작용·학습 명세

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

근거: [S1 §§2–9, S2 §§4–12, S3 §§3–12]. 여기의 치수, 포커스, 세부 문구, 학습 판정 계약은 **상세화 제안**이다. 상태·시간점 정의는 [05_DATA_AND_PROTOCOL.md](05_DATA_AND_PROTOCOL.md), 실행 동작은 [06_DEBUGGER_SPEC.md](06_DEBUGGER_SPEC.md)를 따른다. 그림의 값은 회귀 기대값/설명 예시이지 실행 결과가 아니다.

## 1. 공통 레이아웃

설계 기준은 1440×900 CSS px다. 상단 toolbar 48, status bar 26, 탐색기 192, Inspector 300, 하단 패널 250을 기본값으로 제안한다. 중앙 편집기는 남은 폭을 사용하며 panel splitter로 조절한다. 패널 최소폭은 탐색기 160, Inspector 264, 중앙 360이다. 창이 좁아지면 탐색기 → Inspector 순으로 접고 toolbar·현재 상태·입력 대기 안내는 남긴다. 900px 미만은 중앙과 하단을 한 번에 하나씩 보는 compact 배치다. 이 수치는 OS 최소 요구 사양이 아니다.

작성/실행/학습 전환은 동일한 문서와 세션의 패널 배치만 바꾼다. source를 복제하거나 VM을 재시작하지 않는다. 사용자가 마지막으로 조절한 배치를 작업공간별 로컬 설정에 저장한다.

본문 13px system-ui, 표 숫자와 코드 14px ui-monospace/SFMono-Regular/Menlo 계열을 제안한다. 별도 폰트 다운로드는 없다. 표 숫자는 tabular-nums를 사용하고 0/O, 1/l 구분과 한글 fallback을 설치본에서 확인한다. 4px 간격 단위, 기본 padding 12, 핵심 조작 target 32px 이상을 제안한다. 시스템 light/dark와 고대비를 지원한다. 경고·위치는 색만 쓰지 않고 `C`, `D`, `Δ`, `!`, 텍스트를 함께 표시한다. 명령 팔레트는 모든 명령을 글자와 이름으로 표시한다.

## 2. 여섯 장면의 와이어프레임

### A. Raw 작성

```text
BolgeScope  recurrent_crazy4.mb ●     [작성] 실행 학습    Run Step Back
파일/예제   ┌ Source(Raw) │ Initial │ Runtime │ Diff ┐  선택 주소 #3
            │ ('s;                                   │  raw ; / ASCII 59
            │                                        │  (59+3) mod 94 = 62
            │ @?>=<;:                                │  Initial p / Crazy
            ├ Address Lens ──────────────────────────┤  [초기 명령 교체]
            │ 주소     0   1   2    3                 │  노트: 사용자 설명
            │ 문자     (   '   s    ;                 │  [노트 편집]
            │ 초기     j   j   /    p                 │
            └────────────────────────────────────────┘
[I/O] Timeline Memory Problems Tests
#3 · 1행 4열 · 87 cells · Source rev 12 · READY
```

`●`는 저장되지 않은 변경이다. 선택 주소는 C/D와 독립적이다. 본문의 source 행·열은 표시된 문서의 source map에서 계산한다. Lens의 복사는 표 복사 전용 명령이며 Source 복사와 섞이지 않는다.

### B. Normalized와 생성 Raw 비교

```text
main.nmal ●                         [Normalized] [생성 Raw 보기]
편집 원본                       읽기 전용 생성물
j                               (
j                               '
/                               s
p                               ;
주소 #3  p → residue 62 → raw 59 ;
[.nmal 저장] [Raw 내보내기] [Raw 프로그램으로 분리]
주의: 초기 명령을 인코딩합니다. 전체 실행 의미를 보존하지 않습니다.
```

원본 editor가 유일한 editable model이다. 잘못된 normalized 문자가 있으면 생성 preview를 `이전 revision의 결과`로 표시하고 실행/Raw export를 비활성화한다. invalid 문자를 몰래 삭제하지 않는다. 분리하면 새 Raw documentId가 생성되고 기존 `.nmal`은 그대로 남는다. 같은 경로로 덮어쓰기에는 별도 파일 충돌 확인이 필요하다.

### C. 단일 명령 실행 직후

```text
실행 snapshot S1 · step 4 · PAUSED / STEP_COMPLETE
┌ Source snapshot ───┐ ┌ Registers ───┐ ┌ Step Inspector ─────────────┐
│ ('s;               │ │ A 29487     │ │ fetch #3 ; → p              │
│ Source는 불변      │ │ C 4         │ │ data M[78] 84 → 29487        │
│ 다음 C = 4         │ │ D 79        │ │ encryption M[3] 59 → 92      │
└────────────────────┘ └─────────────┘ │ increment C3→4 / D78→79     │
                                      └──────────────────────────────┘
```

이 시점의 기대값은 `A=29487, C=4, D=79`다. 최종 기대값과 현재 상태를 섞지 않고 실제 VM의 해당 transaction에서 값을 가져온다. 네 단계 애니메이션은 하나의 transaction 설명이며 네 번 실행하지 않는다.

### D. 입력 대기

```text
WAITING_INPUT · step 2 · 대기 명령 #2 / · 실행 의도 STEP
이 명령은 아직 실행되지 않았습니다. A/C/D와 memory는 그대로입니다.
입력 [Text v] [ABC                    ]  LF 추가 [ ]
전송 byte 미리보기: 41 42 43 (3 bytes)
[Send] [Send EOF] [Pause: 자동 재개 취소]
입력을 받으면 이 명령 한 개를 끝내고 멈춥니다.
```

RUN 의도로 기다렸다면 마지막 문장은 `입력을 받으면 계속 실행합니다`다. Pause 이후 Send는 tape만 변경하고 실행하지 않는다. LF는 사용자가 체크한 경우에만 추가한다. EOF 전에 남은 byte는 먼저 소비한다.

### E. 과거 기록 조회

```text
[History] event 17 / step 12       live event 30 / step 24 · HALTED
[현재로 돌아가기] [이 시점으로 되돌리기]
Registers / Memory / Selected Cell / 출력 / Step Inspector: event 17
Source: 동일 ProgramSnapshot S1, 편집 불가
Run·Step·입력 전송: 비활성, live로 돌아가거나 명시적으로 되돌려야 함
```

행 선택은 VM과 입력 tape를 변경하지 않는다. live가 계속 실행 중이어도 과거 조회는 고정된 point를 사용한다. 조회 대상이 eviction되면 모든 과거 패널을 함께 `기록 범위 만료`로 전환하고 live 또는 earliestPoint로 이동하는 선택을 제공한다. 과거 데이터 일부만 live로 바꾸지 않는다.

### F. Source/snapshot 불일치

```text
현재 Source revision 15 ≠ 실행 snapshot revision 12
[실행 스냅샷 보기] [현재 원문으로 재시작]
Source tab: 편집 가능, 현재 C 화살표는 표시하지 않음
Snapshot tab: 읽기 전용, 현재 C/D와 execution decorations 표시
Run tooltip: revision 12의 실행을 계속합니다.
```

불일치는 revision 차이와 logical digest 차이를 각각 표시한다. 공백만 수정해 logical digest가 같아도 source map은 달라질 수 있으므로 예전 map으로 화살표를 그리지 않는다. 재시작은 새 sessionId를 만들고 기존 세션 정리가 끝난 뒤 READY로 전환한다.

## 3. 시작 화면과 패널별 계약

| 화면 | 기본/빈 상태 | 로딩/오류 | 선택·버튼·포커스 |
|---|---|---|---|
| 시작 | 새 Raw, 새 Normalized, 파일 열기, 예제 열기 | 권한 거부·없는 파일을 구별 | 자동 실행 없음. 열기 후 editor로 포커스 |
| 탐색기 | 열린 문서, 프로젝트 트리, 예제, 북마크, 학습 | 트리 실패 시 현재 문서 유지 | 문서 선택은 실행 전환 아님. 예제는 bundled 원본을 덮어쓰지 않음 |
| Source | 실제 원문·dirty·revision | 분석 중도 입력 가능, 이전 진단에 revision 표시 | 유효 분석이 없으면 Run/replace/export 비활성 |
| Initial | snapshot 초기 해독 | 미로딩이면 `실행 snapshot을 로드하세요` | 읽기 전용, 계산 실패를 0/NOP로 표시하지 않음 |
| Runtime | 현재 C 주변 128셀 | query 실패 시 기존 값에 stale badge, 재조회 | live memory를 편집 텍스트로 변환하지 않음 |
| Diff | Initial 대 선택 시점의 address/value 차이 | 비교점 미선택 안내 | source text diff와 memory diff를 별도 이름으로 구분 |
| Address Lens | 선택 셀 주변 24셀 | 공백 위치는 `셀 없음` | 셀 클릭→selectedAddress, editor reveal. 생성 주소면 memory로 이동 |
| Selected Cell | 주소/기원/raw/ASCII/초기 decode/현재 값/trits | runtime이 없으면 Initial만 표시 | C/D 자동 추적 옵션과 사용자 선택 고정 옵션 분리 |
| Step Inspector | 마지막 선택 transaction | step=0이면 아직 명령 없음 | 사건 클릭→같은 eventIndex. attempted/fault 효과는 별도 표시 |
| I/O | Text 입력, LF 꺼짐, Text/Escaped/Hex 출력 | 잘못된 hex는 byte 위치로 오류 | Send/EOF 후 입력 focus 유지. ESC가 입력 byte를 만들지 않음 |
| Memory | 243×243 개요+128셀 표 | 범위 오류·기록 만료 표시 | 클릭 주소=row*243+column, 키보드 주소 이동 제공 |
| Cell History | 선택 주소의 관찰 사건 | 기록 제거는 `이전 상세 없음` | 마지막 쓰기 설명에 origin=observed를 표시 |
| Cycle | 이론 주기와 실제 방문 별도 탭 | 비printable이면 theoretical 변환 불가 | 이론 cycle 방문을 실측 방문 횟수에 더하지 않음 |
| Timeline | 최근 사건 200개 page, step/event 열 분리 | 더 보기/만료/재조회 | 행 선택은 read-only; rewind 버튼만 live 변경 |
| Problems | 오류 수, 행·열·주소·메시지 | source revision이 달라지면 outdated | 항목 클릭은 정확한 모델 revision 확인 후 이동 |
| Tests | 테스트 목록, NOT_RUN | running/cancelled/failed를 별도 표시 | 실행 중 취소 가능. 실패 diff는 byte 단위 |
| 학습 | 설명·질문·힌트·실행 버튼 | 초기 fixture 미검증이면 사용 불가 | 채점은 실제 transaction으로, 사용자 입력을 eval하지 않음 |

역방향 선택은 무한 callback을 막도록 selectionOrigin을 전달한다. Editor caret→Lens→Memory 갱신이 다시 caret 이벤트를 만드는 경우 같은 selectionVersion이면 무시한다. 생성 메모리를 선택해도 Source에 가짜 행을 만들지 않는다.

## 4. 작성 세부 동작

### 4.1 언어 설정

Raw 언어는 comments/brackets/autoClosingPairs/surroundingPairs를 비워 두고 자동 quote·괄호·formatOnPaste·formatOnType·최종 LF 자동 추가를 끈다. 일반 사용자 소스의 `{`, `#`, `;`, 따옴표는 주석/문자열 기호가 아니다. 선택한 언어 설정만 바꾸고 JSON 등 다른 문서는 영향받지 않는다.

전체 문서의 논리 주소를 계산한 semantic tokens로 초기 opcode를 표현한다. 주소 위치와 문서 revision을 함께 cache한다. fallback tokenizer는 문자 전체를 중립 token으로 취급하며, 위치와 무관한 정규식으로 Malbolge 명령을 결정하지 않는다. Monaco 통합 자료 [W5]를 참고하되, semantic token provider의 정확한 API signature와 테마 대비는 설치한 버전에서 확인한다.

### 4.2 교체와 영향 미리보기

명령 팔레트는 `Input /`, `Output <`, `Crazy p`, `Rotate *`, `Move D j`, `Jump C i`, `Halt v`, `NOP o`를 보여준다. 선택하면 현재 raw·ASCII·초기 opcode·이론 치환 cycle과 교체 후 값을 비교한다. 적용 시 한 번의 editor undo 단위로 해당 문자를 교체한다. 이전 revision/caret가 변했으면 적용을 취소하고 다시 preview한다.

직접 타이핑에는 모달을 띄우지 않는다. 공백 변경은 상태줄에서 논리 source 동일 여부를, replacement는 변화 셀 수를, insertion/deletion은 뒤쪽 주소/해독 영향과 연결 재검토 수를 보여준다. `초기 명령 재인코딩`은 별도 명령에서 범위·기존/새 주소·raw 변화와 한계 경고를 확인하고 적용한다. invalid 초기 opcode를 억지로 재인코딩하지 않는다.

### 4.3 노트와 중단점의 연결

노트는 사용자 설명으로 표시하고 VM 관찰과 다른 아이콘을 사용한다. 주소 범위는 내부적으로 half-open `[start,end)`이며 UI는 `0..1`처럼 inclusive로 표시한다. 기존 `[0,2)`는 UI `0..1`이다.

허용 공백만 바뀌면 logical source digest가 같으므로 주소 연결을 유지한다. 길이가 같고 대응이 분명한 교체는 주소를 유지하되 내용 변경 badge를 붙인다. 비공백 삽입·삭제나 모호한 다중 편집은 자동 이동하지 않고 연결 재검토 상태로 둔다. 현재 snapshot의 중단점은 그대로 남고 새 snapshot에 복사할 때 확인을 요구한다.

## 5. 키보드와 접근성 — 상세화 제안

| 동작 | 기본 단축키/접근 |
|---|---|
| 열기·저장·다른 이름 | Cmd+O / Cmd+S / Cmd+Shift+S |
| Run/Continue | Cmd+Enter |
| Step | Cmd+Shift+Enter |
| Pause | Cmd+. |
| Step Back | Cmd+Option+Left |
| Restart·Reverse Continue·Stop | 메뉴와 command palette에서 제공, 첫 버전 기본 조합 미지정 |
| Address로 이동 | Cmd+G, 행 이동은 editor 자체 명령과 구별 |
| 패널 포커스 순환 | F6 / Shift+F6 |
| 편집 undo | Cmd+Z; VM Back과 절대 통합하지 않음 |

단축키는 앱 포커스가 있을 때만 등록한다. 한국어 IME composition 중에는 editor command를 가로채지 않는다. Escape는 popover 닫기/키보드 trap 탈출이지 Stop/입력 전송이 아니다. Tab capture는 editor 설정에서 전환 가능해야 한다. 포커스가 있던 panel을 접으면 toolbar의 해당 panel toggle로 이동시킨다.

VoiceOver에 주소·명령명·이전/현재값을 읽을 수 있는 텍스트 표를 제공한다. Canvas 개요는 같은 주소 표로 모든 기능에 접근할 수 있어야 한다. 상태 알림은 paused/wait/fault 등 중요 전이에서만 읽고 20Hz 숫자 변화를 매번 announce하지 않는다. reduced-motion에서는 단계 애니메이션을 끈다. 대비와 200% 확대는 테스트 항목이며 검증 전 충족을 보장하지 않는다.

## 6. 여섯 학습 계약

모든 학습은 번들 fixture의 읽기 전용 원본에서 작업 사본을 연다. 사용자가 수정했다면 채점 전 snapshot digest 차이를 알려준다. canonical lesson fixture가 아니라면 예상 답을 강제로 맞추지 않고 `현재 코드로 실험` 상태로 전환한다. **초기 5개 주제는 회귀 fixture를 실제로 실행해 목표 지점까지 도달한다. 레지스터 주입으로 시작 상태를 만들지 않는다.**

| ID/목표 | 초기 프로그램·입력·도달점 | 질문·판정 | 힌트·실패·재시작 |
|---|---|---|---|
| L01 주소와 문자 | recurrent_crazy4, 실행 전, 입력 없음 | #2와 #19의 raw s의 초기 명령을 각각 `/`, `j`로 답하는지 codec으로 비교 | residue 계산 표시. 문자만 보고 답하면 주소도 보라는 설명. 처음 source 선택으로 복귀 |
| L02 입력/EOF | recurrent_crazy4를 #2까지 Step, tape open/empty | 빈 큐에서 Step 시 A/C/D/memory 불변과 WAITING_INPUT을 예측. 다음 별도 시도에서 `41`, `410A`, EOF를 구분 | LF checkbox와 byte preview. EOF=Halt라고 답하면 실제 `/` 후 상태를 비교. 매 시도 새 세션 |
| L03 포인터 | recurrent_crazy4, step 0 | 첫 j의 D 효과와 post-increment D=41/C=1을 실제 transaction과 비교 | M[D] 조회 후 자동 증가를 분리. 원문 char ASCII만 추측하지 않게 설명. Back 또는 Restart |
| L04 crazy | recurrent_crazy4, `41`, 실제 #3 직전 | **데이터 쓰기** 주소와 값 예측: #78, 29487. 별도 질문에서 치환 주소 #3 구별 | A=65, M[78]=84 및 trit 표. #3만 답하면 치환과 data write 혼동 설명. Step Back |
| L05 명령 변환 | L04와 같은 실행 | transaction의 M[3] 59→92와 다음 decode를 codec으로 비교. source `;`는 불변인지 확인 | operation과 encryption을 분리. runtime을 source로 오인하면 네 상태 표 표시. Back |
| L06 재방문 | **새로 검증할 revisit fixture**, 고정 입력/tape, 첫 repeated fetch 직전 | 실제 첫 방문과 재방문의 raw/decoded 차이 예측, 두 관찰 사건으로 판정 | cycle은 미래 보장 아님. 입력·memory injection 없음. 검증 fixture 확보 전 lesson은 unavailable/NOT_RUN |

L06을 4-step 회귀 fixture로 통과시킨다고 주장하지 않는다. 4-step fixture는 동일 셀 네 번 갱신이지 무한 루프·유용한 장기기억의 증명이 아니다. 재방문용 fixture 확보는 A6 및 E2의 명시적 수용 작업이다.

## 7. 저장·branch·종료의 확인 UI

dirty 문서 교체/종료는 Save/Discard/Cancel을 제공한다. Save가 실패하면 창을 닫지 않고 원문을 보존한다. 외부 변경이 검출되면 Reload/내 편집을 다른 이름으로 저장/비교를 제공하며 자동 overwrite하지 않는다.

과거에서 새 입력을 만들 때는 현재까지의 trace 내보내기 범위와 source/input 포함 여부를 먼저 확인한다. 내보내기가 성공한 뒤 consumed prefix를 유지한 새 branchId로 미소비 suffix를 바꾼다. 취소·저장 실패는 기존 branch를 유지한다. 입력·상태 상세를 제외한 내보내기는 replay 불가 경고가 필요하다. 일부 필드를 제외해도 민감 정보가 완전히 제거되는 것은 아니다.

Stop 버튼은 메모리·이력 폐기 범위를 표시한다. unsaved trace가 있는 경우 export/discard/cancel을 선택할 수 있게 하되, Pause 요청은 즉시 보내고 다음 명령 경계에서 계산을 멈춘다. 원문 저장 여부와 trace 저장 여부를 하나의 dirty flag로 섞지 않는다.
