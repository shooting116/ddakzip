// 상품별 대출 프로필: 자격·금리·LTV·한도·DTI/DSR 규칙을 한 묶음으로. 규칙표 bank / policy 기준.
import type { Rules } from './rules.ts';
import type { CalcInput } from './types.ts';
import type { RegionInfo } from './region.ts';

export interface LoanProfile {
  key: string;
  name: string;
  variant?: string;
  eligible: boolean;
  reasons: string[];
  notes: string[];
  rate: number;
  rateType: 'variable' | 'fixed' | 'unknown';
  term: number;
  priceCap: number | null;
  limit: number | null;
  /** 가격에 따라 달라질 수 있는 LTV(%) */
  ltvAt: (price: number) => number;
  /** 수도권·규제지역 가격구간 절대 한도 */
  capAt: (price: number) => number | null;
  dsr: { ratio: number; stress: number } | null;
  dti: number | null;
  /** 정책대출: 부부합산 소득 / 은행: 합산 선택 소득 */
  incomeForRatio: number;
}

interface Ctx {
  rules: Rules;
  input: CalcInput;
  region: RegionInfo;
  incomePolicy: number;
  incomeBank: number;
}

const eok = (n: number) => `${(n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1)}억`;
const man = (n: number) => `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;

function nearestTerm(allowed: number[], term: number): number {
  const le = allowed.filter((t) => t <= term);
  return le.length ? le[le.length - 1] : allowed[0];
}

function bandRate(table: { bands: number[]; rows: number[][]; local_discount: number; floor: number }, terms: number[], income: number, term: number, local: boolean): number | null {
  const bi = table.bands.findIndex((b) => income <= b);
  if (bi < 0) return null;
  const ti = terms.indexOf(term);
  let r = table.rows[bi][ti < 0 ? terms.length - 1 : ti];
  if (local) r -= table.local_discount;
  return Math.round(Math.max(r, table.floor) * 100) / 100;
}

// ---------- 시중 주담대 ----------
export function bankProfile(c: Ctx): LoanProfile {
  const { rules, input, region } = c;
  const h = input.household;
  const R = region.cls;
  const b = rules.bank;
  const reasons: string[] = [];
  const notes: string[] = [];

  const maxTerm = (b.dsr.max_term_years as Record<string, number>)[R] ?? 30;
  const term = Math.min(input.term, maxTerm);
  if (term !== input.term) notes.push(`수도권·규제지역 주담대 만기는 ${maxTerm}년 이내 (행정지도)`);

  let kind: 'general' | 'first' | 'serviceman' | 'move_sell6m' | 'owner_keep';
  if (input.situation === 'move') kind = h.sellWithin6m ? 'move_sell6m' : 'owner_keep';
  else if (h.firstHome) kind = 'first';
  else kind = 'general';

  const ltvTable = b.ltv as Record<string, Record<string, number>>;
  const baseLtv = ltvTable[kind][R];
  if (kind === 'owner_keep' && baseLtv === 0) reasons.push('기존 주택을 처분하지 않으면 수도권·규제지역 주담대는 LTV 0%');
  if (kind === 'move_sell6m') notes.push('대출 실행 후 6개월 내 기존 주택 처분 약정 기준');

  const serviceman = kind === 'general' && h.homeless && c.incomeBank <= b.ltv.serviceman.income_cap;
  const ltvAt = (price: number) => {
    if (kind === 'move_sell6m' && R === 'R3') return b.ltv.move_sell6m.R3_without_proof;
    if (serviceman && price <= b.ltv.serviceman.price_cap) return Math.max(baseLtv, ltvTable.serviceman[R]);
    return baseLtv;
  };
  if (serviceman) notes.push(`서민·실수요자 우대(소득 9천만 이하, 8억 이하 주택) 적용 시 LTV ${ltvTable.serviceman[R]}%`);

  const capAt = (price: number): number | null => {
    if (R === 'R3') return kind === 'first' ? b.ltv.first.R3_loan_cap : null;
    for (const t of b.loan_cap_metro) if (t.price_max == null || price <= t.price_max) return t.cap;
    return null;
  };

  const dtiTable = b.dti as Record<string, Record<string, number | null>>;
  const dti = (kind === 'first' ? dtiTable.first : dtiTable.general)[R] ?? null;
  const stress = (b.dsr.stress as Record<string, number>)[R];
  const rate = input.bankRate ?? b.rate_default.variable;
  notes.push(`금리 ${rate}%는 ${b.rate_default.as_of} 예금은행 주담대 평균(변동) · DSR 산정 시 스트레스 +${stress}%p`);

  return {
    key: 'bank', name: '시중 주담대', eligible: reasons.length === 0, reasons, notes,
    rate, rateType: 'variable', term, priceCap: null, limit: null,
    ltvAt, capAt, dsr: { ratio: b.dsr.ratio, stress }, dti, incomeForRatio: c.incomeBank,
  };
}

// ---------- 디딤돌 ----------
export function didimdolProfiles(c: Ctx): LoanProfile[] {
  const { rules, input, region } = c;
  const p = rules.policy.products.didimdol;
  const h = input.household;
  const terms = p.terms;
  const term = nearestTerm(terms, input.term);
  const local = region.cls === 'R3';
  const out: LoanProfile[] = [];

  const candidates: (keyof typeof p.variants)[] = ['general'];
  if (h.firstHome) candidates.push('first');
  if (h.newlywed) candidates.push('newly');
  if (h.children >= 2) candidates.push('kids2');

  for (const vk of candidates) {
    const v = p.variants[vk];
    const reasons: string[] = [];
    const notes: string[] = [];
    if (!h.homeless) reasons.push('무주택 세대주만 가능 (1주택 처분조건부 불가)');
    if (c.incomePolicy > v.income_cap) reasons.push(`부부합산 소득 ${man(v.income_cap)} 초과`);
    if (input.cash > rules.policy.asset_cap) reasons.push(`순자산 ${eok(rules.policy.asset_cap)} 초과`);
    const rate = bandRate(p.rate_table, terms, c.incomePolicy, term, local);
    const ltv = vk === 'first' ? (region.metro ? p.ltv.first_metro : p.ltv.first) : p.ltv.default;
    if (p.room_deduction_metro_apt && region.metro) notes.push('수도권 아파트는 방공제(소액임차보증금) 적용 → 실제 대출액이 줄 수 있음');
    notes.push('우대금리(생애최초·신혼·자녀·청약 등) 미반영 · 전용 85㎡ 이하');
    out.push({
      key: `didimdol_${vk}`, name: `디딤돌 ${v.label}`, variant: v.label,
      eligible: reasons.length === 0 && rate != null, reasons: rate == null && reasons.length === 0 ? ['소득 구간 초과'] : reasons, notes,
      rate: rate ?? 0, rateType: 'variable', term, priceCap: v.price_cap, limit: v.limit,
      ltvAt: () => ltv, capAt: () => null, dsr: null, dti: p.dti, incomeForRatio: c.incomePolicy,
    });
  }
  return out;
}

// ---------- 신혼부부전용 (신혼 + 생애최초) ----------
export function newlywedFirstProfile(c: Ctx): LoanProfile | null {
  const { rules, input, region } = c;
  const h = input.household;
  if (!(h.newlywed && h.firstHome)) return null;
  const p = rules.policy.products.newlywed_first;
  const term = nearestTerm(p.terms, input.term);
  const reasons: string[] = [];
  if (!h.homeless) reasons.push('무주택 세대주만 가능');
  if (c.incomePolicy > p.income_cap) reasons.push(`부부합산 소득 ${man(p.income_cap)} 초과`);
  if (input.cash > rules.policy.asset_cap) reasons.push(`순자산 ${eok(rules.policy.asset_cap)} 초과`);
  const rate = bandRate(p.rate_table, p.terms, c.incomePolicy, term, region.cls === 'R3');
  const ltv = region.metro ? p.ltv.metro : p.ltv.default;
  return {
    key: 'newlywed_first', name: '신혼부부전용 구입자금', eligible: reasons.length === 0 && rate != null, reasons,
    notes: ['신혼 + 생애최초 가구 전용 · 디딤돌 신혼보다 0.3%p 낮은 표 · 우대금리 미반영'],
    rate: rate ?? 0, rateType: 'variable', term, priceCap: p.price_cap, limit: p.limit,
    ltvAt: () => ltv, capAt: () => null, dsr: null, dti: p.dti, incomeForRatio: c.incomePolicy,
  };
}

// ---------- 신생아 특례 ----------
export function newbornProfile(c: Ctx): LoanProfile | null {
  const { rules, input, region } = c;
  const h = input.household;
  const p = rules.policy.products.newborn;
  const term = nearestTerm(p.terms, input.term);
  const reasons: string[] = [];
  const notes: string[] = [];
  if (!h.birthWithin2y) {
    // 자격 없음이지만 "출산 시" 참고용으로 돌려줌
    reasons.push('대출접수일 기준 2년 내 출산·입양 가구만');
  }
  if (!h.homeless) reasons.push('무주택 세대주만 가능 (1주택자는 대환만)');
  const dual = input.incomeSelf > 0 && input.incomeSpouse > 0;
  const cap = dual ? p.income_cap_dual : p.income_cap;
  if (c.incomePolicy > cap) reasons.push(`부부합산 소득 ${eok(cap)} 초과`);
  if (dual && (input.incomeSelf > p.income_cap_each || input.incomeSpouse > p.income_cap_each)) reasons.push(`맞벌이는 각자 ${eok(p.income_cap_each)} 이하`);
  if (input.cash > rules.policy.asset_cap) reasons.push(`순자산 ${eok(rules.policy.asset_cap)} 초과`);
  const rate = bandRate(p.rate_table, p.terms, c.incomePolicy, term, region.cls === 'R3');
  const ltv = h.firstHome ? (region.metro ? p.ltv.first_metro : p.ltv.first) : p.ltv.default;
  notes.push(`특례금리 ${p.special_years}년 (추가 출산 시 연장) · 이후 금리 상승 · 우대금리 미반영`);
  return {
    key: 'newborn', name: '신생아 특례 디딤돌', eligible: reasons.length === 0 && rate != null, reasons, notes,
    rate: rate ?? 0, rateType: 'unknown', term, priceCap: p.price_cap, limit: p.limit,
    ltvAt: () => ltv, capAt: () => null, dsr: null, dti: p.dti, incomeForRatio: c.incomePolicy,
  };
}

// ---------- 보금자리론 ----------
export function bogeumjariProfile(c: Ctx): LoanProfile {
  const { rules, input, region } = c;
  const h = input.household;
  const p = rules.policy.products.bogeumjari;
  const reasons: string[] = [];
  const notes: string[] = [];

  // 만기: 연령 제한
  let term = nearestTerm(p.terms, input.term);
  const lim = p.term_age_limit as Record<string, { age_under: number; newly_age_under: number }>;
  while (term >= 40) {
    const l = lim[String(term)];
    const ok = h.age < (h.newlywed ? l.newly_age_under : l.age_under);
    if (ok) break;
    term = nearestTerm(p.terms, term - 1);
  }
  if (term !== nearestTerm(p.terms, input.term)) notes.push(`${input.term}년 만기는 연령 요건 미달 → ${term}년`);

  if (!h.homeless && input.situation !== 'move') reasons.push('무주택 또는 1주택 처분조건부만 가능');
  if (input.situation === 'move') notes.push(`기존 주택을 실행일부터 ${p.sell_within_years}년 내 처분하는 조건`);

  const incomeCap = Math.max(
    p.income_cap.default,
    h.newlywed ? p.income_cap.newly : 0,
    h.children >= 2 ? p.income_cap.kids2 : h.children === 1 ? p.income_cap.kids1 : 0,
  );
  if (c.incomePolicy > incomeCap) reasons.push(`부부합산 소득 ${man(incomeCap)} 초과`);

  const limit = Math.max(p.limit.default, h.firstHome ? p.limit.first : 0, h.children >= 2 ? p.limit.kids2 : 0);
  const serviceman = h.homeless && c.incomePolicy <= p.serviceman.income_cap;
  const noCut = serviceman || h.firstHome;

  let ltv: number;
  if (h.firstHome) ltv = region.metro ? p.ltv.first_metro : p.ltv.first;
  else ltv = region.cls === 'R1' && !noCut ? p.ltv.apt_R1 : p.ltv.apt;
  const dti = region.cls === 'R1' && !noCut ? p.dti.R1 : p.dti.default;

  const ti = p.rate_table.terms.indexOf(term);
  let rate = p.rate_table.akkime[ti < 0 ? 0 : ti];
  if (region.cls === 'R1') rate += p.rate_table.regulated_add;
  notes.push(`고정금리 · ${p.rate_table.as_of} 공시(아낌e) · 우대금리 미반영 · 주택 ${eok(p.price_cap)} 이하`);

  return {
    key: 'bogeumjari', name: '보금자리론', eligible: reasons.length === 0, reasons, notes,
    rate, rateType: 'fixed', term, priceCap: p.price_cap, limit,
    ltvAt: () => ltv, capAt: () => null, dsr: null, dti, incomeForRatio: c.incomePolicy,
  };
}

export function allProfiles(c: Ctx): LoanProfile[] {
  const list: LoanProfile[] = [bankProfile(c)];
  const nf = newlywedFirstProfile(c);
  if (nf) list.push(nf);
  list.push(...didimdolProfiles(c));
  const nb = newbornProfile(c);
  if (nb) list.push(nb);
  list.push(bogeumjariProfile(c));
  return list;
}
