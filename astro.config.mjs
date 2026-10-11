// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 딱집 — korea-rich.com
// 정적 빌드. 단지 페이지가 2만 개를 넘기면 3단계에서 Cloudflare 어댑터로 요청 시 생성(하이브리드)을 켠다.
export default defineConfig({
  site: 'https://korea-rich.com',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // 공개 전까지는 noindex 페이지를 사이트맵에서 제외
      filter: (page) => !/\/(about|privacy|contact)\/$/.test(page),
    }),
  ],
  build: { format: 'directory' },
});
