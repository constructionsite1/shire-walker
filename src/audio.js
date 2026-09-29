/* ============================================================
   audio.js — the sound of the Shire, made from nothing.

   Wind, birdsong, an owl, the Water, crickets, footsteps on
   grass and dirt and in the shallows, a church bell on the hour,
   and the creak of the mill wheel. All WebAudio, all generated,
   no files. Starts on the first click, as the browsers insist.
   ============================================================ */

import { clamp, lerp, smoothstep, makeRng } from './constants.js';

function noiseBuffer(ctx, seconds = 3) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;   // gently pinked
    d[i] = last * 3.2;
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.ctx = null;
    this.rng = makeRng(9911);
    this._birdTimer = 0;
    this._cricketTimer = 0;
    this._nextBell = 0;
  }

  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch { return; }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // a gentle bus compressor so nothing ever spikes
    this.bus = ctx.createDynamicsCompressor();
    this.bus.threshold.value = -22;
    this.bus.knee.value = 22;
    this.bus.ratio.value = 3.4;
    this.bus.attack.value = 0.01;
    this.bus.release.value = 0.28;
    this.bus.connect(this.master);

    // a small convolution reverb, from synthesised noise
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.1, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.16;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.bus);

    this.noise = noiseBuffer(ctx, 4);
    this._buildWind();
    this._buildRiver();
    this._buildCrickets();

    this.ready = true;
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, ctx.currentTime + 2.2);
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  /* --- wind: filtered noise, with the filter slowly breathing -- */
  _buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.6;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;

    const g = ctx.createGain();
    g.gain.value = 0.16;

    // two slow LFOs, so it never sounds like a machine
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.021;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.06;
    lfo2.connect(lfo2G);
    lfo2G.connect(g.gain);
    lfo2.start();

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.bus);
    src.start();
    this.wind = { g, lp };
  }

  /* --- the Water: brighter noise, gated by distance ----------- */
  _buildRiver() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.33;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start();
    this.river = { g, bp };
  }

  /* --- crickets: a bed of short chirps, thinned by nightfall --- */
  _buildCrickets() {
    this.cricketGain = this.ctx.createGain();
    this.cricketGain.gain.value = 0;
    this.cricketGain.connect(this.bus);
  }

  _chirp(at, freq, dur, vol, sweep = 1.0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * sweep, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + dur * 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(this.cricketGain);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  _bird(at) {
    const ctx = this.ctx;
    const r = this.rng;
    const base = 2100 + r() * 1900;
    const notes = 2 + Math.floor(r() * 3);
    for (let i = 0; i < notes; i++) {
      const t = at + i * (0.06 + r() * 0.09);
      const osc = ctx.createOscillator();
      osc.type = r() < 0.5 ? 'sine' : 'triangle';
      const f = base * (0.86 + r() * 0.3);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (0.72 + r() * 0.7), t + 0.09);
      const g = ctx.createGain();
      const v = 0.05 + r() * 0.055;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + r() * 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.4;
      bp.Q.value = 2.2;
      osc.connect(bp); bp.connect(g);
      g.connect(this.bus);
      g.connect(this.reverb);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }

  _owl(at) {
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const t = at + i * 0.42;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(430, t);
      osc.frequency.exponentialRampToValueAtTime(360, t + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(g); g.connect(this.bus); g.connect(this.reverb);
      osc.start(t); osc.stop(t + 0.34);
    }
  }

  _bell(at, hour) {
    const ctx = this.ctx;
    const f0 = 196;
    for (let k = 0; k < 4; k++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = f0 * (k === 0 ? 1 : k === 1 ? 2.76 : k === 2 ? 5.4 : 8.9);
      const g = ctx.createGain();
      const v = 0.028 / (k + 1);
      const dur = 5.5 / (1 + k * 0.5);
      osc.frequency.setValueAtTime(f, at);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(this.bus); g.connect(this.reverb);
      osc.start(at); osc.stop(at + dur + 0.1);
    }
    void hour;
  }

  /* --- public events ------------------------------------------ */
  footstep(kind, wet) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + this.rng() * 0.5;
    const off = this.rng() * 2.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const g = ctx.createGain();
    let dur = 0.11, vol = 0.05;
    if (kind === 'water') {
      bp.frequency.value = 900 + this.rng() * 900;
      bp.Q.value = 0.7;
      dur = 0.26; vol = 0.075 * (0.6 + wet);
    } else if (kind === 'road') {
      bp.frequency.value = 1500 + this.rng() * 900;
      bp.Q.value = 1.1;
      dur = 0.09; vol = 0.055;
    } else if (kind === 'field') {
      bp.frequency.value = 2600 + this.rng() * 1400;
      bp.Q.value = 0.8;
      dur = 0.13; vol = 0.05;
    } else {
      bp.frequency.value = 2000 + this.rng() * 2200;
      bp.Q.value = 0.6;
      dur = 0.12; vol = 0.045;
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp); bp.connect(g); g.connect(this.bus);
    src.start(at, off, dur + 0.05);
  }

  knock() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = at + i * 0.19;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180 - i * 12, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g); g.connect(this.bus); g.connect(this.reverb);
      osc.start(t); osc.stop(t + 0.2);
    }
  }

  chime(kind = 'bell') {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const notes = kind === 'chime' ? [523.25, 659.25, 783.99, 1046.5] : [392, 523.25];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = at + i * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc.connect(g); g.connect(this.bus); g.connect(this.reverb);
      osc.start(t); osc.stop(t + 1.8);
    });
  }

  /* --- the mix, driven from the frame ------------------------- */
  update(dt, { night = 0, riverDist = 999, wind = 0.3, indoors = 0, indoorsNear = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const k = clamp(dt * 2.2, 0, 1);

    const riverAmt = 1 - smoothstep(6, 46, riverDist);
    this.river.g.gain.setTargetAtTime(riverAmt * 0.11, ctx.currentTime, 0.4);
    this.river.bp.frequency.setTargetAtTime(1100 + riverAmt * 900, ctx.currentTime, 0.6);

    this.wind.g.gain.setTargetAtTime(lerp(0.10, 0.24, wind) * (1 - indoors * 0.4), ctx.currentTime, 0.7);
    this.wind.lp.frequency.setTargetAtTime(300 + wind * 520, ctx.currentTime, 0.9);

    this.cricketGain.gain.setTargetAtTime(night * 0.9 * (1 - indoors * 0.6), ctx.currentTime, 0.6);

    // birds by day, owls at night
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = lerp(0.7, 3.4, this.rng()) * (indoors > 0.5 ? 2.4 : 1);
      const p = 1 - night;
      if (this.rng() < p * 0.9) this._bird(ctx.currentTime + this.rng() * 0.3);
    }
    if (night > 0.35) {
      this._cricketTimer -= dt;
      if (this._cricketTimer <= 0) {
        this._cricketTimer = 0.16 + this.rng() * 0.5;
        const f = 3800 + this.rng() * 1400;
        for (let i = 0; i < 3; i++) {
          this._chirp(ctx.currentTime + i * 0.045, f, 0.035, 0.02 * night, 0.96);
        }
      }
    }
    void k; void indoorsNear;
  }

  bell(hour) { if (this.ready && !this.muted) this._bell(this.ctx.currentTime, hour); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ready) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.25);
    }
    return this.muted;
  }
}
