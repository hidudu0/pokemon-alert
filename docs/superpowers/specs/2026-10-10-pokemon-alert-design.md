# 포켓몬카드 30주년 알림 — 설계

2026-10-10 · 개인용 (배포 없음, 알림 받는 사람 = 나 1명)

## 목적

포켓몬카드 30주년 팩이 GIST 근처 편의점에 들어오거나, 광주 카드샵 채널에 새 글이 올라오면
텔레그램으로 바로 알림을 받아 사러 간다. 성공 기준: 재고가 생긴 뒤 다음 확인 주기 안에 폰에 알림이 뜬다.

## 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 알림 채널 | 텔레그램 봇 `sendMessage` | 토큰 하나로 끝. 카톡 "나에게 보내기"는 OAuth 토큰을 2달마다 재발급해야 함 |
| 실행 | GitHub Actions cron `*/5`, **public** repo | 맥이 꺼져 있어도 돈다. public 이라 분 제한 없음 |
| 상태 저장 | `actions/cache` 에 `state.json` | 민감정보 없음. 키 `state-${run_id}`로 저장하고 `state-` prefix로 복원 |
| 비밀값 | GitHub Secrets `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` | 코드·cache 에 토큰 없음 |
| 런타임 | Node 24, 외부 의존성 0 | 내장 `fetch`, `node:crypto`, `node --test` |
| 위치 | GIST (lat 35.2286, lng 126.8430), 반경 5km | |
| 상품 | 30주년 팩 바코드 `8800286275732` (3,500원) | 세븐·이마트24 에서 같은 바코드 확인. GS25 도 바코드 = itemCode |

## 범위

**1단계 (이번 구현)**
1. 카카오 채널 `_kxhLKxj` (포켓몬카드샵 광주 화성스토어TCG) — 새 글 **전부** 알림
2. 세븐일레븐 — 5km 내 매장별 실재고
3. 이마트24 — 5km 내 매장별 실재고
4. GS25 — 상품 검색에 30주년 팩이 처음 등록되는 순간 1회 알림 (매장 재고 아님)

**2단계 (별도 spec)**: GS25 매장 재고. 네이버 로그인으로 GS JWT 를 받고, 갱신 토큰이 회전하므로
Actions 가 PAT 로 Secret 을 갱신해야 한다. 로그인 절차가 수동이고 GS 웹 배포마다 깨질 수 있어서 분리한다.

**하지 않음**: 웹 UI, 여러 사용자, 박스(70,000원) 추적 (원하면 바코드 한 줄 추가), CU.

## 구조

```
src/check.js            진입점. state 로드 → 소스 4개 병렬 조회(Promise.allSettled) → diff → 텔레그램 1건 → state 저장
src/sources/kakao.js    fetchPosts() → [{id, title, url}]
src/sources/seven.js    fetchStock(barcode) → [{chain, storeId, name, qty, km}]
src/sources/emart24.js  fetchStock(barcode) → 같은 모양
src/sources/gs25.js     isListed(barcode) → boolean
src/geo.js              km(lat1, lng1, lat2, lng2) 하버사인. GIST 좌표·반경 상수
src/diff.js             순수 함수 (아래 규칙). 테스트 대상
src/telegram.js         send(text)
test/*.test.js          diff + 각 소스 파서 (fixture JSON 사용)
test/fixtures/          리서치 때 받은 실제 응답
.github/workflows/check.yml
```

각 소스는 응답 → 공통 모양으로 바꾸는 **순수 파서 함수**와 fetch 하는 함수를 분리해서 export 한다.
파서는 fixture 로 테스트하고, fetch 는 테스트하지 않는다.

## 소스별 API (2026-10-10 이 맥에서 검증)

공통 헤더: `User-Agent: Mozilla/5.0 (Linux; Android 15)`, `Accept: application/json, text/plain, */*`.

### 카카오 채널
- `GET https://pf.kakao.com/rocket-web/web/profiles/_kxhLKxj/posts` → `{items:[...], has_next}` 20건
- 필드: `id`(number), `title`(trim 필요), `permalink`(http → https 로 바꿈), `published_at`(epoch ms)
- **id 는 단조증가가 아니다** (예약 발행). `id > maxId` 금지. 본 id 집합(최근 100개)으로 판정
- `Array.isArray(d.items)` 가 아니면 실패로 취급

### 세븐일레븐 (`https://new.7-elevenapp.co.kr`)
- 매장 목록: `POST /api/v1/open/search/store` body `{"collection":"store","query":"광산구","sort":"Date/desc","listCount":500}`,
  `"북구"` 도 동일 → `data.SearchQueryResult.Collection[0].Documentset.Document[].field` 의 `storeCd, storeNm, storeLat, storeLon`.
  두 결과 합쳐 storeCd 중복 제거 후 GIST 5km 이내만 (확인 시 66개). 매 실행마다 조회해도 요청 2개라 캐시하지 않는다.
- 재고: `POST /api/v1/stock/search/stores` body
  `{searchType:"list", storeCdList:[...], myLat:enc(lat), myLng:enc(lng), order:"stock", smCd, stokMngCd:smCd, stokMngQty:1, stockApplicationRate:"100", ignoreRateYn:"Y"}`
  → `data.storeList[]` 의 `storeCd, storeNm, realStock`.
  66개를 한 번에 보내도 된다 (검증함). **응답에는 그 상품을 취급하는 매장만 온다** (66개 중 4개). 빠진 매장 = 0.
  `storeNm` 필드는 보내지 않는다 (넣었을 때 빈 목록이 오는 경우가 있었다).
- `smCd`: `GET /api/v1/open/product/search/stock?itemCd=<barcode>` → 감싸지 않은 객체 `{itemCd, itemOnm, smCd, ...}`.
  30주년 팩은 `138458`. 매 실행 조회한다 (요청 1개, 바코드만 바꾸면 다른 상품도 됨). 모르는 바코드면 `smCd` 없음 → 빈 결과.
- `enc`: 좌표 문자열을 RSA-OAEP-SHA256 으로 암호화 후 base64. 공개키는 홈페이지 런타임 설정(`rsaPublicKey`)에 공개된 값으로,
  `seven.js` 에 상수로 둔다 (값은 구현 플랜에 적는다). 평문을 보내면 "RSA 복호화 실패".
- WAF(Imperva) 뒤에 있다. 데이터센터 IP·일부 TLS 지문 차단 사례 있음 → 1단계 첫 작업에서 Actions IP 로 검증.

### 이마트24
- 매장: `GET https://emart24.co.kr/api1/store?page=N&top=<동쪽 lng>&bottom=<서쪽 lng>&left=<남쪽 lat>&right=<북쪽 lat>`
  (**파라미터 이름이 뒤바뀌어 있다**. top/bottom = 경도, left/right = 위도). 페이지당 최대 40. 빈 페이지까지 넘긴다.
  GIST 중심 5km 사각형으로 받고 하버사인으로 원 안만 남긴다. 필드 `CODE, TITLE, LATITUDE, LONGITUDE`.
- 재고: `GET https://everse.emart24.co.kr/api/stock/v2/stock-search/store?searchPluCode=<barcode>&bizNoArr=a,b,...`
  헤더 `x-requested-with: XMLHttpRequest`. **10개씩** 나눠 호출. **`bizNoArr` 를 비우면 전국 조회가 되므로 절대 비우지 않는다.**
  → `storeGoodsQty[] {BIZNO, BIZQTY}` + `storeInfo[] {BIZNO, BIZNM, LAT, LON}`. `storeGoodsQty` 에 없는 매장 = 미취급(0 취급).
- 확인 당시 첨단메디케어점(20913) 9개.

### GS25
- `POST https://b2c-apigw.woodongs.com/search/v3/totalSearch` body `{"query":"포켓몬카드"}`
  → `SearchQueryResult.Collection[CollectionId=="offlineItem"].Documentset.Document[].field.itemCode`
- `itemCode === "8800286275732"` 이 있으면 등록된 것. 2026-10-10 기준 아직 없음.
- CloudFront WAF. 일부 데이터센터 IP 차단 사례 있음.

## 알림 규칙 (`diff.js`)

state 모양:
```json
{
  "initialized": true,
  "kakaoSeen": [114844370, ...],
  "stock": { "seven:68846": 0, "emart24:20913": 9 },
  "gs25Listed": false,
  "failures": { "kakao": 0, "seven": 0, "emart24": 0, "gs25": 0 }
}
```

- **카카오**: `kakaoSeen` 에 없는 id 가 새 글. 판정 후 최신 100개만 유지.
- **재고**: 매장별 이전 수량이 0 이거나 없음, 지금 1 이상 → 알림. 수량 감소·유지는 알림 없음. 이번 조회에 없는 매장 키는 0 으로 둔다.
- **GS25**: `gs25Listed` false → true 일 때 1회.
- **소스 실패**: 실패한 소스는 state 의 해당 부분을 건드리지 않는다 (복구 후 오탐 방지).
  `failures[src]` 가 3 이 되는 순간 "⚠️ <소스> 조회 실패: <에러 한 줄>" 1회, 실패 중이던 소스가 성공하면 "✅ <소스> 복구" 1회.
- **첫 실행** (`initialized` 없음): 새 글·재고 변화 알림 대신 "현재 재고 요약 + 카카오 최신 글 1개" 1건 보내고 state 만 채운다.
- 한 실행의 모든 알림은 **텔레그램 메시지 1건**으로 묶는다. 보낼 게 없으면 안 보낸다.

메시지 예:
```
🟢 이마트24 첨단메디케어점 9개 (1.7km)
🟢 세븐일레븐 광주교통방송점 3개 (0.8km)
📢 화성스토어TCG: 30th CELEBRATION 재입고 안내
https://pf.kakao.com/_kxhLKxj/114844370
```

## 워크플로 (`.github/workflows/check.yml`)

- `on: schedule: '*/5 * * * *'` + `workflow_dispatch`. 트리거는 이것뿐 (pull_request 없음).
- `concurrency: { group: check, cancel-in-progress: false }` — 실행이 겹쳐 state 가 꼬이지 않게.
- `actions/cache/restore` (key `state-${{ github.run_id }}`, restore-keys `state-`) → `node src/check.js` → `actions/cache/save`.
- `check.js` 는 소스가 실패해도 exit 0 (state 저장이 막히지 않게). 텔레그램 발송 실패만 exit 1 →
  이후 cache save 스텝이 건너뛰어지므로 state 가 안 바뀌고, 다음 실행에서 같은 알림을 다시 시도한다.
- 알려진 한계: GitHub 무료 cron 은 수 분~십수 분 늦게 돌 수 있다. repo 에 60일 커밋이 없으면 예약 워크플로가 꺼진다.

## 첫 작업: Actions IP 검증

본 구현 전에 `workflow_dispatch` 전용 임시 워크플로로 4개 API 를 1회씩 호출해 HTTP 상태와 응답 앞부분을 로그에 찍는다.
- 전부 200 → 그대로 진행
- 일부 403 → 그 소스는 일단 구현하고, 실패 감시 알림이 뜨는 상태로 둔 뒤 사용자와 대안 상의 (맥 self-hosted runner 등)

## 테스트

`node --test`. 외부 네트워크 안 씀.
- `diff.test.js`: 새 글 판정(순서 뒤바뀐 id 포함), 재고 0→N / N→M / N→0, 실패 소스 state 보존, 3회 실패 알림 1회, 복구 알림, 첫 실행 요약
- `sources.test.js`: 각 파서가 fixture 를 공통 모양으로 바꾸는지, 형태가 깨진 응답에 throw 하는지
- `geo.test.js` 는 만들지 않는다. 이마트24 파서 테스트(5km 밖 매장 제외)가 덮는다.

수동 확인: 로컬에서 `TELEGRAM_TOKEN=… TELEGRAM_CHAT_ID=… node src/check.js` 1회 → 폰에 첫 실행 요약 도착.

## 사용자가 해야 할 일

1. 텔레그램 @BotFather 에서 봇 생성 → 토큰
2. 봇에게 아무 메시지 보낸 뒤 `getUpdates` 로 chat_id 확인 (구현 시 안내 스크립트 제공)
3. GitHub Secrets 등록은 `gh secret set` 으로 대신 해준다
