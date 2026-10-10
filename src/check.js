// 5분마다 Actions 가 실행. 조회 → 비교 → 알림 → state 저장.
// 텔레그램 발송이 실패하면 state 를 저장하지 않고 exit 1 → 다음 실행에서 같은 알림을 다시 시도한다.
import { readFile, writeFile } from 'node:fs/promises';
import { BARCODE } from './common.js';
import { diff } from './diff.js';
import { send } from './telegram.js';
import { fetchPosts } from './sources/kakao.js';
import * as seven from './sources/seven.js';
import * as emart24 from './sources/emart24.js';
import { isListed } from './sources/gs25.js';

const STATE = new URL('../state.json', import.meta.url);
const prev = JSON.parse(await readFile(STATE, 'utf8').catch(() => '{}'));

const jobs = {
  kakao: fetchPosts(),
  seven: seven.fetchStock(BARCODE),
  emart24: emart24.fetchStock(BARCODE),
  gs25: isListed(BARCODE),
};
const settled = await Promise.allSettled(Object.values(jobs));
const results = Object.fromEntries(
  Object.keys(jobs).map((k, i) => {
    const s = settled[i];
    return [k, s.status === 'fulfilled' ? { ok: true, value: s.value } : { ok: false, error: String(s.reason?.message ?? s.reason).slice(0, 200) }];
  }),
);
for (const [k, r] of Object.entries(results)) console.log(k, r.ok ? 'ok' : `FAIL ${r.error}`);

const { state, text } = diff(prev, results);
console.log(text || '(알림 없음)');
if (text) await send(text);
await writeFile(STATE, JSON.stringify(state, null, 2));
