'use strict';
// 账号：登录后，所有 ptcg_* 本地数据（卡组、对局历史、残局进度、收藏、设置……）自动同步到服务器账号。
// 服务器把账号存放在与版本无关的数据目录中，版本更新不丢进度；换设备登录即可恢复。
const Account = {
  NOSYNC: new Set(['ptcg_token', 'ptcg_sess', 'ptcg_user']),
  pending: {}, timer: null, quiet: false,
  get sess() { return localStorage.getItem('ptcg_sess'); },
  get user() { try { return JSON.parse(localStorage.getItem('ptcg_user')); } catch (e) { return null; } },
  synced(k) { return /^ptcg_/.test(k) && !this.NOSYNC.has(k); },
  localData() { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (this.synced(k)) o[k] = localStorage.getItem(k); } return o; },
  apply(data) {
    this.quiet = true;
    try {
      for (const k of Object.keys(this.localData())) if (!(k in data)) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    } finally { this.quiet = false; }
  },
  async call(op, body) {
    const r = await fetch('/api/account/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.sess ? { Authorization: 'Bearer ' + this.sess } : {}) }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({ error: '网络错误' }));
    if (!r.ok) { const e = new Error(j.error || '请求失败'); e.code = r.status; throw e; }
    return j;
  },
  // 本地有改动 → 合并后推送（防抖）
  touch(k, v) {
    if (this.quiet || !this.sess || !this.synced(k)) return;
    this.pending[k] = v; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 800);
    this.badge('同步中…');
  },
  async flush(keepalive) {
    clearTimeout(this.timer); const patch = this.pending; this.pending = {};
    if (!Object.keys(patch).length || !this.sess) return;
    try {
      if (keepalive) { fetch('/api/account/data', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.sess }, body: JSON.stringify({ patch }) }); return; }
      await this.call('data', { patch }); this.badge('');
    } catch (e) {
      if (e.code === 401) { this.expire(); return; }
      Object.assign(patch, this.pending); this.pending = patch; this.badge('⚠ 同步失败，稍后重试'); this.timer = setTimeout(() => this.flush(), 5000);
    }
  },
  // 游客数据并入账号：列表取并集，计数相加，其余以账号为准
  merge(srv, loc) {
    const out = { ...loc, ...srv }, J = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
    for (const k of Object.keys(loc)) {
      if (!(k in srv)) continue;
      const a = J(srv[k], null), b = J(loc[k], null); if (a == null || b == null) continue;
      if (k === 'ptcg_decks') { const seen = new Set(a.map(d => d.name + JSON.stringify(d.cards))); out[k] = JSON.stringify(a.concat(b.filter(d => !seen.has(d.name + JSON.stringify(d.cards))))); }
      else if (k === 'ptcg_games') { const m = new Map(); for (const g of b.concat(a)) m.set(g.id, g); out[k] = JSON.stringify([...m.values()].sort((x, y) => y.t - x.t)); }
      else if (k === 'ptcg_pz_done' || k === 'ptcg_dc_done') out[k] = JSON.stringify({ ...b, ...a });
      else if (k === 'ptcg_coll') { const c = { ...a }; for (const [x, n] of Object.entries(b)) c[x] = (c[x] || 0) + n; out[k] = JSON.stringify(c); }
      else if (k === 'ptcg_gstat') out[k] = JSON.stringify({ ...a, packs: (a.packs || 0) + (b.packs || 0) });
    }
    return out;
  },
  async enter(j, mergeLocal) {
    localStorage.setItem('ptcg_sess', j.token); localStorage.setItem('ptcg_user', JSON.stringify(j.user));
    let data = j.data || {};
    if (mergeLocal) {
      const merged = this.merge(data, this.localData()), patch = {};
      for (const [k, v] of Object.entries(merged)) if (data[k] !== v) patch[k] = v;
      if (Object.keys(patch).length) await this.call('data', { patch });
      data = merged;
    }
    if (!data.ptcg_name) { data.ptcg_name = j.user.username; await this.call('data', { patch: { ptcg_name: j.user.username } }); }
    this.apply(data); location.reload();
  },
  expire() { localStorage.removeItem('ptcg_sess'); this.renderBar(); toast && toast('登录已失效，请重新登录'); },
  async logout() {
    await this.flush();
    try { await this.call('logout'); } catch (e) { }
    this.apply({}); localStorage.removeItem('ptcg_sess'); localStorage.removeItem('ptcg_user'); location.reload();
  },
  // 页面启动：已登录则以服务器数据为准覆盖本地
  async boot() {
    this.renderBar();
    if (!this.sess) return;
    try { const r = await fetch('/api/account/me', { method: 'POST', headers: { Authorization: 'Bearer ' + this.sess } }); const j = await r.json();
      if (r.status === 401) { this.expire(); return; }
      if (r.ok) { localStorage.setItem('ptcg_user', JSON.stringify(j.user)); this.apply(j.data || {}); }
    } catch (e) { this.badge('⚠ 离线，暂用本地数据'); }
    this.renderBar();
  },
  badge(t) { const b = document.getElementById('acc-sync'); if (b) b.textContent = t; },
  renderBar() {
    const el = document.getElementById('acc'); if (!el) return; const u = this.sess && this.user;
    el.innerHTML = u ? `<button id="acc-me" title="账号">👤 ${esc(u.username)}</button><span id="acc-sync" class="muted"></span>` : `<button id="acc-login" class="primary">登录 / 注册</button>`;
    const b = el.querySelector('button'); b.onclick = () => u ? this.panel() : this.dialog();
  },
  dialog(msg) {
    const b = modal(`<h3>账号登录</h3><p class="muted">登录后，卡组、对局历史、残局进度、抽卡收藏和设置都保存在账号里：换设备、清缓存、版本更新都不会丢。<br>首次登录/注册时，本机已有的游客数据会自动并入账号。</p>
      <p><input id="acc-u" placeholder="用户名（2~16 字）" maxlength="16" style="width:240px"></p><p><input id="acc-p" type="password" placeholder="密码（至少 4 位）" style="width:240px"></p>
      <p id="acc-err" style="color:#c33;min-height:1em">${msg ? esc(msg) : ''}</p><p style="text-align:right"><button onclick="closeModal()">取消</button> <button id="acc-reg">注册新账号</button> <button class="primary" id="acc-go">登录</button></p>`);
    const go = async op => {
      const u = b.querySelector('#acc-u').value.trim(), p = b.querySelector('#acc-p').value, err = b.querySelector('#acc-err');
      try { err.textContent = '请稍候…'; const j = await this.call(op, op === 'register' ? { username: u, password: p, data: this.localData() } : { username: u, password: p }); await this.enter(j, op === 'login'); }
      catch (e) { err.textContent = e.message; }
    };
    b.querySelector('#acc-go').onclick = () => go('login'); b.querySelector('#acc-reg').onclick = () => go('register');
    b.querySelector('#acc-p').onkeydown = e => { if (e.key === 'Enter') go('login'); }; b.querySelector('#acc-u').focus();
  },
  panel() {
    const u = this.user, d = this.localData(), J = (k, def) => { try { return JSON.parse(d[k]) || def; } catch (e) { return def; } };
    const G = J('ptcg_games', []), win = G.filter(g => g.res === '胜').length, lose = G.filter(g => g.res === '负').length;
    const b = modal(`<h3>👤 ${esc(u.username)}</h3><p class="muted">注册于 ${new Date(u.created).toLocaleString()}</p>
      <ul style="line-height:1.9"><li>卡组：<b>${J('ptcg_decks', []).length}</b> 套</li><li>对局：<b>${G.length}</b> 局（胜 ${win} / 负 ${lose}）</li>
      <li>残局：已解 <b>${Object.keys(J('ptcg_pz_done', {})).length}</b> 题</li><li>抽卡：已开 <b>${J('ptcg_gstat', {}).packs || 0}</b> 包，收藏 <b>${Object.keys(J('ptcg_coll', {})).length}</b> 种</li></ul>
      <details><summary>修改密码</summary><p><input id="pw-o" type="password" placeholder="原密码"> <input id="pw-n" type="password" placeholder="新密码"> <button id="pw-go">确定</button> <span id="pw-m"></span></p></details>
      <p style="text-align:right;margin-top:12px"><button id="acc-exp">导出备份</button> <button id="acc-out">退出登录</button> <button class="primary" onclick="closeModal()">关闭</button></p>`);
    b.querySelector('#acc-out').onclick = () => this.logout();
    b.querySelector('#acc-exp').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ user: u.username, t: Date.now(), data: this.localData() }, null, 1)], { type: 'application/json' })); a.download = `palworld-tcg-${u.username}.json`; a.click(); };
    b.querySelector('#pw-go').onclick = async () => { const m = b.querySelector('#pw-m'); try { await this.call('password', { old: b.querySelector('#pw-o').value, password: b.querySelector('#pw-n').value }); m.textContent = '✔ 已修改'; } catch (e) { m.textContent = e.message; } };
  },
};
// 拦截 localStorage 写入：已登录时自动同步到账号
(() => {
  const set = Storage.prototype.setItem, rm = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === window.localStorage) Account.touch(k, String(v)); };
  Storage.prototype.removeItem = function (k) { rm.call(this, k); if (this === window.localStorage) Account.touch(k, null); };
  addEventListener('pagehide', () => Account.flush(true));
})();
