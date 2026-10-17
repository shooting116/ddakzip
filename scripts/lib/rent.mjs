// 전월세 실거래 행 정규화·정렬 (국토교통부 RTMSDataSvcAptRent). 수집기와 집계가 함께 쓴다.
// 전월세 API에는 aptSeq·법정동코드가 없다 → 집계 때 (법정동명, 지번, 단지명)으로 매매 쪽 단지와 잇는다.
import { num } from './trades.mjs';
const pad2 = (n) => String(n).padStart(2, '0');

export function normalizeRent(it, lawd) {
  const dep = num(it.deposit ?? it['보증금액']);
  const y = num(it.dealYear ?? it['년']), m = num(it.dealMonth ?? it['월']), d = num(it.dealDay ?? it['일']);
  if (dep == null || !y || !m || !d) return null;
  const area = num(it.excluUseAr ?? it['전용면적']);
  const rent = num(it.monthlyRent ?? it['월세금액']) ?? 0;
  const row = {
    lawd,
    umdNm: (it.umdNm ?? it['법정동'] ?? '').trim(),
    jibun: (it.jibun ?? it['지번'] ?? '').trim(),
    apt: (it.aptNm ?? it['아파트'] ?? '').trim(),
    area: area != null ? Math.round(area * 100) / 100 : null,
    floor: num(it.floor ?? it['층']),
    built: num(it.buildYear ?? it['건축년도']),
    date: `${y}-${pad2(m)}-${pad2(d)}`,
    deposit: dep,                          // 만 원
    rent,                                  // 만 원/월. 0이면 전세
    term: (it.contractTerm ?? it['계약기간'] ?? '').trim() || null,
    type: (it.contractType ?? it['계약구분'] ?? '').trim() || null,     // 신규 / 갱신 / 빈값
    rrr: (it.useRRRight ?? it['갱신요구권사용'] ?? '').trim() || null,  // 갱신요구권 사용
    preDeposit: num(it.preDeposit ?? it['종전계약보증금']),
    preRent: num(it.preMonthlyRent ?? it['종전계약월세']),
  };
  return row;
}

export const keyOfRent = (r) => [r.umdNm, r.jibun, r.apt, r.area, r.floor, r.date, r.deposit, r.rent, r.term ?? ''].join('|');
export function sortRent(rows) {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.apt.localeCompare(b.apt, 'ko') || (a.area - b.area) || ((a.floor ?? 0) - (b.floor ?? 0)) || (a.deposit - b.deposit));
}
