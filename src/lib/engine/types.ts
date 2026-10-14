// 쏙집 계산 엔진 — 타입. 금액은 원(정수), 비율은 %.

export type Situation = 'first' | 'newly' | 'youth' | 'general' | 'move';
export type RegionClass = 'R1' | 'R2' | 'R3';

export type DebtType =
  | 'credit_loan'  // 신용대출 — amount = 잔액
  | 'overdraft'    // 마이너스통장 — amount = 한도
  | 'installment'  // 자동차 할부·리스 — monthly = 월 납입액
  | 'student'      // 학자금 — monthly
  | 'card_loan'    // 카드론 — amount = 잔액
  | 'mortgage'     // 기존 주담대 — monthly, amount = 잔액
  | 'jeonse';      // 전세자금대출 — amount = 잔액

export interface Debt {
  type: DebtType;
  amount?: number;
  monthly?: number;
  rate?: number;
}

export interface Household {
  /** 세대 기준 무주택 (갈아타기면 false) */
  homeless: boolean;
  /** 세대원 전원 주택 소유 이력 없음 */
  firstHome: boolean;
  married: boolean;
  /** 혼인 7년 이내 또는 3개월 내 결혼 예정 */
  newlywed: boolean;
  /** 만 19세 미만 자녀 수 */
  children: number;
  /** 대출 접수일 기준 2년 내 출산·입양 */
  birthWithin2y: boolean;
  /** 차주 만 나이 (만기 연령 제한용) */
  age: number;
  /** 갈아타기: 기존 주택을 6개월 내 처분할 계획 */
  sellWithin6m?: boolean;
  /** 갈아타기: 기존 주택 매도가·잔여 대출 (추가 현금 산출) */
  currentHome?: { price: number; loan: number };
}

export interface CalcInput {
  situation: Situation;
  /** 보유 현금 (부대비용 빼기 전) */
  cash: number;
  incomeSelf: number;
  incomeSpouse: number;
  /** 은행 DSR 산정에 배우자 소득 합산 여부. 정책대출은 항상 부부합산. */
  combineSpouse: boolean;
  debts: Debt[];
  household: Household;
  region: { sido: string; sigungu: string } | null;
  /** 만기(년) */
  term: number;
  /** 시중 주담대 금리 직접 입력(없으면 규칙표 기본값) */
  bankRate?: number;
  /** 전용 85㎡ 초과 (농특세) */
  areaOver85?: boolean;
}

export type Bottleneck = 'ltv' | 'cap' | 'dsr' | 'dti' | 'limit' | 'price_cap' | 'none';

export interface LimitSet {
  ltv: number;
  cap: number | null;
  dsr: number | null;
  dti: number | null;
  limit: number | null;
}

export interface ProductResult {
  key: string;
  name: string;
  variant?: string;
  eligible: boolean;
  reasons: string[];
  /** 최대 매수가 (예산) */
  budget: number;
  /** 그 예산에서의 대출액 */
  loan: number;
  ltvPct: number;
  rate: number;
  rateType: 'variable' | 'fixed' | 'unknown';
  term: number;
  monthly: number;
  bottleneck: Bottleneck;
  limits: LimitSet;
  fees: FeeBreakdown;
  notes: string[];
}

export interface FeeBreakdown {
  acquisitionTax: number;
  acquisitionExemption: number;
  educationTax: number;
  ruralTax: number;
  brokerage: number;
  brokerageVat: number;
  stampContract: number;
  bond: number;
  registration: number;
  legal: number;
  loanStamp: number;
  total: number;
}

export interface CalcResult {
  rulesVersion: string;
  rulesEffective: string;
  region: RegionClass;
  regionLabel: string;
  incomePolicy: number;
  incomeBank: number;
  existingAnnualPayment: number;
  best: ProductResult;
  products: ProductResult[];
  whatif: {
    cashPlus: { delta: number; budget: number };
    incomePlus: { delta: number; budget: number };
    ratePlus: { delta: number; monthly: number };
  };
  /** 갈아타기: 매도로 생기는 추가 현금 */
  moveCash?: number;
}
