// 건축물대장 조회용 보조 함수
/** 지번 "746" / "746-1" / "산 12" → { platGbCd, bun, ji } (4자리 0 채움) */
export function parseJibun(jibun) {
  if (!jibun) return null;
  let s = String(jibun).trim();
  let platGbCd = '0';
  if (/^산/.test(s)) { platGbCd = '1'; s = s.replace(/^산\s*/, ''); }
  const m = s.match(/^(\d+)(?:-(\d+))?/);
  if (!m) return null;
  return { platGbCd, bun: m[1].padStart(4, '0'), ji: (m[2] ?? '0').padStart(4, '0') };
}

