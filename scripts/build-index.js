#!/usr/bin/env node
/**
 * build-index.js — 扫描 news/ 下的日报，生成往期目录和站点首页。
 *
 * 用法:
 *   node scripts/build-index.js
 *
 * 产出（会覆盖，不要手改这两个文件）:
 *   news/index.html   往期目录，最新一期在最前
 *   index.html        站点首页，"阅读最新一期"直链到最新日报
 *
 * 元数据从每期 HTML 里解析: 文件名取日期，NO.xxx 取期号，.hl-title 取头条。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEWS_DIR = path.join(ROOT, 'news');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const hasCJK = s => /[\u4e00-\u9fff]/.test(s);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function collect() {
  if (!fs.existsSync(NEWS_DIR)) return [];
  return fs.readdirSync(NEWS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort()
    .reverse()
    .map(file => {
      const html = fs.readFileSync(path.join(NEWS_DIR, file), 'utf8');
      const date = file.slice(0, 10);
      const d = new Date(date + 'T00:00:00Z');
      // 只从页眉的 .no 元素里取，避免撞上正文里别的数字
      const issue = (html.match(/class="no"[^>]*>\s*(?:NO\.\s*|#)?(\d+)/i) || [])[1] || null;
      const titles = [...html.matchAll(/class="[^"]*\bhl-title\b[^"]*"[^>]*>([\s\S]*?)<\//g)]
        .map(m => stripTags(m[1]))
        .filter(t => t && hasCJK(t));
      return {
        file,
        date,
        weekday: WEEKDAYS[d.getUTCDay()],
        issue: issue ? 'NO.' + String(issue).padStart(3, '0') : '—',
        titles: [...new Set(titles)].slice(0, 3),
      };
    });
}

const SHELL_CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#e9ecf0;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",-apple-system,sans-serif;color:#2c3e50;line-height:1.8;-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto;background:#fff;min-height:100vh}
@media(min-width:768px){.wrap{max-width:720px}}
@media(min-width:1100px){.wrap{max-width:860px}}
.hd{background:#1a1a2e;color:#fff;padding:22px 20px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px}
.hd-brand{font-size:22px;font-weight:800;letter-spacing:1px}
.hd-sub{font-size:10px;letter-spacing:3px;opacity:.6;display:block;margin-top:2px}
.hd-meta{font-size:11px;opacity:.75;text-align:right}
.tagline{background:#c0392b;color:#fff;font-size:12px;letter-spacing:2px;padding:8px 20px;text-align:center}
.body{padding:24px 20px 40px}
.sec-label{font-size:11px;font-weight:700;letter-spacing:2px;color:#999;margin:0 0 12px}
.latest{display:block;border:1px solid #e2e6ea;border-left:4px solid #c0392b;border-radius:4px;padding:18px;text-decoration:none;color:inherit;margin-bottom:34px;transition:box-shadow .2s}
.latest:hover{box-shadow:0 6px 18px rgba(0,0,0,.08)}
.latest .no{font-size:30px;font-weight:800;color:#1a1a2e;line-height:1.1}
.latest .dt{font-size:12px;color:#999;margin-bottom:10px}
.latest ul{list-style:none;margin:0}
.latest li{font-size:13.5px;color:#444;padding-left:14px;position:relative;margin-bottom:4px}
.latest li::before{content:"";position:absolute;left:0;top:11px;width:5px;height:5px;border-radius:50%;background:#c0392b}
.latest .go{display:inline-block;margin-top:12px;font-size:12px;font-weight:700;color:#c0392b}
.row{display:flex;gap:14px;align-items:baseline;padding:14px 0;border-bottom:1px solid #eef1f4;text-decoration:none;color:inherit}
.row:hover .row-t{color:#c0392b}
.row .row-no{font-size:13px;font-weight:800;color:#1a1a2e;flex-shrink:0;width:64px}
.row .row-d{font-size:12px;color:#999;flex-shrink:0;width:104px}
.row .row-t{font-size:13.5px;color:#555;line-height:1.7}
.empty{font-size:13px;color:#999;padding:20px 0}
.ftr{background:#1a1a2e;color:#fff;text-align:center;font-size:11px;padding:20px;line-height:2}
.ftr .brand{font-weight:700;letter-spacing:1px;font-size:12px}
.ftr .dim{opacity:.4}
a.back{color:#c0392b;text-decoration:none;font-weight:700;font-size:12px}
`.trim();

function page({ title, metaRight, tagline, body }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
${SHELL_CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="hd">
  <div>
    <span class="hd-brand">陆先生日报</span>
    <span class="hd-sub">LUXIANSHENG DAILY</span>
  </div>
  <div class="hd-meta">${metaRight}</div>
</header>
<div class="tagline">${tagline}</div>
<div class="body">
${body}
</div>
<footer class="ftr">
  <div class="brand">陆先生日报 · LUXIANSHENG DAILY</div>
  交叉核验 · 事实优先 · 拒绝噪音<br>
  <span class="dim">自动生成 · 内容仅供参考</span>
</footer>
</div>
</body>
</html>
`;
}

function buildHome(issues) {
  const latest = issues[0];
  const latestBlock = latest
    ? `<a class="latest" href="news/${latest.file}">
  <div class="no">${latest.issue}</div>
  <div class="dt">${latest.date.replace(/-/g, '.')} ${latest.weekday}</div>
  <ul>${latest.titles.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
  <span class="go">阅读最新一期 →</span>
</a>`
    : `<p class="empty">还没有已发布的日报。</p>`;

  const rest = issues.slice(1, 11);
  const restBlock = rest.length
    ? `<p class="sec-label">往期</p>` +
      rest.map(i => `<a class="row" href="news/${i.file}"><span class="row-no">${i.issue}</span><span class="row-d">${i.date.replace(/-/g, '.')} ${i.weekday}</span><span class="row-t">${esc(i.titles[0] || '')}</span></a>`).join('\n') +
      `\n<p style="margin-top:18px"><a class="back" href="news/">查看全部 ${issues.length} 期 →</a></p>`
    : '';

  return page({
    title: '陆先生日报 | Luxiansheng Daily',
    metaRight: `共 ${issues.length} 期<br>每日北京时间 21:00 更新`,
    tagline: '每日全球要闻 · 政治 / 科技 / 地理与环境',
    body: `<p class="sec-label">最新一期</p>\n${latestBlock}\n${restBlock}`,
  });
}

function buildArchive(issues) {
  const body = issues.length
    ? issues.map(i => `<a class="row" href="${i.file}"><span class="row-no">${i.issue}</span><span class="row-d">${i.date.replace(/-/g, '.')} ${i.weekday}</span><span class="row-t">${esc(i.titles.join(' · '))}</span></a>`).join('\n')
    : `<p class="empty">还没有已发布的日报。</p>`;

  return page({
    title: '往期目录 | 陆先生日报',
    metaRight: `往期目录<br>共 ${issues.length} 期`,
    tagline: '往期目录 · ARCHIVE',
    body: `<p style="margin-bottom:16px"><a class="back" href="../">← 返回首页</a></p>\n${body}`,
  });
}

const issues = collect();
fs.writeFileSync(path.join(NEWS_DIR, 'index.html'), buildArchive(issues), 'utf8');
fs.writeFileSync(path.join(ROOT, 'index.html'), buildHome(issues), 'utf8');
console.log(`✓ 已生成 index.html 与 news/index.html（${issues.length} 期）`);
for (const i of issues) console.log(`  ${i.issue}  ${i.date} ${i.weekday}  ${i.titles[0] || '(未解析到头条)'}`);
