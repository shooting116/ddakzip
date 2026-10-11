// 규칙표의 지역 목록에서 수집 대상 시군구(법정동코드 앞 5자리)를 뽑는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');

/** 백필 우선순위: 서울 → 인천 → 경기 → 부산 → 대구 → 대전 → 광주 → 울산 → 세종 */
export const SIDO_ORDER = ['서울', '인천', '경기', '부산', '대구', '대전', '광주', '울산', '세종'];

export function loadRegions() {
  const rules = JSON.parse(readFileSync(join(ROOT, 'data', 'rules', 'v2026-09-30.json'), 'utf8'));
  const out = [];
  for (const sido of rules.regions.sido) {
    for (const g of sido.sigungu) {
      if (!g.lawd) continue;
      out.push({ sido: sido.name, sigungu: g.name, lawd: String(g.lawd), regulated: !!g.regulated });
    }
  }
  out.sort((a, b) => SIDO_ORDER.indexOf(a.sido) - SIDO_ORDER.indexOf(b.sido) || a.lawd.localeCompare(b.lawd));
  return out;
}

/** 'YYYYMM' 목록: 이번 달부터 n개월 거슬러 (최근 → 과거) */
export function recentMonths(n, from = new Date()) {
  const out = [];
  let y = from.getFullYear(), m = from.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}
