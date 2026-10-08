'use strict';
// 程序化配乐与音效（WebAudio 实时合成，无外部音频文件）。
// 风格参考《幻兽帕鲁》原声带：明亮的五声音阶冒险旋律、木管/拨弦/弦乐铺底、战斗曲加入定音鼓与低音推进。
const Sound = (() => {
  let ctx = null, master, musicBus, sfxBus, comp, verb, cur = null, nextT = 0, timer = null, step = 0, want = null;
  const st = JSON.parse(localStorage.getItem('ptcg_audio') || '{"music":0.55,"sfx":0.8,"mute":false}');
  const saveSt = () => localStorage.setItem('ptcg_audio', JSON.stringify(st));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) return ctx.state === 'suspended' && ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = st.mute ? 0 : 1;
    musicBus = ctx.createGain(); musicBus.gain.value = st.music * 0.5;
    sfxBus = ctx.createGain(); sfxBus.gain.value = st.sfx * 0.7;
    // 简易混响（指数衰减噪声卷积）
    verb = ctx.createConvolver(); const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.32; verb.connect(vg); vg.connect(comp);
    musicBus.connect(comp); sfxBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    if (want) play(want);
  }
  const noiseBuf = () => { if (noiseBuf.b) return noiseBuf.b; const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf.b = b; };

  // ---------- 乐器 ----------
  function env(g, t, a, peak, d, sus, r, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * sus), t + Math.max(a + d, dur)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + r);
    return t + Math.max(a + d, dur) + r;
  }
  function voice(bus, { type = 'triangle', freq, t, dur, vol = .2, a = .01, d = .2, sus = .4, r = .3, cut = 4000, q = 1, det = 0, wet = .3, vib = 0 }) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = q;
    const end = env(g, t, a, vol, d, sus, r, dur);
    const oscs = (det ? [-det, det] : [0]).map(dt => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = dt; o.connect(f); o.start(t); o.stop(end + .05); return o; });
    if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = vib; l.connect(lg); oscs.forEach(o => lg.connect(o.detune)); l.start(t); l.stop(end); }
    f.connect(g); g.connect(bus); if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
  }
  const I = {
    flute: (m, t, dur, v = 1) => voice(musicBus, { type: 'sine', freq: mtof(m), t, dur, vol: .16 * v, a: .04, d: .1, sus: .8, r: .25, wet: .45, vib: 12 }),
    pluck: (m, t, dur, v = 1) => voice(musicBus, { type: 'triangle', freq: mtof(m), t, dur: .02, vol: .2 * v, a: .003, d: .35, sus: .05, r: .3, cut: 3200, wet: .3 }),
    pad: (m, t, dur, v = 1) => voice(musicBus, { type: 'sawtooth', freq: mtof(m), t, dur, vol: .045 * v, a: .5, d: .4, sus: .8, r: .9, cut: 1100, det: 9, wet: .6 }),
    brass: (m, t, dur, v = 1) => voice(musicBus, { type: 'sawtooth', freq: mtof(m), t, dur, vol: .09 * v, a: .06, d: .2, sus: .7, r: .2, cut: 1800, q: 2, det: 5, wet: .35 }),
    bass: (m, t, dur, v = 1) => voice(musicBus, { type: 'triangle', freq: mtof(m), t, dur, vol: .26 * v, a: .01, d: .2, sus: .5, r: .12, cut: 700, wet: 0 }),
    bell: (m, t, dur, v = 1) => { voice(musicBus, { type: 'sine', freq: mtof(m), t, dur: .01, vol: .12 * v, a: .002, d: 1.2, sus: .01, r: .5, wet: .5 }); voice(musicBus, { type: 'sine', freq: mtof(m) * 2.76, t, dur: .01, vol: .03 * v, a: .002, d: .4, sus: .01, r: .2, wet: .5 }); },
    kick: (t, v = 1) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + .18); g.gain.setValueAtTime(.5 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + .32); },
    timp: (m, t, v = 1) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(mtof(m) * 1.5, t); o.frequency.exponentialRampToValueAtTime(mtof(m), t + .08); g.gain.setValueAtTime(.35 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .7); o.connect(g); g.connect(musicBus); const w = ctx.createGain(); w.gain.value = .3; g.connect(w); w.connect(verb); o.start(t); o.stop(t + .75); },
    hat: (t, v = 1) => { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf(); f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(.06 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); s.connect(f); f.connect(g); g.connect(musicBus); s.start(t); s.stop(t + .06); },
    snare: (t, v = 1) => { const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf(); f.type = 'bandpass'; f.frequency.value = 1800; g.gain.setValueAtTime(.16 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .16); s.connect(f); f.connect(g); g.connect(musicBus); s.start(t); s.stop(t + .18); },
  };

  // ---------- 曲目（16 分音符为一步） ----------
  // 和弦：根音 MIDI + 类型；旋律：五声音阶度数（-1 = 休止），每项为 [度数, 时值(步)]
  const PENTA = [0, 2, 4, 7, 9];
  const deg = (root, d) => root + PENTA[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
  const CH = { M: [0, 4, 7, 11], m: [0, 3, 7, 10], s: [0, 5, 7, 14], M9: [0, 4, 7, 14] };
  const TRACKS = {
    // 标题：辽阔的冒险主题（F 大调 I–V–vi–IV）
    title: { bpm: 84, key: 65, bars: [[53, 'M9'], [60, 's'], [62, 'm'], [58, 'M'], [53, 'M9'], [60, 's'], [58, 'M'], [60, 's']],
      mel: [[[5, 6], [6, 2], [7, 4], [9, 4]], [[8, 8], [7, 4], [5, 4]], [[6, 6], [5, 2], [4, 8]], [[3, 4], [4, 4], [5, 8]],
            [[5, 6], [6, 2], [7, 4], [10, 4]], [[9, 8], [8, 4], [7, 4]], [[8, 4], [7, 4], [6, 4], [5, 4]], [[5, 12], [-1, 4]]],
      drums: 'soft', lead: 'flute' },
    // 菜单：轻松的拨弦小品（C 大调）
    menu: { bpm: 96, key: 60, bars: [[48, 'M9'], [45, 'm'], [53, 'M9'], [55, 's']],
      mel: [[[5, 2], [7, 2], [8, 4], [7, 2], [5, 2], [6, 4]], [[4, 4], [5, 2], [4, 2], [2, 8]], [[3, 2], [4, 2], [5, 4], [7, 4], [6, 4]], [[5, 10], [-1, 6]]],
      drums: 'light', lead: 'pluck', arp: true },
    // 对战：紧张推进（D 小调 i–VI–III–VII）
    battle: { bpm: 132, key: 62, minor: true, bars: [[50, 'm'], [46, 'M'], [53, 'M'], [48, 'M'], [50, 'm'], [46, 'M'], [43, 'm'], [45, 'M']],
      mel: [[[5, 3], [5, 1], [7, 2], [8, 2], [7, 4], [5, 4]], [[6, 4], [5, 2], [4, 2], [3, 8]], [[5, 3], [5, 1], [7, 2], [9, 2], [10, 4], [9, 4]], [[8, 8], [7, 8]],
            [[10, 3], [9, 1], [8, 4], [7, 4], [8, 4]], [[6, 4], [7, 4], [8, 8]], [[7, 3], [6, 1], [5, 4], [4, 4], [3, 4]], [[5, 12], [-1, 4]]],
      drums: 'battle', lead: 'brass' },
    // 大奖赛选牌：期待感（G 大调，铃声琶音）
    draft: { bpm: 104, key: 67, bars: [[55, 'M9'], [52, 'm'], [48, 'M9'], [50, 's']],
      mel: [[[7, 4], [8, 2], [9, 2], [10, 8]], [[9, 4], [8, 4], [7, 8]], [[5, 4], [7, 4], [8, 4], [9, 4]], [[7, 12], [-1, 4]]],
      drums: 'light', lead: 'bell', arp: true },
  };
  // 小调旋律用自然小调五声
  const PENTA_MIN = [0, 3, 5, 7, 10];
  const degM = (root, d) => root + PENTA_MIN[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);

  function schedule() {
    if (!cur) return;
    const T = TRACKS[cur], spb = 60 / T.bpm / 4; // 每步秒数
    while (nextT < ctx.currentTime + 0.25) {
      const bar = Math.floor(step / 16) % T.bars.length, s = step % 16, t = nextT;
      const [root, ty] = T.bars[bar], ch = CH[ty];
      if (s === 0) { ch.forEach(iv => I.pad(root + 12 + iv, t, spb * 15)); }
      // 低音
      if (T.drums === 'battle') { if (s % 2 === 0) I.bass(root - 12 + (s % 8 === 6 ? 7 : 0), t, spb * 1.6, .9); }
      else if (s === 0 || s === 10) I.bass(root - 12, t, spb * 6);
      else if (s === 6) I.bass(root - 12 + 7, t, spb * 3, .7);
      // 琶音
      if (T.arp && s % 2 === 0) I.pluck(root + 24 + ch[(s / 2) % ch.length], t, spb, .45);
      if (!T.arp && T.drums !== 'battle' && s % 4 === 2) I.pluck(root + 24 + ch[(s / 4 | 0) % ch.length], t, spb, .35);
      // 旋律
      let pos = 0; for (const [d, len] of T.mel[bar % T.mel.length]) {
        if (pos === s && d >= 0) { const m = (T.minor ? degM : deg)(T.key - 12, d); I[T.lead](m, t, spb * len * .92); if (T.lead === 'brass') I.flute(m + 12, t, spb * len * .9, .35); }
        pos += len;
      }
      // 打击乐
      if (T.drums === 'battle') {
        if (s % 8 === 0) I.kick(t); if (s % 8 === 4) I.snare(t); if (s % 2 === 1) I.hat(t, .7);
        if (s === 14 && bar % 2 === 1) { I.timp(root - 12, t); I.timp(root - 12, t + spb); }
      } else if (T.drums === 'light') { if (s % 4 === 2) I.hat(t, .5); if (s === 0) I.kick(t, .4); }
      else if (T.drums === 'soft') { if (s === 0 && bar % 2 === 0) I.timp(root - 12, t, .6); }
      step++; nextT += spb;
    }
  }
  // ---------- 自备原声带（服务器 music 目录） ----------
  let EXT = null, ext = null, extScene = null;
  const FALL = { title: ['title', 'menu'], menu: ['menu', 'title'], draft: ['draft', 'menu', 'title'], battle: ['battle'] };
  const reload = () => fetch('/api/music').then(r => r.json()).then(j => { EXT = j; if (want && ctx) { const w = want; cur = null; extScene = null; play(w); } }).catch(() => { EXT = { tracks: {} }; }); reload();
  const extList = sc => { if (!EXT || st.src === 'synth') return []; for (const k of FALL[sc] || [sc]) if ((EXT.tracks[k] || []).length) return EXT.tracks[k]; return []; };
  function extFade(a, to, sec, done) {
    const from = a.volume, t0 = performance.now();
    const f = () => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) requestAnimationFrame(f); else done && done(); };
    f();
  }
  const extVol = () => st.mute ? 0 : Math.min(1, st.music * 1.1);
  function extStop() { if (!ext) return; const a = ext; ext = null; extScene = null; extFade(a, 0, .8, () => { a.pause(); a.src = ''; }); }
  function extPlay(sc, list, once) {
    if (ext && extScene === sc) return true;
    extStop(); extScene = sc;
    const a = new Audio(); a.preload = 'auto'; a.volume = 0; ext = a;
    let order = (sc === 'title' || sc === 'menu') && /hello/i.test(decodeURIComponent(list[0])) ? [list[0], ...list.slice(1).sort(() => Math.random() - .5)] : list.slice().sort(() => Math.random() - .5), i = 0;
    const next = () => { if (ext !== a) return; a.src = order[i++ % order.length]; a.play().catch(() => { }); extFade(a, extVol(), 1.2); };
    a.onended = () => { if (once) { if (ext === a) { ext = null; extScene = null; } return; } next(); };
    a.onerror = () => { if (ext === a && order.length > 1) next(); };
    next(); return true;
  }
  function play(name) {
    want = name; if (!ctx) return;
    const L = extList(name);
    if (L.length) { if (timer) stop(true); cur = null; want = name; extPlay(name, L); return; }
    extStop();
    if (cur === name) return;
    stop(true); cur = name; step = 0; nextT = ctx.currentTime + 0.1;
    musicBus.gain.cancelScheduledValues(ctx.currentTime); musicBus.gain.setValueAtTime(0.0001, ctx.currentTime); musicBus.gain.linearRampToValueAtTime(st.music * 0.5, ctx.currentTime + 1.2);
    timer = setInterval(schedule, 60); schedule();
  }
  function stop(keepWant) {
    if (!keepWant) want = null;
    if (timer) clearInterval(timer); timer = null; cur = null;
    if (ctx) { // 淡出：替换总线，让已调度的音符在旧总线上消失
      const old = musicBus; old.gain.cancelScheduledValues(ctx.currentTime); old.gain.setValueAtTime(old.gain.value, ctx.currentTime); old.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + .6);
      setTimeout(() => old.disconnect(), 3000);
      musicBus = ctx.createGain(); musicBus.gain.value = st.music * 0.5; musicBus.connect(comp);
    }
  }
  // 一次性乐句（胜利 / 失败 / 解锁）
  function sting(kind) {
    if (!ctx) return; stop();
    if ((kind === 'win' || kind === 'lose') && EXT && st.src !== 'synth' && (EXT.tracks[kind] || []).length) { extPlay(kind, EXT.tracks[kind], true); return; }
    extStop(); const t = ctx.currentTime + .05, B = sfxBus;
    const n = (m, at, d, v = 1, ty = 'brass') => { const keep = musicBus; musicBus = B; I[ty](m, t + at, d, v); musicBus = keep; };
    if (kind === 'win') { [[60, 0, .15], [64, .15, .15], [67, .3, .15], [72, .45, .9]].forEach(([m, a, d]) => { n(m, a, d, 1.6); n(m + 12, a, d, .6, 'flute'); }); [48, 55, 64, 67].forEach(m => n(m, .45, 1.6, 1, 'pad')); const k = musicBus; musicBus = B; I.timp(36, t + .45); I.timp(36, t + .6); musicBus = k; }
    else if (kind === 'lose') { [[67, 0, .4], [63, .4, .4], [60, .8, .4], [55, 1.2, 1.4]].forEach(([m, a, d]) => n(m, a, d, 1, 'flute')); [43, 51, 58].forEach(m => n(m, 1.2, 2, 1, 'pad')); }
    else if (kind === 'unlock') { [72, 76, 79, 84].forEach((m, i) => n(m, i * .08, .3, 1, 'bell')); }
  }

  // ---------- 音效 ----------
  const S = {
    hover: () => voice(sfxBus, { type: 'sine', freq: 1900, t: ctx.currentTime, dur: .005, vol: .035, a: .002, d: .04, sus: .01, r: .03, wet: 0 }),
    click: () => { const t = ctx.currentTime; voice(sfxBus, { type: 'triangle', freq: 220, t, dur: .01, vol: .25, a: .002, d: .08, sus: .01, r: .05, cut: 1200, wet: 0 }); voice(sfxBus, { type: 'sine', freq: 1320, t: t + .01, dur: .01, vol: .08, a: .002, d: .12, sus: .01, r: .1, wet: .3 }); },
    confirm: () => { const t = ctx.currentTime; [784, 1175].forEach((f, i) => voice(sfxBus, { type: 'triangle', freq: f, t: t + i * .07, dur: .02, vol: .14, a: .003, d: .2, sus: .05, r: .2, wet: .4 })); voice(sfxBus, { type: 'sine', freq: 110, t, dur: .02, vol: .3, a: .002, d: .15, sus: .01, r: .1, wet: 0 }); },
    back: () => { const t = ctx.currentTime; [880, 587].forEach((f, i) => voice(sfxBus, { type: 'triangle', freq: f, t: t + i * .06, dur: .02, vol: .1, a: .003, d: .12, sus: .05, r: .1, wet: .2 })); },
    whoosh: (v = 1, dur = .35) => { const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3500, t + dur * .6); f.frequency.exponentialRampToValueAtTime(800, t + dur); g.gain.setValueAtTime(.001, t); g.gain.linearRampToValueAtTime(.22 * v, t + dur * .4); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + .05); },
    card: () => { S.whoosh(.5, .18); const t = ctx.currentTime + .1; voice(sfxBus, { type: 'triangle', freq: 160, t, dur: .01, vol: .25, a: .002, d: .06, sus: .01, r: .05, cut: 900, wet: 0 }); },
    pick: () => { S.whoosh(.7, .3); const t = ctx.currentTime + .12;[1047, 1319, 1568].forEach((f, i) => voice(sfxBus, { type: 'sine', freq: f, t: t + i * .05, dur: .02, vol: .1, a: .002, d: .4, sus: .02, r: .3, wet: .5 })); },
    flip: () => { const t = ctx.currentTime; for (let i = 0; i < 3; i++) voice(sfxBus, { type: 'square', freq: 2400 - i * 500, t: t + i * .03, dur: .003, vol: .03, a: .001, d: .02, sus: .01, r: .02, cut: 5000, wet: 0 }); },
    attack: () => { S.whoosh(1.1, .4); const t = ctx.currentTime + .25; voice(sfxBus, { type: 'sawtooth', freq: 90, t, dur: .05, vol: .2, a: .005, d: .2, sus: .05, r: .1, cut: 600, wet: .2 }); },
    hit: () => { const t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = noiseBuf(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(200, t + .25); g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + .32); const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .2); og.gain.setValueAtTime(.5, t); og.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(og); og.connect(sfxBus); o.start(t); o.stop(t + .32); },
    ko: () => { S.hit(); const t = ctx.currentTime + .05; voice(sfxBus, { type: 'sawtooth', freq: 300, t, dur: .3, vol: .12, a: .01, d: .3, sus: .3, r: .4, cut: 900, wet: .5 }); },
    soul: () => { const t = ctx.currentTime;[523, 659, 784, 1047].forEach((f, i) => voice(sfxBus, { type: 'sine', freq: f, t: t + i * .04, dur: .02, vol: .06, a: .002, d: .3, sus: .02, r: .2, wet: .6 })); },
    turn: () => { const t = ctx.currentTime; voice(sfxBus, { type: 'sine', freq: 392, t, dur: .1, vol: .12, a: .01, d: .3, sus: .3, r: .5, wet: .6 }); voice(sfxBus, { type: 'sine', freq: 587, t: t + .12, dur: .1, vol: .1, a: .01, d: .3, sus: .3, r: .6, wet: .6 }); },
    pop: () => { const t = ctx.currentTime; voice(sfxBus, { type: 'sine', freq: 520, t, dur: .01, vol: .14, a: .002, d: .09, sus: .01, r: .06, wet: .2 }); voice(sfxBus, { type: 'sine', freq: 1040, t: t + .05, dur: .01, vol: .08, a: .002, d: .1, sus: .01, r: .08, wet: .3 }); },
    chat: () => { const t = ctx.currentTime;[660, 880].forEach((f, i) => voice(sfxBus, { type: 'triangle', freq: f, t: t + i * .06, dur: .02, vol: .08, a: .003, d: .12, sus: .05, r: .1, wet: .3 })); },
    error: () => { const t = ctx.currentTime; voice(sfxBus, { type: 'square', freq: 180, t, dur: .08, vol: .06, a: .005, d: .05, sus: .6, r: .05, cut: 900, wet: 0 }); },
  };
  let lastHover = 0;
  function sfx(name, ...a) {
    if (!ctx || st.mute || !S[name]) return;
    if (name === 'hover') { const n = performance.now(); if (n - lastHover < 60) return; lastHover = n; }
    try { S[name](...a); } catch (e) { }
  }
  function set(k, v) {
    st[k] = v; saveSt(); if (!ctx && k !== 'src') return; if (!ctx) return;
    if ((k === 'mute' || k === 'music') && ext) ext.volume = extVol();
    if (k === 'src') { const w = want || extScene; cur = null; extStop(); stop(true); if (w) play(w); }
    if (k === 'mute') master.gain.setTargetAtTime(v ? 0 : 1, ctx.currentTime, .05);
    if (k === 'music') musicBus.gain.setTargetAtTime(v * .5, ctx.currentTime, .05);
    if (k === 'sfx') sfxBus.gain.setTargetAtTime(v * .7, ctx.currentTime, .05);
  }
  // 浏览器要求用户手势后才能出声
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => init(), { capture: true }));
  return { init, play, stop, sfx, sting, set, get st() { return st; }, get track() { return cur || extScene || want; }, get ext() { return EXT; }, get extOn() { return !!ext; }, reload: () => { cur = null; extScene = null; ext && extStop(); return reload(); } };
})();
window.Sound = Sound;
