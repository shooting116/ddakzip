#!/usr/bin/env node
// 실거래(data/trades) + 단지 마스터(data/complexes) → 사이트가 읽는 집계(data/index)
//
//   node scripts/build-index.mjs            전체 (npm run build 앞에서 자동 실행)
//   node scripts/build-index.mjs --sido 서울
//
// 결과 (커밋하지 않음, 빌드 때마다 생성):
//   data/index/complexes/{lawd}.json   시군구별 단지 요약 (평형별 시세·추이, K-apt, 좌표)
//   data/index/summary.json            시도·시군구별 건수, 기준일
//
// 기준 (3단계 결정):
//   - 시세 = 최근 6개월 실거래 중앙값(해제·직거래 제외). 6개월 3건 미만이면 basis 'ref'(참고용), 0건이면 마지막 거래 'last'
//   - 평형 = 전용면적을 대표 타입(59·74·84·101·114 …)에 ±3㎡로 묶음. 대표 평형 = 36개월 거래 최다 타입
//   - 정적 상세 페이지 대상 = 36개월 거래 5건 이상

import { readdirSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { iterTrades } from './lib/trades-index.mjs';

const OUT = join(ROOT, 'data', 'index');
const CX = join(ROOT, 'data', 'complexes');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;
const MONTHS = 36;
const STATIC_MIN = 5;
// 정적 상세 페이지 상한. Cloudflare Workers 정적 자산 한도(파일 2만 개) 안에 들도록 거래 많은 순 상위만 정적으로 만들고,
// 나머지는 404 폴백이 브라우저에서 같은 내용을 그린다(검색엔진 노출만 차이).
const STATIC_MAX = 18000;

// ---------- 평형 ----------
const ANCHORS = [33, 39, 46, 49, 51, 59, 66, 74, 84, 95, 101, 114, 125, 135, 150, 165, 180, 200, 240];
const PYEONG = { 33: 13, 39: 16, 46: 18, 49: 20, 51: 21, 59: 25, 66: 27, 74: 30, 84: 34, 95: 38, 101: 40, 114: 45, 125: 50, 135: 54, 150: 60, 165: 66, 180: 72, 200: 80, 240: 96 };
export function typeKey(area) {
  let best = null, bd = Infinity;
  for (const a of ANCHORS) { const d = Math.abs(area - a); if (d < bd) { bd = d; best = a; } }
  if (bd <= 3) return best;
  return Math.round(area / 5) * 5;
}
export function pyeongOf(key) { return PYEONG[key] ?? Math.round((key * 1.33) / 3.3058); }

// ---------- 통계 ----------
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
function ymAdd(ym, delta) { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + delta; while (m <= 0) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; }

function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }

/** data/rent/{lawd}/*.ndjson 에서 fromYm 이후 행만 */
function loadRent(lawd, fromYm) {
  const dir = join(ROOT, 'data', 'rent', lawd);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ndjson') && x.slice(0, 6) >= fromYm.replace('-', '')).sort()) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line) out.push(JSON.parse(line));
  }
  return out;
}
/**
 * 전세 집계 (평형별): 최근 6개월 전세(월세 0원) 보증금 중앙값. 3건 이상이면 median6, 1~2건이면 ref.
 * 전세가율 = 전세 중앙값 ÷ 매매 시세 — 둘 다 median6일 때만 (표본이 얇으면 비율이 튀므로).
 */
function summarizeRent(rentRows, types, asOfYm) {
  const from6 = ymAdd(asOfYm, -5), from12 = ymAdd(asOfYm, -11);
  const ym = (r) => r.date.slice(0, 7);
  const byType = new Map();
  for (const r of rentRows) { const k = typeKey(r.area); (byType.get(k) ?? byType.set(k, []).get(k)).push(r); }
  let repOut = null;
  for (const t of types) {
    const rows = byType.get(t.key) ?? [];
    const j6 = rows.filter((r) => r.rent === 0 && ym(r) >= from6), j12 = rows.filter((r) => r.rent === 0 && ym(r) >= from12);
    const w6 = rows.filter((r) => r.rent > 0 && ym(r) >= from6);
    let price = null, basis = null;
    if (j6.length >= 3) { price = median(j6.map((r) => r.deposit)); basis = 'median6'; }
    else if (j6.length) { price = median(j6.map((r) => r.deposit)); basis = 'ref'; }
    const ratio = price != null && basis === 'median6' && t.price && t.basis === 'median6' ? Math.round((price / t.price) * 100) : null;
    t.jeonse = price != null ? { price, basis, n6: j6.length, n12: j12.length, wolse6: w6.length, ratio } : (w6.length || j12.length ? { price: null, basis: null, n6: 0, n12: j12.length, wolse6: w6.length, ratio: null } : null);
  }
  return repOut;
}

function summarizeComplex(c, asOfYm, months) {
  const from6 = ymAdd(asOfYm, -5), from12 = ymAdd(asOfYm, -11), fromPrev6a = ymAdd(asOfYm, -17), fromPrev6b = ymAdd(asOfYm, -12);
  const valid = c.rows.filter((r) => !r.cancel && !r.direct);
  const byType = new Map();
  for (const r of c.rows) {
    const k = typeKey(r.area);
    let t = byType.get(k);
    if (!t) { t = { key: k, areas: new Set(), rows: [], valid: [] }; byType.set(k, t); }
    t.areas.add(r.area); t.rows.push(r);
    if (!r.cancel && !r.direct) t.valid.push(r);
  }
  const types = [...byType.values()].map((t) => {
    const ym = (r) => r.date.slice(0, 7);
    const v6 = t.valid.filter((r) => ym(r) >= from6), v12 = t.valid.filter((r) => ym(r) >= from12);
    const prev = t.valid.filter((r) => ym(r) >= fromPrev6a && ym(r) <= fromPrev6b);
    const lastValid = [...t.valid].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    let price = null, basis = null, priceN = 0, priceDate = null;
    if (v6.length >= 3) { price = median(v6.map((r) => r.amt)); basis = 'median6'; priceN = v6.length; priceDate = asOfYm; }
    else if (v6.length) { price = median(v6.map((r) => r.amt)); basis = 'ref'; priceN = v6.length; priceDate = asOfYm; }
    else if (lastValid) { price = lastValid.amt; basis = 'last'; priceN = 1; priceDate = lastValid.date; }
    const cur6 = v6.length >= 3 ? median(v6.map((r) => r.amt)) : null;
    const prev6 = prev.length >= 3 ? median(prev.map((r) => r.amt)) : null;
    const yoy = cur6 && prev6 ? +(((cur6 - prev6) / prev6) * 100).toFixed(1) : null;
    const series = months.map((m) => { const xs = t.valid.filter((r) => ym(r) === m).map((r) => r.amt); return [m, median(xs), xs.length]; });
    return {
      key: t.key, label: `${t.key}㎡`, pyeong: pyeongOf(t.key), areas: [...t.areas].sort((a, b) => a - b),
      n36: t.rows.length, n12: v12.length, n6: v6.length, nPrev6: prev.length, price, basis, priceN, priceDate,
      min6: v6.length ? Math.min(...v6.map((r) => r.amt)) : null, max6: v6.length ? Math.max(...v6.map((r) => r.amt)) : null,
      yoy, last: lastValid ? { date: lastValid.date, amt: lastValid.amt, floor: lastValid.floor, area: lastValid.area } : null, series,
    };
  }).sort((a, b) => a.key - b.key);
  const rep = [...types].sort((a, b) => b.n36 - a.n36 || a.key - b.key)[0];
  const lastAll = [...valid].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const n12 = valid.filter((r) => r.date.slice(0, 7) >= from12).length;
  const n6 = valid.filter((r) => r.date.slice(0, 7) >= from6).length;
  return { types, rep: rep?.key ?? null, price: rep?.price ?? null, priceBasis: rep?.basis ?? null, n36: c.rows.length, n12, n6, cancel36: c.rows.filter((r) => r.cancel).length, last: lastAll ? { date: lastAll.date, amt: lastAll.amt, area: lastAll.area, floor: lastAll.floor } : null };
}

const toRad = (d) => (d * Math.PI) / 180;
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/** 단지 1.5km 안의 호재 역 (노선별 가장 가까운 역 하나) */
function nearbyStations(lat, lng, stations, radius) {
  if (lat == null || lng == null) return [];
  const best = new Map();
  for (const s of stations) {
    if (Math.abs(s.lat - lat) > 0.02 || Math.abs(s.lng - lng) > 0.025) continue; // 대략 2km 밖은 건너뜀
    const d = distM(lat, lng, s.lat, s.lng);
    if (d > radius) continue;
    const cur = best.get(s.line);
    if (!cur || d < cur.dist) best.set(s.line, { line: s.line, type: s.type, station: s.name, status: s.status, open: s.open, dist: Math.round(d), approx: !!s.approx, lat: s.lat, lng: s.lng });
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

/** K-apt가 없는 단지: 건축물대장(건축HUB) 총괄표제부·표제부로 세대수·동수·최고층·사용승인일만 채운다. 주차대수는 옛 대장이 부정확해 쓰지 않는다 */
function bldgOf(b) {
  if (!b || !b.units) return null;
  return {
    code: null, src: 'bldg', units: b.units, dongs: b.dongs || null, used: b.used || null, topFloor: b.topFloor || null,
    sale: null, heat: null, hall: null, builder: null, park: null, parkUnder: null, elev: null, subway: null, subwayWalk: null, busWalk: null, ev: null, addr: null, road: null,
  };
}
function kaptOf(info) {
  if (!info) return null;
  const park = (info.parkGround ?? 0) + (info.parkUnder ?? 0);
  return {
    code: info.kaptCode, src: 'kapt', units: info.units || null, dongs: info.dongs || null, used: info.used || null, topFloor: info.topFloor || null,
    sale: info.sale || null, heat: info.heat || null, hall: info.hall || null, builder: info.builder || null,
    park: park || null, parkUnder: info.parkUnder ?? null, elev: info.elevators ?? null,
    subway: info.subwayLine || info.subwayStation ? `${info.subwayLine ?? ''} ${info.subwayStation ?? ''}`.trim() : null, subwayWalk: info.subwayWalk || null, busWalk: info.busWalk || null,
    ev: (info.evGround ?? 0) + (info.evUnder ?? 0) || null, addr: info.addr || null, road: info.road || null,
  };
}

/**
 * "거래 활발" 표시: 같은 시군구 안에서 최근 6개월 거래가 HOT_MIN건 이상인 단지 중 회전율(6개월 거래 ÷ 세대수) 상위 HOT_TOP.
 * 세대수를 모르는 단지(K-apt 미매칭)는 따로 6개월 거래 건수 상위 HOT_TOP. 판단이 아니라 집계이므로 기준값(cut·of·rank)을 같이 적는다.
 */
const HOT_MIN = 5, HOT_TOP = 0.1;
function markHot(complexes) {
  for (const c of complexes) c.hot = null;
  const withUnits = complexes.filter((c) => c.n6 >= HOT_MIN && c.kapt?.units > 0).map((c) => ({ c, v: +(c.n6 / c.kapt.units * 100).toFixed(2) }));
  const noUnits = complexes.filter((c) => c.n6 >= HOT_MIN && !(c.kapt?.units > 0)).map((c) => ({ c, v: c.n6 }));
  for (const [list, byUnits] of [[withUnits, true], [noUnits, false]]) {
    if (!list.length) continue;
    list.sort((a, b) => b.v - a.v || b.c.n6 - a.c.n6);
    const k = Math.max(1, Math.ceil(list.length * HOT_TOP));
    const cut = list[k - 1].v;
    list.forEach((x, i) => { if (i < k) x.c.hot = { byUnits, rate: byUnits ? x.v : null, n6: x.c.n6, units: byUnits ? x.c.kapt.units : null, cut, of: list.length, rank: i + 1 }; });
  }
}

function main() {
  const t0 = Date.now();
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const asOf = kst.toISOString().slice(0, 10), asOfYm = asOf.slice(0, 7);
  const months = Array.from({ length: MONTHS }, (_, i) => ymAdd(asOfYm, -(MONTHS - 1 - i)));
  const match = loadJson(join(CX, 'match.json'), {});
  const bldg = loadJson(join(CX, 'bldg.json'), {});
  const geo = loadJson(join(CX, 'geo.json'), {});
  const redev = loadJson(join(CX, 'redev.json'), {});
  const newsSkip = loadJson(join(ROOT, 'data', 'overrides', 'news.json'), {});
  const transit = loadJson(join(ROOT, 'data', 'transit', 'stations.json'), { radius_m: 1500, stations: [] });
  const stations = transit.stations.filter((s) => s.lat != null);
  const RADIUS = transit.radius_m ?? 1500;
  mkdirSync(join(OUT, 'complexes'), { recursive: true });
  const summary = { asOf, months: MONTHS, staticMin: STATIC_MIN, sido: {}, sigungu: [], idPrefix: {} };
  let total = 0, totalStatic = 0, totalTrades = 0;
  // aptSeq 앞 5자리는 "그 단지가 처음 등록된 시군구"라 지금 코드와 다를 수 있다(2026 행정구역 개편: 광주 29xxx→12xxx, 인천 28140→28125 등).
  // 같은 aptSeq가 두 시군구 파일에 들어가면 /apt/{id} 경로가 겹치므로 한 곳에만 둔다. 앞자리와 같은 시군구가 있으면 거기, 없으면 거래가 많은 쪽.
  const seen = new Map(); // id → [{lawd, n36}]
  const yoyPool = new Map(); // lawd → { yoys: number[], vol: {cur, prev} } (지역별 1년 변동률 재료)

  for (const r of regions) {
    const info = loadJson(join(CX, 'info', `${r.lawd}.json`), {});
    const news = loadJson(join(ROOT, 'data', 'news', `${r.lawd}.json`), {});
    const map = new Map();
    for (const row of iterTrades({ lawds: [r.lawd] })) {
      if (row.date.slice(0, 7) < months[0]) continue;
      const key = row.aptSeq ?? `${row.lawd}${row.umd}-${row.jibun}-${row.apt}`;
      let c = map.get(key);
      if (!c) { c = { id: key, lawd: row.lawd, umd: row.umd, umdNm: row.umdNm, jibun: row.jibun, road: row.road, built: row.built, names: new Map(), rows: [] }; map.set(key, c); }
      c.rows.push(row);
      c.names.set(row.apt, (c.names.get(row.apt) ?? 0) + 1);
      if (!c.jibun && row.jibun) c.jibun = row.jibun;
      if (!c.built && row.built) c.built = row.built;
    }
    // 전월세 → 단지 연결 키 (전월세 API에는 aptSeq가 없다)
    const rentIdx = new Map(), rentByName = new Map(), rentByJibun = new Map();
    for (const c of map.values()) {
      for (const nm of c.names.keys()) {
        rentIdx.set(`${c.umdNm}|${c.jibun}|${nm}`, c.id);
        const nk = `${c.umdNm}|${nm}`; rentByName.set(nk, rentByName.has(nk) ? null : c.id); // 같은 동에 같은 이름이 둘이면 null(모호)
      }
      if (c.jibun) { const jk = `${c.umdNm}|${c.jibun}`; rentByJibun.set(jk, rentByJibun.has(jk) ? null : c.id); } // 같은 지번에 단지가 하나뿐일 때만 (이름 표기 차이 흡수)
    }
    const rentRows = new Map();
    let rentN = 0, rentMiss = 0;
    for (const x of loadRent(r.lawd, ymAdd(asOfYm, -11))) {
      const id = rentIdx.get(`${x.umdNm}|${x.jibun}|${x.apt}`) ?? rentByName.get(`${x.umdNm}|${x.apt}`) ?? (x.jibun ? rentByJibun.get(`${x.umdNm}|${x.jibun}`) : null) ?? null;
      if (!id) { rentMiss++; continue; }
      (rentRows.get(id) ?? rentRows.set(id, []).get(id)).push(x); rentN++;
    }
    const complexes = [];
    for (const c of map.values()) {
      const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const s = summarizeComplex(c, asOfYm, months);
      summarizeRent(rentRows.get(c.id) ?? [], s.types, asOfYm);
      const repT = s.types.find((t) => t.key === s.rep);
      s.jeonse = repT?.jeonse?.price ?? null; s.jeonseBasis = repT?.jeonse?.basis ?? null; s.jeonseRatio = repT?.jeonse?.ratio ?? null;
      s.rent12 = (rentRows.get(c.id) ?? []).length;
      const g = geo[c.id];
      const kapt = kaptOf(match[c.id] ? info[match[c.id].kaptCode] : null) ?? bldgOf(bldg[c.id]);
      const tr = nearbyStations(g?.lat ?? null, g?.lng ?? null, stations, RADIUS);
      const rd = redev[c.id] ?? null;
      const nw = newsSkip[c.id] ? [] : (news[c.id]?.items ?? []);
      complexes.push({
        id: c.id, name, aliases: [...c.names.keys()].filter((n) => n !== name), sido: r.sido, sigungu: r.sigungu, lawd: r.lawd, umd: c.umdNm, bjd: `${c.lawd}${c.umd}`, jibun: c.jibun || null, road: c.road || null,
        built: c.built || null, lat: g?.lat ?? null, lng: g?.lng ?? null, kapt, static: c.rows.length >= STATIC_MIN, ...s,
        transit: tr, redev: rd, news: nw,
      });
    }
    complexes.sort((a, b) => b.n36 - a.n36 || a.name.localeCompare(b.name, 'ko'));
    for (const c of complexes) { let a = seen.get(c.id); if (!a) seen.set(c.id, (a = [])); a.push({ lawd: r.lawd, n36: c.n36 }); }
    writeFileSync(join(OUT, 'complexes', `${r.lawd}.json`), JSON.stringify({ lawd: r.lawd, sido: r.sido, sigungu: r.sigungu, regulated: r.regulated, asOf, months, rent: { n12: rentN, unmatched: rentMiss }, complexes }));
    summary.sigungu.push({ lawd: r.lawd, sido: r.sido, sigungu: r.sigungu, regulated: r.regulated });
  }

  // 중복 aptSeq 정리: 진 쪽 파일에서 빼고 다시 쓴다 (몇 건 안 됨)
  const drop = new Map(); // lawd → Set(id)
  let nDup = 0;
  for (const [id, arr] of seen) {
    if (arr.length < 2) continue;
    nDup++;
    const prefix = id.split('-')[0];
    const win = arr.find((a) => a.lawd === prefix) ?? [...arr].sort((a, b) => b.n36 - a.n36)[0];
    for (const a of arr) if (a !== win) { let s = drop.get(a.lawd); if (!s) drop.set(a.lawd, (s = new Set())); s.add(id); }
  }
  for (const [lawd, ids] of drop) {
    const p = join(OUT, 'complexes', `${lawd}.json`);
    const d = JSON.parse(readFileSync(p, 'utf8'));
    d.complexes = d.complexes.filter((c) => !ids.has(c.id));
    writeFileSync(p, JSON.stringify(d));
  }

  // 정적 페이지 대상: 중복 정리 후 남은 단지 중 36개월 거래 STATIC_MIN건 이상을 거래 많은 순으로 STATIC_MAX개까지
  const dropped = (id, lawd) => drop.get(lawd)?.has(id);
  const ranked = [];
  for (const [id, arr] of seen) for (const a of arr) if (!dropped(id, a.lawd) && a.n36 >= STATIC_MIN) ranked.push([a.n36, id]);
  ranked.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  const staticIds = new Set(ranked.slice(0, STATIC_MAX).map((r) => r[1]));
  const staticCut = ranked.length > STATIC_MAX ? ranked[STATIC_MAX - 1][0] : STATIC_MIN;
  Object.assign(summary, { staticMax: STATIC_MAX, staticCut });

  // 요약 집계 + id 앞자리 → 실제 시군구 코드 맵 (앞자리와 다른 경우만)
  for (const g of summary.sigungu) {
    const p = join(OUT, 'complexes', `${g.lawd}.json`);
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const complexes = d.complexes;
    for (const c of complexes) c.static = staticIds.has(c.id);
    markHot(complexes);
    writeFileSync(p, JSON.stringify(d));
    const nStatic = complexes.filter((c) => c.static).length;
    const trades = complexes.reduce((s, c) => s + c.n36, 0);
    Object.assign(g, { complexes: complexes.length, static: nStatic, trades36: trades, geo: complexes.filter((c) => c.lat).length, kapt: complexes.filter((c) => c.kapt).length, bldg: complexes.filter((c) => c.kapt?.src === 'bldg').length, transit: complexes.filter((c) => c.transit.length).length, redev: complexes.filter((c) => c.redev).length, news: complexes.filter((c) => c.news.length).length, hot: complexes.filter((c) => c.hot).length, jeonse: complexes.filter((c) => c.jeonse != null).length });
    // 역 선택 필터용: 이 시군구 단지 1.5km 안에 있는 호재 역 (단지 수 많은 순, 좌표 포함)
    const stMap = new Map();
    for (const c of complexes) for (const t of c.transit) {
      const key = `${t.station}·${t.line}`;
      const e = stMap.get(key) ?? { k: key, n: t.station, l: t.line, st: t.status, open: t.open ?? null, c: 0, la: null, lo: null };
      e.c++; stMap.set(key, e);
    }
    for (const e of stMap.values()) { const src = stations.find((x) => x.name === e.n && x.line === e.l); if (src) { e.la = src.lat; e.lo = src.lng; } }
    g.stations = [...stMap.values()].sort((a, b) => b.c - a.c || a.n.localeCompare(b.n, 'ko'));
    for (const c of complexes) {
      const prefix = c.id.split('-')[0];
      if (prefix === g.lawd) continue;
      const list = summary.idPrefix[prefix] ?? (summary.idPrefix[prefix] = []);
      if (!list.includes(g.lawd)) list.push(g.lawd);
    }
    const sd = summary.sido[g.sido] ?? (summary.sido[g.sido] = { complexes: 0, static: 0, trades36: 0 });
    sd.complexes += complexes.length; sd.static += nStatic; sd.trades36 += trades;
    total += complexes.length; totalStatic += nStatic; totalTrades += trades;
    // 1년 변동률 재료: 같은 단지·같은 평형의 6개월 중앙값 vs 1년 전 6개월(둘 다 3건↑)의 변동률 목록 + 거래량(최근 6개월 / 1년 전 6개월)
    const yoys = [], vol = { cur: 0, prev: 0 };
    for (const c of complexes) for (const t of c.types) { if (t.yoy != null) yoys.push(t.yoy); vol.cur += t.n6; vol.prev += t.nPrev6 ?? 0; }
    yoyPool.set(g.lawd, { yoys, vol });
  }
  summary.total = { complexes: total, static: totalStatic, trades36: totalTrades };

  // 지역별 1년 변동률: 시군구 → (경기처럼 시 아래 구가 있으면) 시 → 시도. 표본(평형) CHG_MIN개 미만이면 비움
  const CHG_MIN = 10;
  const chgOf = (pool) => {
    const yoys = pool.flatMap((p) => p.yoys), cur = pool.reduce((a, p) => a + p.vol.cur, 0), prev = pool.reduce((a, p) => a + p.vol.prev, 0);
    const med = yoys.length >= CHG_MIN ? median(yoys.map((v) => v * 10)) / 10 : null; // 소수 첫째 자리 유지
    return { yoy: med, n: yoys.length, cur, prev, volPct: prev ? Math.round(((cur - prev) / prev) * 100) : null };
  };
  for (const g of summary.sigungu) g.chg = chgOf([yoyPool.get(g.lawd)]);
  // 권역: 수도권 = 서울·인천·경기 (쏙집이 전수 수집하는 범위). '전국'은 수집 범위 밖이라 만들지 않는다
  const capital = summary.sigungu.filter((g) => ['서울', '인천', '경기'].includes(g.sido));
  summary.groups = { 수도권: { sidos: ['서울', '인천', '경기'], chg: chgOf(capital.map((g) => yoyPool.get(g.lawd))) } };
  summary.cities = {};
  for (const [sido, _] of Object.entries(summary.sido)) {
    const regs = summary.sigungu.filter((g) => g.sido === sido);
    summary.sido[sido].chg = chgOf(regs.map((g) => yoyPool.get(g.lawd)));
    // "성남시 분당구"처럼 시 + 구 로 된 이름은 시로 묶는다 (광역시의 구는 그대로)
    const byCity = new Map();
    for (const g of regs) {
      const m = g.sigungu.match(/^(\S+시)\s+(\S+구)$/);
      const city = m ? m[1] : g.sigungu;
      (byCity.get(city) ?? byCity.set(city, []).get(city)).push(g);
    }
    summary.cities[sido] = [...byCity.entries()].map(([name, gs]) => ({ name, lawds: gs.map((g) => g.lawd), merged: gs.length > 1, chg: chgOf(gs.map((g) => yoyPool.get(g.lawd))) }));
  }
  summary.jeonse = summary.sigungu.reduce((a, g) => a + (g.jeonse ?? 0), 0);
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(`[build-index] 시군구 ${regions.length} · 단지 ${total} (정적 ${totalStatic}, 상한 ${STATIC_MAX}, 커트 36개월 ${staticCut}건) · 거래 ${totalTrades} · 전세 ${summary.jeonse} · 중복 aptSeq ${nDup} · 앞자리≠코드 ${Object.keys(summary.idPrefix).length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
