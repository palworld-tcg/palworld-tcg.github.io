'use strict';
// 卡组构筑
const Builder = {
  cur: { name: '新卡组', cards: [] }, idx: -1,
  init() {
    const cs = $('#f-cost'); for (let i = 1; i <= 8; i++) cs.innerHTML += `<option value="${i}">◇${i}</option>`;
    ['#f-text', '#f-color', '#f-kind', '#f-cost'].forEach(s => $(s).addEventListener('input', () => this.renderPool()));
    $('#pool').addEventListener('click', e => { const c = e.target.closest('[data-id]'); if (c) this.add(c.dataset.id); });
    $('#pool').addEventListener('contextmenu', e => { const c = e.target.closest('[data-id]'); if (c) { e.preventDefault(); this.remove(c.dataset.id); } });
    $('#b-list').addEventListener('click', e => { const c = e.target.closest('[data-id]'); if (c) this.remove(c.dataset.id); });
    $('#b-decks').onchange = () => this.load(+$('#b-decks').value);
    $('#b-new').onclick = () => { this.cur = { name: '新卡组', cards: [] }; this.idx = -1; this.render(); };
    $('#b-del').onclick = () => { if (this.idx < 0) return; askConfirm('确定删除该卡组？', () => { const a = Decks.all(); a.splice(this.idx, 1); Decks.save(a); this.idx = -1; this.cur = { name: '新卡组', cards: [] }; this.render(); }); };
    $('#b-save').onclick = () => {
      this.cur.name = $('#b-name').value.trim() || '未命名卡组';
      const a = Decks.all(); if (this.idx < 0) { a.push(this.cur); this.idx = a.length - 1; } else a[this.idx] = this.cur;
      Decks.save(a); toast('已保存' + (validate(this.cur.cards).length ? '（卡组尚不合法）' : '')); this.render();
    };
    $('#b-random').onclick = async () => { this.cur.cards = await (await fetch('/api/random-deck?mode=' + ($('#b-rmode').value || 'shape') + '&rare=' + $('#b-rare').value)).json(); this.render(); };
    $('#f-ver').addEventListener('input', () => this.renderPool());
    $('#b-upgrade').onclick = () => { this.cur.cards = this.cur.cards.map(id => Builder.best(id)); toast('已全部替换为最高稀有度版本'); this.render(); };
    $('#b-downgrade').onclick = () => { this.cur.cards = this.cur.cards.map(id => App.byId[id].id); this.render(); };
    (async () => { const ps = App.presets || (App.presets = await (await fetch('/api/presets')).json());
      $('#b-preset').innerHTML = '<option value="">📦 载入预设 / 挑战卡组…</option>' + presetOptions('');
      $('#b-preset').onchange = () => { const p = ps.find(x => x.key === $('#b-preset').value); if (!p) return; const rm = $('#b-rare').value; this.cur = { name: p.name, cards: p.cards.map(id => rm === 'max' ? this.best(id) : id) }; this.idx = -1; $('#b-preset').value = ''; toast(p.desc); this.render(); }; })();
    $('#b-clear').onclick = () => { this.cur.cards = []; this.render(); };
    $('#b-export').onclick = () => { const s = this.cur.cards.join(','); navigator.clipboard && navigator.clipboard.writeText(s); modal(`<p>卡组代码（已复制）：</p><textarea style="width:600px;height:120px">${s}</textarea><p><button onclick="closeModal()">关闭</button></p>`); };
    $('#b-import').onclick = () => {
      const box = modal(`<p>粘贴卡组代码（卡号以逗号分隔）：</p><textarea id="imp" style="width:600px;height:120px"></textarea><p><button id="imp-ok">导入</button> <button onclick="closeModal()">取消</button></p>`);
      box.querySelector('#imp-ok').onclick = () => { const ids = box.querySelector('#imp').value.split(/[\s,]+/).filter(x => App.byId[x]); this.cur.cards = ids; closeModal(); this.render(); };
    };
    const a = Decks.all(); if (a.length) this.load(0);
  },
  load(i) { const a = Decks.all(); if (!a[i]) return; this.idx = i; this.cur = JSON.parse(JSON.stringify(a[i])); this.render(); },
  count(id) { return this.cur.cards.filter(x => x === id).length; },
  // 稀有度：0 普通 1 S 2 全画 3 金名 4 金名金框
  rtag(id) { const r = RareFx.rarity(id), t = RareFx.tier(id); return t ? `<span class="rtag rt${t}">${r}</span>` : ''; },
  best(id) { const c = App.byId[id]; return c.variants.slice().sort((a, b) => RareFx.tier(b) - RareFx.tier(a) || (RareFx.rarity(b) > RareFx.rarity(a) ? 1 : -1))[0]; },
  add(id) {
    const c = App.byId[id];
    const same = this.cur.cards.filter(x => App.byId[x].ja === c.ja).length;
    if (same >= 4 && !c.anyNumber) return toast('同名卡至多 4 张');
    if (this.cur.cards.length >= 50) return toast('已达 50 张');
    if (c.lucky && this.cur.cards.filter(x => App.byId[x].lucky).length >= 8) return toast('☆ 至多 8 张');
    const cols = new Set(this.cur.cards.map(x => App.byId[x].color).filter(Boolean));
    if (c.color && !cols.has(c.color) && cols.size >= 2) return toast('颜色至多 2 种');
    this.cur.cards.push(id); this.render();
  },
  remove(id) { const i = this.cur.cards.indexOf(id); if (i >= 0) { this.cur.cards.splice(i, 1); this.render(); } },
  renderPool() {
    const q = $('#f-text').value.trim(), col = $('#f-color').value, k = $('#f-kind').value, cost = $('#f-cost').value;
    const list = App.cards.filter(c => (!q || (c.name + c.text + c.ja + c.en).includes(q)) && (!col || (col === 'none' ? !c.color : c.color === col)) && (!k || c.kind === k) && (!cost || c.cost === +cost));
    const ver = $('#f-ver').value;
    const ids = list.flatMap(c => ver === 'all' ? c.variants.filter(v => cardImgPath(v)) : ver === 'rare' ? c.variants.filter(v => RareFx.tier(v) > 0) : ver === 'best' ? [this.best(c.id)] : [c.id]);
    $('#pool').innerHTML = ids.map(id => { const c = App.byId[id]; return `<div class="ci" data-id="${id}" data-zoom="${id}" data-img="${cardImgPath(id)}"><div class="fr fxr${RareFx.tier(id)}"><img loading="lazy" src="${cardImg(id)}" onload="this.classList.toggle('rot',this.naturalWidth>this.naturalHeight)"></div>${this.count(id) ? `<span class="cnt">${this.count(id)}</span>` : ''}<div class="nm">${this.rtag(id)}${esc(c.name)}</div></div>`; }).join('');
  },
  render() {
    const a = Decks.all();
    $('#b-decks').innerHTML = (this.idx < 0 ? '<option value="-1">（未保存的新卡组）</option>' : '') + a.map((d, i) => `<option value="${i}" ${i === this.idx ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    $('#b-name').value = this.cur.name;
    const cards = this.cur.cards, cnt = {};
    for (const id of cards) cnt[id] = (cnt[id] || 0) + 1;
    const ids = Object.keys(cnt).sort((x, y) => { const a1 = App.byId[x], b1 = App.byId[y]; return ['pal', 'building', 'gear', 'event'].indexOf(a1.kind) - ['pal', 'building', 'gear', 'event'].indexOf(b1.kind) || a1.cost - b1.cost; });
    const by = k => cards.filter(x => App.byId[x].kind === k).length;
    $('#b-stats').innerHTML = `共 <b>${cards.length}</b>/50 张　帕鲁 ${by('pal')}　建筑物 ${by('building')}　装备 ${by('gear')}　事件 ${by('event')}　☆ ${cards.filter(x => App.byId[x].lucky).length}/8`;
    const errs = validate(cards);
    $('#b-errors').innerHTML = errs.length ? errs.map(esc).join('<br>') : '<span style="color:#7f7">✔ 卡组合法</span>';
    $('#b-list').innerHTML = ids.map(id => { const c = App.byId[id]; return `<div class="dl" data-id="${id}" data-zoom="${id}"><span class="c ${colorClass(c)}"><span>${c.cost}</span></span><span class="n">${esc(c.name)}${c.lucky ? ' ☆' : ''} ${this.rtag(id)}</span><span class="q">×${cnt[id]}</span></div>`; }).join('');
    this.renderPool();
  },
};
