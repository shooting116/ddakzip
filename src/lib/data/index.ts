// data/index/*.json 로더 (빌드 시 build-index.mjs가 생성). 페이지·엔드포인트가 공용으로 쓴다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'data', 'index');

export interface TypeStat {
  key: number; label: string; pyeong: number; areas: number[];
  n36: number; n12: number; n6: number;
  price: number | null; basis: 'median6' | 'ref' | 'last' | null; priceN: number; priceDate: string | null;
  min6: number | null; max6: number | null; yoy: number | null;
  last: { date: string; amt: number; floor: number | null; area: number } | null;
  series: [string, number | null, number][];
}
export interface Kapt {
  code: string; units: number | null; dongs: number | null; used: string | null; topFloor: number | null;
  sale: string | null; heat: string | null; hall: string | null; builder: string | null;
  park: number | null; parkUnder: number | null; elev: number | null; subway: string | null; subwayWalk: string | null; busWalk: string | null;
  ev: number | null; addr: string | null; road: string | null;
}
export interface Complex {
  id: string; name: string; aliases: string[]; sido: string; sigungu: string; lawd: string; umd: string; bjd: string;
  jibun: string | null; road: string | null; built: number | null; lat: number | null; lng: number | null;
  kapt: Kapt | null; static: boolean;
  types: TypeStat[]; rep: number | null; price: number | null; priceBasis: TypeStat['basis'];
  n36: number; n12: number; n6: number; cancel36: number;
  last: { date: string; amt: number; area: number; floor: number | null } | null;
  transit: { line: string; type: string; station: string; status: string; open: number | null; dist: number; approx?: boolean }[];
  redev: { program: string; zone: string; type: string; stage: string; stageDate: string | null; planned: number | null; existing: number | null; source: string; sourceDate: string | null; by: string }[] | null;
  news: { t: string; o: string; d: string; u: string }[];
}
export interface SigunguIndex { lawd: string; sido: string; sigungu: string; regulated: boolean; asOf: string; months: string[]; complexes: Complex[] }
export interface Summary {
  asOf: string; months: number; staticMin: number; staticMax: number; staticCut: number;
  sido: Record<string, { complexes: number; static: number; trades36: number }>;
  sigungu: { lawd: string; sido: string; sigungu: string; regulated: boolean; complexes: number; static: number; trades36: number; geo: number; kapt: number; transit: number; redev: number; news: number }[];
  total: { complexes: number; static: number; trades36: number };
  /** aptSeq 앞 5자리 → 실제 시군구 코드 목록 (앞자리와 다른 경우만. 2026 행정구역 개편 지역) */
  idPrefix: Record<string, string[]>;
}

const cache = new Map<string, SigunguIndex>();
let summaryCache: Summary | null = null;

export function loadSummary(): Summary {
  if (summaryCache) return summaryCache;
  const p = join(ROOT, 'summary.json');
  if (!existsSync(p)) throw new Error('data/index/summary.json 이 없습니다. `npm run index`를 먼저 실행하세요.');
  summaryCache = JSON.parse(readFileSync(p, 'utf8'));
  return summaryCache!;
}

export function loadSigungu(lawd: string): SigunguIndex | null {
  if (cache.has(lawd)) return cache.get(lawd)!;
  const p = join(ROOT, 'complexes', `${lawd}.json`);
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, 'utf8')) as SigunguIndex;
  // 메모리 보호: 시군구 몇 개만 캐시
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  cache.set(lawd, d);
  return d;
}

export function* allSigungu(): Generator<SigunguIndex> {
  for (const s of loadSummary().sigungu) {
    const d = loadSigungu(s.lawd);
    if (d) yield d;
  }
}

/** 단지 id가 들어 있을 수 있는 시군구 코드들 (앞 5자리 우선, 그다음 개편 전 코드 매핑) */
export function lawdsOf(id: string): string[] {
  const prefix = id.split('-')[0];
  return [prefix, ...(loadSummary().idPrefix?.[prefix] ?? [])];
}

export function findComplex(id: string): { c: Complex; s: SigunguIndex } | null {
  for (const lawd of lawdsOf(id)) {
    const s = loadSigungu(lawd);
    const c = s?.complexes.find((x) => x.id === id);
    if (c && s) return { c, s };
  }
  return null;
}

/** 클라이언트용 슬림 버전 */
export function slim(c: Complex) {
  return {
    id: c.id, n: c.name, d: c.umd, b: c.built, la: c.lat, lo: c.lng,
    u: c.kapt?.units ?? null, r: c.rep, p: c.price, pb: c.priceBasis, n6: c.n6, n36: c.n36, st: c.static ? 1 : 0,
    t: c.types.map((t) => [t.key, t.price, t.basis, t.n6, t.yoy]),
    l: c.last ? [c.last.date, c.last.amt, c.last.area] : null,
    k: c.kapt ? { park: c.kapt.park, elev: c.kapt.elev, sub: c.kapt.subway, subw: c.kapt.subwayWalk, dongs: c.kapt.dongs, top: c.kapt.topFloor, heat: c.kapt.heat, used: c.kapt.used } : null,
    tr: c.transit.slice(0, 2).map((x) => `${x.line} ${x.station}${x.status === '운행중' ? '' : x.open ? ` ${x.open}예정` : ' 예정'}`),
    rd: c.redev ? `${c.redev[0].type.replace(/\(.*\)/, '')} · ${c.redev[0].stage.split(/\s*→\s*/).pop()!.slice(0, 20)}` : null,
  };
}
export type SlimComplex = ReturnType<typeof slim>;
