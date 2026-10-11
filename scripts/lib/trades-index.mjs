// 수집된 실거래(data/trades)를 읽어 단지(aptSeq) 단위로 묶는다. 단지 마스터 매칭·집계가 함께 쓴다.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './regions.mjs';

export const TRADES_DIR = join(ROOT, 'data', 'trades');

/** 실거래 전체 행을 순회 (lawd 필터 가능) */
export function* iterTrades({ lawds = null } = {}) {
  if (!existsSync(TRADES_DIR)) return;
  for (const lawd of readdirSync(TRADES_DIR).filter((d) => /^\d{5}$/.test(d)).sort()) {
    if (lawds && !lawds.includes(lawd)) continue;
    const dir = join(TRADES_DIR, lawd);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ndjson')).sort()) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        yield JSON.parse(line);
      }
    }
  }
}

/** 단지 묶음: aptSeq → { aptSeq, lawd, umd, bjd(10자리), umdNm, jibun, apt, built, n, first, last } */
export function groupComplexes(opts = {}) {
  const map = new Map();
  for (const r of iterTrades(opts)) {
    const key = r.aptSeq ?? `${r.lawd}${r.umd}-${r.jibun}-${r.apt}`;
    let c = map.get(key);
    if (!c) {
      c = { aptSeq: key, lawd: r.lawd, umd: r.umd, bjd: `${r.lawd}${r.umd}`, umdNm: r.umdNm, jibun: r.jibun, apt: r.apt, road: r.road, built: r.built, n: 0, first: r.date, last: r.date, names: new Map() };
      map.set(key, c);
    }
    c.n++;
    if (r.date < c.first) c.first = r.date;
    if (r.date > c.last) c.last = r.date;
    c.names.set(r.apt, (c.names.get(r.apt) ?? 0) + 1);
    if (!c.jibun && r.jibun) c.jibun = r.jibun;
    if (!c.road && r.road) c.road = r.road;
  }
  // 가장 많이 쓰인 이름을 대표 이름으로
  for (const c of map.values()) {
    c.apt = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
    c.aliases = [...c.names.keys()].filter((n) => n !== c.apt);
    delete c.names;
  }
  return map;
}

/** 이름 정규화: 공백·괄호·특수문자 제거, 흔한 접미사 제거 */
const BRAND = [
  [/i\s*'?\s*park/gi, '아이파크'], [/e\s*-?\s*편한세상/gi, '이편한세상'], [/sk\s*view/gi, '에스케이뷰'], [/the\s*sharp/gi, '더샵'],
  [/prugio/gi, '푸르지오'], [/raemian/gi, '래미안'], [/xi\b/gi, '자이'], [/hillstate/gi, '힐스테이트'], [/lotte\s*castle/gi, '롯데캐슬'],
  [/centreville/gi, '센트레빌'], [/we'?ve/gi, '위브'], [/humansia/gi, '휴먼시아'], [/\bLH\b/g, '엘에이치'],
];
export function normName(s) {
  let t = String(s ?? '').replace(/\(.*?\)/g, '');
  for (const [re, ko] of BRAND) t = t.replace(re, ko);
  return t
    .replace(/아파트$/g, '')
    .replace(/[\s·.,'"’`\-_&/]/g, '')
    .replace(/APT$/i, '')
    .toLowerCase();
}

/** 바이그램 Dice 유사도 (0~1) */
export function dice(a, b) {
  const A = normName(a), B = normName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return Math.min(A.length, B.length) / Math.max(A.length, B.length) * 0.5 + 0.5;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / ((A.length - 1) + (B.length - 1));
}
