#!/usr/bin/env node
// 한국부동산원 R-ONE 부동산통계 Open API 수집기 — 주간 아파트 매매가격지수(시군구) → data/rone/weekly.json
//
//   node scripts/fetch-rone.mjs --mode tables [--q 주간]          통계표 목록에서 이름에 q가 들어간 표 찾기 (STATBL_ID 확인용)
//   node scripts/fetch-rone.mjs --mode probe --tbl A_2024_00045     한 표의 최근 데이터 몇 줄과 필드명 출력
//   node scripts/fetch-rone.mjs --mode weekly --tbl <ID> [--weeks 110]   주간 지수 받아 저장 (기존 파일에 이어 붙임)
//
// - 키: RONE_KEY 환경변수. 로그에 찍지 않는다.
// - 응답은 JSON(Type=json). 표 구조: SttsApiTblData → row[] { WRTTIME_IDTFR_ID(기간), CLS_NM(지역), ITM_NM(항목), DTA_VAL(값), CLS_FULLNM, ... }

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/regions.mjs';

const BASE = 'https://www.reb.or.kr/r-one/openapi';
const OUT = join(ROOT, 'data', 'rone');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const mode = args.mode ?? 'tables';
const key = process.env.RONE_KEY;
if (!key) { console.error('RONE_KEY 환경변수가 없습니다'); process.exit(1); }
const notices = [];
const note = (m) => { console.log(m); notices.push(m); };
const redact = (s) => String(s).replace(/KEY=[^&\s]+/g, 'KEY=***');

async function getJson(path, params) {
  const url = `${BASE}/${path}?KEY=${key}&Type=json&${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`JSON 아님: ${text.slice(0, 160).replace(/\s+/g, ' ')}`); }
  // 오류 응답: { RESULT: { CODE, MESSAGE } } 또는 { SttsApiTblData: [ {head:[{RESULT:{CODE,MESSAGE}}]}, {row:[...]} ] }
  if (j.RESULT && j.RESULT.CODE && j.RESULT.CODE !== 'INFO-000') throw new Error(`${j.RESULT.CODE} ${j.RESULT.MESSAGE}`);
  const root = j[path.replace('.do', '')] ?? j[Object.keys(j)[0]];
  if (!Array.isArray(root)) return { head: null, rows: [] };
  const head = root[0]?.head ?? null;
  const code = head?.find((h) => h.RESULT)?.RESULT;
  if (code && code.CODE !== 'INFO-000') throw new Error(`${code.CODE} ${code.MESSAGE}`);
  const rows = root[1]?.row ?? [];
  const total = Number(head?.find((h) => h.list_total_count != null)?.list_total_count ?? rows.length);
  return { head, rows, total };
}

async function tables() {
  const q = args.q ?? '주간';
  const all = [];
  for (let p = 1; p <= 10; p++) {
    const { rows, total } = await getJson('SttsApiTbl.do', { pIndex: p, pSize: 1000 });
    all.push(...rows);
    if (all.length >= total || !rows.length) break;
  }
  const hit = all.filter((r) => JSON.stringify(r).includes(q));
  note(`통계표 ${all.length}개 중 "${q}" 포함 ${hit.length}개`);
  for (const r of hit.slice(0, 40)) note(`${r.STATBL_ID} · ${r.STATBL_NM} · 주기 ${r.DTACYCLE_CD ?? ''} · ${r.CLS_NM ?? ''} ${r.SCLS_NM ?? ''}`.trim());
  if (hit[0]) note(`필드: ${Object.keys(hit[0]).join(',')}`);
}

async function probe() {
  const tbl = args.tbl; if (!tbl) throw new Error('--tbl 이 필요합니다');
  const { rows, total, head } = await getJson('SttsApiTblData.do', { STATBL_ID: tbl, DTACYCLE_CD: args.cycle ?? 'WK', pIndex: 1, pSize: 50 });
  note(`${tbl}: 총 ${total}행 · 받은 ${rows.length}행`);
  if (rows[0]) note(`필드: ${Object.keys(rows[0]).join(',')}`);
  for (const r of rows.slice(0, 12)) note(`${r.WRTTIME_IDTFR_ID ?? r.WRTTIME_DESC ?? ''} | ${r.CLS_FULLNM ?? r.CLS_NM ?? ''} | ${r.ITM_FULLNM ?? r.ITM_NM ?? ''} | ${r.DTA_VAL}`);
  if (head) note(`head: ${JSON.stringify(head).slice(0, 300)}`);
}

async function weekly() {
  const tbl = args.tbl ?? 'T244183132827305'; // (주) 매매가격지수 — 2026-10 probe로 확인
  const weeks = Number(args.weeks ?? 110);
  const cycle = args.cycle ?? 'WK';
  const SIDOS = ['전국', '서울', '인천', '경기', '부산', '대구', '대전', '광주', '울산', '세종'];
  mkdirSync(OUT, { recursive: true });
  // 행은 기간 오름차순으로 정렬돼 있어, 마지막 페이지부터 거꾸로 받아 최근 weeks주만 모은다
  const first = await getJson('SttsApiTblData.do', { STATBL_ID: tbl, DTACYCLE_CD: cycle, pIndex: 1, pSize: 1 });
  const total = first.total, SIZE = 1000, lastPage = Math.max(1, Math.ceil(total / SIZE));
  const rows = []; const periods = new Set(); let calls = 1;
  for (let p = lastPage; p >= 1; p--) {
    const r = await getJson('SttsApiTblData.do', { STATBL_ID: tbl, DTACYCLE_CD: cycle, pIndex: p, pSize: SIZE }); calls++;
    for (const x of r.rows) { rows.push(x); periods.add(x.WRTTIME_IDTFR_ID); }
    if (periods.size > weeks + 1) break;
    if (calls > 80) break;
  }
  const keepList = [...periods].sort().slice(-weeks);
  const keep = new Set(keepList);
  const series = {}, labels = {};
  let n = 0;
  for (const r of rows) {
    if (!keep.has(r.WRTTIME_IDTFR_ID)) continue;
    if ((r.ITM_NM ?? '').trim() !== '지수') continue;
    const full = (r.CLS_FULLNM ?? r.CLS_NM ?? '').trim();
    if (!SIDOS.includes(full.split('>')[0])) continue;
    const val = Number(r.DTA_VAL);
    if (!full || !Number.isFinite(val)) continue;
    (series[full] ??= {})[r.WRTTIME_IDTFR_ID] = +val.toFixed(2); n++;
    if (r.WRTTIME_DESC && !labels[r.WRTTIME_IDTFR_ID]) labels[r.WRTTIME_IDTFR_ID] = String(r.WRTTIME_DESC).trim();
  }
  const out = { source: '한국부동산원 R-ONE 주간 아파트 매매가격지수 (STATBL ' + tbl + ')', tbl, cycle, updated: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), periods: keepList, labels, series };
  writeFileSync(join(OUT, 'weekly.json'), JSON.stringify(out));
  note(`[rone weekly] 총 ${total}행 중 ${rows.length}행 받음(호출 ${calls}) · 기간 ${keepList[0]}~${keepList.at(-1)} (${keepList.length}주, 최근 라벨 "${labels[keepList.at(-1)] ?? ''}") · 지역 ${Object.keys(series).length} · 값 ${n}`);
  note(`지역 예: ${Object.keys(series).slice(0, 12).join(' / ')}`);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `latest=${keepList.at(-1)}\nregions=${Object.keys(series).length}\n`, { flag: 'a' });
}

async function main() {
  try {
    if (mode === 'tables') await tables();
    else if (mode === 'probe') await probe();
    else await weekly();
  } catch (e) {
    note(`오류: ${redact(e.message)}`);
    process.exitCode = 1;
  } finally {
    if (process.env.GITHUB_ACTIONS) for (let i = 0; i < notices.length; i += 8) console.log(`::notice title=rone ${i / 8 + 1}::${notices.slice(i, i + 8).join(' | ').slice(0, 3900)}`);
  }
}
main();
