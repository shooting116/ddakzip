// 콘텐츠 컬렉션: 공부 가이드 (src/content/guide/*.md)
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const guide = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guide' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['situation', 'loan', 'tax', 'price', 'future']),
    publishAt: z.string(),            // KST ISO (예: 2026-10-12T19:00:00+09:00). 이 시각 이후 publish-guides가 published를 켠다
    published: z.boolean().default(false),
    updatedAt: z.string().optional(),
    asOf: z.string(),                 // 글 속 숫자의 기준일
    facts: z.array(z.string()).default([]),   // 규칙표에서 자동으로 뽑아 보여줄 수치 묶음 키
    sources: z.array(z.object({ title: z.string(), url: z.string(), date: z.string().optional() })).default([]),
    related: z.array(z.string()).default([]), // 다른 가이드 slug
    cta: z.enum(['calc', 'find', 'ref', 'none']).default('calc'),
    situation: z.enum(['first', 'newly', 'youth', 'general', 'move']).optional(),
  }),
});

export const collections = { guide };
