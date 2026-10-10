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
