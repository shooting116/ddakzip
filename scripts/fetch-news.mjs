#!/usr/bin/env node
// 단지 관련 언론 보도 수집 (네이버 뉴스 검색 API) → data/news/{lawd}.json
//   node scripts/fetch-news.mjs [--sido 서울] [--max-calls 2000] [--notify]
// 대상: ① 정비사업 매칭 단지(data/complexes/redev.json) ② 시군구별 1년 하락 상위 10 단지(data/index, 없으면 build-index 먼저 실행)
// 화이트리스트 언론사만, 제목·언론사·날짜·링크만 저장(본문 없음). 180일 이내 최신 3건.
// 키: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET. --notify 면 카카오톡으로 월간 검수 요청.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/regions.mjs';
import { normName } from './lib/trades-index.mjs';
import { kakaoMemo } from './lib/kakao.mjs';

const ID = process.env.NAVER_CLIENT_ID, SECRET = process.env.NAVER_CLIENT_SECRET;
if (!ID || !SECRET) { console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다'); process.exit(1); }
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => { if (!a.startsWith('--')) return []; const k = a.slice(2); const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'; return [k, v]; }).filter((x) => x.length));
const sidoFilter = args.sido ? args.sido.split(',') : null;
const maxCalls = Number(args['max-calls'] ?? 2000);
const notify = args.notify === 'true';
const DAYS = 180, KEEP = 3;

// 화이트리스트: 호스트 끝부분 일치
export const OUTLETS = [
  ['yna.co.kr', '연합뉴스'], ['hankyung.com', '한국경제'], ['mk.co.kr', '매일경제'], ['chosun.com', '조선일보'], ['joongang.co.kr', '중앙일보'],
  ['donga.com', '동아일보'], ['hani.co.kr', '한겨레'], ['khan.co.kr', '경향신문'], ['sedaily.com', '서울경제'], ['mt.co.kr', '머니투데이'],
  ['edaily.co.kr', '이데일리'], ['fnnews.com', '파이낸셜뉴스'], ['news1.kr', '뉴스1'], ['newsis.com', '뉴시스'], ['kbs.co.kr', 'KBS'], ['mbc.co.kr', 'MBC'], ['sbs.co.kr', 'SBS'],
];
function outletOf(url) {
  try { const h = new URL(url).hostname; const hit = OUTLETS.find(([d]) => h === d || h.endsWith('.' + d)); return hit ? hit[1] : null; } catch { return null; }
}
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;|&#39;/g, "'");
const ymd = (rfc) => { const d = new Date(rfc); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; };

let calls = 0;
async function search(q) {
  calls++;
  const res = await fetch(`https://openapi.naver.com/v1/search/news.json?${new URLSearchParams({ query: q, display: 20, sort: 'date' })}`, { headers: { 'X-Naver-Client-Id': ID, 'X-Naver-Client-Secret': SECRET } });
  if (res.status === 429) throw new Error('429');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).items ?? [];
}

function loadJson(p, d) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } }
function ensureIndex() {
  if (!existsSync(join(ROOT, 'data', 'index', 'summary.json'))) execFileSync('node', [join(ROOT, 'scripts', 'build-index.mjs')], { stdio: 'inherit' });
}

async function main() {
  ensureIndex();
  const redev = loadJson(join(ROOT, 'data', 'complexes', 'redev.json'), {});
  const summary = loadJson(join(ROOT, 'data', 'index', 'summary.json'), { sigungu: [] });
  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  mkdirSync(join(ROOT, 'data', 'news'), { recursive: true });
  let targets = 0, hits = 0, stop = null;
  const perSigungu = [];

  outer: for (const g of summary.sigungu) {
    if (sidoFilter && !sidoFilter.includes(g.sido)) continue;
    if (g.complexes === 0) continue;
    const idx = loadJson(join(ROOT, 'data', 'index', 'complexes', `${g.lawd}.json`), null);
    if (!idx) continue;
    const file = join(ROOT, 'data', 'news', `${g.lawd}.json`);
    const news = loadJson(file, {});
    // 대상: 하락 상위 10 + 정비사업 매칭
    const rep = (c) => c.types.find((t) => t.key === c.rep);
    const down = idx.complexes.map((c) => ({ c, t: rep(c) })).filter((x) => x.t && x.t.yoy != null && x.t.basis === 'median6' && x.t.yoy < 0).sort((a, b) => a.t.yoy - b.t.yoy).slice(0, 10).map((x) => x.c);
    const rd = idx.complexes.filter((c) => redev[c.id]);
    const list = [...new Map([...down.map((c) => [c.id, { c, why: 'down' }]), ...rd.map((c) => [c.id, { c, why: 'redev' }])]).values()];
    let changed = false;
    for (const { c, why } of list) {
      if (calls >= maxCalls) { stop = `max-calls ${maxCalls}`; break outer; }
      const prevAt = news[c.id]?.at;
      if (prevAt && (Date.now() - new Date(prevAt).getTime()) < 6 * 86400e3) continue;   // 일주일에 한 번만
      const core = c.name.replace(/\(.*?\)/g, '').trim();
      if (normName(core).length < 3) continue;   // '현대'처럼 짧은 이름은 잡음이 커서 제외
      targets++;
      const q = why === 'redev' ? `"${core}" 재건축` : `"${core}" 아파트 ${g.sigungu}`;
      try {
        const items = await search(q);
        const nc = normName(core);
        const picked = [];
        for (const it of items) {
          const outlet = outletOf(it.originallink || it.link);
          if (!outlet) continue;
          const title = strip(it.title), desc = strip(it.description);
          if (!normName(title + desc).includes(nc)) continue;
          const d = ymd(it.pubDate);
          if (!d || d < cutoff) continue;
          picked.push({ t: title, o: outlet, d, u: it.originallink || it.link });
          if (picked.length >= KEEP) break;
        }
        news[c.id] = { q, why, at: today, items: picked };
        if (picked.length) hits++;
        changed = true;
      } catch (e) {
        if (e.message === '429') { stop = '네이버 일일 한도(429)'; break outer; }
        console.warn(`  실패 ${c.name}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    if (changed) writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(news).sort().map((k) => [k, news[k]])), null, 1) + '\n');
    const n = Object.values(news).filter((v) => v.items?.length).length;
    perSigungu.push(`${g.sigungu} ${n}`);
  }
  const line = `대상 ${targets} · 보도 있음 ${hits} · 호출 ${calls}${stop ? ` · 중단 ${stop}` : ''}`;
  console.log('[news] ' + line);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=news::${line}`);

  if (notify) {
    const total = readdirSync(join(ROOT, 'data', 'news')).filter((f) => f.endsWith('.json')).reduce((s, f) => s + Object.values(loadJson(join(ROOT, 'data', 'news', f), {})).filter((v) => v.items?.length).length, 0);
    const text = `[쏙집 뉴스 검수] 이번 달 단지 보도 링크 ${total}개가 사이트에 걸려 있어요.\n하락 TOP·정비사업 단지 페이지에서 제목이 단지와 맞는지 한 번 훑어봐 주세요. 잘못된 건 data/overrides/news.json 에 단지ID를 적으면 빠집니다.\n${perSigungu.slice(0, 8).join(' · ')}`;
    if (!(await kakaoMemo(text, { url: 'https://korea-rich.com/ref/', button: '레퍼런스 열기' }))) return;
    console.log('카카오톡 검수 알림 전송');
  }
}

main().catch((e) => { console.error('[news] 오류:', String(e?.stack ?? e).replaceAll(SECRET, '***')); if (process.env.GITHUB_ACTIONS) console.log(`::error title=news::${String(e?.message ?? e)}`); process.exit(1); });
