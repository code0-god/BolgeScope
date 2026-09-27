# 04 — 실행 의미론·안전 경계 계약

버전 0.1 · 2026-09-27 · DESIGN_REVIEWED_WITH_GAPS

**요청된 profile 식별자: `tio-c-safe-v1`. 전체 legacy profile과의 동일성은 아직 확인되지 않았다.** 아래는 제공 문서에서 확정된 불변조건, 직접 읽은 C 참조의 동작, 새 안전 정책 제안을 분리한 계약이다. profile의 `contractStatus=pending`을 유지하며 G01을 해결하기 전 해당 이름의 완전한 호환성을 광고하거나 release gate를 통과시키지 않는다.

## 1. 근거와 검증 범위

기존 설계: [S1 §12, S2 §9, S3 §8]. 공개 참조: [W1] TryItOnline의 `malbolge.c`와 Olmstead interpreter 보존본. 확인일은 2026-09-27이다. Workspace에서 실제 받은 원본은 4,738 bytes, SHA-256:

```text
fe29a717f9f684d6cc81d5c63273d446d9c65fec73e62164538514d5737b07a6
```

원본 C는 public domain 선언을 포함한다. 이번에는 소스를 읽었으며 컴파일·실행·차등 검증하지 않았다. 실행 시 사용될 원본은 이 digest로 고정하고 다운로드할 때 mismatch면 중지한다. 플랫폼 이식 patch와 관측 patch는 원본에서 분리하고 각각 hash를 남긴다.

## 2. 제공 문서에서 계승한 불변조건

- 입력이 없으면 대기한다. input 명령의 register/memory/치환/증가를 먼저 수행하지 않는다.
- 명령 효과 **이후 C**의 셀이 치환 대상이다. jump의 fetch 주소와 같다고 가정하지 않는다.
- Halt에는 치환과 C/D 증가가 없다.
- 하나의 명령이 같은 주소에 여러 번 쓰면 순서를 보존한다.
- 참조의 stall·미정의 접근을 NOP 또는 Halt로 위장하지 않는다.
- Source, Initial, Runtime, History는 분리하며 실행은 Source를 수정하지 않는다.

이 목록만으로 BOM·비ASCII·짧은 입력·fault rollback 등 전체 프로필이 정해졌다고 보지 않는다.

## 3. C 원문에서 확인한 정상 실행 경로

메모리는 59,049개 cell이다. 정상 machine word는 0..59048이고 초기 A/C/D는 0이다. loaded prefix 이후 `M[i] = op(M[i-1], M[i-2])`로 채운다. `op(x,y)`의 table row는 y, column은 x다. [W1]

C fetch는 `33 <= M[C] <= 126`일 때만 decode로 진행한다. 그렇지 않으면 원본 루프는 state 변경 없이 continue한다. 그래픽 ASCII의 decoded symbol은 다음 식이다.

```text
index   = mod(M[C] - 33 + C, 94)
symbol  = xlat1[index]
residue = mod(M[C] + C, 94)
index   = mod(residue - 33, 94)
mod(n,94)는 0..93의 값을 반환한다.
```

residue와 xlat1 index는 33만큼 차이 나는 서로 다른 좌표다. residue를 xlat1에 그대로 index로 넣지 않는다.

| residue | decoded symbol | 명령 효과 |
|---:|:---:|---|
| 4 | i | C ← M[D] |
| 5 | < | output에 A의 byte 표현을 보냄 |
| 23 | / | A ← 다음 입력 byte, 실제 EOF이면 59048 |
| 39 | * | A와 M[D] ← floor(M[D]/3)+(M[D] mod 3)×19683 |
| 40 | j | D ← M[D] |
| 62 | p | A와 M[D] ← op(A,M[D]) |
| 68 | o | operation 효과 없음 |
| 81 | v | Halt, 치환·증가 없음 |

표의 residue는 확인한 xlat1에서 유도한 값이다. runtime의 나머지 decoded symbol은 switch에 대응 case가 없어 operation 효과가 없지만, 그 뒤의 치환·증가는 수행된다. Source 로더가 그래픽 문자를 받아들일 때의 허용 8명령 검사와 혼동하지 않는다.

## 4. 변환표 — C 원문에서 확인

아래 코드 블록은 원문 문자열의 전사이며 제품 구현 코드가 아니다. C escape를 해석한 길이는 각 94다. 두 줄은 이어 붙인다.

```c
const char xlat1[] =
  "+b(29e*j1VMEKLyC})8&m#~W>qxdRp0wkrUo[D7,XTcA\"lI"
  ".v%{gJh4G\\-=O@5`_3i<?Z';FNQuY]szf$!BS/|t:Pn6^Ha";
const char xlat2[] =
  "5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1C"
  "B6v^=I_0/8|jsb9m<.TVac`uY*MK'X~xDl}REokN:#?G\"i@";
```

crazy의 원본 9×9 ditrit table은 다음과 같다. `p9={1,9,81,729,6561}`마다 `o[(y/p9)%9][(x/p9)%9]*p9`를 합한다. 나눗셈은 정수 나눗셈이다.

```text
4 3 3 1 0 0 1 0 0
4 3 5 1 0 2 1 0 2
5 5 4 2 2 1 2 2 1
4 3 3 1 0 0 7 6 6
4 3 5 1 0 2 7 6 8
5 5 4 2 2 1 8 8 7
7 6 6 7 6 6 4 3 3
7 6 8 7 6 8 4 3 5
8 8 7 8 8 7 5 5 4
```

독립 검산용 3×3 trit table의 방향도 `table[yTrit][xTrit]`로 고정한다.

```text
     x=0 1 2
y=0    1 0 0
y=1    1 0 2
y=2    2 2 1
```

3×3 방식과 C 9×9 방식의 동일성은 단순 표 전사와 별도로 unit/differential test를 수행해야 한다. 알려진 fixture 값도 이 독립 검증을 대신하지 않는다.

## 5. 로더: 원본 동작과 안전 제안을 구분

C는 `isspace(x)`를 건너뛰며 printable byte에 대해서만 8명령 유효성 검사를 한다. 즉 원본은 모든 비printable byte를 무조건 reject하는 strict ASCII loader가 아니다. 길이가 0/1이면 이후 초기화에서 앞선 두 cell 접근이 안전하지 않다. 이 코드의 동작을 안전한 문서 편집 정책으로 그대로 복사하지 않는다. [W1]

| 경계 | 원문/현재 근거 | 상세화 제안 | legacy 프로필 확인 |
|---|---|---|---|
| 공백 | C의 isspace 사용 | ASCII 09,0A,0B,0C,0D,20만 무시 | 필요 |
| BOM | 제공 프로필 설명에 없음 | U+FEFF를 몰래 제거하지 않고 diagnostic/reject | 필요 |
| NUL/DEL/비ASCII | 원본은 printable 검사를 우회할 수 있음 | strict user-source에서는 reject, raw bytes 보존 | 필요 |
| UTF-8 decode 실패 | IDE 별도 정책 필요 | 원문 bytes를 보존하고 encoding 오류, replacement char로 덮어쓰지 않음 | 필요 |
| 길이 0/1 | C 초기화 안전 보장 없음 | LOAD_TOO_SHORT, VM 생성 없음 | 필요 |
| 길이 2..59049 | 정상 로딩 가능 구간 | 전체 검사 후 load; 최대 길이는 정상 허용 | 경계 회귀 필요 |
| 길이 >59049 | 원본 too long | LOAD_TOO_LONG, 부분 로딩 상태 publish 금지 | 진단 우선순위 필요 |
| invalid printable opcode | 원본 reject | address/span을 포함한 LOAD_INVALID_OPCODE | 기존 요구와 부합 |

이 제안은 구현 후보 계약이며 legacy `tio-c-safe-v1`의 확정 사실이 아니다. G01 해소 시 exact profile 문서와 대조한다. 불일치한다면 변경 기록과 새 profile revision/digest를 정하고, 기존 profile 이름 아래 몰래 섞지 않는다.

실행 버튼은 해당 문서 revision의 분석이 성공한 경우만 활성화한다. 오류 진단은 위치순으로 최대 200개를 보여주고 추가 수를 표시한다. 여러 오류가 있을 때 loader는 encoding → size → 위치별 source validity 순으로 대표 오류를 반환하되 분석기는 가능한 오류를 함께 제공한다. 이 우선순위는 제안이다.

## 6. 인코딩과 source map

initial instruction residue r을 주소 a에 인코딩한다.

```text
raw = 33 + mod(r - a - 33, 94)
```

`a=3, p의 r=62`이면 raw=59(`;`)다. `.nmal`은 이 변환으로 Raw를 만든 뒤 **같은 raw loader**를 통과시킨다. normalized opcode를 VM에서 직접 실행하지 않는다.

source map은 `address ↔ original UTF-16 offset/line/column ↔ file byte offset`이다. address/offset은 0부터, 화면 line/column은 1부터다. CRLF는 한 줄바꿈으로 세고 두 byte/UTF-16 code units를 보존한다. CR 단독과 LF도 줄바꿈으로 처리한다. TAB은 Monaco model의 한 code unit column이며 시각적 tab 폭과 다르다. VT/FF는 loader 공백이더라도 화면에서 경고 가능한 escape 표시를 제공하며 행 규칙과 혼합하지 않는다.

유효 ASCII 문서는 byte와 UTF-16 cell span이 1:1이다. 비ASCII를 편집 중일 때도 Unicode surrogate pair의 실제 UTF-16 길이로 diagnostic span을 만들고 address가 확정되지 않은 뒤쪽 결과는 tentative로 표시한다. 공백 위치 자체에는 address가 없다. 중단점의 열 없는 줄 지정은 첫 비공백의 유효 cell로 resolve하고 빈 줄은 unverified다.

## 7. 입출력과 포인터

입력 tape는 byte 배열이다. Text는 UI 경계에서 UTF-8로 인코딩하고 hex는 엄격히 검증한다. 원문 source ASCII 제한과 I/O byte 범위 0..255는 다르다. output은 byte 배열로 보존하고 Text/Escaped/Hex는 뷰다. C의 `putc(a)`와의 byte 동등성은 reference harness의 binary I/O에서 확인한다.

empty+open이면 WAITING_INPUT, empty+closed이면 EOF=59048을 읽는다. EOF는 byte가 아니고 input.cursor를 증가시키지 않는다. 반복 EOF 읽기도 각각 실제 input 명령 실행이므로 step과 eofReads는 증가한다. closeInput 자체는 명령이 아니다.

명령 효과·치환 이후 C/D를 각각 `59048→0`, 그 외 `+1` 한다. j/i가 변경한 포인터에도 증가가 적용된다. Halt는 이 절차를 생략하되 debugger의 committed instruction 수에는 포함한다. 따라서 fixture 종료 시 step=24이고 C=23이다.

## 8. fetch·치환·fault 경계의 중요한 차이

원본 invalid fetch는 stall이다. 안전 엔진은 이를 `FAULTED / STALLED_INVALID_FETCH`로 멈추고 machine state를 보존한다. 이것은 종료 instruction이 아니다.

원본의 치환은 `xlat2[M[C]-33]`이다. 여기서 **C 문자열의 종단 NUL 때문에 index 94는 배열 안**이다. 따라서 치환 시 M[C]=127이면 xlat2[94]=0이라는 정의된 C 접근이 존재한다. 정상 printable 치환 33..126과 구분해야 한다. `<33` 또는 `>127`의 치환 index는 원본 배열의 범위를 벗어난다. [W1의 C 선언과 접근으로부터 도출]

**상세화 제안:** 참조의 정의된 구간을 보존하려면 치환 값 127→0을 명시적으로 지원하고, 그 결과 다음 fetch가 invalid일 때 stall 진단을 한다. legacy `tio-c-safe-v1`이 127을 어떻게 처리했는지는 확인 필요다. 숫자 하나의 경계를 126으로 잘못 고정하여 정의된 동작을 undefined로 잘못 분류하지 않도록 A4/T11에 넣는다.

## 9. 원자성 후보 — 확정 legacy 정책이 아님

권장 후보는 **staged effects + full rollback on unsafe access**다. 명령을 복사된 소수 scalar와 write journal 위에서 계획하고, read/write 주소와 post-operation 치환 index를 검사한 뒤 한 번에 커밋한다. memory 전체 복사로 원자성을 구현하지 않는다. 같은 주소를 다시 읽으면 staged writes를 순서대로 반영한다.

```text
before 확보 → fetch 검사 → input availability 검사
→ 명령 효과를 임시 journal에 계획
→ post-operation C와 치환 index 검사
→ output/history capacity 검사
→ 명령 효과 + 치환 + 증가를 하나의 transaction으로 commit
```

WAITING_INPUT은 transaction 없음, step/counters/memory/tape cursor/output 무변화다. unsafe access는 machine effects를 롤백하고 별도의 fault event만 남긴다. attempted reads/writes는 diagnostic payload로 표시할 수 있으나 실제 memory/history write로 세지 않는다. UI에는 `실제 커밋되지 않은 시도`라고 표시한다.

원본 C는 치환 UB 이전에 데이터 쓰기나 I/O를 했을 수 있다. 그 partial effects와 위 rollback 제안은 **동일하다고 주장하지 않는다**. 제공된 legacy profile에서 partial commit을 채택했다면 반드시 이 항목과 undo 계약을 함께 수정해야 한다. pending 상태를 없애는 것은 G01을 해결하고 경계 테스트를 실행한 뒤다.

## 10. 필수 검증 계약

codec은 모든 주소 residue 0..93 × printable 33..126을 검사하고 전체 주소 경계 0/59048도 포함한다. memory 초기화는 59,049셀 전체를 independent oracle과 비교한다. 각 opcode, runtime unnamed NOP, pointer wrap, jump 후 치환 target, same-cell 복수 쓰기, EOF/empty 구분, halt, staged rollback, 127 치환 경계를 검사한다.

same-cell 복수 쓰기는 data write와 encryption write를 별도 순서로 남긴다. undo는 이를 역순으로 취소하고 registers/tape/output/counters/terminal까지 복원한다. reference UB를 ASan/UBSan 또는 경계 guard로 탐지한 경우, 그 이후 C 결과를 의미론 oracle로 사용하지 않는다.

테스트의 종류와 기대값은 [07_TEST_AND_RELEASE.md](07_TEST_AND_RELEASE.md)에 있다. 현재 runtime conformance는 `NOT_RUN`이다. 변환표를 읽은 것과 실행 프로필을 검증한 것은 다르다.
