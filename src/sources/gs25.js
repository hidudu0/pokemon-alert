// src/sources/gs25.js — 우리동네GS 상품 검색. 매장 재고는 로그인 토큰이 필요해 2단계로 미룸
import { fetchJson } from '../common.js';

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
