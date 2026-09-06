#!/usr/bin/env node
/**
 * notify-discord.js — 把日报通知发到 Discord 频道（REST API，非 DM）。
 *
 * 两种发法：
 *
 *   1) 卡片（推荐，日报就该用这个）
 *      node scripts/notify-discord.js --card <card.json> [--dry-run]
 *      渲染成 Discord 原生 embed：左侧品牌色竖条、可点的标题、头条列表、
 *      大图，底部是「阅读全文」按钮。链接藏在标题和按钮里，不会出现
 *      裸露的一长串 URL——那种样子最像钓鱼。
 *
 *   2) 纯文本（临时通知、排查用）
 *      node scripts/notify-discord.js --text "……"
 *      node scripts/notify-discord.js --file msg.txt
 *      一个文件里想发多条，用单独一行 ---SPLIT--- 分隔。
 *
 * card.json 的字段（都可省略）：
 * {
 *   "author":      "陆先生日报",                 // 卡片顶部的小标题行
 *   "title":       "NO.003 · 2026年9月6日 星期日", // 卡片大标题
 *   "url":         "https://…/news/2026-09-06.html", // 让标题可点
 *   "description": "编辑部前言，两三句",
 *   "headlines":   ["头条一", "头条二"],          // 自动编号成一个字段
 *   "fields":      [{"name":"…","value":"…"}],    // 需要更多栏目时用
 *   "image":       "https://…jpg",               // 大图，放头条配图
 *   "thumbnail":   "https://…jpg",               // 右上角小图
 *   "color":       "#c0392b",
 *   "footer":      "交叉核验 · 事实优先 · 拒绝噪音",
 *   "buttons":     [{"label":"阅读全文","url":"…"},{"label":"English","url":"…"}]
 * }
 *
 * 凭据从环境变量读，仓库根目录的 .env 会自动加载（.env 已 gitignore）：
 *   DISCORD_BOT_TOKEN=...
 *   DISCORD_CHANNEL_ID=...
 *
 * 为什么不手拼 JSON：消息里的换行必须交给 JSON.stringify 处理，
 * 历史上手拼字符串导致过编码失败（见 memory/JOURNAL.jsonl 2026-07-20）。
 */

const fs = require('fs');
const path = require('path');

const MAX_LEN = 2000;       // 纯文本单条上限
const MAX_DESC = 4096;      // embed 描述上限
const MAX_FIELD = 1024;     // 单个字段上限
const MAX_TITLE = 256;
const API = 'https://discord.com/api/v10';
const DEFAULT_COLOR = '#c0392b';

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs(argv) {
  const out = { files: [], texts: [], cards: [], dryRun: false, channel: null, edit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.files.push(argv[++i]);
    else if (a === '--text') out.texts.push(argv[++i]);
    else if (a === '--card') out.cards.push(argv[++i]);
    else if (a === '--channel') out.channel = argv[++i];
    else if (a === '--edit') out.edit = argv[++i];   // 改一条已发出的消息
    else if (a === '--dry-run') out.dryRun = true;
    else { console.error('未知参数: ' + a); process.exit(1); }
  }
  return out;
}

const clip = (s, n) => {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function colorToInt(c) {
  if (typeof c === 'number') return c;
  const hex = String(c || DEFAULT_COLOR).replace('#', '');
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : parseInt(DEFAULT_COLOR.replace('#', ''), 16);
}

function httpsOnly(u, where) {
  if (!u) return null;
  if (!/^https:\/\//i.test(String(u))) {
    console.error('⚠ ' + where + ' 不是 https 链接，已忽略：' + String(u).slice(0, 60));
    return null;
  }
  return String(u);
}

function buildCard(card) {
  const embed = {
    color: colorToInt(card.color),
    timestamp: new Date().toISOString(),
  };
  if (card.author) embed.author = { name: clip(card.author, MAX_TITLE) };
  if (card.title) embed.title = clip(card.title, MAX_TITLE);
  const url = httpsOnly(card.url, 'card.url');
  if (url) embed.url = url;
  if (card.description) embed.description = clip(card.description, MAX_DESC);

  const fields = [];
  if (Array.isArray(card.headlines) && card.headlines.length) {
    const list = card.headlines.map((h, i) => '**' + (i + 1) + '.** ' + String(h).trim()).join('\n');
    fields.push({ name: card.headlinesTitle || '今日头条', value: clip(list, MAX_FIELD) });
  }
  for (const f of card.fields || []) {
    if (f && f.name && f.value) {
      fields.push({ name: clip(f.name, MAX_TITLE), value: clip(f.value, MAX_FIELD), inline: !!f.inline });
    }
  }
  if (fields.length) embed.fields = fields.slice(0, 25);

  const img = httpsOnly(card.image, 'card.image');
  if (img) embed.image = { url: img };
  const thumb = httpsOnly(card.thumbnail, 'card.thumbnail');
  if (thumb) embed.thumbnail = { url: thumb };
  if (card.footer) embed.footer = { text: clip(card.footer, 2048) };

  const payload = { embeds: [embed], allowed_mentions: { parse: [] } };

  const buttons = (card.buttons || [])
    .map(b => ({ label: clip(b.label, 80), url: httpsOnly(b.url, 'button.url') }))
    .filter(b => b.label && b.url)
    .slice(0, 5)
    .map(b => ({ type: 2, style: 5, label: b.label, url: b.url })); // style 5 = 链接按钮，不需要后端处理
  if (buttons.length) payload.components = [{ type: 1, components: buttons }];

  return payload;
}

function previewCard(payload) {
  const e = payload.embeds[0];
  const lines = ['┌─ 卡片预览 ' + '─'.repeat(46)];
  if (e.author) lines.push('│ ' + e.author.name);
  if (e.title) lines.push('│ ▸ ' + e.title + (e.url ? '   （标题可点，链接不外露）' : ''));
  if (e.description) lines.push('│ ' + e.description.replace(/\n/g, '\n│ '));
  for (const f of e.fields || []) {
    lines.push('│');
    lines.push('│ ' + f.name);
    lines.push('│ ' + f.value.replace(/\*\*/g, '').replace(/\n/g, '\n│ '));
  }
  if (e.image) lines.push('│ [大图] ' + e.image.url.slice(0, 60));
  if (e.thumbnail) lines.push('│ [小图] ' + e.thumbnail.url.slice(0, 60));
  if (e.footer) lines.push('│ ' + e.footer.text);
  const btns = (payload.components || [])[0];
  if (btns) lines.push('│ ' + btns.components.map(b => '[ ' + b.label + ' ]').join('  '));
  lines.push('└' + '─'.repeat(58));
  return lines.join('\n');
}

function chunkText(text) {
  const parts = text.split(/^---SPLIT---$/m).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= MAX_LEN) { out.push(p); continue; }
    console.error('⚠ 有一段长 ' + p.length + ' 字，超过 Discord 2000 上限，已按段落自动切分');
    let buf = '';
    for (const para of p.split(/\n\n+/)) {
      if ((buf + '\n\n' + para).length > MAX_LEN) { out.push(buf.trim()); buf = para; }
      else buf = buf ? buf + '\n\n' + para : para;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

const HINTS = {
  401: 'token 无效或已被吊销。Discord 会自动吊销出现在公开位置的 token，需要去 Developer Portal 里 Reset Token。',
  403: '权限不足。若 code 为 50013：频道权限里 @everyone 的 Send Messages 被 DENY，而 bot 没有独立 ALLOW 覆盖，于是继承了 DENY。修法是在该频道权限设置里给 bot 单独加 Send Messages = ALLOW。',
  404: '频道 ID 不对，或者 bot 不在这个服务器里。',
};

async function send(channel, token, payload, attempt = 1) {
  const res = await fetch(API + '/channels/' + channel + '/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Bot ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'luxiansheng-daily (+https://github.com/Julian-Commit)',
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return res.json();

  let body = {};
  try { body = await res.json(); } catch (err) { body = {}; }

  if (res.status === 429 && attempt === 1) {
    const wait = Math.ceil((body.retry_after || 1) * 1000) + 250;
    console.error('⚠ 触发限流，等待 ' + wait + 'ms 后重试一次');
    await new Promise(r => setTimeout(r, wait));
    return send(channel, token, payload, 2);
  }

  const code = body.code ? '(code ' + body.code + ') ' : '';
  const hint = HINTS[res.status] || '见 https://discord.com/developers/docs/topics/opcodes-and-status-codes';
  const detail = body.errors ? '\n  细节: ' + JSON.stringify(body.errors).slice(0, 300) : '';
  throw new Error('Discord ' + res.status + ' ' + code + (body.message || '') + detail + '\n  → ' + hint);
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  const payloads = [];

  for (const f of args.cards) {
    if (!fs.existsSync(f)) { console.error('✗ 找不到卡片文件: ' + f); process.exit(1); }
    let card;
    try { card = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (err) { console.error('✗ 卡片 JSON 解析失败: ' + err.message); process.exit(1); }
    payloads.push({ kind: 'card', payload: buildCard(card) });
  }

  let raw = args.texts.join('\n---SPLIT---\n');
  for (const f of args.files) {
    if (!fs.existsSync(f)) { console.error('✗ 找不到文件: ' + f); process.exit(1); }
    raw = (raw ? raw + '\n---SPLIT---\n' : '') + fs.readFileSync(f, 'utf8');
  }
  for (const t of chunkText(raw)) {
    payloads.push({ kind: 'text', payload: { content: t, allowed_mentions: { parse: [] } } });
  }

  if (!payloads.length) {
    console.error('用法: node scripts/notify-discord.js (--card card.json | --text "…" | --file path) [--channel id] [--dry-run]');
    process.exit(1);
  }

  const channel = args.channel || process.env.DISCORD_CHANNEL_ID;
  const token = process.env.DISCORD_BOT_TOKEN;

  if (args.dryRun) {
    console.log('[dry-run] 频道 ' + (channel || '(未设置)') + '，共 ' + payloads.length + ' 条：\n');
    payloads.forEach((p, i) => {
      console.log('--- 第 ' + (i + 1) + ' 条（' + (p.kind === 'card' ? '卡片' : '纯文本 ' + p.payload.content.length + ' 字') + '）---');
      console.log(p.kind === 'card' ? previewCard(p.payload) : p.payload.content);
      console.log('');
    });
    return;
  }

  if (!token || !channel) {
    console.error('✗ 缺少 DISCORD_BOT_TOKEN 或 DISCORD_CHANNEL_ID。');
    console.error('  在仓库根目录建 .env（参考 .env.example），或先用 --dry-run 检查内容。');
    process.exit(1);
  }

  if (args.edit) {
    if (payloads.length !== 1) { console.error('✗ --edit 一次只能改一条'); process.exit(1); }
    const res = await fetch(API + '/channels/' + channel + '/messages/' + args.edit, {
      method: 'PATCH',
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json', 'User-Agent': 'luxiansheng-daily' },
      body: JSON.stringify(payloads[0].payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Discord ' + res.status + ' ' + (body.message || '') + '（只能改本机器人自己发的消息）');
    console.log('✓ 已更新消息 ' + args.edit);
    return;
  }

  for (let i = 0; i < payloads.length; i++) {
    const msg = await send(channel, token, payloads[i].payload);
    console.log('✓ 第 ' + (i + 1) + '/' + payloads.length + ' 条已发送（' + payloads[i].kind + '，message id ' + msg.id + '）');
    if (i < payloads.length - 1) await new Promise(r => setTimeout(r, 800));
  }
}

main().catch(err => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
