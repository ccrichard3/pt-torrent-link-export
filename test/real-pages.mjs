#!/usr/bin/env node
/**
 * 用真实保存的页面 HTML 验证脚本。凭据会从页面里被读出来，
 * 所以本脚本只打印打码后的 URL，且不联网。
 *
 *   node test/real-pages.mjs /tmp/ptle-analysis
 */

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'pt-torrent-link-export.user.js'), 'utf8');
const DIR = process.argv[2] || '/tmp/ptle-analysis';

const FILES = [
  { file: 'Browse Torrents __ HappyFappy.html', url: 'https://www.happyfappy.net/torrents.php', expect: 'gazelle' },
  { file: 'Torrents _ BeyondHD.html', url: 'https://beyond-hd.me/torrents', expect: 'unit3d' },
  { file: 'Torrents - ClearJav.html', url: 'https://clearjav.com/torrents', expect: 'unit3d' },
  { file: '资源 - BitPorn.html', url: 'https://bitporn.eu/torrents', expect: 'unit3d' },
];

const mask = (u) => u.replace(
  /(authkey|torrent_pass|passkey|rsskey)=([A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/gi,
  (m, k, p) => `${k}=${p}…`
);

function run(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.alert = (m) => { window.__alert = m; };
  window.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
  window.eval(SCRIPT);
  return window;
}

function readUrls(window) {
  const ta = window.document.querySelector('#ptle-panel textarea');
  return ta ? ta.value.split('\n').filter(Boolean) : null;
}

async function exportAll(window, { allPages = false } = {}) {
  const btn = [...window.document.querySelectorAll('#ptle-controls button')]
    .find((b) => /导出/.test(b.textContent));
  if (!btn) throw new Error('无导出按钮');
  const cb = window.document.getElementById('ptle-all-pages');
  if (cb) cb.checked = allPages;
  btn.click();
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if (window.document.getElementById('ptle-panel')) break;
  }
  return readUrls(window);
}

let bad = 0;

for (const spec of FILES) {
  const p = path.join(DIR, spec.file);
  if (!fs.existsSync(p)) { console.log(`SKIP ${spec.file} (not found)`); continue; }

  const html = fs.readFileSync(p, 'utf8');
  const window = run(html, spec.url);
  const doc = window.document;

  const btn = [...doc.querySelectorAll('#ptle-controls button')].find((b) => /导出/.test(b.textContent));
  const engineLabel = btn ? (/引擎：(\S+)/.exec(btn.title) || [])[1] : null;
  const rowCount = doc.querySelectorAll('tr[data-torrent-id], tr[wire\\:key], tr[id^="torrentposter"], tr[id^="torrent"]').length;

  let urls = [];
  try { urls = await exportAll(window) || []; } catch (e) { console.log('  ERR', e.message); }

  const uniq = [...new Set(urls)];
  const withCred = uniq.filter((u) => /(authkey|torrent_pass|passkey|rsskey)=[A-Za-z0-9_-]{16,}/.test(u));
  const malformed = uniq.filter((u) => /\.$|id=undefined|auto\.\d+\.$/.test(u));

  console.log('='.repeat(72));
  console.log(spec.file);
  console.log(`  引擎识别: ${engineLabel}  (期望 ${spec.expect})`);
  console.log(`  行元素:   ${rowCount}`);
  console.log(`  导出条数: ${uniq.length}`);
  console.log(`  含凭据:   ${withCred.length}`);
  console.log(`  畸形链接: ${malformed.length}`);
  if (uniq[0]) console.log(`  样例:     ${mask(uniq[0]).slice(0, 120)}`);
  if (uniq[1]) console.log(`  样例2:    ${mask(uniq[1]).slice(0, 120)}`);
  if (window.__alert) console.log(`  弹窗:     ${String(window.__alert).split('\n')[0]}`);

  const okEngine = engineLabel && spec.expect.toLowerCase() === String(engineLabel).toLowerCase();
  const okCount = uniq.length >= Math.min(rowCount, 20);
  const okShape = malformed.length === 0;
  if (!okEngine || !okCount || !okShape) {
    bad++;
    console.log(`  → FAIL${!okEngine ? ' [引擎]' : ''}${!okCount ? ' [条数]' : ''}${!okShape ? ' [畸形]' : ''}`);
  } else {
    console.log('  → PASS');
  }
}

console.log('='.repeat(72));
console.log(bad ? `${bad} 个站点有问题` : '全部通过');
process.exit(bad ? 1 : 0);
