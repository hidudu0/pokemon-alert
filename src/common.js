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

// 수량이 없거나 숫자가 아니면 0 으로 삼키지 않고 throw — 필드 이름이 바뀌면 바로 드러나게
export function stockRow(src, chain, store, qty) {
  const n = Number(qty);
  if (qty == null || qty === '' || !Number.isFinite(n)) throw new Error(`${chain} 재고 수량 형태 다름: ${JSON.stringify(qty)}`);
  return { key: `${src}:${store.id}`, chain, name: store.name, qty: n, km: km(HOME.lat, HOME.lng, store.lat, store.lng) };
}

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
