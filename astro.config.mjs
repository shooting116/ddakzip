// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 딱집 — korea-rich.com
// 정적 빌드. 단지 페이지가 2만 개를 넘기면 3단계에서 Cloudflare 어댑터로 요청 시 생성(하이브리드)을 켠다.
export default defineConfig({
  site: 'https://korea-rich.com',
  // PREVIEW_GUIDES=1 이면 예약 중인 가이드도 빌드(로컬 확인용). 서버 빌드에는 넣지 않는다.
  vite: { define: { 'import.meta.env.PREVIEW_GUIDES': JSON.stringify(process.env.PREVIEW_GUIDES ?? '') } },
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // 공개 전까지는 noindex 페이지를 사이트맵에서 제외
      filter: (page) => !/\/(about|privacy|contact)\/$/.test(page),
    }),
  ],
  build: { format: 'directory' },
});
