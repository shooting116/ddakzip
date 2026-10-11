#!/usr/bin/env node
// 국토교통부 아파트 매매 실거래가(RTMSDataSvcAptTradeDev) 수집기
//
//   node scripts/fetch-trades.mjs --mode backfill --months 36 [--sido 서울,인천] [--max-calls 950]
//   node scripts/fetch-trades.mjs --mode refresh  --months 3
//   node scripts/fetch-trades.mjs --mode probe --codes 12210,12220 --ym 202608,202501   (코드 확인용: 건수만 출력)
//
// - backfill: 매니페스트에 없는 (시군구, 월)만 받는다. 중간에 끊겨도 다음 실행이 이어서 한다.
// - refresh : 최근 n개월을 무조건 다시 받는다 (늦게 신고된 건·해제 건 반영).
// - 일일 트래픽 초과(코드 22)나 --max-calls 도달 시 즉시 멈추고 지금까지 받은 것을 저장한다.
// - 저장: data/trades/{lawd}/{yyyymm}.ndjson (정렬된 한 줄 JSON) + data/trades/_manifest.json
// - 키는 DATA_GO_KR_KEY 환경변수. 로그에 찍지 않는다.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serviceKey, getXml, redact, DataGoError } from './lib/datago.mjs';
import { loadRegions, recentMonths, ROOT } from './lib/regions.mjs';
import { normalize, keyOf, sortRows } from './lib/trades.mjs';

const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const ROWS = 1000;
const OUT = join(ROOT, 'data', 'trades');
const MANIFEST = join(OUT, '_manifest.json');

// ---------- 인자 ----------
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const mode = args.mode ?? 'refresh';
const months = Number(args.months ?? (mode === 'backfill' ? 36 : 3));
const maxCalls = Number(args['max-calls'] ?? 950);
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;
const concurrency = Number(args.concurrency ?? 3);

// ---------- 유틸 ----------
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
async function fetchMonth(key, lawd, ym) {
  const all = [];
  let page = 1, total = Infinity, calls = 0;
  while (all.length < total) {
    const url = `${ENDPOINT}?serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${ROWS}`;
    const r = await getXml(url);
    calls++;
    total = r.totalCount;
    if (r.items.length === 0) break;
    all.push(...r.items);
    if (r.items.length < ROWS) break;
    page++;
  }
  const seen = new Set();
  const rows = [];
  for (const it of all) {
    const row = normalize(it, lawd);
    if (!row) continue;
    const k = keyOf(row);
    if (seen.has(k)) continue;
    seen.add(k); rows.push(row);
  }
  return { rows: sortRows(rows), calls, total };
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return {};
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function saveManifest(mf) {
  mkdirSync(OUT, { recursive: true });
  const sorted = Object.fromEntries(Object.keys(mf).sort().map((k) => [k, Object.fromEntries(Object.keys(mf[k]).sort().map((m) => [m, mf[k][m]]))]));
  writeFileSync(MANIFEST, JSON.stringify(sorted, null, 1) + '\n');
}
function writeMonth(lawd, ym, rows) {
  const dir = join(OUT, lawd);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ym}.ndjson`);
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (prev === text) return false;
  writeFileSync(file, text);
  return true;
}

// ---------- 메인 ----------
async function probe(key) {
  const codes = (args.codes ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const yms = (args.ym ?? recentMonths(2, kstNow()).join(',')).split(',').map((s) => s.trim());
  if (!codes.length) throw new Error('--codes 가 필요합니다');
  const lines = [];
  outer: for (const code of codes) {
    const parts = [];
    for (const ym of yms) {
      try {
        const r = await getXml(`${ENDPOINT}?serviceKey=${key}&LAWD_CD=${code}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1`);
        const first = r.items[0];
        parts.push(`${ym}=${r.totalCount}${first ? `(${first.umdNm ?? ''} ${first.aptNm ?? ''})` : ''}`);
      } catch (e) {
        parts.push(`${ym}=ERR ${e.message}`);
        if (e instanceof DataGoError && (e.quota || e.fatal)) { lines.push(`${code}: ${parts.join(' · ')}`); break outer; }
      }
    }
    lines.push(`${code}: ${parts.join(' · ')}`);
  }
  for (const l of lines) console.log('probe ' + l);
  // Actions에서는 로그 대신 주석(annotation)으로도 남긴다 — API로 읽을 수 있다 (스텝당 10개 제한 → 6줄씩 묶음)
  if (process.env.GITHUB_ACTIONS) {
    for (let i = 0; i < lines.length; i += 6) console.log(`::notice title=probe ${i / 6 + 1}::${lines.slice(i, i + 6).join(' | ')}`);
  }
}

async function main() {
  const key = serviceKey();
  if (mode === 'probe') return probe(key);
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const monthList = recentMonths(months, kstNow());
  const manifest = loadManifest();

  // 작업 목록: (시군구, 월). backfill은 매니페스트에 있으면 건너뛴다.
  const jobs = [];
  for (const ym of monthList) {
    for (const r of regions) {
      if (mode === 'backfill' && manifest[r.lawd]?.[ym]) continue;
      jobs.push({ r, ym });
    }
  }
  console.log(`[fetch-trades] mode=${mode} months=${months} regions=${regions.length} jobs=${jobs.length} max-calls=${maxCalls}`);
  if (!jobs.length) { console.log('할 일이 없습니다.'); return; }

  let calls = 0, done = 0, changed = 0, rowsTotal = 0, stopReason = null;
  let idx = 0;
  const worker = async () => {
    while (idx < jobs.length && !stopReason) {
      if (calls >= maxCalls) { stopReason = `max-calls ${maxCalls} 도달`; break; }
      const { r, ym } = jobs[idx++];
      try {
        const { rows, calls: c, total } = await fetchMonth(key, r.lawd, ym);
        calls += c;
        const w = writeMonth(r.lawd, ym, rows);
        if (w) changed++;
        rowsTotal += rows.length;
        manifest[r.lawd] = manifest[r.lawd] ?? {};
        manifest[r.lawd][ym] = { n: rows.length, at: new Date().toISOString().slice(0, 10) };
        done++;
        if (done % 20 === 0) console.log(`  ${done}/${jobs.length} · calls ${calls} · 마지막 ${r.sido} ${r.sigungu} ${ym} ${rows.length}건${total > rows.length ? ` (원본 ${total})` : ''}`);
      } catch (e) {
        if (e instanceof DataGoError && e.quota) { stopReason = '일일 트래픽 초과(22)'; break; }
        if (e instanceof DataGoError && e.fatal) { stopReason = `치명적 오류 ${e.message}`; break; }
        console.warn(`  실패 ${r.sido} ${r.sigungu} ${ym}: ${e.message}`);
        calls += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  saveManifest(manifest);
  console.log(`[fetch-trades] 완료 ${done}/${jobs.length} · 호출 ${calls} · 파일 변경 ${changed} · 행 ${rowsTotal}${stopReason ? ` · 중단: ${stopReason}` : ''}`);
  // 워크플로우가 읽을 요약
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `done=${done}\njobs=${jobs.length}\ncalls=${calls}\nchanged=${changed}\nstop=${stopReason ?? ''}\n`, { flag: 'a' });
  }
  if (stopReason && stopReason.startsWith('치명적')) process.exit(1);
}

main().catch((e) => { console.error('[fetch-trades] 오류:', redact(String(e?.stack ?? e))); process.exit(1); });
