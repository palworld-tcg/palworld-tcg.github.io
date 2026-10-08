'use strict';
// 公共：卡表、导航、大厅、连接
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const App = { cards: [], byId: {}, ws: null, room: null };

const ZH = new Set();
// 统一使用日文原版卡面
const imgUrl = f => '/cards/' + f;
// 卡号可以是异画/稀有版本（如 BP01-001SSP），返回对应版本的图片
function cardImgPath(id) { const c = App.byId[id]; if (!c) return ''; const k = String(id).replace(/^SS01-/, 'SS-'); return c.imgs.find(f => f.split('/').pop().replace(/\.png$/, '') === k) || c.imgs[0]; }
function cardImg(id) { const f = cardImgPath(id); return f ? imgUrl(f) : ''; }
function colorClass(c) { return 'col-' + (c.color || 'none'); }
function cardInfoHtml(c) {
  const st = c.kind === 'pal' ? `战斗力 ${c.power}　打击力 ${c.strike}` : c.kind === 'building' ? `耐久力 ${c.power}` : '';
  return `<div class="h">${esc(c.name)}${c.lucky ? ' ☆' : ''}</div>
  <div class="muted">${c.id}　${c.colorCn}色 ${c.kindCn}　费用 ◇${c.cost}${c.quick ? '　【快速】' : ''}</div>
  ${c.types && c.types.length ? `<div class="muted">属性：${c.types.join('/')}　适应性：${(c.apts || []).join('/')}</div>` : (c.apts && c.apts.length ? `<div class="muted">适应性：${c.apts.join('/')}</div>` : '')}
  ${st ? `<div>${st}</div>` : ''}
  <div class="t">${esc(c.text || '（无效果）')}</div>`;
}
function showZoom(id, extra, el, img) {
  const c = App.byId[id]; if (!c) return;
  if (document.body.classList.contains('ingame')) {
    if (document.body.classList.contains('dragging-now')) return;
    // 悬停：放大这张卡本身，并把中文说明贴在它旁边（不另外显示大图）
    $$('.card.hov').forEach(x => x.classList.remove('hov'));
    const card = el && el.classList && el.classList.contains('card') ? el : null;
    if (card) card.classList.add('hov');
    let hp = $('#hoverpop'); if (!hp) { hp = document.createElement('div'); hp.id = 'hoverpop'; document.body.appendChild(hp); }
    hp.innerHTML = `<div class="tx"><div class="nm">${esc(c.name)}${c.lucky ? ' ☆' : ''}</div><div class="meta">${c.colorCn}色 ${c.kindCn}　◇${c.cost}${c.kind === 'pal' ? `　⚔${c.power} ✱${c.strike}` : c.kind === 'building' ? `　耐久${c.power}` : ''}${c.quick ? '　【快速】' : ''}</div><div class="chips">${(c.types || []).map(t => `<span>${t}</span>`).join('')}${(c.apts || []).map(t => `<span style="background:#6a5a44">${t}</span>`).join('')}</div><div style="white-space:pre-wrap;margin-top:4px">${esc(c.text || '（无效果）')}</div>${extra ? `<div class="ex">${esc(extra)}</div>` : ''}</div>`;
    hp.style.display = 'flex';
    requestAnimationFrame(() => {
      const t = (card && card.querySelector('.in')) || el;
      const r = t ? t.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2 };
      const w = hp.offsetWidth, h = hp.offsetHeight;
      let x = r.right - 2, side = 'r'; if (x + w > innerWidth - 6) { x = r.left - w + 2; side = 'l'; }
      const y = Math.max(6, Math.min(innerHeight - h - 6, r.top));
      hp.className = side; hp.style.left = Math.max(6, x) + 'px'; hp.style.top = y + 'px';
    });
    return;
  }
  const z = $('#zoom'); z.classList.remove('hidden');
  z.classList.remove('wide');
  z.innerHTML = `<div class="zf"><img src="${img ? imgUrl(img) : cardImg(id)}" onload="document.getElementById('zoom').classList.toggle('wide',this.naturalWidth>this.naturalHeight)"></div>${cardInfoHtml(c)}${extra ? `<div class="t">${extra}</div>` : ''}`;
}
function hideZoom() { $('#zoom').classList.add('hidden'); const hp = $('#hoverpop'); if (hp) hp.style.display = 'none'; $$('.card.hov').forEach(x => x.classList.remove('hov')); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 3500); }
function modal(html) { const m = $('#modal'); m.querySelector('.box').innerHTML = html; m.classList.remove('hidden'); return m.querySelector('.box'); }
function askConfirm(msg, ok) {
  const b = modal(`<p style="font-size:16px;margin:6px 4px 14px">${esc(msg)}</p><p style="text-align:right"><button id="cf-no">取消</button> <button class="primary" id="cf-ok">确定</button></p>`);
  b.querySelector('#cf-no').onclick = closeModal; b.querySelector('#cf-ok').onclick = () => { closeModal(); ok(); };
}
function closeModal() { $('#modal').classList.add('hidden'); }

const VIEW_TITLE = { gp: '大奖赛', home: '对战', pz: '残局挑战', dc: '卡组挑战', builder: '卡组构筑', gacha: '抽卡', gallery: '卡牌图鉴', rules: '规则速查' };
const VIEW_MUSIC = { title: 'title', menu: 'menu', gp: 'draft', home: 'menu', pz: 'menu', dc: 'menu', builder: 'menu', gacha: 'draft', gallery: 'menu', rules: 'menu', game: 'battle' };
function show(view) {
  if (view === 'battle') view = 'home';
  const prev = App.view; App.view = view;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view));
  document.body.classList.toggle('ingame', view === 'game');
  document.body.dataset.view = view;
  $('#hdr-title').textContent = VIEW_TITLE[view] || '';
  if (prev && prev !== view && view !== 'game') { const v = $('#v-' + view); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
  if (VIEW_MUSIC[view] && !(view === 'game' && Game.replay)) Sound.play(VIEW_MUSIC[view]);
  if (view === 'menu') refreshMenu();
  if (view === 'gp') GP.open();
  if (['home', 'pz', 'dc'].includes(view)) refreshHome();
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'home') refreshHome();
  if (view === 'builder') Builder.render();
  if (view === 'gallery') renderGallery();
  if (view === 'gacha') Gacha.render();
  if (view === 'rules') renderRules();
}

// ---------- 卡组存储 ----------
const Decks = {
  all() { try { return JSON.parse(localStorage.getItem('ptcg_decks') || '[]'); } catch (e) { return []; } },
  save(list) { localStorage.setItem('ptcg_decks', JSON.stringify(list)); },
};
function validate(list) {
  const errs = [];
  if (list.length !== 50) errs.push(`主卡组须恰好 50 张（当前 ${list.length}）`);
  const cnt = {}; let lucky = 0; const cols = new Set();
  for (const id of list) { const c = App.byId[id]; if (!c) continue; cnt[c.ja] = (cnt[c.ja] || 0) + 1; if (c.lucky) lucky++; if (c.color) cols.add(c.color); }
  for (const [ja, n] of Object.entries(cnt)) { const c = App.cards.find(x => x.ja === ja); if (n > 4 && !c.anyNumber) errs.push(`《${c.name}》超过 4 张`); }
  if (lucky > 8) errs.push(`幸运卡☆ 超过 8 张（${lucky}）`);
  if (cols.size > 2) errs.push(`颜色超过 2 种（${cols.size}）`);
  return errs;
}

// ---------- 大厅 ----------
function startPuzzle(id) { localStorage.setItem('ptcg_pz_last', id); connect({ type: 'pve', puzzle: id, name: pname(), token: token() }); }
window.startPuzzle = startPuzzle;
async function showGuide(id) {
  const P = (App.puzzles || []).find(x => x.id === id) || {};
  const tryPw = async pw => {
    const r = await fetch(`/api/puzzle-guide?id=${encodeURIComponent(id)}&pw=${encodeURIComponent(pw)}`);
    const j = await r.json(); if (!r.ok) return j.error || '错误';
    localStorage.setItem('ptcg_pz_pw', pw);
    modal(`<h3>📖 攻略：${esc(P.title || id)}</h3><p style="line-height:1.7">${esc(j.guide)}</p><h4>完整步骤（对手按最强应对）</h4><ol class="pzsteps">${j.steps.map(x => `<li class="${x.startsWith('（对手）') ? 'op' : ''}">${esc(x)}</li>`).join('')}</ol><p style="text-align:right"><button onclick="closeModal()">关闭</button></p>`);
    return null;
  };
  const saved = localStorage.getItem('ptcg_pz_pw'); if (saved && !(await tryPw(saved))) return;
  const b = modal(`<h3>📖 查看攻略：${esc(P.title || id)}</h3><p class="muted">攻略含完整答案，需要输入密码。</p><p><input id="pz-pw" type="password" placeholder="密码" style="width:220px"> <button class="primary" id="pz-go">查看</button> <button onclick="closeModal()">取消</button></p><p id="pz-err" style="color:#c33"></p>`);
  const go = async () => { const e = await tryPw(b.querySelector('#pz-pw').value); if (e) b.querySelector('#pz-err').textContent = e; };
  b.querySelector('#pz-go').onclick = go; b.querySelector('#pz-pw').onkeydown = e => { if (e.key === 'Enter') go(); }; b.querySelector('#pz-pw').focus();
}
window.showGuide = showGuide;
async function refreshHome() {
  try {
    if (!App.puzzles) App.puzzles = await (await fetch('/api/puzzles')).json();
    renderPuzzles();
    if (!App.presets) App.presets = await (await fetch('/api/presets')).json();
    renderDeckChallenges();
  } catch (e) { console.error(e); }
  const G = JSON.parse(localStorage.getItem('ptcg_games') || '[]');
  $('#my-games').innerHTML = G.slice(0, 50).map(g => `<li data-replay="${g.id}"><span class="res r-${g.res}" data-replay="${g.id}">${g.res}</span><span class="nm" data-replay="${g.id}">${esc(g.nm)}</span><span class="t" data-replay="${g.id}">${new Date(g.t).toLocaleString()}</span></li>`).join('') || '<li class="empty">还没有对局记录</li>';
  const sel = $('#home-deck'); const decks = Decks.all();
  if (!App.presets) App.presets = await (await fetch('/api/presets')).json();
  sel.innerHTML = (decks.length ? `<optgroup label="我的卡组">${decks.map((d, i) => `<option value="${i}">${esc(d.name)}${validate(d.cards).length ? '（不合法）' : ''}</option>`).join('')}</optgroup>` : '')
    + `<optgroup label="随机卡组（可指定颜色）"><option value="rnd:true">🎲 真随机（每张卡独立随机，同名多张很少见）</option><option value="rnd:shape">🎲 牌型随机（帕鲁32/建筑7/装备4/事件7）</option><option value="rnd:curve">🎲 曲线随机（偏低费、成套投入）</option><option value="rnd:preset">🎲 随机主题预设</option></optgroup>`
    + (() => { const G = gpDecks(); return G.length ? `<optgroup label="大奖赛卡组（自由对战，不计战绩）">${G.map((g, i) => `<option value="gpd:${i}">🏆 ${esc(g.name)}${g.live ? '（挑战中）' : ''}</option>`).join('')}</optgroup>` : ''; })()
    + presetOptions('preset:');
  const os = $('#pve-opp'); if (os && !os.options.length) {
    os.innerHTML = `<option value="auto">默认（简单/普通：真随机，困难/地狱：强力随机）</option><option value="rnd:true">真随机</option><option value="rnd:shape">牌型随机</option><option value="rnd:curve">曲线随机（强力）</option><option value="rnd:preset">随机主题预设</option><option value="mirror">镜像（与你的卡组相同）</option>${presetOptions('preset:')}`;
    const lo = localStorage.getItem('ptcg_oppdeck'); if (lo && os.querySelector(`option[value="${lo}"]`)) os.value = lo;
  }
  const showInfo = () => { const v = sel.value; const p = v.startsWith('preset:') && App.presets.find(x => 'preset:' + x.key === v);
    $('#home-deck-info').textContent = p ? p.desc : v.startsWith('rnd:') ? '' : ''; $('#rnd-colors').style.display = v.startsWith('rnd:') ? '' : 'none'; };
  sel.onchange = () => { showInfo(); localStorage.setItem('ptcg_lastdeck', sel.value); if ($('#dc-deck')) $('#dc-deck').value = sel.value; };
  const last = localStorage.getItem('ptcg_lastdeck'); if (last && sel.querySelector(`option[value="${last}"]`)) sel.value = last; else if (!decks.length) sel.value = 'rnd:true';
  syncDcDeck();
  showInfo();
  try {
    const rs = await (await fetch('/api/rooms')).json();
    $('#room-list').innerHTML = rs.length ? rs.map(r => `<li>房间 ${r.code}（${esc(r.host)}） <button data-join="${r.code}">加入</button></li>`).join('') : '<li>暂无</li>';
  } catch (e) { /* ignore */ }
}
async function pickedDeck() {
  const v = $('#home-deck').value; localStorage.setItem('ptcg_lastdeck', v);
  const rare = $('#home-rare') ? $('#home-rare').value : ''; localStorage.setItem('ptcg_rare', rare);
  if (v === 'random' || v === '') return (await fetch('/api/random-deck?colors=' + rndColors().join(',') + '&rare=' + rare)).json();
  if (v.startsWith('rnd:')) return (await fetch(`/api/random-deck?mode=${v.slice(4)}&colors=${rndColors().join(',')}&rare=${rare}`)).json();
  if (v.startsWith('gpd:')) { const g = gpDecks()[+v.slice(4)]; if (!g) { toast('大奖赛卡组不存在'); return null; } return rare === 'max' ? g.cards.map(id => Builder.best(id)) : g.cards.slice(); }
  if (v.startsWith('preset:')) { const c = App.presets.find(p => 'preset:' + p.key === v).cards; return rare === 'max' ? c.map(id => Builder.best(id)) : c; }
  const d = Decks.all()[+v];
  const e = validate(d.cards); if (e.length) { toast('卡组不合法：' + e.join('；')); return null; }
  return d.cards;
}
function rndColors() { return $$('#rnd-colors .cc.on').map(b => b.dataset.c).filter(Boolean); }
document.addEventListener('click', e => {
  const b = e.target.closest('#rnd-colors .cc'); if (!b) return;
  if (!b.dataset.c) $$('#rnd-colors .cc').forEach(x => x.classList.toggle('on', x === b));
  else {
    $('#rnd-colors .cc[data-c=""]').classList.remove('on');
    if (!b.classList.contains('on') && rndColors().length >= 2) { toast('最多指定 2 种颜色'); return; }
    b.classList.toggle('on');
    if (!rndColors().length) $('#rnd-colors .cc[data-c=""]').classList.add('on');
  }
  localStorage.setItem('ptcg_rndc', rndColors().join(','));
});
function token() { let t = localStorage.getItem('ptcg_token'); if (!t) { t = Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('ptcg_token', t); } return t; }
function pname() { return $('#pname').value.trim() || '玩家'; }

function connect(first) {
  if (App.ws && App.ws.readyState <= 1) { App.ws.send(JSON.stringify(first)); return; }
  const ws = App.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify(first));
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'error') toast(m.msg);
    else if (m.type === 'state') {
      if (m.state && m.state.gid) { const L = JSON.parse(localStorage.getItem('ptcg_games') || '[]'); const nm = m.state.players.map(p => p.name).join(' vs '); const i = L.findIndex(x => x.id === m.state.gid);
        const e = { id: m.state.gid, nm, t: Date.now(), res: m.state.over ? (m.state.over.winner === m.state.me ? '胜' : m.state.over.winner === -1 ? '平' : '负') : '进行中' };
        if (i >= 0) L[i] = e; else L.unshift(e); localStorage.setItem('ptcg_games', JSON.stringify(L.slice(0, 500))); } App.room = m.room; sessionStorage.setItem('ptcg_room', m.room); show('game'); Game.update(m); }
    else if (m.type === 'chat') Game.chat(m);
    else if (m.type === 'emote') Game.emote(m);
    else if (m.type === 'rejoinFail') sessionStorage.removeItem('ptcg_room');
  };
  ws.onclose = () => { if (App.room && !(Game.last && Game.last.state && Game.last.state.over)) setTimeout(() => connect({ type: 'rejoin', code: App.room, token: token() }), 1500); };
}
function send(m) { if (App.ws && App.ws.readyState === 1) App.ws.send(JSON.stringify(m)); }

document.addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.view) show(t.dataset.view);
  if ((t.dataset.pve || t.id === 'btn-create' || t.id === 'btn-join' || t.dataset.join) && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  { const pz = e.target.closest('[data-puzzle]'); if (pz && !e.target.closest('.gd')) { startPuzzle(pz.dataset.puzzle); return; } }
  if (t.dataset.pve) { App.dcActive = null; const d = await pickedDeck(); if (!d) return; const ov = $('#pve-opp').value; localStorage.setItem('ptcg_oppdeck', ov); let od = null;
    if (ov === 'mirror') od = d; else if (ov.startsWith('preset:')) od = App.presets.find(p => 'preset:' + p.key === ov).cards; else if (ov.startsWith('rnd:')) od = await (await fetch('/api/random-deck?mode=' + ov.slice(4))).json();
    connect({ type: 'pve', level: t.dataset.pve, deck: d, oppDeck: od, name: pname(), token: token() }); }
  if (t.id === 'btn-create') { const d = await pickedDeck(); if (d) connect({ type: 'create', deck: d, name: pname(), token: token() }); }
  if (t.id === 'btn-join' || t.dataset.join) {
    const code = t.dataset.join || $('#join-code').value.trim();
    const d = await pickedDeck(); if (d) connect({ type: 'join', code, deck: d, name: pname(), token: token() });
  }
  if (t.id === 'modal') closeModal();
  if (t.id === 'btn-replay') { const id = $('#rp-id').value.trim(); if (id) Game.openReplay(id); }
  if (t.dataset.replay) Game.openReplay(t.dataset.replay);
});

// ---------- 残局大厅 ----------
App.pzFilter = 'all';
function renderPuzzles() {
  if (!App.puzzles) return;
  const done = JSON.parse(localStorage.getItem('ptcg_pz_done') || '{}'), f = App.pzFilter;
  const ok = p => f === 'all' || (f === 'mill' && p.mill) || (f === 'life' && !p.mill) || (f === 'todo' && !done[p.id]) || (f === 'done' && done[p.id])
    || (f === 'l12' && p.level <= 2) || (f === 'l34' && p.level >= 3 && p.level <= 4) || (f === 'l56' && p.level >= 5);
  const n = App.puzzles.filter(p => done[p.id]).length, N = App.puzzles.length;
  $('#pz-count').textContent = n + '/' + N; $('#pz-ring').setAttribute('stroke-dasharray', `${(n / N * 100).toFixed(1)} 100`);
  const cp = $('#cta-pz-prog'); if (cp) cp.textContent = `已解 ${n} / ${N}`;
  const tier = l => l <= 2 ? 't1' : l <= 4 ? 't2' : 't3';
  $('#puzzle-list').innerHTML = App.puzzles.map((p, i) => [p, i]).filter(([p]) => ok(p)).map(([p, i], k) => {
    const [tag, name] = p.title.includes('·') ? [p.title.slice(0, p.title.lastIndexOf('·')), p.title.slice(p.title.lastIndexOf('·') + 1)] : ['', p.title];
    return `<div class="pzc ${tier(p.level)} ${done[p.id] ? 'done' : ''} ${p.mill ? 'mill' : ''}" data-puzzle="${p.id}" style="--d:${k * 35}ms">
      <div class="pzc-art"><img loading="lazy" src="${cardImg(p.art)}" onload="this.classList.toggle('land',this.naturalWidth>this.naturalHeight)"></div><div class="pzc-shine"></div>
      <div class="pzc-top"><span class="pzc-no">${String(i + 1).padStart(2, '0')}</span>${p.mill ? '<span class="pzc-badge mill">耗尽</span>' : ''}${p.turns > 1 ? `<span class="pzc-badge">${p.turns}回合</span>` : ''}</div>
      ${done[p.id] ? '<div class="pzc-done"><span>✔</span><b>已解</b></div>' : ''}
      <div class="pzc-body"><div class="pzc-stars">${'<i class="on">★</i>'.repeat(p.level)}${'<i>★</i>'.repeat(Math.max(0, 6 - p.level))}</div>
        ${tag ? `<div class="pzc-tag">${esc(tag)}</div>` : ''}<div class="pzc-name">${esc(name)}</div>
        <div class="pzc-desc">${esc(p.desc)}</div>
        <div class="pzc-act"><span class="pzc-play">${done[p.id] ? '再次挑战' : '开始挑战'} →</span><span class="gd" onclick="event.stopPropagation();showGuide('${p.id}')">📖 攻略</span></div></div>
    </div>`;
  }).join('') || '<div class="pz-empty">这个分类下没有题目</div>';
}
// ---------- 卡组挑战 ----------
App.dcFilter = 'all';
function renderDeckChallenges() {
  syncDcDeck();
  if (!App.presets) return;
  const done = JSON.parse(localStorage.getItem('ptcg_dc_done') || '{}'), f = App.dcFilter, L = App.presets.filter(p => p.group === 'meta' || p.group === 'preset');
  const ok = p => f === 'all' || f === p.group || (f === 'todo' && !done[p.key]);
  const n = L.filter(p => done[p.key]).length; $('#dc-count').textContent = n + '/' + L.length; $('#dc-ring').setAttribute('stroke-dasharray', `${(n / L.length * 100).toFixed(1)} 100`);
  const COL = { red: '#e0463c', blue: '#3b8be8', green: '#3cb46a', purple: '#9b5de5' };
  $('#dc-list').innerHTML = L.filter(ok).map((p, k) => {
    const wr = p.wr != null ? Math.round(p.wr * 100) : null, lv = wr == null ? 3 : wr >= 75 ? 6 : wr >= 68 ? 5 : wr >= 60 ? 4 : wr >= 52 ? 3 : 2;
    return `<div class="pzc ${lv <= 2 ? 't1' : lv <= 4 ? 't2' : 't3'} ${done[p.key] ? 'done' : ''}" data-dc="${p.key}" style="--d:${k * 35}ms">
      <div class="pzc-art"><img loading="lazy" src="${cardImg(p.art || p.cards[0])}" onload="this.classList.toggle('land',this.naturalWidth>this.naturalHeight)"></div><div class="pzc-shine"></div>
      <div class="pzc-top"><span class="pzc-no">${p.group === 'meta' ? '🏆' : '⚙'}</span>${wr != null ? `<span class="pzc-badge">胜率 ${wr}%</span>` : ''}</div>
      ${done[p.key] ? '<div class="pzc-done"><span>✔</span><b>已击败</b></div>' : ''}
      <div class="pzc-body"><div class="pzc-stars">${'<i class="on">★</i>'.repeat(lv)}${'<i>★</i>'.repeat(6 - lv)}</div>
        <div class="pzc-tag">${(p.colors || []).map(c => `<i class="dc-dot" style="background:${COL[c]}"></i>`).join('')}${p.group === 'meta' ? '知名卡组' : '精调预设'}</div><div class="pzc-name">${esc(p.name.replace(/^.*·/, ''))}</div>
        <div class="pzc-desc">${esc(p.desc)}</div>
        <div class="pzc-act"><span class="pzc-play">${done[p.key] ? '再次挑战' : '挑战'} →</span><span class="gd" onclick="event.stopPropagation();showDeckList('${p.key}')">📋 卡表</span><span class="gd" onclick="event.stopPropagation();useDeck('${p.key}')">⚔ 用它出战</span></div></div>
    </div>`;
  }).join('') || '<div class="pz-empty">这个分类下没有卡组</div>';
}
// 挑战卡组即预设卡组：统一分组渲染（精调预设 / 知名卡组），附胜率与击败标记
// 大奖赛完成的卡组（本地保存最近 8 副，随账号同步）
function gpDecks() { try { return JSON.parse(localStorage.getItem('ptcg_gp_decks') || '[]'); } catch (e) { return []; } }
function saveGpDeck(run) {
  if (!run || run.deck.length < 50) return;
  const L = gpDecks().filter(g => g.id !== run.id);
  const d = new Date(run.created), name = `${run.colorsCN.join('')} · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${run.wins + run.losses ? ` · ${run.wins}胜${run.losses}负` : ''}`;
  L.unshift({ id: run.id, name, cards: run.deck.slice(), colors: run.colors, live: run.status === 'play' });
  localStorage.setItem('ptcg_gp_decks', JSON.stringify(L.slice(0, 8)));
}
window.gpDecks = gpDecks; window.saveGpDeck = saveGpDeck;
function presetOptions(prefix, icon = true) {
  const done = JSON.parse(localStorage.getItem('ptcg_dc_done') || '{}');
  const opt = p => `<option value="${prefix}${p.key}">${icon ? (p.group === 'meta' ? '🏆 ' : '⚙ ') : ''}${esc(p.name)}${p.wr != null ? '　' + Math.round(p.wr * 100) + '%' : ''}${done[p.key] ? ' ✔' : ''}</option>`;
  const P = App.presets || [];
  return `<optgroup label="精调预设（卡组挑战）">${P.filter(p => p.group !== 'meta').map(opt).join('')}</optgroup><optgroup label="知名卡组（卡组挑战）">${P.filter(p => p.group === 'meta').map(opt).join('')}</optgroup>`;
}
window.presetOptions = presetOptions;
function useDeck(key) {
  localStorage.setItem('ptcg_lastdeck', 'preset:' + key); show('home');
  setTimeout(() => { const sel = $('#home-deck'); if (sel) { sel.value = 'preset:' + key; sel.dispatchEvent(new Event('change')); } }, 300);
  toast('已设为出战卡组：' + App.presets.find(p => p.key === key).name);
}
window.useDeck = useDeck;
function showDeckList(key) {
  const p = App.presets.find(x => x.key === key); if (!p) return; const cnt = {};
  for (const id of p.cards) cnt[id] = (cnt[id] || 0) + 1;
  const rows = Object.entries(cnt).sort((a, b) => (App.byId[a[0]].cost - App.byId[b[0]].cost)).map(([id, n]) => `<div class="dl-row"><img src="${cardImg(id)}"><span>◇${App.byId[id].cost}</span><b>${esc(App.byId[id].name)}</b><i>×${n}</i></div>`).join('');
  modal(`<h3>${esc(p.name)}</h3><p class="muted">${esc(p.desc)}</p><div class="dl-grid">${rows}</div><p style="text-align:right"><button onclick="closeModal();useDeck('${key}')">⚔ 设为出战卡组</button> <button onclick="closeModal();copyDeckToBuilder('${key}')">复制到卡组构筑</button> <button class="primary" onclick="closeModal();startDeckChallenge('${key}')">挑战</button></p>`);
}
function copyDeckToBuilder(key) { const p = App.presets.find(x => x.key === key); show('builder'); Builder.cur = { name: p.name, cards: p.cards.slice() }; Builder.idx = -1; Builder.render(); }
window.showDeckList = showDeckList; window.startDeckChallenge = startDeckChallenge; window.copyDeckToBuilder = copyDeckToBuilder;
// 卡组挑战页的出战卡组选择（与对战页「出战卡组」共用同一设置）
function syncDcDeck() {
  const src = $('#home-deck'), dst = $('#dc-deck'); if (!src || !dst) return;
  dst.innerHTML = src.innerHTML.replace(/ selected=""/g, ''); dst.value = src.value;
  dst.onchange = () => { src.value = dst.value; src.dispatchEvent(new Event('change')); localStorage.setItem('ptcg_lastdeck', dst.value); dcDeckInfo(); };
  $('#dc-deck-edit').onclick = () => show('builder');
  dcDeckInfo();
}
const DCOL = { red: '#e0463c', blue: '#3b8be8', green: '#3cb46a', purple: '#9b5de5' };
function dcDeckInfo() {
  const v = $('#dc-deck').value, el = $('#dc-deck-info'); let cards = null;
  if (/^\d+$/.test(v)) cards = (Decks.all()[+v] || {}).cards; else if (v.startsWith('preset:')) cards = (App.presets.find(p => 'preset:' + p.key === v) || {}).cards; else if (v.startsWith('gpd:')) cards = (gpDecks()[+v.slice(4)] || {}).cards;
  if (!cards) { el.textContent = '每局随机生成'; return; }
  const cols = [...new Set(cards.map(id => App.byId[id] && App.byId[id].color).filter(Boolean))], k = {}; cards.forEach(id => { const c = App.byId[id]; if (c) k[c.kind] = (k[c.kind] || 0) + 1; });
  const err = validate(cards);
  el.innerHTML = `${cols.map(c => `<i class="dc-dot" style="background:${DCOL[c]}"></i>`).join('')} ${cards.length} 张 · 帕鲁 ${k.pal || 0} · 建筑 ${k.building || 0} · 装备 ${k.gear || 0} · 事件 ${k.event || 0}${err.length ? ' · <b style="color:#ff5d6c">不合法</b>' : ''}`;
}
window.syncDcDeck = syncDcDeck;
// 点击挑战：先确认对阵（可在此更换出战卡组）
function startDeckChallenge(key) {
  const p = App.presets.find(x => x.key === key); if (!p) return;
  const wr = p.wr != null ? Math.round(p.wr * 100) + '%' : '—';
  modal(`<div class="vs-box"><div class="vs-side me"><div class="vs-k">你</div><div class="vs-n">${esc(pname())}</div><select id="vs-deck">${$('#home-deck').innerHTML}</select><div class="vs-i" id="vs-info"></div></div>
    <div class="vs-mid">VS</div>
    <div class="vs-side op"><div class="vs-art"><img src="${cardImg(p.art || p.cards[0])}"></div><div class="vs-k">${p.group === 'meta' ? '🏆 知名卡组' : '⚙ 精调预设'} · 地狱 AI</div><div class="vs-n">${esc(p.name)}</div><div class="vs-i">AI 对战胜率 ${wr}</div></div></div>
    <p style="text-align:right;margin-top:16px"><button onclick="closeModal();showDeckList('${key}')">📋 对手卡表</button> <button onclick="closeModal()">取消</button> <button class="primary" id="vs-go" style="font-size:16px;padding:9px 30px">⚔ 开始挑战</button></p>`);
  const vs = $('#vs-deck'); vs.value = $('#home-deck').value;
  const info = () => { $('#dc-deck').value = vs.value; dcDeckInfo(); $('#vs-info').innerHTML = $('#dc-deck-info').innerHTML; };
  vs.onchange = () => { $('#home-deck').value = vs.value; localStorage.setItem('ptcg_lastdeck', vs.value); info(); }; info();
  $('#vs-go').onclick = () => { closeModal(); launchDeckChallenge(key); };
}
async function launchDeckChallenge(key) {
  const p = App.presets.find(x => x.key === key); const d = await pickedDeck(); if (!d) return;
  App.dcActive = key; connect({ type: 'pve', level: 'hell', deck: d, oppDeck: p.cards, name: pname(), token: token() });
}
document.addEventListener('click', e => {
  const tb = e.target.closest('#dc-tabs button'); if (tb) { App.dcFilter = tb.dataset.f; $$('#dc-tabs button').forEach(b => b.classList.toggle('on', b === tb)); renderDeckChallenges(); }
  const dc = e.target.closest('[data-dc]'); if (dc && !e.target.closest('.gd')) startDeckChallenge(dc.dataset.dc);
});
document.addEventListener('click', e => {
  const tb = e.target.closest('#pz-tabs button'); if (tb) { App.pzFilter = tb.dataset.f; $$('#pz-tabs button').forEach(b => b.classList.toggle('on', b === tb)); renderPuzzles(); }
  
  if (e.target.closest('#cta-pve')) { const b = $('[data-pve="hell"]'); b.click(); }
});
// 卡片悬停：3D 倾斜 + 高光
document.addEventListener('pointermove', e => {
  const c = e.target.closest && e.target.closest('.pzc,.mode');
  $$('.tilt').forEach(x => { if (x !== c) { x.classList.remove('tilt'); x.style.transform = ''; } });
  if (!c) return;
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  c.classList.add('tilt'); const k = c.classList.contains('mode') ? 4 : 9;
  c.style.transform = `perspective(900px) rotateX(${(-y * k).toFixed(2)}deg) rotateY(${(x * k).toFixed(2)}deg) translateY(-6px)`;
  c.style.setProperty('--mx', (x + .5) * 100 + '%'); c.style.setProperty('--my', (y + .5) * 100 + '%');
});
// ---------- 标题画面 / 主菜单（重点击、轻滑动） ----------
function titleFx() {
  const T = $('#v-title');
  $('#t-cards').innerHTML = ['BP01-073SSP', 'BP01-025SSP', 'BP01-001SSP', 'BP01-049SSP', 'BP01-074SP']
    .filter(id => App.byId[id]).map((id, i, a) => `<div class="hc" style="--i:${i - (a.length - 1) / 2}"><img src="${imgUrl(App.byId[id].imgs.find(f => f.includes(id)) || App.byId[id].imgs[0])}"></div>`).join('');
  const P = $('#t-particles'); P.innerHTML = Array.from({ length: 40 }, () => `<i style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 12).toFixed(1)}s;animation-duration:${(9 + Math.random() * 10).toFixed(1)}s;--s:${(2 + Math.random() * 4).toFixed(1)}px"></i>`).join('');
  T.addEventListener('pointermove', e => { T.style.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3)); T.style.setProperty('--py', (e.clientY / innerHeight - .5).toFixed(3)); });
  const go = () => { if (App.view !== 'title') return; Sound.init(); Sound.sfx('confirm'); T.classList.add('leaving'); setTimeout(() => { T.classList.remove('leaving'); show('menu'); }, 650); };
  T.addEventListener('click', go); window.addEventListener('keydown', e => { if (App.view === 'title' && !e.metaKey && !e.ctrlKey) go(); });
  $$('#v-menu [data-art]').forEach(t => { const c = App.byId[t.dataset.art]; if (c) t.querySelector('.tl-art').style.backgroundImage = `url("${imgUrl(c.imgs.find(f => f.includes(t.dataset.art)) || c.imgs[0])}")`; });
}
async function refreshMenu() {
  try {
    if (!App.puzzles) App.puzzles = await (await fetch('/api/puzzles')).json();
    if (!App.presets) App.presets = await (await fetch('/api/presets')).json();
    const pd = JSON.parse(localStorage.getItem('ptcg_pz_done') || '{}'), dd = JSON.parse(localStorage.getItem('ptcg_dc_done') || '{}');
    $('#mn-pz-info').textContent = `已解 ${App.puzzles.filter(p => pd[p.id]).length} / ${App.puzzles.length}`;
    const L = App.presets.filter(p => p.group); $('#mn-dc-info').textContent = `已击败 ${L.filter(p => dd[p.key]).length} / ${L.length}`;
    const b = await (await fetch('/api/gp/board')).json(), t = b.top[0];
    $('#mn-gp-info').innerHTML = (t ? `🏆 本机最佳：<b>${esc(t.name)}</b> ${t.wins} 胜` : '🏆 排行榜虚位以待') + (b.live ? `　·　${b.live} 人挑战中` : '');
  } catch (e) { }
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]'); if (t) { Sound.sfx('confirm'); show(t.dataset.go); return; }
  if (e.target.closest('#hdr-back')) { Sound.sfx('back'); show('menu'); }
  if (e.target.closest('#snd-btn')) soundPanel();
  const b = e.target.closest('button,.pzc,[data-dc],[data-puzzle],.tile'); if (b && !t) Sound.sfx('click');
}, true);
document.addEventListener('pointerover', e => { const b = e.target.closest && e.target.closest('button,.pzc,.tile,.gp-card'); if (b && !b.contains(e.relatedTarget)) Sound.sfx('hover'); });
window.addEventListener('keydown', e => { if ((e.key === 't' || e.key === 'T') && App.view === 'game' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#emo-btn')) { e.preventDefault(); Game.emoWheel(); return; } if (e.key === 'Escape' && $('#emo-wheel')) { $('#emo-wheel').remove(); return; } if (e.key === 'Escape' && !['title', 'menu', 'game'].includes(App.view) && $('#modal').classList.contains('hidden')) { Sound.sfx('back'); show('menu'); } });
async function uploadMusic(files) {
  for (const f of files) { toast('上传中：' + f.name); const r = await fetch('/api/music/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }); const j = await r.json().catch(() => ({})); toast(j.ok ? '已加入：' + f.name : '失败：' + (j.error || r.status)); }
  await Sound.reload(); const v = App.view; Sound.play(v === 'title' ? 'title' : v === 'game' ? 'battle' : v === 'gp' ? 'draft' : 'menu'); soundPanel();
}
window.uploadMusic = uploadMusic;
function soundPanel() {
  const st = Sound.st;
  modal(`<h3>声音设置</h3><div class="snd-panel">
    <label>背景音乐<input type="range" min="0" max="1" step="0.05" value="${st.music}" oninput="Sound.set('music',+this.value)"></label>
    <label>音效<input type="range" min="0" max="1" step="0.05" value="${st.sfx}" oninput="Sound.set('sfx',+this.value);Sound.sfx('click')"></label>
    <label class="ck"><input type="checkbox" ${st.mute ? 'checked' : ''} onchange="Sound.set('mute',this.checked);document.getElementById('snd-btn').textContent=this.checked?'🔇':'🔊'"> 静音</label>
    <label>配乐来源<select onchange="Sound.set('src',this.value);soundPanel()"><option value="auto" ${st.src !== 'synth' ? 'selected' : ''}>官方原声带（自备，优先）</option><option value="synth" ${st.src === 'synth' ? 'selected' : ''}>内置合成配乐</option></select></label>
    ${(() => { const E = Sound.ext, T = E ? E.tracks : {}, n = Object.values(T).reduce((a, l) => a + l.length, 0), CN = { title: '标题', menu: '菜单', draft: '选牌/抽卡', battle: '对战', win: '胜利', lose: '失败' };
      return `<div class="ost-box"><b>原声带：${n ? `已找到 ${n} 首` : '未放入'}</b>
        <div class="ost-sc">${Object.keys(CN).map(k => `<span class="${(T[k] || []).length ? 'on' : ''}">${CN[k]} ${(T[k] || []).length}</span>`).join('')}</div>
        <p>内置配乐是程序合成的<b>原创仿作</b>，并非官方音乐。官方原声带受版权保护，无法随网站附带；如已购买《Palworld Original Soundtrack》（Steam DLC），把音频文件放入服务器目录即可替换：</p>
        <label class="ost-up">⬆ 选择音频文件上传（可多选）<input type="file" accept="audio/*" multiple onchange="uploadMusic(this.files)" hidden></label>
        <p>按曲名自动归类：<b>Hello, Palworld</b> → 标题/主菜单（优先播放）；<b>Bosses / Engraved in Myth / Savage Dudes</b> → 对局战斗（轮播）。也可手动放入：</p>
        <code>${esc(E ? E.dir : 'userdata/music')}/&lt;场景&gt;/</code>
        <p>场景文件夹：title 标题 · menu 菜单 · draft 选牌/抽卡 · battle 对战 · win 胜利 · lose 失败。支持 mp3 / ogg / m4a / flac / wav，同一文件夹多首会随机轮播；放好后刷新页面。</p></div>`; })()}</div>
    <p style="text-align:right"><button class="primary" onclick="closeModal()">完成</button></p>`);
}
// 首屏：卡牌扇形 + 视差
function heroFx() {
  const h = $('#hero2'); if (!h) return;
  h.addEventListener('pointermove', e => { const r = h.getBoundingClientRect(); h.style.setProperty('--px', ((e.clientX - r.left) / r.width - .5).toFixed(3)); h.style.setProperty('--py', ((e.clientY - r.top) / r.height - .5).toFixed(3)); });
  const P = $('#h-particles'); if (P && !P.children.length) P.innerHTML = Array.from({ length: 26 }, () => `<i style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 12).toFixed(1)}s;animation-duration:${(9 + Math.random() * 10).toFixed(1)}s;--s:${(2 + Math.random() * 4).toFixed(1)}px"></i>`).join('');
}

// ---------- 图鉴 / 规则 ----------
function renderGallery() {
  const q = $('#g-text').value.trim();
  const list = App.cards.filter(c => !q || (c.name + c.text + c.ja + c.en).includes(q));
  $('#gallery').innerHTML = list.map(c => c.imgs.map(im => `<div class="ci" data-zoom="${c.id}" data-img="${im}"><div class="fr"><img loading="lazy" src="${imgUrl(im)}"></div><div class="nm">${esc(c.name)}</div></div>`).join('')).join('');
}
function renderRules() {
  $('#rules-text').innerHTML = `<div class="rules">
<h3>胜负</h3><ul><li>生命值降为 0 以下，或卡组为 0 张时败北（双方同时则平局）。初始生命 10。</li><li>受到 N 点伤害时，从卡组顶依次翻开至多 N 张放入墓地；翻到幸运帕鲁☆则整次伤害抵消（☆也进墓地）。所以每次伤害都在"磨"卡组——血量健康时也能靠打空卡组获胜。</li>
<li>受到伤害时，从卡组顶逐张放置入墓地，直至张数等于伤害值；若翻出幸运帕鲁☆，立即停止且该次伤害不扣除生命。否则失去等同伤害的生命。</li></ul>
<h3>卡组</h3><ul><li>主卡组恰好 50 张，同名至多 4 张（《骑士蜂》不限），☆ 至多 8 张，颜色至多 2 种（无色不计）。灵魂卡组 10 张（自动）。</li></ul>
<h3>准备</h3><ul><li>随机决定由谁选择先后攻；后攻玩家先获得 1 灵魂。双方抽 5 张，可各重抽 1 次（全部更换）。</li></ul>
<h3>回合</h3><ul><li>竖置阶段 → 抽卡阶段（先攻第 1 回合不抽）→ 灵魂阶段（灵魂 +2，上限 10）→ 主要阶段 → 结束阶段（伤害清零，"直至回合结束"效果消失）。</li>
<li>主要阶段：使用卡片（横置等同费用的灵魂）、起动【起】能力、用帕鲁攻击、每回合 1 次支付 3 灵魂抽 1 张。</li>
<li>帕鲁上限 5 只，超出时将较早的帕鲁放置入墓地。</li></ul>
<h3>战斗</h3><ul><li>横置竖置的帕鲁攻击：对方玩家、对方建筑物、或对方横置的帕鲁（有【袭击】可攻击竖置帕鲁）。有【嘲讽】时必须优先选择。</li>
<li>阻挡：对方可横置 1 只竖置帕鲁代替目标（【隐秘】无法被阻挡）。快速步骤：非回合玩家可使用【快速】卡与【妨碍】。</li>
<li>伤害：帕鲁之间互相给予等同战斗力的伤害；攻击建筑物时只由攻击方造成伤害；攻击玩家时给予等同打击力的伤害。伤害 ≥ 战斗力/耐久力时破坏。</li></ul>
<h3>关键词</h3><ul><li>勇敢X：攻击时战斗力+X。认真X：任命时选择1只帕鲁战斗力+X。妨碍：从手牌【快速】［①、丢弃此卡］或［丢弃此卡与另1张手牌］使攻击失败。</li>
<li>警戒：你的回合结束时竖置。嘲讽、隐秘、袭击见上。夜行性：黑夜时战斗力+300。复仇：战斗中被放置于墓地时，战斗对手也放置于墓地。突破：攻击中战斗对手帕鲁被放置于墓地时，对对方玩家造成等同打击力的伤害。</li>
<li>任命：横置你竖置的帕鲁以支付建筑物费用。解体：将你据点的帕鲁放置入墓地。</li></ul></div>`;
}
document.addEventListener('mouseover', e => { const z = e.target.closest('[data-zoom]'); if (z) showZoom(z.dataset.zoom, z.dataset.extra, z.closest('.card') || z, z.dataset.img); });
document.addEventListener('mouseout', e => { if (e.target.closest('[data-zoom]')) hideZoom(); });

(async function init() {
  await Account.boot();
  for (const f of await (await fetch('/zh_images.json')).json()) ZH.add(f);
  App.cards = await (await fetch('/api/cards')).json();
  for (const c of App.cards) { App.byId[c.id] = c; for (const v of c.variants) App.byId[v] = App.byId[v] || c; }
  const rc = (localStorage.getItem('ptcg_rndc') || '').split(',').filter(Boolean);
  if (rc.length) $$('#rnd-colors .cc').forEach(b => b.classList.toggle('on', rc.includes(b.dataset.c)));
  $('#pname').value = localStorage.getItem('ptcg_name') || ('玩家' + Math.floor(Math.random() * 1000));
  $('#pname').onchange = () => localStorage.setItem('ptcg_name', $('#pname').value);
  $('#g-text').oninput = renderGallery;
  Builder.init(); if ($('#home-rare')) $('#home-rare').value = localStorage.getItem('ptcg_rare') || '';
  titleFx(); if (Sound.st.mute) $('#snd-btn').textContent = '🔇';
  const r = sessionStorage.getItem('ptcg_room');
  if (r) { App.room = r; connect({ type: 'rejoin', code: r, token: token() }); }
  show(r ? 'menu' : (sessionStorage.getItem('ptcg_seen_title') ? 'menu' : 'title')); sessionStorage.setItem('ptcg_seen_title', 1);
  const hm = location.hash.match(/pve=(easy|normal|hard)/);
  if (hm && !r) { const d = await (await fetch('/api/random-deck')).json(); connect({ type: 'pve', level: hm[1], deck: d, name: pname(), token: token() }); }
  const vm = location.hash.match(/view=(\w+)/); if (vm) show(vm[1]);
})();
