'use strict';
// 稀有卡特效（对局打出 & 抽卡翻开共用）
//   1 小特效：带 S 的稀有（SR / TSR）——卡面流光 + 少量星光
//   2 中特效：全画卡（OSR / 全画 PR）——卡牌飞到中央亮相 + 光环
//   3 大特效：金名卡（SP / TSP）——暗场、金色光芒旋转、粒子爆发、卡名横幅
//   4 特大特效：金名 + 金框（SSP / SSS）——白闪、冲击波、震屏、彩虹全息、满屏金粉
const RareFx = {
  rar: null, NAME: { 1: 'RARE', 2: 'FULL ART', 3: 'GOLD', 4: 'LEGEND' }, CN: { 1: '稀有', 2: '全画', 3: '金名', 4: '金名·金框' },
  async init() { if (!this.rar) try { this.rar = await (await fetch('/rarity.json')).json(); } catch (e) { this.rar = {}; } },
  tierImg(img) {
    const r = this.rar && this.rar[img]; if (!r) return 0;
    if (r === 'SSP' || r === 'SSS') return 4;
    if (r === 'SP' || r === 'TSP') return 3;
    if (r === 'OSR' || (r === 'PR' && /S\.png$/.test(img))) return 2;
    if (r === 'SR' || r === 'TSR') return 1;
    return 0;
  },
  tier(id) { return this.tierImg(cardImgPath(id)); },
  rarity(id) { return (this.rar || {})[cardImgPath(id)] || ''; },
  layer() { let L = document.getElementById('fxlayer'); if (!L) { L = document.createElement('div'); L.id = 'fxlayer'; document.body.appendChild(L); } return L; },
  el(cls, html, parent) { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; (parent || this.layer()).appendChild(d); return d; },
  sparks(cx, cy, n, cols, dist, size = 6) {
    const L = this.layer();
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i'); p.className = 'fx-sp'; const c = cols[i % cols.length], sz = size * (.5 + Math.random());
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;background:${c};box-shadow:0 0 ${sz * 2}px ${c}`;
      L.appendChild(p);
      const a = Math.random() * 6.283, d = dist * (.35 + Math.random() * .75);
      p.animate([{ transform: 'translate(-50%,-50%) scale(1.3)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d + 40}px)) scale(.1)`, opacity: 0 }],
        { duration: 700 + Math.random() * 900, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'forwards' }).onfinish = () => p.remove();
    }
  },
  // 在某个元素上播放（小/中特效的局部部分）
  onEl(el, t) {
    if (!el) return; const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const sh = this.el('fx-sheen'); sh.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    setTimeout(() => sh.remove(), 1100);
    this.sparks(cx, cy, t >= 2 ? 26 : 14, ['#bfe9ff', '#ffffff', '#ffe08a'], t >= 2 ? 140 : 90, 5);
    if (t >= 2) { const ring = this.el('fx-ring'); ring.style.cssText = `left:${cx}px;top:${cy}px`; setTimeout(() => ring.remove(), 900); }
  },
  // 全屏亮相（中/大/特大）。返回持续毫秒数
  showcase(img, t, name) {
    const L = this.layer(), dur = { 2: 1300, 3: 2100, 4: 2900 }[t];
    const box = this.el(`fx-show t${t}`, `
      <div class="fx-dim"></div>${t >= 3 ? '<div class="fx-rays"></div>' : ''}${t >= 4 ? '<div class="fx-rays r2"></div><div class="fx-wave"></div><div class="fx-wave w2"></div><div class="fx-flash"></div>' : ''}
      <div class="fx-card"><img src="${imgUrl(img)}" onload="this.classList.toggle('land',this.naturalWidth>this.naturalHeight)"><div class="fx-holo"></div></div>
      ${t >= 3 ? `<div class="fx-name"><small>${this.NAME[t]} · ${this.CN[t]}</small><b>${esc(name || '')}</b></div>` : ''}`);
    box.style.setProperty('--dur', dur + 'ms');
    const cx = innerWidth / 2, cy = innerHeight / 2;
    if (t >= 3) setTimeout(() => this.sparks(cx, cy, t >= 4 ? 110 : 60, t >= 4 ? ['#ffd54a', '#ff7ab6', '#7dfcff', '#b7ff7a', '#fff'] : ['#ffd54a', '#fff3c4', '#ffb340'], t >= 4 ? 520 : 340, t >= 4 ? 9 : 7), t >= 4 ? 380 : 250);
    if (t >= 4) { setTimeout(() => this.sparks(cx, cy, 70, ['#ffd54a', '#fff'], 700, 5), 900); document.body.classList.add('fx-shake'); setTimeout(() => document.body.classList.remove('fx-shake'), 650); }
    else if (t === 2) setTimeout(() => this.sparks(cx, cy, 30, ['#bfe9ff', '#fff'], 220, 6), 200);
    setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 350); }, dur - 300);
    return dur;
  },
  // 对局中打出：el 为场上卡牌元素（可空）
  play(id, el) {
    const t = this.tier(id); if (!t) return 0;
    const c = App.byId[id] || {};
    if (t === 1) { this.onEl(el, 1); return 700; }
    const d = this.showcase(cardImgPath(id), t, c.name);
    setTimeout(() => this.onEl(el, t), d - 200);
    return d;
  },
};
RareFx.init();
