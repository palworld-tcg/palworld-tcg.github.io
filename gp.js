'use strict';
// 大奖赛客户端：选牌（三选一）→ 连战 → 排行榜
const GP = {
  run: null, board: null, busy: false,
  async call(op, body = {}) {
    const r = await fetch('/api/gp/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(Account.sess ? { Authorization: 'Bearer ' + Account.sess } : {}) }, body: JSON.stringify({ ...body, guest: token(), name: pname() }) });
    const j = await r.json(); if (j.error) { toast(j.error); throw new Error(j.error); } return j;
  },
  async open() {
    try { const j = await this.call('state'); this.run = j.run; this.board = j.board; } catch (e) { }
    this.render(true);
  },
  img(id) { const c = App.byId[id]; return c ? cardImg(id) : ''; },
  COL: { red: '#e0463c', blue: '#3b8be8', green: '#3cb46a', purple: '#9b5de5' },
  KIND: { pal: '帕鲁', building: '建筑物', gear: '装备', event: '事件' },
  boardHtml() {
    const b = this.board || { top: [] }, me = Account.user ? Account.user.username : pname();
    return `<div class="gp-board"><div class="gp-bh"><span>🏆 本机排行榜</span><small>${b.live || 0} 人挑战中 · 共 ${b.total || 0} 次挑战</small></div>
      <ol>${b.top.slice(0, 30).map((r, i) => `<li class="${r.name === me ? 'me' : ''} ${i < 3 ? 'top' + (i + 1) : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}${r.acct ? '' : '<em>游客</em>'}</span>
        <span class="cl">${r.colors.map(c => `<i style="background:${this.COL[c]}"></i>`).join('')}</span><span class="w"><b>${r.wins}</b> 胜</span>${r.status === 'play' ? '<span class="lv">挑战中</span>' : ''}</li>`).join('') || '<li class="empty">还没有人上榜，成为第一个吧！</li>'}</ol></div>`;
  },
  render(enter) {
    const el = $('#gp'), r = this.run;
    if (!r) {
      el.innerHTML = `<div class="gp-intro"><div class="gp-hero"><div class="gp-k">GRAND PRIX</div><h1>大奖赛</h1>
        <ul class="gp-rules"><li><b>1</b>随机分配两种颜色</li><li><b>2</b>每轮从「两色 + 无色」卡池中随机给出 3 张，三选一，共 50 轮组成卡组</li><li><b>3</b>用这副卡组无限连战随机的「地狱」对手</li><li><b>4</b>累计输 3 场挑战结束，按胜场登上排行榜</li></ul>
        <button class="gp-go" id="gp-start"><span>开 始 挑 战</span></button>${Account.user ? '' : '<div class="muted gp-note">单机版：成绩与存档保存在本机浏览器</div>'}</div>${this.boardHtml()}</div>`;
      $('#gp-start').onclick = () => this.start();
      return;
    }
    if (r.status === 'draft') return this.renderDraft(enter);
    this.renderPlay();
  },
  async start() {
    if (this.busy) return; this.busy = true;
    try { const j = await this.call('start'); this.run = j.run; Sound.sting('unlock'); setTimeout(() => Sound.play('draft'), 900); this.colorReveal(); } finally { this.busy = false; }
  },
  colorReveal() {
    const r = this.run, el = $('#gp');
    el.innerHTML = `<div class="gp-reveal">${r.colors.map((c, i) => `<div class="gp-orb" style="--c:${this.COL[c]};--d:${i * 350}ms"><span>${r.colorsCN[i]}</span></div>`).join('<div class="gp-plus">+</div>')}<div class="gp-rv-t">本次大奖赛颜色</div></div>`;
    setTimeout(() => Sound.sfx('pick'), 300); setTimeout(() => Sound.sfx('pick'), 650);
    setTimeout(() => this.renderDraft(true), 2200);
  },
  deckSide() {
    const r = this.run, cnt = {}; for (const id of r.deck) cnt[id] = (cnt[id] || 0) + 1;
    const ids = Object.keys(cnt).sort((a, b) => App.byId[a].cost - App.byId[b].cost || App.byId[a].name.localeCompare(App.byId[b].name));
    const curve = Array(9).fill(0); r.deck.forEach(id => curve[Math.min(8, App.byId[id].cost)]++); const mx = Math.max(1, ...curve);
    const kinds = {}; r.deck.forEach(id => kinds[App.byId[id].kind] = (kinds[App.byId[id].kind] || 0) + 1);
    return `<div class="gp-side"><div class="gp-sh">卡组 <b>${r.deck.length}</b>/50</div>
      <div class="gp-curve">${curve.map((n, i) => `<div><i style="height:${n / mx * 100}%"></i><span>${i}${i === 8 ? '+' : ''}</span></div>`).join('')}</div>
      <div class="gp-kinds">${Object.entries(this.KIND).map(([k, n]) => `<span>${n} <b>${kinds[k] || 0}</b></span>`).join('')}</div>
      <div class="gp-list">${ids.map(id => `<div class="gp-li" data-zoom="${id}"><span class="c">${App.byId[id].cost}</span><span class="n">${esc(App.byId[id].name)}</span><span class="x">×${cnt[id]}</span></div>`).join('')}</div></div>`;
  },
  renderDraft(enter) {
    const r = this.run, el = $('#gp'), n = r.deck.length + 1;
    el.innerHTML = `<div class="gp-draft"><div class="gp-main">
      <div class="gp-top"><div class="gp-cols">${r.colors.map((c, i) => `<span style="--c:${this.COL[c]}">${r.colorsCN[i]}</span>`).join('')}<span class="nc">无色</span></div>
        <div class="gp-round">第 <b>${n}</b> / 50 轮</div><div class="gp-prog"><i style="width:${r.deck.length / 50 * 100}%"></i></div><button class="gp-ab" id="gp-ab">放弃</button></div>
      <div class="gp-pick-t">选择一张加入卡组</div>
      <div class="gp-cards">${r.offer.map((id, i) => { const c = App.byId[id]; return `<button class="gp-card ${enter ? 'deal' : 'deal'}" data-i="${i}" data-zoom="${id}" style="--d:${i * 110}ms">
          <div class="gp-ci"><img src="${this.img(id)}" draggable="false" onload="this.classList.toggle('land',this.naturalWidth>this.naturalHeight)">${c.lucky ? '<span class="gp-lucky">☆</span>' : ''}</div>
          <div class="gp-cn"><span class="k">${this.KIND[c.kind]}</span>${esc(c.name)}</div></button>`; }).join('')}</div>
      <div class="gp-tip">悬停卡牌查看效果 · 键盘 1 / 2 / 3 快速选择</div></div>${this.deckSide()}</div>`;
    $$('#gp .gp-card').forEach(b => b.onclick = e => { if (e.target.closest('.gp-zoom')) return; this.pick(+b.dataset.i, b); });
    $('#gp-ab').onclick = () => this.abandon();
    Sound.sfx('card');
  },
  async pick(i, btn) {
    if (this.busy) return; this.busy = true;
    try {
      Sound.sfx('pick');
      $$('#gp .gp-card').forEach((b, k) => b.classList.add(k === i ? 'chosen' : 'gone'));
      const [j] = await Promise.all([this.call('pick', { i }), new Promise(r => setTimeout(r, 480))]);
      this.run = j.run;
      if (this.run.status === 'play') { Sound.sting('unlock'); try { this.board = await (await fetch('/api/gp/board')).json(); } catch (e) { } this.renderPlay(true); } else this.renderDraft();
    } catch (e) { this.render(); } finally { this.busy = false; }
  },
  renderPlay(fresh) {
    const r = this.run, el = $('#gp'), over = r.status === 'over'; saveGpDeck(r);
    el.innerHTML = `<div class="gp-play"><div class="gp-main">
      <div class="gp-top"><div class="gp-cols">${r.colors.map((c, i) => `<span style="--c:${this.COL[c]}">${r.colorsCN[i]}</span>`).join('')}</div><div class="gp-round">${fresh ? '卡组完成！' : '大奖赛进行中'}</div><span style="flex:1"></span><button class="gp-ab" id="gp-ab">结束挑战</button></div>
      <div class="gp-score"><div class="gp-wins"><b>${r.wins}</b><span>胜</span></div>
        <div class="gp-lives"><div class="gp-hearts big">${Array.from({ length: r.maxLoss }, (_, i) => `<i class="${i < r.losses ? 'lost' : ''}">♥</i>`).join('')}</div><span>剩余 ${r.maxLoss - r.losses} 条命</span></div></div>
      <div class="gp-hist">${r.history.map((h, i) => `<i class="${h.w ? 'w' : 'l'}" title="第 ${i + 1} 战：${h.w ? '胜' : '负'}${h.why ? '（' + esc(h.why) + '）' : ''}">${h.w ? '胜' : '负'}</i>`).join('')}</div>
      <button class="gp-go" id="gp-next"><span>⚔ 第 ${r.wins + r.losses + 1} 战</span></button>
      <div class="gp-tip">对手：地狱 AI（透视全部信息）· 随机卡组 / 精调预设 / 知名卡组，胜场越多对手越强</div>
      <div class="gp-tools"><button id="gp-pvp" class="primary">🌐 用此卡组在线对战</button> <button id="gp-copy">复制卡组到构筑</button></div>
      <div class="gp-tip">在线对战 / 普通人机不计入大奖赛胜负场次</div></div>
      <div class="gp-col">${this.deckSide()}${this.boardHtml()}</div></div>`;
    $('#gp-next').onclick = () => this.next();
    $('#gp-ab').onclick = () => this.abandon();
    $('#gp-pvp').onclick = () => { saveGpDeck(r); localStorage.setItem('ptcg_lastdeck', 'gpd:0'); show('home'); setTimeout(() => { const sel = $('#home-deck'); if (sel && sel.querySelector('option[value="gpd:0"]')) { sel.value = 'gpd:0'; sel.dispatchEvent(new Event('change')); } toast('已选用大奖赛卡组：创建或加入房间即可对战（不计入大奖赛战绩）'); }, 350); };
    $('#gp-copy').onclick = () => { show('builder'); Builder.cur = { name: '大奖赛 ' + r.colorsCN.join(''), cards: r.deck.slice() }; Builder.idx = -1; Builder.render(); };
  },
  next() {
    if (!this.run || this.run.status !== 'play') { show('gp'); return; }
    App.gpActive = this.run.id; App.dcActive = null;
    Sound.sfx('confirm');
    connect({ type: 'pve', gp: true, level: 'hard', auth: Account.sess || '', deck: [], name: Account.user ? Account.user.username : pname(), token: token() });
  },
  abandon() {
    askConfirm(this.run.status === 'draft' ? '放弃本次选牌？' : `结束本次大奖赛？当前成绩 ${this.run.wins} 胜将记入排行榜。`, async () => {
      const j = await this.call('abandon'); const ended = j.ended; this.run = null; this.board = j.board;
      if (ended && ended.status === 'over' && ended.wins + ended.losses > 0) this.summary(ended); else this.render();
    });
  },
  summary(r) {
    saveGpDeck(r);
    const rank = (this.board.top.findIndex(x => x.run === r.id) + 1) || null;
    $('#gp').innerHTML = `<div class="gp-sum"><div class="gp-k">GRAND PRIX · 结算</div><div class="gp-wins huge"><b>${r.wins}</b><span>胜</span></div>
      <div class="gp-hist">${r.history.map(h => `<i class="${h.w ? 'w' : 'l'}">${h.w ? '胜' : '负'}</i>`).join('')}</div>
      ${rank ? `<div class="gp-rank">全服排名 <b>#${rank}</b></div>` : ''}<button class="gp-go" id="gp-again"><span>再来一次</span></button></div>`;
    $('#gp-again').onclick = () => this.start();
    Sound.sting(r.wins >= 3 ? 'win' : 'unlock');
  },
};
window.GP = GP;
document.addEventListener('keydown', e => {
  if (App.view !== 'gp' || !GP.run || GP.run.status !== 'draft' || GP.busy) return;
  const k = +e.key; if (k >= 1 && k <= 3) { const b = $$('#gp .gp-card')[k - 1]; if (b) GP.pick(k - 1, b); }
});
const _gpOpen = GP.open.bind(GP);
GP.open = async function () {
  await _gpOpen();
  const e = App.gpEnded; App.gpEnded = null;
  if (e && !this.run) this.summary(e);
};
