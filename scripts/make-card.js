#!/usr/bin/env node
/**
 * make-card.js — 从一期已生成的日报 HTML 里提取信息，产出 Discord 卡片 JSON。
 *
 * 用法:
 *   node scripts/make-card.js news/2026-09-06.html                # 打印到 stdout
 *   node scripts/make-card.js news/2026-09-06.html card.json      # 写文件
 *
 * 然后:
 *   node scripts/notify-discord.js --card card.json --dry-run
 *
 * 这样卡片内容永远和刊物一致，不用手抄标题、也不会抄错刊号。
 */

const fs = require('fs');
const path = require('path');

// ── 本项目的品牌设定 ────────────────────────────────────────
const PROJECT = {
  brand: '陆先生日报 · LUXIANSHENG DAILY',
  color: '#c0392b',
  footer: '交叉核验 · 事实优先 · 拒绝噪音',
  site: 'https://julian-commit.github.io/daily-news-briefing',
  issueFormat: n => 'NO.' + String(n).padStart(3, '0'),
};
// ───────────────────────────────────────────────────────────

const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const MAX_PREFACE = 140;  // 卡片上放两三句就够，再长就成一堵墙了
const MAX_HEADLINES = 5;

const stripTags = s => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const hasCJK = s => /[一-鿿]/.test(s);

function clipSentence(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('. '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trim() + '…');
}

function main() {
  const [rel, outPath] = process.argv.slice(2);
  if (!rel) {
    console.error('用法: node scripts/make-card.js <news/YYYY-MM-DD.html> [card.json]');
    process.exit(1);
  }
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) { console.error('✗ 找不到 ' + rel); process.exit(1); }
  const html = fs.readFileSync(file, 'utf8');
  const base = path.basename(file);

  const dateMatch = base.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) { console.error('✗ 文件名里没有 YYYY-MM-DD'); process.exit(1); }
  const date = dateMatch[1];
  const d = new Date(date + 'T00:00:00Z');
  const isCn = /-cn\.html$/.test(base);
  const isEn = /-en\.html$/.test(base);

  // 刊号：只从页眉的 .no 元素里取
  const issueNum = (html.match(/class="no"[^>]*>\s*(?:NO\.|No\.|#)?\s*(\d+)/i) || [])[1];

  // 头条：中文优先（新闻版同页有中英两套标题）
  const allTitles = [...new Set(
    [...html.matchAll(/class="[^"]*\bhl-title\b[^"]*"[^>]*>([\s\S]*?)<\//g)].map(m => stripTags(m[1])).filter(Boolean)
  )];
  const cjk = allTitles.filter(hasCJK);
  const headlines = (isEn ? allTitles : (cjk.length ? cjk : allTitles)).slice(0, MAX_HEADLINES);

  // 编者按：前言区里第一段中文
  let preface = '';
  const pfBlock = html.match(/class="pf-label[^"]*"[\s\S]{0,3000}?<\/section>/);
  if (pfBlock) {
    const paras = [...pfBlock[0].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => stripTags(m[1])).filter(Boolean);
    preface = paras.find(p => (isEn ? !hasCJK(p) : hasCJK(p))) || paras[0] || '';
  }
  preface = clipSentence(preface, MAX_PREFACE);

  // 头图：刊物里第一张 https 图片
  const image = ([...html.matchAll(/class="hl-img"[^>]*\ssrc="(https:[^"]+)"/g)][0] || [])[1] || null;

  const issueLabel = issueNum ? PROJECT.issueFormat(issueNum) : '';
  const pageUrl = PROJECT.site + '/news/' + base;

  const buttons = [];
  if (isCn) {
    buttons.push({ label: '阅读中文版', url: pageUrl });
    const en = base.replace(/-cn\.html$/, '-en.html');
    if (fs.existsSync(path.join(path.dirname(file), en))) {
      buttons.push({ label: 'English', url: PROJECT.site + '/news/' + en });
    }
  } else {
    buttons.push({ label: '阅读全文', url: pageUrl });
  }
  buttons.push({ label: '往期目录', url: PROJECT.site + '/news/' });

  const card = {
    author: PROJECT.brand,
    title: [issueLabel, date.replace(/-/g, '.') + ' ' + WEEKDAY_CN[d.getUTCDay()]].filter(Boolean).join(' · '),
    url: pageUrl,
    description: preface || undefined,
    headlines,
    image: image || undefined,
    color: PROJECT.color,
    footer: PROJECT.footer,
    buttons,
  };

  const json = JSON.stringify(card, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    console.log('✓ 已写出 ' + outPath);
    console.log('  刊号 ' + (issueLabel || '(未解析到)') + ' / 头条 ' + headlines.length + ' 条 / 头图 ' + (image ? '有' : '无'));
    if (!image) console.log('  ⚠ 这期没有配图，卡片会没有大图。新刊请给每条头条配信源自带的 og:image');
  } else {
    console.log(json);
  }
}

main();
