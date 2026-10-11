// 기존 대출 → DSR(연간 원리금) · DTI(연간 이자) 환산. 규칙표 bank.dsr.existing_debt 기준.
import type { Rules } from './rules.ts';
import type { Debt, RegionClass } from './types.ts';

export interface ExistingDebtSummary {
  /** DSR용: 연간 원리금 합 */
  annualDsr: number;
  /** DTI용: 기타부채 연간 이자 합 (기존 주담대는 원리금) */
  annualDti: number;
  /** 총 잔액(마통은 한도) — DSR 적용 여부 판단용 */
  totalBalance: number;
  lines: { type: Debt['type']; annualDsr: number; annualDti: number; note: string }[];
}

export function summarizeDebts(rules: Rules, debts: Debt[], opts: { homeless: boolean; region: RegionClass }): ExistingDebtSummary {
  const cfg = rules.bank.dsr.existing_debt;
  const lines: ExistingDebtSummary['lines'] = [];
  let annualDsr = 0, annualDti = 0, totalBalance = 0;

  for (const d of debts) {
    const amount = Math.max(0, d.amount ?? 0);
    const monthly = Math.max(0, d.monthly ?? 0);
    let dsr = 0, dti = 0, note = '';
    switch (d.type) {
      case 'credit_loan': {
        const rate = d.rate ?? cfg.credit_loan.default_rate;
        const principal = amount / cfg.credit_loan.principal_years;
        const interest = (amount * rate) / 100;
        dsr = principal + interest; dti = interest; totalBalance += amount;
        note = `잔액 ÷ ${cfg.credit_loan.principal_years}년 + 이자 ${rate}%`;
        break;
      }
      case 'overdraft': {
        const rate = d.rate ?? cfg.overdraft.default_rate;
        const principal = amount / cfg.overdraft.principal_years;
        const interest = (amount * rate) / 100;
        dsr = principal + interest; dti = interest; totalBalance += amount;
        note = `한도 ÷ ${cfg.overdraft.principal_years}년 + 이자 ${rate}% (사용액 아님)`;
        break;
      }
      case 'card_loan': {
        const rate = d.rate ?? cfg.card_loan.default_rate;
        const principal = amount / cfg.card_loan.principal_years;
        const interest = (amount * rate) / 100;
        dsr = principal + interest; dti = interest; totalBalance += amount;
        note = `잔액 ÷ ${cfg.card_loan.principal_years}년 + 이자 ${rate}%`;
        break;
      }
      case 'installment':
      case 'student': {
        dsr = monthly * 12; dti = monthly * 12 * 0.3; totalBalance += amount;
        note = '향후 1년 실제 상환액';
        break;
      }
      case 'mortgage': {
        dsr = monthly * 12; dti = monthly * 12; totalBalance += amount;
        note = '실제 연간 원리금';
        break;
      }
      case 'jeonse': {
        const rate = d.rate ?? cfg.jeonse.default_rate;
        if (!opts.homeless && opts.region !== 'R3') {
          dsr = (amount * rate) / 100; dti = dsr;
          note = '1주택자 수도권·규제지역: 이자만 반영';
        } else {
          note = '전세대출은 DSR에서 제외';
        }
        break;
      }
    }
    annualDsr += dsr; annualDti += dti;
    lines.push({ type: d.type, annualDsr: dsr, annualDti: dti, note });
  }
  return { annualDsr, annualDti, totalBalance, lines };
}
