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
  // ID 필드 이름이 바뀌면 전부 걸러져 조용히 0건이 된다
  if (list.some((r) => r.storeCd == null)) throw new Error('세븐 재고 응답 형태 다름: storeCd 없음');
  const byId = new Map(stores.map((s) => [s.id, s]));
  return list
    .filter((r) => byId.has(String(r.storeCd)))
    .map((r) => stockRow('seven', '세븐일레븐', byId.get(String(r.storeCd)), r.realStock));
}

export async function fetchStock(barcode) {
  const meta = await fetchJson(`${BASE}/api/v1/open/product/search/stock?itemCd=${barcode}`);
  if (meta === null) return []; // 모르는 바코드 = 빈 본문 = 세븐에서 안 파는 상품
  if (!meta.smCd) throw new Error('세븐 상품 조회 응답 형태 다름');
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
