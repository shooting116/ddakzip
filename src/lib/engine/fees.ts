// 취득세·부대비용. 규칙표 tax.acquisition / fees 기준.
import type { Rules } from './rules.ts';
import type { FeeBreakdown } from './types.ts';

export interface FeeOptions {
  firstHome: boolean;
  newbornExemption: boolean;
  areaOver85: boolean;
  metroCity: boolean;
  loan: number;
  assessedRatio?: number;
  bondDiscountPct?: number;
  legalFee?: number;
}

/** 취득세율(%) — 1주택 유상취득 */
export function acquisitionRate(rules: Rules, price: number): number {
  const t = rules.tax.acquisition.tiers;
  if (price <= t.low_max) return t.low_rate;
  if (price > t.high_min) return t.high_rate;
  // (가액 × 2/3억 − 3) / 100 → %로는 (가액×2/3억 − 3). 소수 넷째 자리(세율 기준) 반올림 = % 기준 둘째 자리
  const pct = (price * 2) / 300_000_000 - 3;
  return Math.round(pct * 100) / 100;
}

export function calcFees(rules: Rules, price: number, o: FeeOptions): FeeBreakdown {
  const acq = rules.tax.acquisition;
  const ratePct = acquisitionRate(rules, price);
  const taxRaw = Math.floor((price * ratePct) / 100);

  let exemption = 0;
  if (o.firstHome && price <= acq.first_home_exemption.price_cap) exemption = Math.min(taxRaw, acq.first_home_exemption.cap);
  if (o.newbornExemption && price <= acq.newborn_exemption.price_cap) exemption = Math.max(exemption, Math.min(taxRaw, acq.newborn_exemption.cap));
  const acquisitionTax = taxRaw - exemption;

  // 지방교육세: 감면 여부 불명확 → 보수적으로 전액 (규칙표 exemption_covers_education_tax=false)
  const educationTax = Math.floor((price * ratePct * acq.education_tax_ratio_of_rate) / 100);
  const ruralTax = o.areaOver85 ? Math.floor((price * acq.rural_tax_rate_over_85m2) / 100) : 0;

  // 중개보수 상한 + 부가세
  const tier = [...rules.fees.brokerage.tiers].reverse().find((t) => price >= t.price_min) ?? rules.fees.brokerage.tiers[0];
  let brokerage = Math.floor((price * tier.rate) / 100);
  if (tier.cap != null) brokerage = Math.min(brokerage, tier.cap);
  const brokerageVat = Math.floor((brokerage * rules.fees.brokerage.vat) / 100);

  const stampContract = rules.fees.stamp_contract.find((s) => s.price_max == null || price <= s.price_max)?.amount ?? 0;

  // 국민주택채권: 시가표준액(공시가) × 매입률(‰) × 할인율
  const assessed = price * (o.assessedRatio ?? rules.fees.bond.assessed_ratio_default);
  const tiers = o.metroCity ? rules.fees.bond.tiers_metro_city : rules.fees.bond.tiers_other;
  let permille = 0;
  for (const [min, p] of tiers) if (assessed >= min) permille = p;
  const bondFace = Math.floor((assessed * permille) / 1000 / 10000) * 10000; // 만 원 단위
  const bond = Math.floor((bondFace * (o.bondDiscountPct ?? rules.fees.bond.discount_rate_default)) / 100);

  const registration = rules.fees.registration_fee;
  const legal = o.legalFee ?? rules.fees.legal_fee_default;

  const ls = rules.fees.loan_stamp.find((s) => s.loan_max == null || o.loan <= s.loan_max)?.amount ?? 0;
  const loanStamp = Math.floor(ls * rules.fees.loan_stamp_borrower_share);

  const total = acquisitionTax + educationTax + ruralTax + brokerage + brokerageVat + stampContract + bond + registration + legal + loanStamp;
  return { acquisitionTax, acquisitionExemption: exemption, educationTax, ruralTax, brokerage, brokerageVat, stampContract, bond, registration, legal, loanStamp, total };
}
