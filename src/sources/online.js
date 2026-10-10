// src/sources/online.js — 온라인 판매처 판매중 여부. G마켓·SSG·네이버 스마트스토어는 봇 차단(403/429)이라 뺐다
import { fetchJson, fetchText } from '../common.js';

export const URLS = {
  '11st': 'https://www.11st.co.kr/products/9622837520',
  kakaogift: 'https://gift.kakao.com/product/14321625',
};

// 상품 페이지 HTML 안의 selStatCd: 103 판매중, 104 일시품절
export function parse11st(html) {
  const code = html.match(/"selStatCd":"(\d+)"/)?.[1];
  if (!code) throw new Error('11번가 응답 형태 다름: selStatCd 없음');
  return code === '103';
}

export function parseKakaoGift(json) {
  if (typeof json?.soldOut !== 'boolean') throw new Error('카카오 선물하기 응답 형태 다름: soldOut 없음');
  return !json.soldOut;
}

// 모바일 UA 면 m.11st.co.kr 로 넘어가 selStatCd 가 없다
export const onSale11st = async () => parse11st(await fetchText(URLS['11st'], { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }));

export const onSaleKakaoGift = async () => parseKakaoGift(await fetchJson('https://gift.kakao.com/a/product-detail/v3/products/14321625'));
