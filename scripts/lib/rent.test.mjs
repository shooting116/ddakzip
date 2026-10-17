import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from './datago.mjs';
import { normalizeRent, keyOfRent, sortRent } from './rent.mjs';

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>
<item><aptNm>까치마을</aptNm><buildYear>1993</buildYear><contractTerm>26.10~28.10</contractTerm><contractType>갱신</contractType><dealDay>3</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><deposit>52,000</deposit><excluUseAr>39.6</excluUseAr><floor>7</floor><jibun>746</jibun><monthlyRent>0</monthlyRent><preDeposit>45,000</preDeposit><preMonthlyRent>0</preMonthlyRent><sggCd>11680</sggCd><umdNm>수서동</umdNm><useRRRight>사용</useRRRight></item>
<item><aptNm>까치마을</aptNm><buildYear>1993</buildYear><contractTerm></contractTerm><contractType></contractType><dealDay>1</dealDay><dealMonth>9</dealMonth><dealYear>2026</dealYear><deposit>10,000</deposit><excluUseAr>34.44</excluUseAr><floor>3</floor><jibun>746</jibun><monthlyRent>120</monthlyRent><sggCd>11680</sggCd><umdNm>수서동</umdNm></item>
</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>`;

test('전월세 응답 파싱 + 정규화', () => {
  const r = parseResponse(sample);
  const rows = sortRent(r.items.map((it) => normalizeRent(it, '11680')));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-09-01');
  assert.equal(rows[0].rent, 120);           // 월세
  assert.equal(rows[0].deposit, 10000);
  assert.equal(rows[0].type, null);
  assert.equal(rows[1].rent, 0);             // 전세
  assert.equal(rows[1].deposit, 52000);
  assert.equal(rows[1].type, '갱신');
  assert.equal(rows[1].rrr, '사용');
  assert.equal(rows[1].preDeposit, 45000);
  assert.equal(rows[1].area, 39.6);
  assert.ok(keyOfRent(rows[0]) !== keyOfRent(rows[1]));
});
