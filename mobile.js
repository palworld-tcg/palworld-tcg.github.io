// 多设备适配：对局桌面整体缩放、竖屏提示、触屏长按看卡
(() => {
  const MIN_W = 1100, MIN_H = 640;          // 对局桌面的最小设计尺寸，屏幕更小时整体等比缩小
  const G = () => document.getElementById('v-game');
  let dismissed = false;
  const tip = document.createElement('div');
  tip.id = 'rotate-tip';
  tip.innerHTML = `<div class="ph"></div><div><b>请将手机横过来</b><br>横屏才能完整显示对战桌面</div>
    <button class="primary" id="rot-fs">全屏并横屏</button><button id="rot-no">仍然竖屏</button><small>iPhone 请关闭「竖排方向锁定」后旋转手机</small>`;
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(tip);
    tip.querySelector('#rot-fs').onclick = async () => {
      try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (e) { }
      setTimeout(fit, 300);
    };
    tip.querySelector('#rot-no').onclick = () => { dismissed = true; fit(); };
    new MutationObserver(fit).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    fit();
  });
  function fit() {
    const g = G(); if (!g) return;
    const ingame = document.body.classList.contains('ingame');
    const vv = window.visualViewport, vw = Math.round(vv ? vv.width * vv.scale : innerWidth), vh = Math.round(vv ? vv.height * vv.scale : innerHeight);
    document.body.classList.toggle('portrait-game', ingame && !dismissed && vh > vw && vw < 760);
    const s = Math.min(1, vw / MIN_W, vh / MIN_H);
    if (!ingame || s >= 0.999) {
      if (g.classList.contains('fit')) { g.classList.remove('fit'); g.style.cssText = ''; }
      document.documentElement.style.removeProperty('--S');
      return;
    }
    const W = vw / s, H = vh / s;
    g.classList.add('fit');
    g.style.cssText = `--S:${s};--VW:${W}px;--VH:${H}px`;
    document.documentElement.style.setProperty('--S', s);
  }
  window.fitBoard = fit;
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 200));
  if (window.visualViewport) visualViewport.addEventListener('resize', fit);

  // 触屏：长按任意卡牌查看大图与中文说明；轻点照常操作
  let lpT = null, sx = 0, sy = 0;
  window.__longPress = false;
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    window.__touchT = Date.now(); window.__longPress = false;
    const z = e.target.closest && e.target.closest('[data-zoom]');
    if (typeof hideZoom === 'function') hideZoom();
    if (!z) return;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(lpT);
    lpT = setTimeout(() => {
      window.__longPress = true;
      if (typeof showZoom === 'function') showZoom(z.dataset.zoom, z.dataset.extra, z.closest('.card') || z, z.dataset.img);
      if (navigator.vibrate) navigator.vibrate(15);
    }, 450);
  }, true);
  addEventListener('pointermove', e => { if (lpT && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(lpT); lpT = null; } }, true);
  addEventListener('pointerup', () => { clearTimeout(lpT); lpT = null; }, true);
  addEventListener('pointercancel', () => { clearTimeout(lpT); lpT = null; }, true);
  addEventListener('contextmenu', e => { if (window.__touchT && Date.now() - window.__touchT < 1500) { e.preventDefault(); e.stopPropagation(); } }, true);
})();
