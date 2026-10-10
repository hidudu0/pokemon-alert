// test/seven.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStores, parseStock } from '../src/sources/seven.js';

const doc = (storeCd, storeNm, storeLat, storeLon, storeCloseYn = 'N') => ({ field: { storeCd, storeNm, storeLat, storeLon, storeCloseYn } });
const search = (...docs) => ({
  success: true,
  data: { SearchQueryResult: { Collection: [{ CollectionId: 'store', Documentset: { Document: docs } }] } },
});

test('seven: 두 검색 결과를 합치고 중복·5km 밖·좌표 없음·폐점 제외', () => {
  const stores = parseStores([
    search(
      doc('68846', '광주교통방송점', '35.2215881703', '126.8463290126'),
      doc('63955', '안산스포츠파크점', '37.2945', '126.7903'),
      doc('11111', '좌표없음점', '', ''),
    ),
    search(doc('68846', '광주교통방송점', '35.2215881703', '126.8463290126'), doc('22222', '폐점', '35.2215', '126.8463', 'Y')),
  ]);
  assert.deepEqual(stores, [{ id: '68846', name: '광주교통방송점', lat: 35.2215881703, lng: 126.8463290126 }]);
});

test('seven: 재고 응답을 공통 모양으로', () => {
  const stores = [{ id: '68846', name: '광주교통방송점', lat: 35.2215881703, lng: 126.8463290126 }];
  const rows = parseStock({ success: true, data: { storeList: [{ storeCd: '68846', storeNm: '광주교통방송점', realStock: 3 }] } }, stores);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], km: Math.round(rows[0].km * 10) / 10 }, {
    key: 'seven:68846', chain: '세븐일레븐', name: '광주교통방송점', qty: 3, km: 0.8,
  });
});

test('seven: 형태 다른 응답은 throw', () => {
  assert.throws(() => parseStores([{ success: false }]), /형태/);
  assert.throws(() => parseStock({ data: {} }, []), /형태/);
});

const STORES = [{ id: '68846', name: '광주교통방송점', lat: 35.2215881703, lng: 126.8463290126 }];

test('seven: 수량 필드 이름이 바뀌면 0 으로 삼키지 않고 throw', () => {
  assert.throws(() => parseStock({ success: true, data: { storeList: [{ storeCd: '68846' }] } }, STORES), /형태/);
});

test('seven: 숫자 storeCd 도 매장과 맞춘다', () => {
  const rows = parseStock({ success: true, data: { storeList: [{ storeCd: 68846, realStock: 2 }] } }, STORES);
  assert.deepEqual(rows.map((r) => [r.key, r.qty]), [['seven:68846', 2]]);
});
