import type { CollectionEntry } from 'astro:content';

export const CATEGORY: Record<string, { name: string; desc: string }> = {
  situation: { name: '상황별 집 사기', desc: '내 상황에서 받을 수 있는 것부터' },
  loan: { name: '대출 상품 공부', desc: '자격·한도·금리를 숫자로' },
  tax: { name: '세금·부대비용', desc: '집값 말고 더 드는 돈' },
  price: { name: '시세 읽는 법', desc: '실거래가를 제대로 보는 눈' },
  future: { name: '호재·정비사업', desc: '사실과 일정만' },
};

/** 빌드 시점에 공개된 글만. published 플래그는 publish-guides.mjs 가 예약 시각에 켠다 */
export function isLive(e: CollectionEntry<'guide'>): boolean {
  return e.data.published === true;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, '0')}.${String(k.getUTCDate()).padStart(2, '0')}`;
}
