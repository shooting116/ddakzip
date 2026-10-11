// 실거래 행 정규화·정렬 (수집기와 테스트가 함께 쓴다)
export const num = (s) => { const n = Number(String(s ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
const pad2 = (n) => String(n).padStart(2, '0');

export function normalize(it, lawd) {
  // 2024-07 이후 필드명 기준. 과거 필드명(거래금액 등)이 오면 함께 받아준다.
  const amt = num(it.dealAmount ?? it['거래금액']);
  const y = num(it.dealYear ?? it['년']), m = num(it.dealMonth ?? it['월']), d = num(it.dealDay ?? it['일']);
  if (!amt || !y || !m || !d) return null;
  const area = num(it.excluUseAr ?? it['전용면적']);
  const row = {
    lawd,
    umd: (it.umdCd ?? '').trim() || null,
    umdNm: (it.umdNm ?? it['법정동'] ?? '').trim(),
    jibun: (it.jibun ?? it['지번'] ?? '').trim(),
    apt: (it.aptNm ?? it['아파트'] ?? '').trim(),
    aptSeq: (it.aptSeq ?? '').trim() || null,
    dong: (it.aptDong ?? '').trim() || null,
    area: area != null ? Math.round(area * 100) / 100 : null,
    floor: num(it.floor ?? it['층']),
    built: num(it.buildYear ?? it['건축년도']),
    date: `${y}-${pad2(m)}-${pad2(d)}`,
    amt,                                   // 만 원
    cancel: (it.cdealType ?? '').trim() === 'O' || (it['해제여부'] ?? '').trim() === 'O',
    cancelDate: (it.cdealDay ?? it['해제사유발생일'] ?? '').trim() || null,
    direct: (it.dealingGbn ?? it['거래유형'] ?? '').includes('직거래'),
    rgst: (it.rgstDate ?? it['등기일자'] ?? '').trim() || null,
    road: (it.roadNm ?? it['도로명'] ?? '').trim() || null,
    seller: (it.slerGbn ?? '').trim() || null,
    buyer: (it.buyerGbn ?? '').trim() || null,
  };
  if (row.cancelDate && /^\d{2}\.\d{2}\.\d{2}$/.test(row.cancelDate)) row.cancelDate = '20' + row.cancelDate.replace(/\./g, '-');
  if (row.rgst && /^\d{2}\.\d{2}\.\d{2}$/.test(row.rgst)) row.rgst = '20' + row.rgst.replace(/\./g, '-');
  return row;
}

export const keyOf = (r) => [r.umd, r.jibun, r.apt, r.dong ?? '', r.area, r.floor, r.date, r.amt].join('|');
export function sortRows(rows) {
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.apt.localeCompare(b.apt, 'ko') || (a.area - b.area) || ((a.floor ?? 0) - (b.floor ?? 0)) || (a.amt - b.amt));
}

