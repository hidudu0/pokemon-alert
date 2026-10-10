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
