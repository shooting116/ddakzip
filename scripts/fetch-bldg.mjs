#!/usr/bin/env node
// 국토교통부 건축HUB 건축물대장 수집기 — K-apt에 없는 단지(150세대 미만·미매칭)의 세대수·동수·최고층·사용승인일·주차대수를 채운다.
//
//   node scripts/fetch-bldg.mjs --mode probe --id 11680-314            응답 필드 확인 (총괄표제부 + 표제부)
//   node scripts/fetch-bldg.mjs --mode fill [--max-calls 900] [--max-minutes 40] [--sido 서울] [--retry-miss]
//        K-apt 매칭이 없는 단지(상세 페이지 대상 → 거래 많은 순)를 지번으로 조회 → data/complexes/bldg.json
//
// - 키: DATA_GO_KR_KEY (로그에 찍지 않는다). 쿼터 초과(22)·max-calls·시간 예산에서 멈추고 저장, 다음 실행이 이어서 한다.
// - 단지 1곳 = 총괄표제부 1회 + 표제부 1회(최고층·동수). 총괄표제부가 없으면 표제부만으로 세대수를 합산한다.
// - 조회했지만 못 찾은 단지도 miss로 기록해 매번 다시 두드리지 않는다 (--retry-miss 로 재시도).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serviceKey, getXml, redact, DataGoError } from './lib/datago.mjs';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { groupComplexes } from './lib/trades-index.mjs';
import { parseJibun } from './lib/bldg.mjs';

const BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService';
const CX = join(ROOT, 'data', 'complexes');
const OUT = join(CX, 'bldg.json');
const ROWS = 100;

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const mode = args.mode ?? 'fill';
const maxCalls = Number(args['max-calls'] ?? 900);
const maxMinutes = Number(args['max-minutes'] ?? 40);
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;
const t0 = Date.now();
const outOfTime = () => (Date.now() - t0) / 60000 > maxMinutes;
let calls = 0, stopReason = null;
const notices = [];
const note = (m) => { console.log(m); notices.push(m); };
const num = (s) => { const n = Number(String(s ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };

async function call(key, op, q) {
  const url = `${BASE}/${op}?serviceKey=${key}&${q}&numOfRows=${ROWS}&pageNo=1`;
  calls++;
  return getXml(url);
}
/** 한 지번의 총괄표제부·표제부 → 요약 */
async function lookup(key, bjd, jibun) {
  const pj = parseJibun(jibun);
  if (!pj) return { ok: false, why: '지번 해석 불가' };
  const q = `sigunguCd=${bjd.slice(0, 5)}&bjdongCd=${bjd.slice(5, 10)}&platGbCd=${pj.platGbCd}&bun=${pj.bun}&ji=${pj.ji}`;
  const recap = await call(key, 'getBrRecapTitleInfo', q);
  const title = await call(key, 'getBrTitleInfo', q);
  // 주용도가 아파트/공동주택인 것만 (같은 지번에 상가·부속건물이 섞인다)
  const isApt = (it) => /아파트|공동주택|연립|다세대/.test(`${it.mainPurpsCdNm ?? ''} ${it.etcPurps ?? ''}`);
  const rc = recap.items.filter((it) => isApt(it) || (num(it.hhldCnt) ?? 0) > 0);
  const tt = title.items.filter((it) => isApt(it) || (num(it.hhldCnt) ?? 0) > 0);
  if (!rc.length && !tt.length) return { ok: false, why: `대장 없음 (총괄 ${recap.items.length}·표제 ${title.items.length}건 모두 주택 아님)`, rawRecap: recap.items, rawTitle: title.items };
  const r0 = rc.sort((a, b) => (num(b.hhldCnt) ?? 0) - (num(a.hhldCnt) ?? 0))[0];
  const units = r0 ? num(r0.hhldCnt) : tt.reduce((a, it) => a + (num(it.hhldCnt) ?? 0), 0);
  const mains = tt.filter((it) => (it.mainAtchGbCdNm ?? '').includes('주') || !it.mainAtchGbCdNm);
  const top = mains.length ? Math.max(...mains.map((it) => num(it.grndFlrCnt) ?? 0)) : null;
  const dongs = r0 ? num(r0.mainBldCnt) : (mains.length || null);
  const used = (r0?.useAprDay ?? mains.map((it) => it.useAprDay).filter(Boolean).sort()[0] ?? '').trim() || null;
  return {
    ok: true,
    data: { units: units || null, dongs: dongs || null, topFloor: top || null, used: used && /^\d{8}$/.test(used) ? `${used.slice(0, 4)}-${used.slice(4, 6)}-${used.slice(6, 8)}` : used,
      park: r0 ? (num(r0.totPkngCnt) || null) : null, name: (r0?.bldNm ?? mains[0]?.bldNm ?? '').trim() || null, pk: r0?.mgmBldrgstPk ?? null, recapN: rc.length, titleN: tt.length },
    rawRecap: recap.items, rawTitle: title.items,
  };
}

function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }

async function probe(key) {
  const id = args.id ?? '11680-314';
  const cx = [...groupComplexes({ lawds: [id.split('-')[0]] }).values()].find((c) => c.aptSeq === id);
  if (!cx) throw new Error(`단지 ${id} 를 실거래 데이터에서 찾지 못했습니다`);
  note(`probe ${id} ${cx.apt} · 법정동 ${cx.bjd} ${cx.umdNm} · 지번 ${cx.jibun}`);
  const r = await lookup(key, cx.bjd, cx.jibun);
  note(`결과: ${r.ok ? JSON.stringify(r.data) : r.why}`);
  if (r.rawRecap?.[0]) note(`총괄표제부 필드: ${Object.keys(r.rawRecap[0]).join(',')}`);
  if (r.rawRecap?.[0]) note(`총괄표제부 예: ${JSON.stringify(Object.fromEntries(['bldNm', 'mainPurpsCdNm', 'hhldCnt', 'fmlyCnt', 'hoCnt', 'mainBldCnt', 'totPkngCnt', 'useAprDay', 'platPlc'].map((k) => [k, r.rawRecap[0][k]])))}`);
  if (r.rawTitle?.[0]) note(`표제부 ${r.rawTitle.length}건, 예: ${JSON.stringify(Object.fromEntries(['bldNm', 'dongNm', 'mainAtchGbCdNm', 'mainPurpsCdNm', 'hhldCnt', 'grndFlrCnt', 'ugrndFlrCnt', 'useAprDay'].map((k) => [k, r.rawTitle[0][k]])))}`);
  if (process.env.GITHUB_ACTIONS) for (let i = 0; i < notices.length; i += 3) console.log(`::notice title=bldg probe ${i / 3 + 1}::${notices.slice(i, i + 3).join(' | ')}`);
}

async function fill(key) {
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const match = loadJson(join(CX, 'match.json'), {});
  const bldg = loadJson(OUT, {});
  const STATIC_MIN = 5;
  // 대상: K-apt 매칭 없음 + 아직 조회 안 함(또는 --retry-miss로 miss 재시도). 상세 페이지 대상(36개월 5건↑)을 거래 많은 순으로 먼저
  const todo = [];
  for (const r of regions) {
    for (const c of groupComplexes({ lawds: [r.lawd] }).values()) {
      if (match[c.aptSeq]) continue;
      const prev = bldg[c.aptSeq];
      if (prev && (prev.units || !(args['retry-miss'] === 'true'))) continue;
      if (!c.jibun) continue;
      todo.push({ id: c.aptSeq, bjd: c.bjd, jibun: c.jibun, n: c.n, name: c.apt, sido: r.sido, sigungu: r.sigungu });
    }
  }
  todo.sort((a, b) => (b.n >= STATIC_MIN) - (a.n >= STATIC_MIN) || b.n - a.n);
  console.log(`[bldg fill] 대상 ${todo.length} (상세 대상 ${todo.filter((x) => x.n >= STATIC_MIN).length}) · 이미 ${Object.keys(bldg).length} · max-calls ${maxCalls}`);
  let done = 0, hit = 0;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  for (const t of todo) {
    if (calls + 2 > maxCalls) { stopReason = `max-calls ${maxCalls} 도달`; break; }
    if (outOfTime()) { stopReason = '시간 예산 소진'; break; }
    try {
      const r = await lookup(key, t.bjd, t.jibun);
      bldg[t.id] = r.ok ? { ...r.data, at: today } : { units: null, miss: r.why.slice(0, 60), at: today };
      done++; if (r.ok && r.data.units) hit++;
      if (done % 50 === 0) { console.log(`  ${done}/${todo.length} · 세대수 확보 ${hit} · 호출 ${calls}`); writeFileSync(OUT, JSON.stringify(bldg, null, 0)); }
    } catch (e) {
      if (e instanceof DataGoError && e.quota) { stopReason = '일일 트래픽 초과(22)'; break; }
      if (e instanceof DataGoError && e.fatal) { stopReason = `치명적 오류 ${e.message}`; break; }
      console.warn(`  실패 ${t.sido} ${t.sigungu} ${t.name}: ${redact(e.message)}`);
    }
  }
  // 정렬해 저장 (diff가 읽히도록 id 순)
  writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.keys(bldg).sort().map((k) => [k, bldg[k]])), null, 0) + '\n');
  const line = `[bldg fill] 처리 ${done}/${todo.length} · 세대수 확보 ${hit} · 호출 ${calls}${stopReason ? ` · 중단 ${stopReason}` : ''}`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=bldg fill::${line}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `done=${done}\nhit=${hit}\ncalls=${calls}\nstop=${stopReason ?? ''}\n`, { flag: 'a' });
  if (stopReason?.startsWith('치명적')) process.exit(1);
}

async function main() {
  const key = serviceKey();
  if (mode === 'probe') return probe(key);
  return fill(key);
}
main().catch((e) => { console.error('[fetch-bldg] 오류:', redact(String(e?.stack ?? e))); process.exit(1); });
