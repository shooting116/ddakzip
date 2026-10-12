#!/usr/bin/env node
// 예약 발행: src/content/guide/*.md 중 published:false 이고 publishAt ≤ 지금(KST)인 글의 published 를 true 로 바꾼다.
// 워크플로우가 08:00·13:00·19:00 KST 에 실행해 하루 최대 3편이 사람이 올리는 속도로 공개된다.
//   node scripts/publish-guides.mjs [--dry]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/regions.mjs';

const DIR = join(ROOT, 'src', 'content', 'guide');
const dry = process.argv.includes('--dry');
const now = Date.now();
const done = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.md')).sort()) {
  const p = join(DIR, f);
  const t = readFileSync(p, 'utf8');
  const fm = t.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) continue;
  const pub = /^published:\s*true/m.test(fm[1]);
  const at = fm[1].match(/^publishAt:\s*"?([^"\n]+)"?/m)?.[1];
  const title = fm[1].match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? f;
  if (pub || !at) continue;
  if (new Date(at).getTime() > now) continue;
  if (!dry) writeFileSync(p, t.replace(/^published:\s*false/m, 'published: true'));
  done.push(title);
}
console.log(done.length ? `[publish] ${done.length}편 공개: ${done.join(' / ')}` : '[publish] 공개할 글 없음');
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `count=${done.length}\ntitles=${done.join(' / ').replace(/\n/g, ' ')}\n`, { flag: 'a' });
