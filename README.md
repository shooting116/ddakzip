# 딱집 — korea-rich.com

내 소득·현금·가구 상황을 넣으면 받을 수 있는 정책대출과 최대 예산을 계산하고,
그 예산에 딱 맞는 아파트를 찾아 비교하는 사이트.

## 구조

```
src/            Astro 사이트 (페이지·레이아웃·컴포넌트·스타일)
  pages/        / 홈 · /calc/ 계산기 · /about/ /privacy/ /contact/ · 404
  layouts/      Base.astro — 공통 head·헤더·푸터
  styles/       global.css — 디자인 토큰 (토스 문법)
data/
  rules/        대출·세금 규칙표 JSON (시행일별 버전)        ← 1단계
  raw/          수집 원본 (커밋 안 함, 파이프라인이 매일 재생성) ← 2단계
public/         favicon · robots.txt
.github/        CI(빌드 확인), 매일 수집·빌드 워크플로우      ← 2단계
wrangler.jsonc  Cloudflare Workers 정적 배포 설정
```

## 개발

```
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/
```

Node 22 이상.

## 배포

Cloudflare Workers Builds(Git 연결). `main`에 푸시하면 자동 빌드·배포.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 저장소 뼈대 · 배포 연결 | 진행 중 |
| 1 | 계산 엔진(규칙표 v0.1) + 계산기 화면 | |
| 2 | 실거래 백필 · 단지 마스터 · 매일 갱신 · 금리 자동수집 | |
| 3 | 예산 맞춤 지도+리스트 · 단지 상세 · 예산별 페이지 | |
| 4 | 비교 · 레퍼런스 4종 · 교통 호재 · 정비사업 · 뉴스 | |
| 5 | 가이드 글 · 정책 페이지 · 사이트맵 · 광고 슬롯 → 공개 | |

## 원칙

- 모든 숫자에 출처와 기준일을 붙인다. 판단은 사용자가 하고, 사이트는 데이터만 보여준다.
- API 키는 코드에 넣지 않는다. GitHub Secrets → Actions 환경변수로만.
- 규칙표는 시행일별 버전으로 보관한다. 경과조치(계약일 기준)에 대응하기 위해서다.
