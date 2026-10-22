# 가이드 글 발행 계획 — 50편, 하루 1편

- 1~23편은 2026-10-12~10-18에 하루 3편씩 공개 완료. 24편(실거래 vs 부동산원 지수)은 2026-10-20 19:00 공개.
- 25편부터는 **매일 1편**. 매일 아침 예약 작업이 아래 표에서 그날 날짜의 글을 써서 `publishAt: "YYYY-MM-DDT08:00:00+09:00"`, `published: true`로 커밋한다.
- 쓰는 규칙은 `docs/guide-writing.md`. 표의 slug·category·cta는 제안값이며 글을 쓰면서 바꿔도 된다(바꾸면 표도 고친다).
- 쓴 날은 `상태` 칸을 `완료(slug)`로 바꾼다. 표가 바닥나면 운영자에게 알린다.

| 날짜 | # | 제목(안) | slug | category | cta | 상태 |
|---|---|---|---|---|---|---|
| 2026-10-21 | 25 | 전세가율 읽는 법 — 매매가 대비 전세가, 갭이 뜻하는 것 | jeonse-ratio | price | find | 완료(jeonse-ratio) |
| 2026-10-22 | 26 | 실거래 내역의 신고가·저층·탑층 표시 — 쏙집 단지 페이지 기준 | trade-tags | price | find | 완료(trade-tags) |
| 2026-10-23 | 27 | 등기부등본 읽는 법 — 갑구·을구, 근저당·가압류·신탁 | registry-reading | situation | none | 완료(registry-reading) |
| 2026-10-24 | 28 | 계약금·중도금·잔금 타임라인 — 대출 실행은 언제 맞추나 | payment-timeline | situation | calc | |
| 2026-10-25 | 29 | 가계약금 — 법적 효력, 돌려받을 수 있는 경우 | provisional-deposit | situation | none | |
| 2026-10-26 | 30 | 매매계약서 특약 체크리스트 — 대출 불가 시 해제, 하자, 잔금일 변경 | contract-clauses | situation | none | |
| 2026-10-27 | 31 | 잔금일 당일 순서 — 대출 실행 → 등기 → 전입·관리비 정산 | closing-day | situation | none | |
| 2026-10-28 | 32 | 세입자 있는 집 사기 — 전세 끼고 매수할 때 계약 승계와 만기 | buying-with-tenant | situation | find | |
| 2026-10-29 | 33 | 아파트 관리비 읽는 법 — K-apt로 단지별 비교 | maintenance-fee | price | find | |
| 2026-10-30 | 34 | 보유세 기초 — 재산세·종합부동산세, 공시가격과 실거래가 차이 | holding-tax | tax | none | |
| 2026-10-31 | 35 | 1주택 양도세 비과세 — 12억·보유·거주 요건 | capital-gains-exempt | tax | none | |
| 2026-11-01 | 36 | 일시적 2주택 — 비과세·취득세 중과 배제 요건 한 장 정리 | temporary-two-homes | tax | calc | |
| 2026-11-02 | 37 | 부모 도움받아 집 살 때 — 증여세 공제, 차용증, 자금출처 | family-gift-loan | tax | none | |
| 2026-11-03 | 38 | 청년 대출 — 만 34세 이하 장래소득 인정 DSR과 정책대출 | youth-loans | loan | calc | |
| 2026-11-04 | 39 | 신혼부부 정책대출 — 디딤돌·버팀목 신혼 특례, 혼인 7년 기준 | newlywed-loans | loan | calc | |
| 2026-11-05 | 40 | 주담대 갈아타기(대환) — 온라인 대환 인프라, 중도상환수수료 | refinancing | loan | calc | |
| 2026-11-06 | 41 | 상환 방식 — 원리금균등·원금균등·체증식, 총이자 차이 | repayment-methods | loan | calc | |
| 2026-11-07 | 42 | DSR에 잡히는 것들 — 신용대출·카드론·전세대출·학자금 | dsr-components | loan | calc | |
| 2026-11-08 | 43 | 보금자리론 2026 — 자격·한도·금리 구조 | bogeumjari-2026 | loan | calc | |
| 2026-11-09 | 44 | 입주 물량 보는 법 — 공급이 가격에 닿는 시차 | supply-pipeline | price | find | |
| 2026-11-10 | 45 | 미분양 통계 읽는 법 — 국토부 월간 통계, 준공 후 미분양 | unsold-stats | price | none | |
| 2026-11-11 | 46 | 용적률·대지지분 — 재건축 사업성을 가르는 두 숫자 | far-and-land-share | future | find | |
| 2026-11-12 | 47 | 분양권 vs 입주권 — 차이, 세금, 대출 | presale-vs-occupancy-right | future | none | |
| 2026-11-13 | 48 | 아파트 vs 주상복합 vs 오피스텔(아파텔) — 대출·세금·관리비 차이 | apt-vs-officetel | situation | calc | |
| 2026-11-14 | 49 | 세대수·동수·주차대수 — 건축물대장으로 단지 읽기 | building-register | price | find | |
| 2026-11-15 | 50 | 신축·준신축·구축 — 준공연도별 가격 차이와 확인할 것 | age-of-building | price | find | |

## 이미 공개된 글(겹치지 않게 참고)

how-to-read-trades, ltv-dsr-dti, acquisition-tax, first-home-2026, why-six-month-median, brokerage-fee, bond-and-registration, area-and-pyeong, yoy-pitfalls, what-is-leading-complex, volume-and-price, regulation-map-2026, moving-up, funding-plan, fixed-vs-variable, dual-income, gtx-timeline-2026, redevelopment-stages, newtown1-pilot, station-radius, metro-rail-2026-2031, remodeling-vs-rebuild, monthly-payment-feel, trades-vs-reb-index
