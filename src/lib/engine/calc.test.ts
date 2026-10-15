import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from './calc.ts';
import { calcFees, acquisitionRate } from './fees.ts';
import { getRules } from './rules.ts';
import type { CalcInput } from './types.ts';

const EOK = 1e8;
const rules = getRules(new Date('2026-10-12'));

function base(over: Partial<CalcInput> = {}): CalcInput {
  return {
    situation: 'general', cash: 1 * EOK, incomeSelf: 50_000_000, incomeSpouse: 0, combineSpouse: false, debts: [],
    household: { homeless: true, firstHome: false, married: false, newlywed: false, children: 0, birthWithin2y: false, age: 34 },
    region: { sido: '인천', sigungu: '부평구' }, term: 30,
    ...over,
  };
}

test('취득세율 구간 공식', () => {
  assert.equal(acquisitionRate(rules, 6 * EOK), 1);
  assert.equal(acquisitionRate(rules, 7 * EOK), 1.67);
  assert.equal(acquisitionRate(rules, 7.5 * EOK), 2);
  assert.equal(acquisitionRate(rules, 8 * EOK), 2.33);
  assert.equal(acquisitionRate(rules, 9.5 * EOK), 3);
});

test('부대비용 예시: 서울 6억 84㎡ 무주택(생애최초 아님) ≈ 1,176만', () => {
  const f = calcFees(rules, 6 * EOK, { firstHome: false, newbornExemption: false, areaOver85: false, metroCity: true, loan: 0 });
  assert.equal(f.acquisitionTax, 6_000_000);
  assert.equal(f.educationTax, 600_000);
  assert.equal(f.ruralTax, 0);
  assert.equal(f.brokerage, 2_400_000);
  assert.equal(f.brokerageVat, 240_000);
  assert.equal(f.stampContract, 150_000);
  assert.ok(Math.abs(f.bond - 1_758_120) < 20_000, `bond ${f.bond}`);
  assert.ok(Math.abs(f.total - 11_765_958) < 120_000, `total ${f.total}`);
});

test('생애최초 감면 200만 · 출산 500만 중 큰 쪽', () => {
  const a = calcFees(rules, 6 * EOK, { firstHome: true, newbornExemption: false, areaOver85: false, metroCity: true, loan: 0 });
  assert.equal(a.acquisitionExemption, 2_000_000);
  const b = calcFees(rules, 6 * EOK, { firstHome: true, newbornExemption: true, areaOver85: false, metroCity: true, loan: 0 });
  assert.equal(b.acquisitionExemption, 5_000_000);
  const c = calcFees(rules, 13 * EOK, { firstHome: true, newbornExemption: false, areaOver85: false, metroCity: true, loan: 0 });
  assert.equal(c.acquisitionExemption, 0);
});

test('예시: 생애최초 · 서울 강북구(R1) · 현금 2억 · 부부합산 1억 → 시중 주담대 LTV 70%, 약 6.3억', () => {
  const r = calculate(base({
    situation: 'first', cash: 2 * EOK, incomeSelf: 60_000_000, incomeSpouse: 40_000_000, combineSpouse: true,
    household: { homeless: true, firstHome: true, married: true, newlywed: false, children: 0, birthWithin2y: false, age: 35 },
    region: { sido: '서울', sigungu: '강북구' },
  }), new Date('2026-10-12'));
  assert.equal(r.region, 'R1');
  const bank = r.products.find((p) => p.key === 'bank')!;
  assert.ok(bank.eligible);
  assert.equal(bank.ltvPct, 70);
  assert.ok(bank.budget > 6.0 * EOK && bank.budget < 6.6 * EOK, `budget ${bank.budget}`);
  assert.equal(bank.bottleneck, 'ltv');
  assert.ok(bank.loan <= 6 * EOK);
  const didim = r.products.find((p) => p.key.startsWith('didimdol'))!;
  assert.equal(didim.eligible, false);
  assert.ok(didim.reasons.some((s) => s.includes('소득')));
  const bog = r.products.find((p) => p.key === 'bogeumjari')!;
  assert.equal(bog.eligible, false);
  assert.equal(r.best.key, 'bank');
  assert.ok(r.whatif.cashPlus.budget > bank.budget);
});

test('디딤돌 일반: 인천 부평(R2) · 현금 1억 · 소득 5천 → 한도 2억에 걸림', () => {
  const r = calculate(base(), new Date('2026-10-12'));
  assert.equal(r.region, 'R2');
  const didim = r.products.find((p) => p.key.startsWith('didimdol'))!;
  assert.ok(didim.eligible, didim.reasons.join(','));
  assert.equal(didim.bottleneck, 'limit');
  assert.ok(Math.abs(didim.loan - 2 * EOK) < 100_000, `loan ${didim.loan}`);
  assert.ok(didim.budget > 2.8 * EOK && didim.budget < 3.0 * EOK, `budget ${didim.budget}`);
  assert.equal(didim.rate, 3.8);
  const bank = r.products.find((p) => p.key === 'bank')!;
  assert.ok(bank.budget > didim.budget);
});

test('신생아 특례: 맞벌이 1.2억 · 부천(R2) · 생애최초 → 자격 있고 금리 3.5%, 예산은 은행과 같지만 금리로 우선', () => {
  const r = calculate(base({
    situation: 'newly', cash: 1.5 * EOK, incomeSelf: 70_000_000, incomeSpouse: 50_000_000, combineSpouse: true,
    household: { homeless: true, firstHome: true, married: true, newlywed: true, children: 1, birthWithin2y: true, age: 33 },
    region: { sido: '경기', sigungu: '부천시 원미구' },
  }), new Date('2026-10-12'));
  const nb = r.products.find((p) => p.key === 'newborn')!;
  assert.ok(nb.eligible, nb.reasons.join(','));
  assert.equal(nb.rate, 3.5);
  assert.equal(nb.ltvPct, 70);
  assert.ok(nb.budget > 4.4 * EOK && nb.budget < 5.0 * EOK, `budget ${nb.budget}`);
  const nf = r.products.find((p) => p.key === 'newlywed_first')!;
  assert.equal(nf.eligible, false);
  assert.equal(r.best.key, 'newborn');
});

test('신혼부부전용: 신혼+생애최초 · 소득 8천 · 인천 → 금리 3.85, LTV 70(수도권)', () => {
  const r = calculate(base({
    situation: 'newly', cash: 1 * EOK, incomeSelf: 45_000_000, incomeSpouse: 35_000_000, combineSpouse: true,
    household: { homeless: true, firstHome: true, married: true, newlywed: true, children: 0, birthWithin2y: false, age: 31 },
  }), new Date('2026-10-12'));
  const nf = r.products.find((p) => p.key === 'newlywed_first')!;
  assert.ok(nf.eligible, nf.reasons.join(','));
  assert.equal(nf.rate, 3.85);
  assert.equal(nf.ltvPct, 70);
  assert.ok(nf.budget <= 6 * EOK);
});

test('갈아타기: 서울(R1) 6개월 처분 · 매도 6억/잔여 2억 → 추가 현금 ≈ 3.97억, 은행 LTV 40%', () => {
  const r = calculate(base({
    situation: 'move', cash: 0.5 * EOK, incomeSelf: 80_000_000,
    household: { homeless: false, firstHome: false, married: true, newlywed: false, children: 1, birthWithin2y: false, age: 40,
      sellWithin6m: true, currentHome: { price: 6 * EOK, loan: 2 * EOK } },
    region: { sido: '서울', sigungu: '마포구' },
  }), new Date('2026-10-12'));
  assert.ok(r.moveCash! > 3.9 * EOK && r.moveCash! < 4 * EOK, `moveCash ${r.moveCash}`);
  const bank = r.products.find((p) => p.key === 'bank')!;
  assert.equal(bank.ltvPct, 40);
  assert.ok(bank.budget > 7 * EOK, `budget ${bank.budget}`);
  const didim = r.products.find((p) => p.key.startsWith('didimdol'))!;
  assert.equal(didim.eligible, false);
});

test('갈아타기 처분 안 함 → 수도권 주담대 불가', () => {
  const r = calculate(base({
    situation: 'move', cash: 3 * EOK, incomeSelf: 80_000_000,
    household: { homeless: false, firstHome: false, married: false, newlywed: false, children: 0, birthWithin2y: false, age: 40, sellWithin6m: false },
    region: { sido: '서울', sigungu: '마포구' },
  }), new Date('2026-10-12'));
  const bank = r.products.find((p) => p.key === 'bank')!;
  assert.equal(bank.eligible, false);
});

test('기존 대출이 DSR을 깎는다: 마통 한도 1억이면 은행 예산이 줄어든다', () => {
  const a = calculate(base({ cash: 2 * EOK, incomeSelf: 50_000_000 }), new Date('2026-10-12'));
  const b = calculate(base({ cash: 2 * EOK, incomeSelf: 50_000_000, debts: [{ type: 'overdraft', amount: 1 * EOK }] }), new Date('2026-10-12'));
  const ba = a.products.find((p) => p.key === 'bank')!, bb = b.products.find((p) => p.key === 'bank')!;
  assert.ok(bb.budget < ba.budget, `${bb.budget} < ${ba.budget}`);
  assert.equal(bb.bottleneck, 'dsr');
});

test('지방(R3) 생애최초 은행 LTV 80, 스트레스 0.75', () => {
  const r = calculate(base({
    situation: 'first', cash: 1 * EOK, incomeSelf: 60_000_000,
    household: { homeless: true, firstHome: true, married: false, newlywed: false, children: 0, birthWithin2y: false, age: 30 },
    region: { sido: '부산', sigungu: '해운대구' },
  }), new Date('2026-10-12'));
  assert.equal(r.region, 'R3');
  const bank = r.products.find((p) => p.key === 'bank')!;
  assert.equal(bank.ltvPct, 80);
  const didim = r.products.find((p) => p.key.startsWith('didimdol'))!;
  assert.equal(didim.rate, 3.6); // 4천~7천 30년 3.80 − 지방 0.2
});

test('규칙표 v0.2: 기본금리 4.66% (2026-10-15~), 그 전은 4.48%', () => {
  assert.equal(getRules(new Date('2026-10-14')).bank.rate_default.variable, 4.48);
  assert.equal(getRules(new Date('2026-10-15')).bank.rate_default.variable, 4.66);
});

test('보금자리론 결혼페널티 완화: 신혼 5천+4천(합산 9천 > 8.5천)은 10/19부터 1인 소득 5천으로 가능', () => {
  const input = base({
    situation: 'newly', cash: 1.5 * EOK, incomeSelf: 50_000_000, incomeSpouse: 40_000_000, combineSpouse: true,
    household: { homeless: true, firstHome: false, married: true, newlywed: true, children: 0, birthWithin2y: false, age: 32 },
  });
  const before = calculate(input, new Date('2026-10-16')).products.find((p) => p.key === 'bogeumjari')!;
  assert.equal(before.eligible, false);
  assert.ok(before.reasons.some((r) => r.includes('부부합산 소득')));
  const after = calculate(input, new Date('2026-10-19')).products.find((p) => p.key === 'bogeumjari')!;
  assert.equal(after.eligible, true);
  assert.ok(after.notes.some((n) => n.includes('그 배우자 명의')), after.notes.join(' / '));
  // 둘 다 7천만 초과면 여전히 불가
  const both = calculate(base({ ...input, incomeSelf: 75_000_000, incomeSpouse: 72_000_000 }), new Date('2026-10-19')).products.find((p) => p.key === 'bogeumjari')!;
  assert.equal(both.eligible, false);
});
