// test/diff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff } from '../src/diff.js';

const ok = (value) => ({ ok: true, value });
const fail = (error = 'HTTP 403') => ({ ok: false, error });
const post = (id) => ({ id, title: `글${id}`, url: `https://pf.kakao.com/_kxhLKxj/${id}` });
const row = (src, id, qty) => ({ key: `${src}:${id}`, chain: src === 'seven' ? '세븐일레븐' : '이마트24', name: `${id}점`, qty, km: 1.23 });
const all = (o = {}) => ({ kakao: ok([]), seven: ok([]), emart24: ok([]), gs25: ok(false), ...o });
const base = { initialized: true, kakaoSeen: [1], stock: {}, gs25Listed: false, failures: {} };

test('첫 실행: 시작 안내 + 재고 있는 매장 + 최신 글 1개, 나머지 글은 본 것으로', () => {
  const { state, text } = diff({}, all({ kakao: ok([post(3), post(2), post(1)]), emart24: ok([row('emart24', 'A', 9), row('emart24', 'B', 0)]) }));
  assert.match(text, /^📋/);
  assert.match(text, /🟢 이마트24 A점 9개 \(1\.2km\)/);
  assert.doesNotMatch(text, /B점/);
  assert.match(text, /📢 글3/);
  assert.doesNotMatch(text, /글2/);
  assert.deepEqual(state.kakaoSeen, [3, 2, 1]);
  assert.equal(state.initialized, true);
});

test('첫 실행에 재고가 없으면 그렇다고 말한다', () => {
  assert.match(diff({}, all()).text, /재고 있는 매장 없음/);
});

test('카카오: 본 적 없는 id 만 알림 (예약 발행으로 작은 id 가 새로 와도), seen 은 100개 유지', () => {
  const prev = { ...base, kakaoSeen: Array.from({ length: 100 }, (_, i) => 1000 - i) }; // 1000..901
  const { state, text } = diff(prev, all({ kakao: ok([post(900), post(1001), post(1000)]) }));
  assert.match(text, /글900\n/);
  assert.match(text, /글1001\n/);
  assert.doesNotMatch(text, /글1000\n/);
  assert.equal(state.kakaoSeen.length, 100);
  assert.deepEqual(state.kakaoSeen.slice(0, 3), [900, 1001, 1000]);
});

test('카카오: 첫 실행 때 실패했다가 나중에 성공해도 글 폭탄 없음', () => {
  const r1 = diff({}, all({ kakao: fail() }));
  const r2 = diff(r1.state, all({ kakao: ok([post(3), post(2), post(1)]) }));
  assert.match(r2.text, /글3/);
  assert.doesNotMatch(r2.text, /글2/);
});

test('재고: 0/없음 → N 만 알림, N→M 과 N→0 은 조용히', () => {
  const prev = { ...base, stock: { 'seven:A': 0, 'seven:B': 2, 'seven:C': 3 } };
  const { state, text } = diff(prev, all({ seven: ok([row('seven', 'A', 1), row('seven', 'B', 5), row('seven', 'C', 0), row('seven', 'D', 4)]) }));
  assert.match(text, /세븐일레븐 A점 1개/);
  assert.match(text, /세븐일레븐 D점 4개/);
  assert.doesNotMatch(text, /B점|C점/);
  assert.deepEqual(state.stock, { 'seven:A': 1, 'seven:B': 5, 'seven:C': 0, 'seven:D': 4 });
});

test('재고: 응답에서 빠진 매장은 0 으로, 다시 생기면 재입고 알림', () => {
  const r1 = diff({ ...base, stock: { 'emart24:A': 9 } }, all());
  assert.equal(r1.state.stock['emart24:A'], 0);
  assert.equal(r1.text, '');
  const r2 = diff(r1.state, all({ emart24: ok([row('emart24', 'A', 2)]) }));
  assert.match(r2.text, /이마트24 A점 2개/);
});

test('실패한 소스는 이전 상태를 건드리지 않아 복구 직후 오탐이 없다', () => {
  const prev = { ...base, kakaoSeen: [5], stock: { 'seven:A': 3, 'emart24:B': 1 }, gs25Listed: true };
  const r1 = diff(prev, { kakao: fail(), seven: fail(), emart24: ok([row('emart24', 'B', 1)]), gs25: fail() });
  assert.deepEqual(r1.state.kakaoSeen, [5]);
  assert.equal(r1.state.stock['seven:A'], 3);
  assert.equal(r1.state.gs25Listed, true);
  assert.equal(r1.text, '');
  const r2 = diff(r1.state, all({ kakao: ok([post(5)]), seven: ok([row('seven', 'A', 3)]), emart24: ok([row('emart24', 'B', 1)]), gs25: ok(true) }));
  assert.equal(r2.text, '');
});

test('3번 연속 실패하면 경고 한 번, 복구되면 알림 한 번', () => {
  let s = base;
  const warned = [];
  for (let i = 0; i < 5; i++) {
    const r = diff(s, all({ seven: fail('HTTP 403 https://new.7-elevenapp.co.kr/api/v1/stock/search/stores') }));
    s = r.state;
    warned.push(r.text.includes('⚠️ 세븐일레븐 조회 실패: HTTP 403'));
  }
  assert.deepEqual(warned, [false, false, true, false, false]);
  const r = diff(s, all());
  assert.match(r.text, /✅ 세븐일레븐 복구/);
  assert.equal(r.state.failures.seven, 0);
  assert.equal(diff(r.state, all()).text, '');
});

test('GS25: 등록되는 순간 한 번만', () => {
  const r1 = diff(base, all({ gs25: ok(true) }));
  assert.match(r1.text, /🆕 GS25/);
  assert.equal(diff(r1.state, all({ gs25: ok(true) })).text, '');
});

test('알림 여러 개는 한 메시지, 재고 → GS25 → 카카오 순', () => {
  const { text } = diff(base, all({ kakao: ok([post(2), post(1)]), emart24: ok([row('emart24', 'A', 9)]), gs25: ok(true) }));
  const lines = text.split('\n');
  assert.match(lines[0], /^🟢 이마트24 A점/);
  assert.match(lines[1], /^🆕 GS25/);
  assert.equal(lines[2], '📢 글2');
  assert.equal(lines[3], 'https://pf.kakao.com/_kxhLKxj/2');
  assert.equal(lines.length, 4);
});

test('첫 실행: 실패한 소스를 밝힌다 (세븐 403 이면 "재고 없음"만으론 오해)', () => {
  const { text } = diff({}, all({ seven: fail() }));
  assert.equal(text.split('\n')[0], '📋 포켓몬카드 30주년 알림 시작');
  assert.match(text, /조회 실패: 세븐일레븐/);
});

test('첫 실행: 모두 성공하면 실패 줄 없음', () => {
  assert.doesNotMatch(diff({}, all()).text, /조회 실패/);
});
