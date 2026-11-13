(function () {
  'use strict';
  const M = window.MAPDATA, STEPS = window.STEPS, L = window.LEADERS, G = window.GROUPS;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const svg = $('map'), wrap = $('mapWrap');
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // приглушённые «архивные» тона для государств вне выделенных групп
  const BASE = ['#e4dccb', '#d9d1bd', '#cfc7b2', '#e0d7c2', '#d5ccb6', '#dad3c3'];
  const baseColor = k => { let h = 7; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return BASE[h % BASE.length]; };

  let idx = 0, view = { x: 0, y: 0, w: M.W, h: M.H }, anim = null, activeMark = -1;

  // ---------- каркас SVG ----------
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, defs);
  el('path', { d: 'M0,0L10,5L0,10z', fill: '#b3121b' }, mk);
  el('rect', { x: -3000, y: -3000, width: 7000, height: 7000, fill: 'var(--sea)' }, svg);
  const pat = el('pattern', { id: 'dots', width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, defs); el('circle', { cx: 3, cy: 3, r: 0.9, fill: '#11111118' }, pat);
  el('rect', { x: -3000, y: -3000, width: 7000, height: 7000, fill: 'url(#dots)' }, svg);
  el('path', { d: M.graticule, class: 'grat' }, svg);
  const gLand = el('g', {}, svg), gLbl = el('g', {}, svg), gFlow = el('g', {}, svg), gMk = el('g', {}, svg), gEdge = el('g', {}, svg);

  // ---------- вид (viewBox) ----------
  function aspect() { const r = wrap.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1 }; }
  function fitView(b) { // b: {x,y,w,h} → прямоугольник с пропорциями контейнера
    const a = aspect(), ar = a.w / a.h;
    let { x, y, w, h } = b;
    if (w / h > ar) { const nh = w / ar; y -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x -= (nw - w) / 2; w = nw; }
    return { x, y, w, h };
  }
  function applyView() { svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); sizeOverlay(); }
  function animateTo(t, ms = 650) {
    cancelAnimationFrame(anim);
    const s = { ...view }, t0 = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
    const tick = now => {
      const p = ms ? Math.min(1, (now - t0) / ms) : 1, e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      for (const k of ['x', 'y', 'w', 'h']) view[k] = s[k] + (t[k] - s[k]) * e;
      applyView();
      if (p < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }
  const unit = () => view.w / aspect().w; // единиц SVG на 1 px экрана

  function stepBox(st) {
    const pts = st.markers.map(m => M.cities[m.c]).filter(Boolean);
    (st.flows || []).forEach(f => [f.from, f.to].forEach(c => M.cities[c] && pts.push(M.cities[c])));
    const home = { x: 0, y: 0, w: M.W, h: M.H };
    if (pts.length < 2) return home;
    let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
    const small = aspect().w < 700, minW = small ? 420 : 560, minH = small ? 380 : 440;
    let w = Math.max(x1 - x0, minW), h = Math.max(y1 - y0, minH);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    w *= 1.25; h *= 1.25;
    if (w > M.W * 1.05 || h > M.H * 1.05) return home;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  // ---------- отрисовка шага ----------
  const yearOf = st => parseInt(st.id, 10);
  let labelData = [], markEls = [], edgeData = [], flowData = [], usaBadge = null;

  // слой суши: при смене среза границ старый слой растворяется, изменившиеся страны обводятся
  const gLandWrap = el('g', {}, svg); svg.insertBefore(gLandWrap, gLand); gLand.remove();
  const gChg = el('g', { class: 'chg-layer' }); svg.insertBefore(gChg, gLbl);
  let curSnap = null, landPaths = {}, chgTimer = 0;
  const NOISE = new Set(['DZ', 'AD', 'IE', 'MA', 'IR']); // различия срезов, а не реальные изменения границ
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function changedKeys(a, b) {
    const A = M.labels[a], B = M.labels[b], out = [];
    for (const k in B) {
      if (NOISE.has(k)) continue;
      if (!A[k]) out.push(k);
      else if (Math.abs(B[k][2] - A[k][2]) / A[k][2] > 0.03) out.push(k);
    }
    return out;
  }
  function styleLand(st) {
    const focus = new Set(st.focus || []), groups = st.groups || {};
    for (const k in landPaths) {
      const g = groups[k];
      const p = landPaths[k];
      p.style.fill = g ? G[g].c : baseColor(k);
      p.setAttribute('class', 'c' + (focus.has(k) ? ' focus' : '') + (!g && !focus.has(k) && focus.size ? ' dim' : ''));
    }
  }
  function renderLand(st) {
    if (st.snap === curSnap) { styleLand(st); return; }
    const prev = curSnap, oldG = gLandWrap.lastElementChild;
    const ng = el('g', { class: 'land' });
    gLandWrap.insertBefore(ng, gLandWrap.firstChild);
    landPaths = {};
    for (const p of M.snaps[st.snap]) {
      const path = el('path', { d: p.d, 'data-k': p.k }, ng);
      path.addEventListener('click', () => {
        if (dragged) return;
        const cur = STEPS[idx], g = (cur.groups || {})[p.k];
        openCountry(p.k);
      });
      landPaths[p.k] = path;
    }
    styleLand(st);
    curSnap = st.snap;
    if (!oldG) return;
    if (!prev || reduceMotion()) { oldG.remove(); return; }
    oldG.classList.add('old');
    requestAnimationFrame(() => requestAnimationFrame(() => oldG.classList.add('out')));
    setTimeout(() => oldG.remove(), 1100);
    // обводка государств, чьи границы изменились
    clearTimeout(chgTimer); gChg.textContent = '';
    const keys = changedKeys(prev, st.snap), sw = 2.6 * unit();
    for (const k of keys) {
      const src = M.snaps[st.snap].find(p => p.k === k);
      if (src) el('path', { d: src.d, pathLength: 1, class: 'chg', 'stroke-width': sw }, gChg);
    }
    const badge = $('mapChg');
    if (keys.length) { badge.hidden = false; badge.classList.remove('show'); void badge.offsetWidth; badge.classList.add('show'); }
    chgTimer = setTimeout(() => { gChg.textContent = ''; badge.hidden = true; }, 4300);
  }

  function renderMap(st) {
    const y = yearOf(st), focus = new Set(st.focus || []), groups = st.groups || {};
    gLbl.textContent = ''; gFlow.textContent = ''; gMk.textContent = ''; gEdge.textContent = '';
    renderLand(st);
    // подписи
    labelData = [];
    const lab = M.labels[st.snap];
    for (const k in lab) {
      const [x, yy, a] = lab[k];
      if (a < 900) continue;
      const t = el('text', { x, y: yy, class: 'lbl' + (focus.has(k) ? ' big' : '') }, gLbl);
      t.textContent = window.countryShort(k, y);
      labelData.push({ t, a, focus: focus.has(k) });
    }
    // потоки
    flowData = (st.flows || []).map(f => {
      const p = el('path', { class: 'flow', 'marker-end': 'url(#arr)' }, gFlow);
      const t = el('text', { class: 'flow-t' }, gFlow); t.textContent = f.t || '';
      return { f, p, t };
    });
    // метки городов
    markEls = st.markers.map((m, i) => {
      const [x, yy] = M.cities[m.c];
      const g = el('g', { class: 'mk', tabindex: 0, role: 'button', 'aria-label': m.t }, gMk);
      const halo = el('circle', { cx: x, cy: yy, class: 'halo' }, g);
      const dot = el('rect', { class: 'dot' }, g);
      const num = el('text', { x, y: yy }, g); num.textContent = i + 1;
      const name = el('text', { x, y: yy, class: 'name' }, g); name.textContent = m.t;
      const open = () => selectMark(i);
      g.addEventListener('click', e => { e.stopPropagation(); if (!dragged) open(); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      return { g, halo, dot, num, name, x, y: yy };
    });
    // края карты
    const usesUsa = (st.flows || []).some(f => f.from === 'usa' || f.to === 'usa');
    if (usesUsa) {
      const g = el('g', { class: 'edge usa', tabindex: 0, role: 'button' }, gEdge); const r = el('rect', {}, g); const t = el('text', {}, g); t.textContent = 'США';
      g.addEventListener('click', () => { if (!dragged) openCountry('US'); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCountry('US'); } });
      usaBadge = { e: { side: 'usa', y: 0.42 }, g, r, t };
    } else usaBadge = null;
    edgeData = (st.edges || []).map((e, j) => {
      const g = el('g', { class: 'edge mk', tabindex: 0, role: 'button' }, gEdge);
      const r = el('rect', {}, g); const t = el('text', {}, g);
      const n = st.markers.length + j;
      t.textContent = (e.side === 'south' ? '↓ ' : e.side === 'west' ? '← ' : '→ ') + e.t;
      g.addEventListener('click', ev => { ev.stopPropagation(); if (!dragged) selectMark(n); });
      return { e, g, r, t };
    });
    // легенда
    const used = [...new Set(Object.values(groups))].filter(g => G[g] && G[g].t);
    $('legend').innerHTML = used.map(g => `<span><i style="background:${G[g].c}"></i>${esc(G[g].t)}</span>`).join('');
    $('mapYear').textContent = st.label.replace('·', ' ');
  }

  // точка на краю видимой области (для США, Урала, Дальнего Востока)
  function edgePoint(name) {
    const u = unit(), pad = 26 * u;
    if (name === 'usa') return [view.x + 62 * u, view.y + view.h * 0.42];
    if (name === 'east') return [view.x + view.w - pad, view.y + view.h * 0.42];
    if (name === 'far') return [view.x + view.w - pad, view.y + view.h * 0.22];
    return M.cities[name];
  }

  function sizeOverlay() {
    const u = unit(), small = aspect().w < 600;
    // подписи стран: размер в пикселях экрана, скрываем мелкие
    for (const l of labelData) {
      const px = Math.max(10, Math.min(small ? 15 : 19, Math.sqrt(l.a) / u / (small ? 26 : 22)));
      const areaPx = l.a / (u * u);
      const show = areaPx > (small ? 2600 : 1800) || (l.focus && areaPx > 900);
      l.t.setAttribute('font-size', px * u);
      l.t.setAttribute('stroke-width', 3 * u);
      l.t.style.display = show ? '' : 'none';
    }
    for (const m of markEls) {
      m.dot.setAttribute('x', m.x - 10.5 * u); m.dot.setAttribute('y', m.y - 10.5 * u); m.dot.setAttribute('width', 21 * u); m.dot.setAttribute('height', 21 * u); m.halo.setAttribute('r', (m.g.classList.contains('on') ? 24 : 17) * u);
      m.num.setAttribute('font-size', 12.5 * u);
      m.name.setAttribute('x', m.x + 15 * u); m.name.setAttribute('font-size', 13.5 * u); m.name.setAttribute('stroke-width', 3.5 * u);
      m.name.style.display = small && markEls.length > 3 && !m.g.classList.contains('on') ? 'none' : '';
    }
    for (const d of (usaBadge ? edgeData.concat([usaBadge]) : edgeData)) {
      const fs = 13 * u; d.t.setAttribute('font-size', fs);
      const tw = (d.t.getComputedTextLength ? d.t.getComputedTextLength() : 100 * u) + 16 * u, th = 26 * u;
      let x, yy;
      if (d.e.side === 'usa') { x = view.x + 10 * u; yy = view.y + view.h * 0.42 - th / 2; }
      else if (d.e.side === 'west') { x = view.x + 10 * u; yy = view.y + view.h * d.e.y; }
      else if (d.e.side === 'south') { x = view.x + view.w - tw - 56 * u; yy = view.y + view.h * d.e.y; }
      else if (d.e.side === 'far') { x = view.x + view.w - tw - 56 * u; yy = view.y + view.h * d.e.y; }
      else { x = view.x + view.w - tw - 56 * u; yy = view.y + view.h * d.e.y; }
      d.r.setAttribute('x', x); d.r.setAttribute('y', yy); d.r.setAttribute('width', tw); d.r.setAttribute('height', th); d.r.setAttribute('rx', 6 * u);
      d.t.setAttribute('x', x + 8 * u); d.t.setAttribute('y', yy + th / 2);
    }
    for (const fd of flowData) {
      const a = edgePoint(fd.f.from), b = edgePoint(fd.f.to);
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const off = Math.min(len * 0.22, 120);
      const mx = (a[0] + b[0]) / 2 - dy / len * off, my = (a[1] + b[1]) / 2 + dx / len * off;
      const sh = 16 * u, ax = a[0] + dx / len * sh, ay = a[1] + dy / len * sh, bx = b[0] - dx / len * sh, by = b[1] - dy / len * sh;
      fd.p.setAttribute('d', `M${ax},${ay}Q${mx},${my} ${bx},${by}`);
      fd.t.setAttribute('x', (ax + 2 * mx + bx) / 4); fd.t.setAttribute('y', (ay + 2 * my + by) / 4);
      fd.t.setAttribute('font-size', 13 * u); fd.t.setAttribute('stroke-width', 4 * u);
    }
  }

  // ---------- панель ----------
  const SECTIONS = [['politics', 'p', 'Политика'], ['society', 's', 'Общество и экономика'], ['analysis', 'a', 'Анализ']];
  function renderPanel(st) {
    $('stepDate').textContent = st.date;
    $('stepTitle').textContent = st.title;
    const note = $('stepNote'); note.hidden = !st.note; note.textContent = st.note || '';
    const ex = (window.EXTRA || {})[st.id] || {};
    $('sections').innerHTML = SECTIONS.map(([k, e, h]) => {
      const paras = [st[k], ex[e]].filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('');
      return `<section class="sec sec-${k}"><h3>${h}</h3>${paras}</section>`;
    }).join('');
    const charts = st.charts || (st.chart ? [st.chart] : []);
    $('chartBox').hidden = !charts.length;
    $('chartBox').innerHTML = charts.map(chartHTML).join('');
    renderLinks(st);
    const all = st.markers.map((m, i) => ({ n: i + 1, t: m.t, d: m.d, edge: false })).concat((st.edges || []).map(e => ({ n: '→', t: e.t, d: e.d, edge: true })));
    $('marks').innerHTML = all.map((m, i) => `<li><button type="button" data-i="${i}"><span class="n${m.edge ? ' edge' : ''}">${m.n}</span><span><b>${esc(m.t)}.</b> ${esc(m.d)}</span></button></li>`).join('');
    $('marks').querySelectorAll('button').forEach(b => b.addEventListener('click', () => selectMark(+b.dataset.i, true)));
    $('leadersTitle').hidden = !st.leaders.length;
    $('leaders').innerHTML = st.leaders.map(leaderBio).join('');
    bindLeaders($('leaders'));
  }
  const num = v => String(v).replace('.', ',');
  // ---------- связи между шагами ----------
  function renderLinks(st) {
    const LK = window.LINKS || [], byId = id => STEPS.findIndex(x => x.id === id);
    const item = (id, text, dir) => { const t = STEPS[byId(id)]; return `<li><button type="button" data-go="${byId(id)}"><span class="lk-y">${dir === 'in' ? '← ' : ''}${esc(t.label.replace('·', ' '))}${dir === 'out' ? ' →' : ''}</span><span><b>${esc(t.title)}.</b> ${esc(text)}</span></button></li>`; };
    const ins = LK.filter(l => l[1] === st.id).map(l => item(l[0], l[2], 'in')).join('');
    const outs = LK.filter(l => l[0] === st.id).map(l => item(l[1], l[2], 'out')).join('');
    const box = $('links');
    box.innerHTML = (ins ? `<h3 class="sub">Откуда это</h3><ul class="lk lk-in">${ins}</ul>` : '') + (outs ? `<h3 class="sub">К чему привело</h3><ul class="lk lk-out">${outs}</ul>` : '');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { go(+b.dataset.go); if (matchMedia('(max-width: 899px)').matches) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }
  // ---------- сводные графики под картой ----------
  const DW = 360, DH = 170, DL = 30, DR = 10, DT = 10, DB = 22;
  function dashInit() {
    const S = window.STATS || [];
    $('dash').innerHTML = `<button type="button" class="dash-h" id="dashT" aria-expanded="true"><span>Цифры эпохи</span><i></i></button><div class="dash-b">${S.map(c => {
      const n = Math.max(...c.series.map(q => q.v.length)), x = i => DL + (DW - DL - DR) * i / (n - 1), y = v => DT + (DH - DT - DB) * (1 - (v - c.min) / (c.max - c.min));
      let g = '';
      for (let v = Math.ceil(c.min / c.step) * c.step; v <= c.max; v += c.step) g += `<line x1="${DL}" x2="${DW - DR}" y1="${y(v)}" y2="${y(v)}" class="${c.id === 'prod' && v === 100 ? 'ch-base' : 'ch-grid'}"/><text x="${DL - 5}" y="${y(v) + 4}" class="ch-ax" text-anchor="end">${v}</text>`;
      for (let i = 0; i < n; i++) if ((c.from + i) % 2 === 1 || n < 10) g += `<text x="${x(i)}" y="${DH - 6}" class="ch-ax" text-anchor="middle">${c.from + i}</text>`;
      g += `<g class="d-cur" data-c="${c.id}"></g>`;
      for (const q of c.series) g += `<polyline points="${q.v.map((v, i) => x(i) + ',' + y(v)).join(' ')}" class="d-line" stroke="${q.c}"${q.d ? ` stroke-dasharray="${q.d}"` : ''}/>`;
      g += `<g class="d-dots" data-c="${c.id}"></g>`;
      const leg = c.series.map(q => `<span><svg viewBox="0 0 26 8" width="26" height="8"><line x1="1" x2="25" y1="4" y2="4" stroke="${q.c}" stroke-width="3"${q.d ? ` stroke-dasharray="${q.d}"` : ''}/></svg>${esc(q.n)}<b data-v="${c.id}-${q.k}"></b></span>`).join('');
      return `<figure class="dcard"><figcaption><b>${esc(c.title)}</b><span>${esc(c.unit)}</span><em data-y="${c.id}"></em></figcaption><svg viewBox="0 0 ${DW} ${DH}" role="img" aria-label="${esc(c.title)}">${g}</svg><div class="d-leg">${leg}</div><details><summary>Что это за цифры</summary><p>${esc(c.note)}</p><p>${esc(c.src)}</p></details></figure>`;
    }).join('')}</div>`;
    const dash = $('dash'), t = $('dashT');
    if (matchMedia('(max-width: 899px)').matches) { dash.classList.add('shut'); t.setAttribute('aria-expanded', 'false'); }
    t.addEventListener('click', () => { const sh = dash.classList.toggle('shut'); t.setAttribute('aria-expanded', String(!sh)); requestAnimationFrame(() => { view = fitView(view); applyView(); }); });
  }
  function dashUpdate(st) {
    const yr = yearOf(st);
    for (const c of (window.STATS || [])) {
      const n = Math.max(...c.series.map(q => q.v.length)), i = yr - c.from, inR = i >= 0 && i < n;
      const x = DL + (DW - DL - DR) * i / (n - 1), y = v => DT + (DH - DT - DB) * (1 - (v - c.min) / (c.max - c.min));
      const cur = document.querySelector(`.d-cur[data-c="${c.id}"]`), dots = document.querySelector(`.d-dots[data-c="${c.id}"]`);
      cur.innerHTML = inR ? `<line x1="${x}" x2="${x}" y1="${DT}" y2="${DH - DB}" class="d-now"/>` : '';
      dots.innerHTML = inR ? c.series.filter(q => q.v[i] != null).map(q => `<circle cx="${x}" cy="${y(q.v[i])}" r="4.2" fill="${q.c}" class="d-dot"/>`).join('') : '';
      document.querySelector(`[data-y="${c.id}"]`).textContent = inR ? yr + ' г.' : (yr < c.from ? 'ряд начинается с ' + c.from + ' г.' : 'ряд кончается ' + (c.from + n - 1) + ' г.');
      for (const q of c.series) document.querySelector(`[data-v="${c.id}-${q.k}"]`).textContent = inR && q.v[i] != null ? num(q.v[i]) : '';
    }
  }
  function chartHTML(c) {
    const W = 360, H = 236, Lp = 34, B = 54, T = 20, max = c.max || 60, step = c.step || 10;
    const bw = (W - Lp - 10) / c.bars.length;
    const y = v => T + (H - T - B) * (1 - v / max);
    let g = '';
    for (let v = 0; v <= max + 1e-9; v += step) g += `<line x1="${Lp}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${Lp - 6}" y="${y(v) + 4}" class="ch-ax" text-anchor="end">${num(+v.toFixed(1))}</text>`;
    c.bars.forEach((b, i) => {
      const x = Lp + i * bw + bw * 0.16, w = bw * 0.68;
      g += `<rect x="${x}" y="${y(b.v)}" width="${w}" height="${y(0) - y(b.v)}" class="ch-bar${b.mark ? ' ch-mark' : ''}"/>`;
      g += `<text x="${x + w / 2}" y="${y(b.v) - 5}" class="ch-val" text-anchor="middle">${num(b.v)}</text>`;
      g += `<text x="${x + w / 2}" y="${H - B + 16}" class="ch-lab" text-anchor="middle">${esc(b.l)}</text>`;
      if (b.n) g += `<text x="${x + w / 2}" y="${H - B + 31}" class="ch-sub" text-anchor="middle">${esc(b.n)}</text>`;
    });
    if (c.line != null) g += `<line x1="${Lp}" x2="${W - 6}" y1="${y(c.line)}" y2="${y(c.line)}" class="ch-line"/><text x="${W - 8}" y="${y(c.line) - 5}" class="ch-ll" text-anchor="end">${esc(c.lineLabel)}</text>`;
    return `<div class="chart"><h3>${esc(c.title)}</h3><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}">${g}</svg>${c.note ? `<p class="ch-note">${esc(c.note)}</p>` : ''}${(c.text || []).map(t => `<p>${esc(t)}</p>`).join('')}${c.src ? `<p class="ch-src">${esc(c.src)}</p>` : ''}</div>`;
  }
  function leaderBio(id) {
    const p = L[id];
    return `<article class="lbio"><button type="button" class="leader" data-id="${id}" aria-label="${esc(p.name)}">${portrait(id)}</button><div class="lbio-t"><b>${esc(p.name)}</b><span class="lbio-y">${esc(p.years)}. ${esc(p.role)}</span><p>${esc(p.bio)}</p><p class="lbio-n">${esc(p.note)}</p></div></article>`;
  }
  function initials(name) { return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join(''); }
  function portrait(id) {
    const p = L[id];
    return `<div class="portrait"><span class="ini">${esc(initials(p.name))}</span><img src="img/${id}.jpg" alt="${esc(p.name)}" loading="lazy" onerror="this.remove()"></div>`;
  }
  function leaderCard(id) {
    const p = L[id];
    return `<button type="button" class="leader" data-id="${id}">${portrait(id)}<b>${esc(p.name)}</b><span>${esc(p.years)}</span></button>`;
  }
  function bindLeaders(root) { root.querySelectorAll('.leader').forEach(b => b.addEventListener('click', () => openLeader(b.dataset.id))); }
  function openLeader(id) {
    const p = L[id];
    openModal(`<div class="lead-card">${portrait(id)}<div><h2>${esc(p.name)}</h2><div style="color:var(--muted);font-size:14px">${esc(p.years)}<br>${esc(p.role)}</div></div></div><p>${esc(p.bio)}</p><p>${esc(p.note)}</p>`);
  }

  // ---------- карточка страны ----------
  function openCountry(k) {
    const st = STEPS[idx], y = yearOf(st), C = (window.COUNTRIES || {})[k], g = (st.groups || {})[k];
    const name = (C && C.n) || window.countryName(k, y);
    const tag = g && G[g].t ? `<div class="cc-tag"><i style="background:${G[g].c}"></i>${esc(G[g].t)}</div>` : '';
    if (!C) { openModal(`<h2>${esc(name)}</h2>${tag}`); return; }
    let pi = C.p.findIndex(p => p[0] <= y && y <= p[1]);
    if (pi < 0) { pi = 0; C.p.forEach((p, i) => { if (p[0] <= y) pi = i; }); }
    const inh = j => { for (let i = pi; i >= 0; i--) if (C.p[i][j] !== 0) return C.p[i][j]; return ''; };
    const P = C.p[pi], rows = [['Государство', inh(2)], ['Глава государства', inh(3)], ['Правительство', inh(4)], ['Столица', P[6] || C.c]].filter(r => r[1]);
    const per = P[0] === P[1] ? P[0] + ' г.' : P[0] + '–' + P[1] + ' гг.';
    const nums = (window.STATS || []).map(c => { const q = c.series.find(q => q.k === k), v = q && q.v[y - c.from]; return v == null ? '' : `<li><b>${num(v)}</b><span>${esc(c.title)}, ${esc(c.unit)}</span></li>`; }).join('');
    const lead = ((window.LEADER_OF || {})[k] || []).filter(id => L[id]);
    const ch = (C.ch || []).map(c => { const id = c[2] || (c[0] === 1929 ? '1929' : (STEPS.find(x => yearOf(x) === c[0]) || {}).id), i = STEPS.findIndex(x => x.id === id); const body = `<span class="lk-y">${c[0]}</span><span>${esc(c[1])}</span>`; return i < 0 ? `<li><div class="lk-plain">${body}</div></li>` : `<li><button type="button" data-go="${i}"${i === idx ? ' class="cur"' : ''}>${body}</button></li>`; }).join('');
    openModal(`<h2>${esc(name)}</h2>${tag}
      <h3 class="sub">Справка на ${y} г.</h3><dl class="cc-facts">${rows.map(r => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>
      <h3 class="sub">Что происходит: ${per}</h3><p>${esc(P[5])}</p>
      ${nums ? `<h3 class="sub">Цифры за ${y} г.</h3><ul class="cc-nums">${nums}</ul>` : ''}
      ${lead.length ? `<h3 class="sub">Лидеры</h3><div class="cc-lead">${lead.map(leaderCard).join('')}</div>` : ''}
      ${ch ? `<h3 class="sub">Хроника 1914–1939</h3><ul class="lk cc-ch">${ch}</ul>` : ''}`);
    const mb = $('modalBody'); bindLeaders(mb);
    mb.querySelectorAll('.cc-ch button').forEach(b => b.addEventListener('click', () => { closeModal(); go(+b.dataset.go); }));
    $('modal').querySelector('.modal-box').scrollTop = 0;
  }

  // ---------- метки и всплывающие окна ----------
  function showPop(t, d) { $('popT').textContent = t; $('popD').textContent = d; $('pop').hidden = false; }
  function hidePop() { $('pop').hidden = true; setActive(-1); }
  function setActive(i) {
    activeMark = i;
    markEls.forEach((m, j) => m.g.classList.toggle('on', j === i));
    $('marks').querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
    sizeOverlay();
  }
  function selectMark(i, fromList) {
    const st = STEPS[idx], n = st.markers.length;
    const m = i < n ? st.markers[i] : st.edges[i - n];
    setActive(i);
    showPop(m.t, m.d);
    if (fromList) {
      if (i < n) {
        const [x, y] = M.cities[m.c];
        const w = Math.min(view.w, aspect().w < 700 ? 380 : 520);
        animateTo(fitView({ x: x - w / 2, y: y - w * 0.4, w, h: w * 0.8 }));
      }
      if (matchMedia('(max-width: 899px)').matches) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  $('popX').addEventListener('click', hidePop);

  // ---------- шкала ----------
  const chips = $('chips');
  chips.innerHTML = STEPS.map((s, i) => `<button type="button" class="chip${s.id.startsWith('1939b') ? ' war' : ''}" role="tab" data-i="${i}">${esc(s.label)}</button>`).join('');
  chips.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => go(+c.dataset.i)));
  $('prev').addEventListener('click', () => go(idx - 1));
  $('next').addEventListener('click', () => go(idx + 1));
  document.addEventListener('keydown', e => {
    if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if (e.key === 'ArrowRight') go(idx + 1); else if (e.key === 'ArrowLeft') go(idx - 1); else if (e.key === 'Escape') hidePop();
  });

  function go(i, instant) {
    if (i < 0 || i >= STEPS.length) return;
    idx = i;
    const st = STEPS[i];
    $('pop').hidden = true; activeMark = -1;
    renderMap(st); renderPanel(st); dashUpdate(st);
    chips.querySelectorAll('.chip').forEach((c, j) => { c.classList.toggle('on', j === i); c.setAttribute('aria-selected', j === i); });
    const on = chips.children[i];
    chips.scrollTo({ left: on.offsetLeft - chips.clientWidth / 2 + on.clientWidth / 2, behavior: instant ? 'auto' : 'smooth' });
    $('prev').disabled = i === 0; $('next').disabled = i === STEPS.length - 1;
    const target = fitView(stepBox(st));
    if (instant) { view = target; applyView(); } else animateTo(target);
    if (history.replaceState) history.replaceState(null, '', '#' + st.id);
    if (!instant && matchMedia('(min-width: 900px)').matches) $('panel').scrollTop = 0;
  }

  // ---------- масштаб и перетаскивание ----------
  function zoomAt(f, cx, cy) {
    const nw = Math.min(Math.max(view.w * f, 120), M.W * 2.2), k = nw / view.w;
    view = { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w: nw, h: view.h * k };
    applyView();
  }
  const toSvg = (px, py) => { const r = wrap.getBoundingClientRect(); return [view.x + (px - r.left) / r.width * view.w, view.y + (py - r.top) / r.height * view.h]; };
  $('zIn').addEventListener('click', () => { cancelAnimationFrame(anim); zoomAt(0.7, view.x + view.w / 2, view.y + view.h / 2); });
  $('zOut').addEventListener('click', () => { cancelAnimationFrame(anim); zoomAt(1 / 0.7, view.x + view.w / 2, view.y + view.h / 2); });
  $('zReset').addEventListener('click', () => animateTo(fitView({ x: 0, y: 0, w: M.W, h: M.H })));
  svg.addEventListener('wheel', e => { e.preventDefault(); cancelAnimationFrame(anim); const [x, y] = toSvg(e.clientX, e.clientY); zoomAt(Math.exp(e.deltaY * 0.0015), x, y); }, { passive: false });

  const ptrs = new Map(); let dragged = false, start = null, pinch0 = null;
  svg.addEventListener('pointerdown', e => {
    cancelAnimationFrame(anim);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { dragged = false; start = { x: e.clientX, y: e.clientY, v: { ...view } }; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), v: { ...view }, c: toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) }; dragged = true; }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const r = wrap.getBoundingClientRect();
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const k = Math.min(Math.max(pinch0.d / d, 120 / pinch0.v.w), M.W * 2.2 / pinch0.v.w);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nw = pinch0.v.w * k, nh = pinch0.v.h * k;
      view = { x: pinch0.c[0] - (mx - r.left) / r.width * nw, y: pinch0.c[1] - (my - r.top) / r.height * nh, w: nw, h: nh };
      applyView();
    } else if (ptrs.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; try { svg.setPointerCapture(e.pointerId); } catch (_) {} }
      if (dragged) { view = { ...start.v, x: start.v.x - dx / r.width * start.v.w, y: start.v.y - dy / r.height * start.v.h }; applyView(); }
    }
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (ptrs.size === 1) { const [p] = [...ptrs.values()]; start = { x: p[0], y: p[1], v: { ...view } }; } setTimeout(() => { if (!ptrs.size) dragged = false; }, 0); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);

  // ---------- модальные окна ----------
  function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; $('modalX').focus(); }
  function closeModal() { $('modal').hidden = true; }
  $('modalX').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
  $('btnLeaders').addEventListener('click', () => {
    openModal(`<h2>Лидеры эпохи</h2><div class="lead-grid">${Object.keys(L).map(leaderCard).join('')}</div>`);
    bindLeaders($('modalBody'));
  });
  $('btnAbout').addEventListener('click', () => openModal(`
    <h2>О карте</h2>
    <p>Разделы «Политика» и «Общество и экономика» содержат общепринятые факты. Раздел «Анализ» объясняет связи между финансами, мировым порядком и политикой.</p>
    <p>Границы государств: набор <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noopener">historical-basemaps</a> (A. Ourednik, лицензия GPL-3.0), срезы 1914, 1920, 1930 и 1938 гг. Точность границ соответствует обзорной карте. Шаги 1922–1937 гг. показаны по срезу 1930 г., шаги 1938–1939 гг. по срезу конца 1938 г.</p>
    <p>Проекция: равновеликая азимутальная Ламберта с центром в Центральной Европе.</p>`));

  // стена из повторяющихся слов, как на фасадах 1930-х
  const wtxt = Array(12).fill('ВОЙНА · МИР · ДОЛГ · КРИЗИС').join(' · ') + ' · ';
  $('wall').innerHTML = `<div class="wall-track"><span>${wtxt}</span><span>${wtxt}</span></div>`;

  // ---------- старт ----------
  window.addEventListener('resize', () => { view = fitView(view); applyView(); });
  const fromHash = STEPS.findIndex(s => '#' + s.id === location.hash);
  dashInit();
  view = fitView({ x: 0, y: 0, w: M.W, h: M.H });
  go(fromHash >= 0 ? fromHash : 0, true);
})();
