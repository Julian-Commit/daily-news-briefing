#!/usr/bin/env node
/**
 * check-images.js — 检查一期日报里的配图能不能在**我们的站点上**正常显示。
 *
 * 用法:
 *   node scripts/check-images.js news/2026-09-09.html
 *   node scripts/check-images.js --all            # 检查 news/ 下所有刊物
 *   node scripts/check-images.js news/x.html --fix-remove   # 把确认坏掉的 <img> 整个删掉
 *
 * 发现坏图时以非 0 退出，方便在流程里当门禁用。
 *
 * ── 为什么要单独检查 ────────────────────────────────────────
 * URL 存在 ≠ 能用。有些图床（半岛电视台的 aje.news 就是）开了防盗链：
 * 直接访问 200，但带上我们站点的 Referer 就返回 403，页面上于是一片空白。
 * 2026-09-09 那期 8 张图里有 3 张栽在这上面。
 * 所以这里模拟真实浏览场景：带 Referer、要求响应确实是 image/*。
 * ────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://julian-commit.github.io/daily-news-briefing/';
const TIMEOUT_MS = 15000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 已知会防盗链的图床，直接提醒别用
const KNOWN_HOTLINK_BLOCKED = ['aje.news'];

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Referer': SITE, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' },
    });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.ok) return { ok: false, why: 'HTTP ' + res.status + (res.status === 403 ? '（多半是防盗链）' : '') };
    if (!type.startsWith('image/')) return { ok: false, why: '返回的不是图片（' + (type || '无 content-type') + '）' };
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len < 1024) return { ok: false, why: '文件太小（' + len + ' 字节），八成是占位图' };
    try { await res.body.cancel(); } catch (err) { /* 不用把图下完 */ }
    return { ok: true, type, len };
  } catch (err) {
    return { ok: false, why: err.name === 'AbortError' ? '超时' : String(err.message).slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkFile(file, fixRemove) {
  const html = fs.readFileSync(file, 'utf8');
  const base = path.basename(file);
  const tags = [...html.matchAll(/<img\b[^>]*class="[^"]*\b(?:hl-img|ft-img)\b[^"]*"[^>]*>/g)].map(m => m[0]);
  const seen = new Map();
  for (const tag of tags) {
    const m = tag.match(/\ssrc="([^"]+)"/);
    if (m) seen.set(m[1], tag);
  }

  if (!seen.size) {
    console.log('· ' + base + '：一张图都没有');
    return { file: base, total: 0, bad: 0 };
  }

  console.log('── ' + base + '（' + seen.size + ' 张）');
  const bad = [];
  for (const [url, tag] of seen) {
    const host = (() => { try { return new URL(url).host; } catch (err) { return '?'; } })();
    const r = await probe(url);
    if (r.ok) {
      console.log('   ✓ ' + host.padEnd(26) + ' ' + url.slice(0, 62));
    } else {
      const known = KNOWN_HOTLINK_BLOCKED.some(h => host.endsWith(h)) ? '（这个域名已知防盗链，换信源的图）' : '';
      console.log('   ✗ ' + host.padEnd(26) + ' ' + r.why + known);
      console.log('     ' + url.slice(0, 100));
      bad.push({ url, tag });
    }
  }

  if (bad.length && fixRemove) {
    let out = html;
    for (const b of bad) out = out.split(b.tag).join('');
    fs.writeFileSync(file, out, 'utf8');
    console.log('   → 已删掉 ' + bad.length + ' 个坏掉的 <img>（其余内容未动）');
  }

  return { file: base, total: seen.size, bad: bad.length };
}

async function main() {
  const args = process.argv.slice(2);
  const fixRemove = args.includes('--fix-remove');
  const all = args.includes('--all');
  let targets = args.filter(a => !a.startsWith('--')).map(f => path.resolve(f));

  if (all) {
    const dir = path.join(ROOT, 'news');
    targets = fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}(-cn|-en)?\.html$/.test(f))
      .sort().map(f => path.join(dir, f));
  }
  if (!targets.length) {
    console.error('用法: node scripts/check-images.js <news/YYYY-MM-DD.html> [--fix-remove]   或   --all');
    process.exit(1);
  }

  let totalBad = 0, totalImg = 0;
  for (const t of targets) {
    if (!fs.existsSync(t)) { console.error('✗ 找不到 ' + t); process.exitCode = 1; continue; }
    const r = await checkFile(t, fixRemove);
    totalBad += r.bad; totalImg += r.total;
  }

  console.log('');
  if (totalBad) {
    console.log('共 ' + totalImg + ' 张图，其中 ' + totalBad + ' 张在我们站点上显示不出来。');
    console.log('换一张同一条新闻里别的信源的图；实在没有就不要配图，别留坏链接。');
    process.exit(1);
  }
  console.log('✓ 共 ' + totalImg + ' 张图，全部可正常显示');
}

main().catch(err => { console.error('✗ ' + err.message); process.exit(1); });
