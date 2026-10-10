// src/sources/kakao.js — 포켓몬카드샵 광주 화성스토어TCG 카카오 채널
import { fetchJson } from '../common.js';

const POSTS = 'https://pf.kakao.com/rocket-web/web/profiles/_kxhLKxj/posts';

const firstLine = (p) => (p.contents ?? []).find((c) => c.t === 'text')?.v.trim().split('\n')[0];

export function parsePosts(json) {
  if (!Array.isArray(json?.items)) throw new Error('카카오 응답에 items 없음');
  // id 가 없으면 매번 새 글로 보이거나 링크가 깨진다
  if (json.items.some((p) => p.id == null)) throw new Error('카카오 응답 형태 다름: id 없음');
  return json.items.map((p) => ({
    id: p.id,
    title: p.title?.trim() || firstLine(p) || '(제목 없음)',
    url: `https://pf.kakao.com/_kxhLKxj/${p.id}`,
  }));
}

export const fetchPosts = async () => parsePosts(await fetchJson(POSTS));
