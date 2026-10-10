// Actions 러너 IP 에서 각 API 가 WAF 에 막히는지 1회씩 확인한다. 확인이 끝나면 지운다.
import { HEADERS } from '../src/common.js';

const json = { 'Content-Type': 'application/json' };
const checks = {
  kakao: ['https://pf.kakao.com/rocket-web/web/profiles/_kxhLKxj/posts'],
  seven_product: ['https://new.7-elevenapp.co.kr/api/v1/open/product/search/stock?itemCd=8800286275732'],
  seven_store: ['https://new.7-elevenapp.co.kr/api/v1/open/search/store',
    { method: 'POST', headers: json, body: JSON.stringify({ collection: 'store', query: '첨단', sort: 'Date/desc', listCount: 5 }) }],
  emart24_store: ['https://emart24.co.kr/api1/store?page=1&top=126.86&bottom=126.82&left=35.21&right=35.24'],
  emart24_stock: ['https://everse.emart24.co.kr/api/stock/v2/stock-search/store?searchPluCode=8800286275732&bizNoArr=20913',
    { headers: { 'x-requested-with': 'XMLHttpRequest' } }],
  gs25_search: ['https://b2c-apigw.woodongs.com/search/v3/totalSearch',
    { method: 'POST', headers: json, body: JSON.stringify({ query: '포켓몬카드' }) }],
};

for (const [name, [url, opts = {}]] of Object.entries(checks)) {
  try {
    const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers }, signal: AbortSignal.timeout(20_000) });
    console.log(name, res.status, (await res.text()).slice(0, 100).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(name, 'ERROR', e.message);
  }
}
