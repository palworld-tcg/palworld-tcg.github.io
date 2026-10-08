// 新手教程：课程列表、对局中的分步引导面板与高亮
const Tutorial = {
  ptr: 0, i: 0, gid: null,
  done() { try { return JSON.parse(localStorage.getItem('ptcg_tut_done') || '{}'); } catch (e) { return {}; } },
  async list() { if (!this.L) this.L = await (await fetch('/api/tutorials')).json(); return this.L; },
  async open() {
    const L = await this.list(), d = this.done(), first = L.find(t => !d[t.id]) || L[0];
    const b = modal(`<h3>🎓 新手教程</h3><p class="muted">五节小课，每节 1～2 分钟，跟着提示一步步操作即可。学完就能和电脑对战了。</p>
      <div class="tut-list">${L.map(t => `<button class="tut-it ${d[t.id] ? 'done' : ''} ${t === first ? 'cur' : ''}" data-tut="${t.id}"><span class="no">${d[t.id] ? '✔' : t.no}</span><span class="tx"><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></span><span class="go">${d[t.id] ? '再学一次' : '开始'} ▶</span></button>`).join('')}</div>
      <p style="text-align:right"><button onclick="closeModal()">关闭</button></p>`);
    b.querySelectorAll('[data-tut]').forEach(x => x.onclick = () => { closeModal(); this.start(x.dataset.tut); });
  },
  start(id) { this.gid = null; connect({ type: 'pve', tutorial: id, name: pname(), token: token() }); },
  // 根据最新状态推进步骤：log 步骤在新出现的对局记录中匹配；获胜直接到最后一步
  sync(s) {
    const T = s.tutorial;
    if (this.gid !== s.gid || this.tid !== T.id) { this.gid = s.gid; this.tid = T.id; this.i = 0; this.ptr = 0; }
    const base = s.logN - s.log.length;
    if (this.ptr > s.logN) this.ptr = s.logN;   // 悔棋后记录变短
    for (;;) {
      const st = T.steps[this.i]; if (!st || st.next || st.win || !st.log) break;
      const re = new RegExp(st.log); let hit = -1;
      for (let k = Math.max(this.ptr, base); k < s.logN; k++) if (re.test(s.log[k - base])) { hit = k; break; }
      if (hit < 0) break;
      this.ptr = hit + 1; this.i++;
    }
    if (s.over && s.over.winner === s.me) this.i = T.steps.length - 1;
  },
  html(s) {
    this.sync(s);
    const T = s.tutorial, st = T.steps[this.i] || {}, n = T.steps.length;
    const win = s.over && s.over.winner === s.me;
    const top = s.deckTop && T.id === 't3' && !win ? `<div class="tut-top">对手卡组顶 → ${s.deckTop[1].map(id => `<img src="${cardImg(id)}" data-zoom="${id}">`).join('')}</div>` : '';
    return `<div class="tutbox"><div class="tut-h"><span>🎓 ${esc(T.title)}</span><small>${Math.min(this.i + 1, n)} / ${n}</small></div>
      <div class="tut-bar"><i style="width:${(win ? n : this.i) / n * 100}%"></i></div>
      <div class="tut-t">${win ? '🎉 <b>完成！</b>' + (T.next ? '继续下一课吧。' : '你已经学会了基本玩法，去「对战」挑战电脑吧！') : st.text || ''}</div>${top}
      <div class="tut-row">${st.next && !win ? '<button class="primary" id="tut-next">继续 ▶</button>' : ''}<button id="tut-re">↻ 重来</button><button id="tut-list">课程列表</button></div></div>`;
  },
  bind(s) {
    const T = s.tutorial, st = T.steps[this.i] || {};
    const nx = $('#tut-next'); if (nx) nx.onclick = () => { this.i++; Game.render(); };
    const re = $('#tut-re'); if (re) re.onclick = () => { Game.leave(); setTimeout(() => this.start(T.id), 250); };
    const ls = $('#tut-list'); if (ls) ls.onclick = () => { Game.leave(); setTimeout(() => this.open(), 250); };
    if (s.over) return;
    const SEL = { op: '.plaque.op', me: '.plaque.me', end: '#endbtn', souls: '[data-souls="me"]', deck: '[data-pile="me-deck"]' };
    for (const h of st.hl || []) {
      const els = SEL[h] ? $$(SEL[h]) : $$(`#mat .card[data-zoom="${h}"]`);
      els.forEach(e => e.classList.add('tut-hl'));
    }
  },
  result(s) {
    const T = s.tutorial, win = s.over.winner === s.me;
    if (win) { const d = this.done(); d[T.id] = 1; localStorage.setItem('ptcg_tut_done', JSON.stringify(d)); }
    return `<div class="row" style="justify-content:center;margin:8px 0;gap:8px">
      <button onclick="Game.leave();setTimeout(()=>Tutorial.start('${T.id}'),250)">↻ 再来一次</button>
      ${win && T.next ? `<button class="primary" onclick="Game.leave();setTimeout(()=>Tutorial.start('${T.next}'),250)">下一课 ▶</button>` : ''}
      ${win && !T.next ? `<button class="primary" onclick="Game.leave();setTimeout(()=>show('home'),250)">去对战电脑 ▶</button>` : ''}
      <button onclick="Game.leave();setTimeout(()=>Tutorial.open(),250)">课程列表</button></div>`;
  },
};
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .tutbox{position:absolute;left:190px;top:4px;z-index:56;width:440px;background:#14202ff2;border:2px solid #ffd75a;border-radius:12px;color:#f3ecdc;font-size:14px;line-height:1.65;padding:8px 12px;box-shadow:0 6px 24px #0008}
  .tutbox .tut-h{display:flex;justify-content:space-between;font-weight:900;color:#ffd75a}.tutbox .tut-h small{color:#cdbb8a;font-weight:400}
  .tutbox .tut-bar{height:4px;background:#ffffff1c;border-radius:2px;margin:4px 0 6px;overflow:hidden}.tutbox .tut-bar i{display:block;height:100%;background:#ffd75a;transition:width .4s}
  .tutbox .tut-t b{color:#ffe7a8}
  .tutbox .tut-row{display:flex;gap:6px;margin-top:8px}.tutbox .tut-row button{padding:4px 12px;font-size:13px}
  .tutbox .tut-top{margin-top:6px;font-size:12px;color:#cdbb8a;display:flex;align-items:center;gap:6px}.tutbox .tut-top img{height:54px;border-radius:4px}
  .tut-hl{outline:3px solid #ffd75a!important;outline-offset:3px;border-radius:10px;animation:tutPulse 1.1s ease-in-out infinite;z-index:30}
  @keyframes tutPulse{0%,100%{box-shadow:0 0 0 0 #ffd75a00}50%{box-shadow:0 0 18px 6px #ffd75acc}}
  .tut-list{display:flex;flex-direction:column;gap:8px;margin:12px 0}
  .tut-it{display:flex;align-items:center;gap:12px;text-align:left;padding:10px 14px;border-radius:10px;width:100%}
  .tut-it .no{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#0002;font-weight:900;flex:none}
  .tut-it.done .no{background:#3c8a4e;color:#fff}.tut-it.cur{outline:2px solid #ffd75a}
  .tut-it .tx{flex:1;display:flex;flex-direction:column}.tut-it .tx small{opacity:.7}.tut-it .go{opacity:.8;font-size:13px}`;
  document.head.appendChild(css);
})();
