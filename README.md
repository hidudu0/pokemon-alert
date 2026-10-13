# 포켓몬카드 30주년 알림

GIST 5km 안 편의점(세븐일레븐·이마트24·GS25)에 30주년 팩 재고가 생기거나,
11번가·카카오 선물하기에서 판매가 시작되거나,
광주 화성스토어TCG 카카오 채널에 새 글이 올라오면 텔레그램으로 알려준다. 나 혼자 쓰는 용도.

GitHub Actions 가 5분마다 `src/check.js` 를 돌린다 (카카오·이마트24·GS25·11번가·카카오 선물하기). 이전 상태는 Actions cache 의 `state.json`.
세븐일레븐은 Actions IP 에서 403 으로 막혀서, 맥 launchd 가 `~/.pokemon-alert` 에서 5분마다 세븐을 따로 확인한다.
GS25 매장 재고도 로그인 세션이 맥에만 있어서 같은 맥 작업이 5분마다 확인한다.
입고가 잦은 07~08시·23~00시엔 둘 다 매분 확인한다 (맥은 `setup.sh` 의 `RUSH_HOURS`, Actions 는 cron-job.org 두 번째 작업).

| 소스 | 알림 조건 |
|---|---|
| 카카오 채널 `_kxhLKxj` | 새 글 전부 |
| 세븐일레븐 · 이마트24 · GS25 | 매장별 재고 0 → 1개 이상은 🔴, 줄어들면 🔽 (세븐·GS25 는 맥이 깨어 있을 때만) |
| GS25 | 상품 검색에 30주년 팩이 처음 등록될 때 |
| 11번가 · 카카오 선물하기 | 품절 → 판매중일 때 🛒 + 링크. G마켓·SSG·네이버 스마트스토어는 봇 차단(403/429)이라 미지원 |
| 공통 | 한 소스가 3번 연속 실패하면 경고, 복구되면 알림 |
| 점검 | 매일 11시 이후 맥의 첫 실행에서 '✅ 시스템 점검' (세븐·GS25 감시 수, GS25 로그인 남은 날, Actions 24시간 실행·실패). 이상 있으면 ⚠️. 안 오면 맥이 꺼진 것 |

## 설정

1. 텔레그램 @BotFather → `/newbot` → 토큰 받기
2. 만든 봇에게 아무 메시지나 보내기
3. `bash scripts/setup.sh` — 토큰을 (화면에 안 보이게) 입력하면 chat id 확인, GitHub Secrets 등록,
   맥 launchd(세븐) 설치, Actions 켜고 1회 실행까지 한다. 폰에 "📋 알림 시작" 이 두 번 온다 (Actions·맥).

5분 간격 보장 (외부 크론): GitHub 무료 cron 은 실제로 몇 시간씩 밀린다. 그래서 cron-job.org 가 5분마다
GitHub API 로 `workflow_dispatch` 를 호출해 깨운다. 예약 실행(schedule)은 백업으로 남겨둔다 (같은 state 라 중복 알림 없음).
- GitHub fine-grained 토큰: 이 repo 만, 권한 `Actions: Read and write` 만
- cron-job.org 작업: `POST https://api.github.com/repos/hidudu0/pokemon-alert/actions/workflows/check.yml/dispatches`,
  헤더 `Authorization: Bearer <토큰>`, `Accept: application/vnd.github+json`, 본문 `{"ref":"master"}`, 5분마다. 정상 응답은 204
- cron-job.org 두 번째 작업 (입고 시간 집중): 위 작업을 복제(Clone)하고 일정만 Custom → 분 `Every minute`, 시 `0, 7, 8, 23` 만 선택.
  두 작업이 겹쳐도 워크플로 `concurrency` 로 차례로 돌아 중복 알림 없음
- 토큰이 새도 이 repo 의 워크플로를 실행·취소하는 것까지만 가능. 만료되면 새로 만들어 cron-job.org 헤더만 바꾼다

맥 작업 (세븐·GS25 재고):
- 마지막 실행 로그 `~/.pokemon-alert/seven.log`, 상태 `~/.pokemon-alert/state.json`
- 실행할 때마다 `git pull` 로 최신 코드를 받는다
- GS25 재고는 우리동네GS 로그인 세션 `~/.pokemon-alert/gs25-auth.json` (권한 600) 이 필요하다.
  `node scripts/gs25-login.mjs` → 뜬 Chrome 에서 네이버 로그인만 하면 저장된다. 세션은 자동 갱신되고 약 90일 간다.
  '⚠️ GS25 재고 조회 실패 … 다시 로그인' 알림이 오면 같은 명령을 다시 실행
- GS25 재고 API 는 1km 반경만 받아서 1회에 55번 호출한다. 그래서 입고 잦은 시간에도 5분마다만
- 제거: `launchctl bootout gui/$(id -u)/com.pokemon-alert.seven && rm ~/Library/LaunchAgents/com.pokemon-alert.seven.plist`

## 명령

- `npm test` — 테스트 (네트워크 안 씀)
- `npm run check` — 로컬 1회 실행 (`.env` 에 TELEGRAM_TOKEN, TELEGRAM_CHAT_ID). 로컬 state.json 은 Actions 와 별개.
  `SOURCES=seven npm run check` 처럼 소스를 고를 수 있다 (kakao, seven, emart24, gs25, gs25stock, 11st, kakaogift)
- 상품 바꾸기: 편의점은 `src/common.js` 의 `BARCODE`, 온라인은 `src/sources/online.js` 의 URL

## 주의

- 전부 비공개 웹 API 라 예고 없이 바뀔 수 있다. 바뀌면 파서가 throw → 3회 후 텔레그램 경고.
- 60일간 커밋이 없으면 GitHub 가 예약 실행(백업)을 끈다. 외부 크론 쪽은 영향 없음.
- 설계: `docs/superpowers/specs/2026-10-10-pokemon-alert-design.md`
