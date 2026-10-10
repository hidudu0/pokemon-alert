// test/gs25.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListed } from '../src/sources/gs25.js';

const res = (codes) => ({
  SearchQueryResult: {
    Collection: [
      { CollectionId: 'woodel_gs', Documentset: { Document: [{ field: { itemCode: '8800286275732' } }] } }, // 다른 컬렉션은 무시
      { CollectionId: 'offlineItem', Documentset: { Document: codes.map((itemCode) => ({ field: { itemCode, itemName: 'x' } })) } },
    ],
  },
});

test('gs25: offlineItem 에 바코드가 있으면 true', () => {
  assert.equal(parseListed(res(['8800286279372', '8800286275732']), '8800286275732'), true);
  assert.equal(parseListed(res(['8800286279372']), '8800286275732'), false);
});

test('gs25: 형태 다른 응답은 throw', () => {
  assert.throws(() => parseListed({ message: 'Request blocked' }, '8800286275732'), /형태/);
});
