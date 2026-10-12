#!/usr/bin/env node
// 정비사업(재건축·재개발·리모델링) 현황 ↔ 실거래 단지 매칭 → data/complexes/redev.json
//   node scripts/match-redev.mjs [--report]
// 출처 4종: data/redev/seoul.json(서울시 통계, 지번·이름), newtown1.json(1기 신도시 선도지구, 이름), gyeonggi.json(경기 현황표, 이름), incheon.json(인천 공공데이터, 이름)
// 재개발 구역은 기존 아파트가 없어 매칭하지 않는다(재건축·리모델링만). 수동 보정: data/overrides/redev.json { aptSeq: [row] | null }

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { groupComplexes, nameScore } from './lib/trades-index.mjs';

const DIR = join(ROOT, 'data', 'redev');
const report = process.argv.includes('--report');
const load = (f) => (existsSync(join(DIR, f)) ? JSON.parse(readFileSync(join(DIR, f), 'utf8')) : { rows: [] });
const seoul = load('seoul.json'), nt = load('newtown1.json'), gg = load('gyeonggi.json'), ic = load('incheon.json');
const overrides = existsSync(join(ROOT, 'data', 'overrides', 'redev.json')) ? JSON.parse(readFileSync(join(ROOT, 'data', 'overrides', 'redev.json'), 'utf8')) : {};

const regions = loadRegions();
const bySigungu = (sido, name) => regions.filter((r) => r.sido === sido && r.sigungu === name);
const cache = new Map();
const complexesOf = (lawd) => { if (!cache.has(lawd)) cache.set(lawd, [...groupComplexes({ lawds: [lawd] }).values()]); return cache.get(lawd); };

const out = {};   // aptSeq → [entry]
const stats = { seoul: 0, newtown1: 0, gyeonggi: 0, incheon: 0, low: [] };
function add(aptSeq, entry) { (out[aptSeq] ??= []).push(entry); }
const cleanName = (s) => String(s).replace(/\s*(아파트|APT|A)$/i, '').replace(/\(.*?\)/g, '').trim();

// 1) 서울: 재건축만. 지번(법정동+본번) 일치 우선, 그다음 이름 유사도
const jb = (addr) => { const m = String(addr ?? '').replace(/번지/g, '').match(/([가-힣0-9]+동)\s*(\d+)(?:-(\d+))?/); return m ? { umd: m[1], bon: m[2], bubun: m[3] ?? null } : null; };
for (const row of seoul.rows) {
  if (!/재건축/.test(row.type)) continue;
  const regs = bySigungu('서울', row.gu);
  if (!regs.length) continue;
  const cs = complexesOf(regs[0].lawd);
  const j = jb(row.jibun);
  let best = null, by = null;
  if (j) {
    const hit = cs.filter((c) => c.umdNm === j.umd && String(c.jibun).split('-')[0] === j.bon);
    if (hit.length === 1) { best = hit[0]; by = 'jibun'; }
    else if (hit.length > 1) { best = hit.map((c) => ({ c, s: nameScore(row.zone, c.apt) })).sort((a, b) => b.s - a.s)[0].c; by = 'jibun+name'; }
  }
  if (!best) {
    const scored = cs.map((c) => ({ c, s: nameScore(cleanName(row.zone), c.apt) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.6) { best = scored[0].c; by = 'name'; }
    else if (scored[0] && scored[0].s >= 0.45) stats.low.push(`서울 ${row.gu} ${row.zone} ~ ${scored[0].c.apt} ${scored[0].s.toFixed(2)}`);
  }
  if (!best) continue;
  const stageDate = Object.entries(row.dates).filter(([, v]) => v).sort((a, b) => b[1].localeCompare(a[1]))[0];
  add(best.aptSeq, { program: '서울시 정비사업', zone: row.zone, type: row.type, stage: row.stage, stageDate: stageDate ? stageDate[1].slice(0, 7) : null, planned: row.planned, existing: row.existing, source: seoul.source_url, sourceDate: seoul.basis, by });
  stats.seoul++;
}

// 2) 1기 신도시 선도지구: 이름
const ntSig = nt.sigungu ?? {};
for (const row of nt.rows ?? []) {
  const sigs = [].concat(ntSig[row.city] ?? []);
  const lawds = sigs.flatMap((s) => bySigungu('경기', s).map((r) => r.lawd));
  const cs = lawds.flatMap(complexesOf);
  for (const name of row.complexes) {
    const scored = cs.map((c) => ({ c, s: Math.max(nameScore(name, c.apt), ...c.aliases.map((a) => nameScore(name, a))) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.55) {
      add(scored[0].c.aptSeq, { program: '1기 신도시 선도지구', zone: row.zone, type: '재건축(노후계획도시 특별정비)', stage: row.stage, stageDate: row.stage_date, planned: row.units_planned, existing: row.units, source: row.source, sourceDate: row.source_date, by: `name ${scored[0].s.toFixed(2)}` });
      stats.newtown1++;
    } else if (scored[0]) stats.low.push(`1기 ${row.city} ${name} ~ ${scored[0].c.apt} ${scored[0].s.toFixed(2)}`);
  }
}

// 3) 경기 현황표: 이름 (complexes 가 있는 행만)
for (const row of gg.rows ?? []) {
  if (!row.complexes?.length) continue;
  const regs = bySigungu('경기', row.sigungu);
  const cs = regs.flatMap((r) => complexesOf(r.lawd));
  for (const name of row.complexes) {
    const scored = cs.map((c) => ({ c, s: Math.max(nameScore(name, c.apt), ...c.aliases.map((a) => nameScore(name, a))) })).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.55) {
      add(scored[0].c.aptSeq, { program: '경기 정비사업', zone: row.name, type: row.type, stage: row.stage, stageDate: row.stage_date, planned: row.units_planned, existing: null, source: row.source, sourceDate: row.source_date, by: `name ${scored[0].s.toFixed(2)}` });
      stats.gyeonggi++;
    } else if (scored[0]) stats.low.push(`경기 ${row.sigungu} ${name} ~ ${scored[0].c.apt} ${scored[0].s.toFixed(2)}`);
  }
}

// 4) 인천 공공데이터: 재건축·리모델링 행의 구역명(…A, …아파트)으로 이름 매칭. 구 이름은 2026-07 개편 전(중구·동구·서구)일 수 있어 새 구로 넓힌다
const icMap = { 중구: ['제물포구', '영종구'], 동구: ['제물포구'], 서구: ['서해구', '검단구'] };
for (const row of ic.rows ?? []) {
  if (!/재건축|리모델링/.test(row.type)) continue;
  if (/준공|후보지|사업지선정/.test(row.stage)) continue;
  const gus = icMap[row.gu] ?? [row.gu];
  const cs = gus.flatMap((g) => bySigungu('인천', g)).flatMap((r) => complexesOf(r.lawd));
  const name = cleanName(row.zone);
  const scored = cs.map((c) => ({ c, s: Math.max(nameScore(name, c.apt), ...c.aliases.map((a) => nameScore(name, a))) })).sort((a, b) => b.s - a.s);
  if (scored[0] && scored[0].s >= 0.55) {
    add(scored[0].c.aptSeq, { program: '인천 정비사업', zone: row.zone, type: row.type, stage: row.stage, stageDate: null, planned: null, existing: null, source: ic.source_url, sourceDate: ic.basis, by: `name ${scored[0].s.toFixed(2)}` });
    stats.incheon++;
  } else if (scored[0] && scored[0].s >= 0.4) stats.low.push(`인천 ${row.gu} ${row.zone} ~ ${scored[0].c.apt} ${scored[0].s.toFixed(2)}`);
}

// 5) 수동 보정: null 이면 제거, 배열이면 교체
for (const [k, v] of Object.entries(overrides)) { if (v == null) delete out[k]; else out[k] = v; }

writeFileSync(join(ROOT, 'data', 'complexes', 'redev.json'), JSON.stringify(Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]])), null, 1) + '\n');
const line = `정비사업 매칭 단지 ${Object.keys(out).length} (서울 ${stats.seoul} · 1기신도시 ${stats.newtown1} · 경기 ${stats.gyeonggi} · 인천 ${stats.incheon})`;
console.log('[match-redev] ' + line);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=redev::${line}`);
if (report) { console.log('--- 점수 낮아 제외 (검토용)'); for (const l of stats.low) console.log('  ' + l); }
