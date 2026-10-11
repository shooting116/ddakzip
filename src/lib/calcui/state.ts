// 계산기 입력 상태 + 저장/복원
import type { CalcInput, Debt, DebtType, Situation } from '../engine/types.ts';

export type Marital = 'single' | 'married' | 'soon';

export interface UiState {
  situation: Situation;
  step: number;
  cashMan: number;              // 만 원
  incomeSelfMan: number;        // 만 원
  incomeSpouseMan: number;      // 만 원
  combineSpouse: boolean;
  hasDebt: boolean;
  debtTypes: DebtType[];
  debtAmounts: Partial<Record<DebtType, number>>;   // 만 원 (잔액·한도·월납입)
  marital: Marital;
  marriageYears: number;
  firstHome: boolean;
  children: number;
  birthWithin2y: boolean;
  age: number;
  sellWithin6m: boolean;
  currentPriceMan: number;
  currentLoanMan: number;
  sido: string | null;
  sigungu: string | null;
  regionUndecided: boolean;
  term: number;
  bankRate: number | null;
}

export const STORAGE_KEY = 'ddakzip-calc-v1';

export function defaultState(situation: Situation): UiState {
  return {
    situation, step: 1,
    cashMan: 0, incomeSelfMan: 0, incomeSpouseMan: 0, combineSpouse: true,
    hasDebt: false, debtTypes: [], debtAmounts: {},
    marital: situation === 'newly' ? 'married' : 'single',
    marriageYears: 1,
    firstHome: situation === 'first' || situation === 'newly' || situation === 'youth',
    children: 0, birthWithin2y: false, age: situation === 'youth' ? 29 : 34,
    sellWithin6m: true, currentPriceMan: 0, currentLoanMan: 0,
    sido: null, sigungu: null, regionUndecided: false,
    term: 30, bankRate: null,
  };
}

export function load(): UiState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as UiState;
    if (!s || typeof s !== 'object' || !s.situation) return null;
    return s;
  } catch { return null; }
}

export function save(s: UiState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ }
}

const MAN = 10_000;

export function toInput(s: UiState): CalcInput {
  const married = s.marital !== 'single';
  const debts: Debt[] = s.hasDebt
    ? s.debtTypes.map((t) => {
        const v = (s.debtAmounts[t] ?? 0) * MAN;
        if (t === 'installment' || t === 'student' || t === 'mortgage') return { type: t, monthly: v, amount: 0 };
        return { type: t, amount: v };
      })
    : [];
  const newlywed = married && (s.marital === 'soon' || s.marriageYears <= 7);
  const homeless = s.situation !== 'move';
  return {
    situation: s.situation,
    cash: s.cashMan * MAN,
    incomeSelf: s.incomeSelfMan * MAN,
    incomeSpouse: married ? s.incomeSpouseMan * MAN : 0,
    combineSpouse: married && s.combineSpouse,
    debts,
    household: {
      homeless,
      firstHome: homeless && s.firstHome,
      married,
      newlywed,
      children: s.children,
      birthWithin2y: s.birthWithin2y,
      age: s.age,
      sellWithin6m: s.sellWithin6m,
      currentHome: s.situation === 'move' ? { price: s.currentPriceMan * MAN, loan: s.currentLoanMan * MAN } : undefined,
    },
    region: s.regionUndecided || !s.sido || !s.sigungu ? null : { sido: s.sido, sigungu: s.sigungu },
    term: s.term,
    bankRate: s.bankRate ?? undefined,
  };
}

export const SITUATION_LABEL: Record<Situation, string> = {
  first: '생애최초', newly: '신혼부부', youth: '청년', general: '무주택 일반', move: '갈아타기',
};

export const DEBT_LABEL: Record<DebtType, { name: string; ask: string; unit: string; hint: string }> = {
  credit_loan: { name: '신용대출', ask: '신용대출 잔액', unit: '만 원', hint: '은행은 5년 분할로 봅니다' },
  overdraft:   { name: '마이너스통장', ask: '마이너스통장 한도', unit: '만 원', hint: '사용액이 아니라 한도 기준' },
  installment: { name: '자동차 할부·리스', ask: '월 납입액', unit: '만 원/월', hint: '향후 1년 실제 상환액' },
  student:     { name: '학자금', ask: '월 상환액', unit: '만 원/월', hint: '향후 1년 실제 상환액' },
  card_loan:   { name: '카드론', ask: '카드론 잔액', unit: '만 원', hint: '3년 분할로 봅니다' },
  mortgage:    { name: '기존 주담대', ask: '월 상환액', unit: '만 원/월', hint: '원리금 전액 반영' },
  jeonse:      { name: '전세대출', ask: '전세대출 잔액', unit: '만 원', hint: '무주택자는 DSR 제외' },
};
