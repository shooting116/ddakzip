import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, DataGoError } from './datago.mjs';
import { normalize, keyOf, sortRows } from './trades.mjs';
import { recentMonths, loadRegions } from './regions.mjs';

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>
<item><aptDong>101</aptDong><aptNm>래미안 &amp; 자이</aptNm><aptSeq>11110-123</aptSeq><buildYear>2008</buildYear><buyerGbn>개인</buyerGbn><cdealDay> </cdealDay><cdealType> </cdealType><dealAmount>82,500</dealAmount><dealDay>7</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><dealingGbn>중개거래</dealingGbn><excluUseAr>84.97</excluUseAr><floor>12</floor><jibun>100</jibun><rgstDate>26.09.30</rgstDate><roadNm>사직로</roadNm><sggCd>11110</sggCd><slerGbn>개인</slerGbn><umdCd>11500</umdCd><umdNm>사직동</umdNm></item>
<item><aptNm>경희궁의아침</aptNm><aptSeq>11110-9</aptSeq><buildYear>2004</buildYear><cdealDay>26.09.20</cdealDay><cdealType>O</cdealType><dealAmount>150,000</dealAmount><dealDay>1</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><dealingGbn>직거래</dealingGbn><excluUseAr>124.5</excluUseAr><floor>3</floor><jibun>1-1</jibun><sggCd>11110</sggCd><umdCd>11700</umdCd><umdNm>내수동</umdNm></item>
</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>`;

test('정상 응답 파싱 + 정규화', () => {
  const r = parseResponse(sample);
  assert.equal(r.totalCount, 2);
  const rows = sortRows(r.items.map((it) => normalize(it, '11110')));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].apt, '경희궁의아침');
  assert.equal(rows[0].cancel, true);
  assert.equal(rows[0].cancelDate, '2026-09-20');
  assert.equal(rows[0].direct, true);
  assert.equal(rows[0].amt, 150000);
  assert.equal(rows[1].apt, '래미안 & 자이');
  assert.equal(rows[1].date, '2026-09-07');
  assert.equal(rows[1].rgst, '2026-09-30');
  assert.equal(rows[1].area, 84.97);
  assert.equal(rows[1].umd, '11500');
  assert.ok(keyOf(rows[0]) !== keyOf(rows[1]));
});

test('포털 오류 응답 → DataGoError (22 = 쿼터)', () => {
  const err = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.throws(() => parseResponse(err), (e) => e instanceof DataGoError && e.quota);
  const bad = `<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.throws(() => parseResponse(bad), (e) => e instanceof DataGoError && e.fatal);
});

test('최근 n개월 · 지역 목록', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-01-15T00:00:00')), ['202601', '202512', '202511']);
  const regs = loadRegions();
  assert.equal(regs.length, 124); // 서울25 경기47 인천11 부산16 대구9 광주5 대전5 울산5 세종1
  assert.equal(regs[0].sido, '서울');
  assert.ok(regs.every((r) => /^\d{5}$/.test(r.lawd)));
});

test('JSON 응답(K-apt) 파싱: 단일 item · 배열 item', () => {
  const one = JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { item: { kaptCode: 'A1', kaptName: '괴정 경성스마트W아파트', kaptdaCnt: 120 } } } });
  const r = parseResponse(one);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].kaptdaCnt, '120');
  const many = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [{ kaptCode: 'A1' }, { kaptCode: 'A2' }] }, totalCount: 2, pageNo: 1, numOfRows: 100 } } });
  assert.equal(parseResponse(many).items.length, 2);
  const err = JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: {} } });
  assert.throws(() => parseResponse(err), (e) => e instanceof DataGoError && e.code === '03');
});
