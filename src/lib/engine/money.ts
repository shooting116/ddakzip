// 금액 포맷 — 억·만 단위, 월 상환액

const EOK = 100_000_000;
const MAN = 10_000;

/** 5.84억 / 9,500만 / 1.2억 형태 */
export function fmtEok(won: number, digits = 2): string {
  if (!Number.isFinite(won)) return '—';
  const sign = won < 0 ? '−' : '';
  const v = Math.abs(won);
  if (v >= EOK) {
    const e = v / EOK;
    const s = e >= 100 ? Math.round(e).toString() : trimZero(e.toFixed(digits));
    return `${sign}${s}억`;
  }
  if (v >= MAN) return `${sign}${Math.round(v / MAN).toLocaleString('ko-KR')}만`;
  return `${sign}${Math.round(v).toLocaleString('ko-KR')}원`;
}

/** 만 원 단위 정수 표기: 2,000만 원 */
export function fmtMan(won: number): string {
  return `${Math.round(won / MAN).toLocaleString('ko-KR')}만 원`;
}

/** 월 상환액: 201만 원 */
export function fmtMonthly(won: number): string {
  return `${Math.round(won / MAN).toLocaleString('ko-KR')}만 원`;
}

export function fmtPct(p: number, digits = 1): string {
  return `${p.toFixed(digits)}%`;
}

function trimZero(s: string): string {
  return s.replace(/\.?0+$/, '');
}

export { EOK, MAN };
