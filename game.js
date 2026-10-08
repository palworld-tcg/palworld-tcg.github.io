'use strict';
// 对局界面：全屏桌布 + 拖拽出牌/攻击 + 动画
const PHASES = ['竖置阶段', '抽卡阶段', '灵魂阶段', '主要阶段', '结束阶段'];
const Game = {
  last: null, prev: null, picked: [], chatLog: [], pendingTarget: null, queue: [], busy: false,
  speed: +localStorage.getItem('ptcg_speed') || 1, replay: null,
  T(ms) { return ms / this.speed; },

  // ---------- 状态更新（排队，保证每一步动画可见） ----------
  update(m) { this.queue.push(m); if (!this.busy) this.pump(); },
  pump() {
    const m = this.queue.shift(); if (!m) { this.busy = false; return; }
    this.busy = true;
    const dur = this.apply(m);
    // 对手造成的每一步都要看得清：至少停留 1.1 秒（按倍速缩放）
    const byOp = this.lastByOp;
    const base = byOp ? Math.max(dur, 1100) : Math.max(dur, 260);
    setTimeout(() => this.pump(), this.queue.length || byOp ? this.T(base) : 0);
  },
  apply(m) {
    this.prev = this.last && this.last.state; this.last = m;
    const s = m.state;
    if (s && !s.over) this.overReady = false; else if (s && s.over && (!this.prev || this.prev.over)) this.overReady = true;
    if (!s) { $('#board').innerHTML = `<div class="mat" style="grid-column:1/3;display:flex;align-items:center;justify-content:center"><div class="prompt" style="flex-direction:column;padding:30px 50px"><div class="q" style="font-size:20px">房间 ${m.room}</div><div>等待对手加入…… 请将房间号 <b style="font-size:30px;color:#ffd54a">${m.room}</b> 告诉好友</div><button onclick="Game.leave()">离开</button></div></div>`; return 0; }
    if (!s.ask || s.ask.kind !== 'select' || this.askV !== s.version) this.picked = [];
    this.askV = s.version;
    // 拖拽攻击后自动回答目标选择
    const a = s.ask;
    if (a && a.kind === 'option' && a.meta && this.pendingTarget != null) {
      const i = a.meta.targets.indexOf(this.pendingTarget); this.pendingTarget = null;
      if (i >= 0) { this.answer(i); }
    } else if (a) this.pendingTarget = null;
    // 拖帕鲁到建筑物任命后，自动选择该帕鲁
    if (a && a.kind === 'select' && this.pendingAssign != null && /任命/.test(a.prompt) && a.cands.some(c => c.uid === this.pendingAssign)) {
      const u = this.pendingAssign; this.pendingAssign = null;
      if (a.max === 1) { this.answer([u]); } else this.picked = [u];
    } else if (a && a.kind === 'main') this.pendingAssign = null;
    const before = this.snapshot();
    // 本次变化是否由对手造成（上一状态在等对手操作）
    const pv = this.prev;
    this.lastByOp = !!(pv && !this.replay && (pv.waiting || (pv.ask == null && !pv.over)) && !(pv.ask));
    this.render();
    this.ensureSpeedCtl(); document.body.classList.toggle('replaying', !!this.replay);
    if (pv && pv.log && s.log) {
      const n = (s.logN || s.log.length) - (pv.logN || pv.log.length);
      if ((this.lastByOp || this.replay) && n > 0) this.caption(s.log.slice(-Math.min(n, 4)).filter(l => !/^——/.test(l)));
    }
    return this.animate(before, this.prev, s);
  },
  // ---------- 表情 / 嘲讽 ----------
  emoMuted: false,
  emoWheel() {
    const old = $('#emo-wheel'); if (old) { old.remove(); return; }
    const E = EMOTES, w = document.createElement('div'); w.id = 'emo-wheel'; w.className = 'emo-wheel';
    w.innerHTML = `<div class="emo-grid">${E.emoji.map((e, i) => `<button data-emo="emoji:${i}">${e}</button>`).join('')}</div>
      <div class="emo-list">${E.taunt.map((t, i) => `<button data-emo="taunt:${i}">${esc(t)}</button>`).join('')}</div>
      <label class="emo-mute"><input type="checkbox" ${this.emoMuted ? 'checked' : ''}> 屏蔽对手的表情</label>`;
    document.body.appendChild(w);
    const b = $('#emo-btn').getBoundingClientRect();
    w.style.left = Math.min(innerWidth - w.offsetWidth - 10, b.left) + 'px'; w.style.top = Math.max(10, b.top - w.offsetHeight - 10) + 'px';
    w.onclick = e => { const x = e.target.closest('[data-emo]'); if (!x) return; const [kind, i] = x.dataset.emo.split(':'); this.sendEmote(kind, +i); w.remove(); };
    w.querySelector('.emo-mute input').onchange = e => { this.emoMuted = e.target.checked; toast(this.emoMuted ? '已屏蔽对手表情' : '已取消屏蔽'); };
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!ev.target.closest('#emo-wheel,#emo-btn')) { w.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  },
  sendEmote(kind, i) {
    const n = Date.now(); if (n - (this._emoT || 0) < 1500) { toast('发得太快啦'); return; } this._emoT = n;
    send({ type: 'emote', kind, i });
  },
  emote(m) {
    const E = EMOTES, txt = E[m.kind] && E[m.kind][m.i]; if (!txt) return;
    this.chatLog.push(`${m.from}：${txt}`);
    if (!m.me && this.emoMuted) return;
    const s = this.last && this.last.state; if (!s) return;
    const side = m.me ? 'me' : 'op', pl = $(`#board [data-plaque="${side}"]`); if (!pl) return;
    $$(`.emo-bubble.${side}`).forEach(x => x.remove());
    const r = pl.getBoundingClientRect(), b = document.createElement('div');
    b.className = `emo-bubble ${side} ${m.kind}`; b.textContent = txt;
    b.style.left = r.left + 24 + 'px'; if (side === 'op') b.style.bottom = innerHeight - r.top + 10 + 'px'; else b.style.top = r.bottom + 12 + 'px';
    document.body.appendChild(b);
    Sound.sfx(m.kind === 'emoji' ? 'pop' : 'chat');
    setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 400); }, m.kind === 'emoji' ? 2400 : 3200);
  },
  chat(m) { this.chatLog.push(`${m.from}：${m.text}`); if (!this.sideOpen) { this.unread = (this.unread || 0) + 1; const sb = $('#sidebtn'); if (sb) sb.innerHTML = `☰ 记录/聊天<span class="badge">${this.unread}</span>`; } const g = $('#glog'); if (g) { g.insertAdjacentHTML('beforeend', `<div class="chat">💬 ${esc(this.chatLog[this.chatLog.length - 1])}</div>`); g.scrollTop = g.scrollHeight; } },
  answer(ans) { if (this.replay) return; send({ type: 'answer', ans, v: this.last.state.version }); },
  leave() { this.revealing.forEach(R => this.dropReveal(R)); this.revealing = []; send({ type: 'leave' }); App.room = null; const back = App.gpActive ? 'gp' : App.dcActive ? 'dc' : 'menu'; App.dcActive = null; App.gpActive = null; sessionStorage.removeItem('ptcg_room'); if (document.fullscreenElement) document.exitFullscreen(); show(back); },
  fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); },

  // ---------- 卡片 ----------
  actsFor(uid) { const a = this.last.state.ask; if (!a || a.kind !== 'main') return []; return a.actions.map((x, i) => ({ ...x, i })).filter(x => x.uid === uid); },
  cardHtml(c, o = {}) {
    const s = this.last.state, d = App.byId[c.id] || {}, a = s.ask, cls = ['card'];
    const land = c.kind === 'building' || (!c.kind && d.kind === 'building' && o.zone !== 'hand');
    if (land && o.zone !== 'hand' && o.zone !== 'tray') cls.push('land');
    if (c.rested) cls.push('rested');
    if (a && a.kind === 'select' && a.cands.some(x => x.uid === c.uid)) cls.push(this.picked.includes(c.uid) ? 'sel' : 'cand');
    else if (a && a.kind === 'option' && a.meta && a.meta.targets.includes(c.uid)) cls.push('tgt');
    else if (this.actsFor(c.uid).length) cls.push('can');
    const B = s.battle; if (B && B.att === c.uid) cls.push('attacking'); if (B && B.target === c.uid) cls.push('tgt');
    let tag = '';
    if (c.kind === 'pal' && d.power != null) tag = `<div class="tag"><span class="pw ${c.power > d.power ? 'up' : c.power < d.power ? 'down' : ''}">⚔${c.power}</span><span class="pw">✱${c.strike}</span></div>`;
    else if (c.kind === 'building' && d.power != null && c.power !== d.power) tag = `<div class="tag"><span class="pw">🛡${c.power}</span></div>`;
    const extra = [c.kw && c.kw.length ? '能力：' + c.kw.join('、') : '', c.extraNames ? '追加卡名：' + c.extraNames.join('、') : '', c.noStand ? '不会竖置' : '', c.damage ? `已受到 ${c.damage} 伤害` : ''].filter(Boolean).join('　');
    return `<div class="${cls.join(' ')}" data-uid="${c.uid}" data-zoom="${c.id}" data-extra="${esc(extra)}" ${o.style ? `style="${o.style}"` : ''}><div class="in"><img src="${cardImg(c.id)}" draggable="false">${tag}${c.damage ? `<span class="dm">-${c.damage}</span>` : ''}${c.kw && c.kw.length ? `<span class="kws">${esc(c.kw.join(' '))}</span>` : ''}</div></div>`;
  },
  backHtml(style) { return `<div class="card back" style="${style || ''}"><div class="in"><img src="/ui/card_back.jpg" draggable="false"></div></div>`; },
  fan(n, i, deg) { const mid = (n - 1) / 2, k = i - mid; return `transform:rotate(${k * deg}deg) translateY(${Math.abs(k) * Math.abs(k) * 2.2}px)`; },

  // ---------- 渲染 ----------
  render() {
    const s = this.last.state; if (!s) return;
    if (typeof Picker !== 'undefined') Picker.sync(this.replay ? null : s);
    const [me, op] = s.players, a = s.ask;
    const myTurn = s.active === s.me;
    const lane = (p, kind, label, side) => {
      const list = p.base.filter(c => kind === 'pal' ? c.kind === 'pal' : c.kind !== 'pal');
      return `<div class="lane a-${side}${kind === 'pal' ? 'pal' : 'bld'} ${list.length >= (kind === 'pal' ? 4 : 3) ? 'tight' : ''}" data-lane="${side}${kind}"><span class="lbl">${label}</span>${list.map(c => this.cardHtml(c)).join('')}</div>`;
    };
    const tgtPlayer = a && a.kind === 'option' && a.meta && a.meta.targets.includes('player');
    const piles = (p, side) => `<div class="pilecol a-${side === 'me' ? 'mright' : 'oleft'}">
        <div class="pile deck ${side === 'me' && this.actsFor(undefined).some(x => x.t === 'soulDraw') ? 'can' : ''}" data-pile="${side}-deck"><span class="cap">卡组</span>${p.deck ? '<img src="/ui/card_back.jpg">' : ''}<span class="cnt">${p.deck}</span></div>
        <div class="pile" data-pile="${side}-grave" data-grave="${side === 'me' ? 0 : 1}"><span class="cap">墓地</span>${p.grave.length ? `<img src="${cardImg(p.grave[p.grave.length - 1].id)}" data-zoom="${p.grave[p.grave.length - 1].id}">` : ''}<span class="cnt">${p.grave.length}</span></div></div>`;
    const souls = (p, side) => `<div class="pilecol a-${side === 'me' ? 'mleft' : 'oright'}">
        <div class="souls" data-souls="${side}"><span class="t">灵魂 ${p.soulsStanding}/${p.souls}</span><div class="sv">${Array.from({ length: p.souls }, (_, i) => `<span class="soul ${i < p.soulsStanding ? '' : 'r'}"></span>`).join('')}</div></div>
        ${p.exile.length ? `<div class="pile" data-exile="${side === 'me' ? 0 : 1}"><span class="cap">放逐</span><img src="${cardImg(p.exile[p.exile.length - 1].id)}"><span class="cnt">${p.exile.length}</span></div>` : ''}
        <div class="pile" style="border-style:solid;opacity:.85" title="灵魂卡组"><span class="cap">灵魂卡组</span>${p.soulDeck ? '<img src="/ui/card_back.jpg">' : ''}<span class="cnt">${p.soulDeck}</span></div></div>`;
    const plaque = (p, side, active) => `<div class="plaque ${side} ${active ? 'active' : ''} ${side === 'op' && tgtPlayer ? 'tgt' : ''} ${s.battle && s.battle.target === 'player' && active === false ? 'tgt' : ''}" data-plaque="${side}">
        <div class="heart"><span>${p.life}</span></div><div class="hud-r"><div class="nm-row"><div class="nm">${esc(p.name)}</div>${side === 'me' && !this.replay && !s.puzzle && !s.tutorial ? `<button class="emo-btn" id="emo-btn" title="表情 / 嘲讽（T）">😀</button>` : ''}</div>
        <div class="lifebar" title="生命 ${p.life}">${Array.from({ length: Math.max(10, p.life) }, (_, i) => `<i class="${i < p.life ? 'on' : ''} ${i < p.life && p.life <= 3 ? 'low' : ''}"></i>`).join('')}</div>
        <div class="rs">${this.res('hand', '手牌', p.handCount)}${this.res('mat', '素材', p.material)}${this.res('food', '食材', p.ingredient)}</div></div></div>`;
    const endAct = a && a.kind === 'main' ? a.actions.findIndex(x => x.t === 'end') : -1;
    const hn = me.hand.length, on = op.handCount;
    $('#board').innerHTML = `
    <div class="mat ${s.night ? 'night' : ''}" id="mat">
      <div class="ohand a-ohand ${op.hand ? 'open' : ''}">${op.hand ? op.hand.map((c, i) => this.cardHtml(c, { zone: 'hand', style: this.fan(on, i, -3) })).join('') : Array.from({ length: on }, (_, i) => this.backHtml(this.fan(on, i, -3))).join('')}</div>
      ${piles(op, 'op')}${lane(op, 'bld', '对手 · 建筑物/装备', 'o')}${lane(op, 'pal', `对手据点 · 帕鲁 ${op.base.filter(c => c.kind === 'pal').length}/5`, 'o')}${souls(op, 'op')}
      <div class="midline a-mid">
        <div class="plaques">${plaque(op, 'op', !myTurn)}${plaque(me, 'me', myTurn)}</div>
        <div class="phase"><span class="on">第${s.turn}回合</span>${PHASES.map(x => `<span class="${s.phase === x && myTurn ? 'on' : ''}" ${s.phase === x && !myTurn ? 'style="background:#4a6fa5;color:#fff"' : ''}>${x.replace('阶段', '')}</span>`).join('')}${s.battle ? '<span class="on" style="background:#c4202c;color:#fff">⚔ 战斗</span>' : ''}</div>
        ${this.promptHtml(s)}
        <button class="endbtn ${endAct >= 0 ? 'go' : 'wait'}" id="endbtn" ${endAct >= 0 ? '' : 'disabled'}>${endAct >= 0 ? '结束<br>回合' : (myTurn ? '我方<br>回合' : '对手<br>回合')}</button>
      </div>
      ${lane(me, 'pal', `我的据点 · 帕鲁 ${me.base.filter(c => c.kind === 'pal').length}/5`, 'm')}${lane(me, 'bld', '我的 · 建筑物/装备', 'm')}${souls(me, 'me')}${piles(me, 'me')}
      <div class="hand a-mhand" id="hand">${me.hand.map((c, i) => this.cardHtml(c, { zone: 'hand', style: this.fan(hn, i, 3.5) })).join('')}</div>
      ${this.trayHtml(s)}
      ${s.puzzle ? this.puzzleHtml(s) : ''}${s.tutorial ? Tutorial.html(s) : ''}
      ${s.over && (this.overReady || this.replay) ? this.resultHtml(s) : ''}
    </div>
    ${this.replay ? this.replayBar() : ''}<div class="gtools" ${this.replay ? 'style="display:none"' : ''}><button id="undobtn" ${s.canUndo && !s.undoReq ? '' : 'disabled'} title="每局最多 3 次${!s.pve ? '，联机需对方同意' : ''}">↶ 悔棋<span class="badge">${s.undos ?? 0}</span></button>${s.gid ? `<button id="gidbtn" title="点击复制对局 ID，用于复盘或反馈问题">🆔 ${s.gid.slice(0, 8)}</button>` : ''}<button onclick="Game.fullscreen()">⛶ 全屏</button><button id="sidebtn">☰ 记录/聊天${this.unread ? `<span class="badge">${this.unread}</span>` : ''}</button>${s.over ? '' : '<button id="concede">🏳 投降</button>'}</div>
    ${s.undoReq === 'theirs' ? `<div class="undoask"><b>对手申请悔棋</b><div class="muted" style="color:#cbb">同意后对手将撤回上一步操作</div><div class="row"><button class="primary" data-undo="1">同意</button><button data-undo="0">拒绝</button></div></div>` : ''}
    <div class="sidebar ${this.sideOpen ? 'open' : ''}"><button class="x">❯</button>
      <div class="tools"><button onclick="Game.fullscreen()">⛶ 全屏</button>${s.over ? '<button onclick="Game.leave()">${s.gp ? "返回大奖赛" : "返回"}</button>' : ''}</div>
      <div class="detail" id="detail"><div class="tx" style="color:#7a6a54;font-size:12px"><b>操作（全部可拖拽）</b><br>· 手牌 → 己方据点：使用　· 己方帕鲁 → 对手帕鲁/建筑/头像：攻击<br>· 拖动发光的卡：中央出现行动垫，拖到垫上即执行<br>· 选择卡牌：拖到「✔ 选择」垫（阻挡可直接拖到攻击者上）<br>· 卡组 → 手牌：支付 3 灵魂抽卡　· ✋ 宝珠 → 按钮：确认/选项/结束<br>· 鼠标悬停任意卡牌查看中文详情</div></div>
      <div class="glog" id="glog">${s.log.map(l => `<div class="${/^──/.test(l) ? 'turn' : ''}">${esc(l)}</div>`).join('')}${this.chatLog.slice(-8).map(l => `<div class="chat">💬 ${esc(l)}</div>`).join('')}</div>
      <div class="chatrow"><input id="chat" placeholder="聊天…"><button id="chat-send">发送</button></div>
    </div>`;
    const lg = $('#glog'); lg.scrollTop = lg.scrollHeight;
    this.bind(s);
    if (s.tutorial && !this.replay) Tutorial.bind(s);
  },
  // 取消（撤回当前行动，不消耗悔棋次数）/ 悔棋 按钮，任何选择界面都显示
  escBtns(s) {
    if (!s || this.replay || s.over) return '';
    return `${s.canCancel ? '<button class="cancelbtn" data-cancel="1" title="撤回当前这次行动（不消耗悔棋次数）">✖ 取消</button>' : ''}${s.canUndo && !s.undoReq ? `<button class="cancelbtn" data-undobtn="1" title="悔棋（剩余 ${s.undos ?? 0} 次）">↶ 悔棋</button>` : ''}`;
  },
  promptHtml(s) {
    return this.promptHtml0(s).replace(/<\/div>$/, m => (s.ask && !this.replay && !s.over && s.undoReq !== 'mine' && !(s.ask.kind === 'main' && !s.ask.quick) ? this.escBtns(s) : '') + m);
  },
  promptHtml0(s) {
    const a = s.ask;
    if (this.replay) { const i = this.replay.info || {}; return i.next ? `<div class="prompt"><span class="q">📼 下一步：${esc((i.names || [])[i.next.player] || '')} → ${esc(String(i.next.label || '').slice(0, 50))}</span></div>` : ''; }
    if (s.over) return '';
    if (!a) return `<div class="prompt" style="opacity:.8"><span class="q">⏳ 等待 ${esc(s.waiting || '对手')} 操作……</span></div>`;
    if (s.undoReq === 'mine') return `<div class="prompt"><span class="q">⏳ 已发送悔棋申请，等待对方同意……</span></div>`;
    const orb = '<span class="orb" data-orb title="拖动宝珠到按钮上">✋</span>';
    if (a.kind === 'main') return a.quick || a.actions.length > 1 ? `<div class="prompt">${a.quick ? orb : ''}<span class="q">${a.quick ? '⚡ ' : ''}${esc(a.prompt)}</span>${a.quick ? a.actions.map((x, i) => x.t === 'end' ? `<button class="go" data-act="${i}">${esc(x.label)}</button>` : '').join('') : ''}</div>` : '';
    if (a.kind === 'option') {
      if (a.view) return '';
      if (a.meta) return `<div class="prompt">${orb}<span class="q">🎯 ${esc(a.prompt)}：点击发红光的目标</span>${a.meta.targets.includes('player') ? `<button data-opt="${a.meta.targets.indexOf('player')}">攻击对手玩家</button>` : ''}</div>`;
      if (a.options.length > 12) return `<div class="prompt"><span class="q">${esc(a.prompt)}</span><button class="go" onclick="Picker.key=null;Picker.sync(Game.last.state)">🔍 打开选择器</button></div>`;
      return `<div class="prompt">${orb}<span class="q">${esc(a.prompt)}</span>${a.options.map((x, i) => `<button data-opt="${i}">${esc(x)}</button>`).join('')}</div>`;
    }
    const ok = this.picked.length >= a.min && this.picked.length <= a.max;
    return `<div class="prompt">${orb}<span class="q">${esc(a.prompt)}</span><span>（${a.min === a.max ? a.min : a.min + '~' + a.max} 张，已选 ${this.picked.length}）</span><button class="go" id="sel-ok" ${ok ? '' : 'disabled'}>${this.picked.length || a.min ? '确定' : '不选择'}</button></div>`;
  },
  trayHtml(s) {
    const a = s.ask; if (!a) return '';
    const orb = '<span class="orb" data-orb title="拖动宝珠到按钮上">✋</span>';
    if (a.view && a.kind === 'option') {
      return `<div class="tray"><div class="q">🔍 检视结果</div><div class="row2">${a.view.map(c => `<div class="dim">${this.cardHtml({ uid: c.uid, id: c.id }, { zone: 'tray' })}</div>`).join('')}</div>
        <div class="prompt">${orb}<span class="q">${esc(a.prompt)}</span><button class="go" data-opt="0">确定</button>${this.escBtns(s)}</div></div>`;
    }
    if (a.kind !== 'select') return '';
    const cu = new Set(a.cands.map(c => c.uid));
    const list = a.view ? a.view : a.cands.filter(c => !this.onBoard(c.uid)); if (!list.length) return '';
    const head = a.view ? '🔍 检视卡组顶 ' + a.view.length + ' 张（发光的可以选择）' : esc(a.prompt);
    return `<div class="tray"><div class="q">${head}</div>${a.view ? `<div style="color:#ffe7a8;font-size:13px">${esc(a.prompt.replace(/（检视：.*）$/, ''))}</div>` : ''}<div class="row2">${list.map(c => cu.has(c.uid) ? this.cardHtml({ uid: c.uid, id: c.id }, { zone: 'tray' }) : `<div class="dim">${this.cardHtml({ uid: c.uid, id: c.id }, { zone: 'tray' })}</div>`).join('')}</div>
      <div class="prompt">${orb}<span>已选 ${this.picked.length}/${a.max}</span><button class="go" id="sel-ok2" ${this.picked.length >= a.min && this.picked.length <= a.max ? '' : 'disabled'}>确定</button>${this.escBtns(s)}</div></div>`;
  },
  gpResult(s) {
    const r = s.gp.result, over = r.status === 'over'; if (over) App.gpEnded = r;
    return `<div class="gp-res"><div class="gp-res-w"><b>${r.wins}</b><span>胜</span></div><div class="gp-hearts">${Array.from({ length: r.maxLoss }, (_, i) => `<i class="${i < r.losses ? 'lost' : ''}">♥</i>`).join('')}</div>
      <div class="why">${over ? '大奖赛结束！最终战绩 ' + r.wins + ' 胜' : '剩余 ' + (r.maxLoss - r.losses) + ' 条命'}</div>
      ${over ? '' : `<button class="primary" style="font-size:18px;padding:10px 36px;margin:6px" onclick="Game.leave();setTimeout(()=>GP.next(),300)">⚔ 下一场</button>`}</div>`;
  },
  resultHtml(s) {
    const w = s.over.winner, cls = w === s.me ? 'win' : 'lose';
    return `<div class="result"><div class="big ${w === -1 ? 'lose' : cls}">${w === -1 ? '平 局' : w === s.me ? '胜 利' : '败 北'}</div><div class="why">${esc(s.over.reason)}</div>${s.puzzle ? this.puzzleResult(s) : ''}${s.tutorial ? Tutorial.result(s) : ''}${s.gp && s.gp.result ? this.gpResult(s) : ''}${s.gid && !this.replay ? `<div class="why" style="font-size:13px">对局 ID：<code>${s.gid}</code>　<button onclick="Game.openReplay('${s.gid}')">📼 复盘本局</button></div>` : ''}<button class="primary" style="font-size:18px;padding:10px 36px" onclick="Game.leave()">${s.gp ? "返回大奖赛" : "返回"}</button></div>`;
  },
  onBoard(uid) { const s = this.last.state; return s.players.some(p => p.base.some(c => c.uid === uid) || (p.hand || []).some(c => c.uid === uid)); },

  // ---------- 交互（全部操作均可拖拽；点击为备用） ----------
  bind(s) {
    const b = $('#board'), a = s.ask;
    this.replayBind();
    b.querySelectorAll('[data-act]').forEach(x => x.onclick = () => this.answer(+x.dataset.act));
    b.querySelectorAll('[data-opt]').forEach(x => x.onclick = () => this.answer(+x.dataset.opt));
    ['#sel-ok', '#sel-ok2'].forEach(id => { const ok = $(id); if (ok) ok.onclick = () => this.answer(this.picked); });
    const eb = $('#endbtn'); if (eb) eb.onclick = () => { const i = a && a.kind === 'main' ? a.actions.findIndex(x => x.t === 'end') : -1; if (i >= 0) this.answer(i); };
    const dk = b.querySelector('[data-pile="me-deck"]');
    if (dk) { dk.onclick = () => this.showDeck(); dk.addEventListener('pointerdown', e => this.down(e, dk, 'deck')); }
    const gid = $('#gidbtn'); if (gid) gid.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(s.gid).catch(() => {}); toast('对局 ID 已复制：' + s.gid + '（可在大厅「复盘」中查看）'); };
    b.querySelectorAll('[data-plaque="op"]').forEach(x => x.onclick = () => { if (a && a.kind === 'option' && a.meta) { const i = a.meta.targets.indexOf('player'); if (i >= 0) this.answer(i); } });
    b.querySelectorAll('.card[data-uid]').forEach(el => el.addEventListener('pointerdown', e => this.down(e, el, 'card')));
    b.querySelectorAll('[data-orb]').forEach(el => el.addEventListener('pointerdown', e => this.down(e, el, 'orb')));
    b.querySelectorAll('[data-grave],[data-exile]').forEach(x => x.onclick = () => {
      const p = s.players[+(x.dataset.grave || x.dataset.exile)];
      const list = x.dataset.grave !== undefined ? p.grave : p.exile;
      modal(`<h3>${esc(p.name)} 的${x.dataset.grave !== undefined ? '墓地' : '放逐区'}（${list.length}）</h3><div class="pickgrid">${list.map(c => `<div class="ci" data-zoom="${c.id}"><img style="width:110px;border-radius:6px" src="${cardImg(c.id)}"></div>`).join('') || '空'}</div><p><button onclick="closeModal()">关闭</button></p>`);
    });
    const eb2 = $('#emo-btn'); if (eb2) eb2.onclick = e => { e.stopPropagation(); this.emoWheel(); };
    const cs = () => { const t = $('#chat').value.trim(); if (t) send({ type: 'chat', text: t }); $('#chat').value = ''; };
    $('#chat-send').onclick = cs; $('#chat').onkeydown = e => { if (e.key === 'Enter') cs(); };
    const cc = $('#concede'); if (cc) cc.onclick = () => askConfirm('确定投降？', () => send({ type: 'concede' }));
    const sb = $('#sidebtn'), sd = $('.sidebar');
    const setSide = o => { this.sideOpen = o; sd.classList.toggle('open', o); if (o) { const lg = $('#glog'); lg.scrollTop = lg.scrollHeight; } };
    sb.onclick = () => { this.unread = 0; sb.innerHTML = '☰ 记录/聊天'; setSide(!this.sideOpen); }; $('.sidebar .x').onclick = () => setSide(false);
    const ub = $('#undobtn'); if (ub) ub.onclick = () => { if (s.canUndo) send({ type: 'undo' }); };
    $$('[data-cancel]').forEach(x => x.onclick = e => { e.stopPropagation(); this.picked = []; send({ type: 'cancel' }); });
    $$('[data-undobtn]').forEach(x => x.onclick = e => { e.stopPropagation(); this.picked = []; send({ type: 'undo' }); });
    $$('[data-undo]').forEach(x => x.onclick = () => send({ type: 'undoReply', ok: x.dataset.undo === '1' }));
  },
  // ---------- 复盘 ----------
  async openReplay(id) {
    this.replay = { id, n: 0, total: 0, pov: 0, all: true, play: false };
    this.last = null; this.prev = null; this.queue = []; this.busy = false;
    show('game');
    await this.replayGo(0, true);
  },
  async replayGo(n, jump) {
    const R = this.replay; if (!R) return;
    const r = await (await fetch(`/api/replay/${R.id}?n=${n}&pov=${R.pov}&all=${R.all ? 1 : 0}`)).json();
    if (r.error) { toast(r.error); this.replay = null; show('menu'); return; }
    Object.assign(R, { n: r.n, total: r.total, info: r, id: r.id });
    if (jump) { this.prev = null; this.last = null; }
    this.update({ room: null, state: Object.assign(r.state, { gid: r.id }) });
  },
  replayBar() {
    const R = this.replay, i = R.info || {};
    return `<div class="replaybar"><b>📼 复盘</b><span class="muted">${esc((i.names || []).join(' vs '))}　ID ${R.id.slice(0, 8)}</span>
      <button data-rp="first">⏮</button><button data-rp="prev">◀</button><button data-rp="play">${R.play ? '⏸' : '▶'}</button><button data-rp="next">▶|</button><button data-rp="last">⏭</button>
      <input type="range" id="rp-range" min="0" max="${R.total}" value="${R.n}" style="width:200px"><span>${R.n}/${R.total}</span>
      <button data-rp="pov">视角：${esc((i.names || [])[R.pov] || '')}</button><button data-rp="all">🂠 手牌：${R.all ? '双方可见' : '仅本方'}</button><button data-rp="exit">退出</button>
      ${i.next && i.next.label ? `<div class="rpnext">下一步：<b>${esc((i.names || [])[i.next.player])}</b> → ${esc(String(i.next.label).slice(0, 60))}</div>` : (i.over ? `<div class="rpnext">结局：${esc(i.over.reason)}</div>` : '')}</div>`;
  },
  replayBind() {
    const R = this.replay; if (!R) return;
    $$('[data-rp]').forEach(b => b.onclick = () => {
      const k = b.dataset.rp;
      if (k === 'first') this.replayGo(0, true); else if (k === 'last') this.replayGo(R.total, true);
      else if (k === 'prev') this.replayGo(Math.max(0, R.n - 1), true); else if (k === 'next') this.replayGo(R.n + 1);
      else if (k === 'pov') { R.pov = 1 - R.pov; this.replayGo(R.n, true); } else if (k === 'all') { R.all = !R.all; this.replayGo(R.n, true); }
      else if (k === 'exit') { this.replay = null; clearInterval(this._rpT); show('home'); }
      else if (k === 'play') { R.play = !R.play; clearInterval(this._rpT); if (R.play) this._rpT = setInterval(() => { if (!this.busy && !this.queue.length) { if (R.n >= R.total) { R.play = false; clearInterval(this._rpT); this.render(); } else this.replayGo(R.n + 1); } }, 200); this.render(); }
    });
    const rg = $('#rp-range'); if (rg) rg.onchange = () => this.replayGo(+rg.value, true);
  },
  puzzleResult(s) {
    const win = s.over.winner === s.me, L = App.puzzles || [], i = L.findIndex(p => p.id === s.puzzle.id), nx = L[i + 1];
    if (win) { const d = JSON.parse(localStorage.getItem('ptcg_pz_done') || '{}'); d[s.puzzle.id] = 1; localStorage.setItem('ptcg_pz_done', JSON.stringify(d)); App.puzzles && (App.puzzles = null); }
    return `<div class="row" style="justify-content:center;margin:8px 0"><button onclick="startPuzzle('${s.puzzle.id}')">↻ 再试一次</button><button onclick="showGuide('${s.puzzle.id}')">📖 攻略</button>${win && nx ? `<button class="primary" onclick="startPuzzle('${nx.id}')">下一题：${esc(nx.title)} ▶</button>` : ''}</div>`;
  },
  puzzleHtml(s) {
    const P = s.puzzle, lim = P.limit, by = lim ? lim.turn : s.turn;
    const row = (ids, who) => `<div class="pzdeck"><span>${who}卡组顶 →</span>${ids.map((id, i) => `<img class="${(App.byId[id] || {}).lucky ? 'lk' : ''}" src="${cardImg(id)}" data-zoom="${id}" title="第${i + 1}张">`).join('')}${ids.length ? '' : '<i>空</i>'}</div>`;
    return `<div class="pzinfo ${this.pzOpen === false ? 'mini' : ''}"><div class="pzt" onclick="Game.pzOpen=Game.pzOpen===false;Game.render()">🧩 ${esc(P.title)}　<small>须在第 ${by} 回合结束前获胜（当前第 ${s.turn} 回合）</small> <span>${this.pzOpen === false ? '▸' : '▾'}</span></div>
      <div class="pzb"><div>${esc(P.desc)}</div>${row(s.deckTop[1], '对手')}${row(s.deckTop[0], '我方')}
      <div class="row"><button onclick="this.nextElementSibling.classList.toggle('hidden')">💡 提示</button><span class="hidden muted">${esc(P.hint || '')}</span><button onclick="startPuzzle('${P.id}')">↻ 重来</button><button onclick="showGuide('${P.id}')">📖 攻略</button></div></div></div>`;
  },
  showDeck() {
    const s = this.last.state, me = s.players[0], list = me.deckList || [];
    const K = { pal: 0, building: 1, gear: 2, event: 3 }, KN = ['帕鲁', '建筑物', '装备', '事件'];
    const cnt = {}; list.forEach(id => cnt[id] = (cnt[id] || 0) + 1);
    const ids = Object.keys(cnt).sort((a, b) => { const x = App.byId[a] || {}, y = App.byId[b] || {}; return (K[x.kind] - K[y.kind]) || (x.cost - y.cost) || a.localeCompare(b); });
    const groups = [0, 1, 2, 3].map(k => ids.filter(id => K[(App.byId[id] || {}).kind] === k)).filter(g => g.length);
    const sd = this.actsFor(undefined).find(x => x.t === 'soulDraw');
    const box = modal(`<h3>我的剩余卡组（${list.length} 张，按 性质→费用 排序；顺序已隐藏）</h3>
      ${groups.map(g => { const k = K[App.byId[g[0]].kind]; return `<h4 style="margin:10px 0 4px">${KN[k]}（${g.reduce((t, id) => t + cnt[id], 0)}）</h4><div class="pickgrid">${g.map(id => `<div class="ci" data-zoom="${id}"><img src="${cardImg(id)}"><span class="dkn">×${cnt[id]}</span><span class="dkc">◇${App.byId[id].cost}</span></div>`).join('')}</div>`; }).join('') || '<p>卡组为空</p>'}
      <p>${sd ? `<button class="primary" id="dk-sd">支付 3 灵魂抽 1 张</button> ` : ''}<button onclick="closeModal()">关闭</button></p>`);
    const b = box.querySelector('#dk-sd'); if (b) b.onclick = () => { closeModal(); this.answer(sd.i); };
  },
  togglePick(uid) {
    const a = this.last.state.ask; if (!a || a.kind !== 'select') return;
    const i = this.picked.indexOf(uid);
    if (i >= 0) this.picked.splice(i, 1);
    else { if (a.max === 1) this.picked = []; if (this.picked.length < a.max) this.picked.push(uid); }
    if (a.min === 1 && a.max === 1 && this.picked.length === 1) { this.answer(this.picked); return; }
    this.render();
  },
  click(el) {
    const s = this.last.state, a = s.ask, uid = +el.dataset.uid; if (!a) return;
    if (a.kind === 'select' && a.cands.some(c => c.uid === uid)) return this.togglePick(uid);
    if (a.kind === 'option' && a.meta) { const i = a.meta.targets.indexOf(uid); if (i >= 0) this.answer(i); return; }
    const acts = this.actsFor(uid); if (!acts.length) return;
    this.menu(el, acts);
  },
  menu(el, acts) {
    this.closeMenu();
    const r = el.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'ctxmenu'; m.innerHTML = acts.map(x => `<button data-i="${x.i}">${x.t === 'play' ? '▶ ' : x.t === 'attack' ? '⚔ ' : '✦ '}${esc(x.label)}</button>`).join('') + '<button data-x="1" style="opacity:.7">取消</button>';
    document.body.appendChild(m);
    const mr = m.getBoundingClientRect();
    m.style.left = Math.min(innerWidth - mr.width - 8, Math.max(8, r.left + r.width / 2 - mr.width / 2)) + 'px';
    m.style.top = Math.max(8, r.top - mr.height - 8) + 'px';
    m.onclick = e => { const bt = e.target.closest('button'); if (!bt) return; this.closeMenu(); if (bt.dataset.i) this.answer(+bt.dataset.i); };
    setTimeout(() => document.addEventListener('pointerdown', this._cm = e => { if (!m.contains(e.target)) this.closeMenu(); }), 0);
  },
  closeMenu() { $$('.ctxmenu').forEach(x => x.remove()); if (this._cm) document.removeEventListener('pointerdown', this._cm); },

  // 行动垫：拖到其上即执行（起动能力、选择/取消选择等）
  pads(list) {
    const box = document.createElement('div'); box.className = 'pads';
    $('#mat').appendChild(box);
    return list.map(x => { const p = document.createElement('div'); p.className = 'pad'; p.textContent = x.label; box.appendChild(p); return { el: p, drop: x.drop, pad: true }; });
  },
  // 根据拖拽源计算可投放区域
  zonesFor(kind, el) {
    const s = this.last.state, a = s.ask, Z = []; if (!a || s.over) return Z;
    if (kind === 'card') {
      const uid = +el.dataset.uid, acts = this.actsFor(uid);
      const play = acts.find(x => x.t === 'play'), atk = acts.find(x => x.t === 'attack');
      if (play) $$('[data-lane="mpal"],[data-lane="mbld"]').forEach(l => Z.push({ el: l, drop: () => this.answer(play.i) }));
      if (atk) for (const t of this.attackTargets(uid)) Z.push({ el: t.el, drop: () => { this.pendingTarget = t.key; this.answer(atk.i); } });
      // 任命：把竖置的帕鲁拖到有【任命】能力的建筑物上
      const me = s.players[0], pal = me.base.find(c => c.uid === uid && c.kind === 'pal' && !c.rested);
      if (pal && a.kind === 'main' && !a.quick) {
        for (const b of me.base.filter(c => c.kind !== 'pal')) {
          const ba = this.actsFor(b.uid).filter(x => x.t === 'act' && /任命/.test(x.label)); if (!ba.length) continue;
          const be = $(`.card[data-uid="${b.uid}"]`); if (!be) continue;
          if (ba.length === 1) Z.push({ el: be, drop: () => { this.pendingAssign = uid; this.answer(ba[0].i); } });
          else Z.push(...this.pads(ba.map(x => ({ label: '🏠 任命：' + x.label, drop: () => { this.pendingAssign = uid; this.answer(x.i); } }))));
        }
      }
      if (a.kind === 'select' && /任命/.test(a.prompt) && a.cands.some(c => c.uid === uid) && !this.picked.includes(uid))
        $$('[data-lane="mbld"] .card').forEach(be => Z.push({ el: be, drop: () => this.togglePick(uid) }));
      const others = acts.filter(x => x !== play && x !== atk);
      if (a.kind === 'select' && a.cands.some(c => c.uid === uid)) {
        const on = this.picked.includes(uid);
        if (/阻挡/.test(a.prompt) && s.battle && !on) { const ae = $(`.card[data-uid="${s.battle.att}"]`); if (ae) Z.push({ el: ae, drop: () => this.togglePick(uid) }); }
        Z.push(...this.pads([{ label: on ? '✖ 取消选择' : '✔ 选择这张' + (a.max > 1 ? `（${this.picked.length}/${a.max}）` : ''), drop: () => this.togglePick(uid) }]));
      }
      if (a.kind === 'option' && a.meta && a.meta.targets.includes(uid)) Z.push(...this.pads([{ label: '🎯 攻击这个目标', drop: () => this.answer(a.meta.targets.indexOf(uid)) }]));
      if (others.length) Z.push(...this.pads(others.map(x => ({ label: (x.t === 'act' ? '✦ ' : '▶ ') + x.label, drop: () => this.answer(x.i) }))));
    } else if (kind === 'deck') {
      const sd = this.actsFor(undefined).find(x => x.t === 'soulDraw');
      if (sd) Z.push({ el: $('#hand'), drop: () => this.answer(sd.i) }, ...this.pads([{ label: '🂠 支付 3 灵魂抽 1 张', drop: () => this.answer(sd.i) }]));
    } else if (kind === 'orb') {
      $$('#board [data-opt],#board [data-act],#sel-ok,#sel-ok2').forEach(b => { if (!b.disabled) Z.push({ el: b, drop: () => b.click() }); });
      const eb = $('#endbtn.go'); if (eb) Z.push({ el: eb, drop: () => eb.click() });
      if (a.kind === 'option' && a.meta) { a.meta.targets.forEach((t, i) => { const te = t === 'player' ? $('[data-plaque="op"]') : $(`.card[data-uid="${t}"]`); if (te) Z.push({ el: te, drop: () => this.answer(i) }); }); }
    }
    return Z.filter(z => z.el);
  },
  down(e, el, kind) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY; let drag = null, dead = false;
    const move = ev => {
      if (!drag && !dead && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { drag = this.startDrag(el, kind); if (!drag) dead = true; }
      if (drag) drag.move(ev.clientX, ev.clientY);
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!drag) { if (kind === 'card' && !window.__longPress) this.click(el); return; }
      drag.end(ev.clientX, ev.clientY);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  },
  startDrag(el, kind) {
    const Z = this.zonesFor(kind, el);
    if (!Z.length) { $$('.pads').forEach(p => p.remove()); return null; }
    this.closeMenu(); hideZoom(); document.body.classList.add('dragging-now');
    Z.forEach(z => z.el.classList.add(z.pad ? 'pad' : z.el.classList.contains('lane') || z.el.id === 'hand' ? 'drop-ok' : 'tgt'));
    const fromBase = kind === 'card' && !!el.closest('.lane');
    const r0 = el.getBoundingClientRect(), x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
    let svg = null, g = null;
    if (fromBase) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'arrow';
      svg.innerHTML = `<defs><marker id="ah" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff3b3b"/></marker><filter id="gl"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path id="ap" fill="none" stroke="#ff3b3b" stroke-width="9" stroke-linecap="round" marker-end="url(#ah)" filter="url(#gl)" stroke-dasharray="18 8"/>`;
      document.body.appendChild(svg); el.classList.add('attacking');
    } else {
      g = document.createElement('div'); g.className = 'dragghost' + (kind === 'orb' ? ' orbghost' : '');
      g.innerHTML = kind === 'orb' ? '<span class="orb">✋</span>' : kind === 'deck' ? '<img src="/ui/card_back.jpg" draggable="false">' : el.querySelector('.in').innerHTML;
      const st = getComputedStyle($('#v-game')); g.style.setProperty('--cw', st.getPropertyValue('--cw')); g.style.setProperty('--ch', st.getPropertyValue('--ch'));
      document.body.appendChild(g); if (kind === 'card') el.classList.add('dragging');
    }
    const hit = (x, y) => Z.find(z => z.pad && inR(z.el, x, y)) || Z.find(z => inR(z.el, x, y));
    const inR = (e2, x, y) => { const r = e2.getBoundingClientRect(); return x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6; };
    const cleanup = () => { Z.forEach(z => z.el.classList.remove('drop-ok', 'drop-hover', 'tgt')); $$('.pads').forEach(p => p.remove()); if (svg) svg.remove(); el.classList.remove('attacking'); document.body.classList.remove('dragging-now'); };
    return {
      move: (x, y) => {
        if (svg) svg.querySelector('#ap').setAttribute('d', `M${x0},${y0} Q${(x0 + x) / 2},${Math.min(y0, y) - 80} ${x},${y}`);
        if (g) { g.style.left = x + 'px'; g.style.top = y + 'px'; }
        const h = hit(x, y); Z.forEach(z => z.el.classList.toggle('drop-hover', z === h));
      },
      end: (x, y) => {
        const h = hit(x, y); cleanup();
        if (h) { if (g) g.remove(); h.drop(); return; }
        el.classList.remove('dragging');
        if (g) g.animate([{ left: g.style.left, top: g.style.top }, { left: x0 + 'px', top: y0 + 'px' }], { duration: 250, easing: 'ease-out' }).onfinish = () => g.remove();
      },
    };
  },
  // 客户端估算可攻击目标（服务器为准：最终目标选择会再次校验）
  attackTargets(uid) {
    const s = this.last.state, op = s.players[1], me = s.players[0];
    const att = me.base.find(c => c.uid === uid), assault = att && (att.kw || []).some(k => k.startsWith('袭击'));
    let list = op.base.filter(c => c.kind === 'building' || c.kind === 'gear' ? c.kind === 'building' : (c.rested || assault));
    const taunt = list.filter(c => (c.kw || []).some(k => k.startsWith('嘲讽')));
    const out = (taunt.length ? taunt : list).map(c => ({ key: c.uid, el: $(`.card[data-uid="${c.uid}"]`) })).filter(t => t.el);
    if (!taunt.length) out.push({ key: 'player', el: $('[data-plaque="op"]') });
    return out;
  },

  // ---------- 动画 ----------
  snapshot() {
    const m = new Map();
    $$('#board .card[data-uid]').forEach(el => m.set(+el.dataset.uid, { r: el.querySelector('.in').getBoundingClientRect(), img: el.querySelector('img').src }));
    const piles = {}; $$('#board [data-pile]').forEach(el => piles[el.dataset.pile] = el.getBoundingClientRect());
    const oh = $('#board .ohand'); if (oh) piles['op-hand'] = oh.getBoundingClientRect();
    const plq = {}; $$('#board [data-plaque]').forEach(el => plq[el.dataset.plaque] = el.querySelector('.heart').getBoundingClientRect());
    return { m, piles, plq };
  },
  ghost(img, from, to, opts = {}) {
    const g = document.createElement('div'); g.className = 'dragghost';
    g.style.cssText = `left:0;top:0;width:${from.width}px;height:${from.height}px;transform:none;z-index:170`;
    g.innerHTML = `<img src="${img}">`; document.body.appendChild(g);
    const k = [{ transform: `translate(${from.left}px,${from.top}px) scale(1)`, opacity: 1, filter: opts.burn ? 'brightness(1)' : 'none' },
      ...(opts.burn ? [{ transform: `translate(${from.left}px,${from.top - 10}px) scale(1.08)`, opacity: 1, filter: 'brightness(2.5) sepia(1) hue-rotate(-30deg) saturate(5)', offset: .3 }] : []),
      { transform: `translate(${to.left + (to.width - from.width) / 2}px,${to.top + (to.height - from.height) / 2}px) scale(${Math.min(1, to.width / from.width)})`, opacity: opts.fade ? 0 : .9, filter: 'none' }];
    g.animate(k, { duration: opts.dur || 520, easing: 'cubic-bezier(.4,0,.2,1)', delay: opts.delay || 0, fill: 'both' }).onfinish = () => g.remove();
  },
  // 伤害判定翻牌：逐张在中央翻开，幸运☆高亮
  reveal(cards, from, to, side, lifeLoss) {
    const step = 750, box = document.createElement('div'); box.className = 'millbox';
    box.innerHTML = `<div class="mt">${side === 'me' ? '我方' : '对手'}受到伤害 —— 伤害判定</div><div class="mr"></div><div class="mres"></div>`;
    document.body.appendChild(box);
    const row = box.querySelector('.mr');
    cards.forEach((c, k) => setTimeout(() => { Sound.sfx("flip");
      const d = App.byId[c.id] || {}, el = document.createElement('div'); el.className = 'mc' + (d.lucky ? ' lucky' : '');
      el.innerHTML = `<img src="${cardImg(c.id)}">${d.lucky ? '<span>☆ 幸运！</span>' : ''}`; row.appendChild(el);
      el.animate([{ transform: 'rotateY(90deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: this.T(380), easing: 'ease-out' });
    }, this.T(k * step)));
    const lucky = cards.some(c => (App.byId[c.id] || {}).lucky);
    setTimeout(() => { box.querySelector('.mres').innerHTML = lucky ? '<b class="ok">✨ 翻出幸运帕鲁，伤害被抵消！</b>' : `<b>未翻出幸运帕鲁 —— 失去 ${lifeLoss} 点生命</b>`; }, this.T(cards.length * step));
    const total = cards.length * step + 1100;
    setTimeout(() => box.remove(), this.T(total));
    return total;
  },
  caption(lines) {
    if (!lines.length) return;
    let c = $('#opcap'); if (!c) { c = document.createElement('div'); c.id = 'opcap'; document.body.appendChild(c); }
    c.innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join('');
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    clearTimeout(this._capT); this._capT = setTimeout(() => c.classList.remove('show'), this.T(2600));
  },
  // 倍速控制（常驻，不随重绘重建）
  ensureSpeedCtl() {
    if ($('#speedctl')) return;
    const d = document.createElement('div'); d.id = 'speedctl';
    d.innerHTML = `<span>🎬 动画</span><input type="range" min="-0.699" max="0.699" step="0.01"><b></b>`;
    document.body.appendChild(d);
    const r = d.querySelector('input'), b = d.querySelector('b');
    const sync = () => { b.textContent = this.speed.toFixed(this.speed < 1 ? 2 : 1) + '×'; };
    r.value = Math.log10(this.speed); sync();
    r.oninput = () => { let v = Math.pow(10, +r.value); if (Math.abs(v - 1) < 0.06) v = 1; this.speed = Math.round(v * 100) / 100; localStorage.setItem('ptcg_speed', this.speed); sync(); };
    r.ondblclick = () => { this.speed = 1; r.value = 0; localStorage.setItem('ptcg_speed', 1); sync(); };
  },
  float(text, r, cls = '') { const f = document.createElement('div'); f.className = 'float ' + cls; f.textContent = text; f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top + r.height / 2 + 'px'; document.body.appendChild(f); this.spd(f); setTimeout(() => f.remove(), this.T(1300)); },
  fx(cls, r) { const f = document.createElement('div'); f.className = cls; f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top + r.height / 2 + 'px'; document.body.appendChild(f); this.spd(f); setTimeout(() => f.remove(), this.T(900)); },
  sparks(r, n = 14, color) {
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div'); p.className = 'spark'; if (color) { p.style.background = color; p.style.boxShadow = `0 0 10px ${color}`; }
      const x = r.left + r.width / 2, y = r.top + r.height / 2, ang = Math.random() * 6.28, d = 40 + Math.random() * 90;
      p.style.left = x + 'px'; p.style.top = y + 'px'; document.body.appendChild(p);
      p.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(.2)`, opacity: 0 }], { duration: 500 + Math.random() * 400, easing: 'cubic-bezier(.1,.8,.3,1)' }).onfinish = () => p.remove();
    }
  },
  // 终局演出：败者生命牌破碎 → 胜利金光 / 失败暗场 → 结算界面
  finale(s) {
    const w = s.over.winner, losers = w === -1 ? [0, 1] : [1 - w], deckOut = /卡组/.test(s.over.reason || '');
    losers.forEach(pi => {
      const side = pi === s.me ? 'me' : 'op', pl = $(`#board [data-plaque="${side}"]`); if (!pl) return;
      const r = pl.getBoundingClientRect();
      pl.animate([{ transform: 'none', filter: 'none' }, { transform: 'translateX(-10px)', filter: 'brightness(2) saturate(2)', offset: .15 }, { transform: 'translateX(10px)', offset: .3 }, { transform: 'translateX(-6px)', offset: .45 }, { transform: 'scale(.96)', filter: 'grayscale(1) brightness(.6)' }], { duration: this.T(1100), fill: 'forwards' });
      const k = document.createElement('div'); k.className = 'ko-tag'; k.textContent = deckOut ? '卡组耗尽' : '生命归零';
      k.style.left = r.left + r.width / 2 + 'px'; k.style.top = r.top + r.height / 2 + 'px'; document.body.appendChild(k); this.spd(k);
      setTimeout(() => k.remove(), this.T(2600));
      this.sparks(r, 26, '#ff4a4a');
    });
    if (!this.replay) setTimeout(() => Sound.sting(w === s.me ? 'win' : 'lose'), this.T(900));
    const fl = document.createElement('div'); fl.className = 'end-fx ' + (w === -1 ? 'draw' : w === s.me ? 'win' : 'lose');
    fl.innerHTML = `<div class="end-word">${w === -1 ? 'DRAW' : w === s.me ? 'VICTORY' : 'DEFEAT'}</div>`;
    setTimeout(() => {
      document.body.appendChild(fl); this.spd(fl);
      if (w === s.me) { const c = { left: innerWidth / 2 - 50, top: innerHeight / 2 - 50, width: 100, height: 100 }; for (let i = 0; i < 5; i++) setTimeout(() => this.sparks(c, 34, ['#ffd54a', '#fff', '#ff9a3c', '#9be4ff', '#ffe08a'][i]), this.T(i * 220)); }
    }, this.T(1000));
    setTimeout(() => { this.overReady = true; fl.remove(); this.render(); }, this.T(3100));
  },
  res(k, label, n) {
    const ICON = { hand: '🂠', mat: '🪨', food: '🍖' }, pips = Math.min(n, 6);
    return `<span class="res-c rk-${k} ${n ? '' : 'zero'}" title="${label} ${n}"><span class="top"><i class="ic">${ICON[k]}</i><b>${n}</b></span><span class="pips">${'<em></em>'.repeat(pips)}${n > 6 ? '<small>+</small>' : ''}</span></span>`;
  },
  revealing: [],
  showReveal(ev, s, before) {
    const side = ev.pi === s.me ? 'me' : 'op', n = ev.cards.length, W = Math.min(150, innerHeight * .22, (innerWidth * .5 - (n - 1) * 18) / n), H = W * 1.4;
    const src = ev.from === 'hand' ? (side === 'op' ? before.piles['op-hand'] : null) : before.piles[side + '-deck'];
    const cx = innerWidth / 2, top = Math.max(96, innerHeight * .13), x0 = cx - (n * W + (n - 1) * 18) / 2;
    const cap = document.createElement('div'); cap.className = 'rv-cap ' + side;
    cap.innerHTML = `<b>${side === 'me' ? '你' : '对手'}公开</b><span>${ev.from === 'hand' ? '手牌' : '卡组顶 ' + n + ' 张'}</span>`;
    cap.style.top = top - 44 + 'px'; document.body.appendChild(cap);
    const els = ev.cards.map((c, k) => {
      const el = document.createElement('div'); el.className = 'rv-card ' + side;
      el.innerHTML = `<div class="rv-in"><img class="f" src="${cardImg(c.id)}"><img class="b" src="/ui/card_back.jpg"></div>`;
      Object.assign(el.style, { left: x0 + k * (W + 18) + 'px', top: top + 'px', width: W + 'px', height: H + 'px' });
      document.body.appendChild(el);
      const own = ev.from === 'hand' && side === 'me' ? $(`#board .card[data-uid="${c.uid}"]`) : null;
      const r = own ? own.getBoundingClientRect() : src;
      const dx = r ? r.left + r.width / 2 - (x0 + k * (W + 18) + W / 2) : 0, dy = r ? r.top + r.height / 2 - (top + H / 2) : 80, sc = r ? Math.max(.25, r.width / W) : .5;
      const d = this.T(160 * k);
      el.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sc})`, opacity: r ? 1 : 0 }, { transform: 'none', opacity: 1 }], { duration: this.T(520), delay: d, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
      el.querySelector('.rv-in').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: .45 }, { transform: 'rotateY(0deg)' }], { duration: this.T(900), delay: d, easing: 'ease-in-out', fill: 'backwards' });
      setTimeout(() => Sound.sfx('flip'), d + this.T(500));
      return el;
    });
    this.revealing.push({ ev, side, els, cap, t0: Date.now(), v: s.version, hand0: s.players[side === 'me' ? 0 : 1].handCount });
    if (!this._rvTimer) this._rvTimer = setInterval(() => this.last && this.settleReveals(this.last.state), 400);
    return side === 'op' ? this.T(1500) : this.T(900);
  },
  settleReveals(s) {
    const HOLD = this.T(2400);
    this.revealing = this.revealing.filter(R => {
      const age = Date.now() - R.t0, pi = R.side === 'me' ? 0 : 1, P = s.players[pi];
      const where = uid => {
        for (const z of ['base', 'grave', 'exile']) for (const q of [0, 1]) if (s.players[q][z].some(c => c.uid === uid)) return { z, q };
        if (P.hand && P.hand.some(c => c.uid === uid)) return { z: 'hand', q: pi };
        return null;
      };
      const locs = R.ev.cards.map(c => where(c.uid));
      const moved = R.ev.from === 'hand' || locs.every(Boolean) || s.version !== R.v;
      if (s.over || !(age >= HOLD && moved) && age < 9000) return !s.over || (this.dropReveal(R), false);
      // 飞往去处
      const pile = k => $(`#board [data-pile="${k}"]`);
      const opGain = P.handCount > R.hand0 || R.ev.from === 'hand';
      R.els.forEach((el, k) => {
        const L = locs[k], uid = R.ev.cards[k].uid, sd = q => q === 0 ? 'me' : 'op';
        let t = null;
        if (L && L.z === 'base') t = $(`#board .card[data-uid="${uid}"]`);
        else if (L && (L.z === 'grave' || L.z === 'exile')) t = pile(sd(L.q) + '-grave');
        else if (L && L.z === 'hand') t = $(`#board .card[data-uid="${uid}"]`);
        else if (R.side === 'op' && opGain) t = $('#board .ohand');
        else t = pile(R.side + '-deck');
        const a = el.getBoundingClientRect(), b = t ? t.getBoundingClientRect() : a;
        el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${b.left + b.width / 2 - a.left - a.width / 2}px,${b.top + b.height / 2 - a.top - a.height / 2}px) scale(${Math.max(.2, Math.min(b.width, 120) / a.width)})`, opacity: .2 }],
          { duration: this.T(560), delay: this.T(90 * k), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).onfinish = () => el.remove();
      });
      R.cap.classList.add('out'); setTimeout(() => R.cap.remove(), 400);
      return false;
    });
    if (!this.revealing.length && this._rvTimer) { clearInterval(this._rvTimer); this._rvTimer = null; }
  },
  dropReveal(R) { R.els.forEach(e => e.remove()); R.cap.remove(); },
  castFx(id, mine) {
    const el = document.createElement('div'); el.className = 'cast-fx ' + (mine ? 'mine' : 'op');
    el.innerHTML = `<img src="${cardImg(id)}"><span>${mine ? '发动' : '对手发动'}</span>`;
    document.body.appendChild(el); this.spd(el); Sound.sfx('soul');
    setTimeout(() => el.remove(), this.T(mine ? 1000 : 1500));
  },
  banner(text, op) { const b = document.createElement('div'); b.className = 'banner' + (op ? ' op' : ''); b.textContent = text; document.body.appendChild(b); this.spd(b); setTimeout(() => b.remove(), this.T(1650)); },
  spd(el) { requestAnimationFrame(() => el.getAnimations({ subtree: true }).forEach(a => a.playbackRate = this.speed)); },
  animate(before, prev, s) {
    if (!prev) { this.banner('对 战 开 始'); Sound.sfx('turn'); return 1200; }
    let dur = 0;
    // 0) 公开：新的公开事件从卡组顶/手牌翻出，在中央展示，结算后飞往去处
    if ((s.revealN || 0) > (prev.revealN || 0) && !this.replayFast) {
      for (const ev of (s.reveals || []).filter(r => r.n > (prev.revealN || 0))) dur = Math.max(dur, this.showReveal(ev, s, before));
    }
    this.settleReveals(s);
    const now = new Map(); $$('#board .card[data-uid]').forEach(el => now.set(+el.dataset.uid, el));
    const pile = k => $(`#board [data-pile="${k}"]`); const rect = el => el.getBoundingClientRect();
    const mySide = s.players[0], opSide = s.players[1];
    const where = uid => { for (const [pi, p] of s.players.entries()) { const side = pi === 0 ? 'me' : 'op'; if (p.grave.some(c => c.uid === uid)) return side + '-grave'; if (p.exile.some(c => c.uid === uid)) return side + '-grave'; } return null; };
    // 1) 已存在的卡：FLIP 平滑移动
    for (const [uid, el] of now) {
      const inn = el.querySelector('.in'), old = before.m.get(uid), nr = inn.getBoundingClientRect();
      if (old) {
        const dx = old.r.left + old.r.width / 2 - (nr.left + nr.width / 2), dy = old.r.top + old.r.height / 2 - (nr.top + nr.height / 2);
        if (Math.abs(dx) + Math.abs(dy) > 3) { el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.3,1.2,.5,1)' }); dur = Math.max(dur, 480); }
        // 从手牌打到场上（自己打出的卡元素早已存在，单独补上登场特效）
        const pi = s.players.findIndex(p => p.base.some(c => c.uid === uid));
        if (pi >= 0 && (prev.players[pi].hand || []).some(c => c.uid === uid)) {
          Sound.sfx('card'); setTimeout(() => this.fx('ring', rect(el)), this.T(300));
          if (!this.replayFast && typeof RareFx !== 'undefined') { const card = s.players[pi].base.find(c => c.uid === uid); dur = Math.max(dur, RareFx.play(card.id, el)); }
        }
      } else {
        // 新出现：来自卡组（我方手牌）、对手手牌（对手据点）或无处（中央放大）
        const inHand = mySide.hand.some(c => c.uid === uid);
        const onOpBase = opSide.base.some(c => c.uid === uid);
        let from = inHand ? before.piles['me-deck'] : onOpBase ? before.piles['op-hand'] : null;
        if (from) {
          const dx = from.left + from.width / 2 - (nr.left + nr.width / 2), dy = from.top + from.height / 2 - (nr.top + nr.height / 2);
          el.animate([{ transform: `translate(${dx}px,${dy}px) rotateY(${inHand ? 180 : 0}deg) scale(.8)`, opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
        } else el.animate([{ transform: 'scale(1.6)', opacity: 0, filter: 'brightness(3)' }, { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }], { duration: 500, easing: 'ease-out' });
        Sound.sfx('card'); if (!inHand) setTimeout(() => this.fx('ring', rect(el)), this.T(250));
        dur = Math.max(dur, 600);
        // 稀有卡登场特效（按稀有度分级）
        if (!inHand && !this.replayFast && typeof RareFx !== 'undefined') { const card = s.players.flatMap(p => p.base).find(c => c.uid === uid); if (card) dur = Math.max(dur, RareFx.play(card.id, el)); }
      }
    }
    // 2) 消失的卡：飞向墓地 / 卡组 / 对手手牌
    for (const [uid, old] of before.m) {
      if (now.has(uid)) continue;
      const w = where(uid); const wasBase = prev.players.some(p => p.base.some(c => c.uid === uid));
      const to = w ? rect(pile(w)) : prev.players[0].hand && prev.players[0].hand.some(c => c.uid === uid) ? null : (before.piles['op-hand'] || old.r);
      if (to) { this.ghost(old.img, old.r, to, { burn: wasBase && !!w, fade: !w, dur: wasBase ? 750 : 520 }); if (wasBase && w) { this.sparks(old.r, 18, '#ff7a30'); Sound.sfx('ko'); } dur = Math.max(dur, 750); }
    }
    // 2.2) 打出的事件卡：稀有版播放亮相特效；对手的普通事件在中央短暂展示
    s.players.forEach((p, pi) => {
      const q = prev.players[pi], known = new Set([...q.grave, ...q.exile, ...q.base].map(c => c.uid));
      const ev = p.grave.filter(c => !known.has(c.uid) && (App.byId[c.id] || {}).kind === 'event');
      if (!ev.length) return;
      const played = q.hand ? ev.filter(c => q.hand.some(h => h.uid === c.uid)) : (q.handCount > p.handCount ? ev.slice(-(q.handCount - p.handCount)) : []);
      for (const c of played) {
        const t = typeof RareFx !== 'undefined' && !this.replayFast ? RareFx.tier(c.id) : 0;
        if (t >= 2) { dur = Math.max(dur, RareFx.play(c.id, null)); continue; }
        if (q.hand && !this.replayFast) { this.castFx(c.id, true); dur = Math.max(dur, 900); }
        else if (!q.hand) { this.castFx(c.id, false); dur = Math.max(dur, 1300); }
      }
    });
    // 2.5) 伤害判定：从卡组翻开的卡逐张展示（是否翻出幸运☆）
    s.players.forEach((p, pi) => {
      const q = prev.players[pi]; if (p.deck >= q.deck) return;
      const known = new Set([...q.grave, ...q.exile, ...q.base, ...(q.hand || [])].map(c => c.uid));
      const milled = p.grave.filter(c => !known.has(c.uid) && !prev.players[1 - pi].base.some(x => x.uid === c.uid));
      const lifeLoss = q.life - p.life;
      if (!milled.length || (q.deck - p.deck) < milled.length) return;
      if (!(lifeLoss > 0 || milled.some(c => (App.byId[c.id] || {}).lucky))) return;
      const side = pi === 0 ? 'me' : 'op', dk = before.piles[side + '-deck'], gv = pile(side + '-grave');
      dur = Math.max(dur, this.reveal(milled, dk, gv && rect(gv), side, lifeLoss));
    });
    // 3) 伤害 / 生命
    s.players.forEach((p, pi) => {
      const q = prev.players[pi], side = pi === 0 ? 'me' : 'op';
      const heart = $(`#board [data-plaque="${side}"] .heart`);
      if (p.life < q.life) { Sound.sfx('hit'); this.float('-' + (q.life - p.life), rect(heart)); $('#mat').classList.add('shake'); setTimeout(() => $('#mat') && $('#mat').classList.remove('shake'), this.T(500)); heart.animate([{ transform: 'scale(1.5)', background: '#fff' }, { transform: 'scale(1)' }], { duration: 500 }); dur = Math.max(dur, 900); }
      if (p.life > q.life) { this.float('+' + (p.life - q.life), rect(heart), 'heal'); }
      if (p.souls > q.souls) { Sound.sfx('soul'); const sv = $$(`#board [data-souls="${side}"] .soul`).slice(q.souls); sv.forEach((x, k) => x.animate([{ transform: 'scale(0) rotate(180deg)', opacity: 0 }, { transform: 'scale(1.4)', opacity: 1, offset: .7 }, { transform: 'scale(1)' }], { duration: 600, delay: k * 120, fill: 'backwards' })); }
      if (p.deck < q.deck - 1 && p.grave.length > q.grave.length && p.life <= q.life) { const pr = pile(side + '-grave'); if (pr) this.sparks(rect(pr), 8, '#9be4ff'); }
      for (const c of p.base) {
        const o = q.base.find(x => x.uid === c.uid); const el = now.get(c.uid);
        if (o && el && (c.damage || 0) > (o.damage || 0)) { Sound.sfx('hit'); const r = rect(el.querySelector('.in')); this.fx('slash', r); this.float('-' + (c.damage - (o.damage || 0)), r); el.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 300 }); dur = Math.max(dur, 700); }
        if (o && el && c.power > o.power && c.kind === 'pal') { this.float('⚔+' + (c.power - o.power), rect(el), 'gain'); }
      }
    });
    // 4) 攻击冲撞
    if (s.battle && (!prev.battle || prev.battle.att !== s.battle.att)) {
      const ae = now.get(s.battle.att), te = s.battle.target === 'player' ? $(`#board [data-plaque="${s.active === s.me ? 'op' : 'me'}"]`) : now.get(s.battle.target);
      if (ae && te) {
        const a = rect(ae), t = rect(te), dx = (t.left - a.left) * .55, dy = (t.top - a.top) * .55;
        ae.animate([{ transform: 'none', zIndex: 20 }, { transform: `translate(${-dx * .08}px,${-dy * .08}px) scale(1.1)`, offset: .3 }, { transform: `translate(${dx}px,${dy}px) scale(1.15)`, offset: .6 }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
        Sound.sfx('attack'); setTimeout(() => { this.fx('slash', t); this.sparks(t, 16); }, this.T(420)); dur = Math.max(dur, 800);
      }
    }
    // 5) 回合切换 / 胜负
    if (s.turn !== prev.turn || s.active !== prev.active) { this.banner(s.active === s.me ? '你 的 回 合' : '对 手 回 合', s.active !== s.me); Sound.sfx('turn'); dur = Math.max(dur, 1300); }
    if (s.night !== prev.night) this.banner(s.night ? '黑 夜 降 临' : '天 亮 了', s.night);
    // 6) 胜负：等翻卡/伤害动画播完，再播终局演出，最后弹出结算
    if (s.over && !prev.over && App.dcActive && s.pve && s.over.winner === s.me) { const d = JSON.parse(localStorage.getItem('ptcg_dc_done') || '{}'); d[App.dcActive] = 1; localStorage.setItem('ptcg_dc_done', JSON.stringify(d)); }
    if (s.over && !prev.over && !this.overReady) { const wait = dur + 300; setTimeout(() => this.finale(s), this.T(wait)); dur = wait + 3200; }
    return dur;
  },
};
// 横版卡图放进竖版卡框时，把内容旋转 90°，保证外框与内容一致（反之亦然）
document.addEventListener('load', e => {
  const t = e.target; if (t.tagName !== 'IMG' || !t.closest('#v-game,.dragghost,#modal,.fr') || t.closest('.pzdeck')) return;
  const box = t.parentElement; if (!box) return;
  const imgLand = t.naturalWidth > t.naturalHeight, boxLand = box.clientWidth > box.clientHeight;
  const rot = imgLand !== boxLand && box.clientWidth > 0;
  t.classList.toggle('rot', rot);
  if (rot) { t.style.setProperty('width', box.clientHeight + 'px', 'important'); t.style.setProperty('height', box.clientWidth + 'px', 'important'); }
}, true);
addEventListener('resize', () => { for (const t of document.querySelectorAll('img.rot')) { const b = t.parentElement; t.style.setProperty('width', b.clientHeight + 'px', 'important'); t.style.setProperty('height', b.clientWidth + 'px', 'important'); } });
