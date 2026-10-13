// test/heartbeat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { due, report } from '../src/heartbeat.js';

const at = (s) => new Date(`2026-10-13T${s}+09:00`);
const state = (o = {}) => ({ stock: { 'seven:1': 0, 'seven:2': 3, 'gs25stock:A': 0 }, failures: { seven: 0, gs25stock: 0 }, ...o });
const facts = (o = {}) => ({
  now: at('11:00:05'),
  state: state(),
  session: at('11:00:05').getTime() + 80 * 86_400_000,
  actions: { total: 500, failed: 0, last: at('10:58:00') },
  ...o,
});

test('heartbeat: 11시 이후 첫 실행에서 하루 한 번', () => {
  assert.equal(due(undefined, at('10:59:00'), 11), false);
  assert.equal(due(undefined, at('11:00:00'), 11), true);
  assert.equal(due('2026-10-12', at('15:30:00'), 11), true); // 11시에 맥이 꺼져 있었으면 켜진 뒤
  assert.equal(due('2026-10-13', at('11:05:00'), 11), false);
});

test('heartbeat: 다 정상이면 ✅ 와 요약', () => {
  const t = report(facts());
  assert.match(t, /^✅/);
  assert.match(t, /세븐일레븐 2곳 감시, 재고 있는 곳 1/);
  assert.match(t, /GS25 1곳 감시, 재고 있는 곳 0/);
  assert.match(t, /GS25 로그인 80일 남음/);
  assert.match(t, /Actions 24시간 500번 실행, 실패 0번, 마지막 2분 전/);
  assert.doesNotMatch(t, /⚠️/);
});

test('heartbeat: 이상이 하나라도 있으면 ⚠️ 와 이유', () => {
  const t = report(facts({
    state: state({ failures: { seven: 2, gs25stock: 0 } }),
    session: at('11:00:05').getTime() + 3 * 86_400_000,
    actions: { total: 10, failed: 1, last: at('09:00:00') },
  }));
  assert.match(t, /^⚠️/);
  assert.match(t, /세븐일레븐 최근 2번 연속 실패/);
  assert.match(t, /GS25 로그인 3일 뒤 만료/);
  assert.match(t, /Actions 마지막 실행 120분 전/);
  assert.match(t, /Actions 실패 1번/);
});

test('heartbeat: 세션·Actions 정보를 못 얻어도 ⚠️ 로 알린다', () => {
  const t = report(facts({ session: null, actions: null, state: state({ stock: {} }) }));
  assert.match(t, /^⚠️/);
  assert.match(t, /GS25 로그인 세션 없음/);
  assert.match(t, /Actions 상태 조회 실패/);
  assert.match(t, /세븐일레븐 감시 매장 0곳/);
});
