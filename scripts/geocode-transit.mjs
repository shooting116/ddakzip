#!/usr/bin/env node
// 교통 호재 규칙표(data/transit/lines.json)의 역 좌표를 카카오 키워드 검색으로 채운다 → data/transit/stations.json
//   node scripts/geocode-transit.mjs [--force]
// 키: KAKAO_REST_KEY. 이미 좌표가 있는 역은 건너뛴다(--force 면 다시).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/regions.mjs';

const KEY = process.env.KAKAO_REST_KEY;
if (!KEY) { console.error('KAKAO_REST_KEY 환경변수가 없습니다'); process.exit(1); }
const force = process.argv.includes('--force');
const LINES = JSON.parse(readFileSync(join(ROOT, 'data', 'transit', 'lines.json'), 'utf8'));
const OUT = join(ROOT, 'data', 'transit', 'stations.json');
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { stations: [] };
const prevMap = new Map(prev.stations.map((s) => [`${s.line}|${s.name}`, s]));

async function keyword(q) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams({ query: q, size: 5 })}`, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const docs = j.documents ?? [];
  // 역 검색이면 지하철역 카테고리 우선
  const st = docs.find((d) => /지하철|전철|기차역|철도/.test(d.category_name ?? '')) ?? docs[0];
  return st ? { lat: +Number(st.y).toFixed(6), lng: +Number(st.x).toFixed(6), place: st.place_name, addr: st.address_name } : null;
}

async function address(q) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: q, size: 1 })}`, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = (await res.json()).documents?.[0];
  return d ? { lat: +Number(d.y).toFixed(6), lng: +Number(d.x).toFixed(6), place: d.address_name, addr: d.address_name } : null;
}

const out = [];
let calls = 0, miss = [];
for (const line of LINES.lines) {
  for (const s of line.stations) {
    const k = `${line.line}|${s.name}`;
    const base = { line: line.line, type: line.type, lineStatus: line.status, name: s.name, status: s.status, open: s.open ?? line.open_target ?? null, approx: !!s.approx };
    const q = s.near ?? s.addr;
    if (!force && prevMap.get(k)?.lat && prevMap.get(k)?.query === q) { out.push({ ...base, ...pick(prevMap.get(k)) }); continue; }
    if (!q) { out.push({ ...base, lat: null, lng: null, place: null }); miss.push(`${k} (위치 미확정)`); continue; }
    try {
      calls++;
      const hit = s.near ? await keyword(s.near) : await address(s.addr);
      if (hit) out.push({ ...base, ...hit, query: q });
      else { out.push({ ...base, lat: null, lng: null, place: null, query: q }); miss.push(k); }
    } catch (e) { out.push({ ...base, lat: null, lng: null, place: null, query: q }); miss.push(`${k} (${e.message})`); }
    await new Promise((r) => setTimeout(r, 120));
  }
}
function pick(p) { return { lat: p.lat, lng: p.lng, place: p.place, addr: p.addr, query: p.query }; }
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), radius_m: LINES.radius_m, stations: out }, null, 1) + '\n');
const ok = out.filter((s) => s.lat).length;
const line = `역 ${out.length} · 좌표 ${ok} · 호출 ${calls}${miss.length ? ` · 실패 ${miss.length}: ${miss.slice(0, 12).join(', ')}` : ''}`;
console.log('[geocode-transit] ' + line);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=transit::${line}`);
// 검색 결과 검토용 (역명 ↔ 찾은 장소명)
for (const s of out.filter((x) => x.lat)) console.log(`  ${s.line} ${s.name} ← ${s.place} (${s.addr})`);
