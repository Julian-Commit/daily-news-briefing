#!/usr/bin/env node
/**
 * journal.js — 往 memory/JOURNAL.jsonl 追加一条运行记录。
 *
 * 用法:
 *   node scripts/journal.js --tags 日报,2026-09-06 --text "本期要点…"
 *   node scripts/journal.js --tags 排查 --file /tmp/note.txt
 *   node scripts/journal.js --tail 3          # 只看最近几条
 *
 * 每行一个 JSON 对象: { ts, tags, text }。手写容易漏转义换行，用这个脚本。
 */

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'memory', 'JOURNAL.jsonl');

const args = process.argv.slice(2);
let tags = [];
let text = '';
let tail = 0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tags') tags = (args[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
  else if (args[i] === '--text') text = args[++i] || '';
  else if (args[i] === '--file') text = fs.readFileSync(args[++i], 'utf8').trim();
  else if (args[i] === '--tail') tail = parseInt(args[++i] || '5', 10);
  else {
    console.error('未知参数: ' + args[i]);
    process.exit(1);
  }
}

if (tail) {
  const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim() : '';
  const lines = raw ? raw.split('\n').filter(Boolean) : [];
  for (const line of lines.slice(-tail)) {
    try {
      const e = JSON.parse(line);
      console.log('\n[' + e.ts + '] ' + (e.tags || []).join(' / ') + '\n' + e.text);
    } catch (err) {
      console.error('⚠ 有一行不是合法 JSON，已跳过: ' + line.slice(0, 60));
    }
  }
  process.exit(0);
}

if (!text.trim()) {
  console.error('用法: node scripts/journal.js --tags a,b --text "…"   或 --file path   或 --tail 3');
  process.exit(1);
}

fs.mkdirSync(path.dirname(FILE), { recursive: true });
const existing = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
const entry = { ts: new Date().toISOString(), tags, text: text.trim() };
fs.appendFileSync(FILE, prefix + JSON.stringify(entry) + '\n', 'utf8');
console.log('✓ 已追加到 memory/JOURNAL.jsonl');
console.log(JSON.stringify(entry, null, 2));
