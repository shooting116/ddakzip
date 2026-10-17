// 단지명 검색 색인: 전 단지 [id, 이름, 시군구, 읍면동, 36개월 거래, 별칭?]. 검색창을 열 때 한 번만 내려받는다.
import type { APIRoute } from 'astro';
import { allSigungu, loadSummary } from '../../lib/data/index.ts';

export const GET: APIRoute = () => {
  const s = loadSummary();
  const rows: (string | number)[][] = [];
  for (const g of allSigungu()) for (const c of g.complexes) {
    const r: (string | number)[] = [c.id, c.name, g.sigungu, c.umd, c.n36];
    if (c.aliases.length) r.push(c.aliases.join('|'));
    rows.push(r);
  }
  rows.sort((a, b) => (b[4] as number) - (a[4] as number));
  return new Response(JSON.stringify({ asOf: s.asOf, c: rows }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
