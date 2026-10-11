#!/usr/bin/env node
// 실거래 단지 좌표 생성 (카카오 로컬 API)
//
//   node scripts/geocode.mjs [--sido 서울] [--max-calls 20000] [--mode probe]
//
// - 단지(aptSeq)마다 "시도 시군구 읍면동 지번" 주소 검색 → 실패 시 키워드 검색(단지명) → 실패 시 K-apt 도로명주소
// - 결과: data/complexes/geo.json  { aptSeq: { lat, lng, addr, by, at } }  (이미 있는 단지는 건너뜀)
// - 키: KAKAO_REST_KEY (REST API 키). 로그에 찍지 않는다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { groupComplexes } from './lib/trades-index.mjs';

const OUT = join(ROOT, 'data', 'complexes');
const GEO = join(OUT, 'geo.json');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const mode = args.mode ?? 'run';
const maxCalls = Number(args['max-calls'] ?? 20000);
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;
const concurrency = Number(args.concurrency ?? 4);

const KEY = process.env.KAKAO_REST_KEY;
if (!KEY) { console.error('KAKAO_REST_KEY 환경변수가 없습니다'); process.exit(1); }

const SIDO_FULL = { 서울: '서울특별시', 경기: '경기도', 인천: '인천광역시', 부산: '부산광역시', 대구: '대구광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시' };

let calls = 0, stopReason = null;
async function kakao(path, query) {
  calls++;
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}?${new URLSearchParams(query)}`, { headers: { Authorization: `KakaoAK ${KEY}` } });
  if (res.status === 429) { stopReason = '카카오 일일 쿼터 초과(429)'; throw new Error('429'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function byAddress(q) {
  const j = await kakao('address.json', { query: q, size: 1 });
  const d = j.documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x), addr: d.address_name } : null;
}
async function byKeyword(q, x, y) {
  const query = { query: q, size: 3 };
  if (x && y) Object.assign(query, { x, y, radius: 3000 });
  const j = await kakao('keyword.json', query);
  const d = j.documents?.find((p) => /아파트|공동주택|apartment/i.test(p.category_name ?? '') || /아파트|APT/i.test(p.place_name ?? '')) ?? j.documents?.[0];
  return d ? { lat: Number(d.y), lng: Number(d.x), addr: d.address_name, place: d.place_name } : null;
}

function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }

async function main() {
  mkdirSync(OUT, { recursive: true });
  const regions = loadRegions();
  const byLawd = Object.fromEntries(regions.map((r) => [r.lawd, r]));
  const lawds = regions.filter((r) => !sidoFilter || sidoFilter.includes(r.sido)).map((r) => r.lawd);
  const complexes = [...groupComplexes({ lawds }).values()];
  const geo = loadJson(GEO, {});

  if (mode === 'probe') {
    const c = complexes[0];
    const r = byLawd[c.lawd];
    const q = `${SIDO_FULL[r.sido]} ${r.sigungu} ${c.umdNm} ${c.jibun}`;
    console.log('probe', q, '→', JSON.stringify(await byAddress(q)));
    console.log('probe keyword', c.apt, '→', JSON.stringify(await byKeyword(`${r.sigungu} ${c.umdNm} ${c.apt}`)));
    return;
  }

  const todo = complexes.filter((c) => !geo[c.aptSeq]);
  console.log(`[geocode] 단지 ${complexes.length} · 이미 있음 ${complexes.length - todo.length} · 할 일 ${todo.length}`);
  let i = 0, ok = 0, fail = 0;
  const today = new Date().toISOString().slice(0, 10);
  const worker = async () => {
    while (i < todo.length && !stopReason) {
      if (calls >= maxCalls) { stopReason = `max-calls ${maxCalls} 도달`; break; }
      const c = todo[i++];
      const r = byLawd[c.lawd];
      const sigungu = r.sigungu.replace(/\s+/g, ' ');
      try {
        let hit = null, by = null;
        if (c.jibun) { hit = await byAddress(`${SIDO_FULL[r.sido]} ${sigungu} ${c.umdNm} ${c.jibun}`); by = 'jibun'; }
        if (!hit) { hit = await byKeyword(`${sigungu} ${c.umdNm} ${c.apt}`); by = 'keyword'; }
        if (!hit && c.jibun) { hit = await byAddress(`${sigungu} ${c.umdNm} ${c.jibun.split('-')[0]}`); by = 'jibun-bon'; }
        if (hit) { geo[c.aptSeq] = { lat: +hit.lat.toFixed(6), lng: +hit.lng.toFixed(6), addr: hit.addr, by, at: today }; ok++; }
        else { geo[c.aptSeq] = { lat: null, lng: null, by: 'none', at: today }; fail++; }
      } catch (e) {
        if (e.message === '429') break;
        fail++;
        console.warn(`  실패 ${c.aptSeq} ${c.apt}: ${e.message}`);
      }
      if ((ok + fail) % 500 === 0) console.log(`  ${ok + fail}/${todo.length} · 성공 ${ok} · 실패 ${fail} · 호출 ${calls}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync(GEO, JSON.stringify(Object.fromEntries(Object.keys(geo).sort().map((k) => [k, geo[k]])), null, 0).replace(/},"/g, '},\n"') + '\n');
  console.log(`[geocode] 완료 성공 ${ok} · 실패 ${fail} · 호출 ${calls}${stopReason ? ` · 중단 ${stopReason}` : ''}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `calls=${calls}\nstop=${stopReason ?? ''}\n`, { flag: 'a' });
}

main().catch((e) => { console.error('[geocode] 오류:', String(e?.stack ?? e).replace(KEY, '***')); process.exit(1); });
