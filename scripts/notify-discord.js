#!/usr/bin/env node
/**
 * notify-discord.js — 把日报通知发到 Discord 频道（REST API，非 DM）。
 *
 * 用法:
 *   node scripts/notify-discord.js --text "……"
 *   node scripts/notify-discord.js --file /tmp/discord.txt
 *   node scripts/notify-discord.js --file /tmp/discord.txt --dry-run
 *   node scripts/notify-discord.js --file a.txt --file b.txt        # 依次发多条
 *   node scripts/notify-discord.js --channel 123456789 --text "……"
 *
 * 一个文件里想发多条消息，用单独一行 ---SPLIT--- 分隔。
 *
 * 凭据从环境变量读取，仓库根目录的 .env 会被自动加载（.env 已 gitignore）:
 *   DISCORD_BOT_TOKEN=...
 *   DISCORD_CHANNEL_ID=...
 *
 * 为什么不手拼 JSON: 消息里的换行必须交给 JSON.stringify 处理，
 * 历史上手拼字符串导致过编码失败（见 memory/JOURNAL.jsonl 2026-07-20）。
 */

const fs = require('fs');
const path = require('path');

const MAX_LEN = 2000; // Discord 单条消息上限
const API = 'https://discord.com/api/v10';

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { files: [], texts: [], dryRun: false, channel: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.files.push(argv[++i]);
    else if (a === '--text') out.texts.push(argv[++i]);
    else if (a === '--channel') out.channel = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else {
      console.error('未知参数: ' + a);
      process.exit(1);
    }
  }
  return out;
}

function chunk(text) {
  const parts = text.split(/^---SPLIT---$/m).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length <= MAX_LEN) {
      out.push(p);
      continue;
    }
    console.error('⚠ 有一段长 ' + p.length + ' 字，超过 Discord 2000 上限，已按段落自动切分');
    let buf = '';
    for (const para of p.split(/\n\n+/)) {
      if ((buf + '\n\n' + para).length > MAX_LEN) {
        out.push(buf.trim());
        buf = para;
      } else {
        buf = buf ? buf + '\n\n' + para : para;
      }
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

async function send(channel, token, content, attempt = 1) {
  const res = await fetch(API + '/channels/' + channel + '/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bot ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'luxiansheng-daily (+https://github.com/Julian-Commit)',
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });

  if (res.ok) return res.json();

  let body = {};
  try {
    body = await res.json();
  } catch (err) {
    body = {};
  }

  if (res.status === 429 && attempt === 1) {
    const wait = Math.ceil((body.retry_after || 1) * 1000) + 250;
    console.error('⚠ 触发限流，等待 ' + wait + 'ms 后重试一次');
    await new Promise(r => setTimeout(r, wait));
    return send(channel, token, content, 2);
  }

  const code = body.code ? '(code ' + body.code + ') ' : '';
  const hint = HINTS[res.status] || '见 https://discord.com/developers/docs/topics/opcodes-and-status-codes';
  throw new Error('Discord ' + res.status + ' ' + code + (body.message || '') + '\n  → ' + hint);
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  let raw = args.texts.join('\n---SPLIT---\n');
  for (const f of args.files) {
    if (!fs.existsSync(f)) {
      console.error('✗ 找不到文件: ' + f);
      process.exit(1);
    }
    raw = (raw ? raw + '\n---SPLIT---\n' : '') + fs.readFileSync(f, 'utf8');
  }
  if (!raw.trim()) {
    console.error('用法: node scripts/notify-discord.js (--text "…" | --file path) [--channel id] [--dry-run]');
    process.exit(1);
  }

  const messages = chunk(raw);
  const channel = args.channel || process.env.DISCORD_CHANNEL_ID;
  const token = process.env.DISCORD_BOT_TOKEN;

  if (args.dryRun) {
    console.log('[dry-run] 频道 ' + (channel || '(未设置)') + '，共 ' + messages.length + ' 条：');
    messages.forEach((m, i) => {
      console.log('\n--- 第 ' + (i + 1) + ' 条（' + m.length + ' 字）---\n' + m);
    });
    return;
  }

  if (!token || !channel) {
    console.error('✗ 缺少 DISCORD_BOT_TOKEN 或 DISCORD_CHANNEL_ID。');
    console.error('  在仓库根目录建 .env（参考 .env.example），或先用 --dry-run 检查内容。');
    process.exit(1);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = await send(channel, token, messages[i]);
    console.log('✓ 第 ' + (i + 1) + '/' + messages.length + ' 条已发送（message id ' + msg.id + '）');
    if (i < messages.length - 1) await new Promise(r => setTimeout(r, 800));
  }
}

main().catch(err => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
