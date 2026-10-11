// test/gs25.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseListed, grid, parseStock } from '../src/sources/gs25.js';
import { km, HOME, RADIUS_KM } from '../src/common.js';

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

test('gs25: 격자 중심 0.95km 원들이 5km 원을 빈틈없이 덮는다 (재고 API 는 1km 반경만 허용)', () => {
  const cs = grid();
  assert.ok(cs.length < 60, `호출 수 ${cs.length}`);
  for (let i = 0; i < 2000; i++) {
    const a = (i * 137.5 * Math.PI) / 180;
    const d = RADIUS_KM * Math.sqrt(i / 2000);
    const lat = HOME.lat + (d * Math.sin(a)) / 111.32;
    const lng = HOME.lng + (d * Math.cos(a)) / (111.32 * Math.cos((HOME.lat * Math.PI) / 180));
    assert.ok(cs.some((c) => km(c.lat, c.lng, lat, lng) <= 0.951), `${lat},${lng}`);
  }
});

const store = (storeCode, y, x, realStockQuantity) => ({ storeCode, storeName: `${storeCode}점`, storeYCoordination: y, storeXCoordination: x, realStockQuantity });

test('gs25: 재고 응답을 공통 모양으로, 5km 밖 제외', () => {
  const rows = parseStock({ stores: [store('V8M37', '35.229725106261185', '126.84592674167581', '3'), store('FAR', '37.5', '127.0', '9')] });
  assert.deepEqual(rows.map((r) => [r.key, r.chain, r.name, r.qty, Math.round(r.km * 10) / 10]), [['gs25stock:V8M37', 'GS25', 'V8M37점', 3, 0.3]]);
});

test('gs25: 형태 다른 재고 응답은 throw', () => {
  assert.throws(() => parseStock({ error: {} }), /형태/);
  assert.throws(() => parseStock({ stores: [store('A', '35.2297', '126.8459', null)] }), /형태/);
});
