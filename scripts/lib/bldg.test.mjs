import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJibun } from './bldg.mjs';

test('지번 → 건축HUB 파라미터', () => {
  assert.deepEqual(parseJibun('746'), { platGbCd: '0', bun: '0746', ji: '0000' });
  assert.deepEqual(parseJibun('1026-3'), { platGbCd: '0', bun: '1026', ji: '0003' });
  assert.deepEqual(parseJibun('산 12-1'), { platGbCd: '1', bun: '0012', ji: '0001' });
  assert.deepEqual(parseJibun('산12'), { platGbCd: '1', bun: '0012', ji: '0000' });
  assert.equal(parseJibun(''), null);
  assert.equal(parseJibun('가-1'), null);
});
