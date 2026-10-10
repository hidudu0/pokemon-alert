// test/online.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse11st, parseKakaoGift } from '../src/sources/online.js';

test('11번가: selStatCd 103 이면 판매중, 104(일시품절) 등은 아님', () => {
  assert.equal(parse11st('<script>var x = {"sellerId":"a","selStatCd":"103","imgUrl":"/t"}</script>'), true);
  assert.equal(parse11st('<script>var x = {"sellerId":"a","selStatCd":"104","imgUrl":"/t"}</script>'), false);
});

test('11번가: selStatCd 가 없으면 throw (모바일 페이지로 넘어갔거나 형태 바뀜)', () => {
  assert.throws(() => parse11st('<html>m.11st</html>'), /selStatCd/);
});

test('카카오 선물하기: soldOut 의 반대', () => {
  assert.equal(parseKakaoGift({ status: 'SOLD_OUT', soldOut: true }), false);
  assert.equal(parseKakaoGift({ status: 'ON_SALE', soldOut: false }), true);
});

test('카카오 선물하기: soldOut 이 없으면 throw', () => {
  assert.throws(() => parseKakaoGift({ errorCode: -10015 }), /soldOut/);
  assert.throws(() => parseKakaoGift(null), /soldOut/);
});
