#!/usr/bin/env node
// K-apt(공동주택관리정보시스템) 단지 마스터 수집기
//
//   node scripts/fetch-complexes.mjs --mode probe                      엔드포인트·승인 확인 (시군구 1곳 + 단지 1곳)
//   node scripts/fetch-complexes.mjs --mode list  [--sido 서울]         시군구별 단지 목록 → data/complexes/list/{lawd}.json
//   node scripts/fetch-complexes.mjs --mode info  [--sido 서울] [--max-calls 900] [--all]
//        실거래에 등장하는 단지와 이름이 맞는 K-apt 단지의 기본정보(+상세) → data/complexes/info/{lawd}.json
//
// - 키: DATA_GO_KR_KEY. 로그에 찍지 않는다.
// - 쿼터 초과(22)·max-calls 도달 시 멈추고 저장. 다음 실행이 이어서 한다 (data/complexes/_manifest.json).

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { serviceKey, getXml, redact, DataGoError } from './lib/datago.mjs';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { groupComplexes, dice, normName } from './lib/trades-index.mjs';

const BASE = 'https://apis.data.go.kr/1613000';
// 목록 서비스는 버전이 바뀌어 왔으므로 후보를 순서대로 시도한다
const LIST_CANDIDATES = ['AptListService4/getSigunguAptList4', 'AptListService3/getSigunguAptList3', 'AptListService4/getSigunguAptList', 'AptListService3/getSigunguAptList', 'AptListService2/getSigunguAptList', 'AptListService5/getSigunguAptList5'];
const BASS_CANDIDATES = ['AptBasisInfoServiceV5/getAphusBassInfoV5', 'AptBasisInfoServiceV4/getAphusBassInfoV4', 'AptBasisInfoServiceV3/getAphusBassInfoV3', 'AptBasisInfoServiceV5/getAphusBassInfo', 'AptBasisInfoService/getAphusBassInfo'];
const DTL_CANDIDATES = ['AptBasisInfoServiceV5/getAphusDtlInfoV5', 'AptBasisInfoServiceV4/getAphusDtlInfoV4', 'AptBasisInfoServiceV3/getAphusDtlInfoV3', 'AptBasisInfoServiceV5/getAphusDtlInfo', 'AptBasisInfoService/getAphusDtlInfo'];
const OUT = join(ROOT, 'data', 'complexes');
const MANIFEST = join(OUT, '_manifest.json');
const ROWS = 100;

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const mode = args.mode ?? 'probe';
const maxCalls = Number(args['max-calls'] ?? 900);
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;
const withDetail = args.detail !== 'false';
const all = args.all === 'true';

let calls = 0;
let stopReason = null;
const notices = [];
const note = (s) => { console.log(s); notices.push(s); };

function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }
function saveJson(p, v) { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); }

/** 후보 경로 중 처음 성공하는 것을 기억해 쓴다 */
const resolved = loadJson(join(OUT, '_endpoints.json'), {});
async function callFirst(kind, candidates, query) {
  const key = serviceKey();
  const order = resolved[kind] ? [resolved[kind], ...candidates.filter((c) => c !== resolved[kind])] : candidates;
  let lastErr;
  for (const path of order) {
    try {
      const r = await getXml(`${BASE}/${path}?serviceKey=${key}&${query}`);
      calls++;
      if (resolved[kind] !== path) { resolved[kind] = path; saveJson(join(OUT, '_endpoints.json'), resolved); }
      return r;
    } catch (e) {
      calls++;
      lastErr = e;
      if (mode === 'probe') note(`  시도 ${path}: ${redact(e.message)}`);
      if (e instanceof DataGoError && e.quota) throw e;
      // 미등록(30)·경로 없음(12) 등은 다음 후보로
    }
  }
  throw lastErr;
}

const n = (v) => { const x = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(x) && String(v ?? '').trim() !== '' ? x : null; };
const s = (v) => { const t = String(v ?? '').trim(); return t || null; };

function normBass(it) {
  return {
    kaptCode: s(it.kaptCode), name: s(it.kaptName), bjd: s(it.bjdCode), addr: s(it.kaptAddr), road: s(it.doroJuso),
    sale: s(it.codeSaleNm), heat: s(it.codeHeatNm), hall: s(it.codeHallNm), type: s(it.codeAptNm), mgr: s(it.codeMgrNm),
    units: n(it.kaptdaCnt), dongs: n(it.kaptDongCnt), topFloor: n(it.kaptTopFloor), baseFloor: n(it.kaptBaseFloor), ho: n(it.hoCnt),
    used: s(it.kaptUsedate), builder: s(it.kaptBcompany), developer: s(it.kaptAcompany),
    areaTotal: n(it.kaptTarea), areaMgmt: n(it.kaptMarea), areaPriv: n(it.privArea),
    units60: n(it.kaptMparea60), units85: n(it.kaptMparea85), units135: n(it.kaptMparea135), units136: n(it.kaptMparea136),
    zip: s(it.zipcode), url: s(it.kaptUrl),
  };
}
function normDtl(it) {
  return {
    parkGround: n(it.kaptdPcnt), parkUnder: n(it.kaptdPcntu), elevators: n(it.kaptdEcnt), cctv: n(it.kaptdCccnt),
    subwayLine: s(it.subwayLine), subwayStation: s(it.subwayStation), subwayWalk: s(it.kaptdWtimesub), busWalk: s(it.kaptdWtimebus),
    edu: s(it.educationFacility), conv: s(it.convenientFacility), welfare: s(it.welfareFacility),
    security: s(it.codeSec), guardCnt: n(it.kaptdScnt), cleanCnt: n(it.kaptdClcnt), fire: s(it.codeFalarm), water: s(it.codeWsupply), evGround: n(it.groundElChargerCnt), evUnder: n(it.undergroundElChargerCnt),
  };
}

async function fetchList(lawd) {
  const out = [];
  let page = 1, total = Infinity;
  while (out.length < total) {
    const r = await callFirst('list', LIST_CANDIDATES, `sigunguCode=${lawd}&pageNo=${page}&numOfRows=${ROWS}`);
    total = r.totalCount;
    if (!r.items.length) break;
    for (const it of r.items) out.push({ kaptCode: s(it.kaptCode), name: s(it.kaptName), bjd: s(it.bjdCode), as1: s(it.as1), as2: s(it.as2), as3: s(it.as3), as4: s(it.as4) });
    if (r.items.length < ROWS) break;
    page++;
  }
  return { list: out.filter((x) => x.kaptCode), total };
}

async function probe() {
  const lawd = args.lawd ?? '11680';
  let code = args.kapt ?? null;
  try {
    const { list, total } = await fetchList(lawd);
    note(`list ${lawd}: ${resolved.list} → ${total}건, 예: ${list.slice(0, 3).map((x) => `${x.kaptCode} ${x.name} (${x.bjd})`).join(' / ')}`);
    code = code ?? list[0]?.kaptCode;
  } catch (e) {
    note(`list 실패: ${redact(e.message)}`);
  }
  try {
    if (code) {
      const b = await callFirst('bass', BASS_CANDIDATES, `kaptCode=${code}`);
      const bb = normBass(b.items[0] ?? {});
      note(`bass ${code}: ${resolved.bass} → ${bb.name} · ${bb.addr} · 세대 ${bb.units} · 동 ${bb.dongs} · 사용승인 ${bb.used} · 최고층 ${bb.topFloor} · 분양 ${bb.sale}`);
      const d = await callFirst('dtl', DTL_CANDIDATES, `kaptCode=${code}`);
      const dd = normDtl(d.items[0] ?? {});
      note(`dtl ${code}: ${resolved.dtl} → 주차 지상 ${dd.parkGround} 지하 ${dd.parkUnder} · 승강기 ${dd.elevators} · 지하철 ${dd.subwayLine} ${dd.subwayStation} 도보 ${dd.subwayWalk}`);
      note(`bass 원본 필드: ${Object.keys(b.items[0] ?? {}).join(',')}`);
      note(`dtl 원본 필드: ${Object.keys(d.items[0] ?? {}).join(',')}`);
    }
  } catch (e) {
    note(`probe 실패: ${redact(e.message)}`);
  }
}

async function listMode() {
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  let done = 0;
  for (const r of regions) {
    if (calls >= maxCalls) { stopReason = `max-calls ${maxCalls} 도달`; break; }
    const file = join(OUT, 'list', `${r.lawd}.json`);
    if (existsSync(file) && args.force !== 'true') { done++; continue; }
    try {
      const { list } = await fetchList(r.lawd);
      saveJson(file, list);
      done++;
      console.log(`  ${r.sido} ${r.sigungu} ${r.lawd}: ${list.length}단지`);
    } catch (e) {
      if (e instanceof DataGoError && e.quota) { stopReason = '일일 트래픽 초과(22)'; break; }
      console.warn(`  실패 ${r.sido} ${r.sigungu}: ${redact(e.message)}`);
    }
  }
  console.log(`[complexes list] ${done}/${regions.length} · 호출 ${calls}${stopReason ? ` · 중단 ${stopReason}` : ''}`);
}

/** 실거래 단지와 K-apt 목록을 같은 법정동 안에서 이름으로 맞춰 본다 */
function candidateKaptCodes(lawd) {
  const list = loadJson(join(OUT, 'list', `${lawd}.json`), []);
  if (all) return list.map((x) => x.kaptCode);
  const traded = [...groupComplexes({ lawds: [lawd] }).values()];
  const byBjd = new Map();
  for (const k of list) { if (!byBjd.has(k.bjd)) byBjd.set(k.bjd, []); byBjd.get(k.bjd).push(k); }
  const picked = new Set();
  for (const t of traded) {
    const pool = byBjd.get(t.bjd) ?? [];
    for (const k of pool) {
      const score = Math.max(dice(t.apt, k.name), ...t.aliases.map((a) => dice(a, k.name)));
      if (score >= 0.45) picked.add(k.kaptCode);
    }
  }
  return [...picked];
}

async function infoMode() {
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const manifest = loadJson(MANIFEST, {});
  let done = 0, skipped = 0;
  outer: for (const r of regions) {
    const file = join(OUT, 'info', `${r.lawd}.json`);
    const info = loadJson(file, {});
    const codes = candidateKaptCodes(r.lawd);
    let changed = false;
    for (const code of codes) {
      const m = manifest[code] ?? {};
      if (m.bass && (!withDetail || m.dtl)) { skipped++; continue; }
      if (calls >= maxCalls) { stopReason = `max-calls ${maxCalls} 도달`; break outer; }
      try {
        if (!m.bass) {
          const b = await callFirst('bass', BASS_CANDIDATES, `kaptCode=${code}`);
          if (b.items[0]) { info[code] = { ...(info[code] ?? {}), ...normBass(b.items[0]) }; m.bass = new Date().toISOString().slice(0, 10); changed = true; }
          else { m.bass = 'empty'; }
        }
        if (withDetail && !m.dtl) {
          const d = await callFirst('dtl', DTL_CANDIDATES, `kaptCode=${code}`);
          if (d.items[0]) { info[code] = { ...(info[code] ?? {}), ...normDtl(d.items[0]) }; changed = true; }
          m.dtl = d.items[0] ? new Date().toISOString().slice(0, 10) : 'empty';
        }
        manifest[code] = m;
        done++;
      } catch (e) {
        if (e instanceof DataGoError && e.quota) { stopReason = '일일 트래픽 초과(22)'; break outer; }
        console.warn(`  실패 ${code}: ${redact(e.message)}`);
      }
    }
    if (changed) saveJson(file, Object.fromEntries(Object.keys(info).sort().map((k) => [k, info[k]])));
    console.log(`  ${r.sido} ${r.sigungu}: 후보 ${codes.length} · 누적 완료 ${done} · 건너뜀 ${skipped} · 호출 ${calls}`);
  }
  // 중단돼도 지금까지 받은 시군구 파일은 위에서 저장됐고, 매니페스트는 여기서
  saveJson(MANIFEST, manifest);
  console.log(`[complexes info] 완료 ${done} · 건너뜀 ${skipped} · 호출 ${calls}${stopReason ? ` · 중단 ${stopReason}` : ''}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (mode === 'probe') await probe();
  else if (mode === 'list') await listMode();
  else if (mode === 'info') await infoMode();
  else throw new Error(`알 수 없는 모드 ${mode}`);
  if (process.env.GITHUB_ACTIONS) {
    for (let i = 0; i < notices.length; i += 4) console.log(`::notice title=complexes ${i / 4 + 1}::${notices.slice(i, i + 4).join(' | ')}`);
  }
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `calls=${calls}\nstop=${stopReason ?? ''}\n`, { flag: 'a' });
}

main().catch((e) => { console.error('[fetch-complexes] 오류:', redact(String(e?.stack ?? e))); process.exit(1); });
