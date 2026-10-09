// 新手教程：课程列表、对局中的分步引导面板与高亮
const Tutorial = {
  ptr: 0, i: 0, gid: null,
  done() { try { return JSON.parse(localStorage.getItem('ptcg_tut_done') || '{}'); } catch (e) { return {}; } },
  async list() { if (!this.L) this.L = await (await fetch('/api/tutorials')).json(); return this.L; },
  async open() {
    const L = await this.list(), d = this.done(), first = L.find(t => !d[t.id]) || L[0];
    const b = modal(`<h3>🎓 新手教程</h3><p class="muted">八节小课，每节 1～2 分钟，跟着发光的手指操作即可：出牌、攻击、阻挡、幸运☆、建筑物、事件、装备、妨碍和防守。</p>
      <div class="tut-list">${L.map(t => `<button class="tut-it ${d[t.id] ? 'done' : ''} ${t === first ? 'cur' : ''}" data-tut="${t.id}"><span class="no">${d[t.id] ? '✔' : t.no}</span><span class="tx"><b>${esc(t.title)}</b><small>${esc(t.desc)}</small></span><span class="go">${d[t.id] ? '再学一次' : '开始'} ▶</span></button>`).join('')}</div>
      <p style="text-align:right"><button onclick="closeModal()">关闭</button></p>`);
    b.querySelectorAll('[data-tut]').forEach(x => x.onclick = () => { closeModal(); this.start(x.dataset.tut); });
  },
  start(id) { this.gid = null; this.clear(); connect({ type: 'pve', tutorial: id, name: pname(), token: token() }); },
  // 直接切换到另一课（不回主菜单）
  go(id) { this.clear(); $$('#batarrow,#arrow,.droplbl').forEach(x => x.remove()); Game.revealing.forEach(R => Game.dropReveal(R)); Game.revealing = []; send({ type: 'leave' }); App.room = null; sessionStorage.removeItem('ptcg_room'); setTimeout(() => this.start(id), 120); },
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
    const top = s.deckTop && T.id === 't3' && !win ? `<div class="tut-top">对手卡组顶 → ${s.deckTop[1].slice(0, 3).map(id => `<span class="tc ${App.byId[id] && App.byId[id].lucky ? 'lk' : ''}" data-zoom="${id}" style="background-image:url('${cardImg(id)}')"></span>`).join('')}</div>` : '';
    return `<div class="tutbox ${this.mini && !win ? 'mini' : ''}"><div class="tut-h" id="tut-h" title="点击收起/展开"><span>🎓 ${esc(T.title)}</span><small>${Math.min(this.i + 1, n)} / ${n} ${this.mini ? '▸' : '▾'}</small></div>
      <div class="tut-bar"><i style="width:${(win ? n : this.i) / n * 100}%"></i></div>
      <div class="tut-t">${win ? '🎉 <b>完成！</b>' + (T.next ? '继续下一课吧。' : '你已经学会了基本玩法，去「对战」挑战电脑吧！') : st.text || ''}</div>${top}
      <div class="tut-row">${st.next && !win ? '<button class="primary" id="tut-next">继续 ▶</button>' : ''}<button id="tut-re">↻ 重来</button><button id="tut-list">课程列表</button></div></div>`;
  },
  bind(s) {
    const T = s.tutorial, st = T.steps[this.i] || {};
    const hh = $('#tut-h'); if (hh) hh.onclick = () => { this.mini = !this.mini; Game.render(); };
    const nx = $('#tut-next'); if (nx) nx.onclick = () => { this.i++; Game.render(); };
    const re = $('#tut-re'); if (re) re.onclick = () => this.go(T.id);
    const ls = $('#tut-list'); if (ls) ls.onclick = () => { this.clear(); Game.leave(); setTimeout(() => this.open(), 250); };
    this.guide(s);
  },
  // ---------- 视觉引导：高亮光圈 + 手指演示（拖动 / 点击） ----------
  els(k) {
    const SEL = { op: '.plaque.op', me: '.plaque.me', end: '#endbtn', souls: '[data-souls="me"]', deck: '[data-pile="me-deck"]', opdeck: '[data-pile="op-deck"]', hand: '#hand', mpal: '[data-lane="mpal"]', mbld: '[data-lane="mbld"]' };
    if (SEL[k]) return $$('#board ' + SEL[k]);
    const m = /^(me|op):(.+)$/.exec(k), id = m ? m[2] : k;
    const sc = m ? (m[1] === 'op' ? '[data-lane^="o"]' : '[data-lane^="m"],#board #hand') : '[data-lane],#board #hand';
    return sc.split(',').flatMap(z => $$(`#board ${z.trim()} .card${id === '*' ? '' : `[data-zoom="${id}"]`}`));
  },
  clear() { clearTimeout(this._t); const L = $('#tutfx'); if (L) L.remove(); },
  guide(s) {
    this.clear();
    if (s.over || !s.tutorial) return;
    const st = s.tutorial.steps[this.i] || {};
    const draw = () => {
      let L = $('#tutfx'); if (L) L.innerHTML = ''; else { L = document.createElement('div'); L.id = 'tutfx'; document.body.appendChild(L); }
      if (!s.ask || document.body.classList.contains('dragging-now') || $('.ctxmenu')) return;
      const R = e => e.getBoundingClientRect(), C = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      const ring = (e, cls = '') => { const r = R(e); if (!r.width) return; const d = document.createElement('div'); d.className = 'tut-ring ' + cls; const p = 5;
        d.style.cssText = `left:${r.left - p}px;top:${r.top - p}px;width:${r.width + 2 * p}px;height:${r.height + 2 * p}px;border-radius:${getComputedStyle(e).borderRadius === '50%' || e.id === 'endbtn' ? '50%' : '12px'}`; L.appendChild(d); };
      const first = k => this.els(k).find(e => R(e).width);
      (st.hl || []).forEach(k => this.els(k).forEach(e => ring(e, 'soft')));
      if (st.drag) {
        const a = first(st.drag[0]), b = first(st.drag[1]); if (!a || !b) return;
        ring(a); ring(b, 'dst');
        const p = C(R(a)), q = C(R(b)), mx = (p.x + q.x) / 2, my = Math.min(p.y, q.y) - 70;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'tut-path');
        svg.innerHTML = `<path d="M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}"/>`; L.appendChild(svg);
        const f = document.createElement('div'); f.className = 'tut-finger'; f.innerHTML = '<i></i><b>👆</b>'; L.appendChild(f);
        const pt = t => ({ x: (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * mx + t * t * q.x, y: (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * my + t * t * q.y });
        const K = []; for (let i = 0; i <= 10; i++) { const o = pt(i / 10); K.push({ transform: `translate(${o.x}px,${o.y}px)`, offset: .2 + i / 10 * .55 }); }
        f.animate([{ transform: `translate(${p.x}px,${p.y}px)`, opacity: 0, offset: 0 }, { transform: `translate(${p.x}px,${p.y}px)`, opacity: 1, offset: .12 }, ...K, { transform: `translate(${q.x}px,${q.y}px)`, opacity: 1, offset: .88 }, { transform: `translate(${q.x}px,${q.y}px)`, opacity: 0, offset: 1 }], { duration: 2200, iterations: Infinity, easing: 'ease-in-out' });
        if (!a.closest('.lane')) { const gh = document.createElement('div'); gh.className = 'tut-ghost'; const im = a.querySelector('img'); if (im) gh.innerHTML = `<img src="${im.src}">`; const r = R(a); gh.style.width = r.width + 'px'; gh.style.height = r.height + 'px'; gh.style.margin = `${-r.height / 2}px 0 0 ${-r.width / 2}px`; L.appendChild(gh);
          gh.animate([{ transform: `translate(${p.x}px,${p.y}px)`, opacity: 0, offset: 0 }, { transform: `translate(${p.x}px,${p.y}px)`, opacity: .55, offset: .2 }, ...K.map(k => ({ ...k, opacity: .55 })), { transform: `translate(${q.x}px,${q.y}px) scale(.9)`, opacity: 0, offset: .9 }, { transform: `translate(${q.x}px,${q.y}px)`, opacity: 0, offset: 1 }], { duration: 2200, iterations: Infinity, easing: 'ease-in-out' }); }
      }
      if (st.tap) {
        const e = first(st.tap); if (!e) return; ring(e, 'dst');
        const c = C(R(e)); const f = document.createElement('div'); f.className = 'tut-finger tap'; f.style.transform = `translate(${c.x}px,${c.y}px)`; f.innerHTML = '<i></i><b>👆</b>'; L.appendChild(f);
      }
      if (st.next && !this.mini) { const n = $('#tut-next'); if (n) n.classList.add('tut-go'); }
    };
    draw(); this._t = setTimeout(draw, 700);   // 等飞行动画落位后再校准一次
  },
  result(s) {
    const T = s.tutorial, win = s.over.winner === s.me;
    if (win) { const d = this.done(); d[T.id] = 1; localStorage.setItem('ptcg_tut_done', JSON.stringify(d)); }
    return `<div class="row" style="justify-content:center;margin:8px 0;gap:8px">
      <button onclick="Tutorial.go('${T.id}')">↻ 再来一次</button>
      ${win && T.next ? `<button class="primary" onclick="Tutorial.go('${T.next}')">下一课 ▶</button>` : ''}
      ${win && !T.next ? `<button class="primary" onclick="Game.leave();setTimeout(()=>show('home'),250)">去对战电脑 ▶</button>` : ''}
      <button onclick="Tutorial.clear();Game.leave();setTimeout(()=>Tutorial.open(),250)">课程列表</button></div>`;
  },
};
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .tutbox{position:absolute;left:190px;top:4px;z-index:56;width:440px;background:#14202ff2;border:2px solid #ffd75a;border-radius:12px;color:#f3ecdc;font-size:14px;line-height:1.65;padding:8px 12px;box-shadow:0 6px 24px #0008}
  .tutbox.mini .tut-bar,.tutbox.mini .tut-t,.tutbox.mini .tut-row,.tutbox.mini .tut-top{display:none}.tutbox .tut-h{cursor:pointer;display:flex;justify-content:space-between;font-weight:900;color:#ffd75a}.tutbox .tut-h small{color:#cdbb8a;font-weight:400}
  .tutbox .tut-bar{height:4px;background:#ffffff1c;border-radius:2px;margin:4px 0 6px;overflow:hidden}.tutbox .tut-bar i{display:block;height:100%;background:#ffd75a;transition:width .4s}
  .tutbox .tut-t b{color:#ffe7a8}
  .tutbox .tut-row{display:flex;gap:6px;margin-top:8px}.tutbox .tut-row button{padding:4px 12px;font-size:13px}
  .tutbox .tut-top{margin-top:6px;font-size:12px;color:#cdbb8a;display:flex;align-items:center;gap:6px}.tutbox .tut-top .tc{display:block;height:60px;width:43px;background:center/cover no-repeat;border-radius:4px;flex:none}
  .tutbox .tut-top .tc.lk{box-shadow:0 0 0 2px #ffd54a,0 0 12px #ffd54a}
  #tutfx{position:fixed;inset:0;pointer-events:none;z-index:57}
  #tutfx>*{position:fixed;pointer-events:none}
  .tut-ring{border:3px solid #ffd75a;box-shadow:0 0 18px 4px #ffd75a99,inset 0 0 14px #ffd75a55;animation:tutRing 1.2s ease-in-out infinite}
  .tut-ring.soft{border-width:2px;border-style:dashed;box-shadow:0 0 10px #ffd75a66;animation:none;opacity:.8}
  .tut-ring.dst{border-color:#7dffb0;box-shadow:0 0 20px 4px #3cff8a88,inset 0 0 14px #3cff8a44}
  @keyframes tutRing{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.04);opacity:1}}
  .tut-path{left:0;top:0;width:100vw;height:100vh;overflow:visible}.tut-path path{fill:none;stroke:#ffd75a;stroke-width:4;stroke-dasharray:3 12;stroke-linecap:round;opacity:.85;animation:tutDash .8s linear infinite}
  @keyframes tutDash{to{stroke-dashoffset:-15}}
  .tut-finger{left:0;top:0;width:0;height:0}
  .tut-finger b{position:absolute;left:-6px;top:4px;font-size:40px;filter:drop-shadow(0 3px 6px #000c) drop-shadow(0 0 8px #fff8)}
  .tut-finger i{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;background:radial-gradient(circle,#fff,#ffd75a66 60%,transparent 70%)}
  .tut-finger.tap b{animation:tutTap 1.2s ease-in-out infinite}
  .tut-finger.tap i{animation:tutRip 1.2s ease-out infinite}
  @keyframes tutTap{0%,100%{transform:translate(8px,14px)}40%{transform:translate(0,0)}55%{transform:translate(0,0) scale(.9)}}
  @keyframes tutRip{0%,40%{transform:scale(.3);opacity:0}50%{opacity:1}100%{transform:scale(2.2);opacity:0}}
  .tut-ghost{left:0;top:0;border-radius:8px;overflow:hidden;filter:drop-shadow(0 10px 14px #000a)}.tut-ghost img{width:100%;height:100%;object-fit:cover}
  #tut-next.tut-go{animation:tutPulse 1.1s ease-in-out infinite}
  @keyframes tutPulse{0%,100%{box-shadow:0 0 0 0 #ffd75a00}50%{box-shadow:0 0 18px 6px #ffd75acc}}
  .tut-list{display:flex;flex-direction:column;gap:8px;margin:12px 0}
  .tut-it{display:flex;align-items:center;gap:12px;text-align:left;padding:10px 14px;border-radius:10px;width:100%}
  .tut-it .no{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#0002;font-weight:900;flex:none}
  .tut-it.done .no{background:#3c8a4e;color:#fff}.tut-it.cur{outline:2px solid #ffd75a}
  .tut-it .tx{flex:1;display:flex;flex-direction:column}.tut-it .tx small{opacity:.7}.tut-it .go{opacity:.8;font-size:13px}`;
  document.head.appendChild(css);
})();
// 离开对局时清理教程引导与残留箭头
document.addEventListener('DOMContentLoaded', () => {
  const lv = Game.leave;
  Game.leave = function (...a) { Tutorial.clear(); $$('#batarrow,#arrow,.droplbl').forEach(x => x.remove()); return lv.apply(this, a); };
});
addEventListener('resize', () => { const s = Game.last && Game.last.state; if (s && s.tutorial && document.body.classList.contains('ingame')) Tutorial.guide(s); });
