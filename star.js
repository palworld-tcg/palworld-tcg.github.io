// 顶栏 GitHub Star 徽章：显示仓库当前 star 数，点击打开项目页（可在那里点 Star）
(() => {
  const REPO = 'binyxu/palworld-tcg', URL_ = 'https://github.com/' + REPO, KEY = 'ptcg_star_cache', TTL = 10 * 60 * 1000;
  const css = document.createElement('style');
  css.textContent = `.gh-star{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;margin-right:10px;border-radius:14px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);color:inherit;font-size:12px;text-decoration:none;vertical-align:middle;transition:background .15s}
    .gh-star:hover{background:rgba(255,215,90,.18);border-color:rgba(255,215,90,.55)}
    .gh-star svg{width:15px;height:15px;fill:currentColor}.gh-star b{color:#ffd75a;font-weight:600}.gh-star .n{opacity:.9}
    .gh-star.fx{position:fixed;right:18px;top:16px;z-index:60;display:none;backdrop-filter:blur(8px)}body[data-view="title"] .gh-star.fx{display:inline-flex}`;
  document.head.appendChild(css);
  const icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  const a = document.createElement('a');
  a.className = 'gh-star'; a.href = URL_; a.target = '_blank'; a.rel = 'noopener'; a.title = '在 GitHub 上给项目点个 Star 吧';
  a.innerHTML = icon + '<span>Star</span><b>★</b><span class="n">…</span>';
  // 两个入口��顶栏内一个；标题画面（顶栏隐藏）右上角一个
  const b = a.cloneNode(true); b.classList.add('fx');
  for (const x of [a, b]) x.addEventListener('click', e => e.stopPropagation());   // 标题画面"点击任意位置开始"不应被触发
  const show = n => { for (const x of [a, b]) x.querySelector('.n').textContent = n == null ? '' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n; };
  const mount = () => { const me = document.querySelector('#top .me'); if (me) me.prepend(a); document.body.appendChild(b); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();
  let c = null; try { c = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
  if (c) show(c.n);
  if (!c || Date.now() - c.t > TTL) {   // GitHub API 未登录限额 60 次/小时，故缓存 10 分钟
    fetch('https://api.github.com/repos/' + REPO).then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => { show(j.stargazers_count); try { localStorage.setItem(KEY, JSON.stringify({ n: j.stargazers_count, t: Date.now() })); } catch (e) { } })
      .catch(() => { if (!c) show(null); });
  }
})();
