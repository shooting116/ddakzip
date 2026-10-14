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

import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
      n36: t.rows.length, n12: v12.length, n6: v6.length, price, basis, priceN, priceDate,
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
    if (!cur || d < cur.dist) best.set(s.line, { line: s.line, type: s.type, station: s.name, status: s.status, open: s.open, dist: Math.round(d), approx: !!s.approx });
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist);
}

function kaptOf(info) {
  if (!info) return null;
  const park = (info.parkGround ?? 0) + (info.parkUnder ?? 0);
  return {
    code: info.kaptCode, units: info.units || null, dongs: info.dongs || null, used: info.used || null, topFloor: info.topFloor || null,
    sale: info.sale || null, heat: info.heat || null, hall: info.hall || null, builder: info.builder || null,
    park: park || null, parkUnder: info.parkUnder ?? null, elev: info.elevators ?? null,
    subway: info.subwayLine || info.subwayStation ? `${info.subwayLine ?? ''} ${info.subwayStation ?? ''}`.trim() : null, subwayWalk: info.subwayWalk || null, busWalk: info.busWalk || null,
    ev: (info.evGround ?? 0) + (info.evUnder ?? 0) || null, addr: info.addr || null, road: info.road || null,
  };
}

function main() {
  const t0 = Date.now();
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const asOf = kst.toISOString().slice(0, 10), asOfYm = asOf.slice(0, 7);
  const months = Array.from({ length: MONTHS }, (_, i) => ymAdd(asOfYm, -(MONTHS - 1 - i)));
  const match = loadJson(join(CX, 'match.json'), {});
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
    const complexes = [];
    for (const c of map.values()) {
      const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const s = summarizeComplex(c, asOfYm, months);
      const g = geo[c.id];
      const kapt = kaptOf(match[c.id] ? info[match[c.id].kaptCode] : null);
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
    writeFileSync(join(OUT, 'complexes', `${r.lawd}.json`), JSON.stringify({ lawd: r.lawd, sido: r.sido, sigungu: r.sigungu, regulated: r.regulated, asOf, months, complexes }));
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

  // 요약 집계 + id 앞자리 → 실제 시군구 코드 맵 (앞자리와 다른 경우만)
  for (const g of summary.sigungu) {
    const d = JSON.parse(readFileSync(join(OUT, 'complexes', `${g.lawd}.json`), 'utf8'));
    const complexes = d.complexes;
    const nStatic = complexes.filter((c) => c.static).length;
    const trades = complexes.reduce((s, c) => s + c.n36, 0);
    Object.assign(g, { complexes: complexes.length, static: nStatic, trades36: trades, geo: complexes.filter((c) => c.lat).length, kapt: complexes.filter((c) => c.kapt).length, transit: complexes.filter((c) => c.transit.length).length, redev: complexes.filter((c) => c.redev).length, news: complexes.filter((c) => c.news.length).length });
    for (const c of complexes) {
      const prefix = c.id.split('-')[0];
      if (prefix === g.lawd) continue;
      const list = summary.idPrefix[prefix] ?? (summary.idPrefix[prefix] = []);
      if (!list.includes(g.lawd)) list.push(g.lawd);
    }
    const sd = summary.sido[g.sido] ?? (summary.sido[g.sido] = { complexes: 0, static: 0, trades36: 0 });
    sd.complexes += complexes.length; sd.static += nStatic; sd.trades36 += trades;
    total += complexes.length; totalStatic += nStatic; totalTrades += trades;
  }
  summary.total = { complexes: total, static: totalStatic, trades36: totalTrades };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(`[build-index] 시군구 ${regions.length} · 단지 ${total} (정적 ${totalStatic}) · 거래 ${totalTrades} · 중복 aptSeq ${nDup} · 앞자리≠코드 ${Object.keys(summary.idPrefix).length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
