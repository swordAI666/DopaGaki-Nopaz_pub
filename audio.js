/* TEN RUSH EXTREME — procedural audio (WebAudio only, no asset files) */
window.GameAudio = (() => {
  'use strict';
  let ctx = null, master, sfxBus, bgmBus, bgmFilter, noiseBuf;
  let muted = false;

  const PENTA = [0, 2, 4, 7, 9];                  // major pentatonic
  const noteHz = (idx, base = 261.63) =>
    base * Math.pow(2, (12 * Math.floor(idx / 5) + PENTA[idx % 5]) / 12);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
    bgmFilter = ctx.createBiquadFilter(); bgmFilter.type = 'lowpass'; bgmFilter.frequency.value = 900;
    bgmBus = ctx.createGain(); bgmBus.gain.value = 0.5;
    bgmBus.connect(bgmFilter); bgmFilter.connect(master);
    sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  }

  /* ---- primitives ---- */
  function tone(o) {
    if (!ctx || muted) return;
    const { f = 440, f2 = null, t = 0, at = null, dur = 0.15, type = 'square', vol = 0.2, a = 0.004, lp = null } = o;
    const bus = o.bus || sfxBus;
    const t0 = at != null ? at : ctx.currentTime + t;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (lp) {
      const bq = ctx.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.value = lp;
      osc.connect(bq); bq.connect(g);
    } else osc.connect(g);
    g.connect(bus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  function noise(o) {
    if (!ctx || muted) return;
    const { t = 0, at = null, dur = 0.1, vol = 0.2, type = 'highpass', freq = 6000, q = 1, f2 = null } = o;
    const bus = o.bus || sfxBus;
    const t0 = at != null ? at : ctx.currentTime + t;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t0, Math.random() * 0.8); src.stop(t0 + dur + 0.02);
  }

  /* ---- sfx ---- */
  const sfx = {
    tick(sum) {
      tone({ f: 330 + Math.min(sum, 14) * 38, dur: 0.05, type: 'triangle', vol: 0.09 });
    },
    ready() {
      tone({ f: 1046, dur: 0.09, type: 'square', vol: 0.1 });
      tone({ f: 1568, t: 0.05, dur: 0.12, type: 'square', vol: 0.09 });
    },
    clear(combo, n, type) {
      const start = Math.min(combo - 1, 14);
      const count = Math.min(2 + Math.floor(n / 2), 7);
      const soft = type === 'twin';
      for (let k = 0; k < count; k++) {
        const hz = noteHz(start + k);
        tone({ f: hz, t: k * 0.04, dur: 0.16, type: soft ? 'triangle' : 'square', vol: soft ? 0.16 : 0.11, lp: 5000 });
        tone({ f: hz / 2, t: k * 0.04, dur: 0.2, type: 'triangle', vol: 0.12 });
      }
      tone({ f: 140, f2: 50, dur: 0.14, type: 'sine', vol: 0.4, a: 0.002 });         // thump
      if (n >= 4) noise({ dur: 0.22, vol: 0.22, type: 'bandpass', freq: 3000, q: 0.7 });
      if (combo >= 10) tone({ f: noteHz(start + count + 2), t: count * 0.04, dur: 0.3, type: 'sawtooth', vol: 0.07, lp: 4000 });
    },
    miss() {
      tone({ f: 210, f2: 55, dur: 0.38, type: 'sawtooth', vol: 0.22, lp: 1400 });
      noise({ dur: 0.25, vol: 0.2, type: 'lowpass', freq: 900 });
    },
    comboBreak() {
      tone({ f: 420, f2: 160, dur: 0.22, type: 'triangle', vol: 0.14 });
    },
    feverStart() {
      tone({ f: 180, f2: 1800, dur: 0.75, type: 'sawtooth', vol: 0.16, lp: 6000 });
      noise({ dur: 0.75, vol: 0.2, type: 'bandpass', freq: 500, f2: 7000, q: 1.2 });
      [0, 4, 7, 12, 16].forEach((s, k) =>
        tone({ f: 330 * Math.pow(2, s / 12), t: 0.72 + k * 0.03, dur: 0.6, type: 'square', vol: 0.09, lp: 4500 }));
      tone({ f: 110, f2: 40, t: 0.72, dur: 0.4, type: 'sine', vol: 0.6 });
    },
    feverEnd() {
      tone({ f: 900, f2: 120, dur: 0.5, type: 'triangle', vol: 0.15 });
    },
    wave() {
      [0, 4, 7, 12, 16, 19, 24].forEach((s, k) =>
        tone({ f: 261.63 * Math.pow(2, s / 12), t: k * 0.06, dur: 0.22, type: k % 2 ? 'triangle' : 'square', vol: 0.11, lp: 5200 }));
      noise({ dur: 0.4, vol: 0.18, type: 'highpass', freq: 5000, t: 0.3 });
    },
    count(n) { tone({ f: 660, dur: 0.14, type: 'square', vol: 0.15 }); },
    go() {
      [0, 7, 12].forEach((s) => tone({ f: 523.25 * Math.pow(2, s / 12), dur: 0.45, type: 'square', vol: 0.12, lp: 5000 }));
      noise({ dur: 0.3, vol: 0.2, type: 'highpass', freq: 4000 });
    },
    danger(sec) {
      const hi = sec <= 3;
      tone({ f: hi ? 1175 : 880, dur: hi ? 0.14 : 0.08, type: 'square', vol: hi ? 0.17 : 0.11 });
    },
    gameOver() {
      tone({ f: 640, f2: 40, dur: 1.3, type: 'sawtooth', vol: 0.22, lp: 3000 });
      noise({ dur: 0.9, vol: 0.25, type: 'lowpass', freq: 3000, f2: 120 });
      tone({ f: 70, f2: 30, dur: 0.9, type: 'sine', vol: 0.6 });
    },
    record() {
      [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, k) =>
        tone({ f: 392 * Math.pow(2, s / 12), t: k * 0.09, dur: 0.25, type: 'square', vol: 0.1, lp: 5000 }));
    },
  };

  /* ---- BGM: 4-bar loop (Am–F–G–Em), tempo & brightness follow the heat ---- */
  const ROOTS = [110, 87.31, 98, 82.41];
  const MINOR = [1, 1.1892, 1.4983, 2], MAJOR = [1, 1.2599, 1.4983, 2];
  const CHORD = [MINOR, MAJOR, MAJOR, MINOR];
  const BASS = [1, 0, 1, 0, 1, 0, 1.5, 0, 1, 0, 1, 0, 2, 0, 1.5, 0];
  const ARP = [0, 2, 1, 3, 2, 3, 1, 2, 0, 2, 1, 3, 3, 2, 1, 2];
  const mus = { on: false, step: 0, next: 0, timer: null, bpm: 128, energy: 0, fever: false };

  function playStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16) % 4;
    const root = ROOTS[bar], e = mus.energy;
    if (s % 4 === 0) tone({ at: t, f: 165, f2: 44, dur: 0.17, type: 'sine', vol: 0.95, a: 0.001, bus: bgmBus });
    if (s % 4 === 2 || (mus.fever && s % 2 === 1))
      noise({ at: t, dur: 0.045, vol: 0.14 + e * 0.08, type: 'highpass', freq: 7500, bus: bgmBus });
    if ((s === 4 || s === 12) && (e > 0.25 || mus.fever))
      noise({ at: t, dur: 0.13, vol: 0.3, type: 'bandpass', freq: 1800, q: 0.8, bus: bgmBus });
    const b = BASS[s];
    if (b) tone({ at: t, f: root * b, dur: 0.15, type: 'sawtooth', vol: 0.22, lp: 500 + e * 1500, bus: bgmBus });
    if (e > 0.42 || mus.fever) {
      const ratio = CHORD[bar][ARP[s] % 4];
      tone({ at: t, f: root * 4 * ratio, dur: 0.11, type: 'square', vol: 0.05 + e * 0.03, lp: 3000, bus: bgmBus });
    }
  }
  function sched() {
    if (!ctx || !mus.on) return;
    while (mus.next < ctx.currentTime + 0.14) {
      playStep(mus.step, mus.next);
      mus.next += 60 / mus.bpm / 4;
      mus.step++;
    }
  }
  const music = {
    start() {
      if (!ctx || mus.on) return;
      mus.on = true; mus.step = 0; mus.next = ctx.currentTime + 0.08;
      mus.timer = setInterval(sched, 25);
    },
    stop() { mus.on = false; clearInterval(mus.timer); },
    set(o) {
      if (o.bpm) mus.bpm = o.bpm;
      if (o.energy != null) {
        mus.energy = o.energy;
        if (bgmFilter) bgmFilter.frequency.setTargetAtTime(700 + o.energy * 9000, ctx.currentTime, 0.15);
      }
      if (o.fever != null) mus.fever = o.fever;
    },
  };

  return { init, resume, suspend, setMuted, sfx, music, get muted() { return muted; } };
})();
