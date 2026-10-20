#!/usr/bin/env node
/**
 * 用 jsdom 模拟三类站点页面，验证脚本的引擎识别、抽取、链接构造。
 * 不联网、不使用真实凭据（全部是假值）。
 *
 *   node test/run-tests.mjs
 */

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'pt-torrent-link-export.user.js'), 'utf8');

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/**
 * 在 jsdom 里跑脚本，返回页面对象。
 * @param {string} url
 * @param {string} html
 * @param {{fetchPages?: Record<string,string>}} opts
 */
function runScript(url, html, opts = {}) {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // 让 alert 不阻塞
  window.alert = (msg) => { window.__alert = msg; };

  // 模拟 fetch：按 URL 里的 page / perPage 返回预置页面
  window.fetch = async (u) => {
    const s = String(u);
    const key = Object.keys(opts.fetchPages || {}).find((k) => s.includes(k));
    const body = key ? opts.fetchPages[key] : '<html><body></body></html>';
    return { ok: true, status: 200, text: async () => body };
  };

  // 不提供 GM_*，走 fallback 分支（navigator.clipboard / 无缓存）
  window.eval(SCRIPT);

  return window;
}

function panelUrls(window) {
  const ta = window.document.querySelector('#ptle-panel textarea');
  if (!ta) return null;
  return ta.value.split('\n').filter(Boolean);
}

async function clickExport(window) {
  const btn = [...window.document.querySelectorAll('#ptle-controls button')]
    .find((b) => /导出/.test(b.textContent));
  if (!btn) throw new Error('找不到导出按钮');
  btn.click();
  // 等异步流程走完
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (window.document.getElementById('ptle-panel')) break;
  }
  return window.document.getElementById('ptle-panel');
}

/* ============================================================
 * 1. Gazelle (DICMusic 形态)
 * ============================================================ */

const AUTHKEY = 'a'.repeat(32);
const TPASS = 'b'.repeat(32);

const gazelleHtml = `<!doctype html><html><body>
<div id="nav_userinfo"><a href="user.php?id=8398">tester</a></div>
<div>RSS: <a href="torrents.php?action=download&id=1&authkey=${AUTHKEY}&torrent_pass=${TPASS}">rss</a></div>
<table>
  <tr id="torrent199223">
    <td><a href="torrents.php?id=55000">Some Album - 1993</a></td>
    <td><a href="torrents.php?action=download&id=199223&authkey=${AUTHKEY}&torrent_pass=${TPASS}">DL</a></td>
  </tr>
  <tr id="torrent199224">
    <td><a href="torrents.php?id=55001">Other Album</a></td>
    <td><a href="torrents.php?action=download&id=199224&authkey=${AUTHKEY}&torrent_pass=${TPASS}">DL</a></td>
  </tr>
</table>
<div class="pages"><a href="torrents.php?page=1">1</a><a href="torrents.php?page=2">2</a></div>
</body></html>`;

const gazellePage2 = `<html><body><table>
  <tr id="torrent199225">
    <td><a href="torrents.php?id=55002">Third Album</a></td>
    <td><a href="torrents.php?action=download&id=199225&authkey=${AUTHKEY}&torrent_pass=${TPASS}">DL</a></td>
  </tr>
</table></body></html>`;

{
  const w = runScript('https://dicmusic.com/torrents.php?type=seeding&userid=8398', gazelleHtml, {
    fetchPages: { 'page=2': gazellePage2 },
  });

  const ctrl = w.document.getElementById('ptle-controls');
  check('Gazelle: 控制条已注入', !!ctrl);
  check('Gazelle: 令牌勾选框默认勾选',
    ctrl && w.document.getElementById('ptle-use-token').checked);
  check('Gazelle: 全部页默认不勾选',
    ctrl && !w.document.getElementById('ptle-all-pages').checked);

  const btn = [...w.document.querySelectorAll('#ptle-controls button')].find((b) => /导出/.test(b.textContent));
  check('Gazelle: 按钮 title 含引擎名', btn && /Gazelle/.test(btn.title), btn && btn.title);

  // 只导当前页
  const panel = await clickExport(w);
  let urls = panelUrls(w);
  check('Gazelle: 导出成功', !!panel);
  check('Gazelle: 当前页 2 条', urls && urls.length === 2, urls && `got ${urls.length}`);
  check('Gazelle: URL 含 authkey', urls && urls.every((u) => u.includes(`authkey=${AUTHKEY}`)));
  check('Gazelle: URL 含 torrent_pass', urls && urls.every((u) => u.includes(`torrent_pass=${TPASS}`)));
  check('Gazelle: URL 含 usetoken=1（默认勾选）', urls && urls.every((u) => u.includes('usetoken=1')));
  check('Gazelle: 使用种子 id 而非组 id', urls && urls.some((u) => u.includes('id=199223')));
  check('Gazelle: 面板标题标出引擎', panel && /Gazelle/.test(panel.querySelector('.ptle-title').textContent));
}

/* ============================================================
 * 2. NexusPHP (PterClub 形态)
 * ============================================================ */

const PASSKEY = 'c'.repeat(32);

const nexusHtml = `<!doctype html><html><body>
<div id="info_block"><a href="userdetails.php?id=12345">nexususer</a></div>
<a href="torrents.php?passkey=${PASSKEY}">rss</a>
<table>
  <tr>
    <td><a href="details.php?id=900001">Nexus Release One</a></td>
    <td><a href="download.php?id=900001&passkey=${PASSKEY}">DL</a></td>
  </tr>
  <tr>
    <td><a href="details.php?id=900002">Nexus Release Two</a></td>
    <td><a href="download.php?id=900002&passkey=${PASSKEY}">DL</a></td>
  </tr>
</table>
<div class="pages"><a href="torrents.php?page=1">1</a><a href="torrents.php?page=3">3</a></div>
</body></html>`;

const nexusBig = `<html><body><table>
  <tr><td><a href="details.php?id=900001">One</a></td><td><a href="download.php?id=900001&passkey=${PASSKEY}">DL</a></td></tr>
  <tr><td><a href="details.php?id=900002">Two</a></td><td><a href="download.php?id=900002&passkey=${PASSKEY}">DL</a></td></tr>
  <tr><td><a href="details.php?id=900003">Three</a></td><td><a href="download.php?id=900003&passkey=${PASSKEY}">DL</a></td></tr>
</table></body></html>`;

{
  const w = runScript('https://pterclub.net/torrents.php?type=seeding', nexusHtml, {
    fetchPages: { 'torrentsperpage=1000': nexusBig },
  });

  const ctrl = w.document.getElementById('ptle-controls');
  const btn = [...w.document.querySelectorAll('#ptle-controls button')].find((b) => /导出/.test(b.textContent));
  check('NexusPHP: 识别为 NexusPHP', btn && /NexusPHP/.test(btn.title), btn && btn.title);

  w.document.getElementById('ptle-all-pages').checked = true;
  const panel = await clickExport(w);
  const urls = panelUrls(w);

  check('NexusPHP: 导出成功', !!panel);
  check('NexusPHP: 一页拉全拿到 3 条', urls && urls.length === 3, urls && `got ${urls.length}`);
  check('NexusPHP: URL 含 passkey', urls && urls.every((u) => u.includes(`passkey=${PASSKEY}`)));
  check('NexusPHP: URL 路径为 download.php', urls && urls.every((u) => u.includes('/download.php')));
  check('NexusPHP: 含 usetoken=1', urls && urls.every((u) => u.includes('usetoken=1')));
}

/* ============================================================
 * 3. UNIT3D / BHD 形态
 * ============================================================ */

// BHD 的 rsskey 是大小写混合字母数字，不是十六进制
const RSSKEY = 'AbCdEfGh12345678XyZ';
const HEX_RSSKEY = 'd'.repeat(32);

const unitHtml = `<!doctype html><html><body>
<div class="username">unituser</div>
<a href="/rss/${HEX_RSSKEY}">rss</a>
<table>
  <tr wire:key="torrent-7001">
    <td><a href="/torrents/7001">Unit Release One</a></td>
    <td><a href="/torrent/download/auto.7001.${HEX_RSSKEY}">DL</a></td>
  </tr>
  <tr wire:key="torrent-7002">
    <td><a href="/torrents/7002">Unit Release Two</a></td>
    <td><a href="/torrent/download/auto.7002.${HEX_RSSKEY}">DL</a></td>
  </tr>
</table>
</body></html>`;

{
  const w = runScript('https://beyond-hd.me/torrents', unitHtml);
  const btn = [...w.document.querySelectorAll('#ptle-controls button')].find((b) => /导出/.test(b.textContent));
  check('UNIT3D: 识别为 UNIT3D', btn && /UNIT3D/.test(btn.title), btn && btn.title);

  const tokenChk = w.document.getElementById('ptle-use-token');
  check('UNIT3D: 令牌勾选框被禁用', tokenChk && tokenChk.disabled);

  const panel = await clickExport(w);
  const urls = panelUrls(w);

  check('UNIT3D: 导出成功', !!panel);
  check('UNIT3D: 2 条', urls && urls.length === 2, urls && `got ${urls.length}`);
  check('UNIT3D: 路径含 auto.<id>.<rsskey>',
    urls && urls.every((u) => /\/torrent\/download\/auto\.\d+\.[a-f0-9]+$/.test(u)), urls && urls[0]);
  check('UNIT3D: 不含 usetoken', urls && urls.every((u) => !u.includes('usetoken')));
}

/* 3b. BHD 真实形态：rsskey 大小写混合，列表页只有详情链接 + 勾选框 */
{
  const bhdHtml = `<!doctype html><html><body>
<div class="username">bhduser</div>
<a href="/rss/${RSSKEY}">RSS</a>
<table>
  <tr data-torrent-id="880001">
    <td><a href="/torrent/880001">BHD Release One</a></td>
    <td><input type="checkbox" value="880001"></td>
  </tr>
  <tr data-torrent-id="880002">
    <td><a href="/torrent/880002">BHD Release Two</a></td>
    <td><input type="checkbox" value="880002"></td>
  </tr>
</table>
</body></html>`;

  const w = runScript('https://beyond-hd.me/torrents', bhdHtml);
  const panel = await clickExport(w);
  const urls = panelUrls(w);

  check('BHD: 导出成功', !!panel);
  check('BHD: 2 条', urls && urls.length === 2, urls && `got ${urls && urls.length}`);
  check('BHD: 大小写混合 rsskey 被正确提取',
    urls && urls.every((u) => u.endsWith(`.${RSSKEY}`)), urls && urls[0]);
  check('BHD: 路径形如 auto.<id>.<rsskey>',
    urls && urls.every((u) => /\/torrent\/download\/auto\.\d+\.[A-Za-z0-9]+$/.test(u)), urls && urls[0]);
}

/* 3c. 列表页不含 rsskey 时，应从 /rss 页面补全 */
{
  const listHtml = `<!doctype html><html><body>
<div class="username">bhduser</div>
<table>
  <tr data-torrent-id="880003"><td><a href="/torrent/880003">No Key Here</a></td></tr>
</table>
</body></html>`;
  const rssPage = `<html><body><a href="/rss/${RSSKEY}">rss</a></body></html>`;

  const w = runScript('https://beyond-hd.me/torrents', listHtml, {
    fetchPages: { '/rss': rssPage },
  });
  const panel = await clickExport(w);
  const urls = panelUrls(w);

  check('BHD: 缺 rsskey 时从 /rss 补全', urls && urls[0] && urls[0].endsWith(`.${RSSKEY}`), urls && urls[0]);
}

/* ============================================================
 * 4. 兜底：页面只有勾选框，没有逐行下载链接
 * ============================================================ */

const checkboxHtml = `<!doctype html><html><body>
<a href="torrents.php?action=download&id=1&authkey=${AUTHKEY}&torrent_pass=${TPASS}">rss</a>
<table>
  <tr><td><a href="torrents.php?id=1">A</a></td><td><input type="checkbox" name="torrents[]" value="800001"></td></tr>
  <tr><td><a href="torrents.php?id=2">B</a></td><td><input type="checkbox" name="torrents[]" value="800002"></td></tr>
</table></body></html>`;

{
  const w = runScript('https://dicmusic.com/torrents.php?type=seeding', checkboxHtml);
  const panel = await clickExport(w);
  const urls = panelUrls(w);
  check('兜底: 勾选框路径能抽出 id', urls && urls.length === 2, urls && `got ${urls && urls.length}`);
  check('兜底: 构造出的 URL 正确', urls && urls.every((u) => /id=\d+/.test(u) && u.includes(AUTHKEY)));
}

/* ============================================================
 * 5. 无凭据时应提示而不是崩溃
 * ============================================================ */

{
  const w = runScript('https://dicmusic.com/torrents.php', '<html><body><table></table></body></html>');
  const btn = [...w.document.querySelectorAll('#ptle-controls button')].find((b) => /导出/.test(b.textContent));
  btn.click();
  await new Promise((r) => setTimeout(r, 300));
  check('空页面: 弹出诊断而不是崩溃', /没找到种子/.test(w.__alert || ''), w.__alert);
}

/* ============================================================
 * 6. 安全：脚本内不得出现真实凭据格式的硬编码
 * ============================================================ */

{
  const leaks = [];
  // 32+ 位十六进制且看起来像密钥的（排除 CSS 里的颜色、版本号）
  const re = /\b[a-f0-9]{32,}\b/gi;
  let m;
  while ((m = re.exec(SCRIPT))) {
    const s = m[0];
    // 允许的例外：颜色值 / 明显重复字符（测试用的占位符不在脚本里）
    if (/^(?:[0-9a-f]{6})$/.test(s)) continue;
    leaks.push(s);
  }
  check('安全: 脚本内无硬编码密钥', leaks.length === 0, leaks.slice(0, 3).join(', '));
}

/* ============================================================
 * 输出
 * ============================================================ */

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
