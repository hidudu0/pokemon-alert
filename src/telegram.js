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
