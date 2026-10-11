#!/usr/bin/env node
// 실거래 단지(aptSeq) ↔ K-apt 단지(kaptCode) 매칭
//
//   node scripts/match-complexes.mjs [--sido 서울] [--report]
//
// 규칙 (같은 법정동 안에서만):
//   1) 수동 보정표 data/overrides/matches.json 이 있으면 그대로   (by: manual)
//   2) K-apt 기본정보의 지번이 실거래 지번과 같고 이름 유사도 ≥ 0.3    (by: jibun)
//   3) 이름 유사도 ≥ 0.7                                             (by: name)
//   4) 이름 유사도 ≥ 0.5 이고 그 법정동에 후보가 하나뿐                 (by: name-only)
// 결과: data/complexes/match.json { aptSeq: { kaptCode, score, by } } + 통계. 매칭 안 된 단지는 넣지 않는다.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegions, ROOT } from './lib/regions.mjs';
import { groupComplexes, dice } from './lib/trades-index.mjs';

const DIR = join(ROOT, 'data', 'complexes');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true';
  return [k, v];
}).filter((x) => x.length));
const sidoFilter = args.sido ? args.sido.split(',').map((s) => s.trim()) : null;

function loadJson(p, dflt) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; } catch { return dflt; } }

/** K-apt 주소("인천광역시 부평구 부평동 1026- 부평하우스토리어반그린")에서 지번만 */
export function jibunOf(addr, umdNm) {
  if (!addr) return null;
  const parts = addr.split(/\s+/);
  const i = umdNm ? parts.indexOf(umdNm) : -1;
  const cand = i >= 0 ? parts[i + 1] : parts.find((p) => /^\d+(-\d+)?-?$/.test(p));
  if (!cand) return null;
  const m = cand.match(/^(\d+)(?:-(\d+))?/);
  if (!m) return null;
  return m[2] && m[2] !== '0' ? `${m[1]}-${m[2]}` : m[1];
}

function main() {
  const regions = loadRegions().filter((r) => !sidoFilter || sidoFilter.includes(r.sido));
  const overrides = loadJson(join(ROOT, 'data', 'overrides', 'matches.json'), {});
  const prev = loadJson(join(DIR, 'match.json'), {});
  const out = sidoFilter ? { ...prev } : {};
  const stats = { complexes: 0, trades: 0, matched: 0, matchedTrades: 0, by: { manual: 0, jibun: 0, name: 0, 'name-only': 0 }, noKaptInBjd: 0, perSido: {} };

  for (const r of regions) {
    const list = loadJson(join(DIR, 'list', `${r.lawd}.json`), []);
    const info = loadJson(join(DIR, 'info', `${r.lawd}.json`), {});
    const byBjd = new Map();
    for (const k of list) { if (!byBjd.has(k.bjd)) byBjd.set(k.bjd, []); byBjd.get(k.bjd).push(k); }
    const traded = [...groupComplexes({ lawds: [r.lawd] }).values()];
    const ps = stats.perSido[r.sido] ?? (stats.perSido[r.sido] = { complexes: 0, matched: 0, trades: 0, matchedTrades: 0 });

    for (const t of traded) {
      stats.complexes++; stats.trades += t.n; ps.complexes++; ps.trades += t.n;
      // aptSeq 가 바뀌어도(이전 실행) 결과가 남지 않게 지역 단위로 다시 계산
      delete out[t.aptSeq];
      let hit = null;
      if (overrides[t.aptSeq]) hit = { kaptCode: overrides[t.aptSeq], score: 1, by: 'manual' };
      else {
        const pool = byBjd.get(t.bjd) ?? [];
        if (!pool.length) { stats.noKaptInBjd++; continue; }
        const scored = pool.map((k) => {
          const score = Math.max(dice(t.apt, k.name), ...t.aliases.map((a) => dice(a, k.name)));
          const kj = jibunOf(info[k.kaptCode]?.addr, t.umdNm);
          return { k, score, jibunEq: !!(kj && t.jibun && kj === t.jibun) };
        }).sort((a, b) => (b.jibunEq - a.jibunEq) || (b.score - a.score));
        const best = scored[0];
        if (best.jibunEq && best.score >= 0.3) hit = { kaptCode: best.k.kaptCode, score: +best.score.toFixed(2), by: 'jibun' };
        else if (best.score >= 0.7) hit = { kaptCode: best.k.kaptCode, score: +best.score.toFixed(2), by: 'name' };
        else if (best.score >= 0.5 && scored.filter((s) => s.score >= 0.5).length === 1) hit = { kaptCode: best.k.kaptCode, score: +best.score.toFixed(2), by: 'name-only' };
      }
      if (hit) { out[t.aptSeq] = hit; stats.matched++; stats.matchedTrades += t.n; stats.by[hit.by]++; ps.matched++; ps.matchedTrades += t.n; }
    }
  }

  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'match.json'), JSON.stringify(Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]])), null, 0).replace(/},"/g, '},\n"') + '\n');
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0');
  console.log(`[match] 단지 ${stats.matched}/${stats.complexes} (${pct(stats.matched, stats.complexes)}%) · 거래 기준 ${pct(stats.matchedTrades, stats.trades)}% · 방법 ${JSON.stringify(stats.by)} · 같은 법정동에 K-apt 없음 ${stats.noKaptInBjd}`);
  for (const [s, p] of Object.entries(stats.perSido)) console.log(`  ${s}: 단지 ${p.matched}/${p.complexes} (${pct(p.matched, p.complexes)}%) · 거래 ${pct(p.matchedTrades, p.trades)}%`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=match::단지 ${stats.matched}/${stats.complexes} (${pct(stats.matched, stats.complexes)}%) · 거래 기준 ${pct(stats.matchedTrades, stats.trades)}% · ${JSON.stringify(stats.by)}`);
}

main();
