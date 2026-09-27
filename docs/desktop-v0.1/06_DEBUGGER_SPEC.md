# 06 — 디버거 실행 전이·역실행·입력 계약

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

기존 근거: [S1 §§6–8, S2 §§9–11, S3 §§8–11]. 상태명과 모든 수치 필드는 [05_DATA_AND_PROTOCOL.md](05_DATA_AND_PROTOCOL.md)를 따른다. 아래 스케줄링·journal·재개 세부 정책은 상세화 제안이며 fault 원자성은 G01 해결 전 미동결이다.

## 1. 생명주기와 정지 이유

phase는 UNLOADED, READY, RUNNING, PAUSED, WAITING_INPUT, HALTED, FAULTED, DISPOSED 중 하나다. `reason`과 `intent`는 별도다. 예를 들어 `PAUSED/BUDGET/NONE`, `WAITING_INPUT/INPUT_EMPTY/STEP`를 구별한다. MachineHead.terminal은 NONE/HALTED/FAULTED이며 scheduler의 Pause를 machine Halt로 취급하지 않는다.

load 중 상태는 UI의 loadPending으로 표시한다. 로드 실패는 이전 세션을 파괴하지 않는다. 첫 로드 실패라면 UNLOADED를 유지한다. 성공한 load는 새 snapshot/session의 READY다.

| 현재 phase | 허용 사용자 조작 | 비활성 조작 |
|---|---|---|
| UNLOADED | 새 문서, 열기, source 편집, load | 모든 실행·memory·history |
| READY | Run, Step, 입력, EOF, breakpoint, Restart, Stop | Back(이력 없음) |
| RUNNING | Pause, Stop, 입력/EOF, breakpoint/watchpoint 변경, 조회 | Step, Back, rewind, branch, Restart |
| PAUSED | Run, Step, Back, Reverse Continue, rewind, 입력/EOF, Restart, Stop | History UI를 보는 동안 실행 조작은 잠금 |
| WAITING_INPUT | 입력, EOF, Pause, Back, Restart, Stop; Run/Step으로 intent 변경 | 원자적으로 실행 중인 명령은 없음 |
| HALTED | Back, Reverse Continue, rewind, 조회, Restart, Stop | Run, Step, 새 입력/EOF |
| FAULTED | Back/rewind, 조회, Restart, Stop | 같은 fault point에서 Run/Step |
| DISPOSED | 새 load/열기 | 폐기한 session 대상 모든 mutation |

WAITING_INPUT에서 Back은 intent를 NONE으로 만든 뒤 실행된 이전 instruction으로 돌아간다. WAITING_INPUT으로 끝난 시도 자체는 instruction으로 되돌릴 대상이 아니다. History 조회 모드에서는 입력 전송도 비활성화하며 live로 돌아가거나 명시적 rewind를 요구한다.

## 2. 정방향 조작의 전이

| 조작·선행조건 | 효과 | 결과 |
|---|---|---|
| Run, READY/PAUSED | intent=RUN, 새 invocation budget 부여 | RUNNING/NONE 또는 즉시 breakpoint/wait/limit |
| Step, READY/PAUSED | intent=STEP, 한 명령 허용 | 완료→PAUSED/STEP_COMPLETE, input 없음→WAITING_INPUT |
| Run, WAITING_INPUT | STEP에서 바꾸면 새 Run budget, 이미 RUN이면 잔여 budget 유지 | 입력 없으면 대기 유지 |
| Step, WAITING_INPUT | intent를 STEP으로 변경 | 입력 없으면 대기 유지 |
| Pause, RUNNING | 다음 instruction 경계에서 intent 해제 | PAUSED/USER_PAUSE |
| Pause, WAITING_INPUT | 기다리던 intent 해제 | PAUSED/USER_PAUSE, machine 상태 불변 |
| Send, 대기 STEP | append 사건 커밋 후 input 명령 한 개 실행 | PAUSED/STEP_COMPLETE 또는 fault/limit |
| Send, 대기 RUN | append 사건 커밋 후 남은 Run budget으로 재개 | RUNNING 또는 다음 정지 이유 |
| Send, PAUSED/READY | append만 수행 | 기존 phase 유지, 실행하지 않음 |
| EOF, 대기 STEP/RUN | close 사건 후 남은 byte 또는 EOF를 해당 intent로 처리 | Step/Run 정책과 동일 |
| Restart(snapshot) | 동일 immutable source, 초기화, 새 sessionId | READY, 이력/tape/output 초기화 |
| Restart(current) | 편집 원문 분석·load 성공 후 기존 세션 대체 | 새 snapshot/session READY |
| Stop 확인 완료 | dispose, buffer/query/intent 폐기 | DISPOSED |

Restart는 초기 실행 설정의 inputHex/closeInput을 **사용자가 선택한 경우에만** 새 tape에 적용한다. implicit 입력 재전송은 하지 않는다. `같은 입력으로 재시작`을 별도 checkbox로 명시한다. 기존 기록을 replay하는 것은 Restart가 아니라 역실행 뒤 Step/Run이다.

Stop UI는 실행 중이면 우선 Pause하여 계산을 멈추고, export가 필요한 경우 export/discard/cancel 선택 후 dispose한다. cancel 시 계산 중이던 세션은 PAUSED로 남고 이미 HALTED/FAULTED인 세션은 해당 terminal 상태를 유지한다. 이는 source dirty 확인과 별개의 trace 보존 절차다. native 창 종료도 이 두 확인을 분리한다.

## 3. command 충돌과 입력 순서

다음 instruction 경계에서 이미 들어온 dispose는 아직 적용되지 않은 실행/입력 요청을 취소한다. Pause는 intent를 해제한 뒤 입력 append를 처리한다. sendInput과 closeInput끼리의 상대 순서는 requestSequence를 유지한다. 순서가 불명확한 중복 request를 추정해서 적용하지 않는다.

Pause와 Send가 경합하면 **어떤 요청이 적용되었는지 ack와 stateVersion**으로 결과를 알린다. Pause가 적용되기 전에 완료된 instruction은 취소하지 않는다. Pause 이후에 받은 byte는 남되 자동 실행하지 않는다. Stop 후 늦게 온 Send는 SESSION_MISMATCH/SESSION_DISPOSED로 실패한다.

input bytes의 범위·총용량·closed 여부를 전체 검증한 뒤 append한다. 일부 byte만 append하고 실패하는 것은 금지한다. 빈 bytes 전송은 no-op 성공이며 event를 추가하지 않는다. closeInput 재호출도 no-op 성공이다.

## 4. budget·output·자원 한도

Run마다 instructionBudget=1,000,000을 기본 부여한다. 이전 Run의 budget 정지 이후 Continue는 새 budget을 부여하지만 lifetime step은 유지한다. 입력 대기로 멈췄다 자동 재개하는 것은 같은 invocation이므로 remaining budget을 유지한다. Step은 별도의 한 명령 허용량이다. host input/fault 사건은 budget을 감소시키지 않는다.

output은 byte 수가 1MiB에 **도달한 committed instruction 직후** PAUSED/OUTPUT_LIMIT로 멈춘다. 다음 byte가 cap을 넘길 예정이면 그 instruction을 커밋하기 전에 멈춘다. 무음 truncate 금지. 재개하려면 cap을 현재 output length보다 높이거나 Restart해야 하며 history/output을 임의 삭제해 capacity를 늘리지 않는다.

history는 encoded buffers 64MiB다. 일관된 earliest checkpoint를 만들고 oldest records를 제거한다. 필요한 baseline/temp를 확보하지 못하면 RESOURCE_LIMIT로 멈추며 명령을 반만 기록하지 않는다. input cap은 1MiB/branch를 추가 제안한다. 한도는 언어의 Halt와 구분한다.

정지 사유 우선순위는 machine Halt/fault → 적용된 사용자 Pause → post-commit watchpoint → output limit → budget → Step 완료다. Halt/fault 직후 도착한 Pause가 terminal 상태를 PAUSED로 덮어쓰면 안 된다. 여러 사유가 겹치면 주사유와 일치한 감시점 목록을 함께 표시하되 명령은 한 번만 커밋한다.

slice는 4,096명령 또는 약 8ms에서 yield하고 연속 UI update는 최대20Hz다. 이는 초기 정책이다. T39에서 실제 Pause 지연과 입력 대기 복귀 지연의 p50/p95/max를 측정한다. instruction 중간의 UI animation을 별도 실행으로 세지 않는다.

## 5. 주소 중단점

주소 중단점은 fetch 전에 검사한다. address는 0..59048이며 Source 밖 generated memory도 동일하다. 같은 줄의 서로 다른 cell에 각각 중단점을 둘 수 있다. 줄만 주어지면 해당 줄 첫 비공백 유효 cell, 열이 있으면 그 cell을 resolve한다. 빈 줄/공백/invalid 위치는 unverified이며 사유를 반환한다.

BREAKPOINT에서 Continue/Step을 선택하면 현재 정지 위치에 대해 **한 번의 fetch 기회만 통과하는 bypass token**을 만든다. token은 session/branch/point/C/breakpointId에 묶는다. 해당 instruction이 실제로 커밋되면 token을 소모한다. input wait로 실행하지 못했을 때는 token을 유지해 입력 공급 후 같은 breakpoint에 갇히지 않게 한다. 이후 같은 주소를 다시 방문하면 중단점을 다시 검사한다. token은 앞선 inputAppend/close 사건으로 eventIndex가 이동해도 동일 pending instruction(C와 registers·memory가 불변)이면 유효하며, 다른 명령까지 허용하지 않는다.

Pause, rewind, Restart, breakpoint 재구성은 bypass token을 무효화한다. 사용자가 명시적으로 Step한 READY/PAUSED의 현재 cell은 한 명령 step 의도에 따라 실행하고 다음 cell에서 breakpoint를 무시하는 권한까지 주지 않는다. 이 정책은 T16으로 시험한다.

Source를 수정해도 현재 snapshot 중단점은 이동하지 않는다. 새 snapshot 생성 시 logical digest와 편집 map으로 연결을 재검토한다. ambiguous insertion/deletion의 주소를 임의로 보정하지 않는다.

## 6. 데이터 감시점

data-read는 j/i의 operand, rotate/crazy의 operand 등 실제 데이터 read다. fetch는 별도 role이며 data-read watch로 잡지 않는다. data-write와 encryption write도 별도다. 여러 role에 걸린 하나의 명령은 **모든 효과를 원자적으로 끝낸 후** PAUSED/WATCHPOINT로 멈춘다.

값이 변하지 않은 write도 실제 write 사건이면 잡는다. 값 변화만 보려는 옵션은 명시적 필터로 별도 제공한다. 복수 감시점이 맞으면 matching IDs를 모두 반환한다. fault 시 attempted write는 정상 watchpoint를 발화하지 않는다. same-cell 두 write는 순서대로 기록하고 각 role 필터가 독립적으로 동작해야 한다.

## 7. 시점과 history 조회

StatePoint=(branchId,eventIndex), row는 사건 이후 상태다. initial root는 eventIndex=0이다. instruction row에는 stepBefore/After와 fetchAddress를 표시하고 input/EOF/fault row는 별도 아이콘을 사용한다.

Timeline 조회는 고정 point의 registers/memory/output/tape cursor/counters/terminal을 복원한 **read-only view**다. live memory나 tape를 되돌리지 않는다. 모든 panel이 동일 point를 가져야 하며 이벤트별로 최신값을 섞지 않는다. 과거의 user Pause 등 scheduler 상태는 machine 역사로 재구성하지 않고 live session status와 별도로 표시한다.

기록이 제거되면 earliestPoint와 그 시점의 누적 step/counters를 표시한다. `이전 기록 없음`은 `이전에 write가 없었다`와 다르다. Explain This Value가 마지막 원인을 찾을 수 없으면 `baseline 이전의 값, 상세 쓰기 기록 없음`이라고 답한다.

## 8. 실제 되돌리기

stepBack은 현재 point 이하의 가장 최근 instruction을 찾고 그 **직전 event point**로 이동한다. 뒤에 inputAppend/inputClose/fault 사건이 있으면 그 사건들도 역순으로 취소한다. 바로 직전이 Halt instruction이면 terminal flag를 되돌려 실행 가능한 상태가 된다. 이전 instruction이 없으면 HISTORY_BOUNDARY, state 무변화다.

rewindTo는 지정 event 이후로 정확히 되돌린다. 둘 모두 intent=NONE, phase=PAUSED, reason=REWOUND로 정리하되 target의 machine terminal이 HALTED/FAULTED라면 해당 terminal phase를 유지한다. Worker crash로 상태가 유실된 경우에는 역실행 가능성을 약속하지 않는다.

undo 순서:

```text
각 journal event를 newest→oldest로 처리
 instruction:
   writes를 역순으로 복원
   register/head·tape cursor·EOF count·output length 복원
   deterministic role/opcode counters 복원
 inputAppend: visibleLength와 해당 tape tail 복원
 inputClose: closedBefore 복원
 fault: terminalBefore와 diagnostic 상태 복원
 마지막 target point에서 일관된 summary publish
```

물리적으로 보존한 future tape bytes는 undo 이후 VM에 visible하지 않다. buffer에 남아 있다는 이유로 input instruction이 먼저 소비하면 안 된다. wall-clock·UI latency 같은 성능 로그는 machine state가 아니므로 되돌리는 cumulative execution counters와 분리한다.

## 9. 같은 입력 replay

undo는 future journal을 지우지 않는다. cursor<tail 상태에서 Step/Run은 replay mode다. 다음 instruction 전에 기록되어 있던 inputAppend/inputClose 사건을 **원래 순서와 위치**에서 재적용한다. 새로운 사용자 입력 전송을 요구하거나 기존 tape를 한꺼번에 open해 미래 입력을 먼저 보여주지 않는다.

instruction은 같은 core로 다시 실행하고 recorded transaction의 registers/ordered writes/I/O/counters와 비교한다. 일치하면 같은 eventIndex의 검증된 상태로 진행한다. mismatch면 PAUSED/REPLAY_DIVERGED/intent=NONE으로 중단하고 마지막 확인된 point를 보존한다. 불일치한 시도의 machine 효과는 커밋하지 않는다. 같은 replay를 다시 강행하지 않고 이전 point 조회·trace 내보내기·Restart를 제공한다. old journal을 새 결과로 몰래 교체하지 않는다. Step은 host 사건을 필요한 만큼 통과하되 committed instruction은 하나만 수행한다.

tail에 도달한 뒤에는 정상 forward 실행으로 전환한다. replay 중 breakpoint/watchpoint도 현재 설정으로 적용하되 기록된 machine 결과 자체를 바꾸지 않는다. reverse/forward navigation에 의해 eventIndex가 바뀌어도 stateVersion은 증가한다.

## 10. 다른 입력 branch

cursor<tail에서 sendInput/closeInput은 BRANCH_REQUIRED다. history를 replay할지 새 branch를 만들지 사용자가 고른다. 새 branch 절차는 다음과 같다.

1. machine terminal=NONE인 PAUSED 상태에서 기준 point와 소비된 input prefix를 보여준다. Halt/fault 이후 point에서는 먼저 그 이전의 실행 가능한 point로 되돌아가야 한다.
2. parent trace의 내보내기 범위/source/input 포함 및 replay 가능성을 확인한다.
3. native 저장 완료 receipt를 확인한다. cancel/error이면 parent 유지.
4. 기준 상태를 기록 기반으로 복제하여 새 branchId와 root eventIndex=0을 만든다. parent point 연결을 남긴다.
5. 이미 소비된 prefix는 유지하고, 아직 읽지 않은 suffix와 closed 상태만 명시적으로 교체한다.
6. READY가 아닌 해당 restored state의 PAUSED로 시작한다. 자동 Run하지 않는다.

branch root의 step은 parent에서 이어받은 cumulative committed count이며 0으로 위조하지 않는다. eventIndex만 branch-local 0이다. 새 suffix는 이후 실제 `/`가 소비한다. register/memory 수정은 없으며 부모 기록에서 얻은 state 복원은 임의 주입과 구분한다. parent future는 export 성공 후 활성 메모리에서 해제할 수 있다.

input prefix가 이미 소비되었다면 그 값을 바꾸려면 소비 이전 point로 더 돌아가야 한다. 없어진 history 이전으로 거슬러 바꾸는 것은 허용하지 않고 원문에서 Restart하도록 한다.

## 11. Reverse Continue

현재 위치에서 적어도 한 개의 완료 instruction을 역행한 뒤 이전 정지 후보를 탐색한다. 주소 중단점 후보는 기록된 instruction의 before point와 fetchAddress, 감시점 후보는 해당 transaction의 after point와 matching access다. 현재와 같은 point를 반환하지 않는다.

가장 가까운 이전 후보에 멈추고 현재 설정 기준 BREAKPOINT/WATCHPOINT를 표시한다. 후보가 없으면 earliestPoint에서 HISTORY_BOUNDARY로 멈춘다. 중간 input/EOF 사건은 point에 맞춰 함께 복원한다. 제거된 기록을 넘어 탐색하거나 예상 실행 경로로 보충하지 않는다. pending long reverse query도 Pause/Stop/cancel을 처리할 수 있도록 분할한다.

## 12. 실패의 표현과 실행 증거

LOAD_*는 소스 로딩 오류다. STALLED_INVALID_FETCH/REFERENCE_UNDEFINED는 machine safe-stop 진단이다. WORKER_CRASH는 엔진 장애다. HISTORY_EXPIRED는 조회 범위 문제, REPLAY_DIVERGED는 재현 불일치다. 서로를 Halt나 generic success로 표시하지 않는다.

시뮬레이션된 lesson 기대값이나 하드코딩된 UI 결과로 PASS를 만들지 않는다. 실제 fixture의 Step/Run/Back/replay 테스트는 T12/T18/T34, 상태 경합은 T14/T22/T23에서 별도로 입증한다. 이번 작업에서 이 검증은 모두 NOT_RUN이다.
