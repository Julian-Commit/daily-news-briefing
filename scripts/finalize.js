#!/usr/bin/env node
/**
 * finalize.js — 给已生成的日报 HTML 做最后加工，可反复执行（幂等）。
 *
 * 用法:
 *   node scripts/finalize.js news/2026-09-06.html            # 注入分享信息 + 同步样式
 *   node scripts/finalize.js news/2026-09-06.html --og-only  # 只注入分享信息
 *   node scripts/finalize.js --all                           # 处理 news/ 下所有刊物
 *
 * 做两件事：
 *
 * 1) 注入分享信息（og:/twitter: 与 JSON-LD）
 *    没有这些标签时，链接发到 Discord、微信、Slack 里就是一条干巴巴的裸 URL——
 *    这正是"看着像钓鱼"的根源。有了之后会自动展开成带标题、摘要和封面图的卡片。
 *    标题/摘要/封面图都从刊物自身解析，不用手填。
 *
 * 2) 同步外壳（--og-only 可跳过）
 *    把当前 template 的 <style>、页面脚本、favicon 覆盖回旧刊物，
 *    让所有历史刊物跟着新样式走（深色模式、进度条、目录高亮等）。
 *    只动外壳，不碰正文。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://julian-commit.github.io/daily-news-briefing';
const BRAND = '陆先生日报 | Luxiansheng Daily';
const TEMPLATE = path.join(ROOT, 'template.html');

const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const hasCJK = s => /[一-鿿]/.test(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function extract(html, base) {
  const date = (base.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  const issue = (html.match(/class="no"[^>]*>\s*(?:NO\.|No\.|#)?\s*(\d+)/i) || [])[1];
  const titles = [...new Set(
    [...html.matchAll(/class="[^"]*\bhl-title\b[^"]*"[^>]*>([\s\S]*?)<\//g)].map(m => stripTags(m[1])).filter(Boolean)
  )].filter(hasCJK);

  let preface = '';
  const pf = html.match(/class="pf-label[^"]*"[\s\S]{0,3000}?<\/section>/);
  if (pf) {
    const paras = [...pf[0].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1])).filter(Boolean);
    preface = paras.find(hasCJK) || paras[0] || '';
  }
  // 摘要优先用头条串起来，比编者按更像"这期讲了什么"
  let desc = titles.slice(0, 3).join('；');
  if (desc.length < 40) desc = preface;
  if (desc.length > 180) desc = desc.slice(0, 179) + '…';

  const image = ([...html.matchAll(/class="hl-img"[^>]*\ssrc="(https:[^"]+)"/g)][0] || [])[1] || null;

  return {
    date, issue, image, desc,
    title: (issue ? 'NO.' + String(issue).padStart(3, '0') + ' · ' : '') + date + ' · ' + BRAND,
    url: SITE + '/news/' + base,
  };
}

const MARK_START = '<!-- share:start -->';
const MARK_END = '<!-- share:end -->';

function shareBlock(meta) {
  const lines = [
    MARK_START,
    `<meta name="description" content="${esc(meta.desc)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="陆先生日报">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.desc)}">`,
    `<meta property="og:url" content="${esc(meta.url)}">`,
    `<meta property="og:locale" content="zh_CN">`,
  ];
  if (meta.image) lines.push(`<meta property="og:image" content="${esc(meta.image)}">`);
  lines.push(`<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`);
  lines.push(`<meta name="twitter:title" content="${esc(meta.title)}">`);
  lines.push(`<meta name="twitter:description" content="${esc(meta.desc)}">`);
  if (meta.image) lines.push(`<meta name="twitter:image" content="${esc(meta.image)}">`);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: meta.title,
    description: meta.desc,
    datePublished: meta.date,
    url: meta.url,
    inLanguage: 'zh-CN',
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: '陆先生日报' },
  };
  if (meta.image) ld.image = [meta.image];
  lines.push('<script type="application/ld+json">' + JSON.stringify(ld) + '</script>');
  lines.push(MARK_END);
  return lines.join('\n');
}

function injectShare(html, meta) {
  const block = shareBlock(meta);
  const re = new RegExp(MARK_START + '[\\s\\S]*?' + MARK_END);
  if (re.test(html)) return html.replace(re, block);
  return html.replace('</head>', block + '\n</head>');
}

function sectionOf(html, tag) {
  const m = html.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>[\\s\\S]*?<\\/' + tag + '>'));
  return m ? m[0] : null;
}

function syncShell(html, tpl) {
  let out = html;

  // 样式整体换成模板的
  const tplStyle = sectionOf(tpl, 'style');
  const ownStyle = sectionOf(out, 'style');
  if (tplStyle && ownStyle) out = out.replace(ownStyle, tplStyle);

  // 页面脚本换成模板的（语言记忆、进度条、目录高亮）
  const tplScripts = [...tpl.matchAll(/<script>[\s\S]*?<\/script>/g)].map(m => m[0]);
  const ownScripts = [...out.matchAll(/<script>[\s\S]*?<\/script>/g)].map(m => m[0]);
  if (tplScripts.length && ownScripts.length) out = out.replace(ownScripts[ownScripts.length - 1], tplScripts[tplScripts.length - 1]);

  // favicon 与 theme-color
  const head = tpl.match(/<head>[\s\S]*?<\/head>/)[0];
  for (const re of [/<link rel="icon"[^>]*>/, /<meta name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"[^>]*>/, /<meta name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"[^>]*>/]) {
    const tag = (head.match(re) || [])[0];
    if (!tag) continue;
    if (out.match(re)) out = out.replace(re, tag);
    else out = out.replace('</head>', tag + '\n</head>');
  }

  // 跳到正文 + 进度条
  if (!/class="skip"/.test(out)) {
    out = out.replace(/<body>/, '<body>\n\n<a class="skip" href="#main">跳到正文 / Skip to content</a>');
  }
  if (!/id="prog"/.test(out)) {
    out = out.replace(/<a class="skip"[^<]*<\/a>/, m => m + '\n<div class="prog" id="prog" aria-hidden="true"></div>');
  }
  if (!/<main[^>]*id="main"/.test(out)) {
    out = out.replace(/<main class="ct">/, '<main class="ct" id="main">');
  }
  // 回到顶部按钮补上无障碍属性
  out = out.replace(/<button class="btt" id="btt"(?![^>]*aria-label)/, '<button class="btt" id="btt" type="button" aria-label="回到顶部"');

  return out;
}

function finalizeFile(file, ogOnly) {
  const base = path.basename(file);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  const meta = extract(html, base);

  html = injectShare(html, meta);
  if (!ogOnly && fs.existsSync(TEMPLATE)) html = syncShell(html, fs.readFileSync(TEMPLATE, 'utf8'));

  if (html === before) {
    console.log('· ' + base + ' 已是最新，未改动');
    return;
  }
  fs.writeFileSync(file, html, 'utf8');
  console.log('✓ ' + base + '  摘要 ' + meta.desc.length + ' 字 / 封面图 ' + (meta.image ? '有' : '无') + (ogOnly ? '' : ' / 已同步样式'));
  if (!meta.image) console.log('    ⚠ 没有封面图，分享出去只有文字卡片');
}

function main() {
  const args = process.argv.slice(2);
  const ogOnly = args.includes('--og-only');
  const all = args.includes('--all');
  const files = args.filter(a => !a.startsWith('--'));

  let targets = files.map(f => path.resolve(f));
  if (all) {
    const dir = path.join(ROOT, 'news');
    targets = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}(-cn|-en)?\.html$/.test(f)).sort().map(f => path.join(dir, f));
  }
  if (!targets.length) {
    console.error('用法: node scripts/finalize.js <news/YYYY-MM-DD.html> [--og-only]   或   --all');
    process.exit(1);
  }
  for (const t of targets) {
    if (!fs.existsSync(t)) { console.error('✗ 找不到 ' + t); process.exitCode = 1; continue; }
    finalizeFile(t, ogOnly);
  }
}

main();
