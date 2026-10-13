// 5분마다 Actions 가 실행. 조회 → 비교 → 알림 → state 저장.
// 텔레그램 발송이 실패하면 state 를 저장하지 않고 exit 1 → 다음 실행에서 같은 알림을 다시 시도한다.
import { readFile, writeFile } from 'node:fs/promises';
import { BARCODE } from './common.js';
import { diff } from './diff.js';
import { due, heartbeat, today } from './heartbeat.js';
import { send } from './telegram.js';
import { fetchPosts } from './sources/kakao.js';
import * as seven from './sources/seven.js';
import * as emart24 from './sources/emart24.js';
import * as gs25 from './sources/gs25.js';
import { onSale11st, onSaleKakaoGift } from './sources/online.js';

const STATE = new URL('../state.json', import.meta.url);
const prev = JSON.parse(await readFile(STATE, 'utf8').catch(() => '{}'));

// SOURCES=seven 처럼 쉼표로 고르면 그 소스만 돈다 (Actions 는 세븐이 403 이라 맥에서 세븐만 따로 돌린다). 없으면 전부.
const only = process.env.SOURCES?.split(',').map((s) => s.trim());
const all = {
  kakao: () => fetchPosts(),
  seven: () => seven.fetchStock(BARCODE),
  emart24: () => emart24.fetchStock(BARCODE),
  gs25: () => gs25.isListed(BARCODE),
  gs25stock: () => gs25.fetchStock(BARCODE), // 맥 전용 (로그인 세션 파일이 맥에만 있다)
  '11st': () => onSale11st(),
  kakaogift: () => onSaleKakaoGift(),
};
if (only?.some((k) => !(k in all))) throw new Error(`SOURCES 에 모르는 소스: ${only.join(',')} (가능: ${Object.keys(all).join(',')})`);
// GS25 재고는 1회에 55번 호출이라 입고 잦은 시간의 매분 실행에서도 5분마다만
const skip = (k) => k === 'gs25stock' && new Date().getMinutes() % 5 !== 0;
const jobs = Object.fromEntries(Object.entries(all).filter(([k]) => (!only || only.includes(k)) && !skip(k)).map(([k, run]) => [k, run()]));
const settled = await Promise.allSettled(Object.values(jobs));
const results = Object.fromEntries(
  Object.keys(jobs).map((k, i) => {
    const s = settled[i];
    return [k, s.status === 'fulfilled' ? { ok: true, value: s.value } : { ok: false, error: String(s.reason?.message ?? s.reason).slice(0, 200) }];
  }),
);
for (const [k, r] of Object.entries(results)) console.log(k, r.ok ? 'ok' : `FAIL ${r.error}`);

const { state, text } = diff(prev, results);
// 맥 작업만 HEARTBEAT_HOUR 를 준다. 그 시각 이후 첫 실행에서 하루 한 번 점검 메시지
const hour = process.env.HEARTBEAT_HOUR;
state.heartbeatDay = prev.heartbeatDay;
const now = new Date();
const beat = hour && due(prev.heartbeatDay, now, Number(hour)) ? await heartbeat(state, now) : '';
if (beat) state.heartbeatDay = today(now);
const out = [text, beat].filter(Boolean).join('\n\n');
console.log(out || '(알림 없음)');
if (out) await send(out);
await writeFile(STATE, JSON.stringify(state, null, 2));
