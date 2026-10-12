#!/usr/bin/env node
// 서울시 도시정비사업 통계(TbSeoulRedevStatus) → data/redev/seoul.json  (분기 1회)
//   node scripts/fetch-redev-seoul.mjs
// 키: SEOUL_OPENAPI_KEY (서울 열린데이터광장 인증키). 없으면 건너뛴다(기존 파일 유지).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/regions.mjs';

const KEY = process.env.SEOUL_OPENAPI_KEY;
const FILE = join(ROOT, 'data', 'redev', 'seoul.json');
if (!KEY) { console.log('SEOUL_OPENAPI_KEY 없음 → 서울 정비사업 갱신 건너뜀'); process.exit(0); }

const d = (v) => { v = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
const n = (v) => { const x = parseInt(String(v ?? '').replace(/,/g, ''), 10); return Number.isFinite(x) && x > 0 ? x : null; };
const MAP = [['ZONE_DESIGNATION_INIT_YMD', '구역지정'], ['PROMOTION_COMMITTEE_YMD', '추진위'], ['ASSOCIATION_ESTABLISHMENT_YMD', '조합설립'], ['ARCHITECTURAL_REVIEW_YMD', '건축심의'], ['BIZ_IMPLEMENTATION_INIT_YMD', '사업시행'], ['MGMT_DISPOSITION_INIT_YMD', '관리처분'], ['MIGRATION_START_YMD', '이주시작'], ['CONSTRUCTION_START_YMD', '착공']];

const rows = [];
for (let start = 1; start < 5000; start += 1000) {
  const res = await fetch(`http://openapi.seoul.go.kr:8088/${KEY}/json/TbSeoulRedevStatus/${start}/${start + 999}/`);
  const j = await res.json();
  const body = j.TbSeoulRedevStatus;
  if (!body) { const r = j.RESULT ?? {}; throw new Error(`서울 API 오류 ${r.CODE ?? ''} ${r.MESSAGE ?? JSON.stringify(j).slice(0, 120)}`); }
  for (const r of body.row ?? []) {
    rows.push({ gu: (r.DISTRICT ?? '').trim(), zone: (r.ZONE_NM ?? '').trim(), jibun: (r.JIBUN_ADDR ?? '').trim() || null, road: (r.ROAD_ADDR ?? '').trim() || null,
      type: (r.BIZ_TYPE ?? '').trim(), stage: (r.BIZ_STAGE ?? '').trim(), public: (r.BIZ_METHOD_PUBLIC_PRIVATE ?? '').trim() || null,
      existing: n(r.EXISTING_HOUSEHOLDS), planned: n(r.TOT_BUILT_HOUSEHOLDS), dates: Object.fromEntries(MAP.map(([k, l]) => [l, d(r[k])])) });
  }
  if ((body.row ?? []).length < 1000) break;
}
if (!rows.length) throw new Error('서울 정비사업 데이터 0건');
const prev = JSON.parse(readFileSync(FILE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
writeFileSync(FILE, JSON.stringify({ ...prev, basis: today.slice(0, 7), fetched: today, rows }, null, 1) + '\n');
console.log(`[redev-seoul] ${rows.length}건 갱신`);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=redev-seoul::${rows.length}건 갱신`);
