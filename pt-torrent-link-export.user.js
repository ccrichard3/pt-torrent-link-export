// ==UserScript==
// @name         PT 种子直链导出 (Gazelle / NexusPHP / UNIT3D)
// @namespace    local.pt.torrent-link-export
// @version      1.0.1
// @description  在 PT 站列表/做种页一键导出带凭据的种子直链，支持多引擎自动识别、分页抓取、可选免费令牌
// @author       ccrichard3
// @license      MIT
// @match        *://*.dicmusic.com/*
// @match        *://dicmusic.com/*
// @match        *://*.redacted.sh/*
// @match        *://redacted.sh/*
// @match        *://*.redacted.ch/*
// @match        *://redacted.ch/*
// @match        *://*.orpheus.network/*
// @match        *://orpheus.network/*
// @match        *://*.gazellegames.net/*
// @match        *://gazellegames.net/*
// @match        *://*.jpopsuki.eu/*
// @match        *://jpopsuki.eu/*
// @match        *://*.animebytes.tv/*
// @match        *://*.passthepopcorn.me/*
// @match        *://*.bibliotik.me/*
// @match        *://*.pterclub.net/*
// @match        *://pterclub.net/*
// @match        *://*.hdsky.me/*
// @match        *://hdsky.me/*
// @match        *://*.hdsky.my/*
// @match        *://hdsky.my/*
// @match        *://*.ourbits.club/*
// @match        *://ourbits.club/*
// @match        *://*.hhanclub.net/*
// @match        *://hhanclub.net/*
// @match        *://*.ubits.club/*
// @match        *://ubits.club/*
// @match        *://*.u2.dmhy.org/*
// @match        *://u2.dmhy.org/*
// @match        *://*.gamegamept.com/*
// @match        *://gamegamept.com/*
// @match        *://*.piggo.me/*
// @match        *://piggo.me/*
// @match        *://*.hddolby.com/*
// @match        *://hddolby.com/*
// @match        *://*.hdchina.org/*
// @match        *://*.hdhome.org/*
// @match        *://*.tjupt.org/*
// @match        *://*.byr.pt/*
// @match        *://*.open.cd/*
// @match        *://*.hdarea.co/*
// @match        *://*.hdfans.org/*
// @match        *://*.ptsbao.club/*
// @match        *://*.haidan.cc/*
// @match        *://*.discfan.net/*
// @match        *://*.joyhd.net/*
// @match        *://*.hdtime.org/*
// @match        *://*.1ptba.com/*
// @match        *://*.skyeysnow.com/*
// @match        *://*.ptchina.org/*
// @match        *://*.hdatmos.club/*
// @match        *://*.hddolby.com/*
// @match        *://*.xingtan.org/*
// @match        *://*.moecat.best/*
// @match        *://*.azusa.wiki/*
// @match        *://*.sharkpt.net/*
// @match        *://*.pthome.net/*
// @match        *://*.keepfrds.com/*
// @match        *://*.tccf.club/*
// @match        *://*.beyond-hd.me/*
// @match        *://beyond-hd.me/*
// @match        *://*.blutopia.cc/*
// @match        *://*.aither.cc/*
// @match        *://*.lst.gg/*
// @match        *://*.seedpool.org/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 支持三类引擎，运行时按页面内容自动识别，不依赖域名：
 *
 *   Gazelle   下载地址 = torrents.php?action=download&id=<id>&authkey=<hex>&torrent_pass=<hex>
 *             DICMusic / RED / OPS / GGn / JPopsuki / AB / PTP ...
 *   NexusPHP  下载地址 = download.php?id=<id>&passkey=<hex>
 *             PterClub / HDSky / OurBits / HHanClub / UBits / U2 / GameGamePT ...
 *   UNIT3D    下载地址 = /torrent/download/auto.<id>.<rsskey>
 *             BeyondHD / Bluteopia / Aither / LST / SeedPool ...
 *
 * 凭据来源：运行时从当前页面 HTML 读取，脚本本身不含任何密钥。
 * 凭据缓存按「站点 + 账号」隔离，换号不会串用。
 */

(function () {
  'use strict';

  /* ============================================================
   * 配置
   * ============================================================ */

  const CFG = {
    delayMs: 450,          // 分页抓取间隔（毫秒），别把站打死
    maxPages: 200,         // 分页安全上限
    zIndex: 2147483000,
    cachePrefix: 'ptle::',
  };

  /* 每个引擎的差异点。autoDetect 会先匹配，失败才用域名提示。 */
  const ENGINES = {
    gazelle: {
      label: 'Gazelle',
      credKeys: ['authkey', 'torrent_pass'],
      tokenParam: 'usetoken',
      perPageParam: null,           // Gazelle 每页条数是用户设置，URL 改不了
      isDownloadUrl(u) {
        return /\/torrents\.php$/.test(u.pathname) &&
               u.searchParams.get('action') === 'download' &&
               /^\d+$/.test(u.searchParams.get('id') || '');
      },
      buildBase() {
        const u = new URL('/torrents.php', location.origin);
        u.searchParams.set('action', 'download');
        return u;
      },
      // 凭据与令牌全部放 query string
      compose(u, id, sec, useToken, tokenParam) {
        u.searchParams.set('id', String(id));
        for (const k of ['authkey', 'torrent_pass']) {
          if (sec[k]) u.searchParams.set(k, sec[k]);
        }
        if (useToken && tokenParam) u.searchParams.set(tokenParam, '1');
        return u;
      },
      rowSelector: 'tr[id^="torrent"]',
      rowIdOf(tr) {
        const m = /^torrent(\d+)$/.exec(tr.id || '');
        return m ? m[1] : null;
      },
      rowNameOf(tr) {
        const g = tr.querySelector('a[href*="torrents.php?id="]');
        return g ? g.textContent.trim().replace(/\s+/g, ' ') : '';
      },
      secretRe: {
        authkey: /authkey=([a-f0-9]{16,64})/i,
        torrent_pass: /torrent_pass=([a-f0-9]{16,64})/i,
      },
      // RSS 链接也长成 action=download&id=N，必须要求锚点在列表行内，否则会混进假种子
      requireRowContext: true,
    },

    nexusphp: {
      label: 'NexusPHP',
      credKeys: ['passkey'],
      tokenParam: 'usetoken',
      perPageParam: 'torrentsperpage',
      perPageValue: '1000',
      isDownloadUrl(u) {
        return /\/download\.php$/.test(u.pathname) &&
               /^\d+$/.test(u.searchParams.get('id') || '');
      },
      buildBase() {
        return new URL('/download.php', location.origin);
      },
      // 凭据与令牌全部放 query string
      compose(u, id, sec, useToken, tokenParam) {
        u.searchParams.set('id', String(id));
        if (sec.passkey) u.searchParams.set('passkey', sec.passkey);
        if (useToken && tokenParam) u.searchParams.set(tokenParam, '1');
        return u;
      },
      rowSelector: 'tr',
      rowIdOf(tr) {
        // NexusPHP 行的下载链接就在行内
        const a = tr.querySelector('a[href*="download.php"]');
        if (!a) return null;
        try {
          const m = new URL(a.getAttribute('href'), location.href).searchParams.get('id');
          return /^\d+$/.test(m || '') ? m : null;
        } catch { return null; }
      },
      rowNameOf(tr) {
        const d = tr.querySelector('a[href*="details.php?id="]');
        if (d) return d.textContent.trim().replace(/\s+/g, ' ');
        const s = tr.querySelector('a[href*="details.php"], strong, b');
        return s ? s.textContent.trim().replace(/\s+/g, ' ') : '';
      },
      secretRe: {
        passkey: /passkey=([a-f0-9]{16,64})/i,
      },
      // download.php?id=N 也会出现在 RSS / 导航栏，只认行内的
      requireRowContext: true,
    },

    unit3d: {
      label: 'UNIT3D',
      credKeys: ['rsskey'],
      tokenParam: null,              // UNIT3D 的免费令牌走 POST，不支持 URL 参数
      perPageParam: 'perPage',
      perPageValue: '100',
      isDownloadUrl(u) {
        // /torrent/download/auto.<id>.<rsskey>（BHD）
        // /torrents/download/<id>（标准 UNIT3D）
        return /\/torrents?\/download\//.test(u.pathname);
      },
      buildBase() {
        return new URL('/torrent/download/', location.origin);
      },
      // rsskey 在路径里：/torrent/download/auto.<id>.<rsskey>
      compose(u, id, sec, useToken, tokenParam) {
        u.pathname = `/torrent/download/auto.${id}.${sec.rsskey || ''}`;
        if (useToken && tokenParam) u.searchParams.set(tokenParam, '1');
        return u;
      },
      // BHD 是 Laravel 自建站，行不一定是 tr；Livewire 站用 [wire:key]
      rowSelector: 'tr, [wire\\:key], [data-torrent-id]',
      rowIdOf(tr) {
        const direct = tr.getAttribute && tr.getAttribute('data-torrent-id');
        if (/^\d+$/.test(direct || '')) return direct;

        const a = tr.querySelector(
          'a[href*="/torrent/download/"], a[href*="/torrents/download/"], ' +
          'a[href*="/torrent/"], a[href*="/torrents/"]'
        );
        if (a) {
          const href = a.getAttribute('href') || '';
          // 下载链接：取 auto.<id> 或路径末尾的数字段
          const dl = /download\/(?:auto\.)?(\d+)/.exec(href);
          if (dl) return dl[1];
          const det = /\/(?:torrent|torrents)\/(\d+)(?:[/?#]|$)/.exec(href);
          if (det) return det[1];
        }

        const cb = tr.querySelector('input[type="checkbox"][value]');
        if (cb && /^\d+$/.test(cb.value)) return cb.value;
        return null;
      },
      rowNameOf(tr) {
        const a = tr.querySelector('a[href*="/torrent/"], a[href*="/torrents/"]');
        if (a) return a.textContent.trim().replace(/\s+/g, ' ');
        const t = tr.querySelector('.torrent-name, .name, strong');
        return t ? t.textContent.trim().replace(/\s+/g, ' ') : '';
      },
      secretRe: {
        // BHD 的 rsskey 是大小写混合的字母数字，不能限定十六进制
        rsskey: /(?:rsskey[=:\/]|rss\/)([A-Za-z0-9_-]{16,128})/i,
      },
      requireRowContext: false,
    },
  };

  /* 已知域名 → 引擎。仅作提示，识别仍以页面内容为准。 */
  const DOMAIN_HINTS = {
    'dicmusic.com': 'gazelle',
    'redacted.sh': 'gazelle',
    'redacted.ch': 'gazelle',
    'orpheus.network': 'gazelle',
    'gazellegames.net': 'gazelle',
    'jpopsuki.eu': 'gazelle',
    'animebytes.tv': 'gazelle',
    'passthepopcorn.me': 'gazelle',
    'bibliotik.me': 'gazelle',
    'beyond-hd.me': 'unit3d',
    'blutopia.cc': 'unit3d',
    'aither.cc': 'unit3d',
    'lst.gg': 'unit3d',
    'seedpool.org': 'unit3d',
    'pterclub.net': 'nexusphp',
    'hdsky.me': 'nexusphp',
    'hdsky.my': 'nexusphp',
    'ourbits.club': 'nexusphp',
    'hhanclub.net': 'nexusphp',
    'ubits.club': 'nexusphp',
    'u2.dmhy.org': 'nexusphp',
    'gamegamept.com': 'nexusphp',
    'piggo.me': 'nexusphp',
    'hddolby.com': 'nexusphp',
  };

  /* 站点级覆盖：某些站的令牌参数名不同 */
  const SITE_OVERRIDES = {
    // 'example.com': { tokenParam: 'freeleech' },
  };

  /* ============================================================
   * 引擎识别
   * ============================================================ */

  function htmlText() {
    return document.documentElement ? document.documentElement.innerHTML : '';
  }

  function readSecretsByEngine(engine, html) {
    const out = {};
    for (const [k, re] of Object.entries(engine.secretRe)) {
      const m = html.match(re);
      out[k] = m ? m[1] : null;
    }
    return out;
  }

  function hasAnySecret(sec) {
    return Object.values(sec).some(Boolean);
  }

  function detectEngine() {
    const html = htmlText();
    const host = location.hostname.replace(/^www\./, '');
    const hint = DOMAIN_HINTS[host];

    // 1) 页面内容优先：哪个引擎的凭据能在页面里找到就用哪个
    const candidates = [];
    for (const [key, engine] of Object.entries(ENGINES)) {
      const sec = readSecretsByEngine(engine, html);
      if (hasAnySecret(sec)) candidates.push({ key, engine, sec, score: 1 });
    }

    // 2) 页面里没有任何凭据时，用真实下载链接的形状判断
    if (!candidates.length) {
      for (const [key, engine] of Object.entries(ENGINES)) {
        const found = [...document.querySelectorAll('a[href]')].some((a) => {
          try { return engine.isDownloadUrl(new URL(a.getAttribute('href'), location.href)); }
          catch { return false; }
        });
        if (found) candidates.push({ key, engine, sec: {}, score: 1 });
      }
    }

    if (candidates.length) {
      // 域名提示命中则优先，否则取第一个
      const hit = hint && candidates.find((c) => c.key === hint);
      return hit || candidates[0];
    }

    if (hint) return { key: hint, engine: ENGINES[hint], sec: {} };
    return { key: null, engine: null, sec: {} };
  }

  /* ============================================================
   * 凭据获取与缓存
   * ============================================================ */

  function detectAccount() {
    const sels = [
      '#nav_userinfo a[href*="user.php?id="]',
      '#nav_usermenu a[href*="user.php?id="]',
      '#header a[href*="user.php?id="]',
      'a[href*="userdetails.php?id="]',
      'a[href*="user.php?id="]',
      '.username',
    ];
    for (const s of sels) {
      const a = document.querySelector(s);
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      const m = /(?:user|userdetails)\.php\?id=(\d+)/.exec(href);
      const name = (a.textContent || '').trim();
      if (m || name) return { id: m ? m[1] : '', name };
    }
    return { id: '', name: '' };
  }

  function credScope(engineKey, accountId) {
    return `${CFG.cachePrefix}${location.hostname}::${engineKey}::${accountId || 'unknown'}::`;
  }

  function getCredentials(engineKey, engine) {
    const account = detectAccount();
    const pageSec = readSecretsByEngine(engine, htmlText());
    const scope = credScope(engineKey, account.id);
    const hasGM = typeof GM_getValue === 'function';

    const sec = {};
    let fromCache = false;

    for (const k of engine.credKeys) {
      const pageVal = pageSec[k];
      const cacheVal = hasGM ? (GM_getValue(scope + k, '') || '') : '';
      sec[k] = pageVal || cacheVal || '';
      if (!pageVal && cacheVal) fromCache = true;
      if (pageVal && typeof GM_setValue === 'function') GM_setValue(scope + k, pageVal);
    }

    return {
      ...account,
      sec,
      source: hasAnySecret(pageSec) ? 'page' : (fromCache ? 'cache' : 'none'),
    };
  }

  /* 页面和缓存里都拿不到凭据时，去站内几个已知位置捞一次。
   * BHD 的列表页不渲染 rsskey，只在 RSS / 设置页里出现。 */
  const CRED_PATHS = {
    unit3d: ['/rss', '/user/settings', '/settings', '/users/settings'],
    nexusphp: ['/getrss.php', '/usercp.php?action=personal', '/torrents.php?type=seeding'],
    gazelle: ['/torrents.php?action=download&id=1', '/user.php?action=rss', '/usercp.php?action=personal'],
  };

  async function discoverCredentials(engineKey, engine, sec) {
    const missing = engine.credKeys.filter((k) => !sec[k]);
    if (!missing.length) return sec;

    const paths = CRED_PATHS[engineKey] || [];
    for (const p of paths) {
      try {
        const r = await fetch(p, { credentials: 'include' });
        if (!r.ok) continue;
        const found = readSecretsByEngine(engine, await r.text());
        for (const k of missing) {
          if (found[k] && !sec[k]) {
            sec[k] = found[k];
            const account = detectAccount();
            if (typeof GM_setValue === 'function') {
              GM_setValue(credScope(engineKey, account.id) + k, found[k]);
            }
            console.info(`[PTLE] ${k} 从 ${p} 补全`);
          }
        }
        if (engine.credKeys.every((k) => sec[k])) break;
      } catch (e) {
        console.warn('[PTLE] 探测', p, '失败', e);
      }
    }
    return sec;
  }

  /* ============================================================
   * 链接构造
   * ============================================================ */

  function overrideFor(engineKey) {
    const host = location.hostname.replace(/^www\./, '');
    return SITE_OVERRIDES[host] || {};
  }

  function resolveTokenParam(engineKey, engine) {
    const ov = overrideFor(engineKey);
    return ov.tokenParam !== undefined ? ov.tokenParam : engine.tokenParam;
  }

  function buildUrl(engineKey, engine, id, sec, useToken) {
    const tokenParam = resolveTokenParam(engineKey, engine);
    return engine.compose(engine.buildBase(), id, sec, useToken, tokenParam).href;
  }

  /* ============================================================
   * 页面抽取
   * ============================================================ */

  function extractFromDoc(doc, base, engineKey, engine, sec) {
    const found = new Map();
    const put = (id, name) => {
      if (!/^\d+$/.test(String(id))) return;
      const prev = found.get(String(id));
      if (prev === undefined || (!prev && name)) found.set(String(id), name || '');
    };

    // 路径 A：页面里已有的真实下载链接（保留站方原始参数，最稳）
    doc.querySelectorAll('a[href]').forEach((a) => {
      let u;
      try { u = new URL(a.getAttribute('href'), base); } catch { return; }
      if (!engine.isDownloadUrl(u)) return;

      const tr = a.closest('tr') || a.closest('[wire\\:key]');
      // 列表页的 RSS / 导航里也有同形状链接，没有行上下文的一律丢弃
      if (engine.requireRowContext && !tr) return;

      let id = null;
      if (engineKey === 'gazelle') id = u.searchParams.get('id');
      else if (engineKey === 'nexusphp') id = u.searchParams.get('id');
      else {
        const m = /(?:auto\.)?(\d+)(?:\.|$|\/)/.exec(u.pathname.split('/').pop() || '');
        id = m ? m[1] : null;
      }
      if (!/^\d+$/.test(id || '')) return;

      put(id, tr ? engine.rowNameOf(tr) : '');
    });

    // 路径 B：行元素本身带 id（Gazelle 的 tr[id="torrentNNN"]）
    if (!found.size) {
      doc.querySelectorAll(engine.rowSelector).forEach((tr) => {
        const id = engine.rowIdOf(tr);
        if (id) put(id, engine.rowNameOf(tr));
      });
    }

    // 路径 C：批量下载勾选框
    if (!found.size) {
      doc.querySelectorAll('input[type="checkbox"][name^="torrents"], input[type="checkbox"][value]').forEach((c) => {
        if (/^\d+$/.test(c.value || '')) {
          const tr = c.closest('tr') || c.closest('[wire\\:key]');
          put(c.value, tr ? engine.rowNameOf(tr) : '');
        }
      });
    }

    return [...found.entries()].map(([id, name]) => ({ id, name }));
  }

  function maxPageOf(doc, base) {
    let max = 1;
    doc.querySelectorAll('a[href*="page="]').forEach((a) => {
      let u;
      try { u = new URL(a.getAttribute('href'), base); } catch { return; }
      const p = parseInt(u.searchParams.get('page'), 10);
      if (Number.isFinite(p) && p > max) max = p;
    });
    return Math.min(max, CFG.maxPages);
  }

  /* ============================================================
   * 采集
   * ============================================================ */

  async function collectAll(ctx, opts, onProgress) {
    const { engineKey, engine, creds } = ctx;
    const seen = new Map();
    const add = (items) => {
      for (const it of items) {
        if (!seen.has(it.id)) seen.set(it.id, it);
        else if (!seen.get(it.id).name && it.name) seen.get(it.id).name = it.name;
      }
    };

    add(extractFromDoc(document, location.href, engineKey, engine, creds.sec));

    if (opts.allPages) {
      // 先试「一页拉全」
      const ov = overrideFor(engineKey);
      const perPageParam = ov.perPageParam !== undefined ? ov.perPageParam : engine.perPageParam;
      const perPageValue = ov.perPageValue !== undefined ? ov.perPageValue : engine.perPageValue;

      let maxPage = maxPageOf(document, location.href);
      let done = false;

      if (perPageParam) {
        try {
          const u = new URL(location.href);
          u.searchParams.set(perPageParam, perPageValue);
          u.searchParams.delete('page');
          const r = await fetch(u.href, { credentials: 'include' });
          if (r.ok) {
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            const items = extractFromDoc(doc, u.href, engineKey, engine, creds.sec);
            if (items.length > seen.size) {
              add(items);
              const mp = maxPageOf(doc, u.href);
              if (mp <= 1) {
                onProgress(`单页模式：${seen.size} 条`);
                done = true;
              } else {
                maxPage = Math.max(maxPage, mp);
              }
            }
          }
        } catch (e) {
          console.warn('[PTLE] 单页试探失败', e);
        }
      }

      if (!done) {
        for (let p = 1; p <= maxPage; p++) {
          onProgress(`抓取第 ${p}/${maxPage} 页…`);
          const u = new URL(location.href);
          u.searchParams.set('page', String(p));
          try {
            const r = await fetch(u.href, { credentials: 'include' });
            if (!r.ok) { console.warn('[PTLE] 第', p, '页 HTTP', r.status); continue; }
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            add(extractFromDoc(doc, u.href, engineKey, engine, creds.sec));
          } catch (e) {
            console.warn('[PTLE] 第', p, '页失败', e);
          }
          await new Promise((res) => setTimeout(res, CFG.delayMs));
        }
      }
    }

    const items = [...seen.values()].map((it) => ({
      ...it,
      url: buildUrl(engineKey, engine, it.id, creds.sec, opts.useToken),
    }));

    return { items, creds };
  }

  /* ============================================================
   * 拖动
   * ============================================================ */

  function makeDraggable(el, handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,input,textarea,select,a,label')) return;
      const r = el.getBoundingClientRect();
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = el.getBoundingClientRect();
      const nx = Math.max(0, Math.min(ox + e.clientX - sx, innerWidth - r.width));
      const ny = Math.max(0, Math.min(oy + e.clientY - sy, innerHeight - 48));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    });

    const stop = () => { dragging = false; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
  }

  /* ============================================================
   * 样式
   * ============================================================ */

  const STYLE_ID = 'ptle-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const css = `
#ptle-panel, #ptle-controls {
  --ptle-panel: #f7f8fa;
  --ptle-text: #1f2328;
  --ptle-border: #d8dce3;
  --ptle-input-bg: #ffffff;
  --ptle-input-text: #1f2328;
  --ptle-accent: #2f6fed;
  --ptle-accent-text: #ffffff;
  --ptle-btn: #eceff4;
  --ptle-btn-text: #1f2328;
  --ptle-note-bg: #f0f4fb;
  --ptle-note-text: #2a4a7f;
  --ptle-sel-bg: #cfe0ff;
  --ptle-sel-text: #10203a;
  --ptle-shadow: 0 8px 30px rgba(20, 30, 50, .18);
  --ptle-grip: #9aa3ad;

  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ptle-text);
  background: var(--ptle-panel);
  border: 1px solid var(--ptle-border);
  border-radius: 10px;
  box-shadow: var(--ptle-shadow);
  text-shadow: none;
  letter-spacing: normal;
}

@media (prefers-color-scheme: dark) {
  #ptle-panel, #ptle-controls {
    --ptle-panel: #23262c;
    --ptle-text: #e3e6ea;
    --ptle-border: #3a3f48;
    --ptle-input-bg: #15171b;
    --ptle-input-text: #dfe3e8;
    --ptle-accent: #5b8def;
    --ptle-accent-text: #ffffff;
    --ptle-btn: #2e333b;
    --ptle-btn-text: #e3e6ea;
    --ptle-note-bg: #1c2530;
    --ptle-note-text: #9dc0f0;
    --ptle-sel-bg: #3d5a8a;
    --ptle-sel-text: #ffffff;
    --ptle-shadow: 0 8px 30px rgba(0, 0, 0, .55);
    --ptle-grip: #7c8591;
  }
}

#ptle-panel { position: fixed; z-index: ${CFG.zIndex}; right: 16px; bottom: 72px;
  width: min(780px, 92vw); max-height: 80vh; overflow: auto; padding: 0 12px 12px; }

#ptle-panel .ptle-head { display: flex; align-items: center; gap: 12px;
  padding: 10px 0 8px; position: sticky; top: 0; background: var(--ptle-panel);
  border-bottom: 1px solid var(--ptle-border); cursor: move; touch-action: none;
  user-select: none; }
#ptle-panel .ptle-title { flex: 1; font-weight: 600; font-size: 13px; }

#ptle-panel textarea {
  display: block; width: 100%; box-sizing: border-box; height: 280px;
  margin-top: 8px; padding: 8px 10px;
  background: var(--ptle-input-bg) !important;
  color: var(--ptle-input-text) !important;
  border: 1px solid var(--ptle-border); border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.65; font-weight: 400; font-style: normal;
  letter-spacing: normal; word-spacing: normal; text-indent: 0;
  text-transform: none; text-decoration: none; text-align: left;
  text-shadow: none !important; white-space: pre; overflow: auto;
  resize: vertical; outline: none;
  -webkit-font-smoothing: antialiased; text-rendering: auto;
  -webkit-text-fill-color: var(--ptle-input-text);
}
#ptle-panel textarea:focus,
#ptle-panel textarea:active {
  background: var(--ptle-input-bg) !important;
  color: var(--ptle-input-text) !important;
  -webkit-text-fill-color: var(--ptle-input-text) !important;
  border-color: var(--ptle-accent);
}
#ptle-panel textarea::selection,
#ptle-panel textarea::-moz-selection {
  background: var(--ptle-sel-bg) !important;
  color: var(--ptle-sel-text) !important;
  -webkit-text-fill-color: var(--ptle-sel-text) !important;
}

#ptle-panel .ptle-bar { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

#ptle-panel .ptle-note {
  margin-top: 10px; padding: 8px 10px; border-radius: 6px;
  background: var(--ptle-note-bg); color: var(--ptle-note-text);
  border: 1px solid var(--ptle-border); font-size: 12px; line-height: 1.6;
}

#ptle-panel button, #ptle-controls button {
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box; height: 30px; padding: 0 12px; margin: 0;
  border: 1px solid transparent; border-radius: 6px;
  font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1;
  cursor: pointer; white-space: nowrap; vertical-align: middle;
  background: var(--ptle-btn); color: var(--ptle-btn-text);
  transition: filter .12s ease, opacity .12s ease;
}
#ptle-panel button:hover, #ptle-controls button:hover { filter: brightness(.94); }
#ptle-panel button:active, #ptle-controls button:active { filter: brightness(.88); }
#ptle-panel button:disabled, #ptle-controls button:disabled {
  opacity: .55; cursor: default; filter: none;
}
#ptle-panel button.ptle-primary, #ptle-controls button.ptle-primary {
  background: var(--ptle-accent); color: var(--ptle-accent-text);
}

#ptle-controls {
  position: fixed; z-index: ${CFG.zIndex}; right: 16px; bottom: 16px;
  display: flex; align-items: center; gap: 12px; padding: 8px 12px;
}
#ptle-controls .ptle-grip {
  cursor: move; touch-action: none; user-select: none;
  color: var(--ptle-grip); font-size: 15px; line-height: 1;
}
#ptle-controls label {
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer; white-space: nowrap; color: var(--ptle-text);
  font-size: 13px; line-height: 1; user-select: none;
}
#ptle-controls label.ptle-hint { color: var(--ptle-accent); }
#ptle-controls label.ptle-off { opacity: .45; cursor: not-allowed; }
#ptle-controls input[type="checkbox"] {
  margin: 0; width: 14px; height: 14px; cursor: pointer;
  accent-color: var(--ptle-accent);
}
`;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ============================================================
   * UI
   * ============================================================ */

  const copyText = (t) => (typeof GM_setClipboard === 'function')
    ? GM_setClipboard(t, 'text')
    : navigator.clipboard.writeText(t);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function credSummary(engineKey, engine, creds) {
    const parts = engine.credKeys.map((k) => `${k} ${creds.sec[k] ? '✓' : '✗'}`);
    return parts.join('　');
  }

  function showPanel(items, opts, ctx) {
    document.getElementById('ptle-panel')?.remove();
    const { engineKey, engine, creds } = ctx;

    const wrap = el('div');
    wrap.id = 'ptle-panel';

    const head = el('div', 'ptle-head');
    const tokenNote = opts.useToken ? '（含令牌参数）' : '';
    const title = el('div', 'ptle-title',
      `共 ${items.length} 条种子${tokenNote} · ${engine.label}`);
    const closeBtn = el('button', null, '✕');
    closeBtn.title = '关闭';
    closeBtn.onclick = () => wrap.remove();
    head.append(title, closeBtn);

    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.spellcheck = false;
    const plain = () => items.map((it) => it.url).join('\n');
    ta.value = plain();

    const bar = el('div', 'ptle-bar');
    const mk = (label, fn, primary) => {
      const b = el('button', primary ? 'ptle-primary' : null, label);
      b.onclick = fn;
      return b;
    };

    bar.append(
      mk('复制纯链接', async () => { ta.value = plain(); await copyText(ta.value); }, true),
      mk('复制名称+链接', async () => {
        ta.value = items.map((it) => (it.name ? `${it.name}\t${it.url}` : it.url)).join('\n');
        await copyText(ta.value);
      }),
      mk('下载 .txt', () => {
        ta.value = plain();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain' }));
        const host = location.hostname.replace(/^www\./, '').replace(/\./g, '-');
        a.download = `${host}-torrents-${Date.now()}.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      })
    );

    const who = el('div', 'ptle-note');
    const acct = creds.name ? `${creds.name}${creds.id ? ` (uid ${creds.id})` : ''}` : '未识别';
    who.innerHTML =
      `引擎：<b>${engine.label}</b>　账号：<b>${acct}</b><br>` +
      `${credSummary(engineKey, engine, creds)}　` +
      `来源 ${creds.source === 'page' ? '当前页面' : creds.source === 'cache' ? '本机缓存' : '缺失'}`;

    wrap.append(head, ta, bar, who);
    document.body.appendChild(wrap);
    makeDraggable(wrap, head);
  }

  function showControls(ctx) {
    document.getElementById('ptle-controls')?.remove();
    const { engineKey, engine, creds } = ctx;

    const box = el('div');
    box.id = 'ptle-controls';

    const grip = el('span', 'ptle-grip', '⠿');
    grip.title = '拖动';

    const mkCheck = (id, text, cls) => {
      const label = el('label', cls);
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.id = id;
      label.append(chk, document.createTextNode(text));
      return { label, chk };
    };

    const hasToken = !!resolveTokenParam(engineKey, engine);
    const useToken = mkCheck('ptle-use-token', '使用免费令牌', 'ptle-hint');
    if (hasToken) {
      useToken.chk.checked = true;
      useToken.label.title = `在链接后附加 ${resolveTokenParam(engineKey, engine)}=1，消耗当前账号的 FL 令牌`;
    } else {
      useToken.chk.checked = false;
      useToken.chk.disabled = true;
      useToken.label.classList.add('ptle-off');
      useToken.label.title = '该站不支持通过 URL 参数使用免费令牌';
    }

    const allPages = mkCheck('ptle-all-pages', '全部页');
    allPages.chk.checked = false;
    allPages.label.title = '勾选：导出当前筛选条件下的所有分页；不勾：只导出当前这一页';

    const btn = el('button', 'ptle-primary', '导出种子直链');
    btn.title = `引擎：${engine.label}　${credSummary(engineKey, engine, creds)}`;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '采集中…';
      try {
        const opts = { allPages: allPages.chk.checked, useToken: useToken.chk.checked && !useToken.chk.disabled };
        btn.textContent = '检查凭据…';
        await discoverCredentials(engineKey, engine, ctx.creds.sec);
        if (hasAnySecret(ctx.creds.sec)) ctx.creds.source = 'page';

        const { items, creds: c } = await collectAll(ctx, opts, (m) => { btn.textContent = m; });

        if (!items.length) {
          alert(
            '本页没找到种子。\n\n' +
            `引擎：${engine.label}\n` +
            `当前页：${location.pathname}${location.search}\n` +
            `账号：${c.name || '未识别'}\n` +
            `${credSummary(engineKey, engine, c)}\n` +
            `识别到的行元素：${document.querySelectorAll(engine.rowSelector).length}\n` +
            `页面内下载链接：${document.querySelectorAll('a[href*="download"]').length}\n\n` +
            '若列表是异步渲染，等页面加载完再点。\n' +
            '仍为空请把 F12 Console 里 [PTLE] 开头的输出发我。'
          );
          return;
        }

        const missing = engine.credKeys.filter((k) => !c.sec[k]);
        if (missing.length) {
          alert(
            `已找到 ${items.length} 条种子，但缺少 ${missing.join(' / ')}。\n\n` +
            '导出的链接不完整，无法直接下载。\n' +
            '请确认已登录，并打开 RSS 页面后再试一次。'
          );
        }

        showPanel(items, opts, ctx);
      } catch (e) {
        alert('导出失败：' + e.message);
        console.error('[PTLE]', e);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });

    box.append(grip, useToken.label, allPages.label, btn);
    document.body.appendChild(box);
    makeDraggable(box, grip);
  }

  /* ============================================================
   * 启动
   * ============================================================ */

  function boot() {
    const detected = detectEngine();
    if (!detected.engine) {
      console.info('[PTLE] 未识别到支持的引擎，脚本不启用');
      return;
    }

    const { key: engineKey, engine } = detected;
    const creds = getCredentials(engineKey, engine);
    const ctx = { engineKey, engine, creds };

    injectStyle();
    showControls(ctx);
  }

  boot();
})();
