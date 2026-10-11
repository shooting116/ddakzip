// 원리금균등 상환 계산

/** 월 상환액 (원리금균등). ratePct 연이율 %, years 만기 */
export function monthlyPayment(principal: number, ratePct: number, years: number): number {
  if (principal <= 0) return 0;
  const n = Math.round(years * 12);
  const m = ratePct / 100 / 12;
  if (m <= 0) return principal / n;
  return (principal * m) / (1 - Math.pow(1 + m, -n));
}

/** 연간 원리금이 annualBudget 이하가 되는 최대 원금 */
export function maxPrincipalForAnnual(annualBudget: number, ratePct: number, years: number): number {
  if (annualBudget <= 0) return 0;
  const n = Math.round(years * 12);
  const m = ratePct / 100 / 12;
  const monthly = annualBudget / 12;
  if (m <= 0) return monthly * n;
  return (monthly * (1 - Math.pow(1 + m, -n))) / m;
}

/** 첫해 이자 (원리금균등, 근사: 잔액×이율) */
export function firstYearInterest(principal: number, ratePct: number): number {
  return (principal * ratePct) / 100;
}
