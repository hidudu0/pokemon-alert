// src/diff.js — 이전 state 와 이번 조회 결과를 비교해 알림 문구와 새 state 를 만든다 (순수 함수)
import { URLS } from './sources/online.js';

const LABEL = { kakao: '카카오 화성스토어TCG', seven: '세븐일레븐', emart24: '이마트24', gs25: 'GS25', gs25stock: 'GS25 재고', '11st': '11번가', kakaogift: '카카오 선물하기' };
const KEEP_SEEN = 100;
const FAIL_ALERT_AT = 3;

// prev: 이전 state ({} 이면 첫 실행). results: { 소스: {ok:true, value} | {ok:false, error} }
// 실패한 소스의 state 는 그대로 둔다 (복구 직후 오탐 방지).
export function diff(prev, results) {
  const first = !prev.initialized;
  const state = {
    initialized: true,
    kakaoSeen: prev.kakaoSeen ?? [],
    stock: { ...prev.stock },
    names: { ...prev.names }, // 응답에서 빠진 매장도 감소 알림에 이름을 쓰려고
    gs25Listed: prev.gs25Listed ?? false,
    onSale: { ...prev.onSale },
    failures: { ...prev.failures },
  };
  const stock = [];
  const online = [];
  const less = [];
  const gs25 = [];
  const kakao = [];
  const health = [];

  for (const src of ['seven', 'emart24', 'gs25stock']) {
    if (!results[src]?.ok) continue;
    for (const key of Object.keys(state.stock)) if (key.startsWith(`${src}:`)) state.stock[key] = 0; // 응답에 없는 매장 = 0
    for (const r of results[src].value) {
      if (r.qty > 0 && !(prev.stock?.[r.key] > 0)) stock.push(`🔴 ${r.chain} ${r.name} ${r.qty}개 (${r.km.toFixed(1)}km)`);
      state.stock[r.key] = r.qty;
      state.names[r.key] = `${r.chain} ${r.name}`;
    }
  }
  // 실패한 소스는 위에서 안 건드려 prev 와 같으니 여기서 안 걸린다
  for (const [key, qty] of Object.entries(state.stock)) {
    const was = prev.stock?.[key] ?? 0;
    if (qty < was) less.push(`🔽 ${state.names[key] ?? key} ${was}→${qty}개`);
  }

  for (const src of Object.keys(URLS)) {
    if (!results[src]?.ok) continue;
    if (results[src].value && !state.onSale[src]) online.push(`🛒 ${LABEL[src]} 판매 시작`, URLS[src]);
    state.onSale[src] = results[src].value;
  }

  if (results.gs25?.ok) {
    if (results.gs25.value && !state.gs25Listed) gs25.push('🆕 GS25 상품 검색에 30주년 팩 등록됨 (매장 재고는 우리동네GS 앱에서)');
    state.gs25Listed = results.gs25.value;
  }

  if (results.kakao?.ok) {
    const posts = results.kakao.value;
    const seen = new Set(state.kakaoSeen);
    // 아직 본 글이 하나도 없으면 최신 1개만 보여주고 나머지는 본 것으로 (글 폭탄 방지)
    const fresh = seen.size ? posts.filter((p) => !seen.has(p.id)) : posts.slice(0, 1);
    for (const p of fresh) kakao.push(`📢 ${p.title}`, p.url);
    state.kakaoSeen = [...new Set([...posts.map((p) => p.id), ...state.kakaoSeen])].slice(0, KEEP_SEEN);
  }

  for (const [src, r] of Object.entries(results)) {
    const n = state.failures[src] ?? 0;
    if (r.ok) {
      if (n >= FAIL_ALERT_AT) health.push(`✅ ${LABEL[src]} 복구`);
      state.failures[src] = 0;
    } else {
      state.failures[src] = n + 1;
      if (n + 1 === FAIL_ALERT_AT) health.push(`⚠️ ${LABEL[src]} 조회 실패: ${r.error}`);
    }
  }

  const lines = [...stock, ...online, ...less, ...gs25, ...kakao, ...health];
  if (first) {
    const down = Object.entries(results).filter(([, r]) => !r.ok).map(([src]) => LABEL[src]);
    lines.unshift(
      '📋 포켓몬카드 30주년 알림 시작',
      ...(stock.length ? [] : ['재고 있는 매장 없음']),
      ...(down.length ? [`조회 실패: ${down.join(', ')}`] : []),
    );
  }
  return { state, text: lines.join('\n') };
}
