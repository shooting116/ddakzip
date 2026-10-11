# 딱집 — korea-rich.com

내 소득·현금·가구 상황을 넣으면 받을 수 있는 정책대출과 최대 예산을 계산하고,
그 예산에 딱 맞는 아파트를 찾아 비교하는 사이트.

## 구조

```
src/            Astro 사이트 (페이지·레이아웃·컴포넌트·스타일)
  pages/        / 홈 · /calc/ 계산기 · /about/ /privacy/ /contact/ · 404
  layouts/      Base.astro — 공통 head·헤더·푸터
  styles/       global.css — 디자인 토큰 (토스 문법)
  lib/engine/   계산 엔진 (순수 TS, 브라우저·Node 공용) — 지역 분류·기존대출 환산·부대비용·상품별 자격·이분탐색
  lib/calcui/   계산기 화면 (6단계 질문 + 결과, localStorage 저장)
data/
  rules/        대출·세금 규칙표 JSON (시행일별 버전) — v2026-09-30 = 규칙표 v0.1
  trades/       국토부 실거래가 {시군구코드}/{YYYYMM}.ndjson + _manifest.json (매일 갱신, 커밋함)
  complexes/    K-apt 단지 목록(list/)·기본+상세정보(info/)·실거래↔K-apt 매칭(match.json)·좌표(geo.json)
  rates/        ECOS 주담대 가중평균 금리 (월 2회)
  overrides/    수동 보정표 (matches.json: aptSeq → kaptCode)
scripts/        수집기 (Node 22, 의존성 없음). fetch-trades · fetch-complexes · geocode · match-complexes · fetch-rates
public/         favicon · robots.txt · ads.txt
.github/        CI · 실거래 매일 갱신 · 백필(수동) · 데이터 수집(수동) · 금리 월간
wrangler.jsonc  Cloudflare Workers 정적 배포 설정
```

## 개발

```
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/
npm test         # 계산 엔진 테스트 (node --test)
```

Node 22 이상.

## 배포

Cloudflare Workers Builds(Git 연결). `main`에 푸시하면 자동 빌드·배포.
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 저장소 뼈대 · 배포 연결 | 완료 |
| 1 | 계산 엔진(규칙표 v0.1) + 계산기 화면 | 완료 (v1) |
| 2 | 실거래 백필 · 단지 마스터 · 매일 갱신 · 금리 자동수집 | 진행 중 (수집기 완료, 백필 진행) |
| 3 | 예산 맞춤 지도+리스트 · 단지 상세 · 예산별 페이지 | |
| 4 | 비교 · 레퍼런스 4종 · 교통 호재 · 정비사업 · 뉴스 | |
| 5 | 가이드 글 · 정책 페이지 · 사이트맵 · 광고 슬롯 → 공개 | |

## 계산기가 하는 일 (1단계)

1. 입력: 상황(생애최초·신혼부부·청년·무주택 일반·갈아타기) → 현금 → 소득(결혼 여부·배우자 소득) → 기존 대출 → 가구(생애최초·자녀·출산·나이, 갈아타기는 매도가·잔여대출·6개월 처분) → 지역 → 만기·금리.
2. 상품별로 `현금 + 대출(P) − 부대비용(P) ≥ P`를 만족하는 최대 매수가 P를 이분탐색. 대출(P) = min(LTV, 가격구간 절대한도, DSR, DTI, 상품 한도).
3. 대상 상품: 시중 주담대 · 디딤돌(일반/생애최초/신혼/2자녀 중 최대) · 신혼부부전용 · 신생아 특례 · 보금자리론. 자격이 없으면 이유를 표시.
4. 결과: 최대 매수가, 병목(LTV/DSR/DTI/한도), 월 상환액, 만약에(현금 +3천·소득 +1천·금리 +0.5%p), 부대비용 상세.
5. 규칙표 수치는 `data/rules/`에 출처·시행일과 함께 둔다. 2026-10-15 기금 대출 개편 발표 뒤 v0.2 추가 예정.

## 데이터 파이프라인 (2단계)

| 흐름 | 주기 | 스크립트 | 출처 |
|---|---|---|---|
| 실거래 백필 36개월 → 매일 최근 3개월 재수집(지연 신고·해제 반영) | 매일 06:10 KST | `fetch-trades.mjs` | 국토교통부 RTMSDataSvcAptTradeDev |
| 단지 목록(시군구별) → 실거래 단지와 이름이 맞는 단지만 기본·상세정보 | 수동/주 1회 | `fetch-complexes.mjs` | K-apt AptListService4 · AptBasisInfoServiceV5 |
| 실거래 단지 ↔ K-apt 매칭 (지번 일치 > 이름 유사도 > 수동 보정표) | 수집 뒤 | `match-complexes.mjs` | — |
| 단지 좌표 (지번 주소 → 키워드 → 본번) | 수동/주 1회 | `geocode.mjs` | 카카오 로컬 API |
| 주담대 가중평균 금리 → 규칙표와 비교 → 차이 나면 카카오톡 알림 (자동 변경 없음) | 매월 1·15일 | `fetch-rates.mjs` | 한국은행 ECOS 121Y006 |

- 2026년 행정구역 개편(화성시 4구, 인천 제물포·영종·서해·검단구, 전남광주통합특별시) 코드는 규칙표 `regions`에 반영. 국토부 API는 과거 거래도 새 코드로 다시 매긴다.
- 모든 수집기는 일일 트래픽 초과(코드 22)에서 멈추고 저장하며, 다음 실행이 매니페스트를 보고 이어서 한다.
- 키는 GitHub Secrets → 워크플로우 환경변수로만 전달한다. 컨테이너에서는 공공데이터포털에 접속할 수 없어 수집기 검증은 Actions의 `데이터 수집 (수동 실행)`으로 한다.

## 원칙

- 모든 숫자에 출처와 기준일을 붙인다. 판단은 사용자가 하고, 사이트는 데이터만 보여준다.
- API 키는 코드에 넣지 않는다. GitHub Secrets → Actions 환경변수로만.
- 규칙표는 시행일별 버전으로 보관한다. 경과조치(계약일 기준)에 대응하기 위해서다.
