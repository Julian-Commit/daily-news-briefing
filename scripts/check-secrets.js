#!/usr/bin/env node
/**
 * check-secrets.js — 防止把密钥提交进（现在是公开的）仓库。
 *
 * 用法:
 *   node scripts/check-secrets.js --staged   # 只查这次要提交的内容（git 钩子用）
 *   node scripts/check-secrets.js --all      # 体检：工作区所有文件 + 全部提交历史
 *   node scripts/check-secrets.js --install  # 把自己装成 .git/hooks/pre-commit
 *
 * 查两类东西：
 *   1. .env 里那几个真实值有没有出现在别的文件/历史里（比对但绝不打印原值）
 *   2. 常见密钥形状：Discord bot token、OpenAI/Anthropic key、GitHub token、AWS、私钥等
 *
 * 命中就以非 0 退出，钩子会因此拦下这次 commit。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const PATTERNS = [
  { name: 'Discord bot token', re: /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI API key', re: /\bsk-(?!ant-)[A-Za-z0-9]{20,}/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: '私钥文件头', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'Bearer/Bot 授权头硬编码', re: /Authorization["'\s:=]+["']?(Bot|Bearer)\s+[A-Za-z0-9._-]{20,}/g },
];

// 这些文件本身就该放密钥或写着密钥的样子，不算问题
const SKIP_FILES = [/(^|[\\/])\.env$/, /(^|[\\/])node_modules[\\/]/, /(^|[\\/])\.git[\\/]/, /check-secrets\.js$/];

function envValues() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    // 频道 ID 之类的短数字不算秘密，只盯长值
    if (val.length >= 24 && !/^\d+$/.test(val)) out.push({ key: m[1], val });
  }
  return out;
}

function mask(v) {
  return v.slice(0, 4) + '…' + v.slice(-4) + '（' + v.length + ' 字符）';
}

function scan(text, where, secrets, hits) {
  for (const s of secrets) {
    if (text.includes(s.val)) {
      hits.push('  ✗ ' + where + ' 里出现了 .env 中的 ' + s.key + ' 实际值 ' + mask(s.val));
    }
  }
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      const uniq = [...new Set(m)].slice(0, 3).map(x => mask(x));
      hits.push('  ✗ ' + where + ' 疑似' + p.name + '：' + uniq.join('、'));
    }
  }
}

function git(cmd) {
  return execSync('git ' + cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function main() {
  const mode = process.argv[2] || '--staged';

  if (mode === '--install') {
    const hookDir = path.join(ROOT, '.git', 'hooks');
    if (!fs.existsSync(hookDir)) { console.error('✗ 这里不是 git 仓库'); process.exit(1); }
    const hook = path.join(hookDir, 'pre-commit');
    fs.writeFileSync(hook,
      '#!/bin/sh\n' +
      '# 由 scripts/check-secrets.js --install 生成：提交前拦截密钥\n' +
      'node "$(git rev-parse --show-toplevel)/scripts/check-secrets.js" --staged || exit 1\n',
      'utf8');
    try { fs.chmodSync(hook, 0o755); } catch (err) { /* Windows 上无所谓 */ }
    console.log('✓ 已安装 git pre-commit 钩子：' + hook);
    return;
  }

  const secrets = envValues();
  const hits = [];

  if (mode === '--staged') {
    const staged = git('diff --cached --name-only').split('\n').filter(Boolean);
    for (const f of staged) {
      if (SKIP_FILES.some(re => re.test(f))) continue;
      let content = '';
      try { content = git('show :"' + f + '"'); } catch (err) { continue; }
      scan(content, f, secrets, hits);
    }
    // .env 被误加入暂存区是最危险的情况，单独拦
    if (staged.some(f => /(^|\/)\.env$/.test(f))) {
      hits.push('  ✗ .env 本身被加进了暂存区——这个文件永远不该提交');
    }
  } else if (mode === '--all') {
    const tracked = git('ls-files').split('\n').filter(Boolean);
    for (const f of tracked) {
      if (SKIP_FILES.some(re => re.test(f))) continue;
      const abs = path.join(ROOT, f);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).size > 5 * 1024 * 1024) continue;
      scan(fs.readFileSync(abs, 'utf8'), '工作区 ' + f, secrets, hits);
    }
    console.log('  已扫描工作区 ' + tracked.length + ' 个受版本管理的文件');
    const history = git('log -p --all --no-color');
    scan(history, '提交历史', secrets, hits);
    const commits = git('rev-list --all --count').trim();
    console.log('  已扫描全部 ' + commits + ' 个提交的完整改动');
  } else {
    console.error('用法: node scripts/check-secrets.js [--staged|--all|--install]');
    process.exit(1);
  }

  if (hits.length) {
    console.error('\n发现可能泄露的密钥：\n' + hits.join('\n'));
    console.error('\n处理办法：把密钥挪进 .env（已被 git 忽略），代码里只读环境变量。');
    console.error('如果它已经进了提交历史，先去服务方后台把这把密钥作废，再考虑清理历史。\n');
    process.exit(1);
  }

  console.log('✓ 没有发现密钥泄露' + (secrets.length ? '（比对了 .env 里的 ' + secrets.length + ' 个值）' : '（.env 为空或不存在）'));
}

main();
