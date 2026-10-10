# 포켓몬카드 30주년 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions 가 5분마다 카카오 채널·세븐일레븐·이마트24·GS25 를 확인해, 새 글이나 GIST 5km 내 30주년 팩 재고가 생기면 텔레그램으로 알린다.

**Architecture:** Node 24 스크립트 하나(`src/check.js`)가 소스 4개를 병렬 조회하고, 순수 함수 `diff(prev, results)` 가 이전 state 와 비교해 알림 문구와 새 state 를 만든다. state 는 `actions/cache` 로 실행 사이에 이어진다. 각 소스는 "응답 → 공통 모양" 순수 파서와 fetch 함수를 분리해 파서만 테스트한다.

**Tech Stack:** Node 24 (내장 fetch, node:crypto, node --test), GitHub Actions, Telegram Bot API. 외부 의존성 0.

**Spec:** `docs/superpowers/specs/2026-10-10-pokemon-alert-design.md`

## Global Constraints

- Node 24, `"type": "module"`, npm 의존성 0개 (devDependencies 포함)
- 테스트는 `node --test` 만. 네트워크를 쓰는 테스트 금지
- 위치 GIST `lat 35.2286, lng 126.8430`, 반경 `5` km
- 상품 바코드 `8800286275732` (세븐·이마트24·GS25 공통)
- 공통 헤더 `User-Agent: Mozilla/5.0 (Linux; Android 15)`, `Accept: application/json, text/plain, */*`
- 재고 행 공통 모양: `{ key: '<src>:<storeId>', chain: '세븐일레븐'|'이마트24', name, qty: number, km: number }`
- 이마트24 `bizNoArr` 를 빈 값으로 호출 금지 (전국 조회가 된다)
- 텔레그램 토큰이 로그·에러 메시지·커밋에 절대 나오지 않는다
- Actions 버전: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache/restore@v6`, `actions/cache/save@v6`
- 코드 주석·커밋 메시지·사용자 문구는 한국어. 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- git 작성자는 repo 로컬 설정(`두영 <kdylee0713@gmail.com>`) 그대로. 바꾸지 않는다

## Review Focus

1. 첫 실행 때 카카오가 실패하고 다음 실행에 성공 → 글 20개 폭탄이 아니라 최신 1개만 (Task 6 테스트)
2. 업스트림이 HTML 차단 페이지나 다른 형태 JSON 을 줌 → 빈 배열로 조용히 넘어가면 재고가 0 으로 덮이고 감시도 안 울린다. 파서는 throw 해야 한다 (Task 2~5 각 "형태 다른 응답 throw" 테스트)
3. 이마트24 매장 목록이 비었을 때 → 빈 `bizNoArr` 호출(전국 조회) 금지 (Task 4 `stockUrls` 테스트)
4. 세븐 매장 검색 두 키워드 결과가 겹치거나 5km 밖·좌표 없음·폐점 매장 포함 → 중복 제거·제외 (Task 3 테스트)
5. 재고 1→0→1 (재입고) → 다시 알림. 실패한 소스의 이전 재고는 보존돼서 복구 직후 오탐 없음 (Task 6 테스트)

## 실행 메모 (에이전트 팀)

- Task 1 먼저 (모두가 쓰는 `src/common.js` 를 만든다).
- **Task 2·3·4·5·6 은 서로 다른 파일만 건드리므로 병렬 가능.** 병렬로 돌릴 때 구현 에이전트는 커밋하지 않는다 (git index 충돌). 리뷰 통과 후 컨트롤러가 태스크별로 커밋한다.
- Task 7 은 2~6 이 모두 끝난 뒤. Task 8 은 사용자 입력(텔레그램 봇 토큰)이 필요해 컨트롤러가 사용자와 진행.

## File Structure

```
package.json
src/common.js            상수(HOME, RADIUS_KM, BARCODE, HEADERS), km(), nearHome(), stockRow(), fetchJson()
src/sources/kakao.js     parsePosts(json), fetchPosts()
src/sources/seven.js     parseStores(jsons), parseStock(json, stores), fetchStock(barcode)
src/sources/emart24.js   parseStores(json), stockUrls(barcode, ids), parseStock(json, stores), fetchStock(barcode)
src/sources/gs25.js      parseListed(json, barcode), isListed(barcode)
src/diff.js              diff(prev, results) → { state, text }
src/telegram.js          send(text)
src/check.js             진입점
test/kakao.test.js  test/seven.test.js  test/emart24.test.js  test/gs25.test.js  test/diff.test.js
.github/workflows/check.yml
scripts/probe.js + .github/workflows/probe.yml   (Task 1 에서 만들고 Task 7 에서 삭제)
README.md
```

---

### Task 1: 뼈대 + GitHub repo + Actions IP 검증

**Files:**
- Create: `package.json`, `src/common.js`, `scripts/probe.js`, `.github/workflows/probe.yml`

**Interfaces:**
- Produces (`src/common.js`):
  - `HOME: {lat: number, lng: number}`, `RADIUS_KM: number`, `BARCODE: string`, `HEADERS: object`
  - `km(lat1, lng1, lat2, lng2): number` — 하버사인, km
  - `nearHome(lat, lng): boolean` — 문자열 좌표도 받는다
  - `stockRow(src: string, chain: string, store: {id, name, lat, lng}, qty): {key, chain, name, qty, km}`
  - `fetchJson(url, opts?): Promise<any>` — HEADERS 병합, 20초 타임아웃, 2xx 아니면 `Error('HTTP <status> <query 뺀 url>')`, 빈 본문이면 `null`, JSON 아니면 `Error('JSON 아님 ...')`

- [ ] **Step 1: package.json**

```json
{
  "name": "pokemon-alert",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "node --test",
    "check": "node --env-file-if-exists=.env src/check.js"
  }
}
```

- [ ] **Step 2: src/common.js**

```js
export const HOME = { lat: 35.2286, lng: 126.843 }; // GIST
export const RADIUS_KM = 5;
export const BARCODE = '8800286275732'; // 포켓몬카드 30주년 팩 3,500원. 세븐·이마트24·GS25 공통 바코드
export const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15)', Accept: 'application/json, text/plain, */*' };

export function km(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const nearHome = (lat, lng) => km(HOME.lat, HOME.lng, Number(lat), Number(lng)) <= RADIUS_KM;

export const stockRow = (src, chain, store, qty) => ({
  key: `${src}:${store.id}`,
  chain,
  name: store.name,
  qty: Number(qty) || 0,
  km: km(HOME.lat, HOME.lng, store.lat, store.lng),
});

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  const where = url.split('?')[0];
  if (!res.ok) throw new Error(`HTTP ${res.status} ${where}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON 아님 ${where}: ${text.slice(0, 80)}`);
  }
}
```

- [ ] **Step 3: scripts/probe.js**

```js
// Actions 러너 IP 에서 각 API 가 WAF 에 막히는지 1회씩 확인한다. 확인이 끝나면 지운다.
import { HEADERS } from '../src/common.js';

const json = { 'Content-Type': 'application/json' };
const checks = {
  kakao: ['https://pf.kakao.com/rocket-web/web/profiles/_kxhLKxj/posts'],
  seven_product: ['https://new.7-elevenapp.co.kr/api/v1/open/product/search/stock?itemCd=8800286275732'],
  seven_store: ['https://new.7-elevenapp.co.kr/api/v1/open/search/store',
    { method: 'POST', headers: json, body: JSON.stringify({ collection: 'store', query: '첨단', sort: 'Date/desc', listCount: 5 }) }],
  emart24_store: ['https://emart24.co.kr/api1/store?page=1&top=126.86&bottom=126.82&left=35.21&right=35.24'],
  emart24_stock: ['https://everse.emart24.co.kr/api/stock/v2/stock-search/store?searchPluCode=8800286275732&bizNoArr=20913',
    { headers: { 'x-requested-with': 'XMLHttpRequest' } }],
  gs25_search: ['https://b2c-apigw.woodongs.com/search/v3/totalSearch',
    { method: 'POST', headers: json, body: JSON.stringify({ query: '포켓몬카드' }) }],
};

for (const [name, [url, opts = {}]] of Object.entries(checks)) {
  try {
    const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers }, signal: AbortSignal.timeout(20_000) });
    console.log(name, res.status, (await res.text()).slice(0, 100).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(name, 'ERROR', e.message);
  }
}
```

- [ ] **Step 4: .github/workflows/probe.yml**

```yaml
# 임시: Actions 러너 IP 에서 API 들이 막히는지 확인. Task 7 에서 지운다.
name: probe
on: workflow_dispatch
jobs:
  probe:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: node scripts/probe.js
```

- [ ] **Step 5: 로컬에서 probe 실행**

Run: `node scripts/probe.js`
Expected: 6줄 모두 `200`. (이 맥은 한국 IP. 여기서 200 이 아니면 멈추고 보고)

- [ ] **Step 6: 커밋 + public repo 생성 + 푸시**

```bash
git add package.json src/common.js scripts/probe.js .github/workflows/probe.yml
git commit -m "chore: 뼈대와 Actions IP 검증용 probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh repo create hidudu0/pokemon-alert --public --source . --push
```

- [ ] **Step 7: Actions 에서 probe 실행하고 결과 기록**

```bash
gh workflow run probe.yml -R hidudu0/pokemon-alert
sleep 5; gh run watch -R hidudu0/pokemon-alert $(gh run list -R hidudu0/pokemon-alert -w probe.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run view -R hidudu0/pokemon-alert --log $(gh run list -R hidudu0/pokemon-alert -w probe.yml -L 1 --json databaseId -q '.[0].databaseId') | grep -E 'kakao|seven_|emart24_|gs25_'
```

Expected: 6줄의 상태 코드. **결과를 그대로 보고에 포함한다.** 403/ERROR 가 있어도 이 태스크는 완료로 보고 (컨트롤러가 사용자와 대안 결정).

---

### Task 2: 카카오 채널 소스

**Files:**
- Create: `src/sources/kakao.js`
- Test: `test/kakao.test.js`

**Interfaces:**
- Consumes: `fetchJson` from `src/common.js`
- Produces: `parsePosts(json): {id: number, title: string, url: string}[]`, `fetchPosts(): Promise<같은 배열>` (응답 순서 유지 = 최신 발행 먼저)

- [ ] **Step 1: 실패하는 테스트**

```js
// test/kakao.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePosts } from '../src/sources/kakao.js';

test('kakao: 글 목록을 {id,title,url} 로. 제목 없으면 본문 첫 줄', () => {
  const posts = parsePosts({
    has_next: true,
    items: [
      { id: 114844370, title: ' 10/09 포켓몬카드 판매 안내 ', permalink: 'http://pf.kakao.com/_kxhLKxj/114844370', contents: [] },
      { id: 114841163, title: '', contents: [{ t: 'image', v: 'x' }, { t: 'text', v: '\n★ 30th CELEBRATION 입고\n둘째 줄' }] },
      { id: 114841170, title: '' },
    ],
  });
  assert.deepEqual(posts, [
    { id: 114844370, title: '10/09 포켓몬카드 판매 안내', url: 'https://pf.kakao.com/_kxhLKxj/114844370' },
    { id: 114841163, title: '★ 30th CELEBRATION 입고', url: 'https://pf.kakao.com/_kxhLKxj/114841163' },
    { id: 114841170, title: '(제목 없음)', url: 'https://pf.kakao.com/_kxhLKxj/114841170' },
  ]);
});

test('kakao: 형태 다른 응답은 throw', () => {
  assert.throws(() => parsePosts({ error: 'blocked' }), /items/);
  assert.throws(() => parsePosts(null), /items/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/kakao.test.js`
Expected: FAIL — `Cannot find module '../src/sources/kakao.js'`

- [ ] **Step 3: 구현**

```js
// src/sources/kakao.js — 포켓몬카드샵 광주 화성스토어TCG 카카오 채널
import { fetchJson } from '../common.js';

const POSTS = 'https://pf.kakao.com/rocket-web/web/profiles/_kxhLKxj/posts';

const firstLine = (p) => (p.contents ?? []).find((c) => c.t === 'text')?.v.trim().split('\n')[0];

export function parsePosts(json) {
  if (!Array.isArray(json?.items)) throw new Error('카카오 응답에 items 없음');
  return json.items.map((p) => ({
    id: p.id,
    title: p.title?.trim() || firstLine(p) || '(제목 없음)',
    url: `https://pf.kakao.com/_kxhLKxj/${p.id}`,
  }));
}

export const fetchPosts = async () => parsePosts(await fetchJson(POSTS));
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/kakao.test.js`
Expected: PASS 2/2

- [ ] **Step 5: 실제 응답으로 한 번 확인 (네트워크)**

Run: `node -e "import('./src/sources/kakao.js').then(m=>m.fetchPosts()).then(p=>console.log(p.length, p[0]))"`
Expected: `20 { id: ..., title: '...', url: 'https://pf.kakao.com/_kxhLKxj/...' }`

- [ ] **Step 6: 커밋** (병렬 실행 중이면 생략, 컨트롤러가 커밋)

```bash
git add src/sources/kakao.js test/kakao.test.js
git commit -m "feat: 카카오 채널 글 목록 소스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 세븐일레븐 소스

**Files:**
- Create: `src/sources/seven.js`
- Test: `test/seven.test.js`

**Interfaces:**
- Consumes: `fetchJson, nearHome, stockRow, HOME` from `src/common.js`
- Produces: `parseStores(jsons: object[]): {id, name, lat, lng}[]`, `parseStock(json, stores): StockRow[]`, `fetchStock(barcode): Promise<StockRow[]>`

배경 (spec 에서 검증된 사실):
- 매장 검색은 키워드만 된다. `광산구`, `북구` 두 번이면 GIST 5km 매장 66개가 다 잡힌다.
- 재고 조회 `storeCdList` 66개 한 번에 OK. 응답엔 **그 상품을 취급하는 매장만** 온다. `storeNm` 필드는 보내지 않는다.
- 좌표는 아래 공개키로 RSA-OAEP-SHA256 암호화 + base64 해서 보낸다.
- 바코드 → `smCd` 는 `/api/v1/open/product/search/stock?itemCd=` 가 감싸지 않은 객체로 준다. 모르는 바코드면 빈 본문.

- [ ] **Step 1: 실패하는 테스트**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/seven.test.js`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 구현**

```js
// src/sources/seven.js — 세븐일레븐 (세븐앱 웹 API)
import { publicEncrypt, constants } from 'node:crypto';
import { fetchJson, nearHome, stockRow, HOME } from '../common.js';

const BASE = 'https://new.7-elevenapp.co.kr';
// 홈페이지 런타임 설정(rsaPublicKey)에 공개된 키. 좌표를 평문으로 보내면 "RSA 복호화 실패".
const RSA_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7n9T9y2rflLzbudMjm+PslBSQTGGCPaySE5ayghbr6lRZ4QDA+WTf2SDxjBWh91J7C2NkTQ6FSHHxdFemvHBIKZtACNOBgsQaO7Q0Sh5nrl34XSVrq53hMIHC7OmP98Wqjqdz6c6BQFicyefGZffOtyG4eBjWtu0oAd0/wW902X0sVnzn/g30V6r1IvvE3ov8Nq49W2F7g1goh1IMPtay2lSvc1259vviV1ONOsqyzmrDY+q9kkEW6bXckZH53Soihhgf+bUA36qagV7EbQKorNwNHYyICHZRRxiFem7Y/vlYWIOamJNSdlPHRdl4epAPMHDVvRxGpteNWkVbr3ybQIDAQAB';
const PEM = `-----BEGIN PUBLIC KEY-----\n${RSA_KEY.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
const enc = (v) =>
  publicEncrypt({ key: PEM, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(String(v))).toString('base64');

const STORE_QUERIES = ['광산구', '북구']; // GIST 5km 원이 걸치는 구. 매장 검색은 키워드만 된다

const post = (path, body) =>
  fetchJson(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function parseStores(jsons) {
  const byId = new Map();
  for (const json of jsons) {
    const docs = json?.data?.SearchQueryResult?.Collection?.[0]?.Documentset?.Document;
    if (!Array.isArray(docs)) throw new Error('세븐 매장 검색 응답 형태 다름');
    for (const { field: f } of docs) {
      if (!f.storeLat || !f.storeLon || f.storeCloseYn === 'Y' || !nearHome(f.storeLat, f.storeLon)) continue;
      byId.set(f.storeCd, { id: f.storeCd, name: f.storeNm, lat: Number(f.storeLat), lng: Number(f.storeLon) });
    }
  }
  return [...byId.values()];
}

export function parseStock(json, stores) {
  const list = json?.data?.storeList;
  if (!Array.isArray(list)) throw new Error('세븐 재고 응답 형태 다름');
  const byId = new Map(stores.map((s) => [s.id, s]));
  return list.filter((r) => byId.has(r.storeCd)).map((r) => stockRow('seven', '세븐일레븐', byId.get(r.storeCd), r.realStock));
}

export async function fetchStock(barcode) {
  const meta = await fetchJson(`${BASE}/api/v1/open/product/search/stock?itemCd=${barcode}`);
  if (!meta?.smCd) return []; // 세븐에서 안 파는 바코드
  const stores = parseStores(
    await Promise.all(STORE_QUERIES.map((query) => post('/api/v1/open/search/store', { collection: 'store', query, sort: 'Date/desc', listCount: 500 }))),
  );
  if (!stores.length) throw new Error('세븐 5km 매장 0개 — 매장 검색 응답 확인 필요');
  const json = await post('/api/v1/stock/search/stores', {
    searchType: 'list',
    storeCdList: stores.map((s) => s.id),
    myLat: enc(HOME.lat),
    myLng: enc(HOME.lng),
    order: 'stock',
    smCd: meta.smCd,
    stokMngCd: meta.smCd,
    stokMngQty: 1,
    stockApplicationRate: '100',
    ignoreRateYn: 'Y',
  });
  return parseStock(json, stores);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/seven.test.js`
Expected: PASS 3/3

- [ ] **Step 5: 실제 응답으로 한 번 확인 (네트워크)**

Run: `node -e "import('./src/sources/seven.js').then(m=>m.fetchStock('8800286275732')).then(r=>console.log(r.length, r))"`
Expected: 몇 개(확인 당시 4개)의 `{ key: 'seven:…', chain: '세븐일레븐', … }`. 0개면 매장 목록 크기를 `console.log` 로 찍어 원인을 보고.

- [ ] **Step 6: 커밋** (병렬 실행 중이면 생략)

```bash
git add src/sources/seven.js test/seven.test.js
git commit -m "feat: 세븐일레븐 매장 재고 소스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 이마트24 소스

**Files:**
- Create: `src/sources/emart24.js`
- Test: `test/emart24.test.js`

**Interfaces:**
- Consumes: `fetchJson, nearHome, stockRow, HOME, RADIUS_KM` from `src/common.js`
- Produces: `parseStores(json): {id, name, lat, lng}[]`, `stockUrls(barcode, ids: string[]): string[]`, `parseStock(json, stores): StockRow[]`, `fetchStock(barcode): Promise<StockRow[]>`

배경:
- 매장 API 파라미터 이름이 뒤바뀌어 있다: `top`/`bottom` = 동/서 **경도**, `left`/`right` = 남/북 **위도**. 응답 `{error, count(전체 수), data: [...최대 40]}`. 다음 페이지가 없으면 `error: 1`, `data` 비어 있음. 5km 사각형 = 32개 (확인 당시).
- 재고 API 는 `bizNoArr` 10개까지. 응답 `storeGoodsQty` 는 항상 배열 (취급 안 하면 빈 배열).

- [ ] **Step 1: 실패하는 테스트**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/emart24.test.js`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 구현**

```js
// src/sources/emart24.js — 이마트24 (웹 매장찾기 + everse 재고조회)
import { fetchJson, nearHome, stockRow, HOME, RADIUS_KM } from '../common.js';

const STOCK_BATCH = 10; // 재고 API 가 한 번에 받는 매장 수

export function parseStores(json) {
  if (!Array.isArray(json?.data)) throw new Error('이마트24 매장 응답 형태 다름');
  return json.data
    .filter((s) => s.LATITUDE && s.LONGITUDE && nearHome(s.LATITUDE, s.LONGITUDE))
    .map((s) => ({ id: s.CODE, name: s.TITLE, lat: Number(s.LATITUDE), lng: Number(s.LONGITUDE) }));
}

// ids 가 비면 [] — bizNoArr 를 비우면 전국 조회가 되므로 빈 호출은 만들지 않는다
export function stockUrls(barcode, ids) {
  const urls = [];
  for (let i = 0; i < ids.length; i += STOCK_BATCH) {
    urls.push(`https://everse.emart24.co.kr/api/stock/v2/stock-search/store?searchPluCode=${barcode}&bizNoArr=${ids.slice(i, i + STOCK_BATCH).join(',')}`);
  }
  return urls;
}

export function parseStock(json, stores) {
  if (!Array.isArray(json?.storeGoodsQty)) throw new Error('이마트24 재고 응답 형태 다름');
  const byId = new Map(stores.map((s) => [s.id, s]));
  return json.storeGoodsQty.filter((r) => byId.has(r.BIZNO)).map((r) => stockRow('emart24', '이마트24', byId.get(r.BIZNO), r.BIZQTY));
}

async function fetchStores() {
  const dLat = RADIUS_KM / 111.32;
  const dLng = RADIUS_KM / (111.32 * Math.cos((HOME.lat * Math.PI) / 180));
  // 파라미터 이름이 뒤바뀌어 있다 (사이트 FindStore.js 기준): top/bottom = 경도, left/right = 위도
  const box = `top=${HOME.lng + dLng}&bottom=${HOME.lng - dLng}&left=${HOME.lat - dLat}&right=${HOME.lat + dLat}`;
  const stores = [];
  // ponytail: 최대 10페이지(400개). 5km 사각형은 32개라 충분
  for (let page = 1; page <= 10; page++) {
    const json = await fetchJson(`https://emart24.co.kr/api1/store?page=${page}&${box}`);
    if (page > 1 && !json?.data?.length) break;
    stores.push(...parseStores(json));
    if (json.data.length < 40) break;
  }
  return stores;
}

export async function fetchStock(barcode) {
  const stores = await fetchStores();
  if (!stores.length) throw new Error('이마트24 5km 매장 0개 — 매장 API 확인 필요');
  const rows = [];
  for (const url of stockUrls(barcode, stores.map((s) => s.id))) {
    rows.push(...parseStock(await fetchJson(url, { headers: { 'x-requested-with': 'XMLHttpRequest' } }), stores));
  }
  return rows;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/emart24.test.js`
Expected: PASS 5/5

- [ ] **Step 5: 실제 응답으로 한 번 확인 (네트워크)**

Run: `node -e "import('./src/sources/emart24.js').then(m=>m.fetchStock('8800286275732')).then(r=>console.log(r.length, r.filter(x=>x.qty>0)))"`
Expected: 여러 행. 확인 당시 `첨단메디케어점` 9개.

- [ ] **Step 6: 커밋** (병렬 실행 중이면 생략)

```bash
git add src/sources/emart24.js test/emart24.test.js
git commit -m "feat: 이마트24 매장 재고 소스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GS25 등록 감지 소스

**Files:**
- Create: `src/sources/gs25.js`
- Test: `test/gs25.test.js`

**Interfaces:**
- Consumes: `fetchJson` from `src/common.js`
- Produces: `parseListed(json, barcode): boolean`, `isListed(barcode): Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/gs25.test.js`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 구현**

```js
// src/sources/gs25.js — 우리동네GS 상품 검색. 매장 재고는 로그인 토큰이 필요해 2단계로 미룸
import { fetchJson } from '../common.js';

export function parseListed(json, barcode) {
  const col = json?.SearchQueryResult?.Collection?.find((c) => c.CollectionId === 'offlineItem');
  if (!col) throw new Error('GS25 검색 응답 형태 다름');
  return (col.Documentset?.Document ?? []).some((d) => d.field?.itemCode === barcode);
}

export const isListed = async (barcode) =>
  parseListed(
    await fetchJson('https://b2c-apigw.woodongs.com/search/v3/totalSearch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '포켓몬카드' }),
    }),
    barcode,
  );
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/gs25.test.js`
Expected: PASS 2/2

- [ ] **Step 5: 실제 응답으로 한 번 확인 (네트워크)**

Run: `node -e "import('./src/sources/gs25.js').then(m=>m.isListed('8800286275732')).then(console.log)"`
Expected: `false` (2026-10-10 기준 미등록. `true` 면 그대로 보고 — 좋은 소식)

- [ ] **Step 6: 커밋** (병렬 실행 중이면 생략)

```bash
git add src/sources/gs25.js test/gs25.test.js
git commit -m "feat: GS25 상품 등록 감지 소스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 알림 판정 diff

**Files:**
- Create: `src/diff.js`
- Test: `test/diff.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수). 입력 모양은 Task 2~5 의 Produces 와 같다
- Produces: `diff(prev: State | {}, results: Results): { state: State, text: string }`
  - `Results = { kakao, seven, emart24, gs25 }`, 각 값은 `{ ok: true, value }` 또는 `{ ok: false, error: string }`
    - `kakao.value: {id, title, url}[]`, `seven.value / emart24.value: StockRow[]`, `gs25.value: boolean`
  - `State = { initialized: true, kakaoSeen: number[], stock: {[key]: number}, gs25Listed: boolean, failures: {[src]: number} }`
  - `text === ''` 이면 보낼 게 없다

- [ ] **Step 1: 실패하는 테스트**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/diff.test.js`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: 구현**

```js
// src/diff.js — 이전 state 와 이번 조회 결과를 비교해 알림 문구와 새 state 를 만든다 (순수 함수)
const LABEL = { kakao: '카카오 화성스토어TCG', seven: '세븐일레븐', emart24: '이마트24', gs25: 'GS25' };
const KEEP_SEEN = 100;
const FAIL_ALERT_AT = 3;

// prev: 이전 state ({} 이면 첫 실행). results: { 소스: {ok:true, value} | {ok:false, error} }
// 실패한 소스의 state 는 그대로 둔다 (복구 직후 오탐 방지).
export function diff(prev, results) {
  const first = !prev.initialized;
  const state = {
    initialized: true,
    kakaoSeen: prev.kakaoSeen ?? [],
    stock: { ...prev.stock },
    gs25Listed: prev.gs25Listed ?? false,
    failures: { ...prev.failures },
  };
  const stock = [];
  const gs25 = [];
  const kakao = [];
  const health = [];

  for (const src of ['seven', 'emart24']) {
    if (!results[src]?.ok) continue;
    for (const key of Object.keys(state.stock)) if (key.startsWith(`${src}:`)) state.stock[key] = 0; // 응답에 없는 매장 = 0
    for (const r of results[src].value) {
      if (r.qty > 0 && !(prev.stock?.[r.key] > 0)) stock.push(`🟢 ${r.chain} ${r.name} ${r.qty}개 (${r.km.toFixed(1)}km)`);
      state.stock[r.key] = r.qty;
    }
  }

  if (results.gs25?.ok) {
    if (results.gs25.value && !state.gs25Listed) gs25.push('🆕 GS25 상품 검색에 30주년 팩 등록됨 (매장 재고는 우리동네GS 앱에서)');
    state.gs25Listed = results.gs25.value;
  }

  if (results.kakao?.ok) {
    const posts = results.kakao.value;
    const seen = new Set(state.kakaoSeen);
    // 아직 본 글이 하나도 없으면 최신 1개만 보여주고 나머지는 본 것으로 (글 폭탄 방지)
    const fresh = seen.size ? posts.filter((p) => !seen.has(p.id)) : posts.slice(0, 1);
    for (const p of fresh) kakao.push(`📢 ${p.title}`, p.url);
    state.kakaoSeen = [...new Set([...posts.map((p) => p.id), ...state.kakaoSeen])].slice(0, KEEP_SEEN);
  }

  for (const [src, r] of Object.entries(results)) {
    const n = state.failures[src] ?? 0;
    if (r.ok) {
      if (n >= FAIL_ALERT_AT) health.push(`✅ ${LABEL[src]} 복구`);
      state.failures[src] = 0;
    } else {
      state.failures[src] = n + 1;
      if (n + 1 === FAIL_ALERT_AT) health.push(`⚠️ ${LABEL[src]} 조회 실패: ${r.error}`);
    }
  }

  const lines = [...stock, ...gs25, ...kakao, ...health];
  if (first) lines.unshift('📋 포켓몬카드 30주년 알림 시작', ...(stock.length ? [] : ['재고 있는 매장 없음']));
  return { state, text: lines.join('\n') };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test/diff.test.js`
Expected: PASS 10/10

- [ ] **Step 5: 커밋** (병렬 실행 중이면 생략)

```bash
git add src/diff.js test/diff.test.js
git commit -m "feat: 새 글·재입고·장애 알림 판정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 진입점 + 텔레그램 + 워크플로

**Files:**
- Create: `src/telegram.js`, `src/check.js`, `.github/workflows/check.yml`, `README.md`
- Delete: `scripts/probe.js`, `.github/workflows/probe.yml`

**Interfaces:**
- Consumes: `fetchPosts` (Task 2), `seven.fetchStock` (Task 3), `emart24.fetchStock` (Task 4), `isListed` (Task 5), `diff` (Task 6), `BARCODE` (Task 1)
- Produces: `send(text): Promise<void>` — env `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` 필요, 실패 시 throw

- [ ] **Step 1: src/telegram.js**

```js
// 텔레그램 봇으로 나에게 메시지. 토큰은 env 로만 받고 에러 메시지에 넣지 않는다.
export async function send(text) {
  const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 환경변수 없음');
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 4096자 넘으면 텔레그램이 400 을 준다 → 매번 실패해 state 가 영영 저장 안 되는 걸 막는다
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4096), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`텔레그램 발송 실패 ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 2: src/check.js**

```js
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
```

- [ ] **Step 3: 전체 테스트**

Run: `node --test`
Expected: PASS — kakao 2, seven 3, emart24 5, gs25 2, diff 10 = 22개

- [ ] **Step 4: 텔레그램 없이 로컬 실행 → 발송 실패 시 state 미저장 확인 (Review Focus)**

Run: `rm -f state.json; env -u TELEGRAM_TOKEN -u TELEGRAM_CHAT_ID node src/check.js; echo "exit=$?"; ls state.json`
Expected: 소스 4줄 `ok`, `📋 포켓몬카드 30주년 알림 시작` 으로 시작하는 문구 출력, `TELEGRAM_TOKEN / TELEGRAM_CHAT_ID 환경변수 없음` 에러, `exit=1`, `ls: state.json: No such file or directory`

- [ ] **Step 5: .github/workflows/check.yml**

```yaml
# 5분마다 확인. GitHub 무료 cron 은 수 분~십수 분 늦게 돌 수 있다.
# repo 에 60일간 커밋이 없으면 GitHub 가 예약 실행을 끈다 → Actions 탭에서 다시 켠다.
name: check
on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

# 실행이 겹치면 state 가 꼬인다
concurrency:
  group: check
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      # 가장 최근 state 를 복원 (키는 매번 새로 만들고 prefix 로 최신을 찾는다)
      - uses: actions/cache/restore@v6
        with:
          path: state.json
          key: state-${{ github.run_id }}
          restore-keys: state-
      - run: node src/check.js
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      # 위 스텝이 실패(텔레그램 발송 실패)하면 저장을 건너뛰어 다음 실행에서 재시도된다
      - uses: actions/cache/save@v6
        with:
          path: state.json
          key: state-${{ github.run_id }}
```

- [ ] **Step 6: README.md**

```markdown
# 포켓몬카드 30주년 알림

GIST 5km 안 편의점(세븐일레븐·이마트24)에 30주년 팩 재고가 생기거나,
광주 화성스토어TCG 카카오 채널에 새 글이 올라오면 텔레그램으로 알려준다. 나 혼자 쓰는 용도.

GitHub Actions 가 5분마다 `src/check.js` 를 돌린다. 이전 상태는 Actions cache 의 `state.json`.

| 소스 | 알림 조건 |
|---|---|
| 카카오 채널 `_kxhLKxj` | 새 글 전부 |
| 세븐일레븐 · 이마트24 | 매장별 재고 0 → 1개 이상 |
| GS25 | 상품 검색에 30주년 팩이 처음 등록될 때 (매장 재고는 로그인 필요라 미구현) |
| 공통 | 한 소스가 3번 연속 실패하면 경고, 복구되면 알림 |

## 설정

1. 텔레그램 @BotFather → `/newbot` → 토큰
2. 만든 봇에게 아무 메시지나 보낸 뒤 chat id 확인:
   `curl -s "https://api.telegram.org/bot<토큰>/getUpdates" | grep -o '"chat":{"id":[0-9-]*'`
3. `gh secret set TELEGRAM_TOKEN` / `gh secret set TELEGRAM_CHAT_ID` (프롬프트에 붙여넣기)
4. `gh workflow run check.yml` → 폰에 "📋 포켓몬카드 30주년 알림 시작"

## 명령

- `npm test` — 테스트 (네트워크 안 씀)
- `npm run check` — 로컬 1회 실행 (`.env` 에 TELEGRAM_TOKEN, TELEGRAM_CHAT_ID). 로컬 state.json 은 Actions 와 별개
- 상품 바꾸기: `src/common.js` 의 `BARCODE`

## 주의

- 전부 비공개 웹 API 라 예고 없이 바뀔 수 있다. 바뀌면 파서가 throw → 3회 후 텔레그램 경고.
- 60일간 커밋이 없으면 GitHub 가 예약 실행을 끈다.
- 설계: `docs/superpowers/specs/2026-10-10-pokemon-alert-design.md`
```

- [ ] **Step 7: probe 삭제 + 커밋 + 푸시**

```bash
git rm -q scripts/probe.js .github/workflows/probe.yml
git add src/telegram.js src/check.js .github/workflows/check.yml README.md
git commit -m "feat: 진입점·텔레그램 발송·5분 cron 워크플로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Expected: push 성공. (Secrets 가 아직 없으므로 cron 실행은 텔레그램 단계에서 실패한다 — Task 8 에서 해결. state 가 저장되지 않으니 Secrets 등록 후 첫 성공 실행이 "첫 실행 요약"이 된다)

---

### Task 8: Secrets 등록 + 실제 알림 확인 (컨트롤러 + 사용자)

토큰을 채팅에 붙여넣지 않게, 사용자가 자기 터미널에서 직접 입력한다.

- [ ] **Step 1: 사용자에게 안내**

1. 텔레그램 @BotFather → `/newbot` → 토큰 받기
2. 만든 봇과 대화 열고 아무 메시지 보내기
3. 터미널에서:
   ```bash
   cd ~/Desktop/포켓몬
   gh secret set TELEGRAM_TOKEN          # 프롬프트에 토큰 붙여넣기
   read -s T && curl -s "https://api.telegram.org/bot$T/getUpdates" | grep -o '"chat":{"id":[0-9-]*'; unset T
   gh secret set TELEGRAM_CHAT_ID        # 위에서 나온 숫자
   ```

- [ ] **Step 2: 수동 실행**

Run: `gh workflow run check.yml && sleep 5 && gh run watch $(gh run list -w check.yml -L 1 --json databaseId -q '.[0].databaseId')`
Expected: 성공. 사용자 폰에 "📋 포켓몬카드 30주년 알림 시작" + 현재 재고 + 최신 카카오 글.

- [ ] **Step 3: 로그에서 소스별 상태 확인**

Run: `gh run view --log $(gh run list -w check.yml -L 1 --json databaseId -q '.[0].databaseId') | grep -E '(kakao|seven|emart24|gs25) (ok|FAIL)'`
Expected: 4줄 모두 `ok`. FAIL 이 있으면 사용자에게 보고하고 대안(맥 self-hosted runner 등) 상의.

- [ ] **Step 4: 다음 cron 실행이 "(알림 없음)" 으로 끝나는지 확인**

10~20분 뒤 `gh run list -w check.yml -L 3` 에서 schedule 실행이 success, 로그에 `(알림 없음)` (그 사이 변화가 없었다면).
