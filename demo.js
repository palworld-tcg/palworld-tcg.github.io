// 浏览器单机版入口：在 Web Worker 中运行完整的游戏服务端（规则引擎 + AI），
// 并把页面的 fetch('/api/...') 与 WebSocket 透明地转发给它。存档保存在本机浏览器 localStorage。
(() => {
  'use strict';
  const PFX = 'ptcg:';                 // localStorage 键前缀（值为虚拟文件内容）
  const MAX_GAMES = 30;                // 最多保留的复盘记录数
  const files = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(PFX + '/')) files[k.slice(PFX.length)] = localStorage.getItem(k); }
  const worker = new Worker('/server.bundle.js');
  let ready = false; const pending = []; const reqs = new Map(); const socks = new Map(); let seq = 0;
  const send = m => ready ? worker.postMessage(m) : pending.push(m);
  function save(path, data) {
    try {
      if (data === null) { localStorage.removeItem(PFX + path); return; }
      localStorage.setItem(PFX + path, data);
      if (path.includes('/games/')) {
        const idx = JSON.parse(localStorage.getItem(PFX + 'gidx') || '[]').filter(x => x !== path); idx.push(path);
        while (idx.length > MAX_GAMES) localStorage.removeItem(PFX + idx.shift());
        localStorage.setItem(PFX + 'gidx', JSON.stringify(idx));
      }
    } catch (e) {   // 存储已满：清掉最旧的复盘记录后重试一次
      const idx = JSON.parse(localStorage.getItem(PFX + 'gidx') || '[]');
      idx.splice(0, 10).forEach(p => localStorage.removeItem(PFX + p)); localStorage.setItem(PFX + 'gidx', JSON.stringify(idx));
      try { localStorage.setItem(PFX + path, data); } catch (e2) { console.warn('存档失败', e2); }
    }
  }
  worker.onmessage = e => {
    const m = e.data;
    if (m.t === 'ready') { ready = true; pending.splice(0).forEach(x => worker.postMessage(x)); }
    else if (m.t === 'fatal') { console.error(m.error); document.body.insertAdjacentHTML('afterbegin', '<pre style="color:#f66;white-space:pre-wrap">启动失败：' + m.error + '</pre>'); }
    else if (m.t === 'save') save(m.path, m.data);
    else if (m.t === 'res') { const r = reqs.get(m.id); reqs.delete(m.id); r && r(new Response(m.body, { status: m.status, headers: m.headers })); }
    else if (m.t === 'wsmsg') { const s = socks.get(m.cid); s && s._msg(m.data); }
    else if (m.t === 'wsclose') { const s = socks.get(m.cid); s && s._closed(); }
  };
  worker.postMessage({ t: 'init', files });
  // ---------- fetch ----------
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    if (url.pathname === '/api/music/upload') return new Response(JSON.stringify({ error: '网页单机版不支持上传音乐，请使用本地部署版' }), { status: 400 });
    let body = init.body; if (body != null && typeof body !== 'string') body = await new Response(body).text();
    const headers = {}; new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    return new Promise(res => { const id = ++seq; reqs.set(id, res); send({ t: 'req', id, url: url.pathname + url.search, method: (init.method || 'GET').toUpperCase(), headers, body }); });
  };
  // ---------- WebSocket（仅拦截本站地址） ----------
  const RealWS = window.WebSocket;
  class LocalWS extends EventTarget {
    constructor(url) {
      const u = new URL(url, location.href);
      if (u.host !== location.host) return new RealWS(url);
      super(); this.url = url; this.readyState = 0; this.cid = ++seq; socks.set(this.cid, this);
      send({ t: 'wsopen', cid: this.cid });
      setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this._fire('open', new Event('open')); });
    }
    _fire(type, ev) { const f = this['on' + type]; f && f.call(this, ev); this.dispatchEvent(ev); }
    _msg(data) { if (this.readyState === 1) this._fire('message', new MessageEvent('message', { data })); }
    _closed() { if (this.readyState === 3) return; this.readyState = 3; socks.delete(this.cid); this._fire('close', new CloseEvent('close')); }
    send(d) { if (this.readyState === 1) send({ t: 'wsmsg', cid: this.cid, data: String(d) }); }
    close() { if (this.readyState >= 2) return; send({ t: 'wsclose', cid: this.cid }); this._closed(); }
  }
  LocalWS.CONNECTING = 0; LocalWS.OPEN = 1; LocalWS.CLOSING = 2; LocalWS.CLOSED = 3;
  window.WebSocket = LocalWS;
  // ---------- 单机版界面调整 ----------
  const REPO = 'https://github.com/palworld-tcg/palworld-tcg';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('demo');
    const pvp = document.querySelector('.m-pvp');
    if (pvp) pvp.innerHTML = `<div class="m-head"><span class="m-ico">🌐</span><div><h2>在线对战</h2><p>网页单机版不含联机</p></div></div>
      <p class="demo-note">这是纯浏览器运行的单机版：AI 在你的电脑上计算，存档保存在本机浏览器。<br>想和好友联机对战，请<a href="${REPO}" target="_blank" rel="noopener">下载源码本地部署</a>（一条命令启动）。</p>`;
    const css = document.createElement('style');
    css.textContent = `body.demo .ost-up,body.demo .ost-box code{display:none!important}
      .demo-note{font-size:13px;line-height:1.7;opacity:.85;margin:10px 2px}.demo-note a{color:var(--acc,#4cc2ff)}
      .demo-foot{position:fixed;left:8px;bottom:6px;font-size:11px;opacity:.55;z-index:5;pointer-events:auto}.demo-foot a{color:inherit}
      body.ingame .demo-foot{display:none}`;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML('beforeend', `<div class="demo-foot">非官方粉丝二创 · 非盈利 · 卡牌与美术版权归 Pocketpair 及官方所有 · <a href="${REPO}" target="_blank" rel="noopener">GitHub</a></div>`);
  });
})();
