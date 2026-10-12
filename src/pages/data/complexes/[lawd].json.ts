// 시군구별 단지 요약 JSON (지도·리스트 클라이언트가 읽음)
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadSummary, loadSigungu, slim } from '../../../lib/data/index.ts';

export const getStaticPaths: GetStaticPaths = () => loadSummary().sigungu.map((s) => ({ params: { lawd: s.lawd } }));

export const GET: APIRoute = ({ params }) => {
  const d = loadSigungu(params.lawd!);
  if (!d) return new Response('{}', { status: 404 });
  const body = { lawd: d.lawd, sido: d.sido, sigungu: d.sigungu, asOf: d.asOf, c: d.complexes.map(slim) };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
