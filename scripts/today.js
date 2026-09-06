#!/usr/bin/env node
/**
 * today.js — 按北京时间输出当期需要的各种日期格式。
 *
 * 用法:
 *   node scripts/today.js              # 今天（北京时间）
 *   node scripts/today.js 2026-09-06   # 补做某一天
 *
 * 为什么要有这个脚本:
 *   1) 本机时区不是 UTC+8（实测是欧洲中部时间），直接用 date 会差好几个小时，跨日就会错刊号
 *   2) 这台机器的 Git Bash 没有时区库，`TZ=Asia/Shanghai date` 会静默退回 UTC，不能用
 *   Node 自带完整 ICU，是这台机器上唯一可靠的时区来源。
 */

const TZ = 'Asia/Shanghai';

const arg = process.argv[2];
let d;
if (arg) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    console.error('日期格式应为 YYYY-MM-DD');
    process.exit(1);
  }
  // 当成北京时间的当天中午，避开时区边界
  d = new Date(arg + 'T04:00:00Z');
} else {
  d = new Date();
}

const fmt = (opts, locale = 'en-US') =>
  new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(d);

const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d).slice(0, 10);
const [y, m, day] = iso.split('-');

const out = {
  DATE: iso,                                        // 2026-09-06
  DATE_DOT: iso.replace(/-/g, '.'),                 // 2026.09.06
  DATE_CN: `${y}年${Number(m)}月${Number(day)}日`,   // 2026年9月6日
  DATE_EN: fmt({ year: 'numeric', month: 'long', day: 'numeric' }), // September 6, 2026
  WEEKDAY_CN: fmt({ weekday: 'long' }, 'zh-CN'),    // 星期日
  WEEKDAY_EN: fmt({ weekday: 'long' }),             // Sunday
  WEEKDAY_EN_UPPER: fmt({ weekday: 'long' }).toUpperCase(), // SUNDAY
  WEEKDAY_SHORT_CN: '周' + '日一二三四五六'[new Date(iso + 'T04:00:00Z').getUTCDay()],
  BEIJING_NOW: new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ, dateStyle: 'short', timeStyle: 'short',
  }).format(new Date()),
};

console.log(JSON.stringify(out, null, 2));
