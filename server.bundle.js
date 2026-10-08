/* 幻兽帕鲁卡牌游戏 · 浏览器单机版服务端（自动生成，请勿手改）*/
const __MODULES__ = {
"/app/server/server.js": { deps: {"http":"http","fs":"fs","path":"path","./engine":"/app/server/engine/index.js","./engine/decks":"/app/server/engine/decks.js","./engine/presets":"/app/server/engine/presets.js","./puzzles":"/app/server/puzzles.js","./solver":"/app/server/solver.js","./ai":"/app/server/ai.js","./ai_deep":"/app/server/ai_deep.js","./view":"/app/server/view.js","./ws":"#ws","crypto":"crypto","./accounts":"/app/server/accounts.js","./gp":"/app/server/gp.js","../public/emotes.js":"/app/public/emotes.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 幻兽帕鲁卡牌游戏 在线对战服务器（零依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { db, Game, publicList } = require('./engine');
const { validateDeck, randomDeck } = require('./engine/decks');
const { PRESETS } = require('./engine/presets');
const { PUZZLES } = require('./puzzles');
const { PuzzleAI } = require('./solver');
// 稀有版本：rare=max 每张都用最高稀有度版本；rare=mix 随机混入稀有版本
const RARITY = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'rarity.json'), 'utf8')); } catch (e) { return {}; } })();
const RTIER = { SSS: 9, SSP: 8, TSP: 7, SP: 7, OSR: 6, PR: 5, TSR: 4, SR: 4, TDR: 3, RR: 2, R: 1 };
function variantTier(c, v) { const k = v.replace(/^SS01-/, 'SS-'); const f = c.imgs.find(x => x.split('/').pop().replace(/\.png$/, '') === k); const r = f && RARITY[f]; return r === 'PR' ? (/S\.png$/.test(f) ? 6 : 1) : (RTIER[r] || 0); }
function rarify(deck, mode) {
  if (mode !== 'max' && mode !== 'mix') return deck;
  return deck.map(id => {
    const c = db[id]; if (!c || !c.variants || c.variants.length < 2) return id;
    const vs = c.variants.map(v => [v, variantTier(c, v)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
    if (!vs.length) return id;
    if (mode === 'max') return vs[0][0];
    return Math.random() < .55 ? vs[Math.floor(Math.random() * vs.length)][0] : id;
  });
}
function puzzleArt(p) {
  const ids = []; for (const pl of [p.sc.players[0], p.sc.players[1]]) for (const x of [...(pl.base || []), ...(pl.hand || [])]) ids.push(typeof x === 'string' ? x : x.id);
  const d = id => db[id] || {};
  const hit = ids.find(id => { const n = d(id).name || ''; const last = n.split(' ').pop(); return last && (p.title.includes(n) || p.title.includes(last)); });
  if (hit) return hit;
  return ids.filter(id => d(id).kind === 'pal').sort((a, b) => (d(b).cost || 0) - (d(a).cost || 0))[0] || ids[0];
}
const PUZZLE_PW = process.env.PUZZLE_PW || 'palworld';
const { AI } = require('./ai');
const { DeepAI } = require('./ai_deep');
const { viewFor } = require('./view');
const { upgrade } = require('./ws');
const crypto = require('crypto');
// ---------- 对局记录（复盘） ----------
const Accounts = require('./accounts');
const GP = require('./gp');
const EMOTES = require('../public/emotes.js');
// 对局记录存放在版本无关的数据目录；旧版本目录下的记录仍可读取
const GAMES = path.join(Accounts.DATA, 'games');
const GAMES_OLD = path.join(__dirname, '..', 'games');
fs.mkdirSync(GAMES, { recursive: true });
function saveGame(room) {
  const g = room.game; if (!g) return;
  const rec = { id: room.gid, created: room.created, updated: Date.now(), pve: room.pve ? (room.puzzle ? 'puzzle:' + room.puzzle.id : room.gp ? 'gp' : room.level) : null, names: g.init.names,
    decks: g.init.decks, seed: g.init.seed, scenario: g.init.scenario || null, hist: g.hist, undoLog: room.undoLog, over: g.over, turn: g.turnNo };
  fs.writeFile(path.join(GAMES, room.gid + '.json'), JSON.stringify(rec), () => {});
}
function loadGame(id) {
  id = String(id || '').replace(/[^0-9a-f-]/gi, '').toLowerCase(); if (id.length < 6) return null;
  for (const dir of [GAMES, GAMES_OLD]) {
    let f; try { f = fs.readdirSync(dir).find(x => x.startsWith(id)); } catch (e) { }
    if (f) return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  }
  return null;
}
function replayAt(rec, n) {
  const g = new Game({ db, decks: rec.decks, names: rec.names, seed: rec.seed, scenario: rec.scenario || undefined });
  g.quiet = true;
  for (const h of rec.hist.slice(0, n)) { g.advance(h[1]); g.hist.push(h); }
  return g;
}

const PORT = +process.env.PORT || 8930;
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const CARDS_JSON = JSON.stringify(publicList());

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (Accounts.handle(req, res, url, send)) return;
  if (GP.handle(req, res, url, send)) return;
  if (url.pathname === '/api/cards') return send(res, 200, CARDS_JSON, MIME['.json']);
  if (url.pathname === '/api/random-deck') {
    const cols = (url.searchParams.get('colors') || '').split(',').filter(c => ['red', 'blue', 'green', 'purple'].includes(c)).slice(0, 2);
    const mode = url.searchParams.get('mode') || 'true';
    if (mode === 'preset') {
      const ok = PRESETS.filter(p => !cols.length || p.colors.every(c => cols.includes(c)) || p.colors.some(c => cols.includes(c)));
      const p = (ok.length ? ok : PRESETS)[Math.floor(Math.random() * (ok.length || PRESETS.length))];
      return send(res, 200, JSON.stringify(rarify(p.cards, url.searchParams.get('rare'))), MIME['.json']);
    }
    return send(res, 200, JSON.stringify(rarify(randomDeck(Math.random, cols.length ? cols : null, url.searchParams.get('strong') === '1' || mode === 'curve', mode === 'curve' ? 'curve' : mode), url.searchParams.get('rare'))), MIME['.json']);
  }
  if (url.pathname === '/api/puzzles') {
    return send(res, 200, JSON.stringify(PUZZLES.map(p => ({ id: p.id, level: p.level, mill: !!p.mill, art: puzzleArt(p), title: p.title, desc: p.desc, hint: p.hint, turns: (p.sc.limit.turn - p.sc.turnNo) / 2 + 1 }))), MIME['.json']);
  }
  if (url.pathname === '/api/puzzle-guide') {
    const p = PUZZLES.find(x => x.id === url.searchParams.get('id'));
    if (!p) return send(res, 404, '{"error":"残局不存在"}', MIME['.json']);
    if (url.searchParams.get('pw') !== PUZZLE_PW) return send(res, 403, '{"error":"密码错误"}', MIME['.json']);
    let steps = []; try { steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzle_guides.json'), 'utf8'))[p.id] || []; } catch (e) { }
    return send(res, 200, JSON.stringify({ guide: p.guide, steps }), MIME['.json']);
  }
  if (url.pathname === '/api/presets') {
    return send(res, 200, JSON.stringify(PRESETS), MIME['.json']);
  }
  let mm;
  if ((mm = url.pathname.match(/^\/api\/replay\/([0-9a-fA-F-]+)$/))) {
    const rec = loadGame(mm[1]); if (!rec) return send(res, 404, JSON.stringify({ error: '找不到该对局' }), MIME['.json']);
    const n = Math.max(0, Math.min(rec.hist.length, +(url.searchParams.get('n') ?? rec.hist.length)));
    const pov = +url.searchParams.get('pov') || 0;
    const g = replayAt(rec, n);
    const st = viewFor(g, pov, { all: url.searchParams.get('all') === '1' });
    st.ask = null; // 复盘中不可操作
    const nxt = rec.hist[n];
    return send(res, 200, JSON.stringify({ id: rec.id, n, total: rec.hist.length, names: rec.names, pve: rec.pve, over: rec.over, created: rec.created,
      next: nxt ? { player: nxt[0], ans: nxt[1], prompt: g.pending && g.pending.prompt, label: g.pending && (g.pending.kind === 'main' ? (g.pending.actions[nxt[1]] || {}).label : g.pending.kind === 'option' ? g.pending.options[nxt[1]] : JSON.stringify(nxt[1])) } : null,
      state: st }), MIME['.json']);
  }
  // 自备原声带：<数据目录>/music/<场景>/*.mp3|ogg|m4a|flac|wav（场景：title menu battle draft win lose）
  if (url.pathname === '/api/music') {
    const root = path.join(Accounts.DATA, 'music'), out = {};
    const AU = /\.(mp3|ogg|m4a|aac|flac|wav|opus|webm)$/i;
    for (const sc of ['title', 'menu', 'battle', 'draft', 'win', 'lose']) {
      try { out[sc] = fs.readdirSync(path.join(root, sc)).filter(f => AU.test(f)).sort().map(f => `/music/${sc}/${encodeURIComponent(f)}`); } catch (e) { out[sc] = []; }
    }
    // 直接放在 music/ 根目录的文件按曲名自动归类
    const RULES = [[/hello.{0,3}pal ?world/i, ['title', 'menu']], [/boss|engraved|myth|savage|dudes|battle|戦闘|战斗/i, ['battle']], [/victory|win|胜利/i, ['win']], [/defeat|lose|失败/i, ['lose']]];
    try {
      for (const f of fs.readdirSync(root).filter(f => AU.test(f)).sort()) {
        const r = RULES.find(([re]) => re.test(f)); const u = `/music/${encodeURIComponent(f)}`;
        for (const sc of r ? r[1] : ['menu']) out[sc].push(u);
      }
    } catch (e) { }
    // 开场固定 Hello, Palworld 置顶
    for (const sc of ['title', 'menu']) out[sc].sort((a, b) => /hello/i.test(decodeURIComponent(b)) - /hello/i.test(decodeURIComponent(a)));
    return send(res, 200, JSON.stringify({ dir: root, tracks: out }), MIME['.json']);
  }
  if (url.pathname === '/api/music/upload' && req.method === 'POST') {
    const root = path.join(Accounts.DATA, 'music'), name = path.basename(String(url.searchParams.get('name') || '')).replace(/[\\/:*?"<>|]/g, '_');
    if (!/\.(mp3|ogg|m4a|aac|flac|wav|opus|webm)$/i.test(name)) return send(res, 400, '{"error":"仅支持音频文件"}', MIME['.json']);
    fs.mkdirSync(root, { recursive: true });
    let size = 0; const tmp = path.join(root, '.up-' + Date.now()), ws = fs.createWriteStream(tmp);
    req.on('data', d => { size += d.length; if (size > 80e6) { req.destroy(); ws.destroy(); fs.rm(tmp, () => { }); } });
    req.pipe(ws); ws.on('finish', () => { fs.renameSync(tmp, path.join(root, name)); send(res, 200, JSON.stringify({ ok: true, name }), MIME['.json']); });
    return;
  }
  if (url.pathname.startsWith('/music/')) {
    const root = path.join(Accounts.DATA, 'music'), f = path.normalize(path.join(root, decodeURIComponent(url.pathname.slice(7))));
    if (path.basename(f).startsWith('.')) return send(res, 404, 'not found');
    if (!f.startsWith(root + path.sep)) return send(res, 403, 'forbidden');
    return fs.stat(f, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'not found');
      const AM = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav', '.webm': 'audio/webm' };
      const type = AM[path.extname(f).toLowerCase()] || 'application/octet-stream', rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (rg) {
        const a = rg[1] ? +rg[1] : st.size - +rg[2], b = rg[1] && rg[2] ? Math.min(+rg[2], st.size - 1) : st.size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1, 'Cache-Control': 'max-age=3600' });
        return fs.createReadStream(f, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(f).pipe(res);
    });
  }
  if (url.pathname === '/api/rooms') return send(res, 200, JSON.stringify(listRooms()), MIME['.json']);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) return send(res, 403, 'forbidden');
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': /\.(png|jpg)$/.test(f) ? 'max-age=86400' : 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
});
function send(res, code, body, type = 'text/plain; charset=utf-8') { res.writeHead(code, { 'Content-Type': type }); res.end(body); }

// ---------- 房间 ----------
const rooms = new Map();
function code() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }
function listRooms() {
  return [...rooms.values()].filter(r => !r.pve && !r.game && r.seats[0] && !r.seats[1]).map(r => ({ code: r.code, host: r.seats[0].name }));
}
class Room {
  constructor(pve) { this.code = code(); this.pve = pve; this.seats = [null, null]; this.game = null; this.ai = null; this.aiTimer = null; this.undos = [3, 3]; this.undoReq = null; rooms.set(this.code, this); }
  canCancel(i) { return !!(this.game && !this.game.over && this.game.cancelPoint(i, !this.pve) >= 0); }
  doCancel(i) {
    const n = this.game.cancelPoint(i, !this.pve); if (n < 0) return false;
    clearTimeout(this.aiTimer); this.aiTimer = null;
    const g = this.game.rewind(n);
    this.undoLog.push({ by: i, from: this.game.hist.length, to: n, at: Date.now(), cancel: true });
    this.game = g; this.undoReq = null;
    return true;
  }
  canUndo(i) { return !!(this.game && !this.game.over && this.undos[i] > 0 && this.game.undoPoint(i) >= 0); }
  doUndo(i) {
    const n = this.game.undoPoint(i); if (n < 0) return false;
    clearTimeout(this.aiTimer); this.aiTimer = null;
    const g = this.game.rewind(n);
    g.say(`↶ ${this.seats[i].name} 悔棋（剩余 ${this.undos[i] - 1} 次）`);
    this.undoLog.push({ by: i, from: this.game.hist.length, to: n, at: Date.now() });
    this.game = g; this.undos[i]--; this.undoReq = null;
    return true;
  }
  broadcast() {
    saveGame(this);
    if (this.pve && !this.puzzle && this.game && this.game.over && !this.overEmote) {
      this.overEmote = true;
      if (Math.random() < 0.7) setTimeout(() => this.seats[0] && this.emote(1, 'taunt', this.game.over.winner === 1 ? [2, 6, 16][Math.floor(Math.random() * 3)] : [1, 2][Math.floor(Math.random() * 2)]), 2600);
    }
    if (this.gp && this.game && this.game.over && !this.gp.done) {
      this.gp.done = true;
      const w = this.game.over.winner;
      this.gp.result = GP.settle(this.gp.run, this.gp.gameId, w === 0, w === 0 ? '' : this.game.over.reason);
    }
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (s && s.ws) s.ws.send({ type: 'state', room: this.code, state: this.game ? Object.assign(viewFor(this.game, i, { all: !!this.puzzle }), this.puzzle ? { puzzle: { id: this.puzzle.id, title: this.puzzle.title, desc: this.puzzle.desc, hint: this.puzzle.hint, limit: this.game.limit }, deckTop: this.game.p.map(p => p.deck.slice(0, 10).map(c => c.id)) } : {}, { gid: this.gid, pve: this.pve, gp: this.gp ? { style: this.gp.style, result: this.gp.result || null } : undefined, undos: this.undos[i], canUndo: this.canUndo(i), canCancel: this.canCancel(i), undoReq: this.undoReq === null ? null : this.undoReq === i ? 'mine' : 'theirs' }) : null, seats: this.seats.map(x => x && { name: x.name, ready: !!x.deck, online: !!(x.ws && x.ws.open) }) });
    }
    this.scheduleAI();
  }
  start(scenario, seed) {
    this.gid = crypto.randomUUID(); this.created = Date.now(); this.undoLog = [];
    const decks = this.seats.map(s => s.deck);
    this.game = new Game({ db, decks, names: this.seats.map(s => s.name), scenario, seed });
    this.broadcast();
  }
  emote(seat, kind, i) {
    const from = this.seats[seat] && this.seats[seat].name;
    for (let k = 0; k < 2; k++) { const s = this.seats[k]; if (s && s.ws) s.ws.send({ type: 'emote', seat, me: k === seat, from, kind, i }); }
  }
  scheduleAI() {
    if (!this.ai || !this.game || this.game.over || this.aiTimer) return;
    const q = this.game.pending;
    if (!q || q.player !== 1) return;
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (!this.game || this.game.over || !this.game.pending || this.game.pending.player !== 1) return;
      try { const a = this.ai.decide(this.game, 1); this.game.answer(1, a); }
      catch (e) { console.error('AI 错误', e); this.game.concede(1); }
      this.broadcast();
    }, +process.env.AI_DELAY || 750);
  }
  leave(i) {
    const s = this.seats[i]; if (!s) return;
    s.ws = null;
    if (!this.seats.some(x => x && x.ws && x.ws.open)) setTimeout(() => { if (!this.seats.some(x => x && x.ws && x.ws.open)) { clearTimeout(this.aiTimer); rooms.delete(this.code); } }, 5 * 60 * 1000);
    else this.broadcast();
  }
}
const AI_NAMES = { easy: '电脑（简单）', normal: '电脑（普通）', hard: '电脑（困难）', hell: '电脑（地狱）' };

server.on('upgrade', (req, socket) => {
  const ws = upgrade(req, socket); if (!ws) return;
  let room = null, seat = -1;
  const err = m => ws.send({ type: 'error', msg: m });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    try {
      if (m.type === 'pve' || m.type === 'create' || m.type === 'join') {
        if (m.type === 'pve' && m.puzzle) {
          const pz = PUZZLES.find(x => x.id === m.puzzle); if (!pz) return err('残局不存在');
          room = new Room(true); seat = 0;
          room.seats[0] = { name: String(m.name || '玩家').slice(0, 16), deck: [], ws, token: m.token };
          room.seats[1] = { name: '残局对手', deck: [] };
          room.ai = new PuzzleAI(0); room.level = 'puzzle'; room.puzzle = pz; room.undos = [99, 0];
          room.start(JSON.parse(JSON.stringify(pz.sc)), 7);
          return;
        }
        if (m.type === 'pve' && m.gp) {
          const mt = GP.nextMatch(m.auth || '', { guest: m.token, name: m.name });
          if (mt.error) return err(mt.error);
          room = new Room(true); seat = 0;
          room.seats[0] = { name: String(m.name || '玩家').slice(0, 16), deck: mt.deck, ws, token: m.token };
          room.seats[1] = { name: mt.oppName, deck: mt.oppDeck };
          room.ai = new DeepAI(Date.now(), { cheat: true }); room.level = 'hell'; room.undos = [0, 0];
          room.gp = { run: mt.run, gameId: mt.gameId, style: mt.style };
          room.start();
          return;
        }
        const errs = validateDeck(m.deck);
        if (errs.length) return err('卡组不合法：' + errs.join('；'));
        const name = String(m.name || '玩家').slice(0, 16);
        if (m.type === 'pve') {
          const lv = ['easy', 'normal', 'hard', 'hell'].includes(m.level) ? m.level : 'normal';
          room = new Room(true); seat = 0;
          room.seats[0] = { name, deck: m.deck, ws, token: m.token };
          room.seats[1] = { name: AI_NAMES[lv], deck: Array.isArray(m.oppDeck) && !validateDeck(m.oppDeck).length ? m.oppDeck : randomDeck(Math.random, null, lv === 'hard' || lv === 'hell') };
          room.ai = lv === 'hell' ? new DeepAI(Date.now(), { cheat: true }) : lv === 'hard' ? new DeepAI(Date.now()) : new AI(lv, Date.now()); room.level = lv;
          room.start(process.env.DEV && m.scenario ? m.scenario : undefined);
        } else if (m.type === 'create') {
          room = new Room(false); seat = 0;
          room.seats[0] = { name, deck: m.deck, ws, token: m.token };
          room.broadcast();
        } else {
          const r = rooms.get(String(m.code));
          if (!r || r.pve) return err('房间不存在');
          if (r.seats[1]) return err('房间已满');
          room = r; seat = 1;
          room.seats[1] = { name, deck: m.deck, ws, token: m.token };
          room.start();
        }
      } else if (m.type === 'rejoin') {
        const r = rooms.get(String(m.code));
        const i = r ? r.seats.findIndex(s => s && s.token && s.token === m.token) : -1;
        if (i < 0) return ws.send({ type: 'rejoinFail' });
        room = r; seat = i; r.seats[i].ws = ws; r.broadcast();
      } else if (!room) {
        return err('尚未加入房间');
      } else if (m.type === 'answer') {
        const g = room.game;
        if (!g || g.over) return;
        if (m.v !== undefined && m.v !== g.version) return; // 过期操作
        g.answer(seat, m.ans);
        room.undoReq = null;
        room.broadcast();
      } else if (m.type === 'cancel') {
        if (!room.doCancel(seat)) return err('当前没有可取消的操作');
        room.broadcast();
      } else if (m.type === 'undo') {
        if (!room.canUndo(seat)) return err('当前无法悔棋（每局最多 3 次）');
        if (room.pve) { room.doUndo(seat); room.broadcast(); }
        else { room.undoReq = seat; room.broadcast(); }
      } else if (m.type === 'undoReply') {
        const r = room.undoReq; if (r === null || r === seat) return;
        if (m.ok && room.canUndo(r)) room.doUndo(r);
        else { room.undoReq = null; const s = room.seats[r]; if (s && s.ws) s.ws.send({ type: 'error', msg: '对方拒绝了悔棋申请' }); }
        room.broadcast();
      } else if (m.type === 'concede') {
        if (room.game && !room.game.over) { room.game.concede(seat); room.broadcast(); }
      } else if (m.type === 'chat') {
        const txt = String(m.text || '').slice(0, 200);
        for (const s of room.seats) if (s && s.ws) s.ws.send({ type: 'chat', from: room.seats[seat].name, text: txt });
      } else if (m.type === 'emote') {
        const kind = m.kind === 'emoji' ? 'emoji' : 'taunt', i = m.i | 0;
        if (!(i >= 0 && i < EMOTES[kind].length)) return;
        const now = Date.now(); room.emoteT = room.emoteT || [0, 0];
        if (now - room.emoteT[seat] < 1500) return; room.emoteT[seat] = now;
        room.emote(seat, kind, i);
        // 人机：AI 偶尔回应（残局对手不说话）
        if (room.pve && !room.puzzle && room.game && Math.random() < 0.6) {
          const g = room.game, winning = !g.over && g.p[1].life >= g.p[0].life, R = EMOTES.aiReply;
          let k2, j;
          if (g.over) { k2 = 'taunt'; j = g.over.winner === 1 ? 2 : 1; }
          else if (Math.random() < 0.45) { k2 = 'emoji'; j = R.emoji[Math.floor(Math.random() * R.emoji.length)]; }
          else { k2 = 'taunt'; j = winning ? R.taunt[Math.floor(Math.random() * R.taunt.length)] : [1, 5, 16][Math.floor(Math.random() * 3)]; }
          setTimeout(() => room.seats[0] && room.emote(1, k2, j), 900 + Math.random() * 900);
        }
      } else if (m.type === 'leave') {
        room.leave(seat); room = null;
      }
    } catch (e) {
      err(e.message);
      if (room) room.broadcast();
    }
  });
  ws.on('close', () => { if (room) room.leave(seat); });
});

server.listen(PORT, () => console.log(`幻兽帕鲁卡牌游戏 对战平台已启动：http://localhost:${PORT}`));

} },
"/app/server/engine/index.js": { deps: {"fs":"fs","path":"path","./actions":"/app/server/engine/actions.js","./costs":"/app/server/engine/costs.js","./flow":"/app/server/engine/flow.js","./main":"/app/server/engine/main.js","./battle":"/app/server/engine/battle.js","./keywords":"/app/server/engine/keywords.js","./core":"/app/server/engine/core.js","./cards_red":"/app/server/engine/cards_red.js","./cards_blue":"/app/server/engine/cards_blue.js","./cards_green":"/app/server/engine/cards_green.js","./cards_purple":"/app/server/engine/cards_purple.js","./cards_none":"/app/server/engine/cards_none.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 合并官方卡牌数据与效果定义
const fs = require('fs');
const path = require('path');
require('./actions'); require('./costs'); require('./flow'); require('./main'); require('./battle'); require('./keywords');
const { Game } = require('./core');

const defs = Object.assign({}, require('./cards_red'), require('./cards_blue'), require('./cards_green'), require('./cards_purple'), require('./cards_none'));
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/cards_base.json'), 'utf8'));
const KIND_CN = { pal: '帕鲁', building: '建筑物', gear: '装备', event: '事件' };
const COLOR_CN = { red: '红', blue: '蓝', green: '绿', purple: '紫' };

const db = {};
Object.defineProperty(db, '_byJa', { value: {}, enumerable: false });
const missing = [];
for (const b of base) {
  const d = defs[b.id];
  if (!d) { missing.push(b.id); continue; }
  const card = { ...b, ...d, kindCn: KIND_CN[b.kind], colorCn: b.color ? COLOR_CN[b.color] : '无' };
  db[b.id] = card;
  db._byJa[b.ja] = card;
  for (const v of b.variants) if (v !== b.id) Object.defineProperty(db, v, { value: card, enumerable: false });
}
if (missing.length) console.warn('缺少效果定义：', missing.join(','));

// 发给前端的公开卡表
function publicList() {
  return Object.values(db).map(c => ({
    id: c.id, name: c.name, ja: c.ja, en: c.en, kind: c.kind, kindCn: c.kindCn, color: c.color, colorCn: c.colorCn,
    types: c.types, apts: c.apts, cost: c.cost, power: c.power, strike: c.strike, lucky: c.lucky, quick: !!c.quick,
    main: c.main, text: c.text, imgs: c.imgs, variants: c.variants, anyNumber: !!c.anyNumber,
  }));
}
module.exports = { db, Game, publicList, missing };

} },
"/app/server/engine/actions.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 基础行动：抽卡、灵魂、资源、伤害、选择辅助
const { Game, GAMEOVER } = require('./core');
const P = Game.prototype;

P.shuffle = function (arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
};
P.draw = function (pi, n = 1) {
  const pl = this.p[pi]; let k = 0;
  for (let i = 0; i < n; i++) { const c = pl.deck[0]; if (!c) break; this.move(c, 'hand'); k++; }
  if (k) this.say(`${pl.name} 抽了 ${k} 张卡`);
  return k;
};
P.untapSouls = function (pi) { return this.p[pi].souls.filter(s => !s.rested).length; };
P.paySouls = function (pi, n) {
  const st = this.p[pi].souls.filter(s => !s.rested);
  if (st.length < n) return false;
  for (let i = 0; i < n; i++) st[i].rested = true;
  return true;
};
P.addSoul = function (pi, n, rested) {
  const pl = this.p[pi]; let k = 0;
  while (k < n && pl.soulDeck > 0 && pl.souls.length < pl.soulLimit) {
    pl.soulDeck--; pl.souls.push({ rested: !!rested }); k++;
  }
  return k;
};
P.standSouls = function (pi, n) {
  let k = 0; for (const s of this.p[pi].souls) if (k < n && s.rested) { s.rested = false; k++; }
  return k;
};
P.gain = function (pi, res, n) { this.p[pi][res] += n; this.say(`${this.p[pi].name} 获得 ${n} 个${res === 'material' ? '【素材】' : '【食材】'}`); };
P.gainLife = function (pi, n) { this.p[pi].life += n; this.say(`${this.p[pi].name} 生命 +${n}`); };
P.lifeOf = function (pi) { return Math.max(0, this.p[pi].life); };

// 给予帕鲁/建筑物效果伤害（含朱雀置换）
P.dealDamage = function (src, ctrlOfSrc, target, n, battle = false) {
  if (!this.inBase(target)) return;
  if (!battle && this.isPal(target) && src && src.def.color === 'red') {
    let k = 0;
    for (const c of this.p[ctrlOfSrc].base) if (c.def.redDmgBoost) k++;
    n += 200 * k;
  }
  if (n <= 0) return;
  target.damage += n;
  this.say(`${this.cname(target)} 受到 ${n} 伤害`);
};
// 对玩家伤害（插入型规则处理，立即执行 11.2）
P.damagePlayer = function (pi, n) {
  if (n <= 0) return;
  const pl = this.p[pi];
  pl.dmg += n;
  let milled = 0, lucky = false;
  this.say(`${pl.name} 受到 ${n} 点伤害`);
  while (true) {
    const c = pl.deck[0];
    if (!c) break;
    this.move(c, 'grave'); milled++;
    if (c.def.lucky) { lucky = true; this.say(`翻开 ${this.cname(c)}（幸运帕鲁）—— 伤害被抵消！`); break; }
    if (milled >= pl.dmg) break;
  }
  if (!lucky) { pl.life -= pl.dmg; this.say(`${pl.name} 失去 ${pl.dmg} 点生命（剩余 ${pl.life}）`); }
  pl.dmg = 0;
};
P.addMod = function (c, mod) { if (this.inBase(c)) c.mods.push({ until: this.turnNo, ...mod }); };
P.rest = function (c) { if (this.inBase(c) && !c.rested) { c.rested = true; return true; } return false; };
P.stand = function (c) {
  if (!this.inBase(c) || !c.rested) return false;
  if (this.cantStand(c)) return false;
  c.rested = false; return true;
};
P.cantStand = function (c) {
  return c.noStand.some(n => n.type === 'while' ? this.allBase().some(x => x.uid === n.srcUid && x.inst === n.srcInst) : false);
};
P.setNight = function (until) { this.nights.push({ until }); this.say('变为黑夜！'); };

// ---------- 选择辅助（生成器） ----------
// cands: 卡数组；返回所选卡数组
P.choose = function* (pi, cands, min, max, prompt, extra = {}) {
  cands = cands.filter(Boolean);
  const view = extra.view ? extra.view.filter(Boolean).map(c => c.uid) : undefined;
  if (!cands.length) {
    // 检视类效果：即使没有可选的卡，也让玩家看到检视结果
    if (view && view.length) yield* this.ask(pi, { kind: 'option', prompt: prompt.replace(/（检视：.*）$/, '') + '——没有符合条件的卡', options: ['确定'], view });
    return [];
  }
  max = Math.min(max, cands.length); min = Math.min(min, max);
  if (min === max && min === cands.length && !extra.always) return cands.slice();
  const ans = yield* this.ask(pi, { kind: 'select', prompt, cands: cands.map(c => c.uid), min, max, reveal: extra.reveal ? cands.map(c => c.uid) : undefined, view });
  return ans.map(u => cands.find(c => c.uid === u));
};
P.option = function* (pi, prompt, options, meta) {
  return yield* this.ask(pi, { kind: 'option', prompt, options, meta });
};
P.yesno = function* (pi, prompt) { return (yield* this.option(pi, prompt, ['是', '否'])) === 0; };
P.chooseNum = function* (pi, prompt, lo, hi) {
  if (hi <= lo) return lo;
  const opts = []; for (let i = lo; i <= hi; i++) opts.push(String(i));
  return lo + (yield* this.option(pi, prompt, opts));
};

// ---------- 判定时点：规则处理 + 自动能力 ----------
P.ruleProcess = function* () {
  let changed = true;
  while (changed) {
    changed = false;
    // 败北（判定型）
    const lose = [0, 1].map(i => this.p[i].life <= 0 || this.p[i].deck.length === 0);
    if (lose[0] || lose[1]) {
      if (lose[0] && lose[1]) this.over = { winner: -1, reason: '双方同时败北，平局' };
      else { const l = lose[0] ? 0 : 1; this.over = { winner: 1 - l, reason: `${this.p[l].name} ${this.p[l].life <= 0 ? '生命归零' : '卡组耗尽'}` }; }
      this.say('游戏结束：' + this.over.reason);
      throw GAMEOVER;
    }
    // 致死伤害（同时）
    const dead = this.allBase().filter(c => (this.isPal(c) || this.isBld(c)) && c.damage > 0 && c.damage >= this.power(c));
    // 超额帕鲁（11.5）：保留最晚放置的帕鲁，其余由据点主体选择
    const excess = [];
    for (const pl of [this.p[this.active], this.p[1 - this.active]]) {
      const ps = pl.base.filter(c => this.isPal(c) && !dead.includes(c));
      if (ps.length > pl.palLimit) {
        const newest = Math.max(...ps.map(c => c.seq));
        const older = ps.filter(c => c.seq !== newest);
        const n = ps.length - pl.palLimit;
        const pick = yield* this.choose(pl.idx, older, n, n, `帕鲁超过上限，选择 ${n} 只放置入墓地`);
        excess.push(...pick);
      }
    }
    const all = [...dead, ...excess.filter(c => !dead.includes(c))];
    if (all.length) {
      for (const c of dead) this.say(`${this.cname(c)} 被破坏`);
      for (const c of excess) this.say(`${this.cname(c)} 因超过帕鲁上限被放置入墓地`);
      this.moveMany(all, 'grave', { cause: 'rule' });
      changed = true;
    }
  }
};
P.checkTiming = function* () {
  while (true) {
    yield* this.ruleProcess();
    let any = false;
    for (const pi of [this.active, 1 - this.active]) {
      const mine = this.queue.filter(q => q.ctrl === pi);
      if (!mine.length) continue;
      let q = mine[0];
      if (mine.length > 1 && pi !== undefined) {
        const i = yield* this.option(pi, '选择先解决的自动能力', mine.map(x => `${this.cname(x.card)}：${x.a.text || '自动能力'}${x.count > 1 ? ' ×' + x.count : ''}`));
        q = mine[i];
      }
      q.count--;
      if (q.count <= 0) this.queue.splice(this.queue.indexOf(q), 1);
      this.say(`${this.cname(q.card)} 的【自】能力发动`);
      yield* q.a.run(this, q.card, q.ctrl, q.ev, q);
      any = true; break;
    }
    if (!any) return;
  }
};
module.exports = { Game, GAMEOVER };

} },
"/app/server/engine/core.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 规则引擎核心：状态、区域、移动、事件、数值计算
const GAMEOVER = { gameover: true };
let INST = 1;

class Game {
  constructor({ db, decks, names, seed, scenario }) {
    this.db = db;
    this.init = { decks, names, scenario, seed: seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed };
    let s = this.init.seed >>> 0;
    this.rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.hist = [];
    this.uid = 1;
    this.p = [0, 1].map(i => ({
      idx: i, name: names[i], deck: [], hand: [], grave: [], base: [], exile: [],
      souls: [], soulDeck: 10, life: 10, dmg: 0, material: 0, ingredient: 0,
      palLimit: 5, soulLimit: 10, soulDrawTurn: -1, played: 0, flags: {}, gearDiscount: null,
    }));
    decks.forEach((list, i) => { for (const id of list) this.p[i].deck.push(this.mk(id, i)); });
    this.turnNo = 0; this.active = 0; this.first = 0; this.phase = 'setup';
    this.battle = null; this.nights = []; this.queue = []; this.delayed = [];
    this.log = []; this.over = null; this.seq = 0; this._batch = null; this.version = 0;
    this.gen = this.run(); this.pending = null;
    this.advance();
  }

  mk(id, owner) {
    const def = this.db[id];
    if (!def) throw new Error('未知卡牌 ' + id);
    return { uid: this.uid++, id, def, owner, ctrl: owner, zone: 'deck', inst: INST++,
      rested: false, damage: 0, mods: [], grants: [], names: [], noStand: [], used: {},
      assignedTurn: -1, seq: 0, exiledBy: null };
  }

  // ---------- 交互 ----------
  advance(ans) {
    try {
      const r = this.gen.next(ans);
      this.pending = r.done ? null : r.value;
    } catch (e) {
      if (e !== GAMEOVER) throw e;
      this.pending = null;
    }
    this.version++;
  }
  *ask(pi, req) { req.player = pi; return yield req; }
  answer(pi, ans) {
    const q = this.pending;
    if (!q || q.player !== pi) throw new Error('现在不是你的操作时机');
    if (q.kind === 'main' || q.kind === 'option') {
      const n = q.kind === 'main' ? q.actions.length : q.options.length;
      if (!Number.isInteger(ans) || ans < 0 || ans >= n) throw new Error('非法选项');
    } else if (q.kind === 'select') {
      if (!Array.isArray(ans)) throw new Error('需要数组');
      const s = new Set(ans);
      if (s.size !== ans.length || ans.some(u => !q.cands.includes(u))) throw new Error('非法选择');
      if (ans.length < q.min || ans.length > q.max) throw new Error(`需要选择 ${q.min}~${q.max} 张`);
    }
    // 可悔棋点：主要阶段行动、选择、选项（不含快速步骤里的"不再使用"）
    const pass = q.kind === 'main' && q.quick && q.actions[ans] && q.actions[ans].t === 'end';
    // 第 4 位：m = 主要阶段发起的行动（取消的回退点），e = 结束回合
    const mk = q.kind === 'main' && !q.quick ? (q.actions[ans] && q.actions[ans].t === 'end' ? 'e' : 'm') : '';
    this.hist.push([pi, ans, pass ? 0 : 1, mk]);
    this.advance(ans);
  }
  clone() {
    const g = new Game({ db: this.db, decks: this.init.decks, names: this.init.names, seed: this.init.seed, scenario: this.init.scenario });
    g.quiet = true;
    // muts：在历史第 at 步之前对副本施加的修改（AI 的隐藏信息重抽样），克隆时按原位置重放
    const M = this.muts || [];
    this.hist.forEach((h, i) => { for (const m of M) if (m.at === i) m.fn(g); g.advance(h[1]); g.hist.push(h); });
    for (const m of M) if (m.at === this.hist.length) m.fn(g);
    if (M.length) g.muts = M.slice();
    return g;
  }
  // 悔棋：回到 pi 最近一次可悔操作之前（之后所有操作一并撤销）
  undoPoint(pi) {
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i][0] === pi && this.hist[i][2]) return i;
    return -1;
  }
  // 取消：当前处于 pi 某个行动的结算过程中（选目标/选卡/选项），回到发起该行动之前
  // strict=true（联机）时，若对手在此期间做过应对则不可取消
  cancelPoint(pi, strict) {
    const q = this.pending;
    if (!q || q.player !== pi || this.over) return -1;
    if (q.kind === 'main' && !q.quick) return -1;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const h = this.hist[i];
      if (h[0] !== pi) { if (strict || h[3]) return -1; continue; }
      if (h[3] === 'm') return i;
      if (h[3] === 'e') return -1;
    }
    return -1;
  }
  rewind(n) {
    const g = new Game({ db: this.db, decks: this.init.decks, names: this.init.names, seed: this.init.seed, scenario: this.init.scenario });
    for (const h of this.hist.slice(0, n)) g.advance(h[1]), g.hist.push(h);
    return g;
  }
  concede(pi) {
    if (this.over) return;
    this.over = { winner: 1 - pi, reason: `${this.p[pi].name} 投降` };
    this.say(this.over.reason);
    this.pending = null; this.version++;
  }
  say(s) { this.log.push(s); if (this.log.length > 400) this.log.shift(); }
  cname(c) { return '《' + c.def.name + '》'; }

  // ---------- 区域 ----------
  zoneArr(c) {
    if (c.zone === 'res' || c.zone === 'none') return null;
    return this.p[c.zone === 'base' ? c.ctrl : c.owner][c.zone];
  }
  allBase() { return [...this.p[0].base, ...this.p[1].base]; }
  inBase(c, inst) { return c.zone === 'base' && (inst === undefined || c.inst === inst); }
  isPal(c) { return c.def.kind === 'pal'; }
  isBld(c) { return c.def.kind === 'building'; }
  isGear(c) { return c.def.kind === 'gear'; }
  pals(f) { return this.allBase().filter(c => this.isPal(c) && (!f || f(c))); }
  myPals(pi, f) { return this.p[pi].base.filter(c => this.isPal(c) && (!f || f(c))); }
  opPals(pi, f) { return this.myPals(1 - pi, f); }

  snapshot(c) {
    return { rested: c.rested, power: this.power(c), strike: this.strike(c), cost: c.def.cost,
      kw: this.kw(c), autos: this.autosOf(c), ctrl: c.ctrl, inst: c.inst, names: this.namesOf(c) };
  }

  // 移动卡牌。to: base/hand/grave/deck/exile/res/none
  move(c, to, opt = {}) {
    const from = c.zone;
    const lki = from === 'base' ? this.snapshot(c) : null;
    if (lki && this.battle) this.battle.attStrikeSnap = this.strike(this.battle.att);
    const arr = this.zoneArr(c);
    if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
    if (to !== 'base' || from !== 'base') {
      Object.assign(c, { rested: false, damage: 0, mods: [], grants: [], names: [], noStand: [],
        used: {}, assignedTurn: -1, exiledBy: null, inst: INST++ });
    }
    c.zone = to;
    if (to === 'base') c.ctrl = opt.ctrl !== undefined ? opt.ctrl : c.owner;
    const dest = this.zoneArr(c);
    if (dest) { if (opt.top) dest.unshift(c); else dest.push(c); }
    if (to === 'base') { c.rested = !!opt.rested; c.seq = ++this.seq; }
    const evs = [];
    if (from === 'base') {
      c.lki = lki;
      evs.push({ t: 'leave', card: c, to, lki, cause: opt.cause });
      if (to === 'grave') evs.push({ t: 'toGrave', card: c, lki, cause: opt.cause });
    }
    if (to === 'base' && from !== 'base') evs.push({ t: 'deploy', card: c, from });
    for (const ev of evs) this.emit(ev, from === 'base' ? [c] : []);
    return c;
  }
  // 同时移动多张（共享离场信息）
  moveMany(list, to, opt = {}) {
    this._batch = { evs: [], leavers: [] };
    const b = this._batch;
    try { for (const c of list) this.move(c, to, opt); } finally { this._batch = null; }
    for (const [ev] of b.evs) this.emit(ev, b.leavers);
  }

  // ---------- 事件 / 自动能力 ----------
  emit(ev, leavers = []) {
    if (this._batch) { this._batch.evs.push([ev]); for (const l of leavers) if (!this._batch.leavers.includes(l)) this._batch.leavers.push(l); return; }
    ev.leavers = leavers;
    const srcs = [...this.allBase().map(c => [c, this.autosOf(c), c.ctrl]),
      ...leavers.map(c => [c, c.lki.autos, c.lki.ctrl])];
    for (const [c, autos, ctrl] of srcs) {
      for (const a of autos) {
        let ok = false;
        try { ok = a.when(this, ev, c); } catch (e) { ok = false; }
        if (!ok) continue;
        if (ev.fired) { const key = c.inst + ':' + autos.indexOf(a) + ':' + (a.text || ''); if (ev.fired.has(key)) continue; ev.fired.add(key); }
        const count = this.isDoubled(c, ctrl, ev) ? 2 : 1;
        this.queue.push({ card: c, ctrl, a, ev, count, inst: c.lki && c.zone !== 'base' ? c.lki.inst : c.inst });
      }
    }
    // 时限诱发（延迟能力）
    for (const d of this.delayed) if (!d.done && d.when(this, ev)) {
      d.done = true; this.queue.push({ card: d.card, ctrl: d.ctrl, a: d, ev, count: 1 });
    }
    this.delayed = this.delayed.filter(d => !d.done);
  }
  isDoubled(c, ctrl, ev) {
    if (c.def.kind !== 'pal') return false;
    const lv = ev.leavers || [];
    const doubler = this.p[ctrl].base.some(x => x.def.doubleAuto) || lv.some(x => x.def.doubleAuto && x.lki.ctrl === ctrl);
    return doubler && this.isNight(lv);
  }
  isNight(leavers = []) {
    if (this.nights.some(n => n.until >= this.turnNo)) return true;
    if (this.allBase().some(c => c.def.nightWhileRested && c.rested)) return true;
    return leavers.some(c => c.def.nightWhileRested && c.lki && c.lki.rested);
  }

  // ---------- 能力集合 ----------
  activeGrants(c) { return c.grants; }
  kw(c) {
    const k = { ...(c.def.kw || {}) };
    const add = g => { for (const [n, v] of Object.entries(g)) k[n] = (typeof v === 'number' && typeof k[n] === 'number') ? k[n] + v : (k[n] || v); };
    for (const g of c.grants) if (g.kw) add(g.kw);
    if (c.zone === 'base') for (const s of this.allBase()) for (const st of s.def.statics || [])
      if (st.grantKw) { const g = st.grantKw(this, s, c); if (g) add(g); }
    return k;
  }
  autosOf(c) {
    const out = [...(c.def.autos || [])];
    for (const g of c.grants) if (g.auto) out.push(g.auto);
    const k = this.kw(c);
    for (const [n, v] of Object.entries(k)) {
      const mk = this.kwAutos[n];
      if (mk) { const times = typeof v === 'number' && n !== 'brave' && n !== 'serious' ? v : 1; for (let i = 0; i < times; i++) out.push(mk(v)); }
    }
    return out;
  }
  actsOf(c) {
    const out = (c.def.acts || []).map((a, i) => ({ ...a, key: 'a' + i }));
    c.grants.forEach((g, i) => { if (g.act) out.push({ ...g.act, key: 'g' + i + g.act.name }); });
    if (this.kw(c).interrupt) out.push({ ...this.interruptAct, key: 'interrupt' });
    return out;
  }

  // ---------- 数值 ----------
  statSum(c, key) {
    let v = 0;
    for (const m of c.mods) v += m[key] || 0;
    if (c.zone === 'base') for (const s of this.allBase()) for (const st of s.def.statics || [])
      if (st[key]) v += st[key](this, s, c) || 0;
    return v;
  }
  power(c) {
    if (c.def.kind !== 'pal' && c.def.kind !== 'building') return 0;
    let v = (c.def.power || 0) + this.statSum(c, 'power');
    if (c.def.kind === 'pal' && this.isNight()) v += 300 * (this.kw(c).nocturnal || 0);
    return v;
  }
  strike(c) { return c.def.kind === 'pal' ? (c.def.strike || 0) + this.statSum(c, 'strike') : 0; }
  namesOf(c) { return [c.def.ja, ...c.names]; }
  mainNames(c) {
    const out = [c.def.main];
    for (const n of c.names) { const d = this.db._byJa[n]; if (d && d.main) out.push(d.main); }
    return out.filter(Boolean);
  }
  hasMain(c, m) { return this.mainNames(c).includes(m); }
  sameName(a, b) { const s = this.namesOf(b); return this.namesOf(a).some(n => s.includes(n)); }
  // 互不同名的最大张数（贪心）
  distinctCount(cards) {
    const picked = [];
    for (const c of cards) if (!picked.some(p => this.sameName(p, c))) picked.push(c);
    return picked.length;
  }
  untilTurnEnd() { return this.turnNo; }
  untilOppNext(pi) { return this.active === pi ? this.turnNo + 1 : this.turnNo + 2; }
}

module.exports = { Game, GAMEOVER };

} },
"/app/server/engine/costs.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 费用：灵魂/丢弃/横置自身/消费资源/任命/解体/卡组顶送墓
// alt 字段: soul, discard(数字|'X'), discardSelf, discardBuilding, restSelf, material(数字|'X'),
//          ingredient(数字|'X'), assign(数字), butcher(数字), butcherOther, mill
const { Game } = require('./core');
const P = Game.prototype;

P.assignable = function (pi, bld) {
  if (this.p[pi].flags.noAssign === this.turnNo) return [];
  return this.myPals(pi, c => !c.rested && c !== bld);
};
P.costText = function (alt) {
  const t = [];
  if (alt.soul) t.push(`支付${alt.soul}灵魂`);
  if (alt.restSelf) t.push('横置此卡');
  if (alt.discardSelf) t.push('丢弃此卡');
  if (alt.discard) t.push(alt.discard === 'X' ? '丢弃X张手牌' : `丢弃${alt.discard}张${alt.discardSelf ? '其他' : ''}手牌`);
  if (alt.discardBuilding) t.push('丢弃1张手牌中的建筑物');
  if (alt.material !== undefined) t.push(alt.material === 'X' ? '消费X个素材' : `消费${alt.material}个素材`);
  if (alt.ingredient !== undefined) t.push(alt.ingredient === 'X' ? '消费X个食材' : `消费${alt.ingredient}个食材`);
  if (alt.assign) t.push(`任命${alt.assign}只帕鲁`);
  if (alt.butcher) t.push(`解体${alt.butcher}只${alt.butcherOther ? '其他' : ''}帕鲁`);
  if (alt.mill) t.push(`将卡组顶${alt.mill}张放置入墓地`);
  return t.join('、') || '无费用';
};
P.canPay = function (c, pi, alt) {
  const pl = this.p[pi];
  if (alt.soul && this.untapSouls(pi) < alt.soul) return false;
  if (alt.restSelf && (c.zone !== 'base' || c.rested)) return false;
  const handOthers = pl.hand.filter(h => h !== c).length;
  if (alt.discardSelf && c.zone !== 'hand') return false;
  if (typeof alt.discard === 'number' && handOthers < alt.discard) return false;
  if (alt.discardBuilding && !pl.hand.some(h => h.def.kind === 'building' && h !== c)) return false;
  if (typeof alt.material === 'number' && pl.material < alt.material) return false;
  if (typeof alt.ingredient === 'number' && pl.ingredient < alt.ingredient) return false;
  if (alt.assign && this.assignable(pi, c).length < alt.assign) return false;
  if (alt.butcher && this.myPals(pi, x => !alt.butcherOther || x !== c).length < alt.butcher) return false;
  if (alt.mill && pl.deck.length < alt.mill) return false;
  return true;
};
// 返回 {x, assigned:[], butchered:[]}
P.payCost = function* (c, pi, alt, label) {
  const pl = this.p[pi]; const paid = { x: 0, assigned: [], butchered: [] };
  if (alt.material === 'X') paid.x = yield* this.chooseNum(pi, `${label}：消费几个素材（X）？`, 0, pl.material);
  if (alt.ingredient === 'X') paid.x = yield* this.chooseNum(pi, `${label}：消费几个食材（X）？`, 0, pl.ingredient);
  if (alt.discard === 'X') paid.x = yield* this.chooseNum(pi, `${label}：丢弃几张手牌（X）？`, 0, Math.min(pl.hand.length, this.myPals(pi).length));
  if (alt.soul) this.paySouls(pi, alt.soul);
  if (alt.restSelf) c.rested = true;
  if (alt.discardSelf) this.move(c, 'grave');
  const nd = alt.discard === 'X' ? paid.x : alt.discard;
  if (nd) {
    const ds = yield* this.choose(pi, pl.hand.filter(h => h !== c), nd, nd, `${label}：选择要丢弃的 ${nd} 张手牌`, { always: true });
    for (const d of ds) this.move(d, 'grave');
  }
  if (alt.discardBuilding) {
    const ds = yield* this.choose(pi, pl.hand.filter(h => h.def.kind === 'building'), 1, 1, `${label}：选择要丢弃的建筑物`, { always: true });
    for (const d of ds) this.move(d, 'grave');
  }
  if (alt.material !== undefined) pl.material -= alt.material === 'X' ? paid.x : alt.material;
  if (alt.ingredient !== undefined) pl.ingredient -= alt.ingredient === 'X' ? paid.x : alt.ingredient;
  if (alt.mill) { for (let i = 0; i < alt.mill; i++) if (pl.deck[0]) this.move(pl.deck[0], 'grave'); this.say(`${pl.name} 将卡组顶 ${alt.mill} 张放置入墓地`); }
  if (alt.assign) {
    const as = yield* this.choose(pi, this.assignable(pi, c), alt.assign, alt.assign, `${label}：选择要任命的帕鲁`, { always: true });
    for (const a of as) {
      a.rested = true; a.assignedTurn = this.turnNo; paid.assigned.push(a);
      this.say(`${this.cname(a)} 被任命至 ${this.cname(c)}`);
      this.emit({ t: 'assign', card: a, bld: c });
    }
  }
  if (alt.butcher) {
    const bs = yield* this.choose(pi, this.myPals(pi, x => !alt.butcherOther || x !== c), alt.butcher, alt.butcher, `${label}：选择要解体的帕鲁`, { always: true });
    for (const b of bs) paid.butchered.push(this.butcher(b, pi));
  }
  return paid;
};
// 解体：返回离场信息
P.butcher = function (card, pi) {
  const cost = card.def.cost;
  this.say(`${this.cname(card)} 被解体`);
  this.move(card, 'grave', { cause: 'butcher' });
  this.emit({ t: 'butcher', card, cost, pi }, [card]);
  return { card, cost };
};
module.exports = {};

} },
"/app/server/engine/flow.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 游戏准备与回合流程（规则 6、7）
const { Game } = require('./core');
const P = Game.prototype;

P.run = function* () {
  if (this.init.scenario) { yield* this.runScenario(this.init.scenario); return; }
  // 6.2 游戏前步骤
  for (const pl of this.p) this.shuffle(pl.deck);
  this.first = this.rng() < 0.5 ? 0 : 1;
  const chooser = this.first; // 随机选中的玩家决定先后攻（Q8）
  const goFirst = (yield* this.option(chooser, '你获得了先后攻的选择权，请选择', ['先攻', '后攻'])) === 0;
  this.first = goFirst ? chooser : 1 - chooser;
  this.say(`${this.p[this.first].name} 先攻`);
  this.addSoul(1 - this.first, 1, false);
  for (const pl of this.p) this.draw(pl.idx, 5);
  for (const pi of [this.first, 1 - this.first]) {
    if (yield* this.yesno(pi, '是否重新抽取起手 5 张手牌？（每局仅 1 次，须全部更换）')) {
      const pl = this.p[pi];
      for (const c of [...pl.hand]) this.move(c, 'deck');
      this.shuffle(pl.deck); this.draw(pi, 5);
      this.say(`${pl.name} 重抽了手牌`);
    }
  }
  this.active = this.first;
  while (true) {
    yield* this.turn();
    this.active = 1 - this.active;
  }
};

// 残局：直接从给定局面开始（不洗牌，卡组按给定顺序，顶部在前）
P.runScenario = function* (sc) {
  sc.players.forEach((ps, pi) => {
    const pl = this.p[pi];
    for (const c of pl.deck) c.zone = 'none';
    pl.deck = [];
    const mk = (id, zone) => { const c = this.mk(id, pi); c.zone = zone; return c; };
    for (const id of ps.deck || []) pl.deck.push(mk(id, 'deck'));
    for (const id of ps.hand || []) pl.hand.push(mk(id, 'hand'));
    for (const id of ps.grave || []) pl.grave.push(mk(id, 'grave'));
    for (const b of ps.base || []) {
      const o = typeof b === 'string' ? { id: b } : b;
      const c = mk(o.id, 'base'); c.ctrl = pi; c.rested = !!o.rested; c.damage = o.damage || 0; c.seq = ++this.seq;
      pl.base.push(c);
    }
    pl.life = ps.life ?? 10;
    pl.souls = Array.from({ length: ps.souls || 0 }, (_, i) => ({ rested: i < (ps.soulsRested || 0) }));
    pl.soulDeck = ps.soulDeck ?? Math.max(0, 10 - (ps.souls || 0));
    pl.material = ps.material || 0; pl.ingredient = ps.ingredient || 0;
    if (ps.name) pl.name = ps.name;
  });
  this.first = sc.first ?? 0;
  this.active = sc.active ?? 0;
  this.turnNo = (sc.turnNo ?? 3) - 1;
  this.limit = sc.limit || null; // {pi, turn}: pi 须在第 turn 回合结束前获胜
  this.say('—— 残局开始 ——');
  let first = true;
  while (true) {
    yield* this.turn(first ? sc.startPhase || 'main' : null);
    first = false;
    if (this.limit && this.turnNo >= this.limit.turn && !this.over) {
      this.over = { winner: 1 - this.limit.pi, reason: '未能在限定回合内获胜' };
      this.say('游戏结束：' + this.over.reason); this.pending = null;
      throw require('./core').GAMEOVER;
    }
    this.active = 1 - this.active;
  }
};

P.turn = function* (startAt) {
  this.turnNo++;
  const pi = this.active, pl = this.p[pi];
  this.say(`—— 第 ${this.turnNo} 回合：${pl.name} ——`);
  if (startAt === 'main') { this.phase = 'main'; yield* this.checkTiming(); yield* this.mainPhase(); yield* this.endPhase(pi); return; }
  // 7.2 竖置阶段
  this.phase = 'stand';
  for (const c of pl.base) {
    if (c.noStand.some(n => n.type === 'nextStand' && n.pi === pi)) continue;
    if (this.cantStand(c)) continue;
    c.rested = false;
  }
  for (const c of pl.base) c.noStand = c.noStand.filter(n => !(n.type === 'nextStand' && n.pi === pi));
  for (const s of pl.souls) s.rested = false;
  this.emit({ t: 'turnStart', pi });
  yield* this.checkTiming();
  // 7.3 抽卡阶段
  this.phase = 'draw';
  if (!(pi === this.first && this.turnNo === 1)) {
    yield* this.checkTiming();
    this.draw(pi, 1);
    yield* this.checkTiming();
  }
  // 7.4 灵魂阶段
  this.phase = 'soul';
  yield* this.checkTiming();
  const k = this.addSoul(pi, 2, false);
  if (k) this.say(`${pl.name} 灵魂 +${k}`);
  yield* this.checkTiming();
  // 7.5 主要阶段
  this.phase = 'main';
  yield* this.checkTiming();
  yield* this.mainPhase();
  yield* this.endPhase(pi);
};
P.endPhase = function* (pi) {
  const pl = this.p[pi];
  // 7.6 结束阶段
  this.phase = 'end';
  const fired = new Set();
  for (let loop = 0; loop < 20; loop++) {
    const before = this.queue.length;
    this.emit({ t: 'turnEnd', pi, fired });
    const newTrig = this.queue.length > before;
    yield* this.checkTiming();
    for (const c of this.allBase()) c.damage = 0;
    for (const c of this.allBase()) c.mods = c.mods.filter(m => m.until === 'perm' || m.until > this.turnNo);
    for (const c of this.allBase()) { c.grants = c.grants.filter(g => g.until > this.turnNo); c.names = []; }
    if (!newTrig && !this.queue.length) break;
  }
  this.nights = this.nights.filter(n => n.until > this.turnNo);
  pl.gearDiscount = null;
};
module.exports = {};

} },
"/app/server/engine/main.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 主要阶段可选行动（规则 8）、卡片使用、起动能力
const { Game } = require('./core');
const P = Game.prototype;

P.playCost = function (c, pi) {
  let cost = c.def.cost;
  const gd = this.p[pi].gearDiscount;
  if (c.def.kind === 'gear' && gd && gd.until >= this.turnNo && gd.x > 0) cost = Math.max(Math.min(cost, 1), cost - gd.x);
  return cost;
};
P.canPlay = function (c, pi, quickOnly) {
  if (c.zone !== 'hand' || c.owner !== pi) return false;
  if (quickOnly && !(c.def.kind === 'event' && c.def.quick)) return false;
  if (c.def.canPlay && !c.def.canPlay(this, c, pi)) return false;
  return this.untapSouls(pi) >= this.playCost(c, pi);
};
P.actUsable = function (c, pi, a, quickStep) {
  if (a.zone === 'hand' ? c.zone !== 'hand' || c.owner !== pi : !(c.zone === 'base' && c.ctrl === pi)) return false;
  if (quickStep ? !a.quick : a.needsBattle) return false;
  if (a.needsBattle && !(this.battle && this.battle.att && !this.battle.failed)) return false;
  if (a.once && c.used[a.key] === this.turnNo) return false;
  if (a.canUse && !a.canUse(this, c, pi)) return false;
  return true;
};
P.listActs = function (pi, quickStep) {
  const out = [];
  const pl = this.p[pi];
  for (const c of [...pl.base, ...pl.hand]) for (const a of this.actsOf(c)) {
    if (!this.actUsable(c, pi, a, quickStep)) continue;
    a.costs.forEach((alt, ai) => {
      if (!this.canPay(c, pi, alt)) return;
      out.push({ t: 'act', uid: c.uid, key: a.key, alt: ai, label: `${this.cname(c)} 起动：${a.name || ''}［${this.costText(alt)}］` });
    });
  }
  return out;
};
P.mainActions = function () {
  const pi = this.active, pl = this.p[pi], out = [];
  for (const c of pl.hand) if (this.canPlay(c, pi)) out.push({ t: 'play', uid: c.uid, label: `使用 ${this.cname(c)}（${this.playCost(c, pi)}灵魂）` });
  out.push(...this.listActs(pi, false));
  for (const c of this.myPals(pi)) if (this.legalTargets(c).length) out.push({ t: 'attack', uid: c.uid, label: `${this.cname(c)} 发起攻击` });
  if (pl.soulDrawTurn !== this.turnNo && this.untapSouls(pi) >= 3) out.push({ t: 'soulDraw', label: '支付 3 灵魂抽 1 张卡' });
  const must = pl.flags.mustAttack === this.turnNo && out.some(a => a.t === 'attack');
  if (!must) out.push({ t: 'end', label: '结束回合' });
  return out;
};
P.mainPhase = function* () {
  while (true) {
    yield* this.checkTiming();
    const req = { kind: 'main', prompt: '主要阶段：选择行动', actions: this.mainActions() };
    const i = yield* this.ask(this.active, req);
    const a = req.actions[i];
    if (a.t === 'end') return;
    yield* this.doAction(this.active, a);
  }
};
// 重新计算当前主要阶段可选行动（测试/外部改动局面后使用）
P.refreshMain = function () { const q = this.pending; if (q && q.kind === 'main' && !q.quick) q.actions = this.mainActions(); };
P.findCard = function (uid) {
  for (const pl of this.p) for (const z of ['hand', 'base', 'grave', 'deck', 'exile']) { const c = pl[z].find(x => x.uid === uid); if (c) return c; }
  return null;
};
P.doAction = function* (pi, a) {
  const c = a.uid ? this.findCard(a.uid) : null;
  if (a.t === 'play') yield* this.playCard(c, pi);
  else if (a.t === 'act') yield* this.useAct(c, pi, a.key, a.alt);
  else if (a.t === 'attack') yield* this.doBattle(c);
  else if (a.t === 'soulDraw') {
    this.paySouls(pi, 3); this.p[pi].soulDrawTurn = this.turnNo;
    this.say(`${this.p[pi].name} 支付 3 灵魂抽卡`); this.draw(pi, 1);
  }
};
// 10.6.2 使用手牌中的卡片
P.playCard = function* (c, pi, opt = {}) {
  const pl = this.p[pi];
  const cost = opt.cost !== undefined ? opt.cost : this.playCost(c, pi);
  if (c.def.kind === 'gear' && !opt.fromDeck && pl.gearDiscount && pl.gearDiscount.until >= this.turnNo) pl.gearDiscount = null;
  const prevPlayed = pl.played;
  this.move(c, 'res');
  this.paySouls(pi, cost);
  this.say(`${pl.name} 使用了 ${this.cname(c)}`);
  pl.played++;
  if (c.def.kind === 'event') {
    yield* c.def.play(this, c, pi, { prevPlayed });
    if (c.zone === 'res') this.move(c, 'grave');
  } else {
    this.move(c, 'base');
  }
  this.emit({ t: 'play', card: c, pi });
};
P.useAct = function* (c, pi, key, ai) {
  const a = this.actsOf(c).find(x => x.key === key);
  const alt = a.costs[ai];
  if (a.once) c.used[key] = this.turnNo;
  const inst = c.inst;
  this.say(`${this.cname(c)} 起动能力：${a.name || this.costText(alt)}`);
  const paid = yield* this.payCost(c, pi, alt, a.name || this.cname(c));
  paid.inst = inst;
  yield* a.run(this, c, pi, paid);
};
// 是否仍为同一张在据点的卡
P.same = function (c, inst) { return c.zone === 'base' && c.inst === inst; };
module.exports = {};

} },
"/app/server/engine/battle.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 战斗（规则 9）
const { Game } = require('./core');
const P = Game.prototype;

// 攻击目标候选：{type:'player'} 或卡
P.rawTargets = function (att) {
  const op = 1 - att.ctrl, k = this.kw(att), out = [];
  if (!att.rested && att.ctrl === this.active && !(att.flags && att.flags.noAttack)) {
    if (!this.attackBanned(att)) {
      out.push('player');
      for (const c of this.p[op].base) {
        if (this.isBld(c)) out.push(c);
        else if (this.isPal(c) && (c.rested || k.assault)) out.push(c);
      }
    }
  }
  return out.filter(t => t === 'player' || !this.protectedFrom(t, att));
};
P.attackBanned = function () { return false; };
P.protectedFrom = function (t, att) {
  for (const st of t.def.statics || []) if (st.notAttackedBy && st.notAttackedBy(this, t, att)) return true;
  return false;
};
P.legalTargets = function (att) {
  const raw = this.rawTargets(att);
  const taunts = raw.filter(t => t !== 'player' && this.kw(t).taunt);
  return taunts.length ? taunts : raw;
};
P.targetName = function (t) { return t === 'player' ? '对手玩家' : this.cname(t); };

P.doBattle = function* (att) {
  const pi = this.active, op = 1 - pi;
  // 9.3 攻击宣言
  const ts = this.legalTargets(att);
  if (!ts.length) return;
  let target;
  if (ts.length === 1) target = ts[0];
  else {
    this.declaring = att;
    const i = yield* this.option(pi, `选择 ${this.cname(att)} 的攻击目标`, ts.map(t => this.targetName(t)), { attacker: att.uid, targets: ts.map(t => t === 'player' ? 'player' : t.uid) });
    this.declaring = null;
    target = ts[i];
  }
  const B = this.battle = { att, attInst: att.inst, target, tInst: target === 'player' ? null : target.inst, blocked: false, failed: false, opp: null };
  att.rested = true;
  this.say(`${this.cname(att)} 攻击 ${this.targetName(target)}`);
  this.emit({ t: 'attack', card: att, target });
  if (target !== 'player') this.emit({ t: 'attacked', card: target, by: att });
  this.phase = 'battle';
  yield* this.checkTiming();
  // 9.4 阻挡
  if (!B.failed) {
    this.emit({ t: 'blockStep' });
    yield* this.checkTiming();
    if (this.same(att, B.attInst) && !this.kw(att).stealth) {
      const blockers = this.myPals(op, c => !c.rested && c !== B.target && !c.mods.some(m => m.noBlock));
      if (blockers.length) {
        const bs = yield* this.choose(op, blockers, 0, 1, `${this.cname(att)} 正在攻击 ${this.targetName(B.target)}，是否选择 1 只帕鲁阻挡？`, { always: true });
        if (bs.length) {
          const b = bs[0]; b.rested = true; B.target = b; B.tInst = b.inst; B.blocked = true;
          this.say(`${this.cname(b)} 进行阻挡`);
          this.emit({ t: 'block', card: b });
        }
      }
    }
    if (B.target !== 'player' && this.isPal(B.target)) B.opp = B.target;
    yield* this.checkTiming();
  }
  // 9.5 快速步骤
  if (!B.failed) {
    this.emit({ t: 'quickStep' });
    yield* this.checkTiming();
    while (!B.failed) {
      const acts = [];
      for (const c of this.p[op].hand) if (this.canPlay(c, op, true)) acts.push({ t: 'play', uid: c.uid, label: `使用 ${this.cname(c)}（${this.playCost(c, op)}灵魂）` });
      acts.push(...this.listActs(op, true));
      if (!acts.length) break;
      acts.push({ t: 'end', label: '不再使用（进入伤害步骤）' });
      const i = yield* this.ask(op, { kind: 'main', prompt: '快速步骤：可使用【快速】卡片或能力', actions: acts, quick: true });
      if (acts[i].t === 'end') break;
      yield* this.doAction(op, acts[i]);
      yield* this.checkTiming();
    }
  }
  // 9.6 伤害步骤
  if (!B.failed) {
    this.emit({ t: 'damageStep' });
    yield* this.checkTiming();
    const attOk = this.same(att, B.attInst);
    const t = B.target;
    const tOk = t === 'player' || this.same(t, B.tInst);
    if (!B.failed && attOk && tOk) {
      if (t === 'player') {
        const s = this.strike(att);
        if (s > 0) this.damagePlayer(op, s);
      } else if (this.isPal(t)) {
        const pa = this.power(att), pt = this.power(t);
        if (pa > 0) { t.damage += pa; this.say(`${this.cname(t)} 受到 ${pa} 战斗伤害`); }
        if (pt > 0) { att.damage += pt; this.say(`${this.cname(att)} 受到 ${pt} 战斗伤害`); }
      } else {
        const pa = this.power(att);
        if (pa > 0) { t.damage += pa; this.say(`${this.cname(t)} 受到 ${pa} 战斗伤害`); }
      }
    }
    yield* this.checkTiming();
  }
  // 9.7 战斗结束
  this.emit({ t: 'battleEnd', att, attInst: B.attInst });
  yield* this.checkTiming();
  for (const c of this.allBase()) c.mods = c.mods.filter(m => m.until !== 'battle');
  this.battle = null;
  this.phase = 'main';
};
// 使攻击失败（5.18）
P.failAttack = function () {
  if (this.battle) { this.battle.failed = true; this.say('攻击失败！'); }
};
// 某卡是否为正在进行战斗中的帕鲁
P.inBattle = function (c, lkiInst) {
  const B = this.battle; if (!B) return false;
  const inst = lkiInst !== undefined ? lkiInst : c.inst;
  return (c === B.att && inst === B.attInst) || (B.opp && c === B.opp && inst === B.tInst);
};
module.exports = {};

} },
"/app/server/engine/keywords.js": { deps: {"./core":"/app/server/engine/core.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 关键词能力（规则 12）
const { Game } = require('./core');
const P = Game.prototype;

P.kwAutos = {
  // 勇敢X：【攻击时】直至回合结束，此卡战斗力+X
  brave: v => ({ text: `勇敢${v}`, when: (g, ev, c) => ev.t === 'attack' && ev.card === c,
    run: function* (g, c) { g.addMod(c, { power: v }); } }),
  // 认真X：【任命时】选择1只帕鲁，直至回合结束战斗力+X
  serious: v => ({ text: `认真${v}`, when: (g, ev, c) => ev.t === 'assign' && ev.card === c,
    run: function* (g, c, pi) {
      const t = yield* g.choose(pi, g.pals(), 1, 1, `认真${v}：选择 1 只帕鲁，战斗力+${v}`);
      for (const x of t) g.addMod(x, { power: v });
    } }),
  // 警戒：你的回合结束时，将此卡竖置
  vigilance: () => ({ text: '警戒', when: (g, ev, c) => ev.t === 'turnEnd' && ev.pi === c.ctrl && c.zone === 'base',
    run: function* (g, c) { if (g.stand(c)) g.say(`${g.cname(c)} 因警戒竖置`); } }),
  // 复仇：此卡在战斗中被放置于墓地时，将战斗对手放置于墓地
  retaliate: () => ({ text: '复仇', when: (g, ev, c) => ev.t === 'toGrave' && ev.card === c && g.inBattle(c, ev.lki.inst),
    run: function* (g, c) {
      const B = g.battle; if (!B) return;
      const foe = c === B.att ? B.opp : B.att;
      const foeInst = c === B.att ? B.tInst : B.attInst;
      if (foe && g.same(foe, foeInst)) { g.say(`复仇：${g.cname(foe)} 被放置入墓地`); g.move(foe, 'grave'); }
    } }),
  // 突破：此卡攻击中战斗对手帕鲁被放置于墓地时，给予其主体等同打击力的伤害
  breakthrough: () => ({ text: '突破',
    when: (g, ev, c) => { const B = g.battle; return ev.t === 'toGrave' && B && B.att === c && (B.attInst === c.inst || (c.lki && c.lki.inst === B.attInst)) && B.opp === ev.card && ev.lki.inst === B.tInst; },
    run: function* (g, c, pi, ev) {
      const s = g.battle && g.battle.attStrikeSnap !== undefined ? g.battle.attStrikeSnap : g.strike(c);
      g.say(`突破：给予对手 ${s} 伤害`);
      if (s > 0) g.damagePlayer(ev.lki.ctrl, s);
    } }),
};

// 妨碍：【手牌】【快速】［①、丢弃此卡］或［丢弃此卡与另1张手牌］使对方的攻击失败
P.interruptAct = {
  name: '妨碍', zone: 'hand', quick: true, needsBattle: true,
  costs: [{ soul: 1, discardSelf: true }, { discardSelf: true, discard: 1 }],
  canUse: (g, c, pi) => g.battle && g.active !== pi,
  run: function* (g) { g.failAttack(); },
};
module.exports = {};

} },
"/app/server/engine/cards_red.js": { deps: {"./cardlib":"/app/server/engine/cardlib.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const L = require('./cardlib');
const red = L.isColor('red');
const gear200 = L.gearAct(200);
module.exports = {
  'BP01-001': { name: '狂暴熔岩龙 腾炎龙', text: '【起】【1回合1次】［③］或者［丢弃2张手牌］将此卡竖置。',
    acts: [{ name: '竖置此卡', once: true, costs: [{ soul: 3 }, { discard: 2 }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) g.stand(c); } }] },
  'BP01-002': { name: '业火之翼 朱雀', redDmgBoost: true, text: '【永】你的红色卡片给予帕鲁战斗伤害以外的【伤害】时，作为替代给予+200的【伤害】（也强化自身能力）。\n【自】【登场时】选择至多1只帕鲁，给予700【伤害】。',
    autos: [L.onDeploy('选择至多1只帕鲁，给予700伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 700); })] },
  'BP01-003': { name: '红色暴脾气 红小鲨', text: '【永】你的其他所有红色帕鲁【战斗力】+300。',
    statics: [{ power: (g, s, c) => c !== s && c.ctrl === s.ctrl && g.isPal(c) && red(c) ? 300 : 0 }] },
  'BP01-004': { name: '刹那之刃 浪刃武士', kw: { interrupt: true }, text: '【自】此卡进行攻击的战斗结束时，可以将此卡返回手牌。\n【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）',
    autos: [{ text: '战斗结束时可返回手牌', when: (g, ev, c) => ev.t === 'battleEnd' && ev.att === c && ev.attInst === c.inst,
      run: function* (g, c, pi) { if (c.zone === 'base' && (yield* g.yesno(pi, `是否将 ${g.cname(c)} 返回手牌？`))) L.bounce(g, c); } }] },
  'BP01-005': { name: '矿石暴食兽 熔岩兽', text: '【自】【登场时】获得3个【素材】。\n【起】【1回合1次】［消费3个【素材】］检视你的卡组顶5张卡，选择至多1张◇8以下的装备使其登场，其余与卡组洗切。',
    autos: [L.onDeploy('获得3个素材', function* (g, c, pi) { g.gain(pi, 'material', 3); })],
    acts: [{ name: '检视5张，装备登场', once: true, costs: [{ material: 3 }], run: function* (g, c, pi) {
      yield* L.lookPick(g, pi, 5, 1, x => x.def.kind === 'gear' && x.def.cost <= 8, '选择至多1张◇8以下的装备登场', function* (x) { yield* L.deploy(g, x, pi); });
    } }] },
  'BP01-006': { name: '勇气之火 火绒狐', kw: { brave: 300 }, text: '【自】勇敢300（【攻击时】直至回合结束，此卡【战斗力】+300）' },
  'BP01-007': { name: '屠龙之牙 苍焰狼', text: '【自】【登场时】选择至多1只◇7以上的帕鲁，给予1200【伤害】。',
    autos: [L.onDeploy('◇7以上帕鲁1200伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 1200, { filter: L.cmpCost('>=', 7) }); })] },
  'BP01-008': { name: '危险勿碰 伏特喵', text: '【自】【登场时】选择至多1只竖置状态的帕鲁，给予500【伤害】。',
    autos: [L.onDeploy('竖置帕鲁500伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 500, { filter: x => !x.rested }); })] },
  'BP01-009': { name: '勇猛迅雷 雷角马', kw: { brave: 300 }, text: '【自】勇敢300（【攻击时】直至回合结束，此卡【战斗力】+300）' },
  'BP01-010': { name: '炎击之翼 燧火鸟', text: '【自】【攻击时】选择你所有的红色帕鲁，直至回合结束，【战斗力】+500/【打击力】+1。',
    autos: [L.onAttack('所有红色帕鲁+500/+1', function* (g, c, pi) { for (const x of g.myPals(pi, red)) g.addMod(x, { power: 500, strike: 1 }); })] },
  'BP01-011': { name: '坚强火种 燎火鹿', kw: { serious: 400 }, text: '【自】认真400（【任命时】选择1只帕鲁，直至回合结束，【战斗力】+400）' },
  'BP01-012': { name: '灼热之泪 融焰娘', text: '【自】【登场时】获得2个【素材】。',
    autos: [L.onDeploy('获得2个素材', function* (g, c, pi) { g.gain(pi, 'material', 2); })] },
  'BP01-013': { name: '烈火骏马 火麒麟', text: '' },
  'BP01-014': { name: '挡路狱炎 狱焰王', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'BP01-015': { name: '固定式机关枪', text: '【起】【1回合1次】［消费X个【素材】、任命1只帕鲁］执行X次〈选择1只帕鲁，给予500【伤害】。〉',
    acts: [{ name: 'X次500伤害', once: true, costs: [{ material: 'X', assign: 1 }], run: function* (g, c, pi, p) {
      for (let i = 0; i < p.x; i++) yield* L.dmg(g, c, pi, 500, { upTo: false, prompt: `第 ${i + 1}/${p.x} 次：选择1只帕鲁，给予500伤害` });
    } }] },
  'BP01-016': { name: '原始熔炉', text: '【起】【1回合1次】［任命1只帕鲁］获得3个【素材】，抽1张卡。\n【起】【1回合1次】［消费X个【素材】］直至回合结束，你下一次从手牌使用装备的费用减少X。不会因此能力变为◇0以下。',
    acts: [{ name: '获得3素材并抽1', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) { g.gain(pi, 'material', 3); g.draw(pi, 1); } },
      { name: '下一张装备费用-X', once: true, costs: [{ material: 'X' }], run: function* (g, c, pi, p) { g.p[pi].gearDiscount = { x: p.x, until: g.turnNo }; g.say(`下一张装备费用 -${p.x}`); } }] },
  'BP01-017': { name: '圣火台', text: '【永】你所有的红色帕鲁【战斗力】+200。\n【自】你的红色帕鲁登场时，获得1个【素材】。',
    statics: [{ power: (g, s, c) => c.ctrl === s.ctrl && g.isPal(c) && red(c) ? 200 : 0 }],
    autos: [{ text: '红色帕鲁登场时获得1素材', when: (g, ev, c) => ev.t === 'deploy' && g.isPal(ev.card) && red(ev.card) && ev.card.ctrl === c.ctrl, run: function* (g, c, pi) { g.gain(pi, 'material', 1); } }] },
  'BP01-018': { name: '警钟', text: '【起】【1回合1次】［①、任命1只帕鲁］将该回合中已任命的帕鲁全部竖置。直至回合结束，你无法用帕鲁进行任命，且须尽可能进行攻击（包括发动此能力后登场的帕鲁）。',
    acts: [{ name: '竖置已任命帕鲁', once: true, costs: [{ soul: 1, assign: 1 }], run: function* (g, c, pi) {
      for (const x of g.myPals(pi, x => x.assignedTurn === g.turnNo)) g.stand(x);
      g.p[pi].flags.noAssign = g.turnNo; g.p[pi].flags.mustAttack = g.turnNo;
    } }] },
  'BP01-019': { name: '火绒狐的背带', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。若其主名称为《火绒狐》，直至回合结束，赋予其〈〉内的能力。〈【自】【攻击时】选择至多1只帕鲁，给予700【伤害】〉。',
    acts: [L.gearAct(200, function* (g, c, pi, t) {
      if (t && g.hasMain(t, '火绒狐')) t.grants.push({ until: g.turnNo, src: c, auto: L.onAttack('选择至多1只帕鲁，给予700伤害', function* (g2, x, pi2) { yield* L.dmg(g2, c, pi2, 700); }) });
    })] },
  'BP01-020': { name: '泵动式霰弹枪', text: '【自】【登场时】选择对方所有的帕鲁，给予1200【伤害】。\n【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。',
    autos: [L.onDeploy('对方所有帕鲁1200伤害', function* (g, c, pi) { L.dmgAllOpp(g, c, pi, 1200); })], acts: [gear200] },
  'BP01-021': { name: '粗制手枪', text: '【自】【登场时】选择至多1只帕鲁，给予500【伤害】。\n【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。',
    autos: [L.onDeploy('至多1只帕鲁500伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 500); })], acts: [gear200] },
  'BP01-022': { name: '石镐', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200，获得1个【素材】。',
    acts: [L.gearAct(200, function* (g, c, pi) { g.gain(pi, 'material', 1); })] },
  'BP01-023': { name: '阿克塞尔的作战', text: '从以下选择1项。\n・选择1只帕鲁，给予1500【伤害】。\n・选择至多X只帕鲁，将其竖置。X为你的装备数量。\n・选择对方所有◇5以上的帕鲁，直至回合结束，其无法阻挡。',
    play: function* (g, c, pi) {
      const i = yield* g.option(pi, '阿克塞尔的作战：选择1项', ['1只帕鲁1500伤害', `竖置至多X只帕鲁（X=${g.p[pi].base.filter(g.isGear).length}）`, '对方◇5以上帕鲁无法阻挡']);
      if (i === 0) yield* L.dmg(g, c, pi, 1500, { upTo: false });
      else if (i === 1) { const x = g.p[pi].base.filter(g.isGear).length; const ts = yield* g.choose(pi, g.pals(), 0, x, `选择至多 ${x} 只帕鲁竖置`, { always: true }); for (const t of ts) g.stand(t); }
      else for (const t of g.opPals(pi, L.cmpCost('>=', 5))) g.addMod(t, { noBlock: true });
    } },
  'BP01-024': { name: '发现宝箱！', text: '检视你的卡组顶5张卡，选择至多1张红色的建筑物或红色的装备加入手牌，其余与卡组洗切。选择了0张时，获得3个【素材】。',
    play: function* (g, c, pi) {
      const pk = yield* L.lookPick(g, pi, 5, 1, x => red(x) && (x.def.kind === 'building' || x.def.kind === 'gear'), '选择至多1张红色建筑物/装备加入手牌', function* (x) { L.toHand(g, x); });
      if (!pk.length) g.gain(pi, 'material', 3);
    } },
  'TD01-001': { name: '暴走重战车 暴电熊', kw: { assault: true }, text: '【永】袭击（此卡可以选择处于竖置状态的帕鲁作为攻击目标）' },
  'TD01-002': { name: '刺激又纯真 电棘鼠', text: '' },
  'TD01-003': { name: '熔岩好天气 火灵儿', text: '' },
  'TD01-004': { name: '暖烘烘抱抱 火绒狐', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'TD01-005': { name: '热腾腾的掉落物 炽焰牛', text: '【自】【登场时】获得2个【素材】。',
    autos: [L.onDeploy('获得2个素材', function* (g, c, pi) { g.gain(pi, 'material', 2); })] },
  'TD01-006': { name: '特攻队长 雷胖达', text: '【起】［消费2个【素材】］直至回合结束，此卡【战斗力】+500。',
    acts: [{ name: '战斗力+500', costs: [{ material: 2 }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) g.addMod(c, { power: 500 }); } }] },
  'TD01-007': { name: '统御熔岩者 焰煌', text: '【自】【登场时】选择至多1只帕鲁，给予1000【伤害】。',
    autos: [L.onDeploy('至多1只帕鲁1000伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 1000); })] },
  'TD01-008': { name: '采石场', text: '【起】【1回合1次】［任命1只帕鲁］获得3个【素材】，抽1张卡。（可以通过横置你竖置的帕鲁进行任命）',
    acts: [{ name: '获得3素材并抽1', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) { g.gain(pi, 'material', 3); g.draw(pi, 1); } }] },
  'TD01-009': { name: '武器工作台', text: '【起】【1回合1次】［消费1个【素材】、任命1只帕鲁］选择至多1只帕鲁，给予800【伤害】。选择你所有的帕鲁，直至回合结束【打击力】+1。',
    acts: [{ name: '800伤害并全体打击力+1', once: true, costs: [{ material: 1, assign: 1 }], run: function* (g, c, pi) {
      yield* L.dmg(g, c, pi, 800); for (const x of g.myPals(pi)) g.addMod(x, { strike: 1 });
    } }] },
  'TD01-010': { name: '单发步枪', text: '【自】【登场时】选择至多1只帕鲁，给予1500【伤害】。\n【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。',
    autos: [L.onDeploy('至多1只帕鲁1500伤害', function* (g, c, pi) { yield* L.dmg(g, c, pi, 1500); })], acts: [gear200] },
  'TD01-011': { name: '火焰吐息', text: '【快速】选择1只帕鲁，给予500【伤害】。',
    play: function* (g, c, pi) { yield* L.dmg(g, c, pi, 500, { upTo: false }); } },
  'SS01-001': { name: '倾泻电击 暴电熊', text: '【自】【登场时】选择对方所有的帕鲁，给予300【伤害】。',
    autos: [L.onDeploy('对方所有帕鲁300伤害', function* (g, c, pi) { L.dmgAllOpp(g, c, pi, 300); })] },
};

} },
"/app/server/engine/cardlib.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 卡牌效果辅助函数
const L = {};
L.onDeploy = (text, run) => ({ text: '【登场时】' + text, when: (g, ev, c) => ev.t === 'deploy' && ev.card === c, run });
L.onAttack = (text, run) => ({ text: '【攻击时】' + text, when: (g, ev, c) => ev.t === 'attack' && ev.card === c, run });
L.onAssign = (text, run) => ({ text: '【任命时】' + text, when: (g, ev, c) => ev.t === 'assign' && ev.card === c, run });
L.onGrave = (text, run) => ({ text, when: (g, ev, c) => ev.t === 'toGrave' && ev.card === c, run });
L.onMyTurnEnd = (text, run) => ({ text, when: (g, ev, c) => ev.t === 'turnEnd' && ev.pi === c.ctrl && c.zone === 'base', run });

// 选择至多 n 只满足条件的帕鲁，给予 amt 伤害
L.dmg = function* (g, src, pi, amt, { n = 1, upTo = true, filter, prompt, kinds = ['pal'] } = {}) {
  const cands = g.allBase().filter(c => kinds.includes(c.def.kind) && (!filter || filter(c)));
  const ts = yield* g.choose(pi, cands, upTo ? 0 : n, n, prompt || `选择${upTo ? '至多' : ''} ${n} 张，给予 ${amt} 伤害`, { always: upTo });
  for (const t of ts) g.dealDamage(src, pi, t, amt);
  return ts;
};
L.dmgAllOpp = (g, src, pi, amt) => { for (const t of g.opPals(pi)) g.dealDamage(src, pi, t, amt); };
L.buff = function* (g, pi, mod, { n = 1, upTo = false, filter, prompt } = {}) {
  const ts = yield* g.choose(pi, g.pals(filter), upTo ? 0 : n, n, prompt || '选择帕鲁', { always: upTo });
  for (const t of ts) g.addMod(t, mod);
  return ts;
};
L.restUpTo = function* (g, pi, n, filter, noStand) {
  const ts = yield* g.choose(pi, g.pals(filter), 0, n, `选择至多 ${n} 只帕鲁横置`, { always: true });
  for (const t of ts) {
    g.rest(t); g.say(`${g.cname(t)} 被横置`);
    if (noStand === 'next') t.noStand.push({ type: 'nextStand', pi: 1 - pi });
    else if (noStand) t.noStand.push(noStand);
  }
  return ts;
};
// 检视卡组顶 n 张（返回卡数组，仍在卡组中）
L.top = (g, pi, n) => g.p[pi].deck.slice(0, n);
L.reveal = (g, cards, who) => {
  if (!cards.length) return;
  g.say(`${who || ''}公开：${cards.map(c => g.cname(c)).join('、')}`);
  // 公开事件：双方客户端都会播放翻牌展示
  const pi = g.p.findIndex(p => p.deck.includes(cards[0]) || p.hand.includes(cards[0]));
  const from = pi >= 0 && g.p[pi].hand.includes(cards[0]) ? 'hand' : 'deck';
  (g.reveals || (g.reveals = [])).push({ n: g.reveals.length + 1, pi: pi < 0 ? (cards[0].owner ?? 0) : pi, from, cards: cards.map(c => ({ uid: c.uid, id: c.id })) });
};
// 检视顶 n 张，选择至多 k 张满足条件的卡执行 fn，其余洗回
L.lookPick = function* (g, pi, n, k, filter, prompt, fn, { min = 0, revealPick = true } = {}) {
  const cards = L.top(g, pi, n);
  const ok = cards.filter(c => !filter || filter(c));
  const pick = yield* g.choose(pi, ok, Math.min(min, ok.length), k, prompt + `（检视：${cards.map(c => g.cname(c)).join('、') || '无'}）`, { always: true, reveal: true, view: cards });
  if (revealPick) L.reveal(g, pick, '');
  for (const c of pick) yield* fn(c);
  g.shuffle(g.p[pi].deck);
  return pick;
};
L.deploy = function* (g, c, pi, opt = {}) {
  g.move(c, 'base', { ctrl: pi, rested: !!opt.rested });
  g.say(`${g.cname(c)} 登场${opt.rested ? '（横置）' : ''}`);
};
L.toHand = (g, c) => { g.move(c, 'hand'); g.say(`${g.cname(c)} 加入手牌`); };
L.toGrave = (g, c) => { g.move(c, 'grave'); g.say(`${g.cname(c)} 被放置入墓地`); };
L.bounce = (g, c) => { g.move(c, 'hand'); g.say(`${g.cname(c)} 返回手牌`); };
// 横置此卡的装备通用能力：选择1只帕鲁战斗力+n
L.gearAct = (n, extra, name) => ({
  name: name || `选择1只帕鲁战斗力+${n}`, costs: [{ restSelf: true }],
  run: function* (g, c, pi, paid) {
    const ts = yield* g.choose(pi, g.pals(), 1, 1, `选择 1 只帕鲁，直至回合结束战斗力+${n}`);
    for (const t of ts) g.addMod(t, { power: n });
    if (extra) yield* extra(g, c, pi, ts[0], paid);
  },
});
L.cmpCost = (op, x) => c => op === '<=' ? c.def.cost <= x : c.def.cost >= x;
L.chooseRes = function* (g, pi, n) {
  const i = yield* g.option(pi, `获得 ${n} 个素材或食材`, [`${n} 个【素材】`, `${n} 个【食材】`]);
  g.gain(pi, i === 0 ? 'material' : 'ingredient', n);
};
L.night = g => g.isNight();
L.isColor = col => c => c.def.color === col;
// 「牧场」建筑物
L.isRanch = c => c.def.kind === 'building' && c.def.apts.includes('牧场');
module.exports = L;

} },
"/app/server/engine/cards_blue.js": { deps: {"./cardlib":"/app/server/engine/cardlib.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const L = require('./cardlib');
const gear200 = L.gearAct(200);
const NOSTAND_WHILE = c => ({ type: 'while', srcUid: c.uid, srcInst: c.inst });
module.exports = {
  'BP01-025': { name: '唤龙之声 疾旋鼬', text: '【自】【登场时】公开你的卡组顶1张卡，若其为◇8以下的【龙】属性帕鲁，可以使其登场。不使其登场的场合，将其加入手牌。',
    autos: [L.onDeploy('公开顶1张，龙属性帕鲁可登场', function* (g, c, pi) {
      const t = g.p[pi].deck[0]; if (!t) return; L.reveal(g, [t]);
      if (g.isPal(t) && t.def.cost <= 8 && t.def.types.includes('龙') && (yield* g.yesno(pi, `是否使 ${g.cname(t)} 登场？`))) yield* L.deploy(g, t, pi);
      else L.toHand(g, t);
    })] },
  'BP01-026': { name: '饿饿射手 佩克龙', text: '【自】【登场时】选择至多1只◇6以下的帕鲁，将其横置。只要此卡在据点，其不竖置。',
    autos: [L.onDeploy('◇6以下帕鲁横置且不竖置', function* (g, c, pi) { yield* L.restUpTo(g, pi, 1, L.cmpCost('<=', 6), NOSTAND_WHILE(c)); })] },
  'BP01-027': { name: '逆卷海龙 覆海龙', text: '【自】【登场时】抽1张卡，选择至多1只◇7以下的帕鲁，将其横置。其在下一个对方的竖置阶段中不竖置。',
    autos: [L.onDeploy('抽1，◇7以下帕鲁横置', function* (g, c, pi) { g.draw(pi, 1); yield* L.restUpTo(g, pi, 1, L.cmpCost('<=', 7), 'next'); })] },
  'BP01-028': { name: '憧憬天空 企丸丸', text: '【自】此卡被放置于墓地时，抽1张卡。',
    autos: [L.onGrave('被放置于墓地时抽1', function* (g, c, pi) { g.draw(pi, 1); })] },
  'BP01-029': { name: '水龙之舞 碧海龙', text: '【自】【登场时】抽1张卡，选择至多1只帕鲁，将其横置。',
    autos: [L.onDeploy('抽1，横置至多1只帕鲁', function* (g, c, pi) { g.draw(pi, 1); yield* L.restUpTo(g, pi, 1); })] },
  'BP01-030': { name: '冰霜的暴食兽 寒霜兽', text: '【自】【登场时】抽1张卡。\n【起】【1回合1次】［丢弃1张手牌］检视你的卡组顶5张卡，选择至多2张◇6以下的建筑物使其登场，其余与卡组洗切。',
    autos: [L.onDeploy('抽1张卡', function* (g, c, pi) { g.draw(pi, 1); })],
    acts: [{ name: '检视5张，建筑物登场', once: true, costs: [{ discard: 1 }], run: function* (g, c, pi) {
      const pk = [];
      yield* L.lookPick(g, pi, 5, 2, x => x.def.kind === 'building' && x.def.cost <= 6, '选择至多2张◇6以下的建筑物登场', function* (x) { pk.push(x); });
      g.moveMany(pk, 'base', { ctrl: pi }); for (const x of pk) g.say(`${g.cname(x)} 登场`);
    } }] },
  'BP01-031': { name: '大海原的大战士 企丸王', text: '【永】你所有主名称为《企丸丸》的帕鲁【战斗力】+700。',
    statics: [{ power: (g, s, c) => c.ctrl === s.ctrl && g.isPal(c) && g.hasMain(c, '企丸丸') ? 700 : 0 }] },
  'BP01-032': { name: '兴致冲浪手 冲浪鸭', text: '【自】此卡被攻击时，直至回合结束，此卡【战斗力】+300。',
    autos: [{ text: '被攻击时战斗力+300', when: (g, ev, c) => ev.t === 'attacked' && ev.card === c, run: function* (g, c) { g.addMod(c, { power: 300 }); } }] },
  'BP01-033': { name: '雪山看守者 白绒雪怪', text: '【永】此卡处于横置状态时，对方所有帕鲁【打击力】-1。',
    statics: [{ strike: (g, s, c) => s.rested && g.isPal(c) && c.ctrl !== s.ctrl ? -1 : 0 }] },
  'BP01-034': { name: '倾注元气 壶小象', kw: { serious: 400 }, text: '【自】认真400（【任命时】选择1只帕鲁，直至回合结束，【战斗力】+400）' },
  'BP01-035': { name: '招财进宝 冰丝特', text: '【自】此卡被任命至「牧场」的建筑物时，抽1张卡。',
    autos: [{ text: '任命至牧场时抽1', when: (g, ev, c) => ev.t === 'assign' && ev.card === c && L.isRanch(ev.bld), run: function* (g, c, pi) { g.draw(pi, 1); } }] },
  'BP01-036': { name: '翻身回旋 鲁米儿', text: '【自】【攻击时】抽1张卡，选择你的1张手牌丢弃。',
    autos: [L.onAttack('抽1弃1', function* (g, c, pi) { g.draw(pi, 1); const d = yield* g.choose(pi, g.p[pi].hand, 1, 1, '选择1张手牌丢弃', { always: true }); for (const x of d) g.move(x, 'grave'); })] },
  'BP01-037': { name: '畅游泳者 滑水蛇', text: '' },
  'BP01-038': { name: '冰冻试炼 冰棘兽', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'BP01-039': { name: '古典式窗帘', text: '【自】【登场时】选择至多X只对方的帕鲁，将其返回手牌。X为你的卡名中含有《古典式》的建筑物中不同卡名的数量。',
    autos: [L.onDeploy('返回对方至多X只帕鲁', function* (g, c, pi) {
      const x = g.distinctCount(g.p[pi].base.filter(b => g.isBld(b) && g.namesOf(b).some(n => n.includes('アンティーク'))));
      const ts = yield* g.choose(pi, g.opPals(pi), 0, x, `选择至多 ${x} 只对方帕鲁返回手牌`, { always: true });
      g.moveMany(ts, 'hand'); for (const t of ts) g.say(`${g.cname(t)} 返回手牌`);
    })] },
  'BP01-040': { name: '古典式化妆台', text: '【起】【1回合1次】［丢弃1张手牌］宣言1个卡名。选择你所有的卡片，直至回合结束，追加被宣言的卡名。\n【起】【1回合1次】［丢弃X张手牌］选择你的X只帕鲁，直至回合结束，【战斗力】+1000/【打击力】+1。',
    acts: [{ name: '宣言卡名', once: true, costs: [{ discard: 1 }], run: function* (g, c, pi) {
      const names = [...new Set(Object.values(g.db).filter(d => d && d.ja).map(d => d.ja))];
      const i = yield* g.option(pi, '宣言1个卡名', names.map(n => g.db._byJa[n].name));
      for (const x of g.p[pi].base) x.names.push(names[i]);
      g.say(`宣言卡名：${g.db._byJa[names[i]].name}`);
    } }, { name: 'X只帕鲁+1000/+1', once: true, costs: [{ discard: 'X' }], run: function* (g, c, pi, p) {
      const ts = yield* g.choose(pi, g.myPals(pi), p.x, p.x, `选择你的 ${p.x} 只帕鲁`);
      for (const t of ts) g.addMod(t, { power: 1000, strike: 1 });
    } }] },
  'BP01-041': { name: '温泉', text: '【起】【1回合1次】［任命1只帕鲁］选择至多2只◇6以下的帕鲁，将其横置。其在下一个对方的竖置阶段中不竖置。',
    acts: [{ name: '横置至多2只帕鲁', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) { yield* L.restUpTo(g, pi, 2, L.cmpCost('<=', 6), 'next'); } }] },
  'BP01-042': { name: '古典式镜子', text: '【自】【登场时】抽1张卡。', autos: [L.onDeploy('抽1张卡', function* (g, c, pi) { g.draw(pi, 1); })] },
  'BP01-043': { name: '帕鲁球工作台', text: '【起】【1回合1次】［任命1只帕鲁］抽2张卡，选择你的1张手牌丢弃。',
    acts: [{ name: '抽2弃1', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) {
      g.draw(pi, 2); const d = yield* g.choose(pi, g.p[pi].hand, 1, 1, '选择1张手牌丢弃', { always: true }); for (const x of d) g.move(x, 'grave');
    } }] },
  'BP01-044': { name: '企丸丸的火箭发射器', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。若其主名称为《企丸丸》，作为替代【战斗力】+500，并直至回合结束赋予其〈〉内的能力。〈【起】［横置此卡］选择对方所有的帕鲁，给予X【伤害】。X为此卡的【战斗力】。将此卡放置于墓地〉。',
    acts: [{ name: '选择1只帕鲁强化', costs: [{ restSelf: true }], run: function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.pals(), 1, 1, '选择1只帕鲁（企丸丸则+500并获得能力）');
      const t = ts[0]; if (!t) return;
      if (g.hasMain(t, '企丸丸')) {
        g.addMod(t, { power: 500 });
        t.grants.push({ until: g.turnNo, act: { name: '火箭发射', costs: [{ restSelf: true }], run: function* (g2, x, pi2, p) {
          const amt = g2.power(x); L.dmgAllOpp(g2, x, pi2, amt); if (g2.same(x, p.inst)) L.toGrave(g2, x);
        } } });
      } else g.addMod(t, { power: 200 });
    } }] },
  'BP01-045': { name: '抓钩枪', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200，并赋予其〈〉内的能力。〈【自】警戒（你的回合结束时，将此卡竖置）〉。',
    acts: [L.gearAct(200, function* (g, c, pi, t) { if (t) t.grants.push({ until: g.turnNo, kw: { vigilance: 1 } }); })] },
  'BP01-046': { name: '维克托的作战', text: '从以下选择1项。\n・检视你的卡组顶5张卡，选择1张加入手牌，其余与卡组洗切。\n・选择1只帕鲁，将其返回手牌。\n・抽X张卡。X为你的建筑物数量。',
    play: function* (g, c, pi) {
      const x = g.p[pi].base.filter(b => g.isBld(b)).length;
      const i = yield* g.option(pi, '维克托的作战：选择1项', ['检视5张选1加入手牌', '1只帕鲁返回手牌', `抽X张（X=${x}）`]);
      if (i === 0) yield* L.lookPick(g, pi, 5, 1, null, '选择1张加入手牌', function* (y) { L.toHand(g, y); }, { min: 1, revealPick: false });
      else if (i === 1) { const ts = yield* g.choose(pi, g.pals(), 1, 1, '选择1只帕鲁返回手牌'); for (const t of ts) L.bounce(g, t); }
      else g.draw(pi, x);
    } },
  'BP01-047': { name: '帕鲁球', text: '抽3张卡。', play: function* (g, c, pi) { g.draw(pi, 3); } },
  'BP01-048': { name: '极光的指引', text: '【快速】抽1张卡，选择至多1张你的手牌，将其放置于卡组顶。',
    play: function* (g, c, pi) { g.draw(pi, 1); const d = yield* g.choose(pi, g.p[pi].hand, 0, 1, '选择至多1张手牌放置于卡组顶', { always: true }); for (const x of d) g.move(x, 'deck', { top: true }); } },
  'TD01-012': { name: '温柔波纹 水灵龙', text: '【自】【登场时】抽2张卡，选择你的1张手牌，将其放置于卡组顶。',
    autos: [L.onDeploy('抽2，1张放回卡组顶', function* (g, c, pi) { g.draw(pi, 2); const d = yield* g.choose(pi, g.p[pi].hand, 1, 1, '选择1张手牌放置于卡组顶', { always: true }); for (const x of d) g.move(x, 'deck', { top: true }); })] },
  'TD01-013': { name: '固执又纯真 冰刺鼠', text: '' },
  'TD01-014': { name: '飞得远的炮弹 企丸丸', text: '' },
  'TD01-015': { name: '冻夜徘徊 冰缚灵', text: '【自】【登场时】选择至多1只◇3以下的帕鲁，将其横置。',
    autos: [L.onDeploy('◇3以下帕鲁横置', function* (g, c, pi) { yield* L.restUpTo(g, pi, 1, L.cmpCost('<=', 3)); })] },
  'TD01-016': { name: '冰冷眼神 严冬鹿', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'TD01-017': { name: '流水之理 清雀', kw: { vigilance: 1 }, text: '【自】警戒（你的回合结束时，将此卡竖置）' },
  'TD01-018': { name: '冰原轰鸣者 雪猛犸', text: '【永】你每有1张建筑物，此卡【战斗力】+200。\n【起】［丢弃1张手牌中的建筑物］直至回合结束，此卡【打击力】+1。',
    statics: [{ power: (g, s, c) => c === s ? 200 * g.p[s.ctrl].base.filter(b => g.isBld(b)).length : 0 }],
    acts: [{ name: '打击力+1', costs: [{ discardBuilding: true }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) g.addMod(c, { strike: 1 }); } }] },
  'TD01-019': { name: '古典式木椅', text: '【自】【登场时】选择至多1只帕鲁，直至回合结束【战斗力】+1000。',
    autos: [L.onDeploy('至多1只帕鲁+1000', function* (g, c, pi) { yield* L.buff(g, pi, { power: 1000 }, { upTo: true }); })] },
  'TD01-020': { name: '原始工作台', text: '【起】【1回合1次】［任命1只帕鲁］公开你的卡组顶1张卡，若其为◇6以下的建筑物或装备，可以使其登场。不使其登场的场合，将其加入手牌。',
    acts: [{ name: '公开顶1张', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) {
      const t = g.p[pi].deck[0]; if (!t) return; L.reveal(g, [t]);
      if ((t.def.kind === 'building' || t.def.kind === 'gear') && t.def.cost <= 6 && (yield* g.yesno(pi, `是否使 ${g.cname(t)} 登场？`))) yield* L.deploy(g, t, pi);
      else L.toHand(g, t);
    } }] },
  'TD01-021': { name: '单发式帕鲁球发射器', text: '【自】【登场时】抽1张卡。\n【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。',
    autos: [L.onDeploy('抽1张卡', function* (g, c, pi) { g.draw(pi, 1); })], acts: [gear200] },
  'TD01-022': { name: '寒冰吐息', text: '【快速】选择1只帕鲁，直至回合结束【打击力】-3。其在下一个对方的竖置阶段中不竖置。',
    play: function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.pals(), 1, 1, '选择1只帕鲁，打击力-3');
      for (const t of ts) { g.addMod(t, { strike: -3 }); t.noStand.push({ type: 'nextStand', pi: 1 - pi }); }
    } },
  'SS01-002': { name: '收尾冰刃 疾旋鼬', text: '【自】此卡的战斗对手帕鲁被放置于墓地时，抽1张卡。',
    autos: [{ text: '战斗对手被放置于墓地时抽1', when: (g, ev, c) => { const B = g.battle; if (!B || ev.t !== 'toGrave') return false;
      return (B.att === c && B.opp === ev.card && ev.lki.inst === B.tInst) || (B.opp === c && B.att === ev.card && ev.lki.inst === B.attInst); },
      run: function* (g, c, pi) { g.draw(pi, 1); } }] },
};

} },
"/app/server/engine/cards_green.js": { deps: {"./cardlib":"/app/server/engine/cardlib.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const L = require('./cardlib');
const TAUNT = '【永】嘲讽（对方在可能的情况下，须选择此卡作��攻击目标）';
const BREAK = { kw: { breakthrough: 1 } };
module.exports = {
  'BP01-049': { name: '女神的祝福 百合女王', text: '【自】【登场时】获得3个【食材】。\n【起】【1回合1次】［消费3个【食材】］检视你的卡组顶5张卡，选择至多1只◇6以下的帕鲁使其登场，其余与卡组洗切。',
    autos: [L.onDeploy('获得3个食材', function* (g, c, pi) { g.gain(pi, 'ingredient', 3); })],
    acts: [{ name: '检视5张，帕鲁登场', once: true, costs: [{ ingredient: 3 }], run: function* (g, c, pi) {
      yield* L.lookPick(g, pi, 5, 1, x => g.isPal(x) && x.def.cost <= 6, '选择至多1只◇6以下的帕鲁登场', function* (x) { yield* L.deploy(g, x, pi); });
    } }] },
  'BP01-050': { name: '轰鸣刚矛 碎岩龟', text: '【永】你的灵魂在10张以上时，此卡【战斗力】+1000/【打击力】+1。\n【起】【1回合1次】［消费2个【食材】］直至回合结束，此卡【战斗力】+500，并获得〈〉内的能力。〈【自】突破（此卡攻击中战斗对手的帕鲁被放置于墓地时，也给予对方玩家【伤害】）〉。',
    statics: [{ power: (g, s, c) => c === s && g.p[s.ctrl].souls.length >= 10 ? 1000 : 0, strike: (g, s, c) => c === s && g.p[s.ctrl].souls.length >= 10 ? 1 : 0 }],
    acts: [{ name: '+500并获得突破', once: true, costs: [{ ingredient: 2 }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) { g.addMod(c, { power: 500 }); c.grants.push({ until: g.turnNo, ...BREAK }); } } }] },
  'BP01-051': { name: '甜蜜祝福 花丽娜', text: '【自】【登场时】获得1点生命，选择2张灵魂，将其竖置。',
    autos: [L.onDeploy('生命+1，竖置2灵魂', function* (g, c, pi) { g.gainLife(pi, 1); g.standSouls(pi, 2); })] },
  'BP01-052': { name: '猪突粉碎 草莽猪', text: '【自】此卡攻击建筑物时，直至回合结束，此卡【战斗力】+800。',
    autos: [{ text: '攻击建筑物时+800', when: (g, ev, c) => ev.t === 'attack' && ev.card === c && ev.target !== 'player' && g.isBld(ev.target), run: function* (g, c) { g.addMod(c, { power: 800 }); } }] },
  'BP01-053': { name: '花园女王 女皇蜂', text: '【永】你每有1只主名称为《骑士蜂》的帕鲁，此卡【战斗力】+300。\n【起】［消费1个【食材】］检视你的卡组顶1张卡，若其为主名称为《骑士蜂》的帕鲁，可以将费用减少◇2来使用。不会因此能力变为◇0以下。',
    statics: [{ power: (g, s, c) => c === s ? 300 * g.myPals(s.ctrl, x => g.hasMain(x, '骑士蜂')).length : 0 }],
    acts: [{ name: '检视顶1张骑士蜂', costs: [{ ingredient: 1 }], run: function* (g, c, pi) {
      const t = g.p[pi].deck[0]; if (!t) return;
      g.say(`${g.p[pi].name} 检视了卡组顶的卡`);
      const cost = Math.max(1, t.def.cost - 2);
      if (g.isPal(t) && g.hasMain(t, '骑士蜂') && g.untapSouls(pi) >= cost && (yield* g.yesno(pi, `顶牌是 ${g.cname(t)}，是否支付 ${cost} 灵魂使用？`))) yield* g.playCard(t, pi, { cost, fromDeck: true });
    } }] },
  'BP01-054': { name: '黑铁要塞 铠格力斯', kw: { taunt: true }, text: TAUNT },
  'BP01-055': { name: '魅惑花旦 薇莉塔', text: '【起】【1回合1次】［丢弃1张手牌］若此卡在该回合中被任命过，将此卡竖置。',
    acts: [{ name: '竖置此卡', once: true, costs: [{ discard: 1 }], canUse: (g, c) => true, run: function* (g, c, pi, p) { if (g.same(c, p.inst) && c.assignedTurn === g.turnNo) g.stand(c); } }] },
  'BP01-056': { name: '期待的新人 翠叶鼠', text: '' },
  'BP01-057': { name: '醇厚恩惠 趴趴鲶', text: '【自】【登场时】获得2个【食材】。\n【自】此卡被任命至「牧场」的建筑物时，以横置状态增加你的1张灵魂。',
    autos: [L.onDeploy('获得2个食材', function* (g, c, pi) { g.gain(pi, 'ingredient', 2); }),
      { text: '任命至牧场时增加1灵魂', when: (g, ev, c) => ev.t === 'assign' && ev.card === c && L.isRanch(ev.bld), run: function* (g, c, pi) { if (g.addSoul(pi, 1, true)) g.say('灵魂 +1（横置）'); } }] },
  'BP01-058': { name: '不可思议的树液 叶泥泥', text: '【自】【登场时】直至回合结束，此卡【战斗力】+300，并获得〈〉内的能力。〈【永】袭击（此卡可以选择处于竖置状态的帕鲁作为攻击目标）〉。',
    autos: [L.onDeploy('+300并获得袭击', function* (g, c) { if (c.zone !== 'base') return; g.addMod(c, { power: 300 }); c.grants.push({ until: g.turnNo, kw: { assault: true } }); })] },
  'BP01-059': { name: '低吼锐矛 碎岩龟', text: '【起】【1回合1次】［消费2个【食材】］直至回合结束，此卡【战斗力】+500，并获得〈〉内的能力。〈【自】突破（此卡攻击中战斗对手的帕鲁被放置于墓地时，也给予对方玩家【伤害】）〉。',
    acts: [{ name: '+500并获得突破', once: true, costs: [{ ingredient: 2 }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) { g.addMod(c, { power: 500 }); c.grants.push({ until: g.turnNo, ...BREAK }); } } }] },
  'BP01-060': { name: '欢乐工人 新叶猿', kw: { serious: 400 }, text: '【自】认真400（【任命时】选择1只帕鲁，直至回合结束，【战斗力】+400）' },
  'BP01-061': { name: '花园骑士 骑士蜂', anyNumber: true, text: '【永】与此卡同名的卡片，可以在卡组中投入任意张数。\n【自】【登场时】获得1个【食材】。若你有「牧场」的建筑物，直至回合结束，此卡【战斗力】+500。',
    autos: [L.onDeploy('获得1食材，有牧场则+500', function* (g, c, pi) { g.gain(pi, 'ingredient', 1); if (g.p[pi].base.some(L.isRanch)) g.addMod(c, { power: 500 }); })] },
  'BP01-062': { name: '南国看守者 绿苔绒怪', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'BP01-063': { name: '配种牧场', text: '【起】【1回合1次】［消费2个【食材】］公开你的卡组顶1张卡，若其为◇8以下的帕鲁则加入手牌，否则放置于墓地。\n【起】【1回合1次】［消费2个【食材】、任命2只帕鲁］从你的手牌中选择1只◇8以下的帕鲁，使其登场。',
    acts: [{ name: '公开顶1张', once: true, costs: [{ ingredient: 2 }], run: function* (g, c, pi) {
      const t = g.p[pi].deck[0]; if (!t) return; L.reveal(g, [t]);
      if (g.isPal(t) && t.def.cost <= 8) L.toHand(g, t); else L.toGrave(g, t);
    } }, { name: '手牌帕鲁登场', once: true, costs: [{ ingredient: 2, assign: 2 }], run: function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.p[pi].hand.filter(x => g.isPal(x) && x.def.cost <= 8), 1, 1, '选择手牌中1只◇8以下的帕鲁登场');
      for (const t of ts) yield* L.deploy(g, t, pi);
    } }] },
  'BP01-064': { name: '可乐自动售货机', text: '【起】【1回合1次】［消费X个【食材】、任命1只帕鲁］选择1张灵魂，将其竖置。并且，选择至多X的3倍张数的灵魂，将其竖置。',
    acts: [{ name: '竖置灵魂', once: true, costs: [{ ingredient: 'X', assign: 1 }], run: function* (g, c, pi, p) { const k = g.standSouls(pi, 1 + 3 * p.x); g.say(`竖置了 ${k} 张灵魂`); } }] },
  'BP01-065': { name: '饲料箱', text: '【起】【1回合1次】［消费1个【食材】］以横置状态增加你的1张灵魂。增加前的灵魂在10张以上时，选择2张灵魂，将其竖置。',
    acts: [{ name: '增加1灵魂', once: true, costs: [{ ingredient: 1 }], run: function* (g, c, pi) {
      const before = g.p[pi].souls.length; g.addSoul(pi, 1, true);
      if (before >= 10) g.standSouls(pi, 2);
    } }] },
  'BP01-066': { name: '家畜牧场', text: '【起】【1回合1次】［任命1只帕鲁］获得【素材】或【食材】中任意一种3个，抽1张卡。',
    acts: [{ name: '获得3资源并抽1', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) { yield* L.chooseRes(g, pi, 3); g.draw(pi, 1); } }] },
  'BP01-067': { name: '帕鲁禁止通行的道路标识', text: '【起】【1回合1次】［任命1只帕鲁］直至下一个对方的回合结束，赋予任命至此卡的帕鲁〈〉内的能力。〈' + TAUNT + '〉。',
    acts: [{ name: '赋予嘲讽', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi, p) { for (const a of p.assigned) if (a.zone === 'base') a.grants.push({ until: g.untilOppNext(pi), kw: { taunt: true } }); } }] },
  'BP01-068': { name: '碎岩龟的头巾', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。若其主名称为《碎岩龟》，获得【素材】或【食材】中任意一种2个。',
    acts: [L.gearAct(200, function* (g, c, pi, t) { if (t && g.hasMain(t, '碎岩龟')) yield* L.chooseRes(g, pi, 2); })] },
  'BP01-069': { name: '农业帽子', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200，获得1个【食材】。',
    acts: [L.gearAct(200, function* (g, c, pi) { g.gain(pi, 'ingredient', 1); })] },
  'BP01-070': { name: '莉莉的作战', text: '从以下选择1项。\n・选择你所有的帕鲁，直至回合结束【战斗力】+1000。\n・选择1张建筑物或装备，将其放置于墓地。\n・以横置状态增加你的1张灵魂。',
    play: function* (g, c, pi) {
      const i = yield* g.option(pi, '莉莉的作战：选择1项', ['你所有帕鲁+1000', '1张建筑物/装备放置于墓地', '增加1灵魂（横置）']);
      if (i === 0) for (const x of g.myPals(pi)) g.addMod(x, { power: 1000 });
      else if (i === 1) { const ts = yield* g.choose(pi, g.allBase().filter(x => g.isBld(x) || g.isGear(x)), 1, 1, '选择1张建筑物或装备'); for (const t of ts) L.toGrave(g, t); }
      else g.addSoul(pi, 1, true);
    } },
  'BP01-071': { name: '发现帕鲁蛋！', text: '检视你的卡组顶5张卡，选择至多1只帕鲁加入手牌，其余与卡组洗切。选择了0张时，获得3个【食材】。',
    play: function* (g, c, pi) {
      const pk = yield* L.lookPick(g, pi, 5, 1, x => g.isPal(x), '选择至多1只帕鲁加入手牌', function* (x) { L.toHand(g, x); });
      if (!pk.length) g.gain(pi, 'ingredient', 3);
    } },
  'BP01-072': { name: '花精灵的祝福', text: '获得1点生命，抽1张卡。', play: function* (g, c, pi) { g.gainLife(pi, 1); g.draw(pi, 1); } },
  'TD02-001': { name: '亲卫队长 叶胖达', text: '' },
  'TD02-002': { name: '梦见双叶 叶泥泥', text: '' },
  'TD02-003': { name: '点心时间 波娜兔', text: '【自】【登场时】获得2个【食材】。', autos: [L.onDeploy('获得2个食材', function* (g, c, pi) { g.gain(pi, 'ingredient', 2); })] },
  'TD02-004': { name: '华丽香气 花冠龙', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'TD02-005': { name: '自然守护者 祇岳鹿', kw: { taunt: true }, text: TAUNT + '\n【起】［消费2个【食材】］直至回合结束，此卡【战斗力】+500。',
    acts: [{ name: '战斗力+500', costs: [{ ingredient: 2 }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) g.addMod(c, { power: 500 }); } }] },
  'TD02-006': { name: '满溢爱情 连理龙', kw: { taunt: true }, text: TAUNT },
  'TD02-007': { name: '大地轰鸣者 森猛犸', text: '【自】此卡被放置于墓地时，获得3个【食材】。', autos: [L.onGrave('被放置于墓地时获得3食材', function* (g, c, pi) { g.gain(pi, 'ingredient', 3); })] },
  'TD02-008': { name: '浆果农园', text: '【起】【1回合1次】［任命1只帕鲁］获得3个【食材】，抽1张卡。（可以通过横置你竖置的帕鲁进行任命）',
    acts: [{ name: '获得3食材并抽1', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) { g.gain(pi, 'ingredient', 3); g.draw(pi, 1); } }] },
  'TD02-009': { name: '营火', text: '【起】【1回合1次】［消费2个【食材】、任命1只帕鲁］你获得1点生命，选择你所有的帕鲁，直至回合结束【战斗力】+1000。',
    acts: [{ name: '生命+1，全体+1000', once: true, costs: [{ ingredient: 2, assign: 1 }], run: function* (g, c, pi) { g.gainLife(pi, 1); for (const x of g.myPals(pi)) g.addMod(x, { power: 1000 }); } }] },
  'TD02-010': { name: '精炼金属长枪', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+900。', acts: [L.gearAct(900)] },
  'TD02-011': { name: '岩石冲击', text: '【快速】选择1只帕鲁，直至回合结束【战斗力】+500。', play: function* (g, c, pi) { yield* L.buff(g, pi, { power: 500 }); } },
};

} },
"/app/server/engine/cards_purple.js": { deps: {"./cardlib":"/app/server/engine/cardlib.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const L = require('./cardlib');
const NOCT = '【永】夜行性（若为黑夜，此卡【战斗力】+300）';
const NIGHT_ACT = { name: '变为黑夜', once: true, costs: [{ mill: 3 }], run: function* (g, c, pi) { g.setNight(g.untilOppNext(pi)); } };
const hasNoct = (g, c) => (g.kw(c).nocturnal || 0) > 0;
module.exports = {
  'BP01-073': { name: '暗夜之翼 雷冥鸟', kw: { nocturnal: 1 }, text: NOCT + '\n【自】你持有〈夜行性〉的帕鲁登场时，若为黑夜，选择至多1只费用在其费用以下的帕鲁，放置于墓地。若放置了1张以上，该回合结束时，将此卡横置。',
    autos: [{ text: '夜行性帕鲁登场时，破坏帕鲁', when: (g, ev, c) => ev.t === 'deploy' && g.isPal(ev.card) && ev.card.ctrl === c.ctrl && hasNoct(g, ev.card),
      run: function* (g, c, pi, ev) {
        if (!g.isNight()) return;
        const cost = ev.card.def.cost;
        const ts = yield* g.choose(pi, g.pals(x => x.def.cost <= cost), 0, 1, `选择至多1只费用◇${cost}以下的帕鲁放置于墓地`, { always: true });
        for (const t of ts) L.toGrave(g, t);
        if (ts.length) { const inst = c.inst, turn = g.turnNo; g.delayed.push({ card: c, ctrl: pi, text: '回合结束时横置此卡', when: (g2, e2) => e2.t === 'turnEnd' && g2.turnNo === turn, run: function* (g2) { if (g2.same(c, inst)) g2.rest(c); } }); }
      } }] },
  'BP01-074': { name: '绝望的基因 异构格里芬', nightWhileRested: true, doubleAuto: true, text: '【永】此卡处于横置状态期间，为黑夜。\n【永】若为黑夜，你的帕鲁的【自】发动2次。\n【自】你的回合结束时，选择至多1只你的帕鲁，将其解体。若解体了1张以上，对方选择1只自己的帕鲁，放置于墓地。',
    autos: [L.onMyTurnEnd('回合结束时解体', function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.myPals(pi), 0, 1, '选择至多1只你的帕鲁解体', { always: true });
      for (const t of ts) g.butcher(t, pi);
      if (ts.length) { const os = yield* g.choose(1 - pi, g.myPals(1 - pi), 1, 1, '选择你的1只帕鲁放置于墓地'); for (const o of os) L.toGrave(g, o); }
    })] },
  'BP01-075': { name: '深渊魔导师 暗巫猫', text: '【起】【1回合1次】［解体1只其他帕鲁］直至回合结束，此卡【战斗力】+1000/【打击力】+1。\n【自】你的帕鲁被解体时，选择至多1只你墓地中费用为X的普通帕鲁，以横置状态登场。X为被解体帕鲁的费用-1。',
    acts: [{ name: '+1000/+1', once: true, costs: [{ butcher: 1, butcherOther: true }], run: function* (g, c, pi, p) { if (g.same(c, p.inst)) g.addMod(c, { power: 1000, strike: 1 }); } }],
    autos: [{ text: '帕鲁被解体时，墓地普通帕鲁登场', when: (g, ev, c) => ev.t === 'butcher' && ev.pi === (c.zone === 'base' ? c.ctrl : c.lki && c.lki.ctrl),
      run: function* (g, c, pi, ev) {
        const x = ev.cost - 1;
        const ts = yield* g.choose(pi, g.p[pi].grave.filter(y => g.isPal(y) && !y.def.lucky && y.def.cost === x), 0, 1, `选择至多1只墓地中费用◇${x}的普通帕鲁横置登场`, { always: true });
        for (const t of ts) yield* L.deploy(g, t, pi, { rested: true });
      } }] },
  'BP01-076': { name: '就在那里！？ 猫蝠怪', text: '【自】【登场时】公开你的卡组顶3张卡，选择至多1只帕鲁加入手牌，其余放置于墓地。',
    autos: [L.onDeploy('公开3张选帕鲁', function* (g, c, pi) {
      const cs = L.top(g, pi, 3); L.reveal(g, cs);
      const pk = yield* g.choose(pi, cs.filter(x => g.isPal(x)), 0, 1, '选择至多1只帕鲁加入手牌', { always: true, view: cs });
      for (const x of pk) L.toHand(g, x);
      for (const x of cs) if (!pk.includes(x)) g.move(x, 'grave');
    })] },
  'BP01-077': { name: '苍炎骏马 邪麒麟', kw: { nocturnal: 1, interrupt: true }, text: NOCT + '\n【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'BP01-078': { name: '女神的冥加 黑月女王', text: '【起】［横置此卡、丢弃1张手牌］选择你墓地中1只◇6以下的帕鲁，以横置状态登场。',
    acts: [{ name: '墓地帕鲁登场', costs: [{ restSelf: true, discard: 1 }], run: function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.p[pi].grave.filter(x => g.isPal(x) && x.def.cost <= 6), 1, 1, '选择墓地中1只◇6以下帕鲁横置登场');
      for (const t of ts) yield* L.deploy(g, t, pi, { rested: true });
    } }] },
  'BP01-079': { name: '晚上才动真格 瞅什魔', kw: { nocturnal: 2 }, text: NOCT + '\n' + NOCT },
  'BP01-080': { name: '梦的开始 寐魔', kw: { nocturnal: 1 }, text: NOCT },
  'BP01-081': { name: '偷心贼 博爱蜥', text: '【自】【攻击时】可以丢弃你的1张手牌。若丢弃了，获得1点生命。',
    autos: [L.onAttack('可弃1张，生命+1', function* (g, c, pi) {
      const d = yield* g.choose(pi, g.p[pi].hand, 0, 1, '可以丢弃1张手牌（生命+1）', { always: true });
      for (const x of d) g.move(x, 'grave'); if (d.length) g.gainLife(pi, 1);
    })] },
  'BP01-082': { name: '梦的延续 寐魔', kw: { nocturnal: 1 }, text: NOCT },
  'BP01-083': { name: '天空袭击者 烽歌龙', text: '【自】【登场时】选择至多1只帕鲁，直至回合结束【战斗力】-300（【战斗力】降至0以下也不会被放置于墓地）。',
    autos: [L.onDeploy('至多1只帕鲁-300', function* (g, c, pi) { yield* L.buff(g, pi, { power: -300 }, { upTo: true }); })] },
  'BP01-084': { name: '潜伏暗中的蝎 冥铠蝎', kw: { retaliate: 1 }, text: '【自】复仇（此卡在战斗中被放置于墓地时，将战斗对手的帕鲁放置于墓地）\n【自】此卡被放置于墓地时，选择至多1只你墓地中的普通帕鲁，返回手牌。',
    autos: [L.onGrave('墓地普通帕鲁返回手牌', function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.p[pi].grave.filter(x => g.isPal(x) && !x.def.lucky), 0, 1, '选择至多1只墓地普通帕鲁返回手牌', { always: true });
      for (const t of ts) L.toHand(g, t);
    })] },
  'BP01-085': { name: '逢魔时的使者 噬魂兽', nightWhileRested: true, text: '【永】此卡处于横置状态期间，为黑夜。\n【永】若为黑夜，对方所有帕鲁【战斗力】-200（【战斗力】降至0以下也不会被放置于墓地）。',
    statics: [{ power: (g, s, c) => g.isPal(c) && c.ctrl !== s.ctrl && g.isNight() ? -200 : 0 }] },
  'BP01-086': { name: '沉默的孩子 露娜蒂', text: '' },
  'BP01-087': { name: '闪耀月光 月镰魔', text: '【自】【登场时】若为黑夜，选择至多1只竖置状态的◇6以下的帕鲁，放置于墓地。',
    autos: [L.onDeploy('黑夜时破坏竖置帕鲁', function* (g, c, pi) {
      if (!g.isNight()) return;
      const ts = yield* g.choose(pi, g.pals(x => !x.rested && x.def.cost <= 6), 0, 1, '选择至多1只竖置的◇6以下帕鲁放置于墓地', { always: true });
      for (const t of ts) L.toGrave(g, t);
    })] },
  'BP01-088': { name: '固定式电灯', text: '【起】【1回合1次】［将卡组顶3张放置于墓地］直至下一个对方的回合结束，变为黑夜。\n【永】赋予你所有的帕鲁〈〉内的能力。〈' + NOCT + '〉。',
    acts: [NIGHT_ACT], statics: [{ grantKw: (g, s, c) => g.isPal(c) && c.ctrl === s.ctrl ? { nocturnal: 1 } : null }] },
  'BP01-089': { name: '劣质床', text: '【起】【1回合1次】［将卡组顶3张放置于墓地］直至下一个对方的回合结束，变为黑夜。\n【自】你的回合结束时，若你有横置状态的持有〈夜行性〉的帕鲁，抽1张卡。',
    acts: [NIGHT_ACT], autos: [L.onMyTurnEnd('回合结束时抽1', function* (g, c, pi) { if (g.myPals(pi, x => x.rested && hasNoct(g, x)).length) g.draw(pi, 1); })] },
  'BP01-090': { name: '中世纪制药台', text: '【起】【1回合1次】［③、任命1只帕鲁］选择你墓地中1只费用X以下的帕鲁，以横置状态登场。X为任命的帕鲁费用+2。',
    acts: [{ name: '墓地帕鲁登场', once: true, costs: [{ soul: 3, assign: 1 }], run: function* (g, c, pi, p) {
      const x = (p.assigned[0] ? p.assigned[0].def.cost : 0) + 2;
      const ts = yield* g.choose(pi, g.p[pi].grave.filter(y => g.isPal(y) && y.def.cost <= x), 1, 1, `选择墓地中1只费用◇${x}以下的帕鲁横置登场`);
      for (const t of ts) yield* L.deploy(g, t, pi, { rested: true });
    } }] },
  'BP01-091': { name: '木墙', kw: { taunt: true }, text: '【永】嘲讽（对方在可能的情况下，须选择此卡作为攻击目标）\n【自】此卡被放置于墓地时，抽1张卡。',
    autos: [L.onGrave('被放置于墓地时抽1', function* (g, c, pi) { g.draw(pi, 1); })] },
  'BP01-092': { name: '观赏用笼子', text: '【起】【1回合1次】［任命1只帕鲁］将任命的帕鲁放逐。选择1只费用X以下的帕鲁，将其放逐。X为任命的帕鲁费用+2。\n【自】此卡离开据点时，将此卡放逐中的帕鲁全部返回所有者的手牌。',
    acts: [{ name: '放逐帕鲁', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi, p) {
      const a = p.assigned[0]; const x = (a ? a.def.cost : 0) + 2;
      if (a && a.zone === 'base') { g.move(a, 'exile'); a.exiledBy = { uid: c.uid, inst: c.inst }; g.say(`${g.cname(a)} 被放逐`); }
      const ts = yield* g.choose(pi, g.pals(y => y.def.cost <= x), 1, 1, `选择1只费用◇${x}以下帕鲁放逐`);
      for (const t of ts) { g.move(t, 'exile'); t.exiledBy = { uid: c.uid, inst: c.inst }; g.say(`${g.cname(t)} 被放逐`); }
    } }],
    autos: [{ text: '离开据点时返回被放逐帕鲁', when: (g, ev, c) => ev.t === 'leave' && ev.card === c,
      run: function* (g, c, pi, ev) { for (const pl of g.p) for (const x of [...pl.exile]) if (x.exiledBy && x.exiledBy.uid === c.uid && x.exiledBy.inst === ev.lki.inst) L.bounce(g, x); } }] },
  'BP01-093': { name: '切肉刀', text: '【起】［横置此卡、解体1只帕鲁］公开你的卡组顶3张卡，选择1张加入手牌，其余放置于墓地。',
    acts: [{ name: '公开3张选1', costs: [{ restSelf: true, butcher: 1 }], run: function* (g, c, pi) {
      const cs = L.top(g, pi, 3); L.reveal(g, cs);
      const pk = yield* g.choose(pi, cs, 1, 1, '选择1张加入手牌', { always: true, view: cs });
      for (const x of pk) L.toHand(g, x);
      for (const x of cs) if (!pk.includes(x)) g.move(x, 'grave');
    } }] },
  'BP01-094': { name: '寐魔的项圈', text: '【自】【登场时】选择至多1只你手牌中主名称为《寐魔》的帕鲁，使其登场。\n【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200。直至下一个对方的回合结束，变为黑夜。',
    autos: [L.onDeploy('手牌中寐魔登场', function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.p[pi].hand.filter(x => g.isPal(x) && x.def.main === '寐魔'), 0, 1, '选择至多1只手牌中的寐魔登场', { always: true });
      for (const t of ts) yield* L.deploy(g, t, pi);
    })],
    acts: [L.gearAct(200, function* (g, c, pi) { g.setNight(g.untilOppNext(pi)); }, '战斗力+200并变为黑夜')] },
  'BP01-095': { name: '佐伊的作战', text: '从以下选择1项。\n・选择对方的【素材】与【食材】合计至多5个，对方失去它们。\n・选择至多1只你墓地中的帕鲁，返回手牌。对方选择自己的1张手牌丢弃。\n・选择你的1只帕鲁，将其解体。若解体了1张以上，选择对方的1只帕鲁，放置于墓地。',
    play: function* (g, c, pi) {
      const i = yield* g.option(pi, '佐伊的作战：选择1项', ['对方失去至多5个素材/食材', '墓地帕鲁回手，对方弃1张', '解体1只己方帕鲁，破坏对方1只帕鲁']);
      const op = g.p[1 - pi];
      if (i === 0) {
        const m = yield* g.chooseNum(pi, '让对方失去几个【素材】？', 0, Math.min(5, op.material));
        const n = yield* g.chooseNum(pi, '让对方失去几个【食材】？', 0, Math.min(5 - m, op.ingredient));
        op.material -= m; op.ingredient -= n; g.say(`${op.name} 失去 ${m} 素材、${n} 食材`);
      } else if (i === 1) {
        const ts = yield* g.choose(pi, g.p[pi].grave.filter(x => g.isPal(x)), 0, 1, '选择至多1只墓地帕鲁返回手牌', { always: true });
        for (const t of ts) L.toHand(g, t);
        const d = yield* g.choose(1 - pi, op.hand, 1, 1, '选择你的1张手牌丢弃', { always: true }); for (const x of d) g.move(x, 'grave');
      } else {
        const ts = yield* g.choose(pi, g.myPals(pi), 1, 1, '选择你的1只帕鲁解体');
        for (const t of ts) g.butcher(t, pi);
        if (ts.length) { const os = yield* g.choose(pi, g.opPals(pi), 1, 1, '选择对方1只帕鲁放置于墓地'); for (const o of os) L.toGrave(g, o); }
      }
    } },
  'BP01-096': { name: '暗黑炮', text: '【快速】选择1只◇5以下的帕鲁，放置于墓地。',
    play: function* (g, c, pi) { const ts = yield* g.choose(pi, g.pals(L.cmpCost('<=', 5)), 1, 1, '选择1只◇5以下帕鲁放置于墓地'); for (const t of ts) L.toGrave(g, t); } },
  'BP01-097': { name: '黑市商人', text: '选择至多2只你墓地中不持有〈妨碍〉的帕鲁，返回手牌。直至下一个对方的回合结束，变为黑夜。',
    play: function* (g, c, pi) {
      const ts = yield* g.choose(pi, g.p[pi].grave.filter(x => g.isPal(x) && !(x.def.kw && x.def.kw.interrupt)), 0, 2, '选择至多2只墓地帕鲁返回手牌', { always: true });
      for (const t of ts) L.toHand(g, t); g.setNight(g.untilOppNext(pi));
    } },
  'TD02-012': { name: '唤死铠龙 魔渊龙', text: '【自】【登场时】选择至多1只帕鲁，直至回合结束【战斗力】-1000（【战斗力】降至0以下也不会被放置于墓地）。\n【自】【攻击时】选择【战斗力】300以下的所有帕鲁，放置于墓地（也选择你的帕鲁）。',
    autos: [L.onDeploy('至多1只帕鲁-1000', function* (g, c, pi) { yield* L.buff(g, pi, { power: -1000 }, { upTo: true }); }),
      L.onAttack('战斗力300以下的帕鲁全部破坏', function* (g, c) { const ts = g.pals(x => g.power(x) <= 300); for (const t of ts) g.say(`${g.cname(t)} 被放置入墓地`); g.moveMany(ts, 'grave'); })] },
  'TD02-013': { name: '睿智结晶 啼卡尔', text: '' },
  'TD02-014': { name: '宝藏预感 朋克蜥', text: '【自】此卡被放置于墓地时，对方选择自己的1张手牌丢弃。',
    autos: [L.onGrave('对方弃1张', function* (g, c, pi) { const d = yield* g.choose(1 - pi, g.p[1 - pi].hand, 1, 1, '选择你的1张手牌丢弃', { always: true }); for (const x of d) g.move(x, 'grave'); })] },
  'TD02-015': { name: '暗中活跃之影 黑鸦隐士', kw: { stealth: true }, text: '【永】隐秘（此卡无法被阻挡）' },
  'TD02-016': { name: '埋伏的猎人 炎魔羊', text: '' },
  'TD02-017': { name: '挡路黑炎 狱阎王', kw: { interrupt: true }, text: '【起】妨碍（【手牌】【快速】［①、丢弃此卡］或者［丢弃此卡与其他1张手牌］使对方的攻击失败。不发生战斗伤害）' },
  'TD02-018': { name: '盗命者 夜幕魔蝠', kw: { stealth: true }, text: '【永】隐秘（此卡无法被阻挡）\n【自】【攻击时】获得1点生命。',
    autos: [L.onAttack('生命+1', function* (g, c, pi) { g.gainLife(pi, 1); })] },
  'TD02-019': { name: '悬吊陷阱', text: '【起】【1回合1次】［任命1只帕鲁］若此卡放逐的帕鲁不在放逐区域，选择1只帕鲁，将其放逐。\n【自】此卡离开据点时，将此卡放逐的帕鲁以横置状态在其所有者的据点登场。',
    acts: [{ name: '放逐1只帕鲁', once: true, costs: [{ assign: 1 }], run: function* (g, c, pi) {
      if (g.p.some(pl => pl.exile.some(x => x.exiledBy && x.exiledBy.uid === c.uid && x.exiledBy.inst === c.inst))) return;
      const ts = yield* g.choose(pi, g.pals(), 1, 1, '选择1只帕鲁放逐');
      for (const t of ts) { g.move(t, 'exile'); t.exiledBy = { uid: c.uid, inst: c.inst }; g.say(`${g.cname(t)} 被放逐`); }
    } }],
    autos: [{ text: '离开据点时被放逐帕鲁登场', when: (g, ev, c) => ev.t === 'leave' && ev.card === c,
      run: function* (g, c, pi, ev) { for (const pl of g.p) for (const x of [...pl.exile]) if (x.exiledBy && x.exiledBy.uid === c.uid && x.exiledBy.inst === ev.lki.inst) yield* L.deploy(g, x, x.owner, { rested: true }); } }] },
  'TD02-020': { name: '黑鸦隐士帽', text: '【起】［横置此卡］选择1只帕鲁，直至回合结束【战斗力】+200，并赋予其〈〉内的能力。〈【永】隐秘（此卡无法被阻挡）〉。',
    acts: [L.gearAct(200, function* (g, c, pi, t) { if (t) t.grants.push({ until: g.turnNo, kw: { stealth: true } }); })] },
  'TD02-021': { name: '来自黑暗的一击', text: '选择1只帕鲁，放置于墓地。',
    play: function* (g, c, pi) { const ts = yield* g.choose(pi, g.pals(), 1, 1, '选择1只帕鲁放置于墓地'); for (const t of ts) L.toGrave(g, t); } },
  'TD02-022': { name: '医药品', text: '选择你墓地中1只◇8以下的帕鲁，以横置状态登场。',
    play: function* (g, c, pi) { const ts = yield* g.choose(pi, g.p[pi].grave.filter(x => g.isPal(x) && x.def.cost <= 8), 1, 1, '选择墓地中1只◇8以下帕鲁横置登场'); for (const t of ts) yield* L.deploy(g, t, pi, { rested: true }); } },
  'SS01-003': { name: '深夜的认真 瞅什魔', kw: { nocturnal: 1 }, text: NOCT + '\n【自】【登场时】若为黑夜，选择至多1张建筑物，直至回合结束【耐久力】-500（【耐久力】降至0以下也不会被放置于墓地）。',
    autos: [L.onDeploy('黑夜时建筑物耐久-500', function* (g, c, pi) {
      if (!g.isNight()) return;
      const ts = yield* g.choose(pi, g.allBase().filter(x => g.isBld(x)), 0, 1, '选择至多1张建筑物耐久力-500', { always: true });
      for (const t of ts) g.addMod(t, { power: -500 });
    })] },
};

} },
"/app/server/engine/cards_none.js": { deps: {"./cardlib":"/app/server/engine/cardlib.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const L = require('./cardlib');
module.exports = {
  'BP01-098': { name: '温柔光辉 精灵龙', text: '【自】【攻击时】可以公开你的1张手牌。若公开了【龙】属性的帕鲁，直至回合结束，此卡【战斗力】+500。',
    autos: [L.onAttack('可公开手牌龙帕鲁+500', function* (g, c, pi) {
      const d = yield* g.choose(pi, g.p[pi].hand, 0, 1, '可以公开1张手牌（龙属性帕鲁则+500）', { always: true });
      for (const x of d) { L.reveal(g, [x]); if (g.isPal(x) && x.def.types.includes('龙')) g.addMod(c, { power: 500 }); }
    })] },
  'BP01-099': { name: '高傲之牙 猎狼', text: '' },
  'BP01-100': { name: '冒险的开始', text: '若你在本局游戏中没有使用过其他卡片，抽2张卡。\n若你的卡名中含有《起始》且卡名互不相同的帕鲁有3种以上，选择你所有的帕鲁，直至回合结束【战斗力】+1000/【打击力】+5。',
    play: function* (g, c, pi, ctx) {
      if (ctx.prevPlayed === 0) g.draw(pi, 2);
      // Q97：宣言追加的卡名不计入
      const ps = g.myPals(pi, x => x.def.ja.includes('始まりの'));
      const kinds = new Set(ps.map(x => x.def.ja));
      if (kinds.size >= 3) for (const x of g.myPals(pi)) g.addMod(x, { power: 1000, strike: 5 });
    } },
  'TD01-023': { name: '起始帕鲁 棉悠悠', text: '【永】此卡不会被◇4以上的帕鲁攻击。',
    statics: [{ notAttackedBy: (g, s, att) => att.def.cost >= 4 }] },
  'TD01-024': { name: '小小公主 姬小兔', text: '【自】此卡被放置于墓地时，获得1个【素材】。',
    autos: [L.onGrave('获得1素材', function* (g, c, pi) { g.gain(pi, 'material', 1); })] },
  'TD02-023': { name: '起始帕鲁 捣蛋猫', text: '【永】此卡不会被◇3以下的帕鲁攻击。',
    statics: [{ notAttackedBy: (g, s, att) => att.def.cost <= 3 }] },
  'TD02-024': { name: '起始帕鲁 皮皮鸡', text: '【自】此卡被放置于墓地时，获得1个【食材】。',
    autos: [L.onGrave('获得1食材', function* (g, c, pi) { g.gain(pi, 'ingredient', 1); })] },
  'SS01-004': { name: '自信满满 捣蛋猫', text: '【永】你的灵魂在5张以上时，此卡【战斗力】+200。\n【永】你的灵魂在10张以上时，此卡【战斗力】+200。',
    statics: [{ power: (g, s, c) => c === s ? (g.p[s.ctrl].souls.length >= 5 ? 200 : 0) + (g.p[s.ctrl].souls.length >= 10 ? 200 : 0) : 0 }] },
  'SS01-005': { name: '翼龙的吐息 天羽龙', text: '【自】此卡攻击帕鲁或建筑物时，选择至多1张帕鲁或建筑物，给予700【伤害】。',
    autos: [{ text: '攻击帕鲁/建筑物时700伤害', when: (g, ev, c) => ev.t === 'attack' && ev.card === c && ev.target !== 'player',
      run: function* (g, c, pi) { yield* L.dmg(g, c, pi, 700, { kinds: ['pal', 'building'], prompt: '选择至多1张帕鲁或建筑物，给予700伤害' }); } }] },
};

} },
"/app/server/engine/decks.js": { deps: {"./index":"/app/server/engine/index.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 卡组构筑规则（规则 4）与随机卡组生成
const { db } = require('./index');

function resolve(id) { return db[id] || null; }

function validateDeck(list) {
  const errs = [];
  if (!Array.isArray(list)) return ['卡组格式错误'];
  if (list.length !== 50) errs.push(`主卡组必须恰好 50 张（当前 ${list.length} 张）`);
  const byName = {}; let lucky = 0; const colors = new Set();
  for (const id of list) {
    const c = resolve(id);
    if (!c) { errs.push(`未知卡牌 ${id}`); continue; }
    byName[c.ja] = (byName[c.ja] || 0) + 1;
    if (c.lucky) lucky++;
    if (c.color) colors.add(c.color);
  }
  for (const [ja, n] of Object.entries(byName)) {
    const c = db._byJa[ja];
    if (n > 4 && !c.anyNumber) errs.push(`同名卡至多 4 张：${c.name}（${n} 张）`);
  }
  if (lucky > 8) errs.push(`幸运卡（☆）至多 8 张（当前 ${lucky} 张）`);
  if (colors.size > 2) errs.push(`卡组至多使用 2 种颜色（加无色）（当前 ${colors.size} 种）`);
  return errs;
}

// ---- 随机卡组的几种模式 ----
const COLS = ['red', 'blue', 'green', 'purple'];
function pickColors(rng, want) {
  if (want && want.length) return want.slice(0, 2);
  const a = COLS[Math.floor(rng() * 4)], r = COLS.filter(x => x !== a);
  return rng() < 0.5 ? [a] : [a, r[Math.floor(rng() * 3)]];
}
// 把每个卡名的 4 张副本都放进"卡池"，再从中等概率抽取：同名 4 张的概率自然很低
function drawCopies(rng, cards, n, deck, count, st) {
  const bag = [];
  for (const c of cards) { const k = c.anyNumber ? 4 : 4 - (count[c.id] || 0); for (let i = 0; i < k; i++) bag.push(c); }
  while (n > 0 && bag.length) {
    const i = Math.floor(rng() * bag.length), c = bag[i]; bag[i] = bag[bag.length - 1]; bag.pop();
    if (c.lucky && st.lucky >= 8) continue;
    deck.push(c.id); count[c.id] = (count[c.id] || 0) + 1; if (c.lucky) st.lucky++; n--;
  }
}
// 真随机：所选颜色（+无色）的全部卡牌副本中均匀抽 50 张
function trueRandomDeck(rng = Math.random, colorsWanted) {
  const picks = pickColors(rng, colorsWanted);
  const pool = Object.values(db).filter(c => !c.color || picks.includes(c.color));
  const deck = [], count = {}, st = { lucky: 0 };
  drawCopies(rng, pool, 50, deck, count, st);
  return deck;
}
// 牌型随机：固定牌型（帕鲁 32 / 建筑物 7 / 装备 4 / 事件 7），每类内部真随机
function shapeRandomDeck(rng = Math.random, colorsWanted) {
  const picks = pickColors(rng, colorsWanted);
  const pool = Object.values(db).filter(c => !c.color || picks.includes(c.color));
  const deck = [], count = {}, st = { lucky: 0 };
  const shape = { building: 7, gear: 4, event: 7 };
  for (const [k, n] of Object.entries(shape)) drawCopies(rng, pool.filter(c => c.kind === k), n, deck, count, st);
  drawCopies(rng, pool.filter(c => c.kind === 'pal'), 50 - deck.length, deck, count, st);
  if (deck.length < 50) drawCopies(rng, pool, 50 - deck.length, deck, count, st);
  return deck;
}
// mode: 'true' 真随机 | 'shape' 牌型随机 | 'curve' 曲线随机（偏向低费、成套投入）
function randomDeck(rng = Math.random, colorsWanted, strong = false, mode) {
  if (mode === 'true' || (!mode && !strong)) return trueRandomDeck(rng, colorsWanted);
  if (mode === 'shape') return shapeRandomDeck(rng, colorsWanted);
  const all = Object.values(db);
  const cols = ['red', 'blue', 'green', 'purple'];
  let picks = colorsWanted;
  if (!picks) {
    const a = cols[Math.floor(rng() * 4)];
    picks = [a];
    if (rng() < 0.6) { const rest = cols.filter(x => x !== a); picks.push(rest[Math.floor(rng() * 3)]); }
  }
  const pool = all.filter(c => !c.color || picks.includes(c.color));
  const deck = []; let lucky = 0;
  const count = {};
  const add = (c, n) => {
    for (let i = 0; i < n && deck.length < 50; i++) {
      if (c.lucky && lucky >= 8) return;
      if ((count[c.id] || 0) >= 4 && !c.anyNumber) return;
      deck.push(c.id); count[c.id] = (count[c.id] || 0) + 1; if (c.lucky) lucky++;
    }
  };
  // 帕鲁优先，费用曲线：低费多
  const weight = c => {
    let w = c.kind === 'pal' ? 3 : c.kind === 'building' ? 1.6 : 1.2;
    if (c.cost <= 3) w *= 1.4; else if (c.cost >= 7) w *= 0.7;
    if (!c.color) w *= 0.5;
    if (c.kind === 'pal' && !c.text) w *= 0.8;
    if (strong) {
      if (c.lucky) w *= 3;
      if (c.kw && c.kw.interrupt) w *= 2;
      if (c.kind === 'pal' && c.power / Math.max(c.cost, 1) >= 200) w *= 1.5;
      if (c.kind === 'pal' && !c.text && c.power / Math.max(c.cost, 1) < 150) w *= 0.4;
      if (c.kind === 'event' && !c.quick && c.cost >= 4) w *= 0.7;
    }
    return w;
  };
  const shuffled = pool.slice().sort(() => rng() - 0.5);
  let guard = 0;
  while (deck.length < 50 && guard++ < 5000) {
    const tot = shuffled.reduce((s, c) => s + weight(c), 0);
    let r = rng() * tot; let pick = shuffled[0];
    for (const c of shuffled) { r -= weight(c); if (r <= 0) { pick = c; break; } }
    add(pick, rng() < 0.5 ? 2 : (rng() < 0.5 ? 3 : 4));
  }
  while (deck.length < 50) deck.push(shuffled.find(c => !c.lucky && (count[c.id] || 0) < 4).id), count[deck[deck.length - 1]]++;
  return deck;
}

// 官方预组：从 TD01 / TD02 构造近似 50 张预组
function starterDeck(tag) {
  const ids = Object.values(db).filter(c => c.variants.some(v => v.startsWith(tag)));
  const deck = [];
  let k = 0;
  while (deck.length < 50 && k < 400) { const c = ids[k % ids.length]; const n = deck.filter(x => x === c.id).length; if (n < 4 && !(c.lucky && deck.filter(x => db[x].lucky).length >= 8)) deck.push(c.id); k++; }
  return deck;
}
module.exports = { validateDeck, randomDeck, trueRandomDeck, shapeRandomDeck, starterDeck };

} },
"/app/server/engine/presets.js": { deps: {"./index":"/app/server/engine/index.js","fs":"fs","path":"path","./meta_decks":"/app/server/engine/meta_decks.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 主题预设卡组（有体系的卡放在一起）。不足 50 张时用同色基础帕鲁补齐。
const { db } = require('./index');
const P = [
  { key: 'red-burn', name: '红·火力压制', desc: '伏特喵/手枪/步枪/朱雀：用【伤害】效果清场，配合武器工作台与机关枪', colors: ['red'],
    list: { 'BP01-008': 4, 'BP01-021': 3, 'TD01-011': 3, 'TD01-010': 2, 'BP01-002': 2, 'BP01-007': 3, 'SS01-001': 2, 'TD01-007': 2, 'TD01-009': 2, 'BP01-015': 2, 'TD01-008': 3, 'BP01-012': 4, 'TD01-005': 3, 'BP01-023': 2, 'BP01-014': 2, 'TD01-004': 3, 'BP01-013': 4, 'TD01-002': 4 } },
  { key: 'red-army', name: '红·红色军团', desc: '火绒狐+背带、红小鲨、圣火台、燧火鸟：全体红色帕鲁一起变强', colors: ['red'],
    list: { 'BP01-006': 4, 'TD01-004': 3, 'BP01-019': 3, 'BP01-003': 4, 'BP01-017': 3, 'BP01-010': 3, 'BP01-009': 4, 'TD01-002': 4, 'TD01-003': 4, 'BP01-011': 3, 'TD01-006': 3, 'BP01-013': 3, 'TD01-001': 2, 'BP01-004': 2, 'TD01-008': 3, 'BP01-024': 2 } },
  { key: 'blue-classic', name: '蓝·古典式建筑', desc: '古典式镜子/木椅/化妆台/窗帘 + 雪猛犸、寒霜兽：建筑越多越强', colors: ['blue'],
    list: { 'BP01-042': 4, 'TD01-019': 3, 'BP01-040': 2, 'BP01-039': 3, 'TD01-018': 3, 'BP01-030': 3, 'BP01-046': 3, 'TD01-020': 3, 'BP01-043': 3, 'BP01-034': 3, 'BP01-035': 3, 'TD01-013': 4, 'BP01-037': 4, 'BP01-038': 3, 'TD01-012': 3, 'BP01-029': 3 } },
  { key: 'blue-penguin', name: '蓝·企丸丸冲锋', desc: '企丸丸、企丸王、火箭发射器，配合冰缚灵/佩克龙/覆海龙横置控制', colors: ['blue'],
    list: { 'TD01-014': 4, 'BP01-028': 4, 'BP01-031': 4, 'BP01-044': 3, 'TD01-015': 3, 'BP01-026': 2, 'BP01-027': 2, 'BP01-029': 2, 'TD01-022': 3, 'BP01-048': 3, 'BP01-047': 2, 'TD01-016': 3, 'BP01-032': 4, 'BP01-036': 4, 'TD01-021': 3, 'TD01-017': 2, 'TD01-019': 2 } },
  { key: 'green-bee', name: '绿·花园蜂群', desc: '骑士蜂可投入任意张数；女皇蜂随蜂群成长，牧场让骑士蜂+500', colors: ['green'],
    list: { 'BP01-061': 18, 'BP01-053': 4, 'BP01-066': 3, 'TD02-008': 3, 'BP01-063': 2, 'TD02-009': 3, 'BP01-070': 3, 'TD02-011': 3, 'TD02-004': 3, 'BP01-062': 2, 'BP01-060': 3, 'BP01-072': 3 } },
  { key: 'green-ramp', name: '绿·食材与灵魂', desc: '趴趴鲶/波娜兔攒食材，饲料箱/售货机加速灵魂，碎岩龟10魂爆发', colors: ['green'],
    list: { 'BP01-057': 4, 'TD02-003': 4, 'BP01-065': 3, 'BP01-064': 2, 'BP01-059': 3, 'BP01-050': 3, 'BP01-051': 3, 'TD02-007': 2, 'BP01-049': 2, 'TD02-005': 3, 'BP01-066': 3, 'TD02-008': 3, 'BP01-071': 3, 'BP01-056': 4, 'TD02-002': 4, 'BP01-054': 2, 'TD02-004': 2 } },
  { key: 'purple-night', name: '紫·夜行性', desc: '寐魔家族、瞅什魔 + 劣质床/电灯/项圈造黑夜，雷冥鸟、噬魂兽收割', colors: ['purple'],
    list: { 'BP01-080': 4, 'BP01-082': 4, 'BP01-079': 4, 'SS01-003': 3, 'BP01-089': 3, 'BP01-088': 2, 'BP01-094': 3, 'BP01-073': 2, 'BP01-085': 3, 'BP01-087': 4, 'BP01-077': 3, 'BP01-097': 2, 'BP01-096': 3, 'TD02-016': 4, 'TD02-017': 2, 'BP01-074': 2, 'BP01-086': 2 } },
  { key: 'purple-grave', name: '紫·墓地轮回', desc: '猫蝠怪/切肉刀填墓地，制药台、医药品、黑月女王从墓地复活', colors: ['purple'],
    list: { 'BP01-076': 4, 'BP01-093': 3, 'BP01-090': 3, 'TD02-022': 2, 'BP01-078': 3, 'BP01-075': 2, 'BP01-084': 3, 'TD02-014': 4, 'BP01-095': 3, 'BP01-097': 2, 'TD02-021': 2, 'TD02-012': 2, 'BP01-086': 4, 'TD02-013': 4, 'TD02-016': 4, 'TD02-017': 3, 'BP01-081': 2 } },
  { key: 'starter', name: '无色·起始帕鲁', desc: '集齐3种「起始」帕鲁后用「冒险的开始」全体+1000/打击+5（红绿混合）', colors: ['red', 'green'],
    list: { 'TD01-023': 4, 'TD02-023': 4, 'TD02-024': 4, 'BP01-100': 4, 'TD01-024': 3, 'SS01-004': 3, 'TD02-008': 3, 'TD01-008': 3, 'BP01-006': 3, 'BP01-060': 3, 'TD02-011': 3, 'TD01-011': 3, 'BP01-099': 4, 'TD02-001': 2, 'BP01-013': 2, 'TD02-006': 2 } },
  { key: 'bluepurple-control', name: '蓝紫·妨碍控制', desc: '大量【妨碍】让对手攻击失败，暗黑炮/来自黑暗的一击精确除去，悬吊陷阱放逐', colors: ['blue', 'purple'],
    list: { 'TD01-016': 3, 'BP01-038': 3, 'TD02-017': 3, 'BP01-077': 3, 'BP01-096': 3, 'TD02-021': 3, 'TD02-019': 3, 'TD01-022': 3, 'BP01-048': 3, 'BP01-091': 3, 'TD02-015': 3, 'TD02-018': 2, 'BP01-027': 2, 'TD01-012': 3, 'BP01-086': 4, 'TD01-014': 4, 'BP01-095': 2 } },
];
function build(p) {
  const deck = [];
  for (const [id, n] of Object.entries(p.list)) { if (!db[id]) throw new Error('preset ' + p.key + ' unknown ' + id); for (let i = 0; i < n; i++) deck.push(id); }
  const filler = Object.values(db).filter(c => c.kind === 'pal' && !c.text && !c.lucky && (p.colors.includes(c.color) || !c.color));
  let k = 0; const cnt = id => deck.filter(x => x === id).length;
  while (deck.length < 50 && k < 200) { const c = filler[k++ % filler.length]; if (cnt(c.id) < 4) deck.push(c.id); }
  return deck.slice(0, 50);
}
const PRESETS = P.map(p => ({ key: p.key, name: p.name, desc: p.desc, colors: p.colors, cards: build(p) }));
module.exports = { PRESETS };

// ---- v8：精调预设（tools/deck/opt.js 对战爬山优化）+ 社区知名卡组 ----
{
  const fs = require('fs'), path = require('path');
  const { META } = require('./meta_decks');
  const expand = l => { const d = []; for (const [k, n] of Object.entries(l)) for (let i = 0; i < n; i++) d.push(k); return d; };
  let tuned = []; try { tuned = JSON.parse(fs.readFileSync(path.join(__dirname, 'tuned_decks.json'), 'utf8')); } catch (e) { }
  const wr = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'deck_winrates.json'), 'utf8')); } catch (e) { return {}; } })();
  const usedArt = new Set();
  const art = l => { const c = Object.entries(l).filter(([k]) => db[k].kind === 'pal').sort((a, b) => (!!db[b[0]].color - !!db[a[0]].color) || (db[b[0]].cost - db[a[0]].cost) || (b[1] - a[1])).map(x => x[0]);
    const k = c.find(x => !usedArt.has(x)) || c[0]; usedArt.add(k); return k; };
  const out = [];
  for (const t of tuned) out.push({ key: t.key, name: t.name, desc: t.desc, colors: t.colors, cards: expand(t.list), group: 'preset', wr: wr[t.key], art: t.art || art(t.list) });
  for (const m of META) out.push({ key: m.key, name: m.name, desc: m.desc, colors: m.colors, cards: expand(m.list), group: 'meta', wr: wr[m.key], art: art(m.list) });
  if (out.length) { module.exports.PRESETS.length = 0; module.exports.PRESETS.push(...out); }
}

} },
"/app/server/engine/meta_decks.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 玩家社区知名卡组（按截图录入）
const META = [
  { key: 'meta-gp-ramp', name: '名卡组①·绿紫灵魂加速', colors: ['green', 'purple'], desc: '波娜兔/趴趴鲶/花冠龙攒资源，百合女王、狱阎王、邪麒麟、异构格里芬高费压制，猫蝠怪+制药台循环',
    list: { 'BP01-066': 3, 'BP01-065': 2, 'TD02-003': 4, 'TD02-004': 4, 'BP01-057': 4, 'BP01-050': 2, 'BP01-049': 2, 'BP01-095': 3, 'TD02-014': 4, 'TD02-021': 3, 'TD02-015': 3, 'BP01-076': 4, 'BP01-077': 4, 'BP01-074': 1, 'BP01-078': 1, 'BP01-090': 2, 'TD02-017': 4 } },
  { key: 'meta-gp-big', name: '名卡组②·绿紫大型', colors: ['green', 'purple'], desc: '百合女王/碎岩龟/花丽娜/狱阎王/铠格力斯，叶泥泥袭击，制药台与猫蝠怪回收',
    list: { 'BP01-078': 2, 'BP01-054': 2, 'BP01-049': 4, 'BP01-050': 4, 'BP01-051': 4, 'TD02-017': 4, 'TD02-004': 4, 'TD02-021': 4, 'BP01-058': 4, 'BP01-090': 4, 'BP01-076': 4, 'BP01-070': 2, 'BP01-095': 2, 'TD02-003': 4, 'BP01-066': 2 } },
  { key: 'meta-bp-dragon', name: '名卡组③·蓝紫龙族', colors: ['blue', 'purple'], desc: '疾旋鼬翻龙、水灵龙/精灵龙/魔渊龙/覆海龙，冰棘兽与严冬鹿控场',
    list: { 'BP01-095': 4, 'BP01-047': 3, 'TD02-021': 3, 'TD02-023': 4, 'BP01-025': 4, 'TD01-012': 4, 'BP01-026': 2, 'BP01-027': 1, 'BP01-098': 4, 'BP01-036': 4, 'BP01-096': 3, 'TD01-016': 3, 'BP01-038': 4, 'BP01-032': 1, 'TD02-012': 3, 'BP01-078': 2, 'BP01-077': 1 } },
  { key: 'meta-bp-penguin', name: '名卡组④·蓝紫企丸丸龙', colors: ['blue', 'purple'], desc: '企丸丸+火箭发射器打点，覆海龙/佩克龙/冰棘兽控制，极光的指引排序',
    list: { 'TD02-012': 1, 'BP01-027': 3, 'BP01-026': 2, 'BP01-077': 4, 'TD01-012': 4, 'TD02-017': 2, 'BP01-038': 3, 'TD01-016': 3, 'BP01-025': 4, 'TD02-021': 2, 'BP01-044': 3, 'BP01-047': 2, 'BP01-028': 4, 'TD01-021': 2, 'TD01-014': 3, 'BP01-095': 4, 'BP01-048': 4 } },
  { key: 'meta-rb-gun', name: '名卡组⑤·红蓝枪械', colors: ['red', 'blue'], desc: '熔炉攒素材，步枪/霰弹枪/机关枪清场，熔岩兽、腾炎龙、覆海龙、佩克龙终结',
    list: { 'BP01-016': 4, 'TD01-010': 4, 'TD01-004': 4, 'BP01-020': 4, 'BP01-001': 2, 'BP01-005': 4, 'BP01-047': 2, 'BP01-025': 4, 'TD01-016': 4, 'BP01-038': 4, 'TD01-012': 4, 'BP01-027': 2, 'BP01-015': 2, 'BP01-045': 2, 'BP01-026': 4 } },
  { key: 'meta-starter', name: '名卡组⑥·起始帕鲁冒险', colors: ['blue', 'purple'], desc: '三种起始帕鲁+冒险的开始一回合爆发，帕鲁球与工作台抽滤，黑暗一击/佐伊清障',
    list: { 'TD02-023': 4, 'TD02-024': 4, 'TD01-023': 4, 'BP01-100': 4, 'BP01-043': 4, 'BP01-047': 4, 'BP01-046': 2, 'BP01-095': 4, 'TD02-021': 4, 'TD02-015': 4, 'BP01-027': 4, 'TD01-016': 4, 'TD02-017': 4 } },
  { key: 'meta-rb-fire', name: '名卡组⑦·红蓝火绒狐', colors: ['red', 'blue'], desc: '火绒狐+背带+圣火台铺场，朱雀/苍焰狼/霰弹枪拆场，腾炎龙、焰煌收尾',
    list: { 'BP01-006': 4, 'BP01-017': 4, 'BP01-016': 3, 'BP01-012': 4, 'BP01-019': 4, 'BP01-008': 1, 'TD01-004': 4, 'BP01-023': 2, 'BP01-047': 4, 'BP01-007': 2, 'BP01-038': 4, 'BP01-002': 3, 'BP01-020': 4, 'BP01-001': 3, 'BP01-027': 1, 'TD01-007': 1, 'BP01-005': 2 } },
];
module.exports = { META };

} },
"/app/server/puzzles.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 残局谜题（从易到难，每题围绕一张核心卡/一个核心机制）。玩家 0 = 你，玩家 1 = 残局对手（完全信息）。
// guide = 攻略说明（需密码查看），具体步骤由 tools/pz/guides.js 预先求解生成 server/puzzle_guides.json
const PUZZLES = [
  { id: "p01", level: 1, title: "幸运帕鲁☆", desc: "对手只剩 2 点生命，但卡组顶是一张幸运帕鲁☆——翻到它，这次伤害就被抵消。你有两只帕鲁，本回合内获胜。 （场上和手牌里有些牌与解法无关。）", hint: "幸运☆只能抵消一次伤害，而且翻开后就进了墓地。",
    guide: "伤害 N 会从卡组顶依次翻开至多 N 张，翻到☆则整次伤害抵消。先用打击力 1 的电棘鼠\"踩雷\"把☆翻掉，再用打击力 2 的火麒麟打出 2 点致命伤害。顺序反过来，2 点伤害会被☆吃掉，剩下 1 点不够。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":2,"base":["BP01-013","TD01-002"],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]},{"name":"残局对手","life":2,"souls":4,"base":[{"id":"SS01-004","rested":true}],"hand":[],"deck":["TD02-006","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "p02", level: 1, title: "踩雷·幸运帕鲁☆（二）", desc: "对手 3 点生命，卡组第 2 张是幸运☆。你有三只帕鲁：电棘鼠（打击 1）、火灵儿（打击 1）、火麒麟（打击 2）。 （场上和手牌里有些牌与解法无关。）", hint: "☆在第 2 张——要先用小伤害把它前面的牌和它本身翻掉。",
    guide: "先让电棘鼠攻击：1 点伤害翻掉卡组顶第 1 张，生命 3→2。再让火灵儿攻击：翻到☆，伤害被抵消，但☆已经被踩掉。最后火麒麟打 2 点致命。若先用火麒麟，2 点伤害会翻到☆被整次抵消，剩下的打点就不够了。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":2,"base":["BP01-013","TD01-002","TD01-003"],"hand":["BP01-016"],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]},{"name":"残局对手","life":3,"souls":4,"base":[],"hand":[],"deck":["BP01-099","TD02-006","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "break", level: 2, title: "突破·碎岩龟", desc: "对手只剩 1 点生命，但横置的嘲讽「铠格力斯」逼你只能打它，旁边还有竖置的叶胖达。 （场上和手牌里有些牌与解法无关。）", hint: "「突破」：攻击中把战斗对手送入墓地时，也对玩家造成伤害。起动它需要 2 个食材——你现在一个都没有。",
    guide: "使用碎岩龟的头巾，起动时选择碎岩龟：主名称是《碎岩龟》，所以额外获得 2 个食材。用这 2 个食材起动碎岩龟 +500 并获得突破，此时 800+200+500=1500 正好击倒铠格力斯，突破对玩家造成伤害，致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":3,"ingredient":0,"base":["BP01-059"],"hand":["BP01-068","BP01-063"]},{"name":"残局对手","life":1,"deck":["BP01-099","BP01-099","BP01-099"],"base":[{"id":"BP01-054","rested":true},"TD02-001",{"id":"BP01-060","rested":true}]}]} },
  { id: "bee", level: 2, title: "女皇蜂·骑士蜂", desc: "卡组里塞满了「花园骑士 骑士蜂」。对手 3 点生命，竖置的叶胖达会挡下一次攻击。灵魂只有 4 张、食材只有 1 个。 （场上和手牌里有些牌与解法无关。）", hint: "女皇蜂每看到骑士蜂就能减费 ◇2 召唤，骑士蜂登场又给 1 个食材——这是一个循环。家畜牧场能补上断掉的那一环。",
    guide: "女皇蜂【起】消费 1 食材看顶牌，是骑士蜂就以 ◇1 召唤，骑士蜂登场返还 1 食材，循环。卡组第 3 张是叶泥泥（不是骑士蜂）会断链：这时用家畜牧场任命一只骑士蜂获得 3 食材并抽 1（把叶泥泥抽走），继续循环。最终女皇蜂每只骑士蜂 +300，叶胖达挡不住你所有攻击者。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":4,"ingredient":1,"base":["BP01-053","BP01-066"],"hand":["BP01-064","TD02-008"],"deck":["BP01-061","BP01-061","TD02-002","BP01-061","BP01-061","BP01-099","BP01-099","BP01-099"]},{"name":"残局对手","life":3,"base":["TD02-001"],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "taunt", level: 2, title: "嘲讽·铠格力斯", desc: "对手 2 点生命，场上只有一只横置的「黑铁要塞 铠格力斯」（嘲讽，战斗力 1500）。嘲讽迫使你所有攻击都打它。", hint: "伤害会累积到回合结束。火麒麟 1200 单挑打不过 1500……",
    guide: "有嘲讽时攻击必须指向铠格力斯。先用火焰吐息��它 500 伤害，此时火麒麟（1200）攻击它，累计 1700 ≥ 1500，铠格力斯被击倒。嘲讽消失后，电棘鼠与火灵儿各打 1 点，正好 2 点致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":2,"base":["BP01-013","TD01-002","TD01-003"],"hand":["TD01-011"]},{"name":"残局对手","life":2,"deck":["BP01-099","BP01-099","BP01-099","BP01-099"],"base":[{"id":"BP01-054","rested":true}]}]} },
  { id: "night", level: 2, title: "黑夜·月镰魔", desc: "对手 2 点生命，场上两只竖置帕鲁随时阻挡。你有劣质床和手里的「闪耀月光 月镰魔」。 （场上和手牌里有些牌与解法无关。）", hint: "月镰魔的【登场时】只在黑夜生效；登场的帕鲁当回合就能攻击。",
    guide: "先起动劣质床（卡组顶 3 张入墓地）变为黑夜，再使用月镰魔，【登场时】破坏一只竖置的◇6以下帕鲁（祇岳鹿是嘲讽，优先处理）。剩下的阻挡者只能挡一次，你有两只攻击者，打击力足够打完 2 点。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":4,"base":["BP01-089","TD02-016"],"hand":["BP01-087","BP01-079"],"deck":["BP01-080","BP01-080","BP01-080","BP01-080","BP01-080","BP01-080","BP01-080","BP01-080","BP01-080","BP01-080"]},{"name":"残局对手","life":2,"souls":2,"base":["BP01-013","TD02-005",{"id":"BP01-081","rested":true}],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "dragon", level: 3, title: "竖置·腾炎龙", desc: "腾炎龙可以重新竖置再打一次，但对手手里握着一张【妨碍】「绿苔绒怪」。你只有 5 灵魂。 （场上和手牌里有些牌与解法无关。）", hint: "竖置腾炎龙不一定付③——丢弃 2 张手牌也行。先让对手把妨碍交出来。",
    guide: "用 4 灵魂使用火绒狐，然后腾炎龙攻击，逼对手用绿苔绒怪妨碍。再起动腾炎龙\"丢弃 2 张手牌\"（融焰娘、燎火鹿）将其竖置，第二次攻击已无人能挡，加上火绒狐致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":5,"souls":5,"material":0,"ingredient":2,"base":["BP01-001","TD01-009"],"hand":["TD01-004","BP01-012","BP01-011"],"deck":["BP01-005","SS01-001","TD01-023","BP01-007","BP01-011","TD01-007","BP01-007","BP01-013"]},{"name":"残局对手","life":6,"souls":6,"base":["TD01-019",{"id":"BP01-008","rested":true},{"id":"BP01-006","rested":true}],"hand":["BP01-062"],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-084","BP01-099"]}]} },
  { id: "pharm", level: 3, title: "自掘坟墓·中世纪制药台", desc: "对手 2 点生命，卡组第 2 张是幸运☆，竖置的叶胖达随时阻挡。你手里没有牌，只有 3 灵魂。 （场上和手牌里有些牌与解法无关。）", hint: "你的卡组第 2 张是什么？劣质床的代价不一定是代价。",
    guide: "起动劣质床：把自己卡组顶 3 张（含月镰魔）送入墓地，同时变为黑夜。再起动中世纪制药台（③，任命◇2 的寐魔 → X=4），让墓地里◇4 的月镰魔横置登场——横置登场照样触发【登场时】：黑夜下破坏竖置的叶胖达。之后炎魔羊攻击会被☆抵消，但它替你\"排掉\"了☆；隐秘的黑鸦隐士再打 2 点致命。注意先打炎魔羊、后打黑鸦隐士。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-087","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":3,"base":["BP01-089","BP01-090","BP01-080","TD02-016","TD02-015","BP01-090"],"hand":["BP01-093"]},{"name":"残局对手","life":2,"deck":["BP01-099","TD02-006","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD02-001"]}]} },
  { id: "blade", level: 3, title: "回手·浪刃武士", desc: "你只有 2 点生命，必须本回合解决。对手手握快速除去卡「暗黑炮」，卡组里埋着 3 张☆。 （场上和手牌里有些牌与解法无关。）", hint: "浪刃武士攻击后可以回到手牌——然后再出场再打一次。",
    guide: "先用 2 灵魂出姬小兔。浪刃武士攻击后选择\"返回手牌\"，再用 5 灵魂重新使用它——这样它又能攻击一次。再让火绒狐、捣蛋猫、姬小兔、浪刃武士依次攻击，打击总数足以穿过对手卡组里的☆。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":2,"souls":7,"material":0,"ingredient":0,"base":["BP01-006","SS01-004","BP01-004"],"hand":["TD01-009","TD01-024","TD01-002","TD01-008"],"deck":["TD01-023","BP01-003","BP01-004","BP01-009","TD02-012","BP01-012","BP01-008","BP01-003"]},{"name":"残局对手","life":5,"souls":2,"base":[{"id":"BP01-082","rested":true},{"id":"TD02-015","rested":true}],"hand":["BP01-096"],"deck":["BP01-099","BP01-099","TD01-001","BP01-099","TD02-012","BP01-099","BP01-099","TD02-006","BP01-099","BP01-099"]}]} },
  { id: "peng", level: 3, title: "企丸丸的火箭发射器", desc: "对手 4 点生命，三只竖置帕鲁（叶胖达、火麒麟、雪猛犸）把你的攻击全挡住。你只有 2 灵魂。", hint: "火箭发射器给《企丸丸》+500，并赋予一个能横置自身、对对方所有帕鲁造成等同于自身战斗力伤害的能力。",
    guide: "企丸王让所有企丸丸 +700。用火箭发射器强化「飞得远的炮弹 企丸丸」（500+700+500=1700），再让它起动火箭发射：对对方所有帕鲁造成 1700 伤害，三只阻挡者全灭（它自己被送入墓地）。剩下企丸王（打击 2）与憧憬天空企丸丸（打击 2）共 4 点，致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":2,"base":["BP01-031","TD01-014","BP01-028","BP01-044"],"hand":[],"deck":["TD01-022","BP01-099","BP01-099"]},{"name":"残局对手","life":4,"base":["TD02-001","BP01-013","TD01-018"],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "bell", level: 4, title: "连锁任命·警钟", desc: "你只剩 1 点生命，三只帕鲁都想攻击，对手的冲浪鸭、猎狼、叶胖达组成三道防线。素材为 0。", hint: "任命是很多起动能力的代价——而警钟能让本回合被任命过的帕鲁全部重新竖置。先把它们\"用\"一遍。",
    guide: "① 采石场任命雷角马：+3 素材、抽 1。② 固定式机关枪 X=2，任命火绒狐：500 打冲浪鸭、500 打猎狼，两只都被破坏。③ 警钟（①）任命燎火鹿（认真 400 顺带触发）：本回合被任命过的雷角马、火绒狐、燎火鹿全部竖置。对手只剩叶胖达一只阻挡者，你有三只攻击者，对手 2 点生命必死。顺序关键：机关枪和采石场要在警钟之前用。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":1,"deck":["BP01-099","BP01-099","BP01-099","BP01-099"],"souls":3,"base":["TD01-008","BP01-015","BP01-018","BP01-011","BP01-006","BP01-009"],"hand":[]},{"name":"残局对手","life":2,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD02-001","BP01-099","BP01-032"]}]} },
  { id: "abyss", level: 4, title: "同归于尽·魔渊龙", desc: "对手手握【妨碍】狱阎王，场上 4 只帕鲁。你的魔渊龙攻击时会把所有战斗力 300 以下的帕鲁送进墓地——包括你自己的。", hint: "朋克蜥进墓地时，对手要丢 1 张手牌。对手手里只有一张牌。",
    guide: "使用烽歌龙，【登场时】让猎狼战斗力 -300（500→200）。魔渊龙攻击，【攻击时】把战斗力 ≤300 的帕鲁全部送入墓地：对手的冲浪鸭、姬小兔、猎狼，以及你自己的朋克蜥。朋克蜥进墓地 → 对手丢掉唯一的手牌狱阎王，妨碍落空。对手只剩叶胖达，挡不住魔渊龙、炎魔羊、烽歌龙三次攻击。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099"],"souls":4,"base":["TD02-012","TD02-014","TD02-016"],"hand":["BP01-083"]},{"name":"残局对手","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":2,"base":["BP01-099","BP01-032","TD01-024","TD02-001"],"hand":["TD02-017"]}]} },
  { id: "phoenix", level: 4, title: "业火·朱雀", desc: "对手的「起始帕鲁 捣蛋猫」竖置着随时阻挡。你有 7 灵魂和一手红卡。", hint: "朱雀的【登场时】伤害会被它自己的【永】能力再 +200。",
    guide: "用 7 灵魂直接使用朱雀，【登场时】700(+200)=900 伤害击倒竖置的捣蛋猫，对手失去唯一的阻挡者。之后炽焰牛、燎火鹿、朱雀依次直击玩家即可。警钟看似诱人但费用不够。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":5,"souls":7,"material":3,"ingredient":2,"base":["TD01-005","BP01-011","TD01-008"],"hand":["BP01-002","BP01-018"],"deck":["TD01-004","TD01-005","BP01-010","SS01-005","BP01-003","BP01-001","BP01-099","BP01-004"]},{"name":"残局对手","life":6,"souls":3,"base":[{"id":"TD01-001","rested":true},{"id":"TD02-023","rested":false},{"id":"TD01-023","rested":true}],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-029","BP01-099","BP01-099"]}]} },
  { id: "cat", level: 4, title: "公开三张·猫蝠怪", desc: "对手 6 点生命，卡组第 3 张是幸运☆。你手里有猫蝠怪、黑鸦隐士帽、瞅什魔，6 灵魂。 （场上和手牌里有些牌与解法无关。）", hint: "打点要够 6 点，还要有一次垫刀去吃掉☆。新登场的帕鲁当回合就能攻击。",
    guide: "用 5 灵魂使用猫蝠怪（【登场时】公开卡组顶 3 张，选不选都行），它自己就是一个打击 2 的攻击者。猫蝠怪先打 2（6→4），露娜蒂打 1 翻到☆被抵消——☆已经被消耗掉。棉悠悠再打 1（4→3），最后黑月女王打 3 致命。关键是攻击顺序：☆在第 3 张，必须让小打点去吃掉它，大打点留到最后。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":4,"souls":6,"material":0,"ingredient":0,"base":["BP01-086","TD01-023","BP01-078","BP01-091"],"hand":["BP01-076","TD02-020","BP01-079","BP01-088"],"deck":["TD01-018","BP01-085","TD02-016","TD01-023","SS01-005","BP01-078","TD01-023","BP01-078"]},{"name":"残局对手","life":6,"souls":5,"base":["TD01-008",{"id":"TD02-015","rested":true}],"hand":[],"deck":["BP01-099","BP01-099","BP01-055","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-074","BP01-099"]}]} },
  { id: "curtain", level: 5, title: "三件古典式·古典式窗帘", desc: "对手 3 点生命，叶胖达、火麒麟、雪猛犸三只竖置帕鲁严阵以待。你只有 4 灵魂，买不起 ◇5 的古典式窗帘。", hint: "原始工作台公开卡组顶，若是 ◇6 以下的建筑物可以免费登场。怎么把窗帘放到卡组顶？",
    guide: "使用【快速】极光的指引（2 灵魂）：抽 1 张，再把手里的古典式窗帘放回卡组顶。起动原始工作台（任命冰刺鼠），公开窗帘 → 免费登场。此时你有镜子、木椅、窗帘 3 种《古典式》建筑物，【登场时】把对手 3 只帕鲁全部弹回手牌。滑水蛇 2 + 企丸丸 1 = 3 点致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-047","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":4,"base":["TD01-020","BP01-042","TD01-019","BP01-037","TD01-014","TD01-013"],"hand":["BP01-039","BP01-048"]},{"name":"残局对手","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD02-001","BP01-013","TD01-018"]}]} },
  { id: "zoe", level: 5, title: "解体·佐伊的作战", desc: "对手竖置的黑月女王会挡住你最致命的一击。用手牌为攻击开路。 （场上和手牌里有些牌与解法无关。）", hint: "佐伊的作战第三个选项：解体自己 1 只帕鲁，就能把对方 1 只帕鲁送入墓地。解体已经攻击过的帕鲁最不心疼。",
    guide: "先让姬小兔攻击玩家（它已经完成任务了）。然后使用佐伊的作战，选择\"解体1只己方帕鲁\"：解体已横置的姬小兔，破坏对方竖置的黑月女王。之后寐魔与异构格里芬直击玩家致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":5,"souls":4,"material":1,"ingredient":3,"base":["TD01-024","BP01-082","BP01-074"],"hand":["BP01-095","SS01-003","TD02-023","BP01-092","BP01-100","BP01-093"],"deck":["TD02-017","BP01-074","BP01-001","BP01-087","SS01-005","BP01-075","BP01-010","SS01-005"]},{"name":"残局对手","life":5,"souls":6,"base":[{"id":"BP01-078","rested":true},{"id":"BP01-078","rested":false},"TD01-008"],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "trap", level: 5, title: "放逐·悬吊陷阱", desc: "对手有一只竖置的雷冥鸟可以阻挡，手里还有【妨碍】狱阎王，而你只有 3 灵魂。 （场上和手牌里有些牌与解法无关。）", hint: "悬吊陷阱能放逐一只帕鲁；你的某次攻击可以专门用来\"钓\"出妨碍。",
    guide: "用 3 灵魂使用朋克蜥。起动悬吊陷阱（任命猎狼）放逐竖置的雷冥鸟。然后让朋克蜥攻击横置的另一只雷冥鸟——对手为保护帕鲁会用狱阎王妨碍。妨碍用掉后，炎魔羊与隐秘的黑鸦隐士直击玩家致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":5,"souls":3,"material":1,"ingredient":0,"base":["TD02-016","TD02-015","BP01-099","TD02-019","TD02-019"],"hand":["TD02-014","BP01-093","BP01-082","TD02-024"],"deck":["BP01-083","BP01-078","BP01-055","BP01-076","BP01-078","TD02-018","SS01-005","BP01-075"]},{"name":"残局对手","life":4,"souls":2,"base":[{"id":"BP01-073","rested":true},{"id":"BP01-073","rested":false},{"id":"BP01-084","rested":true},{"id":"SS01-003","rested":true}],"hand":["TD02-017"],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-027","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "cleaver", level: 5, title: "解体·切肉刀", desc: "对手卡组顶连续两张幸运☆，场上还有嘲讽的木墙。6 点生命，你能打穿吗？", hint: "切肉刀的解体也是资源：已经攻击完的帕鲁可以拿来解体。公开的 3 张牌你都看得到。",
    guide: "猎狼先攻击（撞木墙或被阻挡都无所谓），然后起动切肉刀解体它，公开卡组顶 3 张，选「晚上才动真格 瞅什魔」加入手牌并用 2 灵魂使用。瞅什魔、邪麒麟、黑月女王三次攻击，前面的小伤害负责把两张☆翻掉，后面的大伤害致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"souls":4,"material":1,"ingredient":0,"base":["BP01-077","BP01-099","BP01-078","BP01-093"],"hand":["BP01-096"],"deck":["TD02-007","BP01-079","BP01-084","TD02-015","BP01-079","BP01-098","BP01-004","BP01-077"]},{"name":"残局对手","life":6,"souls":6,"base":[{"id":"BP01-076","rested":true},"BP01-091"],"hand":[],"deck":["TD02-006","BP01-075","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-004"]}]} },
  { id: "hang", level: 5, title: "两回合·悬吊陷阱与暗巫猫", desc: "两回合内获胜。对手 4 点生命，场上一只竖置的暴电熊，卡组里埋着两张☆。你有暗巫猫、悬吊陷阱和 3 个食材。", hint: "悬吊陷阱可以把对手的阻挡者放逐。第二回合，暗巫猫解体自己的帕鲁可以换来 +1000/+1，并从墓地复活一只帕鲁。",
    guide: "第一回合：使用露娜蒂，起动悬吊陷阱（任命露娜蒂）放逐竖置的暴电熊，暗巫猫直击 2 点（4→2）。第二回合：抽到并使用冥铠蝎。暗巫猫、露娜蒂先攻击，把对手卡组里的两张☆依次翻掉（伤害被抵消也没关系）。然后暗巫猫起动：解体露娜蒂获得 +1000/+1，冥铠蝎再攻击打出 2 点致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":7},"players":[{"name":"你","life":3,"souls":4,"material":0,"ingredient":3,"base":["BP01-075","TD02-019"],"hand":["BP01-086"],"deck":["BP01-084","BP01-084","BP01-099","BP01-083","BP01-074","BP01-074","TD02-013","BP01-079"]},{"name":"残局对手","life":4,"souls":1,"base":[{"id":"SS01-001","rested":false}],"hand":[],"deck":["BP01-099","BP01-099","BP01-084","BP01-099","BP01-099","TD01-017","BP01-075","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "adv", level: 6, title: "三种起始·冒险的开始", desc: "对手 6 点生命，卡组第 3 张是幸运☆。你手握两张「冒险的开始」，场上只有棉悠悠和猎狼。", hint: "冒险的开始的抽卡条件是\"本局游戏中没有使用过其他卡片\"。自信满满 捣蛋猫 不是《起始》帕鲁。",
    guide: "第一张冒险的开始必须作为本局第一张使用的卡：抽 2 张（起始帕鲁 捣蛋猫 + 猎狼）。使用皮皮鸡、起始帕鲁 捣蛋猫，凑齐棉悠悠/皮皮鸡/捣蛋猫三种《起始》。第二张冒险的开始：全体 +1000/打击力 +5。棉悠悠打 6 被☆抵消，但卡组被翻掉 3 张；猎狼再打 6 点致命。自信满满 捣蛋猫 是陷阱：名字带捣蛋猫但不是起始帕鲁。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["TD02-023","BP01-099","BP01-099","BP01-099"],"souls":8,"base":["TD01-023","BP01-099"],"hand":["BP01-100","BP01-100","SS01-004","TD02-024"]},{"name":"残局对手","life":6,"deck":["BP01-099","BP01-099","TD02-006","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD02-001","BP01-013"]}]} },
  { id: "griffin", level: 6, title: "双重触发·异构格里芬", desc: "对手 6 点生命，但卡组只剩 6 张（第 2 张是☆）。4 只帕鲁挡在前面。", hint: "异构格里芬横置时为黑夜，且黑夜中你的帕鲁【自】能力发动 2 次。雷冥鸟会对\"持有夜行性的帕鲁登场\"作出反应。",
    guide: "先让异构格里芬攻击：它横置后变为黑夜（伤害被☆抵消，但对手卡组被翻掉 2 张）。使用寐魔（夜行性）→ 雷冥鸟的【自】发动 2 次，破坏棉悠悠与姬小兔。使用月镰魔 → 【登场时】发动 2 次，破坏猎狼与叶胖达。雷冥鸟打 3、寐魔打 1，对手卡组被翻空 —— 卡组耗尽判负。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099"],"souls":6,"base":["BP01-074","BP01-073","BP01-089"],"hand":["BP01-080","BP01-087"]},{"name":"残局对手","life":6,"deck":["BP01-099","TD02-006","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD01-024","TD01-023","TD02-001","BP01-099"]}]} },
  { id: "dresser", level: 6, title: "追加卡名·古典式化妆台", desc: "对手 4 点生命，三只竖置帕鲁（最高战斗力 1700）。你有企丸王和火箭发射器，场上却一只企丸丸都没有。", hint: "化妆台能给你所有的卡追加一个卡名。企丸王与火箭发射器只认主名称《企丸丸》。",
    guide: "化妆台①：丢弃冰刺鼠，宣言「憧憬天空 企丸丸」——你所有卡都追加此卡名，主名称《企丸丸》生效：企丸王的 +700 现在覆盖所有帕鲁（包括它自己）。化妆台②：丢弃猎狼（X=1），冰刺鼠 +1000/+1。火箭发射器强化冰刺鼠：300+700+1000+500=2500，起动火箭发射，对手三只帕鲁全灭（冰刺鼠自身入墓地）。企丸王 2 + 滑水蛇 2 = 4 点致命。陷阱：把火箭发射用在企丸王或滑水蛇身上，会少一个打点。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"souls":1,"base":["BP01-031","BP01-040","BP01-044","BP01-037","TD01-013"],"hand":["BP01-099","TD01-013"]},{"name":"残局对手","life":4,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"base":["TD02-001","BP01-013","TD01-018"]}]} },
  { id: "frost", level: 6, title: "两回合·冰缚灵与抓钩枪", desc: "你只有 2 灵魂，对手手握妨碍「邪麒麟」。两回合内获胜：先撑过对手的回合，再终结比赛。", hint: "抓钩枪赋予【警戒】（回合结束时竖置）。第一回合就要把对手的妨碍逼出来。",
    guide: "第一回合：使用壶小象，抓钩枪强化壶小象，冰缚灵攻击逼出邪麒麟的妨碍，壶小象再攻击。对手回合它会反击，但打不死你。第二回合：使用翻身回旋鲁米儿，抓钩枪再强化一次，冰缚灵直击玩家致命。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":7},"players":[{"name":"你","life":3,"souls":2,"material":0,"ingredient":2,"base":["TD01-015","BP01-045"],"hand":["BP01-034","BP01-036","TD01-022"],"deck":["TD01-017","BP01-028","BP01-033","BP01-038","TD01-018","SS01-005","TD01-013","BP01-002"]},{"name":"残局对手","life":2,"souls":4,"base":[{"id":"TD01-024","rested":false}],"hand":["BP01-077"],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-050","BP01-099","BP01-099"]}]} },
  { id: "mirror", level: 6, title: "两回合·古典式镜子", desc: "你只剩 1 点生命，对手手握暗黑炮，木墙嘲讽挡在前面。两回合内获胜。", hint: "古典式镜子登场时抽 1 张——卡组顶的牌你都看得到。对手的暗黑炮只能用一次，让它用在不重要的帕鲁上。",
    guide: "第一回合：使用古典式镜子抽卡，使用皮皮鸡，捣蛋猫攻击——对手会用暗黑炮打掉皮皮鸡。对手回合猎狼来袭，用佩克龙阻挡保命。第二回合：再使用一张古典式镜子抽卡、出棉悠悠，冰丝特、佩克龙、捣蛋猫、棉悠悠四连击，木墙挡不完。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":7},"players":[{"name":"你","life":1,"souls":3,"material":0,"ingredient":0,"base":["BP01-026","TD02-023","BP01-035","BP01-042"],"hand":["BP01-042","BP01-042","TD02-024"],"deck":["BP01-029","TD01-023","TD01-015","BP01-033","BP01-027","BP01-098","BP01-029","BP01-073"]},{"name":"残局对手","life":5,"souls":6,"base":["BP01-091"],"hand":["BP01-096"],"deck":["BP01-099","TD02-006","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "m_adv", level: 2, mill: true, title: "耗尽①·冒险的开始", desc: "对手有 10 点生命，靠打血打不死——但卡组只剩 8 张（第 2、3 张是幸运☆）。把它的卡组打空！ （场上和手牌里有些牌与解法无关。）", hint: "幸运☆会抵消伤害，但被翻开的☆本身也会进墓地。打击力越高，一次能翻掉的牌越多。",
    guide: "使用皮皮鸡，凑齐棉悠悠/捣蛋猫/皮皮鸡三种《起始》帕鲁，再使用冒险的开始：全体 +1000/打击力 +5。第一击翻到第 2 张☆停下（翻 2 张），第二击翻掉第 3 张☆（翻 1 张），第三击打击力 6 把剩下 5 张全部翻光——卡组耗尽。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"hand":["BP01-100","TD02-024","TD01-011","BP01-024"],"souls":4,"base":["TD01-023","TD02-023","BP01-099"]},{"name":"残局对手","life":10,"souls":0,"base":["BP01-099",{"id":"TD01-002","rested":true}],"hand":[],"deck":["BP01-099","BP01-055","TD01-018","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "m_bird", level: 3, mill: true, title: "耗尽②·☆三连·燧火鸟", desc: "对手 10 点生命，卡组 9 张，最上面连续三张都是幸运☆。你的五只红色帕鲁一共只能攻击五次。 （场上和手牌里有些牌与解法无关。）", hint: "每张☆都会让那次攻击只翻 1 张牌就停下。把浪费留给最弱的攻击者。燧火鸟攻击时，所有红色帕鲁打击力 +1——包括之后才攻击的。",
    guide: "电棘鼠、火灵儿、火绒狐（打击力都是 1）依次攻击，各翻掉一张☆。然后燧火鸟攻击：【攻击时】所有红色帕鲁 +500/打击力 +1，自己打击力 3，翻掉 3 张；火麒麟此时打击力 3，翻掉最后 3 张。若燧火鸟或火麒麟先打，会被☆截停，白白浪费 2~3 点打击力。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"hand":[],"souls":0,"base":["BP01-010","BP01-013","TD01-002","TD01-003","BP01-006","TD02-023","BP01-098"]},{"name":"残局对手","life":10,"souls":0,"base":[],"hand":[],"deck":["BP01-055","BP01-055","TD01-017","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"]}]} },
  { id: "m_blade", level: 3, mill: true, title: "耗尽③·回手·浪刃武士", desc: "对手 10 点生命，卡组 6 张：☆ · · ☆ · ·。你只有三只帕鲁和 6 灵魂。", hint: "浪刃武士攻击结束后可以返回手牌，再花 5 灵魂重新登场就能再打一次。灵魂不够同时出燎火鹿和重新登场。",
    guide: "电棘鼠（打击 1）先打，翻掉第一张☆。浪刃武士（打击 2）翻掉 2 张普通牌，战斗结束时选择返回手牌，用 5 灵魂重新使用。火灵儿（打击 1）翻掉第二张☆，浪刃武士再打 2 点，翻光卡组。别把灵魂花在燎火鹿上。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"hand":["BP01-011"],"souls":6,"base":["BP01-004","TD01-002","TD01-003"]},{"name":"残局对手","life":10,"souls":0,"base":[],"hand":[],"deck":["TD02-006","BP01-099","BP01-099","TD02-006","BP01-099","BP01-099"]}]} },
  { id: "m_dragon", level: 5, mill: true, title: "耗尽④·竖置·腾炎龙", desc: "对手 10 点生命，卡组 5 张（第 4 张是☆），竖置的猎狼随时阻挡，手里还有【妨碍】狱阎王。你只有 2 灵魂。 （场上和手牌里有些牌与解法无关。）", hint: "腾炎龙打击力 4，正好翻到☆为止。它可以丢弃 2 张手牌重新竖置——前提是手里还留着 2 张牌。",
    guide: "用 2 灵魂使用火焰吐息击倒猎狼（不留阻挡者）。腾炎龙攻击，逼对手用狱阎王妨碍。丢弃火灵儿与燎火鹿将腾炎龙竖置，再次攻击：打击力 4 翻掉 · · · ☆。最后电棘鼠打 1，翻掉最后一张。若先出火灵儿/燎火鹿，就没有手牌可以丢弃来竖置腾炎龙了。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"hand":["TD01-003","BP01-011","TD01-011","TD01-005"],"souls":2,"base":["BP01-001","TD01-002"]},{"name":"残局对手","life":10,"souls":1,"base":["BP01-099",{"id":"TD02-024","rested":true},{"id":"BP01-098","rested":true}],"hand":["TD02-017"],"deck":["BP01-099","BP01-099","BP01-099","BP01-055","BP01-099"]}]} },
  { id: "m_dresser", level: 5, mill: true, title: "耗尽⑤·精准分段·古典式化妆台", desc: "对手 10 点生命，卡组 9 张：· · · · · ☆ · ☆ ·。你的四只帕鲁打击力合计只有 6，手里三张猎狼没灵魂可用。", hint: "☆把卡组切成了 6 / 2 / 1 三段，每次攻击翻到☆就停。化妆台丢 X 张手牌，就能让 X 只帕鲁 +1000/打击力 +1。攻击顺序决定每一点打击力能不能用满。",
    guide: "化妆台丢弃 3 张猎狼（X=3），让滑水蛇、冰刺鼠、企丸丸打击力各 +1（3/2/3），壶小象仍为 1。滑水蛇 3 + 企丸丸 3 正好翻完前 6 张（第二击停在第 6 张☆上）；冰刺鼠 2 翻 · ☆；壶小象 1 翻最后一张。顺序错一次就会有打击力被☆吃掉。",
    sc: {"turnNo":5,"limit":{"pi":0,"turn":5},"players":[{"name":"你","life":3,"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","BP01-099"],"hand":["BP01-099","BP01-099","BP01-099"],"souls":0,"base":["BP01-040","BP01-037","TD01-013","BP01-034","BP01-028"]},{"name":"残局对手","life":10,"souls":0,"base":[],"hand":[],"deck":["BP01-099","BP01-099","BP01-099","BP01-099","BP01-099","TD01-017","BP01-099","TD01-017","BP01-099"]}]} },
];
module.exports = { PUZZLES };

} },
"/app/server/solver.js": { deps: {"./engine":"/app/server/engine/index.js","./ai":"/app/server/ai.js","./ai_master":"/app/server/ai_master.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 残局求解器：完全信息 AND-OR 搜索。
// 玩家 hero 的决策点为 OR（存在一步可胜即可），对手决策点为 AND（对手所有应对都必须仍能获胜）。
// 用于：① 验证残局存在必胜解；② 作为残局中"最聪明的对手"（选择让玩家无法取胜、或解最难的应对）。
const { Game } = require('./engine');

function combos(arr, min, max, cap = 400) {
  const out = [];
  const rec = (i, cur) => {
    if (out.length >= cap) return;
    if (cur.length >= min && cur.length <= max) out.push(cur.slice());
    if (cur.length === max) return;
    for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}
function moves(g) {
  const q = g.pending; if (!q) return [];
  if (q.kind === 'main') {
    // 先尝试"做事"，结束/不再使用放最后
    const idx = q.actions.map((a, i) => i);
    return idx.sort((a, b) => (q.actions[a].t === 'end') - (q.actions[b].t === 'end'));
  }
  if (q.kind === 'option') return q.options.map((_, i) => i);
  // select：去重同名同状态的候选（对称剪枝）
  const seen = new Map();
  for (const u of q.cands) {
    const c = g.findCard(u) || g.p.flatMap(p => p.deck).find(x => x.uid === u);
    const k = c ? [c.id, c.zone, c.ctrl, c.rested, c.damage, c.zone === 'deck' ? g.p[c.owner].deck.indexOf(c) : 0].join(':') : u;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(u);
  }
  const groups = [...seen.values()];
  if (q.max <= 0) return [[]];
  if (q.max <= 1) { const r = groups.map(gr => [gr[0]]); if (q.min === 0) r.push([]); return r.reverse(); }
  return combos(q.cands, q.min, q.max).sort((a, b) => b.length - a.length);
}
function sig(g) {
  const cv = c => [c.id, c.rested ? 1 : 0, c.damage, g.power ? g.power(c) : 0, g.isPal(c) ? g.strike(c) : 0, Object.keys(c.used || {}).filter(k => c.used[k] === g.turnNo).join('.'), c.noStand.length, c.assignedTurn === g.turnNo ? 1 : 0].join(',');
  const pv = p => [p.life, p.deck.map(c => c.id).join(','), p.hand.map(c => c.id).sort().join(','), p.grave.length, p.exile.map(c => c.id).sort().join(','),
    p.base.map(cv).sort().join('|'), p.souls.length, p.souls.filter(s => !s.rested).length, p.soulDeck, p.material, p.ingredient, p.soulDrawTurn === g.turnNo ? 1 : 0, p.played].join(';');
  const q = g.pending;
  const qs = q ? [q.player, q.kind, q.prompt, (q.actions || []).map(a => a.label).join('/'), (q.options || []).join('/'), q.min, q.max, (q.cands || []).length].join('#') : 'none';
  const B = g.battle;
  return [g.turnNo, g.active, g.phase, g.isNight() ? 1 : 0, B ? [B.att.id, B.target === 'player' ? 'P' : B.target.id, B.blocked, B.failed].join(':') : '', g.queue.length, pv(g.p[0]), pv(g.p[1]), qs].join('§');
}
function child(g, ans) { const c = g.clone(); c.answer(c.pending.player, ans); return c; }

class Solver {
  constructor({ hero = 0, maxNodes = 300000 } = {}) { this.hero = hero; this.memo = new Map(); this.nodes = 0; this.maxNodes = maxNodes; }
  // 返回 true=hero 必胜，false=无法保证
  win(g) {
    if (g.over) return g.over.winner === this.hero;
    if (!g.pending) return false;
    const k = sig(g);
    if (this.memo.has(k)) return this.memo.get(k);
    if (++this.nodes > this.maxNodes || (this.until && (this.nodes & 63) === 0 && Date.now() > this.until)) throw new Error('搜索超出节点上限');
    this.memo.set(k, false); // 防环
    const ms = moves(g), heroTurn = g.pending.player === this.hero;
    let r;
    if (heroTurn) { r = false; for (const m of ms) if (this.win(child(g, m))) { r = true; break; } }
    else { r = true; for (const m of ms) if (!this.win(child(g, m))) { r = false; break; } }
    this.memo.set(k, r);
    return r;
  }
  // hero 的所有必胜着法
  winningMoves(g) { return moves(g).filter(m => this.win(child(g, m))); }
  // 对手的最佳应对：优先让 hero 无法必胜；否则选使 hero 证明树最大的（最难的）
  refute(g) {
    const ms = moves(g); let best = ms[0], bestN = -1;
    for (const m of ms) {
      const c = child(g, m);
      const n0 = this.nodes;
      const sub = new Solver({ hero: this.hero, maxNodes: this.maxNodes }); sub.memo = this.memo;
      const w = sub.win(c); this.nodes += sub.nodes;
      if (!w) return m;
      const size = sub.nodes; if (size > bestN) { bestN = size; best = m; }
      void n0;
    }
    return best;
  }
}
// 求一条主线（hero 走必胜着，对手走最强应对），用于展示答案
function mainLine(g, hero = 0, limit = 200) {
  const S = new Solver({ hero }); const line = [];
  if (!S.win(g)) return null;
  while (!g.over && g.pending && line.length < limit) {
    const q = g.pending, me = q.player === hero;
    const m = me ? S.winningMoves(g)[0] : S.refute(g);
    line.push({ p: q.player, prompt: q.prompt, label: q.kind === 'main' ? q.actions[m].label : q.kind === 'option' ? (q.prompt ? q.prompt + ' → ' : '') + q.options[m] : (q.prompt || '选择') + '：' + (m.length ? m.map(u => { const c = g.findCard(u); return c ? '《' + c.def.name + '》' : '#' + u; }).join('、') : '不选'), ans: m });
    g = child(g, m);
  }
  return { line, over: g.over };
}
module.exports = { Solver, moves, child, sig, mainLine };
// 残局对手：用求解器寻找"让玩家无法必胜"的应对；搜索超限时退回困难 AI
// hero 最少还需要多少次"主动行动"（主要阶段行动 + 选择/选项）才能强制获胜（对手每步都取最顽强的应对）
// 返回 Infinity 表示在 maxD 内无法强制获胜
function forcedDepth(g, hero, maxD, budget) {
  const memo = new Map();
  const rec = (g, k) => {
    if (g.over) return g.over.winner === hero;
    if (!g.pending) return false;
    const key = sig(g) + '|' + k; const m0 = memo.get(key); if (m0 !== undefined) return m0;
    if (--budget.n < 0 || (budget.n & 255) === 0 && Date.now() > budget.until) throw new Error('budget');
    const q = g.pending, me = q.player === hero;
    let r;
    if (me) {
      const pass = q.kind === 'main' && q.quick;  // 快速步骤里"不再使用"不计步
      r = false;
      for (const m of moves(g)) {
        const free = pass && q.actions[m].t === 'end';
        const nk = free ? k : k - 1; if (nk < 0) continue;
        if (rec(child(g, m), nk)) { r = true; break; }
      }
    } else { r = true; for (const m of moves(g)) if (!rec(child(g, m), k)) { r = false; break; } }
    memo.set(key, r); return r;
  };
  for (let d = 0; d <= maxD; d++) if (rec(g, d)) return d;
  return Infinity;
}
// 残局对手：
// ① 若存在让玩家无法必胜的应对，选它；
// ② 否则"苟延残喘"：选让玩家最少所需步数最多的应对（尽量阻挡、尽量吃下最大伤害）；
//    步数相同再按"困难 AI 的直觉 + 自身生命/场面"打破平局。
class PuzzleAI {
  constructor(hero = 0) { const { AI } = require('./ai'); this.hero = hero; this.fb = new AI('hard', 1); this.memo = new Map(); }
  // 用困难 AI 把当前回合快速走完，看对手还剩多少生命/场面（衡量"挡住了多少伤害"）
  rollout(c, pi) {
    const { evalM } = require('./ai_master'); const { AI } = require('./ai');
    const p = [new AI('hard', 3), new AI('hard', 4)]; p[0].noSim = p[1].noSim = true;
    const t = c.turnNo;
    for (let k = 0; k < 120 && c.pending && !c.over && c.turnNo === t; k++) { const q = c.pending; c.answer(q.player, p[q.player].decide(c, q.player)); }
    if (c.over) return c.over.winner === pi ? 1e5 : -1e5;
    return c.p[pi].life * 50 + evalM(c, pi);
  }
  decide(g, pi) {
    const ms = moves(g); if (ms.length <= 1) return ms.length ? ms[0] : this.fb.decide(g, pi);
    const t0 = Date.now();
    // ① 找能让玩家无法必胜的应对
    try {
      const S = new Solver({ hero: this.hero, maxNodes: 20000 }); S.memo = this.memo; S.until = t0 + 2200;
      for (const m of ms) if (!S.win(child(g, m))) return m;
    } catch (e) { this.memo = new Map(); }
    // ② 全部会输（或算不完）：苟延残喘
    const budget = { n: 60000, until: Math.max(Date.now() + 600, t0 + 3000) };
    let best = null;
    for (const m of ms) {
      const c = child(g, m);
      let d = -1;
      if (Date.now() < budget.until) { try { d = forcedDepth(c, this.hero, 14, budget); } catch (e) { d = -1; } }
      let ro = 0; try { ro = this.rollout(c.clone(), pi); } catch (e) { }
      const sc = (d === Infinity ? 1e9 : d < 0 ? 0 : d * 1e6) + ro;
      if (!best || sc > best.sc) best = { sc, m, d };
    }
    if (process.env.AIDBG) console.log('[puzzle-ai] stall', best.d, Date.now() - t0, 'ms');
    return best.m;
  }
}
module.exports.PuzzleAI = PuzzleAI;

} },
"/app/server/ai.js": { deps: {"./ai_eval":"/app/server/ai_eval.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
const { evaluate, pickSelect, cardValue } = require('./ai_eval');

class AI {
  constructor(level = 'normal', seed = Date.now()) {
    this.level = level; let s = seed >>> 0;
    this.rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  decide(g, pi) {
    const q = g.pending;
    if (!q || q.player !== pi) return null;
    if (q.kind === 'select') {
      if (this.blockHook && /阻挡/.test(q.prompt)) return this.blockHook(g, pi, q);
      return pickSelect(g, pi, q, this.level, this.rng);
    }
    if (q.kind === 'option') return this.option(g, pi, q);
    return this.main(g, pi, q);
  }

  // ---------- 选项 ----------
  option(g, pi, q) {
    const pr = q.prompt, o = q.options;
    if (/先攻/.test(o.join())) return 0;
    if (/重新抽取/.test(pr)) {
      const h = g.p[pi].hand;
      const cheap = h.filter(c => c.def.kind === 'pal' && c.def.cost <= 3).length;
      return cheap === 0 || (this.level !== 'easy' && h.filter(c => c.def.cost >= 7).length >= 3) ? 0 : 1;
    }
    if (/攻击目标/.test(pr)) return this.attackTarget(g, pi, q);
    if (/^是否/.test(pr) || o.length === 2 && o[0] === '是') {
      if (/返回手牌/.test(pr)) { const B = g.battle; return B && B.att && B.att.damage > 0 ? 0 : 1; }
      return 0;
    }
    if (/（X）/.test(pr)) {
      const n = o.length - 1;
      if (/丢弃/.test(pr)) return Math.min(n, Math.max(0, g.p[pi].hand.length - 3));
      return n;
    }
    if (/失去几个/.test(pr)) return o.length - 1;
    if (/宣言1个卡名/.test(pr)) return this.declareName(g, pi, q);
    if (this.level !== 'easy' && o.length <= 6) {
      const r = this.simBest(g, pi, o.map((_, i) => i));
      if (r !== null) return r;
    }
    return Math.floor(this.rng() * o.length);
  }
  declareName(g, pi, q) {
    // 宣言《家畜牧场》等无意义；尝试宣言能让《冒险的开始》或牧场条件成立的卡名 —— 简化：选第一个
    return 0;
  }
  attackTarget(g, pi, q) {
    const a = g.declaring;
    const targets = g.legalTargets(a);
    let best = 0, bs = -1e9;
    targets.forEach((t, i) => {
      const s = this.targetScore(g, pi, a, t) + (this.level === 'hard' ? this.hardTarget(g, pi, a, t) : 0);
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }
  targetScore(g, pi, a, t) {
    const op = 1 - pi, ap = g.power(a);
    const blockers = g.myPals(op, c => !c.rested);
    if (t === 'player') {
      const st = g.strike(a);
      let s = st * 6 + (g.p[op].life <= st ? 80 : 0);
      const strongBlock = blockers.some(b => g.power(b) >= ap - a.damage);
      if (strongBlock && !g.kw(a).stealth) s -= 8;
      return s;
    }
    const tp = g.power(t), left = tp - t.damage;
    if (g.isBld(t)) return ap >= left ? 6 + cardValue(g, t) : -5;
    const kills = ap >= left && ap > 0, dies = tp >= ap - a.damage && tp > 0;
    if (kills && !dies) return 12 + cardValue(g, t);
    if (kills && dies) return cardValue(g, t) - cardValue(g, a) + 2;
    return -20;
  }

  // ---------- 主要阶段 / 快速步骤 ----------
  main(g, pi, q) {
    const acts = q.actions;
    const endI = acts.findIndex(a => a.t === 'end');
    if (q.quick) return this.quick(g, pi, q);
    if (this.level === 'easy') {
      if (endI >= 0 && this.rng() < 0.12) return endI;
      const good = acts.map((a, i) => [a, i]).filter(([a]) => a.t === 'play' || (a.t === 'attack' && this.rng() < 0.7) || (a.t === 'act' && this.rng() < 0.3));
      if (good.length) return good[Math.floor(this.rng() * good.length)][1];
      return endI >= 0 ? endI : 0;
    }
    if (this.level === 'hard' && this.useDeep) {
      const r = this.simBest(g, pi, acts.map((_, i) => i), endI);
      if (r !== null) return r;
    }
    let best = endI >= 0 ? endI : 0, bs = 0.5;
    acts.forEach((a, i) => {
      const s = this.heur(g, pi, a, acts) + (this.level === 'hard' ? this.hardAdj(g, pi, a) : 0);
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }
  // 困难难度附加规则
  lethal(g, pi) {
    const op = 1 - pi;
    const atks = g.myPals(pi, c => !c.rested && g.legalTargets(c).includes('player')).map(c => ({ c, s: g.strike(c), st: !!g.kw(c).stealth }));
    const blockers = g.myPals(op, c => !c.rested).length;
    const stealthDmg = atks.filter(a => a.st).reduce((s, a) => s + a.s, 0);
    const rest = atks.filter(a => !a.st).map(a => a.s).sort((x, y) => y - x).slice(blockers);
    const interrupts = g.p[op].hand.length >= 1 ? 1 : 0; // 对方可能持有妨碍
    return stealthDmg + rest.reduce((s, x) => s + x, 0) >= g.p[op].life + interrupts * 2;
  }
  hardAdj(g, pi, a) {
    const c = a.uid ? g.findCard(a.uid) : null, me = g.p[pi];
    if (a.t === 'attack') {
      const ts = g.legalTargets(c);
      if (this.lethal(g, pi) && ts.includes('player')) return 200;
      // 攻击后横置，可能被对方攻击
      const maxOp = Math.max(0, ...g.opPals(pi).map(x => g.power(x)));
      if (maxOp >= g.power(c)) return -cardValue(g, c) * 0.25;
      return 2;
    }
    if (a.t === 'play') {
      const d = c.def;
      const hasInt = me.hand.some(h => h !== c && h.def.kw && h.def.kw.interrupt);
      const left = g.untapSouls(pi) - g.playCost(c, pi);
      if (hasInt && left < 1 && g.myPals(pi).length > 0 && d.kind !== 'pal') return -8;
      if (d.kw && d.kw.interrupt && me.hand.length <= 3 && g.myPals(pi).length >= 2) return -12;
      if (d.kind === 'pal' && /登场时/.test(d.text)) return 4;
    }
    return 0;
  }
  // 困难：攻击目标额外考虑斩杀
  hardTarget(g, pi, a, t) {
    if (t === 'player' && this.lethal(g, pi)) return 300;
    return 0;
  }
  heur(g, pi, a, acts) {
    const me = g.p[pi];
    const c = a.uid ? g.findCard(a.uid) : null;
    const palCount = g.myPals(pi).length;
    const hasAttack = acts.some(x => x.t === 'attack');
    if (a.t === 'play') {
      const d = c.def;
      if (d.kind === 'pal') return palCount >= 5 ? (cardValue(g, c) > 10 ? 3 : -1) : 20 + d.cost;
      if (d.kind === 'building') return 14 + d.cost;
      if (d.kind === 'gear') return palCount ? 12 + d.cost : 2;
      return this.simDelta(g, pi, a);
    }
    if (a.t === 'attack') {
      const ts = g.legalTargets(c);
      const s = Math.max(...ts.map(t => this.targetScore(g, pi, c, t)));
      return s > 0 ? 10 + s : -1;
    }
    if (a.t === 'act') {
      if (/任命/.test(a.label) && hasAttack) {
        if (this.level !== 'hard') return -1;
        // 困难：存在无法有效攻击的竖置帕鲁时，用其任命
        const idle = g.myPals(pi, x => !x.rested && !g.legalTargets(x).some(t => this.targetScore(g, pi, x, t) > 0));
        if (!idle.length) return -1;
      }
      const d = this.simDelta(g, pi, a);
      return d > 1 ? 5 + d : -1;
    }
    if (a.t === 'soulDraw') return me.hand.length <= 2 && !acts.some(x => x.t === 'play') ? 4 : -1;
    return -1;
  }
  quick(g, pi, q) {
    const acts = q.actions, endI = acts.findIndex(a => a.t === 'end');
    if (this.level === 'easy' && this.rng() < 0.5) return endI;
    const B = g.battle;
    let best = endI, bs = 0;
    acts.forEach((a, i) => {
      if (a.t === 'end') return;
      let s;
      if (a.key === 'interrupt') {
        const threat = B && B.target === 'player' ? g.strike(B.att) * (g.p[pi].life <= 4 ? 10 : 3) : B && B.target && B.target.def ? cardValue(g, B.target) : 0;
        const lethal = B && B.target === 'player' && g.strike(B.att) >= g.p[pi].life;
        s = lethal ? 100 : threat - (/①/.test(a.label) ? 6 : 9);
      } else s = this.simDelta(g, pi, a, i);
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }

  // ---------- 模拟 ----------
  // 公平化：模拟前随机重排对己方未知的信息（对手手牌+卡组、己方卡组）
  determinize(g2, pi) {
    const r = this.rng;
    const sh = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
    sh(g2.p[pi].deck);
    const op = g2.p[1 - pi]; const pool = [...op.hand, ...op.deck]; sh(pool);
    const hn = op.hand.length;
    op.hand = pool.slice(0, hn); op.deck = pool.slice(hn);
    for (const c of op.hand) c.zone = 'hand'; for (const c of op.deck) c.zone = 'deck';
  }
  rollout(g2, pi, deep) {
    const sub = new AI('normal', Math.floor(this.rng() * 1e9)); sub.noSim = true;
    const turn = g2.turnNo;
    for (let k = 0; k < (deep ? 400 : 120) && g2.pending; k++) {
      const q = g2.pending;
      if (!deep && q.player === pi && q.kind === 'main' && !q.quick) break;
      if (g2.turnNo !== turn && !deep) break;
      if (deep && g2.turnNo >= turn + 2) break;
      g2.answer(q.player, sub.decide(g2, q.player));
    }
    return evaluate(g2, pi);
  }
  simIdx(g, pi, i) {
    const deep = false;
    const samples = this.level === 'hard' ? 3 : 1;
    let tot = 0;
    for (let s = 0; s < samples; s++) {
      try {
        const g2 = g.clone();
        if (this.level === 'hard') this.determinize(g2, pi);
        g2.answer(pi, i); tot += this.rollout(g2, pi, deep);
      } catch (e) { return -1e9; }
    }
    return tot / samples;
  }
  simBest(g, pi, idxs, endI) {
    if (this.noSim) return null;
    let best = null, bs = -1e18;
    for (const i of idxs.slice(0, 18)) {
      const v = this.simIdx(g, pi, i) + (i === endI ? 0.3 : 0);
      if (v > bs) { bs = v; best = i; }
    }
    return best;
  }
  simDelta(g, pi, a, idx) {
    if (this.noSim) return a && a.t === 'act' ? (this.actHeur ? this.actHeur(g, pi, a) : 1) : 1;
    const q = g.pending; const i = idx !== undefined ? idx : q.actions.indexOf(a);
    return this.simIdx(g, pi, i) - evaluate(g, pi);
  }
}
module.exports = { AI };

} },
"/app/server/ai_eval.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 规则型电脑 AI（不使用 LLM）。难度：easy / normal / hard
// easy：随机性高、只做简单判断；normal：启发式规则；hard：启发式 + 对主要阶段行动做1步模拟评估

function cardValue(g, c) {
  if (!c) return 0;
  const d = c.def;
  if (d.kind === 'pal') return g.power(c) / 100 + g.strike(c) * 3 + d.cost * 0.6 + (c.rested ? 0 : 1.5);
  if (d.kind === 'building') return 4 + d.cost * 0.6;
  if (d.kind === 'gear') return 3 + d.cost * 0.5;
  return d.cost * 0.5;
}
// 局面评估（从 pi 视角）
function evaluate(g, pi) {
  if (g.over) return g.over.winner === pi ? 1e6 : g.over.winner === -1 ? 0 : -1e6;
  const me = g.p[pi], op = g.p[1 - pi];
  let s = 0;
  const lifeW = w => Math.max(w, 0) * 26 + (w <= 4 ? Math.max(w, 0) * 12 : 0);
  s += lifeW(me.life) - lifeW(op.life);
  for (const c of me.base) s += cardValue(g, c);
  for (const c of op.base) s -= cardValue(g, c);
  s += (me.hand.length - op.hand.length) * 2.2;
  s += (me.souls.length - op.souls.length) * 2.5;
  s += (me.material + me.ingredient - op.material - op.ingredient) * 0.4;
  if (me.deck.length < 8) s -= (8 - me.deck.length) * 4;
  if (op.deck.length < 8) s += (8 - op.deck.length) * 4;
  return s;
}

function mineOf(g, uid) { const c = g.findCard(uid); return c; }
// 选择卡片：根据提示语判断是"有利"还是"有害"效果
function harmful(prompt) { return /伤害|墓地|横置|放逐|返回手牌|-\d|无法|解体|丢弃/.test(prompt) && !/墓地中|墓地的|墓地帕鲁/.test(prompt); }

function pickSelect(g, pi, q, level, rng) {
  const cands = q.cands.map(u => mineOf(g, u)).filter(Boolean);
  const pr = q.prompt;
  if (level === 'easy' && rng() < 0.4) {
    const n = q.min + Math.floor(rng() * (q.max - q.min + 1));
    return q.cands.slice().sort(() => rng() - 0.5).slice(0, n);
  }
  let score;
  if (/阻挡/.test(pr)) return blockChoice(g, pi, cands, level);
  if (/丢弃/.test(pr) && cands.every(c => c.zone === 'hand' && c.owner === pi)) {
    score = c => -handKeep(g, pi, c);
  } else if (/卡组顶/.test(pr) && cands.every(c => c.zone === 'hand')) {
    score = c => -handKeep(g, pi, c);
  } else if (/任命/.test(pr)) {
    score = c => -(g.power(c) + (c.def.kw && c.def.kw.serious ? -500 : 0));
  } else if (/解体/.test(pr) || /超过上限/.test(pr) || (/放置于墓地/.test(pr) && /你的/.test(pr) && cands.every(c => c.ctrl === pi))) {
    score = c => -cardValue(g, c) + (c.def.autos && c.def.autos.some(a => /墓地/.test(a.text || '')) ? 3 : 0);
  } else if (harmful(pr)) {
    score = c => (c.ctrl === pi || (c.zone !== 'base' && c.owner === pi) ? -50 - cardValue(g, c) : cardValue(g, c) + killBonus(g, c, pr));
  } else {
    // 有益：选己方高价值
    score = c => ((c.zone === 'base' ? c.ctrl : c.owner) === pi ? 20 + cardValue(g, c) + (c.rested ? 0 : 3) : -20 - cardValue(g, c));
  }
  const sorted = cands.slice().sort((a, b) => score(b) - score(a));
  let n = q.min;
  for (let i = q.min; i < q.max && i < sorted.length; i++) if (score(sorted[i]) > 0) n = i + 1;
  if (q.max > 0 && n === 0 && q.min === 0 && /加入手牌|登场|返回手牌/.test(pr) && !harmful(pr)) n = Math.min(q.max, sorted.length);
  return sorted.slice(0, n).map(c => c.uid);
}
function killBonus(g, c, pr) {
  const m = pr.match(/(\d+)\s*伤害/);
  if (m && c.zone === 'base') { const left = g.power(c) - c.damage; return +m[1] >= left ? 15 : -5; }
  return 0;
}
function handKeep(g, pi, c) {
  const d = c.def; const souls = g.p[pi].souls.length;
  let v = d.cost <= souls + 2 ? 5 : 2;
  if (d.kind === 'pal') v += 2 + (g.p[pi].base.filter(x => x.def.kind === 'pal').length < 2 ? 3 : 0);
  if (d.kw && d.kw.interrupt) v += 2;
  return v + d.cost * 0.3;
}
function blockChoice(g, pi, cands, level) {
  const B = g.battle; if (!B) return [];
  const att = B.att, tgt = B.target;
  const ap = g.power(att) - att.damage * 0;
  let best = null, bestS = 0;
  for (const c of cands) {
    const bp = g.power(c);
    let s = 0;
    const kills = bp >= g.power(att) - att.damage && bp > 0;
    const dies = ap >= bp - c.damage;
    if (kills && !dies) s = 30;
    else if (kills && dies) s = cardValue(g, att) - cardValue(g, c);
    else if (!dies) s = 3;
    else s = -cardValue(g, c);
    if (tgt === 'player') { const st = g.strike(att); const life = g.p[pi].life; s += st >= life ? 100 : st * (life <= 4 ? 6 : 2.5); }
    else if (tgt && tgt.def) s += cardValue(g, tgt) * 0.8;
    if (s > bestS) { bestS = s; best = c; }
  }
  if (level === 'easy' && best && Math.random() < 0.5) return [];
  return best ? [best.uid] : [];
}
module.exports = { evaluate, pickSelect, cardValue, handKeep, harmful };

} },
"/app/server/ai_master.js": { deps: {"./ai":"/app/server/ai.js","./ai_eval":"/app/server/ai_eval.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 大师级 AI：每个决策点对所有候选行动做「蒙特卡洛前瞻」——
// 执行该行动后，用强化启发式策略把本回合打完、再模拟对手完整一回合，
// 在多次「公平化」采样（重洗未知信息）上取平均局面评估，选期望最高的行动。
// 共同随机数（同一采样种子比较不同行动）降低方差。
const { AI } = require('./ai');
const { cardValue, evaluate } = require('./ai_eval');

// 更深入的局面评估（从 pi 视角）
function evalM(g, pi) {
  if (g.over) return g.over.winner === pi ? +(process.env.TV || 400) - g.turnNo : g.over.winner === -1 ? -150 : -(process.env.TV || 400) + g.turnNo;
  const me = g.p[pi], op = g.p[1 - pi];
  const lifeV = l => { l = Math.max(l, 0); return l * 22 + Math.min(l, 6) * 14 + Math.min(l, 3) * 20; };
  let s = lifeV(me.life) - lifeV(op.life);
  const palV = (c, mine) => {
    const d = c.def;
    if (d.kind === 'pal') {
      let v = g.power(c) / 100 + g.strike(c) * 3.2 + d.cost * 0.5 + 3;
      const k = g.kw(c);
      if (k.stealth) v += 2; if (k.taunt) v += 1.5; if (k.assault) v += 1.5;
      if (d.acts && d.acts.length) v += 1.5;
      return v;
    }
    if (d.kind === 'building') return 4 + d.cost * 0.7;
    if (d.kind === 'gear') return 3 + d.cost * 0.5;
    return 0;
  };
  for (const c of me.base) s += palV(c, true);
  for (const c of op.base) s -= palV(c, false);
  // 压制力：轮到谁行动，谁的竖置帕鲁能造成的打击（对方可阻挡数折减）
  const pressure = (a, b) => {
    const atk = g.myPals(a).map(c => g.strike(c)).sort((x, y) => y - x);
    const blk = g.myPals(b, c => !c.rested).length;
    const dmg = atk.slice(blk).reduce((x, y) => x + y, 0);
    const L = Math.max(g.p[b].life, 1);
    return dmg >= L ? 40 : dmg * (L <= 4 ? 6 : 2.5);
  };
  s += pressure(pi, 1 - pi) * (g.active === pi ? 1 : 0.6) - pressure(1 - pi, pi) * (g.active === pi ? 0.6 : 1);
  s += (me.hand.length - op.hand.length) * 2.6;
  // 灵魂每回合补充，几乎不影响长期局面；只保留少量价值（快速/妨碍时可用）
  s += (me.souls.length - op.souls.length) * 0.4;
  s += (me.material + me.ingredient - op.material - op.ingredient) * 0.5;
  if (me.deck.length < 8) s -= (8 - me.deck.length) * 5;
  if (op.deck.length < 8) s += (8 - op.deck.length) * 5;
  return s;
}

// 推演策略中的起动能力估值：资源/抽卡/伤害类能力通常值得用（无模拟时的近似）
function actHeur(g, pi, a) {
  const L = a.label || '';
  if (/妨碍/.test(L)) return -5;
  if (/抽|获得|伤害|登场|竖置|横置|强化|战斗力|放逐|墓地/.test(L)) return 3;
  return 1.5;
}
class MasterAI extends AI {
  constructor(level = 'master', seed = Date.now(), opt = {}) {
    super('hard', seed);
    this.level = 'master';
    this.samples = opt.samples || +process.env.MS || 8;
    this.budgetMs = opt.budgetMs || 2500;
    this.cheat = !!opt.cheat; // 残局：信息全公开时不做公平化
    this.policy = (sd) => { const a = new AI('hard', sd); a.noSim = true; if (process.env.ACT !== '0') a.actHeur = actHeur; return a; };
  }
  decide(g, pi) {
    const q = g.pending;
    if (!q || q.player !== pi) return null;
    if (q.kind === 'option') {
      if (/先攻/.test(q.options.join()) || /重新抽取/.test(q.prompt)) return super.decide(g, pi);
      return this.search(g, pi, q.options.map((_, i) => i));
    }
    if (q.kind === 'select') {
      if (q.max <= 1 && q.cands.length <= 7) {
        const opts = q.cands.map(u => [u]); if (q.min === 0) opts.unshift([]);
        return this.search(g, pi, opts);
      }
      // 多选：启发式给出基准，再与若干变体比较
      const base = super.decide(g, pi);
      const alts = [base];
      if (q.min === 0 && base.length) alts.push([]);
      return this.search(g, pi, alts);
    }
    // main / quick
    const acts = q.actions, seen = new Map(), idx = [];
    acts.forEach((a, i) => {
      const c = a.uid ? g.findCard(a.uid) : null;
      const key = a.t + '|' + (c ? (c.zone === 'hand' ? 'h:' + c.id : c.uid) : '') + '|' + (a.label || '').replace(/《[^》]*》/g, '');
      if (!seen.has(key)) { seen.set(key, i); idx.push(i); }
    });
    if (idx.length === 1) return idx[0];
    return this.search(g, pi, idx);
  }
  // 对候选答案做共同随机数蒙特卡洛评估
  search(g, pi, answers) {
    if (answers.length === 1) return answers[0];
    const t0 = Date.now();
    const tot = answers.map(() => 0), n = answers.map(() => 0);
    const S = this.samples;
    for (let s = 0; s < S; s++) {
      const sd = Math.floor(this.rng() * 1e9);
      for (let k = 0; k < answers.length; k++) {
        if (s > 0 && Date.now() - t0 > this.budgetMs) break;
        let v;
        try {
          const g2 = g.clone();
          if (!this.cheat) this.fair(g2, pi, sd);
          g2.answer(pi, answers[k]);
          v = this.roll(g2, pi, sd);
        } catch (e) { v = -1e9; this.errs = (this.errs || 0) + 1; if (process.env.AIDBG) console.error(e.stack); }
        tot[k] += v; n[k]++;
      }
    }
    let best = 0, bv = -Infinity;
    answers.forEach((_, k) => { const v = n[k] ? tot[k] / n[k] : -Infinity; if (v > bv) { bv = v; best = k; } });
    if (process.env.AIDBG2) { const q = g.pending; console.log('T' + g.turnNo, q.kind, q.prompt.slice(0, 30), answers.map((a, k) => (q.kind === 'main' ? q.actions[a].label : q.kind === 'option' ? q.options[a] : JSON.stringify(a)) + '=' + (tot[k] / n[k]).toFixed(1)).join(' | ')); }
    return answers[best];
  }
  fair(g2, pi, sd) {
    let s = sd >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const sh = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
    sh(g2.p[pi].deck);
    const op = g2.p[1 - pi]; const pool = [...op.hand, ...op.deck]; sh(pool);
    const hn = op.hand.length;
    op.hand = pool.slice(0, hn); op.deck = pool.slice(hn);
    for (const c of op.hand) c.zone = 'hand'; for (const c of op.deck) c.zone = 'deck';
  }
  // 推演到「下一次轮到 pi 的主要阶段开始」为止
  roll(g2, pi, sd) {
    const pol = [this.policy(sd), this.policy(sd + 1)];
    const start = g2.turnNo, myTurn = g2.active === pi;
    const stopTurn = process.env.HZ === 'short' ? start + 1 : myTurn ? start + 2 : start + 1;
    for (let k = 0; k < 600 && g2.pending; k++) {
      if (g2.turnNo >= stopTurn) break;
      const q = g2.pending;
      g2.answer(q.player, pol[q.player].decide(g2, q.player));
    }
    return process.env.EV === 'old' ? evaluate(g2, pi) : evalM(g2, pi);
  }
}
module.exports = { MasterAI, evalM };

} },
"/app/server/ai_deep.js": { deps: {"./ai":"/app/server/ai.js","./ai_master":"/app/server/ai_master.js","./solver":"/app/server/solver.js","./ai_value":"/app/server/ai_value.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 深度搜索 AI（困难）：在自己回合的每个决策点，
// 对「本回合内所有可能的行动序列」做深度优先搜索（含子选择：目标、选项、选卡），
// 一直推演到回合结束（轮到对手），用局面评估函数给最终局面打分，选择分数最高的路径。
// - 对手在我方回合内的应对（阻挡、妨碍等）用启发式策略模拟；
// - 未知信息（对手手牌/卡组、我方卡组顺序）在搜索前做一次随机「公平化」，不偷看；
// - 转置表合并"同一局面不同顺序"；按节点预算在兄弟分支间均分，预算用尽的分支用贪心策略补完本回合；
// - 找到的整条路径会缓存，后续决策若局面与计划一致则直接沿用，不一致（如抽到新牌）则重新搜索。
const { AI } = require('./ai');
const { evalM } = require('./ai_master');
const { sig, Solver, moves: solverMoves, child: solverChild } = require('./solver');
const VN = require('./ai_value');
// 局面评估：value='net' 用学习到的价值网络（终局 ±1000），否则用手写评估 evalM
function evalOf(ai, g, pi) {
  if (ai.value === 'net' && VN.ready()) { if (g.over) return g.over.winner === pi ? 1000 - g.turnNo : g.over.winner === -1 ? -300 : -1000 + g.turnNo; return 300 * VN.value(g, pi, ai.vfile); }
  return evalM(g, pi);
}

function actHeur(g, pi, a) {
  const L = a.label || '';
  if (/妨碍/.test(L)) return -5;
  if (/抽|获得|伤害|登场|竖置|横置|强化|战斗力|放逐|墓地/.test(L)) return 3;
  return 1.5;
}
// 不含隐藏信息的局面指纹：用于判断真实局面是否仍在计划路径上
function fp(g, pi) {
  const cv = c => [c.id, c.rested ? 1 : 0, c.damage, g.power(c), g.isPal(c) ? g.strike(c) : 0, Object.keys(c.used || {}).filter(k => c.used[k] === g.turnNo).join('.')].join(',');
  const pv = (p, mine) => [p.life, mine ? p.hand.map(c => c.id).sort().join(',') : p.hand.length, p.deck.length, p.grave.length, p.exile.length,
    p.base.map(cv).sort().join('|'), p.souls.length, p.souls.filter(s => !s.rested).length, p.material, p.ingredient, p.played].join(';');
  const q = g.pending, B = g.battle;
  const qs = q ? [q.player, q.kind, q.prompt, (q.actions || []).map(a => a.label).join('/'), (q.options || []).join('/'), (q.cands || []).join(',')].join('#') : '';
  return [g.turnNo, g.phase, B ? [B.att.uid, B.target === 'player' ? 'P' : B.target.uid, B.blocked].join(':') : '', g.queue.length, pv(g.p[pi], true), pv(g.p[1 - pi], false), qs].join('§');
}

class DeepAI extends AI {
  constructor(seed = Date.now(), opt = {}) {
    super('hard', seed);
    this.noSim = true; this.actHeur = actHeur;          // 自身启发式（用于排序与贪心补完）不再嵌套模拟
    this.budgetMs = opt.budgetMs || +process.env.DEEP_MS || 1800;
    this.maxNodes = opt.maxNodes || +process.env.DEEP_NODES || 2500;
    this.oppTurn = opt.oppTurn !== undefined ? opt.oppTurn : process.env.DEEP_OPP !== '0';
    this.rollouts = opt.rollouts || +process.env.DEEP_R || 1;
    this.value = opt.value || process.env.DEEP_VALUE || 'net';
    this.vfile = opt.vfile || null;
    this.forceMs = opt.forceMs || +process.env.DEEP_FMS || 1500; this.puzzleMs = opt.puzzleMs || +process.env.DEEP_PMS || 20000; this.forceNodes = opt.forceNodes || 60000;
    this.minOpp = opt.minOpp !== undefined ? opt.minOpp : process.env.DEEP_MINOPP !== '0';
    this.cheat = !!opt.cheat;                                   // 地狱：完全信息（看得到对手手牌与双方卡组顺序）
    this.inner = !!opt.inner;                                   // 内层（对手回合）搜索
    this.reply = opt.reply !== undefined ? opt.reply : process.env.DEEP_REPLY !== '0';
    this.topM = opt.topM || +process.env.DEEP_M || 6;             // 复核的候选数
    this.samples = opt.samples || +process.env.DEEP_K || 3;       // 每个候选抽样对手手牌次数
    this.replyMs = opt.replyMs || +process.env.DEEP_RMS || 2400;  // 第二阶段总时间
    this.replyNodes = opt.replyNodes || +process.env.DEEP_RN || 100;
    this.plan = null;
  }
  pol(sd) { const a = new AI('hard', sd); a.noSim = true; a.actHeur = actHeur; return a; }

  decide(g, pi) {
    const q = g.pending;
    if (!q || q.player !== pi) return null;
    // 只在自己回合深搜；对手回合中的应对（阻挡/妨碍）沿用困难启发式
    if (g.active !== pi && !g.over) { const fw = this.forced(g, pi); if (fw !== null) return fw; }
    if (g.active !== pi || g.over) { this.noSim = false; try { return super.decide(g, pi); } finally { this.noSim = true; } }
    if (q.kind === 'option' && (/先攻/.test(q.options.join()) || /重新抽取/.test(q.prompt))) return super.decide(g, pi);
    const fw = this.forced(g, pi); if (fw !== null) { this.plan = null; return fw; }
    const opts = this.answers(g, pi);
    if (opts.length === 1) { this.plan = null; return opts[0]; }
    // 沿用已有计划
    const f = fp(g, pi);
    if (this.plan && this.plan.length && this.plan[0].fp === f) return this.plan.shift().ans;
    return this.search(g, pi);
  }

  // 必胜检查（AND-OR 求解）：在隐藏信息重抽样后的副本上找"无论对手如何应对都能获胜"的着法。
  // 只在可能接近终局时尝试（有回合限制、对手生命低、卡组将尽），同一局面失败过不再重试。
  forced(g, pi) {
    if (this.inner || this.noForce) return null;
    const op = g.p[1 - pi], me = g.p[pi];
    const near = g.limit || op.life <= 6 || op.deck.length <= 6 || me.life <= 3;
    if (!near) return null;
    const f = fp(g, pi) + '|' + g.hist.length;
    this.fmemo = this.fmemo || new Map();
    if (this.fmemo.has(f)) return null;
    const c = g.clone();
    this.fair(c, pi, Math.floor(this.rng() * 1e9));
    // 残局（公开信息）：求解器可跨步复用（已证明的结论仍有效），预算放宽
    const sc = !!(g.init && g.init.scenario);
    const S = sc && this.psolver && this.psolver.hero === pi ? this.psolver : new Solver({ hero: pi, maxNodes: sc ? 400000 : this.forceNodes });
    S.nodes = 0; S.until = Date.now() + (sc ? this.puzzleMs : this.forceMs);
    let mv = null;
    try { if (S.win(c)) { const ms = solverMoves(c); for (const m of ms) if (S.win(solverChild(c, m))) { mv = m; break; } } } catch (e) { mv = null; }
    // 超时抛出后 memo 中可能残留"进行中=false"的条目，不能复用
    if (sc) this.psolver = mv !== null ? S : null;
    if (mv === null) { this.fmemo.set(f, 1); return null; }
    if (process.env.AIDBG) console.log(`[forced] T${g.turnNo} win found nodes=${S.nodes}`);
    // 着法需映射回真实局面：main/option 用下标；select 用 uid（重抽样只交换手牌/卡组内容，场上 uid 一致）
    const q = g.pending;
    if (q.kind === 'select') { if (!Array.isArray(mv) || mv.some(u => !q.cands.includes(u))) return null; }
    else if (!Number.isInteger(mv) || mv >= (q.kind === 'main' ? q.actions.length : q.options.length)) return null;
    return mv;
  }
  // 某决策点的候选答案（已按启发式从好到坏排序）
  answers(g, pi) {
    const q = g.pending;
    if (q.kind === 'main') {
      const seen = new Set(), out = [];
      q.actions.forEach((a, i) => {
        const c = a.uid ? g.findCard(a.uid) : null;
        const key = a.t + '|' + (c ? (c.zone === 'hand' ? 'h:' + c.id : c.uid) : '') + '|' + (a.label || '').replace(/《[^》]*》/g, '');
        if (seen.has(key)) return; seen.add(key);
        let h = 0; try { h = a.t === 'end' ? 0.4 : this.heur(g, pi, a, q.actions); } catch (e) { }
        out.push([i, h]);
      });
      return out.sort((x, y) => y[1] - x[1]).map(x => x[0]);
    }
    if (q.kind === 'option') {
      const base = super.decide(g, pi);
      if (q.options.length > 8) return [base];
      const all = [base, ...q.options.map((_, i) => i).filter(i => i !== base)];
      const ok = all.filter(i => !this.badTarget(g, q, i));
      return ok.length ? ok : all;
    }
    // select
    const base = super.decide(g, pi);
    const out = [base]; const k = JSON.stringify;
    if (q.max <= 1 && q.cands.length <= 8) {
      const seen = new Map();
      for (const u of q.cands) { const c = g.findCard(u) || g.p.flatMap(p => p.deck).find(x => x.uid === u); const kk = c ? [c.id, c.zone, c.ctrl, c.rested, c.damage].join(':') : u; if (!seen.has(kk)) seen.set(kk, u); }
      for (const u of seen.values()) out.push([u]);
      if (q.min === 0) out.push([]);
    } else if (q.min === 0 && base.length) out.push([]);
    const s = new Set(); return out.filter(a => { const x = k(a); if (s.has(x)) return false; s.add(x); return true; });
  }

  // 白送：攻击帕鲁却打不死、自己还会被反杀（攻击时增益按 +500 宽容估计）
  badTarget(g, q, i) {
    const m = q.meta; if (!m || !m.attacker || !m.targets) return false;
    const t = m.targets[i]; if (t === 'player') return false;
    const a = g.findCard(m.attacker), c = g.findCard(t); if (!a || !c || !g.isPal(c)) return false;
    // 只有"攻击时 …战斗力+X"这类能力才计入增益（抽卡等攻击时能力不算）
    const m2 = /攻击时[^。]*?战斗力】?\+(\d+)/.exec((a.def && a.def.text) || ''); const bonus = m2 ? +m2[1] : 0;
    const ap = g.power(a) + bonus, left = g.power(c) - c.damage;
    const kills = ap >= left && ap > 0, dies = g.power(c) >= g.power(a) + bonus - a.damage && g.power(c) > 0;
    if (!kills && dies) return true;
    // 对换：若我方另有尚未攻击的帕鲁能单独击杀它且自己存活，就不该用会死的帕鲁去换（交给那只去打）
    if (kills && dies) {
      const tp = g.power(c);
      const alt = g.myPals(a.ctrl, x => x !== a && !x.rested && g.rawTargets && g.legalTargets(x).includes(c))
        .some(x => g.power(x) >= left && tp < g.power(x) - x.damage);
      if (alt) return true;
    }
    return false;
  }
  search(g, pi) {
    this.t0 = Date.now(); this.nodes = 0; this.memo = new Map(); this.turn = g.turnNo; this.pi = pi;
    this.leaves = []; this.stack = [];
    const root = g.clone();
    this.fair(root, pi, Math.floor(this.rng() * 1e9));
    this.sd = Math.floor(this.rng() * 1e9);
    const r = this.dfs(root, this.maxNodes);
    let best = r;
    // 第二阶段：对本回合的若干候选结束局面，搜索对手下一回合的最强应对（多次抽样对手手牌，取均值）
    if (this.reply && !this.inner) best = this.rescore(r) || r;
    const first = best.path.length ? best.path[0].ans : super.decide(g, pi);
    this.plan = best.path.slice(1);
    if (process.env.AIDBG) console.log(`[deep] T${g.turnNo} nodes=${this.nodes} cands=${this.leaves.length} ${Date.now() - this.t0}ms v=${r.v.toFixed(1)}→${best.v.toFixed(1)} steps=${best.path.length}`);
    return first;
  }
  rescore(r) {
    const seen = new Set(), cands = [];
    for (const L of this.leaves.sort((a, b) => b.v - a.v)) {
      const k = sig(L.g); if (seen.has(k)) continue; seen.add(k); cands.push(L);
      if (cands.length >= this.topM) break;
    }
    if (cands.length <= 1) return null;
    const t1 = Date.now(), budget = this.replyMs, op = 1 - this.pi;
    let best = null;
    cands.forEach((L, ci) => {
      let v;
      if (L.g.over || L.g.turnNo === this.turn && L.g.active === this.pi && L.g.pending) v = L.base;
      else {
        let sum = 0, n = 0;
        const S = this.cheat ? 1 : this.samples;
        for (let k = 0; k < S; k++) {
          // 只按节点数限制（不按时间），保证各候选得到同等深度的对手搜索；总时间超出 3 倍预算时才放弃
          if (Date.now() - t1 > budget * 3) break;
          const c = L.g.clone();
          this.fair(c, op, this.sd + 101 * k, true);   // 公共随机数：各候选用同一组抽样，差异只来自候选本身   // 对手视角：对手知道自己的手牌，我们只能抽样；我方卡组顺序也未知
          const opAI = new DeepAI(this.sd + k, { inner: true, cheat: this.cheat, value: this.value, vfile: this.vfile, maxNodes: this.cheat ? this.replyNodes * 2 : this.replyNodes, budgetMs: 1e9 });
          sum += -opAI.bestValue(c, op); n++;
        }
        v = n ? 0.35 * L.base + 0.65 * sum / n : L.v;
      }
      if (process.env.AIDBG) console.log(`   cand ${ci}: stage1=${L.v.toFixed(1)} base=${L.base.toFixed(1)} → ${v.toFixed(1)}  ` + L.g.p.map(p => p.life + ":" + p.base.map(c => L.g.cname(c).slice(-4, -1) + (c.rested ? "R" : "")).join(",")).join(" | "));
      if (!best || v > best.v) best = { v, path: L.path };
    });
    return best;
  }
  // 内层：从对手（pi）的回合开始，搜索其整回合的最佳行动，返回 pi 视角的分数
  bestValue(g, pi) {
    this.t0 = Date.now(); this.nodes = 0; this.memo = new Map(); this.pi = pi; this.leaves = []; this.stack = [];
    this.sd = Math.floor(this.rng() * 1e9);
    // 推进到 pi 的第一个决策点（对手回合开始的抽卡等）
    for (let k = 0; k < 200 && g.pending && !g.over && g.pending.player !== pi; k++) { const q = g.pending; g.answer(q.player, this.pol(this.sd).decide(g, q.player)); }
    if (g.over || !g.pending) return evalOf(this, g, pi);
    this.turn = g.turnNo;
    if (g.active !== pi) return evalOf(this, g, pi);
    return this.dfs(g, this.maxNodes).v;
  }
  fair(g2, pi, sd, oppHandOnly) {
    if (this.cheat) return;
    if (g2.init && g2.init.scenario) return;   // 残局：局面（含卡组顺序）是公开给玩家的题面信息，不需要重抽样
    // 隐藏信息重抽样：写入 muts，使之后的 clone() 仍保持（否则克隆按历史重放会还原真实手牌）
    const fn = h => {
      let s = sd >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const sh = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
      if (!oppHandOnly) sh(h.p[pi].deck);
      const op = h.p[1 - pi]; const pool = [...op.hand, ...op.deck]; sh(pool);
      const hn = op.hand.length;
      op.hand = pool.slice(0, hn); op.deck = pool.slice(hn);
      for (const c of op.hand) c.zone = 'hand'; for (const c of op.deck) c.zone = 'deck';
      if (oppHandOnly) sh(h.p[pi].deck);
    };
    // oppHandOnly：pi 是"对手"，pi 的手牌由我们抽样 —— 即对 pi 之外一方做 fair 的反面
    if (oppHandOnly) { const q = 1 - pi; return this.fair(g2, q, sd, false); }
    fn(g2);
    g2.muts = [...(g2.muts || []), { at: g2.hist.length, fn }];
  }
  // 对手的应对用启发式自动走完，直到轮到我方决策 / 回合结束 / 对局结束
  advance(g2) {
    const op = this.pol(this.sd);
    for (let k = 0; k < 200 && g2.pending && !g2.over; k++) {
      if (g2.turnNo !== this.turn || g2.active !== this.pi) return;
      const q = g2.pending;
      if (q.player === this.pi) return;
      if (this.opBranch(g2, q)) return;              // 对手的关键应对（妨碍/快速/阻挡）交给搜索取最坏情况
      g2.answer(q.player, op.decide(g2, q.player));
    }
  }
  // 对手在我方回合中的关键决策点：返回候选答案（≥2 个时作为 MIN 节点搜索），否则 null
  opBranch(g2, q) {
    if (!this.minOpp) return null;
    if (q.kind === 'main' && q.quick) {
      const seen = new Set(), out = [];
      q.actions.forEach((a, i) => { const k = a.t === 'end' ? 'end' : (a.label || '').replace(/《[^》]*》/, '') + '|' + (g2.findCard(a.uid) || {}).id; if (!seen.has(k)) { seen.add(k); out.push(i); } });
      return out.length >= 2 ? out.slice(0, 4) : null;
    }
    if (q.kind === 'option' && /阻挡/.test(q.prompt) && q.options.length >= 2) return q.options.map((_, i) => i).slice(0, 4);
    return null;
  }
  // 叶子评估：回合结束时的局面分；可选再用启发式模拟对手一整回合（考虑反击）
  score(g2) {
    const base = evalOf(this, g2, this.pi);
    if (!this.oppTurn || g2.over || this.inner) return base;
    let sum = 0; const R = this.rollouts;
    for (let j = 0; j < R; j++) {
      const c = g2.clone(), p = [this.pol(this.sd + 2 + j * 11), this.pol(this.sd + 3 + j * 11)], t = c.turnNo;
      for (let k = 0; k < 400 && c.pending && !c.over && c.turnNo <= t; k++) { const q = c.pending; c.answer(q.player, p[q.player].decide(c, q.player)); }
      sum += evalOf(this, c, this.pi);
    }
    return 0.5 * base + 0.5 * sum / R;
  }
  leaf(g2) { return g2.turnNo !== this.turn || g2.active !== this.pi || g2.over || !g2.pending; }
  // 预算用尽：贪心策略补完本回合
  greedy(g2) {
    const p = [this.pol(this.sd), this.pol(this.sd + 1)];
    for (let k = 0; k < 300 && g2.pending && !this.leaf(g2); k++) { const q = g2.pending; g2.answer(q.player, p[q.player].decide(g2, q.player)); }
    return this.score(g2);
  }
  dfs(g2, budget) {
    this.advance(g2);
    if (this.leaf(g2)) {
      const v = this.score(g2);
      if (!this.inner) this.leaves.push({ v, base: evalOf(this, g2, this.pi), g: g2, path: this.stack.slice() });
      return { v, path: [] };
    }
    const key = sig(g2);
    if (this.memo.has(key)) return this.memo.get(key);
    const out = Date.now() - this.t0 > this.budgetMs || this.nodes >= this.maxNodes;
    if (budget < 1 || out) {
      const gg = g2.clone(), v = this.greedy(gg);
      if (!this.inner) this.leaves.push({ v, base: evalOf(this, gg, this.pi), g: gg, path: this.stack.slice() });
      const r = { v, path: [] }; this.memo.set(key, r); return r;
    }
    const oq = g2.pending;
    if (oq.player !== this.pi) {
      // MIN 节点：对手选择对我最不利的应对；只保留最坏分支下的候选叶子
      const oa = this.opBranch(g2, oq); let worst = null, wl = null, left = budget - 1;
      for (let i = 0; i < oa.length; i++) {
        const share = left / (oa.length - i), l0 = this.leaves.length; let r;
        try { const c = g2.clone(); this.nodes++; c.answer(oq.player, oa[i]); const b0 = this.nodes; r = this.dfs(c, share - 1); left -= Math.max(1, this.nodes - b0 + 1); }
        catch (e) { this.leaves.length = l0; continue; }
        const mine = this.leaves.splice(l0);
        if (!worst || r.v < worst.v - 1e-9) { worst = r; wl = mine; }
      }
      if (!worst) { worst = { v: this.greedy(g2.clone()), path: [] }; wl = []; }
      this.leaves.push(...wl);
      this.memo.set(key, worst);
      return worst;
    }
    const ans = this.answers(g2, this.pi), f = fp(g2, this.pi);
    let best = null, left = budget - 1;
    for (let i = 0; i < ans.length; i++) {
      const share = left / (ans.length - i);
      let r;
      try {
        const c = g2.clone(); this.nodes++;
        c.answer(this.pi, ans[i]);
        const before = this.nodes;
        this.stack.push({ fp: f, ans: ans[i] });
        try { r = this.dfs(c, share - 1); } finally { this.stack.pop(); }
        left -= Math.max(1, this.nodes - before + 1);
      } catch (e) { if (process.env.AIDBG) console.error(e.message); continue; }
      // 同分时偏好"结束回合"之外的行动顺序中靠前者（启发式排序）
      if (!best || r.v > best.v + 1e-9) best = { v: r.v, path: [{ fp: f, ans: ans[i] }, ...r.path] };
    }
    if (!best) best = { v: this.greedy(g2.clone()), path: [] };
    this.memo.set(key, best);
    return best;
  }
}
module.exports = { DeepAI };

} },
"/app/server/ai_value.js": { deps: {"fs":"fs","path":"path","./ai_feat":"/app/server/ai_feat.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 学习到的价值网络（与卡牌 ID 无关，见 ai_feat.js）。输出 pi 视角的胜率估计 [-1,1]。
const fs = require('fs'), path = require('path');
const { encode } = require('./ai_feat');
let M = null; const MS = new Map();
function load(file) {
  const f = file || process.env.AI_VALUE || path.join(__dirname, 'ai_value.json');
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); M = { ...j, W1: j.W1.map(r => Float32Array.from(r)), W2: j.W2.map(r => Float32Array.from(r)) }; } catch (e) { M = null; }
  return M;
}
function raw(g, pi, M) {
  const x = encode(g, pi), D = M.dim, H1 = M.b1.length, H2 = M.b2.length;
  const h1 = Float32Array.from(M.b1);
  for (let i = 0; i < D; i++) { const v = (x[i] - M.mu[i]) / M.sd[i]; if (v === 0) continue; const w = M.W1[i]; for (let j = 0; j < H1; j++) h1[j] += v * w[j]; }
  const h2 = Float32Array.from(M.b2);
  for (let i = 0; i < H1; i++) { const v = h1[i] > 0 ? h1[i] : 0; if (!v) continue; const w = M.W2[i]; for (let j = 0; j < H2; j++) h2[j] += v * w[j]; }
  let o = M.b3; for (let j = 0; j < H2; j++) if (h2[j] > 0) o += h2[j] * M.W3[j];
  return Math.tanh(o);
}
// 双视角对称化：v = (net(pi) - net(对手)) / 2，满足零和
function value(g, pi, file) {
  if (g.over) return g.over.winner === pi ? 1 : g.over.winner === -1 ? 0 : -1;
  let m;
  if (file) { if (!MS.has(file)) { const keep = M; MS.set(file, load(file)); M = keep; } m = MS.get(file); }
  else m = M || load();
  if (!m) return null;
  return (raw(g, pi, m) - raw(g, 1 - pi, m)) / 2;
}
module.exports = { value, load, ready: () => !!(M || load()) };

} },
"/app/server/ai_feat.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 局面特征编码（与卡牌 ID 无关）：每张卡只用"属性 + 规则文本语义标签"描述，
// 所以新卡只要有费用/战斗力/打击力/关键字/效果文本，就能直接编码，无需重新训练。
// 只使用 pi 视角下可见的信息（对手手牌只用张数，双方卡组只用张数和已知构成）。

const KW = ['interrupt', 'brave', 'serious', 'taunt', 'nocturnal', 'retaliate', 'assault', 'vigilance', 'stealth'];
// 规则文本语义标签：按效果文字匹配（新卡文本也同样适用）
const TAGS = [
  ['deploy', /登场时/], ['onatk', /攻击时/], ['ondie', /被破坏|放置于墓地时|放置入墓地时/], ['turnend', /回合结束时/],
  ['draw', /抽\d*张|抽1|抽卡/], ['dmg', /伤害/], ['destroy', /破坏/], ['exile', /放逐/], ['grave', /墓地/],
  ['rest', /横置/], ['stand', /竖置/], ['powup', /战斗力】?\+|\+\d+/], ['powdown', /-\d+/], ['search', /卡组顶|检视|公开/],
  ['food', /食材/], ['mat', /素材/], ['life', /生命/], ['night', /黑夜|夜/], ['summon', /使其登场|登场/], ['hand', /手牌/],
];
const NTAG = TAGS.length, NKW = KW.length;
const cache = new Map();
function staticVec(def) {
  let v = cache.get(def);
  if (v) return v;
  const t = (def.text || '') + ' ' + (def.acts ? def.acts.map(a => a.name || '').join(' ') : '');
  v = {
    tags: TAGS.map(([, re]) => re.test(t) ? 1 : 0),
    acts: def.acts ? def.acts.length : 0, autos: def.autos ? def.autos.length : 0, statics: def.statics ? def.statics.length : 0,
    quick: def.quick ? 1 : 0, lucky: def.lucky ? 1 : 0, len: Math.min(t.length, 200) / 200,
  };
  cache.set(def, v); return v;
}
// 单卡（场上）向量
const CARD_D = 12 + NKW + NTAG;
function cardVec(g, c, out, o, w = 1) {
  const d = c.def, s = staticVec(d), pal = d.kind === 'pal', k = c.zone === 'base' ? g.kw(c) : (d.kw || {});
  out[o++] += w * (pal ? 1 : 0); out[o++] += w * (d.kind === 'building' ? 1 : 0); out[o++] += w * (d.kind === 'gear' ? 1 : 0); out[o++] += w * (d.kind === 'event' ? 1 : 0);
  const pw = c.zone === 'base' ? g.power(c) : (d.power || 0);
  out[o++] += w * pw / 1000; out[o++] += w * (pal ? (c.zone === 'base' ? g.strike(c) : d.strike || 0) : 0) / 2; out[o++] += w * (d.cost || 0) / 6;
  out[o++] += w * (c.rested ? 1 : 0); out[o++] += w * (c.damage || 0) / 1000;
  out[o++] += w * Math.min(s.acts, 3) / 2; out[o++] += w * Math.min(s.autos, 3) / 2; out[o++] += w * (s.quick + s.lucky * 0.5 + s.statics * 0.5);
  for (const n of KW) out[o++] += w * (k[n] ? (typeof k[n] === 'number' ? Math.min(k[n], 3) : 1) : 0);
  for (let i = 0; i < NTAG; i++) out[o++] += w * s.tags[i];
  return o;
}
// 一方的特征
const SIDE_D = 24 + CARD_D * 3 + 6 * 3 + 4;
function sideVec(g, pi, viewer, out, o) {
  const p = g.p[pi], mine = pi === viewer, op = g.p[1 - pi];
  const L = Math.max(p.life, 0);
  const pals = p.base.filter(c => c.def.kind === 'pal'), stand = pals.filter(c => !c.rested);
  const oppStand = op.base.filter(c => c.def.kind === 'pal' && !c.rested);
  out[o++] = L / 10; out[o++] = Math.min(L, 3) / 3; out[o++] = Math.min(L, 6) / 6; out[o++] = L <= 2 ? 1 : 0;
  out[o++] = p.hand.length / 8; out[o++] = p.deck.length / 40; out[o++] = p.deck.length < 8 ? (8 - p.deck.length) / 8 : 0;
  out[o++] = p.grave.length / 20; out[o++] = p.exile.length / 10;
  out[o++] = p.souls.length / 10; out[o++] = p.souls.filter(s => !s.rested).length / 10; out[o++] = p.soulDeck / 10;
  out[o++] = Math.min(p.material, 10) / 5; out[o++] = Math.min(p.ingredient, 10) / 5;
  out[o++] = pals.length / 5; out[o++] = stand.length / 5; out[o++] = (p.base.length - pals.length) / 4;
  // 攻防关系：按打击力排序，扣除对方可阻挡数后的未阻挡打击
  const atk = stand.map(c => g.strike(c)).sort((a, b) => b - a);
  const unb = atk.slice(oppStand.length).reduce((a, b) => a + b, 0), tot = atk.reduce((a, b) => a + b, 0);
  const opL = Math.max(op.life, 1);
  out[o++] = unb / 5; out[o++] = tot / 8; out[o++] = unb >= opL ? 1 : 0; out[o++] = tot >= opL ? 1 : 0;
  // 我方竖置帕鲁能否在战斗中打赢对方最强竖置帕鲁
  const maxOp = Math.max(0, ...oppStand.map(c => g.power(c))), maxMe = Math.max(0, ...stand.map(c => g.power(c)));
  out[o++] = (maxMe - maxOp) / 1000; out[o++] = stand.filter(c => g.power(c) > maxOp).length / 5;
  out[o++] = mine ? 1 : 0;
  // 场上：全部卡求和；帕鲁求最大值（逐维）；手牌求和（仅自己可见）
  const base0 = o; for (const c of p.base) cardVec(g, c, out, base0); o += CARD_D;
  const mx = new Float32Array(CARD_D), tmp = new Float32Array(CARD_D);
  for (const c of pals) { tmp.fill(0); cardVec(g, c, tmp, 0); for (let i = 0; i < CARD_D; i++) mx[i] = Math.max(mx[i], tmp[i]); }
  for (let i = 0; i < CARD_D; i++) out[o + i] = mx[i]; o += CARD_D;
  if (mine) { for (const c of p.hand) cardVec(g, c, out, o, 1 / 4); }
  o += CARD_D;
  // 战斗力最高的 6 只帕鲁（排序）：战斗力、打击力、竖置
  const top = pals.slice().sort((a, b) => g.power(b) - g.power(a)).slice(0, 6);
  for (let i = 0; i < 6; i++) { const c = top[i]; out[o++] = c ? g.power(c) / 1000 : 0; out[o++] = c ? g.strike(c) / 2 : 0; out[o++] = c ? (c.rested ? 0 : 1) : 0; }
  // 卡组剩余构成（自己知道自己卡组的构成；对手的卡组只能用已知的公开信息，这里不使用）
  if (mine) {
    const dk = p.deck; const n = Math.max(dk.length, 1);
    out[o++] = dk.filter(c => c.def.lucky).length / n; out[o++] = dk.filter(c => c.def.kind === 'pal').length / n;
    out[o++] = dk.reduce((a, c) => a + (c.def.cost || 0), 0) / n / 6; out[o++] = dk.reduce((a, c) => a + (c.def.power || 0), 0) / n / 1000;
  } else o += 4;
  return o;
}
const DIM = SIDE_D * 2 + 8;
function encode(g, pi) {
  const out = new Float32Array(DIM);
  let o = sideVec(g, pi, pi, out, 0);
  o = sideVec(g, 1 - pi, pi, out, o);
  out[o++] = g.active === pi ? 1 : 0; out[o++] = Math.min(g.turnNo, 20) / 20; out[o++] = g.isNight() ? 1 : 0;
  out[o++] = g.first === pi ? 1 : 0; const ph = g.phase; out[o++] = ph === 'main' ? 1 : 0; out[o++] = ph === 'end' ? 1 : 0;
  out[o++] = g.battle ? 1 : 0; out[o++] = 1; // bias
  return out;
}
module.exports = { encode, DIM, TAGS, KW };

} },
"/app/server/view.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 生成玩家视角的游戏状态（隐藏非公开信息）
const PHASE_CN = { setup: '准备', stand: '竖置阶段', draw: '抽卡阶段', soul: '灵魂阶段', main: '主要阶段', battle: '战斗', end: '结束阶段' };
const KW_CN = { brave: '勇敢', serious: '认真', interrupt: '妨碍', taunt: '嘲讽', stealth: '隐秘', assault: '袭击', nocturnal: '夜行性', vigilance: '警戒', breakthrough: '突破', retaliate: '复仇' };

function cardView(g, c, full) {
  const v = { uid: c.uid, id: c.id, owner: c.owner };
  if (c.zone === 'base') {
    Object.assign(v, { ctrl: c.ctrl, rested: c.rested, damage: c.damage, kind: c.def.kind });
    if (c.def.kind === 'pal' || c.def.kind === 'building') v.power = g.power(c);
    if (c.def.kind === 'pal') v.strike = g.strike(c);
    const k = g.kw(c); v.kw = Object.entries(k).filter(([n, x]) => x && KW_CN[n]).map(([n, x]) => KW_CN[n] + (typeof x === 'number' && (n === 'brave' || n === 'serious') ? x : (typeof x === 'number' && x > 1 ? '×' + x : '')));
    if (c.names.length) v.extraNames = c.names.map(n => (g.db._byJa[n] || {}).name);
    if (g.cantStand(c) || c.noStand.length) v.noStand = true;
  }
  return v;
}
function viewFor(g, me, opt = {}) {
  const op = 1 - me;
  const pv = (pi) => {
    const p = g.p[pi];
    return {
      name: p.name, life: p.life, material: p.material, ingredient: p.ingredient,
      souls: p.souls.length, soulsStanding: p.souls.filter(s => !s.rested).length, soulDeck: p.soulDeck,
      deck: p.deck.length, handCount: p.hand.length,
      hand: pi === me || opt.all ? p.hand.map(c => cardView(g, c)) : undefined,
      deckList: pi === me || opt.all ? p.deck.map(c => c.id).sort() : undefined,
      base: p.base.map(c => cardView(g, c)),
      grave: p.grave.map(c => ({ uid: c.uid, id: c.id })),
      exile: p.exile.map(c => ({ uid: c.uid, id: c.id })),
    };
  };
  const q = g.pending;
  let ask = null;
  if (q && q.player === me) {
    ask = { kind: q.kind, prompt: q.prompt, quick: !!q.quick, v: g.version };
    if (q.kind === 'main') ask.actions = q.actions.map(a => ({ t: a.t, uid: a.uid, label: a.label }));
    if (q.kind === 'option') { ask.options = q.options; if (q.meta) ask.meta = q.meta; }
    if (q.view) ask.view = q.view.map(u => { const c = g.findCard(u) || g.p.flatMap(p => p.deck).find(x => x.uid === u); return { uid: u, id: c ? c.id : null }; });
    if (q.kind === 'select') {
      ask.min = q.min; ask.max = q.max;
      ask.cands = q.cands.map(u => { const c = g.findCard(u) || g.p.flatMap(p => p.deck).find(x => x.uid === u); return { uid: u, id: c ? c.id : null, zone: c ? c.zone : null, owner: c ? c.owner : null }; });
    }
  }
  const B = g.battle;
  return {
    me, turn: g.turnNo, active: g.active, phase: PHASE_CN[g.phase] || g.phase, night: g.isNight(),
    players: [pv(me), pv(op)],
    battle: B ? { att: B.att.uid, target: B.target === 'player' ? 'player' : B.target.uid, blocked: B.blocked, failed: B.failed } : null,
    ask, waiting: q && q.player !== me ? g.p[q.player].name : null,
    reveals: (g.reveals || []).slice(-4), revealN: (g.reveals || []).length,
    log: g.log.slice(-60), logN: g.log.length, over: g.over, version: g.version,
  };
}
module.exports = { viewFor };

} },
"/app/server/accounts.js": { deps: {"fs":"fs","path":"path","crypto":"crypto"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 账号系统（零依赖）。所有账号数据存放在"版本无关"的数据目录中（默认 <仓库>/userdata，
// 可用环境变量 PTCG_DATA 指定），各版本服务器共用同一目录，升级版本不会丢失进度。
//   accounts/<uid>.json  { id, username, salt, hash, created, updated, data:{键:值}, rev }
//   sessions.json        { token: { uid, t } }
// data 为客户端同步的键值（卡组、对局历史、残局进度、收藏、偏好设置……），服务器按键合并，不解析其内容。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = process.env.PTCG_DATA || path.resolve(__dirname, '..', 'userdata');
const ACC = path.join(DATA, 'accounts');
const SESS = path.join(DATA, 'sessions.json');
fs.mkdirSync(ACC, { recursive: true });

const MAX_DATA = 4 * 1024 * 1024; // 单账号数据上限 4MB
const SESSION_TTL = 180 * 86400e3;  // 登录有效期 180 天

function writeAtomic(f, s) { const t = f + '.tmp' + process.pid; fs.writeFileSync(t, s); fs.renameSync(t, f); }
const uidOf = name => crypto.createHash('sha256').update(String(name).trim().toLowerCase()).digest('hex').slice(0, 20);
const accFile = uid => path.join(ACC, uid + '.json');
function load(uid) { try { return JSON.parse(fs.readFileSync(accFile(uid), 'utf8')); } catch (e) { return null; } }
function save(a) {
  const f = accFile(a.id);
  try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch (e) { }
  a.updated = Date.now(); writeAtomic(f, JSON.stringify(a));
}
// 多个版本的服务器可能同时运行并共用 sessions.json：读取时以磁盘为准，写入时先合并
const readSess = () => { try { return JSON.parse(fs.readFileSync(SESS, 'utf8')); } catch (e) { return {}; } };
let sessions = readSess(); const removed = new Set();
function saveSessions() {
  const now = Date.now(), disk = readSess();
  for (const k of removed) delete disk[k]; removed.clear();
  sessions = Object.assign(disk, sessions);
  for (const k in sessions) if (now - sessions[k].t > SESSION_TTL) delete sessions[k];
  writeAtomic(SESS, JSON.stringify(sessions));
}
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const pub = a => ({ id: a.id, username: a.username, created: a.created });

function newSession(a) { const tk = crypto.randomBytes(24).toString('hex'); sessions[tk] = { uid: a.id, t: Date.now() }; saveSessions(); return tk; }
function bySession(tk) {
  if (tk && !sessions[tk]) { const d = readSess(); if (d[tk]) sessions[tk] = d[tk]; }
  const s = tk && sessions[tk]; if (!s) return null;
  if (Date.now() - s.t > SESSION_TTL) { delete sessions[tk]; return null; }
  return load(s.uid);
}
function checkName(u) {
  u = String(u || '').trim();
  if (u.length < 2 || u.length > 16) return '用户名需 2~16 个字符';
  if (/[\s<>"'&\\/]/.test(u)) return '用户名不能包含空格或特殊符号';
  return null;
}
// 简单防爆破：同一用户名 10 分钟内失败 10 次即暂时锁定
const fails = new Map();
function tooMany(uid) { const f = fails.get(uid); return f && f.n >= 10 && Date.now() - f.t < 600e3; }
function fail(uid) { const f = fails.get(uid) || { n: 0, t: Date.now() }; if (Date.now() - f.t > 600e3) { f.n = 0; f.t = Date.now(); } f.n++; fails.set(uid, f); }

const api = {
  register({ username, password, data }) {
    const e = checkName(username); if (e) return [400, { error: e }];
    if (String(password || '').length < 4) return [400, { error: '密码至少 4 位' }];
    const uid = uidOf(username); if (load(uid)) return [409, { error: '该用户名已被注册' }];
    const salt = crypto.randomBytes(16).toString('hex');
    const a = { id: uid, username: String(username).trim(), salt, hash: hashPw(password, salt), created: Date.now(), data: {}, rev: 0 };
    if (data && typeof data === 'object') for (const [k, v] of Object.entries(data)) if (typeof v === 'string') a.data[k] = v;
    if (JSON.stringify(a.data).length > MAX_DATA) a.data = {};
    save(a);
    return [200, { token: newSession(a), user: pub(a), data: a.data, rev: a.rev }];
  },
  login({ username, password }) {
    const uid = uidOf(username || ''); if (tooMany(uid)) return [429, { error: '尝试次数过多，请 10 分钟后再试' }];
    const a = load(uid);
    if (!a || hashPw(password || '', a.salt) !== a.hash) { fail(uid); return [403, { error: '用户名或密码错误' }]; }
    fails.delete(uid);
    return [200, { token: newSession(a), user: pub(a), data: a.data, rev: a.rev }];
  },
  me(_, a) { return [200, { user: pub(a), data: a.data, rev: a.rev }]; },
  // patch: { 键: 字符串值 | null(删除) }
  data({ patch }, a) {
    if (!patch || typeof patch !== 'object') return [400, { error: '格式错误' }];
    for (const [k, v] of Object.entries(patch)) {
      if (!/^ptcg_[a-z0-9_]{1,40}$/.test(k)) continue;
      if (v === null) delete a.data[k]; else if (typeof v === 'string') a.data[k] = v;
    }
    if (JSON.stringify(a.data).length > MAX_DATA) return [413, { error: '账号数据过大' }];
    a.rev = (a.rev || 0) + 1; save(a);
    return [200, { ok: true, rev: a.rev }];
  },
  password({ old, password }, a) {
    if (hashPw(old || '', a.salt) !== a.hash) return [403, { error: '原密码错误' }];
    if (String(password || '').length < 4) return [400, { error: '新密码至少 4 位' }];
    a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hashPw(password, a.salt); save(a);
    return [200, { ok: true }];
  },
  logout(_, a, tk) { delete sessions[tk]; removed.add(tk); saveSessions(); return [200, { ok: true }]; },
};
const NEED_AUTH = new Set(['me', 'data', 'password', 'logout']);

// 处理 /api/account/<op>，返回 true 表示已处理
function handle(req, res, url, send) {
  const m = url.pathname.match(/^\/api\/account\/(\w+)$/); if (!m || !api[m[1]]) return false;
  const op = m[1];
  let body = '';
  req.on('data', d => { body += d; if (body.length > MAX_DATA * 1.5) req.destroy(); });
  req.on('end', () => {
    let j = {}; try { j = body ? JSON.parse(body) : {}; } catch (e) { return send(res, 400, JSON.stringify({ error: '格式错误' }), 'application/json; charset=utf-8'); }
    const tk = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let a = null;
    if (NEED_AUTH.has(op)) { a = bySession(tk); if (!a) return send(res, 401, JSON.stringify({ error: '登录已失效，请重新登录' }), 'application/json; charset=utf-8'); }
    let r; try { r = api[op](j, a, tk); } catch (e) { console.error(e); r = [500, { error: '服务器错误' }]; }
    send(res, r[0], JSON.stringify(r[1]), 'application/json; charset=utf-8');
  });
  return true;
}
module.exports = { handle, bySession, DATA };

} },
"/app/server/gp.js": { deps: {"fs":"fs","path":"path","crypto":"crypto","./engine":"/app/server/engine/index.js","./engine/decks":"/app/server/engine/decks.js","./accounts":"/app/server/accounts.js","./engine/presets":"/app/server/engine/presets.js"}, fn: function (module, exports, require, __dirname, __filename, process) {
'use strict';
// 大奖赛（Grand Prix）：随机 2 色 → 50 轮三选一组成 50 张卡组 → 连续挑战随机困难对手，累计 3 败结束。
// 数据存放在版本无关的数据目录 <DATA>/gp.json，各版本服务器共用；排行榜按单次挑战的最高胜场排名。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { db } = require('./engine');
const { randomDeck, validateDeck } = require('./engine/decks');
const Accounts = require('./accounts');

const FILE = path.join(Accounts.DATA, 'gp.json');
const PICKS = 50, MAX_LOSS = 3;
const COLORS = ['red', 'blue', 'green', 'purple'];
const CN = { red: '红', blue: '蓝', green: '绿', purple: '紫' };

let S = { runs: {}, board: [] };
function load() { try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); S.runs ||= {}; S.board ||= []; } catch (e) { if (e.code === 'ENOENT') S = { runs: {}, board: [] }; } }
function save() { const t = FILE + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, FILE); }
load();
// 多版本服务器共用文件：每次操作前重新读取
const fresh = () => load();

// 身份：已登录用账号 uid，否则用客户端 guest token
function who(tk, body) {
  const a = tk ? Accounts.bySession(tk) : null;
  if (a) return { owner: 'u:' + a.id, name: a.username, acct: true };
  const g = String(body.guest || '').replace(/[^\w]/g, '').slice(0, 40);
  if (!g) return null;
  return { owner: 'g:' + g, name: String(body.name || '玩家').slice(0, 16), acct: false };
}

// ---- 选牌 ----
const POOL_ALL = Object.values(db).filter(c => c.id && !c.id.startsWith('PR'));
function pool(colors) { return POOL_ALL.filter(c => !c.color || colors.includes(c.color)); }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function canAdd(deck, c) {
  const n = deck.filter(id => db[id].ja === c.ja).length;
  if (!c.anyNumber && n >= 4) return false;
  if (c.lucky && deck.filter(id => db[id].lucky).length >= 8) return false;
  return true;
}
// 生成 3 个候选：卡名互不相同；尽量覆盖不同种类，保证有帕鲁可选
function offer(run) {
  const R = rng(run.seed + run.deck.length * 7919);
  const P = pool(run.colors).filter(c => canAdd(run.deck, c));
  const pals = P.filter(c => c.kind === 'pal');
  const palCnt = run.deck.filter(id => db[id].kind === 'pal').length, left = PICKS - run.deck.length;
  const out = [];
  const pick = list => { const L = list.filter(c => !out.some(o => o.ja === c.ja)); if (!L.length) return; out.push(L[Math.floor(R() * L.length)]); };
  // 目标约 30~34 只帕鲁：缺口大时保证候选里有帕鲁，帕鲁过多时少给帕鲁
  const need = 30 - palCnt;
  if (need >= left - 2) { pick(pals); pick(pals); }
  else if (need > 0 && need >= left * 0.6) pick(pals);
  const pp = palCnt >= 36 ? 0.15 : palCnt >= 32 ? 0.35 : 0.5;
  const non = P.filter(c => c.kind !== 'pal');
  while (out.length < 3) { const before = out.length; pick(R() < pp ? pals : non.length ? non : P); if (out.length === before) pick(P); if (out.length === before) break; }
  return out.map(c => c.id);
}

// ---- 排行榜 ----
function boardRow(run) { return { run: run.id, owner: run.owner, name: run.name, acct: run.acct, wins: run.wins, losses: run.losses, colors: run.colors, status: run.status, t: run.updated }; }
function updateBoard(run) {
  S.board = S.board.filter(r => r.run !== run.id);
  if (run.status === 'draft') return;
  S.board.push(boardRow(run));
  // 每位玩家保留最好的 3 次 + 进行中的那次
  const by = {};
  for (const r of S.board) (by[r.owner] ||= []).push(r);
  S.board = Object.values(by).flatMap(l => l.sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.t - b.t).filter((r, i) => i < 3 || r.status === 'play'));
}
function leaderboard() {
  fresh();
  const best = {};
  for (const r of S.board) { const b = best[r.owner]; if (!b || r.wins > b.wins || (r.wins === b.wins && r.losses < b.losses)) best[r.owner] = r; }
  const top = Object.values(best).sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.t - b.t).slice(0, 100);
  const live = Object.values(S.runs).filter(r => r.status === 'play').length;
  const total = Object.keys(S.runs).length;
  return { top: top.map(({ owner, ...r }) => r), live, total };
}

const pubRun = r => r && ({ id: r.id, colors: r.colors, colorsCN: r.colors.map(c => CN[c]), deck: r.deck, offer: r.offer, wins: r.wins, losses: r.losses, maxLoss: MAX_LOSS, picks: PICKS, status: r.status, history: r.history, created: r.created, name: r.name });
function current(owner) { return Object.values(S.runs).filter(r => r.owner === owner && r.status !== 'over').sort((a, b) => b.created - a.created)[0] || null; }

const api = {
  state(b, me) { fresh(); return [200, { run: pubRun(current(me.owner)), board: leaderboard() }]; },
  start(b, me) {
    fresh();
    const old = current(me.owner); if (old) { old.status = 'over'; old.updated = Date.now(); updateBoard(old); }
    const cs = COLORS.slice().sort(() => Math.random() - .5).slice(0, 2).sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b));
    const run = { id: crypto.randomUUID(), owner: me.owner, name: me.name, acct: me.acct, colors: cs, seed: crypto.randomBytes(4).readUInt32LE(0), deck: [], offer: [], wins: 0, losses: 0, status: 'draft', history: [], created: Date.now(), updated: Date.now(), game: null };
    run.offer = offer(run);
    S.runs[run.id] = run; save();
    return [200, { run: pubRun(run) }];
  },
  pick(b, me) {
    fresh();
    const run = current(me.owner); if (!run || run.status !== 'draft') return [400, { error: '当前没有进行中的选牌' }];
    const id = run.offer[+b.i]; if (!id) return [400, { error: '无效的选择' }];
    run.deck.push(id); run.updated = Date.now();
    if (run.deck.length >= PICKS) {
      const e = validateDeck(run.deck); if (e.length) console.error('GP 卡组异常', e);
      run.status = 'play'; run.offer = []; updateBoard(run);
    } else run.offer = offer(run);
    save();
    return [200, { run: pubRun(run) }];
  },
  abandon(b, me) {
    fresh();
    const run = current(me.owner); if (!run) return [200, { run: null }];
    run.status = 'over'; run.updated = Date.now(); updateBoard(run); save();
    return [200, { run: null, ended: pubRun(run), board: leaderboard() }];
  },
};

function handle(req, res, url, send) {
  if (url.pathname === '/api/gp/board') { send(res, 200, JSON.stringify(leaderboard()), 'application/json; charset=utf-8'); return true; }
  const m = url.pathname.match(/^\/api\/gp\/(\w+)$/); if (!m || !api[m[1]]) return false;
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    let j = {}; try { j = body ? JSON.parse(body) : {}; } catch (e) { }
    const me = who((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), j); if (!me) return send(res, 400, JSON.stringify({ error: '缺少身份信息' }), 'application/json; charset=utf-8');
    let r; try { r = api[m[1]](j, me); } catch (e) { console.error(e); r = [500, { error: '服务器错误' }]; }
    send(res, r[0], JSON.stringify(r[1]), 'application/json; charset=utf-8');
  });
  return true;
}

// ---- 对局 ----
const OPP_NAMES = ['流浪驯兽师', '帕鲁猎人', '遗迹探险家', '雪山向导', '火山矿工', '沙漠商队', '樱岛剑士', '黑市商人', '帕鲁研究员', '塔主候补', '牧场主', '自由佣兵'];
// 由服务器发起下一场：返回 { deck, oppDeck, oppName } 或错误
function nextMatch(tk, body) {
  fresh();
  const me = who(tk, body); if (!me) return { error: '缺少身份信息' };
  const run = current(me.owner); if (!run || run.status !== 'play') return { error: '没有可进行的大奖赛' };
  // 上一场未结束（中途离开）按失败处理
  if (run.game) { settle(run.id, run.game, false, '中途离开'); return nextMatch(tk, body); }
  const { PRESETS } = require('./engine/presets');
  const n = run.wins + run.losses;
  const R = Math.random;
  let oppDeck, style;
  // 对手：精调预设 / 知名卡组 / 强力随机，随胜场增加更偏向强卡组
  const strong = PRESETS.filter(p => (p.wr || 0) >= 0.55), any = PRESETS;
  const x = R();
  if (x < 0.25 + Math.min(0.4, run.wins * 0.05)) { const p = strong[Math.floor(R() * strong.length)] || any[0]; oppDeck = p.cards; style = p.name; }
  else if (x < 0.75) { const p = any[Math.floor(R() * any.length)]; oppDeck = p.cards; style = p.name; }
  else { oppDeck = randomDeck(R, null, true); style = '强力随机卡组'; }
  const gameId = crypto.randomUUID();
  run.game = gameId; run.updated = Date.now(); save();
  return { run: run.id, gameId, deck: run.deck, oppDeck, oppName: `${OPP_NAMES[Math.floor(R() * OPP_NAMES.length)]}（第 ${n + 1} 战）`, style, owner: me.owner };
}
function settle(runId, gameId, won, why) {
  fresh();
  const run = S.runs[runId]; if (!run || run.game !== gameId) return null;
  run.game = null;
  if (won) run.wins++; else run.losses++;
  run.history.push({ w: won ? 1 : 0, why: why || '', t: Date.now() });
  if (run.losses >= MAX_LOSS) run.status = 'over';
  run.updated = Date.now(); updateBoard(run); save();
  return pubRun(run);
}

module.exports = { handle, nextMatch, settle, leaderboard, MAX_LOSS };

} },
"/app/public/emotes.js": { deps: {}, fn: function (module, exports, require, __dirname, __filename, process) {
// 对局表情 / 嘲讽语（客户端与服务器共用；服务器只接受下标，防止刷屏与注入）
(function (root) {
  const E = {
    emoji: ['👋', '😎', '😂', '🤡', '😭', '😡', '🤔', '🥱', '🫡', '👍', '🔥', '💀', '🎉', '💤', '🐧', '⚡'],
    taunt: [
      '你好！', '打得好！', 'GG', '再来一局！', '抱歉，手滑了', '谢谢！',
      '就这？', '这波我在第一层', '你的帕鲁在发抖哦', '思考时间有点长啊…', '快点吧，我的帕鲁要下班了',
      '这张卡你没想到吧', '帕鲁球已经准备好了', '谢谢你的帕鲁！', '运气也是实力的一部分', '下回合就结束了',
      '我差点就输了（并没有）', '你确定要这么打？', '企丸丸大军即将抵达', '在？看看幸运☆',
    ],
    // AI 的回应（下标指向 taunt / emoji）
    aiReply: { taunt: [1, 2, 6, 7, 8, 9, 13, 15, 16, 17], emoji: [1, 2, 3, 6, 7, 9, 13] },
  };
  if (typeof module !== 'undefined') module.exports = E; else root.EMOTES = E;
})(this);

} },
};
const __FILES__ = {
"/app/data/cards_base.json": "[\n{\n\"id\": \"BP01-001\",\n\"variants\": [\n\"BP01-001\",\n\"BP01-001OSR\",\n\"BP01-001SSP\",\n\"PR-009\"\n],\n\"imgs\": [\n\"BP01/BP01-001.png\",\n\"BP01/BP01-001OSR.png\",\n\"BP01/BP01-001SSP.png\",\n\"PR/PR-009.png\"\n],\n\"ja\": \"荒ぶる溶岩竜 – アグニドラ\",\n\"en\": \"Jormuntide Ignis – Savage Lava Dragon\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"火\",\n\"龙\"\n],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 8,\n\"power\": 1700,\n\"strike\": 4,\n\"quick\": false,\n\"main\": \"腾炎龙\",\n\"text_ja\": \"【起】【ターン１回】［③］または［手札を２枚捨てる］このカードをスタンドする。\",\n\"flavor\": \"二撃滅殺。\"\n},\n{\n\"id\": \"BP01-002\",\n\"variants\": [\n\"BP01-002\",\n\"BP01-002OSR\",\n\"BP01-002SP\"\n],\n\"imgs\": [\n\"BP01/BP01-002.png\",\n\"BP01/BP01-002OSR.png\",\n\"BP01/BP01-002SP.png\"\n],\n\"ja\": \"業火の翼 – スザク\",\n\"en\": \"Suzaku – Hellfire Wings\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 7,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"朱雀\",\n\"text_ja\": \"【永】あなたの赤のカードがパルにバトルダメージ以外の【ダメージ】を与える際、かわりに＋200した【ダメージ】を与える(自分の能力も強化する)。\\n【自】【登場時】パルを１枚まで選び、700【ダメージ】。\",\n\"flavor\": \"紅の翼は風を起こし、風は業火を呼ぶだろう。\"\n},\n{\n\"id\": \"BP01-003\",\n\"variants\": [\n\"BP01-003\",\n\"BP01-003SR\"\n],\n\"imgs\": [\n\"BP01/BP01-003.png\",\n\"BP01/BP01-003SR.png\"\n],\n\"ja\": \"赤い怒りんぼ – シャーマンダー\",\n\"en\": \"Gobfin Ignis – Blazing Hothead\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 4,\n\"power\": 400,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"红小鲨\",\n\"text_ja\": \"【永】あなたの他の赤のパルすべての【戦闘力】＋300。\",\n\"flavor\": \"煮えたぎる怒りは力となる。\"\n},\n{\n\"id\": \"BP01-004\",\n\"variants\": [\n\"BP01-004\",\n\"BP01-004SR\"\n],\n\"imgs\": [\n\"BP01/BP01-004.png\",\n\"BP01/BP01-004SR.png\"\n],\n\"ja\": \"刹那の刃 – ツジギリ\",\n\"en\": \"Bushi – Ephemeral Blade\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 800,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"浪刃武士\",\n\"text_ja\": \"【自】このカードがアタックしたバトル終了時、このカードを手札に戻してよい。\\n【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"気づけるのは、斬られたという事実だけ。\"\n},\n{\n\"id\": \"BP01-005\",\n\"variants\": [\n\"BP01-005\",\n\"BP01-005SR\"\n],\n\"imgs\": [\n\"BP01/BP01-005.png\",\n\"BP01/BP01-005SR.png\"\n],\n\"ja\": \"鉱石の暴食獣 – ボルカノン\",\n\"en\": \"Reptyro – Ore Gorger\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\",\n\"地\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 8,\n\"power\": 1500,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"熔岩兽\",\n\"text_ja\": \"【自】【登場時】【素材】を３個得る。\\n【起】【ターン１回】［【素材】を３個消費］あなたの山札を上から５枚見て、◇８以下のギアを１枚まで選んで登場させ、残りのカードと山札を切る。\",\n\"flavor\": \"鉱山には膨大な力が眠っている。その獣は鉱山を貪る。\"\n},\n{\n\"id\": \"BP01-006\",\n\"variants\": [\n\"BP01-006\",\n\"BP01-006SR\",\n\"PR-011\"\n],\n\"imgs\": [\n\"BP01/BP01-006.png\",\n\"BP01/BP01-006SR.png\",\n\"PR/PR-011.png\"\n],\n\"ja\": \"勇気のともし火 – キツネビ\",\n\"en\": \"Foxparks – Light of Courage\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"火绒狐\",\n\"text_ja\": \"【自】勇敢300（【アタック時】ターン終了時まで、このカードの【戦闘力】＋300）\",\n\"flavor\": \"暗闇に包まれても、そのともし火が勇気をくれる。\"\n},\n{\n\"id\": \"BP01-007\",\n\"variants\": [\n\"BP01-007\",\n\"BP01-007SR\"\n],\n\"imgs\": [\n\"BP01/BP01-007.png\",\n\"BP01/BP01-007SR.png\"\n],\n\"ja\": \"竜を穿つ牙 – シラヌイ\",\n\"en\": \"Kitsun – Wyrmbane Fangs\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 5,\n\"power\": 400,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"苍焰狼\",\n\"text_ja\": \"【自】【登場時】◇７以上のパルを１枚まで選び、1200【ダメージ】。\",\n\"flavor\": \"一火が分かれて両火となり、不知火の牙は竜をも穿つ。\"\n},\n{\n\"id\": \"BP01-008\",\n\"variants\": [\n\"BP01-008\"\n],\n\"imgs\": [\n\"BP01/BP01-008.png\"\n],\n\"ja\": \"触るな危険 – ボルトラ\",\n\"en\": \"Sparkit – Hazardous Contact\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\",\n\"制造\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"伏特喵\",\n\"text_ja\": \"【自】【登場時】スタンド状態のパルを１枚まで選び、500【ダメージ】。\",\n\"flavor\": \"乾燥してる日は、いつもぴりぴり。\"\n},\n{\n\"id\": \"BP01-009\",\n\"variants\": [\n\"BP01-009\"\n],\n\"imgs\": [\n\"BP01/BP01-009.png\"\n],\n\"ja\": \"勇猛迅雷 – ライコーン\",\n\"en\": \"Univolt – Valiant Thunderclap\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\",\n\"资源\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"雷角马\",\n\"text_ja\": \"【自】勇敢300（【アタック時】ターン終了時まで、このカードの【戦闘力】＋300）\",\n\"flavor\": \"勇猛なること、迅雷のごとし。\"\n},\n{\n\"id\": \"BP01-010\",\n\"variants\": [\n\"BP01-010\"\n],\n\"imgs\": [\n\"BP01/BP01-010.png\"\n],\n\"ja\": \"炎撃の翼 – イグニクス\",\n\"en\": \"Ragnahawk – Emberwing Striker\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 1000,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"燧火鸟\",\n\"text_ja\": \"【自】【アタック時】あなたの赤のパルをすべて選び、ターン終了時まで、【戦闘力】＋500/【打撃力】＋１。\",\n\"flavor\": \"炎撃の翼は、自軍の勝利を約束する。\"\n},\n{\n\"id\": \"BP01-011\",\n\"variants\": [\n\"BP01-011\"\n],\n\"imgs\": [\n\"BP01/BP01-011.png\"\n],\n\"ja\": \"健気な種火 – ヒノコジカ\",\n\"en\": \"Rooby – Brave Sparks\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"燎火鹿\",\n\"text_ja\": \"【自】まじめ400（【アサイン時】パルを１枚選び、ターン終了時まで、【戦闘力】＋400）\",\n\"flavor\": \"１日１本、枝を焼いた炭を食べるのが健康の秘訣。\"\n},\n{\n\"id\": \"BP01-012\",\n\"variants\": [\n\"BP01-012\",\n\"PR-001\",\n\"PR-001S\"\n],\n\"imgs\": [\n\"BP01/BP01-012.png\",\n\"PR/PR-001.png\",\n\"PR/PR-001S.png\"\n],\n\"ja\": \"灼熱のナミダ – ラヴィ\",\n\"en\": \"Flambelle – Scorching Tears\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"融焰娘\",\n\"text_ja\": \"【自】【登場時】【素材】を２個得る。\",\n\"flavor\": \"流れる涙は灼熱のマグマ。涙の数だけ強くなる。\"\n},\n{\n\"id\": \"BP01-013\",\n\"variants\": [\n\"BP01-013\"\n],\n\"imgs\": [\n\"BP01/BP01-013.png\"\n],\n\"ja\": \"烈火の優駿 – サラブレイズ\",\n\"en\": \"Pyrin – Cinder Steed\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 1200,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"火麒麟\",\n\"text_ja\": \"\",\n\"flavor\": \"誰かが乗ると、火傷しないよう気を利かせる。\"\n},\n{\n\"id\": \"BP01-014\",\n\"variants\": [\n\"BP01-014\",\n\"PR-002\",\n\"PR-002S\"\n],\n\"imgs\": [\n\"BP01/BP01-014.png\",\n\"PR/PR-002.png\",\n\"PR/PR-002S.png\"\n],\n\"ja\": \"立ちはだかる獄炎 – ゴクエンオ\",\n\"en\": \"Blazehowl – Hellflame Defender\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 7,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": true,\n\"main\": \"狱焰王\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"灼熱のツメを恐れよ。立ちはだかるは獄炎の獅子。\"\n},\n{\n\"id\": \"BP01-015\",\n\"variants\": [\n\"BP01-015\",\n\"BP01-015SP\"\n],\n\"imgs\": [\n\"BP01/BP01-015.png\",\n\"BP01/BP01-015SP.png\"\n],\n\"ja\": \"設置型マシンガン\",\n\"en\": \"Mounted Machine Gun\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 4,\n\"power\": 1000,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【素材】をX個消費、パルを１枚アサイン］〈パルを１枚選び、500【ダメージ】。〉をX回行う。\",\n\"flavor\": \"銃架を用いた連続射撃が、襲撃者たちを薙ぎ払う。\"\n},\n{\n\"id\": \"BP01-016\",\n\"variants\": [\n\"BP01-016\"\n],\n\"imgs\": [\n\"BP01/BP01-016.png\"\n],\n\"ja\": \"原始的な炉\",\n\"en\": \"Primitive Furnace\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 2,\n\"power\": 800,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］【素材】を３個得て、１枚引く。\\n【起】【ターン１回】［【素材】をX個消費］ターン終了時まで、あなたが次に手札からギアをプレイするためのコストはX減る。この能力で◇０以下にはならない。\",\n\"flavor\": \"原始的だけど、木炭や金属のインゴットが作れる。\"\n},\n{\n\"id\": \"BP01-017\",\n\"variants\": [\n\"BP01-017\"\n],\n\"imgs\": [\n\"BP01/BP01-017.png\"\n],\n\"ja\": \"聖火台\",\n\"en\": \"Flame Cauldron\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 2,\n\"power\": 900,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【永】あなたの赤のパルすべての【戦闘力】＋200。\\n【自】あなたの赤のパルが登場した時、【素材】を１個得る。\",\n\"flavor\": \"灯すと、正々堂々戦いそうな雰囲気になるらしい。\"\n},\n{\n\"id\": \"BP01-018\",\n\"variants\": [\n\"BP01-018\"\n],\n\"imgs\": [\n\"BP01/BP01-018.png\"\n],\n\"ja\": \"警鐘\",\n\"en\": \"Alarm Bell\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［①、パルを１枚アサイン］そのターンにアサインしたパルをすべてスタンドする。ターン終了時まで、あなたはパルでアサインできず、可能な限りアタックする（この能力を発動した後に登場したパルも含む）。\",\n\"flavor\": \"鐘が鳴り響けば、パルたちは武器を持って立ち上がる。\"\n},\n{\n\"id\": \"BP01-019\",\n\"variants\": [\n\"BP01-019\",\n\"BP01-019SR\"\n],\n\"imgs\": [\n\"BP01/BP01-019.png\",\n\"BP01/BP01-019SR.png\"\n],\n\"ja\": \"キツネビのハーネス\",\n\"en\": \"Foxparks' Harness\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。それのメインネームが《キツネビ》なら、ターン終了時まで、〈〉内の能力を与える。〈【自】【アタック時】パルを１枚まで選び、700【ダメージ】〉。\\n\",\n\"flavor\": \"抱っこ用ハーネス。あなたのキツネビも火炎放射器。\"\n},\n{\n\"id\": \"BP01-020\",\n\"variants\": [\n\"BP01-020\",\n\"BP01-020SR\"\n],\n\"imgs\": [\n\"BP01/BP01-020.png\",\n\"BP01/BP01-020SR.png\"\n],\n\"ja\": \"ポンプ式ショットガン\",\n\"en\": \"Pump-Action Shotgun\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 7,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】相手のパルをすべて選び、1200【ダメージ】。\\n【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。\",\n\"flavor\": \"連射性能の高いショットガン。ハンドグリップを前後させることで次弾を装填できる。\"\n},\n{\n\"id\": \"BP01-021\",\n\"variants\": [\n\"BP01-021\"\n],\n\"imgs\": [\n\"BP01/BP01-021.png\"\n],\n\"ja\": \"ジャンクハンドガン\",\n\"en\": \"Makeshift Handgun\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、500【ダメージ】。\\n【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。\",\n\"flavor\": \"ガラクタで手作りされた銃。性能はあまり高くない。\"\n},\n{\n\"id\": \"BP01-022\",\n\"variants\": [\n\"BP01-022\"\n],\n\"imgs\": [\n\"BP01/BP01-022.png\"\n],\n\"ja\": \"石のつるはし\",\n\"en\": \"Stone Pickaxe\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200し、【素材】を１個得る。\",\n\"flavor\": \"文明は石の道具から始まる。\"\n},\n{\n\"id\": \"BP01-023\",\n\"variants\": [\n\"BP01-023\",\n\"BP01-023OSR\",\n\"BP01-023SP\"\n],\n\"imgs\": [\n\"BP01/BP01-023.png\",\n\"BP01/BP01-023OSR.png\",\n\"BP01/BP01-023SP.png\"\n],\n\"ja\": \"アクセルの作戦\",\n\"en\": \"Axel's Strategy\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"以下から１つ選ぶ。\\n・パルを１枚選び、1500【ダメージ】。\\n・パルをX枚まで選び、スタンドする。Xはあなたのギアの数。\\n・相手の◇５以上のパルをすべて選び、ターン終了時まで、それらはブロックできない。\",\n\"flavor\": \"真の強者は、細かいことに動じない。\"\n},\n{\n\"id\": \"BP01-024\",\n\"variants\": [\n\"BP01-024\",\n\"PR-012\"\n],\n\"imgs\": [\n\"BP01/BP01-024.png\",\n\"PR/PR-012.png\"\n],\n\"ja\": \"宝箱発見！\",\n\"en\": \"Treasure Chest Found!\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"あなたの山札を上から５枚見て、赤の建築物か、赤のギアを１枚まで選んで手札に加え、残りのカードと山札を切る。０枚選んだ時、【素材】を３個得る。\",\n\"flavor\": \"貴重な素材？ 武器の設計図？ レアなお宝だといいな！\"\n},\n{\n\"id\": \"BP01-025\",\n\"variants\": [\n\"BP01-025\",\n\"BP01-025OSR\",\n\"BP01-025SSP\"\n],\n\"imgs\": [\n\"BP01/BP01-025.png\",\n\"BP01/BP01-025OSR.png\",\n\"BP01/BP01-025SSP.png\"\n],\n\"ja\": \"竜を呼ぶ声 – オコチョ\",\n\"en\": \"Chillet – Dragon Whisperer\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"冰\",\n\"龙\"\n],\n\"apts\": [\n\"冷却\",\n\"农耕\"\n],\n\"cost\": 5,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"疾旋鼬\",\n\"text_ja\": \"【自】【登場時】あなたの山札を上から１枚公開し、それが◇８以下の【竜】のパルなら、登場させてよい。登場させないなら、手札に加える。\",\n\"flavor\": \"にょろにょろイタチは竜と仲良し。\"\n},\n{\n\"id\": \"BP01-026\",\n\"variants\": [\n\"BP01-026\",\n\"BP01-026OSR\",\n\"BP01-026SP\"\n],\n\"imgs\": [\n\"BP01/BP01-026.png\",\n\"BP01/BP01-026OSR.png\",\n\"BP01/BP01-026SP.png\"\n],\n\"ja\": \"ペコペコガンナー – ペコドン\",\n\"en\": \"Relaxaurus – Hungry Gunner\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\",\n\"搬运\"\n],\n\"cost\": 7,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"佩克龙\",\n\"text_ja\": \"【自】【登場時】◇６以下のパルを１枚まで選び、レストする。このカードが拠点にいる限り、それはスタンドしない。\",\n\"flavor\": \"気の抜けた外見。乱射される体験。\"\n},\n{\n\"id\": \"BP01-027\",\n\"variants\": [\n\"BP01-027\",\n\"BP01-027OSR\",\n\"BP01-027SP\"\n],\n\"imgs\": [\n\"BP01/BP01-027.png\",\n\"BP01/BP01-027OSR.png\",\n\"BP01/BP01-027SP.png\"\n],\n\"ja\": \"逆巻く海竜 – レヴィドラ\",\n\"en\": \"Jormuntide – Surging Sea Serpent\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 8,\n\"power\": 1600,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"覆海龙\",\n\"text_ja\": \"【自】【登場時】１枚引き、◇７以下のパルを１枚まで選び、レストする。それは次の相手のスタンドフェイズ中、スタンドしない。\",\n\"flavor\": \"逆巻く海から生還する者は少ない。生還した後、故郷が残っている者はもっと少ない。\"\n},\n{\n\"id\": \"BP01-028\",\n\"variants\": [\n\"BP01-028\",\n\"BP01-028SR\",\n\"PR-013\"\n],\n\"imgs\": [\n\"BP01/BP01-028.png\",\n\"BP01/BP01-028SR.png\",\n\"PR/PR-013.png\"\n],\n\"ja\": \"空への憧れ – ペンタマ\",\n\"en\": \"Pengullet – Yearning for the Sky\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"冰\"\n],\n\"apts\": [\n\"冷却\",\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"企丸丸\",\n\"text_ja\": \"【自】このカードが墓地に置かれた時、１枚引く。\",\n\"flavor\": \"それは、遺伝子に刻まれた空への未練。\"\n},\n{\n\"id\": \"BP01-029\",\n\"variants\": [\n\"BP01-029\",\n\"BP01-029SR\"\n],\n\"imgs\": [\n\"BP01/BP01-029.png\",\n\"BP01/BP01-029SR.png\"\n],\n\"ja\": \"水竜の舞 – アズレーン\",\n\"en\": \"Azurobe – Water Dragon Waltz\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 6,\n\"power\": 1200,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"碧海龙\",\n\"text_ja\": \"【自】【登場時】１枚引き、パルを１枚まで選び、レストする。\",\n\"flavor\": \"水は自然の怒りであり、祝福である。\"\n},\n{\n\"id\": \"BP01-030\",\n\"variants\": [\n\"BP01-030\",\n\"BP01-030SR\"\n],\n\"imgs\": [\n\"BP01/BP01-030.png\",\n\"BP01/BP01-030SR.png\"\n],\n\"ja\": \"氷塊の暴食獣 – フロスカノン\",\n\"en\": \"Reptyro Cryst – Glacial Devourer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\",\n\"地\"\n],\n\"apts\": [\n\"冷却\",\n\"资源\"\n],\n\"cost\": 8,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"寒霜兽\",\n\"text_ja\": \"【自】【登場時】１枚引く。\\n【起】【ターン１回】［手札を１枚捨てる］あなたの山札を上から５枚見て、◇６以下の建築物を２枚まで選んで登場させ、残りのカードと山札を切る。\",\n\"flavor\": \"氷山には叡智が眠っている。その獣は氷山を貪る。\"\n},\n{\n\"id\": \"BP01-031\",\n\"variants\": [\n\"BP01-031\",\n\"BP01-031SR\"\n],\n\"imgs\": [\n\"BP01/BP01-031.png\",\n\"BP01/BP01-031SR.png\"\n],\n\"ja\": \"大海原の大戦士 – キャプペン\",\n\"en\": \"Penking – Mighty Warrior of the Deep\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"冰\"\n],\n\"apts\": [\n\"冷却\",\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"企丸王\",\n\"text_ja\": \"【永】あなたのメインネームが《ペンタマ》のパルすべての【戦闘力】＋700。\",\n\"flavor\": \"実はペンタマとは関係ないが、なぜかちやほやされている。\"\n},\n{\n\"id\": \"BP01-032\",\n\"variants\": [\n\"BP01-032\",\n\"PR-003\",\n\"PR-003S\"\n],\n\"imgs\": [\n\"BP01/BP01-032.png\",\n\"PR/PR-003.png\",\n\"PR/PR-003S.png\"\n],\n\"ja\": \"ノリノリサーファー – カモノスケ\",\n\"en\": \"Fuack – Manic Wave Ripper\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"冲浪鸭\",\n\"text_ja\": \"【自】このカードがアタックされた時、ターン終了時まで、このカードの【戦闘力】＋300。\",\n\"flavor\": \"とりあえず波に乗ってから考える。\"\n},\n{\n\"id\": \"BP01-033\",\n\"variants\": [\n\"BP01-033\"\n],\n\"imgs\": [\n\"BP01/BP01-033.png\"\n],\n\"ja\": \"雪山の番人 – ヒエティ\",\n\"en\": \"Wumpo – Frostpeak Sentinel\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"冷却\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 7,\n\"power\": 1500,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"白绒雪怪\",\n\"text_ja\": \"【永】このカードがレスト状態なら、相手のパルすべての【打撃力】－１。\",\n\"flavor\": \"雪山を守る巨大な番人。毛の中身は秘密だ。\"\n},\n{\n\"id\": \"BP01-034\",\n\"variants\": [\n\"BP01-034\"\n],\n\"imgs\": [\n\"BP01/BP01-034.png\"\n],\n\"ja\": \"降り注ぐ元気 – チョロゾウ\",\n\"en\": \"Teafant – Fountain of Cheer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\"\n],\n\"apts\": [\n\"农耕\",\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"壶小象\",\n\"text_ja\": \"【自】まじめ400（【アサイン時】パルを１枚選び、ターン終了時まで、【戦闘力】＋400）\",\n\"flavor\": \"癒しのシャワーは、拠点の植物たちにも元気をくれる。\"\n},\n{\n\"id\": \"BP01-035\",\n\"variants\": [\n\"BP01-035\"\n],\n\"imgs\": [\n\"BP01/BP01-035.png\"\n],\n\"ja\": \"金運招来 – チルテト\",\n\"en\": \"Mau Cryst – Harbinger of Riches\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"冷却\",\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"冰丝特\",\n\"text_ja\": \"【自】このカードが「牧場」の建築物にアサインした時、１枚引く。\",\n\"flavor\": \"牧場にいるだけで、金運を上げてくれるらしい。\"\n},\n{\n\"id\": \"BP01-036\",\n\"variants\": [\n\"BP01-036\"\n],\n\"imgs\": [\n\"BP01/BP01-036.png\"\n],\n\"ja\": \"くるりと宙返り – ルミカイト\",\n\"en\": \"Celaray – Loop De Loop\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\"\n],\n\"apts\": [\n\"农耕\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"鲁米儿\",\n\"text_ja\": \"【自】【アタック時】１枚引き、あなたの手札を１枚選び、捨てる。\",\n\"flavor\": \"宙返りをひとつ。天と地と、世界のすべてを一巡り。\"\n},\n{\n\"id\": \"BP01-037\",\n\"variants\": [\n\"BP01-037\"\n],\n\"imgs\": [\n\"BP01/BP01-037.png\"\n],\n\"ja\": \"スイスイスイマー – シーペント\",\n\"en\": \"Surfent – Swift Swimmer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\"\n],\n\"apts\": [\n\"农耕\",\n\"牧场\"\n],\n\"cost\": 4,\n\"power\": 700,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"滑水蛇\",\n\"text_ja\": \"\",\n\"flavor\": \"流線形のフォルムは、水上活動に適している。\"\n},\n{\n\"id\": \"BP01-038\",\n\"variants\": [\n\"BP01-038\",\n\"PR-004\",\n\"PR-004S\"\n],\n\"imgs\": [\n\"BP01/BP01-038.png\",\n\"PR/PR-004.png\",\n\"PR/PR-004S.png\"\n],\n\"ja\": \"凍てつく試練 – ツンドラー\",\n\"en\": \"Cryolinx – Arctic Ordeal\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"冷却\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"冰棘兽\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"険しい山岳に現れる、凍てつく試練。\"\n},\n{\n\"id\": \"BP01-039\",\n\"variants\": [\n\"BP01-039\",\n\"BP01-039SR\"\n],\n\"imgs\": [\n\"BP01/BP01-039.png\",\n\"BP01/BP01-039SR.png\"\n],\n\"ja\": \"アンティークなカーテン\",\n\"en\": \"Antique Curtain\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 5,\n\"power\": 1400,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】相手のパルをX枚まで選び、手札に戻す。Xは、あなたのカード名に《アンティーク》を含む建築物の、異なるカード名の数（たとえば、すでに《アンティークな鏡》が４枚ある状態で、《アンティークなカーテン》を出すと、２枚まで戻せる）。\",\n\"flavor\": \"由緒あるカーテン。部屋の印象ががらりと変わる。\"\n},\n{\n\"id\": \"BP01-040\",\n\"variants\": [\n\"BP01-040\"\n],\n\"imgs\": [\n\"BP01/BP01-040.png\"\n],\n\"ja\": \"アンティークなドレッサー\",\n\"en\": \"Antique Dresser\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": 1400,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［手札を１枚捨てる］カード名を１つ宣言する。あなたのカードをすべて選び、ターン終了時まで、それらに宣言したカード名を追加する。\\n【起】【ターン１回】［手札をX枚捨てる］あなたのパルをX枚選び、ターン終了時まで、【戦闘力】＋1000/【打撃力】＋１。\",\n\"flavor\": \"由緒あるドレッサー。自分の姿を見直すチャンス。\"\n},\n{\n\"id\": \"BP01-041\",\n\"variants\": [\n\"BP01-041\"\n],\n\"imgs\": [\n\"BP01/BP01-041.png\"\n],\n\"ja\": \"温泉\",\n\"en\": \"Hot Spring\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 6,\n\"power\": 1000,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］◇６以下のパルを２枚まで選び、レストする。それらは次の相手のスタンドフェイズ中、スタンドしない。\",\n\"flavor\": \"みんなで入れば効果も倍増。\"\n},\n{\n\"id\": \"BP01-042\",\n\"variants\": [\n\"BP01-042\"\n],\n\"imgs\": [\n\"BP01/BP01-042.png\"\n],\n\"ja\": \"アンティークな鏡\",\n\"en\": \"Antique Mirror\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 1,\n\"power\": 1000,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】１枚引く。\",\n\"flavor\": \"由緒ある鏡。出かける前に身だしなみ。\"\n},\n{\n\"id\": \"BP01-043\",\n\"variants\": [\n\"BP01-043\"\n],\n\"imgs\": [\n\"BP01/BP01-043.png\"\n],\n\"ja\": \"スフィア製作台\",\n\"en\": \"Sphere Workbench\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 2,\n\"power\": 900,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］２枚引き、あなたの手札を１枚選び、捨てる。\",\n\"flavor\": \"メガとか、ギガとか。いい感じのスフィアが作れる。\"\n},\n{\n\"id\": \"BP01-044\",\n\"variants\": [\n\"BP01-044\",\n\"BP01-044SR\"\n],\n\"imgs\": [\n\"BP01/BP01-044.png\",\n\"BP01/BP01-044SR.png\"\n],\n\"ja\": \"ペンタマのロケットランチャー\",\n\"en\": \"Pengullet Rocket Launcher\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。それのメインネームが《ペンタマ》なら、かわりに【戦闘力】＋500し、ターン終了時まで〈〉内の能力を与える。〈【起】［このカードをレスト］相手のパルをすべて選び、X【ダメージ】。Xはこのカードの【戦闘力】。このカードを墓地に置く〉。\",\n\"flavor\": \"ペンタマを天高く飛ばせてくれる砲筒。\"\n},\n{\n\"id\": \"BP01-045\",\n\"variants\": [\n\"BP01-045\"\n],\n\"imgs\": [\n\"BP01/BP01-045.png\"\n],\n\"ja\": \"グラップリングガン\",\n\"en\": \"Grappling Gun\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 5,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200し、〈〉内の能力を与える。〈【自】警戒（あなたのターン終了時、このカードをスタンドする）〉。\",\n\"flavor\": \"目的地を狙い撃って、自分を射撃地点まで引っ張れる。\"\n},\n{\n\"id\": \"BP01-046\",\n\"variants\": [\n\"BP01-046\",\n\"BP01-046OSR\",\n\"BP01-046SP\"\n],\n\"imgs\": [\n\"BP01/BP01-046.png\",\n\"BP01/BP01-046OSR.png\",\n\"BP01/BP01-046SP.png\"\n],\n\"ja\": \"ヴィクターの作戦\",\n\"en\": \"Victor's Strategy\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"以下から１つ選ぶ。\\n・あなたの山札を上から５枚見て、カードを１枚選んで手札に加え、残りのカードと山札を切る。\\n・パルを１枚選び、手札に戻す。\\n・X枚引く。Xはあなたの建築物の数。\",\n\"flavor\": \"すべては、最強のパルを創り出すために。\"\n},\n{\n\"id\": \"BP01-047\",\n\"variants\": [\n\"BP01-047\",\n\"BP01-047SR\"\n],\n\"imgs\": [\n\"BP01/BP01-047.png\",\n\"BP01/BP01-047SR.png\"\n],\n\"ja\": \"パルスフィア\",\n\"en\": \"Pal Sphere\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"３枚引く。\",\n\"flavor\": \"パルはきっと君を助けてくれる。\"\n},\n{\n\"id\": \"BP01-048\",\n\"variants\": [\n\"BP01-048\"\n],\n\"imgs\": [\n\"BP01/BP01-048.png\"\n],\n\"ja\": \"オーロラの導き\",\n\"en\": \"Aurora Guide\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": true,\n\"main\": null,\n\"text_ja\": \"１枚引き、あなたの手札を１枚まで選び、山札の上に置く。\",\n\"flavor\": \"太陽風と地球の磁場が、天空に未来を描き出す。\"\n},\n{\n\"id\": \"BP01-049\",\n\"variants\": [\n\"BP01-049\",\n\"BP01-049OSR\",\n\"BP01-049SSP\"\n],\n\"imgs\": [\n\"BP01/BP01-049.png\",\n\"BP01/BP01-049OSR.png\",\n\"BP01/BP01-049SSP.png\"\n],\n\"ja\": \"女神の祝福 – リリクイン\",\n\"en\": \"Lyleen – Blessing of the Goddess\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\"\n],\n\"cost\": 7,\n\"power\": 900,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"百合女王\",\n\"text_ja\": \"【自】【登場時】【食材】を３個得る。\\n【起】【ターン１回】［【食材】を３個消費］あなたの山札を上から５枚見て、◇６以下のパルを１枚まで選んで登場させ、残りのカードと山札を切る。\",\n\"flavor\": \"みなしごパルの面倒を見る優しいパル。しつけは全力のソーラーブラスト。\"\n},\n{\n\"id\": \"BP01-050\",\n\"variants\": [\n\"BP01-050\",\n\"BP01-050OSR\",\n\"BP01-050SP\"\n],\n\"imgs\": [\n\"BP01/BP01-050.png\",\n\"BP01/BP01-050OSR.png\",\n\"BP01/BP01-050SP.png\"\n],\n\"ja\": \"轟く剛矛 – ドリタス\",\n\"en\": \"Digtoise – Seismic Drillback\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"地\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"碎岩龟\",\n\"text_ja\": \"【永】あなたのソウルが10枚以上なら、このカードの【戦闘力】＋1000/【打撃力】＋１。\\n【起】【ターン１回】［【食材】を２個消費］ターン終了時まで、このカードの【戦闘力】＋500し、〈〉内の能力を得る。〈【自】突破（このカードのアタック中にバトル相手のパルが墓地に置かれた時、相手プレイヤーにも【ダメージ】）〉。\",\n\"flavor\": \"甲羅と牙は、矛盾を考察する最高の教材だ。\"\n},\n{\n\"id\": \"BP01-051\",\n\"variants\": [\n\"BP01-051\",\n\"BP01-051OSR\",\n\"BP01-051SP\"\n],\n\"imgs\": [\n\"BP01/BP01-051.png\",\n\"BP01/BP01-051OSR.png\",\n\"BP01/BP01-051SP.png\"\n],\n\"ja\": \"甘い祝福 – フラリーナ\",\n\"en\": \"Petallia – Sweet Blessings\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 700,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"花丽娜\",\n\"text_ja\": \"【自】【登場時】ライフを１得て、ソウルを２枚選び、スタンドする。\",\n\"flavor\": \"花精霊の祝福は、優しく甘い匂いがする。\"\n},\n{\n\"id\": \"BP01-052\",\n\"variants\": [\n\"BP01-052\",\n\"BP01-052SR\"\n],\n\"imgs\": [\n\"BP01/BP01-052.png\",\n\"BP01/BP01-052SR.png\"\n],\n\"ja\": \"猪突粉砕 – イノボウ\",\n\"en\": \"Rushoar – Reckless Destruction\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"地\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"草莽猪\",\n\"text_ja\": \"【自】このカードが建築物にアタックした時、ターン終了時まで、このカードの【戦闘力】＋800。\",\n\"flavor\": \"その突撃は岩すら砕く。それが建築物でも変わらない。\"\n},\n{\n\"id\": \"BP01-053\",\n\"variants\": [\n\"BP01-053\",\n\"BP01-053SR\"\n],\n\"imgs\": [\n\"BP01/BP01-053.png\",\n\"BP01/BP01-053SR.png\"\n],\n\"ja\": \"花園の女王 – クインビーナ\",\n\"en\": \"Elizabee – Queen of the Flower Garden\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"制造\"\n],\n\"cost\": 5,\n\"power\": 700,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"女皇蜂\",\n\"text_ja\": \"【永】あなたのメインネームが《ビーナイト》のパル１枚につき、このカードの【戦闘力】＋300。\\n【起】［【食材】を１個消費］あなたの山札を上から１枚見て、それがメインネームが《ビーナイト》のパルなら、コストを◇２減らしてプレイしてよい。この能力で◇０以下にはならない。\",\n\"flavor\": \"気高き女王に、とこしえの栄光があらんことを。\"\n},\n{\n\"id\": \"BP01-054\",\n\"variants\": [\n\"BP01-054\",\n\"BP01-054SR\"\n],\n\"imgs\": [\n\"BP01/BP01-054.png\",\n\"BP01/BP01-054SR.png\"\n],\n\"ja\": \"黒鉄の要塞 – グラクレス\",\n\"en\": \"Warsect – Iron Fortress\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\",\n\"地\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 8,\n\"power\": 1500,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"铠格力斯\",\n\"text_ja\": \"【永】挑発（相手は挑発を持つカードを優先してアタック先に選ぶ）\",\n\"flavor\": \"全身を包む装甲は、圧倒的な強度と耐熱性を誇る。\"\n},\n{\n\"id\": \"BP01-055\",\n\"variants\": [\n\"BP01-055\",\n\"BP01-055SR\"\n],\n\"imgs\": [\n\"BP01/BP01-055.png\",\n\"BP01/BP01-055SR.png\"\n],\n\"ja\": \"魅惑の花形 – ヴィオレッタ\",\n\"en\": \"Vaelet – Bewitching Blossom\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 8,\n\"power\": 1600,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"薇莉塔\",\n\"text_ja\": \"【起】【ターン１回】［手札を１枚捨てる］そのターンに、このカードがアサインしていたら、このカードをスタンドする。\",\n\"flavor\": \"おしろをまもってくれる、おはなのせいれい。\"\n},\n{\n\"id\": \"BP01-056\",\n\"variants\": [\n\"BP01-056\",\n\"BP01-056SR\"\n],\n\"imgs\": [\n\"BP01/BP01-056.png\",\n\"BP01/BP01-056SR.png\"\n],\n\"ja\": \"期待の新入り – クルリス\",\n\"en\": \"Lifmunk – Promising Newbie\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"制造\"\n],\n\"cost\": 3,\n\"power\": 500,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"翠叶鼠\",\n\"text_ja\": \"\",\n\"flavor\": \"５歳から７歳児程度の知能がある。\"\n},\n{\n\"id\": \"BP01-057\",\n\"variants\": [\n\"BP01-057\"\n],\n\"imgs\": [\n\"BP01/BP01-057.png\"\n],\n\"ja\": \"芳醇な恵み – トドドドン\",\n\"en\": \"Dumud – Mellow Bounty\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"地\",\n\"水\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 4,\n\"power\": 500,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"趴趴鲶\",\n\"text_ja\": \"【自】【登場時】【食材】を２個得る。\\n【自】このカードが「牧場」の建築物にアサインした時、あなたのソウルを１枚レスト状態で増やす。\",\n\"flavor\": \"最高品質のオイルは、高級レストランでも珍重される。\"\n},\n{\n\"id\": \"BP01-058\",\n\"variants\": [\n\"BP01-058\",\n\"PR-005\",\n\"PR-005S\"\n],\n\"imgs\": [\n\"BP01/BP01-058.png\",\n\"PR/PR-005.png\",\n\"PR/PR-005S.png\"\n],\n\"ja\": \"不思議な樹液 – ナエモチ\",\n\"en\": \"Gumoss – Curious Sprout\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\",\n\"地\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"叶泥泥\",\n\"text_ja\": \"【自】【登場時】ターン終了時まで、このカードの【戦闘力】＋300し、〈〉内の能力を得る。〈【永】襲撃（このカードはスタンド状態のパルをアタックできる）〉。\",\n\"flavor\": \"樹液のような体をした不思議なパル。\"\n},\n{\n\"id\": \"BP01-059\",\n\"variants\": [\n\"BP01-059\",\n\"PR-006\",\n\"PR-006S\"\n],\n\"imgs\": [\n\"BP01/BP01-059.png\",\n\"PR/PR-006.png\",\n\"PR/PR-006S.png\"\n],\n\"ja\": \"唸る鋭矛 – ドリタス\",\n\"en\": \"Digtoise – Keen Needleback\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"地\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 5,\n\"power\": 800,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"碎岩龟\",\n\"text_ja\": \"【起】【ターン１回】［【食材】を２個消費］ターン終了時まで、このカードの【戦闘力】＋500し、〈〉内の能力を得る。〈【自】突破（このカードのアタック中にバトル相手のパルが墓地に置かれた時、相手プレイヤーにも【ダメージ】）〉。\",\n\"flavor\": \"敵であれ、鉱物であれ、ドリルはすべてを粉砕する。\"\n},\n{\n\"id\": \"BP01-060\",\n\"variants\": [\n\"BP01-060\"\n],\n\"imgs\": [\n\"BP01/BP01-060.png\"\n],\n\"ja\": \"ウキウキワーカー – エテッパ\",\n\"en\": \"Tanzee – Cheerful Worker\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"新叶猿\",\n\"text_ja\": \"【自】まじめ400（【アサイン時】パルを１枚選び、ターン終了時まで、【戦闘力】＋400）\",\n\"flavor\": \"器用な手先で、いろんな建築物で活躍する。\"\n},\n{\n\"id\": \"BP01-061\",\n\"variants\": [\n\"BP01-061\"\n],\n\"imgs\": [\n\"BP01/BP01-061.png\"\n],\n\"ja\": \"花園の騎士 – ビーナイト\",\n\"en\": \"Beegarde – Knight of the Flower Garden\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"骑士蜂\",\n\"text_ja\": \"【永】このカードと同名のカードは、デッキに好きな枚数入れられる。\\n【自】【登場時】【食材】を１個得る。あなたの「牧場」の建築物があるなら、ターン終了時まで、このカードの【戦闘力】＋500。\",\n\"flavor\": \"花園の騎士は、女王に忠誠と蜂蜜を捧げる。\"\n},\n{\n\"id\": \"BP01-062\",\n\"variants\": [\n\"BP01-062\"\n],\n\"imgs\": [\n\"BP01/BP01-062.png\"\n],\n\"ja\": \"南国の番人 – トロピティ\",\n\"en\": \"Wumpo Botan – Tropical Sentinel\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 7,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": true,\n\"main\": \"绿苔绒怪\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"密林を守る巨大な番人。草の中身は秘密だ。\"\n},\n{\n\"id\": \"BP01-063\",\n\"variants\": [\n\"BP01-063\",\n\"BP01-063SR\"\n],\n\"imgs\": [\n\"BP01/BP01-063.png\",\n\"BP01/BP01-063SR.png\"\n],\n\"ja\": \"配合牧場\",\n\"en\": \"Breeding Farm\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【食材】を２個消費］あなたの山札を上から１枚公開し、それが◇８以下のパルなら手札に加え、そうでないなら墓地に置く。\\n【起】【ターン１回】［【食材】を２個消費、パルを２枚アサイン］あなたの手札から◇８以下のパルを１枚選び、登場させる。\",\n\"flavor\": \"パルたちが一緒にケーキを食べるくらい親密になると、どうやら卵が産まれるようだ。\"\n},\n{\n\"id\": \"BP01-064\",\n\"variants\": [\n\"BP01-064\",\n\"BP01-064SR\"\n],\n\"imgs\": [\n\"BP01/BP01-064.png\",\n\"BP01/BP01-064SR.png\"\n],\n\"ja\": \"コーラ自動販売機\",\n\"en\": \"Cola Vending Machine\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 6,\n\"power\": 1500,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【食材】をX個消費、パルを１枚アサイン］ソウルを１枚選び、スタンドする。さらに、ソウルをXの３倍の枚数まで選び、スタンドする。\",\n\"flavor\": \"元気が出る飲み物が出てくるという噂がある。\"\n},\n{\n\"id\": \"BP01-065\",\n\"variants\": [\n\"BP01-065\"\n],\n\"imgs\": [\n\"BP01/BP01-065.png\"\n],\n\"ja\": \"エサ箱\",\n\"en\": \"Feed Box\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": 900,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【食材】を１個消費］あなたのソウルを１枚レスト状態で増やす。増やす前のソウルが10枚以上なら、ソウルを２枚選び、スタンドする。\",\n\"flavor\": \"パルたちはどこまでもついてきてくれる。エサさえあれば、の話だが。　～漂流者の手記　Day18\"\n},\n{\n\"id\": \"BP01-066\",\n\"variants\": [\n\"BP01-066\"\n],\n\"imgs\": [\n\"BP01/BP01-066.png\"\n],\n\"ja\": \"家畜牧場\",\n\"en\": \"Ranch\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 800,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］【素材】か【食材】いずれかを３個得て、１枚引く。\",\n\"flavor\": \"放牧すると、アイテムを作ってくれるパルがいる。\"\n},\n{\n\"id\": \"BP01-067\",\n\"variants\": [\n\"BP01-067\"\n],\n\"imgs\": [\n\"BP01/BP01-067.png\"\n],\n\"ja\": \"パル通行止めの道路標識\",\n\"en\": \"No Pals Beyond Sign\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 5,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］次の相手のターン終了時まで、このカードにアサインしたパルに〈〉内の能力を与える。〈【永】挑発（相手は挑発を持つカードを優先してアタック先に選ぶ）〉。\",\n\"flavor\": \"古代に使われた道路標識。現在は形骸化している。\"\n},\n{\n\"id\": \"BP01-068\",\n\"variants\": [\n\"BP01-068\"\n],\n\"imgs\": [\n\"BP01/BP01-068.png\"\n],\n\"ja\": \"ドリタスのハチマキ\",\n\"en\": \"Digtoise's Headband\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。それのメインネームが《ドリタス》なら、【素材】か【食材】いずれかを２個得る。\",\n\"flavor\": \"ドリタスの勝負鉢巻。いつもより爆速で回ってくれる。\"\n},\n{\n\"id\": \"BP01-069\",\n\"variants\": [\n\"BP01-069\"\n],\n\"imgs\": [\n\"BP01/BP01-069.png\"\n],\n\"ja\": \"農業の帽子\",\n\"en\": \"Farming Hat\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200し、【食材】を１個得る。\",\n\"flavor\": \"畑仕事に向いた帽子。強い日光を防いでくれる。\"\n},\n{\n\"id\": \"BP01-070\",\n\"variants\": [\n\"BP01-070\",\n\"BP01-070OSR\",\n\"BP01-070SP\"\n],\n\"imgs\": [\n\"BP01/BP01-070.png\",\n\"BP01/BP01-070OSR.png\",\n\"BP01/BP01-070SP.png\"\n],\n\"ja\": \"リリィの作戦\",\n\"en\": \"Lily's Strategy\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"以下から１つ選ぶ。\\n・あなたのパルをすべて選び、ターン終了時まで、【戦闘力】＋1000。\\n・建築物かギアを１枚選び、墓地に置く。\\n・あなたのソウルを１枚レスト状態で増やす。\",\n\"flavor\": \"みなさまもパル愛護団体に入りませんか？\"\n},\n{\n\"id\": \"BP01-071\",\n\"variants\": [\n\"BP01-071\",\n\"PR-014\"\n],\n\"imgs\": [\n\"BP01/BP01-071.png\",\n\"PR/PR-014.png\"\n],\n\"ja\": \"タマゴ発見！\",\n\"en\": \"Found an Egg!\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"あなたの山札を上から５枚見て、パルを１枚まで選んで手札に加え、残りのカードと山札を切る。０枚選んだ時、【食材】を３個得る。\",\n\"flavor\": \"平凡？ ゴツゴツ？ 凍てつく？ 暗黒？ どんなパルが孵るかな？\"\n},\n{\n\"id\": \"BP01-072\",\n\"variants\": [\n\"BP01-072\"\n],\n\"imgs\": [\n\"BP01/BP01-072.png\"\n],\n\"ja\": \"花精霊の祝福\",\n\"en\": \"Blessing of the Flower Spirit\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"ライフを１得て、１枚引く。\",\n\"flavor\": \"大地に生命が溢れますように。\"\n},\n{\n\"id\": \"BP01-073\",\n\"variants\": [\n\"BP01-073\",\n\"BP01-073OSR\",\n\"BP01-073SSP\"\n],\n\"imgs\": [\n\"BP01/BP01-073.png\",\n\"BP01/BP01-073OSR.png\",\n\"BP01/BP01-073SSP.png\"\n],\n\"ja\": \"闇夜の翼 – ヘルガルダ\",\n\"en\": \"Helzephyr – Wings of the Moonless Night\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"搬运\"\n],\n\"cost\": 7,\n\"power\": 700,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"雷冥鸟\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\\n【自】あなたの〈夜行性〉を持つパルが登場した時、夜なら、それのコスト以下のパルを１枚まで選び、墓地に置く。１枚以上置いたら、そのターン終了時、このカードをレストする。\",\n\"flavor\": \"闇夜の翼は冥府の門。くぐりし魂は地獄に堕ちる。\"\n},\n{\n\"id\": \"BP01-074\",\n\"variants\": [\n\"BP01-074\",\n\"BP01-074OSR\",\n\"BP01-074SP\"\n],\n\"imgs\": [\n\"BP01/BP01-074.png\",\n\"BP01/BP01-074OSR.png\",\n\"BP01/BP01-074SP.png\"\n],\n\"ja\": \"絶望の遺伝子 – ゼノグリフ\",\n\"en\": \"Shadowbeak – Seed of Despair\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 8,\n\"power\": 1300,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"异构格里芬\",\n\"text_ja\": \"【永】このカードがレスト状態の間、夜である。\\n【永】夜なら、あなたのパルの【自】は２回発動する。\\n【自】あなたのターン終了時、あなたのパルを１枚まで選び、解体する。１枚以上解体したら、相手は自分のパルを１枚選び、墓地に置く。\",\n\"flavor\": \"狂気の末に生まれた、禁忌の存在。\"\n},\n{\n\"id\": \"BP01-075\",\n\"variants\": [\n\"BP01-075\",\n\"BP01-075OSR\",\n\"BP01-075SP\"\n],\n\"imgs\": [\n\"BP01/BP01-075.png\",\n\"BP01/BP01-075OSR.png\",\n\"BP01/BP01-075SP.png\"\n],\n\"ja\": \"深淵の魔導師 – クレメーオ\",\n\"en\": \"Katress – Abyssal Sorcerer\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"制造\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"暗巫猫\",\n\"text_ja\": \"【起】【ターン１回】［他のパルを１枚解体］ターン終了時まで、このカードの【戦闘力】＋1000/【打撃力】＋１。\\n【自】あなたのパルが解体された時、あなたの墓地のコストXのノーマルパルを１枚まで選び、レスト状態で登場させる。Xは解体されたパルのコスト－１の数。\",\n\"flavor\": \"陰なる力を操り、奇怪な術を披露する。\"\n},\n{\n\"id\": \"BP01-076\",\n\"variants\": [\n\"BP01-076\",\n\"BP01-076SR\"\n],\n\"imgs\": [\n\"BP01/BP01-076.png\",\n\"BP01/BP01-076SR.png\"\n],\n\"ja\": \"そこにいる！？ – ニャンバット\",\n\"en\": \"Tombat – Out of Nowhere!?\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"猫蝠怪\",\n\"text_ja\": \"【自】【登場時】あなたの山札を上から３枚公開し、パルを１枚まで選んで手札に加え、残りのカードを墓地に置く。\",\n\"flavor\": \"突如現れて翼を広げ、見せつけるように威嚇する。\"\n},\n{\n\"id\": \"BP01-077\",\n\"variants\": [\n\"BP01-077\",\n\"BP01-077SR\"\n],\n\"imgs\": [\n\"BP01/BP01-077.png\",\n\"BP01/BP01-077SR.png\"\n],\n\"ja\": \"蒼炎の優駿 – サラブラック\",\n\"en\": \"Pyrin Noct – Steed of Azure Flames\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 7,\n\"power\": 1100,\n\"strike\": 3,\n\"quick\": true,\n\"main\": \"邪麒麟\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\\n【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"誰かが乗ると、闇落ちしないよう気を利かせる。\"\n},\n{\n\"id\": \"BP01-078\",\n\"variants\": [\n\"BP01-078\",\n\"BP01-078SR\"\n],\n\"imgs\": [\n\"BP01/BP01-078.png\",\n\"BP01/BP01-078SR.png\"\n],\n\"ja\": \"女神の冥加 – ルナクイン\",\n\"en\": \"Lyleen Noct – Providence of the Goddess\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\"\n],\n\"cost\": 8,\n\"power\": 1700,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"黑月女王\",\n\"text_ja\": \"【起】［このカードをレスト、手札を１枚捨てる］あなたの墓地の◇６以下のパルを１枚選び、レスト状態で登場させる。\",\n\"flavor\": \"気品溢れる幽光の女神。冥加は回復？ 手痛いビンタ？\"\n},\n{\n\"id\": \"BP01-079\",\n\"variants\": [\n\"BP01-079\",\n\"BP01-079SR\",\n\"PR-015\"\n],\n\"imgs\": [\n\"BP01/BP01-079.png\",\n\"BP01/BP01-079SR.png\",\n\"PR/PR-015.png\"\n],\n\"ja\": \"夜になったら本気出す – ンダコアラ\",\n\"en\": \"Depresso – Late Night Hustler\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"资源\",\n\"制造\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 100,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"瞅什魔\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\\n【永】夜行性（夜なら、このカードの【戦闘力】＋300）\",\n\"flavor\": \"ゴキゲンな夜だ。カフェインをキメろ。\"\n},\n{\n\"id\": \"BP01-080\",\n\"variants\": [\n\"BP01-080\",\n\"BP01-080SR\"\n],\n\"imgs\": [\n\"BP01/BP01-080.png\",\n\"BP01/BP01-080SR.png\"\n],\n\"ja\": \"夢の始まり – ネムラム\",\n\"en\": \"Daedream – First Slumber\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"寐魔\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\",\n\"flavor\": \"さあ目を閉じて。幸せな夢を見せてあげる。\"\n},\n{\n\"id\": \"BP01-081\",\n\"variants\": [\n\"BP01-081\",\n\"BP01-081SR\",\n\"PR-010\"\n],\n\"imgs\": [\n\"BP01/BP01-081.png\",\n\"BP01/BP01-081SR.png\",\n\"PR/PR-010.png\"\n],\n\"ja\": \"ハート泥棒 – ラブマンダー\",\n\"en\": \"Lovander – Heartstealer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"资源\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 800,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"博爱蜥\",\n\"text_ja\": \"【自】【アタック時】あなたの手札を１枚捨ててもよい。捨てたら、ライフを１得る。\",\n\"flavor\": \"恋焦がれるは、一夜の愛。\"\n},\n{\n\"id\": \"BP01-082\",\n\"variants\": [\n\"BP01-082\",\n\"PR-007\",\n\"PR-007S\"\n],\n\"imgs\": [\n\"BP01/BP01-082.png\",\n\"PR/PR-007.png\",\n\"PR/PR-007S.png\"\n],\n\"ja\": \"夢の続き – ネムラム\",\n\"en\": \"Daedream – Deep Slumber\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"寐魔\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\",\n\"flavor\": \"楽しい夢は終わらない。夜はまだ続くのだから。\"\n},\n{\n\"id\": \"BP01-083\",\n\"variants\": [\n\"BP01-083\"\n],\n\"imgs\": [\n\"BP01/BP01-083.png\"\n],\n\"ja\": \"天空の襲撃者 – カバネドリ\",\n\"en\": \"Vanwyrm – Marauder of the Skies\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"搬运\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"烽歌龙\",\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、ターン終了時まで、【戦闘力】－300（【戦闘力】は０以下になっても墓地に置かれない）。\",\n\"flavor\": \"空からの襲撃は、強きものから強さを奪う。\"\n},\n{\n\"id\": \"BP01-084\",\n\"variants\": [\n\"BP01-084\"\n],\n\"imgs\": [\n\"BP01/BP01-084.png\"\n],\n\"ja\": \"闇に潜む蠍 – デスティング\",\n\"en\": \"Menasting – Darkness-Dwelling Scorpion\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"地\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 5,\n\"power\": 700,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"冥铠蝎\",\n\"text_ja\": \"【自】相打ち（このカードがバトル中に墓地に置かれた時、バトル相手のパルを墓地に置く）\\n【自】このカードが墓地に置かれた時、あなたの墓地のノーマルパルを１枚まで選び、手札に戻す。\",\n\"flavor\": \"獲物を殻に吸収する。周囲には呻き声が響き続ける。\"\n},\n{\n\"id\": \"BP01-085\",\n\"variants\": [\n\"BP01-085\"\n],\n\"imgs\": [\n\"BP01/BP01-085.png\"\n],\n\"ja\": \"逢魔時の使者 – ソルレイス\",\n\"en\": \"Maraith – Twilight Messenger\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"噬魂兽\",\n\"text_ja\": \"【永】このカードがレスト状態の間、夜である。\\n【永】夜なら、相手のパルすべての【戦闘力】－200（【戦闘力】は０以下になっても墓地に置かれない）。\",\n\"flavor\": \"死期が近い生物が醸し出す、独特な匂いを好む。\"\n},\n{\n\"id\": \"BP01-086\",\n\"variants\": [\n\"BP01-086\"\n],\n\"imgs\": [\n\"BP01/BP01-086.png\"\n],\n\"ja\": \"無口なあの子 – ルナティ\",\n\"en\": \"Nox – The Silent One\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 3,\n\"power\": 500,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"露娜蒂\",\n\"text_ja\": \"\",\n\"flavor\": \"無口でクール。仲良くなるとちょっぴり照れ屋。\"\n},\n{\n\"id\": \"BP01-087\",\n\"variants\": [\n\"BP01-087\",\n\"PR-008\",\n\"PR-008S\"\n],\n\"imgs\": [\n\"BP01/BP01-087.png\",\n\"PR/PR-008.png\",\n\"PR/PR-008S.png\"\n],\n\"ja\": \"閃く月光 – ツキカゲ\",\n\"en\": \"Loupmoon – Glinting Moonlight\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 4,\n\"power\": 500,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"月镰魔\",\n\"text_ja\": \"【自】【登場時】夜なら、スタンド状態の◇６以下のパルを１枚まで選び、墓地に置く。\",\n\"flavor\": \"月影は、闇に煌めく。\"\n},\n{\n\"id\": \"BP01-088\",\n\"variants\": [\n\"BP01-088\",\n\"BP01-088SR\"\n],\n\"imgs\": [\n\"BP01/BP01-088.png\",\n\"BP01/BP01-088SR.png\"\n],\n\"ja\": \"設置ランプ\",\n\"en\": \"Lamp\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": 1300,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［山札を上から３枚墓地に置く］次の相手のターン終了時まで、夜になる。\\n【永】あなたのパルすべてに〈〉内の能力を与える。〈【永】夜行性（夜なら、このカードの【戦闘力】＋300）〉。\",\n\"flavor\": \"拠点を明るくしてくれる。夜でも安心して作業ができる。\"\n},\n{\n\"id\": \"BP01-089\",\n\"variants\": [\n\"BP01-089\"\n],\n\"imgs\": [\n\"BP01/BP01-089.png\"\n],\n\"ja\": \"低質なベッド\",\n\"en\": \"Shoddy Bed\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": 700,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［山札を上から３枚墓地に置く］次の相手のターン終了時まで、夜になる。\\n【自】あなたのターン終了時、あなたのレスト状態の〈夜行性〉を持つパルがいるなら、１枚引く。\",\n\"flavor\": \"夜に眠って元気になる。目が覚めると朝がくる。\"\n},\n{\n\"id\": \"BP01-090\",\n\"variants\": [\n\"BP01-090\"\n],\n\"imgs\": [\n\"BP01/BP01-090.png\"\n],\n\"ja\": \"中世の製薬台\",\n\"en\": \"Medieval Medicine Workbench\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 4,\n\"power\": 1300,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［③、パルを１枚アサイン］あなたの墓地のコストX以下のパルを１枚選び、レスト状態で登場させる。Xはアサインしたパルのコスト＋２の数。\",\n\"flavor\": \"お薬をどうぞ。早く元気になりますように。\"\n},\n{\n\"id\": \"BP01-091\",\n\"variants\": [\n\"BP01-091\"\n],\n\"imgs\": [\n\"BP01/BP01-091.png\"\n],\n\"ja\": \"木の壁\",\n\"en\": \"Wooden Wall\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": 300,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【永】挑発（相手は挑発を持つカードを優先してアタック先に選ぶ）\\n【自】このカードが墓地に置かれた時、１枚引く。\",\n\"flavor\": \"侵入者を阻む壁だが、木だからもろい。ガウルフの息で吹き飛ばされるかもしれない。\"\n},\n{\n\"id\": \"BP01-092\",\n\"variants\": [\n\"BP01-092\"\n],\n\"imgs\": [\n\"BP01/BP01-092.png\"\n],\n\"ja\": \"鑑賞用ケージ\",\n\"en\": \"Viewing Cage\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": 1300,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］アサインしたパルを追放する。コストX以下のパルを１枚選び、追放する。Xはアサインしたパルのコスト＋２の数。\\n【自】このカードが拠点から離れた時、このカードが追放しているパルをすべてオーナーの手札に戻す。\",\n\"flavor\": \"飾ったパルは鑑賞用で、作業や戦闘はできなくなる。\"\n},\n{\n\"id\": \"BP01-093\",\n\"variants\": [\n\"BP01-093\",\n\"BP01-093SR\"\n],\n\"imgs\": [\n\"BP01/BP01-093.png\",\n\"BP01/BP01-093SR.png\"\n],\n\"ja\": \"肉切り包丁\",\n\"en\": \"Meat Cleaver\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト、パルを１枚解体］あなたの山札を上から３枚公開し、カードを１枚選んで手札に加え、残りのカードを墓地に置く。\",\n\"flavor\": \"「なでる」コマンドが「解体」コマンドに変わる。解体したパルは戻ってこない。\"\n},\n{\n\"id\": \"BP01-094\",\n\"variants\": [\n\"BP01-094\"\n],\n\"imgs\": [\n\"BP01/BP01-094.png\"\n],\n\"ja\": \"ネムラムの首輪\",\n\"en\": \"Daedream's Necklace\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】あなたの手札のメインネームが《ネムラム》のパルを１枚まで選び、登場させる。\\n【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。次の相手のターン終了時まで、夜になる。\",\n\"flavor\": \"手持ちにいるネムラムが、君と一緒に戦ってれる。\"\n},\n{\n\"id\": \"BP01-095\",\n\"variants\": [\n\"BP01-095\",\n\"BP01-095OSR\",\n\"BP01-095SP\"\n],\n\"imgs\": [\n\"BP01/BP01-095.png\",\n\"BP01/BP01-095OSR.png\",\n\"BP01/BP01-095SP.png\"\n],\n\"ja\": \"ゾーイの作戦\",\n\"en\": \"Zoe's Strategy\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"以下から１つ選ぶ。\\n・相手の【素材】か【食材】を合わせて５個まで選び、相手はそれらを失う。\\n・あなたの墓地のパルを１枚まで選び、手札に戻す。相手は自分の手札を１枚選び、捨てる。\\n・あなたのパルを１枚選び、解体する。１枚以上解体したら、相手のパルを１枚選び、墓地に置く。\",\n\"flavor\": \"密猟団の悪事に賛成ではないが強く口を出せていない。\"\n},\n{\n\"id\": \"BP01-096\",\n\"variants\": [\n\"BP01-096\"\n],\n\"imgs\": [\n\"BP01/BP01-096.png\"\n],\n\"ja\": \"ダークキャノン\",\n\"en\": \"Dark Cannon\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": true,\n\"main\": null,\n\"text_ja\": \"◇５以下のパルを１枚選び、墓地に置く。\",\n\"flavor\": \"その闇技は、闇のエネルギー弾で敵を打ち抜く。\"\n},\n{\n\"id\": \"BP01-097\",\n\"variants\": [\n\"BP01-097\"\n],\n\"imgs\": [\n\"BP01/BP01-097.png\"\n],\n\"ja\": \"闇商人\",\n\"en\": \"Black Marketeer\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 5,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"あなたの墓地の〈妨害〉を持たないパルを２枚まで選び、手札に戻す。次の相手のターン終了時まで、夜になる。\",\n\"flavor\": \"宙吊り罠とキャンプファイアが嫌いらしい。\"\n},\n{\n\"id\": \"BP01-098\",\n\"variants\": [\n\"BP01-098\"\n],\n\"imgs\": [\n\"BP01/BP01-098.png\"\n],\n\"ja\": \"優しい輝き – シルフィア\",\n\"en\": \"Elphidran – Gentle Radiance\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"龙\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"精灵龙\",\n\"text_ja\": \"【自】【アタック時】あなたの手札を１枚公開してもよい。【竜】のパルを公開したら、ターン終了時まで、このカードの【戦闘力】＋500。\",\n\"flavor\": \"無邪気な聖竜は、優しい輝きを差し伸べる。\"\n},\n{\n\"id\": \"BP01-099\",\n\"variants\": [\n\"BP01-099\"\n],\n\"imgs\": [\n\"BP01/BP01-099.png\"\n],\n\"ja\": \"誇り高き牙 – ガウルフ\",\n\"en\": \"Direhowl – Proud Fang\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 3,\n\"power\": 500,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"猎狼\",\n\"text_ja\": \"\",\n\"flavor\": \"はるか昔、ガウルフは人と共に狩りをしていた。\"\n},\n{\n\"id\": \"BP01-100\",\n\"variants\": [\n\"BP01-100\",\n\"BP01-100SR\"\n],\n\"imgs\": [\n\"BP01/BP01-100.png\",\n\"BP01/BP01-100SR.png\"\n],\n\"ja\": \"冒険の始まり\",\n\"en\": \"The Adventure Begins\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"あなたがこのゲーム中、他のカードをプレイしていないなら、２枚引く。\\nあなたの、カード名に《始まりの》を含む異なるカード名のパルが３種類以上あるなら、あなたのパルをすべて選び、ターン終了時まで、【戦闘力】＋1000/【打撃力】＋５。\",\n\"flavor\": \"島に上陸してすぐに、謎の生物を見つけた。　～漂流者の手記　Day1-2\"\n},\n{\n\"id\": \"TD01-001\",\n\"variants\": [\n\"TD01-001\",\n\"TD01-001TSP\",\n\"TD01-001TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-001.png\",\n\"TD01/TD01-001TSP.png\",\n\"TD01/TD01-001TSR.png\"\n],\n\"ja\": \"爆走重戦車 – エレパンダ\",\n\"en\": \"Grizzbolt – Rumbling Tank\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 7,\n\"power\": 1600,\n\"strike\": 4,\n\"quick\": false,\n\"main\": \"暴电熊\",\n\"text_ja\": \"【永】襲撃（このカードはスタンド状態のパルをアタックできる）\",\n\"flavor\": \"豪快な笑顔。屈強な体格。認めた相手の頼れる相棒。\"\n},\n{\n\"id\": \"TD01-002\",\n\"variants\": [\n\"TD01-002\"\n],\n\"imgs\": [\n\"TD01/TD01-002.png\"\n],\n\"ja\": \"刺激的で純真 – パチグリ\",\n\"en\": \"Jolthog – Shocking Yet Innocent\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\"\n],\n\"cost\": 2,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"电棘鼠\",\n\"text_ja\": \"\",\n\"flavor\": \"衝撃を受けると、溜め込んだ電気を放出する。\"\n},\n{\n\"id\": \"TD01-003\",\n\"variants\": [\n\"TD01-003\"\n],\n\"imgs\": [\n\"TD01/TD01-003.png\"\n],\n\"ja\": \"溶岩日和 – マグピス\",\n\"en\": \"Kelpsea Ignis – Balmy Magma\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 500,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"火灵儿\",\n\"text_ja\": \"\",\n\"flavor\": \"暑さが足りないなと思ったら、打ち溶岩がお勧めだ。\"\n},\n{\n\"id\": \"TD01-004\",\n\"variants\": [\n\"TD01-004\"\n],\n\"imgs\": [\n\"TD01/TD01-004.png\"\n],\n\"ja\": \"ほかほかだっこ – キツネビ\",\n\"en\": \"Foxparks – A Toasty Hug\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 4,\n\"power\": 400,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"火绒狐\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"熱い抱擁。うかつに近づくと、やけどするよ。\"\n},\n{\n\"id\": \"TD01-005\",\n\"variants\": [\n\"TD01-005\",\n\"TD01-005TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-005.png\",\n\"TD01/TD01-005TSR.png\"\n],\n\"ja\": \"熱々の落し物 – ブルフェルノ\",\n\"en\": \"Arsox – Burning Spoils\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 5,\n\"power\": 800,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"炽焰牛\",\n\"text_ja\": \"【自】【登場時】【素材】を２個得る。\",\n\"flavor\": \"ぽかぽかのボディ。熱々の落とし物。\"\n},\n{\n\"id\": \"TD01-006\",\n\"variants\": [\n\"TD01-006\"\n],\n\"imgs\": [\n\"TD01/TD01-006.png\"\n],\n\"ja\": \"特攻隊長 – ライゾー\",\n\"en\": \"Mossanda Lux – Vanguard Captain\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 1100,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"雷胖达\",\n\"text_ja\": \"【起】［【素材】を２個消費］ターン終了時まで、このカードの【戦闘力】＋500。\",\n\"flavor\": \"電気の力で限界を超える。最強の名を誇るグレパンダ。\"\n},\n{\n\"id\": \"TD01-007\",\n\"variants\": [\n\"TD01-007\",\n\"TD01-007TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-007.png\",\n\"TD01/TD01-007TSR.png\"\n],\n\"ja\": \"マグマを統べる者 – ボルカイザー\",\n\"en\": \"Blazamut – Molten Sovereign\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"red\",\n\"types\": [\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 8,\n\"power\": 1600,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"焰煌\",\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、1000【ダメージ】。\",\n\"flavor\": \"火山の噴火を産声として、マグマの王が降臨する。\"\n},\n{\n\"id\": \"TD01-008\",\n\"variants\": [\n\"TD01-008\",\n\"TD01-008TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-008.png\",\n\"TD01/TD01-008TSR.png\"\n],\n\"ja\": \"採石場\",\n\"en\": \"Stone Pit\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 1,\n\"power\": 600,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］【素材】を３個得て、１枚引く。（あなたのスタンドしているパルをレストすることでアサインできる）\",\n\"flavor\": \"石が取れる。岩より小さく、砂より大きい。\"\n},\n{\n\"id\": \"TD01-009\",\n\"variants\": [\n\"TD01-009\"\n],\n\"imgs\": [\n\"TD01/TD01-009.png\"\n],\n\"ja\": \"武器製作台\",\n\"en\": \"Weapon Workbench\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 3,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【素材】を１個消費、パルを１枚アサイン］パルを１枚まで選び、800【ダメージ】。あなたのパルをすべて選び、ターン終了時まで、【打撃力】＋１。（あなたのスタンドしているパルをレストすることでアサインできる）\",\n\"flavor\": \"武器や弾丸はいかが？ 肉切り包丁も作れるよ？\"\n},\n{\n\"id\": \"TD01-010\",\n\"variants\": [\n\"TD01-010\"\n],\n\"imgs\": [\n\"TD01/TD01-010.png\"\n],\n\"ja\": \"シングルショットライフル\",\n\"en\": \"Single-Shot Rifle\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、1500【ダメージ】。\\n【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。\",\n\"flavor\": \"単発式のライフル。装填数は少ないが、一撃は強力。\"\n},\n{\n\"id\": \"TD01-011\",\n\"variants\": [\n\"TD01-011\",\n\"TD01-011TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-011.png\",\n\"TD01/TD01-011TSR.png\"\n],\n\"ja\": \"ファイアーブレス\",\n\"en\": \"Ignis Breath\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": true,\n\"main\": null,\n\"text_ja\": \"パルを１枚選び、500【ダメージ】。\",\n\"flavor\": \"炎の竜の吐息のように、その炎技は敵を焼却する。\"\n},\n{\n\"id\": \"TD01-012\",\n\"variants\": [\n\"TD01-012\",\n\"TD01-012TSP\",\n\"TD01-012TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-012.png\",\n\"TD01/TD01-012TSP.png\",\n\"TD01/TD01-012TSR.png\"\n],\n\"ja\": \"優しい波紋 – シルティア\",\n\"en\": \"Elphidran Aqua – Gentle Ripples\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"水灵龙\",\n\"text_ja\": \"【自】【登場時】２枚引き、あなたの手札を１枚選び、山札の上に置く。\",\n\"flavor\": \"水竜が現れた時、優しい波紋が広がる。\"\n},\n{\n\"id\": \"TD01-013\",\n\"variants\": [\n\"TD01-013\"\n],\n\"imgs\": [\n\"TD01/TD01-013.png\"\n],\n\"ja\": \"堅物で純真 – コチグリ\",\n\"en\": \"Jolthog Cryst – Stoic Yet Innocent\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"冷却\"\n],\n\"cost\": 2,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"冰刺鼠\",\n\"text_ja\": \"\",\n\"flavor\": \"衝撃を受けると、溜め込んだ冷気を放出する。\"\n},\n{\n\"id\": \"TD01-014\",\n\"variants\": [\n\"TD01-014\",\n\"TD01-014TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-014.png\",\n\"TD01/TD01-014TSR.png\"\n],\n\"ja\": \"よく飛ぶ砲弾 – ペンタマ\",\n\"en\": \"Pengullet – Frequent Flyer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"水\",\n\"冰\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"冷却\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 500,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"企丸丸\",\n\"text_ja\": \"\",\n\"flavor\": \"心の羽根は、まだ退化していないから。\"\n},\n{\n\"id\": \"TD01-015\",\n\"variants\": [\n\"TD01-015\"\n],\n\"imgs\": [\n\"TD01/TD01-015.png\"\n],\n\"ja\": \"凍夜にさまよう – オバケナワ\",\n\"en\": \"Hangyu Cryst – Frigid Wanderer\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"冷却\",\n\"搬运\"\n],\n\"cost\": 4,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"冰缚灵\",\n\"text_ja\": \"【自】【登場時】◇３以下のパルを１枚まで選び、レストする。\",\n\"flavor\": \"咎人よ、凍てつき震えよ。\"\n},\n{\n\"id\": \"TD01-016\",\n\"variants\": [\n\"TD01-016\"\n],\n\"imgs\": [\n\"TD01/TD01-016.png\"\n],\n\"ja\": \"冷たい眼差し – ツララジカ\",\n\"en\": \"Reindrix – Icy Gaze\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\"\n],\n\"apts\": [\n\"资源\",\n\"冷却\"\n],\n\"cost\": 5,\n\"power\": 600,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"严冬鹿\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"凍り付く眼差しに耐え、何かをするのはとても難しい。\"\n},\n{\n\"id\": \"TD01-017\",\n\"variants\": [\n\"TD01-017\",\n\"TD01-017TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-017.png\",\n\"TD01/TD01-017TSR.png\"\n],\n\"ja\": \"流水の理 – シヴァ\",\n\"en\": \"Suzaku Aqua – Way of the Current\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"水\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 7,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"清雀\",\n\"text_ja\": \"【自】警戒（あなたのターン終了時、このカードをスタンドする）\",\n\"flavor\": \"流れるように淀みなく。武の極みは流水に至る。\"\n},\n{\n\"id\": \"TD01-018\",\n\"variants\": [\n\"TD01-018\",\n\"TD01-018TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-018.png\",\n\"TD01/TD01-018TSR.png\"\n],\n\"ja\": \"氷原に轟く者 – ブリザモス\",\n\"en\": \"Mammorest Cryst – Roar of the Tundra\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"blue\",\n\"types\": [\n\"冰\",\n\"地\"\n],\n\"apts\": [\n\"资源\",\n\"冷却\"\n],\n\"cost\": 8,\n\"power\": 1700,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"雪猛犸\",\n\"text_ja\": \"【永】あなたの建築物１枚につき、このカードの【戦闘力】＋200。\\n【起】［手札の建築物を１枚捨てる］ターン終了時まで、このカードの【打撃力】＋１。\",\n\"flavor\": \"氷原のように峻厳で、氷原のように教訓をもたらす。\"\n},\n{\n\"id\": \"TD01-019\",\n\"variants\": [\n\"TD01-019\"\n],\n\"imgs\": [\n\"TD01/TD01-019.png\"\n],\n\"ja\": \"アンティークな木の椅子\",\n\"en\": \"Antique Wooden Chair\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": 1200,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、ターン終了時まで、【戦闘力】＋1000。\",\n\"flavor\": \"由緒ある木の椅子。腰かけて、ほっと一息。\"\n},\n{\n\"id\": \"TD01-020\",\n\"variants\": [\n\"TD01-020\"\n],\n\"imgs\": [\n\"TD01/TD01-020.png\"\n],\n\"ja\": \"原始的な作業台\",\n\"en\": \"Primitive Workbench\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 3,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］あなたの山札を上から１枚公開し、それが◇６以下の、建築物かギアなら、登場させてよい。登場させないなら、手札に加える。（あなたのスタンドしているパルをレストすることでアサインできる）\",\n\"flavor\": \"原始的だけど、序盤に役立つモノが作れる。\"\n},\n{\n\"id\": \"TD01-021\",\n\"variants\": [\n\"TD01-021\"\n],\n\"imgs\": [\n\"TD01/TD01-021.png\"\n],\n\"ja\": \"単発型スフィアランチャー\",\n\"en\": \"Single-Shot Sphere Launcher\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 3,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【自】【登場時】１枚引く。\\n【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200。\",\n\"flavor\": \"スフィアを発射する装置。遠くにいるパルにも届く。\"\n},\n{\n\"id\": \"TD01-022\",\n\"variants\": [\n\"TD01-022\",\n\"TD01-022TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-022.png\",\n\"TD01/TD01-022TSR.png\"\n],\n\"ja\": \"コールドブレス\",\n\"en\": \"Crystal Breath\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": true,\n\"main\": null,\n\"text_ja\": \"パルを１枚選び、ターン終了時まで、【打撃力】－３。それは次の相手のスタンドフェイズ中、スタンドしない。\",\n\"flavor\": \"氷の竜の吐息のように、その氷技は敵を凍結する。\"\n},\n{\n\"id\": \"TD01-023\",\n\"variants\": [\n\"TD01-023\",\n\"TD01-023TSR\",\n\"PR-017\"\n],\n\"imgs\": [\n\"TD01/TD01-023.png\",\n\"TD01/TD01-023TSR.png\",\n\"PR/PR-017.png\"\n],\n\"ja\": \"始まりのパル – モコロン\",\n\"en\": \"Lamball – My First Pal\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"制造\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"棉悠悠\",\n\"text_ja\": \"【永】このカードは◇４以上のパルにアタックされない。\",\n\"flavor\": \"始まりから君のそばに。モコモコした毛皮が盾になる。\"\n},\n{\n\"id\": \"TD01-024\",\n\"variants\": [\n\"TD01-024\",\n\"TD01-024TSR\"\n],\n\"imgs\": [\n\"TD01/TD01-024.png\",\n\"TD01/TD01-024TSR.png\"\n],\n\"ja\": \"小さな姫君 – ヒメウサ\",\n\"en\": \"Ribbuny – Little Princess\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"姬小兔\",\n\"text_ja\": \"【自】このカードが墓地に置かれた時、【素材】を１個得る。\",\n\"flavor\": \"常にニコニコ笑顔をかかさない。 ツッパニャンにいたずらされないかぎり。\"\n},\n{\n\"id\": \"TD02-001\",\n\"variants\": [\n\"TD02-001\",\n\"TD02-001TSP\",\n\"TD02-001TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-001.png\",\n\"TD02/TD02-001TSP.png\",\n\"TD02/TD02-001TSR.png\"\n],\n\"ja\": \"親衛隊長 – ササゾー\",\n\"en\": \"Mossanda – Guard Captain\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"叶胖达\",\n\"text_ja\": \"\",\n\"flavor\": \"草食でよかった。3000枚の紙を引きちぎるグレパンダ。\"\n},\n{\n\"id\": \"TD02-002\",\n\"variants\": [\n\"TD02-002\"\n],\n\"imgs\": [\n\"TD02/TD02-002.png\"\n],\n\"ja\": \"夢見る双葉 – ナエモチ\",\n\"en\": \"Gumoss – Dreamy Seedling\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\",\n\"地\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 2,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"叶泥泥\",\n\"text_ja\": \"\",\n\"flavor\": \"小さな双葉が育った時、どんな姿になるのだろう？\"\n},\n{\n\"id\": \"TD02-003\",\n\"variants\": [\n\"TD02-003\",\n\"TD02-003TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-003.png\",\n\"TD02/TD02-003TSR.png\"\n],\n\"ja\": \"おやつの時間 – ポプリーナ\",\n\"en\": \"Flopie – Snack Lover\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 400,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"波娜兔\",\n\"text_ja\": \"【自】【登場時】【食材】を２個得る。\",\n\"flavor\": \"いつもお手伝いありがとう。\"\n},\n{\n\"id\": \"TD02-004\",\n\"variants\": [\n\"TD02-004\"\n],\n\"imgs\": [\n\"TD02/TD02-004.png\"\n],\n\"ja\": \"華やかな香気 – アロアリュー\",\n\"en\": \"Dinossom – Radiant Fragrance\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"草\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\"\n],\n\"cost\": 4,\n\"power\": 400,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"花冠龙\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"あなたが成功したいならば、アロアリューの尻尾を踏むべきではない。\"\n},\n{\n\"id\": \"TD02-005\",\n\"variants\": [\n\"TD02-005\"\n],\n\"imgs\": [\n\"TD02/TD02-005.png\"\n],\n\"ja\": \"自然の守護者 – ヤマガミ\",\n\"en\": \"Eikthyrdeer Terra – Guardian of Nature\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [\n\"地\"\n],\n\"apts\": [\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 800,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"祇岳鹿\",\n\"text_ja\": \"【永】挑発（相手は挑発を持つカードを優先してアタック先に選ぶ）\\n【起】［【食材】を２個消費］ターン終了時まで、このカードの【戦闘力】＋500。\",\n\"flavor\": \"ヤマガミの角は、金色の森の守護者の証である。\"\n},\n{\n\"id\": \"TD02-006\",\n\"variants\": [\n\"TD02-006\",\n\"TD02-006TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-006.png\",\n\"TD02/TD02-006TSR.png\"\n],\n\"ja\": \"溢れる愛情 – ラブラドン\",\n\"en\": \"Broncherry – Brimming Adoration\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"草\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 7,\n\"power\": 1500,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"连理龙\",\n\"text_ja\": \"【永】挑発（相手は挑発を持つカードを優先してアタック先に選ぶ）\",\n\"flavor\": \"パートナーを見つけた後の体臭は、「初恋の香り」と呼ばれている。\"\n},\n{\n\"id\": \"TD02-007\",\n\"variants\": [\n\"TD02-007\",\n\"TD02-007TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-007.png\",\n\"TD02/TD02-007TSR.png\"\n],\n\"ja\": \"大地に轟く者 – グランモス\",\n\"en\": \"Mammorest – Roar of the Wilds\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"green\",\n\"types\": [\n\"草\",\n\"地\"\n],\n\"apts\": [\n\"农耕\",\n\"资源\"\n],\n\"cost\": 8,\n\"power\": 2000,\n\"strike\": 4,\n\"quick\": false,\n\"main\": \"森猛犸\",\n\"text_ja\": \"【自】このカードが墓地に置かれた時、【食材】を３個得る。\",\n\"flavor\": \"大地のように雄大で、大地のように恩恵をもたらす。\"\n},\n{\n\"id\": \"TD02-008\",\n\"variants\": [\n\"TD02-008\",\n\"TD02-008TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-008.png\",\n\"TD02/TD02-008TSR.png\"\n],\n\"ja\": \"ベリー農園\",\n\"en\": \"Berry Plantation\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 1,\n\"power\": 600,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］【食材】を３個得て、１枚引く。（あなたのスタンドしているパルをレストすることでアサインできる）\",\n\"flavor\": \"種をまいて、水をやって、採取するのは赤いベリー。\"\n},\n{\n\"id\": \"TD02-009\",\n\"variants\": [\n\"TD02-009\"\n],\n\"imgs\": [\n\"TD02/TD02-009.png\"\n],\n\"ja\": \"キャンプファイア\",\n\"en\": \"Campfire\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [\n\"生火\"\n],\n\"cost\": 3,\n\"power\": 1100,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［【食材】を２個消費、パルを１枚アサイン］あなたはライフを１得て、あなたのパルをすべて選び、ターン終了時まで、【戦闘力】＋1000。（あなたのスタンドしているパルをレストすることでアサインできる）\",\n\"flavor\": \"明るくて暖かい。そして簡単な料理も作れる。\"\n},\n{\n\"id\": \"TD02-010\",\n\"variants\": [\n\"TD02-010\"\n],\n\"imgs\": [\n\"TD02/TD02-010.png\"\n],\n\"ja\": \"精錬金属の槍\",\n\"en\": \"Refined Metal Spear\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 6,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋900。\",\n\"flavor\": \"上質な金属で作られた槍。近接戦闘に有用。\"\n},\n{\n\"id\": \"TD02-011\",\n\"variants\": [\n\"TD02-011\"\n],\n\"imgs\": [\n\"TD02/TD02-011.png\"\n],\n\"ja\": \"ストーンブラスト\",\n\"en\": \"Stone Blast\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"green\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": null,\n\"strike\": null,\n\"quick\": true,\n\"main\": null,\n\"text_ja\": \"パルを１枚選び、ターン終了時まで、【戦闘力】＋500。\",\n\"flavor\": \"その地技は、つぶての雨を援軍に変える。\"\n},\n{\n\"id\": \"TD02-012\",\n\"variants\": [\n\"TD02-012\",\n\"TD02-012TSP\",\n\"TD02-012TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-012.png\",\n\"TD02/TD02-012TSP.png\",\n\"TD02/TD02-012TSR.png\"\n],\n\"ja\": \"死を呼ぶ鎧竜 – ジオラーヴァ\",\n\"en\": \"Astegon – Aegis Wyvern of Death\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"龙\"\n],\n\"apts\": [\n\"制造\",\n\"资源\"\n],\n\"cost\": 8,\n\"power\": 1200,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"魔渊龙\",\n\"text_ja\": \"【自】【登場時】パルを１枚まで選び、ターン終了時まで、【戦闘力】－1000（【戦闘力】は０以下になっても墓地に置かれない）。\\r\\n【自】【アタック時】【戦闘力】300以下のパルをすべて選び、墓地に置く（あなたのパルも選ぶ）。\",\n\"flavor\": \"汝、かの獣の前に立つべからず。汝、かの獣の声を聴くべからず。\"\n},\n{\n\"id\": \"TD02-013\",\n\"variants\": [\n\"TD02-013\"\n],\n\"imgs\": [\n\"TD02/TD02-013.png\"\n],\n\"ja\": \"叡智の結晶 – ホウロック\",\n\"en\": \"Hoocrates – Embodiment of Wisdom\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\"\n],\n\"cost\": 2,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"啼卡尔\",\n\"text_ja\": \"\",\n\"flavor\": \"我思う、ゆえに我あり。\"\n},\n{\n\"id\": \"TD02-014\",\n\"variants\": [\n\"TD02-014\",\n\"TD02-014TSR\",\n\"PR-016\"\n],\n\"imgs\": [\n\"TD02/TD02-014.png\",\n\"TD02/TD02-014TSR.png\",\n\"PR/PR-016.png\"\n],\n\"ja\": \"お宝の予感 – ダリザード\",\n\"en\": \"Leezpunk – Treasure Bandit\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"朋克蜥\",\n\"text_ja\": \"【自】このカードが墓地に置かれた時、相手は自分の手札を１枚選び、捨てる。\",\n\"flavor\": \"第六感に優れ、カッコいいポーズにこだわる。\"\n},\n{\n\"id\": \"TD02-015\",\n\"variants\": [\n\"TD02-015\"\n],\n\"imgs\": [\n\"TD02/TD02-015.png\"\n],\n\"ja\": \"暗躍する影 – マスクロウ\",\n\"en\": \"Cawgnito – Looming Shadow\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"资源\",\n\"牧场\"\n],\n\"cost\": 4,\n\"power\": 300,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"黑鸦隐士\",\n\"text_ja\": \"【永】隠密（このカードはブロックされない）\",\n\"flavor\": \"音もなく闇に隠れ、密やかに暗躍する。\"\n},\n{\n\"id\": \"TD02-016\",\n\"variants\": [\n\"TD02-016\",\n\"TD02-016TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-016.png\",\n\"TD02/TD02-016TSR.png\"\n],\n\"ja\": \"待ち伏せる狩人 – ヘルゴート\",\n\"en\": \"Incineram – Lurking Stalker\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 5,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"炎魔羊\",\n\"text_ja\": \"\",\n\"flavor\": \"捕らえた獲物を縄張りに持ち帰る炎爪の狩人。\"\n},\n{\n\"id\": \"TD02-017\",\n\"variants\": [\n\"TD02-017\"\n],\n\"imgs\": [\n\"TD02/TD02-017.png\"\n],\n\"ja\": \"立ちはだかる黒炎 – シンエンオ\",\n\"en\": \"Blazehowl Noct – Darkflame Defender\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\",\n\"火\"\n],\n\"apts\": [\n\"生火\",\n\"资源\"\n],\n\"cost\": 6,\n\"power\": 900,\n\"strike\": 2,\n\"quick\": true,\n\"main\": \"狱阎王\",\n\"text_ja\": \"【起】妨害（【手札】【クイック】［①、このカードを捨てる］または［このカードと他の手札を１枚捨てる］相手のアタックを失敗させる。バトルダメージは発生しない）\",\n\"flavor\": \"暗黒のツメを恐れよ。立ちはだかるは黒炎の獅子。\"\n},\n{\n\"id\": \"TD02-018\",\n\"variants\": [\n\"TD02-018\",\n\"TD02-018TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-018.png\",\n\"TD02/TD02-018TSR.png\"\n],\n\"ja\": \"命を盗む者 – ヤミトバリ\",\n\"en\": \"Felbat – Lifestealer\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"制造\"\n],\n\"cost\": 7,\n\"power\": 1000,\n\"strike\": 3,\n\"quick\": false,\n\"main\": \"夜幕魔蝠\",\n\"text_ja\": \"【永】隠密（このカードはブロックされない）\\n【自】【アタック時】ライフを１得る。\",\n\"flavor\": \"闇の帳に包まれて、命を盗む者がいる。\"\n},\n{\n\"id\": \"TD02-019\",\n\"variants\": [\n\"TD02-019\"\n],\n\"imgs\": [\n\"TD02/TD02-019.png\"\n],\n\"ja\": \"宙吊り罠\",\n\"en\": \"Hanging Trap\",\n\"kind\": \"building\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 2,\n\"power\": 900,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】【ターン１回】［パルを１枚アサイン］このカードが追放しているパルが追放領域にないなら、パルを１枚選び、追放する。（あなたのスタンドしているパルをレストすることでアサインできる）\\n【自】このカードが拠点から離れた時、このカードが追放したパルをオーナーの拠点にレスト状態で登場させる。\",\n\"flavor\": \"小さなパルや人間を宙吊りにして捕まえる罠。\"\n},\n{\n\"id\": \"TD02-020\",\n\"variants\": [\n\"TD02-020\"\n],\n\"imgs\": [\n\"TD02/TD02-020.png\"\n],\n\"ja\": \"マスクロウ帽\",\n\"en\": \"Cawgnito Hat\",\n\"kind\": \"gear\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"【起】［このカードをレスト］パルを１枚選び、ターン終了時まで、【戦闘力】＋200し、〈〉内の能力を与える。〈【永】隠密（このカードはブロックされない）〉。\",\n\"flavor\": \"マスクロウっぽくなれる帽子。これで君も暗躍する影。\"\n},\n{\n\"id\": \"TD02-021\",\n\"variants\": [\n\"TD02-021\",\n\"TD02-021TSR\"\n],\n\"imgs\": [\n\"TD02/TD02-021.png\",\n\"TD02/TD02-021TSR.png\"\n],\n\"ja\": \"暗闇からの一撃\",\n\"en\": \"Strike from the Darkness\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 4,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"パルを１枚選び、墓地に置く。\",\n\"flavor\": \"闇に紛れた奇襲ほど恐ろしいものはない。\"\n},\n{\n\"id\": \"TD02-022\",\n\"variants\": [\n\"TD02-022\"\n],\n\"imgs\": [\n\"TD02/TD02-022.png\"\n],\n\"ja\": \"医薬品\",\n\"en\": \"Medical Supplies\",\n\"kind\": \"event\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [],\n\"apts\": [],\n\"cost\": 7,\n\"power\": null,\n\"strike\": null,\n\"quick\": false,\n\"main\": null,\n\"text_ja\": \"あなたの墓地の◇８以下のパルを１枚選び、レスト状態で登場させる。\",\n\"flavor\": \"胃潰瘍や骨折に効く不思議な医薬品。\"\n},\n{\n\"id\": \"TD02-023\",\n\"variants\": [\n\"TD02-023\",\n\"TD02-023TSR\",\n\"PR-019\",\n\"PR-029\"\n],\n\"imgs\": [\n\"TD02/TD02-023.png\",\n\"TD02/TD02-023TSR.png\",\n\"PR/PR-019.png\",\n\"PR/PR-029.png\"\n],\n\"ja\": \"始まりのパル – ツッパニャン\",\n\"en\": \"Cattiva – My First Pal\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"捣蛋猫\",\n\"text_ja\": \"【永】このカードは◇３以下のパルにアタックされない。\",\n\"flavor\": \"始まりから君のそばに。大きいやつが怖いのは内緒。\"\n},\n{\n\"id\": \"TD02-024\",\n\"variants\": [\n\"TD02-024\",\n\"TD02-024TSR\",\n\"PR-018\"\n],\n\"imgs\": [\n\"TD02/TD02-024.png\",\n\"TD02/TD02-024TSR.png\",\n\"PR/PR-018.png\"\n],\n\"ja\": \"始まりのパル – タマコッコ\",\n\"en\": \"Chikipi – My First Pal\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"农耕\",\n\"牧场\"\n],\n\"cost\": 2,\n\"power\": 200,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"皮皮鸡\",\n\"text_ja\": \"【自】このカードが墓地に置かれた時、【食材】を１個得る。\",\n\"flavor\": \"始まりから君のそばに。気がついたら卵がひとつ。\"\n},\n{\n\"id\": \"SS01-001\",\n\"variants\": [\n\"SS01-001\",\n\"SS01-001OSR\"\n],\n\"imgs\": [\n\"SS01/SS-001.png\",\n\"SS01/SS-001OSR.png\"\n],\n\"ja\": \"降り注ぐ電撃 – エレパンダ\",\n\"en\": \"Grizzbolt – Cascading Voltage\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"red\",\n\"types\": [\n\"雷\"\n],\n\"apts\": [\n\"发电\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 1000,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"暴电熊\",\n\"text_ja\": \"【自】【登場時】相手のパルをすべて選び、300【ダメージ】。\",\n\"flavor\": \"乱れ落ちる電撃は周囲一帯を痺れさせる。\"\n},\n{\n\"id\": \"SS01-002\",\n\"variants\": [\n\"SS01-002\",\n\"SS01-002OSR\"\n],\n\"imgs\": [\n\"SS01/SS-002.png\",\n\"SS01/SS-002OSR.png\"\n],\n\"ja\": \"仕上げの氷刃 – オコチョ\",\n\"en\": \"Chillet – Final Frostneedle\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"blue\",\n\"types\": [\n\"冰\",\n\"龙\"\n],\n\"apts\": [\n\"农耕\",\n\"冷却\"\n],\n\"cost\": 6,\n\"power\": 1000,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"疾旋鼬\",\n\"text_ja\": \"【自】このカードのバトル相手のパルが墓地に置かれた時、１枚引く。\",\n\"flavor\": \"オコチョの本気はほんのりひんやり刺激的。\"\n},\n{\n\"id\": \"SS01-003\",\n\"variants\": [\n\"SS01-003\",\n\"SS01-003OSR\"\n],\n\"imgs\": [\n\"SS01/SS-003.png\",\n\"SS01/SS-003OSR.png\"\n],\n\"ja\": \"深夜の本気 – ンダコアラ\",\n\"en\": \"Depresso – Midnight Overdrive\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": \"purple\",\n\"types\": [\n\"暗\"\n],\n\"apts\": [\n\"制造\",\n\"资源\",\n\"搬运\",\n\"牧场\"\n],\n\"cost\": 3,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"瞅什魔\",\n\"text_ja\": \"【永】夜行性（夜なら、このカードの【戦闘力】＋300）\\n【自】【登場時】夜なら、建築物を１枚まで選び、ターン終了時まで、【耐久力】－500（【耐久力】は０以下になっても墓地に置かれない）。\",\n\"flavor\": \"立派な柱も、一晩のうちに。\"\n},\n{\n\"id\": \"SS01-004\",\n\"variants\": [\n\"SS01-004\",\n\"SS01-004OSR\"\n],\n\"imgs\": [\n\"SS01/SS-004.png\",\n\"SS01/SS-004OSR.png\"\n],\n\"ja\": \"自信満々 – ツッパニャン\",\n\"en\": \"Cattiva – Brimming Bravado\",\n\"kind\": \"pal\",\n\"lucky\": false,\n\"color\": null,\n\"types\": [\n\"无\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 3,\n\"power\": 300,\n\"strike\": 1,\n\"quick\": false,\n\"main\": \"捣蛋猫\",\n\"text_ja\": \"【永】あなたのソウルが５枚以上なら、このカードの【戦闘力】＋200。\\n【永】あなたのソウルが10枚以上なら、このカードの【戦闘力】＋200。\",\n\"flavor\": \"自信がみなぎるほどに、肉球は熱く燃える。\"\n},\n{\n\"id\": \"SS01-005\",\n\"variants\": [\n\"SS01-005\",\n\"SS01-005OSR\"\n],\n\"imgs\": [\n\"SS01/SS-005.png\",\n\"SS01/SS-005OSR.png\"\n],\n\"ja\": \"翼竜の息吹  – フェスキー\",\n\"en\": \"Quivern – Breath of the Wyvern\",\n\"kind\": \"pal\",\n\"lucky\": true,\n\"color\": null,\n\"types\": [\n\"龙\"\n],\n\"apts\": [\n\"农耕\",\n\"制造\",\n\"资源\",\n\"搬运\"\n],\n\"cost\": 6,\n\"power\": 1300,\n\"strike\": 2,\n\"quick\": false,\n\"main\": \"天羽龙\",\n\"text_ja\": \"【自】このカードがパルか建築物にアタックした時、パルか建築物を１枚まで選び、700【ダメージ】。\",\n\"flavor\": \"愛くるしい姿からは想像もつかない超威力。\"\n}\n]",
"/app/server/engine/tuned_decks.json": "[\n {\n  \"key\": \"v8-red-fox\",\n  \"name\": \"红·火绒狐军团\",\n  \"desc\": \"火绒狐+背带+圣火台快速铺场，红小鲨全体增益，☆朱雀/腾炎龙收尾\",\n  \"colors\": [\n   \"red\"\n  ],\n  \"list\": {\n   \"BP01-006\": 4,\n   \"TD01-004\": 4,\n   \"BP01-019\": 3,\n   \"BP01-017\": 3,\n   \"BP01-003\": 2,\n   \"BP01-012\": 4,\n   \"BP01-008\": 3,\n   \"BP01-009\": 2,\n   \"BP01-020\": 3,\n   \"BP01-002\": 4,\n   \"BP01-001\": 4,\n   \"TD01-002\": 4,\n   \"BP01-024\": 1,\n   \"TD01-023\": 1,\n   \"SS01-004\": 3,\n   \"TD01-011\": 1,\n   \"BP01-011\": 3,\n   \"TD01-005\": 1\n  }\n },\n {\n  \"key\": \"v8-red-gun\",\n  \"name\": \"红·重火力枪械\",\n  \"desc\": \"熔炉攒素材，步枪/霰弹枪/机关枪/手枪连续点杀，熔岩兽、焰煌压阵\",\n  \"colors\": [\n   \"red\"\n  ],\n  \"list\": {\n   \"BP01-016\": 3,\n   \"TD01-010\": 3,\n   \"BP01-020\": 4,\n   \"TD01-004\": 4,\n   \"BP01-008\": 3,\n   \"TD01-007\": 1,\n   \"BP01-001\": 3,\n   \"TD01-006\": 3,\n   \"TD01-024\": 4,\n   \"BP01-012\": 3,\n   \"BP01-014\": 4,\n   \"TD01-001\": 4,\n   \"BP01-099\": 3,\n   \"TD02-023\": 1,\n   \"BP01-013\": 3,\n   \"BP01-019\": 1,\n   \"BP01-009\": 3\n  }\n },\n {\n  \"key\": \"v8-blue-peng\",\n  \"name\": \"蓝·企丸丸大军\",\n  \"desc\": \"企丸丸+企丸王+火箭发射器堆打击力，疾旋鼬翻龙，覆海龙控场\",\n  \"colors\": [\n   \"blue\"\n  ],\n  \"list\": {\n   \"BP01-028\": 4,\n   \"TD01-014\": 3,\n   \"BP01-031\": 4,\n   \"BP01-044\": 4,\n   \"BP01-025\": 4,\n   \"BP01-027\": 3,\n   \"TD01-016\": 4,\n   \"BP01-047\": 2,\n   \"BP01-048\": 4,\n   \"BP01-036\": 2,\n   \"BP01-026\": 3,\n   \"TD01-013\": 1,\n   \"BP01-037\": 1,\n   \"TD01-015\": 1,\n   \"SS01-005\": 1,\n   \"TD02-023\": 4,\n   \"BP01-046\": 1,\n   \"TD01-023\": 4\n  }\n },\n {\n  \"key\": \"v8-blue-classic\",\n  \"name\": \"蓝·古典式庄园\",\n  \"desc\": \"古典式建筑群：镜子抽卡、窗帘弹回、化妆台宣言，雪猛犸/清雀镇守\",\n  \"colors\": [\n   \"blue\"\n  ],\n  \"list\": {\n   \"BP01-042\": 4,\n   \"TD01-019\": 3,\n   \"BP01-039\": 3,\n   \"TD01-018\": 4,\n   \"TD01-017\": 4,\n   \"TD01-016\": 4,\n   \"BP01-038\": 3,\n   \"BP01-035\": 2,\n   \"TD01-013\": 4,\n   \"BP01-037\": 4,\n   \"SS01-002\": 4,\n   \"BP01-099\": 2,\n   \"BP01-026\": 1,\n   \"BP01-036\": 1,\n   \"TD02-023\": 2,\n   \"BP01-098\": 2,\n   \"BP01-028\": 3\n  }\n },\n {\n  \"key\": \"v8-green-bee\",\n  \"name\": \"绿·花园蜂巢\",\n  \"desc\": \"骑士蜂不限张数，女皇蜂连锁召唤，牧场让蜂群+500，营火全体+1000\",\n  \"colors\": [\n   \"green\"\n  ],\n  \"list\": {\n   \"BP01-061\": 21,\n   \"BP01-053\": 4,\n   \"TD02-008\": 1,\n   \"BP01-049\": 3,\n   \"TD02-003\": 4,\n   \"BP01-057\": 3,\n   \"BP01-098\": 3,\n   \"BP01-056\": 4,\n   \"TD01-024\": 2,\n   \"TD02-024\": 2,\n   \"BP01-072\": 2,\n   \"BP01-071\": 1\n  }\n },\n {\n  \"key\": \"v8-green-giant\",\n  \"name\": \"绿·巨兽森林\",\n  \"desc\": \"波娜兔/趴趴鲶/牧场加速，百合女王、碎岩龟、森猛犸、铠格力斯硬碰硬\",\n  \"colors\": [\n   \"green\"\n  ],\n  \"list\": {\n   \"TD02-003\": 4,\n   \"BP01-057\": 4,\n   \"TD02-004\": 4,\n   \"BP01-066\": 3,\n   \"BP01-065\": 2,\n   \"BP01-049\": 4,\n   \"BP01-050\": 2,\n   \"TD02-007\": 2,\n   \"BP01-051\": 4,\n   \"TD02-023\": 3,\n   \"BP01-056\": 3,\n   \"BP01-061\": 1,\n   \"BP01-060\": 3,\n   \"BP01-098\": 4,\n   \"BP01-099\": 2,\n   \"TD02-009\": 1,\n   \"TD01-023\": 3,\n   \"TD01-024\": 1\n  }\n },\n {\n  \"key\": \"v8-purple-night\",\n  \"name\": \"紫·永夜猎场\",\n  \"desc\": \"劣质床/电灯制造黑夜，夜行性帕鲁、月镰魔破坏、雷冥鸟收割\",\n  \"colors\": [\n   \"purple\"\n  ],\n  \"list\": {\n   \"BP01-089\": 4,\n   \"BP01-080\": 4,\n   \"BP01-082\": 2,\n   \"SS01-003\": 4,\n   \"BP01-087\": 3,\n   \"TD02-018\": 4,\n   \"BP01-085\": 3,\n   \"BP01-077\": 2,\n   \"BP01-095\": 1,\n   \"TD02-015\": 3,\n   \"BP01-086\": 4,\n   \"TD02-020\": 2,\n   \"BP01-096\": 1,\n   \"BP01-084\": 4,\n   \"BP01-093\": 1,\n   \"BP01-078\": 2,\n   \"BP01-083\": 3,\n   \"BP01-079\": 2,\n   \"TD02-024\": 1\n  }\n },\n {\n  \"key\": \"v8-purple-grave\",\n  \"name\": \"紫·冥府轮回\",\n  \"desc\": \"猫蝠怪/朋克蜥/切肉刀填墓地，制药台复活，黑月女王、魔渊龙压轴\",\n  \"colors\": [\n   \"purple\"\n  ],\n  \"list\": {\n   \"BP01-076\": 4,\n   \"BP01-093\": 1,\n   \"BP01-090\": 3,\n   \"BP01-078\": 3,\n   \"TD02-016\": 1,\n   \"TD02-017\": 4,\n   \"BP01-095\": 3,\n   \"BP01-079\": 4,\n   \"BP01-083\": 3,\n   \"BP01-081\": 4,\n   \"BP01-082\": 1,\n   \"TD02-013\": 4,\n   \"TD02-019\": 1,\n   \"SS01-005\": 4,\n   \"BP01-099\": 4,\n   \"BP01-086\": 1,\n   \"TD01-023\": 1,\n   \"TD02-018\": 3,\n   \"BP01-074\": 1\n  }\n },\n {\n  \"key\": \"v8-rb-dragon\",\n  \"name\": \"红蓝·双龙怒涛\",\n  \"desc\": \"疾旋鼬翻出腾炎龙/覆海龙，熔炉与帕鲁球加速，严冬鹿/冰棘兽控场\",\n  \"colors\": [\n   \"red\",\n   \"blue\"\n  ],\n  \"list\": {\n   \"BP01-025\": 4,\n   \"BP01-001\": 2,\n   \"BP01-027\": 2,\n   \"TD01-010\": 4,\n   \"TD01-004\": 4,\n   \"BP01-005\": 4,\n   \"TD01-016\": 4,\n   \"BP01-038\": 4,\n   \"TD01-012\": 4,\n   \"BP01-026\": 4,\n   \"BP01-012\": 4,\n   \"BP01-032\": 4,\n   \"TD01-005\": 3,\n   \"BP01-014\": 3\n  }\n },\n {\n  \"key\": \"v8-bp-control\",\n  \"name\": \"蓝紫·冰封控制\",\n  \"desc\": \"严冬鹿/冰棘兽横置，暗黑炮与黑暗一击精确除去，邪麒麟、覆海龙终结\",\n  \"colors\": [\n   \"blue\",\n   \"purple\"\n  ],\n  \"list\": {\n   \"TD01-016\": 3,\n   \"BP01-038\": 4,\n   \"TD01-012\": 4,\n   \"BP01-025\": 4,\n   \"BP01-027\": 3,\n   \"BP01-077\": 2,\n   \"TD02-017\": 3,\n   \"TD02-021\": 2,\n   \"BP01-095\": 2,\n   \"BP01-096\": 4,\n   \"BP01-048\": 3,\n   \"BP01-036\": 1,\n   \"BP01-098\": 1,\n   \"TD01-015\": 1,\n   \"TD02-023\": 4,\n   \"TD02-014\": 4,\n   \"BP01-087\": 4,\n   \"SS01-003\": 1\n  }\n },\n {\n  \"key\": \"v8-gp-ramp\",\n  \"name\": \"绿紫·灵魂洪流\",\n  \"desc\": \"饲料箱/售货机/趴趴鲶加速灵魂，花丽娜与狱阎王、异构格里芬大型压制\",\n  \"colors\": [\n   \"green\",\n   \"purple\"\n  ],\n  \"list\": {\n   \"BP01-065\": 3,\n   \"TD02-003\": 4,\n   \"TD02-004\": 3,\n   \"BP01-057\": 4,\n   \"BP01-049\": 4,\n   \"BP01-050\": 2,\n   \"BP01-095\": 4,\n   \"TD02-021\": 4,\n   \"BP01-076\": 4,\n   \"BP01-077\": 4,\n   \"BP01-051\": 4,\n   \"TD01-024\": 4,\n   \"TD02-005\": 3,\n   \"TD02-006\": 2,\n   \"BP01-093\": 1\n  }\n },\n {\n  \"key\": \"v8-rg-break\",\n  \"name\": \"红绿·突破猛攻\",\n  \"desc\": \"碎岩龟+头巾突破伤害，勇敢帕鲁与岩石冲击强攻，营火全体增益\",\n  \"colors\": [\n   \"red\",\n   \"green\"\n  ],\n  \"list\": {\n   \"BP01-059\": 3,\n   \"BP01-068\": 2,\n   \"BP01-050\": 4,\n   \"BP01-049\": 2,\n   \"BP01-006\": 4,\n   \"TD01-004\": 4,\n   \"BP01-020\": 1,\n   \"BP01-060\": 4,\n   \"BP01-098\": 3,\n   \"TD02-005\": 2,\n   \"TD01-002\": 3,\n   \"TD01-006\": 1,\n   \"TD01-023\": 4,\n   \"TD02-001\": 4,\n   \"TD01-024\": 3,\n   \"BP01-018\": 2,\n   \"BP01-011\": 1,\n   \"TD02-010\": 1,\n   \"TD02-023\": 1,\n   \"TD02-006\": 1\n  }\n },\n {\n  \"key\": \"v8-rp-burn\",\n  \"name\": \"红紫·焦土\",\n  \"desc\": \"伏特喵/手枪/霰弹枪造成伤害，黑暗一击补刀，夜幕魔蝠、焰煌收尾\",\n  \"colors\": [\n   \"red\",\n   \"purple\"\n  ],\n  \"list\": {\n   \"BP01-008\": 4,\n   \"TD02-021\": 4,\n   \"BP01-095\": 4,\n   \"BP01-012\": 4,\n   \"BP01-077\": 4,\n   \"TD02-018\": 3,\n   \"TD01-007\": 2,\n   \"BP01-002\": 3,\n   \"TD02-015\": 3,\n   \"BP01-086\": 4,\n   \"BP01-021\": 2,\n   \"BP01-098\": 4,\n   \"TD01-006\": 4,\n   \"BP01-085\": 1,\n   \"BP01-017\": 4\n  }\n },\n {\n  \"key\": \"v8-starter\",\n  \"name\": \"无色·起始冒险团\",\n  \"desc\": \"三种起始帕鲁 + 冒险的开始：全体+1000、打击力+5 一回合斩杀\",\n  \"colors\": [\n   \"blue\",\n   \"purple\"\n  ],\n  \"list\": {\n   \"TD02-023\": 4,\n   \"TD02-024\": 4,\n   \"TD01-023\": 4,\n   \"BP01-100\": 4,\n   \"BP01-047\": 4,\n   \"BP01-046\": 1,\n   \"TD02-021\": 2,\n   \"TD02-015\": 4,\n   \"TD01-016\": 4,\n   \"TD02-017\": 3,\n   \"BP01-081\": 4,\n   \"TD01-017\": 4,\n   \"BP01-033\": 4,\n   \"BP01-093\": 1,\n   \"BP01-028\": 1,\n   \"BP01-080\": 1,\n   \"BP01-030\": 1\n  }\n },\n {\n  \"key\": \"v8-bg-tempo\",\n  \"name\": \"蓝绿·潮汐农场\",\n  \"desc\": \"浆果农园/牧场抽卡攒资源，严冬鹿横置节奏，百合女王/覆海龙双☆压制\",\n  \"colors\": [\n   \"blue\",\n   \"green\"\n  ],\n  \"list\": {\n   \"TD02-008\": 4,\n   \"BP01-057\": 4,\n   \"TD01-016\": 4,\n   \"BP01-025\": 4,\n   \"BP01-027\": 2,\n   \"BP01-049\": 2,\n   \"TD02-004\": 4,\n   \"BP01-051\": 4,\n   \"BP01-026\": 2,\n   \"TD01-013\": 4,\n   \"BP01-060\": 4,\n   \"BP01-098\": 2,\n   \"BP01-042\": 1,\n   \"TD01-024\": 1,\n   \"TD01-015\": 2,\n   \"BP01-061\": 1,\n   \"TD02-001\": 2,\n   \"TD02-002\": 3\n  }\n }\n]",
"/app/server/engine/deck_winrates.json": "{\n \"v8-bg-tempo\": 0.772,\n \"v8-rb-dragon\": 0.761,\n \"v8-blue-classic\": 0.699,\n \"v8-bp-control\": 0.645,\n \"v8-blue-peng\": 0.638,\n \"v8-gp-ramp\": 0.63,\n \"meta-gp-big\": 0.605,\n \"v8-green-giant\": 0.591,\n \"meta-bp-penguin\": 0.536,\n \"v8-starter\": 0.511,\n \"v8-rg-break\": 0.504,\n \"v8-rp-burn\": 0.496,\n \"meta-bp-dragon\": 0.486,\n \"meta-rb-gun\": 0.475,\n \"v8-red-fox\": 0.464,\n \"v8-purple-grave\": 0.446,\n \"v8-green-bee\": 0.442,\n \"v8-purple-night\": 0.442,\n \"meta-gp-ramp\": 0.42,\n \"v8-red-gun\": 0.384,\n \"meta-rb-fire\": 0.286,\n \"meta-starter\": 0.156\n}",
"/app/server/ai_value.json": "{\"dim\": 346, \"mu\": [0.7144821286201477, 0.9686030149459839, 0.8883049488067627, 0.06675397604703903, 0.4684440791606903, 0.9164032936096191, 5.5858636187622324e-05, 0.36551138758659363, 0.0004652109055314213, 0.7411230802536011, 0.23411047458648682, 0.25910601019859314, 0.09126013517379761, 0.13581925630569458, 0.341092586517334, 0.12067782878875732, 0.14179827272891998, 0.1545056849718094, 0.1254391223192215, 0.042475808411836624, 0.05690735578536987, 0.0, 0.09710179269313812, 1.0, 1.704384446144104, 0.4185045063495636, 0.14868858456611633, 0.0, 1.708487629890442, 1.5965572595596313, 1.5706228017807007, 1.1142021417617798, 0.11648288369178772, 0.366485595703125, 0.5713698863983154, 0.4466288387775421, 0.10437879711389542, 0.09064209461212158, 0.1207088977098465, 0.03716246038675308, 0.09314507991075516, 0.00950823724269867, 0.016877703368663788, 0.01637142337858677, 0.02990148216485977, 0.7506263852119446, 0.15951159596443176, 0.16268101334571838, 0.058320287615060806, 0.37855494022369385, 0.33531454205513, 0.0, 0.02538113109767437, 0.38516756892204285, 0.4987756311893463, 0.32219260931015015, 0.6619189977645874, 0.07222489267587662, 0.28552091121673584, 0.3576631546020508, 0.2684391736984253, 0.06626836210489273, 0.14529961347579956, 0.8471578359603882, 0.5168699622154236, 0.8188087940216064, 0.0, 0.0, 0.0, 0.7843868136405945, 0.8959105014801025, 0.7420011758804321, 0.6241676211357117, 0.10136598348617554, 0.08932215720415115, 0.3032781481742859, 0.3161172568798065, 0.09691634774208069, 0.08364459127187729, 0.11344791948795319, 0.03100961446762085, 0.07764673233032227, 0.009105280041694641, 0.015903890132904053, 0.015185799449682236, 0.027847951278090477, 0.410726934671402, 0.12855106592178345, 0.14273980259895325, 0.02957085147500038, 0.13543233275413513, 0.2109893560409546, 0.0, 0.0, 0.24135063588619232, 0.18036462366580963, 0.18361669778823853, 0.3240911364555359, 0.0644240528345108, 0.174087792634964, 0.16195516288280487, 0.09927725791931152, 0.049369990825653076, 0.09022105485200882, 0.4335353374481201, 0.3042248487472534, 0.623379111289978, 0.11431194841861725, 0.07896796613931656, 0.1202290877699852, 0.5946456789970398, 0.6066867709159851, 0.6795283555984497, 0.0, 0.0, 0.13516563177108765, 0.17921355366706848, 0.2218359410762787, 0.07750014215707779, 0.03195178508758545, 0.04314352944493294, 0.020999617874622345, 0.03534786030650139, 0.005754407960921526, 0.004431236535310745, 0.006319452077150345, 0.017172817140817642, 0.1973462998867035, 0.07054977864027023, 0.07219518721103668, 0.023727327585220337, 0.13167397677898407, 0.17553237080574036, 0.0, 0.00753219798207283, 0.20694752037525177, 0.1841481626033783, 0.09875225275754929, 0.2953055500984192, 0.029813658446073532, 0.11012481153011322, 0.1260157823562622, 0.08815525472164154, 0.0322197787463665, 0.060659248381853104, 0.23844727873802185, 0.2658638656139374, 0.7843816876411438, 0.8845321536064148, 0.2279548943042755, 0.3458395004272461, 0.4412599503993988, 0.188354030251503, 0.13170652091503143, 0.18676285445690155, 0.11571584641933441, 0.042342957109212875, 0.06616762280464172, 0.05400141701102257, 0.010152215138077736, 0.017834724858403206, 0.017887677997350693, 0.0, 0.0, 0.0, 0.1516539752483368, 0.7372643947601318, 0.6998316645622253, 0.6284019947052002, 0.7144821286201477, 0.9686030149459839, 0.8883049488067627, 0.06675397604703903, 0.4684440791606903, 0.9164032936096191, 5.5858636187622324e-05, 0.36551132798194885, 0.0004652109055314213, 0.7411230802536011, 0.23411047458648682, 0.2591060400009155, 0.09126013517379761, 0.13581925630569458, 0.34109264612197876, 0.12067782878875732, 0.14179827272891998, 0.1545056849718094, 0.1254391223192215, 0.042475808411836624, 0.05690735578536987, 0.0, 0.09710179269313812, 0.0, 1.704384446144104, 0.4185045063495636, 0.14868858456611633, 0.0, 1.708487629890442, 1.5965572595596313, 1.5706229209899902, 1.1142021417617798, 0.11648288369178772, 0.366485595703125, 0.5713698863983154, 0.4466288387775421, 0.10437879711389542, 0.09064209461212158, 0.1207088977098465, 0.03716246038675308, 0.09314507991075516, 0.00950823724269867, 0.016877703368663788, 0.01637142337858677, 0.02990148216485977, 0.7506263852119446, 0.15951159596443176, 0.16268101334571838, 0.058320287615060806, 0.37855494022369385, 0.33531454205513, 0.0, 0.02538113109767437, 0.38516756892204285, 0.4987756311893463, 0.32219260931015015, 0.6619189977645874, 0.07222489267587662, 0.28552091121673584, 0.3576631546020508, 0.2684391736984253, 0.06626836210489273, 0.14529961347579956, 0.8471578359603882, 0.5168699622154236, 0.8188087940216064, 0.0, 0.0, 0.0, 0.7843868136405945, 0.8959105014801025, 0.7420012354850769, 0.6241676211357117, 0.10136598348617554, 0.08932215720415115, 0.3032781481742859, 0.3161172568798065, 0.09691634774208069, 0.08364459127187729, 0.11344791948795319, 0.03100961446762085, 0.07764673233032227, 0.009105280041694641, 0.015903890132904053, 0.015185799449682236, 0.027847951278090477, 0.410726934671402, 0.12855106592178345, 0.14273980259895325, 0.02957085147500038, 0.13543233275413513, 0.2109893560409546, 0.0, 0.0, 0.24135063588619232, 0.18036462366580963, 0.18361669778823853, 0.3240911364555359, 0.0644240528345108, 0.174087792634964, 0.16195516288280487, 0.09927725791931152, 0.049369990825653076, 0.09022105485200882, 0.4335353374481201, 0.3042248487472534, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.7843816876411438, 0.8845321536064148, 0.2279548943042755, 0.3458395004272461, 0.4412599503993988, 0.188354030251503, 0.13170652091503143, 0.18676285445690155, 0.11571584641933441, 0.042342957109212875, 0.06616762280464172, 0.05400141701102257, 0.010152215138077736, 0.017834724858403206, 0.017887677997350693, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.39086079597473145, 0.03870454430580139, 0.5, 1.0, 0.0, 0.0, 1.0], \"sd\": [0.2608060836791992, 0.12568311393260956, 0.21865132451057434, 0.2505354583263397, 0.21815286576747894, 0.15469655394554138, 0.006203420460224152, 0.30791521072387695, 0.008991500362753868, 0.27637946605682373, 0.30755534768104553, 0.2762196362018585, 0.2451506406068802, 0.32859933376312256, 0.2590358555316925, 0.19322741031646729, 0.24258391559123993, 0.30763888359069824, 0.22078657150268555, 0.2029200941324234, 0.23275217413902283, 0.65962153673172, 0.17294377088546753, 0.0010000000474974513, 1.2911769151687622, 0.775745153427124, 0.4561012387275696, 0.0010000000474974513, 1.5365458726882935, 1.3605594635009766, 1.2535109519958496, 1.1525779962539673, 0.32089895009994507, 0.5740187764167786, 0.5901986360549927, 0.5776521563529968, 0.33199143409729004, 0.5557711720466614, 0.6295855045318604, 0.21123939752578735, 0.4147901237010956, 0.10193701833486557, 0.13772574067115784, 0.13744331896305084, 0.18357768654823303, 0.9884163737297058, 0.42137229442596436, 0.421013742685318, 0.2670347988605499, 0.7094249725341797, 0.6506242156028748, 0.0010000000474974513, 0.18190579116344452, 0.7045965790748596, 0.8138370513916016, 0.6166536808013916, 0.9222482442855835, 0.29033362865448, 0.5871032476425171, 0.7968475222587585, 0.6234808564186096, 0.2735652029514313, 0.4649414122104645, 1.0283844470977783, 0.7841089963912964, 0.38572782278060913, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.6051503419876099, 0.5781700611114502, 0.46641936898231506, 0.48522165417671204, 0.2714298367500305, 0.19232583045959473, 0.272350937128067, 0.3715299069881439, 0.2972017228603363, 0.4955592751502991, 0.5742985606193542, 0.1743738353252411, 0.31479284167289734, 0.09584604203701019, 0.12638044357299805, 0.12316803634166718, 0.16586443781852722, 0.4929873049259186, 0.33496829867362976, 0.3501167893409729, 0.17063096165657043, 0.3432891070842743, 0.4082475006580353, 0.0010000000474974513, 0.0010000000474974513, 0.42881762981414795, 0.3850904703140259, 0.38885924220085144, 0.4684227406978607, 0.24626870453357697, 0.38101813197135925, 0.3697039783000946, 0.30004942417144775, 0.21703407168388367, 0.28718101978302, 0.4961342215538025, 0.46160590648651123, 0.4163050055503845, 0.18213671445846558, 0.15415126085281372, 0.19442790746688843, 0.39976823329925537, 0.43890154361724854, 0.3688669502735138, 0.0010000000474974513, 0.0010000000474974513, 0.14486686885356903, 0.16582044959068298, 0.22444944083690643, 0.15972033143043518, 0.16780999302864075, 0.1924777776002884, 0.08175636827945709, 0.12215989828109741, 0.04249835014343262, 0.03688006475567818, 0.04407738521695137, 0.07390382885932922, 0.2581424117088318, 0.1427350491285324, 0.14343143999576569, 0.08359934389591217, 0.20990559458732605, 0.2391452044248581, 0.0010000000474974513, 0.04837720841169357, 0.2699371874332428, 0.22507600486278534, 0.16780930757522583, 0.27781906723976135, 0.09682675451040268, 0.1780383586883545, 0.22687393426895142, 0.16385331749916077, 0.09814213961362839, 0.15465795993804932, 0.2719251811504364, 0.2831071615219116, 0.605157732963562, 0.5764127969741821, 0.4203754663467407, 0.45353972911834717, 0.5152263045310974, 0.39184123277664185, 0.2791273295879364, 0.3595878779888153, 0.32064080238342285, 0.14888215065002441, 0.2134888619184494, 0.22668024897575378, 0.06664267927408218, 0.10789347440004349, 0.13371403515338898, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.03894694894552231, 0.11176050454378128, 0.07758301496505737, 0.10909754782915115, 0.2608061134815216, 0.12568311393260956, 0.21865132451057434, 0.2505354583263397, 0.21815286576747894, 0.15469655394554138, 0.006203420460224152, 0.30791521072387695, 0.008991500362753868, 0.27637946605682373, 0.30755534768104553, 0.2762196362018585, 0.2451506406068802, 0.32859933376312256, 0.2590358555316925, 0.19322741031646729, 0.24258391559123993, 0.30763888359069824, 0.22078657150268555, 0.2029200941324234, 0.23275215923786163, 0.65962153673172, 0.17294377088546753, 0.0010000000474974513, 1.2911769151687622, 0.775745153427124, 0.4561012387275696, 0.0010000000474974513, 1.536545753479004, 1.3605594635009766, 1.2535109519958496, 1.1525781154632568, 0.32089895009994507, 0.5740187764167786, 0.5901986360549927, 0.5776521563529968, 0.33199143409729004, 0.5557711720466614, 0.6295855045318604, 0.21123941242694855, 0.4147901237010956, 0.10193701833486557, 0.13772572576999664, 0.13744331896305084, 0.18357768654823303, 0.9884163737297058, 0.42137229442596436, 0.421013742685318, 0.2670347988605499, 0.7094249725341797, 0.6506242156028748, 0.0010000000474974513, 0.18190579116344452, 0.7045965194702148, 0.8138370513916016, 0.6166536808013916, 0.9222483038902283, 0.29033362865448, 0.5871032476425171, 0.7968475222587585, 0.6234808564186096, 0.2735652029514313, 0.4649414122104645, 1.0283844470977783, 0.7841089963912964, 0.38572782278060913, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.6051503419876099, 0.5781700611114502, 0.46641936898231506, 0.48522165417671204, 0.2714298367500305, 0.19232583045959473, 0.272350937128067, 0.3715299069881439, 0.2972017228603363, 0.4955592751502991, 0.5742985606193542, 0.1743738353252411, 0.31479284167289734, 0.09584604203701019, 0.12638044357299805, 0.12316803634166718, 0.16586443781852722, 0.4929873049259186, 0.33496832847595215, 0.3501167893409729, 0.17063096165657043, 0.3432891070842743, 0.4082475006580353, 0.0010000000474974513, 0.0010000000474974513, 0.42881762981414795, 0.3850904703140259, 0.38885924220085144, 0.4684227406978607, 0.24626868963241577, 0.38101813197135925, 0.3697039783000946, 0.30004945397377014, 0.21703407168388367, 0.28718101978302, 0.4961342215538025, 0.46160590648651123, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.605157732963562, 0.5764127969741821, 0.42037543654441833, 0.45353972911834717, 0.5152263045310974, 0.39184123277664185, 0.2791273295879364, 0.3595878779888153, 0.32064080238342285, 0.14888215065002441, 0.2134888619184494, 0.22668024897575378, 0.06664267927408218, 0.10789348185062408, 0.13371403515338898, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.5009999871253967, 0.1982581615447998, 0.1943507045507431, 0.5009999871253967, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513], \"W1\": [[0.12104501575231552, -0.12185756117105484, 0.07120626419782639, 0.06103276461362839, 0.041817355901002884, -0.014886109158396721, -0.002104765037074685, 0.09727471321821213, -0.07779943943023682, -0.02267630770802498, -0.10292357951402664, 0.021598946303129196, -0.1948344111442566, -0.06254026293754578, -0.05495994910597801, -0.0063893855549395084, -0.1026189774274826, -0.09679380804300308, 0.08297821134328842, -0.07543874531984329, -0.014037402346730232, 0.038383424282073975, -0.04748732969164848, -0.03423561900854111, 0.08952762186527252, 0.04848577082157135, -0.02596629224717617, -0.14244471490383148, -0.008407142013311386, -0.06257979571819305, -0.015447021462023258, -0.08846885710954666, 0.014610536396503448, 0.0169826652854681, 0.10348399728536606, -0.0293855220079422, 0.009032705798745155, -0.0636637955904007, 0.04675639793276787, 0.06116458401083946, -0.09357849508523941, -0.011435259133577347, 0.09769249707460403, 0.05883049592375755, 0.06268560141324997, 0.043928977102041245, 0.054062455892562866, 0.06584116071462631], [0.0524759478867054, 0.016527436673641205, 0.10400251299142838, -0.06423880904912949, 0.04401760920882225, -0.019829923287034035, 0.00318715488538146, 0.011856974102556705, -0.0032531600445508957, 0.0006820681737735868, -0.033562809228897095, 0.029483553022146225, -0.031071245670318604, -0.04635850712656975, -0.004122575744986534, -0.0037606279365718365, 0.0021073012612760067, -0.0442732609808445, 0.014014888554811478, -0.0016901751514524221, 0.014517406933009624, -0.021248653531074524, 0.03119383007287979, -0.0448143444955349, 0.04889720305800438, -0.04446381330490112, -0.0038269576616585255, -0.020697645843029022, -0.0199968833476305, -0.016382263973355293, -0.01524750329554081, 0.06313082575798035, 0.0367899015545845, -0.011927432380616665, 0.023594260215759277, 0.027159787714481354, 0.015487942844629288, 0.056206297129392624, 0.04433848708868027, -0.011983315460383892, -0.02148526906967163, 0.0008182631572708488, -0.01937519945204258, 0.05047027766704559, 0.004420476965606213, 0.04311942309141159, 0.04649478197097778, 0.0008075024816207588], [0.11035647988319397, -0.028764285147190094, 0.09087177366018295, 0.00017576446407474577, 0.08372406661510468, 0.02754596434533596, 0.0007356869173236191, 0.019657088443636894, -0.03466475382447243, -0.025857429951429367, -0.07462704926729202, 0.030998410657048225, -0.15388153493404388, -0.024506965652108192, -0.03270125389099121, -0.010433063842356205, -0.06266478449106216, -0.07176636904478073, 0.05964844301342964, -0.0737585499882698, 0.05137310549616814, 0.0383068285882473, 0.026219621300697327, -0.006944466847926378, 0.07457255572080612, 0.02044825069606304, 0.022610340267419815, -0.11673884838819504, 0.012292561121284962, -0.07356013357639313, -0.02754041738808155, -0.039322372525930405, 0.02003774233162403, -0.02778194099664688, 0.06908030062913895, 0.008780254982411861, 0.062449898570775986, 0.04822266846895218, 0.03034735843539238, 0.03510355204343796, -0.011153347790241241, 0.012196188792586327, -0.02983188070356846, 0.07541367411613464, 0.060919251292943954, 0.0771242156624794, 0.07027799636125565, 0.012535392306745052], [-0.0316050723195076, -0.018388202413916588, -0.11471977829933167, 0.006737360265105963, -0.052113126963377, 0.035196367651224136, -0.014543266035616398, -0.00012676152982749045, -0.006367414258420467, 0.007599974516779184, 0.021053044125437737, -0.022749468684196472, 0.019109295681118965, -0.004249273799359798, 0.0003619807830546051, -0.0014455756172537804, 0.011039110831916332, 0.01579626277089119, 0.002726826583966613, -0.0014958212850615382, 0.003524302737787366, -0.007064809091389179, -0.023238642141222954, 0.03086244687438011, 0.043894171714782715, 0.04700644314289093, 0.00509303342550993, -0.024511853232979774, 0.004756427835673094, 0.01663738116621971, 0.01814035139977932, -0.04285358637571335, -0.041609808802604675, 0.018002893775701523, -0.0790189579129219, -0.03206571936607361, -0.027625270187854767, -0.06673438847064972, -0.0328863300383091, -0.002544427989050746, -0.0022861380130052567, 0.002289218595251441, -0.007254434749484062, 0.04080848768353462, -0.009906617924571037, -0.0499928742647171, -0.05016477406024933, -0.009629832580685616], [0.08709295839071274, -0.05918338522315025, 0.02542876824736595, 0.057164255529642105, -0.02548103593289852, -0.03219754993915558, -0.006134727504104376, 0.016775617375969887, -0.06135191768407822, 0.009397328831255436, -0.02037212811410427, 0.002636191202327609, 0.015576761215925217, -0.01780002750456333, -0.016378967091441154, 0.0038943602703511715, -0.056894298642873764, 0.022647004574537277, -0.001866543316282332, 0.02587774395942688, -0.08515297621488571, -0.003425779053941369, -0.045050762593746185, -0.013483523391187191, 0.05850399285554886, 0.01756785437464714, -0.0073183332569897175, 0.094341941177845, -0.03359401226043701, -0.023647358641028404, 0.016371242702007294, 0.006302007474005222, 0.04472574591636658, -0.05123670771718025, 0.06493353843688965, -0.01500131655484438, 0.02192460186779499, -0.033943455666303635, 0.0037268702872097492, 0.006393452640622854, 0.016274886205792427, 0.0014208724023774266, -0.019467702135443687, -0.016374407336115837, -0.011874954216182232, -0.02298445999622345, -0.05531507357954979, -0.06208028271794319], [0.03754694387316704, -0.01371478196233511, 0.04474809765815735, -0.021875426173210144, 0.08134136348962784, 0.027144286781549454, -0.01988385058939457, 0.04744592308998108, -0.004494847264140844, -0.04353020340204239, 0.005234042648226023, -0.0016360525041818619, -0.0015678121708333492, -0.011159691959619522, 0.026593826711177826, -0.012452462688088417, -0.02102847956120968, -0.01689048483967781, -0.020458517596125603, 0.018856311216950417, -0.025073135271668434, -0.030123621225357056, -0.007036695722490549, 0.008649177849292755, -0.025129610672593117, -0.01680709980428219, -0.00952217448502779, -0.01115119643509388, 0.009890684857964516, -0.0131682138890028, 0.04999794065952301, 0.0011682691983878613, -0.025290964171290398, 0.008914865553379059, -0.026196572929620743, 0.01424490101635456, 0.02650371566414833, -0.023880064487457275, -0.01594233326613903, 0.004315888974815607, -0.0003478649305179715, -0.015799127519130707, -0.005250789225101471, -0.03826867789030075, -0.010255337692797184, 0.009263625368475914, -0.031138280406594276, 0.00563797214999795], [0.005490930750966072, -0.015731973573565483, -0.001295739901252091, 0.020414389669895172, 0.0034337311517447233, -0.01618264801800251, -0.003312799148261547, 0.00026947882724925876, -0.012410336174070835, 0.006314869970083237, -0.02928946353495121, -0.012701867148280144, -0.013149156235158443, -0.0033482846338301897, 0.0018464606255292892, 0.0034643406979739666, -0.0006098200101405382, -0.018052546307444572, -0.0026205219328403473, -0.022282959893345833, -0.018924210220575333, -0.0005020813550800085, -0.0032456384506076574, -0.0008655729470774531, 0.017204459756612778, 0.011545037850737572, 0.0037927778903394938, 0.0019405477214604616, 0.00842276681214571, -0.015566512010991573, 0.010024458169937134, -0.023023786023259163, 0.007287352345883846, 0.009898846969008446, 0.014885922893881798, -0.012590599246323109, 0.003564329817891121, -0.012844759970903397, 5.355435860110447e-05, 0.017576899379491806, -0.015799013897776604, -0.020757785066962242, 0.007675096392631531, -0.009840838611125946, 0.00965200737118721, 0.0007458259351551533, 0.003995523788034916, 0.00873819924890995], [-0.030475324019789696, -0.01587601564824581, 0.018435021862387657, -0.04465808719396591, -0.06667838245630264, -0.011069866828620434, 0.02737194113433361, 0.03779269754886627, 0.01414871122688055, 0.013312901370227337, -0.004866259638220072, 0.004559061955660582, 0.06555574387311935, 0.00044789325329475105, -0.0270510446280241, 0.008619432337582111, 0.0036672779824584723, 0.007046092301607132, 0.032560113817453384, 0.026158569380640984, 0.007349283900111914, 0.023131471127271652, 0.014717554673552513, 0.008998802863061428, -0.0234358012676239, 0.045586083084344864, 0.021136661991477013, -0.013223443180322647, -0.050257403403520584, 0.010826707817614079, -0.005741904489696026, 0.003741496242582798, -0.023287340998649597, 0.003382214577868581, 0.0015606025699526072, -0.020804377272725105, -0.004385985899716616, 0.037447795271873474, -0.04747599735856056, -0.003882246557623148, 0.010272422805428505, 0.03062709979712963, 0.00026799197075888515, 0.045425526797771454, -0.02516031265258789, -0.04674234613776207, -0.009040949866175652, -0.019247280433773994], [0.008918024599552155, -0.03197620436549187, -0.062252841889858246, -0.03877528756856918, 0.0002019379026023671, -0.002522413618862629, 0.02484516054391861, -0.0010783388279378414, -0.001551505527459085, 0.030315373092889786, 0.000650075264275074, 0.0172146987169981, 0.01603812351822853, -0.0014729674439877272, -0.029275383800268173, 0.009516976773738861, -0.01119237020611763, -0.03521440178155899, -0.032482847571372986, 0.04181961715221405, -0.03552032634615898, 0.024418257176876068, 0.003758825361728668, 0.011460216715931892, -0.012061874382197857, -0.010338937863707542, -0.006191092077642679, 0.028612781316041946, -0.016936538740992546, -0.014302237890660763, -0.013946245424449444, 0.023788049817085266, 0.0433209128677845, 0.013452962040901184, 0.04175407439470291, -0.013957311399281025, -0.016367143020033836, -0.003770108101889491, 0.04071999341249466, -0.02675306238234043, 0.025955844670534134, -0.020875727757811546, -0.03057592734694481, 0.006831895560026169, -0.003612964181229472, 0.03106662444770336, 0.07873670756816864, 0.002602617023512721], [0.041182003915309906, 0.021618584170937538, 0.0009451113874092698, 0.04507346451282501, -0.062237683683633804, 0.05739372596144676, 0.010611517354846, 0.0007755502592772245, 0.011669456027448177, 0.025285299867391586, 0.01798120327293873, 0.013708485290408134, 0.0339982733130455, 0.05480807274580002, -0.03344723954796791, -0.0004898415645584464, 0.062179531902074814, 0.02341938577592373, 0.004954956006258726, -0.0028750060591846704, 0.040929339826107025, 0.008376571349799633, 0.023322904482483864, -0.03144733980298042, -0.010249122977256775, 0.019243137910962105, 0.005985117983072996, 0.03972277045249939, -0.03145000711083412, -0.011349604465067387, -0.028520304709672928, 0.007663401309400797, 0.03986077010631561, 0.033753011375665665, 0.02485770732164383, -0.03630762919783592, -0.019880736246705055, 0.03828614577651024, -0.09849346429109573, 0.0034380173310637474, 0.003092742059379816, 0.0331803597509861, 0.004874741658568382, 0.024556877091526985, -0.0015096167335286736, -0.02494138851761818, -0.07234232127666473, 0.028196359053254128], [0.0017753717256709933, 0.0060919951647520065, 0.15529632568359375, 0.06076943501830101, -0.023710455745458603, -0.12023178488016129, 0.03858845308423042, 0.009068596176803112, 0.05636029690504074, -0.007676861248910427, 0.005260430742055178, 0.02848062850534916, -0.0762198269367218, -0.0535031221807003, -0.009949862025678158, 0.024533024057745934, -0.10715046525001526, 0.010139345191419125, -0.22489312291145325, 0.0823577418923378, -0.04739100858569145, -0.001737525686621666, -0.11243783682584763, -0.025508368387818336, 0.12154895812273026, -0.08960533887147903, -0.060822494328022, -0.12773533165454865, -0.02403499186038971, 0.01280973944813013, -0.01300511322915554, -0.007569935172796249, 0.04034975916147232, -0.026831189170479774, 0.143980473279953, -0.006542942952364683, 0.2237735092639923, -0.17188112437725067, 0.021929850801825523, 0.0427827313542366, -0.043776098638772964, -0.010035631246864796, 0.04963573440909386, 0.052906110882759094, 0.02844073809683323, -0.014282796531915665, 0.09743029624223709, -0.08747569471597672], [-0.025921760126948357, 0.04499194398522377, 0.02095716819167137, -0.007978924550116062, -0.006288309581577778, 0.044919975101947784, -0.006777035538107157, -0.024953685700893402, -0.01621781289577484, -0.013150950893759727, -0.024104377254843712, -0.012390047311782837, -0.01957576535642147, -0.015072313137352467, 0.051427483558654785, 0.0005316670285537839, -0.025587139651179314, -0.03259256109595299, 0.0032764405477792025, 0.014370672404766083, 0.030174950137734413, -0.008129686117172241, -0.011873612180352211, 0.00259907403960824, -0.0006266673444770277, 0.00027065910398960114, -0.04795815423130989, -0.024228231981396675, -0.008572418242692947, -0.00024348788429051638, 0.02625347301363945, -0.0027558596339076757, -0.03422579541802406, -0.03517758101224899, -0.03465958684682846, 0.08209613710641861, -0.0021960092708468437, -0.0356106162071228, 0.059322912245988846, -0.007749424781650305, 0.008467591367661953, -0.0018264675745740533, 0.019375741481781006, -0.0010655691148713231, 0.005575379356741905, -0.008238089270889759, -0.025113878771662712, 0.031413689255714417], [-0.04137425124645233, -0.018123891204595566, 0.05509202554821968, -0.03322869911789894, 0.025160513818264008, -0.0061729345470666885, -0.007326219230890274, 0.049587804824113846, 0.025113124400377274, -0.038556285202503204, -0.033001676201820374, -0.0028290909249335527, -0.04922230914235115, 0.04910716414451599, -0.029079217463731766, -0.014246334321796894, -0.008069860748946667, -0.005982172675430775, 0.0024308059364557266, 0.04479999840259552, -0.03155528008937836, -0.012462032027542591, -0.032487884163856506, -0.05488250032067299, -0.011639567092061043, -0.01420650165528059, -0.008172241039574146, 0.08774719387292862, 0.020206930115818977, -0.054697275161743164, -0.0061540245078504086, 0.04572780802845955, -0.01687755435705185, -0.04366455599665642, -0.03942704573273659, -0.010973435826599598, 0.014708021655678749, 0.014874961227178574, 0.029305486008524895, -0.025154003873467445, 0.005464715883135796, -0.003121161600574851, 0.02077225036919117, 0.055642228573560715, -0.016612613573670387, -0.013974846340715885, -0.011974374763667583, 0.019001156091690063], [-0.03854495286941528, -0.03573106229305267, -0.004978066310286522, -0.05313973128795624, -0.08486489951610565, 0.03303324803709984, -0.013958322815597057, 0.060465872287750244, 0.034642044454813004, -0.01103778276592493, -0.02015080489218235, -0.02576369047164917, -0.015726206824183464, 0.00232507660984993, 0.018669646233320236, -0.010579880326986313, -0.01092758309096098, -0.034763820469379425, -0.024019591510295868, -0.005492990370839834, -0.02249567024409771, -0.012689647264778614, 0.04577944800257683, -0.005710893776267767, 0.03410004824399948, 0.014410856179893017, 0.007892925292253494, -0.050221625715494156, 0.03943079710006714, 0.028456946834921837, -0.0038742884062230587, 0.007651418913155794, -0.010113324038684368, -0.02123941108584404, 0.04520966112613678, 0.054104093462228775, 0.024834832176566124, 0.012533489614725113, 0.01484041940420866, -0.043739356100559235, -0.0011973893269896507, 0.04104304313659668, 0.010887667536735535, 0.1281532347202301, -0.04812149703502655, -0.04436197876930237, -0.0028657715301960707, -0.007798079866915941], [0.014349323697388172, -0.03201572969555855, -0.029806869104504585, 0.07069416344165802, 0.03980113938450813, 0.016970284283161163, 0.0028513451106846333, 0.015532687306404114, -0.014432787895202637, 0.019091151654720306, 0.01087831798940897, -0.005972237326204777, 0.02108512446284294, -0.028600843623280525, -0.0021838454995304346, 0.007487734314054251, -0.00038434367161244154, -4.843393980991095e-05, 0.022562991827726364, -0.05824461579322815, -0.04365561157464981, 0.04594724625349045, 0.03356214612722397, -0.011259067803621292, 0.0017746726516634226, 0.0369841530919075, -0.02450444921851158, -0.006903940811753273, 0.018482789397239685, 0.007167565170675516, -0.0258998554199934, -0.00627423170953989, 0.03316827118396759, 0.00029639998683705926, 0.02607758343219757, -0.016144976019859314, 0.018119756132364273, 0.015388774685561657, -0.002264549722895026, 0.012263638898730278, 0.013160686008632183, -0.021198460832238197, -0.015408370643854141, -0.011724824085831642, 0.011334177106618881, 0.04808121547102928, 0.028136149048805237, 0.013900893740355968], [-0.013047782704234123, -0.008305784314870834, 0.0100662587210536, 0.006941187661141157, 0.03291452303528786, -0.015066585503518581, -0.0071295383386313915, 0.023872368037700653, 0.010512632317841053, 0.000927504850551486, -0.0007461438653990626, -0.0030589064117521048, -0.020675329491496086, -0.015044436790049076, -0.029363393783569336, 0.0062196217477321625, -0.050505973398685455, -0.0218302384018898, -0.04171915724873543, -0.027911795303225517, -0.04827640950679779, 0.01828014850616455, 0.019139347597956657, -0.014668988063931465, -0.005982362199574709, -0.005092460662126541, -0.013982714153826237, -0.058684635907411575, 0.01263620238751173, -0.008674105629324913, 0.018089240416884422, -0.002496926113963127, 0.014141010120511055, -0.06412745267152786, 0.052667878568172455, 0.0592401959002018, 0.016483817249536514, 0.046355605125427246, -0.015213634818792343, 0.006694435141980648, -0.0023374955635517836, 0.011924633756279945, 0.02326449565589428, 0.0003368309116922319, 0.02818598598241806, -0.013456196524202824, 0.0006037014536559582, -0.015009133145213127], [-0.005424287635833025, 0.034916702657938004, 0.0180209893733263, -0.0022732403595000505, -0.06903310865163803, 0.002731528365984559, -0.009504420682787895, -0.04814713075757027, 0.028921663761138916, -0.004834132734686136, 0.013272510841488838, -0.0012445575557649136, -0.004062027204781771, -0.03485976532101631, -0.024944258853793144, 0.015416517853736877, 0.032095011323690414, 0.01029332634061575, -0.023354077711701393, 0.005603570491075516, -0.010074363090097904, 0.01029549166560173, -0.0042104232124984264, -0.0010856477310881019, -0.048589419573545456, -0.007383969612419605, -0.005305722821503878, -0.009032713249325752, -0.046598169952631, -0.00696962233632803, -8.735122537473217e-05, 0.002964317100122571, -0.04528508707880974, 0.029011454433202744, -0.025803331285715103, -0.012951960787177086, -0.03823965787887573, 0.0005383050884120166, -0.019044512882828712, -0.013095889240503311, 0.006841684225946665, -0.010313745588064194, 0.03396395221352577, -0.006774201989173889, 0.05531945824623108, -0.018716325983405113, -0.0018424903973937035, -0.0007469275733456016], [0.008440069854259491, -0.03001866303384304, 0.02119280956685543, 0.025898735970258713, 0.024482278153300285, -0.04517843946814537, 0.0066070109605789185, -0.0002568315831013024, -0.005020850338041782, -0.013660609722137451, 0.0012890018988400698, 0.013903996907174587, 0.0057333954609930515, -0.020376168191432953, 0.026064608246088028, 0.0038680469151586294, -0.013783499598503113, 0.01669600047171116, -0.01283236313611269, 0.004703774582594633, 0.010963642969727516, -0.008436104282736778, -0.036414310336112976, 0.006040763575583696, 0.0023858887143433094, -0.01656937040388584, -0.024662913754582405, -0.0007661376730538905, -0.01394779235124588, 0.00784794520586729, 0.003730852622538805, 0.02372322417795658, 0.00970215443521738, -0.006997418589890003, 0.055254362523555756, 0.027598517015576363, 0.03446093946695328, -0.0031640802044421434, -0.006327162031084299, 0.017117585986852646, -0.010199871845543385, 0.002018935279920697, 0.019772503525018692, 0.025834789499640465, -0.018253201618790627, -0.04511666297912598, -0.0035157499369233847, -0.004410796333104372], [0.007541470695286989, -0.019636254757642746, 0.03920475393533707, 0.02037697285413742, -0.002453653607517481, -0.030459152534604073, -0.010124011896550655, 0.0004178278031758964, -0.013289615511894226, -0.018777502700686455, -0.014286567457020283, 0.010077680461108685, -0.031087752431631088, -0.017957499250769615, 0.01733292266726494, 0.001847671577706933, -0.023936297744512558, -0.013753645122051239, -0.03089725971221924, -0.018616139888763428, 0.0015644034137949347, -0.0007226932793855667, -0.00401622848585248, -0.007307759020477533, 0.046070631593465805, -0.015915747731924057, -0.022814922034740448, -0.02095237374305725, -0.03338156268000603, -0.027917984873056412, -0.021464979276061058, -0.026230713352560997, 0.01801547035574913, -0.024497896432876587, 0.019676916301250458, 0.011955459602177143, -0.007939280942082405, 0.005141291301697493, 0.003439559368416667, -0.012121163308620453, -0.001119360327720642, -0.011039821431040764, 0.011527292430400848, 0.012773256748914719, 0.008141283877193928, 0.04258936271071434, 0.03521329537034035, -0.027273274958133698], [-0.043641094118356705, 0.008802843280136585, -0.04755857214331627, 0.0801907554268837, 0.009452177211642265, -0.009804341942071915, 0.04125232249498367, 0.04235813766717911, -0.006952107883989811, -0.004398716613650322, -0.0031412136740982533, -0.0094769187271595, -0.05351308360695839, -0.038431551307439804, 0.003313790075480938, 0.014239965006709099, -0.012045156210660934, -0.019251300022006035, 0.013255264610052109, 0.007496553473174572, 0.007213082630187273, 0.004161783494055271, 0.0025763562880456448, -0.003685408504679799, -0.004969586152583361, 0.03510401397943497, -0.02305183932185173, -0.0068995216861367226, -0.006188254803419113, -0.0205802284181118, 0.052642472088336945, 0.023991284891963005, 0.001923586125485599, -0.060804836452007294, -0.014233218505978584, 0.039858169853687286, -0.0647917166352272, -0.01567993313074112, -0.010925641283392906, -0.00825104583054781, -0.00044601730769500136, 0.014271286316215992, 0.02917773835361004, 0.007877922616899014, -0.016857588663697243, -0.051317013800144196, -0.03910686820745468, -0.016617797315120697], [-0.04663810878992081, -0.012929904274642467, 0.026149071753025055, 0.033270213752985, -0.03077997826039791, -0.038677413016557693, 0.019144009798765182, -0.002004085574299097, 0.010216434486210346, -0.02671632543206215, -0.004557437729090452, 0.008257194422185421, -0.07795768231153488, -0.023350033909082413, 0.005605571437627077, 0.012354692444205284, -0.019611971452832222, -0.03370032086968422, -0.00839563924819231, 0.047254301607608795, 0.013050230219960213, -0.03842247277498245, -0.033759865909814835, -0.012364436872303486, 0.011555902659893036, -0.004109569359570742, -0.012142191641032696, -0.005527288652956486, 0.0010931006399914622, -0.021506618708372116, 0.006520275957882404, -0.0062370747327804565, -0.023133324459195137, -0.026353638619184494, -0.04031382501125336, 0.040527813136577606, -0.014941764064133167, 0.005310941021889448, 0.001175117096863687, 0.009601134806871414, 0.015375553630292416, 0.02244357392191887, 0.045053429901599884, 0.0018099506851285696, -0.007603573612868786, 0.0018772865878418088, -0.021686550229787827, -0.015743877738714218], [-0.014995712786912918, -0.020992448553442955, 0.04295041784644127, -0.00843134243041277, 0.011433104053139687, -0.00429731048643589, 0.010965674184262753, 0.00044723134487867355, 0.008228576742112637, 0.003968940582126379, 0.021830737590789795, 0.015016147866845131, -0.0012913914397358894, 0.0009622274665161967, -0.014228278771042824, 0.008486137725412846, 0.019395263865590096, 0.034757696092128754, -0.026097547262907028, 0.014469757676124573, 0.003308854764327407, -0.012668246403336525, -0.008573925122618675, -0.019237879663705826, -0.03212094306945801, -0.014327389188110828, -0.01962718367576599, 0.009340674616396427, -0.026743967086076736, -0.00436012540012598, -0.009665137156844139, 0.011581450700759888, 0.033471379429101944, -0.03873573988676071, -0.034755874425172806, -0.0064996047876775265, 0.021626409143209457, -0.04625029116868973, 0.012876478023827076, 0.0005309924017637968, 0.0048467544838786125, -0.02732766605913639, 0.01623372733592987, 0.06289676576852798, -0.012836302630603313, -0.0037094715517014265, 0.011640484444797039, -0.020977184176445007], [-0.038991671055555344, -0.010011228732764721, 0.02204425446689129, -0.00946083851158619, -0.010429229587316513, 0.015736879780888557, 0.02849642001092434, -0.00040377455297857523, 0.01222690287977457, 0.0033210450783371925, 0.0037870712112635374, 0.005185157060623169, 0.016259735450148582, -0.01367286778986454, -0.014101710170507431, 0.017758408561348915, -0.00434091966599226, 0.01707499288022518, -0.03331513702869415, 0.012815448455512524, -0.02764325588941574, -0.023062273859977722, 0.015500525943934917, -0.0015020364662632346, 0.02774401567876339, 0.013836274854838848, -0.0383991003036499, 0.004546836484223604, -0.039418548345565796, 0.008078535087406635, 0.018916232511401176, 0.021465113386511803, -0.010049103759229183, -0.009841975755989552, 0.08143476396799088, 0.04531576484441757, 0.035407569259405136, 0.0016411284450441599, 0.01596931554377079, 0.030987681820988655, -0.006801506970077753, 0.00568328145891428, 0.04417070373892784, 0.01019576471298933, 0.005471435375511646, 0.005007525440305471, 0.026455838233232498, -0.011838852427899837], [1.15126477933534e-40, 2.228555012738973e-40, 3.9840316639218874e-41, -2.475533867076222e-41, -2.8537863615514197e-40, -4.5303979351621336e-41, -1.1553986098050982e-40, 1.902304704274869e-40, 1.990278221865181e-40, 1.884354070946868e-40, 8.208806404014778e-42, 2.268141694356149e-40, -2.1008827096543387e-40, -2.0095180497803607e-40, 1.0622977411338216e-39, -3.4131706955252434e-40, 7.83059594849351e-41, 8.536289855127488e-41, -9.261868186970235e-40, 2.969897952305374e-40, -3.111176863478602e-40, 7.470644411962395e-40, -4.5612265013772796e-41, -7.730724005642616e-39, -3.3787968441953557e-40, -2.8440193112550757e-40, -1.5724530587574502e-40, 1.4958300587281692e-40, 1.8505547519873534e-41, 1.4413195484659338e-40, 2.436185406197981e-40, 2.114629447589365e-40, 2.1889122791832238e-40, 8.626309268475714e-40, -2.157032739119834e-40, -2.958253162066835e-40, -3.0277575658973457e-40, -2.1960168623973506e-40, -1.0257504758857661e-41, 1.1149711491093272e-40, 4.857320866889113e-41, 1.3588531338404184e-40, -3.432060198824342e-41, 2.0686948839287977e-40, -3.45651285702681e-40, -1.6801988976793854e-40, 9.562460720552552e-42, -8.448008051875025e-41], [-0.010721425525844097, -0.01636655442416668, 0.027576545253396034, 0.030538953840732574, 0.01390148140490055, -0.05612284317612648, 0.005929166451096535, 0.01460892241448164, -0.019821343943476677, 0.031769704073667526, -0.005374582950025797, -0.005523378029465675, 0.023203754797577858, -0.032049115747213364, -0.014467642642557621, 0.007584135048091412, 0.006486458703875542, 0.010528325103223324, 0.057820189744234085, -0.04046877473592758, 0.04258272796869278, 0.0006326357834041119, -0.005085393786430359, -0.019366392865777016, 0.006710255518555641, 0.03765576332807541, 0.00526073481887579, 0.01990918442606926, -0.02122168242931366, 0.004157621879130602, 0.007333633489906788, 0.0060221292078495026, 0.013015230186283588, 0.01116155181080103, 0.022938361391425133, 0.004936310928314924, 0.08158459514379501, -0.00196366966702044, 0.04240540787577629, -0.0003475758130662143, -0.008497621864080429, -0.033562786877155304, -0.02562432922422886, 0.042004406452178955, 0.013036608695983887, 0.03610207512974739, 0.023243578150868416, -0.03802628442645073], [-0.0005293352878652513, 0.02507355622947216, 0.032986629754304886, -0.004393517039716244, -0.044339921325445175, -0.05511783808469772, -0.012709297239780426, 0.03153003752231598, 0.028015242889523506, -0.007291701622307301, 0.03184809163212776, -0.00017965298320632428, 0.027203034609556198, -0.013792199082672596, -0.01257872674614191, 0.020476743578910828, 0.0492292083799839, 0.034287966787815094, -0.007146061863750219, -0.004429618362337351, -0.030378717929124832, 0.03300657495856285, -0.04126866161823273, -0.02554727904498577, 0.0104561448097229, -0.010911456309258938, -0.036867640912532806, 0.025432851165533066, -0.02948750928044319, -0.01836933195590973, 0.012740416452288628, 0.0050620525144040585, 0.00018019770504906774, -0.08468180149793625, -0.058072060346603394, -0.009548207744956017, 0.01702617108821869, -0.011356390081346035, -0.029160605743527412, -0.011933691799640656, 0.01224529929459095, -0.012148217298090458, -0.03251807764172554, -0.009249348193407059, 0.050564296543598175, -0.009222285822033882, 0.004266203846782446, 0.07019324600696564], [-0.0023583194706588984, 0.010074950754642487, 0.048003386706113815, -0.029566287994384766, 0.012968404218554497, -0.017463522031903267, -0.0022343380842357874, 0.025507444515824318, -0.011411969549953938, -0.02986546792089939, -0.011031243950128555, -0.01670287549495697, -0.014785252511501312, 0.04941297322511673, -0.0436273068189621, -0.005231229122728109, 0.009726607240736485, -0.029159093275666237, -0.03487147018313408, 0.03209926187992096, 0.008146966807544231, -0.04661563038825989, 0.05120938643813133, 0.02151499129831791, -0.08483076840639114, -0.01350589469075203, 0.03706107288599014, 0.021278755739331245, 0.0014071548357605934, 0.03069918602705002, -0.017102375626564026, 0.03162344545125961, -0.0511833056807518, 0.012131648138165474, 0.03167771175503731, -0.0044175381772220135, -0.057237762957811356, 0.022324545308947563, 0.008543300442397594, -0.02444079890847206, 0.00705060875043273, -0.038004837930202484, 0.11180464178323746, 0.06950404495000839, 0.006888857576996088, -0.023706568405032158, 0.009758024476468563, -0.008048049174249172], [-3.5843687302102707e-39, 3.88818284896207e-41, -2.441160015746334e-40, 1.0827735142945359e-39, -7.397314463324277e-41, 2.0355261492782293e-41, 2.3474972263908633e-40, -2.7723428948048613e-40, 1.9378147059788558e-36, 2.103320968982264e-40, 6.944274669808063e-41, -6.796633863606801e-40, 3.1883884088628995e-40, -4.0777785311852177e-41, 6.000266137241757e-39, -1.9064665607139136e-41, 2.4690878941403277e-41, 2.368418612463233e-40, -8.90567213032351e-41, 3.0821279463131487e-40, 1.1677006090234057e-39, -2.216924235485077e-40, 1.5558476719552011e-40, 1.5884839131893261e-40, 7.292217078499916e-41, -2.4572749480860695e-40, 2.426488420824853e-41, 7.321784476097169e-42, -4.973908899120938e-41, -1.2524665544288782e-40, -1.75951239076017e-40, -9.904969454319138e-38, 3.1299402499159114e-41, 3.3474357845637663e-40, -6.642995499978228e-41, -6.888222731235071e-41, -1.6720713665863015e-40, -2.3509584335977456e-41, 2.241769257257556e-40, 6.997159673851682e-40, -2.3404486951153095e-40, 1.1665529455811237e-40, -1.14906474074635e-40, -1.5666937220690752e-40, 8.431192470303127e-41, -2.589487458195116e-40, -2.391133660569938e-40, 3.3407936298428666e-40], [0.0585792250931263, -0.01299565564841032, -0.03822993487119675, -0.03144054114818573, -0.006141388323158026, -0.016367528587579727, 0.0020434483885765076, 0.05297481641173363, 0.050461992621421814, 0.037880152463912964, 0.0016120127402245998, 0.004330175928771496, -0.017929917201399803, 0.05140775442123413, -0.04774606227874756, 0.02303643338382244, 0.050729189068078995, 0.05457271635532379, 0.024193549528717995, -0.018314942717552185, -0.024369817227125168, 0.008625369518995285, -0.02114294283092022, -0.019426988437771797, 0.02792942337691784, 0.017873695120215416, 0.0019963642116636038, 0.020433487370610237, 0.017140625044703484, 0.017006829380989075, 0.021635305136442184, 0.020278995856642723, -0.03920020908117294, 0.004947356414049864, -0.0347004309296608, -0.05493585392832756, 0.007359708193689585, -0.03825891762971878, 0.00022931899002287537, 0.007942846044898033, -0.01171968411654234, -0.026666738092899323, -0.041741471737623215, 0.04172387719154358, -0.0034143561497330666, 0.03597954288125038, 0.012370424345135689, 0.03582896292209625], [0.04627617076039314, -0.025946585461497307, -0.053113777190446854, 0.04385564103722572, 0.05051933974027634, -0.03333980590105057, 0.009140629321336746, -0.007970688864588737, -0.016612056642770767, 0.009695151820778847, -0.005199965089559555, 0.004129759501665831, 0.008804240263998508, 0.02049102634191513, -0.018921367824077606, 0.007394792512059212, 0.004939687438309193, 0.0011462788097560406, 0.03045840561389923, -0.030921030789613724, -0.048303183168172836, -0.006218543276190758, 0.0012536491267383099, 0.007026518229395151, -0.004047599155455828, 0.015002059750258923, -0.015761584043502808, 0.033372946083545685, 0.0029644120950251818, 0.017325473949313164, -0.0028137790504842997, 0.011136354878544807, 0.02322232536971569, -0.03905618563294411, 0.035705167800188065, -0.035919900983572006, -0.006926198024302721, -0.006782847456634045, 0.0017608326161280274, -0.005122090689837933, -0.010953315533697605, 0.021386563777923584, 0.05680067464709282, -0.0048667918890714645, 0.01101706549525261, 0.033008359372615814, 0.024322407320141792, 0.017511067911982536], [0.05576275289058685, -0.017635617405176163, -0.02568594180047512, -0.030076850205659866, 0.004484519362449646, -0.0019353184616193175, 0.006570145953446627, 0.06786294281482697, 0.0007630259497091174, 0.015247469767928123, -0.010691323317587376, -0.008634745143353939, 0.021280433982610703, -0.0011096677044406533, -0.008814164437353611, 0.015063785947859287, -0.00833163782954216, -0.021787703037261963, 0.06361400336027145, -0.027659906074404716, -0.09486047923564911, 0.03255510702729225, 0.01086443942040205, -0.034215573221445084, 0.043615084141492844, 0.0003497599973343313, -0.06619257479906082, -0.0036853738129138947, -0.008852115832269192, 0.005460696294903755, 0.035870831459760666, -0.003261022036895156, 0.005715062376111746, -0.02400442399084568, -0.0005838668439537287, -0.03405274823307991, -0.007489343639463186, -0.020319951698184013, -0.02713494561612606, -0.00937795639038086, -0.02167556621134281, -0.010081314481794834, -0.0064673153683543205, 0.023656368255615234, 0.015071218833327293, 0.04020828381180763, 0.02527737431228161, -0.044540803879499435], [0.016469890251755714, 0.022514117881655693, 0.03909973427653313, 0.047406747937202454, 0.037038084119558334, -0.0033950554206967354, 0.008490495383739471, -0.031966157257556915, 0.009953704662621021, 0.02091851830482483, -0.023244362324476242, -0.010234816931188107, 0.04835923761129379, -0.019137011840939522, -0.04182502254843712, 0.001720014726743102, -0.018668387085199356, -0.009826024994254112, 0.07554366439580917, -0.008648038841784, -0.021963119506835938, 0.025698205456137657, -0.007411167491227388, -0.008755076676607132, 0.004122440237551928, 0.0477246530354023, -0.01717449352145195, 0.02363131195306778, -0.001554769231006503, 0.010120558552443981, 0.004102816339582205, -0.003064720658585429, 0.04197179153561592, -0.006270847748965025, 0.003024117788299918, -0.05296199768781662, -0.026334920898079872, 0.021812796592712402, 0.024003220722079277, 0.05454352870583534, -0.004767981823533773, 0.011754564940929413, 0.009042228572070599, 0.022048264741897583, 0.000153734115883708, 0.027140194550156593, 0.0597248375415802, -0.03872999548912048], [-0.023783782497048378, 0.007914984598755836, 0.016250846907496452, 0.005935378838330507, 0.00041940936353057623, 0.000651524169370532, 0.02481561340391636, -0.02034720405936241, -0.010975680314004421, 0.022294718772172928, -0.011521647684276104, 0.0011117791291326284, 0.033219270408153534, -0.01639307476580143, 0.002146923216059804, 0.008161056786775589, 0.014850672334432602, 0.005045129917562008, -0.028361789882183075, -0.003725160378962755, 0.041049957275390625, -0.006357058882713318, 0.005298299714922905, -0.009712183848023415, 0.018460199236869812, -0.03589330613613129, 0.0031974154990166426, 0.0261690691113472, 0.0461241640150547, 0.01162544172257185, -0.01019513513892889, 0.048559848219156265, -0.023234643042087555, 0.0036885617300868034, 0.045665279030799866, 0.021014058962464333, 0.013261162675917149, 0.03223360702395439, -0.011161746457219124, -0.018627628684043884, -0.0007727210177108645, 0.013279514387249947, 0.012714143842458725, 0.03582274168729782, 0.01721801795065403, -0.039602793753147125, 0.00249927188269794, -0.018907485529780388], [0.11003396660089493, -0.005683738272637129, -0.006190290208905935, -0.025466442108154297, 0.047146424651145935, 0.004123800899833441, -0.018071526661515236, 0.06613556295633316, -0.009221330285072327, 0.02174905315041542, 0.01730877161026001, -0.020885871723294258, -0.028153441846370697, -0.022584673017263412, -0.015033178962767124, 0.0057769655250012875, 0.011107747443020344, -0.01047053374350071, -0.03570106625556946, 0.002251487225294113, -0.02199060469865799, 0.04146746173501015, 0.018961094319820404, 0.011136440560221672, 0.004568600561469793, -0.015682468190789223, 0.03257656469941139, 0.01717549003660679, 0.0406353585422039, -0.01952490210533142, 0.0019349337089806795, -0.0027938014827668667, -0.042769819498062134, -0.03457195684313774, -0.031292907893657684, -0.040223997086286545, 0.04902070760726929, 0.021115338429808617, -0.022341588512063026, 0.020475488156080246, 0.029664482921361923, -0.0150275444611907, -0.04267195984721184, -0.02550535276532173, 0.048528626561164856, 0.02787354215979576, -0.03026016615331173, 0.009476308710873127], [0.001460784929804504, -0.00545399310067296, 0.029257670044898987, -0.038265008479356766, 0.026387225836515427, -0.01841818355023861, -0.011753602884709835, -0.004594782367348671, 0.026251979172229767, -0.0028470291290432215, -0.016367213800549507, 0.00897884089499712, 0.01596791110932827, -0.0084022032096982, 0.028967056423425674, -0.002782858442515135, 0.07863402366638184, -0.02944517880678177, 0.00941980630159378, -0.04065563157200813, -0.09634964913129807, -0.018650636076927185, 0.02848106622695923, 0.026616299524903297, -0.005001367069780827, -0.04188666120171547, -0.01322844997048378, -0.014916578307747841, -0.0070005119778215885, -0.0325300432741642, 0.00503574451431632, 0.0017153527587652206, -0.0581052340567112, 0.003907676786184311, -0.03626425191760063, 0.001655925647355616, -0.04361281543970108, 0.003519910154864192, 0.060219213366508484, 0.009342307224869728, -0.04808911308646202, -0.029719872400164604, -0.07844871282577515, -0.01842053420841694, -0.024982012808322906, 0.03143928572535515, 0.027927765622735023, 0.014417463913559914], [-0.029415354132652283, -0.04840473830699921, 0.04170374199748039, -0.044728975743055344, 0.024672621861100197, -0.08211264759302139, -0.02365204505622387, 0.02758224681019783, -0.013076799921691418, -0.019950076937675476, 0.009481072425842285, 0.004306316375732422, 0.01351985428482294, 0.008475161157548428, -0.028359785676002502, -0.001228650682605803, -0.003432792378589511, 0.005445636808872223, -0.04103223606944084, -0.03186239302158356, -0.010082167573273182, 1.111848177970387e-06, -0.02474524825811386, -0.025744738057255745, -0.005346795544028282, -0.041233230382204056, -0.008108449168503284, 0.028750188648700714, -0.11103834211826324, 0.0011878293007612228, -0.04453348368406296, -0.015891283750534058, 0.03208509087562561, -0.022001689299941063, -0.01664523221552372, 0.0015015954850241542, -0.03534331172704697, 0.012396449223160744, 0.013188516721129417, 0.04262659326195717, 0.016317036002874374, -0.006864975206553936, 0.017582949250936508, 0.02503577060997486, -0.0067648193798959255, 0.054592158645391464, 0.029737424105405807, -0.07308930158615112], [-0.022902758792042732, 0.030026007443666458, -0.05606419965624809, 0.04838789254426956, 0.009341668337583542, -0.01223666686564684, -0.023436525836586952, -0.03358633443713188, 0.00020679470617324114, -0.01039251871407032, -0.008329569362103939, 0.013080894947052002, -0.02078958787024021, 0.03337867185473442, 0.01160978339612484, -0.009698951616883278, 0.019498419016599655, 0.005258223973214626, -0.0019752976950258017, 0.02723606489598751, 0.017087632790207863, -0.020466703921556473, 0.02168836072087288, -0.006024676375091076, -0.013280101120471954, -0.022469986230134964, 0.0005751127609983087, -0.05082216113805771, 0.005647740792483091, 0.008567293174564838, 0.006263222079724073, 0.0022006991785019636, -0.05041562020778656, 0.015025032684206963, 0.0646044984459877, -0.027946190908551216, 0.055415451526641846, -0.021213848143815994, 0.005010380409657955, 0.033545952290296555, 0.029869666323065758, 0.0012549340026453137, -0.0344732366502285, -0.028449712321162224, -0.010210234671831131, -0.004254190716892481, 0.04187614843249321, -0.037221696227788925], [-0.04143979027867317, -0.000532398116774857, -0.03232582286000252, -0.0069848159328103065, 0.04380543529987335, 0.013578351587057114, 0.01997596025466919, -0.008542297407984734, 0.00229964149184525, 0.03636007010936737, 0.03448044881224632, 0.00035061489325016737, -0.03581307828426361, -0.012644466944038868, -0.03453025594353676, 0.011325866915285587, -0.02360769733786583, -0.01579669862985611, -0.009933252818882465, -0.005318490322679281, 0.04148881509900093, 0.008510665036737919, 0.010620991699397564, 0.002403027843683958, -0.030492054298520088, 0.01097471360117197, 0.054341524839401245, -0.011475445702672005, 0.004699740093201399, 0.03795313835144043, 0.07797706127166748, -0.0007765063783153892, -0.032606251537799835, -0.07723955810070038, 0.028522739186882973, 0.02722747251391411, -0.08542788773775101, -0.009476873092353344, -0.00959985051304102, 0.020934252068400383, 0.009726347401738167, 0.03172852843999863, 0.018936805427074432, -0.020249424502253532, 0.03574080765247345, 0.04143494740128517, 0.04432206600904465, 0.002588239498436451], [-0.03523792698979378, -0.0017763616051524878, 0.008031454868614674, 0.04865109547972679, 0.030322110280394554, 0.028448114171624184, 0.016831956803798676, 0.04175882786512375, -0.008581940084695816, -0.007113839033991098, -0.030257731676101685, 0.0067919339053332806, 0.06380455940961838, -0.0178743414580822, 0.019250081852078438, 0.0022350773215293884, -0.02198401279747486, 4.6613189624622464e-05, 0.0061003356240689754, -0.011182974092662334, 0.01536719873547554, -0.029272345826029778, -0.021310092881321907, 0.022111801430583, 0.0333365760743618, 0.017241034656763077, 0.022762322798371315, -0.036093950271606445, -0.027979658916592598, 0.009222847409546375, -0.01752365753054619, 0.03509899228811264, -0.028949769213795662, -0.010186304338276386, 0.014421574771404266, 0.027292000129818916, -0.006338524166494608, 0.011642343364655972, -0.027358243241906166, -0.015530526638031006, -0.024519698694348335, 0.008791559375822544, 0.032988354563713074, 0.061323098838329315, 0.0038100299425423145, 0.006110365502536297, -0.04164475202560425, 0.0022472923155874014], [0.026857340708374977, -0.02408576011657715, -0.02165546827018261, 0.022804301232099533, -0.05479707941412926, -0.02389681339263916, -0.003601654199883342, 0.06355665624141693, -0.04718105494976044, 0.017748042941093445, -0.03646530583500862, -0.013146218843758106, -0.1298089176416397, -0.0021759243682026863, -0.01698298193514347, 0.009478137828409672, -0.059813469648361206, -0.049950242042541504, 0.03205254301428795, -0.03937678039073944, 0.028592582792043686, 0.009849314577877522, 0.002728415187448263, -0.013094642199575901, -0.014550632797181606, -0.018615644425153732, 0.04144405946135521, -0.018157189711928368, 0.01860162988305092, -0.0031559618655592203, 0.03606783226132393, -0.06981667876243591, 0.10250984132289886, 0.0026451728772372007, -0.000294576573651284, -0.0022846886422485113, -0.03552472963929176, 0.01594073511660099, -0.0014627240598201752, -0.049257099628448486, 0.0030501973815262318, -0.003070338163524866, -0.013689299114048481, 0.021734653040766716, 0.005458520725369453, -0.03728528693318367, 0.02514447085559368, 0.02181974984705448], [0.05033429339528084, -0.004912229720503092, -0.034742455929517746, 0.03922920674085617, 0.038152292370796204, 0.012507493607699871, -0.008300202898681164, -0.04230198264122009, 0.007846081629395485, 0.007186634466052055, 0.02123350091278553, -0.006574555765837431, -0.02156982570886612, 0.01194364670664072, 0.028170794248580933, -0.0017469667363911867, -0.03928152844309807, -0.029684344306588173, -0.03203112632036209, -0.019314873963594437, -0.005655916407704353, 0.026271646842360497, 0.0054653179831802845, -0.04869358614087105, 0.023253154009580612, -0.0022426482755690813, -0.006310783792287111, -0.01706082932651043, -0.02177918329834938, -0.011570518836379051, 0.007258442230522633, 0.012785641476511955, 0.05961158871650696, -0.040310271084308624, -0.007167425937950611, 0.028980949893593788, -0.037203602492809296, 0.025869417935609818, -0.03176654502749443, 0.02808982878923416, 0.014002006500959396, -0.03348641097545624, 0.011629533022642136, -0.009295820258557796, -0.0066792103461921215, 0.020406991243362427, -0.07034747302532196, -0.010116430930793285], [0.00027321447851136327, 0.022317970171570778, -0.01866329275071621, 0.03727014362812042, -0.001834224909543991, -0.023688219487667084, 0.013402767479419708, -0.011684740893542767, 0.022610630840063095, -0.014686171896755695, -0.00882827676832676, -0.007114638574421406, 0.05221446231007576, 0.014581718482077122, 0.004540940746665001, 0.009275090880692005, 0.03496858477592468, 0.004817222245037556, -0.030863342806696892, -0.009390017949044704, 0.012644574977457523, -0.02338152751326561, -0.025087784975767136, -0.0028191881719976664, 0.01906014233827591, -0.03292999789118767, -0.027116045355796814, 0.021031780168414116, -0.0037183088716119528, -0.0005981468129903078, 0.021847529336810112, 0.027375303208827972, 0.033549219369888306, -0.05260857567191124, -0.02942591719329357, -0.04033760353922844, -0.03199204057455063, -0.008247913792729378, 0.026544975116848946, 0.003999604843556881, -0.012551875784993172, 0.013770279474556446, 0.07655638456344604, -0.032277192920446396, 0.0034193263854831457, -0.003973789047449827, -0.004776371642947197, 0.02333449386060238], [0.00877378974109888, 0.009754444472491741, 0.0104553597047925, -0.019946342334151268, -0.008686442859470844, 0.017762316390872, 0.018696444109082222, 0.0274383295327425, -0.013030745089054108, 0.004590173717588186, 0.0057184044271707535, 0.00802063662558794, -0.007451701909303665, -0.013947250321507454, -0.037263110280036926, 0.00687787402421236, 0.00891504529863596, -0.02226979099214077, 0.03453843295574188, 0.019027728587388992, -0.011148921214044094, 0.0202789306640625, 0.017048120498657227, 0.015475774183869362, -0.03016846626996994, 0.02544078417122364, 0.007554528769105673, -0.015347616747021675, 0.010069112293422222, 0.021356254816055298, -0.01824539341032505, 0.02104043960571289, -0.036182403564453125, 0.0037267780862748623, -0.010620159097015858, -0.002091487869620323, -0.04666312038898468, 0.0072580925188958645, 0.008255811408162117, -0.021803777664899826, -0.013991562649607658, 0.002223437651991844, 0.020504329353570938, 0.030091241002082825, -0.008970299735665321, 0.003195815021172166, -0.037307869642972946, -0.024603748694062233], [-0.01586710475385189, 0.012875168584287167, -0.006456945091485977, -0.012235543690621853, 0.028025951236486435, -0.03565504401922226, -0.011007928289473057, -0.031249845400452614, 0.009616661816835403, -0.01208528783172369, -0.005572063848376274, 0.0007006055093370378, 0.05362953245639801, 0.06030596047639847, 0.024050112813711166, -0.0029361755587160587, -0.03417636454105377, 0.014107073657214642, -0.0037058484740555286, -0.010713583789765835, 0.014566147699952126, 0.014009466394782066, 0.05339746177196503, -0.0033014598302543163, 0.04157170653343201, 0.009039662778377533, 0.015301965177059174, -0.0240629855543375, -0.005254805088043213, 0.008368716575205326, 0.010362586006522179, 0.02987455017864704, 0.07499337196350098, -0.03673727065324783, -0.012617251835763454, 0.019908566027879715, 0.05069177970290184, -0.014294099994003773, -0.0043028476648032665, -0.01064392551779747, 0.030638452619314194, 0.03174211457371712, 0.032458506524562836, 0.017747744917869568, 0.012181592173874378, -0.041148167103528976, -0.03106021322309971, -0.003211767179891467], [-0.010433870367705822, 0.015390157699584961, -0.03387850522994995, 0.011569727212190628, -0.0018682850059121847, -0.0416417196393013, -0.028816891834139824, -0.014571895822882652, -0.0028947440441697836, -0.037325579673051834, 0.0552145354449749, -0.00543682835996151, -0.01554455328732729, -0.10575803369283676, -0.03755662590265274, -0.010784413665533066, -0.012078710831701756, 0.012340793386101723, -0.0019169847946614027, 0.01737477444112301, 0.017763737589120865, -0.023031361401081085, -0.010042093694210052, -0.03232612460851669, 0.029614409431815147, 0.03537770360708237, 0.06203974038362503, 0.019894616678357124, -0.0036675031296908855, -0.006122832652181387, -0.0022930377162992954, -0.023509705439209938, 0.012859193608164787, 0.030348582193255424, -0.004321898799389601, -0.01226034015417099, -0.021477745845913887, -0.046044692397117615, 0.026795092970132828, 0.021605927497148514, 0.04567423835396767, -0.022441327571868896, 0.00503552844747901, 0.04234272614121437, -0.01415665727108717, 0.023908959701657295, 0.05568620562553406, 0.025140084326267242], [-0.0019442257471382618, -0.021350843831896782, -0.016700759530067444, 0.053519971668720245, 0.005883748643100262, 0.0073528047651052475, -0.02172773703932762, 0.07874003797769547, 0.016205858439207077, -0.02266331948339939, 0.03229793906211853, -0.0016481102211400867, 0.0057054553180933, -0.029669523239135742, -0.022219786420464516, -0.012881127186119556, 0.006452375091612339, -0.018551478162407875, 0.00014618225395679474, -0.0310817863792181, -0.04530724510550499, -0.016709649935364723, 0.039098888635635376, -0.007193651981651783, -0.028474517166614532, 0.0030701549258083105, 0.032807085663080215, -0.04332168400287628, -0.05917617678642273, -0.008297490887343884, -0.015058151446282864, 0.012162789702415466, -0.038251180201768875, -0.01279198843985796, -0.033758874982595444, 0.03219471871852875, 0.007814733311533928, 0.0036049378104507923, 0.035391759127378464, -0.001661745016463101, -0.02895372547209263, -0.03630848973989487, -0.020879197865724564, 0.05947335436940193, -0.020482368767261505, -0.0066609191708266735, 0.0184556283056736, 0.032636452466249466], [0.02215193212032318, 0.0001735858095344156, 0.01439543254673481, 0.025515248998999596, 0.05481652170419693, 0.06537023186683655, 0.009364633820950985, -0.004507439211010933, -0.01568014547228813, -0.002247874392196536, -0.027989089488983154, 0.003913171123713255, -0.012824890203773975, -0.03129133954644203, 0.0030624691862612963, 0.003247390501201153, -0.009968411177396774, -0.011484069749712944, -0.04632649943232536, -0.022244997322559357, -0.028026936575770378, 0.009603439830243587, -0.007864772342145443, 0.0065445913933217525, -0.004442395176738501, 0.011150876060128212, 0.026882927864789963, 0.005077766720205545, 0.03599863499403, -0.04619377851486206, -0.030638016760349274, -0.005446763709187508, -0.03428124636411667, -0.005930445156991482, -0.018711095675826073, 0.03867890313267708, 0.04245227947831154, 0.033210642635822296, 0.0018535420531406999, 0.00019010790856555104, -0.008082907646894455, -0.019381815567612648, 0.03616003692150116, -0.011974525637924671, -0.02068549208343029, 0.04358788579702377, 0.041706278920173645, -0.07839372754096985], [-0.031099960207939148, 0.017036370933055878, 0.011694814078509808, 0.07505320012569427, 0.008535707369446754, 0.008528207428753376, -0.022179825231432915, 0.014736349694430828, -0.0350017286837101, -0.02042892761528492, 0.01940489001572132, 0.008144731633365154, -0.0045690820552408695, -0.05060199275612831, -0.0024598045274615288, -0.008929108269512653, -0.04572710022330284, -0.012743458151817322, 0.03844337910413742, -0.01934756711125374, -0.006134903524070978, -0.019447244703769684, 0.011333153583109379, -0.008130236528813839, 0.017034711316227913, -0.04536319896578789, -0.016267500817775726, -0.03232717141509056, -0.01744048111140728, 0.01193967554718256, -0.0076875085942447186, -0.011088909581303596, 0.012673494406044483, -0.031377095729112625, -0.00434781052172184, -0.03149284049868584, 0.005127790849655867, -0.013574144802987576, 0.0025671168696135283, -0.012888521887362003, 0.013544167391955853, 0.015601727180182934, 0.0507856048643589, 0.0051218667067587376, 0.008537723682820797, 0.0627187117934227, 0.017964977771043777, -0.012264356948435307], [0.003883494297042489, 0.016550354659557343, -0.0036871067713946104, -0.0274571031332016, 0.03733893483877182, -0.02816593460738659, -0.010881423950195312, 0.0027337446808815002, -0.002978104166686535, 0.017144691199064255, -0.054174669086933136, 0.007414094638079405, -0.015542510896921158, -0.03770972788333893, 0.053907301276922226, -0.0018992787227034569, -0.06227608770132065, -0.013919859193265438, 0.005786712747067213, -0.03291682153940201, -0.02048318274319172, 0.03421536833047867, 0.02232459746301174, 0.012977520003914833, 0.03476552665233612, 0.011107354424893856, -0.022986767813563347, -0.032459307461977005, -0.0496620275080204, -0.012906426563858986, -0.01380491629242897, -0.03240509703755379, 0.02918364480137825, -0.09763193875551224, -0.07667955756187439, 0.04661649465560913, -0.0448019914329052, 0.05848327651619911, -0.01866336353123188, -0.004920478444546461, -0.03907450661063194, 0.02498568594455719, -0.05711492523550987, 0.04588651284575462, -0.009213775396347046, 0.012228552252054214, 0.01424600649625063, -0.0033534811809659004], [0.0483248196542263, 0.03168254345655441, -0.038398291915655136, 0.03179358318448067, -0.03735308721661568, -0.023373737931251526, -0.013375449925661087, -0.019146833568811417, 0.017115386202931404, -0.0038325355853885412, 0.04573706537485123, 0.010934852994978428, 0.018726306036114693, -0.07049904018640518, 0.009188550524413586, 0.007439994253218174, 0.04902605339884758, 0.0566767081618309, 0.020952843129634857, 0.006312134675681591, -0.06363633275032043, -0.007500359322875738, -0.022390618920326233, 0.006495246198028326, 0.007456118240952492, -0.011904372833669186, -0.0017201929586008191, 0.026933105662465096, -0.03362026810646057, -0.037992045283317566, -0.0019842961337417364, -0.018508831039071083, 0.0221785306930542, 0.017567817121744156, -0.025598086416721344, -0.02828626148402691, 0.036547232419252396, 0.007266204804182053, -0.04321441799402237, 0.007807312998920679, 0.013416466303169727, 0.013287141919136047, 0.05000969395041466, -0.007126347161829472, 0.04869254305958748, 0.02641257829964161, 0.0037662996910512447, -0.022549699991941452], [0.041803088039159775, 0.006931627169251442, -0.00941398274153471, 0.02387290820479393, -0.04235674440860748, 0.0347234271466732, -0.008882638067007065, 0.0016032831044867635, -0.0027982103638350964, 0.017168661579489708, 0.006144784390926361, 0.0143528888002038, -0.009575116448104382, -0.005718528758734465, -0.03229089826345444, -0.010422112420201302, 0.0076899100095033646, -0.006814764346927404, 0.020346246659755707, 0.040591102093458176, 0.042534973472356796, 0.017353544011712074, 0.0174606591463089, 0.01674296148121357, -0.06536705046892166, -0.027516048401594162, 0.015210216864943504, -0.02358965575695038, 0.013241087086498737, -0.0004401648184284568, 0.0018518775468692183, 0.0011250101961195469, 0.015789173543453217, 0.03046674095094204, -0.02170584350824356, 0.02854762226343155, -0.06118083745241165, -0.014556288719177246, -0.0244380384683609, 0.024916760623455048, 0.028129883110523224, -0.006567684467881918, -0.03815535083413124, -0.0017095900839194655, 0.010378211736679077, 0.03019297495484352, 0.04776209965348244, 0.01096557080745697], [-6.253434526895929e-41, 2.5894594322258295e-41, -2.2960555597654993e-40, 3.289594387851831e-39, 1.4266059145905233e-40, -1.1863673058666766e-40, -2.7849545809837847e-40, -2.680235546744791e-40, 2.9499294491887454e-40, 3.8175672154493494e-39, -3.2308477523319415e-40, -6.373274972863451e-39, 6.4400454433900646e-40, 2.8589151139308485e-40, -1.1081706476619589e-39, -1.9507475921865778e-41, 1.3200231533939777e-41, -7.900801001556184e-41, -1.1216973817380863e-40, 3.5960121191503456e-41, 3.2827664209545617e-38, -2.789382684131051e-40, 1.199483459492757e-40, -1.0400311085357003e-39, -2.2057839126936946e-41, -2.57729616155549e-40, -1.3064866102286e-40, -1.482657853163516e-40, 3.4676531798181923e-41, 2.9661564854056268e-40, -2.1089401758242064e-40, 1.9059761062514e-40, -1.114452668677527e-40, -3.6515035383376083e-40, -2.8180812766804234e-40, 9.693061737427625e-41, 2.2152566903125303e-40, 1.2791192512203363e-40, 1.7609417151937814e-40, 2.874238873157626e-38, -2.9097962611704826e-41, -1.2291069090285835e-40, 3.267239473450457e-40, 4.649508304629743e-41, -1.042877145716744e-39, -2.4565462728846206e-40, -5.545778802411896e-40, 4.368547962532617e-41], [-0.036086760461330414, -0.025373559445142746, -0.09812664985656738, -0.004287987481802702, -0.06974831968545914, 0.010625065304338932, 0.019820205867290497, -0.038168299943208694, -0.01154384482651949, 0.07985309511423111, -0.017643623054027557, 0.03182812035083771, -0.03776666149497032, 0.040464192628860474, 0.010485611855983734, 0.026304904371500015, -0.02382095344364643, -0.06025771051645279, 0.02928566187620163, 0.026789944618940353, 0.0083451634272933, -0.04600078985095024, 0.05689575895667076, -0.013670195825397968, -0.01845862716436386, -0.011818655766546726, -0.05965399369597435, -0.03596322983503342, 0.022970790043473244, -0.019241148605942726, 0.07583391666412354, -0.02900649979710579, 0.00020933423365931958, 0.05216502770781517, 0.0922192856669426, 0.04278704151511192, 0.052309904247522354, -0.017652757465839386, -0.04245888069272041, -0.09537354856729507, -0.012302037328481674, 0.009638452902436256, 0.02524789609014988, 0.04539090394973755, 0.032174933701753616, -0.03062569350004196, -0.04440440982580185, 0.03898381069302559], [0.025631336495280266, -0.045522015541791916, -0.0012931516394019127, -0.05207701772451401, 0.036600079387426376, -0.06656808406114578, -0.0009247917332686484, -0.05623476579785347, 0.007713931612670422, -0.014911373145878315, -0.02516782097518444, -0.012682835571467876, 0.012360435910522938, -0.08066695183515549, -0.04194952920079231, 0.002286071190610528, 0.06014714762568474, 0.009071812964975834, 0.0057751997373998165, 0.027385402470827103, 0.033724553883075714, -0.04068992659449577, -0.009738774970173836, 0.012909864075481892, 0.005375202279537916, -0.01077614352107048, -0.04164651036262512, 0.042323317378759384, -0.039042264223098755, 0.03401077538728714, -0.010794269852340221, -0.009784331545233727, 0.006414318457245827, 0.031380798667669296, 0.019763171672821045, -0.015454424545168877, -0.007162399590015411, -0.010081538930535316, -0.014818745665252209, 0.047223951667547226, -0.03129583224654198, -0.003298441180959344, -0.05558024346828461, -0.02189483679831028, 0.05568159371614456, -0.01343243196606636, -0.00892708357423544, -0.01597684808075428], [0.010557835921645164, -0.0044882576912641525, -0.0001124846312450245, -0.028755851089954376, -0.004622574895620346, 0.013285313732922077, 0.014055559411644936, -0.15471495687961578, 0.0025692207273095846, -0.01800011470913887, 0.01733260601758957, -0.018630968406796455, -0.03837175667285919, -0.04783574864268303, -0.015813356265425682, 0.01367361843585968, 0.01806718111038208, 0.010395423509180546, 0.0016608921578153968, 0.028288960456848145, 0.01437627337872982, -0.03888491913676262, -0.008423084393143654, -0.025283539667725563, -0.020067155361175537, -0.04544120281934738, -0.05972951278090477, 0.06013684347271919, -0.03853199630975723, 0.020723171532154083, 0.07910022139549255, -0.011410112492740154, -0.033113133162260056, -0.04497140645980835, 0.041251860558986664, 0.005449884571135044, -0.021764785051345825, -0.023849084973335266, -0.05956944450736046, -0.0515560507774353, -0.009658918716013432, -0.015217926353216171, 0.0811990424990654, 0.013943630270659924, 0.04713005572557449, 0.022232891991734505, -0.017440810799598694, 0.025062762200832367], [0.04492345079779625, 0.008297469466924667, -0.02289157174527645, -0.021842867136001587, -0.004580352455377579, -0.005656444933265448, 0.003686962416395545, -0.10739650577306747, 0.022869857028126717, 0.0013150395825505257, 0.03327655419707298, -0.00033027498284354806, 0.01043565571308136, 0.05731953680515289, 0.03713097423315048, 0.010743345133960247, 0.009813419543206692, 0.01028370950371027, 0.013071564957499504, -0.0037975977174937725, 0.015384080819785595, 0.030378369614481926, -0.04313191398978233, -0.03065689280629158, -0.0064235045574605465, -0.01922553777694702, -0.0020126947201788425, 0.002721573458984494, 0.026140401139855385, -0.0037311259657144547, 0.0971209928393364, -0.016629498451948166, -0.04104311019182205, 0.02936336025595665, 0.02969108335673809, -0.007499670144170523, -0.04040921479463577, -0.018508469685912132, -0.010216721333563328, -0.07259397208690643, 0.04238228127360344, 0.006709419656544924, 0.05117440223693848, -0.030970022082328796, 0.026544008404016495, 0.006794460583478212, -0.0029177593532949686, 0.03870340436697006], [0.011115234345197678, -0.026412762701511383, 0.09062961488962173, -0.025767488405108452, 0.01633976399898529, -0.06168500706553459, -0.016682593151926994, 0.0445934422314167, 0.0026118257082998753, -0.024450037628412247, -0.01862027496099472, 0.0005445347633212805, 0.007044814992696047, 0.02722933329641819, 0.016212614253163338, -0.003931763581931591, -0.04270286113023758, -0.031023679301142693, 0.020333630964159966, -0.0249958373606205, -0.028028497472405434, -0.028589867055416107, -0.015679718926548958, -0.014217360876500607, 0.0010840005706995726, 0.03883093222975731, 0.03525105491280556, 0.003831342328339815, -0.0031574852764606476, -0.006716330070048571, -0.011795681901276112, -0.027031803503632545, -0.060265228152275085, 0.036931607872247696, 0.003420111956074834, -0.026571981608867645, 0.021071307361125946, 0.03316272050142288, 0.016665559262037277, 0.01777421496808529, -0.0362226739525795, -0.025714779272675514, 0.027628526091575623, 0.037059251219034195, -0.04277893900871277, 0.0021235153544694185, -0.041854482144117355, 0.005664135329425335], [-0.01749366708099842, -0.03170403093099594, 0.05352814495563507, -0.0020042050164192915, -0.0036273833829909563, 0.053920190781354904, 0.017895858734846115, 0.01278412714600563, 0.003323022276163101, -0.03503694385290146, -0.030434969812631607, -0.018562480807304382, -0.05406557396054268, 0.03214544430375099, -0.05062297731637955, 0.020982418209314346, -0.0440908782184124, 0.019524607807397842, 0.00970050971955061, -0.04892338439822197, 0.013099303469061852, 0.002927035791799426, 0.018954213708639145, 0.05254239961504936, -0.02799595147371292, -0.028753407299518585, -0.007951169274747372, -0.040510937571525574, -0.009813650511205196, -0.03286302089691162, 0.012499877251684666, 0.027406830340623856, 0.033698953688144684, 0.005906787235289812, -0.053707025945186615, 0.03174249082803726, -0.05100194737315178, -0.003960126545280218, -0.021832844242453575, 0.0051055471412837505, -0.023586848750710487, 0.03363591060042381, 0.060292795300483704, 0.046940673142671585, 0.015542865730822086, -0.011499018408358097, -0.060853391885757446, -0.013864985667169094], [0.03164808452129364, 0.03707818686962128, -0.05052622780203819, -0.018079182133078575, 0.0695071741938591, 0.03528293967247009, -0.01977609470486641, 0.012765160761773586, -0.004755853675305843, -0.004440802615135908, -0.0013403395423665643, -0.0003694986517075449, 0.0367257222533226, 0.021961020305752754, 0.01641067862510681, -0.003054293105378747, -0.020053362473845482, -0.0029848485719412565, -0.030274221673607826, 0.03443567454814911, 0.0254230834543705, 0.05607545003294945, 0.04587817192077637, 0.019269345328211784, 0.06011265516281128, -0.028169283643364906, 0.04039779677987099, -0.005100461654365063, -0.02505120076239109, 0.008860827423632145, -0.041710931807756424, -0.0282539464533329, 0.037839557975530624, 0.01621944084763527, -0.052124738693237305, 0.0011476476211100817, -0.0564207099378109, 0.012179910205304623, -0.042403340339660645, 0.0295686274766922, -0.01206103153526783, 0.008325018920004368, -0.035932984203100204, -0.003986622206866741, 0.029735587537288666, 0.03180655092000961, -0.020853284746408463, -0.008815464563667774], [-0.003986217547208071, 0.017275217920541763, -0.03286579251289368, -0.010294524021446705, 0.02144451066851616, -0.01047653891146183, -0.02450060285627842, -0.07391920685768127, -0.00976447481662035, -0.031029023230075836, -0.012250161729753017, -0.016392724588513374, -0.015504476614296436, 0.0664491206407547, -0.0349598228931427, -0.0056288219057023525, -0.028725432232022285, -0.0696427971124649, -0.034227896481752396, -0.0372333787381649, -0.011137993074953556, 0.003774763783439994, -0.009593809954822063, -0.03667421638965607, 0.016242841258645058, -0.0011647770879790187, 0.0499531626701355, -0.004233665764331818, 0.024037593975663185, 0.03471854329109192, 0.06244426593184471, -0.05225202813744545, -0.053997818380594254, -0.029242726042866707, -0.041509415954351425, 0.007953546941280365, 0.03591064736247063, -0.04949723184108734, -0.03793835639953613, 0.026566142216324806, 0.022567646577954292, 0.015957169234752655, 0.019288724288344383, 0.03780660405755043, 0.037719883024692535, -0.049469172954559326, 0.07486024498939514, -0.020953141152858734], [-0.03713291138410568, 0.030081601813435555, 0.058347661048173904, -0.044619664549827576, -0.009612704627215862, 0.07919566333293915, -0.03724869340658188, 0.009842668659985065, -0.014743220992386341, -0.0256245955824852, -0.0208634901791811, 0.000713010027538985, 0.004325960297137499, 0.03915267437696457, 0.016676422208547592, -0.01073409989476204, -0.010239941067993641, 0.006600348744541407, -0.003271787893027067, 0.01684303767979145, 0.011489271186292171, 0.07080169767141342, -0.019652368500828743, -0.012195644900202751, -0.0203519519418478, 0.006728376727551222, -0.01867830380797386, 2.18130589928478e-05, 0.06060478091239929, -0.03142823651432991, -0.05185025557875633, 0.004438595846295357, -0.04742563143372536, -0.03086543269455433, -0.016174225136637688, -0.0025134137831628323, -0.02889890968799591, 0.007370836101472378, 0.023962456732988358, 0.01336260698735714, 0.04050580412149429, 0.022253358736634254, 0.01952727511525154, 0.051506709307432175, 0.009970140643417835, 0.008550130762159824, -0.017559459432959557, 0.029373157769441605], [-0.013658910058438778, -3.956622094847262e-06, 0.010432256385684013, -0.034003846347332, -0.007856021635234356, -0.0020358727779239416, -0.007453364785760641, -0.013746748678386211, -0.01569722220301628, -0.027796687558293343, -0.00448244996368885, -0.012148206122219563, -0.04470035061240196, -9.935550042428076e-05, -0.02245068922638893, -0.0093404995277524, -0.06775607913732529, -0.06818042695522308, -0.013522999361157417, -0.01039609219878912, 0.05296575278043747, 0.015506638213992119, -0.016313202679157257, -0.02171170711517334, 0.027397705242037773, 0.0009994740830734372, 0.009343639947474003, -0.07804735004901886, 0.04871172085404396, -0.013388254679739475, -0.017818335443735123, -0.03736577555537224, 0.010913873091340065, -0.03727831318974495, 0.002849140204489231, -0.004767592530697584, -0.013321398757398129, -0.016730522736907005, 0.01892782375216484, 0.02445848286151886, -0.02268696203827858, 0.018417635932564735, 0.003851659130305052, 0.031025512143969536, -0.02683393284678459, 0.026401575654745102, 0.018919864669442177, 0.03398158773779869], [-0.006222106516361237, 0.0002518422552384436, 0.022056620568037033, -0.04817557334899902, -0.029836248606443405, -0.012034912593662739, 0.01198652759194374, -0.059799160808324814, 0.03704919293522835, -0.02634136565029621, 0.008695120923221111, -0.0022717469837516546, 0.023901937529444695, -0.07072774320840836, 0.024469463154673576, 0.006115713622421026, 0.05369517579674721, 0.020634667947888374, -0.043647605925798416, -0.0046667964197695255, 0.021128788590431213, -0.014331177808344364, -0.0239047110080719, -0.027995768934488297, 0.005777118727564812, 0.018221864476799965, -0.04852431267499924, 0.022710410878062248, -0.016372479498386383, 0.006279063876718283, -0.004445577505975962, 0.014896044507622719, 0.028159845620393753, 0.005021390039473772, -0.000599465100094676, -0.002431402914226055, 0.016541611403226852, -0.0046207294799387455, 0.01275486871600151, 0.014213614165782928, -0.012478208169341087, -0.00817952398210764, -0.06432682275772095, 0.02478565275669098, 0.013319481164216995, 0.01846909709274769, 0.03681819140911102, 0.00537848612293601], [0.028754642233252525, -0.007464590482413769, 0.024587273597717285, 0.056484661996364594, 0.04199530929327011, -0.030491389334201813, -0.0075148604810237885, -0.018061170354485512, 0.027540521696209908, -0.02604174055159092, 0.0416448600590229, -0.007217981852591038, -0.008836233988404274, 0.014078830368816853, 0.02761855721473694, -0.004508507903665304, 0.011001063510775566, 0.0061622862704098225, 0.013066005893051624, 0.0036983354948461056, -0.026170639321208, -0.0006491498206742108, -0.019566474482417107, -0.00896773673593998, 0.014280674047768116, 0.024050822481513023, 0.026104653254151344, -0.009087827987968922, -0.07701195031404495, 0.005311004817485809, 0.012122075073421001, 0.029364246875047684, -0.02038329839706421, 0.01608736626803875, 0.012311359867453575, -0.024375682696700096, 0.008453797549009323, -0.011190335266292095, 0.019984938204288483, -0.01895771734416485, -0.026684440672397614, -0.03236324340105057, -0.022680679336190224, 0.03042748011648655, 0.0010803240584209561, -0.011731593869626522, 0.0010188061278313398, 0.029022250324487686], [0.012791665270924568, -0.012939119711518288, -0.07276495546102524, 0.07681875675916672, 0.05779274180531502, 0.0448852963745594, -0.007810862734913826, 0.06377428025007248, -0.012125138193368912, -0.02111957222223282, 0.018961358815431595, 0.0001452350552426651, 0.012689796276390553, 0.018291281536221504, 0.009538769721984863, 0.008335591293871403, -0.06552646309137344, -0.02562292292714119, 0.010164289735257626, 0.046709094196558, 0.008212268352508545, 0.07255207002162933, -0.0021530580706894398, 0.03129309415817261, 0.02937685139477253, -0.016468413174152374, -0.03499177470803261, -0.020385991781949997, -0.05536170303821564, -0.000967657077126205, -0.012920699082314968, -0.008519685827195644, -0.06636316329240799, -0.019632816314697266, -0.05485047399997711, -0.01645979844033718, -0.08413657546043396, 0.02845902554690838, -0.06438609957695007, 0.06398501247167587, -0.02252892032265663, -0.01581452041864395, -0.08393682539463043, -0.008895913138985634, 0.028323909267783165, 0.0633026584982872, -0.041135452687740326, -0.018535248935222626], [-0.01386322919279337, 0.04175569862127304, -0.03193487599492073, 0.034519776701927185, -0.02188200131058693, 0.04893387109041214, 0.012398282997310162, -0.006852277554571629, 0.009258723817765713, 0.028693994507193565, -0.0014275445137172937, -0.010472702793776989, 0.016146929934620857, 0.02049706131219864, -0.01930398680269718, 0.0016800601733848453, -0.001515788841061294, -0.016268160194158554, -0.0005424492410384119, -0.014102830551564693, 0.021604152396321297, 0.007854975759983063, 0.0021218156907707453, 0.005340482573956251, -0.033351410180330276, 0.007742048241198063, 0.015223652124404907, -0.0011482873233035207, 0.004944093991070986, -0.011559980921447277, -0.045355867594480515, -0.0013394425623118877, 0.051494646817445755, -0.010201697237789631, 0.014605280943214893, -0.04144744202494621, -0.01298786886036396, 0.001106342999264598, -0.025014715269207954, -0.00269709131680429, 0.006020200438797474, 0.016774196177721024, 0.012552784755825996, 0.015446587465703487, -0.011692728847265244, 0.01839439943432808, -0.011244089342653751, 0.003277650335803628], [-8.281253534620371e-41, 2.6832343254584462e-40, 1.042285797764799e-40, -2.758554117915905e-40, 1.6437651376069402e-39, -4.2368259068860844e-41, 3.3336750336440966e-40, 2.9182460909103613e-40, -1.9653281027078776e-39, 2.3951553871625503e-40, -1.569047903489141e-40, 1.9257204016137366e-40, -2.951274695714497e-41, -9.869625343932552e-41, -3.5127189384308784e-40, -1.843926610251097e-40, -8.760637739265891e-41, 6.319393645611698e-40, -2.0602030152349893e-40, 3.170577905381331e-41, 7.122071418961596e-40, -1.8169516148128443e-40, -9.26258284918704e-41, 7.862805305517478e-32, -3.4110407218594697e-41, -3.2448046850366167e-40, 1.7777572967656792e-40, -1.1352619508727506e-40, 6.83735559698008e-41, 8.307710049626824e-40, 1.1200298365655398e-40, -5.081668751027517e-41, -2.254549099252198e-40, 3.208749275549539e-40, -1.014512062201881e-40, -3.385481037870185e-40, -1.8665295544806563e-41, 5.813286679251504e-41, 2.212594223230313e-40, 2.5592053983810567e-40, 3.2271343114014807e-40, 2.8112251711892547e-29, -3.3804924153371887e-41, 1.593556613630182e-41, -1.909423300473639e-40, -9.051267040766858e-41, 4.409659256878979e-39, 1.3323125409261063e-40], [-1.445957846382849e-40, 3.222285818714917e-41, -2.0111435559989775e-40, 1.9525692801902e-41, 5.441241936973265e-42, -4.931729815344761e-41, -3.0967855282499862e-40, 2.5198289115335293e-40, 2.9525779032863193e-40, 2.384928710969908e-38, -3.0485948740618558e-40, 6.489833577827525e-41, -2.9597525514236624e-40, -2.5318520523574362e-40, 5.232868855328164e-41, -8.728688134279286e-41, 2.5711584742817474e-40, -6.8943884444781e-42, 2.1119389545378616e-40, 4.6346545409079e-41, 3.2116499633706915e-40, -2.6950598831988834e-39, 1.0856139462817223e-40, 7.723256486126229e-41, 2.5176288729445393e-40, -4.113053417427666e-39, 4.2323865933511034e-39, -3.5352518177372215e-40, 2.08147472592344e-40, -2.2752715009426336e-39, -8.512187521541101e-41, 1.6332273731552175e-40, -3.4357035748315865e-41, 3.2187685595694616e-40, 2.3803576753792803e-40, 4.339224072476802e-25, -2.119804080731562e-32, 1.4267320314523125e-40, 5.439560378816075e-41, 2.574647707457916e-40, 5.255595113822584e-39, 1.2245807149888144e-40, 2.782936711195157e-40, -2.329070151584992e-40, -3.2542354237015227e-41, -1.210823322701304e-35, -7.31898187916852e-42, 2.0677069685114487e-39], [3.282023172249084e-40, 7.373912778970052e-41, -5.162537685403702e-40, -1.1753951388910133e-40, 2.5059420437520704e-41, 7.12588295078456e-41, -2.3580069648732994e-40, 1.986774975704369e-40, -3.6038453775659213e-40, -1.4097763200339822e-40, 1.2786848486963956e-41, -1.673010236557399e-41, 2.1987774203720705e-41, 2.1323558731630741e-41, 2.9573423180650237e-40, -3.1235503289185902e-40, -1.0245369514156608e-39, 3.1022365792762098e-40, 4.819065418813046e-42, 2.386677531453385e-40, -1.075720779123589e-40, -2.0172392043187904e-40, -2.4969877465650348e-40, -1.0542949256040626e-40, -7.44720068865424e-41, -7.022467124117388e-41, -3.054704535366312e-40, -6.193739212315691e-42, 2.1474898965777822e-41, -8.583093223835937e-41, 6.58610278232664e-43, -3.160180270776041e-40, 1.7448548088233325e-40, -5.368374416828374e-41, 2.7148055798596844e-40, 7.527214830967187e-41, 5.276028848029369e-41, 5.896804067725263e-41, 3.1415149752312344e-40, 4.1751687744557925e-41, -1.8546885824571116e-40, 4.3100801854071286e-39, 2.002021102996223e-40, 7.434448872628884e-41, 3.5714473570707315e-40, -2.018738593675618e-40, 1.846666148748852e-39, -2.4729274519325777e-40], [0.06964326649904251, -0.04977443441748619, 0.06351686269044876, 0.0011031720787286758, -0.013278665021061897, -0.00676072807982564, 0.012014349922537804, 0.036102138459682465, 0.023693248629570007, 0.037070877850055695, 0.020897438749670982, 0.02277286723256111, 0.009815366007387638, -0.03156520053744316, -0.06108642742037773, 0.007899113930761814, -0.028353463858366013, 0.01732969656586647, -0.004191826097667217, 0.0002619526640046388, -0.03841226175427437, 0.03875350207090378, 0.003413756610825658, -0.03834427520632744, 0.025428252294659615, -0.01248210109770298, -0.003719315631315112, 0.029280437156558037, -0.0012204456143081188, 0.04565717279911041, 0.02102149836719036, 0.007986162789165974, -0.013203770853579044, 0.00679763313382864, -0.006589239928871393, -0.09863491356372833, 0.00495948875322938, 0.030315177515149117, 0.039156556129455566, -0.022101497277617455, 0.024606039747595787, -0.03443310782313347, -0.017949236556887627, 0.03226237744092941, -0.03429120033979416, 0.00865138228982687, 0.026989363133907318, -0.04230538010597229], [0.03476385027170181, -0.0390140637755394, 0.0028259388636797667, -0.04760828614234924, -0.006198239978402853, 0.05832049250602722, 0.014443549327552319, 0.022750340402126312, -0.0052139125764369965, 0.01728389598429203, -0.02218841388821602, 0.009472650475800037, -0.005222833715379238, -0.01566752977669239, -0.005731360521167517, 0.0035872473381459713, -0.013607015833258629, 0.0025178189389407635, 0.04608143866062164, -0.020490683615207672, -0.052068375051021576, 0.023357762023806572, -0.013113788329064846, -0.029313353821635246, -0.008837942965328693, 0.03042757697403431, -0.02685241773724556, 0.012737631797790527, 0.06148078665137291, 0.014892840757966042, -0.02206323854625225, 0.011202082969248295, -0.020038506016135216, -0.026426536962389946, 0.0009908791398629546, -0.020549437031149864, 0.018763380125164986, 0.0014862027019262314, 0.024649757891893387, -0.031801581382751465, -0.00034354691160842776, 0.005988566670566797, 0.031830333173274994, 0.028784729540348053, -0.013392766006290913, 0.06903738528490067, -0.0313955619931221, -0.02841378003358841], [0.036190859973430634, -0.03613246977329254, 0.037326667457818985, -0.07283994555473328, 0.050554655492305756, -0.034950219094753265, -0.002482230309396982, -0.014616832137107849, -0.003050136147066951, 0.02625920996069908, -0.050020355731248856, 0.01939919777214527, -0.042946942150592804, 0.06291793286800385, -0.03339406102895737, -0.00022187251306604594, 0.006927812937647104, -0.007285075727850199, -0.01622582972049713, -0.020969096571207047, 0.03191704303026199, 0.021109867841005325, 0.01256826613098383, 0.005309524014592171, 0.008271943777799606, 0.011234557256102562, 0.028495993465185165, 0.000624100910499692, 0.04693923518061638, -0.008828358724713326, 0.02123831957578659, 0.010050119832158089, 0.020541789010167122, -0.027080031111836433, -0.010443043895065784, -0.023831715807318687, 0.07114771008491516, 0.0073889256455004215, 0.004669283051043749, -0.00022900974727235734, -0.017929811030626297, -0.027728011831641197, 0.007722515147179365, 0.00352323055267334, -0.016286712139844894, 0.029953353106975555, 0.010534357279539108, -0.0032663769088685513], [-0.022720128297805786, 0.010507185012102127, -0.010506843216717243, -0.018313301727175713, 0.01614529825747013, 0.015702005475759506, 0.007309501525014639, 0.020771199837327003, 0.0194509569555521, 0.024576444178819656, -0.00579683855175972, -0.025806784629821777, 0.028976064175367355, 0.017953818663954735, 0.027050580829381943, -0.002149011008441448, 0.019937850534915924, 0.03498595580458641, 0.0434122234582901, -0.0038082057144492865, 0.026060065254569054, 0.020060332491993904, 0.0016617306973785162, -0.00830123946070671, -0.02323218807578087, 0.03946256265044212, 0.01628425531089306, 0.03889092430472374, 0.043015334755182266, 0.014914531260728836, -0.025857673957943916, 0.0012137779267504811, -0.002704308135434985, 0.005748904775828123, 0.0008763603400439024, -0.040915798395872116, -0.01593765988945961, 0.05651841685175896, 0.0028951202984899282, 0.0005859405500814319, -0.000639386591501534, -0.020908640697598457, -0.02007521130144596, 0.007301331032067537, -0.002006477676331997, 0.010247725062072277, -0.01464603841304779, 0.02164793573319912], [-0.03778800368309021, -0.00968720018863678, 0.04541196674108505, 0.024646515026688576, -0.016032850369811058, 0.01976899243891239, 0.01590433157980442, -0.03607029467821121, -0.008631369099020958, 0.011130877770483494, 0.014390474185347557, -0.0007518697530031204, -0.014110312797129154, -0.020310163497924805, -0.004182085860520601, 0.004149788059294224, 0.00468539958819747, 0.027954276651144028, -0.0414874404668808, 0.0006719136144965887, -0.0009967942023649812, 0.0018909708596765995, 0.011663726530969143, -0.0025833130348473787, 0.04930168017745018, -0.037050459533929825, 0.018519893288612366, -0.024784663692116737, 0.0023701624013483524, 0.010775984264910221, -0.01850571483373642, 0.017325663939118385, -0.03234902024269104, -0.030615340918302536, 0.014347701333463192, 0.02754743956029415, 0.037998199462890625, 0.03127561882138252, -0.011663869954645634, -0.028541674837470055, 0.005054562818259001, 0.025620821863412857, -0.004951212555170059, 0.015641821548342705, 0.015649225562810898, 0.02431507781147957, -0.0358673632144928, -0.01680472306907177], [0.03804472088813782, -0.002622853731736541, -0.0016583778196945786, -0.043229635804891586, 0.014651783742010593, 0.02055244706571102, -0.028378669172525406, -0.011249342001974583, 0.005732919089496136, 0.039875999093055725, 0.018263401463627815, -0.02469966560602188, 0.04844699800014496, 0.04295995831489563, -0.0031669996678829193, -0.000817168562207371, -0.05284736678004265, 0.026626331731677055, -0.010725890286266804, 0.015451514162123203, 0.0026514995843172073, 0.0211323332041502, 0.02178620547056198, 0.01390961091965437, -0.022247400134801865, 0.04988643154501915, 0.02611914463341236, 0.04784395173192024, -0.04445142298936844, -0.008140685968101025, -0.01977209560573101, -0.03654959797859192, -0.01404497493058443, -0.016528360545635223, 0.002433881862089038, -0.049106091260910034, -0.030394800007343292, 0.036477230489254, -0.01706138625741005, 0.016784679144620895, 0.060645055025815964, 0.027780205011367798, -0.02034219726920128, -0.07233382761478424, -0.005059253890067339, 0.008670883253216743, -0.03804805129766464, 0.0015525774797424674], [-0.026823053136467934, 0.023760464042425156, -0.0015132351545616984, -0.030059009790420532, -0.02334463968873024, 0.031098969280719757, -0.0032996193040162325, -0.019773736596107483, -0.020767832174897194, -0.033296726644039154, -0.03296726942062378, 0.00895859394222498, 0.014328830875456333, 0.04888447746634483, 0.025485200807452202, -0.01851547881960869, -0.017115933820605278, -0.03285948559641838, 0.06751135736703873, -0.015477153472602367, 0.02239680476486683, -0.005232839845120907, 0.02512124925851822, 0.002222000155597925, -0.02575143240392208, 0.018185939639806747, -0.018109073862433434, 0.022333037108182907, 0.06445594877004623, -0.06627295911312103, 0.007878929376602173, 0.029031231999397278, 0.032850686460733414, -0.00676045473664999, -0.003703497350215912, 0.027935806661844254, 0.001604435732588172, -0.008844234049320221, 0.017555562779307365, -0.006626506801694632, -0.030422993004322052, -0.02599211595952511, 0.021274102851748466, 0.058106809854507446, -0.020336594432592392, 0.013834758661687374, 0.027555422857403755, 0.0270991250872612], [0.018169887363910675, 0.019130626693367958, 0.004607631359249353, -0.026378996670246124, 0.017341746017336845, 0.0031443913467228413, -0.04270617663860321, -0.02778349630534649, -0.0027737601194530725, -0.016814418137073517, 0.0032119001261889935, 0.012345974333584309, -0.011827854439616203, 0.0023754786234349012, 0.0040926244109869, 0.004280076362192631, 0.01137945894151926, -0.0025756743270903826, 0.004907014314085245, -0.027340279892086983, 0.0404859334230423, 0.02797050029039383, 0.013752023689448833, 0.012541587464511395, -0.031394731253385544, -0.03740137070417404, -0.004595611710101366, 0.018826382234692574, -0.021086707711219788, 0.0033921687863767147, -0.027771325781941414, -0.0317726694047451, 0.03606007620692253, -0.04851137101650238, 0.003238342236727476, -0.005836554802954197, -0.04342370852828026, 0.03926093503832817, -0.034097813069820404, -0.0052320887334644794, 0.052338916808366776, -0.011392631568014622, 0.026603583246469498, 0.057263001799583435, -0.02557378262281418, 0.018448272719979286, 0.03135096654295921, 0.026159750297665596], [-0.04632725566625595, 0.017235226929187775, 0.04042379930615425, 0.014169098809361458, 0.008036870509386063, 0.0468868725001812, -0.024981006979942322, -0.031763456761837006, 0.004711724817752838, -0.010064063593745232, -0.015739286318421364, 0.004375376272946596, -0.013085671700537205, 0.03670089691877365, -0.00486418791115284, -0.009110288694500923, 0.022272737696766853, 0.01486740168184042, -0.007725127041339874, 0.021641293540596962, -0.006300964392721653, -0.00542684830725193, 0.01090159546583891, 0.015334014780819416, -0.045541033148765564, -0.02936716005206108, 0.002735556336119771, 0.03862578794360161, -0.006117271725088358, 0.01042402908205986, -0.005226458422839642, -0.0231498833745718, -0.038010671734809875, 0.006952809635549784, -0.009156163781881332, -0.009079852141439915, -0.0073852939531207085, 0.0017404493410140276, -0.01891888491809368, 0.02276727184653282, 0.03514658287167549, -0.004627640824764967, -0.011265144683420658, 0.004452685825526714, -0.010715825483202934, -0.00893903523683548, 0.007121151778846979, -5.444444468594156e-05], [0.0006194068118929863, -0.0036265323869884014, -0.015792805701494217, 0.007539613172411919, -0.01175195723772049, 0.061253901571035385, 0.019955815747380257, 0.013648269698023796, -0.0003591778804548085, 0.032410748302936554, 0.05578496307134628, 0.0051766447722911835, -0.015533335506916046, 0.03265546262264252, -0.007203017361462116, 0.011925473809242249, -0.013326454907655716, 0.006324926856905222, -0.018077434971928596, -0.0006081402534618974, 0.03473629057407379, -0.01582397148013115, 0.01001859549432993, -0.0007659163675270975, -0.024940097704529762, 0.004692681133747101, 0.017234493046998978, 0.014741419814527035, -0.0019331806106492877, 0.028960205614566803, 0.06154908239841461, -0.005080968141555786, -0.014226584695279598, -0.004819950088858604, -0.011482288129627705, 0.01773129776120186, -0.011602710001170635, 0.030494874343276024, -0.006906022317707539, 0.02406337857246399, 0.02109093777835369, 0.03593042865395546, 0.006095492746680975, -0.051169052720069885, 0.03833635151386261, -0.02022034302353859, 0.041027508676052094, 0.054034147411584854], [-0.00849025510251522, 0.012981947511434555, -0.037319816648960114, 0.05337262526154518, -0.027012482285499573, 0.05342577025294304, 0.020180506631731987, 0.012951510958373547, 0.015009433962404728, 0.05636543035507202, -0.030101990327239037, 0.0032934374175965786, 0.009917208924889565, -0.022172167897224426, 0.028595848008990288, 0.0037390957586467266, 0.00754961185157299, -0.002487368416041136, -0.014779804274439812, 0.015163907781243324, 0.028031693771481514, -0.015474366024136543, -0.023222826421260834, -0.0030335658229887486, -0.020743977278470993, 0.013804914429783821, 0.020086420699954033, -0.025394536554813385, -0.0673716589808464, 0.01586531102657318, 0.05534561723470688, 0.004656899254769087, -0.006096140015870333, -0.004533656407147646, -0.028747085481882095, 0.0362561009824276, 0.08370563387870789, 0.06864194571971893, -0.027304749935865402, -0.009668370708823204, -0.025065626949071884, 0.01549719087779522, 0.003085586242377758, 0.022812722250819206, -0.0013774376129731536, -0.00038382146158255637, -0.04951074346899986, 0.02565942145884037], [0.01687021180987358, -0.05628471449017525, 0.014490993693470955, -0.052492447197437286, -0.05523006618022919, -0.03564991056919098, -0.004327514674514532, 0.03190644085407257, -0.052399586886167526, 0.027891060337424278, -0.04495782032608986, -0.0179975014179945, -0.13693277537822723, 0.04454619437456131, -0.0014958239626139402, 0.00456160819157958, -0.07931487262248993, -0.06564909219741821, 0.045441653579473495, -0.04557270556688309, 0.0413607694208622, 0.042794279754161835, 0.08457208424806595, -0.022603437304496765, 0.029986223205924034, -0.019796080887317657, 0.035244639962911606, -0.0179392509162426, 0.056260108947753906, -0.003967700060456991, 0.08065351098775864, -0.08225459605455399, 0.10911647975444794, 0.0045614177361130714, -0.005792245734483004, -0.010449215769767761, 0.00687346002086997, 0.005764457397162914, -0.008158233016729355, -0.05495940148830414, 5.157494160812348e-05, 0.0005502321291714907, -0.026187635958194733, 0.1005275771021843, -0.017657019197940826, -0.05542513355612755, -0.005636207293719053, 0.06586962193250656], [0.01677398756146431, 0.04218561574816704, 0.045470234006643295, 0.03696376457810402, -0.012696821242570877, 0.04568811133503914, -0.0053085507825016975, -0.009367989376187325, 0.031277090311050415, -0.01026115845888853, 0.02070322446525097, 0.004543684888631105, 0.032530441880226135, 0.03759128972887993, 0.002281029475852847, -0.001235037692822516, 0.009045460261404514, -0.001065657357685268, -0.05193720757961273, -0.008296334184706211, -0.0014851873274892569, -0.012624511495232582, 0.011875123716890812, -0.040446288883686066, -0.002901107305660844, 0.0005479876417666674, -0.002140493132174015, 0.026908302679657936, 0.020837951451539993, -0.00808552373200655, -0.02891859970986843, 0.026047464460134506, -0.0016984473913908005, -0.04840391129255295, -0.02028781734406948, -0.009684354066848755, -0.022029124200344086, 0.005726208910346031, -0.022028349339962006, 0.003985698334872723, -0.014630729332566261, -0.03021126799285412, 0.02654387429356575, -0.009297833777964115, 0.01047901064157486, -0.001962021691724658, -0.02143203653395176, 0.051773298531770706], [0.042613666504621506, -0.029951024800539017, -0.01696893572807312, -0.025293786078691483, 0.00013443606439977884, -0.010458182543516159, 0.023565514013171196, -0.017793642356991768, 0.028869671747088432, -0.021729851141572, 0.003857044270262122, -0.005012122448533773, 0.04375123605132103, 0.058335237205028534, 0.0421207956969738, 0.011507169343531132, -0.007908822037279606, 0.01446661725640297, -0.035877954214811325, -0.022822966799139977, -0.04278183728456497, 0.010548236779868603, -0.01490527018904686, -0.017648259177803993, -0.04217943549156189, 0.00014483954873867333, -0.03938509151339531, -0.010404206812381744, 0.002890442730858922, 0.011119178496301174, 0.010730765759944916, 0.029427967965602875, 0.017551660537719727, 0.020667804405093193, -0.03658068925142288, -0.011471268720924854, 0.06480593234300613, -0.004944483749568462, 0.024078652262687683, -0.010231374762952328, -0.00785053987056017, 0.018663225695490837, 0.023262735456228256, -0.01049109362065792, -0.006080328486859798, 0.04551262781023979, 0.04280133917927742, -0.013151708990335464], [-0.050082094967365265, 0.006252393592149019, -0.007085041143000126, -0.004786152392625809, 0.021751128137111664, 0.020968511700630188, 0.020558563992381096, -0.04280340299010277, 0.004646752495318651, -0.001436543301679194, 0.0019739156123250723, 0.0016260931733995676, -0.026022154837846756, 0.00649675540626049, -0.03331062197685242, 0.005912357941269875, -0.011114060878753662, 0.008411247283220291, -0.004340279381722212, 0.03567562252283096, -0.014247902669012547, -0.0002482777927070856, 0.03038109466433525, 0.008762246929109097, 0.03631078824400902, 0.00474445940926671, 0.01489889994263649, 0.049340784549713135, 0.0102079464122653, 0.03624780476093292, -0.01530519314110279, 0.02744343690574169, -0.04422794282436371, -0.0011562923900783062, -0.016534389927983284, -0.023892482742667198, 0.018004950135946274, -0.01584303192794323, -0.00896107591688633, -0.019858073443174362, -0.021000662818551064, 0.026835739612579346, 0.026150263845920563, 0.04615484178066254, -0.010647568851709366, 0.0006578711909241974, -0.03640704229474068, -0.017854835838079453], [0.013394585810601711, 0.008164704777300358, -0.031234484165906906, -0.03502834588289261, 0.05391368642449379, 0.03128295764327049, -0.018893275409936905, -0.02902328036725521, -0.009753580205142498, -0.009778936393558979, -0.002044356893748045, -0.006983777973800898, -0.0054421271197497845, 0.06426989287137985, -0.005070444196462631, -0.006975091062486172, -0.03423025459051132, 0.018059851601719856, 0.01780598796904087, -0.008985653519630432, -0.01352537702769041, 0.010239885188639164, 0.02163919061422348, -0.008829341270029545, 0.02376651205122471, -0.013514013960957527, 0.024336012080311775, -0.030789325013756752, 0.010489319451153278, 0.007285191211849451, 0.008061888627707958, -0.003392020473256707, 0.05893634632229805, -0.042925477027893066, 0.015849454328417778, 0.02545851469039917, 0.012374689802527428, -0.03239408880472183, -0.0038487964775413275, -0.004104346968233585, 0.025591079145669937, 0.018763286992907524, -0.004634805489331484, 0.02574951760470867, 0.01999255269765854, 0.05454759672284126, -0.0007383165648207068, 0.006308719050139189], [-0.017806483432650566, 0.01692718267440796, 0.019627708941698074, 0.013445412740111351, 0.025261614471673965, -0.004229259677231312, -0.0289238803088665, -0.022847332060337067, -0.013912132009863853, -0.0429958775639534, 0.06270431727170944, -0.0023990676272660494, 0.023267116397619247, -0.03823275864124298, -0.03989491984248161, -0.011512239463627338, -0.018439549952745438, 0.03332684561610222, 0.00943344458937645, 0.01786717399954796, 0.05895761027932167, -0.01819966733455658, 0.006232627667486668, -0.012347657233476639, -0.004841421265155077, 0.016275346279144287, 0.02421323023736477, -0.005015320144593716, 0.01896177977323532, -0.005812301300466061, 0.014352635480463505, -0.01657603494822979, 0.027193346992135048, 0.011388031765818596, 0.022845027968287468, 0.04250982403755188, 0.013035565614700317, -0.02667047828435898, 0.0322953425347805, 0.020300762727856636, 0.031640954315662384, -0.007744618225842714, 0.00471213785931468, 0.03414866328239441, -0.00858386792242527, 0.01877131313085556, 0.016433926299214363, 0.024294229224324226], [0.002134329406544566, -0.03437148034572601, -0.021602779626846313, -0.011031457222998142, 0.04964442178606987, -0.023502124473452568, -0.021064240485429764, 0.00191015494056046, -0.03084380552172661, -0.015181699767708778, 0.03016080893576145, -0.006870125886052847, 0.0210525281727314, 0.02882879599928856, -0.0002890153555199504, -0.024253765121102333, 0.000793509534560144, -0.02085314691066742, 0.00630812905728817, -0.011298595927655697, -0.0037649418227374554, 0.037178415805101395, -0.0058515602722764015, 0.004860969725996256, 0.05846663564443588, -0.005661044269800186, 0.03687194734811783, 0.012016222812235355, 0.015767699107527733, -0.02967701107263565, 0.04345030337572098, 0.007130298763513565, -0.060733020305633545, 0.02843254618346691, -0.011293528601527214, 0.029101591557264328, -0.004536029417067766, 0.017041029408574104, 0.04719396308064461, -0.01676216907799244, -0.0013174323830753565, 0.01818370819091797, -0.01921416074037552, 0.021076656877994537, -0.02796092815697193, 0.025034001097083092, 0.05416054278612137, -0.03356606885790825], [-0.05874316021800041, -0.05927189067006111, 0.023467304185032845, 0.02426113374531269, 0.0377068929374218, -0.01892145350575447, 0.02606801874935627, -0.046992167830467224, 0.030182532966136932, 0.005361477378755808, -0.0498565174639225, 0.01058084238320589, 0.032873619347810745, 0.0242224782705307, 0.0398511067032814, 0.013922642916440964, 0.02464083582162857, -0.003200652077794075, -0.012149818241596222, -0.03474849462509155, 0.0026486844290047884, -0.02826314978301525, 0.018479542806744576, -0.01062401756644249, -0.007937796413898468, 0.010042407549917698, -0.019859209656715393, -0.05289914831519127, 0.0036427495069801807, -0.02423693798482418, 0.0035623274743556976, 0.026636779308319092, -0.03797326609492302, -0.013437459245324135, -0.04684469848871231, -0.003840769175440073, 0.039800290018320084, 0.019904635846614838, 0.03682757914066315, -0.0007691422360949218, -0.021663382649421692, -0.020619841292500496, -0.07454358786344528, -0.033190567046403885, -0.01207643374800682, 0.07218833267688751, -0.04388251528143883, -0.0381196029484272], [0.03834587335586548, 0.021517662331461906, 0.06411661952733994, -0.0038366769440472126, -0.008102799765765667, 0.022983131930232048, -0.009933184832334518, 0.02196350321173668, 0.0059678517282009125, -0.007022379897534847, 0.002833480481058359, 0.000859031337313354, -0.0021943403407931328, 0.025040995329618454, 0.02732061967253685, -0.008859793655574322, 0.00282484432682395, -0.018101705238223076, -0.0076662516221404076, -0.004794546402990818, 0.0645717903971672, -0.02965126559138298, 0.028867818415164948, -0.008008178323507309, -0.053699053823947906, -0.017181936651468277, -0.018186619505286217, 0.013347511179745197, 0.024452654644846916, 0.009978784248232841, -0.00615376653149724, -0.023760754615068436, -0.010584672912955284, -0.04213332012295723, -0.0023386632092297077, 0.030879538506269455, -0.03755924105644226, -0.016122883185744286, -0.0160539373755455, -0.020281527191400528, -0.006567404605448246, 0.007030797190964222, 0.013238837011158466, -0.039267949759960175, -0.0011623470345512033, 0.04321691766381264, -0.031767938286066055, -0.017877498641610146], [-0.03140637278556824, 0.04752815514802933, -0.058926329016685486, 0.022721514105796814, 0.005518609657883644, 0.04200498014688492, -0.007327888626605272, -0.02868557907640934, 0.01051951665431261, -0.013772384263575077, -0.013868437148630619, 0.00431642634794116, 0.00019954060553573072, -0.018261991441249847, 0.005231944378465414, 3.619193012127653e-05, 0.010967212729156017, -0.00797082670032978, 0.030553989112377167, -0.04857338219881058, 0.015468613244593143, 0.01066785492002964, 0.0075735668651759624, -0.03175219148397446, 0.05383944883942604, 0.0011959999101236463, 0.011064263060688972, -0.036222055554389954, 0.0033529624342918396, 0.0006662612431682646, 0.05535050481557846, -0.005524443928152323, -0.023255541920661926, 0.0009770011529326439, 0.014040440320968628, -0.022188572213053703, 0.03058379516005516, 0.06288948655128479, -0.01643397845327854, -0.03014509193599224, -0.009377209469676018, 0.01230816449970007, 0.01655322127044201, 0.026730982586741447, 0.02412395179271698, -0.012404664419591427, -0.01978844590485096, 0.002490942133590579], [-0.024195261299610138, 0.01793828420341015, -0.01172814890742302, -0.010189147666096687, 0.018619738519191742, -0.009181302040815353, 0.0018368283053860068, 0.03973883017897606, -0.004718460608273745, 0.022213837131857872, 0.05270291492342949, 0.0020513401832431555, -0.022281456738710403, 0.007265930064022541, -0.01864083856344223, 0.0014960278058424592, 0.007254224736243486, 0.019730594009160995, -0.003105846466496587, -0.023311305791139603, 0.020795157179236412, 0.023906448855996132, -0.016817135736346245, 0.01315630879253149, 0.0059373402036726475, 0.0437919944524765, 0.02733175829052925, 0.00833313912153244, -0.0077284034341573715, -0.006468123756349087, -0.011007065884768963, 0.029192019253969193, 0.01091089192777872, -0.0032600434496998787, 0.042025525122880936, -0.006347246002405882, 0.022366492077708244, -0.012895460240542889, 0.031567592173814774, 0.0014550859341397882, -0.013132628053426743, -0.012869718484580517, 0.037834130227565765, -0.06738247722387314, 0.0010875898879021406, -0.012746026739478111, -0.03656740486621857, -0.03551752120256424], [0.022640971466898918, -0.012084697373211384, 0.03415803611278534, -0.0017170183127745986, 0.006365774665027857, 0.020522568374872208, 0.012898302637040615, -0.011187508702278137, -0.011877762153744698, 0.01106196828186512, 0.025365931913256645, 0.035168491303920746, 0.02707112766802311, 0.018830301240086555, 0.01871708407998085, -0.0016758344136178493, -0.016597596928477287, 0.0009577696910127997, 0.03876733407378197, 0.029651068150997162, -0.018002478405833244, -0.026274828240275383, -0.0314149372279644, -0.018687037751078606, 0.04527178406715393, -0.021154172718524933, 0.011575852520763874, 0.04050411656498909, 0.0137751754373312, 0.006327228620648384, 0.030208099633455276, 0.014705212786793709, 0.030595943331718445, -0.007916426286101341, 0.030797606334090233, -0.02033315598964691, -0.043653812259435654, -0.013203421607613564, -0.007997579872608185, 0.04078904539346695, 0.04631306231021881, 0.0008161067380569875, -0.026345504447817802, -0.04056957736611366, 0.015574050135910511, 0.08509756624698639, 0.06503273546695709, -0.027891015633940697], [1.875876215237703e-40, 2.2915433787103734e-41, 1.3129606091337806e-40, 3.410031786965156e-40, 3.200789900272174e-40, 1.9648546559687365e-21, 3.3108268621832804e-39, 1.5196381196370479e-40, 1.045676940048465e-40, 4.3831214665615953e-41, -2.1147555644511544e-40, -2.7878832947742236e-41, 4.938736307666385e-41, 5.798432915529661e-41, -8.100822344353908e-40, -2.3134036347538405e-41, -1.348497538189058e-40, 1.417216233970622e-38, -5.0516809638909655e-42, -2.5551976847730877e-40, 2.6670493281954946e-40, -2.2538904889739655e-40, -8.773753892891972e-40, 2.0072339332835112e-40, 1.6229838813810031e-41, 1.9895775726330185e-40, 2.0922226851448114e-40, -1.7806159456329018e-40, 6.743328470023885e-41, -1.1471309488655818e-40, 2.851432180131354e-40, -1.2135244701052916e-41, 1.771367375768358e-40, 6.296814523456032e-39, 1.5171718343398362e-40, 1.4050399312245643e-40, -1.0049832326444723e-40, -1.5813933429598426e-40, 5.942346267815819e-40, 3.057072729771021e-40, -1.65804436895841e-40, 1.064706573193996e-41, 1.2693662139086355e-40, 7.072773738986649e-41, 8.541194399752625e-41, -2.9575104738807427e-40, 1.1822895273354914e-40, -2.9184843116492965e-41], [1.2391682320024357e-40, 4.0294337341660115e-41, -3.2106970804149506e-40, -9.551950982070116e-41, 2.630881814831271e-40, -1.9448663425318066e-39, 7.393671087317032e-41, -3.0416304206941614e-40, -8.986106662175754e-41, -6.280745833965619e-40, -3.251600982588592e-40, -1.030430812756611e-40, 2.4047682946278186e-40, 3.1327848857984908e-40, -2.183110903540919e-40, -7.247936047027251e-41, -3.6422549684730645e-41, -7.415951732899797e-41, -1.9160654551945386e-40, -3.1383480407018603e-40, 1.530428117812349e-40, 2.856350737741134e-40, 2.6981161151495758e-40, -1.2904137168427943e-40, 2.8943119131396934e-40, -2.3664708075978213e-40, -5.903550049264656e-30, 7.456309128672352e-41, -1.0000786880193354e-40, -3.002534193539499e-40, -8.542735828063382e-41, -2.8001726823063522e-40, -1.1729008276245151e-40, 7.473825359476412e-41, -1.9913852476519975e-41, -3.3517377708492435e-40, -5.700342023026923e-41, -1.8815654870028616e-40, -1.0972377170432966e-39, 2.813219411461357e-29, -3.2138500019596815e-40, 1.7283895518675159e-40, -8.218908364644096e-39, 1.1607795959081055e-40, 5.242958204271303e-41, -2.210492275533826e-40, -1.070017494373787e-40, 3.207572184839506e-42], [-0.020022399723529816, -0.006202884949743748, -0.01637779362499714, 0.02674596756696701, -0.04606929421424866, -0.017361897975206375, -0.001485247164964676, 0.005710572935640812, 0.0062937005423009396, -0.0042596617713570595, 0.001091558369807899, -0.0004894973244518042, -0.034432586282491684, 0.009162459522485733, 0.002141023986041546, 0.001825776300393045, 0.004427713807672262, -0.015076438896358013, -0.011769779957830906, -0.013771455734968185, 0.0014619978610426188, -0.03790263459086418, 0.03051154688000679, 0.007381928153336048, -0.025022991001605988, 0.03003150410950184, 0.030023744329810143, -0.037979912012815475, 0.001913003739900887, 0.004397576674818993, 0.0004192391934338957, 0.04534337297081947, -0.03756827861070633, 0.02948274277150631, 0.026042014360427856, 0.008345368318259716, 0.04429962486028671, 0.023673169314861298, -0.020305650308728218, -0.0033608530648052692, -0.006669813767075539, 0.032050952315330505, 0.011615871451795101, -0.053007081151008606, -0.007115039974451065, 0.006829740945249796, 0.008152191527187824, 0.027463259175419807], [0.03988867253065109, 0.07052761316299438, -0.005937138572335243, -0.04433778300881386, -0.005220605526119471, 0.0017739437753334641, -0.00015921125304885209, -0.012486600317060947, 0.001146161463111639, -0.023570451885461807, 0.028889881446957588, -0.018203873187303543, -0.005367423873394728, -0.08530256152153015, 0.014254544861614704, 0.0010341787710785866, -0.04751152917742729, 0.0030022019054740667, 0.034920766949653625, -0.0146198570728302, 0.022956276312470436, -0.040544211864471436, 0.005322472658008337, 0.003190575400367379, 0.03619194030761719, -0.046514272689819336, -0.008031674660742283, 0.008770449087023735, 0.005610769614577293, -0.00691103283315897, -0.003010531421750784, -0.024301942437887192, 0.007085244636982679, 0.03724750131368637, 0.017716726288199425, -0.01631331443786621, 0.052168410271406174, 0.015835300087928772, 0.0017932913033291698, 0.01601743884384632, -0.031642619520425797, -0.01477185357362032, 0.04778219014406204, 0.02937246859073639, 0.010911799035966396, 0.020658129826188087, 0.03434818610548973, -0.03191274777054787], [0.019606517627835274, 0.003059402573853731, 0.023993149399757385, 0.018384002149105072, 0.0029070957098156214, -0.004395117983222008, 0.04374052956700325, -0.005464330315589905, 0.03439922258257866, 0.04034563526511192, 0.027497515082359314, 0.002190457656979561, 0.034943774342536926, -0.06290721893310547, 0.01736822910606861, 0.007528043817728758, -0.07925248146057129, 0.049735452979803085, 0.007238159887492657, -0.028893042355775833, -0.05364654213190079, -0.004252970218658447, -0.02204686589539051, -0.0037264369893819094, 0.0017895204946398735, -0.01780380681157112, -0.06510736793279648, -0.02889505960047245, -0.008973699994385242, 0.006778099108487368, 0.02397279441356659, 0.034793682396411896, -0.024729134514927864, -0.002579060848802328, 0.01864837110042572, 0.05747294798493385, -0.015413424000144005, -0.01990812085568905, -0.02835080772638321, -0.0002813493483699858, -0.0026801887433975935, 0.013240208849310875, 0.06608051061630249, 0.0012622862122952938, -0.016366340219974518, 0.02569149062037468, -0.002765397075563669, -0.01053699478507042], [0.013388000428676605, 0.032613370567560196, 0.015884483233094215, 0.035525981336832047, -0.007589598186314106, -0.01658526435494423, -0.016352474689483643, -0.026392264291644096, 0.0030092201195657253, -0.014338347129523754, -0.0161676574498415, -0.00010470091365277767, 0.021677903831005096, -0.01384542603045702, 0.05087526887655258, -0.006638393271714449, 0.033471252769231796, 0.012785781174898148, -0.0036969869397580624, -0.03690638020634651, 0.01048837136477232, -0.017110509797930717, -0.019748736172914505, 0.00811715517193079, 0.03868529200553894, 0.03903591260313988, -0.020730722695589066, 0.011147988960146904, 0.035704661160707474, -0.003954320214688778, 0.0009919124422594905, -0.019519025459885597, 0.010458214208483696, 0.03022868186235428, -0.009279616177082062, -0.013138620182871819, -0.02815309911966324, 0.008713219314813614, 0.017484115436673164, 0.0019811312668025494, -0.00914967991411686, -0.00021483039017766714, 0.014553421176970005, -0.014966162852942944, -0.023239966481924057, 0.017619663849473, 0.055340737104415894, 0.03032974898815155], [-0.00727659510448575, -0.024484416469931602, 0.02467239834368229, 0.02148454636335373, 0.046374544501304626, 0.030171865597367287, 0.021060820668935776, -0.005725170485675335, -0.032320536673069, -0.033403683453798294, -0.048314180225133896, -0.018148334696888924, 0.007331779692322016, 0.011850732378661633, -0.011824955232441425, 0.01915769837796688, 0.019282421097159386, -0.014508849009871483, -0.007526789791882038, -0.05129239335656166, -0.0446724034845829, 0.0386451855301857, -0.003880531759932637, 0.05297396704554558, -0.05960468575358391, -0.04255671054124832, 0.0037222467362880707, -0.04212070256471634, -0.002171474741771817, -0.033157482743263245, 0.011707811616361141, 0.026044845581054688, 0.048632360994815826, -0.0018598390743136406, -0.03224679082632065, 0.04499087482690811, -0.014937331900000572, -0.0072272163815796375, -0.009447193704545498, -0.003557783318683505, -0.020406577736139297, 0.002029924653470516, 0.06723927706480026, 0.043277934193611145, 0.01687236689031124, 0.02041737549006939, -0.04756507650017738, 0.02642110176384449], [0.029962196946144104, -0.017831386998295784, -0.056929655373096466, -0.0072440397925674915, 0.060701414942741394, 0.0059909941628575325, -0.010388192720711231, 0.04503897577524185, 0.0068870787508785725, -0.0017739833565428853, -0.010632607154548168, -0.0007096364861354232, 0.03909686580300331, 0.030289918184280396, 0.0002229432575404644, -0.006221984047442675, -0.003113129176199436, 0.007933881133794785, 0.0008552507497370243, -0.03279249370098114, 0.021905023604631424, 0.020363396033644676, 0.020206082612276077, 0.02317415177822113, 0.08459826558828354, -0.03386390209197998, 0.0358743742108345, -0.012433713302016258, -0.06131954491138458, -0.007518521510064602, 0.006738842930644751, -0.012746252119541168, -0.016425704583525658, 0.03643191233277321, 0.05026838555932045, -0.007762657478451729, 0.051447879523038864, 0.002420505043119192, -0.032467328011989594, 0.0021206815727055073, 0.00318502658046782, -0.008890217170119286, -0.009284424595534801, 0.02894710935652256, 0.03305564075708389, -0.01727198250591755, -0.003956872504204512, -0.0060501242987811565], [-0.02175002731382847, -0.003214046824723482, 0.07773706316947937, -0.01215345598757267, 0.014235539361834526, 0.006421662867069244, -0.01245302427560091, -0.008787810802459717, 0.003169378964230418, -0.032295096665620804, 0.014995661564171314, -0.02753569185733795, 0.014393285848200321, -0.0022412838879972696, -0.008800990879535675, -0.015096364542841911, -0.021010765805840492, 0.0017060425598174334, 0.01580791361629963, 0.00726077426224947, 0.00229151314124465, -0.014799939468502998, 0.009150716476142406, -0.008109242655336857, 0.00793610792607069, -0.010161916725337505, 0.0070969644002616405, 0.005275649018585682, 0.03335083648562431, 0.00492725009098649, -0.07447735965251923, -0.03400534763932228, -0.04072273522615433, -0.05030270665884018, 0.023907551541924477, 0.02589975669980049, -0.018208583816885948, 0.013090528547763824, 0.002449245657771826, 0.032927148044109344, 0.009987086057662964, 0.016990624368190765, 0.012280265800654888, -0.0049186027608811855, -0.03179532289505005, 0.05954717472195625, -0.003384190145879984, -0.03396055847406387], [-0.0817359983921051, 0.04497504234313965, -0.0031394807156175375, 0.026304787024855614, -0.00015211018035188317, 0.047338686883449554, -0.028255419805645943, 0.01492363028228283, -0.021055180579423904, 0.01325413677841425, 0.011220364831387997, -0.014658248983323574, -0.03402785584330559, 0.009775279089808464, 0.017005326226353645, -0.007714917883276939, -0.045989107340574265, 0.016012368723750114, -0.007805355824530125, 0.03675432503223419, -0.004322640597820282, 0.038738880306482315, 0.02378733456134796, -0.014557420276105404, 0.011011864989995956, 0.010713590309023857, -0.02453712560236454, -0.019379232078790665, -0.021938547492027283, -0.01965787075459957, 0.025671925395727158, -0.04397692158818245, -0.030629508197307587, -0.08932573348283768, -0.01929439604282379, -0.03169243782758713, -0.0018109632655978203, -0.07224740833044052, -0.041284702718257904, -0.004047065041959286, -0.006725891027599573, -0.01938452012836933, -0.014066547155380249, 0.06101444363594055, 0.012807399034500122, -0.009273963049054146, 0.006249791942536831, 0.02387841045856476], [-0.029928987845778465, -0.03139704838395119, 0.03389568626880646, -0.04157005250453949, -0.014181145466864109, 0.07211032509803772, -0.005744551308453083, 0.03253871947526932, -0.000830122095067054, -0.05920274928212166, -0.03365815803408623, -0.009841873310506344, 0.016795895993709564, 0.027849500998854637, -0.002650157082825899, -0.01118280366063118, 0.020065145567059517, -0.03307081758975983, -0.019080664962530136, -0.016983680427074432, 0.036129798740148544, 0.016370046883821487, -0.032077889889478683, -0.0375717356801033, 0.0011261113686487079, 0.005919215269386768, -0.016038063913583755, -0.07598959654569626, 0.039229054003953934, -0.016864804551005363, -0.023618703708052635, -0.009140612557530403, 0.018685195595026016, 0.008554601110517979, -0.052705150097608566, 0.01975802332162857, -0.027937375009059906, 0.048709139227867126, 0.04260064288973808, 0.003102406393736601, 0.0010839804308488965, -0.004780760500580072, 0.014161268249154091, -0.024228062480688095, -0.02667705900967121, 0.04189193621277809, -0.025569073855876923, -0.006031916942447424], [-0.004364370834082365, 0.013317374512553215, 0.023019826039671898, 0.06325648725032806, -0.0056299371644854546, 0.022591525688767433, 0.00839413981884718, -0.020057519897818565, 0.032358940690755844, -0.02682228572666645, 0.009717918001115322, 0.007627356331795454, 0.0012456332333385944, 0.030583927407860756, -0.0586770623922348, 0.0045410930179059505, -0.0036031859926879406, 0.043158143758773804, 0.04904089495539665, -0.009365231730043888, 0.05439792573451996, -0.01605832763016224, -0.019055098295211792, -0.03004719689488411, -0.0030462949071079493, -0.003508726367726922, -0.018717797473073006, -0.0033362319227308035, -0.027097396552562714, 0.025848956778645515, -0.0007583191036246717, 0.010057537816464901, 0.01221578661352396, 0.04815085604786873, 0.03587789833545685, 0.03264881297945976, -0.02030303329229355, -0.03227245807647705, 0.026561666280031204, 0.03184156119823456, -0.0008663467597216368, -0.03334025293588638, 0.027434997260570526, 0.015541385859251022, 0.01712126098573208, -0.009143966250121593, 0.016214847564697266, -0.032073985785245895], [0.00022819903097115457, 0.017075074836611748, -0.011671280488371849, -0.03695789724588394, -0.0018806292209774256, -0.025505777448415756, -0.00815995130687952, -0.07898437231779099, -0.02426886186003685, -0.0009479583241045475, 0.016440460458397865, -0.017772875726222992, -0.0005512045463547111, 0.02609601616859436, 1.1987605830654502e-05, -0.01870240457355976, -0.03411391004920006, -0.018653448671102524, -0.04246789216995239, 0.0013977239141240716, -0.03407437354326248, 0.019165314733982086, -0.009048566222190857, 0.003274043556302786, 0.09486652165651321, -0.013662124052643776, 0.018501698970794678, 0.028724053874611855, 0.007058874238282442, -0.028014585375785828, -0.007349648978561163, 0.04465566948056221, -0.016154209151864052, 0.01150332111865282, 0.010273641906678677, 0.07920137047767639, -0.04388251528143883, 0.054059818387031555, 0.0025186538696289062, -0.008093825541436672, 0.017875047400593758, 0.024105055257678032, 0.014240458607673645, 0.010045227594673634, -0.043868545442819595, 0.0044814469292759895, -0.007126019336283207, -0.0018214393639937043], [0.017423540353775024, 0.005090996157377958, -0.013278570026159286, 0.020575078204274178, 0.019852226600050926, 0.0639733374118805, -0.00555869797244668, -0.04483208805322647, -0.019621266052126884, 0.04101372882723808, 0.0029613112565129995, 0.0008757549803704023, 0.002084061037749052, -0.052441876381635666, 0.028625745326280594, 0.011288554407656193, 0.04399488493800163, -0.024711988866329193, -0.008959063328802586, -0.0035845250822603703, -0.048651073127985, 0.009658520109951496, 0.019407398998737335, 0.004174971487373114, -0.02510753460228443, 0.03521336242556572, -0.017174025997519493, 0.020246226340532303, -0.02234036661684513, 0.004414828959852457, 0.007691952865570784, 0.011432397179305553, -0.0057597472332417965, -0.004093751311302185, 0.06345132738351822, 0.0015559346647933125, -0.0199059396982193, -0.03637942671775818, -0.05873969569802284, 0.01370067149400711, 0.009127704426646233, 0.006289249751716852, 0.01983516477048397, 0.033100247383117676, 0.0009018978453241289, 0.0024318904615938663, -0.05135912820696831, -0.012860342860221863], [0.02461581863462925, 0.010129252448678017, 0.08401914685964584, 0.059646688401699066, -0.04290725663304329, -0.024638604372739792, 0.016244249418377876, -0.00568378297612071, -0.10232826322317123, 0.026347771286964417, 0.002039185957983136, 0.007153776008635759, 0.014220716431736946, 0.0001895401073852554, -0.06565044075250626, 0.009049955755472183, -0.08382903784513474, 0.007296241354197264, 0.04293588921427727, 0.0027412399649620056, -0.11083640903234482, 0.0061902510933578014, 0.00405609467998147, 0.00991897750645876, 0.06492405384778976, 0.020451869815587997, -0.006870575249195099, 0.043117813766002655, -0.10108280181884766, -0.009783695451915264, -0.02437637373805046, -0.0025983117520809174, 0.028215864673256874, -0.17674404382705688, 0.07557710260152817, 0.04065053537487984, 0.1171630397439003, -0.01256046537309885, 0.029156947508454323, 0.03631696105003357, -0.0002777407062239945, -0.05900471284985542, 0.04814589396119118, 0.015469980426132679, 0.010092902928590775, -0.021381188184022903, 0.027628816664218903, -0.09515608847141266], [0.036990270018577576, -0.004188126884400845, -0.01419074460864067, 0.03057706169784069, -0.023537196218967438, -0.03677370771765709, -0.05060645192861557, -0.03282530605792999, 0.10913173854351044, -0.012840844690799713, -0.03620808944106102, -0.005181156564503908, -0.01821039989590645, 0.025128202512860298, 0.048671793192625046, -0.015618753619492054, 0.04858110472559929, 0.04212598502635956, 0.012936178594827652, 0.006783357355743647, 0.0259881392121315, -0.01845669187605381, -0.0326986163854599, -0.0015490236692130566, 0.06796080619096756, 0.0066454061307013035, 0.03664439916610718, -0.07163535803556442, 0.06273780763149261, -0.001765783759765327, 0.016202853992581367, 0.01758493483066559, 0.06750312447547913, 0.12413229793310165, -0.05445566400885582, -0.029589729383587837, 0.02623578906059265, -0.01981770433485508, 0.011676632799208164, 0.00439025042578578, -0.0067361160181462765, 0.034619901329278946, -0.0003652835439424962, -0.04058215767145157, -0.0002681642072275281, -0.0052878172136843204, 0.02105393074452877, 0.0593562126159668], [0.045042261481285095, 0.01173537690192461, -0.03322644159197807, -0.019524551928043365, -0.008658667095005512, 0.04958931356668472, -0.010062350891530514, 0.05184478312730789, -0.022240227088332176, 0.02881833352148533, 0.030016575008630753, 0.010749533772468567, 0.021051758900284767, 0.010799860581755638, 0.005253878887742758, -0.009196789003908634, 0.03270599618554115, 0.0099989278241992, -0.023482464253902435, 0.009683835320174694, -0.044912129640579224, 0.0037406370975077152, 0.01642652601003647, -0.07709599286317825, -0.10255127400159836, 0.01897534728050232, -0.04973789304494858, 0.028014495968818665, 0.08216453343629837, 0.004754815716296434, -0.04434901475906372, -0.010459019802510738, 0.0060354177840054035, 0.001687705283984542, -0.030074341222643852, 0.034890495240688324, -0.005708260927349329, -0.035039614886045456, 0.012237872928380966, 0.0029743509367108345, -0.003921656869351864, -0.024009935557842255, -0.03937475010752678, 0.0014349691336974502, 0.004309611860662699, 0.06007831543684006, -0.00774937542155385, 0.019423775374889374], [0.01645052619278431, 0.01811293140053749, -0.02550359256565571, -0.06784231960773468, -0.025902830064296722, -0.032878369092941284, 0.002068815054371953, -0.0017467525321990252, -0.007480293978005648, -0.04436539486050606, -0.029258185997605324, 0.0015610966365784407, -0.009083565324544907, 0.06240417808294296, 0.015277564525604248, 0.013337016105651855, 0.023890912532806396, -0.031829871237277985, 0.019687624648213387, -0.031200595200061798, 0.051753729581832886, -0.013677145354449749, -0.008222243748605251, 0.002646290697157383, 0.003292565932497382, -0.03773362562060356, 0.013276757672429085, -0.037223778665065765, 0.002066412940621376, -0.026520460844039917, 0.08418294787406921, -0.016349872574210167, -0.0310746431350708, 0.07166676968336105, 0.03788990527391434, -0.0818290188908577, 0.014535900205373764, 0.005566529929637909, -0.05620322749018669, 0.01464441791176796, 0.006865768693387508, 0.0034642028622329235, -0.026443205773830414, 0.061693549156188965, -0.0022406664211302996, -0.0610719658434391, 0.05873585864901543, 0.035233885049819946], [0.028041204437613487, 0.0217514019459486, 0.0760003924369812, -0.006071427837014198, 0.008413906209170818, 0.008175220340490341, -0.01422572135925293, -0.04002770408987999, -0.02202436327934265, 0.023575564846396446, -0.008942932821810246, -0.018117446452379227, 0.05647922679781914, -0.1156122237443924, -0.06884204596281052, -0.0029649592470377684, -0.003108903532847762, 0.0736459344625473, 0.0320286825299263, 0.03445197269320488, -0.03873669356107712, -0.005704987328499556, -0.07667569816112518, -0.014891097322106361, 0.05126790329813957, -0.009640800766646862, -0.06467126309871674, 0.07493891566991806, -0.045288898050785065, 0.04909179359674454, -0.02326517179608345, 0.03844958543777466, 0.07537829875946045, -0.1645963340997696, -0.05178581178188324, -0.08581437170505524, 0.017877813428640366, 0.06633056700229645, 0.061282698065042496, 0.008360075764358044, 0.05674760416150093, -0.016076186671853065, -0.005457438062876463, -0.055748350918293, 0.007382806856185198, 0.03220456466078758, 0.0453312061727047, -0.08317527920007706], [-0.0024430041667073965, -0.03515343368053436, 0.044064030051231384, -0.017933128401637077, -0.02699572965502739, 0.037594933062791824, 0.006038091145455837, 0.06860709190368652, -0.08174602687358856, 0.036240167915821075, 0.013638131320476532, -0.027121111750602722, -0.003029399085789919, -0.14163121581077576, -0.0846104621887207, 0.0038073742762207985, -0.044354796409606934, 0.028095748275518417, -0.00945782195776701, 0.06468914449214935, -0.05454978719353676, 0.005009905900806189, -0.02860482782125473, -0.0038521226961165667, -0.046722251921892166, 0.00013923028018325567, -0.06814008951187134, 0.07820452004671097, -0.09615230560302734, 0.036950744688510895, 0.010990487411618233, 0.019579295068979263, 0.06202496215701103, -0.19593781232833862, 0.0003661233058664948, -0.03522435203194618, 0.037681952118873596, 0.07611354440450668, 0.03997485712170601, 0.03154704347252846, 0.03779735788702965, -0.024663662537932396, -0.013977942056953907, -0.021967073902487755, -0.007818839512765408, 0.05390984192490578, 0.027724215760827065, -0.0837797299027443], [0.00833546556532383, 0.03464898094534874, -0.11166498064994812, 0.012445410713553429, 0.0023006608244031668, -0.004648532252758741, -0.006515715271234512, 0.0068803224712610245, -0.0589047372341156, 0.039129678159952164, 0.03221942484378815, -0.03888121247291565, 0.13670165836811066, -0.05298968032002449, -0.06790581345558167, -0.0015439200215041637, 0.00949101522564888, 0.04347071051597595, -0.09169141948223114, 0.0419330932199955, 0.007983235642313957, 0.014767634682357311, -0.011027020402252674, 0.0015505605842918158, 0.011756549589335918, -0.024299124255776405, -0.018592923879623413, 0.06853864341974258, -0.041215695440769196, 0.03866272792220116, 0.007715406361967325, 0.015864122658967972, -0.02058171108365059, -0.14283032715320587, -0.00841587409377098, 0.008219455368816853, 0.04488704726099968, 0.05903131514787674, -0.01934679225087166, 0.024682575836777687, 0.0658748596906662, 0.001563851605169475, -0.01324043795466423, 0.010072868317365646, 0.012247880920767784, -0.06265562027692795, 0.011441247537732124, -0.03597727417945862], [7.247249410779732e-39, 2.6770265732614873e-40, -1.9745696660800997e-40, 1.4648677177020814e-19, 2.901738795000615e-40, 1.853525504731722e-40, -1.0431826287819668e-40, -1.0813820249194613e-41, 1.949402345660826e-40, -5.223760415310053e-41, 4.4297847054236117e-41, 2.4129939166134053e-40, 1.0407303564693984e-40, -1.9947203379970906e-40, 2.7810029193143887e-40, -3.2326554273509205e-40, -2.2761431085874436e-40, -3.7242309286360663e-41, 3.2298808563915574e-40, -1.6078635794808578e-36, 3.135405313926778e-41, -1.0837922582781e-40, -1.3204715689025616e-40, 3.599375235464725e-41, -1.2188494042697259e-40, -2.7699747004001524e-40, -1.848887206814807e-40, -1.0787756097758172e-40, -1.9148323125459328e-40, 6.738185704659813e-40, -1.8056711621750295e-40, -1.8729755274165505e-41, 7.923922426217543e-41, 8.479677397168766e-41, 7.283529028021102e-41, -2.8147041473814006e-40, -6.419348265071987e-41, -1.7830682179454702e-40, 1.6034497807883152e-40, -9.975843767528373e-42, 1.7394317837663954e-40, -2.7375766799049626e-41, 7.29208255384734e-39, -1.5275834819297696e-40, 3.437539275819852e-40, -1.4329397836492714e-40, -1.6118715845589073e-40, 1.246637152817287e-40], [-3.4166739416860555e-40, 1.2208112221197806e-41, -8.543996996681275e-40, -3.867023242150765e-41, 3.476159061496644e-40, -2.4052167101364025e-40, -6.068421090651123e-40, 2.8792479546482016e-41, -1.2418447120692961e-40, 3.2042511074790565e-40, -4.965393208353236e-39, 2.2975969880762566e-40, 3.1456347927163494e-41, -9.087420541146439e-42, -1.0905184909068591e-40, 2.2432826595990267e-40, 3.4130025397095245e-41, 9.799476342808451e-40, 3.1404499883983475e-41, -2.1670520231397566e-40, -1.1720740615305635e-40, 1.1858067864809467e-40, -4.44435820945259e-41, -3.647593915622142e-40, -1.2596412025662213e-40, -2.26050181512865e-39, 4.661777956746161e-25, -6.815495340936613e-41, -9.272251808590882e-41, -2.2965880531819427e-40, -6.509788067959511e-40, 2.253624242265744e-40, -4.401338346597818e-41, -2.6312601654166388e-40, -1.3611232373526246e-40, 6.001340933163894e-41, 7.755065961266403e-41, -2.8291515345485894e-40, -9.623417203750681e-41, 2.0283655141255295e-40, -6.99805650486885e-40, -2.630825762892698e-40, -1.6355535286059967e-40, 1.5284242610083645e-40, 2.669613704385209e-41, -3.569107188635309e-42, 8.56291452594966e-41, -3.4092890987790637e-40], [0.03582952171564102, 0.040475986897945404, -0.03647458553314209, -0.06288836896419525, -0.035938095301389694, 0.012928806245326996, -0.03201263025403023, -0.05317511782050133, 0.002738799899816513, 0.006831342354416847, 0.018534280359745026, -0.00863958615809679, -0.014132737182080746, 0.021491853520274162, 0.013926003128290176, -0.014773647300899029, 0.0022887568920850754, 0.017702635377645493, -0.035509005188941956, 0.05432683601975441, 0.07244914025068283, -0.02277754805982113, 0.003787260502576828, -0.0025819032453000546, -0.005387013778090477, -0.008358591236174107, 0.06564377248287201, -0.013763350434601307, 0.06335543096065521, 0.0703090950846672, -0.07469014078378677, -0.03575164079666138, 0.001658964203670621, 0.013701898977160454, -0.04149648919701576, 0.04892272129654884, -0.07037485390901566, 0.004273766186088324, -0.05141481012105942, -0.0012726598652079701, 0.03949326276779175, 0.06631429493427277, -0.12533387541770935, -0.01594935730099678, -0.020307594910264015, 0.027051031589508057, -0.009552095085382462, 0.08447744697332382], [-0.0063417693600058556, 0.007074141874909401, 0.06731594353914261, -0.0538291335105896, 0.014214608818292618, 0.041674382984638214, -0.0024181436747312546, 0.02998194471001625, -0.038163430988788605, 0.02370366081595421, 0.03435077518224716, -0.019264472648501396, 0.12665382027626038, -0.00011156377149745822, -0.04914127290248871, -0.016224917024374008, -0.003291230881586671, 0.03672119230031967, -0.03640122339129448, -0.005620083771646023, 0.08494362235069275, 0.02384355291724205, 0.04769048094749451, -0.015585830435156822, 0.012971257790923119, 0.001926527125760913, -0.04035210981965065, 0.05270029604434967, 0.002987298183143139, 0.0046393414959311485, 0.04676439240574837, 0.005735553801059723, -0.11483940482139587, -0.03583071753382683, -0.03678707405924797, 0.03411278873682022, -0.0012218611082062125, 0.02550811879336834, 0.023743966594338417, -0.07421377301216125, 0.011662845499813557, -0.022526999935507774, 0.01331812422722578, -0.0094087990000844, 0.0023884312249720097, -0.0015461730072274804, -0.003971933852881193, -0.02340170182287693], [0.025246700271964073, 0.022617721930146217, 0.0017251454992219806, 0.02099655009806156, -0.0027226628735661507, 0.017697134986519814, 0.017985958606004715, 0.039503853768110275, -0.019420498982071877, -0.015285917557775974, 0.01980694942176342, -0.0091329887509346, -0.009731230325996876, -0.0067239850759506226, 0.018427720293402672, 0.006804583128541708, -0.007363155484199524, -0.03373607620596886, 0.0637999176979065, -0.014322138391435146, -0.008488496765494347, 0.03244670853018761, 0.04034830257296562, -0.021002929657697678, -0.06694439053535461, -0.04803162440657616, -0.009357227012515068, -0.007869681343436241, 0.04435425251722336, -0.02101549319922924, 0.024106623604893684, 0.00040890794480219483, 0.08147076517343521, 0.00014435200137086213, 0.05277511477470398, -0.0536549873650074, 0.055903878062963486, 0.02079421654343605, -0.028743835166096687, 0.02442121133208275, -0.03527923300862312, -0.02306433953344822, -0.02864852361381054, 0.025839850306510925, -0.022364551201462746, -0.026450645178556442, 0.015467141754925251, -0.0001373986597172916], [-0.01193397119641304, 0.04667204990983009, 0.0034464665222913027, 0.04362978786230087, 0.014169500209391117, 0.015371961519122124, 0.009644352830946445, 0.0009192716097459197, 0.06099766865372658, -0.04208608344197273, -0.010094464756548405, 0.02093394845724106, -0.12138770520687103, 0.0064523653127253056, 0.09038925170898438, -0.0009141164482571185, 0.033405601978302, -0.09298514574766159, -0.009515289217233658, -0.04404914751648903, 0.01649642176926136, -0.015002591535449028, 0.08429194241762161, 0.03648236021399498, 0.036820363253355026, 0.03264598920941353, 0.05627528205513954, -0.06274491548538208, 0.012041614390909672, 0.0023021074011921883, -0.00915227085351944, 0.01070150826126337, -0.06911361217498779, 0.06752607971429825, 0.08243552595376968, 0.1297731101512909, 0.005210667848587036, -0.02074241451919079, -0.026583435013890266, 0.012623045593500137, -0.06092831492424011, 0.04102539271116257, -0.049944501370191574, 0.004474877845495939, 0.005713590420782566, -0.031924713402986526, -0.03750801458954811, -0.011958407238125801], [-0.007629948668181896, -0.032453812658786774, -0.03447389602661133, 0.033719468861818314, 0.0635044127702713, 0.02141040749847889, 0.0151725634932518, -0.034485820680856705, -0.03816373646259308, 0.043901775032281876, -0.017080938443541527, 0.02540997602045536, -0.046912096440792084, -0.04546203836798668, 0.018772445619106293, 0.019431933760643005, -0.04516470059752464, -0.026099547743797302, -0.033428095281124115, -0.010541620664298534, -0.02918190136551857, -0.04650786891579628, -0.01051898580044508, -0.023575574159622192, 0.024540485814213753, 0.0007374526467174292, -0.009084821678698063, 0.007929766550660133, 0.04547971487045288, 0.019383154809474945, 0.018534526228904724, 0.013736710883677006, -0.02962014265358448, -0.031633034348487854, 0.00964908953756094, -0.02795087732374668, -0.018536647781729698, 0.003115719184279442, -0.02822040766477585, 0.06605837494134903, 0.029551761224865913, 0.011507749557495117, 0.08264288306236267, -0.039734549820423126, 0.02044009417295456, 0.0374518521130085, -0.018036246299743652, 0.00846951361745596], [0.0042404597625136375, -0.03223676607012749, 0.0027665025554597378, 0.0021857814863324165, 0.0035030983854085207, -0.011712073348462582, 0.011506786569952965, -0.028416983783245087, 0.019271280616521835, 0.037583332508802414, 0.018804248422384262, 0.028109146282076836, -0.020640099421143532, -0.016405930742621422, -0.009236100129783154, 0.002552202669903636, 0.021272579208016396, 0.04148261621594429, -0.026911664754152298, 0.03378160670399666, 0.07122693210840225, -0.00296580558642745, -0.0232770424336195, 0.008755838498473167, 0.043165985494852066, 0.051249805837869644, 0.058450985699892044, -0.045366257429122925, 0.005704800132662058, 0.03530285879969597, 0.04905381426215172, 0.016705065965652466, 0.012061519548296928, 0.003095894819125533, -0.009344170801341534, -0.029147762805223465, 0.09960728138685226, 0.01580038107931614, -0.03316338732838631, -0.05483660846948624, -0.007118132431060076, 0.034523431211709976, 0.027179425582289696, 0.0651761069893837, 0.019877474755048752, -0.0197275560349226, 0.011452562175691128, -0.02481316588819027], [0.0192707646638155, -0.05611466243863106, 0.006803325843065977, 0.022612638771533966, -0.04727880656719208, -0.006862294860184193, -0.03541501238942146, -0.005755099467933178, -0.0688507929444313, -0.06672360002994537, -0.008945192210376263, 0.009775894694030285, -0.007908154278993607, 0.02226141281425953, 0.048625748604536057, -0.008461063727736473, -0.050476305186748505, -0.04430761933326721, 0.03794635832309723, -0.047446466982364655, 0.11012636870145798, -0.027889369055628777, 0.03059997782111168, 0.031206130981445312, 0.06536287069320679, -0.005421889014542103, 0.06994647532701492, 0.01935589499771595, 0.01132396049797535, 0.02116965502500534, -0.023293983191251755, -0.08355841785669327, 0.05176803842186928, -0.03483881428837776, -0.05602461099624634, 0.023693619295954704, 0.09114765375852585, -0.019567469134926796, -0.001613160246051848, 0.0686907097697258, -0.017954904586076736, -0.023032667115330696, 0.010561983101069927, -0.0027992052491754293, -0.006260704714804888, -0.0098110968247056, 0.045436978340148926, 0.030980434268712997], [0.05041913315653801, 0.03776054456830025, 0.04425404220819473, -0.014016946777701378, 0.012646808288991451, 0.0020076564978808165, -0.017783354967832565, -0.05801942199468613, -0.03432388976216316, 0.002418520860373974, 0.0019112294539809227, -0.014825736172497272, -0.01746416836977005, 0.0046092146076262, 0.022227497771382332, 0.006558417808264494, 0.029956456273794174, -0.022823838517069817, -0.011009368114173412, -0.012047342024743557, -0.05592729523777962, 0.020840059965848923, -0.030846083536744118, 0.014543384313583374, 0.04384053125977516, 0.013214122503995895, -0.023378076031804085, 0.018314680084586143, 0.07430735975503922, -0.01103696133941412, -0.009904150851070881, -0.0021217165049165487, 0.011274631135165691, -0.027476420626044273, 0.05561235174536705, 0.01199230458587408, -0.044631149619817734, 0.014775682240724564, 0.03611143305897713, 0.045949533581733704, 0.023525338619947433, 0.028926227241754532, 0.05711224302649498, 0.007685347925871611, 0.032920580357313156, 0.02626347541809082, -0.0008899103850126266, 0.00015048804925754666], [0.016484878957271576, -0.009625335223972797, -0.011958419345319271, -0.06638721376657486, -0.03415576368570328, 0.028678683564066887, -0.0018364820862188935, 0.014224658720195293, 0.08613770455121994, -0.010352618992328644, -0.0019348632777109742, 0.03327497839927673, -0.019420823082327843, 0.0893024429678917, -0.021505206823349, -0.007439922075718641, 0.05095307528972626, 0.0018457513069733977, -0.02338355779647827, 0.04442882537841797, -0.025063829496502876, 0.01674155332148075, -0.022653648629784584, 0.00448208162561059, -0.0004111351154278964, 0.0029840595088899136, -0.03662770241498947, -0.05297234281897545, -0.03415240719914436, -0.001295595895498991, 0.028352830559015274, 0.01119729969650507, 0.02505072019994259, -0.04520837590098381, -0.027959156781435013, -0.06576964259147644, 0.0027423605788499117, 0.07343306392431259, -0.025264566764235497, -0.004357130266726017, 0.012460798025131226, 0.023441588506102562, 0.01497192494571209, -0.01673126593232155, 0.05693454667925835, -0.04001498967409134, 0.07905396819114685, 0.014194952324032784], [0.024249371141195297, 0.08161881566047668, 0.005262135993689299, -0.029200619086623192, 0.026000354439020157, -0.014654381200671196, -0.017307426780462265, -0.03871278837323189, -0.052467115223407745, 0.06125018000602722, 0.013984816148877144, -0.00957297720015049, -0.033320751041173935, 0.014756941236555576, 0.00666863052174449, 0.005227817688137293, -0.06568295508623123, -0.05206090956926346, -0.02203083038330078, 0.03149538114666939, 0.04916028305888176, 0.007017065770924091, 0.0008939019171521068, -0.008652831427752972, -0.0013753402745351195, 0.0062419050373137, 0.015094069764018059, 0.04302786663174629, -0.05506350100040436, -0.03582347556948662, 0.022753890603780746, -0.05059291049838066, 0.0032846650574356318, -0.015052970498800278, -0.05149590224027634, -0.049754634499549866, -0.01476777158677578, 0.04903082177042961, 0.052837952971458435, -0.034263502806425095, 0.011869668029248714, 0.0021423641592264175, 0.015964176505804062, 0.015214988961815834, 0.01946137472987175, 0.03385721519589424, 0.0036892020143568516, -0.03465932607650757], [-0.015439768321812153, -0.0760108232498169, 0.006604811642318964, 0.025460055097937584, 0.05446486920118332, 0.04576578363776207, -0.01919076032936573, -0.032475546002388, -0.02460397407412529, 0.014691843651235104, 0.01551244780421257, 0.006689541041851044, 0.0452425554394722, -0.027747604995965958, -0.0553235299885273, 0.004690526053309441, -0.05650804191827774, -0.03528573364019394, -0.018527869135141373, 0.021216023713350296, 0.016189293935894966, 0.0611613430082798, 0.0106338607147336, 0.03409314155578613, 0.03139365836977959, -0.013833785429596901, -0.010138241574168205, 0.0085552167147398, -0.01197222713381052, -0.02819661982357502, -0.044250164180994034, -0.01891891099512577, 0.028082992881536484, -0.07325729727745056, -0.033026356250047684, 0.01443077065050602, 0.0693487599492073, 0.06620578467845917, 0.009479883126914501, 0.020695919170975685, -0.003943752497434616, -0.02039467729628086, -0.05539686605334282, 0.064971424639225, -0.0233332309871912, 0.05683409050107002, -0.003007517196238041, -0.04504808411002159], [0.031057193875312805, -0.044314805418252945, -0.005276122130453587, -0.013680676929652691, -0.016344333067536354, -0.014305724762380123, -0.02994597889482975, 0.00197318266145885, -0.043629080057144165, -0.0006150322151370347, 0.038735754787921906, -0.003396362531930208, 0.006163185928016901, -0.04723159223794937, -0.04729810729622841, -0.00517385546118021, -0.03921283036470413, -0.04725240543484688, -0.02155582420527935, -0.016735028475522995, -0.010330562479794025, -0.007218113634735346, 0.04423815384507179, 0.03773586452007294, 0.028743302449584007, 0.0020897311624139547, 0.04539959505200386, -0.03761407360434532, 0.021450607106089592, -0.025394877418875694, 0.0069723716005682945, -0.01258371863514185, 0.05203091353178024, -0.017600042745471, -0.029570387676358223, 0.0991116613149643, -0.03223167359828949, -0.003773659700527787, -0.06096974015235901, -0.021017931401729584, 0.013591594062745571, -0.0010442195925861597, -0.028800809755921364, 0.0334404855966568, -0.006034990772604942, 0.004290865268558264, 0.019690517336130142, 0.047395579516887665], [0.03764203190803528, 0.0002969987690448761, 0.015505289658904076, 0.03516450524330139, 0.03526091203093529, 0.022062106058001518, -0.03203391283750534, 0.09190299361944199, -0.043660279363393784, 0.04452778398990631, 0.018379194661974907, -0.018169837072491646, 0.04867371916770935, -0.013759607449173927, -0.04406341165304184, -0.01602974906563759, -0.040201153606176376, 0.002393652917817235, 0.007876994088292122, 0.013885109685361385, 0.034127216786146164, 0.049434348940849304, -0.012306810356676579, -0.020178375765681267, 0.05306293070316315, -0.0172159131616354, -0.04503646492958069, 0.020644908770918846, -0.03876585513353348, -0.03246786445379257, 0.04943600669503212, -0.061046991497278214, -0.05494450032711029, -0.047841835767030716, 0.021714873611927032, -0.013083322905004025, -0.024359596893191338, 0.006854475475847721, 0.042905036360025406, -0.02871871180832386, -0.028146371245384216, -0.0515628382563591, 0.05775807052850723, 0.04206696152687073, -0.00011639059812296182, 0.004832401406019926, -0.009741394780576229, 0.005826556123793125], [-0.07577983289957047, 0.034081149846315384, -0.06862430274486542, 0.019148429855704308, 0.0479167141020298, 0.022507455199956894, 0.01352003961801529, 0.056296560913324356, -0.036236513406038284, -0.020538242533802986, -0.09481623768806458, 0.0010876670712605119, 0.10340404510498047, 0.03951991721987724, -0.056643348187208176, 0.014563677832484245, 0.022378956899046898, -0.013416781090199947, -0.03357507288455963, -0.010662401095032692, 0.08709969371557236, 0.05434102937579155, 0.01408691331744194, -0.011006786487996578, -0.01579063944518566, 0.029374919831752777, -0.14247535169124603, -0.041327640414237976, 0.0502454973757267, -0.004050435032695532, -0.009019584394991398, 0.030152468010783195, -0.12430331110954285, 0.034259650856256485, -0.030928904190659523, 0.010911567136645317, 0.009850461967289448, 0.011153316125273705, -0.002449335064738989, -0.040404703468084335, 0.011522606015205383, -0.037250109016895294, -0.05436614155769348, 0.014740075916051865, 0.025780774652957916, 0.006104825064539909, 0.018063945695757866, -0.01624576561152935], [-0.04261348769068718, 0.03707972913980484, 0.019338959828019142, 0.03334081545472145, 0.00950926635414362, -0.03407135233283043, -0.006763427518308163, 0.05707406997680664, 0.0030215776059776545, 0.002483679447323084, 0.041209835559129715, 0.0035924578551203012, -0.052758343517780304, -0.042027588933706284, -0.0016956150066107512, -0.012140018865466118, 0.01116446778178215, -0.03373236581683159, 0.013724204152822495, -0.014104912057518959, 0.031977199018001556, -0.012868328019976616, -0.05202960595488548, -0.003390426281839609, 0.03203633800148964, -0.010799460113048553, -0.05645005404949188, 0.006482330150902271, 0.013187442906200886, -0.024175038561224937, -0.015624445863068104, -0.026844164356589317, 0.06922704726457596, -0.029932156205177307, -0.003155189100652933, -0.04043526202440262, -0.03717053309082985, 0.02377825602889061, 0.03564469516277313, 0.049647919833660126, 0.01241561770439148, 0.019581599161028862, 0.05131369084119797, -0.01877150684595108, 0.014552456326782703, 0.07027988135814667, 0.04348469153046608, -0.027306247502565384], [0.03530111908912659, 0.034922655671834946, -0.02451840043067932, 0.006207775790244341, 0.09531096369028091, 0.057409003376960754, -0.022710340097546577, -0.07083902508020401, 0.021388275548815727, 0.03195089101791382, 0.01916712522506714, -0.002705573569983244, 0.013411099091172218, -0.07160476595163345, 0.001847384963184595, -0.005803706124424934, -0.035824112594127655, 0.027806995436549187, -0.039521295577287674, 0.0064836833626031876, 0.05871585011482239, 0.023549964651465416, 0.04533334821462631, 0.04176529869437218, -0.03892010450363159, 0.03820813447237015, 0.032474271953105927, -0.03669783100485802, -0.015923822298645973, 0.02325654961168766, -0.04479490593075752, -0.003433608217164874, 0.0373661033809185, -0.08090591430664062, -0.01820269413292408, 0.0035984059795737267, -0.013458537869155407, -0.007719562388956547, 0.007069102488458157, -0.059177495539188385, 0.02753460593521595, 0.027442101389169693, 0.011669198051095009, 0.05322592705488205, -0.001677024643868208, 0.028344228863716125, -0.02361840195953846, 0.03060903027653694], [0.004441587254405022, -0.03772541135549545, 0.06318635493516922, 0.00984952226281166, 0.027766622602939606, -0.011666379868984222, -0.01903715915977955, -0.1014021635055542, -0.040831148624420166, -0.014324422925710678, 0.10788654536008835, -0.0266982764005661, -0.00564970588311553, -0.011587562970817089, -0.04504892975091934, -0.003765589091926813, -0.08507072180509567, -0.05237627401947975, -0.003114876337349415, -0.03266318142414093, -0.06720689684152603, 0.0031342143192887306, -0.0014110369374975562, 0.008110731840133667, -0.0003681842645164579, 0.013412662781774998, 0.07387252151966095, 0.06380616873502731, -0.04404183849692345, -0.0615529865026474, 0.03021853044629097, -0.026034681126475334, 0.04769745469093323, -0.0625961497426033, -0.04295778647065163, 0.01987236738204956, -0.01409478485584259, 0.07319596409797668, 0.06129632517695427, -0.030796116217970848, 0.043107014149427414, 0.038655515760183334, 0.057349275797605515, 0.01450349297374487, -0.06778782606124878, 0.01947834901511669, 0.03021506778895855, -0.04221533238887787], [-0.03265310451388359, -0.09122651815414429, 0.06258571147918701, -0.030574997887015343, -0.02314091846346855, -0.022910697385668755, 0.008041566237807274, 0.04911702871322632, 0.03765292465686798, 0.025136614218354225, -0.0644301325082779, 0.00932537205517292, -0.05468399077653885, 0.02664199098944664, 0.05769655108451843, 0.0009037021663971245, 0.04659109190106392, -0.021585848182439804, -0.0010878005996346474, 0.018171781674027443, 0.008963692933321, -0.05464000254869461, -0.013873735442757607, -0.05115702375769615, 0.03926295042037964, -0.011205357499420643, -0.09662643820047379, 0.0072881318628787994, 0.014601991511881351, -0.019226964563131332, -0.012311299331486225, -0.009762956760823727, 0.03681836277246475, 0.0036091122310608625, -0.006933453027158976, 0.010720105841755867, -0.03854817524552345, -0.042389992624521255, 0.022459296509623528, 0.037948183715343475, -0.013057541102170944, 0.004416437353938818, -0.05752355605363846, -0.0009288742439821362, 0.0052526723593473434, 0.025844015181064606, -0.0011437711073085666, -0.05009617283940315], [-1.460979765920411e-40, -1.894863809429304e-40, 1.038109928341111e-40, 3.5087112248229095e-41, -2.9388732043052226e-40, -1.3685641321981893e-40, -1.4941905395249092e-40, 5.104509915996011e-41, 1.8715742289522257e-40, -3.537549947218714e-40, -6.97174011970883e-41, 1.215476478866096e-39, 9.144032999105161e-41, 3.1280344840044297e-40, -4.246634996136358e-41, 1.3644723406823609e-40, -3.062944170336542e-40, 1.1519374025982159e-40, -3.8712271375437396e-41, 1.923604440932606e-40, 2.4322617704978715e-40, -1.6638737705700013e-40, 2.0411173301508853e-40, 2.9366031007930164e-40, -4.128225275900911e-41, 2.366176534920313e-40, 1.520885275270297e-40, 2.33540402064374e-41, 1.4866235278175552e-40, 4.949147955256319e-40, 7.596298845258401e-40, 3.1847029939017253e-40, -7.88650775722007e-41, 1.6114932339735396e-43, -2.2776004589903414e-40, 1.0525152765543701e-40, -9.739024327057479e-43, -7.942139306253766e-41, 1.9441895153735377e-40, -2.2771100045278277e-41, 1.5900253415000834e-40, -1.7562473653382932e-41, -3.3069662849140656e-40, -2.9905250657002354e-40, 1.6187099210648124e-40, -2.1149797722054464e-41, 2.9787961975538366e-40, -2.1028865664583232e-40], [0.00892390962690115, -0.021262183785438538, 0.010408925823867321, 0.028315292671322823, 0.0342785120010376, -0.036317598074674606, -0.003605195786803961, -0.04848823696374893, -0.028865035623311996, -0.005088394973427057, -0.009436903521418571, 0.006966313812881708, -0.0235997773706913, 0.05194523185491562, -0.05871384218335152, -0.00963479932397604, -0.016799015924334526, 0.0029480191878974438, 0.010939281433820724, 0.0392264798283577, 0.04774093255400658, -0.024338485673069954, 0.024990592151880264, 0.0010371159296482801, 0.0208315197378397, 0.003813621122390032, -0.05651460215449333, 0.03168383985757828, -0.04989168792963028, 0.01171267032623291, 0.03637462854385376, -0.02900482341647148, -0.024253414943814278, 0.060259897261857986, -0.006761085242033005, 0.0018294808687642217, -0.04371797665953636, 0.0001393929123878479, 0.012593181803822517, 0.024914827197790146, -0.0580565482378006, 0.013071172870695591, 0.025073690339922905, -0.00011068486492149532, 0.014581579715013504, -0.011968491598963737, -0.010166572406888008, 0.04390402510762215], [-0.0339716337621212, 0.10506348311901093, -0.014919270761311054, -0.023874567821621895, -0.023649301379919052, -0.007790558505803347, -0.03248174116015434, 0.030277177691459656, -0.021842291578650475, -0.042139481753110886, -0.01545989140868187, -0.01484657358378172, 0.057134959846735, -0.012694014236330986, -0.08139744400978088, -0.017989449203014374, -0.004679173696786165, 0.018793003633618355, -0.004293376114219427, -0.029783183708786964, 0.07334934920072556, 0.01819915696978569, -0.032627906650304794, 0.03305008262395859, 0.002116080140694976, -0.0005111262435093522, -0.07865448296070099, -0.08396708965301514, 0.04735955223441124, 0.0020513010676950216, 0.01572643406689167, -0.02292240969836712, -0.07628095149993896, -0.04629514366388321, 0.041817013174295425, 0.0022153006866574287, 0.011951057240366936, 0.06182144582271576, -0.004085020162165165, 0.03253258764743805, 0.04488289728760719, 0.024048157036304474, -0.024947211146354675, 0.0033869759645313025, 0.010268324986100197, -0.0541737861931324, 0.03896365687251091, 0.005955038126558065], [0.08801006525754929, -0.03783285990357399, 0.08784263581037521, 0.002577910665422678, 0.0534190870821476, -0.021672595292329788, -0.008365295827388763, -0.0872943177819252, 0.029610581696033478, 0.04767357558012009, -0.01833660900592804, 0.022684698924422264, 0.0156821608543396, 0.003479518461972475, 0.00786290131509304, -0.0037330712657421827, -0.009541181847453117, -0.0016352359671145678, 0.025393366813659668, -0.0026361229829490185, -0.03250062093138695, 0.03859024494886398, -0.06612072139978409, -0.04771221801638603, -0.008665209636092186, 0.04271183907985687, -0.06270787119865417, -0.04705003276467323, 0.030353154987096786, 0.022062640637159348, 0.037724681198596954, -0.01097274199128151, 0.03426665440201759, -0.026631271466612816, 0.028546499088406563, 0.017757948487997055, -0.0027051654178649187, -0.010679328814148903, 0.012373572215437889, -0.04565165936946869, -0.006306617520749569, 0.011554964818060398, 0.05218696594238281, 0.043891504406929016, -0.028325460851192474, 0.0017732871929183602, -0.08058473467826843, 0.006256007123738527], [-0.04193473234772682, 0.02586335875093937, -0.004131685011088848, 0.09081418812274933, 0.05132902413606644, -0.07731974124908447, 0.017908021807670593, 0.0014908139128237963, 0.06058448553085327, 0.02628510072827339, -0.04687286913394928, -0.01866006664931774, 0.001447523944079876, 0.04383653402328491, -0.007897909730672836, 0.0020063521806150675, 0.049309488385915756, 0.036929983645677567, -0.021410517394542694, 0.037201009690761566, -0.05223289504647255, -0.013054672628641129, -0.07188265770673752, -0.039489056915044785, -0.026045851409435272, 0.0002920037950389087, 0.033375099301338196, -0.010666686110198498, 0.009580502286553383, 0.035111118108034134, 0.04120025038719177, 0.0018812158377841115, -0.0019473910797387362, 0.031804390251636505, 0.049472272396087646, -0.043100278824567795, -0.023016078397631645, 0.02332131750881672, 0.008700015023350716, -0.010798611678183079, 0.055191509425640106, 0.034523267298936844, -0.03291810676455498, -0.008786816149950027, 0.005311828106641769, -0.0020592163782566786, -0.008518711663782597, 0.016501586884260178], [-0.01922496221959591, -0.02194683998823166, -0.007524247281253338, 0.006200053729116917, 0.034376125782728195, -0.013174711726605892, -0.009847421199083328, 0.031071089208126068, -0.05448795482516289, 0.04519611969590187, 0.000934869865886867, -0.008739959448575974, -0.039770133793354034, 0.12650534510612488, 0.01783309318125248, -0.0006929924129508436, -0.03815101832151413, -0.0442182682454586, -0.04546219855546951, -0.05210158973932266, -0.005456217564642429, -0.06875411421060562, 0.04594925791025162, 0.02726990357041359, -0.000607431516982615, 0.06884989887475967, 0.034951016306877136, 0.0010943475645035505, -0.025463156402111053, 0.027413491159677505, -0.05499781668186188, -0.011984669603407383, -0.007948415353894234, 0.07471855729818344, -0.012352917343378067, 0.06347940117120743, -0.0009272685274481773, -0.04375871270895004, -0.010858302935957909, 0.06288619339466095, -0.05374253913760185, -0.013801999390125275, -0.056748684495687485, -0.03778216615319252, 0.01100471243262291, 0.041146520525217056, -0.01420361828058958, 0.008446289226412773], [0.06772480905056, -0.0015567995142191648, 0.05295354500412941, -0.061383992433547974, -0.07126497477293015, 0.05595270171761513, -0.017059845849871635, -0.24937783181667328, -0.06556393951177597, -0.021680060774087906, -0.053000275045633316, -0.00044968671863898635, 0.056457869708538055, 0.021770333871245384, -0.06441660970449448, 0.013688221573829651, -0.0008456542855128646, -0.004517694003880024, -0.006896347273141146, 0.0202463511377573, 0.07694432139396667, 0.11529190093278885, 0.01513915229588747, -0.03833471238613129, -0.011266232468187809, -0.014934946782886982, -0.03466802462935448, -0.003972889855504036, -0.007245451211929321, -0.058367010205984116, -0.033127643167972565, -0.026172881945967674, 0.18833933770656586, 0.014610287733376026, -0.06326841562986374, 0.018452836200594902, -0.09855315834283829, 0.0019768860656768084, -0.08220700919628143, 0.041593123227357864, 0.0054126400500535965, -0.014158020727336407, 0.011377090588212013, -0.04059465229511261, -0.023366723209619522, -0.007368732243776321, -0.08316904306411743, 0.014218122698366642], [0.04431579262018204, 0.016844728961586952, 0.05228090286254883, 0.007664322853088379, -0.007656709756702185, 0.039468638598918915, -0.03629620745778084, 0.046040330082178116, 0.01422205287963152, -0.0002673526469152421, 0.060856349766254425, 0.01679879054427147, -0.008916744031012058, -0.04556901380419731, -0.057867906987667084, -0.005821787286549807, -0.012154585681855679, -0.021793365478515625, 0.010018710978329182, -0.01095654722303152, -0.06210504099726677, 0.023288002237677574, -0.021002523601055145, -0.015204192139208317, 0.0020500586833804846, 0.03879258409142494, 0.06796695291996002, 0.024669962003827095, 0.058432046324014664, -0.0023649123031646013, 0.008831056766211987, -0.06065968796610832, -0.01157570630311966, 0.09527696669101715, 0.017763271927833557, -0.06428704410791397, -0.03794233500957489, -0.07501500099897385, 0.009522102773189545, -0.06254774332046509, 0.03949125111103058, -0.03825804963707924, -0.043055105954408646, 0.005905573256313801, -0.04668160527944565, -0.0219724178314209, -0.08906993269920349, 0.011566965840756893], [-0.01538929995149374, -0.03280295804142952, 0.011603654362261295, -0.03923458606004715, -0.01700969785451889, -0.005707040894776583, 0.006685102358460426, -0.03707261383533478, -0.009592638351023197, -0.006930343806743622, 0.06941846013069153, 0.012180197983980179, -0.008378753438591957, 0.04842831939458847, -0.03201108053326607, -0.0064924247562885284, -0.07295604795217514, 0.03751790151000023, -0.016083545982837677, -0.0363006666302681, 0.016085103154182434, -0.02369474060833454, 0.08582590520381927, 0.019947173073887825, -0.006559199187904596, -0.013307861983776093, 0.12874072790145874, 0.010925748385488987, -0.003835052251815796, 0.050324711948633194, 0.03305571898818016, -0.008248580619692802, -0.023177308961749077, 0.002298768376931548, 0.07161535322666168, 0.07856567949056625, -0.01867069862782955, -0.047336991876363754, 0.00335974944755435, 0.014832114800810814, 0.011605619452893734, -0.04120933264493942, -0.014133704826235771, 0.02821858786046505, -0.021841906011104584, 0.04426639899611473, 0.07557860761880875, 0.02527381107211113], [0.0052330936305224895, -0.09234180301427841, -0.011778457090258598, -0.048636097460985184, 0.05024335905909538, 0.042045220732688904, -0.004130664747208357, 0.07306240499019623, 0.009381430223584175, -0.05871133506298065, -0.08913496136665344, 0.05423087254166603, 0.036640264093875885, 0.006705163512378931, 0.08025126904249191, -0.011138937436044216, 0.01708952523767948, -0.0012605816591531038, 0.008099008351564407, -0.03144649416208267, 0.04550771787762642, 0.006342363078147173, 0.011519866064190865, 0.016949979588389397, 0.007827688939869404, -0.03771911561489105, -0.02139308862388134, 0.0038474267348647118, 0.011653575114905834, 0.008715148083865643, -0.028571385890245438, 0.009134366177022457, -0.10775429010391235, 0.022354179993271828, -0.016755251213908195, -0.005384332034736872, -0.007186797447502613, -0.06878906488418579, -0.017565425485372543, -0.004486192017793655, -0.009712405502796173, 0.02453533746302128, -0.028731759637594223, -0.014691769145429134, -0.005936915520578623, 0.03840244188904762, 0.05785234272480011, 0.030402278527617455], [0.0797339379787445, -0.001960898283869028, 0.027203813195228577, -0.05553221330046654, -0.014198090881109238, -0.04561426490545273, -0.00497535802423954, -0.08310914784669876, -0.06984889507293701, 0.02334689535200596, -0.05813021957874298, -0.00787572655826807, -0.04291525483131409, 0.0319102481007576, 0.02669265680015087, 0.012498152442276478, -0.04236431047320366, -0.04921170696616173, 0.009711611084640026, -0.008332033641636372, 0.12676946818828583, 0.005234718322753906, -0.006380083505064249, 0.029203670099377632, 0.031918954104185104, 0.0013971910811960697, -0.051323261111974716, -0.0247198436409235, 0.011210729368031025, 0.04629579186439514, 0.0631294697523117, -0.04947070777416229, 0.08062981069087982, 0.038264200091362, -0.010464866645634174, -0.012508600018918514, -0.04773673415184021, 0.028663091361522675, 0.0188191756606102, -0.056305788457393646, -0.008250485174357891, -0.02790329046547413, 0.032882995903491974, 0.06332051008939743, -0.004553877282887697, 0.018085014075040817, 0.08737370371818542, -0.011692733503878117], [0.021661315113306046, -0.004616216756403446, 0.011944586411118507, -0.026382599025964737, -0.027265796437859535, 0.058463066816329956, -0.023465126752853394, -0.030885742977261543, -0.013108454644680023, -0.028537269681692123, -0.004197249189019203, 0.0076446086168289185, -0.012787281535565853, 0.059710875153541565, 0.06392255425453186, -0.010069124400615692, 0.07557785511016846, 0.01075650379061699, 0.0024023777805268764, 0.024187061935663223, -0.03070972114801407, 0.03752366825938225, -0.017746955156326294, 0.0329558327794075, 0.047005388885736465, -0.02374875172972679, -0.04650445282459259, 0.026356520131230354, 0.04131510481238365, -0.0067855739034712315, 0.023371392861008644, 0.022854680195450783, 0.012273833155632019, 0.09218517690896988, 0.021999742835760117, 0.054719820618629456, -0.023694206029176712, -0.04620352387428284, 0.03508098050951958, -0.011177243664860725, 0.01978449337184429, 0.029876692220568657, -0.00791215430945158, -0.0004186553123872727, 0.0006006556795910001, 0.02354547753930092, 0.07926438748836517, 0.06049000099301338], [0.022776102647185326, 0.06547608226537704, -0.0487842783331871, -0.02745526097714901, 0.05390773341059685, 0.0653364509344101, -0.03251690790057182, 0.03797090798616409, -0.0021784536074846983, 0.0037227445282042027, 0.021396789699792862, 0.0002695502189453691, 0.004586741793900728, -0.0006925322813913226, -0.015010316856205463, -0.01715840771794319, 0.022317958995699883, -0.008974147960543633, 0.01683216728270054, -0.01985596865415573, -0.002027991460636258, 0.01703079603612423, -0.018217703327536583, -0.010516097769141197, 0.03878379985690117, 0.030396750196814537, 0.01402753870934248, -0.03188508003950119, -0.01698397658765316, -0.018921522423624992, 0.06448553502559662, -0.04723655432462692, -0.05846291407942772, -0.022030681371688843, -0.0451672337949276, 0.015536000020802021, 0.009457911364734173, 0.0036590315867215395, 0.03479348123073578, -0.06506375223398209, 0.0329081155359745, 0.004412797279655933, 0.01878419518470764, -0.02457028068602085, 0.01521368883550167, -0.041952621191740036, -0.05680301785469055, -0.0034910428803414106], [0.04302658513188362, 0.06872215867042542, 0.05994049832224846, 0.06587604433298111, 0.007228888105601072, -0.030065085738897324, -0.025366296991705894, 0.09886526316404343, -0.012276072055101395, -0.02917570248246193, 0.0022970072459429502, 0.039052803069353104, 0.0025044744834303856, -0.06586125493049622, -0.022677209228277206, -0.015709251165390015, -0.02316930703818798, -0.048661090433597565, 0.021657584235072136, -0.020152689889073372, 0.0065416330471634865, 0.010405144654214382, 0.01716865412890911, 0.023390715941786766, 0.0849662497639656, -0.0266248919069767, -0.07010090351104736, -0.01143741700798273, -0.0002394761540926993, 0.05010175332427025, -0.024806641042232513, -0.027194757014513016, -0.0636947900056839, -0.057772036641836166, 0.017125219106674194, -0.030675092712044716, -0.021245254203677177, 0.04855216667056084, 0.06835378706455231, -0.051659367978572845, 0.017184091731905937, 0.016099948436021805, -0.015034356154501438, -0.025532949715852737, 0.009207445196807384, 0.014294984750449657, 0.005576051771640778, -0.06456541270017624], [0.053315144032239914, -0.08019108325242996, 0.0736592561006546, -0.03375186026096344, 0.02298511378467083, -0.039470117539167404, 0.013232368044555187, 0.02067088894546032, 0.029347283765673637, 0.008755478076636791, 0.0158636886626482, 0.014117260463535786, 0.023554615676403046, -0.04870447516441345, -0.07308218628168106, 0.008259122259914875, 0.0001565370475873351, 0.025592558085918427, 0.005318583454936743, -0.002119319047778845, -0.05898042768239975, 0.005633074790239334, -0.0665755346417427, -0.07179972529411316, -0.0471075214445591, -0.0017431739252060652, -0.06818390637636185, 0.0236120093613863, 0.009584467858076096, 0.039160504937171936, 0.008565172553062439, 0.027681145817041397, 0.007444475311785936, 0.0015025690663605928, 0.006177525036036968, -0.08053234219551086, 0.03106037899851799, -0.00910654105246067, 0.045959360897541046, -0.018243426457047462, -0.004038530867546797, -0.04181000217795372, 0.013614239171147346, 0.05283990874886513, -0.024417102336883545, 0.018328199163079262, -0.010657006874680519, -0.06886105984449387], [0.037279874086380005, 0.01479850523173809, -0.00035637483233585954, 0.02315503917634487, 0.01709436997771263, -0.05478968471288681, 0.008427951484918594, 0.013363604433834553, -0.0059293960221111774, 0.023559076711535454, -0.03734760731458664, 0.01707504875957966, -0.027623530477285385, -0.06918361783027649, -0.016159862279891968, 0.004162564408034086, -0.005623128265142441, 0.006202021613717079, 0.07572401314973831, 0.017672350630164146, 0.0009328636224381626, -0.029212074354290962, -0.0787225291132927, -0.024681854993104935, 0.010422199964523315, 0.029540687799453735, -0.0411304272711277, 0.037198975682258606, -0.044190555810928345, 0.013388502411544323, 0.0015452501829713583, 0.0077171423472464085, -0.017076125368475914, 0.0091023538261652, -0.025552010163664818, 0.0062578399665653706, 0.037464626133441925, -0.041752733290195465, 0.03139082342386246, 0.007103696931153536, -0.024556446820497513, -0.031317759305238724, 0.06121436879038811, 0.050021227449178696, -0.011941776610910892, 0.03018633835017681, 0.022893095389008522, -0.003465380286797881], [-0.03536130487918854, 0.022256378084421158, 0.045357976108789444, 0.03324948251247406, -0.015779677778482437, 1.0414820280857384e-05, 0.012793691828846931, -0.034545041620731354, -0.033660151064395905, -0.021221065893769264, -0.020490705966949463, 0.00691382447257638, 0.02743811532855034, -0.027341296896338463, 0.014171155169606209, 0.007838028483092785, -0.04731697961688042, -0.03736744076013565, -0.06722263991832733, -0.01212682481855154, 0.03150565177202225, 0.006425532046705484, 0.027401546016335487, 0.017405090853571892, 0.008672966621816158, -0.022597219794988632, 0.012580045498907566, -0.00306803360581398, 0.0003972817794419825, -0.02276945672929287, 0.024250498041510582, -0.013357950374484062, 0.004988471977412701, 0.0031408786308020353, -0.003026342485100031, 0.04856814444065094, -0.0015002103755250573, -0.08741822838783264, -0.010176059789955616, 0.006950422655791044, -0.004791352432221174, 0.0483727790415287, -0.03030952624976635, 0.007144950795918703, 0.010688102804124355, 0.043822791427373886, 0.010529871098697186, -0.010365888476371765], [0.02643754705786705, -0.06014484539628029, -0.005221792962402105, -0.012860679998993874, -0.009826730005443096, 0.023314500227570534, 0.02010892890393734, 0.04244789853692055, -0.007237145211547613, 0.05495855584740639, -0.03557729348540306, 0.0047680288553237915, 0.02010076865553856, -0.07330401986837387, -0.03241574391722679, 0.024182945489883423, -0.06709566712379456, 0.027917833998799324, 0.048596981912851334, -0.03054676577448845, -0.02301235869526863, 0.0248084906488657, -0.024475572630763054, -0.028031541034579277, 0.03353790566325188, 0.019710542634129524, -0.04123523458838463, 0.03021932952105999, 0.0020993556827306747, 0.010284395888447762, 0.022517129778862, -0.0004107938439119607, 0.03649909794330597, -0.004954594653099775, -0.00641753850504756, -0.030181745067238808, -0.05191085487604141, -0.029652707278728485, 0.006517634727060795, 0.009842099621891975, -0.04573526605963707, -0.021528838202357292, -0.007353450637310743, 0.0264239851385355, 0.010246030054986477, -0.01650567352771759, 0.06837176531553268, -0.0483287088572979], [0.02371322177350521, -0.019244669005274773, 0.008110257796943188, 0.06929107010364532, 0.002993292175233364, 0.009675199165940285, 0.012442350387573242, 0.009716047905385494, -0.029191290959715843, 0.03845970332622528, -0.04124440997838974, 0.0002263629576191306, 0.028775770217180252, 0.022702127695083618, -0.05381887033581734, 0.014240593649446964, -0.03240077942609787, -0.01084935199469328, 0.016611026600003242, -0.019140904769301414, -0.025945594534277916, -0.008177131414413452, -0.05078604817390442, -0.03239266946911812, 0.03531602770090103, 0.015495901927351952, 0.005667678080499172, 0.018455155193805695, 0.041327379643917084, 0.0036847295705229044, 0.017125677317380905, -0.002534096362069249, 0.02125885896384716, 0.020279739052057266, 0.0018612536368891597, -0.056363869458436966, 0.012026019394397736, 0.025209324434399605, -0.03586293384432793, 0.02979600615799427, -0.0061439950950443745, -0.005190233699977398, -0.008963469415903091, -0.027650320902466774, 0.0155309634283185, 0.01644761487841606, 0.015275690704584122, -0.010513793677091599], [0.0008562980219721794, -0.004038649145513773, 0.034875866025686264, -0.014534919522702694, -0.023307031020522118, 0.01329183578491211, -0.004416811745613813, -0.044314540922641754, 0.005315963178873062, 0.01821495220065117, 0.01951548643410206, 0.01101621612906456, -0.010513604618608952, -0.007733786944299936, 0.005456491839140654, -0.0010239524999633431, -0.026046080514788628, -0.007295629009604454, -0.06584028899669647, -0.029165152460336685, -0.0009602703503333032, 0.0016643116250634193, 0.030743930488824844, -0.0323655866086483, -0.015004524029791355, -0.006789269391447306, 0.027658611536026, -0.040245119482278824, 0.02992241457104683, 0.022827304899692535, 0.002717718482017517, -0.01659459061920643, -0.018780171871185303, -0.03929593786597252, 0.018162449821829796, -0.022128533571958542, 0.024669062346220016, -0.014607454650104046, 0.00418205838650465, 0.027954934164881706, 0.011997866444289684, -0.0003927509824279696, 0.015164082869887352, -0.015353880822658539, -0.00783911906182766, -0.001982268877327442, 0.0014772723661735654, 0.02129550464451313], [0.0022025115322321653, -0.030002102255821228, -0.009873069822788239, 0.006375730037689209, 0.02240254543721676, -0.025323227047920227, 0.00469445763155818, 0.04825414717197418, -0.0047221495769917965, 0.0344502255320549, 0.03667715936899185, -0.004337583668529987, -0.023180384188890457, 0.0019382273312658072, -0.00157565635163337, 0.009984367527067661, 0.024213680997490883, 0.05027111619710922, 0.011190865188837051, 0.011080036871135235, -0.029115930199623108, -0.040769312530756, -0.017109675332903862, 0.0054708910174667835, 0.013734799809753895, 0.007952137850224972, -0.018251465633511543, 0.025687919929623604, -0.022632313892245293, 0.013273283839225769, 0.04182261973619461, 0.014546333812177181, 0.007207581307739019, -0.07735099643468857, 0.0001396468869643286, 0.013470548205077648, -6.94301852490753e-05, -0.017207708209753036, -0.02200797200202942, -0.013656974770128727, -0.00867228303104639, 0.00395934609696269, -0.045786820352077484, -0.0001931557635543868, 0.02603941410779953, 0.06715703755617142, 0.0004753554239869118, -0.019217463210225105], [0.036612775176763535, -0.00865943729877472, 0.03232976049184799, 0.01600479707121849, -0.03489575535058975, -0.013018764555454254, -0.01665758155286312, -0.00827831868082285, 0.016756538301706314, 0.02110898308455944, 0.015489352867007256, -0.008735617622733116, -0.0038634745869785547, -0.05151694267988205, -0.018038267269730568, 0.003070549573749304, -0.004655939526855946, 0.036802567541599274, -0.006671930197626352, -0.004365965723991394, 0.0018644147785380483, 0.007556081749498844, -0.020741034299135208, -0.004397792275995016, -0.009213525801897049, 0.006070929113775492, -0.018794303759932518, 0.0354449525475502, -0.029682138934731483, 0.008745979517698288, 0.017782388255000114, 0.008398310281336308, 0.019047550857067108, -0.039616260677576065, 0.03344834968447685, -0.014100387692451477, 0.03897954151034355, 0.008233169093728065, -0.0022472841665148735, 0.009548849426209927, 0.014939039945602417, 0.0037890737876296043, -0.03573395311832428, -0.0017425230471417308, 0.03921763226389885, -0.0031953512225300074, 0.007684917189180851, -0.008973808027803898], [-0.022728681564331055, -0.027521906420588493, -0.009068116545677185, 0.03246435150504112, -0.008045435883104801, 0.04868021607398987, -0.002017263090237975, 0.025381242856383324, 0.013247549533843994, 0.008790249936282635, -0.006098990794271231, -0.002071008551865816, 0.008024082519114017, 0.00973021425306797, 0.0028296939563006163, 0.004679347854107618, -0.012011080980300903, -0.0286099873483181, 0.00843268632888794, -0.04038058966398239, -0.02584913745522499, -0.018753524869680405, 0.022563904523849487, 0.014591336250305176, 0.033088840544223785, -0.006720882374793291, 0.006280388217419386, -0.01955101266503334, 0.00020343507640063763, -0.01129081193357706, 0.02350347861647606, -0.00937129370868206, -0.005848688539117575, 0.00511189317330718, -0.009034816175699234, 0.03322572633624077, 0.054229751229286194, 0.008140788413584232, -0.010194272734224796, -0.01494436152279377, -0.00012564510689117014, -0.014840840362012386, 0.028861146420240402, 0.008602140471339226, 0.014768264256417751, -0.037469275295734406, 0.023566579446196556, -0.032287344336509705], [0.006021374836564064, -0.02380760945379734, 0.008426369167864323, -0.03297175094485283, -0.0018740823725238442, -0.003766430774703622, 0.0017216290580108762, -0.019917313009500504, 0.006482007913291454, -0.015585931949317455, -0.006406944245100021, -0.011361269280314445, 0.0006976273725740612, 0.015035159885883331, 0.015013083815574646, -0.00012637261534109712, 0.006428357679396868, 0.0020180693827569485, -0.03051006980240345, 0.005710947327315807, -0.009083994664251804, -0.01306133158504963, -0.0053406693041324615, -0.002898377599194646, 0.008330956101417542, -0.037533052265644073, 0.005638827569782734, -0.006377192214131355, -0.029554355889558792, 0.02699364349246025, 0.029830558225512505, -0.02093520015478134, -0.012379742227494717, -0.0164631400257349, -0.0061532240360975266, -0.006890406366437674, -0.025014687329530716, 0.0001819032186176628, -0.0033849524334073067, -0.019656680524349213, -0.007827798835933208, 0.009460531175136566, -0.03574948385357857, 0.05688052251935005, -0.004402783699333668, 0.029805127531290054, 0.014222892932593822, 0.025138141587376595], [0.04845414310693741, -0.03288241848349571, -0.026308763772249222, -0.008648950606584549, 0.01606452837586403, 0.006312534678727388, -0.0009153296705335379, 0.023636478930711746, 0.025912903249263763, -0.024152042344212532, 0.02601715736091137, -0.008753527887165546, 0.0346219576895237, 0.0030326275154948235, -0.014146893285214901, -0.00445023737847805, -0.020453212782740593, 0.03189348056912422, -0.03574942797422409, -0.0023483000695705414, -0.01634780690073967, 0.005562320817261934, 0.0058595906011760235, -0.011905926279723644, 0.02515680342912674, 0.010612810961902142, 0.002363428007811308, 0.020877160131931305, -0.03327477350831032, 0.018286537379026413, 0.02241903357207775, 0.031484175473451614, 0.007718073204159737, -0.012345478869974613, 0.04319106414914131, 0.0007060784264467657, -0.04294540733098984, -0.007966825738549232, -0.012371271848678589, 0.010629475116729736, 0.003405714873224497, 0.0029084081761538982, -0.05908942595124245, -0.004101257771253586, 0.009074345231056213, 0.020959453657269478, -0.0010657317470759153, 0.0011308094253763556], [-0.0064115216955542564, -0.0050530824810266495, 0.01912626065313816, -0.0039513129740953445, -0.02225467376410961, -0.004304111003875732, 0.016614940017461777, -0.02604934386909008, 0.01253519207239151, 0.020311718806624413, 0.02049768902361393, -0.011941088363528252, -0.031834568828344345, -0.026299532502889633, -0.008062704466283321, 0.0039318278431892395, -0.017356446012854576, 0.009870626963675022, -0.030450083315372467, -0.00860891118645668, -0.01527158822864294, 0.0073256161995232105, 0.018490755930542946, -0.01901881769299507, 0.016173487529158592, 0.004996517673134804, -0.019840458407998085, -0.0023458157666027546, 0.0021690879948437214, 0.0010225188452750444, 0.022052500396966934, 0.007434167433530092, 0.021130533888936043, 0.02308262512087822, 0.007953697815537453, 0.023673251271247864, -0.014118121936917305, 0.048024557530879974, -0.027379103004932404, -0.011054790578782558, -0.01699466072022915, 0.002995087532326579, 0.030800381675362587, -0.00022783689200878143, -0.0036406884901225567, 0.005190524738281965, -0.0327143557369709, -0.030949557200074196], [0.0008756066090427339, -0.015796659514307976, -0.00048299715854227543, -0.03628005459904671, -0.05965562164783478, -0.011401951313018799, 0.012654083780944347, -0.022499749436974525, 0.008240262977778912, -0.0019565564580261707, -0.001617969828657806, 0.0019994177855551243, -0.009080899879336357, -0.02120756171643734, 0.0089248176664114, -0.0001270440552616492, -0.04100404307246208, 0.010628560557961464, 0.006912407465279102, 0.022006742656230927, -0.017176100984215736, -0.005248915404081345, 0.008887343108654022, 0.009216085076332092, 0.001635693828575313, -0.00825713761150837, 0.018544983118772507, 0.005390284117311239, 0.011565248481929302, 0.01795964688062668, 0.009821373037993908, 0.00633115042001009, -0.0026653208769857883, -0.04607567563652992, 0.02463817410171032, -0.00637146458029747, -0.01140761561691761, -0.0030401600524783134, 0.00012789989705197513, 0.011194092221558094, -0.009106037206947803, 0.007827029563486576, -0.00011994656961178407, 0.00966950599104166, 0.012401008047163486, 0.023238148540258408, 0.0043228198774158955, -0.018995020538568497], [0.03821833059191704, -0.004433376248925924, 0.022562017664313316, -7.71782360970974e-05, 0.004906772635877132, 6.317184306681156e-05, 0.008218503557145596, -0.012658710591495037, 0.0219859816133976, -0.017590602859854698, -0.013279585167765617, 0.009119275957345963, 0.007415697444230318, -0.03257196024060249, 0.000533105805516243, 1.0253119398839772e-05, -0.025269750505685806, 0.015707921236753464, 0.028758861124515533, 0.009400549344718456, -0.017690354958176613, 0.0008980465936474502, 0.012561986222863197, 0.007455500774085522, 0.0018276434857398272, -0.02482730709016323, 0.015355021692812443, 0.0192066989839077, 0.008252469822764397, 0.009042865596711636, 0.01662863977253437, 0.034631941467523575, 0.0028063147328794003, -0.03141980618238449, 0.0095007149502635, 0.021292317658662796, -0.013789267279207706, 0.017871204763650894, 0.009123717434704304, 0.012482836842536926, -0.0018437695689499378, 0.010191172361373901, -0.010892272926867008, 0.03443301096558571, 0.0009053000248968601, 0.005598763003945351, -0.021580949425697327, -0.004683834966272116], [-0.01248110830783844, -0.005162438843399286, -0.010112913325428963, 0.005238617304712534, 0.016160449013113976, 0.0017302845371887088, 0.005221731029450893, 0.02211945131421089, -0.015358703210949898, -0.0059477477334439754, 0.008011078462004662, 0.0002527122269384563, -0.012842066586017609, -0.006721222307533026, 0.0038157517556101084, 0.004191418178379536, -0.016513124108314514, 0.0004418952448759228, 0.005212824326008558, 0.007521966006606817, -0.00923288892954588, -0.007706472650170326, -0.005164368078112602, 0.01249658316373825, -0.002410740591585636, 0.005503758322447538, 0.014709600247442722, 0.0031454151030629873, 0.026291845366358757, 0.014292274601757526, 0.012938261032104492, -0.016655441373586655, -0.020174317061901093, -0.04310644790530205, 0.016563430428504944, 0.027974003925919533, 0.0035982392728328705, -0.0003735469654202461, -0.00011480660759843886, -0.020591603592038155, -0.010648718103766441, 0.0020537450909614563, 0.006072212476283312, 0.013156584464013577, 0.009700489230453968, -0.026464935392141342, -0.010957280173897743, -0.005876912735402584], [-2.4985431878604353e-40, -3.5913878342180737e-41, -9.416025031030608e-41, 1.7975856700358753e-41, -2.3451990969093706e-40, -2.1313048993148305e-40, 6.254555565667389e-41, 1.213608548013151e-40, -6.917930258678757e-41, -3.3978685162948164e-40, -2.3118762194277265e-40, 2.348492148300534e-40, 1.7062770621004703e-39, 1.9991904800982868e-40, 1.5059695853667185e-36, -2.3459137591261763e-41, 2.1084917603156225e-40, -4.873015409689551e-41, 6.194439861547854e-41, -1.84726170059619e-40, 8.050994973559446e-38, 2.8251578339252637e-41, 2.5309552213402684e-40, 2.4026102949927584e-40, 1.5698046046598763e-40, -1.6285890752383024e-40, 3.12523188707578e-40, -2.241601101441837e-40, -1.7580830663265587e-40, -2.9376961135951898e-40, -7.409085370424605e-41, -3.2345331672931158e-40, 5.793528370904524e-41, 5.523918546368429e-42, 2.2083903278373387e-40, -2.4785746847438067e-40, 2.2678334086939975e-40, -2.7075888927684115e-41, 1.8202867051579374e-41, 6.236058425938301e-41, 1.7751088426681053e-40, 1.5812392001287668e-40, 9.065560285102972e-41, 5.3738506912269556e-39, 2.6405647872197555e-40, -1.5642694757257933e-40, -1.0021526097465362e-40, 3.0553070937059717e-40], [-1.6447460465319675e-40, -8.339687680582716e-41, -1.7854364123501792e-40, 3.5797570569641777e-40, -2.1954983819655504e-40, 2.5259806117919153e-40, -2.6622428744628605e-40, 3.2731389399852645e-40, -2.8065065513651004e-40, 1.600843365644671e-40, 2.445504040985741e-40, 9.952862472713446e-41, 1.8138967841606162e-40, -2.380806090887864e-41, 2.640312553496177e-40, -2.21253817129174e-40, -3.5089494455618447e-40, 9.250811942086712e-41, -4.4300649651164767e-41, -2.482540359397846e-41, 2.517264535343815e-40, -3.184058396608136e-40, 1.1455755075701812e-40, 1.5616350346128626e-40, -1.1524418700453728e-40, -1.626136802925734e-40, 8.346554043057908e-41, -3.866322592918603e-41, 3.122583432978206e-40, -1.3138013882123755e-40, -9.529810466333783e-41, -9.43648398860975e-41, -7.448181597579268e-41, 1.2117642991042532e-38, -1.044037420845205e-40, 1.2850159151582151e-39, 3.4832636447107708e-40, 5.202320548805883e-41, -2.82578841823421e-40, 1.592996094244452e-40, 1.768718921670784e-41, -1.7123867234049265e-42, 1.2787829395888983e-40, -1.2641533836213472e-40, 2.2137012490171298e-40, -1.9386964253933844e-40, -2.772833349267375e-40, -3.965254264499935e-41], [-2.9914359097020465e-40, 3.1764213199775656e-40, -1.7491427821241664e-40, -2.067531806203408e-40, -1.0712226110531064e-40, -5.588518405573803e-41, -4.1027216438501994e-41, -1.9010995875955496e-40, 1.1652357250246584e-40, 1.5342396496353125e-40, 2.006140920481338e-40, -1.4492508977740123e-40, -1.4998377723361382e-40, 1.773062946910191e-41, 3.094851736369218e-40, 1.0114432185650097e-40, 1.2266686497006584e-40, 3.0455400434096277e-40, 6.754538857738483e-41, 5.194263082636016e-40, -3.402632931073521e-41, 1.3449522530743162e-40, 9.60183720740008e-41, -2.6474451626795904e-40, -1.2095587954512524e-40, 7.77300258160976e-41, 9.698386671592059e-41, -1.3850132602066368e-28, 7.535482491906704e-41, -9.895871664169355e-40, -2.8892392126988376e-40, -3.1822367086045136e-40, -1.1023314369611173e-40, 3.6826123642456193e-41, 2.8015319418167473e-40, 3.1712645416288503e-40, 3.409720698706076e-39, 1.4799253211580826e-40, -2.6843539629314418e-39, 1.1773331346671745e-39, -6.300237895604378e-41, 2.9607194473640465e-40, -1.2886747054485672e-39, 1.0806953886719422e-40, -2.80490907111577e-40, 1.3022406758816958e-40, 1.6149404281957787e-40, 1.510389549772504e-40], [0.05645361915230751, -0.05985228344798088, 0.02430756576359272, -0.008250545710325241, 0.05550225451588631, -0.023515429347753525, -0.0158982053399086, 0.05228656530380249, -0.03879730403423309, -0.006398461293429136, -0.06401847302913666, -0.004755669739097357, -0.10408149659633636, -0.06245613470673561, 0.0225120410323143, -0.014697711914777756, -0.039143066853284836, -0.05077363923192024, -0.023546475917100906, -0.04615096375346184, -0.005755857098847628, 0.07089740037918091, 0.0200228039175272, -0.008018371649086475, 0.07430429756641388, -0.014579812064766884, -0.027483519166707993, 0.05435163527727127, -0.03329229727387428, -0.06974037736654282, 0.028476174920797348, -0.07898443937301636, 0.014994649216532707, 0.013069652952253819, 0.04428258165717125, 0.02782931551337242, -0.022717902436852455, -0.017867015674710274, 0.01585119217634201, -0.04523508623242378, -0.015453418716788292, -0.05685102567076683, 0.015023614279925823, 0.031408268958330154, -0.03389769420027733, -0.005117214284837246, 0.014452227391302586, 0.023377742618322372], [0.0298857931047678, -0.07241363078355789, 0.08174381405115128, -0.02631959319114685, 0.05590853840112686, 0.03302234411239624, 0.0394618846476078, 0.0173263568431139, 0.0013744508614763618, 0.014965956099331379, -0.03512921929359436, -0.015332017093896866, 0.06944844126701355, -0.02190176211297512, 0.020273739472031593, 0.0024032180663198233, -0.01340808067470789, 0.035923417657613754, 0.06009528785943985, -0.06236637383699417, -0.08717767894268036, 0.07913703471422195, 0.05231360346078873, 0.016179269179701805, -0.039340339601039886, 0.03785674273967743, 0.000936038966756314, 0.12664780020713806, -0.10876825451850891, 0.009455330669879913, 0.060827769339084625, 0.038334622979164124, 0.11256498098373413, -0.11947999149560928, -0.01006392389535904, -0.04514627158641815, 0.07382410019636154, 0.013140697963535786, 0.006642140913754702, -0.032316967844963074, 0.010442718863487244, -0.06007621809840202, 0.06761068850755692, 0.03389940410852432, 0.014592697843909264, 0.0057595763355493546, -0.012592936865985394, -0.15071451663970947], [-0.03103424794971943, -0.06612122058868408, 0.052734795957803726, -0.07289884239435196, 0.02194233238697052, 0.004925338085740805, -0.04459114372730255, -0.025847533717751503, -0.0190548375248909, -0.06352079659700394, -0.016094906255602837, 0.011440493166446686, 0.051912277936935425, -0.048089440912008286, -0.05036415532231331, -0.03427615389227867, -0.011112751439213753, 0.011198499239981174, 0.06901209056377411, 0.003579143201932311, -0.01485285721719265, -0.001465527107939124, -0.0675305649638176, -0.019338807091116905, -0.04727278649806976, -0.05070533603429794, -0.018753960728645325, -0.030015375465154648, -0.010020463727414608, 0.019471049308776855, 0.028372418135404587, -0.05809265375137329, -0.0907815620303154, -0.10726618766784668, 0.04112091287970543, -0.0467999093234539, -0.01938827708363533, 0.03889927268028259, 0.01626952737569809, -0.05443396046757698, -0.0035977018997073174, -0.003042275086045265, 0.044270988553762436, 0.08975819498300552, -0.005424001254141331, -0.045663513243198395, 0.0709524154663086, -0.06538037955760956], [-0.023566631600260735, -0.03327551111578941, -0.0033791298046708107, -0.047658879309892654, 0.055953364819288254, 0.058301594108343124, 0.029092878103256226, -0.03218621760606766, 0.05528454855084419, 0.024940336123108864, -0.06462022662162781, 0.026793118566274643, 0.012675121426582336, 0.09098248928785324, 0.03277771547436714, -0.0006782666314393282, 0.04404369741678238, 0.04192991554737091, -0.0379614420235157, 0.05211731418967247, -0.1482635885477066, -0.05897216498851776, -0.019516753032803535, 0.01737004518508911, -0.009892663918435574, 0.03311631828546524, -0.08275658637285233, 0.01311576273292303, 0.027745047584176064, -0.0018050277139991522, 0.017072390764951706, 0.10618555545806885, 0.013898812234401703, -0.017473271116614342, 3.595915040932596e-05, 0.05475699156522751, 0.07161568850278854, 0.002188175916671753, 0.049905721098184586, -0.08422265201807022, -0.019035160541534424, -0.028795452788472176, 0.037423085421323776, 0.019598396494984627, -0.028927864506840706, 0.023486824706196785, -0.008972582407295704, 0.012058477848768234], [-0.0674658790230751, 0.061912763863801956, -0.07485181093215942, -0.1323859691619873, -0.02023397572338581, 0.07250376045703888, -0.000371388450730592, -0.030538346618413925, 0.03029567189514637, -0.01813165470957756, 0.020736126229166985, 0.01941407099366188, 0.07221128046512604, 0.15566807985305786, 0.06236882135272026, 0.002446915255859494, 0.06441372632980347, 0.05145697295665741, 0.0059577967040240765, 0.09051812440156937, -0.08881828188896179, -0.04505086690187454, 0.038287460803985596, 0.03518874943256378, -0.028096377849578857, -0.092875637114048, 0.10198826342821121, 0.09748491644859314, 0.09263424575328827, 0.03008771874010563, -0.05024414509534836, 0.06855055689811707, -0.0763024166226387, 0.06263451278209686, -0.1714170128107071, 0.07946177572011948, -0.10808636993169785, 0.06695853173732758, 0.027836505323648453, -0.06119462475180626, 0.028700772672891617, 0.012774577364325523, -0.08930384367704391, -0.05137765407562256, -0.0558672659099102, 0.005389542784541845, -0.04414723441004753, 0.05137990787625313], [-0.015298345126211643, 0.057622846215963364, -0.041643306612968445, -0.05985373258590698, -0.021215321496129036, 0.05453206226229668, -0.0016243100399151444, 0.01191074587404728, 0.0012492922833189368, -0.0009464159957133234, -0.013794991187751293, 0.01069115474820137, -0.0072421845979988575, 0.06173272803425789, 0.03599253296852112, 0.004629506729543209, 0.025154976174235344, -0.0010126496199518442, 0.02769852615892887, 0.02746785245835781, -0.009133106097579002, 0.05835021287202835, 0.018022457137703896, -0.002781330607831478, -0.004934348165988922, -0.041125692427158356, -0.00813829805701971, -0.06659255176782608, 0.04071826487779617, -0.017770390957593918, -0.0014180561993271112, -0.0009567838278599083, 0.023189278319478035, 0.035968974232673645, 0.02227417752146721, 0.05166376754641533, 0.0019277693936601281, -0.013664823025465012, 0.006160798016935587, -0.026035405695438385, 0.006576803978532553, 0.021779844537377357, -0.07866258174180984, 0.02455969713628292, 0.014396325685083866, 0.048668090254068375, 0.03809700533747673, 0.05894792824983597], [-0.011246589943766594, 0.07778233289718628, -0.0026509263552725315, -0.14279867708683014, -0.04148668050765991, 0.1387479156255722, -0.016445033252239227, -0.05397273227572441, 0.01588803343474865, 0.015113580040633678, 0.013587899506092072, 0.03258424624800682, 0.030165042728185654, 0.13691605627536774, 0.07540931552648544, -0.0064307102002203465, 0.09702135622501373, 0.023977244272828102, -0.015428626909852028, 0.04361245781183243, -0.01913219317793846, 0.001018389593809843, 0.013502920046448708, 0.02927066758275032, 0.022937728092074394, -0.07649152725934982, -0.004683611448854208, -0.010255556553602219, 0.08446360379457474, 0.005685840733349323, -0.08044987916946411, 0.08628131449222565, 0.044682640582323074, 0.08511854708194733, -0.04140852391719818, 0.06751221418380737, -0.028911300003528595, 0.04571182653307915, 0.0245351605117321, -0.011348887346684933, 0.03931688889861107, 0.003834235481917858, -0.08321881294250488, 0.04470563307404518, -0.04293030500411987, 0.028776230290532112, -0.026728393509984016, 0.06900797039270401], [0.025880739092826843, -0.05766586586833, 0.025324048474431038, 0.0373678095638752, 0.03785550966858864, -0.04846303164958954, 0.005838832352310419, 0.012584343552589417, -0.007143245078623295, -0.02196991629898548, -0.01852230541408062, -0.015428400598466396, 0.046116478741168976, -0.01744784228503704, -0.04654459282755852, -0.005287581123411655, -0.02662179060280323, -0.012240659445524216, -0.025360330939292908, -0.04171738773584366, -0.03760642558336258, -0.05461472272872925, -0.00823280867189169, 0.012382294982671738, -0.007015476003289223, 0.01965564303100109, 0.0024040525313466787, 0.03260141238570213, -0.07089904695749283, 0.0025727739557623863, 0.025907255709171295, 0.0028580394573509693, -0.014028106816112995, 0.007192596793174744, 0.022561492398381233, -0.049037180840969086, 0.04205530881881714, 0.0010344070615246892, -0.004067355766892433, 0.021804073825478554, -0.00694532785564661, -0.017673233523964882, 0.023150760680437088, -0.009222629480063915, -0.023147892206907272, -0.03239215910434723, -0.028212370350956917, -0.05662316083908081], [-0.017900284379720688, 0.10850758105516434, -0.21607676148414612, 0.022071603685617447, -0.12875878810882568, 0.05864241346716881, 0.02085806615650654, -0.07837600260972977, 0.0033799950033426285, -0.03305172920227051, 0.011000354774296284, -0.014838781207799911, 0.07225043326616287, 0.10291589796543121, 0.0806596651673317, 0.010014393366873264, -0.05751122161746025, -0.009183734655380249, -0.04245240241289139, 0.032599303871393204, 0.055864788591861725, -0.05097624287009239, -0.0018565549980849028, 0.07424584776163101, -0.13119612634181976, -0.0581863634288311, 0.0065155355259776115, 0.04182327166199684, 0.02889576181769371, -0.041911713778972626, -0.013325367122888565, 0.018123574554920197, -0.10663383454084396, 0.04247012734413147, -0.016092192381620407, 0.10327967256307602, -0.07664291560649872, 0.039213959127664566, -0.10601884871721268, 0.029349487274885178, 0.01047992892563343, -0.0008741858182474971, -0.0043319580145180225, -0.11717592924833298, 0.03641585260629654, -0.020078524947166443, -0.027590733021497726, 0.009469066746532917], [0.05093313753604889, 0.0760975331068039, 0.07247177511453629, -0.058232612907886505, 0.06402187794446945, -0.0009919211734086275, -0.039729151874780655, 0.010715593583881855, -0.04578818753361702, -0.024625450372695923, -0.002654481213539839, 0.00480634905397892, 0.0016591021558269858, -0.004365433938801289, 0.008738293312489986, -0.009061147458851337, -0.023990390822291374, -0.012571951374411583, 0.004039891995489597, -0.02737070806324482, -0.03369366005063057, 0.02278921939432621, 0.02937304973602295, 0.028451276943087578, -0.06677745282649994, -0.01010852213948965, -0.011550608091056347, -0.049623966217041016, 0.019911428913474083, -0.0025070279370993376, 0.0012737575452774763, -0.035700514912605286, -0.0018865888705477118, -0.03414564207196236, -0.03942614048719406, -0.002486890647560358, -0.03304169327020645, 0.03576042875647545, 0.028149930760264397, -0.010816562920808792, -0.008124688640236855, 0.021765485405921936, 0.005479735787957907, 0.009548298083245754, -0.007480207365006208, -0.01350989006459713, 0.024523869156837463, 0.0456826388835907], [0.01908174715936184, -0.0006085830391384661, 0.03420747071504593, -0.013488688506186008, -0.013716641813516617, 0.009853794239461422, -0.012652755714952946, 0.02436744049191475, -0.01256487239152193, -0.011859248392283916, 0.0033601291943341494, 0.011002397164702415, 0.013088502921164036, -0.014705878682434559, -0.007719152607023716, -0.0014141207793727517, -0.012234171852469444, 0.004561622627079487, -0.016852088272571564, 0.018113180994987488, 0.007766061462461948, 0.011241739615797997, -0.009758108295500278, -0.0007922240765765309, -0.022100472822785378, -0.01047945860773325, -0.010077541694045067, 0.0030849825125187635, -0.014942668378353119, -0.014366253279149532, -0.022615820169448853, -0.006380423903465271, 0.028716227039694786, -0.020365871489048004, 0.02959759719669819, -0.007085238117724657, 0.00691436929628253, -0.010365563444793224, 0.00010498337360331789, -0.010264354757964611, -0.006946459412574768, -0.0005038504023104906, 0.01862993836402893, -0.004033476579934359, -0.012839188799262047, -0.007248535752296448, -0.017165737226605415, -0.015049259178340435], [-0.022069692611694336, 0.016132790595293045, -0.018852563574910164, 0.07032716274261475, 0.032652728259563446, -0.06717276573181152, 0.02361283265054226, 0.02159346267580986, 0.0324462354183197, 0.02648405358195305, -0.031601253896951675, 0.006598397623747587, 0.03727453574538231, -0.030300172045826912, -0.06447074562311172, 0.0048612612299621105, 0.03742508590221405, 0.008410225622355938, 0.01252986304461956, -0.006226727273315191, -0.008991274982690811, 0.024388164281845093, -0.022967010736465454, -0.02241574227809906, -0.00532891321927309, -0.01619092747569084, 0.0031428977381438017, 0.006337597966194153, -0.06102556362748146, 0.019278014078736305, 0.03273613750934601, 0.015416018664836884, 0.030036645010113716, 0.05044390633702278, 0.037746138870716095, -0.06864999234676361, 0.025328319519758224, -0.007441313471645117, -0.04063498601317406, -0.01725914515554905, -0.013590460643172264, -0.03865618258714676, 0.005150802433490753, 0.006488654762506485, -0.022854069247841835, -0.06770048290491104, -0.016527757048606873, -0.02480703964829445], [0.008769761770963669, 0.058995939791202545, 0.002367643639445305, 0.016140375286340714, -0.005976417101919651, 0.02396024391055107, -0.01882210187613964, 0.06684962660074234, -0.00108828314114362, 0.029300503432750702, 0.01000188384205103, 0.020983649417757988, 0.0160694383084774, -0.036020003259181976, -0.008177231065928936, -0.003326766425743699, -0.021702907979488373, 0.007644728757441044, 0.012922199442982674, -0.06797181814908981, 0.016802625730633736, 0.02555863745510578, 0.012660732492804527, -0.029169516637921333, -0.05100695416331291, -0.03219696134328842, 0.030728505924344063, -0.03262779489159584, -0.022726550698280334, -0.017979677766561508, -0.002594645833596587, -0.017421191558241844, -0.03891618549823761, 0.037310607731342316, 0.009977590292692184, 0.006768704392015934, 0.018113790079951286, 0.04917951300740242, 0.017813226208090782, 0.012358097359538078, -0.004391394555568695, 0.0027739270590245724, 0.011833665892481804, -0.02954469993710518, 0.03835563734173775, 0.06660081446170807, -0.02779470942914486, 0.03013327717781067], [0.10179751366376877, -0.010416075587272644, 0.011726481840014458, 0.04599842056632042, 0.04642215371131897, -0.00863661803305149, 0.0024932757951319218, 0.040045782923698425, 0.005087422206997871, 0.04452885687351227, 0.014240465126931667, 0.008592354133725166, -0.00940921064466238, 0.03764214739203453, -0.013178043998777866, -0.0015949421795085073, -0.037612415850162506, 0.03724202886223793, 0.09237922728061676, 0.020093224942684174, 0.04312119632959366, -0.01905832625925541, 0.0179438479244709, 0.02179046720266342, 0.06673948466777802, 0.053388725966215134, -0.02200508303940296, -0.025840215384960175, 0.006601340603083372, -0.0018960773013532162, -0.01986106112599373, -0.03285034000873566, -0.013652869500219822, -0.03484812751412392, 0.028695961460471153, -0.004032593220472336, 0.004319773055613041, -0.003072283463552594, -0.005266339052468538, 0.03027237206697464, -0.000960280594881624, 0.031024616211652756, 0.042287446558475494, -0.0009628471452742815, -0.008150506764650345, 0.04153323173522949, 0.040987007319927216, -0.06716619431972504], [-0.12142320722341537, 0.21674658358097076, -0.0649130791425705, -0.05756878852844238, -0.10019928216934204, 0.08782787621021271, 0.03083730675280094, -0.1223486065864563, -0.05223957076668739, 0.0006911226082593203, 0.04843685403466225, -0.023609820753335953, 0.08367294073104858, 0.11757524311542511, 0.03862877935171127, 0.008793388493359089, -0.1161554604768753, 0.01967421919107437, -0.18781781196594238, 0.13688437640666962, 0.06025858223438263, -0.02686357870697975, -0.042687028646469116, 0.14247381687164307, 0.025585873052477837, -0.12554052472114563, -0.014719635248184204, -0.0269018542021513, 0.024882536381483078, -0.021732009947299957, -0.009402967058122158, -0.0024840261321514845, -0.09409461170434952, 0.011510922573506832, -0.007082798518240452, 0.12353701889514923, -0.004622722510248423, -0.12275290489196777, -0.08323449641466141, -0.04806090146303177, 0.040592413395643234, 0.02128864824771881, -0.032108843326568604, -0.08181436359882355, 0.05029444023966789, -0.12552301585674286, -0.03658690303564072, 0.007240653038024902], [-0.024752184748649597, -0.02262202464044094, 0.06777782738208771, -0.021752776578068733, 0.005213342607021332, 0.05177341774106026, -0.01041770726442337, -0.045812807977199554, -0.005517921410501003, -0.03601099178195, -0.009337772615253925, -0.010648615658283234, -0.0019275551894679666, -0.01591840386390686, 0.024856602773070335, 0.0015019504353404045, -0.01178427878767252, -0.042741794139146805, -0.048138394951820374, -0.025875985622406006, 0.007761884946376085, -0.0625707358121872, 0.002631263341754675, -0.009068909101188183, -0.012254125438630581, -0.05906221643090248, 0.040708936750888824, 0.013028637506067753, 0.011955589056015015, 0.0034256428480148315, 0.028700590133666992, 0.01073225773870945, -0.010897326283156872, -0.019672514870762825, -0.04364875331521034, 0.011883733794093132, 0.07982125878334045, -0.026784062385559082, -0.03961217775940895, -0.05340603366494179, -0.027021197602152824, 0.02918173372745514, -0.04441304877400398, -0.04607053101062775, 0.010440468788146973, -0.015686042606830597, -0.017299767583608627, 0.0707351565361023], [-0.02057729661464691, 0.031605809926986694, 0.017857380211353302, 0.04255479574203491, -0.05236397311091423, -0.07191816717386246, -0.014137744903564453, 0.023540154099464417, -0.008078423328697681, 0.03852252662181854, -0.031594980508089066, -0.014433354139328003, -0.028240814805030823, -0.0079610925167799, 0.08467693626880646, -0.0006269228179007769, -0.010986605659127235, -0.008747728541493416, -0.01590423472225666, -0.045006562024354935, 0.03239559382200241, 0.047533128410577774, 0.008627479895949364, 0.061572231352329254, 0.027825940400362015, 0.046137940138578415, -0.00027728077839128673, 0.0017862996319308877, -0.027512816712260246, -0.04346134141087532, -0.04858162999153137, -0.03949115797877312, -0.06423382461071014, 0.03214250132441521, 0.01275221724063158, -0.021881988272070885, -0.07049855589866638, 0.03715164586901665, -0.008638914674520493, 0.03795386105775833, 0.0024910676293075085, 0.012140762992203236, -0.019381819292902946, -0.039369989186525345, -0.021782048046588898, -0.000857854844070971, -0.07769051939249039, -0.03014414943754673], [0.02969568409025669, -0.017165593802928925, -0.017294472083449364, -0.002011034404858947, -0.01283365860581398, 0.02333526499569416, 0.042566604912281036, -0.0005355349858291447, 0.05264849588274956, -0.026008255779743195, -0.06702301651239395, 0.015563883818686008, 0.007765640038996935, 0.1137155070900917, 0.01986466534435749, 0.027527613565325737, -0.03456392139196396, 0.06228052079677582, 0.013718780130147934, 0.018466664478182793, -0.16236887872219086, -0.04870119318366051, 0.0032978998497128487, 0.03403263911604881, 0.08130931109189987, -0.022691478952765465, -0.026609893888235092, -0.002861045766621828, -0.07023560255765915, -0.009864245541393757, -0.020651113241910934, 0.08220899850130081, -0.030498072504997253, 0.04589354619383812, -0.11686256527900696, -0.03317045792937279, -0.01791338250041008, 0.02356756292283535, 0.03309156745672226, 0.006546718999743462, -0.030177107080817223, -0.005648198537528515, -0.07443693280220032, -0.009922227822244167, -0.020198598504066467, 0.05581560358405113, 0.04626743867993355, -0.12370407581329346], [0.029575161635875702, 0.05235867574810982, 0.0007953169988468289, -0.010774961672723293, -0.02475195936858654, 0.019680744037032127, 0.00545088853687048, -0.03789399191737175, 0.02080504782497883, -0.0008933724602684379, 0.013980204239487648, -0.0015955675626173615, -0.0011335753370076418, -0.015242701396346092, 0.07492239773273468, 0.004289763048291206, 0.07225340604782104, 0.017401449382305145, -0.000235857572988607, 0.028080955147743225, 0.020617427304387093, -0.014063814654946327, 0.024561041966080666, -0.0046033659018576145, -0.050758786499500275, 0.006685515865683556, 0.04540781304240227, 0.018271280452609062, -0.016296926885843277, 0.01756279170513153, -0.002027712529525161, 0.028210202232003212, 0.0030488204210996628, -0.014498081989586353, 0.005192475859075785, 0.029572125524282455, -0.05149044841527939, 0.0318668894469738, -0.03667927160859108, -0.0005089676706120372, 0.012006720528006554, 0.016018416732549667, -0.03274489566683769, 0.007787731010466814, -0.0013976278714835644, 0.015955395996570587, 0.02457169070839882, 0.01896517351269722], [0.04322458431124687, 0.036050356924533844, 0.016704974696040154, -0.010193449445068836, -0.030389586463570595, -0.030682982876896858, 0.006374249700456858, 0.004582769237458706, 0.009280369617044926, 0.0033647711388766766, 0.006283001508563757, -0.016240587458014488, 0.0009368497412651777, 0.008481084369122982, 0.0029753984417766333, 0.009353026747703552, 0.007249380927532911, -0.0024672290310263634, 0.01490812934935093, 0.02616831101477146, -0.03318648412823677, -0.014323254115879536, -0.034438811242580414, -0.002787961158901453, -0.030754191800951958, -0.04393221437931061, 0.004050050396472216, 0.011341644451022148, -0.03172137960791588, 0.0016161040402948856, 0.023570775985717773, 0.028528591617941856, 0.003869033884257078, 0.017734648659825325, -0.027619507163763046, 0.016521336510777473, 0.04531048238277435, -0.02081674337387085, -0.046406351029872894, -0.00983854103833437, -0.01074931863695383, 0.008176153525710106, -0.04443131387233734, 0.009092286229133606, 0.005120641551911831, 0.03104740008711815, -0.008547380566596985, -0.01813831366598606], [0.004872441291809082, -0.03208429738879204, 0.07051524519920349, -0.00041737506398931146, 0.01953127421438694, 0.010355877690017223, 0.0173366516828537, 0.018551038578152657, -0.006660630460828543, 0.026751378551125526, -0.024830438196659088, -0.011204658076167107, -0.014394469559192657, 0.0391571931540966, 0.01737934723496437, 0.007262818049639463, -0.062126241624355316, 0.001678955857641995, 0.06445597857236862, -0.0018182535422965884, -0.015508334152400494, 0.018291404470801353, -0.05244549363851547, -0.05317823216319084, 0.017373010516166687, 0.01698472909629345, -0.03350076079368591, -0.025602495297789574, 0.034370288252830505, 0.01991802267730236, -0.009527551010251045, 0.03830387443304062, 0.022767940536141396, -0.02028599940240383, 0.062450140714645386, -0.010974414646625519, 0.011193971149623394, -0.04187800735235214, -0.0011527570895850658, 0.02160346694290638, 0.028654929250478745, -0.008963481523096561, 0.014795362949371338, -0.00967036746442318, 0.0006714819464832544, 0.004842006601393223, 0.01297589298337698, 0.040989603847265244], [0.015425900928676128, 0.06199224665760994, -0.03491702675819397, 0.01502308901399374, -0.04748110473155975, 0.00844519305974245, 0.019724013283848763, 0.0239151269197464, 0.007255933713167906, -0.0073090894147753716, 0.007328429259359837, 0.001415581675246358, 0.06032728776335716, 0.02269257791340351, -0.018176067620515823, 0.001733195735141635, 0.04226445406675339, 0.02296583354473114, -0.011880714446306229, 0.03664775192737579, -0.0007035183953121305, 0.00047844339860603213, -0.02722836285829544, 0.00010075604950543493, -0.014069359749555588, 0.004612007178366184, -0.001583378529176116, 0.04219359531998634, 0.011051367968320847, 0.018715234473347664, 0.010296055115759373, 0.013738954439759254, -0.0028314893133938313, 0.014805943705141544, 0.018036508932709694, 0.014573897235095501, 0.008382975123822689, 0.030596330761909485, -0.006779795978218317, -0.019435280933976173, 0.006117100827395916, 0.02179524302482605, -0.05078558996319771, -0.02779976651072502, 0.005148516036570072, -0.06352448463439941, -0.012199808843433857, 0.04331350326538086], [-0.007216805592179298, 0.014035859145224094, 0.03026367723941803, -0.006545662879943848, 0.021960770711302757, -0.019575003534555435, 0.00730563560500741, -0.02568276971578598, 0.0029869722202420235, -0.013407482765614986, 0.008569045923650265, 0.0014361483044922352, -0.012478562071919441, 0.06621310114860535, -0.028306925669312477, 0.001675381208769977, -0.0016351257218047976, -0.0016556064365431666, 0.03887668997049332, 0.034200314432382584, 0.011146855540573597, -0.01549441460520029, -0.000746019883081317, -0.012296336703002453, -0.056582603603601456, -0.010557842440903187, 0.011293569579720497, -0.040305349975824356, 0.04240673407912254, 0.010111344046890736, 0.010461244732141495, 0.016515515744686127, -0.021955041214823723, 0.03915134817361832, -0.011148995719850063, 0.020442387089133263, -0.003846801584586501, -0.02810433879494667, 0.0022233999334275723, -0.012258588336408138, 0.010417066514492035, 0.023344537243247032, -0.02674083784222603, -0.04673316702246666, 0.0011766949901357293, -0.009658818133175373, -0.05903996154665947, -0.010996316559612751], [0.0007002673810347915, -0.028476020321249962, -0.0020808910485357046, -0.025688033550977707, 0.0003664213581942022, -0.028637098148465157, 0.011976129375398159, 0.02202707529067993, 0.0181978028267622, 0.02710564434528351, 0.016933487728238106, -0.013244230300188065, 0.07643462717533112, -0.007492796052247286, -0.009041952900588512, 0.006309111602604389, 0.0386953130364418, 0.03565152361989021, 0.00035829644184559584, -0.009080875664949417, 0.006739381235092878, 0.009537707082927227, -0.008596275001764297, -0.00930321216583252, 0.02863963693380356, -0.041447822004556656, -0.002716522663831711, 0.040295861661434174, -0.027145663276314735, 0.032130807638168335, -0.004267003387212753, 0.03535008430480957, 0.020776329562067986, -0.0007438789471052587, 0.03804537281394005, -0.027533208951354027, -0.00014653192192781717, -0.004529325757175684, -0.014899169094860554, -0.03146642446517944, 0.00862458162009716, -0.02042323164641857, -0.06038229167461395, -0.0016687222523614764, 0.01798993907868862, -0.0290993582457304, -0.00251064938493073, -0.01662462204694748], [-0.03764806315302849, -0.002807416720315814, 0.010161474347114563, 0.0064660171046853065, -0.0339752621948719, -0.0016287589678540826, -0.0025125686079263687, 0.016841936856508255, 0.010353032499551773, 0.025189276784658432, 0.011935991235077381, -0.01776770129799843, 0.047471120953559875, -0.003247693879529834, -0.01357957348227501, 0.0065565286204218864, -0.010387684218585491, -0.012723701074719429, -0.024280468001961708, 0.004718754440546036, 0.014091595076024532, 0.03759421408176422, -0.005255506839603186, -0.010425115935504436, -0.03256820887327194, -0.08003812283277512, -0.00871951226145029, 0.005040477961301804, -0.013199223205447197, 0.031355611979961395, -0.007262778468430042, 0.005929692182689905, 0.02060910128057003, -0.05287070572376251, -0.0005228830268606544, 0.0019071674905717373, -0.01447817962616682, -0.014434410259127617, -0.01831386610865593, -0.03529806435108185, 0.008443629369139671, -0.0073738303035497665, -0.06279010325670242, -0.022696340456604958, 0.00438027735799551, -0.024922354146838188, -0.008798480033874512, -0.02606203965842724], [-0.06184094399213791, 0.026256801560521126, -0.06423860043287277, 0.0037998761981725693, 0.03092622384428978, 0.00012798700481653214, -0.015696823596954346, -0.07615330815315247, 0.017309101298451424, -0.0013623291160911322, -0.013752690516412258, -0.01049873884767294, -0.036861009895801544, -0.035507071763277054, 0.004412397276610136, -0.009402770549058914, 0.017335660755634308, -0.006592821329832077, -0.016150126233696938, -0.032035261392593384, -0.00389471766538918, -0.017480293288826942, 0.013228103518486023, 0.009958866983652115, -0.04939679801464081, 0.018727460876107216, 0.006719197146594524, -0.05338909476995468, 0.030923180282115936, -0.0003739413514267653, -0.0027214111760258675, 0.01839681714773178, -0.00616978295147419, 0.039984580129384995, 0.04569412022829056, 0.018843580037355423, -0.05036553740501404, -0.02199402265250683, 0.006194496527314186, -0.021856432780623436, 0.017666205763816833, 0.02319013886153698, -0.01191761251538992, 0.009480978362262249, 0.002583227353170514, -0.0006360101979225874, -0.021293168887495995, 0.02425338886678219], [0.012758656404912472, 0.04955829307436943, 0.007143852300941944, 0.024081915616989136, 0.0018374461214989424, -0.00513916602358222, 0.001841259654611349, -0.00320197781547904, 0.01015120092779398, -0.008012847974896431, 0.017330404371023178, -0.020100165158510208, 0.03966633230447769, 0.025869712233543396, 0.043072912842035294, 0.005083052441477776, -0.007528179325163364, 0.05369316041469574, -0.048591215163469315, 0.041759099811315536, -0.02845000848174095, -0.02023405395448208, 0.015844503417611122, -0.001385117182508111, -0.0011677492875605822, -0.03766648471355438, 0.03342915326356888, 0.04569467529654503, 0.005454023368656635, 0.013532420620322227, 0.007544647436589003, 0.035055067390203476, -0.011656946502625942, 0.02297152951359749, 0.021227167919278145, 0.04348151013255119, -0.016833573579788208, -0.039923783391714096, -0.019694486632943153, -0.013780933804810047, 0.01575351320207119, 0.02340584248304367, -0.006255098152905703, -0.02841062657535076, -0.00792758073657751, -0.010135888122022152, 0.003397011663764715, -0.002783950651064515], [-1.6119416494821236e-40, -1.4338926666050123e-40, -1.5541661137980114e-40, 4.738490757114369e-41, -1.3248015811573253e-40, -2.6451206887869684e-38, -9.390521398979897e-41, 2.3089166770710724e-39, 9.199944807831722e-41, 1.0564529252391228e-40, -1.5390320903833033e-40, 2.3710390405915202e-40, -1.6809415858654776e-40, -1.2446893479518755e-40, -8.103737045159704e-40, 3.093212217165958e-40, -3.3549047053786175e-40, -1.692208025518649e-40, -3.038323356318355e-40, -2.268421954049014e-40, 3.2346172452009752e-40, 7.727039991979906e-40, -4.274240575883557e-41, 2.4615208824329737e-41, -7.816162574310965e-41, -5.97233405495237e-41, -3.3586741982476513e-40, -7.106404902130445e-41, -2.529287676167722e-40, -2.7694001680297792e-40, 1.8844942007933005e-40, -2.988030754433737e-40, -1.9745416401108132e-40, -3.3032948829375345e-40, 2.5961856648545886e-40, -2.7375766799049626e-40, 1.2500423080855963e-40, -8.937201345770818e-41, -1.6096014810467011e-40, 1.2314891164179357e-40, 1.2621355138327195e-40, 2.7091022951098823e-40, -6.022780799668064e-42, 2.7071054447982195e-39, 2.111448500075348e-40, -1.4726764042021303e-39, -2.8668604762235703e-40, -2.4516137022901972e-40], [0.005821436643600464, 0.02843695878982544, -0.05175735428929329, -0.05155270919203758, 0.014949804171919823, -0.0012369818286970258, -0.0024607160594314337, -0.045392490923404694, 0.022777853533625603, -0.017185518518090248, 0.020065730437636375, -0.0017563033616170287, -0.0188604723662138, -0.03428535908460617, 0.03346695005893707, 0.004037846345454454, 0.06486143916845322, 0.03524314612150192, 0.05631648376584053, 0.0090872161090374, -0.0013640867546200752, -0.019061561673879623, 0.00940673053264618, -0.019030068069696426, -0.011906460858881474, 0.004007971845567226, 0.06269530951976776, 0.031572941690683365, -0.021937495097517967, 0.012241177260875702, -0.02461140975356102, 0.030883925035595894, 0.013607123866677284, -0.025643926113843918, -0.0014214490074664354, 0.024727802723646164, 0.04679907485842705, 0.02095743454992771, -0.013326853513717651, 0.005269840359687805, 0.02326359413564205, 0.04679190367460251, -0.008379019796848297, 0.011831468902528286, -0.0026823889929801226, -0.005730915814638138, -0.012440909631550312, -0.0057508801110088825], [-0.0002260461333207786, -0.0353136882185936, 0.0156734399497509, 0.05041096359491348, 0.05209364369511604, -0.02563461847603321, 0.023647313937544823, 0.030724288895726204, 0.01550047006458044, 0.023537175729870796, -0.02682231366634369, -0.0018603880889713764, 0.05795181170105934, -0.009733613580465317, -0.004277089145034552, 0.01097012683749199, -0.05337856337428093, 0.037601254880428314, 0.016054872423410416, 0.030532553791999817, -0.023675721138715744, 0.018801536411046982, -0.045830365270376205, -0.07141866534948349, 0.037633687257766724, -0.003743202891200781, 0.03993867337703705, -0.003487707581371069, 0.012433117255568504, 0.04005015268921852, 0.01576659269630909, 0.07777420431375504, -0.0058540781028568745, -0.017882566899061203, 0.009932099841535091, 0.023118527606129646, -0.05676139518618584, -0.04095734655857086, -0.02069966122508049, 0.008367819711565971, 0.009608065709471703, -0.012729552574455738, 0.006722234655171633, -0.02411304973065853, -0.0005537269171327353, -0.03876182436943054, -0.015397285111248493, 0.021361233666539192], [-0.03377313166856766, -0.04047179967164993, 0.018072977662086487, 0.025416769087314606, -0.05246651917695999, -0.022292306646704674, -0.009096048772335052, 0.07376651465892792, -0.03394697979092598, 0.0023760648909956217, -0.00599259277805686, -0.024707742035388947, 0.08360286056995392, -0.016298266127705574, 0.04326583445072174, -0.002483971416950226, 0.042315270751714706, -0.039259783923625946, 0.009383740834891796, -0.002188759157434106, -0.0024144859053194523, -0.000415776768932119, -0.06468741595745087, -0.012491787783801556, 0.04979938268661499, 0.0034233760088682175, -0.056190237402915955, 0.009425177238881588, 0.014454999007284641, -0.02285880409181118, -0.030061572790145874, -0.04634130373597145, -0.009593838825821877, 0.04734852910041809, -0.0012695842888206244, -0.01892286166548729, 0.041700564324855804, 0.0014091372722759843, 0.01154401432722807, 0.04973239079117775, 0.023912882432341576, 0.007389926351606846, -0.009981080889701843, 0.03044891729950905, 0.0021186035592108965, 0.02005756087601185, 0.02541390247642994, -0.004471226129680872], [-3.195871342662394e-40, 1.7526039893310487e-40, 1.8711538394129282e-40, -3.2802014842454615e-40, -3.4880981244126914e-40, -1.3970945689318426e-42, 3.5693594223588875e-40, -1.7043012312657723e-40, -6.830349104658456e-41, 8.532001881826654e-40, -6.504827471395801e-42, -1.7178798133850797e-40, 6.023901838439524e-41, 3.5695696171285363e-40, -1.221792131044808e-41, -2.071427415934231e-40, -1.297910663626932e-40, -3.3395464742096175e-40, 1.8535114917470788e-40, 3.661144471772163e-40, -3.089442724296924e-41, -3.295195377813737e-40, 1.4924949683830762e-40, 4.678375052994834e-41, -2.182326176400897e-40, 9.849306516199842e-41, 7.305949803450299e-41, 8.643208927955472e-42, 2.3537890564956817e-40, -2.322974503265179e-40, 8.53811154313111e-42, 1.24341416634934e-40, 1.5551470227230387e-40, -1.0581204704116694e-41, 6.175942721818766e-41, -1.761992689042025e-41, -1.5140329257797486e-40, 2.7978325138709298e-40, -1.6484034355238553e-40, 9.897371053526183e-42, 7.348549276765773e-40, -2.0485161860425203e-40, -3.3687355212215035e-40, -1.8083756682111764e-41, 8.201799911693154e-42, 1.6319381785680387e-40, -1.6134550518235944e-41, -2.7822402658583875e-39], [-0.030502144247293472, 0.004472713451832533, -0.015494108200073242, 0.09619072824716568, 0.006901112850755453, 0.03882400318980217, 0.0247944463044405, -0.006091449409723282, -0.00915442779660225, -0.0011959153926, -0.06491605192422867, 0.005414356477558613, -0.042394716292619705, 0.03244543448090553, -0.0304977186024189, 0.006861009635031223, -0.09246724843978882, -0.03890712559223175, 0.04244406521320343, 0.001993710407987237, -0.025767067447304726, 0.023452308028936386, 0.023552391678094864, -0.0024872208014130592, -0.013219915330410004, 0.024891039356589317, 0.012763959355652332, -0.017832305282354355, 0.05049699544906616, -0.0002941843995358795, 0.010694870725274086, 0.05066674202680588, -0.04136975109577179, -0.06413009762763977, 0.049556486308574677, 0.0413699671626091, -0.04264841228723526, 0.014543535187840462, -0.06895411759614944, 0.004423166625201702, 0.00952185783535242, 0.01813291199505329, 0.03756244108080864, 0.004422710742801428, 0.019711002707481384, -0.04454876855015755, 0.004112736321985722, -0.01335865817964077], [-0.005978611763566732, 0.03542504087090492, -0.06790369004011154, -0.004979240242391825, -0.02772366628050804, 0.05203088000416756, 0.009426395408809185, -0.032017745077610016, -0.002315118908882141, -0.0211486853659153, 0.013518474996089935, 0.004787714220583439, 0.022102054208517075, 0.004360557533800602, -0.010791358537971973, -0.001752742798998952, 0.048142313957214355, -2.504547592252493e-05, 0.0019363164901733398, 0.009151465259492397, -0.014637721702456474, -0.002474046777933836, 0.04230162873864174, -0.004553146660327911, -0.03360462188720703, 0.012083000503480434, 0.04884694516658783, 0.03761350363492966, 0.013313056901097298, 0.008445684798061848, 0.022054603323340416, 0.018315298482775688, -0.026005810126662254, 0.026285476982593536, 0.00855614710599184, 0.013939281925559044, 0.007954412139952183, 0.02350817620754242, -0.0610128752887249, 0.0015696673654019833, 0.017689982429146767, 0.025895055383443832, 0.02409445121884346, -0.02265554666519165, 0.018636243417859077, -0.017529714852571487, -0.006288051139563322, -0.002605587709695101], [0.006441010627895594, 0.02987664006650448, -0.02785896509885788, -0.06364522129297256, -0.05669000744819641, 0.025234736502170563, 0.019324950873851776, -0.012457055039703846, 0.006151134148240089, -0.018453579396009445, -0.013437770307064056, 0.002202661009505391, -0.009867054410278797, 0.019371232017874718, 0.019820520654320717, 0.0039283824153244495, -0.007992424070835114, -0.010734795592725277, 0.0028694141656160355, -0.02591969631612301, -2.4951659725047648e-05, -0.027724264189600945, 0.028448428958654404, -0.009124408476054668, -0.02370869368314743, 0.03261033445596695, -0.009176655672490597, 0.017458895221352577, -0.018107470124959946, -0.001506746863014996, -0.02146713249385357, 0.026701828464865685, 0.006450516637414694, -0.022016029804944992, -0.04243031144142151, -0.013076785020530224, -0.032908279448747635, 0.031659238040447235, -0.011975090950727463, 0.01481252908706665, 0.012734465301036835, -0.0006111997063271701, 0.0023610671050846577, -0.04257667064666748, -0.006392255891114473, -0.007256355602294207, -0.015005885623395443, 0.022468769922852516], [0.014974220655858517, -0.060270898044109344, -0.021220505237579346, -0.004074865952134132, -0.02211565524339676, 0.040189046412706375, -0.008221465162932873, 0.03244205191731453, 0.010213818401098251, -0.027717554941773415, 0.0014419691869989038, 0.011311105452477932, -0.06485326588153839, -0.042292989790439606, 0.027226857841014862, -0.0039204987697303295, 0.05362251028418541, 0.0013638631207868457, -0.0020819224882870913, 0.00169363955501467, -0.005682553164660931, -0.008322342298924923, 0.053651995956897736, -0.013352111913263798, 0.016722308471798897, 0.024423688650131226, 0.032480817288160324, 0.02846975438296795, -0.001006082515232265, 0.01364029198884964, -0.03151208162307739, 0.02124749682843685, -0.03199334442615509, 0.03335905820131302, 0.0014686548383906484, -0.005973105784505606, -0.0003626794496085495, 0.03874202445149422, 0.006192405242472887, 0.0161701999604702, 0.010914349928498268, 0.02329830452799797, -0.055561430752277374, -0.017494894564151764, -0.006325994618237019, 0.016176437959074974, -0.0350690521299839, 0.0055076065473258495], [-0.002083339262753725, 0.0746525228023529, -0.0057413410395383835, 0.014330042526125908, 0.002095464151352644, -0.015485224314033985, 0.009250550530850887, -0.05646664649248123, 0.031033402308821678, 0.030897775664925575, -0.00527293561026454, 0.00535850552842021, -0.025401579216122627, 0.037810567766427994, -0.021628817543387413, 0.0024939693976193666, 0.0036687327083200216, 0.014079864136874676, 0.0496043786406517, 0.026506952941417694, -0.019866621121764183, -0.018693044781684875, 0.00966578908264637, -0.008357582613825798, -0.035485267639160156, 0.014332794584333897, -0.013029285706579685, -0.02735605463385582, 0.00015194242587313056, -0.01555758435279131, 0.022442512214183807, -0.012090384028851986, 0.0021263589151203632, -0.042220450937747955, 0.025482511147856712, 0.017582306638360023, 0.013894608244299889, -0.04099331423640251, 0.009966632351279259, 0.0053676702082157135, 0.002558708656579256, 0.0010151168098673224, -0.04474763199687004, 0.03814845159649849, -0.011325628496706486, 0.017306463792920113, 0.04083876311779022, -0.0277467779815197], [0.0032880245707929134, -0.10279256105422974, 0.024967525154352188, 0.02829236537218094, -0.0193936787545681, 0.061528779566287994, 0.014324210584163666, -0.049414362758398056, 0.006466240156441927, -0.010756978765130043, -0.010034814476966858, -0.01077273953706026, -0.04097196087241173, 0.027455853298306465, 0.047858841717243195, 0.00414429884403944, -0.03219801187515259, -0.005748186260461807, 0.0007655141525901854, -0.02378484606742859, -0.0314134918153286, -0.002954414812847972, -0.011676961556077003, -0.08876585215330124, 0.027517477050423622, 0.020077291876077652, -0.017028799280524254, -0.03759483993053436, 0.0321950763463974, 0.001807043212465942, 0.004658392630517483, 0.03555013984441757, -0.0378292091190815, 0.032956432551145554, 0.011331235058605671, -0.0007160112727433443, 0.024500839412212372, -0.03638084605336189, 0.02212008461356163, -0.0009362390264868736, 0.035601723939180374, -0.009731890633702278, 0.022439945489168167, -0.0433560311794281, -0.005120576824992895, 0.042613085359334946, -0.006718611344695091, 0.02450706623494625], [0.022773301228880882, -0.01644301228225231, -0.03751467913389206, -0.0027719116769731045, 0.008919469080865383, -0.04113868251442909, 0.003060938324779272, -0.037785958498716354, -0.02741127647459507, -0.012170262634754181, -0.04690620303153992, 0.004300299566239119, -0.061319563537836075, -0.017479775473475456, 0.030055148527026176, -0.0009795988444238901, 0.03850207477807999, -0.04131707549095154, 0.014447239227592945, -0.04183291271328926, 0.02926798164844513, 0.02244800142943859, -0.024806393310427666, 0.02403872273862362, 0.06335665285587311, 0.037086501717567444, 0.008109397254884243, 0.00021850554912816733, 0.009317625313997269, 0.0059776222333312035, 0.03152845427393913, -0.02610543929040432, 0.015498454682528973, 0.007300944533199072, -0.015380080789327621, 0.009044668637216091, -0.024795077741146088, -0.05744190141558647, -0.03269949182868004, -0.006929341237992048, -0.02077460289001465, 0.01994945853948593, 0.0563008151948452, 0.011114522814750671, 0.025304080918431282, 0.011685367673635483, -0.017715010792016983, 0.0044924430549144745], [-0.03292682021856308, 0.003598061390221119, -0.04878198355436325, -0.007492529693990946, 0.052732914686203, 0.03988293558359146, -0.008760997094213963, -0.030948234722018242, -0.0414850078523159, 0.01027890108525753, -0.00922293309122324, -0.0015553068369626999, -0.017214208841323853, -0.006113241892307997, -0.01017230935394764, -0.002512690145522356, -0.04263852909207344, -0.03297377750277519, -0.013214237056672573, -0.03745875507593155, -0.005712336394935846, -0.014091718010604382, -0.0653933584690094, -0.012755227275192738, -0.05191615968942642, 0.03301962465047836, -0.007998854853212833, 0.007634313777089119, 0.0581359826028347, -0.020629651844501495, 0.01029747910797596, -0.03399842977523804, -0.02375544235110283, 0.023363683372735977, 0.00757070304825902, 0.032212089747190475, 0.01310988049954176, 0.022012876346707344, 0.0021880129352211952, 0.020076606422662735, 0.02070593647658825, 0.025060640648007393, -0.03187769651412964, -0.014354418963193893, 0.027249183505773544, -0.004127028398215771, 0.005326639395207167, -0.03255268186330795], [-0.02773991785943508, 0.004601336549967527, 0.036608822643756866, 0.03310022130608559, 0.007125777658075094, -0.01823977194726467, 0.012468995526432991, 0.02791621722280979, -0.038982126861810684, -0.008691235445439816, 0.0040574101731181145, -0.008646925911307335, -0.0004500517970882356, 0.0026990424375981092, 0.01753333769738674, 0.008161358535289764, 0.061507705599069595, -0.01349604967981577, 0.02828172594308853, 0.03231517970561981, 0.023467272520065308, -0.03779931366443634, -0.03851911053061485, -0.0163912083953619, 0.016482770442962646, 0.005615768954157829, -0.04004526138305664, 0.037335410714149475, 0.02529114857316017, 0.014631150290369987, -0.042369332164525986, 0.0035647249314934015, -0.004896580241620541, 0.029066041111946106, -0.062067147344350815, 0.013775457628071308, 0.012474218383431435, -0.022524602711200714, 0.041104186326265335, 0.0018542513716965914, -0.005212763790041208, 0.018339652568101883, 0.052639566361904144, 0.022771509364247322, 0.029089266434311867, 0.007022724486887455, 0.024557000026106834, 0.009927184320986271], [-0.02158305235207081, 0.018941091373562813, 0.006866211071610451, 0.04041924327611923, 0.003963525872677565, -0.04397234693169594, 0.006791089661419392, 0.03534984961152077, -0.016995318233966827, 0.010152608156204224, 0.0380764938890934, -0.014311159029603004, 0.03919048607349396, 0.046235159039497375, 0.03095703385770321, -0.0009909033542498946, -0.002146079670637846, 0.001681269844993949, 0.007543941494077444, -0.01810651458799839, -0.0382673479616642, -0.00351331802085042, 0.004059533588588238, -0.01415260974317789, -0.03542085736989975, -0.02383027784526348, -0.01538993138819933, 0.005626753903925419, 0.05043872818350792, -0.0019012303091585636, -0.007727198302745819, 0.016803374513983727, 0.03837743028998375, -0.04011751338839531, -0.013674518093466759, 0.004146513994783163, 0.009227070026099682, 0.000626243301667273, 0.02178800478577614, -0.002807510318234563, 0.025246860459446907, -0.007399028167128563, -0.04476800933480263, -0.039608970284461975, -0.0014300033217296004, -0.004184035584330559, -0.037854038178920746, 0.02283535897731781], [0.002223580377176404, -0.010459133423864841, -0.0409727618098259, -0.03311825916171074, 0.025083234533667564, -0.0029869750142097473, 0.005823194049298763, -0.05276333540678024, 0.008937941864132881, 0.026714423671364784, 0.011424241587519646, 0.005662872456014156, -0.01014329306781292, 0.032315514981746674, 0.016997801139950752, 0.00545281870290637, -0.022479580715298653, 0.0083394730463624, -0.024222977459430695, -0.005128782242536545, 0.0034870679955929518, 0.0022798320278525352, 0.013549146242439747, 0.01622878760099411, 0.007877117954194546, 0.011603977531194687, 0.03478143736720085, 0.040402039885520935, -0.01300981268286705, 0.015126300044357777, 0.010261034592986107, 0.026027465239167213, 0.01810271665453911, 0.062311455607414246, -0.04933005943894386, -0.003343220567330718, 0.03404202684760094, 0.014713975600898266, 0.009222188033163548, -0.01998288556933403, 0.007674880791455507, -0.008854800835251808, -0.03515322878956795, 0.01328209601342678, 0.007830141112208366, -0.0055990866385400295, 0.02775692008435726, -0.05148611590266228], [0.023158809170126915, -0.027879662811756134, 0.03483083099126816, -0.0903661698102951, 0.022444285452365875, -0.014352623373270035, -0.004108538385480642, 0.009959145449101925, 0.07127214223146439, 0.0021946104243397713, -0.010130226612091064, 0.039601877331733704, -0.019663941115140915, 0.007116705644875765, 0.022115856409072876, -0.0064574615098536015, 0.01123479288071394, -0.028673792257905006, 0.005722760688513517, -0.004628963768482208, -0.014585801400244236, -0.006412094458937645, 0.1172417476773262, -0.00750008737668395, -0.04441569000482559, -0.05103443190455437, -0.03595099598169327, -0.015111349523067474, -0.020610205829143524, -0.019479086622595787, -0.02614891342818737, 0.04127045348286629, -0.013104603625833988, 0.05231102928519249, -0.08309464156627655, 0.06287194043397903, 0.011014487594366074, 0.030196061357855797, 0.030962631106376648, -0.03787713870406151, -0.017140500247478485, -0.013607565313577652, -0.09022382646799088, -0.015543898567557335, -0.0324648953974247, 0.08511535823345184, -0.02579588070511818, -0.021587101742625237], [0.013722948729991913, 0.02876395359635353, 0.010928944684565067, -0.04963788390159607, -0.01232187356799841, -0.002371708396822214, -0.0028309752233326435, -0.006508119869977236, 0.057768553495407104, 0.0059700049459934235, 0.024348407983779907, -0.007722171489149332, 0.023863187059760094, -0.03906773030757904, -0.005751177202910185, -0.0009699854417704046, 0.038819193840026855, 0.006364856846630573, 0.01307383831590414, 0.009522022679448128, -0.06143602356314659, 0.006726222112774849, 0.020281460136175156, -0.03800320252776146, 0.027075696736574173, -0.02473057061433792, -0.0023402837105095387, -0.01052945014089346, 0.06160053610801697, 0.011112051084637642, 0.005914362147450447, 0.03795715793967247, 0.016758093610405922, -0.00747686717659235, 0.03214793652296066, 0.009198765270411968, -0.00933668203651905, -0.04067631810903549, 0.024662842974066734, 0.011762518435716629, 0.014026956632733345, -0.027947166934609413, -0.04283517226576805, -0.05553550273180008, 0.008831334300339222, -0.03135859593749046, 0.04247022047638893, -0.008984305895864964], [-0.0195054579526186, 0.04029473289847374, 0.011031071655452251, 0.027052579447627068, -0.054352544248104095, -0.002152214525267482, 0.008359719067811966, -0.015878230333328247, 0.0040506827645003796, -0.01843436434864998, 0.008750488050282001, -0.005255409050732851, 0.009842312894761562, -0.015790360048413277, -0.039213165640830994, 0.012540698982775211, -0.016436632722616196, 0.0002903988934122026, 0.009570391848683357, 0.0025100361090153456, 0.019292857497930527, 0.01013170275837183, 0.02878018096089363, 0.0011548304464668036, -0.012539439834654331, 0.0005640821764245629, -0.026419537141919136, 0.015307443216443062, 0.06895814836025238, 0.06016376242041588, 0.06142660975456238, -0.04255783557891846, -0.05792371928691864, 0.02474229596555233, 0.010170584544539452, 0.05052032694220543, -0.006167200859636068, 0.001931757782585919, -0.027728624641895294, -0.008698084391653538, 0.016740769147872925, -0.018082719296216965, 0.029300572350621223, 0.014326745644211769, 0.014704328961670399, -0.023592019453644753, -0.04133671522140503, -0.01786286011338234], [0.026576556265354156, 0.00016982783563435078, -0.03884393349289894, -0.00010375733836553991, -0.005746692884713411, -0.020759427919983864, 0.0015471315709874034, -0.02225726842880249, -0.006112870294600725, -0.013460521586239338, -0.01074419915676117, -0.016506696119904518, 0.021708006039261818, -0.021347569301724434, 0.020249860361218452, 0.0011276595760136843, -0.023719707503914833, 0.019228089600801468, 0.006060413084924221, -0.0037446417845785618, -0.06073205918073654, -0.036232221871614456, 0.005841980222612619, 0.0019712108187377453, 0.025624923408031464, -0.0032738998997956514, 0.011189940385520458, 0.03350776433944702, 0.013060634955763817, -0.02769959159195423, 0.046745605766773224, 0.01524073351174593, -0.0019170517334714532, 0.05877595394849777, -0.0007182804984040558, -0.017360618337988853, 0.0058293151669204235, 0.03793153539299965, -0.0038104369305074215, -0.0007562742684967816, 0.005463696550577879, -0.03519093990325928, -0.02284449152648449, 0.03166387230157852, 0.008924702182412148, 0.032918814569711685, -0.012032303027808666, 0.029380111023783684], [0.02430008165538311, 0.007684424519538879, 0.004074165131896734, -0.0035825571976602077, -0.008128754794597626, -0.009693753905594349, 0.007027675397694111, 0.009431370534002781, -0.0003294010821264237, 0.01852329634130001, 0.0427527017891407, 0.0010567368008196354, -0.00144189374987036, -0.03983630985021591, 0.030605237931013107, 0.012813206762075424, 0.018084140494465828, 0.010844795033335686, 0.023391861468553543, 0.014589650556445122, 0.025483397766947746, 0.01819535903632641, -0.0010502886725589633, 0.04866069182753563, -0.019126616418361664, 0.01098651997745037, 0.054747700691223145, -0.01842557080090046, -0.035260990262031555, 0.03447619453072548, 0.03926980495452881, -0.018997060135006905, 0.008677436970174313, 0.01278847549110651, -0.02966027893126011, 0.004013743717223406, 0.02831128239631653, 0.03299446403980255, 0.015048477798700333, 0.0036867675371468067, 0.000396091490983963, 0.0019144712714478374, -0.0325189009308815, -0.006619215942919254, 0.028555257245898247, 0.019835663959383965, 0.019508028402924538, -0.02199222333729267], [-0.06013952195644379, -0.016593731939792633, 0.06000172346830368, -0.015029750764369965, 0.041394300758838654, -0.04960464686155319, -0.016997624188661575, -0.048549480736255646, 0.010783917270600796, -0.008301974274218082, -0.0034738897811621428, 0.018288254737854004, 0.026278575882315636, 0.009575255215168, 0.002710307016968727, -0.002472338965162635, -0.04474809020757675, 0.014385020360350609, 0.0252122450619936, -0.01740683801472187, 0.02229234017431736, -0.013694851659238338, 0.09202616661787033, 0.017270736396312714, -0.06507351249456406, -0.015223897993564606, 0.022223835811018944, -0.010515675880014896, 0.008268913254141808, 0.01848534680902958, 0.031236687675118446, -0.04332619160413742, -0.02695920132100582, 0.019271207973361015, -0.021528612822294235, -0.02682172879576683, 0.02841041423380375, -0.032924119383096695, 0.017836730927228928, 0.07005495578050613, -0.003884892910718918, -0.02584511786699295, 0.004317011218518019, 0.008102796971797943, 0.01970348134636879, 0.03145063668489456, -0.003932232037186623, -0.0024268487468361855], [-0.04390760138630867, -0.002543396083638072, -0.0357389934360981, 0.026112332940101624, -0.04595193639397621, 0.011039800941944122, 0.003811616450548172, -0.007188193034380674, -0.022505545988678932, -0.021978192031383514, -0.034255802631378174, -0.01124587282538414, 0.018730508163571358, 0.0003305156424175948, 0.02086690068244934, 0.011284401640295982, 0.07066111266613007, -0.009642903693020344, -0.049070991575717926, -0.00519138015806675, 0.003561907447874546, 0.007840639911592007, 0.006982069928199053, 0.06484285742044449, 0.04875468462705612, -0.001721701817587018, 0.03444109112024307, 0.06005598232150078, -0.002318458864465356, -0.004529326688498259, -0.005304764956235886, -0.020807160064578056, -0.04288239777088165, -0.013355908915400505, -0.05341280251741409, 0.02126222848892212, -0.06616521626710892, 0.03133400157094002, -0.068778395652771, 0.012829805724322796, -0.005585480015724897, 0.00973488949239254, -0.027005067095160484, -0.02194899134337902, 0.015605845488607883, 0.026513829827308655, -0.08629598468542099, 0.04619481414556503], [0.0678500384092331, 0.03730767220258713, -0.06518685072660446, -0.0625075176358223, -0.03566720709204674, 0.03598343953490257, -0.039430540055036545, 0.02260502800345421, 0.023678209632635117, 0.0316137857735157, 0.020522980019450188, -0.012961388565599918, 0.024464881047606468, -0.02974446676671505, 0.045393913984298706, -0.015347114764153957, 0.021610578522086143, -0.011865977197885513, -0.08024388551712036, -0.01736529730260372, 0.03354252129793167, 0.027997273951768875, -0.04821806773543358, 0.0007452144054695964, 0.0008099973783828318, -0.01266542449593544, -0.028778385370969772, 0.02946249395608902, 0.040369052439928055, 0.010847294703125954, -0.031428173184394836, -0.02477274090051651, 0.013757536187767982, -0.03234206885099411, 0.05101306363940239, 0.002149567473679781, -0.07606707513332367, 0.02006434090435505, -0.011158447712659836, -0.03115767240524292, 0.031046133488416672, 0.04535963013768196, -0.025106076151132584, 0.059975266456604004, -0.03292233869433403, -0.023242348805069923, -0.03129308298230171, 0.012798869982361794], [-0.010387085378170013, -0.004729678388684988, -0.024783514440059662, 0.01680693030357361, -0.004625997971743345, 0.021289031952619553, -0.01770961284637451, -0.02731282450258732, -0.0015504691982641816, -0.011576035991311073, 0.06381863355636597, -0.015503418631851673, -0.017655180767178535, 0.03343705087900162, -0.008368044160306454, -0.0034687817096710205, 0.03845689445734024, -0.024409322068095207, 0.010937018319964409, 0.0078085046261549, -0.0451025664806366, -0.0037318789400160313, -0.05811049044132233, -0.0029054356273263693, -0.012705261819064617, -0.01947139948606491, 0.0029554865323007107, -0.006761791650205851, 0.0011269596870988607, -0.0033823729027062654, 0.00580226257443428, -0.026935460045933723, -0.018712753430008888, 0.005489799194037914, -0.06379473954439163, 0.04060196876525879, 0.0039893342182040215, 0.031580936163663864, 0.0017940388061106205, -0.020348116755485535, 0.060952093452215195, 0.030262522399425507, -0.012712652795016766, 0.029285049065947533, 0.027463536709547043, -0.010164904408156872, 0.004693328868597746, 0.0009657797054387629], [0.03665667027235031, -0.005163105670362711, 0.04296259582042694, -0.10153334587812424, 0.02192353457212448, -0.03047635219991207, -0.008546125143766403, -0.00258826557546854, 0.026161057874560356, 0.008922739885747433, -0.015126524493098259, 0.010640541091561317, -0.0288784671574831, 0.03881802037358284, 0.06188048794865608, -0.00242949603125453, -0.030139120295643806, -0.025322772562503815, -0.025113319978117943, -0.023866090923547745, 0.017671840265393257, 0.046356622129678726, 0.02222982794046402, -0.012634753249585629, -0.0012402433203533292, -0.022851962596178055, 0.028405070304870605, -0.04525573179125786, 0.045273490250110626, 0.016940779983997345, 0.012444589287042618, -0.01816062070429325, 0.08171170949935913, -0.006713355425745249, -0.003978574648499489, -0.010333649814128876, -0.05288102105259895, 0.036983199417591095, 0.031436432152986526, -0.10938342660665512, -0.012683609500527382, -0.02012532763183117, -0.04057397320866585, -0.03302741423249245, -0.034370068460702896, -0.002245370764285326, -0.05805683881044388, 0.014313309453427792], [-0.047506727278232574, -0.014378286898136139, -0.029024671763181686, -0.037109266966581345, 0.052746761590242386, 0.006598647218197584, -0.011703364551067352, -0.05657451972365379, -0.0028526184614747763, 0.011947055347263813, 0.01757904142141342, 0.004334041848778725, 0.025780262425541878, 0.11088398098945618, 0.03652753308415413, -0.00013757683336734772, 0.02053537778556347, 0.01934470236301422, -0.015869485214352608, 0.010456041432917118, -0.006072623655200005, -0.038955435156822205, -0.06136832386255264, -0.047219425439834595, -0.014914869330823421, 0.05865295231342316, -0.0501699298620224, -0.012875204905867577, -0.008087912574410439, 0.02555837482213974, -0.015586457215249538, 0.005372476764023304, -0.057969626039266586, -0.014233994297683239, 0.09061530232429504, 0.032399531453847885, 0.0015199012123048306, 0.03997114300727844, -0.05443086475133896, -0.009455754421651363, 0.01978292129933834, 0.017275718972086906, -0.021906116977334023, -0.026900742202997208, -0.01844259351491928, -0.08970008045434952, 0.012521524913609028, -0.023052548989653587], [-0.038351479917764664, 0.006690314970910549, 0.022769227623939514, -0.007939351722598076, 0.016360295936465263, 0.0013976722257211804, -0.004840238951146603, -0.06470879167318344, -0.007774185389280319, -0.013789413496851921, 0.013738371431827545, -0.017658548429608345, -0.019976528361439705, -0.0075569432228803635, 0.03279617428779602, -0.0040591126307845116, 0.034436363726854324, -0.0399123840034008, -0.0170424934476614, 0.0014665387570858002, -0.029927486553788185, -0.0017129412153735757, -0.025185417383909225, -0.09110941737890244, 0.020193370059132576, 0.01733097806572914, -0.04035213217139244, 0.07207418233156204, 0.044294651597738266, 0.016088059172034264, -0.06869600713253021, -0.009039517492055893, 0.05527530983090401, 0.0044527905993163586, -0.04380769655108452, -0.011094667948782444, 3.2158117392100394e-05, -0.005519786383956671, -0.008986306376755238, 0.055917561054229736, 0.03242967650294304, -0.018366165459156036, 0.04390943795442581, 0.01820296049118042, -0.0052375104278326035, -0.0061140600591897964, -0.007670711260288954, 0.020199421793222427], [3.409485280564069e-40, 1.232862388912974e-40, 1.3915594399977596e-40, -2.2037380169357803e-40, 1.9921699747920194e-40, 2.7402391469871798e-40, -1.9047569765874373e-40, 1.5642975016950798e-40, -6.238020243788356e-41, 1.5291809621790999e-40, 5.531135233459702e-40, -3.6230571795118145e-41, 1.642461930035118e-41, 2.664639094836856e-40, -1.6236705176285223e-40, 1.609307208369193e-40, 1.891290498345276e-40, 7.412868876278282e-42, -5.045751789828714e-38, -3.996395320272625e-39, -7.624324814544897e-41, -2.156920635242688e-40, 1.5790531745244201e-40, 4.0201851643014677e-41, -3.302538181766799e-40, -8.429370782299505e-41, -9.80068145948777e-41, -2.8794020974792774e-40, 1.978086925225555e-40, 8.060268766796348e-41, -7.226636310369514e-41, 1.7190569040951126e-40, -2.3249082951459473e-40, -3.8813164864868783e-41, -8.644470096573364e-41, 2.9785579768149014e-40, -4.938736307666385e-41, 1.4722321925889393e-40, -2.577520369309782e-40, 1.6589552129602212e-40, 3.3804083374293292e-40, -2.1438465205705376e-40, 1.5929680682751655e-40, -1.2720847329294257e-40, 9.78989146131247e-41, -1.0673690402762132e-40, 5.221518337767133e-41, -2.6240715042946524e-40], [0.023320358246564865, -0.002841264707967639, 0.06298469752073288, -0.05904137343168259, 0.023178191855549812, 0.0047209495678544044, 0.027604157105088234, 0.03464161232113838, -0.015246786177158356, -0.025489039719104767, 0.040400274097919464, 0.009594387374818325, 0.03370151296257973, 0.0019450313411653042, -0.025987619534134865, 0.002668915316462517, -0.046278804540634155, 0.0404931865632534, 0.0018517031567171216, 0.008901291526854038, -0.08327966928482056, -0.005004242993891239, 0.03722274675965309, -0.036453790962696075, -0.0594576857984066, -0.05865924432873726, -0.010819785296916962, -0.03613266721367836, -0.10971449315547943, -0.022975532338023186, 0.008574020117521286, 0.08038552850484848, 0.013094435445964336, -0.016113780438899994, -0.026950854808092117, -0.08164247125387192, 0.031133705750107765, 0.0019939423073083162, 0.05099781975150108, -0.028062421828508377, -0.020956475287675858, -0.016467135399580002, -0.012452811934053898, -0.03346492350101471, 0.010361049324274063, -0.006787286140024662, 0.016920538619160652, -0.03344845026731491], [-0.034641385078430176, 0.0086190365254879, -0.06533674150705338, 0.025139840319752693, 0.0378992035984993, -0.01729872263967991, 0.021981006488204002, 0.023149993270635605, 0.014373602345585823, -0.03038710355758667, 0.003683575429022312, 0.014810610562562943, -0.04808758571743965, -0.005792581010609865, -0.013387272134423256, -0.005679822061210871, 0.008971700444817543, -0.0016358480788767338, -0.03565192222595215, 0.010253156535327435, -0.03161174803972244, 0.013441712595522404, -0.008791022002696991, -0.02068135514855385, -0.001974659040570259, -0.014730935916304588, -0.028934022411704063, 0.017797280102968216, 0.029473109170794487, 0.050319019705057144, -0.025009822100400925, 0.034016311168670654, -0.034811947494745255, 0.002350296825170517, -0.047835156321525574, -0.01082039438188076, 0.01056970376521349, 0.018661517649888992, -0.02015833556652069, -0.005787731148302555, 0.01727192848920822, -0.056187424808740616, -0.0017446018755435944, 0.0020926962606608868, 0.001723154098726809, 0.02973458729684353, 0.020196497440338135, 0.031161678954958916], [-0.07701879739761353, -0.03334487974643707, -0.02661486156284809, 0.012397843413054943, -0.04051470756530762, 0.06564146280288696, 0.027173172682523727, 0.019407257437705994, -0.026241960003972054, -0.021418115124106407, 0.029231375083327293, -0.014099502936005592, 0.042099516838788986, 0.028523966670036316, -0.008934869430959225, -0.00439915107563138, -0.04389173910021782, 0.03817172348499298, 0.028783686459064484, 0.03562508523464203, -0.060607414692640305, -0.03650825470685959, -0.024101488292217255, -0.015868255868554115, -0.043459635227918625, -0.010163016617298126, 0.012510157190263271, -0.015703197568655014, 0.027916522696614265, 0.05748577415943146, 0.013666922226548195, 0.02071254327893257, -0.018910175189375877, -0.032123863697052, 0.04480407014489174, -0.07655557990074158, -0.07537981867790222, -0.00893561914563179, 4.012857607449405e-05, -0.025936175137758255, -0.014891925267875195, 0.03472260385751724, 0.00965204369276762, -0.01678699627518654, -0.02048114314675331, -0.013872003182768822, -0.023648586124181747, -0.03255274519324303], [-0.0034839599393308163, -0.031549375504255295, 0.06876366585493088, 0.006660659797489643, 0.00259278598241508, 0.06936706602573395, 0.04422883689403534, 0.012044524773955345, -0.01750744879245758, 0.000893085147254169, 0.008666486479341984, 0.004381148144602776, 0.07819416373968124, -0.012057746760547161, 0.050672437995672226, 0.014146869070827961, -0.033941179513931274, 0.05543329194188118, 0.011045937426388264, 0.009098580107092857, -0.06614384800195694, -0.014132128097116947, -0.02260410040616989, -0.006296111736446619, 0.004560415167361498, 0.0023188127670437098, -0.026866232976317406, -0.0019580814987421036, 0.029693862423300743, 0.04070166125893593, 0.024260565638542175, 0.015825707465410233, -1.527035237813834e-05, -0.1342717707157135, 0.022122524678707123, -0.038509782403707504, -0.039571527391672134, 0.06774076074361801, 0.012614980340003967, -0.008682950399816036, -0.044338349252939224, -0.019211284816265106, 0.05159098654985428, -0.053363729268312454, 0.017064101994037628, -0.005326760932803154, -0.0036323508247733116, -0.004725400824099779], [-0.04484934359788895, 0.020113298669457436, -0.04140642285346985, -0.052160896360874176, 0.04886288195848465, -0.03607882559299469, -0.03450983017683029, 0.04797166958451271, 0.0017998921684920788, 0.004259438719600439, 0.015365193597972393, -0.027958381921052933, 0.005036508664488792, 0.02056647092103958, 0.01748688891530037, -0.00462718028575182, 0.03935752809047699, -0.03200000524520874, -0.019950415939092636, -0.028123602271080017, 0.047611236572265625, 0.04422759637236595, -0.0826278105378151, 0.011124754324555397, 0.010335204191505909, -0.010209953412413597, -0.014107289724051952, 0.029158562421798706, 0.001768465037457645, -0.022994330152869225, 0.01827101968228817, -0.00946818944066763, 0.0037888656370341778, 0.09581629931926727, -0.03365684673190117, -0.020760267972946167, 0.007899192161858082, -0.05226382613182068, 0.0018390084151178598, 0.0298279020935297, 0.0423675999045372, 0.006446275860071182, -0.04495958238840103, -0.011804589070379734, 0.027168547734618187, 0.04709625244140625, -0.004333574790507555, 0.02339460887014866], [0.05741927772760391, -0.071896493434906, -0.005711437668651342, -0.031093444675207138, -0.03451114892959595, 0.06244875118136406, 0.0032022802624851465, 0.034270018339157104, -0.0037002989556640387, -0.003604802070185542, -0.006901868619024754, 0.01802547462284565, 0.023317938670516014, 0.01742091402411461, -0.005376224871724844, -0.006108857691287994, 0.014230849221348763, 0.005550010595470667, -0.06435748189687729, -0.01057172380387783, -0.015349075198173523, -0.023793822154402733, 0.03882943093776703, -0.05941971018910408, 0.04600680619478226, -0.0025447558145970106, -0.021642377600073814, -0.06346677243709564, 0.009595048613846302, 0.00032354428549297154, -0.03803236782550812, 0.0036054220981895924, -0.00654008099809289, 0.006420497316867113, -0.06437190622091293, 0.029858043417334557, 0.007413927000015974, -0.07512427121400833, -0.02565043792128563, 0.011075211688876152, 0.009425604715943336, 0.0355965718626976, 0.02570672333240509, 0.011636404320597649, -0.004749970976263285, -0.03533480688929558, -0.06032653525471687, -0.013439567759633064], [0.04663660749793053, -0.025143001228570938, -0.0019921502098441124, 0.025333840399980545, 0.014922738075256348, 0.021021243184804916, 0.027657728642225266, -0.03115631267428398, 0.039793722331523895, 0.03392956033349037, -0.032137997448444366, 0.004158169496804476, -0.052748095244169235, 0.02292010560631752, -0.0278577022254467, -0.0010043371003121138, 0.05274362862110138, -0.03958287090063095, -0.005862262565642595, -0.026500023901462555, -0.05286908522248268, 0.03143487870693207, -0.0024156870786100626, -0.031516458839178085, -0.0418078787624836, -0.032035816460847855, -0.016536271199584007, -0.032245151698589325, -0.023245956748723984, 0.02560066618025303, -0.0329422801733017, 0.021381985396146774, 0.03320344164967537, -0.03931530565023422, 0.005188990384340286, 0.014517445117235184, 0.015550174750387669, 0.004360680468380451, 0.036278821527957916, -0.032302454113960266, -0.03288603946566582, -0.014260615222156048, -0.01251473743468523, -0.04169519618153572, -0.020930306985974312, 0.02856389433145523, -0.07382386177778244, 0.012641890905797482], [0.01440848596394062, -0.05275852605700493, -0.01321308221668005, -0.03881220147013664, 0.01767069846391678, 0.00490940036252141, 0.007336470298469067, 0.02002554014325142, 0.029100380837917328, -0.013672084547579288, 0.006732176057994366, -0.0032121799886226654, -0.014013976790010929, 0.03701521083712578, -0.015056668780744076, 0.009437649510800838, -0.029379382729530334, 0.06395662575960159, -0.06829118728637695, 0.008054542355239391, -0.10631018131971359, -0.016958989202976227, -0.013691430911421776, -0.042307011783123016, 0.005059855990111828, -0.015227073803544044, -0.02948899194598198, -0.03153729438781738, 0.027380449697375298, 0.05243736505508423, -0.023087436333298683, 0.051409363746643066, -0.05714491382241249, -0.006892000325024128, -0.08132273703813553, 0.005506004206836224, -0.019854402169585228, -0.0005002270918339491, 0.010745282284915447, 0.07299814373254776, -0.0021708616986870766, 0.01425647921860218, -0.040697768330574036, 0.012906741350889206, 0.03568072244524956, 0.0290109571069479, 0.07432066649198532, 0.00029835960594937205], [0.024358239024877548, -0.0032641938887536526, 0.02713943086564541, 0.034213267266750336, 0.004829618148505688, -0.05052120238542557, -0.0037688924930989742, 0.03595755994319916, -0.0024745541159063578, -0.00765312509611249, -0.09484433382749557, -0.013684367761015892, 0.03831370919942856, -0.02231205627322197, 0.021459417417645454, -0.0031916385050863028, 0.028664324432611465, -0.006508206948637962, 0.019338659942150116, -0.009099125862121582, 0.08463196456432343, 0.02705991640686989, -0.00990968570113182, 0.007782299071550369, 0.04838871210813522, -0.004516982473433018, -0.03575547784566879, -0.0019187198486179113, 0.003454500576481223, -0.03850569576025009, -0.04408365488052368, -0.0015212903963401914, -0.06877445429563522, 0.041647057980298996, 0.031900323927402496, 0.012273670174181461, 0.014116582460701466, -0.0051263910718262196, -0.0059242709539830685, 0.006463235709816217, 0.020918933674693108, -0.010192632675170898, 0.0005531373899430037, -0.025555793195962906, -0.03194238618016243, 0.04141577333211899, -0.053763289004564285, 0.12048228830099106], [0.01262896042317152, -0.006246600765734911, 0.021921370178461075, -0.0567670576274395, 0.01773076318204403, 0.01637551560997963, 0.011856263503432274, -0.001688946969807148, 0.03987863287329674, 0.021183038130402565, -0.04789511114358902, -0.0028218303341418505, -0.01729433238506317, 0.0033868090249598026, 0.005018929950892925, -0.0012633182341232896, -0.03883114084601402, 0.040356677025556564, 0.0020442036911845207, -0.009704887866973877, -0.017029475420713425, 0.0030266663525253534, 0.0024047743063420057, -0.03469182923436165, 0.013333548791706562, -0.05525335296988487, -0.0145717179402709, -0.009321246296167374, 0.025016723200678825, 0.013359189964830875, -0.0007543559768237174, 0.05516009032726288, 0.08254633098840714, 0.03143996000289917, -0.07148751616477966, 0.005362560506910086, 0.03257237374782562, -0.02786913327872753, 0.0015094979899004102, -0.0050613293424248695, -0.03428676724433899, -0.01607309840619564, -0.03213420882821083, -0.007676833309233189, -0.035533931106328964, 0.0024118542205542326, 0.011188367381691933, -0.013333001174032688], [0.009501251392066479, 0.021107859909534454, 0.01040735188871622, -0.004984159022569656, -0.006060159765183926, -0.05416575446724892, -0.004835343454033136, 0.026202360168099403, 0.009639784693717957, -0.003967993892729282, 0.023409396409988403, 0.010230411775410175, -0.012747162953019142, -0.03414865583181381, -0.015092884190380573, -0.005656861234456301, -0.018217217177152634, 0.015028025954961777, 0.009466414339840412, -0.02703162096440792, 0.025703663006424904, 0.07018964737653732, 0.0071150572039186954, -0.04267537593841553, 0.008685632608830929, -0.03438523784279823, 0.019489381462335587, -0.02397330291569233, 0.024029357358813286, 0.02512565441429615, 0.015665890648961067, 0.014661043882369995, -0.006166019942611456, -0.004337607882916927, 0.07961878925561905, 0.029028194025158882, -0.006723690312355757, 0.02305382676422596, 0.0006253400351852179, 0.0009054496767930686, 0.008681386709213257, -0.013608395121991634, 0.05766367167234421, -0.007693057879805565, -0.026229651644825935, -0.013858111575245857, -0.010255164466798306, -0.024864234030246735], [-0.04119723290205002, 0.02175326459109783, -0.060863155871629715, 0.029284179210662842, -0.03328592702746391, 0.10439351946115494, 0.02963649481534958, 0.040739789605140686, -0.013345063664019108, -0.01289893127977848, -0.025281589478254318, 0.00040257704677060246, -0.022277390584349632, -0.01770879328250885, 0.025207240134477615, 0.01100974902510643, 0.020203346386551857, -0.01730097085237503, 0.007404631469398737, 0.02400963567197323, 0.016177499666810036, 0.0036376994103193283, 0.034327857196331024, 0.05987575277686119, 0.08009915798902512, 0.020123178139328957, -0.016484105959534645, 0.014226209372282028, 0.01664687879383564, -0.0001956263731699437, 0.0025969119742512703, 0.0337984524667263, -0.0015433232765644789, 0.045165203511714935, -0.024573713541030884, 0.040491364896297455, -0.0169577244669199, 0.02939538098871708, -0.0630970448255539, 6.252841558307409e-05, 0.0022592332679778337, -0.02513657510280609, 0.002203635172918439, 0.004648050293326378, 0.028314383700489998, -0.047413650900125504, 0.04025840759277344, 0.014682416804134846], [-0.0112575963139534, 0.014633100479841232, -0.02365957573056221, 0.003587787039577961, 0.026521768420934677, 0.061956167221069336, 0.019395606592297554, -0.0069631910882890224, -0.012635217048227787, -0.007617103401571512, -0.03953791782259941, -0.0023997474927455187, 0.00035514988121576607, 0.013908080756664276, -0.005525700747966766, 0.0083867646753788, 0.028429092839360237, -0.03328732028603554, 0.0317901074886322, -0.0062023950740695, 0.02817906253039837, 0.0035630925558507442, 0.008318902924656868, -0.021808648481965065, 0.023966994136571884, -0.034204039722681046, -0.018246615305542946, 0.0381661020219326, 0.024904821068048477, 0.0011881779646500945, -0.013318382203578949, 0.017812874168157578, 0.009726203978061676, -0.03067854419350624, -0.02941366285085678, -0.0025609734002500772, 0.061398930847644806, -0.038862645626068115, -0.020133469253778458, 0.0006449826760217547, -0.033440545201301575, -0.01616469956934452, -0.013662813231348991, -0.04059771075844765, 0.007929734885692596, -0.013001685030758381, 2.498192770872265e-05, -0.008149813860654831], [-0.016709616407752037, 0.015068113803863525, -0.01755175180733204, -0.029506491497159004, -0.019665835425257683, 0.008655664511024952, -0.023398783057928085, 0.07242097705602646, -0.01584763266146183, 0.023804597556591034, -0.03631800785660744, -0.0009075584239326417, -0.025417117401957512, -0.020143060013651848, 0.024886157363653183, -0.0024036078248173, 0.010502245277166367, -0.005031609907746315, 0.05523333698511124, -0.02985428087413311, 0.005694122053682804, -0.015567122027277946, 0.009829334914684296, 0.017991527915000916, 0.0010844487696886063, 0.021699832752346992, 0.0389036163687706, 0.012957599014043808, -0.05025891214609146, 0.002328885719180107, -0.031263116747140884, -0.0007667217869311571, -0.020768294110894203, -0.029420869424939156, -0.029430681839585304, -0.09076821804046631, 0.020302608609199524, 0.0010540449293330312, -0.005453763995319605, 0.028156807646155357, -0.02204935811460018, 0.031142648309469223, 0.011684918776154518, 0.010435298085212708, 0.005166533403098583, 0.00777270644903183, 0.03238576650619507, 5.7606594054959714e-05], [6.587097704236311e-40, -5.661105666025828e-41, -6.741086392480965e-41, -8.99997951697257e-41, -2.7547285731082984e-40, -9.405094903008875e-41, 2.6044112868401753e-40, -1.6323025161687632e-40, -1.6383701385192896e-40, 1.2993960399991164e-40, 2.2180452742565367e-40, -9.930862086823546e-41, -3.47131056881008e-40, -1.0895656079511183e-40, 4.3078717390273526e-41, -1.0696531567730626e-40, -1.3605907439361811e-40, 7.257324746738228e-42, -6.455880116036935e-40, -8.869378500097497e-41, 4.0131786719798436e-41, 9.304481673270353e-41, -4.3480833997596176e-39, 3.0050425177906405e-40, 1.998531869820054e-41, 3.7287150837219057e-41, 7.027231538896093e-41, 3.01772426889278e-40, 2.1256016145650285e-40, 4.1192569657292323e-41, -8.516489507826578e-40, -1.5607382035956948e-40, 1.8899872907734538e-40, -2.468247115061733e-41, 5.4596760182714577e-39, -1.529923650365192e-40, -2.5377515188922437e-42, -2.5719432014217693e-40, -2.488145553255145e-40, 2.9628213950605337e-40, 2.180672644212994e-40, -1.4630536876476118e-40, 5.458758167777325e-41, 8.67193554647413e-41, -7.856660099929952e-41, 1.7897103726663699e-40, -8.745363586004751e-41, 2.695537725975218e-40], [-2.311960297335586e-40, -1.0407023305001119e-40, 4.204175652667316e-41, 2.273564719413086e-40, -1.9021225354745067e-40, 1.3511459922866319e-40, -1.8312868981028872e-40, -1.619760894913056e-40, -2.5067267708920923e-40, -1.904462703909929e-40, -1.794909189969015e-40, -1.1531985712161082e-40, 6.386277621313921e-41, -2.8081460705683604e-40, -8.496969420218534e-40, 3.3246506715338447e-40, -8.246361202858683e-41, 2.2860082497762903e-40, -2.285377665467344e-40, 8.119711847653007e-40, -1.0529216531090243e-40, -1.2410319589599877e-40, -8.926831737134815e-41, 2.055396561502355e-40, -1.0953950095627095e-41, 1.4490266900197203e-40, -7.04853127555383e-41, -3.0882095816483184e-40, 2.5386483499094116e-40, 3.229124155220822e-40, 9.06205703894216e-41, 2.05567682119522e-40, -2.389592232259181e-40, 1.6331713212166446e-40, 1.6199010247594885e-41, 2.936981451378384e-40, -9.883918588268665e-41, -2.4095607353758094e-40, -1.5214037557020971e-40, 1.1936960968350954e-40, -1.7975296180973023e-40, -1.2056351597511429e-40, 8.494671290737041e-41, 5.618366062863922e-41, -2.051823250418327e-40, 4.700795828424031e-41, -6.780743139021357e-41, 2.4301317968320978e-40], [3.3552550299946987e-40, -1.29768645587264e-40, 2.344795522951645e-39, 1.4522020323398804e-39, 2.939237541905947e-40, 8.909175376484322e-41, 2.797147278921875e-39, 1.4954096691888718e-40, 4.820186457584506e-41, -1.478507207112186e-39, 3.254936072933685e-41, 2.757867481668386e-40, -1.4539452476295004e-40, 3.3530269654364223e-41, 2.3423824869960777e-40, 1.7354661091123562e-40, -2.041495680736253e-40, -6.614055884092992e-39, -1.5758021620871865e-40, -1.2699239306974368e-38, 1.3125962715330562e-41, -2.675886941472109e-25, 1.5264344171890232e-40, 2.9472809950911715e-40, 1.6138754413628918e-41, 1.7129472427906564e-41, 1.618789795077279e-39, -2.6209185827499216e-40, -1.1025738615954455e-39, 1.763968519876723e-40, -3.4713385947793666e-40, -1.9624063954097603e-40, 1.0982060142821451e-39, -7.832953206358511e-19, 1.419529357345683e-40, -1.4621288306611574e-40, 7.716866565128908e-40, -2.550124984332232e-40, 1.3803910912370908e-39, -1.2820199390414886e-40, -1.3038101301617395e-40, 1.7509766614244283e-38, 1.3955251146517988e-40, 8.616261958486505e-40, 1.3001247152005653e-40, 2.2463094642819683e-40, 4.0423845345733014e-39, -1.451324819501213e-41], [-0.014658927917480469, -0.017321858555078506, -0.01851644739508629, 0.04093058407306671, -0.07012013345956802, 0.04975089803338051, 0.0016936289612203836, -0.02182687632739544, -0.032836683094501495, 0.022838912904262543, -0.056359175592660904, -0.0022857151925563812, 0.018030978739261627, 0.02616807073354721, 0.034796230494976044, -0.007493155542761087, 0.058837469667196274, -0.04347630590200424, -0.041178490966558456, -0.02633083239197731, 0.021416818723082542, 0.02733222208917141, 0.013511541299521923, 0.04538578540086746, -0.016001690179109573, 0.009628471918404102, 0.004493671469390392, -0.00024746329290792346, -0.014434954151511192, -0.03129282221198082, -0.0022966729011386633, -0.011426795274019241, -0.08209547400474548, -0.023097455501556396, -0.006975519470870495, 0.04016798734664917, -0.047376640141010284, 0.029650740325450897, -0.04076264053583145, 0.009392233565449715, 0.016888868063688278, 0.0013451256090775132, 0.04721389710903168, 0.006279505789279938, 0.024967219680547714, -0.04885533079504967, -0.008824426680803299, 0.011847675777971745], [-0.012359163723886013, 0.005326610524207354, -0.012219918891787529, -0.005654027685523033, -0.04417187348008156, 0.012722503393888474, 0.0019221879774704576, -0.029136350378394127, -0.05014846846461296, 0.0034401684533804655, -0.0034448904916644096, -0.0017762923380360007, 0.028149215504527092, 0.10355867445468903, -0.03361934423446655, -0.01044921949505806, -0.026331428438425064, -0.004115413408726454, -0.05691942945122719, -0.048034489154815674, -0.03280429542064667, 0.0006525709177367389, 0.011177880689501762, 0.03487292677164078, -0.03803331404924393, -0.013034469448029995, 0.0042868549935519695, 0.016552355140447617, 0.0067755659110844135, -0.010213683359324932, 0.007253037299960852, 0.003620950970798731, -0.00945055577903986, -0.0046725282445549965, 0.01072084903717041, 0.036244947463274, -0.004121339879930019, 0.01509292796254158, -0.009275909513235092, 0.013909406028687954, 0.01107443030923605, 0.024753479287028313, 0.029365340247750282, -0.0009718857472762465, 0.019172783941030502, -0.0015164989745244384, 0.02328633703291416, 0.002740185707807541], [-0.015320837497711182, 0.04084457457065582, -0.10211106389760971, -0.034472767263650894, 0.017123622819781303, 0.019369598478078842, -0.008546863682568073, -0.0375627838075161, -0.023174911737442017, 0.012162089347839355, -0.030849682167172432, 0.0028216331265866756, 0.0063754781149327755, 0.06480161845684052, 0.03226300701498985, -0.00947217084467411, -0.0032228624913841486, -0.030107025057077408, -0.015269133262336254, -0.03184330463409424, -0.017445072531700134, -0.009348715655505657, 0.046047091484069824, 0.04924976825714111, 0.009369708597660065, -0.0073194908909499645, 0.06868692487478256, -0.023393891751766205, 0.012803692370653152, -0.02418929897248745, -0.04041685163974762, -0.018558211624622345, -0.010849015787243843, 0.07342655956745148, 0.013338890857994556, -0.033555518835783005, -0.06314609199762344, 0.033067487180233, -0.021604089066386223, 0.000629730406217277, 0.008837719447910786, -0.01252832356840372, 0.03462658077478409, -0.029836377128958702, 0.001454541110433638, -0.005405981093645096, -0.0031352308578789234, 0.02062918059527874], [0.056686580181121826, -0.02419048547744751, -0.025666434317827225, 0.005081548821181059, -0.007912499830126762, 0.002407840685918927, -0.013196484185755253, -0.004624602850526571, -0.012757256627082825, 0.006388862617313862, -0.008333997800946236, 0.008983529172837734, 0.009998718276619911, 0.01053187157958746, -0.0010434070136398077, -0.0027156418655067682, 0.039205774664878845, 0.009768093936145306, 0.01694430224597454, -0.02064570039510727, 0.016367264091968536, -0.022207459434866905, 0.04036325588822365, -0.029158927500247955, -0.019229434430599213, 0.03507104888558388, 0.02022417075932026, 0.028783263638615608, 0.006205959711223841, 0.00880325399339199, 0.0053958347998559475, -0.009191159158945084, -0.02195274643599987, -0.03877146169543266, 0.011888849548995495, -0.06404358893632889, -0.04964452609419823, 0.019836245104670525, 0.0026421055663377047, 0.04655870795249939, 0.002888039220124483, -0.048798128962516785, 0.025274010375142097, -0.01927780546247959, 0.0015653764130547643, 0.02744392305612564, 0.003595959395170212, -0.040289051830768585], [-0.019387634471058846, 0.045026302337646484, -0.02238430827856064, 0.004559106193482876, 0.0013000768376514316, -0.019059155136346817, 0.004902922548353672, 0.04517332836985588, 0.023200180381536484, 0.0033109146170318127, -0.01632210984826088, 0.006625914014875889, -0.02766326069831848, 0.01595916785299778, -0.028056539595127106, -0.0006403392762877047, 0.01330829318612814, -0.004990757908672094, 0.016595380380749702, 0.033950965851545334, 0.00024270657740999013, 0.012098082341253757, -0.03139202296733856, 0.007192879915237427, -0.002217675792053342, -0.004049567971378565, -0.0004455643938854337, -0.04640793055295944, -0.0003124192589893937, -0.01852921023964882, 0.030410228297114372, 0.0232185497879982, 0.022098468616604805, -0.014688918367028236, 0.024015549570322037, 0.009897459298372269, 0.014570471830666065, 0.005661257542669773, 0.0070890942588448524, -0.004998674150556326, 0.03420428931713104, 0.00013325156760402024, -0.012482184916734695, 0.04693405330181122, -0.01881159096956253, 0.029673032462596893, 0.027736172080039978, 0.008204701356589794], [0.020142657682299614, 0.015644464641809464, -0.010682608932256699, 0.008153621107339859, 0.04050209000706673, -0.006752335466444492, -0.00039084890158846974, -0.04978873208165169, -0.018370361998677254, -0.009016294963657856, 0.002336210571229458, -0.009938009083271027, -0.04143022000789642, 0.03166205435991287, -0.00033963893656618893, -0.006322855595499277, -0.006439543794840574, -0.013285331428050995, 0.027443714439868927, -0.06260941922664642, 0.011421606875956059, -0.05280235409736633, 0.0001161986292572692, 0.007153777871280909, -0.029026111587882042, 0.06269197165966034, 0.02328745648264885, 0.028634918853640556, 0.02147161401808262, -0.05630258098244667, -0.024468133226037025, 0.02847271040081978, -0.023592090234160423, -0.03189098834991455, 0.016597799956798553, 0.008598758839070797, 0.057779233902692795, 0.0352504700422287, -0.00044645348680205643, -0.023601265624165535, 0.05079527571797371, 0.00479792058467865, 0.0638773962855339, -0.02816651575267315, 0.026589419692754745, -0.015167830511927605, 0.011676955968141556, -0.005566273350268602], [0.08144760876893997, 0.025297170504927635, 0.00890595093369484, -0.04551409184932709, 0.01063420157879591, -0.02177591063082218, 0.005004923790693283, 0.0652819350361824, 0.036039162427186966, 0.028127219527959824, -0.008309204131364822, 0.0005944693111814559, 0.03325129672884941, -0.03141943737864494, 0.0040755863301455975, 4.322205495554954e-05, 0.022971533238887787, 0.008575123734772205, 0.003245989093557, -0.024935012683272362, 0.0017184294993057847, 0.046054285019636154, -0.02970941923558712, 0.00022014311980456114, 0.032047029584646225, -0.0026236064732074738, -0.010520289652049541, 0.008667084388434887, 0.013331286609172821, 0.03201643005013466, 0.009691666811704636, 0.018928762525320053, -0.017480317503213882, -0.008192341774702072, -0.048499226570129395, -0.020230960100889206, 0.04074029251933098, 0.03627702221274376, 0.04460819065570831, 0.008458019234240055, -0.04191683605313301, 0.023997433483600616, 0.04173332080245018, -0.04949759319424629, -0.0009123272029682994, 0.05048906058073044, -0.07128908485174179, 0.04329920560121536], [-0.04713299870491028, 0.03644370287656784, 0.029354296624660492, 0.01177426427602768, 0.018947483971714973, 0.03194018825888634, -0.025495970621705055, 0.03127911686897278, -0.01793644391000271, 0.011603319086134434, 0.02375474013388157, -0.009876800701022148, 0.03287480026483536, -0.024061203002929688, -0.043668799102306366, -0.004671148955821991, 0.017671745270490646, -0.027423877269029617, 0.003970809280872345, -0.018689345568418503, -0.01593092456459999, -0.008828588761389256, 0.050414375960826874, -0.02427768148481846, -0.0032206850592046976, 0.014971490949392319, -0.026152953505516052, -0.026152554899454117, 0.0651453509926796, -0.02212420292198658, 0.026335159316658974, -0.021165303885936737, 0.0017836162587627769, -0.004420860204845667, -0.021929675713181496, 0.02667376399040222, 0.039653219282627106, 0.044817786663770676, 0.03152929246425629, -0.006087939254939556, 0.014335732907056808, 0.0018110782839357853, -0.006533840671181679, 0.009791813790798187, 0.005515981465578079, 0.042662933468818665, 0.011264936067163944, 0.011601297184824944], [-0.004886619746685028, -0.0036298392806202173, -0.012415303848683834, 0.004256030078977346, -0.01087928656488657, -0.002119570504873991, 0.011638613417744637, 0.04193677380681038, -0.04272935539484024, 0.005832576658576727, -0.0026833172887563705, -0.010845523327589035, 0.022516515105962753, -0.039268214255571365, -0.003385829506441951, 0.009262867271900177, 0.000525423267390579, 0.005674207583069801, -0.008776741102337837, 0.0046524847857654095, 0.012074480764567852, -0.009906531311571598, -0.06463053822517395, -0.02603967674076557, 0.01996270753443241, 0.016367925330996513, -0.03964053466916084, 0.005123591050505638, 0.02475210838019848, 0.007661471143364906, -0.0313001424074173, -0.000792487058788538, -0.002507728524506092, -0.0033580518793314695, 0.013194954954087734, 0.025222154334187508, 0.007373820524662733, 0.00043249453301541507, -0.003198747057467699, 0.03088429942727089, -0.0325818806886673, 0.01659283973276615, 0.07469525188207626, 0.017988938838243484, 0.038972243666648865, 0.0019870754331350327, 0.06565771251916885, 0.051120683550834656], [-0.023036478087306023, -0.045477356761693954, 0.017011534422636032, 0.0214042067527771, 0.054310739040374756, -0.023005986586213112, 0.005613220389932394, -0.026028113439679146, -0.009147295728325844, 0.023507842794060707, 0.014430052600800991, -0.01838436909019947, 0.007649809587746859, 0.035483889281749725, -0.007753162644803524, 0.0008642909815534949, -0.023904332891106606, -0.00650215707719326, 0.010900256223976612, 0.006504484452307224, -7.119605288608e-05, 0.009543223306536674, -0.02391473390161991, -0.04432680457830429, -0.04295095056295395, 0.012902738526463509, 0.025834567844867706, -0.005847151856869459, -0.0202746894210577, -0.008400332182645798, -0.010648866184055805, -0.03241313248872757, 0.04569429159164429, -0.037409309297800064, -0.018924115225672722, -0.0232562106102705, 0.0006986160296946764, 0.015270779840648174, 0.0216217003762722, 0.027484331279993057, 0.03571042791008949, -0.017031371593475342, -0.04576155170798302, -0.016124112531542778, 0.01911897212266922, 0.048346150666475296, 0.006057984661310911, -0.02394760772585869], [0.006049287039786577, 0.04215811938047409, -0.038327183574438095, 0.007710257079452276, 0.05072927474975586, -0.010636960156261921, 0.0024526745546609163, -0.059422463178634644, 0.0009959656745195389, 0.03522374480962753, 0.005388468969613314, 0.00993371568620205, 0.05361365154385567, 0.028416121378540993, -0.011263437569141388, 0.003503023646771908, 0.03309425339102745, -0.008250732906162739, 0.004219675436615944, 0.008126550354063511, 0.04637400433421135, 0.04979497194290161, 0.04258476197719574, 6.883324385853484e-05, 0.05336657911539078, 0.01428392343223095, -0.016067225486040115, -0.009558144956827164, -0.0023402669467031956, 0.002042972482740879, 0.008849075064063072, 0.02622399851679802, 0.031949471682310104, -0.020162537693977356, -0.01764972321689129, 0.0064861103892326355, 0.04777038097381592, 0.0451769158244133, -0.024649474769830704, -0.002099043456837535, -0.011444250121712685, -0.006430679000914097, -0.0324496366083622, 0.04724046587944031, 0.009031815454363823, 0.027128012850880623, 0.014927607029676437, -0.08017155528068542], [0.03242183104157448, -0.03531854972243309, 0.01707661896944046, -0.11683116853237152, -0.01836937665939331, -0.019023342058062553, 0.0011512315832078457, -0.034414373338222504, 0.04588979482650757, 0.014030319638550282, 0.0007650555926375091, 0.050234269350767136, 0.0008054174249991775, -0.04874826967716217, 0.04765556380152702, -0.005922066047787666, -0.02494693174958229, -0.03176045045256615, 0.03567679971456528, -0.010023157112300396, -0.024223003536462784, -0.0005333813023753464, 0.06983096152544022, -0.0056332992389798164, -0.022025614976882935, -0.03734368085861206, -0.04179108515381813, -0.018330559134483337, -0.027356188744306564, -0.03642755001783371, -0.0028525525704026222, 0.07864906638860703, -0.02857576124370098, 0.0028105599340051413, -0.1195618212223053, 0.09259171038866043, -0.03484061732888222, 0.04310135915875435, 0.03280123323202133, -0.028967080637812614, -0.026728730648756027, -0.030996626242995262, -0.14167648553848267, -0.0761290043592453, -0.04038077965378761, 0.04266118258237839, 0.0389857217669487, -0.004024452995508909], [0.022259635850787163, -0.024247799068689346, 0.026741301640868187, -0.04360450804233551, -0.022830460220575333, -0.04715251177549362, -0.00023623116430826485, -0.02529101073741913, 0.0032684756442904472, -0.005061574280261993, 0.050270941108465195, -0.0043929447419941425, -0.025815267115831375, 0.014832206070423126, -0.00695688184350729, -0.0020148896146565676, -0.006355798803269863, 0.015108351595699787, 0.03079242818057537, -0.00565092358738184, -0.07911482453346252, 0.01118813082575798, -0.006819667294621468, -0.03407237306237221, 0.04574955999851227, 0.009748123586177826, -0.007888030260801315, 0.0015675476752221584, 0.010670190677046776, -0.005567334592342377, 0.015071473084390163, 0.01895834133028984, -0.018748236820101738, 0.02583029493689537, 0.020568465813994408, 0.03573237359523773, -0.004906391259282827, 0.0033090850338339806, 0.007652229629456997, 0.02610769309103489, 0.027042707428336143, 0.002518737455829978, -0.03450683504343033, -0.06028047949075699, 0.021481553092598915, -0.024205606430768967, 0.03880001977086067, -0.0071833268739283085], [-0.025871502235531807, -0.049696363508701324, 0.03568114712834358, 0.05063500255346298, -0.000790279998909682, 0.02783568762242794, 0.006783042103052139, 0.004618852864950895, 0.009016172960400581, -0.025954963639378548, 0.013239151798188686, -0.0015592423733323812, -0.003425335045903921, 0.0005719152977690101, -0.028844336047768593, 0.014039849862456322, -0.024518633261322975, 0.00537848798558116, 0.045298416167497635, 0.017391573637723923, 0.009844216518104076, 0.019442349672317505, 0.0337977409362793, 0.0034630834124982357, -0.003523105289787054, 0.021791603416204453, -0.024265894666314125, 0.010723723098635674, -0.008256642147898674, 0.025991104543209076, 0.01981409452855587, -0.049527354538440704, -0.038110651075839996, -0.03394629433751106, 0.01759885996580124, 0.000371190340956673, -0.02066550962626934, -0.025967566296458244, -0.03237215802073479, -0.009791858494281769, 0.010897768661379814, 0.015539955347776413, 0.05468698590993881, 0.006962238810956478, 0.01845843903720379, -0.028603924438357353, 0.041510410606861115, -0.03571585565805435], [0.022689275443553925, -0.006556396838277578, -0.06160886213183403, 0.03252367675304413, -0.0007616626098752022, 0.013556649908423424, 0.0003666901611723006, -0.014973435550928116, 0.011368962936103344, -0.010098634287714958, 0.005684059578925371, -0.01949775032699108, 0.03018595464527607, -0.007302421610802412, -0.022334203124046326, 0.0006525843637064099, 0.0033042991999536753, 0.01495758444070816, 0.010237762704491615, -0.004418065771460533, -0.05295699089765549, -0.04544677585363388, 0.021974116563796997, 0.01077045127749443, 0.04929376021027565, -0.028104303404688835, 0.023954741656780243, 0.021222883835434914, 0.028995202854275703, -0.029344633221626282, 0.05228206515312195, 0.018819378688931465, -0.0024255849421024323, 0.0032269267830997705, 0.021744638681411743, -0.030731085687875748, 0.014057506807148457, -0.02962745912373066, 0.013084296137094498, -0.0027874375227838755, 0.013095848262310028, -0.04133790731430054, 0.019338497892022133, 0.001745491405017674, 0.00845607090741396, 0.019795699045062065, 0.044102709740400314, 0.01612142287194729], [0.004279713612049818, 0.04775867611169815, -0.018402915447950363, -0.024810396134853363, -0.017759812995791435, 0.06121359020471573, 0.004528823774307966, 0.049446750432252884, -0.014303313568234444, 0.012542313896119595, 0.03564560413360596, -0.004110360983759165, -0.013543722219765186, -0.03686032444238663, 0.003346906043589115, 0.011528423056006432, -0.003375916974619031, 0.005746566224843264, -0.03579224273562431, 0.016280019655823708, 0.0259504783898592, -0.000808854354545474, 0.02207208052277565, 0.06112823635339737, -0.016487281769514084, 0.013932852074503899, 0.033517152070999146, 0.002396239433437586, -0.0352838896214962, 0.03188328444957733, 0.002071536611765623, -0.012586787343025208, -0.01706698164343834, 0.05176559090614319, -0.03241533413529396, 0.036970216780900955, 0.0467163510620594, 0.03323723375797272, 0.01737009733915329, 0.0003393266524653882, -0.00037947617238387465, 0.0050515225157141685, -0.004175879061222076, 0.007625710219144821, 0.029128482565283775, 0.005847158841788769, 0.014667868614196777, 0.0040289112366735935], [-0.013455940410494804, -0.01883179508149624, 0.05804828181862831, 0.04340554401278496, 0.04475503787398338, -0.00144420366268605, -0.009773071855306625, -0.07493265718221664, 0.03698301687836647, 0.0010955696925520897, 0.014389190822839737, 0.004881161730736494, 0.007244509644806385, -0.007598573341965675, -0.02152172103524208, -0.0033420203253626823, -0.013691363856196404, 0.017419202253222466, 0.023732919245958328, 0.010857900604605675, 0.0220185574144125, -0.020430609583854675, 0.038295019418001175, 0.007484643720090389, -0.04289719834923744, 0.018209535628557205, -0.021841859444975853, -0.010232376866042614, -0.008009432815015316, 0.01979346200823784, 0.04366815835237503, -0.02972828596830368, -0.010027296841144562, 0.02582397870719433, -0.024737218394875526, 0.06949588656425476, 0.010858740657567978, 0.0028433864936232567, 0.0040400526486337185, 0.032731276005506516, -0.00633281609043479, -0.02646738477051258, 0.019128546118736267, 0.013257640413939953, 0.025445537641644478, 0.045803070068359375, 0.040760599076747894, -0.03248127922415733], [-0.020669294521212578, 0.017675574868917465, 0.03130606189370155, 0.01944940723478794, -0.0006416385294869542, -0.027930382639169693, 0.02639530412852764, -0.018837440758943558, 0.00032525890856049955, -0.0017135458765551448, -0.02064882218837738, -0.009225331246852875, 0.019147885963320732, 0.02245626412332058, -0.017480164766311646, 0.007820996455848217, 0.0645323097705841, -0.01203695498406887, 0.02987845055758953, 0.017639482393860817, -0.016295982524752617, -0.0077766356989741325, -0.010120265185832977, 0.01278719212859869, -0.008239050395786762, 0.035231269896030426, -0.01864171028137207, -0.012689905241131783, -0.006791990250349045, 0.000523097172845155, -0.035098619759082794, -0.02228335291147232, 0.04596547782421112, 0.03672879561781883, 0.009265527129173279, -0.0001847960229497403, 0.0069004748947918415, -0.03869634494185448, -0.011850842274725437, 0.044345926493406296, -0.020439574494957924, -0.014963207766413689, 0.02677222155034542, -0.02730456180870533, -0.012912453152239323, -0.03188575431704521, 0.004295927006751299, 0.01438872329890728], [0.07652736455202103, -0.006953983101993799, -0.07652990520000458, 0.013093889690935612, -0.023889075964689255, 0.03306735306978226, -0.023288195952773094, 0.010266444645822048, -0.012569926679134369, 0.052405476570129395, 0.00610238965600729, -0.011710849590599537, -0.03329694643616676, -0.059755709022283554, 0.04328030347824097, -0.017064712941646576, -0.00827708002179861, -0.01249571330845356, 0.0005975813837721944, -0.018377823755145073, 0.057876069098711014, 0.04071957617998123, -0.05308908596634865, 0.020486971363425255, 0.07674135267734528, 0.01747581548988819, -0.026222437620162964, 0.006482021417468786, -0.029863959178328514, 0.03067931905388832, -0.01711890660226345, -0.030535878613591194, -0.017730288207530975, -0.017920594662427902, -0.0012134122662246227, 0.02732880972325802, -0.05974118411540985, -0.002791064791381359, -0.015903493389487267, -0.021351972594857216, 0.02501022070646286, 0.05864674597978592, 0.012068506330251694, 0.10452693700790405, -0.02812308445572853, -0.030755240470170975, -0.011987782083451748, -0.012621580623090267], [0.011670376174151897, -0.014980198815464973, -0.043531183153390884, 0.023567380383610725, 0.03328036144375801, 0.017271937802433968, -0.03266854211688042, 0.010637985542416573, -0.03734501078724861, 0.007209135685116053, 0.03786136209964752, -0.018643727526068687, -0.035654157400131226, -0.004931755363941193, 0.02159583941102028, -0.0063473875634372234, -0.0520593635737896, -0.0562368668615818, -0.02345435321331024, -0.02142740972340107, -0.02478751726448536, -0.0005795164033770561, -0.0259542278945446, -0.01853090338408947, -0.026891328394412994, -0.008355900645256042, -0.018307466059923172, -0.007557765115052462, 0.027662498876452446, -0.023592976853251457, 0.024923140183091164, -0.05647548288106918, 0.05291981250047684, 0.0012956771533936262, -0.043647006154060364, -0.0005293205031193793, 0.03505154326558113, -0.0015480765141546726, -0.002894612494856119, -0.005958269815891981, 0.04296531155705452, 0.04612935334444046, -0.05576162785291672, -0.016601236537098885, 0.006443137302994728, 0.04412303492426872, -0.037580568343400955, 0.023846087977290154], [0.04294608533382416, -0.015953317284584045, -0.0220317505300045, 0.003642709692940116, -0.003703797236084938, -0.012714782729744911, 0.011028749868273735, -0.06903531402349472, 0.0021053531672805548, -0.003041204297915101, 0.04230494052171707, 0.028438104316592216, 0.0006992561393417418, -0.02030690386891365, -0.012084605172276497, 0.0034828386269509792, -0.03905092924833298, 0.020374510437250137, -0.008421340957283974, 0.0067858523689210415, -0.014370712451636791, 1.8991457181982696e-05, 0.03895934671163559, -0.016045721247792244, 0.050489045679569244, 0.006705400533974171, 0.0055671026930212975, 0.019358385354280472, -0.03035043552517891, 0.024175113067030907, -0.004906286019831896, -0.0024196894373744726, 0.04696905240416527, 0.022312752902507782, -0.03232157975435257, -0.0014816337497904897, 0.06154361367225647, 0.01053871400654316, 0.018413882702589035, 0.009829966351389885, -0.006374628748744726, -0.0077263182029128075, 0.0012620926136150956, -0.024318264797329903, -0.01951153762638569, 0.01963917352259159, 0.02309711091220379, -0.026400653645396233], [-0.03842651844024658, 0.05825269594788551, -0.023039182648062706, -0.007435549981892109, -0.03515421971678734, -0.037483133375644684, -0.019342243671417236, -0.013666528277099133, -0.03966902568936348, 0.004487926606088877, 0.049389880150556564, 0.005854552611708641, -0.000330067181494087, 0.03735299035906792, -0.015764184296131134, -0.009614462032914162, 0.07590319216251373, -0.04659169912338257, 0.05513431876897812, 0.003556079464033246, -0.011902166530489922, 0.0015856787795200944, -0.04588187485933304, 0.022682102397084236, 0.04601332172751427, 0.03004358895123005, -0.07228727638721466, -0.0027888724580407143, 0.005883143283426762, -0.010793794877827168, 0.022603880614042282, -0.02607796899974346, -0.026545537635684013, 0.02144353650510311, 0.06624624878168106, 0.02596147172152996, 0.010121562518179417, 0.006175152026116848, -0.04483362287282944, 0.04390355572104454, 0.027066469192504883, 0.026950746774673462, -0.01194217149168253, -0.04209086671471596, -0.023356862366199493, -0.04579697549343109, 0.07770491391420364, 0.021981623023748398], [-0.010450460948050022, -0.010381324216723442, 0.0027368285227566957, 0.04605724662542343, -0.008878776803612709, 0.03888161480426788, -0.017490429803729057, -0.010199472308158875, -0.0023413486778736115, 0.033552136272192, 0.019476735964417458, -0.01122287753969431, -0.021430213004350662, 0.016961347311735153, -0.002835758263245225, -0.002960131736472249, -0.04373900592327118, -0.019124334678053856, 0.0018889702623710036, -0.028721055015921593, 0.010703506879508495, -0.019784996286034584, -0.014612781815230846, -0.08104625344276428, -0.009052128531038761, -0.007074026390910149, 0.025212353095412254, -0.021883515641093254, 0.10433321446180344, 0.016377922147512436, -0.07357917726039886, -0.004701112397015095, 0.0041192676872015, 0.032674554735422134, 0.000304947083350271, 0.019776007160544395, -0.02072613313794136, 0.017036614939570427, -0.015169261023402214, 0.05262645334005356, 0.029888667166233063, -0.014731335453689098, -0.03757280111312866, -0.00520275579765439, -5.275377770885825e-05, -0.002572957193478942, 0.009331696666777134, 0.03503413498401642], [1.0492222251632068e-40, -5.1595809456439765e-42, -3.9631523168034476e-41, 2.2363182062313323e-40, -3.0920491394405684e-40, -2.9173492598931934e-40, 9.85659326821433e-41, -1.1687249582008272e-40, 1.041501070624777e-40, 3.2561552025976477e-40, -8.386070659751868e-41, 2.6737475348549672e-40, 2.3230445681883952e-40, -3.3801841296750372e-40, 3.0276314490355565e-40, 3.0401170183526906e-41, 1.7391910406902244e-38, -2.851151920438489e-40, -2.002133206873369e-40, 2.3418499935796343e-41, 2.5223372357846707e-43, -4.2278575967144056e-41, 7.751142325566293e-41, 1.5596451907935214e-41, -2.2200865457295187e-38, -1.371703040758277e-40, -2.1006571006015824e-39, 4.586029484195829e-41, 6.060917417634357e-38, -1.6900920648375186e-39, 3.1686861524544926e-40, -1.0798546095933473e-40, -4.784032957204925e-41, 1.5796487263717582e-39, -8.432509690859592e-40, 1.7914760087314191e-40, 3.053008964224479e-41, 6.37829022006727e-41, 8.579449847828693e-41, -5.0757832974773524e-39, -4.2781642115836665e-42, 1.2111702886852259e-40, -3.4284728747556704e-40, -6.732398342002151e-41, 2.9854523652593795e-40, 5.907453936054131e-41, -3.459455583801892e-40, -1.9138990477686925e-39], [3.7644341815775453e-38, 2.7752996345645867e-40, 1.3705399630328873e-40, 1.1871937917009354e-38, -2.4730815947636534e-40, -6.525146299128511e-41, 1.9381359060076545e-40, -4.5074166403472066e-41, 2.8075435122287007e-40, -3.549895386689416e-40, 1.881467396110359e-40, 2.6946689209273367e-40, -1.1082729424498546e-40, -3.871927786775902e-41, -3.2357522969570783e-40, 3.8801954477154185e-41, -2.039744057655847e-40, 2.8496665440663047e-40, 2.0079766214696034e-40, 2.566169851748751e-40, 8.859289151154358e-41, -2.442239015563864e-40, 1.5069563685349083e-40, 4.803090616319743e-41, 6.81703676924737e-41, -4.620501426418219e-41, -2.1434401440158834e-40, 3.587464198517964e-41, -4.871508157601297e-21, 3.7126001513821703e-41, 1.1988809011530972e-40, 1.6858881694445442e-40, -1.0824133805892044e-39, -1.7516511063753078e-40, -4.2741004460371245e-41, 2.554314866740563e-40, 3.02376386527402e-40, 3.306377739559049e-40, 1.0315938904820006e-40, -1.2475870930462528e-38, 2.8707280599851067e-40, -2.753229183751471e-40, -2.9127109619762783e-40, -2.7475118860170256e-39, 9.505708132747397e-41, -2.210884639103837e-40, -6.349143212009314e-41, 3.224163558657112e-40], [0.022963186725974083, 0.04705513268709183, 0.05729755386710167, 0.03444458544254303, -0.0035306082572788, -0.08024925738573074, 0.020603157579898834, 0.06087609380483627, 0.010632021352648735, -0.022936729714274406, 0.019676746800541878, 0.005388210527598858, -0.017241982743144035, 0.04765034466981888, 0.012860762886703014, -0.005026290658861399, -0.003672848455607891, 0.0006503620534203947, 0.001210870686918497, 0.013045581988990307, -0.03507314622402191, -8.312915451824665e-05, -0.014828345738351345, -0.035580214112997055, 0.04787253588438034, -0.02794903703033924, -0.07054952532052994, 0.023495420813560486, 0.02162952348589897, -0.00488195288926363, -0.03896436467766762, 0.017929628491401672, 0.01159256137907505, -0.00645620608702302, -0.06307151168584824, -0.021078797057271004, 0.007365805096924305, 0.051393065601587296, -0.019269919022917747, 0.022732215002179146, 0.013188623823225498, -0.03348175808787346, 0.046453725546598434, 0.029931727796792984, -0.003870791755616665, 0.04407626390457153, -0.039109572768211365, -0.013799981214106083], [-0.01164706889539957, 0.0004777591675519943, -0.03045624867081642, 0.01255367323756218, 0.03835654258728027, 0.0466049388051033, 0.007245300337672234, -0.03196215629577637, 0.0016309195198118687, 0.0031036054715514183, 0.025201870128512383, 0.008783707395195961, -0.013097070157527924, 0.020226208493113518, -0.0375862792134285, -0.012203998863697052, -0.0348544605076313, -0.01164730079472065, -0.038712278008461, 0.02591823786497116, -0.034854039549827576, -0.008640509098768234, 0.0575033575296402, 0.01667023077607155, 0.031885936856269836, -0.002499103546142578, 0.008647744543850422, -0.004972656257450581, 0.01718989573419094, 0.014718707650899887, 0.014919609762728214, 0.012498322874307632, -0.009909003973007202, 0.006018360611051321, 0.007525069173425436, -0.04278196021914482, 0.04077233001589775, -0.015720173716545105, -0.017259888350963593, 0.0023749421816319227, -0.03132196143269539, 0.035735469311475754, -0.009808630682528019, -0.015852682292461395, -0.018724706023931503, -0.006009573582559824, -0.06943745911121368, -0.00749926408752799], [-0.023319752886891365, 0.0012838297989219427, 0.01074505876749754, -0.03371943160891533, 0.007193006109446287, -0.017685087397694588, 0.029498782008886337, -0.0223550982773304, -0.023996293544769287, -0.020362956449389458, -0.010204765945672989, 0.013221380300819874, 0.031947724521160126, -0.04767439514398575, 0.03586790710687637, 0.005737585946917534, 0.027460239827632904, 0.014364458620548248, -0.04241976514458656, 0.011921562254428864, -0.0005218397127464414, -0.05971675366163254, -0.01884356699883938, 0.030113959684967995, 0.015724321827292442, 0.008910637348890305, 0.02068864181637764, 0.012083834037184715, 0.03293638676404953, -0.012860704213380814, 0.03836704045534134, -0.01885411888360977, -0.0004390135291032493, 0.014768117107450962, -0.014267652295529842, -0.030876250937581062, -0.0024850666522979736, 0.017825696617364883, -0.0001951193844433874, -0.019478043541312218, -0.05229589715600014, -0.008797608315944672, -0.03754528984427452, -0.029646262526512146, 0.01463902834802866, -0.02583000808954239, 0.04617118462920189, 0.016024993732571602], [0.0247034952044487, -0.011800232343375683, -0.0317641943693161, -0.033342741429805756, 0.049015991389751434, -0.06241069361567497, -0.02597792074084282, 0.07814791053533554, 0.019168617203831673, 0.013880683109164238, 0.04200369119644165, -0.00894720945507288, 0.04070817306637764, -0.0053461105562746525, -0.011702247895300388, -0.010519846342504025, 0.008122755214571953, -0.013842406682670116, 0.03692343458533287, -0.0402030311524868, -0.0015142131596803665, 0.026561245322227478, -0.04615218937397003, 0.008266985416412354, -0.026767179369926453, 0.006649101618677378, -0.04595925658941269, 0.054718855768442154, 0.0508708693087101, 0.008161522448062897, 0.02277550846338272, -0.027875613421201706, 0.04821537807583809, 0.05484295263886452, 0.03759790584445, 0.004183274228125811, 0.017605576664209366, -0.038272593170404434, 0.0024456391111016273, 0.021723397076129913, 0.07496951520442963, 0.028859686106443405, -0.003770366543903947, 0.011092377826571465, 0.014749359339475632, -0.06618507206439972, 0.037674397230148315, 0.026281341910362244], [0.04703850299119949, -0.021530384197831154, -0.034456830471754074, -0.06718332320451736, -0.008619447238743305, 0.056213103234767914, 0.007773525081574917, 0.028321413323283195, 0.013183973729610443, -0.0187417920678854, -0.01406931597739458, 0.011074685491621494, 0.019795777276158333, -0.00024114403640851378, -0.008403674699366093, -0.0028732758946716785, -0.012948642484843731, -0.002185841789469123, 0.01981363259255886, -0.0009901662124320865, 0.007711889687925577, 0.04520208761096001, 0.04871378839015961, -0.04599226266145706, 0.042028266936540604, -0.03834233805537224, 0.014750039204955101, -0.04220820963382721, 0.030028263106942177, 0.008902475237846375, -0.02012733183801174, 0.003598867915570736, 0.019497673958539963, 0.02198541723191738, -0.041304461658000946, 0.02366936206817627, 0.0246810931712389, -0.05806056782603264, -0.029919162392616272, -0.007271355949342251, 0.01931075006723404, 0.02514616586267948, 0.04565858840942383, 0.02853916585445404, -0.00865254644304514, 0.004919165745377541, -0.07979854941368103, -0.05125340074300766], [0.0219112541526556, 0.051311735063791275, -0.05835704505443573, -0.050249043852090836, -0.007092772517353296, -0.012781190685927868, 0.025231678038835526, 0.010155711323022842, 0.027876371517777443, 0.026732686907052994, -0.026487527415156364, -0.006450240965932608, 0.06514831632375717, 0.042997803539037704, -0.06017167866230011, 0.0011877177748829126, 0.02363026700913906, 0.016124263405799866, -0.0037407048512250185, 0.01153717003762722, -0.008767453022301197, -0.012019336223602295, -0.000813703634776175, -0.002074660500511527, 0.04314494878053665, -0.03189699724316597, -0.04779960587620735, -0.05901264026761055, -0.021169506013393402, -0.007643473334610462, 0.010146014392375946, 0.05017367750406265, 0.03514043614268303, 0.008651413954794407, 0.06505855172872543, -0.006517983507364988, -0.0039035025984048843, 0.003890313906595111, 0.032521363347768784, 0.00720285763964057, -0.011592108756303787, 0.0008543108706362545, -0.04256089776754379, 0.015895452350378036, -0.04479194059967995, -0.01763232611119747, -0.055735692381858826, 0.014047177508473396], [0.06457996368408203, 0.034705981612205505, 0.02060367912054062, 0.016162529587745667, -0.006537929642945528, 0.0550677515566349, -0.013872193172574043, -0.08778581023216248, 0.014317898079752922, 0.01742330938577652, -0.0035739862360060215, -0.017498046159744263, -0.04722929000854492, 0.004440896213054657, -0.0479629747569561, 0.003388328943401575, 0.038037095218896866, 0.01079040952026844, 0.006941358558833599, 0.008148920722305775, -0.037355437874794006, 0.0014798541087657213, 0.017532316967844963, 0.0020353428553789854, 0.06812787055969238, 0.008281262591481209, 0.023250002413988113, -0.008919600397348404, 0.01798303611576557, 0.005485929548740387, 0.03522980213165283, -0.020545613020658493, 0.06190860643982887, 0.06165694072842598, -0.03352099657058716, -0.05065107345581055, 0.03799979388713837, -0.06054721027612686, -0.011706504039466381, 0.010925455950200558, 0.014072714373469353, -0.021906809881329536, 0.023373886942863464, -0.04049263522028923, 0.008847400546073914, -0.0015880176797509193, 0.05578193441033363, -0.047309860587120056], [-0.006948656402528286, 0.010984398424625397, 0.0466100350022316, -0.0267031230032444, -0.0528070405125618, 0.016936806961894035, 0.007176009006798267, 0.004652967676520348, 0.017601963132619858, -0.003581233322620392, -0.04474958777427673, -0.01648707687854767, 0.040781036019325256, 0.00013544352259486914, 0.006041445303708315, -0.001496108015999198, 0.01566733606159687, 0.027686476707458496, 0.0007657717796973884, 0.009745973162353039, 0.006503568030893803, -0.012925508432090282, -0.0677405521273613, 0.026306265965104103, 0.004315695259720087, -0.030323559418320656, 0.0467778779566288, 0.017685558646917343, -0.061452221125364304, 0.0186932235956192, -0.029432879760861397, 0.02414063923060894, 0.004045696929097176, 0.039639972150325775, -0.00017250399105250835, -0.0017013283213600516, 0.024187346920371056, 0.012350826524198055, 0.0224146768450737, -0.014248444698750973, 0.007511818781495094, -0.032220806926488876, 0.0228863637894392, -0.04625636339187622, -0.011891452595591545, -0.02674691006541252, -0.0794624537229538, 0.0031244007404893637], [0.014178682118654251, 0.008301894180476665, -0.05536339059472084, -0.04310907796025276, 0.01681065931916237, -0.02583562582731247, 0.0217501949518919, 0.05545157194137573, -0.004906204994767904, 0.012639104388654232, -0.05166911333799362, 0.020321937277913094, -0.011300715617835522, -0.01717769168317318, 0.010033922269940376, 0.005104304291307926, -0.043385669589042664, 0.015702566131949425, -0.029745187610387802, -0.002209586789831519, 0.01190882083028555, 0.029398107901215553, 0.02169378288090229, -0.005797795485705137, -0.021283922716975212, -0.013225306756794453, -0.026922477409243584, -0.006568306125700474, -0.01845736615359783, -0.0008336553000845015, -0.0066930088214576244, -0.0040295906364917755, -0.0028527502436190844, 0.058960750699043274, -0.055017709732055664, 0.06339555978775024, 0.02257552370429039, -0.002178114838898182, -0.012576079927384853, -0.03989880904555321, -0.033990103751420975, -0.016986766830086708, 0.0011705192737281322, -7.008275133557618e-06, -0.03708478435873985, -0.011429455131292343, -0.020939568057656288, 0.02045474387705326], [-0.0526733361184597, 0.03859351947903633, -0.025970369577407837, -0.04441070556640625, -0.012153051793575287, 0.0075354864820837975, 0.011846885085105896, 0.00931397546082735, 0.022349081933498383, -0.028666093945503235, -0.005876959767192602, 0.019703511148691177, -0.021040529012680054, -0.017932076007127762, -0.01131910178810358, -0.0061807651072740555, 0.023915136232972145, 0.018595095723867416, -0.020195065066218376, -0.01514893677085638, 0.017273614183068275, -0.008609985932707787, 0.04044631868600845, -0.02217714488506317, 0.04729719087481499, 0.03722214698791504, -0.01985747553408146, -0.00981011800467968, 0.007718496955931187, 0.040271081030368805, -0.02352682501077652, 0.020069383084774017, -0.02507828362286091, -0.0032309265807271004, 0.0009819600963965058, -0.02160044200718403, 0.05585777387022972, 0.04058779776096344, 0.04009634628891945, 0.028071243315935135, 0.01316880714148283, 0.036728959530591965, -0.043402381241321564, 0.01577650010585785, -0.03014378249645233, 0.042416494339704514, 0.015545932576060295, 0.013146513141691685], [-0.03586950525641441, 0.04046182334423065, 0.05934455618262291, -0.014251990243792534, 0.003980082459747791, -0.005920376628637314, 0.027258938178420067, 0.053137801587581635, 0.007665383163839579, -0.0020254189148545265, -0.0017091217450797558, 0.0008268249221146107, 0.02324564754962921, -0.0720810815691948, -0.02742563746869564, 0.005890656728297472, -0.009192009456455708, -0.010675689205527306, 0.009721051901578903, -0.01002536155283451, -0.05486944317817688, -0.003881988115608692, 0.029343366622924805, 0.03869805485010147, -0.0077041033655405045, 0.04623331502079964, -0.009539476595818996, -0.0167526975274086, -0.03550448641180992, -0.016975831240415573, 0.01323049608618021, 0.01164458878338337, -0.008878354914486408, -0.022812586277723312, -0.007635235786437988, -0.008440570905804634, 0.014581236056983471, 0.002202636795118451, 0.002992314985021949, 0.015450488775968552, -0.03322296217083931, -0.03197486698627472, -0.012626963667571545, -0.024845687672495842, -0.01166155468672514, -0.03203911706805229, 0.02817157842218876, 0.0694415345788002], [0.028763635084033012, -0.01738697849214077, -0.04990791156888008, -0.031913891434669495, -0.03207256272435188, 0.048369504511356354, 0.018086081370711327, 0.03757760301232338, -0.01811596378684044, -0.04407406225800514, -0.007743320427834988, -0.010424762964248657, -0.006813278421759605, 0.04477556794881821, -0.05378206446766853, -0.0021010111086070538, 0.02650187350809574, 0.009036391973495483, -0.007799315266311169, 0.0057800645008683205, -0.04743969812989235, -0.043348707258701324, -0.004594128578901291, -0.02105993777513504, -0.04753556475043297, -0.010079484432935715, -0.01919420063495636, 0.01131494902074337, -0.00712076248601079, -0.010972803458571434, -0.00106233695987612, 0.029921654611825943, -0.0020038720685988665, -0.029492713510990143, -0.027874182909727097, -0.007495854515582323, -0.02294299006462097, 0.03582856059074402, 0.018492447212338448, -0.055252548307180405, -0.012392843142151833, -0.01561995130032301, 0.002515853848308325, 0.0020552638452500105, 0.001765100983902812, 0.033230554312467575, -0.010741136036813259, 0.033931463956832886], [-1.394684335573204e-40, -1.323876724170871e-40, 3.3726451439369697e-40, -1.0196548275659531e-40, 2.929078128039592e-40, 4.919958908244433e-42, -1.1529883764464595e-40, 1.137994482878184e-40, -2.303594545503567e-41, 5.812042326215183e-39, 2.865501216713175e-40, 3.002464128616283e-40, -2.816750043139315e-41, -3.145284468100268e-40, 2.0204061388481645e-40, -2.019929697370294e-40, -2.7904897099178677e-40, 3.0856872444125337e-40, -2.105871332187335e-40, -2.5282367023194782e-40, 7.149144505292352e-41, 2.0375300060822138e-40, 3.620815101968895e-40, 9.456522556649596e-41, -8.400223774241548e-41, -5.22642288239227e-41, 9.809159315196936e-40, -1.0631931708525252e-40, -2.358819717982608e-40, -5.97793924880967e-42, -7.761091544663e-40, 3.372785273783402e-41, 1.1164705384661548e-40, 1.014568114140454e-40, -2.426936836333437e-40, 1.824672769351274e-40, 1.9166680135341983e-40, -4.0207456836871976e-41, 3.1139514344379652e-40, -2.0380204605447275e-40, -3.2696497068090957e-40, -4.326649138449305e-41, 6.024163881252352e-39, 2.4061695930921434e-41, -1.4841572425203435e-40, -2.0689791433229823e-29, 8.015006826398656e-41, -3.415524876945309e-41], [4.696451803184624e-41, 3.5260032478726777e-40, 2.268029590479003e-40, -1.847135583734401e-40, -4.5159941698203885e-20, -2.0622629239775468e-40, 5.653114060883784e-39, -8.182461992885472e-41, -2.8666082424999918e-40, -7.712746747643793e-41, 2.0261654755365395e-40, 4.548895074891221e-41, 9.27435375628737e-41, -2.1960589013512803e-40, 4.094019580386742e-40, 7.198457599550406e-39, 2.8403899482324745e-40, 2.376742325341322e-41, 1.9024722995712022e-38, -2.7060054255037245e-40, -3.1759588914843384e-40, -4.838123077927863e-41, -3.513755899294479e-41, 1.0507356275046776e-40, -5.917683414843702e-41, -2.3687268981253843e-40, -2.3822354153214755e-40, 6.324900748576494e-41, 1.7106911522630934e-40, 1.2984291440587322e-40, -1.4968530066071263e-40, -1.516462777316888e-39, 2.3608375877712356e-40, -7.488258733658957e-41, -1.2423772054857396e-40, -3.281462652863354e-40, 2.8487977390184234e-40, 6.219523104059268e-41, -4.045667568362003e-35, -1.8710137095664958e-41, 2.7707594275401743e-40, -1.26491568998594e-39, 7.407964331653145e-41, -6.118069095242151e-42, -1.2908621323513782e-40, 1.4351538352229047e-40, 3.5234949236215363e-40, -2.2168541705618606e-40], [-5.005017725028949e-41, 7.187540083214852e-41, 1.0070711673563163e-40, -1.968892725741427e-38, -7.723536745819094e-41, -4.2543421376901446e-41, 5.2888927679318706e-40, -3.0464929263653686e-40, 2.148036402978869e-40, 3.7315176806505554e-41, -1.7027177640010852e-41, 1.3531638620752596e-40, 4.907207092219077e-41, 1.9763619268159712e-39, -8.792867603945362e-41, 8.409192084413227e-42, 1.7555186901368443e-40, -2.612580856887189e-40, -2.2680576164482894e-40, -8.220016791729377e-42, 9.383094517118975e-42, -5.885733809857097e-41, 2.6158458823090658e-40, -2.303314285810702e-41, 1.0268014497340097e-40, 2.248943905394899e-41, 1.7861552784623778e-39, -8.907213558634267e-41, 7.883565030444988e-41, -4.652595041003404e-13, 2.7858640236871315e-39, 2.510776523453991e-40, 2.527213754440521e-40, -2.671015002849534e-40, 3.537774154973006e-40, 1.4313542879321898e-33, 3.001973674153769e-40, 1.6406402420314958e-40, 1.980373844319333e-39, 3.1996128095621413e-40, 1.0651409757179367e-40, 3.2347994140013375e-40, 1.7171231122143443e-40, -2.0293884620044866e-40, -2.61677073929552e-40, 2.5482472443900366e-40, -6.693052750983165e-36, -1.1254949005764066e-40], [-1.0942739707912497e-41, 2.8699293198604416e-40, -1.495759993804953e-40, 8.387191698523328e-41, 2.737366485135314e-40, 1.5230432749053572e-40, -1.8853910318104684e-40, -1.2531391776917542e-40, -3.316873465056842e-40, 1.2714961875744093e-40, 2.963620135185199e-40, -9.160428191137762e-41, 7.883705160291421e-41, 3.0213115929614516e-40, -1.355926521997676e-38, -1.4166707084784603e-40, 1.4271103820376802e-40, -6.209573884962562e-41, 3.3344037088455455e-40, -2.01020468602788e-40, -2.9979659605458e-40, -2.159400933524543e-40, 1.2749433817966483e-40, -3.4951186297189587e-41, 1.902304704274869e-40, 2.1237378876074765e-40, 1.736811355638108e-40, 3.8223218211388035e-41, 3.3852708431005363e-40, -1.75843339094264e-40, 6.69904743855122e-41, 1.2856563085564115e-39, -3.5551222299613474e-40, 3.4865707090865774e-41, -1.275321732382016e-41, 2.9406668663395584e-40, -3.9424130995314403e-41, -4.956112408624013e-41, 1.0001487529425517e-40, 6.4046346311965764e-40, -3.434820756799062e-40, -2.784239918766979e-41, -1.4638384147876337e-40, 3.0942071390756286e-40, 3.148885805153583e-40, -2.0111435559989775e-40, 1.954825370717763e-40, -1.8736481506794264e-40], [8.915200959880919e-41, 2.9220996616872545e-40, 3.56069939784936e-40, 4.5247927413048343e-42, 5.905211858511212e-41, -6.018857163967954e-41, -2.528278741273408e-40, 1.5261821834654448e-40, 3.4957352010432617e-40, -2.903770677773886e-40, 2.5671647736584216e-40, 5.540734127940327e-41, 3.6382332418804523e-40, 1.5852889526906656e-41, -4.203867367005165e-39, -2.0565456262431015e-40, 7.554540151021521e-41, -2.4611565448322492e-40, 1.8043119026646345e-40, -3.216974897535126e-40, 2.248159178254877e-40, 8.649795030737798e-41, -3.391002153819625e-41, 9.049024963223939e-41, 5.4927256425525585e-40, -1.849167466507672e-40, 1.2468473475869357e-40, -1.846855324041536e-40, 6.648880953528392e-41, -1.209768990220901e-40, -3.568490617311006e-40, -1.0629269241443035e-40, -1.221175559720505e-40, 8.33422261657185e-41, 1.512813796115786e-40, 6.970759210783803e-41, 1.394067764248901e-40, 3.6006364040826175e-41, -1.4707748421860415e-40, 2.141954767643699e-40, 2.1808828389826426e-40, -1.911174923554045e-40, 1.155160389066163e-40, -2.9388031393820064e-40, -2.8952647960954343e-40, -3.2192029620934023e-41, 2.3106851157330504e-40, -1.009313244899236e-40], [-5.4499423637201155e-36, -3.147092143119247e-40, -1.4827419310713754e-40, 1.568151072471973e-40, 4.1600347510410844e-41, 1.8320856382275523e-40, 6.072386765305162e-41, 1.2490894251298554e-40, -1.5346320132053234e-40, -3.2591399683266595e-41, -3.163795620813999e-40, 5.122401918996265e-37, -3.0040335828963266e-40, 1.3163797773867332e-40, 2.1428936376147968e-40, -3.267926109697976e-40, 1.6118996105281938e-40, 3.408336215823323e-40, -2.917559454662842e-40, -6.992973995338744e-39, -4.810657628027097e-42, 1.5791232394476364e-40, 2.5787955509123176e-40, 1.0312996178044924e-40, -2.0253807483965176e-40, -2.0399542524254957e-40, 3.5911075745252087e-41, -2.215004456588952e-40, 3.090325542329449e-40, -2.252447151555711e-41, 7.851335165765518e-41, 6.396764939020928e-39, -2.0492028222900395e-40, -8.623310489762059e-41, 1.6622891530298516e-33, -1.3056878701039348e-40, 6.74304821033102e-41, -1.3038342730320879e-33, 7.837462310968702e-41, -2.9325085066802593e-39, 9.716743681474714e-41, 2.645497357814179e-40, 1.59389292526162e-40, 4.428103147266422e-41, -4.643062331693849e-41, -9.853090022053519e-41, -2.9223098564569033e-40, 1.8714340991057932e-41], [-1.6661859130361372e-40, -2.776266530504971e-40, 2.114503330727576e-40, 7.498348082602096e-41, -3.270350356041258e-40, -7.473404969937114e-41, -7.247291449733662e-40, -2.58385423836853e-40, -2.2100298470405987e-40, -7.024569071813875e-41, -4.28797330083394e-43, 2.023643138300755e-40, 6.35628983417737e-42, -1.9016601069812795e-40, -6.727633927223447e-42, 5.389674153486111e-41, 1.602987352295088e-40, -2.7183788909437126e-41, 1.845566129454357e-40, 1.8781042797959793e-40, 4.792440747990874e-41, 2.3487583950087556e-40, -7.280936625862101e-40, 2.8209679515169325e-40, 1.7954136574161719e-40, 1.274018524810194e-40, -1.4402265356637605e-40, 1.9686842125299355e-40, -8.990871076954459e-41, -2.9801414440795885e-40, -9.277997132294614e-41, 1.841894727477826e-40, -3.3012630001642635e-40, -2.9004075614595064e-40, -4.919678648551568e-41, -5.715616176288064e-41, -6.397067619489222e-41, -5.009081490575491e-41, 2.5651749298390804e-40, -3.015468178365217e-40, 8.139582259877132e-41, -1.140026365651455e-40, -2.0600488724039136e-41, -1.3071073854482958e-39, 1.1462060918791274e-40, 3.565323682781632e-41, -7.825271014329076e-41, -3.095300151877802e-40], [2.8002427472295684e-40, -4.5669718250810113e-41, 1.8637129445673635e-40, -1.7803609093123947e-39, -2.1419457993335275e-38, -2.742172938867948e-40, -2.9268921024352454e-40, -3.089092399680843e-40, -4.2257556490179184e-41, -3.4126241891241568e-40, 5.045935640187234e-41, 3.053849743303074e-41, -1.259627189581578e-40, 2.7925636316450685e-40, -2.029080176342335e-41, -2.145794325435949e-40, 1.1608104244743206e-39, 4.696732062877489e-41, -7.59966196157278e-41, -1.987573715829034e-40, 1.5141310166722513e-40, -1.5515737116390105e-40, -9.59675049397458e-40, 1.9606687853139975e-40, 1.90377606766241e-40, -4.043586848655692e-41, -2.790265116715268e-26, 6.718945876744633e-41, 4.460333011945893e-42, -8.455294803889514e-41, 1.6513321493142942e-40, -2.136363586771043e-40, 5.10955459046758e-41, -1.037661512832527e-41, -4.913442870385322e-40, 7.948445149343227e-41, 1.0095234396688847e-40, -2.9963965062657563e-40, -2.2544089694057657e-41, 9.331666863478254e-41, -2.828969365748227e-40, 2.7995561109820493e-40, -2.8935411989843148e-40, -1.8050265648814401e-40, 1.7606194165469867e-40, 2.0525799515890623e-40, 1.1358364832431237e-40, 9.703151086370763e-41], [3.765429103487216e-41, 1.9207878310193133e-40, 3.4778686456231202e-40, 3.013212087837654e-40, -5.352960133720801e-41, 8.985966532329322e-41, -2.7703670639701633e-40, -2.0513327959558132e-40, -1.7624551175352522e-40, 9.296774531716566e-41, 2.169280087698033e-40, -1.3327749694193335e-40, 2.1925836811597548e-40, -8.104129408729715e-41, 1.3105643887597852e-40, -1.8855872135954739e-41, -3.7830854641377086e-41, -5.013285385968466e-41, -6.360633859416777e-41, 2.2148923527118059e-41, 1.8366538712212512e-40, 4.2683929573919296e-39, 2.4332847183768286e-40, 2.741668471420791e-40, -3.146090214717255e-39, -2.028169332340524e-40, -1.9323765693192795e-40, -3.7812825550017585e-15, -4.1984303289635844e-41, 2.316528530329285e-40, -1.1969891482262587e-40, 1.4872681251111446e-40, -3.6602756667242817e-40, 3.6195539333510025e-42, 4.924078725729548e-40, 1.839680675904193e-40, -3.3493135245059615e-40, -3.153902453655866e-41, 5.47711517765998e-41, -8.685948531117379e-41, 4.21398474191759e-41, 3.005743167022803e-40, 3.339448383317115e-40, 1.35911938054864e-41, -2.3549100952671416e-40, -2.7638089871571232e-40, 1.8924535760706655e-41, -9.591677793533724e-40], [1.7929613851036034e-41, -1.4273906417305452e-40, 2.2392609330064144e-40, -9.596554312189574e-40, -5.922307699775974e-41, 3.5927330807438255e-40, -1.9679975762824163e-40, -5.341293515870868e-32, -1.556856606849515e-40, 1.1696638281719248e-41, -2.409770930145458e-40, -2.022522099529295e-40, 1.6556761745537011e-40, -1.6017121706925524e-40, 4.3131041874931415e-38, 1.608914844799182e-40, 1.6538825125193653e-40, 2.0380905254679437e-40, 1.408290943661798e-40, 3.649401590641121e-41, -2.9372757240558923e-40, 1.2448434907829512e-40, -9.33993452441777e-41, -1.8266205742166855e-40, -1.8498681157398343e-40, -9.374686726333026e-42, -4.8043657979222786e-40, 2.0851881668539008e-40, 1.2502207151676202e-22, -1.744546523161181e-40, 1.515125938581922e-40, -2.895124666249002e-40, 6.712219644115874e-41, 1.5061155894563134e-41, 5.181721461380309e-41, -1.2028325628224932e-40, -8.285737689706211e-41, -2.522519404585033e-40, -2.894115731354688e-40, 2.2235663902059765e-40, -7.989414071765613e-38, 1.9054841180232254e-26, -7.693128569143246e-43, 2.9948831039242855e-40, -3.1337237557695884e-40, -2.924383778184104e-40, -1.7120083728195588e-40, -1.4112530927339407e-28], [-3.1981134202053138e-40, 4.517646119136778e-41, 1.4219536036889649e-40, -3.1864265910128448e-40, 6.817807483402749e-40, -1.396379906715037e-40, -8.123187067844532e-41, 6.060475728358401e-41, -1.8660811389720724e-40, 6.475540333491412e-41, -3.5127749903694514e-40, 4.2435521395148435e-41, 9.865449474508864e-39, 5.957340161384095e-41, -1.2787829395888983e-40, -6.789431189500171e-41, 3.020709034621792e-40, -1.4795890095266446e-40, 2.1278717180772347e-41, -8.886614471208692e-41, 1.2896850416413454e-40, -5.064292650069889e-41, -4.198009939424287e-41, -2.386383258775877e-40, -8.423064939210043e-41, 1.0410946940701228e-40, -6.521507407276352e-38, 2.6778813653247254e-42, 7.091831398101467e-41, -1.6800167288790232e-40, -7.907527234184943e-41, 8.356082872615317e-41, 3.198926173314622e-40, -9.73510069135737e-41, -1.8581105533069928e-38, -1.143305404057975e-40, 2.328509632199262e-40, -2.684187208414187e-40, -2.6275747504554645e-41, 2.773407881637748e-40, -2.6155375966469143e-40, -3.581592757952443e-40, -2.427048940210583e-41, 1.3412247991592122e-40, 3.4861783455165664e-40, -2.094016347179147e-40, -3.1873234220300127e-40, -1.3390247605702222e-40], [-5.940846878458992e-40, -6.738423925398748e-41, 2.9828599631003786e-40, 6.753698078659888e-41, -1.4434355091470643e-40, -3.4044826450464296e-40, 2.3969070102429564e-40, 3.737823523740017e-41, 2.0130072829565295e-40, -2.113998863280419e-41, -2.6477394353570986e-40, 6.893547665399505e-41, 1.831959521365763e-40, -4.8301388891299155e-34, -2.6292142696587245e-40, 1.340818422604558e-40, 3.1733664893253375e-40, 2.2339500118266234e-41, -1.1200303970849255e-38, -5.592021651734615e-41, 9.971639872135398e-42, -8.130754079551886e-41, -7.567011707354012e-43, -1.0938535812519522e-41, -6.275434912785828e-41, 9.848535802044463e-40, -1.8312868981028872e-40, -4.387465491801002e-42, 1.8964612896786344e-40, 1.913431014081608e-40, -3.0376927720094087e-40, -4.8695121635287393e-42, -6.13611053271064e-38, -1.3104242589133527e-40, 8.469307788532762e-41, -6.533834349607325e-41, 3.4766915549130874e-40, 1.8624798019187576e-40, -3.2965125983702024e-40, -2.0430931609855833e-40, -1.9939075848877822e-40, 2.6965886998234617e-40, -1.520100548130275e-40, 3.302580220720729e-40, -2.436970133338003e-40, -5.272340630471266e-39, -8.760637739265891e-41, 2.5761470968147437e-41], [-3.682472234399187e-41, 2.6759615864286004e-40, -5.511867379575235e-41, 1.0603905739238756e-40, -1.024839631883955e-40, 1.89553643269218e-40, -3.3379630069449305e-40, -3.1840443836234926e-40, -3.814894939277882e-41, 1.8937147446885578e-40, -2.9876944428022992e-40, 3.3096707909502124e-40, -2.314174348909219e-40, 2.6542975121701388e-40, -8.751949688787077e-41, -2.7381371992906926e-42, 2.6250384002350366e-40, -2.707168503229114e-41, 2.6386590213082738e-40, 4.373452507157754e-41, -1.4441838025270138e-39, -6.967802471024077e-40, 2.5416331156384235e-40, -2.8753383319327354e-40, 2.6365010216732136e-40, 1.84182466255461e-40, 2.1033531988469434e-39, 3.394967828473664e-40, -6.417946966607662e-43, 7.016161281027927e-41, -3.5412213491952452e-40, 9.352966600135992e-41, -8.523257779409267e-41, 2.2204975465691051e-41, -1.6401778135382686e-40, -4.742274262968046e-41, -5.249404177207197e-41, -1.6804090924490341e-40, 1.0534541465254677e-40, 1.1829341246290808e-40, -1.9346326598468424e-40, -2.3471749277440686e-42, -3.281294497047635e-40, -2.9547779418753093e-40, -1.4745583480397185e-40, -2.052902250235857e-41, 4.4238992518734475e-42, -1.9474685537800578e-40], [3.5024894596413073e-40, 2.7992898642738276e-40, -2.632185022403093e-40, 4.425300550337772e-42, 1.1527021438590202e-35, -1.366223963762767e-40, 6.097049618277279e-42, -1.6679095101472568e-40, 2.0069816995599328e-40, 3.151646363128303e-40, 2.5760630189068842e-40, 2.764593714297145e-40, -3.253674904315793e-41, -3.0564841844160045e-40, 1.4677760634723864e-40, 1.5466985942816244e-39, -3.2930654041479634e-40, -1.3202753871175561e-40, 5.245382450614585e-40, -2.2942759107158067e-40, 9.376508414336648e-41, -7.743715443705372e-41, -2.250303164905294e-40, 4.4028895839978255e-39, -9.136185727704942e-41, -9.826325221384915e-41, -9.363196078925563e-41, 8.034625004899204e-41, 2.0593616756370087e-38, -2.0699140135927603e-40, -4.882220061739184e-35, 6.08920234687706e-41, -1.6059721180241e-39, -5.621869309024734e-41, -6.234376867781111e-42, 5.492809720460418e-41, -5.772368764093219e-41, -2.892980679598585e-40, -7.258726045202552e-41, -3.0117687504193996e-40, -1.002937336886558e-40, 1.6094052992616957e-40, -5.336985331227498e-41, 9.764808218801055e-41, -1.0697904840225664e-39, -1.3618252878832513e-39, 2.7517297943946433e-40, -3.965368610454624e-38], [1.7606754684855597e-40, -9.933804813598628e-42, -2.4165111757588605e-40, 1.343074513132121e-40, 1.4537770918137815e-40, -1.9090449498882713e-40, 6.652888667136361e-40, -3.602303949255164e-40, 2.844327596917227e-40, 2.7140348657043057e-40, 1.2961450275618828e-40, -1.3280806195638454e-40, 2.6667270295487e-40, 1.6632151602917686e-40, -1.1965407327176748e-40, -2.1222525112352922e-40, -1.7597506114991053e-41, 1.7457796658097869e-40, 3.4927224093449633e-40, -2.156121895118023e-40, 1.3712686382343362e-40, -1.9855138070864766e-40, 2.4926297083409846e-40, -1.7290341491611053e-40, 1.2814594196557587e-40, -2.176791047466814e-40, -7.997476582609953e-40, -9.087000151607141e-41, -8.196194717835855e-41, 3.516754678008134e-40, -4.835320480999214e-41, -1.7345412521259018e-40, 1.4363309259329375e-42, -3.185431669103174e-40, 1.4045634897466939e-40, 1.1088755007895142e-40, -3.0874809064468695e-40, -6.97286115848029e-41, 2.4011389316052173e-40, 6.619593815624003e-41, 2.762898143155312e-40, 7.579343133840071e-41, 3.2605412667909844e-41, -2.859279451531573e-40, -4.5082574194258015e-41, 2.2147101839114436e-40, -9.667558105376913e-41, 3.0276734879894863e-40], [-6.272352056164314e-41, -1.5246267421700442e-40, -5.866860162530382e-35, 1.129979055662246e-40, -1.1329217824373281e-40, -2.102316237983343e-39, -7.966521899533018e-41, -3.5141342498798465e-40, -1.077640558019714e-40, -1.7556816611482453e-38, 2.2829674321087055e-40, 5.446286611444834e-41, -2.719822228361967e-40, 1.0667244429826237e-40, -1.5494157120039502e-41, 3.1001766705336523e-40, -6.452137247838723e-39, 8.056625390789103e-41, -1.807899226733306e-40, 3.5824055110617516e-40, -1.119076953609799e-40, -1.7814847506807832e-40, 3.306657999251914e-40, -3.0275613841123403e-40, -7.146061648670837e-41, 1.2687776685536191e-40, -7.69957454207914e-41, 3.325113100027072e-40, 3.2889595996474917e-40, -9.012451073305061e-41, 5.714481124531961e-40, 2.071707675627096e-40, -3.1550234924273256e-41, -2.1299036008505057e-40, -1.6347968274352613e-40, 1.1514396613836877e-38, 1.0041844925198072e-40, 2.0655139364147804e-42, -2.509655484682531e-40, 1.6623463552438872e-40, -3.553188438080579e-39, 1.8211274842365323e-41, 2.6640085105279097e-40, -3.1743193722810784e-40, 2.1783689095376438e-39, -3.398737321342698e-40, 1.3293417881817377e-40, -1.5223426256731948e-40], [7.33705862935831e-41, 1.3495625250219448e-40, -1.4310760566917194e-40, 1.9618598890086736e-40, 2.658711602332762e-40, -2.0442982776649026e-40, 1.731220174765452e-40, 9.859657907955809e-39, -7.485007721221724e-40, -9.435222819991858e-41, 2.62734466845801e-36, 2.3683905864939463e-40, 4.2533612287651173e-41, -2.407725034387544e-40, -1.2193959106708126e-40, 2.0529723151590732e-40, -7.795423357038957e-42, -2.906601300671822e-40, 2.1993519527424436e-40, -4.292037066380482e-41, 1.3173466733271173e-40, 3.0037953621573914e-40, 2.9874422090787208e-40, 3.062733975566893e-40, 1.250813022240975e-40, 1.2051727312579157e-40, 3.52566693624124e-41, 1.7274646948810615e-40, -3.145172364223122e-40, -5.18970886262696e-41, 2.8867028624784097e-40, -6.61465143594033e-39, -7.845805642025292e-39, 2.2612753318809573e-40, -2.0157678409312494e-41, -1.4792386849105634e-40, 1.3933811280013819e-40, 1.201347186450309e-40, -5.0892778016888e-40, 2.67548514495073e-40, 2.932805581954696e-40, 5.487064396756686e-41, 2.4943112664981744e-42, 1.1441041441826401e-40, -1.8553051537814146e-40, 1.1050247326095496e-39, 1.2773255891860005e-40, 2.4409638339613286e-40], [3.632291736391715e-40, 1.1624262519456861e-20, 3.895189341283694e-41, 1.3491000965287176e-40, -5.641207227832416e-41, 3.0834872058235437e-40, -2.5020997861397263e-33, -7.808035043217881e-41, -1.5178024186487824e-40, -1.8687982566943982e-39, -3.5019289402555773e-40, 1.5489706596116807e-38, -2.83894661081422e-40, -3.534999584013643e-40, 1.360296471258673e-40, -2.6253887248511178e-40, -8.569921018271284e-41, 2.546859958910355e-41, -9.171498449005928e-42, 2.2371169463559975e-40, 2.873572695867686e-40, 3.7444096265223437e-41, 1.8451317269304164e-40, 9.206530910614048e-42, 3.375601883696695e-40, 1.35886014033274e-39, 3.263063604026769e-41, -1.7188887482793936e-40, -2.0475212641328497e-40, -8.20863824819906e-40, -4.690145960095163e-42, -2.3784098705138688e-40, 2.139404404438628e-40, 7.848952958376165e-41, -1.095815399102007e-42, -2.12258882286673e-40, 2.3054862984304053e-40, -7.523711584806375e-41, 1.4138120596112377e-40, -3.3164530755175446e-40, 4.0283126953945516e-41, 2.4445231320607136e-40, 2.5763012396458194e-40, 2.345157057955441e-40, 2.6643868611132774e-40, -7.223413323901567e-41, 3.0497159128333156e-40, 2.725525513111769e-40], [-5.135758871750455e-41, -1.2729395249926638e-40, -7.054136469411129e-42, 1.217504157743974e-40, 1.5872830004053998e-39, -2.6997416213681926e-40, -9.098560863937821e-40, 2.4267826935023615e-40, -1.469970496867519e-39, 3.177976761272966e-40, -2.0206723855563862e-42, -2.32772490505924e-40, 5.118280490874389e-32, 3.148045026074988e-40, -8.633960358090928e-41, 2.3644389248245503e-40, 1.6704318473830414e-40, -1.164366919976777e-40, 2.597390781533908e-40, -2.2225434423270194e-40, -5.605614246838566e-41, -9.929881177898519e-41, 6.88065992342311e-39, -1.3933951409860251e-40, -2.0921414098338805e-39, 1.8040316429717695e-41, 1.035909889752121e-40, 3.0542568790861686e-30, 1.4109954496979448e-40, -1.0616587490340895e-39, 1.4673977128870187e-40, -1.4324913681406875e-40, -2.3755091826927164e-40, 1.3520147973345133e-40, -2.4721987767311288e-40, -1.5043866786214171e-35, 3.2501716581549807e-40, 3.4935940169897733e-39, 2.1748094769136062e-36, -1.602763144540796e-40, -3.6292088797702005e-40, 1.3363244584294683e-39, -1.0550236008055115e-40, -7.645624551202634e-41, -1.971935224967169e-40, -1.7926671124260952e-40, 2.8515022450545703e-41, -3.201574627412196e-40], [-3.4631550117477097e-40, -1.2045841859028993e-40, -2.393095478419993e-40, 2.6478599470250305e-39, -3.461921869099104e-40, 1.493784162970255e-42, -1.670179613659463e-40, 3.137647391469698e-40, 2.287857963749199e-40, -6.617631997773949e-41, -2.0910596074194218e-40, -2.875646617594887e-40, -9.291169337859267e-41, 4.2600874613938764e-41, -2.7622955848156524e-40, 9.187613381345663e-41, -1.4706543305181096e-39, 1.4605453633964703e-40, -1.9064665607139136e-40, 2.379152558699961e-40, 2.5223372357846707e-41, 1.8734940078483507e-40, 4.965772507713612e-24, 3.9983249082580005e-41, 3.305915311065822e-40, 2.007850504607814e-40, 5.13435757328613e-41, -1.7556027680447038e-40, 2.02828143621767e-40, 1.200842719003152e-40, -3.5428188294445755e-40, 5.092552355940235e-38, -3.2564775012444424e-41, -2.3427047856428724e-40, 7.288125286984087e-40, -3.214071407117045e-39, 1.4312301995227952e-40, 2.701465218479312e-40, -1.6108626496645935e-40, 8.379484556969541e-41, -1.6667464324218672e-40, -1.8562019847985824e-40, 1.802532253614942e-40, -1.293048157955725e-39, -7.4703221133156e-41, 7.132609183413319e-41, 2.050926419401159e-40, 2.2138413788635622e-40], [1.2062937700293755e-40, -1.882154032357878e-40, 2.464183349515191e-41, 1.0097336344385334e-40, -8.306897296517516e-42, -2.7717683624344882e-42, -7.407543942113848e-41, -2.152002077632908e-40, 2.2746156932613296e-40, -2.6429890335630375e-41, -1.2607202023837514e-40, -1.9135010790048242e-40, 3.6625737962057744e-41, -3.2693133951776577e-40, 5.1375749545602195e-39, 6.9327840224006e-40, -2.123205394191033e-40, -2.576889785000836e-40, -1.409369943479328e-40, -4.778708023040491e-41, 3.371412001288364e-40, -4.045828926198612e-41, 2.997563787886539e-39, -1.823369561779452e-41, 2.2938695341611526e-40, -1.8906038620977567e-40, 2.1003908538933607e-39, -2.1830828775716325e-40, 4.068810221013539e-41, 3.2910895733132654e-40, 3.136246093005373e-41, -1.065042884825434e-40, 3.7161033975429824e-41, -7.098557630730226e-41, 2.0500996533072074e-41, 6.630664073492169e-41, -8.57594660166788e-42, 2.296433910350867e-40, -3.0133522176840866e-40, 1.819473952048629e-40, -2.011619997476848e-40, -1.1581731807644613e-41, 1.66441313034892e-38, 1.452165598579808e-41, 2.5358317399961187e-40, -2.7016473872796743e-40, 1.500790655291879e-42, -2.3862991808680175e-40], [-3.7406261206686667e-41, -3.90682011853759e-41, -3.0944873987684935e-39, -1.965657407846994e-40, -1.568319228287692e-40, -1.0306129815569732e-40, -8.993533544036676e-42, -2.728328110040419e-40, 2.1733158272752885e-40, 1.1878807082081474e-41, -1.4247982395715443e-40, 1.6592775116070159e-40, -1.722592380120604e-39, -1.5765168243039922e-40, 1.7571862353093909e-40, 1.3704278591557414e-40, 2.0682324554355705e-40, 2.3791245327306744e-40, -2.5093331860357364e-40, 1.3948244654196364e-40, 3.042499225742043e-41, -2.8683318396111113e-40, 2.122532770928157e-40, 1.7193932157265505e-41, 7.133309832645481e-41, -1.983159625666411e-40, -8.59738646817205e-41, 2.5598219697053596e-40, 1.1950133173915607e-40, -3.125343990952926e-40, -3.450459247660927e-40, -3.3248188273495637e-40, -2.463692895052677e-40, 1.170574672173736e-40, -1.1928973567104303e-40, -1.165614075610026e-40, -2.81534874467499e-41, -8.956118875039203e-41, 4.866366528736023e-38, 1.1771187360021328e-40, -9.885039627040125e-41, -2.6452030851366707e-40, 1.0610772101713947e-40, 9.210174286621293e-41, 6.60530057128789e-41, 1.9110908456461855e-40, 1.0639218460539741e-40, 3.5109813283351157e-40], [-2.080970258476283e-40, 1.2050438117991978e-39, 1.4701722838463818e-40, 2.4841392409456405e-39, -6.062577676054889e-41, -1.5049525117309238e-40, 4.2362653875003545e-41, 2.198062758155265e-40, 2.5735266686864563e-40, -1.4006538670312277e-40, 3.435451341108008e-40, 1.8051526817432294e-40, 3.793034683234415e-41, -2.075547233419346e-40, 1.4111075535750908e-41, 1.0193325289191584e-40, -1.3696291190310762e-40, -1.2247768967738199e-40, -3.858475321518384e-41, -6.811011185850773e-41, -2.949284851895156e-40, 3.1398334170740446e-40, 2.17250307416598e-40, 5.736215263713639e-41, -7.930928918539167e-41, -1.2786708357117523e-40, 1.3837962465054001e-40, 7.334536292122525e-41, -1.6461193190270059e-40, 8.282094313698966e-41, 7.136532819113428e-41, -1.855108971996409e-40, -1.2638871369131255e-40, 6.723416018845829e-40, -2.5587850088417592e-40, -1.327492074208829e-40, 1.499375343842911e-40, 1.6095594420927714e-40, -2.3909795177388624e-40, -1.2083396657872898e-41, 3.0848744913032253e-40, -8.665349443691804e-41, -8.75321085740497e-41, -3.579883173825967e-40, 2.49722596730397e-40, 1.77487062192917e-40, -3.1025168389690747e-40, -3.318218711582594e-40], [2.847578609354461e-41, -3.371916468735521e-40, 1.4046896066084831e-40, -2.62664989346901e-40, -3.144037312467019e-40, -2.577015901862625e-40, 2.4983750320447164e-40, 3.0259919298322965e-40, 1.7748846349138133e-41, 2.671029015834177e-40, -1.902472860090588e-40, 1.6997049723027869e-40, -3.1291695357605328e-40, 2.013876088004411e-40, 3.2752268746971084e-40, 1.4917102412430543e-40, -6.703811853329925e-41, -3.0140108279623193e-40, -1.6159073241361628e-40, 1.6136932725625296e-40, -1.2645737731606447e-40, -1.6149124022264922e-40, 7.472424061012087e-41, 9.423872302430827e-41, -1.1417920017165042e-40, -9.75373796093289e-41, -1.588077536634672e-40, 3.2019529779975638e-40, 3.009204374229685e-40, 3.9136864810127816e-41, -2.3844915058490385e-40, -3.4701615040693337e-40, 1.9556381238270715e-40, -5.667691768808155e-41, -1.0115973613960854e-40, -5.873962902756768e-41, -1.6804511314029639e-40, 1.4660384533766236e-40, 1.2406395953899768e-40, 1.4467005345689411e-41, 1.661715770934941e-40, -1.6575258885266099e-40, 2.1562620249644555e-40, -3.3918289199135765e-40, -2.809421252170896e-40, 3.1747677877896623e-40, -2.8730822414051724e-41, -1.9014218862423443e-40], [9.404674513469577e-41, -6.533371921114097e-40, -2.3982802827379947e-40, -2.8335095727726396e-40, -1.7313743175965277e-40, -2.106880267081649e-40, 1.6905544933307458e-40, -3.1695129185484442e-40, 2.221912858018073e-40, 2.553866451231979e-40, -1.595308236710588e-40, -6.507845868287956e-39, 2.8085132107660135e-39, -1.1793187745911228e-40, -5.828280572819779e-41, -9.057713013702753e-41, -9.131421312926238e-41, -2.616476466618012e-40, 5.208766521741778e-41, -1.2081434840022843e-40, 2.5717470196367638e-40, -1.5827169758580806e-36, -1.099767060771403e-40, 1.2726452523151556e-40, -3.0865280234911286e-40, 1.0981135285834996e-40, 2.8438791814086433e-40, 1.0202013339670398e-40, 1.0502605873252715e-39, 2.4664394400427538e-40, -2.50490508288847e-40, -1.3425840586696072e-41, 3.7856078013734933e-41, 3.2429269450944214e-40, 1.2561940083439823e-40, -1.5672542414548052e-40, 2.479877892315629e-41, 2.248047074377731e-40, -1.6541207332583006e-40, -5.519154131589725e-41, 2.6517891879189973e-40, -1.1302312893858245e-40, -9.032769901037771e-41, 6.759849778918274e-40, -5.570257338673364e-35, -2.122476718989584e-40, -6.449476182054971e-41, -2.0936379965937794e-40], [-1.2833567777764545e-39, 4.1795127996951994e-41, -1.7639825328613662e-40, -1.9939215978724255e-40, -1.6604097607661903e-39, -6.245366410857732e-38, 4.410818130708975e-39, -2.5257564040376233e-40, -1.6039262222661856e-40, -7.627547801012844e-41, 1.4986046296875324e-40, 8.507142847069532e-41, 1.341098682297423e-40, -1.3340081120679394e-40, -5.664889171879505e-41, -2.4452518072621625e-40, 6.375908012677918e-42, -2.655264408110523e-40, 2.8516704008702892e-40, -2.177295514913971e-40, 1.2330725836826228e-40, 1.3281506844870616e-41, -1.5666376701305022e-40, -7.704058697164979e-41, -8.507703366455262e-41, 2.246743866805909e-40, 2.5053254724277674e-40, 2.511351055824364e-40, 5.8961034184931e-41, -3.3213716331273247e-40, -3.866042333225738e-41, -2.113382291956116e-40, -5.322063501398058e-21, 3.575553161571203e-41, -6.325881657501522e-41, -6.260020629678255e-41, -4.38508328441165e-41, -2.914336468194895e-40, -1.4039188924531045e-40, -2.7363155112870703e-41, -9.5923700349751e-39, -1.949626553415118e-41, 9.634137137002766e-40, -1.9656994468009236e-40, -4.97797266466748e-41, -2.0861270368249984e-40, -1.9389766850862494e-41, 4.0971164499929e-41], [8.877926420729879e-41, -5.517080209862524e-40, -2.0000794638440544e-38, 1.4078845671071437e-40, 1.4109253847747286e-40, 3.078932985814488e-41, 2.0445645243731243e-40, -2.204746951830094e-40, 2.947365072999031e-40, -1.3593155623336456e-40, 3.440748249303156e-40, -1.8842559800543653e-40, -3.1214203552528165e-40, 2.584470809692833e-40, 4.169563580598493e-41, -8.407370396409605e-41, -1.5169476265855442e-40, 8.73008943274361e-43, 1.8746150466198105e-40, 7.551597424246439e-42, -8.415035499009462e-40, 2.769217999229417e-40, 2.904008898512821e-40, 1.6036459625733207e-40, 2.8145486032518605e-39, -2.235911829676678e-41, 3.5938120805613556e-40, -1.0298416858062494e-28, 9.478494916570209e-40, 2.8649126713581588e-40, 4.123881250661504e-41, 1.019584762642737e-40, -1.5262102094347313e-40, 1.7848198410258763e-40, -6.227930894845217e-41, 2.505745861967065e-40, 2.2921038980961033e-41, -1.1213330441373619e-40, 1.8848445254093817e-40, 3.328504242310738e-41, -1.5422107958197778e-38, 4.660998952037207e-41, -1.3085325059865142e-41, 2.2044807051218725e-40, 4.859703074278466e-41, 3.2621247340556714e-40, 1.4039609314070342e-40, -9.891065210436721e-41], [1.238779581469274e-22, 1.6148563502879192e-41, -1.7631417537827713e-40, -1.734947628680556e-40, 6.312849581783301e-42, 1.3706240409407468e-40, 4.1813344876988217e-41, -2.2254441301481717e-40, 2.3258751910863314e-41, -1.1176756551454741e-38, -8.021312669488118e-41, -1.7311781358115223e-40, -1.9511399557565888e-40, 2.3002034032199007e-40, -3.2020510688900665e-40, 1.852908933407419e-40, 2.4809989310870886e-41, 3.1459150524092143e-42, -1.675490534839254e-40, -1.755784936845066e-40, -9.994060647564595e-41, -1.4233969411072194e-40, 1.6227316476574247e-40, 6.327983605198009e-41, 1.9553718771188497e-41, 5.156778348715327e-43, -1.3835580257664649e-40, 1.8857273434419063e-41, -1.9468379694711116e-40, -2.801573980770677e-40, -2.3674517165228487e-40, 1.5076570177670707e-40, -3.5708307857464286e-40, 1.0223593336021e-40, 3.17842517678155e-40, -2.9800153272177992e-40, 1.1228184205095462e-40, 9.047623664759614e-41, 2.2729621610734263e-40, -1.7731610378026938e-40, 7.641280525963227e-40, 5.639609747583086e-40, 1.108917539743444e-40, 1.1858067864809467e-40, 1.3947824264657067e-40, -1.9972987271714483e-40, 2.2977090919534026e-41, -2.367914145016076e-41], [-1.7294965776543325e-40, -2.0736414675078643e-40, 2.2922720539118223e-40, -1.9198013169004286e-39, 1.8351404688797804e-41, -1.5253694303561364e-40, -2.269725161620836e-40, -1.678307144752547e-40, -3.461935882083747e-40, 3.436586392864111e-40, -1.7893460350656454e-40, -1.0196814522367753e-39, 1.2371924011677377e-40, -6.990517519130782e-41, 2.2843689263458242e-26, 2.605013845179835e-40, 2.726590499944656e-40, 3.2556787611197772e-40, -4.05816035268467e-42, 3.9031767425303455e-41, -1.3443356817500133e-40, 2.1461586630366736e-40, 4.88590735556134e-41, -1.964420061302995e-39, 5.647232811229013e-41, 2.8879360051270155e-41, -1.7170250213218416e-40, -2.281426003797948e-40, -4.873575929075281e-41, 9.518179689079887e-41, -2.4593768957825567e-40, -4.758389195307781e-41, -1.0502423704452352e-39, 6.593529664187562e-41, 4.930748906419734e-41, -5.32689598228436e-41, -2.5783891743576634e-43, 8.079886945296895e-41, -2.4799059182849153e-40, -2.130926548729463e-40, -1.049572549779288e-40, -3.62489288050008e-40, -3.5109252763965427e-40, -6.714181461965929e-41, 2.595863366207794e-40, 2.9799592752792262e-40, 1.2994380789530461e-40, 2.9236817276534773e-39], [8.868257461326037e-41, -3.6371822680322087e-40, 1.0307250854341192e-40, 2.224042831683847e-40, -2.6083909744788577e-40, -2.415978682342417e-40, -6.4383498722482315e-40, -2.459054597135762e-40, -1.3986079712733134e-40, 7.043066211542963e-41, 1.850764946757002e-40, 1.4509744948851318e-40, 1.2652884353774503e-40, 2.2506815154906617e-40, -1.4613441035211355e-40, -5.086152906113356e-41, 1.5834672646870433e-43, -1.3573957834375206e-40, 2.731102680999782e-40, 2.6024074300361908e-40, 1.594139553791341e-39, -1.7280112012821482e-40, -3.5324211948392854e-40, 1.521796119272108e-40, 6.133763638042589e-41, 3.151646363128303e-40, -2.764761870112864e-40, -1.776846452763868e-40, -1.2164363683141586e-39, -4.4224979534091227e-41, 1.7397120434592604e-41, 2.107104474835941e-40, -1.3623423670165872e-40, 3.4337697829508182e-40, 1.844655285452546e-40, -9.545785268827086e-41, -1.5070264334581245e-40, -1.5214878336099566e-40, -1.0107782967488106e-33, 2.8275820802685456e-40, -1.1007619826810736e-40, -1.419361201529964e-40, -2.8170723417861095e-40, -5.773349673018246e-41, 2.0713853769803013e-40, 1.5595751258703052e-40, -3.5064411213107033e-40, -1.946473631870387e-40], [6.725952369066257e-41, -1.650848701344102e-39, -2.001068220040482e-40, -3.017275853384196e-40, -1.7393617188431792e-40, 1.54889723157215e-40, 2.2644002274564016e-40, 4.362382249289588e-41, -3.1611051277624953e-40, -2.0028478690901745e-40, -1.1378543530317515e-41, -2.4493716247472775e-40, 3.2105149116145884e-40, -6.152541037464542e-41, 2.544758011213868e-41, -2.25369430718896e-40, 3.302033714319642e-40, -2.1615589331596033e-40, -3.4109286179823237e-40, 1.2515416974424239e-40, 1.0622122619274978e-40, 6.084437932098356e-42, -2.3073500253879573e-40, 2.4112983454715722e-40, -2.999381271994768e-40, 7.432627184625262e-41, 9.169536631155873e-41, -3.2623489418099634e-40, -2.1342336131052694e-40, 1.5885679910971856e-40, -1.0834699596313053e-40, 4.89949995066529e-40, -2.115007798174733e-40, 2.055550704333431e-40, 3.5340747270271887e-42, -1.2704732396954521e-40, 2.40291858065491e-40, -2.6233848680471333e-40, -1.606939013964484e-40, -4.4550080777814584e-41, 3.510098510302591e-40, 2.170513230346639e-40, -2.128796575063689e-40, 9.600996428321484e-41, -6.845623257919596e-41, 9.303050947538277e-39, 3.5275867151373647e-40, -1.4918503710894868e-40], [1.433248069311423e-40, -3.3804784023525455e-40, -2.7488571325427774e-40, -1.6046689104522778e-40, -2.3041410519046535e-40, 2.8590972827312108e-40, -6.790047760824474e-40, -1.2930621709403682e-40, -3.1297720941001924e-40, -8.577768289671503e-41, 1.1941865512976091e-40, 7.381339660830974e-41, 2.6362768139189216e-40, -6.109100785070473e-41, 2.678652079480104e-39, 2.447591975697585e-40, -1.0478349396835252e-40, -2.522056976091806e-41, -2.3372397216320056e-40, 3.4045246840003593e-40, 6.275855302325126e-41, 6.45732345345519e-41, -1.0988422037849486e-40, -2.256693085902615e-40, -2.3753410268769974e-41, 5.562563819982729e-35, 9.920632608033975e-41, 1.3263009705141529e-40, 7.733766224608665e-42, 1.942283749462056e-40, 1.5517839064086592e-40, -3.6578794463502862e-40, -3.0566103012777937e-40, -1.195587849761934e-40, -2.1531091034197247e-40, 1.3453446166443271e-40, 6.082756373941166e-41, 1.5026123432955013e-41, -9.877332485486338e-41, 2.598007352858211e-42, 8.347675081829368e-41, 4.0026689334974075e-41, -3.087060516907572e-40, 3.396649386630854e-40, -5.848094933105332e-40, 2.7981407995330812e-40, 3.1944280052441395e-40, 2.07379168670324e-36], [-1.7231627085955843e-40, 2.1590365959238187e-40, -8.618125685444057e-41, -1.1831863583526593e-40, -1.7880988794323963e-40, 2.6628174068332336e-40, 1.621568569932035e-40, -3.2645629933835966e-40, -3.1499367790018265e-40, -9.927779230202032e-41, -8.060549026489213e-41, -2.852343024133165e-41, -1.392428245045641e-40, -1.388924998884829e-40, -2.8233501589062847e-40, -3.5523476590019843e-40, -1.4881789691129557e-41, 1.8305582229014383e-40, 2.438959977157344e-41, -1.3057439220425078e-40, -2.5971525607949727e-40, -1.3576059782071693e-40, 3.5625210858529824e-41, -1.654036655350441e-40, -3.3434981358790135e-42, 1.9238566746561846e-40, -1.360520679012965e-41, 7.217107480812105e-41, -1.3945021667728417e-40, 1.9884425208769154e-40, -1.144888871322662e-40, -1.967857446435984e-40, -9.567645524870554e-41, -1.5323198707391875e-40, 2.9663246412213458e-40, -1.931493751286755e-40, -1.5369721816407459e-40, -2.819762834837613e-40, 2.5774923433404955e-40, -2.130378674661075e-36, 3.034539850464678e-40, 2.8697051121061496e-40, 1.60485107925264e-40, -2.4241202264201443e-40, 3.352732692758914e-40, -2.8031854740046506e-40, 2.974241977544781e-40, 1.9810016260313506e-40], [2.981402612697481e-40, 2.9081006900286496e-40, -1.0549255099130088e-40, 1.7081127630887358e-40, 8.465103893139787e-41, 3.0432279009434917e-40, -5.390795192257571e-41, 1.1950973952994202e-40, 1.277241511278141e-40, 1.129586692092235e-41, -5.354388522939028e-32, -1.8140649399763352e-40, -7.356957067551722e-41, -7.442716533568401e-41, 7.809506406605422e-40, 9.241703502068601e-41, -2.563129034081166e-40, -1.1151533179096894e-41, -2.5345705713782264e-40, 6.221064532370025e-41, 3.2653056815696887e-41, 9.717718671315028e-36, -9.985652856778646e-42, -7.895223833668171e-40, -1.6444097349005296e-40, -1.620545622053078e-40, -5.846217193163137e-41, 2.7907559566260894e-40, 1.152511934968589e-40, -2.77039508993945e-40, -4.5748190964812303e-41, -3.33692604608133e-40, 1.1530304154003892e-40, -2.7927317874607874e-40, 1.35364030355313e-40, -9.757661596632999e-41, -2.7829787501490867e-40, 1.0847451412338409e-41, 2.3687409111100275e-40, -2.2468839966523414e-40, -1.1543055970029248e-40, 2.9042471192517564e-40, 3.269901940532674e-40, -1.42055230522464e-40, 2.0708809095331444e-40, 2.0499455104761316e-40, -2.6207364139495594e-40, -1.8786746082709595e-39], [-9.8616379426859e-41, 3.3796376232739506e-40, -3.58045770619634e-41, -5.97233405495237e-42, 1.4576166496060315e-40, -3.1726798530778183e-41, -5.145427831154296e-41, -2.130422081282306e-40, 1.1596445441520024e-40, 2.040598849719085e-40, 2.493848838004947e-40, 1.3781770396634576e-41, -1.5050085636694968e-40, 2.4178704352692556e-40, 1.3723686575288312e-39, -2.325903217055618e-40, -1.1449547323504853e-39, 1.0015500514068765e-40, 9.99378038787173e-41, -9.900313780301265e-41, 3.326822684153548e-41, -2.3416818377639153e-40, -2.4311267187417684e-40, -3.2882869763846157e-41, -1.3497867327762368e-40, 3.371257858457288e-40, -2.357223639031742e-39, -1.053692367264403e-40, -2.5774783303558523e-40, 3.4329322218653184e-17, -3.786308450605656e-42, 9.536816958655408e-41, -5.393527724263005e-40, 2.063173767979358e-40, 1.1491488186542095e-40, 4.5292768963906737e-41, 6.006385607635463e-41, -5.612900998853055e-41, -1.789180681846855e-39, -6.659530821857261e-41, -8.656465211427984e-40, 3.3144211927442736e-40, 3.0507682879800236e-39, -2.1524057641522533e-29, -1.2759663296756054e-40, 7.018683618263711e-41, 2.057764755907064e-40, -1.5365938310553782e-40], [4.273960316190692e-42, -1.3450783699361054e-40, -1.898184886789754e-40, -5.124828743728721e-41, -1.0182255031323418e-40, -2.7180425793122747e-40, -2.2087266394687767e-40, -1.5257197549722176e-40, -1.3170243746803226e-40, -1.3096255187886875e-40, -1.4728627768978855e-40, 2.1995761604967356e-40, -1.934954958493637e-40, 3.1258764843693694e-40, 2.961364044657636e-41, 1.2555353980657496e-40, -2.729407109857949e-40, 1.6482492926927796e-40, 4.976565761009298e-39, -2.082105310232386e-40, 1.3632532110183983e-40, -1.3826331687800105e-40, 2.937373814948395e-40, 2.83234649504725e-40, -2.620554245149197e-40, -1.1607795959081055e-40, -3.328223982617873e-41, -2.039926226456209e-40, -2.028449592033389e-40, -1.195251538130496e-40, -2.944702605916814e-40, 1.1240095242042223e-40, 2.589319302379397e-41, -9.656768107201612e-41, 1.787061918568796e-40, -9.793338655534709e-40, 2.2377895696188734e-40, -1.3151045957841976e-40, -1.8129999531434483e-40, 4.8597030742784656e-42, -1.6975002133101658e-12, 3.18778585052324e-40, 1.3047069611789074e-40, 1.1284376273514887e-40, 6.956437940478403e-40, -6.714882111198091e-41, -1.7078605293651573e-40, 1.228224090996059e-40], [5.791846812747334e-41, -1.1299370167083162e-40, 3.7882702684557105e-41, -2.6870878962353395e-40, -2.599997196677552e-40, 1.0007601674885059e-37, 1.9270656481394884e-41, -2.2634893834545905e-40, -1.0305148906644705e-41, 5.871214956468227e-39, 3.114902916095242e-38, -2.8619699445830766e-40, -1.7487364055695122e-40, 2.6200077387481105e-41, -1.4815760507490572e-39, 1.082096687136267e-40, 1.3725718458061583e-40, -6.543643438857598e-41, 1.0703117670512953e-40, 2.82906745664073e-40, 1.7347934858494803e-40, -2.278956915903808e-39, 1.4845496060903545e-40, -3.4432705865389405e-41, -4.4468805466883745e-41, 1.882154032357878e-40, 6.038615472314934e-41, -1.1556508435286766e-41, -1.381357987177475e-40, -2.9947670764114394e-38, -3.2386529847782307e-40, 1.8206370297740186e-40, -4.528996636697809e-42, 1.6666903804832942e-40, -2.1488631690728205e-40, 8.147656541628572e-39, 2.926471712895948e-41, -9.315972320677816e-41, -5.903936676908676e-40, 2.808580473092301e-40, 2.9520313968852326e-40, 4.649648434476176e-41, 1.2509391391027642e-41, -6.82311840458254e-40, 3.5203836178885136e-26, 2.8606106850726816e-41, -8.130263625089372e-40, 1.3473764994175981e-40], [4.107906448168201e-41, -3.062397663935455e-41, -1.9530317086834273e-40, 1.8347340923251262e-40, -2.32004578947474e-40, 1.8965173416172074e-41, 2.5579442297631643e-40, 7.464016270226138e-40, -1.053916575018695e-40, -3.10107350155082e-42, 1.3714087680807687e-40, -1.1454634036930352e-40, -2.8202392763154836e-40, -1.9633592783655012e-41, -8.598227247250645e-41, -3.000446258827655e-40, 8.515853318323775e-38, -4.2673742134083654e-41, 8.308718984521138e-41, -3.753518066540455e-41, -3.3299896186829223e-40, -1.318173439421069e-40, 2.312142466135948e-40, 3.1673689318980273e-40, 1.8534414268238625e-40, -1.5421850119280342e-40, -1.9063188638557738e-38, -4.13668491473004e-39, -3.3630742754256312e-40, -4.1739076058379e-41, 3.4699670038424855e-38, 2.544547816444219e-40, 4.930844194715308e-39, -2.080521842967699e-40, -3.1775003197950957e-40, -1.3610146367216394e-38, -1.5024021485258526e-40, -1.3979493609950808e-40, -1.7734693234648452e-40, 1.5729154872506774e-40, 2.6428629167012482e-40, -1.4307817840142112e-40, -3.156845180430948e-40, 6.268988939849934e-41, -5.451058611768817e-18, -3.555948996055299e-40, -1.082432998767705e-40, -1.07283410428708e-40], [-2.360136938539073e-40, 2.332965761315815e-40, -1.4134757479797997e-40, -2.372776650687283e-40, -1.628523214210479e-39, -1.0610385343337794e-38, 2.8838722395804735e-41, -1.9512940985876645e-40, -1.478089620169817e-40, -2.4873047741765503e-40, -3.0222224369632627e-40, -1.2984431570433755e-40, -1.1820356120537558e-38, 8.039949939063638e-41, -1.7198836701890642e-40, 1.5839296931802705e-40, -4.259925699696324e-32, -5.90226913173613e-42, 4.849893985028192e-41, 2.1257277314268178e-40, -1.1546699346036493e-40, -3.02652442324874e-41, -2.1266105494593424e-41, 2.3469423902389655e-26, 3.4431164437078648e-40, 1.0523751467079376e-42, 1.1483781044988308e-40, 1.13239740534159e-36, 7.112991004912771e-42, 3.6305541262959523e-40, 1.3230499580769193e-40, 1.2472116851876602e-40, -2.517825054729545e-40, -2.510832575392564e-40, -2.1775057096836197e-40, 8.6933754129783e-41, -1.984701053977168e-40, -1.0038495821868335e-39, -1.6303631190941376e-39, -2.9532785525184817e-40, -1.1371677167842323e-40, -1.3846089996147085e-40, -2.3471749277440686e-41, -3.5145966783730737e-41, -7.393970404669012e-38, 2.6754431059968002e-40, -2.7084296718470064e-41, 1.3273183131992527e-39], [-1.8624657889341144e-41, -4.558704164141495e-41, -2.4409077820227556e-40, 3.542118180212413e-40, -2.2253011977048106e-37, 3.5390213106062553e-40, 1.8228931203015815e-40, 3.172483671292813e-40, 1.2392803358795817e-40, 2.1898091102003916e-40, 1.4829240998717377e-40, -1.7525899763464055e-40, -7.530774129066572e-39, 1.695136739309088e-40, 4.0405039920341775e-41, 1.3468299930165114e-40, -6.407997747510956e-41, -2.5854657316025037e-40, -1.2924175736467788e-40, 1.0921347485556114e-38, 1.5137934438721955e-38, -8.667171131695426e-41, -1.3153147905538463e-40, 7.648861550655225e-40, -2.813386926824935e-41, -6.482546825813036e-41, 7.256203707966768e-41, -2.6570020182062856e-41, 2.7384314719682008e-40, 1.7094720225991308e-40, -2.2580663583976535e-40, -1.5734900196210506e-40, -3.101858228690842e-40, -6.044080536325801e-41, 2.3197094778433022e-39, 2.0923488020066006e-40, -9.069624050649514e-41, 1.6458951112727139e-40, 2.504554758272389e-40, -2.330933878542544e-40, 3.768932349648028e-41, -4.3552356271215315e-42, 1.597396171422432e-40, 8.756714103565782e-42, 4.344305499099798e-41, -8.417459745352744e-41, 1.6325967888462714e-40, -6.013672359649952e-41], [1.2504486846402505e-40, -1.7626793252895441e-40, -1.8766889683470113e-40, -2.458255857011097e-40, 2.8688923589968412e-40, -1.370750157802536e-41, -3.3124313489249323e-40, -6.206014586863177e-40, 7.895896456931047e-40, 7.08804789224779e-41, -1.7875243470620232e-40, 7.677434026342808e-41, 3.597105131952519e-40, 5.523358026982699e-41, 4.900761119283183e-41, -4.613635063943028e-41, 3.5506240618908647e-40, 9.744909780607643e-41, 2.2897497166760376e-40, -8.785230527314792e-40, -2.0196980627341412e-38, -1.6296680750558325e-40, -3.863555588970947e-38, 1.5683612672416218e-40, -2.1083936694231198e-41, 2.2559644107011663e-40, -4.688464401937973e-41, -2.3140342190627867e-40, -1.9076576644085897e-40, 3.4851133586836795e-40, -8.568099330267661e-41, 1.283169003782235e-41, 2.0178557756430933e-40, -9.830290896038954e-40, 3.0352404996968403e-40, 1.0861170124304149e-39, 2.9817669502982053e-40, -3.6981667771996247e-41, -5.426948692637152e-41, -5.301112090540783e-42, -6.474419294719952e-41, 3.0280938775287837e-40, 9.229512205428975e-41, -6.1236742890994506e-43, -7.259426694434715e-41, -2.781703568546551e-40, -2.4897430335044755e-40, 7.713867786415253e-41], [-0.03699635714292526, 0.045978691428899765, -0.08771958947181702, 0.06440795958042145, -0.12655383348464966, 0.07132311910390854, -0.0034700778778642416, -0.03532120957970619, -0.037523046135902405, -0.000465155957499519, -0.04602031037211418, -0.0042032282799482346, 0.006236282177269459, 0.022426411509513855, 0.022921781986951828, -0.00652664341032505, 0.01987358368933201, -0.03735233098268509, -0.030237868428230286, -0.023957714438438416, 0.03560950234532356, 0.009040375240147114, 0.05003189295530319, -0.00253333174623549, 0.004435073118656874, 0.005409042816609144, 0.0605582557618618, -0.0008836638880893588, 0.05581003800034523, -0.03035324066877365, -0.0008434666669927537, -0.0197682436555624, -0.09718749672174454, 0.007012096233665943, 0.026420041918754578, 0.03130317106842995, -0.07936020940542221, 0.016273777931928635, -0.010791346430778503, 0.00981123000383377, -0.005822300910949707, -0.005576346535235643, -0.0344717800617218, -0.009682655334472656, 0.026090916246175766, -0.033814240247011185, -0.00304711377248168, 0.022694408893585205], [-0.00887700542807579, 0.014158015139400959, -0.06637099385261536, -0.02121570147573948, -0.0025927620008587837, -0.013103832490742207, 0.0010799833107739687, -0.02407671883702278, -0.036315567791461945, -0.006576256360858679, -0.0010301918955519795, -0.0068377223797142506, 0.05833211541175842, -0.0038121268153190613, 0.012484592385590076, -0.011210295371711254, 0.00133520585950464, -0.00302076805382967, -0.03372996300458908, -0.03990675508975983, -0.06831326335668564, -0.03140844777226448, 0.04433007538318634, 0.030185991898179054, -0.024681201204657555, 0.013970579020678997, 0.06420138478279114, 0.03292926400899887, 0.017802266404032707, -0.013446344062685966, 0.0017204191535711288, -0.02862488105893135, -0.05127597227692604, 0.024434277787804604, -0.025305021554231644, 0.00010895234299823642, -0.07303470373153687, 0.032303184270858765, -0.020673269405961037, 0.005373064428567886, 0.016743414103984833, 0.03648700565099716, 0.0008250876562669873, -0.03306591138243675, 0.02695518732070923, -0.03231360763311386, 0.027780530974268913, 0.022136811167001724], [0.01771967113018036, 0.06396780163049698, 0.09426876157522202, -0.021208010613918304, 0.003669572528451681, 0.03269164636731148, -0.0031381372828036547, -0.021728159859776497, 0.005300944205373526, -0.008080922067165375, 0.0019967074040323496, -0.01974969357252121, 0.03467986732721329, -0.036966968327760696, 0.022218763828277588, 0.0008024299168027937, -0.01929868943989277, 0.015019701793789864, -0.025464115664362907, 0.00835247989743948, 0.02161348983645439, -0.0388856902718544, -0.02864932268857956, -0.014993674121797085, -0.007188648451119661, -0.02857932634651661, 0.0319119468331337, -0.014900178648531437, -0.013519920408725739, 0.01125757023692131, 0.027252936735749245, 0.018391985446214676, 0.01057814434170723, -0.052873700857162476, 0.0084835859015584, 0.006671193987131119, 0.030407393351197243, -0.011203006841242313, -0.005332727916538715, -0.03406378626823425, 0.014892494305968285, 0.01621278189122677, -0.06699762493371964, 0.033929627388715744, -0.007215859368443489, 0.019132807850837708, -0.04510880634188652, -0.026620352640748024], [-0.03357136249542236, 0.020924123004078865, 0.0007285535684786737, 0.02587132900953293, -0.05405464395880699, -0.019560430198907852, 0.02482612244784832, 0.017280498519539833, 0.03300246223807335, -0.02372531034052372, -0.00734455231577158, 0.0009928520303219557, 0.020439421758055687, 0.02866530790925026, -0.027233177796006203, 0.00821598805487156, -0.024257812649011612, -0.019369475543498993, -0.008828841149806976, -0.01240174937993288, 0.04188146814703941, -0.021653898060321808, 0.04879419505596161, -0.0445682555437088, -0.04666867479681969, 0.02038612961769104, -4.0207087295129895e-05, 0.023100031539797783, 0.04229247197508812, -0.017164353281259537, -0.011490175500512123, 0.06474201381206512, -0.04158146679401398, 0.07933603227138519, -0.009084842167794704, 0.07544126361608505, -0.054516494274139404, 0.0634869858622551, -0.019288314506411552, -0.02107643149793148, 0.0006457649869844317, 0.020135339349508286, 0.02060508355498314, -0.02469652332365513, -0.008164901286363602, -0.06916782259941101, -0.02484191581606865, 0.01592230051755905], [0.014040959067642689, -0.03865577280521393, -0.05524411424994469, 0.002791795413941145, -0.09008301794528961, 0.0055496832355856895, 0.014363251626491547, -0.0351141095161438, 0.027012325823307037, -0.03184724226593971, 0.018280597403645515, 0.00952067505568266, -0.00808100774884224, 0.01662931777536869, -0.023778067901730537, 0.000154112494783476, -0.04476504400372505, -0.005616812035441399, 0.01416022889316082, 0.005356697831302881, -0.027837738394737244, -0.015602096915245056, 0.03434942290186882, -0.03582513704895973, -0.007544827181845903, 0.012436243705451488, 0.048462312668561935, 0.037521470338106155, -0.03154167905449867, 0.015132236294448376, -0.02475578524172306, 0.035537075251340866, -0.03990921005606651, 0.00736320111900568, -0.00414423318579793, -0.017382364720106125, -0.04497360810637474, 0.06760264188051224, -0.058188747614622116, -0.014371534809470177, 0.008286397904157639, 0.04794110730290413, -0.01652682013809681, -0.007908890023827553, -0.0020458968356251717, -0.025508739054203033, 0.023868054151535034, 0.007240610662847757], [0.015766965225338936, 0.05178311839699745, -0.008482849225401878, -0.024843376129865646, -0.03737589344382286, -0.004344621207565069, 0.004607209004461765, 0.005032213870435953, -0.009263239800930023, 0.0032728041987866163, -0.018370967358350754, -0.011447961442172527, 0.05751647800207138, -0.012782853096723557, -0.014367924071848392, 0.0033018675167113543, -0.01763707771897316, -0.005252056755125523, 0.033805400133132935, 0.007355356123298407, 0.0037242420949041843, -0.0007773350807838142, 0.024465912953019142, 0.009149576537311077, 0.02299121581017971, -0.004520040936768055, 0.0010230739135295153, 0.00024996098363772035, -0.01274098176509142, -0.018113998696208, -0.004324819426983595, 0.014742226339876652, 0.037355467677116394, -0.006868160795420408, -0.04383984953165054, -0.019390769302845, -0.015887286514043808, -0.025705913081765175, -0.029787424951791763, -0.019290033727884293, -0.00914910901337862, 0.029160182923078537, -0.010012701153755188, 0.024251112714409828, 0.00014937476953491569, 0.035937629640102386, 0.010135076008737087, 0.01557729858905077], [-0.031328823417425156, -0.010647553019225597, -0.04233551770448685, 0.022875767201185226, 0.0297753494232893, 0.016511498019099236, 0.02635684795677662, -0.03217242658138275, 0.03799166902899742, -0.03567364066839218, -0.0005665435455739498, 0.012170652858912945, 0.0002701994962990284, 0.017986521124839783, 0.022039949893951416, 0.0121171148493886, -0.0035033042076975107, 0.0019351684022694826, -0.036876749247312546, -0.0028074674773961306, 0.02050674520432949, -0.035089462995529175, 0.028057169169187546, -0.021037321537733078, -0.007457172963768244, 0.02073523961007595, -0.024902036413550377, -0.012664669193327427, 0.020962271839380264, 0.018993757665157318, 0.01189905684441328, 0.050808120518922806, -0.024263793602585793, 0.0026424285024404526, 0.021805034950375557, 0.021729234606027603, -0.033308640122413635, 0.015696633607149124, -0.015272039920091629, -0.005230385810136795, 0.02047126740217209, 0.023423923179507256, 0.008653218857944012, -0.024910684674978256, -0.0027201094198971987, -0.03329350799322128, -0.016850735992193222, 0.01814115233719349], [-0.032156575471162796, 0.014613799750804901, -0.01141332183033228, 0.026531949639320374, -0.013391423039138317, -0.009751087985932827, -0.0015853329095989466, 0.01248606014996767, 0.002367558889091015, -0.014360702596604824, 0.014748374931514263, -0.0025126568507403135, -0.01378787774592638, 0.020005851984024048, 0.0246133916079998, 0.006026081275194883, 0.011226358823478222, -0.002716309856623411, -0.0023937297519296408, 0.017750754952430725, -0.022205771878361702, 0.00310984393581748, 0.019852904602885246, 0.0023966114968061447, 0.006511546205729246, 0.027544386684894562, -0.024218054488301277, -0.004063039552420378, -0.01409450825303793, 0.013447883538901806, 0.03666286915540695, 0.0007014247821643949, -0.04346650838851929, 0.02090584672987461, 0.016765348613262177, 0.013383143581449986, -0.03757204860448837, 0.02864832989871502, -0.035044629126787186, -0.0027720436919480562, 0.014005162753164768, 0.0305501576513052, -1.4139077393338084e-06, -0.0332053080201149, 0.031344909220933914, -0.027095932513475418, -0.008154698647558689, -0.017741719260811806], [-0.01668732240796089, -0.0037675746716558933, 0.009585555642843246, -0.0652981847524643, 0.039385367184877396, -0.011564415879547596, 0.009686214849352837, 0.031638942658901215, 0.01505191158503294, 0.0059873140417039394, 0.022954456508159637, -0.006243510637432337, 0.004417652264237404, 0.05729706585407257, 0.012655475176870823, 0.008893447928130627, 0.03010781854391098, 0.015659764409065247, -0.023463940247893333, 0.042681433260440826, -0.028215894475579262, 0.00545755960047245, -0.035139553248882294, 0.02658248506486416, 0.02522897534072399, -0.0006970350514166057, -0.02387784793972969, -0.01295570656657219, -0.012726441025733948, -0.004347569774836302, -0.0042457315139472485, 0.034844521433115005, 0.021348068490624428, -0.005728178657591343, -0.03147469088435173, 0.017147840932011604, -0.08315732330083847, 0.0021042723674327135, -0.012938203290104866, -0.0018758197547867894, -0.006678328383713961, 0.002350246999412775, -0.006943004671484232, 0.019753824919462204, 0.010274862870573997, 0.013731244020164013, -0.0007904373342171311, -0.038598738610744476], [-0.0017426784615963697, -0.01238316297531128, -0.028505779802799225, 0.01905081979930401, 0.030418647453188896, 0.0353056825697422, 0.005577421747148037, 0.003468852024525404, 0.021373188123106956, -0.03293416649103165, -0.017004311084747314, 0.018263494595885277, -0.01119730994105339, -0.011494146659970284, 0.02528737112879753, 0.006593446712940931, 0.013591720722615719, 0.0041220467537641525, -0.0114663764834404, 0.02478700503706932, 0.006892592646181583, -0.013042506761848927, 0.02479688636958599, -0.014111198484897614, 0.0064628818072378635, 0.02096799947321415, -0.010567961260676384, -0.03560599684715271, 0.004991195630282164, 0.004996407777070999, 0.0003566902014426887, 0.011932127177715302, 0.002367977285757661, -0.0319082997739315, -0.019170409068465233, 0.011681717820465565, -0.01495311502367258, 0.02018728479743004, -0.0034117961768060923, 0.01124446839094162, -0.012923943810164928, 0.01578610949218273, 0.014372153207659721, -0.0022921618074178696, 0.009885447099804878, 0.01583889126777649, -0.009602604433894157, -0.03114631399512291], [-0.011658607982099056, -0.01456795446574688, -0.03168145567178726, 0.012779735960066319, 0.003914790693670511, 0.0034913113340735435, 0.01077699102461338, -0.015957897529006004, -0.0035399803891777992, -0.008587313815951347, -0.022166308015584946, 0.015372093766927719, -0.013984167017042637, -0.00844215415418148, -0.013555789366364479, 0.008891281671822071, 0.026954246684908867, 0.00620339997112751, -0.003513267496600747, 0.03628896176815033, -0.005132555030286312, -0.010057137347757816, -0.010705416090786457, -0.011079422198235989, -0.008409111760556698, 0.03212486207485199, -0.014177833683788776, -0.014589148573577404, -0.013384953141212463, 0.011617831885814667, 0.01754746213555336, 0.00722810672596097, 0.012465464882552624, 0.0343649797141552, -0.0028305803425610065, -0.006775219459086657, 0.004425563849508762, 0.015429168939590454, -0.016397176310420036, 0.024470295757055283, -0.009034409187734127, -0.008290464989840984, -0.021200140938162804, -0.02374539151787758, 0.027216335758566856, -0.010532242245972157, 0.0026264383923262358, -0.01575285755097866], [-0.025667110458016396, -0.013589058071374893, -0.03526942431926727, -0.016556229442358017, -0.026105687022209167, 0.011214160360395908, 0.005389025434851646, 0.005462854169309139, -0.01150779239833355, 0.012956324964761734, 0.0026822781655937433, 0.002252638339996338, 0.004194623790681362, -0.008277652785182, 0.016659118235111237, 0.013530374504625797, -0.024409806355834007, 0.02376125566661358, 0.020370405167341232, 0.009762894362211227, -0.004891864489763975, 0.018383529037237167, -0.011991328559815884, -0.011684680357575417, -0.0353623703122139, -0.03737423196434975, -0.019655082374811172, -0.007335462607443333, 0.015509561635553837, 0.016686728224158287, 0.029289942234754562, 0.026983706280589104, 0.024745309725403786, -0.04057484120130539, -0.00817095022648573, 0.029253540560603142, -0.03518375754356384, -0.007990694604814053, -0.0241127610206604, 0.0048055145889520645, -0.008106078021228313, -0.025600716471672058, -0.022176027297973633, -0.014682465232908726, 0.010402500629425049, 0.006329763680696487, -0.0046561844646930695, -0.023411907255649567], [-0.0036072880029678345, -0.00879764650017023, 0.0026340745389461517, 0.030748436227440834, -0.007262900471687317, 0.021567517891526222, 0.0048072002828121185, -0.009847920387983322, -0.002572239376604557, 0.02118127979338169, -0.012952478602528572, -0.0017509200843051076, -0.024694496765732765, 0.005662187468260527, -0.013688808307051659, 0.012884402647614479, 0.0023629788774996996, 0.002241938840597868, -0.0037840306758880615, -0.008466017432510853, -0.020331349223852158, -0.02597755193710327, -0.0019905990920960903, -0.01320191752165556, -0.01352164801210165, 0.02055286429822445, -0.018865304067730904, -0.019113656133413315, 0.02460288256406784, 0.013433774001896381, 0.05659692361950874, 0.011568603105843067, -0.002308280672878027, -0.036349356174468994, 0.00991517398506403, 0.03258385509252548, -0.00840713083744049, 0.019026899710297585, 0.0033517132978886366, 0.014531157910823822, -0.022353781387209892, 0.004196299239993095, -0.027038555592298508, -0.01675795391201973, -0.01604345440864563, -0.005640167742967606, -0.006241532973945141, -0.014828229323029518], [-0.01776799187064171, -0.0023358375765383244, -0.011036592535674572, -0.001197820296511054, 0.012622819282114506, 0.005594720132648945, 0.012425991706550121, -0.00316027388907969, 0.007033473812043667, 0.013598734512925148, -0.002280481392517686, 0.007205135654658079, -0.0029542171396315098, -0.022355837747454643, -0.007824890315532684, 0.0022596544586122036, -0.024664409458637238, 0.017475640401244164, -0.02000713162124157, 0.016666293144226074, 0.00416197394952178, -0.011004019528627396, 0.029606355354189873, -0.009874199517071247, -0.008190239779651165, 0.024744806811213493, -0.008493266999721527, -0.010055913589894772, 0.017080942168831825, 0.004861351102590561, 0.03100813739001751, 0.027061831206083298, 0.012024534866213799, -0.015423101373016834, 0.00730347353965044, 0.009935222566127777, -0.014504186809062958, 0.020566824823617935, -0.002914771670475602, 0.013685571029782295, 0.012683134526014328, 0.01859983429312706, -0.0022444187197834253, 0.026500418782234192, -0.0039644623175263405, 0.0022927774116396904, -0.009967136196792126, 0.0007994798361323774], [0.01598912663757801, 0.0011789032723754644, -0.0020566582679748535, 0.003779575927183032, 0.009948240593075752, 0.01626945100724697, 0.01491304486989975, 0.026614543050527573, 0.010118228383362293, 0.02234361134469509, -0.018470564857125282, -0.004758742172271013, 0.0013484734809026122, 0.03571102395653725, 0.0038011029828339815, 0.011045843362808228, -0.01440197229385376, 0.00038015004247426987, -0.0026317108422517776, 0.007035897579044104, 0.005127216223627329, -0.008738242089748383, 0.011458748020231724, 0.014129751361906528, -0.006619808729737997, -0.010243302211165428, -0.008158714510500431, 0.00478712935000658, -0.02441437728703022, 0.0028187022544443607, -0.002118014032021165, 0.013773125596344471, -0.0025218515656888485, -0.0262757521122694, -0.0006645263638347387, -0.04200749099254608, 0.015071522444486618, 0.005733258090913296, 0.0014163586311042309, 0.011980957351624966, -0.01950916461646557, 0.010997048579156399, -0.0015616549644619226, -0.010689588263630867, -0.02346639893949032, -0.014683611690998077, -0.024246176704764366, 0.018165377900004387], [6.360675898370707e-40, -1.8975963414347375e-40, -1.1532686361393244e-42, 2.685868766571377e-40, 3.7750167875801263e-39, 2.67824570292545e-40, -2.9213023228610537e-39, 7.264751628599149e-41, -2.0262445092495727e-27, -2.1198422778766535e-40, 1.4702745786342775e-39, -2.701745478172177e-40, -3.0054909332992244e-40, -9.693892707416969e-39, -1.3112790509765908e-40, -2.1028305145197502e-40, 1.772894791094472e-40, -3.4356335099083703e-40, 4.682298688694944e-41, -8.097263046254523e-40, -3.43071495229859e-40, -8.219316142497215e-41, 2.2331652846866015e-40, 1.0714608317920416e-40, -1.3962397768686045e-40, -5.757935389910673e-42, -3.5328135584092963e-41, -2.7225967993213303e-40, -8.82607837754986e-41, 1.3059120778582268e-40, -1.6110728444342422e-41, 3.5328135584092963e-41, 3.046170627718574e-40, -2.5151065357087547e-40, 1.9112029495233315e-40, 2.339748045883147e-41, -3.3432823359155075e-39, 1.495759993804953e-40, 1.0985058921535106e-40, -4.2147453263666296e-35, 6.426635017086476e-41, -9.470955930832141e-41, -1.9855138070864766e-40, -2.621787387797803e-40, -1.0943860746683956e-40, 3.47075004942435e-40, 8.302553271278109e-41, -1.27029107089509e-40], [1.1104869940234878e-40, -2.37927867556175e-40, 1.322811737337984e-40, -5.437458431119588e-41, -1.6087186630141765e-40, -1.432042111853025e-38, -2.4875850338694153e-41, 3.0315690977203093e-40, 1.3967022053618317e-40, -1.4222759023357596e-40, 7.973388262008209e-41, 2.173736216814586e-40, 1.6026650536482933e-40, -8.581832055218045e-41, -1.6612253164724274e-40, 1.9394811525334063e-40, -1.8618860717594232e-38, -2.93053547844249e-41, 1.3545091086010114e-40, -1.7480077303680633e-40, 2.987974702495164e-40, -3.302818441459664e-40, -1.2034911731007259e-40, 1.6310693735201573e-40, -9.308965828356192e-41, 1.0893974521353993e-40, 2.693169531570509e-40, -8.659043600602342e-41, 2.1035872156904856e-40, 2.2389946862981927e-41, 3.354708523593612e-40, -1.4396800292626738e-40, 2.9488084104172856e-40, 1.3940537512642578e-40, -4.733165822949935e-41, 1.6496365781724612e-40, 1.482601801224943e-40, 1.5367199479171674e-40, -3.03036398104099e-40, 7.680516882964322e-41, -2.617443362558396e-40, 3.0310646302731523e-40, 3.3172378026575665e-40, 4.593876755596048e-41, -3.3393082534706823e-40, 2.1528148307422165e-41, -1.2066581076301e-40, -3.1729601127706833e-41], [2.9281252450838513e-40, -2.5355795062725402e-40, -1.2463709061090653e-40, -1.3203034130868426e-40, -2.23613603743097e-40, -2.002203271796585e-40, 4.813880614495044e-41, -3.51682474293135e-40, 5.183963538923228e-41, 8.684421115791265e-40, -1.0841664049680747e-39, -1.747138925320182e-40, 5.923568868393867e-41, -2.424106213435501e-40, -2.962723304168031e-40, 1.8204828869429428e-40, 2.5022846547601826e-40, 6.449728415778549e-40, 1.705814633607243e-40, -3.245659477099855e-40, 4.926124621487462e-41, -1.2585061508101182e-40, 5.337545850613228e-41, 3.450178987968062e-40, -2.2702576550372794e-40, -3.471072348071145e-40, 3.573170954181851e-41, -3.0417985765098804e-41, 3.320854553993989e-39, 2.0396599797479875e-40, 1.6099518056627823e-40, -2.3942025042068095e-40, 5.410009796800393e-39, 1.1994554335234704e-40, 1.2840798477840461e-40, 2.0082008292238953e-41, 2.5077637317556926e-41, 2.8569953350347235e-40, 1.0315378385434276e-39, -4.549735853969816e-41, -2.5327628963592474e-40, -3.1998089913471468e-40, -2.6613460434456926e-40, 2.8540974498104998e-39, 1.9997930384379464e-40, -6.982109728344834e-41, -2.4209532918907702e-40, 2.8528054526263923e-40], [-1.1263496926396447e-40, -2.6352959049938942e-40, -1.8381532605780788e-40, 7.63909450035888e-40, 2.3823335062139783e-40, -3.2540112159472307e-40, -1.535803498721499e-39, -2.2451884255105084e-40, -2.554370918679136e-40, 1.4834706062728243e-40, -4.1408369620798344e-41, -1.969328809823525e-40, 1.2521022168281538e-40, -1.1652497380093016e-40, -3.2613358030202565e-39, 2.63381052862171e-40, 2.994785013031783e-40, -9.910683388937269e-41, 3.7958372801630645e-41, -1.4916934256614824e-38, 2.0952354768431097e-40, -4.534321570862243e-41, -1.542170998943391e-40, -8.185124459967689e-41, 3.090227451436946e-40, -1.2671241363657158e-40, -9.832350804781511e-41, 2.8366204553634407e-40, 1.357367757468234e-40, 6.744869898334642e-41, 3.002422089662353e-41, -4.172280698320819e-39, 1.2260100394224257e-40, -6.13096104111394e-41, -2.622011595552095e-40, 2.3772608057731224e-39, -3.0355207593897052e-40, -3.3288265409575327e-40, -8.282094313698966e-41, 2.7091163080945256e-40, 1.7170670602757713e-40, -5.519014001743292e-41, 2.972378250587229e-40, 2.716977592479388e-40, 2.4814473465956726e-40, -1.886161745965847e-40, -1.9458290345767977e-40, 4.914073454694269e-41], [-1.6542468501200898e-40, -1.7045394520047075e-41, 1.378597429202755e-41, -2.9437357099764297e-40, 3.304401908724351e-41, 5.371359182557386e-40, -2.2764093552956653e-41, -1.3834599348739621e-40, -1.82754543120314e-40, -1.7480777952912796e-40, -3.373626052861997e-41, -1.7154976059957276e-40, 5.178218215219497e-41, -3.5297307017877817e-41, 1.210506073213136e-39, 2.5628768003575877e-40, -1.7631137278134848e-41, 1.480513866513099e-40, -1.934954958493637e-40, -1.9010435356569766e-40, 1.1494150653624312e-40, -2.703553153191156e-40, -1.4329257706646282e-40, 2.030873838376671e-40, 7.193565666611448e-41, 9.857854436832223e-41, 1.8285823920667403e-40, -1.395132751081788e-41, -4.1919843560276903e-41, 2.426698615594502e-40, 1.4963065002060397e-41, -1.1896463442731967e-40, -1.8498260767859045e-40, 7.823379261402237e-40, -1.5244725993389685e-40, 3.3343476569069725e-40, -1.6093912862770524e-40, -1.1001454113567706e-40, 2.8648566194195858e-40, 1.1635681798521119e-40, -1.630312672349422e-40, 1.4919064230280597e-40, 1.819586055925775e-40, -3.3773675197617444e-40, -2.54058214179018e-40, 3.0290467604845246e-41, -4.3255280996778453e-41, -1.4122846442851236e-40], [9.760436167592362e-40, 2.105969423079838e-40, 5.828560832512644e-41, 3.017219801445623e-40, 2.335684280336605e-41, 9.85771430698579e-41, -3.507492095158947e-40, -3.6660770423665864e-41, 4.531098584394296e-41, -3.4015959702099204e-40, 2.7477921457098905e-40, -2.8603304253798166e-41, 1.3019884421581173e-40, 8.090817073318629e-41, 5.505561536485774e-41, 2.3404402873245235e-39, -3.571069006485364e-41, -1.7239053967816765e-40, 9.829349223470928e-39, -1.5955184314802367e-41, -3.6543341612355445e-40, -1.831216833179671e-40, -3.0680448967466842e-40, 6.499803816401196e-39, 1.9145380398684246e-40, -2.7984350722105894e-40, 1.466402790977348e-40, 1.9206196752035943e-41, -1.328290814333494e-41, 2.067125429648754e-40, -3.3373324226359843e-41, -2.2199370271833752e-41, -8.776332282066329e-42, -2.3569840169943423e-41, -1.4334442510964284e-40, -7.48615678596247e-41, 8.971953547686074e-41, -2.3870278560694664e-40, 2.9696317055971523e-41, -7.362842521101886e-41, 9.542730438174858e-40, -7.193145277072151e-41, -3.321665905804833e-40, -1.2911704180135297e-40, -1.8642314249991636e-40, 2.1233455240374656e-40, -1.2586743066258372e-40, -1.5650542028658152e-40], [-2.994855077954999e-41, 1.9487437353825934e-40, 1.6514022142375104e-40, -1.33608203379514e-40, 3.2018128481511313e-40, 1.3291596193813755e-40, 1.1406849759296876e-40, -3.05719884663281e-40, -2.061982664284682e-40, 4.4328675620451263e-41, 2.5132848477051324e-40, -9.159447282212734e-41, -2.642330423284805e-40, -2.2771100045278277e-42, -1.24121412776035e-40, -3.651380224072748e-39, -6.636829786735199e-41, -3.539776338363362e-23, 2.6303913603687574e-40, 8.298909895270864e-41, 1.127301342452737e-37, 3.0015392716298284e-40, 3.9672160823499896e-41, -6.338353213834013e-41, -1.4311461216149357e-41, 2.6560211092812583e-41, 1.4840030996892678e-40, -1.3064725972439567e-39, -2.023657151285398e-40, -1.3076356749693463e-40, -6.458080154625925e-40, 2.086827686057161e-40, 2.0724083248592585e-40, 2.289721690706751e-40, 3.0024770205621546e-37, 1.8278397038806481e-40, 3.469054478282517e-40, -5.185462928280056e-40, 5.197882636569367e-39, -2.6332219832666935e-40, 2.444705300861076e-40, 5.060706687749434e-33, 1.355913218630575e-35, 6.016488788632688e-16, -6.942032592265144e-41, 6.415845018911175e-41, -1.966217927232724e-40, -1.7087013084437522e-40], [-0.18168680369853973, 0.02852143906056881, 0.024776441976428032, -0.06704423576593399, -0.08050527423620224, 0.14113865792751312, -0.008234681561589241, -0.14336088299751282, 0.06188153102993965, -0.10315455496311188, -0.022112509235739708, -0.008167151361703873, 0.12329330295324326, 0.19025114178657532, 0.015770651400089264, -0.0002638029691297561, 0.27943292260169983, 0.013706840574741364, -0.348613977432251, -0.10956727713346481, 0.039667338132858276, -0.09062599390745163, 0.0717601627111435, -0.03431258350610733, -0.10390697419643402, -0.25433123111724854, 0.1114237979054451, 0.20373092591762543, 0.09463425725698471, 0.024875879287719727, 0.008810272440314293, 0.09835834056138992, -0.024246931076049805, 0.18773677945137024, -0.06345009058713913, -0.1305186003446579, 0.04122027009725571, 0.25741177797317505, 0.03107614256441593, -0.11992154270410538, 0.024397745728492737, -0.04075612872838974, -0.17461808025836945, -0.1535489708185196, 0.029799848794937134, -0.18062084913253784, -0.10822070389986038, 0.12881216406822205], [-0.002415673341602087, -0.016311870887875557, 0.006254532374441624, 0.046647004783153534, -0.01729220151901245, 1.2572112609632313e-05, 0.032921526581048965, 0.07890196144580841, 0.007336715701967478, 0.024272359907627106, 0.029492927715182304, -4.807697041542269e-05, 0.022511698305606842, 0.02073412574827671, -0.05352544039487839, 0.007636304944753647, -0.02875485084950924, -0.002145578386262059, 0.060179438441991806, 0.01998121850192547, -0.017377300187945366, 0.02622056193649769, -0.0326874814927578, -0.03658512979745865, 0.031590625643730164, 0.005511241499334574, 0.010962095111608505, -0.014690178446471691, -0.027757111936807632, -0.01169552095234394, -0.005413583014160395, 0.011993308551609516, 0.017715439200401306, 0.0438721589744091, 0.003468549344688654, 0.018703142181038857, 0.055173419415950775, -0.023018864914774895, -0.014533926732838154, -0.027227772399783134, 0.014966658316552639, 0.01730569265782833, -0.022842299193143845, -0.023013101890683174, -0.010900164023041725, -0.037211380898952484, 0.03775326535105705, 0.022019632160663605], [-0.03573749214410782, 0.013056589290499687, -0.08311298489570618, 0.0020863336976617575, -0.01383788138628006, -0.005516543053090572, 0.025841135531663895, -0.006177901290357113, 0.020785581320524216, -0.011528016068041325, -0.02749427780508995, 0.020786909386515617, 0.03865668922662735, -0.03138819709420204, -0.04577801004052162, 0.0015403092838823795, 0.02415444515645504, 0.003644866868853569, -0.008367535658180714, -0.03750280663371086, 0.015871554613113403, 0.03399593383073807, 0.015851184725761414, -0.024406250566244125, 0.010754493065178394, -0.02895376645028591, -0.027428368106484413, -0.037569738924503326, -0.026386845856904984, 0.01698523387312889, -0.00872005708515644, 0.016657833009958267, -0.0059796953573822975, 0.0037013015244156122, 0.054416246712207794, -0.07446122169494629, -0.025890182703733444, 0.0303657129406929, -0.001450061914511025, -0.015584145672619343, -0.03767339885234833, -0.03660593181848526, 0.0020322834607213736, 0.027448806911706924, -0.023688144981861115, 0.02318629063665867, -0.00613887794315815, -0.006921035703271627], [0.007392111700028181, -0.007693586405366659, 0.045620858669281006, 0.0007433848222717643, 0.0009670354193076491, 0.07483744621276855, 0.027180379256606102, -0.02171841636300087, 0.044346440583467484, 0.07773789763450623, 0.08169068396091461, -0.01815570332109928, -0.009237212128937244, 0.007641013246029615, -0.06071113422513008, -0.013813850469887257, 0.012665169313549995, 0.045411862432956696, 0.0031970643904060125, 0.03208877891302109, -0.09225861728191376, 0.00015029008500277996, 0.09110121428966522, -0.001885398873127997, -0.012833399698138237, -0.0099724642932415, -0.043838925659656525, -0.0003363987780176103, -0.025055894628167152, 0.019737180322408676, -0.06827240437269211, 0.04142994061112404, 0.0033566057682037354, 0.03093174658715725, -0.05101637542247772, -0.0010940742213279009, 0.0075457035563886166, -0.08652547001838684, 0.010474656708538532, 0.07396966218948364, -0.055984534323215485, -0.038829345256090164, 0.004290476441383362, 0.005432799458503723, -0.04754725471138954, 0.08432745188474655, 0.045799657702445984, 0.02950393036007881], [-1.8243504707044793e-41, 8.330579240564605e-41, 4.5274552083870515e-41, -9.412101395330499e-41, 1.8988995490065596e-40, 3.1798545012151614e-40, -2.400382230434482e-40, -1.1305255620633327e-40, 9.144425362675172e-40, -2.345213109894014e-41, 2.8299502746732546e-40, 3.0385755900419333e-41, 1.7563893391437201e-22, -5.980069222475443e-40, 6.642855370131795e-41, 3.366619560540373e-41, 1.7794108289535825e-40, -9.588342703188631e-40, 5.452172064994998e-41, -7.404180825799468e-41, -2.3970331271047456e-40, 4.912391896537079e-41, 7.421977316296394e-41, 1.6568602717560556e-39, 2.484978618725771e-40, -2.2104081976259664e-41, 3.5713492661782288e-40, -1.2457403218001191e-40, 5.149299618811225e-39, 1.8221083931615596e-41, -1.9722014716753908e-40, -1.408346995600371e-40, 2.2885445999967182e-40, 2.4461626512639737e-40, -2.5580128933879162e-39, -2.8332713520337044e-40, -3.3128797644335163e-40, 1.2529850348606784e-40, 2.838105831735625e-40, 1.1329498084066146e-40, 4.193286162301048e-39, -1.3551396929099576e-40, -3.530081026403863e-40, -9.894288196904668e-41, 3.7455104865959173e-38, 1.6401217615996956e-40, 9.978646364457022e-41, 7.624184684698465e-41], [-3.773836894273165e-41, 3.231786622303039e-40, 1.4804718275591692e-40, -1.3047770261021237e-40, 2.2131127036621133e-40, 2.0358064089710942e-40, -2.5819624854416917e-40, -7.955731901357716e-41, 7.652434861739253e-40, -1.5860036149074712e-40, 3.468872309482155e-40, 2.2901420802460485e-40, 2.1436783647548187e-40, -2.1123733570618022e-40, -2.8136671865178e-41, 7.717511162422498e-41, 5.84075212915227e-41, -9.20498948230329e-41, -1.5329364420634904e-40, -3.1411366246458667e-40, 1.2975743519954941e-40, 1.8763666697002166e-40, -3.00896615349075e-40, -3.214718807007563e-41, 2.6341328272685046e-40, 1.6530099239656303e-38, -2.682253416533419e-40, 5.426808562790719e-41, -2.0765841942829464e-40, -7.454907830208027e-42, 9.241563372222169e-41, -1.6754484958853243e-40, 1.9471742811025496e-40, 8.162465463799557e-40, 2.494016993820666e-40, 2.1396706511468497e-40, 7.441175105257644e-41, 9.801991299698936e-31, -5.074204314367751e-38, 1.6566430704940852e-40, 3.1005269951497335e-40, -1.7696998305958115e-40, 2.4899252023048377e-40, -1.0231580737267652e-40, -7.167641645021439e-41, 3.0505146529579808e-40, -1.9968503116628643e-41, -1.2156544437710653e-40], [2.4780562043120065e-40, -5.114459135092717e-41, 1.2503225677784613e-40, 3.2959941179384022e-40, -4.053676197598831e-41, -1.1486023122531228e-40, 1.0031010317599052e-24, -1.9035798858774045e-40, -1.734723420926264e-40, 2.473740205041886e-40, -3.2558469169354962e-40, 1.850750933772359e-40, 3.7487536517617506e-41, -1.5309045592902194e-40, -1.1636522577599713e-40, 1.8123693688345022e-40, -3.6455760458335143e-40, 3.3548346404554013e-40, 2.364354846916691e-40, -5.3641705214354e-42, 1.3786674941259713e-40, -8.315164957457032e-41, -9.733839522739477e-41, -5.439420248969642e-41, 8.655694497272606e-40, -3.216932858581196e-40, 1.9126042479876563e-40, 8.208806404014778e-42, 3.1229337575942873e-41, -1.7005177254120953e-40, 2.7594369359484298e-40, -1.1606534790463162e-40, -2.6973033620402674e-40, -1.2978826376576456e-40, 8.064472662189322e-42, -9.67414420815924e-41, 7.802569979207014e-41, -2.1292730165415595e-41, 4.6690410039239667e-39, 5.375997480474301e-40, 1.888473888431983e-40, 9.210454546314158e-41, 9.935206112062953e-42, 2.025450813319734e-40, -9.722208745485581e-42, 1.1212489662295024e-40, 4.757548416229186e-41, -8.381166115126731e-42], [1.9675631737584756e-41, 3.190616473421176e-40, -2.674013781563189e-40, -2.41715577305245e-40, 2.411060124732637e-40, 2.809645459925188e-40, -1.2041932236313526e-39, 1.3092892071572496e-40, 5.03444499277977e-41, 1.2753917973052323e-40, -2.48518881349542e-40, 2.539853466588731e-40, -2.2895114959371024e-40, 7.292497338192781e-41, -2.327374580443159e-40, 1.0073654400338245e-40, -2.9613500316729927e-40, -1.2804813437612513e-21, 8.350197419065152e-41, 3.639260198594056e-35, -4.38620432318311e-41, 9.875510797482716e-41, -1.4396702201734235e-39, -7.112570615373474e-41, 2.8515723099777865e-40, 1.0860203228363765e-40, -2.7222604876898924e-40, -3.5281472345230947e-40, -1.864595762599888e-40, 9.498701640425773e-41, -8.916882518038108e-41, -2.0619546383153953e-40, 2.8726758648505182e-40, -1.8029946821081691e-40, 3.1489945459144145e-38, -1.540195168108693e-40, 2.207325341004452e-40, 3.151310051496865e-40, -1.38983584288664e-40, 1.962560538240836e-40, 2.629914918890887e-40, -2.028617747849108e-40, 5.447687909909159e-40, 5.480338164127927e-41, -5.233989894099624e-41, 4.051994639441641e-41, -1.5309195531837877e-38, -1.882083967434662e-40]], \"b1\": [-0.007629758678376675, -0.004780160263180733, 0.0444207563996315, 0.002752613741904497, 0.04742606356739998, 0.04429835081100464, 0.0002530287893023342, 0.04085717722773552, -0.07366905361413956, 0.030971592292189598, -0.07877293229103088, 0.15734829008579254, 0.050025373697280884, 0.09554460644721985, 0.01594349928200245, -0.04451741650700569, 0.023376774042844772, -0.015754466876387596, 0.022703740745782852, -0.048373088240623474, -0.046964604407548904, 0.042567674070596695, -0.02375335805118084, 0.02663053199648857, -0.0031143436208367348, -0.0046964650973677635, -0.006524014752358198, -0.08198187500238419, -0.022593127563595772, -0.15330825746059418, -0.06139632686972618, 0.0066515132784843445, -0.07207059115171432, 0.04016701504588127, 0.04306846857070923, -0.02120513655245304, 0.014743657782673836, -0.06884226948022842, 0.0012913732789456844, 0.07042815536260605, -0.05044709891080856, -0.07417640835046768, 0.02513275481760502, 0.07637093961238861, -0.08649066835641861, -0.025501132011413574, 0.009926960803568363, 0.011367394588887691], \"W2\": [[0.08769477158784866, -0.0015576619189232588, 0.0011849448783323169, -0.05940953269600868, -0.02490656077861786, 0.02299766056239605, 0.037471041083335876, -0.05781393125653267, 0.07353313267230988, 0.06978055834770203, 0.08740908652544022, -1.473723288263464e-26, 0.016199320554733276, -0.019279714673757553, 0.03424423933029175, 0.0016385511262342334, -0.006356118246912956, 0.03468324989080429, -0.022822055965662003, 0.01567152515053749, -0.008681531064212322, 0.11900727450847626, -0.17179587483406067, 0.13356545567512512], [-0.013069243170320988, 0.06991925835609436, 0.006641522515565157, 0.19105049967765808, 0.017525160685181618, -0.007377043832093477, 0.08918166160583496, 0.10131824016571045, -0.02957538142800331, 0.00630677817389369, -0.035196658223867416, -1.1124050071416497e-24, -0.04545561969280243, 0.029466237872838974, -0.004384886007755995, -0.0018769402522593737, 0.017279941588640213, -0.031028829514980316, -0.04918413981795311, -0.004390500485897064, 0.0763879045844078, -0.08079907298088074, 0.2017505019903183, 0.011698482558131218], [-0.004080383572727442, -0.018001310527324677, -0.07816148549318314, -0.05070922151207924, -0.12466773390769958, 0.013149009086191654, -0.10690797865390778, -2.9452232411131263e-05, -0.008764519356191158, 0.042981360107660294, -0.01974032074213028, -1.4987983303868828e-16, -0.09929464757442474, 0.06743283569812775, 0.041570186614990234, 0.0037148133851587772, -0.041010964661836624, 0.01944279670715332, -0.09275218844413757, 0.011937382631003857, 0.007083332631736994, 0.20607541501522064, 0.016768669709563255, 0.32935136556625366], [0.16220365464687347, -0.011769195087254047, 0.036690954118967056, -0.036950744688510895, 0.007264847867190838, 0.025677254423499107, -0.0823434516787529, -0.057027775794267654, 0.06083555519580841, 0.12269613146781921, 0.15214551985263824, 1.2488675159897938e-25, -0.025095803663134575, 0.006415434181690216, 0.046929217875003815, 0.010214929468929768, -0.015166237019002438, 0.01877482421696186, 0.0014114429941400886, 0.031761955469846725, -0.058748502284288406, 0.19154256582260132, -0.03594039008021355, 0.008313698694109917], [0.08642366528511047, -0.02060590870678425, -0.004770723637193441, -0.06289035826921463, 0.016109643504023552, 0.0034028468653559685, -0.03500615805387497, 0.021926576271653175, 0.022010313346982002, 0.04943486303091049, 0.08145438879728317, 8.874665154064961e-27, 0.0816076323390007, -0.06081179156899452, 0.00736474571749568, -8.732406422495842e-05, -0.019469747319817543, 0.005154496990144253, -0.019117571413517, -0.00043253012700006366, 0.03910734876990318, 0.25151410698890686, 0.026908889412879944, 0.09315085411071777], [0.26046222448349, 0.034682221710681915, -0.005820316728204489, 0.06645617634057999, 0.06312206387519836, -0.02644478529691696, 0.0549527071416378, 0.07179601490497589, -0.0908253937959671, -0.07746227085590363, -0.08159429579973221, 4.194080499564379e-11, 0.23884141445159912, -0.0406356006860733, -0.07246691733598709, -0.0069187539629638195, 0.020308643579483032, -0.034811194986104965, 0.0964975580573082, -0.023781245574355125, -0.03734933212399483, -0.13999208807945251, 0.06643766164779663, 0.033368855714797974], [0.11843335628509521, 0.04136831313371658, 0.029551781713962555, 0.06771586090326309, 0.022686704993247986, -0.0014263715129345655, -0.07633689045906067, 0.03049984574317932, -0.03329464793205261, 0.03772956505417824, 0.08257050067186356, -6.255307398770433e-15, -0.1816834807395935, 0.0251618642359972, 0.003399499924853444, 0.0019734958186745644, 0.02336837910115719, -0.0059855724684894085, 0.06381019204854965, 0.002243067603558302, -0.023526452481746674, -0.08515045046806335, 0.0772702619433403, -0.10792401432991028], [0.05145439878106117, -0.04512514919042587, -0.06400354206562042, -0.08023736625909805, -0.06258881837129593, 0.02515258453786373, -0.13186876475811005, -0.057646457105875015, 0.1167382001876831, 0.15584146976470947, 0.12001895159482956, -2.4852888714921004e-26, -0.07146358489990234, -0.11153674125671387, 0.0578145906329155, 0.004698233678936958, -0.03893091902136803, 0.04013611376285553, -0.06394939124584198, 0.030901247635483742, 0.020205087959766388, 0.020352214574813843, -0.06318340450525284, 0.062424734234809875], [0.12270714342594147, 0.04757417365908623, 0.042546533048152924, 0.10280419141054153, 0.08516832441091537, -0.003593438072130084, 0.00022416944557335228, 0.02050172910094261, -0.06825483590364456, 0.055845510214567184, 0.005078003741800785, -8.038237631077473e-27, 0.03377682715654373, 0.045698754489421844, -0.003997704945504665, 6.164747173897922e-05, 0.044308580458164215, -0.00752451503649354, 0.04308747872710228, -0.0041540320962667465, -0.007111582905054092, -0.12319798022508621, 0.18168024718761444, 0.03223654255270958], [0.04690328985452652, 0.01379042025655508, 0.015246288850903511, -0.036096446216106415, 0.00448288768529892, 0.008405237458646297, 0.05001816898584366, -0.004605723079293966, 0.07497982680797577, -0.05063193291425705, 0.03899306058883667, 9.967353186852242e-25, -0.24199289083480835, 0.008981824852526188, 0.01341380923986435, 0.000302348576951772, 0.009724967181682587, 0.017787810415029526, -0.0014391656732186675, 0.011854873038828373, -0.004680088255554438, -0.05788194388151169, -0.19060860574245453, 0.01046324148774147], [-0.08350391685962677, 0.05049534887075424, 0.030288459733128548, 0.10474571585655212, 0.12058141827583313, -0.01676681451499462, 0.22282671928405762, 0.06738482415676117, -0.10393859446048737, 0.02945990487933159, -0.05320900306105614, -5.4627843462717424e-27, 0.09458424150943756, -0.010472911410033703, -0.030070504173636436, -0.009079058654606342, 0.049787312746047974, -0.02801138535141945, 0.04094543680548668, -0.021300185471773148, -0.034202516078948975, 0.0026796506717801094, -0.04087931290268898, -0.04194437339901924], [-0.07544105499982834, -0.0038111319299787283, 0.055977266281843185, -0.004198634065687656, 0.005180164240300655, 0.0004465355887077749, -0.06290765106678009, -0.010311806574463844, 0.023120377212762833, 0.033498454838991165, -0.05703267082571983, -4.182029762860553e-27, -0.02282024174928665, 0.17642858624458313, -0.0153091661632061, -0.0024572929833084345, 0.0010750922374427319, -0.01926451548933983, -0.03740907087922096, -0.007682113908231258, -0.04231511428952217, 0.1694413721561432, 0.17773200571537018, 0.10611467808485031], [-0.16944663226604462, 0.06405821442604065, 0.028805268928408623, 0.12907938659191132, 0.022618738934397697, -0.007600865326821804, 0.17173539102077484, 0.04312557727098465, -0.1307172030210495, 0.08638820052146912, -0.1691483110189438, -6.47908349392276e-22, -0.028972843661904335, 0.08877602964639664, 0.03081592172384262, -0.0037196665070950985, 0.049250200390815735, -0.026433585211634636, 0.16783499717712402, -0.002681005047634244, 0.02948932535946369, 0.03056393936276436, -0.00881767738610506, -0.14515794813632965], [0.10990847647190094, 0.02707144245505333, 0.12913420796394348, 0.060126639902591705, 0.200177401304245, -0.012502388097345829, 0.0534939169883728, 0.015326681546866894, -0.050102945417165756, -0.00763979647308588, 0.011230099946260452, 2.5078700039399108e-17, 0.06377845257520676, 0.16198357939720154, -0.014866916462779045, -0.0005001720855943859, 0.013521874323487282, 0.002444037701934576, 0.13027162849903107, -0.006112373899668455, -0.02469971403479576, -0.08283942192792892, 0.1134691834449768, -0.029105106368660927], [-0.06032039225101471, 0.008087744936347008, 0.07031625509262085, 0.12985658645629883, 0.04033900052309036, -0.023589449003338814, -0.0161435566842556, -0.036692842841148376, -0.006053956225514412, -0.0904194563627243, -0.04316685348749161, -1.3869438123828906e-26, 0.03322748467326164, 0.0926729217171669, -0.03912961855530739, -0.006323235109448433, -0.005365536082535982, -0.044531434774398804, -0.0014856784837320447, -0.02166159451007843, -0.03693128004670143, 0.0041818623431026936, 0.23562714457511902, 0.09954257309436798], [0.059173278510570526, 0.008789900690317154, 0.001236889511346817, -0.009065132588148117, 0.02778240106999874, 0.0038769221864640713, -0.03339743986725807, 0.00969725288450718, -0.038609374314546585, 0.00567667419090867, 0.034443680197000504, 1.3766494240887892e-25, -0.11595579981803894, 0.0053711323998868465, 0.021063104271888733, 0.001724921283312142, 0.006810774095356464, 0.008521380834281445, 0.02302604541182518, 0.0053108492866158485, -0.006108161527663469, -0.017974935472011566, 0.05744708329439163, -0.01114158146083355], [-0.13965946435928345, 0.025022201240062714, 0.07054995000362396, 0.026471253484487534, 0.07424807548522949, -0.008427363820374012, 0.10501854866743088, 0.07892239838838577, -0.05735202506184578, -0.03890819102525711, -0.08255995064973831, -1.1042611730929446e-19, 0.07368383556604385, 0.03796074539422989, -0.005208213347941637, -0.005017830524593592, 0.03796226903796196, -0.02877509780228138, 0.09825529903173447, -0.01401683408766985, 0.005524630658328533, -0.05302321910858154, 0.14501704275608063, -0.011568693444132805], [0.036495644599199295, 0.05266512557864189, 0.047375861555337906, 0.09567374736070633, 0.11675223708152771, -0.008073252625763416, 0.23954622447490692, -0.009850548580288887, 0.06297643482685089, -0.023501954972743988, 0.011013412848114967, -4.003060796848425e-27, -0.12093424052000046, 0.12001129239797592, 0.02029792219400406, -0.0001944239338627085, 0.043183330446481705, -0.005795801058411598, 0.10957813262939453, -0.0117598045617342, -0.03810995817184448, 0.02104816399514675, 0.08327068388462067, 0.015534630976617336], [-0.003832303686067462, -0.021663302555680275, -0.05960893630981445, -0.026597710326313972, -0.054124411195516586, 0.05490873008966446, -0.04697138071060181, 0.015057988464832306, 0.17499276995658875, 0.028327956795692444, -0.0032082400284707546, 2.268491297585662e-11, -0.09204572439193726, 0.05147815868258476, 0.06369752436876297, 0.009859014302492142, -0.008288413286209106, 0.07786785811185837, -0.035155244171619415, 0.036151912063360214, -0.05679778382182121, 0.276117205619812, 0.07564785331487656, 0.08217683434486389], [-0.1756211817264557, 0.059564605355262756, 0.07662329077720642, 0.09558430314064026, 0.08539886027574539, -0.018537137657403946, -0.014605711214244366, 0.1474771350622177, 0.02902747318148613, -0.06194494292140007, -0.015272153541445732, -9.487322393077962e-18, -0.11954661458730698, 0.32433781027793884, -0.03460904583334923, -0.003333284752443433, 0.028358785435557365, -0.02397524006664753, 0.06126299500465393, -0.016210079193115234, 0.029925312846899033, -0.04284444451332092, -0.10127222537994385, 0.06311843544244766], [0.1324254423379898, -0.0004732769448310137, 0.0153441047295928, 0.007804300636053085, -0.09888654947280884, -0.03287084400653839, 0.05736256390810013, 0.0649515688419342, -0.04201880097389221, 0.008343798108398914, -0.06474696844816208, 1.2122022339361958e-14, 0.3275485634803772, 0.07442338019609451, -0.05254006013274193, -0.0062743439339101315, 0.020084593445062637, -0.01759408600628376, -0.007291632238775492, -0.02941480278968811, 0.2396813929080963, -0.12134364992380142, 0.05612727254629135, -0.07639481127262115], [0.048050593584775925, 0.0044427053071558475, -0.03692891076207161, 0.0470375120639801, -0.12992775440216064, 0.011706185527145863, 0.06231601536273956, 0.010394256561994553, 0.09291066229343414, -0.038930680602788925, 0.20424826443195343, -4.137954856083251e-27, 0.1706346869468689, -0.10191746056079865, 0.005376925226300955, 0.003390117548406124, -0.013218865729868412, 0.026825834065675735, 5.181689630262554e-05, 0.01270575076341629, 0.1735755205154419, 0.12003175914287567, -0.04521936550736427, -0.016385305672883987], [-0.12236742675304413, 0.03786701709032059, 0.08604171872138977, 0.03974585980176926, 0.14145047962665558, -0.011106186546385288, 0.012676614336669445, 0.01039193943142891, 0.11933089792728424, -0.06614550203084946, -0.09045707434415817, 1.7539177575576215e-12, 0.16778388619422913, 0.19074364006519318, -0.01269624661654234, -0.006076729856431484, 0.036290813237428665, -0.009164698421955109, 0.037443891167640686, -0.019098086282610893, -0.01718924567103386, -0.07011072337627411, -0.07731650024652481, 0.03555278107523918], [-0.12595710158348083, -0.029739905148744583, 0.09267879277467728, 0.10693404078483582, -0.06734023988246918, -0.02664307877421379, 0.12304940819740295, 0.05322729051113129, -0.09128187596797943, -0.046451687812805176, -0.10089847445487976, -3.014101933381401e-26, 0.009750847704708576, -0.09514954686164856, -0.052229225635528564, -0.004380072001367807, 0.0030209512915462255, -0.032319556921720505, -0.038189589977264404, -0.022088732570409775, -0.0664685070514679, 0.05307149887084961, 0.2228553295135498, 0.06488848477602005], [-0.003483218839392066, -0.007627920713275671, -0.024493638426065445, -0.03757129982113838, 0.017727943137288094, 0.02057836391031742, -0.0917942002415657, 0.013856847770512104, 0.11742035299539566, 0.05596310272812843, -0.028772640973329544, -1.2850333861239016e-12, -0.10330596566200256, -0.03522571176290512, 0.026578664779663086, 0.005733357276767492, -0.003776123747229576, 0.02441893145442009, -0.071078360080719, 0.027427256107330322, -0.01907629705965519, 0.19565807282924652, -0.03123563528060913, -0.0011068170424550772], [0.07590759545564651, -0.032102931290864944, -0.05525369942188263, -0.06306740641593933, 0.019121212884783745, 0.031747233122587204, 0.048890527337789536, -0.011093243956565857, 0.045601435005664825, 0.19079703092575073, 0.029148299247026443, -7.672040228000535e-23, 0.10068157315254211, -0.13223998248577118, 0.04781876504421234, 0.0058892653323709965, -0.02003350295126438, 0.06086013466119766, -0.0677512139081955, 0.03531352058053017, -0.00537510821595788, 0.13359969854354858, -0.06654397398233414, 0.017863014712929726], [-0.03282215818762779, 0.009904302656650543, 0.07572231441736221, -0.028526894748210907, 0.015468677505850792, -0.01275612972676754, 0.18998661637306213, 0.017287274822592735, 0.026386843994259834, -0.08149268478155136, 0.051736172288656235, 2.596975718915928e-06, 0.13408352434635162, 0.14088530838489532, -0.019785486161708832, -0.002957046963274479, 0.03216872736811638, -0.027533892542123795, -0.013424325734376907, -0.009140478447079659, -0.07430926710367203, -0.003455276135355234, 0.09187495708465576, -0.1321895718574524], [0.027565501630306244, 0.05128203332424164, 0.08460981398820877, -0.010926243849098682, 0.15531505644321442, -0.015957679599523544, 0.04682012274861336, 0.05245305970311165, -0.05670548602938652, -0.002086525084450841, -0.010022628121078014, 3.308646725728185e-27, 0.0565522164106369, 0.1607164442539215, -0.04097594693303108, -0.0031017877627164125, 0.05771701782941818, -0.02981751039624214, 0.1345321387052536, -0.009765060618519783, -0.03250442072749138, -0.22198548913002014, 0.017810700461268425, 0.011449416168034077], [-0.11551491916179657, 0.016746511682868004, 0.012887027114629745, 0.02542990818619728, 0.023708879947662354, -0.005995544139295816, 0.1166231706738472, 0.019170960411429405, -0.12531404197216034, -0.0003665473486762494, -0.12397923320531845, 5.5810846788517665e-06, -0.0026721686590462923, -0.013646111823618412, -0.017306623980402946, -0.0037189151626080275, -0.000740319024771452, -0.0064523485489189625, -0.006795285269618034, -0.01576875150203705, 0.028148820623755455, -0.04897867515683174, 0.22174544632434845, 0.047921404242515564], [0.007537434808909893, 0.019988620653748512, 0.032978590577840805, 0.04543576017022133, 0.02569948509335518, -0.015249584801495075, 0.058659691363573074, 0.09417865425348282, -0.06961733847856522, -0.07794485986232758, 0.0421440452337265, -1.2338513457471612e-12, -0.05368973687291145, 0.0617060549557209, -0.019436778500676155, -0.003605286590754986, 0.04452816769480705, -0.025585899129509926, 0.0043636588379740715, -0.016349658370018005, 0.02172153629362583, -0.09893415123224258, 0.045808445662260056, -0.0604734942317009], [0.18468670547008514, -0.03961404040455818, -0.04274921864271164, 0.017835740000009537, -0.002725655911490321, 0.011253084056079388, -0.08375738561153412, -0.031238708645105362, 0.013718071393668652, 0.015247826464474201, 0.03696653991937637, -7.54569553079362e-26, 0.019611619412899017, 0.007263662293553352, 0.03721315413713455, 0.0020711447577923536, -0.026408884674310684, 0.032920386642217636, -0.07172123342752457, 0.019514555111527443, -0.06529799103736877, -0.07511435449123383, -0.2892204225063324, 0.04426504671573639], [-0.09414298087358475, 0.05761668086051941, 0.07678893953561783, 0.14060528576374054, 0.16527467966079712, -0.009106463752686977, -0.0029791295528411865, -0.00017947008018381894, 0.08883894979953766, 0.01041034422814846, 0.0008525117882527411, -5.362979788178183e-15, -0.07231620699167252, 0.1017632856965065, -0.024560315534472466, -0.00311992596834898, 0.04823203757405281, 0.005281399469822645, 0.17163985967636108, -0.009107265621423721, -0.02903108485043049, -0.08094819635152817, 0.06170954927802086, -0.042565371841192245], [0.1445617526769638, -0.05119888857007027, -0.07596906274557114, -0.11661269515752792, -0.07048480957746506, 0.019598469138145447, -0.07899641990661621, -0.08298952877521515, 0.1658848226070404, -0.0264909565448761, 0.09841165691614151, -1.514618119813349e-08, 0.06148833781480789, -0.12709744274616241, 0.00986670982092619, 0.006233204621821642, -0.04969348385930061, 0.08971288800239563, -0.09073641896247864, 0.024858519434928894, -0.03009718470275402, 0.11359050869941711, -0.04153197258710861, 0.18138249218463898], [0.0031668646261096, -0.0011181673035025597, 0.06608361750841141, -0.012367680668830872, 0.1400056779384613, -0.015979591757059097, 0.05214676633477211, 0.06434505432844162, -0.06866585463285446, -0.07198741286993027, 0.048626456409692764, -7.318772464319144e-18, 0.20134606957435608, 0.1514013558626175, -0.024738997220993042, -0.0027234223671257496, 0.014622933231294155, -0.031144466251134872, -0.020032677799463272, -0.011321360245347023, -0.01075366698205471, -0.015052481554448605, 0.2208981215953827, -0.08129392564296722], [0.027073899284005165, -0.03765638917684555, -0.04046031832695007, 0.011917476542294025, 0.007986943237483501, 0.02736791968345642, -0.09316670894622803, -0.01073981449007988, 0.14933103322982788, 0.27371490001678467, 0.15136496722698212, -3.4767252105639433e-23, 0.02868499606847763, -0.045040279626846313, 0.06565386056900024, 0.008953502401709557, -0.025685735046863556, 0.028402917087078094, -0.06662491708993912, 0.03222762048244476, -0.043416768312454224, 0.15336726605892181, -0.005602583754807711, -0.02690522000193596], [-0.021443171426653862, 0.029625562950968742, 0.04140683636069298, 0.22029171884059906, 0.07315996289253235, -0.030258916318416595, -0.024905115365982056, -0.003211509669199586, -0.1607067584991455, -0.11718632280826569, -0.04452040046453476, 7.008130889162628e-27, 0.04633089527487755, 0.11595263332128525, -0.05561726540327072, -0.013442921452224255, 0.024402771145105362, -0.04370911791920662, -0.008045703172683716, -0.03717859089374542, -0.0409204438328743, -0.14511604607105255, -0.11868874728679657, -0.11706779152154922], [-0.025895440950989723, -0.016995051875710487, -0.00027434417279437184, -0.023654906079173088, -0.04559635743498802, 0.007170375902205706, 0.04768150672316551, 0.029150916263461113, -0.029639722779393196, 0.0011124663287773728, -0.040000926703214645, -0.0002086362219415605, -0.1186833307147026, -0.011783392168581486, -0.004459742456674576, 0.0009409572230651975, -0.009612642228603363, 0.005457054357975721, -0.02547297067940235, 0.001555433846078813, -0.02414323017001152, 0.2619694173336029, -0.14091897010803223, 0.15824700891971588], [-0.09488168358802795, 0.11916489899158478, 0.07793117314577103, -0.052311524748802185, 0.1069839745759964, -0.010973857715725899, 0.0387437604367733, 0.03899101912975311, -0.0954761877655983, -0.1389564871788025, 0.04299769923090935, -2.357197282417539e-13, 0.15016025304794312, -0.01886925846338272, -0.013470086269080639, -0.003619295544922352, 0.05090729519724846, -0.019288593903183937, 0.12612228095531464, -0.02297673560678959, -0.005855766125023365, -0.06425325572490692, 0.08876067399978638, -0.09105461090803146], [-0.022424308583140373, -0.029527347534894943, -0.02402089536190033, -0.12140212953090668, 0.01289349514991045, 0.005137924570590258, -0.057947851717472076, -0.1131042093038559, -0.10091185569763184, -0.03370792791247368, -0.0857730284333229, 1.8450298525310602e-23, 0.0816933810710907, 0.04805431514978409, 0.013250167481601238, -0.0035181117709726095, -0.04140983149409294, -0.00856589525938034, 0.027714794501662254, -0.007543119136244059, 0.04993778467178345, 0.22738374769687653, -0.043232984840869904, 0.1732313483953476], [-0.07078441977500916, 0.005567214451730251, -0.03399885445833206, 0.020368563011288643, 0.0009322630940005183, 0.021126102656126022, 0.03942924365401268, -0.009605571627616882, 0.037917569279670715, 0.07457327842712402, 0.07522986829280853, 1.0414874296316157e-08, 0.02269580028951168, -0.009318480268120766, 0.04125691205263138, 0.009139248169958591, -0.0010863513452932239, 0.02921404130756855, -4.6516070142388344e-05, 0.032550591975450516, -0.036063749343156815, 0.2896328568458557, -0.03707845136523247, 0.06443347036838531], [-0.0386510044336319, 0.05560142919421196, 0.014655651524662971, -0.012166311964392662, 0.06090085580945015, -0.002684117527678609, 0.1907888948917389, 0.03889569267630577, 0.030812788754701614, -0.10244569927453995, -0.023732157424092293, 2.372364671667853e-24, 0.11189398169517517, -0.028305377811193466, -0.0198723915964365, -0.004759954754263163, 0.03174428641796112, -0.011034999042749405, 0.04361343011260033, -0.009095198474824429, -0.005134704988449812, 0.02713228389620781, 0.033992111682891846, -0.004409195855259895], [0.06880173832178116, 0.005900823511183262, 0.054877884685993195, 0.10319174826145172, -0.03148939460515976, -0.00633681146427989, 0.02002641186118126, -0.045215487480163574, -0.01684022881090641, -0.009673144668340683, 0.0621282123029232, 1.6891051183993417e-26, 0.09227541834115982, -0.01197011023759842, 0.0023536456283181906, 0.0004938100464642048, 0.00884255301207304, -0.014839572831988335, 0.001514554489403963, -0.00509938970208168, 0.03829343616962433, -0.06788023561239243, 0.12350833415985107, -0.07369847595691681], [0.08718995749950409, 0.016347669064998627, -0.07301997393369675, 0.004345429129898548, -0.027549777179956436, 0.01937626674771309, -0.009352721273899078, -0.021833520382642746, 0.1325128972530365, 0.09809359163045883, 0.10525406897068024, 2.0049629602529344e-25, -0.13259512186050415, -0.044972632080316544, 0.041248537600040436, 0.006164355203509331, -0.009747247211635113, 0.03404184430837631, -0.03917595371603966, 0.025047767907381058, 0.015258874744176865, 0.2033284604549408, 0.0745672658085823, 0.0343099981546402], [-0.014457397162914276, -0.020431194454431534, -0.03166699409484863, -0.017183519899845123, -0.10846715420484543, 0.019288597628474236, -0.0940653458237648, -0.04293900355696678, 0.12048877775669098, 0.08772657066583633, 0.08331893384456635, -1.6968187965815673e-09, 0.05095785856246948, -0.13582265377044678, 0.02298261597752571, 0.006580084562301636, -0.032261863350868225, 0.024714339524507523, -0.03897378593683243, 0.019708232954144478, -0.03528721630573273, 0.09290968626737595, -0.02283451519906521, -0.045530978590250015], [0.11509369313716888, 0.020649774000048637, -0.008419401943683624, -0.027706431224942207, -0.07958757877349854, 0.01801401376724243, 0.02983134239912033, -0.0013134923065081239, 0.05679641291499138, 0.03341316059231758, -0.01321299746632576, -2.7226197548321818e-27, 0.07265760004520416, -0.004542417358607054, 0.04104087874293327, 0.005864111706614494, -0.013470951467752457, 0.02002020739018917, -0.003540643025189638, 0.021503383293747902, 0.053999412804841995, 0.24741220474243164, 0.0864340290427208, -0.017529675737023354], [0.014054770581424236, -0.016124553978443146, -0.014279788359999657, -0.02198520489037037, 0.01979290321469307, 0.026445789262652397, -0.1065267026424408, 0.08642148971557617, 0.015630587935447693, 0.11499710381031036, 0.018608883023262024, -1.9361516478966223e-06, -0.10364243388175964, 0.012294602580368519, 0.060104433447122574, 0.005549751687794924, -0.021320538595318794, 0.027365192770957947, -0.08708830177783966, 0.015470411628484726, -0.028030840680003166, 0.16476885974407196, -0.016994377598166466, 0.13462795317173004], [-0.08055585622787476, -0.012964488007128239, -0.012400378473103046, -0.035018883645534515, -0.006218801252543926, 0.024742912501096725, -0.03004758432507515, -0.06515118479728699, 0.08042442798614502, 0.12983466684818268, -0.0410342812538147, -6.717428262942304e-13, -0.0693642720580101, -0.09843046963214874, 0.07549892365932465, 0.006928279064595699, -0.024493932723999023, 0.06881225854158401, 0.016951467841863632, 0.02576538920402527, 0.01845817267894745, 0.19098052382469177, -0.08865553140640259, -0.024655384942889214], [-0.0011015082709491253, -0.04506108537316322, 0.0906839668750763, -0.06599810719490051, 0.06491249054670334, -0.025285979732871056, 0.013440088368952274, 0.010108300484716892, 0.0002477823873050511, -0.1016475185751915, 0.030782613903284073, 1.3938167026800174e-12, 0.24828900396823883, 0.08688808977603912, -0.04643649980425835, -0.005080766510218382, -0.011807175353169441, -0.014383066445589066, 0.07367963343858719, -0.02362777106463909, -0.02536061778664589, 0.0433112308382988, 0.09706992655992508, -0.07979506254196167]], \"b2\": [-0.0014414048055186868, -0.029444022104144096, 0.07406286150217056, 0.013811755925416946, -0.0042110346257686615, 0.02286987379193306, 0.0072364602237939835, 0.002583842957392335, 0.0846276581287384, 0.044131238013505936, 0.036439914256334305, -0.01267100591212511, 4.299270221963525e-05, 0.005461325868964195, 0.05315675213932991, 0.0021781385876238346, -0.003424035618081689, 0.05177474021911621, 0.02694562077522278, 0.024099059402942657, -0.04302731156349182, 0.06590604782104492, 0.018158618360757828, 0.03821442276239395], \"W3\": [0.2306433767080307, -0.14203320443630219, -0.17240314185619354, -0.22003108263015747, -0.2053295075893402, 0.060619037598371506, -0.2763436436653137, -0.1584339737892151, 0.23923926055431366, 0.20059359073638916, 0.24024945497512817, -0.0024553313851356506, -0.27628859877586365, -0.20172110199928284, 0.10577399283647537, 0.0132798096165061, -0.11790230125188828, 0.10235917568206787, -0.19378089904785156, 0.068869449198246, -0.2226419597864151, 0.347529798746109, -0.28398385643959045, 0.20057666301727295], \"b3\": 0.020894724875688553}",
"/app/public/rarity.json": "{\"SS01/SS-001.png\": \"R\", \"SS01/SS-001OSR.png\": \"OSR\", \"SS01/SS-002.png\": \"R\", \"SS01/SS-002OSR.png\": \"OSR\", \"SS01/SS-003.png\": \"R\", \"SS01/SS-003OSR.png\": \"OSR\", \"SS01/SS-004.png\": \"R\", \"SS01/SS-004OSR.png\": \"OSR\", \"SS01/SS-005.png\": \"R\", \"SS01/SS-005OSR.png\": \"OSR\", \"TD02/SOUL-001.png\": \"TD\", \"TD02/TD02-001.png\": \"TDR\", \"TD02/TD02-001TSP.png\": \"TSP\", \"TD02/TD02-001TSR.png\": \"TSR\", \"TD02/TD02-002.png\": \"TD\", \"TD02/TD02-003.png\": \"TD\", \"TD02/TD02-003TSR.png\": \"TSR\", \"TD02/TD02-004.png\": \"TD\", \"TD02/TD02-005.png\": \"TD\", \"TD02/TD02-006.png\": \"TD\", \"TD02/TD02-006TSR.png\": \"TSR\", \"TD02/TD02-007.png\": \"TD\", \"TD02/TD02-007TSR.png\": \"TSR\", \"TD02/TD02-008.png\": \"TD\", \"TD02/TD02-008TSR.png\": \"TSR\", \"TD02/TD02-009.png\": \"TD\", \"TD02/TD02-010.png\": \"TD\", \"TD02/TD02-011.png\": \"TD\", \"TD02/TD02-012.png\": \"TDR\", \"TD02/TD02-012TSP.png\": \"TSP\", \"TD02/TD02-012TSR.png\": \"TSR\", \"TD02/TD02-013.png\": \"TD\", \"TD02/TD02-014.png\": \"TD\", \"TD02/TD02-014TSR.png\": \"TSR\", \"TD02/TD02-015.png\": \"TD\", \"TD02/TD02-016.png\": \"TD\", \"TD02/TD02-016TSR.png\": \"TSR\", \"TD02/TD02-017.png\": \"TD\", \"TD02/TD02-018.png\": \"TD\", \"TD02/TD02-018TSR.png\": \"TSR\", \"TD02/TD02-019.png\": \"TD\", \"TD02/TD02-020.png\": \"TD\", \"TD02/TD02-021.png\": \"TD\", \"TD02/TD02-021TSR.png\": \"TSR\", \"TD02/TD02-022.png\": \"TD\", \"TD02/TD02-023.png\": \"TD\", \"TD02/TD02-023TSR.png\": \"TSR\", \"TD02/TD02-024.png\": \"TD\", \"TD02/TD02-024TSR.png\": \"TSR\", \"TD01/SOUL-001.png\": \"TD\", \"TD01/TD01-001.png\": \"TDR\", \"TD01/TD01-001TSP.png\": \"TSP\", \"TD01/TD01-001TSR.png\": \"TSR\", \"TD01/TD01-002.png\": \"TD\", \"TD01/TD01-003.png\": \"TD\", \"TD01/TD01-004.png\": \"TD\", \"TD01/TD01-005.png\": \"TD\", \"TD01/TD01-005TSR.png\": \"TSR\", \"TD01/TD01-006.png\": \"TD\", \"TD01/TD01-007.png\": \"TD\", \"TD01/TD01-007TSR.png\": \"TSR\", \"TD01/TD01-008.png\": \"TD\", \"TD01/TD01-008TSR.png\": \"TSR\", \"TD01/TD01-009.png\": \"TD\", \"TD01/TD01-010.png\": \"TD\", \"TD01/TD01-011.png\": \"TD\", \"TD01/TD01-011TSR.png\": \"TSR\", \"TD01/TD01-012.png\": \"TDR\", \"TD01/TD01-012TSP.png\": \"TSP\", \"TD01/TD01-012TSR.png\": \"TSR\", \"TD01/TD01-013.png\": \"TD\", \"TD01/TD01-014.png\": \"TD\", \"TD01/TD01-014TSR.png\": \"TSR\", \"TD01/TD01-015.png\": \"TD\", \"TD01/TD01-016.png\": \"TD\", \"TD01/TD01-017.png\": \"TD\", \"TD01/TD01-017TSR.png\": \"TSR\", \"TD01/TD01-018.png\": \"TD\", \"TD01/TD01-018TSR.png\": \"TSR\", \"TD01/TD01-019.png\": \"TD\", \"TD01/TD01-020.png\": \"TD\", \"TD01/TD01-021.png\": \"TD\", \"TD01/TD01-022.png\": \"TD\", \"TD01/TD01-022TSR.png\": \"TSR\", \"TD01/TD01-023.png\": \"TD\", \"TD01/TD01-023TSR.png\": \"TSR\", \"TD01/TD01-024.png\": \"TD\", \"TD01/TD01-024TSR.png\": \"TSR\", \"BP01/BP01-001.png\": \"RR\", \"BP01/BP01-001OSR.png\": \"OSR\", \"BP01/BP01-001SSP.png\": \"SSP\", \"BP01/BP01-002.png\": \"RR\", \"BP01/BP01-002OSR.png\": \"OSR\", \"BP01/BP01-002SP.png\": \"SP\", \"BP01/BP01-003.png\": \"R\", \"BP01/BP01-003SR.png\": \"SR\", \"BP01/BP01-004.png\": \"R\", \"BP01/BP01-004SR.png\": \"SR\", \"BP01/BP01-005.png\": \"R\", \"BP01/BP01-005SR.png\": \"SR\", \"BP01/BP01-006.png\": \"U\", \"BP01/BP01-006SR.png\": \"SR\", \"BP01/BP01-007.png\": \"U\", \"BP01/BP01-007SR.png\": \"SR\", \"BP01/BP01-008.png\": \"U\", \"BP01/BP01-009.png\": \"U\", \"BP01/BP01-010.png\": \"U\", \"BP01/BP01-011.png\": \"C\", \"BP01/BP01-012.png\": \"C\", \"BP01/BP01-013.png\": \"C\", \"BP01/BP01-014.png\": \"C\", \"BP01/BP01-015.png\": \"R\", \"BP01/BP01-015SP.png\": \"SP\", \"BP01/BP01-016.png\": \"U\", \"BP01/BP01-017.png\": \"U\", \"BP01/BP01-018.png\": \"C\", \"BP01/BP01-019.png\": \"R\", \"BP01/BP01-019SR.png\": \"SR\", \"BP01/BP01-020.png\": \"R\", \"BP01/BP01-020SR.png\": \"SR\", \"BP01/BP01-021.png\": \"C\", \"BP01/BP01-022.png\": \"C\", \"BP01/BP01-023.png\": \"RR\", \"BP01/BP01-023OSR.png\": \"OSR\", \"BP01/BP01-023SP.png\": \"SP\", \"BP01/BP01-024.png\": \"C\", \"BP01/BP01-025.png\": \"RR\", \"BP01/BP01-025OSR.png\": \"OSR\", \"BP01/BP01-025SSP.png\": \"SSP\", \"BP01/BP01-026.png\": \"RR\", \"BP01/BP01-026OSR.png\": \"OSR\", \"BP01/BP01-026SP.png\": \"SP\", \"BP01/BP01-027.png\": \"R\", \"BP01/BP01-027OSR.png\": \"OSR\", \"BP01/BP01-027SP.png\": \"SP\", \"BP01/BP01-028.png\": \"R\", \"BP01/BP01-028SR.png\": \"SR\", \"BP01/BP01-029.png\": \"R\", \"BP01/BP01-029SR.png\": \"SR\", \"BP01/BP01-030.png\": \"R\", \"BP01/BP01-030SR.png\": \"SR\", \"BP01/BP01-031.png\": \"U\", \"BP01/BP01-031SR.png\": \"SR\", \"BP01/BP01-032.png\": \"U\", \"BP01/BP01-033.png\": \"U\", \"BP01/BP01-034.png\": \"C\", \"BP01/BP01-035.png\": \"C\", \"BP01/BP01-036.png\": \"C\", \"BP01/BP01-037.png\": \"C\", \"BP01/BP01-038.png\": \"C\", \"BP01/BP01-039.png\": \"R\", \"BP01/BP01-039SR.png\": \"SR\", \"BP01/BP01-040.png\": \"U\", \"BP01/BP01-041.png\": \"U\", \"BP01/BP01-042.png\": \"C\", \"BP01/BP01-043.png\": \"C\", \"BP01/BP01-044.png\": \"R\", \"BP01/BP01-044SR.png\": \"SR\", \"BP01/BP01-045.png\": \"U\", \"BP01/BP01-046.png\": \"RR\", \"BP01/BP01-046OSR.png\": \"OSR\", \"BP01/BP01-046SP.png\": \"SP\", \"BP01/BP01-047.png\": \"U\", \"BP01/BP01-047SR.png\": \"SR\", \"BP01/BP01-048.png\": \"C\", \"BP01/BP01-049.png\": \"RR\", \"BP01/BP01-049OSR.png\": \"OSR\", \"BP01/BP01-049SSP.png\": \"SSP\", \"BP01/BP01-050.png\": \"RR\", \"BP01/BP01-050OSR.png\": \"OSR\", \"BP01/BP01-050SP.png\": \"SP\", \"BP01/BP01-051.png\": \"R\", \"BP01/BP01-051OSR.png\": \"OSR\", \"BP01/BP01-051SP.png\": \"SP\", \"BP01/BP01-052.png\": \"R\", \"BP01/BP01-052SR.png\": \"SR\", \"BP01/BP01-053.png\": \"R\", \"BP01/BP01-053SR.png\": \"SR\", \"BP01/BP01-054.png\": \"R\", \"BP01/BP01-054SR.png\": \"SR\", \"BP01/BP01-055.png\": \"U\", \"BP01/BP01-055SR.png\": \"SR\", \"BP01/BP01-056.png\": \"C\", \"BP01/BP01-056SR.png\": \"SR\", \"BP01/BP01-057.png\": \"U\", \"BP01/BP01-058.png\": \"U\", \"BP01/BP01-059.png\": \"U\", \"BP01/BP01-060.png\": \"C\", \"BP01/BP01-061.png\": \"C\", \"BP01/BP01-062.png\": \"C\", \"BP01/BP01-063.png\": \"R\", \"BP01/BP01-063SR.png\": \"SR\", \"BP01/BP01-064.png\": \"R\", \"BP01/BP01-064SR.png\": \"SR\", \"BP01/BP01-065.png\": \"U\", \"BP01/BP01-066.png\": \"U\", \"BP01/BP01-067.png\": \"C\", \"BP01/BP01-068.png\": \"U\", \"BP01/BP01-069.png\": \"C\", \"BP01/BP01-070.png\": \"RR\", \"BP01/BP01-070OSR.png\": \"OSR\", \"BP01/BP01-070SP.png\": \"SP\", \"BP01/BP01-071.png\": \"C\", \"BP01/BP01-072.png\": \"C\", \"BP01/BP01-073.png\": \"RR\", \"BP01/BP01-073OSR.png\": \"OSR\", \"BP01/BP01-073SSP.png\": \"SSP\", \"BP01/BP01-074.png\": \"RR\", \"BP01/BP01-074OSR.png\": \"OSR\", \"BP01/BP01-074SP.png\": \"SP\", \"BP01/BP01-075.png\": \"R\", \"BP01/BP01-075OSR.png\": \"OSR\", \"BP01/BP01-075SP.png\": \"SP\", \"BP01/BP01-076.png\": \"R\", \"BP01/BP01-076SR.png\": \"SR\", \"BP01/BP01-077.png\": \"R\", \"BP01/BP01-077SR.png\": \"SR\", \"BP01/BP01-078.png\": \"R\", \"BP01/BP01-078SR.png\": \"SR\", \"BP01/BP01-079.png\": \"U\", \"BP01/BP01-079SR.png\": \"SR\", \"BP01/BP01-080.png\": \"C\", \"BP01/BP01-080SR.png\": \"SR\", \"BP01/BP01-081.png\": \"C\", \"BP01/BP01-081SR.png\": \"SR\", \"BP01/BP01-082.png\": \"U\", \"BP01/BP01-083.png\": \"U\", \"BP01/BP01-084.png\": \"U\", \"BP01/BP01-085.png\": \"U\", \"BP01/BP01-086.png\": \"C\", \"BP01/BP01-087.png\": \"C\", \"BP01/BP01-088.png\": \"R\", \"BP01/BP01-088SR.png\": \"SR\", \"BP01/BP01-089.png\": \"U\", \"BP01/BP01-090.png\": \"U\", \"BP01/BP01-091.png\": \"C\", \"BP01/BP01-092.png\": \"C\", \"BP01/BP01-093.png\": \"R\", \"BP01/BP01-093SR.png\": \"SR\", \"BP01/BP01-094.png\": \"C\", \"BP01/BP01-095.png\": \"RR\", \"BP01/BP01-095OSR.png\": \"OSR\", \"BP01/BP01-095SP.png\": \"SP\", \"BP01/BP01-096.png\": \"C\", \"BP01/BP01-097.png\": \"C\", \"BP01/BP01-098.png\": \"U\", \"BP01/BP01-099.png\": \"C\", \"BP01/BP01-100.png\": \"U\", \"BP01/BP01-100SR.png\": \"SR\", \"SOUL/SOUL-002.png\": \"SSS\", \"PR/PR-001.png\": \"PR\", \"PR/PR-001S.png\": \"PR\", \"PR/PR-002.png\": \"PR\", \"PR/PR-002S.png\": \"PR\", \"PR/PR-003.png\": \"PR\", \"PR/PR-003S.png\": \"PR\", \"PR/PR-004.png\": \"PR\", \"PR/PR-004S.png\": \"PR\", \"PR/PR-005.png\": \"PR\", \"PR/PR-005S.png\": \"PR\", \"PR/PR-006.png\": \"PR\", \"PR/PR-006S.png\": \"PR\", \"PR/PR-007.png\": \"PR\", \"PR/PR-007S.png\": \"PR\", \"PR/PR-008.png\": \"PR\", \"PR/PR-008S.png\": \"PR\", \"PR/PR-009.png\": \"PR\", \"PR/PR-010.png\": \"PR\", \"PR/PR-011.png\": \"PR\", \"PR/PR-012.png\": \"PR\", \"PR/PR-013.png\": \"PR\", \"PR/PR-014.png\": \"PR\", \"PR/PR-015.png\": \"PR\", \"PR/PR-016.png\": \"PR\", \"PR/PR-017.png\": \"PR\", \"PR/PR-018.png\": \"PR\", \"PR/PR-019.png\": \"PR\", \"PR/PR-029.png\": \"PR\", \"PR/SOUL-000.png\": \"PR\", \"PR/SOUL-003.png\": \"PR\", \"PR/SOUL-005.png\": \"PR\", \"PR/SOUL-006.png\": \"PR\", \"PR/SOUL-007.png\": \"PR\", \"PR/SOUL-008.png\": \"PR\", \"SOUL/SOUL-013.png\": \"PR\", \"SOUL/SOUL-014.png\": \"PR\", \"SOUL/SOUL-015.png\": \"PR\", \"SOUL/SOUL-016.png\": \"PR\"}",
"/app/server/puzzle_guides.json": "{\n \"p01\": [\n  \"《刺激又纯真 电棘鼠》 发起攻击\",\n  \"选择 《刺激又纯真 电棘鼠》 的攻击目标 → 对手玩家\",\n  \"《烈火骏马 火麒麟》 发起攻击\",\n  \"选择 《烈火骏马 火麒麟》 的攻击目标 → 对手玩家\"\n ],\n \"p02\": [\n  \"使用 《原始熔炉》（2灵魂）\",\n  \"《原始熔炉》 起动：下一张装备费用-X［消费X个素材］\",\n  \"《刺激又纯真 电棘鼠》 发起攻击\",\n  \"《熔岩好天气 火灵儿》 发起攻击\",\n  \"《烈火骏马 火麒麟》 发起攻击\"\n ],\n \"break\": [\n  \"使用 《碎岩龟的头巾》（3灵魂）\",\n  \"《碎岩龟的头巾》 起动：选择1只帕鲁战斗力+200［横置此卡］\",\n  \"选择 1 只帕鲁，直至回合结束战斗力+200：《低吼锐矛 碎岩龟》\",\n  \"获得 2 个素材或食材 → 2 个【食材】\",\n  \"《低吼锐矛 碎岩龟》 起动：+500并获得突破［消费2个食材］\",\n  \"《低吼锐矛 碎岩龟》 发起攻击\"\n ],\n \"bee\": [\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"顶牌是 《花园骑士 骑士蜂》，是否支付 1 灵魂使用？ → 是\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"顶牌是 《花园骑士 骑士蜂》，是否支付 1 灵魂使用？ → 是\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"《家畜牧场》 起动：获得3资源并抽1［任命1只帕鲁］\",\n  \"获得3资源并抽1：选择要任命的帕鲁：《花园骑士 骑士蜂》\",\n  \"获得 3 个素材或食材 → 3 个【食材】\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"顶牌是 《花园骑士 骑士蜂》，是否支付 1 灵魂使用？ → 是\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"顶牌是 《花园骑士 骑士蜂》，是否支付 1 灵魂使用？ → 是\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"《花园女王 女皇蜂》 起动：检视顶1张骑士蜂［消费1个食材］\",\n  \"《花园女王 女皇蜂》 发起攻击\",\n  \"《花园骑士 骑士蜂》 发起攻击\"\n ],\n \"taunt\": [\n  \"使用 《火焰吐息》（2灵魂）\",\n  \"选择 1 张，给予 500 伤害：《黑铁要塞 铠格力斯》\",\n  \"《烈火骏马 火麒麟》 发起攻击\",\n  \"《刺激又纯真 电棘鼠》 发起攻击\",\n  \"《熔岩好天气 火灵儿》 发起攻击\"\n ],\n \"night\": [\n  \"《劣质床》 起动：变为黑夜［将卡组顶3张放置入墓地］\",\n  \"使用 《闪耀月光 月镰魔》（4灵魂）\",\n  \"选择至多1只竖置的◇6以下帕鲁放置于墓地：《自然守护者 祇岳鹿》\",\n  \"《埋伏的猎人 炎魔羊》 发起攻击\",\n  \"选择 《埋伏的猎人 炎魔羊》 的攻击目标 → 对手玩家\"\n ],\n \"dragon\": [\n  \"使用 《暖烘烘抱抱 火绒狐》（4灵魂）\",\n  \"《狂暴熔岩龙 腾炎龙》 发起攻击\",\n  \"选择 《狂暴熔岩龙 腾炎龙》 的攻击目标 → 对手玩家\",\n  \"（对手）《南国看守者 绿苔绒怪》 起动：妨碍［支付1灵魂、丢弃此卡］\",\n  \"《狂暴熔岩龙 腾炎龙》 起动：竖置此卡［丢弃2张手牌］\",\n  \"竖置此卡：选择要丢弃的 2 张手牌：《灼热之泪 融焰娘》、《坚强火种 燎火鹿》\",\n  \"《狂暴熔岩龙 腾炎龙》 发起攻击\",\n  \"选择 《狂暴熔岩龙 腾炎龙》 的攻击目标 → 对手玩家\",\n  \"《暖烘烘抱抱 火绒狐》 发起攻击\",\n  \"选择 《暖烘烘抱抱 火绒狐》 的攻击目标 → 对手玩家\"\n ],\n \"pharm\": [\n  \"《劣质床》 起动：变为黑夜［将卡组顶3张放置入墓地］\",\n  \"《中世纪制药台》 起动：墓地帕鲁登场［支付3灵魂、任命1只帕鲁］\",\n  \"墓地帕鲁登场：选择要任命的帕鲁：《梦的开始 寐魔》\",\n  \"选择墓地中1只费用◇4以下的帕鲁横置登场：《闪耀月光 月镰魔》\",\n  \"选择至多1只竖置的◇6以下帕鲁放置于墓地：《亲卫队长 叶胖达》\",\n  \"《埋伏的猎人 炎魔羊》 发起攻击\",\n  \"《暗中活跃之影 黑鸦隐士》 发起攻击\"\n ],\n \"blade\": [\n  \"使用 《小小公主 姬小兔》（2灵魂）\",\n  \"《刹那之刃 浪刃武士》 发起攻击\",\n  \"选择 《刹那之刃 浪刃武士》 的攻击目标 → 对手玩家\",\n  \"是否将 《刹那之刃 浪刃武士》 返回手牌？ → 是\",\n  \"使用 《刹那之刃 浪刃武士》（5灵魂）\",\n  \"《勇气之火 火绒狐》 发起攻击\",\n  \"选择 《勇气之火 火绒狐》 的攻击目标 → 对手玩家\",\n  \"《自信满满 捣蛋猫》 发起攻击\",\n  \"选择 《自信满满 捣蛋猫》 的攻击目标 → 对手玩家\",\n  \"《小小公主 姬小兔》 发起攻击\",\n  \"选择 《小小公主 姬小兔》 的攻击目标 → 对手玩家\",\n  \"《刹那之刃 浪刃武士》 发起攻击\",\n  \"选择 《刹那之刃 浪刃武士》 的攻击目标 → 对手玩家\"\n ],\n \"peng\": [\n  \"《企丸丸的火箭发射器》 起动：选择1只帕鲁强化［横置此卡］\",\n  \"选择1只帕鲁（企丸丸则+500并获得能力）：《飞得远的炮弹 企丸丸》\",\n  \"《飞得远的炮弹 企丸丸》 起动：火箭发射［横置此卡］\",\n  \"《大海原的大战士 企丸王》 发起攻击\",\n  \"《憧憬天空 企丸丸》 发起攻击\"\n ],\n \"bell\": [\n  \"《采石场》 起动：获得3素材并抽1［任命1只帕鲁］\",\n  \"获得3素材并抽1：选择要任命的帕鲁：《勇猛迅雷 雷角马》\",\n  \"《固定式机关枪》 起动：X次500伤害［消费X个素材、任命1只帕鲁］\",\n  \"X次500伤害：消费几个素材（X）？ → 2\",\n  \"X次500伤害：选择要任命的帕鲁：《勇气之火 火绒狐》\",\n  \"第 1/2 次：选择1只帕鲁，给予500伤害：《兴致冲浪手 冲浪鸭》\",\n  \"第 2/2 次：选择1只帕鲁，给予500伤害：《高傲之牙 猎狼》\",\n  \"《警钟》 起动：竖置已任命帕鲁［支付1灵魂、任命1只帕鲁］\",\n  \"竖置已任命帕鲁：选择要任命的帕鲁：《坚强火种 燎火鹿》\",\n  \"认真400：选择 1 只帕鲁，战斗力+400：《亲卫队长 叶胖达》\",\n  \"《坚强火种 燎火鹿》 发起攻击\",\n  \"《勇气之火 火绒狐》 发起攻击\"\n ],\n \"abyss\": [\n  \"使用 《天空袭击者 烽歌龙》（4灵魂）\",\n  \"选择帕鲁：《高傲之牙 猎狼》\",\n  \"《唤死铠龙 魔渊龙》 发起攻击\",\n  \"（对手）选择你的1张手牌丢弃：《挡路黑炎 狱阎王》\"\n ],\n \"phoenix\": [\n  \"使用 《业火之翼 朱雀》（7灵魂）\",\n  \"选择至多 1 张，给予 700 伤害：《起始帕鲁 捣蛋猫》\",\n  \"《热腾腾的掉落物 炽焰牛》 发起攻击\",\n  \"选择 《热腾腾的掉落物 炽焰牛》 的攻击目标 → 对手玩家\",\n  \"《坚强火种 燎火鹿》 发起攻击\",\n  \"选择 《坚强火种 燎火鹿》 的攻击目标 → 对手玩家\",\n  \"《业火之翼 朱雀》 发起攻击\",\n  \"选择 《业火之翼 朱雀》 的攻击目标 → 对手玩家\"\n ],\n \"cat\": [\n  \"使用 《就在那里！？ 猫蝠怪》（5灵魂）\",\n  \"选择至多1只帕鲁加入手牌：不选\",\n  \"《就在那里！？ 猫蝠怪》 发起攻击\",\n  \"选择 《就在那里！？ 猫蝠怪》 的攻击目标 → 对手玩家\",\n  \"《沉默的孩子 露娜蒂》 发起攻击\",\n  \"选择 《沉默的孩子 露娜蒂》 的攻击目标 → 对手玩家\",\n  \"《起始帕鲁 棉悠悠》 发起攻击\",\n  \"选择 《起始帕鲁 棉悠悠》 的攻击目标 → 对手玩家\",\n  \"《女神的冥加 黑月女王》 发起攻击\",\n  \"选择 《女神的冥加 黑月女王》 的攻击目标 → 对手玩家\"\n ],\n \"curtain\": [\n  \"使用 《极光的指引》（2灵魂）\",\n  \"选择至多1张手牌放置于卡组顶：《古典式窗帘》\",\n  \"《原始工作台》 起动：公开顶1张［任命1只帕鲁］\",\n  \"公开顶1张：选择要任命的帕鲁：《固执又纯真 冰刺鼠》\",\n  \"是否使 《古典式窗帘》 登场？ → 是\",\n  \"选择至多 3 只对方帕鲁返回手牌：《亲卫队长 叶胖达》、《烈火骏马 火麒麟》、《冰原轰鸣者 雪猛犸》\",\n  \"《畅游泳者 滑水蛇》 发起攻击\",\n  \"《飞得远的炮弹 企丸丸》 发起攻击\"\n ],\n \"zoe\": [\n  \"《小小公主 姬小兔》 发起攻击\",\n  \"选择 《小小公主 姬小兔》 的攻击目标 → 对手玩家\",\n  \"使用 《佐伊的作战》（3灵魂）\",\n  \"佐伊的作战：选择1项 → 解体1只己方帕鲁，破坏对方1只帕鲁\",\n  \"选择你的1只帕鲁解体：《小小公主 姬小兔》\",\n  \"选择对方1只帕鲁放置于墓地：《女神的冥加 黑月女王》\",\n  \"《梦的延续 寐魔》 发起攻击\",\n  \"选择 《梦的延续 寐魔》 的攻击目标 → 对手玩家\",\n  \"《绝望的基因 异构格里芬》 发起攻击\",\n  \"选择 《绝望的基因 异构格里芬》 的攻击目标 → 对手玩家\"\n ],\n \"trap\": [\n  \"使用 《宝藏预感 朋克蜥》（3灵魂）\",\n  \"《悬吊陷阱》 起动：放逐1只帕鲁［任命1只帕鲁］\",\n  \"放逐1只帕鲁：选择要任命的帕鲁：《高傲之牙 猎狼》\",\n  \"选择1只帕鲁放逐：《暗夜之翼 雷冥鸟》\",\n  \"《宝藏预感 朋克蜥》 发起攻击\",\n  \"选择 《宝藏预感 朋克蜥》 的攻击目标 → 《暗夜之翼 雷冥鸟》\",\n  \"（对手）《挡路黑炎 狱阎王》 起动：妨碍［支付1灵魂、丢弃此卡］\",\n  \"《埋伏的猎人 炎魔羊》 发起攻击\",\n  \"选择 《埋伏的猎人 炎魔羊》 的攻击目标 → 对手玩家\",\n  \"《暗中活跃之影 黑鸦隐士》 发起攻击\",\n  \"选择 《暗中活跃之影 黑鸦隐士》 的攻击目标 → 对手玩家\"\n ],\n \"cleaver\": [\n  \"《高傲之牙 猎狼》 发起攻击\",\n  \"《切肉刀》 起动：公开3张选1［横置此卡、解体1只帕鲁］\",\n  \"公开3张选1：选择要解体的帕鲁：《高傲之牙 猎狼》\",\n  \"选择1张加入手牌：《晚上才动真格 瞅什魔》\",\n  \"使用 《晚上才动真格 瞅什魔》（2灵魂）\",\n  \"《晚上才动真格 瞅什魔》 发起攻击\",\n  \"选择 《晚上才动真格 瞅什魔》 的攻击目标 → 对手玩家\",\n  \"《苍炎骏马 邪麒麟》 发起攻击\",\n  \"选择 《苍炎骏马 邪麒麟》 的攻击目标 → 对手玩家\",\n  \"《女神的冥加 黑月女王》 发起攻击\",\n  \"选择 《女神的冥加 黑月女王》 的攻击目标 → 对手玩家\"\n ],\n \"hang\": [\n  \"使用 《沉默的孩子 露娜蒂》（3灵魂）\",\n  \"《悬吊陷阱》 起动：放逐1只帕鲁［任命1只帕鲁］\",\n  \"放逐1只帕鲁：选择要任命的帕鲁：《沉默的孩子 露娜蒂》\",\n  \"选择1只帕鲁放逐：《倾泻电击 暴电熊》\",\n  \"《深渊魔导师 暗巫猫》 发起攻击\",\n  \"结束回合\",\n  \"（对手）支付 3 灵魂抽 1 张卡\",\n  \"（对手）结束回合\",\n  \"使用 《潜伏暗中的蝎 冥铠蝎》（5灵魂）\",\n  \"《深渊魔导师 暗巫猫》 发起攻击\",\n  \"《沉默的孩子 露娜蒂》 发起攻击\",\n  \"《深渊魔导师 暗巫猫》 起动：+1000/+1［解体1只其他帕鲁］\",\n  \"+1000/+1：选择要解体的帕鲁：《沉默的孩子 露娜蒂》\",\n  \"《潜伏暗中的蝎 冥铠蝎》 发起攻击\"\n ],\n \"adv\": [\n  \"使用 《冒险的开始》（2灵魂）\",\n  \"使用 《起始帕鲁 皮皮鸡》（2灵魂）\",\n  \"使用 《起始帕鲁 捣蛋猫》（2灵魂）\",\n  \"使用 《冒险的开始》（2灵魂）\",\n  \"《起始帕鲁 棉悠悠》 发起攻击\",\n  \"《高傲之牙 猎狼》 发起攻击\"\n ],\n \"griffin\": [\n  \"《绝望的基因 异构格里芬》 发起攻击\",\n  \"使用 《梦的开始 寐魔》（2灵魂）\",\n  \"选择至多1只费用◇2以下的帕鲁放置于墓地：《起始帕鲁 棉悠悠》\",\n  \"选择至多1只费用◇2以下的帕鲁放置于墓地：《小小公主 姬小兔》\",\n  \"使用 《闪耀月光 月镰魔》（4灵魂）\",\n  \"选择至多1只竖置的◇6以下帕鲁放置于墓地：《高傲之牙 猎狼》\",\n  \"选择至多1只竖置的◇6以下帕鲁放置于墓地：《亲卫队长 叶胖达》\",\n  \"《暗夜之翼 雷冥鸟》 发起攻击\",\n  \"《梦的开始 寐魔》 发起攻击\"\n ],\n \"dresser\": [\n  \"《古典式化妆台》 起动：宣言卡名［丢弃1张手牌］\",\n  \"宣言卡名：选择要丢弃的 1 张手牌：《固执又纯真 冰刺鼠》\",\n  \"宣言1个卡名 → 憧憬天空 企丸丸\",\n  \"《古典式化妆台》 起动：X只帕鲁+1000/+1［丢弃X张手牌］\",\n  \"X只帕鲁+1000/+1：丢弃几张手牌（X）？ → 1\",\n  \"X只帕鲁+1000/+1：选择要丢弃的 1 张手牌：《高傲之牙 猎狼》\",\n  \"选择你的 1 只帕鲁：《固执又纯真 冰刺鼠》\",\n  \"《企丸丸的火箭发射器》 起动：选择1只帕鲁强化［横置此卡］\",\n  \"选择1只帕鲁（企丸丸则+500并获得能力）：《固执又纯真 冰刺鼠》\",\n  \"《固执又纯真 冰刺鼠》 起动：火箭发射［横置此卡］\",\n  \"《大海原的大战士 企丸王》 发起攻击\",\n  \"《畅游泳者 滑水蛇》 发起攻击\"\n ],\n \"frost\": [\n  \"使用 《倾注元气 壶小象》（2灵魂）\",\n  \"《抓钩枪》 起动：选择1只帕鲁战斗力+200［横置此卡］\",\n  \"选择 1 只帕鲁，直至回合结束战斗力+200：《倾注元气 壶小象》\",\n  \"《冻夜徘徊 冰缚灵》 发起攻击\",\n  \"（对手）《苍炎骏马 邪麒麟》 起动：妨碍［支付1灵魂、丢弃此卡］\",\n  \"《倾注元气 壶小象》 发起攻击\",\n  \"结束回合\",\n  \"（对手）使用 《高傲之牙 猎狼》（3灵魂）\",\n  \"（对手）《小小公主 姬小兔》 发起攻击\",\n  \"（对手）选择 《小小公主 姬小兔》 的攻击目标 → 对手玩家\",\n  \"（对手）《高傲之牙 猎狼》 发起攻击\",\n  \"（对手）选择 《高傲之牙 猎狼》 的攻击目标 → 对手玩家\",\n  \"（对手）支付 3 灵魂抽 1 张卡\",\n  \"（对手）结束回合\",\n  \"使用 《翻身回旋 鲁米儿》（3灵魂）\",\n  \"《抓钩枪》 起动：选择1只帕鲁战斗力+200［横置此卡］\",\n  \"选择 1 只帕鲁，直至回合结束战斗力+200：《高傲之牙 猎狼》\",\n  \"《冻夜徘徊 冰缚灵》 发起攻击\",\n  \"选择 《冻夜徘徊 冰缚灵》 的攻击目标 → 对手玩家\"\n ],\n \"mirror\": [\n  \"使用 《古典式镜子》（1灵魂）\",\n  \"使用 《起始帕鲁 皮皮鸡》（2灵魂）\",\n  \"《起始帕鲁 捣蛋猫》 发起攻击\",\n  \"（对手）使用 《暗黑炮》（3灵魂）\",\n  \"（对手）选择1只◇5以下帕鲁放置于墓地：《起始帕鲁 皮皮鸡》\",\n  \"结束回合\",\n  \"（对手）使用 《高傲之牙 猎狼》（3灵魂）\",\n  \"（对手）《高傲之牙 猎狼》 发起攻击\",\n  \"（对手）选择 《高傲之牙 猎狼》 的攻击目标 → 对手玩家\",\n  \"《高傲之牙 猎狼》 正在攻击 对手玩家，是否选择 1 只帕鲁阻挡？：《饿饿射手 佩克龙》\",\n  \"（对手）支付 3 灵魂抽 1 张卡\",\n  \"（对手）结束回合\",\n  \"使用 《古典式镜子》（1灵魂）\",\n  \"使用 《起始帕鲁 棉悠悠》（2灵魂）\",\n  \"《招财进宝 冰丝特》 发起攻击\",\n  \"《饿饿射手 佩克龙》 发起攻击\",\n  \"《起始帕鲁 捣蛋猫》 发起攻击\",\n  \"《起始帕鲁 棉悠悠》 发起攻击\"\n ],\n \"m_adv\": [\n  \"使用 《起始帕鲁 皮皮鸡》（2灵魂）\",\n  \"使用 《冒险的开始》（2灵魂）\",\n  \"《起始帕鲁 棉悠悠》 发起攻击\",\n  \"选择 《起始帕鲁 棉悠悠》 的攻击目标 → 对手玩家\",\n  \"《起始帕鲁 捣蛋猫》 发起攻击\",\n  \"选择 《起始帕鲁 捣蛋猫》 的攻击目标 → 对手玩家\",\n  \"《高傲之牙 猎狼》 发起攻击\",\n  \"选择 《高傲之牙 猎狼》 的攻击目标 → 对手玩家\"\n ],\n \"m_bird\": [\n  \"帕鲁超过上限，选择 2 只放置入墓地：《刺激又纯真 电棘鼠》、《熔岩好天气 火灵儿》\",\n  \"《勇气之火 火绒狐》 发起攻击\",\n  \"《起始帕鲁 捣蛋猫》 发起攻击\",\n  \"《温柔光辉 精灵龙》 发起攻击\",\n  \"《炎击之翼 燧火鸟》 发起攻击\",\n  \"《烈火骏马 火麒麟》 发起攻击\"\n ],\n \"m_blade\": [\n  \"《刺激又纯真 电棘鼠》 发起攻击\",\n  \"《刹那之刃 浪刃武士》 发起攻击\",\n  \"是否将 《刹那之刃 浪刃武士》 返回手牌？ → 是\",\n  \"使用 《刹那之刃 浪刃武士》（5灵魂）\",\n  \"《熔岩好天气 火灵儿》 发起攻击\",\n  \"《刹那之刃 浪刃武士》 发起攻击\"\n ],\n \"m_dragon\": [\n  \"使用 《火焰吐息》（2灵魂）\",\n  \"选择 1 张，给予 500 伤害：《高傲之牙 猎狼》\",\n  \"《狂暴熔岩龙 腾炎龙》 发起攻击\",\n  \"选择 《狂暴熔岩龙 腾炎龙》 的攻击目标 → 对手玩家\",\n  \"（对手）《挡路黑炎 狱阎王》 起动：妨碍［支付1灵魂、丢弃此卡］\",\n  \"《狂暴熔岩龙 腾炎龙》 起动：竖置此卡［丢弃2张手牌］\",\n  \"竖置此卡：选择要丢弃的 2 张手牌：《熔岩好天气 火灵儿》、《坚强火种 燎火鹿》\",\n  \"《狂暴熔岩龙 腾炎龙》 发起攻击\",\n  \"选择 《狂暴熔岩龙 腾炎龙》 的攻击目标 → 对手玩家\",\n  \"《刺激又纯真 电棘鼠》 发起攻击\",\n  \"选择 《刺激又纯真 电棘鼠》 的攻击目标 → 对手玩家\"\n ],\n \"m_dresser\": [\n  \"《古典式化妆台》 起动：X只帕鲁+1000/+1［丢弃X张手牌］\",\n  \"X只帕鲁+1000/+1：丢弃几张手牌（X）？ → 3\",\n  \"X只帕鲁+1000/+1：选择要丢弃的 3 张手牌：《高傲之牙 猎狼》、《高傲之牙 猎狼》、《高傲之牙 猎狼》\",\n  \"选择你的 3 只帕鲁：《畅游泳者 滑水蛇》、《固执又纯真 冰刺鼠》、《憧憬天空 企丸丸》\",\n  \"《畅游泳者 滑水蛇》 发起攻击\",\n  \"《憧憬天空 企丸丸》 发起攻击\",\n  \"《固执又纯真 冰刺鼠》 发起攻击\",\n  \"《倾注元气 壶小象》 发起攻击\"\n ]\n}",
};
const __ENTRY__ = "/app/server/server.js";
// 浏览器单机版：在 Web Worker 中运行原服务端代码所需的 Node 内置模块替身（fs / path / crypto / http / events）。
// 由 tools/build-demo.js 拼接到 server.bundle.js 开头。
/* global __MODULES__, __FILES__, __ENTRY__ */
'use strict';
const post = m => self.postMessage(m);
// ---------- path ----------
const P = {
  sep: '/',
  normalize(p) {
    const abs = p.startsWith('/'), out = [];
    for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return (abs ? '/' : '') + out.join('/');
  },
  join(...a) { return P.normalize(a.filter(x => x !== '').join('/')); },
  resolve(...a) { let r = ''; for (const x of a) r = x.startsWith('/') ? x : r + '/' + x; return P.normalize(r || '/'); },
  dirname(p) { const n = P.normalize(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); },
  basename(p, ext) { const b = P.normalize(p).split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
  extname(p) { const b = P.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
};
// ---------- fs（内存文件系统；/palworld-data 下的写入同步到页面 localStorage） ----------
const FILES = new Map(Object.entries(__FILES__));
const PERSIST = '/palworld-data/';
const enoent = p => { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; return e; };
const persist = (p, d) => { if (p.startsWith(PERSIST)) post({ t: 'save', path: p, data: d }); };
const FS = {
  readFileSync(p) { p = P.normalize(p); if (!FILES.has(p)) throw enoent(p); return FILES.get(p); },
  writeFileSync(p, s) { p = P.normalize(p); s = String(s); FILES.set(p, s); persist(p, s); },
  writeFile(p, s, cb) { try { FS.writeFileSync(p, s); cb && cb(null); } catch (e) { cb && cb(e); } },
  renameSync(a, b) { a = P.normalize(a); b = P.normalize(b); if (!FILES.has(a)) throw enoent(a); const d = FILES.get(a); FILES.delete(a); FILES.set(b, d); persist(a, null); persist(b, d); },
  copyFileSync(a, b) { FS.writeFileSync(b, FS.readFileSync(a)); },
  existsSync(p) { p = P.normalize(p); if (FILES.has(p)) return true; for (const k of FILES.keys()) if (k.startsWith(p + '/')) return true; return false; },
  mkdirSync() { },
  readdirSync(d) {
    d = P.normalize(d) + '/'; const out = new Set();
    for (const k of FILES.keys()) if (k.startsWith(d)) out.add(k.slice(d.length).split('/')[0]);
    return [...out];
  },
  stat(p, cb) { p = P.normalize(p); setTimeout(() => FILES.has(p) ? cb(null, { isFile: () => true, size: FILES.get(p).length }) : cb(enoent(p))); },
  rm(p, o, cb) { cb = typeof o === 'function' ? o : cb; p = P.normalize(p); FILES.delete(p); persist(p, null); cb && cb(null); },
  unlinkSync(p) { p = P.normalize(p); FILES.delete(p); persist(p, null); },
  createWriteStream() { throw new Error('单机版不支持上传文件'); },
  createReadStream() { throw new Error('单机版不支持读取文件流'); },
};
// ---------- crypto ----------
function sha256(msg) {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const b = typeof msg === 'string' ? new TextEncoder().encode(msg) : msg;
  const l = b.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(b); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  const r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = W[i - 15], c = W[i - 2]; W[i] = (W[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + W[i - 7] + (r(c, 17) ^ r(c, 19) ^ (c >>> 10))) >>> 0; }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); H.forEach((x, i) => ov.setUint32(i * 4, x)); return out;
}
const bytes = u8 => ({ u8, length: u8.length, toString: () => [...u8].map(x => x.toString(16).padStart(2, '0')).join(''), readUInt32LE: (o = 0) => new DataView(u8.buffer).getUint32(o, true) });
const CR = {
  randomUUID: () => self.crypto.randomUUID(),
  randomBytes: n => bytes(self.crypto.getRandomValues(new Uint8Array(n))),
  createHash() { let s = ''; const h = { update(x) { s += String(x); return h; }, digest() { return bytes(sha256(s)).toString(); } }; return h; },
  scryptSync(pw, salt, len) { let h = sha256(String(pw) + '|' + salt); for (let i = 0; i < 2000; i++) h = sha256(h); return bytes(h.slice(0, len)); },
};
// ---------- events ----------
class EventEmitter {
  constructor() { this._ev = {}; }
  on(e, f) { (this._ev[e] = this._ev[e] || []).push(f); return this; }
  once(e, f) { const w = (...a) => { this.off(e, w); f(...a); }; return this.on(e, w); }
  off(e, f) { this._ev[e] = (this._ev[e] || []).filter(x => x !== f); return this; }
  removeListener(e, f) { return this.off(e, f); }
  emit(e, ...a) { for (const f of (this._ev[e] || []).slice()) f(...a); return true; }
}
// ---------- http（把页面发来的请求交给原服务端的处理函数） ----------
let SERVER = null;
const HTTP = { createServer(handler) { SERVER = new EventEmitter(); SERVER.handler = handler; SERVER.listen = (p, cb) => { cb && cb(); }; return SERVER; } };
const WSMOD = { upgrade: (req, socket) => socket };
const BUILTIN = { fs: FS, path: P, crypto: CR, http: HTTP, events: EventEmitter, '#ws': WSMOD };
const process = { env: { AI_DELAY: '600', PTCG_DATA: '/palworld-data' }, pid: 1, on() { }, platform: 'browser', cwd: () => '/app' };
self.process = process;
// ---------- 模块系统 ----------
const CACHE = {};
function load(id) {
  if (BUILTIN[id]) return BUILTIN[id];
  if (CACHE[id]) return CACHE[id].exports;
  const def = __MODULES__[id]; if (!def) throw new Error('模块不存在：' + id);
  const module = { exports: {} }; CACHE[id] = module;
  if (def.json !== undefined) { module.exports = JSON.parse(def.json); return module.exports; }
  def.fn(module, module.exports, spec => load(def.deps[spec] || spec), P.dirname(id), id, process);
  return module.exports;
}
// ---------- 与页面通信 ----------
const sockets = new Map(); let ready = false; const queue = [];
function handle(m) {
  if (m.t === 'req') {
    const req = new EventEmitter(); req.url = m.url; req.method = m.method; req.headers = m.headers || {}; req.destroy = () => { };
    let done = false, status = 200, headers = {};
    const res = {
      statusCode: 200, setHeader(k, v) { headers[k.toLowerCase()] = v; },
      writeHead(c, h) { status = c; Object.assign(headers, h || {}); return res; },
      write() { }, end(body) { if (done) return; done = true; post({ t: 'res', id: m.id, status, headers, body: body == null ? '' : String(body) }); },
      on() { }, once() { }, emit() { },
    };
    try { SERVER.handler(req, res); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    setTimeout(() => { if (m.body) req.emit('data', m.body); req.emit('end'); });
  } else if (m.t === 'wsopen') {
    const ws = new EventEmitter(); ws.open = true;
    ws.send = o => { if (ws.open) post({ t: 'wsmsg', cid: m.cid, data: typeof o === 'string' ? o : JSON.stringify(o) }); };
    ws.close = () => { if (!ws.open) return; ws.open = false; post({ t: 'wsclose', cid: m.cid }); ws.emit('close'); };
    sockets.set(m.cid, ws); SERVER.emit('upgrade', { headers: {}, url: '/' }, ws);
  } else if (m.t === 'wsmsg') { const ws = sockets.get(m.cid); if (ws && ws.open) ws.emit('message', m.data); }
  else if (m.t === 'wsclose') { const ws = sockets.get(m.cid); if (ws && ws.open) { ws.open = false; ws.emit('close'); } sockets.delete(m.cid); }
}
self.onmessage = e => {
  const m = e.data;
  if (m.t === 'init') {
    for (const [k, v] of Object.entries(m.files || {})) FILES.set(k, v);
    try { load(__ENTRY__); } catch (err) { post({ t: 'fatal', error: String(err && err.stack || err) }); return; }
    ready = true; post({ t: 'ready' }); queue.splice(0).forEach(handle); return;
  }
  if (!ready) queue.push(m); else handle(m);
};
