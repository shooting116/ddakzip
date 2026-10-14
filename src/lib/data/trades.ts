// 빌드 시 단지별 실거래 원본 조회 (data/trades/{lawd}/*.ndjson). 시군구 단위로 읽어 캐시한다.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lawdsOf } from './index.ts';

export interface Trade {
  lawd: string; umd: string | null; umdNm: string; jibun: string; apt: string; aptSeq: string | null; dong: string | null;
  area: number; floor: number | null; built: number | null; date: string; amt: number;
  cancel: boolean; cancelDate: string | null; direct: boolean; rgst: string | null; road: string | null;
}

const DIR = join(process.cwd(), 'data', 'trades');
const cache = new Map<string, Map<string, Trade[]>>();

function loadLawd(lawd: string): Map<string, Trade[]> {
  if (cache.has(lawd)) return cache.get(lawd)!;
  const map = new Map<string, Trade[]>();
  const dir = join(DIR, lawd);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ndjson')).sort()) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line) continue;
        const r = JSON.parse(line) as Trade;
        const key = r.aptSeq ?? `${r.lawd}${r.umd}-${r.jibun}-${r.apt}`;
        let arr = map.get(key);
        if (!arr) { arr = []; map.set(key, arr); }
        arr.push(r);
      }
    }
  }
  if (cache.size >= 2) cache.delete(cache.keys().next().value!);
  cache.set(lawd, map);
  return map;
}

/** 최신순. lawd(단지가 속한 시군구 코드)를 알면 넘기고, 모르면 id 앞자리·개편 전 코드 순으로 찾는다 */
export function tradesOf(id: string, lawd?: string): Trade[] {
  let arr: Trade[] | undefined;
  for (const l of lawd ? [lawd] : lawdsOf(id)) { arr = loadLawd(l).get(id); if (arr?.length) break; }
  return [...(arr ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.amt - a.amt);
}
