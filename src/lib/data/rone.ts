// 한국부동산원 R-ONE 주간 아파트 매매가격지수 (data/rone/weekly.json, fetch-rone.mjs가 매주 갱신)
// 지역 키는 "서울>강남지역>동남권>강남구", "경기>경부1권>성남시>분당구", "경기>경부1권>성남시", "인천>부평구", "서울" 꼴.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Weekly { source: string; updated: string; periods: string[]; labels: Record<string, string>; series: Record<string, Record<string, number>> }
export interface RoneStat {
  yoy: number | null;        // 최근 주 지수 ÷ 52주 전 지수 − 1 (%)
  streak: number;            // 전주 대비 연속 상승 주 수(양수) 또는 연속 하락 주 수(음수). 0이면 보합·방향 바뀜
  latest: number; asOf: string; asOfLabel: string; key: string;
}

let cache: Weekly | null | undefined;
function load(): Weekly | null {
  if (cache !== undefined) return cache;
  const p = join(process.cwd(), 'data', 'rone', 'weekly.json');
  cache = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Weekly) : null;
  return cache;
}
export function roneAsOf(): { period: string; label: string; updated: string } | null {
  const w = load(); if (!w || !w.periods.length) return null;
  const period = w.periods[w.periods.length - 1];
  return { period, label: w.labels[period] ?? period, updated: w.updated };
}
function statOf(key: string): RoneStat | null {
  const w = load(); if (!w) return null;
  const s = w.series[key]; if (!s) return null;
  const P = w.periods;
  const last = s[P[P.length - 1]]; if (last == null) return null;
  const prev = P.length >= 53 ? s[P[P.length - 53]] : undefined;
  const yoy = prev ? +(((last - prev) / prev) * 100).toFixed(1) : null;
  let streak = 0;
  for (let i = P.length - 1; i > 0; i--) {
    const a = s[P[i]], b = s[P[i - 1]];
    if (a == null || b == null) break;
    const d = Math.sign(+(a - b).toFixed(4));
    if (d === 0) break;
    if (streak === 0) streak = d; else if (Math.sign(streak) !== d) break; else streak += d;
  }
  return { yoy, streak, latest: last, asOf: P[P.length - 1], asOfLabel: w.labels[P[P.length - 1]] ?? P[P.length - 1], key };
}
const keys = () => Object.keys(load()?.series ?? {});

/** 시도 전체 ("서울", "경기" …) · 권역("수도권", "전국"). 최상위 이름이 조금 달라도(광주광역시 등) 찾는다 */
export function roneSido(sido: string): RoneStat | null {
  const direct = statOf(sido); if (direct) return direct;
  const k = keys().find((x) => !x.includes('>') && x.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '') === sido);
  return k ? statOf(k) : null;
}
/** 시군구: "종로구"(서울·광역시) 또는 "안양시 만안구"(경기). 이름이 안 맞으면 null */
export function roneSigungu(sido: string, sigungu: string): RoneStat | null {
  const parts = sigungu.trim().split(/\s+/);
  const tail = '>' + parts.join('>');
  const k = keys().find((x) => x.startsWith(sido + '>') && x.endsWith(tail));
  return k ? statOf(k) : null;
}
/** 시 단위 ("성남시") — 구가 있는 시는 R-ONE에 시 합계 행이 따로 있다 */
export function roneCity(sido: string, city: string): RoneStat | null {
  const k = keys().find((x) => x.startsWith(sido + '>') && x.endsWith('>' + city) && x.split('>').length <= 4);
  return k ? statOf(k) : null;
}
/** 표시용: "+11.2% · 89주째 ↑" */
export function roneText(r: RoneStat | null): string {
  if (!r || r.yoy == null) return '';
  const s = r.streak >= 2 ? ` · ${r.streak}주째 ↑` : r.streak <= -2 ? ` · ${-r.streak}주째 ↓` : '';
  return `${r.yoy > 0 ? '+' : ''}${r.yoy.toFixed(1)}%${s}`;
}
