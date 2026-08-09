/**
 * index.html の「出発まで あと N 日」。
 *
 * menu.js のトップレベルに直書きしていたが、日付の引き算と N > 0 の分岐は
 * ブラウザを開かないと一度も実行されない計算だった。
 * DOM に触らない形でここへ出し、境界（当日・前日・過ぎたあと）を
 * node --test から確かめられるようにしている。
 */

import { escapeHtml } from "./dom.js";

const DAY_MS = 86_400_000;

/**
 * target までの残り日数。
 *
 * 端数は切り上げる。出発が 3 時間後でも「あと 1 日」と出したいため
 * （「あと 0 日」は残り時間があるのに終わったように読める）。
 * target が Date なのは、出発時刻が "+09:00" 付きの絶対時刻だから。
 * 実行環境のタイムゾーンに依存させないため、日付の切り出しはしない。
 *
 * @param {Date} target 出発の絶対時刻
 * @param {number|Date} now 現在時刻（テストから固定するために引数で受ける）
 * @returns {number} 残り日数。到達済み・経過後は 0 以下になる
 */
export function daysUntil(target, now = Date.now()) {
  const remaining = target.getTime() - (now instanceof Date ? now.getTime() : now);
  if (!Number.isFinite(remaining)) {
    throw new TypeError(`daysUntil: 時刻を数値にできません: ${target} / ${now}`);
  }
  return Math.ceil(remaining / DAY_MS);
}

/**
 * カウントダウン欄の HTML。出発を過ぎたら残り日数の行ごと消して副題だけ残す
 * （「あと -3 日」を出さないため）。
 */
export function countdownHtml(target, subtitle, now = Date.now()) {
  const left = daysUntil(target, now);
  const safeSubtitle = escapeHtml(subtitle);
  return left > 0 ? `出発まで あと ${left} 日<br>${safeSubtitle}` : safeSubtitle;
}
