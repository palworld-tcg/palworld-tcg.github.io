// 局内动态演出（第二层）：能用动画表达的，尽量不用文字
//  · 攻击箭头：攻击者 → 目标的持续弧线与准星；阻挡时箭头改道并弹出盾牌；妨碍时箭头碎裂
//  · 战斗对撞：双方战斗力数字飞向中点碰撞
//  · 灵魂支付：灵魂水晶飞向打出的卡 / 起动的建筑
//  · 生命：失去的生命格碎裂掉落；低生命时屏幕边缘泛红心跳
//  · 幸运☆抵消：星芒护盾；任命：帕鲁与建筑之间的光束；竖置：卡面扫光
//  · 对手抽卡：卡背从卡组飞入手牌；卡组见底：卡组计数红色警示
//  · 对局记录字幕前加图标
(() => {
  if (typeof Game === 'undefined') return;
  const $1 = s => document.querySelector(s), $all = s => [...document.querySelectorAll(s)];
  const R = el => el.getBoundingClientRect();
  const C = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const T = ms => Game.T(ms);
  const fast = () => Game.replayFast;
  const cardEl = uid => $1(`#board .card[data-uid="${uid}"]`);
  const heartEl = side => $1(`#board [data-plaque="${side}"] .heart`);
  const layer = () => { let l = $1('#fx2'); if (!l) { l = document.createElement('div'); l.id = 'fx2'; document.body.appendChild(l); } return l; };
  const add = (cls, css, html = '') => { const d = document.createElement('div'); d.className = cls; if (css) d.style.cssText = css; d.innerHTML = html; layer().appendChild(d); return d; };
  const anim = (el, k, o) => { const a = el.animate(k, { ...o, duration: T(o.duration), delay: T(o.delay || 0) }); return a; };
  const kill = (el, ms) => setTimeout(() => el.remove(), T(ms));

  // ---------- 攻击箭头（随每次重绘重新定位） ----------
  function arrow(s) {
    let svg = $1('#batarrow');
    const B = s && !s.over && s.battle;
    const ae = B && cardEl(B.att);
    const def = B && (s.active === s.me ? 'op' : 'me');
    const te = B && (B.target === 'player' ? heartEl(def) : cardEl(B.target));
    if (!B || !ae || !te || document.body.classList.contains('dragging-now')) { if (svg) svg.remove(); return; }
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'batarrow';
      svg.innerHTML = `<defs><linearGradient id="baG" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffb347" stop-opacity=".2"/><stop offset="1" stop-color="#ff2d2d"/></linearGradient>
        <marker id="baH" markerWidth="5" markerHeight="5" refX="2.6" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" fill="#ff2d2d"/></marker>
        <filter id="baF"><feGaussianBlur stdDeviation="4"/></filter></defs>
        <path class="glow" filter="url(#baF)"/><path class="main" marker-end="url(#baH)"/><path class="flow"/>
        <g class="reticle"><circle r="30"/><circle r="20" class="in"/></g><g class="shield"><path d="M0,-26 L22,-17 L19,8 Q12,22 0,28 Q-12,22 -19,8 L-22,-17 Z"/><text y="8">🛡</text></g>`;
      document.body.appendChild(svg);
    }
    const a = C(R(ae.querySelector('.in') || ae)), t = C(R(te));
    const dx = t.x - a.x, dy = t.y - a.y, L = Math.hypot(dx, dy) || 1;
    const bend = Math.min(120, L * .25), cx = (a.x + t.x) / 2 - dy / L * bend, cy = (a.y + t.y) / 2 + dx / L * bend;
    const ex = t.x - (t.x - cx) / Math.hypot(t.x - cx, t.y - cy) * 34, ey = t.y - (t.y - cy) / Math.hypot(t.x - cx, t.y - cy) * 34;
    const d = `M${a.x},${a.y} Q${cx},${cy} ${ex},${ey}`;
    svg.querySelectorAll('path.glow,path.main,path.flow').forEach(p => p.setAttribute('d', d));
    svg.querySelector('linearGradient').setAttribute('x1', a.x); svg.querySelector('linearGradient').setAttribute('y1', a.y);
    svg.querySelector('linearGradient').setAttribute('x2', t.x); svg.querySelector('linearGradient').setAttribute('y2', t.y);
    svg.querySelector('.reticle').setAttribute('transform', `translate(${t.x},${t.y})`);
    svg.querySelector('.shield').setAttribute('transform', `translate(${t.x},${t.y - R(te).height / 2 - 8})`);
    svg.classList.toggle('blocked', !!B.blocked); svg.classList.toggle('failed', !!B.failed);
  }

  // ---------- 各类演出 ----------
  // 屏幕中央的大号印章：阻挡 / 妨碍 等关键应对，配上使用的卡
  const idByName = n => { n = n.replace(/[《》]/g, ''); const c = Object.values(App.byId).find(x => x.name === n); return c && c.id; };
  function banner(title, sub, kind, cardId) {
    $$('.fx2-ban').forEach(x => x.remove());
    const d = add('fx2-ban ' + kind, '', `<div class="bg"></div>${cardId ? `<span class="cd" style="background-image:url('${cardImg(cardId)}')"></span>` : ''}<div class="tx"><b>${title}</b><small>${sub}</small></div>`);
    anim(d.querySelector('.bg'), [{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1, offset: .15 }, { transform: 'scaleY(1)', opacity: 1, offset: .85 }, { transform: 'scaleY(0)', opacity: 0 }], { duration: 1500, easing: 'ease-out' });
    anim(d.querySelector('.tx'), [{ transform: 'scale(2.4)', opacity: 0 }, { transform: 'scale(.95)', opacity: 1, offset: .18 }, { transform: 'scale(1)', opacity: 1, offset: .85 }, { transform: 'scale(1)', opacity: 0 }], { duration: 1500, easing: 'cubic-bezier(.2,.8,.3,1)' });
    const cd = d.querySelector('.cd'); if (cd) anim(cd, [{ transform: 'translateX(-120px) rotate(-14deg)', opacity: 0 }, { transform: 'translateX(0) rotate(-6deg)', opacity: 1, offset: .2 }, { transform: 'translateX(0) rotate(-6deg)', opacity: 1, offset: .85 }, { transform: 'translateX(40px) rotate(-6deg)', opacity: 0 }], { duration: 1500, easing: 'ease-out' });
    document.body.classList.add('fx2-shake'); setTimeout(() => document.body.classList.remove('fx2-shake'), 400);
    kill(d, 1550); Sound.sfx(kind === 'hinder' ? 'hit' : 'confirm');
  }
  function shieldPop(r) {
    const c = C(r);
    const d = add('fx2-shield', `left:${c.x}px;top:${c.y}px`, '<i></i><b>🛡</b>');
    anim(d, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .35 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 0 }], { duration: 1100, easing: 'ease-out' });
    kill(d, 1150); Sound.sfx('confirm');
  }
  function barrier(r, el) {
    const c = C(r);
    const d = add('fx2-barrier', `left:${c.x}px;top:${c.y - r.height * .1}px`, '<b>✋</b>' + Array.from({ length: 8 }, (_, i) => `<em style="--a:${i * 45 + 20}deg"></em>`).join(''));
    anim(d, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 0 }], { duration: 1200 });
    kill(d, 1250);
    if (el) anim(el, [{ transform: 'none' }, { transform: 'translateY(14px) rotate(-4deg)', offset: .3 }, { transform: 'translateY(-4px)', offset: .6 }, { transform: 'none' }], { duration: 600, delay: 150 });
    Sound.sfx('hit');
  }
  function clash(ra, rb, pa, pb, win) {
    const a = C(ra), b = C(rb), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const chip = (p, from, cls) => {
      const d = add('fx2-pow ' + cls, `left:0;top:0`, `⚔${p}`);
      anim(d, [{ transform: `translate(${from.x}px,${from.y}px) translate(-50%,-50%) scale(.6)`, opacity: 0 },
        { transform: `translate(${from.x}px,${from.y}px) translate(-50%,-50%) scale(1.2)`, opacity: 1, offset: .25 },
        { transform: `translate(${m.x + (from.x - m.x) * .12}px,${m.y + (from.y - m.y) * .12}px) translate(-50%,-50%) scale(1.1)`, opacity: 1, offset: .62 },
        { transform: `translate(${m.x + (from.x - m.x) * .35}px,${m.y + (from.y - m.y) * .35}px) translate(-50%,-50%) scale(.9)`, opacity: 0 }], { duration: 1000, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
      kill(d, 1050);
    };
    chip(pa, a, win === 0 ? 'win' : win === 1 ? 'lose' : ''); chip(pb, b, win === 1 ? 'win' : win === 0 ? 'lose' : '');
    setTimeout(() => {
      const f = add('fx2-burst', `left:${m.x}px;top:${m.y}px`);
      anim(f, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }], { duration: 500, easing: 'ease-out' });
      kill(f, 520); Game.sparks({ left: m.x - 20, top: m.y - 20, width: 40, height: 40 }, 20, '#ffe08a');
    }, T(600));
    return 1000;
  }
  function souls(fromEls, toRect, delay = 0) {
    const t = C(toRect);
    fromEls.forEach((s, k) => {
      const f = C(R(s)), d = add('fx2-soul', 'left:0;top:0');
      const mx = (f.x + t.x) / 2 + (k - fromEls.length / 2) * 30, my = Math.min(f.y, t.y) - 60;
      anim(d, [{ transform: `translate(${f.x}px,${f.y}px) scale(1)`, opacity: 1 }, { transform: `translate(${mx}px,${my}px) scale(1.3)`, opacity: 1, offset: .45 }, { transform: `translate(${t.x}px,${t.y}px) scale(.4)`, opacity: 0 }],
        { duration: 650, delay: delay + k * 90, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' });
      kill(d, delay + k * 90 + 700);
    });
    setTimeout(() => Game.fx('ring', toRect), T(delay + fromEls.length * 90 + 600));
  }
  function shatterPips(side, from, to) {
    const pips = $all(`#board [data-plaque="${side}"] .lifebar i`).slice(to, from);
    pips.forEach((p, k) => {
      const r = R(p);
      for (let j = 0; j < 4; j++) {
        const d = add('fx2-shard', `left:${r.left + r.width * Math.random()}px;top:${r.top}px`);
        const vx = (Math.random() - .5) * 60, vy = 30 + Math.random() * 50;
        anim(d, [{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${vx}px,${vy}px) rotate(${Math.random() * 540}deg)`, opacity: 0 }], { duration: 800, delay: k * 70, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'both' });
        kill(d, 900 + k * 70);
      }
      anim(p, [{ background: '#fff', transform: 'scaleY(1.8)' }, { transform: 'none' }], { duration: 400, delay: k * 70 });
    });
  }
  function luckyShield(side, delay) {
    setTimeout(() => {
      const h = heartEl(side); if (!h) return;
      const c = C(R(h)), d = add('fx2-lucky', `left:${c.x}px;top:${c.y}px`, '<i></i><b>☆</b>' + Array.from({ length: 10 }, (_, i) => `<em style="--a:${i * 36}deg"></em>`).join(''));
      anim(d, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .8 }, { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 0 }], { duration: 1500 });
      kill(d, 1550); Sound.sfx('soul');
    }, T(delay));
  }
  function beam(ea, eb) {
    const a = C(R(ea)), b = C(R(eb)), L = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const d = add('fx2-beam', `left:${a.x}px;top:${a.y}px;width:${L}px;transform:rotate(${ang}rad)`);
    anim(d, [{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: .5 }, { clipPath: 'inset(0 0 0 100%)', opacity: .2 }], { duration: 900, easing: 'ease-in-out' });
    kill(d, 950);
    setTimeout(() => { Game.fx('ring', R(eb)); anim(eb, [{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 500 }); }, T(450));
  }
  const byName = n => $all('#board .card[data-zoom]').find(el => { const d = App.byId[el.dataset.zoom]; return d && ('《' + d.name + '》' === n || d.name === n); });

  // ---------- 接入 ----------
  const render0 = Game.render.bind(Game);
  Game.render = function () {
    render0();
    const s = this.last && this.last.state; if (!s) return;
    arrow(this.replay && this.replayFast ? null : s);
    const me = s.players[0];
    document.body.classList.toggle('fx2-low', !s.over && me.life <= 3 && me.life > 0);
    s.players.forEach((p, pi) => { const c = $1(`#board [data-pile="${pi === 0 ? 'me' : 'op'}-deck"]`); if (c) c.classList.toggle('low', p.deck <= 5); });
  };
  const animate0 = Game.animate.bind(Game);
  Game.animate = function (before, prev, s) {
    let dur = animate0(before, prev, s);
    if (!prev || fast()) return dur;
    try {
      const pB = prev.battle, B = s.battle;
      const nNew = (s.logN || s.log.length) - (prev.logN || prev.log.length);
      const newLog = nNew > 0 ? s.log.slice(-Math.min(nNew, 12)) : [];
      const find = (st, uid) => st.players.flatMap(p => p.base).find(c => c.uid === uid);
      const uidByName = (st, n) => { const c = st.players.flatMap(p => p.base).find(c => '《' + ((App.byId[c.id] || {}).name) + '》' === n); return c && c.uid; };
      const rectOf = uid => { const o = before.m.get(uid); if (o) return o.r; const el = cardEl(uid); return el && R(el.querySelector('.in')); };
      let blocker = null, t0 = 0, hinderBy = null;
      for (const l of newLog) {
        const mb = l.match(/^(《[^》]+》) 进行阻挡/);
        if (mb) { blocker = uidByName(prev, mb[1]) || uidByName(s, mb[1]); const r = blocker && rectOf(blocker); if (r) { shieldPop(r); t0 = 900; dur = Math.max(dur, 1500); } banner('🛡 阻挡！', mb[1] + ' 挡在了攻击前面', 'block', idByName(mb[1])); }
        const mh = l.match(/^(《[^》]+》) 起动能力：妨碍/); if (mh) hinderBy = mh[1];
        if (/^攻击失败/.test(l) && pB) { const r = rectOf(pB.att); if (r) { barrier(r, cardEl(pB.att)); dur = Math.max(dur, 1500); } banner('✋ 妨碍！', (hinderBy ? hinderBy + ' 使' : '') + '攻击失败', 'hinder', hinderBy && idByName(hinderBy)); }
      }
      if (B && pB && B.att === pB.att && B.blocked && !pB.blocked && !blocker) { const r = rectOf(B.target); if (r) { shieldPop(r); dur = Math.max(dur, 1100); } }
      // 战斗结束：帕鲁之间的对撞
      if (pB && (!B || B.att !== pB.att) && !pB.failed && !newLog.some(l => /^攻击失败/.test(l))) {
        const did = blocker || (pB.target !== 'player' ? pB.target : null);
        const A = find(prev, pB.att), D = did && find(prev, did), ra = rectOf(pB.att), rb = did && rectOf(did);
        if (A && D && D.kind === 'pal' && ra && rb) {
          const aDead = !find(s, pB.att), dDead = !find(s, did);
          setTimeout(() => clash(ra, rb, A.power, D.power, aDead && !dDead ? 1 : dDead && !aDead ? 0 : -1), T(t0));
          dur = Math.max(dur, t0 + 1000);
        }
      }
      s.players.forEach((p, pi) => {
        const q = prev.players[pi], side = pi === 0 ? 'me' : 'op';
        // 灵魂支付
        const paid = (q.soulsStanding || 0) - (p.soulsStanding || 0);
        if (paid > 0 && p.souls >= q.souls - 0) {
          const sv = $all(`#board [data-souls="${side}"] .soul`).slice(p.soulsStanding, p.soulsStanding + paid);
          const fresh = p.base.find(c => !q.base.some(x => x.uid === c.uid));
          const tgt = fresh && cardEl(fresh.uid);
          const to = tgt ? R(tgt.querySelector('.in')) : R($1('#mat .midline') || $1('#mat'));
          if (sv.length) { souls(sv, to); dur = Math.max(dur, 700); }
        }
        // 生命格碎裂
        if (p.life < q.life) shatterPips(side, Math.min(q.life, 10), Math.max(p.life, 0));
        // 竖置扫光
        for (const c of p.base) { const o = q.base.find(x => x.uid === c.uid); if (o && o.rested && !c.rested) { const el = cardEl(c.uid); if (el) { el.classList.remove('fx2-shine'); void el.offsetWidth; el.classList.add('fx2-shine'); } } }
        // 战斗力变化：数字弹跳
        for (const c of p.base) { const o = q.base.find(x => x.uid === c.uid); if (o && c.power !== o.power) { const t = cardEl(c.uid); const pw = t && t.querySelector('.pw'); if (pw) anim(pw, [{ transform: 'scale(1.8)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.3,1.6,.5,1)' }); } }
        // 对手抽卡：卡背从卡组飞入
        if (!p.hand && p.handCount > q.handCount && before.piles[side + '-deck']) {
          const backs = $all('#board .ohand .card').slice(-(p.handCount - q.handCount)), f = before.piles[side + '-deck'];
          backs.forEach((el, k) => { const r = R(el); anim(el, [{ transform: `translate(${f.left - r.left}px,${f.top - r.top}px) scale(.9)`, opacity: .4 }, { transform: el.style.transform || 'none', opacity: 1 }], { duration: 550, delay: k * 120, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'backwards' }); });
        }
        // 幸运☆抵消
        const known = new Set([...q.grave, ...q.exile, ...q.base, ...(q.hand || [])].map(c => c.uid));
        const milled = p.grave.filter(c => !known.has(c.uid));
        if (p.deck < q.deck && milled.some(c => (App.byId[c.id] || {}).lucky) && p.life >= q.life) luckyShield(side, milled.length * 750 + 200);
      });
      // 任命光束（来自新增对局记录）
      const n = (s.logN || s.log.length) - (prev.logN || prev.log.length);
      if (n > 0) for (const l of s.log.slice(-Math.min(n, 8))) {
        const m = l.match(/^(《[^》]+》) 被任命至 (《[^》]+》)$/);
        if (m) { const a = byName(m[1]), b = byName(m[2]); if (a && b) { beam(a, b); dur = Math.max(dur, 900); } }
      }
    } catch (e) { console.warn('fx2', e); }
    return dur;
  };
  // 字幕图标
  const ICON = [[/攻击失败/, '✋'], [/伤害被抵消|幸运/, '⭐'], [/进行阻挡/, '🛡'], [/被破坏|放置于墓地/, '💥'], [/失去 \d+ 点生命/, '💔'], [/受到 \d+ 点伤害|战斗伤害/, '🩸'], [/ 攻击 /, '⚔'], [/被任命至/, '🔨'], [/起动/, '⚙'], [/使用了/, '🃏'], [/抽了|抽 \d/, '📥'], [/灵魂/, '💠'], [/回复|恢复/, '💚']];
  const cap0 = Game.caption.bind(Game);
  Game.caption = function (lines) { cap0(lines); const c = $1('#opcap'); if (!c) return; [...c.children].forEach(d => { const ic = (ICON.find(([re]) => re.test(d.textContent)) || [])[1]; if (ic) d.innerHTML = `<i class="ic">${ic}</i>` + d.innerHTML; }); };
  addEventListener('resize', () => { const s = Game.last && Game.last.state; if (s && document.body.classList.contains('ingame')) arrow(s); });
  // 鼠标悬停卡面光泽
  if (matchMedia('(hover:hover)').matches) document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('#board .card .in'); if (!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%'); c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  }, { passive: true });

  const css = document.createElement('style');
  css.textContent = `
  #fx2{position:fixed;inset:0;pointer-events:none;z-index:186}
  #fx2>div{position:fixed;pointer-events:none}
  #batarrow{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:60;overflow:visible}
  #batarrow path{fill:none;stroke-linecap:round}
  #batarrow .glow{stroke:#ff3b3b;stroke-width:14;opacity:.35}
  #batarrow .main{stroke:url(#baG);stroke-width:6}
  #batarrow .flow{stroke:#fff;stroke-width:2.5;stroke-dasharray:6 22;opacity:.8;animation:baFlow .6s linear infinite}
  @keyframes baFlow{to{stroke-dashoffset:-28}}
  #batarrow .reticle circle{fill:none;stroke:#ff3b3b;stroke-width:3;stroke-dasharray:14 8;animation:baSpin 2.4s linear infinite}
  #batarrow .reticle circle.in{stroke-width:2;stroke-dasharray:4 6;animation-direction:reverse;opacity:.7}
  @keyframes baSpin{to{transform:rotate(360deg)}}
  #batarrow .shield{display:none}
  #batarrow .shield path{fill:#2a6fd6;stroke:#bfe2ff;stroke-width:3}
  #batarrow .shield text{font-size:20px;text-anchor:middle}
  #batarrow.blocked .shield{display:block;animation:baBob 1.4s ease-in-out infinite}
  #batarrow.blocked .glow{stroke:#4aa8ff}#batarrow.blocked .reticle circle{stroke:#4aa8ff}
  @keyframes baBob{50%{transform:translateY(-4px)}}
  #batarrow.failed{filter:grayscale(1);opacity:.45}#batarrow.failed .flow{animation:none;stroke-dasharray:3 14}
  .fx2-shield{width:120px;height:120px;display:grid;place-items:center}
  .fx2-shield i{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,#8fd0ff88,#2a6fd622 60%,transparent 70%);box-shadow:0 0 0 4px #9fd8ff,0 0 40px #4aa8ff}
  .fx2-shield b{font-size:54px;filter:drop-shadow(0 0 10px #4aa8ff)}
  .fx2-ban{position:fixed;left:0;right:0;top:38%;height:130px;z-index:95;pointer-events:none;display:flex;align-items:center;justify-content:center;gap:22px}
  .fx2-ban .bg{position:absolute;inset:0;background:linear-gradient(90deg,#0000,#14202ff0 20%,#14202ff0 80%,#0000);border-top:2px solid var(--bc);border-bottom:2px solid var(--bc);box-shadow:0 0 40px var(--bc)}
  .fx2-ban.block{--bc:#5ab0ff}.fx2-ban.hinder{--bc:#ff5a5a}
  .fx2-ban .cd{position:relative;width:78px;height:109px;background:center/cover;border-radius:6px;box-shadow:0 0 0 2px var(--bc),0 0 24px var(--bc)}
  .fx2-ban .tx{position:relative;display:flex;flex-direction:column;align-items:flex-start}
  .fx2-ban b{font-size:52px;font-weight:900;color:#fff;letter-spacing:4px;text-shadow:0 0 16px var(--bc),0 0 30px var(--bc),0 3px 0 #000}
  .fx2-ban small{font-size:16px;color:#f3ecdc;opacity:.9}
  body.fx2-shake #board{animation:fx2Shake .35s}
  @keyframes fx2Shake{20%{transform:translate(-6px,2px)}40%{transform:translate(5px,-3px)}60%{transform:translate(-3px,2px)}80%{transform:translate(2px,0)}}
  .fx2-barrier{width:150px;height:150px;display:grid;place-items:center}
  .fx2-barrier b{font-size:66px;filter:drop-shadow(0 0 14px #fff) drop-shadow(0 0 22px #ff5050)}
  .fx2-barrier em{position:absolute;left:50%;top:50%;width:70px;height:3px;background:linear-gradient(90deg,#fff,#fff0);transform-origin:0 50%;transform:rotate(var(--a))}
  .fx2-pow{font:900 30px/1 system-ui;color:#fff;padding:6px 14px;border-radius:14px;background:#000c;border:2px solid #ffd54a;text-shadow:0 0 8px #ffb300;white-space:nowrap}
  .fx2-pow.win{border-color:#7dff9a;text-shadow:0 0 10px #3cff6a}.fx2-pow.lose{border-color:#ff6060;color:#ffc8c8}
  .fx2-burst{width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,#fff,#ffe08a 30%,#ff8a3000 70%)}
  .fx2-soul{width:14px;height:20px;margin:-10px 0 0 -7px;border-radius:3px;background:linear-gradient(135deg,#e6f8ff,#4fb8ff);box-shadow:0 0 12px #6cf,0 0 24px #39f}
  .fx2-shard{width:5px;height:4px;background:#ff5a6e;box-shadow:0 0 6px #ff2d4a;border-radius:1px}
  .fx2-lucky{width:170px;height:170px;display:grid;place-items:center}
  .fx2-lucky i{position:absolute;inset:18px;border-radius:50%;background:radial-gradient(circle,#fff6c066,#ffd54a22 60%,transparent 72%);box-shadow:0 0 0 3px #ffe58a,0 0 40px #ffd54a}
  .fx2-lucky b{font-size:60px;color:#ffe58a;text-shadow:0 0 16px #ffb300,0 0 30px #fff}
  .fx2-lucky em{position:absolute;left:50%;top:50%;width:85px;height:2px;background:linear-gradient(90deg,#fff8,#ffd54a00);transform-origin:0 50%;transform:rotate(var(--a))}
  .fx2-beam{height:6px;margin-top:-3px;transform-origin:0 50%;border-radius:3px;background:linear-gradient(90deg,#9be4ff,#fff,#ffd54a);box-shadow:0 0 14px #9be4ff,0 0 28px #ffd54a}
  .card.fx2-shine .in::before{content:"";position:absolute;inset:0;border-radius:var(--r);pointer-events:none;z-index:3;background:linear-gradient(110deg,transparent 30%,#ffffffb0 48%,transparent 66%);background-size:250% 100%;animation:fx2Shine .9s ease-out both}
  @keyframes fx2Shine{from{background-position:130% 0}to{background-position:-60% 0}}
  @media (hover:hover){#board .card .in::after{content:"";position:absolute;inset:0;border-radius:var(--r);pointer-events:none;opacity:0;transition:opacity .25s;background:radial-gradient(circle at var(--mx,50%) var(--my,30%),#ffffff55,transparent 45%);mix-blend-mode:screen}
    #board .card:hover .in::after{opacity:1}}
  body.fx2-low #v-game::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:58;box-shadow:inset 0 0 90px 10px #ff1a3a66;animation:fx2Beat 1.3s ease-in-out infinite}
  @keyframes fx2Beat{0%,100%{opacity:.35}15%{opacity:1}30%{opacity:.5}45%{opacity:.9}}
  .pile.deck.low .cnt{background:#8c1d18;border-color:#ff6b6b;color:#fff;animation:fx2Low 1s ease-in-out infinite}
  @keyframes fx2Low{50%{transform:scale(1.2);box-shadow:0 0 12px #ff3030}}
  #opcap .ic{font-style:normal;margin-right:6px;display:inline-block;animation:fx2Ic .4s cubic-bezier(.3,1.8,.5,1)}
  @keyframes fx2Ic{from{transform:scale(0)}}
  @media (prefers-reduced-motion:reduce){#batarrow .flow,#batarrow .reticle circle,body.fx2-low #v-game::after{animation:none}}`;
  document.head.appendChild(css);
})();
