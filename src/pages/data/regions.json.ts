// 시도 → 시군구 목록 + 단지 수 (지역 선택 UI용)
import type { APIRoute } from 'astro';
import { loadSummary } from '../../lib/data/index.ts';

export const GET: APIRoute = () => {
  const s = loadSummary();
  const sido: Record<string, { lawd: string; name: string; n: number; st: number; s: unknown[] }[]> = {};
  for (const g of s.sigungu) (sido[g.sido] ??= []).push({ lawd: g.lawd, name: g.sigungu, n: g.complexes, st: g.static, s: g.stations ?? [] });
  return new Response(JSON.stringify({ asOf: s.asOf, sido, idPrefix: s.idPrefix ?? {} }), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
