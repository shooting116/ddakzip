// 예산 계산: 상품별로 "현금 + 대출(P) − 부대비용(P) ≥ P"를 만족하는 최대 P를 이분탐색으로 구한다.
import { getRules, type Rules } from './rules.ts';
import { classifyRegion, type RegionInfo } from './region.ts';
import { summarizeDebts } from './debts.ts';
import { calcFees } from './fees.ts';
import { monthlyPayment, maxPrincipalForAnnual } from './payment.ts';
import { allProfiles, type LoanProfile } from './products.ts';
import type { CalcInput, CalcResult, ProductResult, Bottleneck, LimitSet, FeeBreakdown } from './types.ts';

const PRICE_MAX = 10_000_000_000;
const STEP = 100_000; // 결과는 10만 원 단위로 내림

interface Solved {
  budget: number;
  loan: number;
  limits: LimitSet;
  bottleneck: Bottleneck;
  fees: FeeBreakdown;
}

function limitsAt(p: LoanProfile, price: number, existing: { annualDsr: number; annualDti: number }): LimitSet {
  const ltv = Math.floor((price * p.ltvAt(price)) / 100);
  const cap = p.capAt(price);
  const dsr = p.dsr
    ? maxPrincipalForAnnual((p.incomeForRatio * p.dsr.ratio) / 100 - existing.annualDsr, p.rate + p.dsr.stress, p.term)
    : null;
  const dti = p.dti != null
    ? maxPrincipalForAnnual((p.incomeForRatio * p.dti) / 100 - existing.annualDti, p.rate, p.term)
    : null;
  return { ltv, cap, dsr, dti, limit: p.limit };
}

function minLoan(l: LimitSet): { loan: number; by: Bottleneck } {
  let loan = l.ltv, by: Bottleneck = 'ltv';
  const consider = (v: number | null, k: Bottleneck) => { if (v != null && v < loan) { loan = v; by = k; } };
  consider(l.cap, 'cap'); consider(l.dsr, 'dsr'); consider(l.dti, 'dti'); consider(l.limit, 'limit');
  return { loan: Math.max(0, loan), by };
}

function solve(rules: Rules, p: LoanProfile, cash: number, existing: { annualDsr: number; annualDti: number },
  feeOpt: { firstHome: boolean; newbornExemption: boolean; areaOver85: boolean; metroCity: boolean }): Solved {
  const evalAt = (price: number) => {
    const limits = limitsAt(p, price, existing);
    const { loan, by } = minLoan(limits);
    const fees = calcFees(rules, price, { ...feeOpt, loan });
    const slack = cash + loan - fees.total - price;
    return { limits, loan, by, fees, slack };
  };

  let lo = 0, hi = p.priceCap ?? PRICE_MAX;
  if (evalAt(hi).slack >= 0) {
    const r = evalAt(hi);
    return { budget: hi, loan: r.loan, limits: r.limits, bottleneck: 'price_cap', fees: r.fees };
  }
  for (let i = 0; i < 60 && hi - lo > STEP / 2; i++) {
    const mid = (lo + hi) / 2;
    if (evalAt(mid).slack >= 0) lo = mid; else hi = mid;
  }
  const budget = Math.floor(lo / STEP) * STEP;
  const r = evalAt(budget);
  // 대출이 0이어도 DSR·DTI가 0으로 막은 것이면 그 항목이 병목이다
  const bottleneck: Bottleneck = r.by;
  return { budget, loan: Math.min(r.loan, Math.max(0, budget + r.fees.total - cash)), limits: r.limits, bottleneck, fees: r.fees };
}

export function calculate(input: CalcInput, asOf?: Date): CalcResult {
  const rules = getRules(asOf);
  const region: RegionInfo = classifyRegion(rules, input.region);
  const h = input.household;

  const incomePolicy = input.incomeSelf + (h.married ? input.incomeSpouse : 0);
  const incomeBank = input.incomeSelf + (input.combineSpouse ? input.incomeSpouse : 0);

  // 갈아타기: 매도 후 추가 현금 (매도가 − 잔여대출 − 매도 중개보수). 양도세는 v1 미반영.
  let moveCash: number | undefined;
  let cash = input.cash;
  if (input.situation === 'move' && h.currentHome) {
    const sellFees = calcFees(rules, h.currentHome.price, { firstHome: false, newbornExemption: false, areaOver85: false, metroCity: region.metroCity, loan: 0 });
    moveCash = Math.max(0, h.currentHome.price - h.currentHome.loan - sellFees.brokerage - sellFees.brokerageVat);
    cash += moveCash;
  }

  const existing = summarizeDebts(rules, input.debts, { homeless: h.homeless, region: region.cls });
  const ctx = { rules, input, region, incomePolicy, incomeBank };
  const feeOpt = { firstHome: h.firstHome, newbornExemption: h.birthWithin2y, areaOver85: !!input.areaOver85, metroCity: region.metroCity };

  const products: ProductResult[] = allProfiles(ctx).map((p) => {
    if (!p.eligible) {
      return {
        key: p.key, name: p.name, variant: p.variant, eligible: false, reasons: p.reasons, notes: p.notes,
        budget: 0, loan: 0, ltvPct: p.ltvAt(0), rate: p.rate, rateType: p.rateType, term: p.term, monthly: 0,
        bottleneck: 'none', limits: { ltv: 0, cap: null, dsr: null, dti: null, limit: p.limit },
        fees: calcFees(rules, 0, { ...feeOpt, loan: 0 }),
      };
    }
    const s = solve(rules, p, cash, existing, feeOpt);
    return {
      key: p.key, name: p.name, variant: p.variant, eligible: true, reasons: [], notes: p.notes,
      budget: s.budget, loan: s.loan, ltvPct: p.ltvAt(s.budget), rate: p.rate, rateType: p.rateType, term: p.term,
      monthly: monthlyPayment(s.loan, p.rate, p.term), bottleneck: s.bottleneck, limits: s.limits, fees: s.fees,
    };
  });

  // 디딤돌은 변형 중 예산이 가장 큰 것 하나만 대표로 남기고, 나머지는 숨긴다(자격 없는 변형은 이유 표시용으로 유지)
  const didim = products.filter((p) => p.key.startsWith('didimdol_'));
  const bestDidim = didim.filter((p) => p.eligible).sort((a, b) => b.budget - a.budget)[0]
    ?? didim.sort((a, b) => b.reasons.length - a.reasons.length).pop();
  const shown = products.filter((p) => !p.key.startsWith('didimdol_'));
  if (bestDidim) shown.splice(1, 0, bestDidim);

  const eligible = shown.filter((p) => p.eligible);
  const best = [...eligible].sort((a, b) => b.budget - a.budget || a.rate - b.rate)[0] ?? shown[0];

  // 만약에
  const bestProfile = allProfiles(ctx).find((p) => p.key === best.key)!;
  const cashPlus = best.eligible ? solve(rules, bestProfile, cash + rules.whatif.cash_delta, existing, feeOpt).budget : 0;
  const ctx2 = { ...ctx, incomePolicy: incomePolicy + rules.whatif.income_delta, incomeBank: incomeBank + rules.whatif.income_delta,
    input: { ...input, incomeSelf: input.incomeSelf + rules.whatif.income_delta } };
  const prof2 = allProfiles(ctx2).find((p) => p.key === best.key);
  const incomePlus = prof2 && prof2.eligible ? solve(rules, prof2, cash, existing, feeOpt).budget : best.budget;
  const ratePlus = monthlyPayment(best.loan, best.rate + rules.whatif.rate_delta, best.term);

  return {
    rulesVersion: rules.meta.version, rulesEffective: rules.meta.effective_from,
    region: region.cls, regionLabel: region.label,
    incomePolicy, incomeBank, existingAnnualPayment: existing.annualDsr,
    best, products: shown,
    whatif: {
      cashPlus: { delta: rules.whatif.cash_delta, budget: cashPlus },
      incomePlus: { delta: rules.whatif.income_delta, budget: incomePlus },
      ratePlus: { delta: rules.whatif.rate_delta, monthly: ratePlus },
    },
    moveCash,
  };
}

export const bottleneckLabel: Record<Bottleneck, string> = {
  ltv: 'LTV 한도 — 현금이 병목',
  cap: '가격구간 절대 한도',
  dsr: 'DSR — 소득 대비 상환능력',
  dti: 'DTI — 소득 대비 원리금',
  limit: '상품 최대 대출액',
  price_cap: '상품 주택가격 상한',
  none: '대출 없이 현금으로 충분',
};
