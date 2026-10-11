// scripts/gs25-login.mjs — 우리동네GS 네이버 로그인 → GS 세션을 SESSION 파일(권한 600)에 저장.
// Chrome 을 임시 프로필로 띄워 진행한다. 사람은 뜬 창에서 네이버 로그인만 하면 된다. 토큰은 출력하지 않는다.
// 흐름 출처: daiso-mcp docs/gs25-auth-recovery-runbook.md, gs25-auth-login-guide.md (2026-10-05 검증)
// 약 90일마다 (또는 '⚠️ GS25 재고 조회 실패 … 다시 로그인' 알림이 오면) `node scripts/gs25-login.mjs`
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BFF, SESSION, appHeaders, expiresAt, saveSession } from '../src/sources/gs25.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const HUB = 'https://ex-hubpage.grm.gsretail.com';
const RETURN = `${BFF}/api/bff/v4/grmHub/authReturn`;
// 2026-10-06 GS 공개 번들. 바뀌면 login guide 의 '모듈 경로나 export가 바뀌었을 때' 절차로 찾는다
const LOGIN_MODULE = '/_nuxt/login.BDscyujx.js';
const LOGIN_EXPORT = 'u';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deviceId = randomUUID();
const t = await (
  await fetch(`${BFF}/api/bff/v4/grmHub/authTicket`, { method: 'POST', headers: { ...appHeaders(deviceId), 'grm-sysCdDtl': '2011' }, body: '{}' })
).json();
if (t.resultCode !== '0000' || !t.ticket) throw new Error(`GS 티켓 발급 실패 (${t.resultCode})`);
const start = `${HUB}/bizmgt/signin/bridge?${new URLSearchParams({ grmSysCdDtl: '2011', page: 'NAVER', return: RETURN, ticket: t.ticket })}`;

const profile = await mkdtemp(join(tmpdir(), 'gs25-login-'));
const chrome = spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', start], { stdio: 'ignore' });

// 현재 탭 (URL 에 승인 코드·토큰이 들어 있으니 출력 금지)
async function tab() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.find((x) => x.type === 'page');
}

// 탭에서 JS 실행. alert 가 떠 있으면 먼저 닫는다 (안 닫으면 evaluate 가 멈춘다)
async function run(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)));
  let id = 0;
  const call = (method, params) =>
    new Promise((ok) => {
      const my = ++id;
      ws.addEventListener('message', function on(e) {
        const m = JSON.parse(e.data);
        if (m.id === my) ws.removeEventListener('message', on), ok(m);
      });
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  try {
    await call('Page.handleJavaScriptDialog', { accept: true });
    const m = await Promise.race([call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), sleep(15_000)]);
    return m?.result?.result?.value;
  } finally {
    ws.close();
  }
}

const PUSH_NAVER = `(async () => {
  const router = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$router;
  if (!router) return 'wait';
  await router.push('/bizmgt/signin/bridge/naver');
  return 'ok';
})()`;

const EXCHANGE = `(async () => {
  const p = new URLSearchParams(location.search);
  const nuxt = document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$nuxt;
  if (typeof nuxt?.runWithContext !== 'function') return 'GS 앱 컨텍스트 없음';
  const mod = await import('${LOGIN_MODULE}').catch(() => null);
  if (typeof mod?.['${LOGIN_EXPORT}'] !== 'function') return 'GS 로그인 모듈이 바뀜 (${LOGIN_MODULE})';
  const api = nuxt.runWithContext(() => mod['${LOGIN_EXPORT}']());
  if (typeof api?.loginNaver !== 'function') return 'loginNaver 없음';
  const r = await nuxt.runWithContext(() => api.loginNaver({ code: p.get('code'), state: p.get('state') }));
  return r === 'ERROR' ? '코드 교환 실패' : 'ok';
})()`;

let step = 'bridge';
let ok = false;
console.log('Chrome 창이 뜬다. "네이버 통신 장애" 팝업이 뜨면 닫고 기다리면 네이버 로그인 화면으로 넘어간다.');
try {
  for (const deadline = Date.now() + 15 * 60_000; Date.now() < deadline; await sleep(1000)) {
    const target = await tab().catch(() => null);
    if (!target) continue;
    const url = new URL(target.url);
    if (url.href.startsWith(RETURN)) {
      const q = url.searchParams;
      const strip = (v) => (v ?? '').replace(/^Bearer /, '');
      const s = { accessToken: strip(q.get('token')), refreshToken: strip(q.get('refresh')), deviceId };
      if (q.get('result') !== 'Y' || q.get('resultCode') !== '0000' || !s.accessToken || !s.refreshToken) throw new Error(`GS 반환 실패 (resultCode ${q.get('resultCode')})`);
      // JSON 파싱 에러 메시지에 토큰 내용이 섞일 수 있어 삼키고 일반 메시지로
      const valid = (() => { try { return expiresAt(s.accessToken) > Date.now() && expiresAt(s.refreshToken) > Date.now(); } catch { return false; } })();
      if (!valid) throw new Error('GS 반환 토큰 형태 다름');
      await saveSession(s);
      console.log(`✅ GS25 로그인 저장 완료 → ${SESSION} (refresh 만료 ${new Date(expiresAt(s.refreshToken)).toLocaleDateString('ko-KR')})`);
      ok = true;
      break;
    }
    if (url.origin !== HUB) continue; // 네이버 화면: 사람이 로그인 중
    if (step === 'bridge' && url.pathname === '/bizmgt/signin/bridge') {
      await sleep(2000); // bridge 가 티켓·우리동네GS 채널을 초기화할 시간
      // push 가 네이버로 페이지를 넘기면 응답 없이 끝날 수 있다 → 'wait' 만 재시도
      if ((await run(target, PUSH_NAVER)) !== 'wait') {
        step = 'naver';
        console.log('네이버 로그인 화면에 "우리동네GS 로그인 중" 이 보이면 로그인. (GS SHOP 이 보이면 Ctrl+C 후 다시 실행)');
      }
    } else if (step !== 'exchange' && url.pathname === '/bizmgt/signin/bridge/naver' && url.searchParams.get('code')) {
      step = 'exchange'; // 승인 코드는 한 번만 쓸 수 있다
      const r = await run(target, EXCHANGE);
      if (r !== 'ok') throw new Error(`GS 코드 교환: ${r ?? '응답 없음'}`);
      console.log('네이버 로그인 확인. GS 토큰 받는 중… (가입/동의 화면이 나오면 진행)');
    }
  }
  if (!ok) throw new Error('15분 안에 끝나지 않음. 다시 실행');
} finally {
  chrome.kill();
  await sleep(500);
  await rm(profile, { recursive: true, force: true });
}
