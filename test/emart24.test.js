// test/emart24.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStores, stockUrls, parseStock } from '../src/sources/emart24.js';

test('emart24: 5km 원 밖(사각형 모서리)·좌표 없는 매장 제외', () => {
  const stores = parseStores({
    error: 0,
    count: 3,
    data: [
      { CODE: '20913', TITLE: '첨단메디케어점', LATITUDE: '35.2136422667519', LONGITUDE: '126.850841892567' },
      { CODE: '99999', TITLE: '모서리점', LATITUDE: '35.2700', LONGITUDE: '126.8950' }, // 약 6.6km
      { CODE: '88888', TITLE: '좌표없음점', LATITUDE: '', LONGITUDE: '' },
    ],
  });
  assert.deepEqual(stores, [{ id: '20913', name: '첨단메디케어점', lat: 35.2136422667519, lng: 126.850841892567 }]);
});

test('emart24: 매장 0개면 재고 URL 도 0개 (빈 bizNoArr = 전국 조회 금지)', () => {
  assert.deepEqual(stockUrls('8800286275732', []), []);
});

test('emart24: 재고 조회는 10개씩 나눈다', () => {
  const urls = stockUrls('8800286275732', Array.from({ length: 23 }, (_, i) => String(i)));
  assert.equal(urls.length, 3);
  assert.match(urls[0], /searchPluCode=8800286275732&bizNoArr=0,1,2,3,4,5,6,7,8,9$/);
  assert.match(urls[2], /bizNoArr=20,21,22$/);
});

test('emart24: 재고 API 는 v3 (2026-10-13 v2 는 "99999…" 문자열만 준다)', () => {
  assert.match(stockUrls('8800286275732', ['1'])[0], /\/api\/stock\/v3\/stock-search\/store\?/);
});

test('emart24: v2 폐기 응답처럼 storeGoodsQty 가 배열이 아니면 throw', () => {
  assert.throws(() => parseStock({ storeGoodsQty: '99999999999999999999999', storeInfo: '99999999999999999999999' }, []), /형태/);
});

test('emart24: 재고 응답을 공통 모양으로', () => {
  const stores = [{ id: '20913', name: '첨단메디케어점', lat: 35.2136422667519, lng: 126.850841892567 }];
  const rows = parseStock({ storeGoodsQty: [{ BIZNO: '20913', PLU_CD: '8800286275732', BIZQTY: 9 }], storeInfo: [] }, stores);
  assert.deepEqual({ ...rows[0], km: Math.round(rows[0].km * 10) / 10 }, {
    key: 'emart24:20913', chain: '이마트24', name: '첨단메디케어점', qty: 9, km: 1.8,
  });
});

test('emart24: 형태 다른 응답은 throw', () => {
  assert.throws(() => parseStores({ error: 1 }), /형태/);
  assert.throws(() => parseStock({ storeGoodsInfo: null }, []), /형태/);
});

const 첨단 = { id: '20913', name: '첨단메디케어점', lat: 35.2136422667519, lng: 126.850841892567 };

test('emart24: 수량 필드 이름이 바뀌면 0 으로 삼키지 않고 throw', () => {
  assert.throws(() => parseStock({ storeGoodsQty: [{ BIZNO: '20913', QTY: 9 }] }, [첨단]), /형태/);
});

test('emart24: 숫자 BIZNO 도 매장과 맞춘다', () => {
  const rows = parseStock({ storeGoodsQty: [{ BIZNO: 20913, BIZQTY: 9 }] }, [첨단]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'emart24:20913');
  assert.equal(rows[0].qty, 9);
});

test('emart24: CODE 없는 매장은 throw (빈 bizNoArr 방지)', () => {
  assert.throws(
    () => parseStores({ data: [{ TITLE: '코드없음점', LATITUDE: '35.2136422667519', LONGITUDE: '126.850841892567' }] }),
    /CODE/,
  );
});

test('emart24: BIZNO 필드 이름이 바뀌면 조용히 0건이 아니라 throw', () => {
  assert.throws(() => parseStock({ storeGoodsQty: [{ bizno: '20913', BIZQTY: 9 }] }, [첨단]), /BIZNO/);
});
