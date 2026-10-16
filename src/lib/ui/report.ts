// 단지 정보 오류 제보 — 메일 제목·본문에 단지 id·페이지 주소·기준일을 미리 채운 mailto 링크. 서버 없이 동작한다.
export const REPORT_EMAIL = 'xix1223.ad.2025@gmail.com';

export function reportMailto(o: { name: string; id: string; asOf: string; path: string }): string {
  const subject = `[쏙집 제보] ${o.name} (${o.id})`;
  const body = [
    `페이지: https://korea-rich.com${o.path}`,
    `데이터 기준일: ${o.asOf}`,
    '',
    '이상한 항목 (해당하는 것만 남겨주세요): 세대수 / 준공년도 / 면적·평형 / 시세·실거래 / 위치 / 역·정비사업 / 뉴스 링크 / 기타',
    '',
    '어떻게 이상한가요?',
    '',
  ].join('\n');
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
