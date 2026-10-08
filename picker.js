'use strict';
// 大量选项（如「古典式化妆台」宣言卡名）的可搜索、可滚动选择器。
// 选项为卡名时显示卡图；支持搜索（卡名/日文/效果/属性）、颜色/种类/费用筛选、键盘操作。
const Picker = {
  key: null, sel: -1, f: { q: '', color: '', kind: '', cost: '' },
  sync(s) {
    const a = s && s.ask;
    const want = a && a.kind === 'option' && !a.meta && !a.view && a.options.length > 12;
    if (!want) { this.close(); return; }
    const key = s.version + '|' + a.prompt + '|' + a.options.length;
    if (this.key && this.key.split('|').slice(1).join('|') === key.split('|').slice(1).join('|') && document.getElementById('picker')) return;
    this.key = key; this.open(s, a);
  },
  close() { this.key = null; const p = document.getElementById('picker'); if (p) { p.classList.add('out'); setTimeout(() => p.remove(), 180); } },
  open(s, a) {
    const old = document.getElementById('picker'); if (old) old.remove();
    const byName = {}; for (const c of App.cards) if (!byName[c.name]) byName[c.name] = c;
    const seen = new Set(); JSON.stringify(s, (k, v) => { if (k === 'id' && typeof v === 'string') seen.add(v); return v; });
    this.items = a.options.map((name, i) => { const c = byName[name]; return { i, name, c, onBoard: c && seen.has(c.id) }; });
    this.items.sort((x, y) => (y.onBoard - x.onBoard) || ((x.c ? x.c.cost : 99) - (y.c ? y.c.cost : 99)) || x.name.localeCompare(y.name, 'zh'));
    this.sel = -1; this.f = { q: '', color: '', kind: '', cost: '' };
    const chip = (grp, v, label, style = '') => `<button class="chip ${v === '' ? 'on' : ''}" data-g="${grp}" data-v="${v}" style="${style}">${label}</button>`;
    const costs = [...new Set(this.items.filter(x => x.c).map(x => x.c.cost))].sort((a, b) => a - b);
    const el = document.createElement('div'); el.id = 'picker';
    el.innerHTML = `<div class="pk-box">
      <div class="pk-head"><div class="pk-title">${esc(a.prompt)}<small>${a.options.length} 个选项 · ↑↓←→ 选择 · Enter 确定</small></div>
        <div class="pk-search"><span>🔍</span><input id="pk-q" placeholder="搜索卡名、日文名、效果、属性…" autocomplete="off"><kbd>/</kbd></div></div>
      <div class="pk-chips">
        ${chip('color', '', '全部')}${chip('color', 'red', '红', '--cc:#e0473f')}${chip('color', 'blue', '蓝', '--cc:#3d8bfd')}${chip('color', 'green', '绿', '--cc:#3fb950')}${chip('color', 'purple', '紫', '--cc:#a371f7')}${chip('color', 'none', '无色', '--cc:#999')}
        <i></i>${chip('kind', '', '全部')}${chip('kind', 'pal', '帕鲁')}${chip('kind', 'building', '建筑物')}${chip('kind', 'gear', '装备')}${chip('kind', 'event', '事件')}
        <i></i>${chip('cost', '', '◇全部')}${costs.map(c => chip('cost', String(c), '◇' + c)).join('')}
      </div>
      <div class="pk-grid" id="pk-grid"></div>
      <div class="pk-foot"><span id="pk-info" class="pk-info">点击选中，双击直接确定</span><span class="pk-esc" id="pk-cancel"></span><button id="pk-ok" class="go" disabled>确定宣言</button></div>
    </div>`;
    document.body.appendChild(el);
    const q = el.querySelector('#pk-q');
    q.oninput = () => { this.f.q = q.value.trim().toLowerCase(); this.render(); };
    el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
      const g = b.dataset.g; this.f[g] = b.dataset.v;
      el.querySelectorAll(`.chip[data-g="${g}"]`).forEach(x => x.classList.toggle('on', x === b)); this.render();
    });
    el.querySelector('#pk-ok').onclick = () => this.confirm();
    const esc = el.querySelector('#pk-cancel'), st = Game.last && Game.last.state;
    if (esc && st) { esc.innerHTML = Game.escBtns(st); esc.querySelectorAll('[data-cancel]').forEach(x => x.onclick = () => { this.close(); send({ type: 'cancel' }); }); esc.querySelectorAll('[data-undobtn]').forEach(x => x.onclick = () => { this.close(); send({ type: 'undo' }); }); }
    el.addEventListener('keydown', e => this.key_(e));
    this.render(); setTimeout(() => q.focus(), 50);
  },
  list() {
    const { q, color, kind, cost } = this.f;
    return this.items.filter(x => {
      const c = x.c;
      if (color && (!c || (c.color || 'none') !== color)) return false;
      if (kind && (!c || c.kind !== kind)) return false;
      if (cost && (!c || String(c.cost) !== cost)) return false;
      if (q) { const hay = (x.name + ' ' + (c ? [c.ja, c.en, c.text, (c.types || []).join(' '), c.kindCn, c.colorCn].join(' ') : '')).toLowerCase(); if (!q.split(/\s+/).every(w => hay.includes(w))) return false; }
      return true;
    });
  },
  render() {
    const L = this.vis = this.list(), g = document.getElementById('pk-grid'); if (!g) return;
    if (!L.some(x => x.i === this.sel)) this.sel = L.length === 1 ? L[0].i : (L.some(x => x.i === this.sel) ? this.sel : -1);
    g.innerHTML = L.length ? L.map(x => `<div class="pk-it ${x.i === this.sel ? 'on' : ''}" data-i="${x.i}" ${x.c ? `data-zoom="${x.c.id}"` : ''}>
        ${x.c ? `<div class="pk-img"><img loading="lazy" src="${cardImg(x.c.id)}" onload="this.classList.toggle('rot',this.naturalWidth>this.naturalHeight)"></div>` : '<div class="pk-img pk-noimg">？</div>'}
        <div class="pk-nm">${x.onBoard ? '<b class="pk-tag">场上</b>' : ''}${esc(x.name)}</div></div>`).join('')
      : '<div class="pk-empty">没有匹配的卡名</div>';
    g.querySelectorAll('.pk-it').forEach(it => {
      it.onclick = () => this.pick(+it.dataset.i);
      it.ondblclick = () => { this.pick(+it.dataset.i); this.confirm(); };
    });
    this.foot();
  },
  pick(i, scroll) {
    this.sel = i; const g = document.getElementById('pk-grid');
    g.querySelectorAll('.pk-it').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    if (scroll) { const it = g.querySelector(`.pk-it[data-i="${i}"]`); if (it) it.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    this.foot();
  },
  foot() {
    const it = this.items.find(x => x.i === this.sel), ok = document.getElementById('pk-ok'), info = document.getElementById('pk-info');
    ok.disabled = !it; info.innerHTML = it ? `已选：<b>${esc(it.name)}</b>${it.c ? `　<span>${it.c.colorCn}色${it.c.kindCn} ◇${it.c.cost}</span>` : ''}` : `显示 ${this.vis.length} / ${this.items.length}　·　点击选中，双击直接确定`;
  },
  confirm() { if (this.sel < 0) return; const i = this.sel; hideZoom(); this.close(); Game.answer(i); },
  key_(e) {
    const q = document.getElementById('pk-q');
    if (e.key === 'Enter') { e.preventDefault(); if (this.sel < 0 && this.vis.length) this.pick(this.vis[0].i); this.confirm(); return; }
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); return; }
    const dirs = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'd', ArrowUp: 'u' }; if (!(e.key in dirs) || !this.vis.length) return;
    e.preventDefault();
    const g = document.getElementById('pk-grid'), first = g.querySelector('.pk-it');
    const cols = first ? Math.max(1, Math.round(g.clientWidth / first.offsetWidth)) : 1;
    let k = this.vis.findIndex(x => x.i === this.sel); const d = dirs[e.key];
    k = k < 0 ? 0 : k + (d === 'd' ? cols : d === 'u' ? -cols : d);
    k = Math.max(0, Math.min(this.vis.length - 1, k)); this.pick(this.vis[k].i, true);
  },
};
