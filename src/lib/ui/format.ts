// 화면 표시용 포맷 (만 원 단위 입력)
export function eok(man: number | null | undefined, digits = 2): string {
  if (man == null) return '—';
  if (man < 10000) return `${Math.round(man).toLocaleString()}만`;
  const e = man / 10000;
  const str = e >= 100 ? e.toFixed(0) : e.toFixed(digits);
  return `${str.replace(/\.?0+$/, '')}억`;
}
/** 12억 3,500만 형식 */
export function eokMan(man: number | null | undefined): string {
  if (man == null) return '—';
  const e = Math.floor(man / 10000), m = Math.round(man % 10000);
  if (!e) return `${m.toLocaleString()}만`;
  return m ? `${e}억 ${m.toLocaleString()}만` : `${e}억`;
}
export function ymd(d: string | null | undefined): string {
  if (!d) return '—';
  return d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1.$2.$3');
}
export const basisLabel: Record<string, string> = { median6: '최근 6개월 실거래 중앙값', ref: '참고용 · 6개월 거래 3건 미만', last: '마지막 거래가 · 6개월 거래 없음' };
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
