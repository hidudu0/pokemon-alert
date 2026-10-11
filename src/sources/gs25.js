// src/sources/gs25.js — 우리동네GS 상품 검색 + 매장 재고 (재고는 네이버 로그인으로 받은 GS 세션 필요)
// 세션 흐름 출처: daiso-mcp docs/gs25-auth-recovery-runbook.md (2026-10-05 검증)
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchJson, nearHome, stockRow, HOME, RADIUS_KM } from '../common.js';

export const BFF = 'https://b2c-bff.woodongs.com';
// 맥 launchd 가 도는 clone 옆. 토큰이 들어 있어 권한 600, git 에 안 올린다
export const SESSION = process.env.GS25_SESSION ?? join(homedir(), '.pokemon-alert', 'gs25-auth.json');
const RELOGIN = 'node scripts/gs25-login.mjs 로 다시 로그인';

// 우리동네GS 안드로이드 앱 헤더 (5.3.61/2132)
export const appHeaders = (deviceId) => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'woodongs-app/5.3.61 (Android; 14; sdk_gphone64_arm64)',
  request_id: randomUUID(),
  appinfo_device_id: deviceId,
  appinfo_model_name: 'sdk_gphone64_arm64',
  appinfo_os_version: '14',
  appinfo_app_version: '5.3.61',
  appinfo_app_build_number: '2132',
  appinfo_os_type: 'android',
});

export const expiresAt = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;

// 임시 파일에 쓰고 rename — 쓰다 죽어도 회전된 refresh 토큰을 잃지 않게
export async function saveSession({ accessToken, refreshToken, deviceId }) {
  const tmp = `${SESSION}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ accessToken, refreshToken, deviceId }), { mode: 0o600, flag: 'wx' });
  await rename(tmp, SESSION);
}

// access 가 1분 안에 만료되거나 force 면 refresh 로 새로 받는다. refresh 도 갱신마다 바뀐다
export async function session(force = false, now = Date.now()) {
  let s;
  try {
    s = JSON.parse(await readFile(SESSION, 'utf8'));
  } catch {
    throw new Error(`GS25 세션 없음 — ${RELOGIN}`);
  }
  if (!force && expiresAt(s.accessToken) > now + 60_000) return s;
  if (expiresAt(s.refreshToken) <= now) throw new Error(`GS25 로그인 만료 — ${RELOGIN}`);
  const res = await fetch(`${BFF}/api/bff/v4/auth/tokenReissue`, {
    method: 'POST',
    headers: { ...appHeaders(s.deviceId), Refresh: s.refreshToken },
    signal: AbortSignal.timeout(10_000),
  });
  // 응답에 회원 정보가 있어 본문은 에러에 넣지 않는다
  const j = res.ok ? await res.json() : null;
  if (j?.resultCode !== '0000' || !j.data?.access || !j.data?.refresh) throw new Error(`GS25 토큰 갱신 실패 HTTP ${res.status} — ${RELOGIN}`);
  const next = { accessToken: j.data.access.replace(/^Bearer /, ''), refreshToken: j.data.refresh.replace(/^Bearer /, ''), deviceId: s.deviceId };
  await saveSession(next);
  return next;
}

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

// 재고 API 는 GS WAF 가 radiusCondition=1000 만 통과시킨다 (3000·5000·페이징 파라미터는 403, 반경 없으면 500).
// 그래서 5km 원을 0.95km 원으로 덮는 육각 격자 중심마다 조회한다 (55곳)
// ponytail: 매번 55번 호출. 줄이려면 격자로 찾은 매장 목록을 캐시해 세븐처럼 groups() 로 묶기 (~25번)
const CELL_KM = 0.95;
export function grid() {
  const d = CELL_KM * Math.sqrt(3); // 이웃 중심 간격. 육각 격자는 이 간격이면 반경 CELL_KM 원으로 평면을 덮는다
  const kmLat = 1 / 111.32;
  const kmLng = 1 / (111.32 * Math.cos((HOME.lat * Math.PI) / 180));
  const out = [];
  const n = Math.ceil((RADIUS_KM + CELL_KM) / d) + 1;
  for (let row = -n; row <= n; row++) {
    for (let col = -n; col <= n; col++) {
      const y = (row * d * Math.sqrt(3)) / 2;
      const x = col * d + (row % 2 ? d / 2 : 0);
      if (Math.hypot(x, y) <= RADIUS_KM + CELL_KM) out.push({ lat: HOME.lat + y * kmLat, lng: HOME.lng + x * kmLng });
    }
  }
  return out;
}

export function parseStock(json) {
  if (!Array.isArray(json?.stores)) throw new Error('GS25 재고 응답 형태 다름');
  return json.stores
    .filter((s) => nearHome(s.storeYCoordination, s.storeXCoordination))
    .map((s) =>
      stockRow('gs25stock', 'GS25', { id: s.storeCode, name: s.storeName, lat: Number(s.storeYCoordination), lng: Number(s.storeXCoordination) }, s.realStockQuantity),
    );
}

async function stockAt(barcode, { lat, lng }, s) {
  // 파라미터 순서·이름은 앱 그대로. 하나라도 더하면 WAF 403
  const qs = `serviceCode=01&itemCode=${barcode}&myPositionXCoordination=${lng}&myPositionYCoordination=${lat}&centerPositionXCoordination=${lng}&centerPositionYCoordination=${lat}&radiusCondition=1000&pickupStoreYn=N&isSuperDlvyStoreSelected=N&isGs25DlvyStoreSelected=N&realTimeStockYn=Y`;
  return fetch(`${BFF}/api/bff/v2/store/stock?${qs}`, {
    headers: { ...appHeaders(s.deviceId), Authorization: `Bearer ${s.accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
}

export async function fetchStock(barcode) {
  let s = await session();
  const rows = new Map(); // 격자 원이 겹쳐 같은 매장이 여러 번 온다
  for (const p of grid()) {
    let res = await stockAt(barcode, p, s);
    if (res.status === 401) {
      s = await session(true); // 만료 전에 끊긴 토큰이면 한 번 갱신해서 다시 (403 은 WAF 라 갱신해도 소용없다)
      res = await stockAt(barcode, p, s);
    }
    if (!res.ok) throw new Error(`GS25 재고 HTTP ${res.status}`);
    for (const r of parseStock(await res.json())) rows.set(r.key, r);
  }
  return [...rows.values()];
}
