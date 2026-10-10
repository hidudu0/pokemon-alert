#!/bin/bash
# 한 번만 실행하면 끝나는 설정. 다시 실행해도 된다 (코드 업데이트·재등록).
#   1. ~/.pokemon-alert 에 repo clone (바탕화면은 macOS 가 백그라운드 프로세스 접근을 막는다)
#   2. 텔레그램 토큰 입력 → chat id 자동 확인 → ~/.pokemon-alert/.env (권한 600)
#   3. GitHub Secrets 등록 (Actions 용)
#   4. 맥 launchd: 5분마다(입고 잦은 시간엔 매분) 세븐일레븐만 확인 (Actions IP 는 세븐이 403)
#   5. Actions 워크플로 켜고 1회 실행
# 미리 할 것: @BotFather 로 봇 만들기 → 그 봇에게 아무 메시지나 보내기.
# 맥 쪽 제거: launchctl bootout gui/$(id -u)/com.pokemon-alert.seven && rm ~/Library/LaunchAgents/com.pokemon-alert.seven.plist
set -euo pipefail

REPO=hidudu0/pokemon-alert
DIR="$HOME/.pokemon-alert"
LABEL=com.pokemon-alert.seven
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"
RUSH_HOURS="7 8 23 0" # 입고가 잦은 시간. 이 시간 동안은 매분 확인

# 평소엔 5분마다, RUSH_HOURS 엔 매분. Minute 없이 Hour 만 주면 launchd 는 그 시간 내내 매분 실행한다
SCHEDULE=""
for m in $(seq 0 5 55); do SCHEDULE+="<dict><key>Minute</key><integer>$m</integer></dict>"; done
for h in $RUSH_HOURS; do SCHEDULE+="<dict><key>Hour</key><integer>$h</integer></dict>"; done

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q "https://github.com/$REPO" "$DIR"; fi

if [ ! -f "$DIR/.env" ]; then
  read -rsp '텔레그램 봇 토큰 (화면에 안 보임): ' T; echo
  T="${T//[[:space:]]/}" # 복사할 때 딸려 온 공백·줄바꿈 제거
  BOT=$(curl -sS "https://api.telegram.org/bot$T/getMe" | grep -oE '"username":"[^"]+"' | cut -d'"' -f4) || true
  if [ -z "$BOT" ]; then
    echo '토큰이 틀렸다. BotFather 가 준 토큰 전체(숫자:문자 형태)를 다시 복사해서 실행.' >&2
    exit 1
  fi
  C=$(curl -sS "https://api.telegram.org/bot$T/getUpdates" | grep -oE '"chat":\{"id":-?[0-9]+' | head -1 | grep -oE -- '-?[0-9]+$') || true
  if [ -z "$C" ]; then
    echo "토큰은 맞다 (봇 @$BOT). 그런데 이 봇에 온 메시지가 없다." >&2
    echo "https://t.me/$BOT 을 열어 '시작' 누르고 아무 메시지나 보낸 뒤 다시 실행. (BotFather 대화방이 아니라 이 봇 대화방)" >&2
    exit 1
  fi
  (umask 077; printf 'TELEGRAM_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$T" "$C" > "$DIR/.env")
  unset T
fi
set -a; . "$DIR/.env"; set +a

printf %s "$TELEGRAM_TOKEN" | gh secret set TELEGRAM_TOKEN -R "$REPO"
printf %s "$TELEGRAM_CHAT_ID" | gh secret set TELEGRAM_CHAT_ID -R "$REPO"

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>cd "$DIR" &amp;&amp; git pull -q --ff-only; exec "$NODE" --env-file-if-exists=.env src/check.js &gt; seven.log 2&gt;&amp;1</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>SOURCES</key><string>seven</string></dict>
  <key>StartCalendarInterval</key><array>$SCHEDULE</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

gh workflow enable check.yml -R "$REPO"
gh workflow run check.yml -R "$REPO"

echo "끝. 폰에 '📋 포켓몬카드 30주년 알림 시작' 이 두 번 온다 (Actions 1번, 맥 세븐 1번)."
echo "맥 세븐 마지막 실행 로그: $DIR/seven.log"
