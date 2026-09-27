import { decode } from '@bolgescope/core';
import type { JournalEvent, MachineState, Transaction } from '@bolgescope/core';

export type LessonId = 'L01' | 'L02' | 'L03' | 'L04' | 'L05' | 'L06';
export type Lesson = Readonly<{
  id: LessonId;
  title: string;
  goal: string;
  question: string;
  hint: string;
  fixtureUrl: string;
  inputHex: string;
  setupStep: number;
  answerExample: string;
}>;

const recurrent = '/examples/recurrent_crazy4.mb';
export const lessons: readonly Lesson[] = [
  { id: 'L01', title: '주소와 문자', goal: '같은 raw 문자도 주소에 따라 다르게 해독합니다.', question: '#2와 #19의 raw s는 각각 어떤 명령일까요? (예: /,j)', hint: '(raw + address) mod 94를 구한 뒤 명령표를 보세요.', fixtureUrl: recurrent, inputHex: '', setupStep: 0, answerExample: '/,j' },
  { id: 'L02', title: '입력과 EOF', goal: '빈 입력과 EOF를 구별합니다.', question: '빈 입력 tape에서 /를 Step하면 상태는? (WAITING_INPUT 또는 HALTED)', hint: 'EOF는 Send EOF를 눌렀을 때만 도착합니다.', fixtureUrl: recurrent, inputHex: '', setupStep: 2, answerExample: 'WAITING_INPUT' },
  { id: 'L03', title: '포인터', goal: 'j의 효과와 명령 뒤 증가를 분리합니다.', question: '첫 명령을 Step한 뒤 D,C 값을 순서대로 입력하세요.', hint: 'j가 D를 옮긴 뒤 C와 D가 각각 1 증가합니다.', fixtureUrl: recurrent, inputHex: '', setupStep: 0, answerExample: 'D,C' },
  { id: 'L04', title: 'crazy 연산', goal: '데이터 쓰기와 코드 치환을 구분합니다.', question: '#3 p를 Step할 때 데이터 쓰기의 주소와 결과값은 무엇일까요?', hint: 'A=65, M[78]=84에서 crazy table을 적용하세요.', fixtureUrl: recurrent, inputHex: '41', setupStep: 3, answerExample: '주소,값' },
  { id: 'L05', title: '명령 변환', goal: '실행 뒤 현재 코드가 바뀌는 것을 확인합니다.', question: '#3에서 encryption 쓰기 전후 값을 예측하고 Step으로 확인하세요.', hint: 'Source는 그대로이고 Runtime memory의 C 셀이 바뀝니다.', fixtureUrl: recurrent, inputHex: '41', setupStep: 3, answerExample: '이전 값,새 값' },
  { id: 'L06', title: '재방문', goal: '같은 주소의 두 fetch에서 실제 해독 변화를 봅니다.', question: '다음 Step으로 재방문하는 주소의 첫 해독 문자와 두 번째 해독 문자는?', hint: '이론 cycle 대신 실제 fetch 사건 두 개를 비교하세요.', fixtureUrl: '/examples/revisit.mb', inputHex: '4142430A', setupStep: 8, answerExample: '첫 문자,두 번째 문자' },
] as const;

export type LessonResult = Readonly<{ correct: boolean; expected: string; observed: boolean }>;

function instructionAtStep(history: readonly JournalEvent[], step: number): Transaction | null {
  for (const event of history) if (event.kind === 'instruction' && event.stepAfter === step) return event.transaction;
  return null;
}

function expectedFor(id: LessonId, state: MachineState, history: readonly JournalEvent[]): string | null {
  switch (id) {
    case 'L01': return `${decode('s'.charCodeAt(0), 2)},${decode('s'.charCodeAt(0), 19)}`;
    case 'L02': return state.phase === 'WAITING_INPUT' && state.reason === 'INPUT_EMPTY' ? 'WAITING_INPUT' : null;
    case 'L03': {
      const tx = instructionAtStep(history, 1);
      return tx ? `${tx.after.registers.d},${tx.after.registers.c}` : null;
    }
    case 'L04': {
      const write = instructionAtStep(history, 4)?.writes.find(item => item.role === 'data-write');
      return write ? `${write.address},${write.after}` : null;
    }
    case 'L05': {
      const write = instructionAtStep(history, 4)?.writes.find(item => item.role === 'encryption');
      return write ? `${write.before},${write.after}` : null;
    }
    case 'L06': {
      const seen = new Map<number, Transaction>();
      for (const event of history) {
        if (event.kind !== 'instruction') continue;
        const first = seen.get(event.transaction.fetchAddress);
        if (first) return `${first.decodedSymbol},${event.transaction.decodedSymbol}`;
        seen.set(event.transaction.fetchAddress, event.transaction);
      }
      return null;
    }
  }
}

export function judgeLesson(id: LessonId, answer: string, state: MachineState, history: readonly JournalEvent[]): LessonResult {
  const expected = expectedFor(id, state, history);
  if (expected === null) return { correct: false, expected: '', observed: false };
  // Decoded Malbolge symbols are case-sensitive; C and c are not the same token.
  const submitted = answer.replaceAll(/\s/g, '');
  return { correct: id === 'L02' ? submitted.toUpperCase() === expected : submitted === expected, expected, observed: true };
}
