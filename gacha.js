'use strict';
// 抽卡：补充包第1弹「帕洛斯的黎明」—— 每包5张，按稀有度概率抽取，带光效与收藏册
const RARE_ORDER = ['C', 'U', 'R', 'RR', 'SR', 'OSR', 'SP', 'SSP', 'SSS'];
const RARE_NAME = { C: '普通', U: '非普通', R: '稀有', RR: '双重稀有', SR: '超级稀有', OSR: '帕鲁超稀有', SP: '特殊', SSP: '超特殊', SSS: '传说' };
// 第5张（闪卡槽）概率，合计 100。SR 很常见；带 S 的高稀有依次递减；SSS 全收藏唯一
const SLOT5 = [['R', 30], ['RR', 22], ['SR', 42], ['OSR', 5], ['SP', 0.8], ['SSP', 0.18], ['SSS', 0.02]];
// 已发售商品（有卡牌数据的）：补充包第1弹、两套体验卡组、卡套&卡片套装、PR 卡
const PRODUCTS = [
  { key: 'BP01', name: '补充包 第1弹', sub: '帕洛斯的黎明', art: 'BP01/BP01-001OSR.png', tag: '补充包', desc: '每包5张：普通×3、非普通/稀有×1、闪卡槽×1' },
  { key: 'TD01', name: '体验卡组', sub: '帕洛斯的黎明 红·蓝', art: 'TD01/TD01-007TSR.png', tag: '体验卡组', desc: '每包5张：TD×4、闪卡槽×1（TSR 75% / TDR 18% / TSP 7%）', hue: 'rb' },
  { key: 'TD02', name: '体验卡组', sub: '帕洛斯的黎明 绿·紫', art: 'TD02/TD02-006TSR.png', tag: '体验卡组', desc: '每包5张：TD×4、闪卡槽×1（TSR 75% / TDR 18% / TSP 7%）', hue: 'gp' },
  { key: 'SS01', name: '卡套&卡片套装 Vol.1', sub: '附赠卡片', art: 'SS01/SS-001OSR.png', tag: '套装', desc: '每份2张：R×1、闪卡槽×1（OSR 35% / R 65%）' },
  { key: 'PR', name: 'PR 卡（2026年）', sub: '活动 / 特典宣传卡', art: 'PR/PR-009.png', tag: '特典', desc: '每份1张 PR 卡' },
];
const Gacha = {
  pool: null, rar: null, opening: false, prod: localStorage.getItem('ptcg_gprod') || 'BP01',
  coll() { try { return JSON.parse(localStorage.getItem('ptcg_coll') || '{}'); } catch (e) { return {}; } },
  saveColl(c) { localStorage.setItem('ptcg_coll', JSON.stringify(c)); },
  stats() { try { return JSON.parse(localStorage.getItem('ptcg_gstat') || '{"packs":0}'); } catch (e) { return { packs: 0 }; } },
  async init() {
    if (this.pool) return;
    this.rar = await (await fetch('/rarity.json')).json();
    const img2id = {}; for (const c of App.cards) for (const f of c.imgs) img2id[f] = c.id;
    this.pools = {};
    for (const [img, r] of Object.entries(this.rar)) {
      const set = img.split('/')[0]; if (!img2id[img] && r !== 'SSS') continue;
      for (const k of r === 'SSS' ? ['BP01'] : [set]) { const P = this.pools[k] = this.pools[k] || {}; (P[r] = P[r] || []).push({ img, id: img2id[img] || '', r }); }
    }
    if (!PRODUCTS.find(p => p.key === this.prod)) this.prod = 'BP01';
    this.pool = this.pools[this.prod];
  },
  roll(r) { const L = this.pool[r] || this.pool.C || Object.values(this.pool)[0]; return L[Math.floor(Math.random() * L.length)]; },
  pick(table) { let x = Math.random() * table.reduce((a, b) => a + b[1], 0); for (const [k, p] of table) if ((x -= p) < 0) return k; return table[0][0]; },
  pack() {
    if (this.prod === 'TD01' || this.prod === 'TD02') return [this.roll('TD'), this.roll('TD'), this.roll('TD'), this.roll('TD'), this.roll(this.pick([['TSR', 75], ['TDR', 18], ['TSP', 7]]))];
    if (this.prod === 'SS01') return [this.roll('R'), this.roll(this.pick([['OSR', 35], ['R', 65]]))];
    if (this.prod === 'PR') return [this.roll('PR')];
    const out = [this.roll('C'), this.roll('C'), this.roll('C'), this.roll(Math.random() < .25 ? 'R' : 'U')];
    let x = Math.random() * 100, r = 'R'; for (const [k, p] of SLOT5) { if ((x -= p) < 0) { r = k; break; } }
    if (r === 'SSS' && Object.keys(this.coll()).some(k => this.rar[k] === 'SSS')) r = 'SSP'; // 绝无仅有：只能拥有一张
    out.push(this.roll(r));
    return out;
  },
  tier(r) { return { C: 0, U: 0, R: 0, TD: 0, PR: 1, RR: 1, SR: 1, TSR: 1, TDR: 3, OSR: 3, SP: 4, TSP: 4, SSP: 5, SSS: 6 }[r] || 0; },
  async render() {
    await this.init();
    const st = this.stats(), co = this.coll();
    const P = PRODUCTS.find(p => p.key === this.prod), inP = new Set(Object.values(this.pool).flat().map(x => x.img));
    const owned = Object.keys(co).filter(k => inP.has(k)).length, total = inP.size;
    const ORDER = RARE_ORDER.concat(['TD', 'TSR', 'TDR', 'TSP', 'PR']).sort((a, b) => this.tier(a) - this.tier(b));
    $('#gacha').innerHTML = `
      <div class="g-prods">${PRODUCTS.map(p => `<button class="g-prod ${p.key === this.prod ? 'on' : ''}" data-prod="${p.key}"><img src="${imgUrl(p.art)}"><span><small>${p.tag}</small><b>${p.name}</b><i>${p.sub}</i></span></button>`).join('')}</div>
      <div class="g-stage" id="g-stage">
        <div class="g-intro">
          <div class="g-pack" id="g-pack"><div class="foil"></div><img class="art" src="${imgUrl(P.art)}"><img class="lg" src="/ui/logo.png"><div class="pn">${P.name}<br><b>${P.sub}</b></div><div class="sh"></div></div>
          <div class="g-ctl">
            <button class="primary big" id="g-one">开 1 包</button>
            <button class="big" id="g-ten">十连开 10 包</button>
          </div>
          <div class="g-info">已开 <b>${st.packs}</b> 包　收集进度 <b>${owned}</b> / ${total}（含异画）
            <div class="g-rates">${P.desc}${P.key === 'BP01' ? `　｜　闪卡槽：${SLOT5.map(([k, p]) => `<span class="rt r-${k}">${k} ${p}%</span>`).join(' ')}<br>SSS 全收藏仅此一张，抽到后不会再出现` : ''}</div></div>
        </div>
      </div>
      <h3 style="margin:18px 0 8px">我的收藏 · ${P.name} ${P.sub} <button id="g-reset" style="font-size:12px;padding:2px 8px;float:right">清空收藏</button></h3>
      <div class="g-album">${ORDER.slice().reverse().map(r => (this.pool[r] || []).map(x => { const n = co[x.img] || 0; return `<div class="g-al ${n ? '' : 'no'} gr-${r}" data-zoom="${x.id}" data-img="${x.img}"><img src="${imgUrl(x.img)}" loading="lazy"><span class="rt r-${r}">${r}</span>${n > 1 ? `<span class="n">×${n}</span>` : ''}</div>`; }).join('')).join('')}</div>`;
    $$('[data-prod]').forEach(b => b.onclick = () => { if (this.opening) return; this.prod = b.dataset.prod; localStorage.setItem('ptcg_gprod', this.prod); this.pool = this.pools[this.prod]; this.render(); });
    $('#g-one').onclick = () => this.open(1);
    $('#g-ten').onclick = () => this.open(10);
    $('#g-reset').onclick = () => askConfirm('清空收藏与统计？', () => { localStorage.removeItem('ptcg_coll'); localStorage.removeItem('ptcg_gstat'); this.render(); });
  },
  async open(n) {
    if (this.opening) return; this.opening = true;
    const packs = Array.from({ length: n }, () => this.pack());
    const co = this.coll(); for (const p of packs) for (const c of p) co[c.img] = (co[c.img] || 0) + 1; this.saveColl(co);
    const st = this.stats(); st.packs += n; localStorage.setItem('ptcg_gstat', JSON.stringify(st));
    const stage = $('#g-stage'), pk = $('#g-pack');
    // 撕包动画
    pk.classList.add('tear');
    await new Promise(r => setTimeout(r, 900));
    const cards = n === 1 ? packs[0] : packs.flat().sort((a, b) => this.tier(b.r) - this.tier(a.r)).slice(0, 10).concat([]);
    const shown = n === 1 ? cards : packs.map(p => p.reduce((a, b) => this.tier(b.r) > this.tier(a.r) ? b : a));
    const best = Math.max(...shown.map(c => this.tier(c.r)));
    stage.innerHTML = `<div class="g-reveal ${n > 1 ? 'ten' : ''} best${best}">
      <div class="g-rays"></div>
      <div class="g-row">${shown.map((c, i) => `<div class="g-card t${this.tier(c.r)} fx${RareFx.tierImg(c.img)}" data-img="${c.img}" data-nm="${esc((App.byId[c.id] || {}).name || '')}" data-i="${i}" style="animation-delay:${i * 90}ms">
        <div class="g-flip"><div class="g-back"><img src="/ui/card_back.jpg"></div><div class="g-front gr-${c.r}"><img src="${imgUrl(c.img)}"><div class="holo"></div><span class="rt r-${c.r}">${c.r}</span></div></div></div>`).join('')}</div>
      <div class="g-tip">${n > 1 ? `10 包 · 共 ${packs.flat().length} 张，展示每包最高稀有度。` : ''}点击卡牌翻开</div>
      <div class="g-ctl"><button id="g-all">全部翻开</button><button class="primary" id="g-again" style="display:none">再开一次</button><button id="g-back" style="display:none">返回</button></div>
      ${n > 1 ? `<div class="g-sum" style="display:none">${RARE_ORDER.concat(['TD', 'TSR', 'TDR', 'TSP', 'PR']).sort((a, b) => this.tier(b) - this.tier(a)).map(r => { const k = packs.flat().filter(c => c.r === r).length; return k ? `<span class="rt r-${r}">${r}×${k}</span>` : ''; }).join(' ')}</div>` : ''}
    </div>`;
    const els = $$('.g-card'); let left = els.length;
    const flip = el => {
      if (el.classList.contains('open')) return; el.classList.add('open'); left--;
      const t = +el.className.match(/t(\d)/)[1];
      // 与对局打出共用同一套稀有度特效：S 小 / 全画 中 / 金名 大 / 金名金框 特大
      const fx = +(el.className.match(/fx(\d)/) || [0, 0])[1];
      if (fx === 1 || fx === 2) setTimeout(() => RareFx.onEl(el, fx), 250);
      if (fx >= 2) setTimeout(() => RareFx.showcase(el.dataset.img, fx, el.dataset.nm), 450);
      if (fx >= 3) this.burst(el, fx >= 4 ? 5 : 4);
      if (t >= 6) this.banner('★ 绝 无 仅 有 ★');
      if (!left) { $('#g-all').style.display = 'none'; $('#g-again').style.display = ''; $('#g-back').style.display = ''; const s = $('.g-sum'); if (s) s.style.display = ''; this.opening = false; }
    };
    els.forEach(el => {
      el.onclick = () => flip(el);
      el.onmousemove = e => { if (!el.classList.contains('open')) return; const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = `perspective(800px) rotateY(${x * 22}deg) rotateX(${-y * 22}deg) scale(1.06)`; el.style.setProperty('--hx', (x + .5) * 100 + '%'); el.style.setProperty('--hy', (y + .5) * 100 + '%'); };
      el.onmouseleave = () => { el.style.transform = ''; };
    });
    // 高稀有度：翻开前就有预兆光
    $('#g-all').onclick = async () => { const order = [...els].filter(e => !e.classList.contains('open')).sort((a, b) => +a.className.match(/t(\d)/)[1] - +b.className.match(/t(\d)/)[1]); for (const e of order) { flip(e); await new Promise(r => setTimeout(r, +(e.className.match(/fx(\d)/) || [0, 0])[1] >= 2 ? [0, 0, 1500, 2300, 3100][+(e.className.match(/fx(\d)/))[1]] : +e.className.match(/t(\d)/)[1] >= 3 ? 700 : 220)); } };
    $('#g-again').onclick = () => { this.opening = false; this.render().then(() => this.open(n)); };
    $('#g-back').onclick = () => { this.opening = false; this.render(); };
  },
  banner(txt) { const b = document.createElement('div'); b.className = 'banner'; b.style.right = '0'; b.textContent = txt; document.body.appendChild(b); setTimeout(() => b.remove(), 1700); },
  burst(el, t) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = t >= 5 ? ['#ff5e9a', '#ffd54a', '#7dff9a', '#5ed0ff', '#c58cff'] : t === 4 ? ['#ffe08a', '#fff', '#9be4ff', '#ff9ad5'] : ['#ffd54a', '#fff3c4'];
    for (let i = 0; i < (t >= 5 ? 70 : 36); i++) {
      const p = document.createElement('div'); p.className = 'spark'; const c = cols[i % cols.length];
      p.style.cssText = `left:${cx}px;top:${cy}px;background:${c};box-shadow:0 0 12px ${c};z-index:300;position:fixed`;
      document.body.appendChild(p);
      const a = Math.random() * 6.28, d = 80 + Math.random() * (t >= 5 ? 320 : 180);
      p.animate([{ transform: 'translate(0,0) scale(1.4)', opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 60}px) scale(.2)`, opacity: 0 }], { duration: 900 + Math.random() * 700, easing: 'cubic-bezier(.1,.8,.3,1)' }).onfinish = () => p.remove();
    }
  },
};
// 横版卡（建筑物）在竖版卡框中旋转显示
document.addEventListener('load', e => { const t = e.target; if (t.tagName === 'IMG' && t.closest('.g-front,.g-al') && t.naturalWidth > t.naturalHeight) t.classList.add('landimg'); }, true);
