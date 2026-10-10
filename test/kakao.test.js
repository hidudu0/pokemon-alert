// test/kakao.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePosts } from '../src/sources/kakao.js';

test('kakao: 글 목록을 {id,title,url} 로. 제목 없으면 본문 첫 줄', () => {
  const posts = parsePosts({
    has_next: true,
    items: [
      { id: 114844370, title: ' 10/09 포켓몬카드 판매 안내 ', permalink: 'http://pf.kakao.com/_kxhLKxj/114844370', contents: [] },
      { id: 114841163, title: '', contents: [{ t: 'image', v: 'x' }, { t: 'text', v: '\n★ 30th CELEBRATION 입고\n둘째 줄' }] },
      { id: 114841170, title: '' },
    ],
  });
  assert.deepEqual(posts, [
    { id: 114844370, title: '10/09 포켓몬카드 판매 안내', url: 'https://pf.kakao.com/_kxhLKxj/114844370' },
    { id: 114841163, title: '★ 30th CELEBRATION 입고', url: 'https://pf.kakao.com/_kxhLKxj/114841163' },
    { id: 114841170, title: '(제목 없음)', url: 'https://pf.kakao.com/_kxhLKxj/114841170' },
  ]);
});

test('kakao: 형태 다른 응답은 throw', () => {
  assert.throws(() => parsePosts({ error: 'blocked' }), /items/);
  assert.throws(() => parsePosts(null), /items/);
});

test('kakao: id 필드 이름이 바뀌면 throw', () => {
  assert.throws(() => parsePosts({ items: [{ post_id: 1, title: 'x' }] }), /id/);
});
