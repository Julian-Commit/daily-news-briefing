#!/usr/bin/env node
/**
 * extract-images.js — 抓取新闻页的配图（og:image 等）。
 *
 * 用法:
 *   node scripts/extract-images.js <url1> <url2> ...             # 默认：纯 HTTP，不开浏览器
 *   node scripts/extract-images.js --auto <url1> ...             # HTTP 抓不到的，再用浏览器补
 *   node scripts/extract-images.js --browser <url1> ...          # 强制全部走浏览器
 *
 * 输出 JSON 到 stdout，进度日志到 stderr：
 *   [ { "url": "...", "image": "https://...jpg", "status": "ok", "via": "http" }, ... ]
 *   status: ok / no_image / timeout / error
 *
 * ── 为什么默认不开浏览器 ─────────────────────────────────────
 * 原来这个脚本每次都启动 Puppeteer 的 Chrome for Testing。后果有两个：
 *   1. 卡巴斯基会拦它（"Google Chrome for Testing 正在试图访问网络摄像头"），
 *      在屏幕上弹模态框——无人值守出刊时没人点，整期就卡在那儿；
 *   2. 屏幕上还会多出一个空白窗口。
 * 而 og:image 是给社交平台爬虫看的，**本来就写在静态 HTML 的 <head> 里**，
 * 一个普通 GET 就能拿到，不需要跑 JS。所以默认走 HTTP，只在明确要求时才开浏览器。
 * 真碰上必须渲染 JS 的站点，用 --auto（只对失败的那几条开浏览器）。
 * ────────────────────────────────────────────────────────────
 */

const HTTP_TIMEOUT_MS = 15000;
const MAX_HTML_BYTES = 800 * 1024;   // og:image 一定在 <head>，读前面这些就够
const BROWSER_TIMEOUT_MS = 20000;
const BROWSER_WAIT_MS = 6000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// 被 401/403/429 挡住时改用这个身份重试一次（详见 viaHttp 里的注释）
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function absolutize(src, pageUrl) {
  if (!src) return null;
  try {
    const u = new URL(src, pageUrl);
    return u.protocol === 'https:' ? u.href : null;   // 只要 https，http 图在页面里会被当混合内容拦掉
  } catch (err) {
    return null;
  }
}

// 兜底判断：不能是站点根地址、也不能是一看就不是图的东西
function looksLikeImage(u) {
  try {
    const p = new URL(u).pathname;
    if (!p || p === '/') return false;
    if (/\.(html?|php|aspx?)$/i.test(p)) return false;
    return true;
  } catch (err) {
    return false;
  }
}

function pickFromHtml(html, pageUrl) {
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i')) ||
              tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : null;
  };

  // 1) og:image / twitter:image（属性顺序不固定，所以逐个 meta 标签看）
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  const wanted = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image:src', 'twitter:image'];
  for (const key of wanted) {
    for (const tag of metas) {
      const prop = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
      if (prop !== key) continue;
      const v = absolutize(attr(tag, 'content'), pageUrl);
      if (v) return { image: v, how: key };
    }
  }

  // 2) <link rel="image_src">
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (/rel\s*=\s*["']?image_src/i.test(tag)) {
      const v = absolutize(attr(tag, 'href'), pageUrl);
      if (v) return { image: v, how: 'link[image_src]' };
    }
  }

  // 3) JSON-LD 里的 image
  //    只认 image / thumbnailUrl / primaryImageOfPage 这几个字段。
  //    不能见到 url 就拿——顶层 WebSite/Organization 对象的 url 是站点首页地址，
  //    拿了会得到一个根本不是图片的链接（archdaily 就会这样）。
  const asImageUrl = v => {
    if (!v) return null;
    if (typeof v === 'string') return absolutize(v, pageUrl);
    if (Array.isArray(v)) { for (const x of v) { const r = asImageUrl(x); if (r) return r; } return null; }
    if (typeof v === 'object') return absolutize(v.contentUrl || v.url, pageUrl);
    return null;
  };
  const findImage = node => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const x of node) { const r = findImage(x); if (r) return r; } return null; }
    for (const k of ['image', 'thumbnailUrl', 'primaryImageOfPage']) {
      if (node[k]) { const r = asImageUrl(node[k]); if (r) return r; }
    }
    if (node['@graph']) { const r = findImage(node['@graph']); if (r) return r; }
    return null;
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = findImage(JSON.parse(m[1].trim()));
      if (v && looksLikeImage(v)) return { image: v, how: 'json-ld' };
    } catch (err) { /* 这段 JSON-LD 坏了就跳过 */ }
  }

  // 4) 正文里第一张看起来够大的图
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
    const v = absolutize(src, pageUrl);
    if (!v) continue;
    if (/sprite|icon|logo|avatar|pixel|1x1|blank|placeholder/i.test(v)) continue;
    const w = parseInt(attr(tag, 'width') || '0', 10);
    if (w && w < 300) continue;
    return { image: v, how: 'img' };
  }

  return null;
}

async function viaHttp(url, ua = UA, retried = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    });
    if (!res.ok) {
      // 被反爬挡住时换社交平台爬虫的身份再试一次。
      // 这些站点**故意**放行 facebook/Twitter 的爬虫去读 og 标签——它们希望被分享时有图，
      // 而我们要的正是 og:image，身份和目的都对得上。
      if (!retried && [401, 403, 429].includes(res.status)) {
        clearTimeout(timer);
        return viaHttp(url, CRAWLER_UA, true);
      }
      return { url, image: null, status: res.status === 404 ? 'error' : 'blocked', via: 'http', error: 'HTTP ' + res.status };
    }

    // 只读前面一段，og:image 一定在 <head>
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.length;
    }
    try { await reader.cancel(); } catch (err) { /* 已读完就无所谓 */ }
    const html = Buffer.concat(chunks).toString('utf8');

    const hit = pickFromHtml(html, res.url || url);
    if (hit) return { url, image: hit.image, status: 'ok', via: 'http', how: hit.how };
    return { url, image: null, status: 'no_image', via: 'http' };
  } catch (err) {
    const timeout = err.name === 'AbortError';
    return { url, image: null, status: timeout ? 'timeout' : 'error', via: 'http', error: String(err.message).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

async function viaBrowser(urls) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (err) {
    return urls.map(url => ({ url, image: null, status: 'error', via: 'browser', error: '没装 puppeteer，先 npm install' }));
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      // 下面几条是为了不去碰摄像头/麦克风——否则杀毒软件会弹框拦截，
      // 无人值守时没人点，整期日报就卡死在那里
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--deny-permission-prompts',
      '--disable-features=MediaFoundationVideoCapture,WebRtcHideLocalIpsWithMdns',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-notifications',
    ],
  });

  const results = [];
  try {
    for (const url of urls) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(UA);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.setViewport({ width: 1200, height: 800 });
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const t = req.resourceType();
          if (t === 'font' || t === 'media') req.abort(); else req.continue();
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: BROWSER_TIMEOUT_MS });
        await new Promise(r => setTimeout(r, BROWSER_WAIT_MS));
        await page.evaluate(() => window.scrollTo(0, 800));
        await new Promise(r => setTimeout(r, 1000));

        const html = await page.content();
        const hit = pickFromHtml(html, page.url());
        results.push(hit
          ? { url, image: hit.image, status: 'ok', via: 'browser', how: hit.how }
          : { url, image: null, status: 'no_image', via: 'browser' });
      } catch (err) {
        const timeout = /timeout/i.test(err.message || '');
        results.push({ url, image: null, status: timeout ? 'timeout' : 'error', via: 'browser', error: String(err.message).slice(0, 120) });
      } finally {
        await page.close().catch(() => {});
      }
      console.error('[browser] ' + url);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceBrowser = argv.includes('--browser');
  const auto = argv.includes('--auto');
  const urls = argv.filter(a => a.startsWith('http'));

  if (!urls.length) {
    console.error('用法: node scripts/extract-images.js [--auto|--browser] <url1> [url2] ...');
    console.error('  默认只发 HTTP 请求，不启动浏览器（杀毒软件不会弹框，也不会有空白窗口）');
    process.exit(1);
  }

  let results;
  if (forceBrowser) {
    results = await viaBrowser(urls);
  } else {
    results = [];
    for (const url of urls) {
      const r = await viaHttp(url);
      console.error('[' + r.status + '] ' + (r.how ? r.how + ' ' : '') + url + ' → ' + (r.image || 'none'));
      results.push(r);
    }
    if (auto) {
      const failed = results.filter(r => r.status !== 'ok').map(r => r.url);
      if (failed.length) {
        console.error('--auto：' + failed.length + ' 条没抓到，改用浏览器重试（会启动 Chrome）');
        const retried = await viaBrowser(failed);
        results = results.map(r => (r.status === 'ok' ? r : retried.find(x => x.url === r.url) || r));
      }
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  console.error('—— 共 ' + results.length + ' 条，抓到 ' + ok + ' 张图');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('Fatal: ' + err.message);
  process.exit(1);
});
