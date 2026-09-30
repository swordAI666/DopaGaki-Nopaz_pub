/* TEN RUSH EXTREME — game logic */
(() => {
  'use strict';

  /* ================= helpers ================= */
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const A = window.GameAudio;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tenrush.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tenrush.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } },
  };

  /* ================= config ================= */
  const DIFFS = {
    // time: start seconds / win: combo window / growth: drain speed-up per wave
    // penalty: seconds lost on a miss / tb: time-bonus multiplier / mult: score multiplier
    rush:    { label: 'RUSH',    time: 60, win: 3.2, growth: 0.10, penalty: 1.0, tb: 1.4, mult: 1.0 },
    extreme: { label: 'EXTREME', time: 45, win: 2.6, growth: 0.16, penalty: 2.0, tb: 1.0, mult: 1.5 },
    inferno: { label: 'INFERNO', time: 30, win: 1.9, growth: 0.25, penalty: 3.0, tb: 0.8, mult: 2.5 },
  };
  const HUE = { 1: 190, 2: 140, 3: 52, 4: 22, 5: 320, 6: 22, 7: 52, 8: 140, 9: 190 };
  const FEVER_DUR = 8;          // seconds
  const GOLD_P = 0.035;         // chance that a new cell is gold
  const HINT_DELAY = 3.4;       // seconds of idle before a hint glows
  const PAD = 6, BORDER = 2, GAP = 3;   // keep in sync with style.css
  const TIERS = [
    [3, 'NICE!', '#9dff3a'], [6, 'GREAT!!', '#19e3ff'], [10, 'EXCELLENT!!!', '#ffe62e'],
    [15, 'AMAZING!!!!', '#ff9500'], [20, 'UNREAL!!!!!', '#ff2bd6'], [30, 'GODLIKE', '#ff3355'],
    [40, 'ADRENALINE OVERLOAD', '#ffffff'],
  ];
  const RANKS = [['GOD', 1600000], ['SSS', 900000], ['SS', 500000], ['S', 250000], ['A', 120000], ['B', 50000], ['C', 15000], ['D', 0]];
  const SIZE_NAME = [[10, 'GIGA'], [8, 'MEGA'], [6, 'HUGE'], [4, 'BIG']];

  const settings = {
    sound: store.get('sound', true),
    fx: store.get('fx', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'lite' : 'full'),
    assist: store.get('assist', true),
    diff: store.get('diff', 'extreme'),
  };
  if (!DIFFS[settings.diff]) settings.diff = 'extreme';
  const lite = () => settings.fx === 'lite';

  /* ================= DOM ================= */
  const stage = $('#stage'), boardEl = $('#board'), wrapEl = $('#boardWrap');
  const selRect = $('#selRect'), selBadge = $('#selBadge');
  const scoreEl = $('#score'), timeEl = $('#time'), timeFill = $('#timeFill');
  const comboBox = document.querySelector('.combo'), comboNumEl = $('#comboNum'), comboMultEl = $('#comboMult'), comboFill = $('#comboFill');
  const waveLbl = $('#waveLbl'), drainLbl = $('#drainLbl');
  const feverBar = document.querySelector('.feverbar'), feverFill = $('#feverFill'), feverLbl = $('#feverLbl');
  const flashEl = $('#flash'), floatLayer = $('#floaters'), annEl = $('#announce'), toastEl = $('#toast');
  const titleEl = $('#title'), pauseEl = $('#pause'), resultEl = $('#result');
  const root = document.documentElement;

  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  const setText = (el, t) => { if (el._t !== t) { el._t = t; el.textContent = t; } };

  /* ================= game state ================= */
  let st = 'title';                 // title | countdown | play | paused | over
  let diff = DIFFS[settings.diff];
  let R = 14, C = 10, cell = 38;
  let vals, golds, cellEls = [];
  let time, cap, score, shown, combo, comboT, comboWin, fever, feverT, wave;
  let idleT, hintOn, refillT, cdT, cdStep, lastSec, dangerOn, heat, musicT;
  let stats;
  let drag = null, selKey = '', selIdx = [], selOk = false;

  /* ================= pure board logic ================= */
  function classify(sum, n, mn, mx) {
    if (!n) return null;
    if (sum === 10) return 'ten';
    if (n >= 2 && mn === mx) return 'twin';
    return null;
  }

  // every valid rectangle (or the first `limit` of them). Empty cells count as 0.
  function findMoves(v, rows, cols, limit = Infinity) {
    const res = [];
    const cs = new Int16Array(cols), cc = new Int16Array(cols), cmin = new Int8Array(cols), cmax = new Int8Array(cols);
    for (let r1 = 0; r1 < rows; r1++) {
      cs.fill(0); cc.fill(0); cmin.fill(99); cmax.fill(0);
      for (let r2 = r1; r2 < rows; r2++) {
        for (let c = 0; c < cols; c++) {
          const x = v[r2 * cols + c];
          if (x) { cs[c] += x; cc[c]++; if (x < cmin[c]) cmin[c] = x; if (x > cmax[c]) cmax[c] = x; }
        }
        for (let c1 = 0; c1 < cols; c1++) {
          let s = 0, n = 0, mn = 99, mx = 0;
          for (let c2 = c1; c2 < cols; c2++) {
            s += cs[c2]; n += cc[c2];
            if (cmin[c2] < mn) mn = cmin[c2];
            if (cmax[c2] > mx) mx = cmax[c2];
            const type = classify(s, n, mn, mx);
            if (type) {
              res.push({ r1, c1, r2, c2, type, n });
              if (res.length >= limit) return res;
            }
          }
        }
      }
    }
    return res;
  }
  const hasMove = () => findMoves(vals, R, C, 1).length > 0;

  function evalRect(rc) {
    let sum = 0, n = 0, mn = 99, mx = 0, g = 0;
    for (let r = rc.r1; r <= rc.r2; r++) {
      for (let c = rc.c1; c <= rc.c2; c++) {
        const i = r * C + c, v = vals[i];
        if (v) { sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; if (golds[i]) g++; }
      }
    }
    return { sum, n, g, type: classify(sum, n, mn, mx) };
  }

  /* ================= board build / layout ================= */
  function gridBox() {
    const wr = wrapEl.getBoundingClientRect();
    const inner = 2 * (PAD + BORDER);
    return { aw: wr.width - inner, ah: wr.height - 6 - inner };
  }
  function configureGrid() {
    const { aw, ah } = gridBox();
    let tgt, cols;
    if (aw < 520) { cols = 10; tgt = (aw - GAP * 9) / 10; }
    else { tgt = 46; cols = Math.floor((aw + GAP) / (tgt + GAP)); }
    C = clamp(cols, 8, 14);
    R = clamp(Math.floor((ah + GAP) / (tgt + GAP)), 9, 18);
    fit();
  }
  function fit() {
    const { aw, ah } = gridBox();
    cell = Math.floor(clamp(Math.min((aw - GAP * (C - 1)) / C, (ah - GAP * (R - 1)) / R), 22, 66));
    root.style.setProperty('--cell', cell + 'px');
    root.style.setProperty('--cols', C);
  }
  function buildBoard() {
    boardEl.querySelectorAll('.cell').forEach((e) => e.remove());
    vals = new Int8Array(R * C);
    golds = new Uint8Array(R * C);
    cellEls = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < R * C; i++) {
      const d = document.createElement('div');
      d.className = 'cell'; d.dataset.v = '0';
      frag.appendChild(d); cellEls.push(d);
    }
    boardEl.insertBefore(frag, selRect);
  }
  function paint(i) {
    const e = cellEls[i], v = vals[i];
    e.dataset.v = v;
    e.textContent = v ? v : '';
    e.classList.toggle('gold', !!(v && golds[i]));
  }
  boardEl.addEventListener('animationend', (e) => {
    if (e.animationName === 'boom') e.target.classList.remove('boom');
    else if (e.animationName === 'spawn') e.target.classList.remove('spawn');
  });

  /* fill every empty cell with fresh digits (whole board if nothing is empty) */
  function fillBoard() {
    let fill = [];
    for (let i = 0; i < R * C; i++) if (!vals[i]) fill.push(i);
    if (!fill.length) fill = Array.from({ length: R * C }, (_, i) => i);
    let ok = false;
    for (let a = 0; a < 40 && !ok; a++) {
      for (const i of fill) vals[i] = 1 + Math.floor(Math.random() * 9);
      ok = hasMove();
    }
    if (!ok) {   // practically unreachable: force one adjacent pair
      const set = new Set(fill);
      for (const i of fill) {
        if (i % C < C - 1 && set.has(i + 1)) { vals[i + 1] = 10 - vals[i]; break; }
      }
    }
    for (const i of fill) golds[i] = Math.random() < GOLD_P ? 1 : 0;
    if (fill.length > 40 && !fill.some((i) => golds[i])) golds[fill[Math.floor(Math.random() * fill.length)]] = 1;

    for (const i of fill) cellEls[i].classList.remove('spawn', 'boom');
    void boardEl.offsetWidth;   // restart animations
    for (const i of fill) {
      paint(i);
      const e = cellEls[i];
      e.style.setProperty('--d', Math.round(Math.floor(i / C) * 16 + Math.random() * 120) + 'ms');
      e.classList.add('spawn');
    }
    removeHint();
  }
  const countLeft = () => { let n = 0; for (let i = 0; i < vals.length; i++) if (vals[i]) n++; return n; };

  /* ================= geometry ================= */
  function boardOrigin() {
    const br = boardEl.getBoundingClientRect();
    return { x: br.left + BORDER + PAD, y: br.top + BORDER + PAD };
  }
  function cellCenter(i, o) {
    const step = cell + GAP;
    return { x: o.x + (i % C) * step + cell / 2, y: o.y + Math.floor(i / C) * step + cell / 2 };
  }
  function rectCenter(rc, o) {
    const step = cell + GAP;
    return {
      x: o.x + ((rc.c1 + rc.c2 + 1) * step - GAP) / 2,
      y: o.y + ((rc.r1 + rc.r2 + 1) * step - GAP) / 2,
    };
  }
  function cellAt(px, py) {
    const br = boardEl.getBoundingClientRect(), step = cell + GAP;
    const x = px - br.left - BORDER - PAD, y = py - br.top - BORDER - PAD;
    return { r: clamp(Math.floor(y / step), 0, R - 1), c: clamp(Math.floor(x / step), 0, C - 1) };
  }

  /* ================= particles (canvas) ================= */
  const fx = {
    c: $('#fx'), ctx: null, parts: [], w: 0, h: 0, dpr: 1,
    resize() {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = innerWidth; this.h = innerHeight;
      this.c.width = this.w * this.dpr; this.c.height = this.h * this.dpr;
      this.ctx = this.c.getContext('2d');
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },
    push(p) { this.parts.push(p); if (this.parts.length > 700) this.parts.shift(); },
    burst(x, y, hue, count, speed, size) {
      count = Math.ceil(count * (lite() ? 0.4 : 1));
      for (let k = 0; k < count; k++) {
        const a = rand(0, Math.PI * 2), s = rand(speed * 0.3, speed);
        const life = rand(0.35, 0.8);
        this.push({ k: 0, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.25, life, max: life, size: rand(size * 0.5, size), hue: hue + rand(-12, 12), g: 900 });
      }
    },
    ring(x, y, hue, r, lw = 4) {
      this.push({ k: 1, x, y, r: r * 0.3, vr: r * 4.2, life: 0.4, max: 0.4, hue, lw });
    },
    confetti(x, y, count) {
      count = Math.ceil(count * (lite() ? 0.3 : 1));
      for (let k = 0; k < count; k++) {
        const a = rand(-Math.PI, 0), s = rand(250, 900);
        const life = rand(0.9, 1.7);
        this.push({ k: 2, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(5, 10), hue: rand(0, 360), rot: rand(0, 6), vr: rand(-12, 12), g: 1100 });
      }
    },
    update(dt) {
      const arr = this.parts;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.life -= dt;
        if (p.life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
        if (p.k === 1) { p.r += p.vr * dt; p.vr *= 0.9; continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.985;
        if (p.k === 2) p.rot += p.vr * dt;
      }
    },
    draw() {
      const g = this.ctx;
      g.clearRect(0, 0, this.w, this.h);
      if (!this.parts.length) return;
      g.globalCompositeOperation = 'lighter';
      for (const p of this.parts) {
        const a = clamp(p.life / p.max, 0, 1);
        if (p.k === 1) {
          g.strokeStyle = `hsla(${p.hue},100%,65%,${a})`; g.lineWidth = p.lw * a + 1;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.stroke();
        } else if (p.k === 2) {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.fillStyle = `hsla(${p.hue},100%,60%,${a})`; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          g.restore();
        } else {
          g.fillStyle = `hsla(${p.hue},100%,62%,${a})`;
          const s = p.size * (0.4 + a * 0.6);
          g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
      g.globalCompositeOperation = 'source-over';
    },
  };

  /* ================= juice ================= */
  function shake(power, dur = 320) {
    if (lite()) power *= 0.25;
    if (power < 1) return;
    const frames = [];
    for (let i = 0; i < 9; i++) {
      const k = 1 - i / 9;
      frames.push({ transform: `translate(${rand(-power, power) * k}px,${rand(-power, power) * k}px)` });
    }
    frames.push({ transform: 'none' });
    stage.animate(frames, { duration: dur, easing: 'linear' });
  }
  function flash(color, alpha, dur = 260) {
    if (lite()) alpha *= 0.3;
    flashEl.style.background = color;
    flashEl.animate([{ opacity: alpha }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
  }
  function vib(p) { if (lite()) return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ } }

  function floater(text, x, y, cls, size) {
    const d = document.createElement('div');
    d.className = 'float ' + cls; d.textContent = text;
    d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.fontSize = size + 'px';
    floatLayer.appendChild(d);
    if (floatLayer.childElementCount > 26) floatLayer.firstChild.remove();
    d.addEventListener('animationend', () => d.remove());
  }
  let annAnim = null;
  function announce(text, o = {}) {
    const { color = '#fff', size = 1, dur = 950 } = o;
    annEl.textContent = text;
    annEl.style.setProperty('--c', color);
    annEl.style.fontSize = `calc(var(--ann) * ${size})`;
    if (annAnim) annAnim.cancel();
    annAnim = annEl.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(2.6) rotate(-8deg)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(-3deg)', offset: 0.16 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.07) rotate(-3deg)', offset: 0.75 },
      { opacity: 0, transform: 'translate(-50%,-64%) scale(1.3) rotate(-3deg)' },
    ], { duration: dur, easing: 'ease-out' });
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ================= selection ================= */
  function clearSelUI() {
    for (const i of selIdx) cellEls[i].classList.remove('sel');
    selIdx.length = 0; selKey = ''; selOk = false;
    selRect.style.display = 'none'; selBadge.style.display = 'none';
    selRect.className = ''; selBadge.className = '';
  }
  function dragRect() {
    return {
      r1: Math.min(drag.sr, drag.er), r2: Math.max(drag.sr, drag.er),
      c1: Math.min(drag.sc, drag.ec), c2: Math.max(drag.sc, drag.ec),
    };
  }
  function updateSel() {
    const rc = dragRect();
    const key = `${rc.r1},${rc.c1},${rc.r2},${rc.c2}`;
    if (key === selKey) return;
    selKey = key;
    for (const i of selIdx) cellEls[i].classList.remove('sel');
    selIdx.length = 0;
    for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
      const i = r * C + c; cellEls[i].classList.add('sel'); selIdx.push(i);
    }
    const info = evalRect(rc);
    const over = !info.type && info.sum > 10;
    const step = cell + GAP;
    const x = PAD + rc.c1 * step, y = PAD + rc.r1 * step;
    const w = (rc.c2 - rc.c1 + 1) * step - GAP, h = (rc.r2 - rc.r1 + 1) * step - GAP;
    selRect.style.cssText = `display:block;left:${x - 3}px;top:${y - 3}px;width:${w + 6}px;height:${h + 6}px`;
    selRect.className = info.type ? 'ok' : over ? 'over' : '';

    if (info.n > 0) {
      selBadge.textContent = info.type === 'ten' ? '10 !' : info.type === 'twin' ? 'TWIN' : String(info.sum);
      selBadge.className = info.type ? 'ok' : over ? 'over' : '';
      const bw = boardEl.clientWidth;
      const cx = clamp(x + w / 2, 44, bw - 44);
      const above = y > 44;
      selBadge.style.cssText = `display:block;left:${cx}px;top:${above ? y - 10 : y + h + 10}px;transform:translate(-50%,${above ? '-100%' : '0'})`;
    } else selBadge.style.display = 'none';

    if (info.type && !selOk) { A.sfx.ready(); vib(8); }
    else if (!info.type) A.sfx.tick(info.sum);
    selOk = !!info.type;
  }

  boardEl.addEventListener('pointerdown', (e) => {
    if (st !== 'play' || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const { r, c } = cellAt(e.clientX, e.clientY);
    drag = { pid: e.pointerId, sr: r, sc: c, er: r, ec: c };
    updateSel();
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const { r, c } = cellAt(e.clientX, e.clientY);
    if (r !== drag.er || c !== drag.ec) { drag.er = r; drag.ec = c; updateSel(); }
  });
  boardEl.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const rc = dragRect();
    drag = null;
    clearSelUI();
    if (st === 'play') attemptClear(rc);
  });
  boardEl.addEventListener('pointercancel', () => cancelDrag());
  function cancelDrag() { if (drag) { drag = null; clearSelUI(); } }
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ================= hint ================= */
  function showHint() {
    const moves = findMoves(vals, R, C);
    if (!moves.length) { hintOn = true; return; }
    let pool = moves.filter((m) => m.type === 'ten');
    if (!pool.length) pool = moves;
    let best = Infinity;
    const area = (m) => (m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1);
    for (const m of pool) best = Math.min(best, area(m));
    pool = pool.filter((m) => area(m) <= best + 1);
    const m = pool[Math.floor(Math.random() * pool.length)];
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) {
      const i = r * C + c; if (vals[i]) cellEls[i].classList.add('hint');
    }
    hintOn = true;
  }
  function removeHint() {
    if (cellEls.length) for (const e of cellEls) e.classList.remove('hint');
    hintOn = false; if (typeof idleT === 'number') idleT = 0;
  }

  /* ================= core actions ================= */
  function comboWindow() { return diff.win * Math.max(0.55, 1 - 0.03 * (wave - 1)); }
  const drainRate = () => 1 + diff.growth * (wave - 1);
  const multOf = (c) => 1 + 0.25 * Math.min(Math.max(c - 1, 0), 44);

  function attemptClear(rc) {
    const info = evalRect(rc);
    if (info.type) doClear(rc, info);
    else if (info.n >= 2) doMiss(rc);      // single digit / empty drags are ignored (no penalty)
  }

  function doClear(rc, info) {
    const { n, g, type } = info;
    const o = boardOrigin();
    const idxs = [];
    for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
      const i = r * C + c; if (vals[i]) idxs.push(i);
    }
    const inFever = feverT > 0;

    combo = (combo > 0 ? combo : 0) + 1;
    stats.maxCombo = Math.max(stats.maxCombo, combo);
    comboWin = comboWindow(); comboT = comboWin;
    const mult = multOf(combo);
    const base = 50 * n * n * (type === 'twin' ? 0.6 : 1);
    const pts = Math.round(base * (g ? 2 : 1) * mult * (inFever ? 2 : 1) * diff.mult);
    score += pts;
    stats.clears++; stats.cells += n;

    const tb = (Math.min(3, 0.5 * n) * (type === 'twin' ? 0.5 : 1)) * diff.tb + 2 * g;
    if (!inFever) time = Math.min(cap, time + tb);
    if (!inFever) fever = Math.min(100, fever + n * 1.3 + Math.min(combo, 12) * 0.35 + g * 8);

    /* board update + per-cell effects */
    for (const i of idxs) cellEls[i].classList.remove('boom', 'spawn', 'hint');
    void boardEl.offsetWidth;
    for (const i of idxs) {
      const v = vals[i], isGold = golds[i];
      const p = cellCenter(i, o);
      fx.burst(p.x, p.y, isGold ? 48 : HUE[v], inFever ? 12 : 7, 260 + combo * 6, 7);
      vals[i] = 0; golds[i] = 0; paint(i);
      cellEls[i].classList.add('boom');
    }
    const ctr = rectCenter(rc, o);
    const hue = type === 'twin' ? 190 : (combo >= 20 ? rand(0, 360) : 100 + Math.min(combo, 20) * 10);
    fx.ring(ctr.x, ctr.y, hue, 30 + n * 9, 4 + Math.min(combo, 10) * 0.4);
    if (inFever) fx.confetti(ctr.x, ctr.y, 10);
    removeHint();
    idleT = 0;

    /* feedback */
    const scale = 18 + Math.min(16, Math.log10(pts + 10) * 3.4);
    floater('+' + fmt(pts), ctr.x, ctr.y, g ? 'gold' : 'score', scale);
    const sizeName = (SIZE_NAME.find(([k]) => n >= k) || [])[1];
    floater((type === 'twin' ? 'TWIN' : 'TEN!') + (sizeName ? ' ' + sizeName : ''), ctr.x, ctr.y - scale - 6, type === 'twin' ? 'twin' : 'label', 15);
    if (tb >= 1 && !inFever) floater('+' + tb.toFixed(1) + 's', ctr.x + 34, ctr.y + scale + 4, g ? 'gold' : 'time', 14);

    const tier = TIERS.find(([k]) => k === combo);
    if (tier) { announce(tier[1], { color: tier[2], size: 0.8 + Math.min(combo, 40) / 100 }); flash(tier[2], 0.35, 320); }
    else if (combo > 40 && combo % 10 === 0) announce(combo + ' COMBO!!', { color: '#ffffff', size: 1 });
    else if (n >= 8) announce('MEGA CLEAR!', { color: '#ffe62e', size: 0.85 });
    if (g) announce('GOLD RUSH!', { color: '#ffc400', size: 0.95, dur: 800 });

    shake(Math.min(16, 2 + n * 1.2 + combo * 0.3 + (inFever ? 3 : 0)), 280);
    A.sfx.clear(combo, n, type);
    vib(Math.min(40, 8 + n * 3));
    popCombo();

    if (!inFever && fever >= 100) startFever(ctr);

    /* refill check */
    if (refillT <= 0) {
      const left = countLeft();
      if (left <= Math.max(6, Math.floor(R * C * 0.12)) || !hasMove()) refillT = 0.45;
    }
  }

  function doMiss(rc) {
    stats.misses++;
    const o = boardOrigin(), ctr = rectCenter(rc, o);
    if (feverT > 0) {          // fever is forgiving: no penalty
      floater('MISS', ctr.x, ctr.y, 'miss', 22);
      A.sfx.miss(); shake(5, 200);
      return;
    }
    const had = combo;
    combo = 0; comboT = 0;
    fever = Math.max(0, fever * 0.7);
    time -= diff.penalty;
    floater('MISS  -' + diff.penalty.toFixed(1) + 's', ctr.x, ctr.y, 'miss', 22);
    flash('#ff0033', 0.45, 300);
    shake(11, 300);
    A.sfx.miss(); vib([30, 40, 30]);
    if (had >= 5) announce('COMBO LOST', { color: '#ff3355', size: 0.55, dur: 700 });
    idleT = 0;
    if (time <= 0) { time = 0; gameOver(); }
  }

  function breakCombo() {
    if (combo >= 5) { A.sfx.comboBreak(); floater('COMBO BREAK', innerWidth / 2, innerHeight * 0.3, 'miss', 18); }
    combo = 0; comboT = 0;
  }

  function startFever(at) {
    feverT = FEVER_DUR; fever = 100;
    document.body.classList.add('fever');
    announce('FEVER!!', { color: '#ffe62e', size: 1.25, dur: 1300 });
    flash('#ffffff', 0.7, 450);
    shake(18, 500);
    fx.confetti(at.x, at.y, 70);
    fx.ring(at.x, at.y, 50, 140, 8);
    A.sfx.feverStart(); vib([40, 30, 80]);
    stats.fevers++;
  }
  function endFever() {
    feverT = 0; fever = 0;
    document.body.classList.remove('fever');
    comboT = comboWin = comboWindow();
    announce('FEVER END', { color: '#19e3ff', size: 0.5, dur: 700 });
    A.sfx.feverEnd();
  }

  function doRefill() {
    const left = countLeft();
    const isWave = left <= Math.max(6, Math.floor(R * C * 0.12));
    if (!isWave && hasMove()) return;
    if (isWave) {
      wave++;
      const bonus = Math.round(3000 * wave * diff.mult);
      score += bonus;
      time = Math.min(cap, time + 5);
      announce('WAVE ' + wave, { color: '#19e3ff', size: 1.15, dur: 1250 });
      const cx = innerWidth / 2, cy = innerHeight * 0.45;
      floater('WAVE CLEAR +' + fmt(bonus), cx, cy + 50, 'score', 26);
      floater('+5.0s', cx, cy + 86, 'time', 18);
      flash('#19e3ff', 0.5, 420);
      shake(10, 360);
      fx.confetti(cx, cy, 45);
      A.sfx.wave(); vib([20, 20, 40]);
    } else {
      announce('NO MOVES → RESHUFFLE', { color: '#ff9500', size: 0.55, dur: 1000 });
    }
    fillBoard();
  }

  function popCombo() {
    comboNumEl.animate([{ transform: 'scale(1.7)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
  }

  /* ================= game flow ================= */
  function startGame() {
    A.init(); A.resume(); A.setMuted(!settings.sound);
    diff = DIFFS[settings.diff];
    hide(titleEl); hide(resultEl); hide(pauseEl);
    document.body.classList.remove('fever', 'danger');
    boardEl.classList.remove('dead');
    configureGrid();
    buildBoard();
    clearSelUI(); drag = null;
    time = diff.time; cap = Math.round(diff.time * 1.35);
    score = 0; shown = 0; combo = 0; comboT = 0; comboWin = diff.win;
    fever = 0; feverT = 0; wave = 1;
    idleT = 0; hintOn = false; refillT = 0; lastSec = 99; dangerOn = false; heat = 0; musicT = 0;
    stats = { maxCombo: 0, clears: 0, cells: 0, misses: 0, fevers: 0, t: 0 };
    root.style.setProperty('--heat', 0);
    fx.parts.length = 0;
    fillBoard();
    st = 'countdown'; cdT = 0; cdStep = -1;
    A.music.set({ bpm: 126, energy: 0, fever: false });
    A.music.start();
  }

  function gameOver() {
    if (st !== 'play') return;
    st = 'over';
    cancelDrag(); removeHint();
    document.body.classList.remove('danger', 'fever');
    boardEl.classList.add('dead');
    A.music.stop();
    A.sfx.gameOver(); vib([80, 40, 160]);
    announce('TIME UP!', { color: '#ff3355', size: 1.2, dur: 1700 });
    flash('#ff0033', 0.6, 600);
    shake(16, 600);
    setTimeout(showResult, 1700);
  }

  function rankOf(s) {
    const n = s / diff.mult;
    for (const [r, t] of RANKS) if (n >= t) return r;
    return 'D';
  }
  function showResult() {
    if (st !== 'over') return;
    const key = 'best.' + settings.diff;
    const prev = store.get(key, 0);
    const isBest = score > prev && score > 0;
    if (isBest) store.set(key, score);
    $('#rScore').textContent = fmt(score);
    $('#rRank').textContent = rankOf(score);
    $('#rBest').textContent = fmt(Math.max(prev, score));
    $('#rDiff').textContent = diff.label;
    $('#rNew').classList.toggle('hidden', !isBest);
    $('#sCombo').textContent = stats.maxCombo;
    $('#sWave').textContent = wave;
    $('#sClears').textContent = stats.clears;
    $('#sCells').textContent = stats.cells;
    $('#sFever').textContent = stats.fevers;
    $('#sMiss').textContent = stats.misses;
    show(resultEl);
    if (isBest) A.sfx.record();
  }

  function toTitle() {
    st = 'title';
    A.music.stop();
    hide(resultEl); hide(pauseEl); show(titleEl);
    document.body.classList.remove('fever', 'danger');
    refreshTitle();
  }
  function pause() {
    if (st !== 'play') return;
    st = 'paused'; cancelDrag();
    show(pauseEl); A.suspend();
  }
  function resume() {
    if (st !== 'paused') return;
    hide(pauseEl); st = 'play'; A.resume();
  }

  /* ================= per-frame ================= */
  function update(dt) {
    if (st === 'countdown') {
      cdT += dt;
      const step = Math.floor(cdT / 0.6);
      if (step !== cdStep) {
        cdStep = step;
        if (step < 3) { announce(String(3 - step), { color: '#ffe62e', size: 1.7, dur: 600 }); A.sfx.count(3 - step); }
        else { announce('GO!', { color: '#9dff3a', size: 1.7, dur: 800 }); A.sfx.go(); flash('#ffffff', 0.4, 300); st = 'play'; idleT = 0; }
      }
      return;
    }
    if (st !== 'play') return;

    stats.t += dt;
    const inFever = feverT > 0;
    if (inFever) { feverT -= dt; if (feverT <= 0) endFever(); }
    else time -= dt * drainRate();

    if (combo > 0 && !inFever) { comboT -= dt; if (comboT <= 0) breakCombo(); }
    if (refillT > 0) { refillT -= dt; if (refillT <= 0) doRefill(); }

    idleT += dt;
    if (idleT > HINT_DELAY && !hintOn) showHint();

    const danger = time <= 10 && feverT <= 0;
    if (danger !== dangerOn) { dangerOn = danger; document.body.classList.toggle('danger', danger); }
    if (danger) { const s = Math.ceil(time); if (s !== lastSec) { lastSec = s; A.sfx.danger(s); } }
    else lastSec = 99;

    if (time <= 0) { time = 0; gameOver(); }
  }

  function render(dt) {
    if (st === 'title') return;
    shown += (score - shown) * Math.min(1, dt * 10);
    if (Math.abs(score - shown) < 1) shown = score;
    setText(scoreEl, fmt(shown));
    setText(timeEl, Math.max(0, time).toFixed(1));
    const tf = clamp(time / cap, 0, 1);
    timeFill.style.transform = `scaleX(${tf})`;
    const th = Math.round(tf * 120);
    if (timeFill._h !== th) { timeFill._h = th; timeFill.style.background = `hsl(${th} 100% 55%)`; }

    comboBox.classList.toggle('on', combo > 0);
    setText(comboNumEl, String(combo));
    setText(comboMultEl, '×' + multOf(combo).toFixed(1) + (feverT > 0 ? ' ×2' : ''));
    comboFill.style.transform = `scaleX(${combo > 0 ? (feverT > 0 ? 1 : clamp(comboT / comboWin, 0, 1)) : 0})`;
    setText(waveLbl, 'WAVE ' + wave);
    setText(drainLbl, diff.label + '  DRAIN ×' + drainRate().toFixed(2));

    feverBar.classList.toggle('on', feverT > 0);
    feverFill.style.transform = `scaleX(${feverT > 0 ? feverT / FEVER_DUR : fever / 100})`;
    setText(feverLbl, feverT > 0 ? 'FEVER!!  SCORE ×2  NO DRAIN' : 'FEVER GAUGE');

    // heat drives background glow, border colour, and music brightness
    const target = feverT > 0 ? 1 : clamp(combo / 24, 0, 1);
    heat += (target - heat) * Math.min(1, dt * 3);
    if (Math.abs(parseFloat(root.style.getPropertyValue('--heat') || 0) - heat) > 0.01) root.style.setProperty('--heat', heat.toFixed(3));
    musicT += dt;
    if (musicT > 0.2) {
      musicT = 0;
      A.music.set({ bpm: Math.min(176, 126 + (wave - 1) * 4 + (feverT > 0 ? 12 : 0)), energy: heat, fever: feverT > 0 });
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (st !== 'paused') { update(dt); fx.update(dt); fx.draw(); render(dt); }
    requestAnimationFrame(frame);
  }

  /* ================= UI wiring ================= */
  function refreshTitle() {
    document.querySelectorAll('#diffs .chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === settings.diff)));
    $('#tBest').textContent = fmt(store.get('best.' + settings.diff, 0));
    const tg = (id, on, text) => { const b = $(id); b.dataset.on = String(on); b.textContent = text; };
    tg('#tgSound', settings.sound, 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'));
    tg('#tgFx', settings.fx === 'full', 'EFFECTS: ' + (settings.fx === 'full' ? 'FULL' : 'LITE'));
    tg('#tgAssist', settings.assist, 'COLOR ASSIST: ' + (settings.assist ? 'ON' : 'OFF'));
    boardEl.classList.toggle('assist', settings.assist);
    document.body.classList.toggle('lite', lite());
  }
  document.querySelectorAll('#diffs .chip').forEach((b) => b.addEventListener('click', () => {
    settings.diff = b.dataset.diff; store.set('diff', settings.diff); refreshTitle();
  }));
  $('#tgSound').addEventListener('click', () => { settings.sound = !settings.sound; store.set('sound', settings.sound); A.setMuted(!settings.sound); refreshTitle(); });
  $('#tgFx').addEventListener('click', () => { settings.fx = lite() ? 'full' : 'lite'; store.set('fx', settings.fx); refreshTitle(); });
  $('#tgAssist').addEventListener('click', () => { settings.assist = !settings.assist; store.set('assist', settings.assist); refreshTitle(); });

  $('#btnStart').addEventListener('click', startGame);
  $('#btnRetry').addEventListener('click', startGame);
  $('#btnTitle').addEventListener('click', toTitle);
  $('#btnQuit').addEventListener('click', toTitle);
  $('#btnPause').addEventListener('click', pause);
  $('#btnResume').addEventListener('click', resume);
  $('#btnShare').addEventListener('click', async () => {
    const text = `TEN RUSH EXTREME [${diff.label}] ${fmt(score)}点 / RANK ${rankOf(score)} / MAX COMBO ${stats.maxCombo} / WAVE ${wave}`;
    try {
      if (navigator.share) await navigator.share({ title: 'TEN RUSH EXTREME', text, url: location.href });
      else { await navigator.clipboard.writeText(text + ' ' + location.href); toast('コピーしました'); }
    } catch (e) { /* cancelled */ }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  addEventListener('blur', pause);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { st === 'paused' ? resume() : pause(); }
  });
  addEventListener('resize', () => { fx.resize(); if (st !== 'title' && vals) fit(); });
  addEventListener('orientationchange', () => setTimeout(() => { fx.resize(); if (vals) fit(); }, 200));

  /* ================= boot ================= */
  fx.resize();
  refreshTitle();
  // idle demo board behind the title so the page never looks empty
  configureGrid(); buildBoard();
  time = diff.time; cap = Math.round(diff.time * 1.35); score = 0; shown = 0; combo = 0; comboT = 0; comboWin = diff.win;
  fever = 0; feverT = 0; wave = 1; idleT = 0; hintOn = false; refillT = 0; heat = 0; musicT = 0;
  stats = { maxCombo: 0, clears: 0, cells: 0, misses: 0, fevers: 0, t: 0 };
  fillBoard();
  render(0);
  requestAnimationFrame(frame);

  // test/debug hook: open with ?debug
  if (location.search.includes('debug')) {
    window.__tr = {
      moves: () => findMoves(vals, R, C),
      state: () => ({ st, time, score, combo, fever, feverT, wave, R, C, cell, left: countLeft(), stats }),
      setTime: (t) => { time = t; },
      endFever: () => { if (feverT > 0) endFever(); },
      geometry: () => { const o = boardOrigin(); return { ox: o.x, oy: o.y, cell, gap: GAP }; },
      vals: () => Array.from(vals),
    };
  }
})();
