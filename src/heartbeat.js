// src/heartbeat.js — 하루 한 번 "잘 돌고 있다" 점검 메시지. 맥 작업만 HEARTBEAT_HOUR 로 켠다.
// 맥이 꺼져 있으면 안 온다 → 메시지가 안 오는 것 자체가 이상 신호.
// Actions 쪽 소스별 실패는 Actions 가 3회 연속 실패 시 따로 알리므로 여기선 실행 수·실패 수·마지막 실행만 본다.
import { readFile } from 'node:fs/promises';
import { fetchJson } from './common.js';
import { SESSION, expiresAt } from './sources/gs25.js';

const REPO = 'hidudu0/pokemon-alert';
const DAY = 86_400_000;

export const today = (now) => now.toLocaleDateString('sv'); // 맥 로컬(KST) YYYY-MM-DD
export const due = (lastDay, now, hour) => now.getHours() >= hour && lastDay !== today(now);

// 모은 사실 → 문구 (순수 함수). 이상이 하나라도 있으면 ⚠️ 로 시작
export function report({ now, state, session, actions }) {
  const warn = [];
  const lines = [];
  for (const [src, label] of [['seven', '세븐일레븐'], ['gs25stock', 'GS25']]) {
    const keys = Object.keys(state.stock ?? {}).filter((k) => k.startsWith(`${src}:`));
    const fails = state.failures?.[src] ?? 0;
    lines.push(`${label} ${keys.length}곳 감시, 재고 있는 곳 ${keys.filter((k) => state.stock[k] > 0).length}`);
    if (fails) warn.push(`${label} 최근 ${fails}번 연속 실패`);
    if (!keys.length) warn.push(`${label} 감시 매장 0곳`);
  }
  if (session) {
    const left = Math.floor((session - now) / DAY);
    lines.push(`GS25 로그인 ${left}일 남음`);
    if (left < 7) warn.push(`GS25 로그인 ${left}일 뒤 만료 — node scripts/gs25-login.mjs`);
  } else warn.push('GS25 로그인 세션 없음 — node scripts/gs25-login.mjs');
  if (actions) {
    const ago = Math.round((now - actions.last) / 60_000);
    lines.push(`Actions 24시간 ${actions.total}번 실행, 실패 ${actions.failed}번, 마지막 ${ago}분 전`);
    if (ago > 30) warn.push(`Actions 마지막 실행 ${ago}분 전 — cron-job.org 확인`);
    if (actions.failed) warn.push(`Actions 실패 ${actions.failed}번`);
  } else warn.push('Actions 상태 조회 실패');
  return [warn.length ? '⚠️ 시스템 점검: 확인 필요' : '✅ 시스템 점검: 정상', ...warn.map((w) => `- ${w}`), ...lines].join('\n');
}

async function actionsStats(now) {
  const since = new Date(now - DAY).toISOString();
  const runs = (q) => fetchJson(`https://api.github.com/repos/${REPO}/actions/runs?per_page=1&created=%3E%3D${since}${q}`);
  const [all, failed] = await Promise.all([runs(''), runs('&status=failure')]);
  return { total: all.total_count, failed: failed.total_count, last: new Date(all.workflow_runs[0].created_at) };
}

export async function heartbeat(state, now = new Date()) {
  const session = await readFile(SESSION, 'utf8').then((t) => expiresAt(JSON.parse(t).refreshToken)).catch(() => null);
  const actions = await actionsStats(now).catch(() => null);
  return report({ now, state, session, actions });
}
