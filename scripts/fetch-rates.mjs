#!/usr/bin/env node
// 금리 수집 (한국은행 ECOS) + 규칙표와 비교 + 카카오톡 알림
//
//   node scripts/fetch-rates.mjs            ECOS 예금은행 가중평균 주택담보대출 금리(신규취급액) 최근 24개월 → data/rates/ecos-mortgage.json
//   node scripts/fetch-rates.mjs --notify   규칙표 rate_default와 0.05%p 이상 차이 나거나 새 달이 들어오면 카카오톡 "나에게 보내기"
//
// - 규칙표는 자동으로 바꾸지 않는다. 바뀌어야 하면 알림만 보내고 사람이 확인해 새 버전을 넣는다.
// - 키: ECOS_KEY, (알림 시) KAKAO_REFRESH_TOKEN + KAKAO_REST_KEY/KAKAO_JS_KEY. 로그에 찍지 않는다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/regions.mjs';
import { kakaoMemo } from './lib/kakao.mjs';

const OUT = join(ROOT, 'data', 'rates');
const FILE = join(OUT, 'ecos-mortgage.json');
const STAT = '121Y006';        // 예금은행 가중평균금리 (신규취급액 기준)
const ITEM = 'BECBLA0302';     // 주택담보대출
const args = new Set(process.argv.slice(2));
const notify = args.has('--notify');

const ECOS = process.env.ECOS_KEY;
if (!ECOS) { console.error('ECOS_KEY 환경변수가 없습니다'); process.exit(1); }

function ym(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; }
function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }

async function fetchEcos() {
  const end = new Date(Date.now() + 9 * 3600 * 1000);
  const start = new Date(end); start.setMonth(start.getMonth() - 24);
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS}/json/kr/1/100/${STAT}/M/${ym(start)}/${ym(end)}/${ITEM}`;
  const res = await fetch(url);
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`ECOS 응답 해석 실패: ${text.slice(0, 100)}`); }
  if (j.RESULT) throw new Error(`ECOS 오류 ${j.RESULT.CODE}: ${j.RESULT.MESSAGE}`);
  const rows = j.StatisticSearch?.row ?? [];
  return rows.map((r) => ({ ym: r.TIME, rate: Number(r.DATA_VALUE), name: r.ITEM_NAME1 })).filter((r) => Number.isFinite(r.rate)).sort((a, b) => a.ym.localeCompare(b.ym));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const prev = loadJson(FILE, { series: [] });
  const series = await fetchEcos();
  if (!series.length) throw new Error('ECOS 데이터 없음');
  const latest = series[series.length - 1];
  const prevLatest = prev.series?.[prev.series.length - 1];
  const out = { stat: STAT, item: ITEM, name: latest.name, unit: '%', basis: '신규취급액 기준 월평균', source: 'https://ecos.bok.or.kr', fetched: new Date().toISOString().slice(0, 10), latest, series };
  writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`[rates] ECOS ${latest.name} ${latest.ym} = ${latest.rate}% (${series.length}개월)`);

  // 규칙표와 비교
  const rules = JSON.parse(readFileSync(join(ROOT, 'data', 'rules', 'v2026-09-30.json'), 'utf8'));
  const rd = rules.bank.rate_default;
  const ruleRate = Number(rd.variable ?? rd.rate ?? rd);
  const diff = +(latest.rate - ruleRate).toFixed(2);
  const newMonth = !prevLatest || prevLatest.ym !== latest.ym;
  const msg = [
    `[쏙집 금리 확인] ECOS 주담대 가중평균(신규) ${latest.ym.slice(0, 4)}.${latest.ym.slice(4)} = ${latest.rate}%`,
    `규칙표 기본금리 ${ruleRate}% (${rd.as_of ?? '-'}) 와 차이 ${diff > 0 ? '+' : ''}${diff}%p`,
    Math.abs(diff) >= 0.05 ? '→ 규칙표 금리 갱신 검토 필요' : '→ 차이 작음, 유지',
    '정책대출(디딤돌·신생아·보금자리론) 금리는 기금·HF 공지에서 직접 확인하세요.',
  ].join('\n');
  console.log(msg);
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `latest=${latest.ym} ${latest.rate}\ndiff=${diff}\n`, { flag: 'a' });
  if (notify && (newMonth || Math.abs(diff) >= 0.05)) {
    const sent = await kakaoMemo(msg);
    console.log(sent ? '카카오톡 알림 전송' : '카카오톡 알림 안 보냄');
  }
}

main().catch((e) => {
  const msg = String(e?.stack ?? e).replaceAll(ECOS, '***');
  console.error('[rates] 오류:', msg);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=rates::${msg.split('\n').slice(0, 3).join(' | ')}`);
  process.exit(1);
});
