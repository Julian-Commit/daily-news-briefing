#!/usr/bin/env node
/**
 * render.js — 用 JSON 数据填充日报模板，并在写出前做硬校验。
 *
 * 用法:
 *   node scripts/render.js <template.html> <data.json> <output.html> [--allow-missing]
 *
 * data.json 形如:
 *   {
 *     "DATE": "2026-09-06",
 *     "DATE_EN": "2026.09.06",
 *     "WEEKDAY": "SATURDAY",
 *     "ISSUE": "NO.003",
 *     "PREFACE_ZH": "……",
 *     "HEADLINES_CARDS": "<article class=\"hl\">…</article>"
 *   }
 *
 * 校验项（任何一项失败都 exit 非 0，不会写出文件）:
 *   1. 模板里的占位符必须都有值，且不能是空串
 *   2. 渲染后不能残留 {{...}}
 *   3. 不能有空的 <img src="">
 *   4. 不能残留 TODO / XXX / 待补 / lorem 这类占位文字
 * 另外会对以下情况给出警告（不阻断）:
 *   - data.json 里有模板用不到的键
 *   - <img> 缺 onerror 兜底
 *   - 中英内容块数量不对等
 */

const fs = require('fs');

const PLACEHOLDER_RE = /\{\{[A-Z_0-9]+\}\}/g;
const JUNK_RE = /(TODO|FIXME|待补|待填|XXXX|lorem ipsum)/i;

function fail(msg) {
  console.error('✗ ' + msg);
  process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  const allowMissing = args.includes('--allow-missing');
  const [tplPath, dataPath, outPath] = args.filter(a => !a.startsWith('--'));

  if (!tplPath || !dataPath || !outPath) {
    console.error('用法: node scripts/render.js <template.html> <data.json> <output.html> [--allow-missing]');
    process.exit(1);
  }

  const template = fs.readFileSync(tplPath, 'utf8');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    console.error('✗ data.json 解析失败: ' + err.message);
    process.exit(1);
  }

  const keys = [...new Set(template.match(PLACEHOLDER_RE) || [])].map(s => s.slice(2, -2));
  const missing = keys.filter(k => data[k] == null || String(data[k]).trim() === '');
  const unused = Object.keys(data).filter(k => !keys.includes(k));

  if (missing.length) {
    const msg = '占位符未填: ' + missing.join(', ');
    if (allowMissing) console.error('⚠ ' + msg + '（--allow-missing，继续）');
    else fail(msg);
  }
  if (unused.length) {
    console.error('⚠ data.json 里有模板用不到的键: ' + unused.join(', '));
  }

  let html = template;
  for (const k of keys) {
    if (data[k] != null) html = html.split('{{' + k + '}}').join(String(data[k]));
  }

  const leftover = [...new Set(html.match(PLACEHOLDER_RE) || [])];
  if (leftover.length && !allowMissing) fail('渲染后仍残留占位符: ' + leftover.join(', '));

  const emptyImg = (html.match(/<img[^>]*\ssrc=(""|''|"\s+")/g) || []).length;
  if (emptyImg) fail(emptyImg + ' 处 <img> 的 src 为空');

  const junk = html.match(JUNK_RE);
  if (junk) fail('正文里残留占位文字: ' + junk[0]);

  // 以下仅警告
  const imgs = html.match(/<img[^>]*>/g) || [];
  const noFallback = imgs.filter(t => !/onerror=/.test(t)).length;
  if (noFallback) console.error('⚠ ' + noFallback + ' 张图片没有 onerror 兜底，外链失效会破版');

  const zh = (html.match(/class="[^"]*\bzh-content\b/g) || []).length;
  const en = (html.match(/class="[^"]*\ben-content\b/g) || []).length;
  if (zh !== en) console.error('⚠ 中文块 ' + zh + ' 个 / 英文块 ' + en + ' 个，数量不对等，切换语言时会出现空白');

  if (process.exitCode) {
    console.error('\n未写出 ' + outPath + '，请修好上面的问题后重跑。');
    return;
  }

  fs.writeFileSync(outPath, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('✓ ' + outPath + ' 已写出（' + kb + ' KB，' + imgs.length + ' 张图，' + keys.length + ' 个占位符全部填充）');
}

main();
