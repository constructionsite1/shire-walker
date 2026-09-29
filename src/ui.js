/* ============================================================
   ui.js — the frame around the walk.

   Loading, the compass of place names, the prompt to look at
   things, discovery toasts, the map of the Four Farthings, the
   help card, and the phone's two thumbs.
   ============================================================ */

import { PLACES, RIVER, ROAD, FIELDS, TAU, clamp, lerp } from './constants.js';
import { riverAt } from './noise.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      loader: $('loader'),
      bar: $('bar'),
      loadStatus: $('load-status'),
      menu: $('menu'),
      help: $('help'),
      lost: $('lost'),
      hud: $('hud'),
      place: $('place'),
      clockTime: $('clock-time'),
      clockPhase: $('clock-phase'),
      prompt: $('prompt'),
      promptText: $('prompt-text'),
      crosshair: $('crosshair'),
      toasts: $('toasts'),
      minimap: $('minimap'),
      minimapCanvas: $('minimap-canvas'),
      stats: $('stats'),
      touch: $('touch'),
      stick: $('stick'),
      knob: $('stick-knob'),
      btnRun: $('btn-run'),
      btnAct: $('btn-act'),
      btnMap: $('btn-map'),
      btnHelp: $('btn-help'),
      selQuality: $('sel-quality'),
      selTime: $('sel-time'),
      chkCycle: $('chk-cycle')
    };
    this.mapOpen = false;
    this.helpOpen = false;
    this._toasts = [];
    this._place = '';
    this._lastPlaceUpdate = 0;
    this.mctx = this.el.minimapCanvas ? this.el.minimapCanvas.getContext('2d') : null;
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 1 && !matchMedia('(hover: hover)').matches);
    if (this.isTouch) document.body.classList.add('touch');
  }

  /* --- loading -------------------------------------------------- */
  progress(p, label) {
    if (this.el.bar) this.el.bar.style.width = `${clamp(p, 0, 1) * 100}%`;
    if (label && this.el.loadStatus) this.el.loadStatus.textContent = label;
  }

  hideLoader() {
    if (!this.el.loader) return;
    this.el.loader.classList.add('gone');
    setTimeout(() => this.el.loader.classList.add('hidden'), 1000);
  }

  showMenu(show) {
    this.el.menu.classList.toggle('hidden', !show);
  }

  showHelp(show) {
    this.helpOpen = show;
    this.el.help.classList.toggle('hidden', !show);
  }

  showLost(show) { this.el.lost.classList.toggle('hidden', !show); }

  setTouch(on) {
    this.el.touch.classList.toggle('hidden', !on);
  }

  /* --- place and clock ------------------------------------------ */
  setPlace(name) {
    if (name === this._place) return;
    this._place = name;
    this.el.place.textContent = name || ' ';
    if (name) {
      this.el.place.classList.remove('pop');
      void this.el.place.offsetWidth;
      this.el.place.classList.add('pop');
    }
  }

  setClock(time, phase) {
    this.el.clockTime.textContent = time;
    this.el.clockPhase.textContent = phase;
  }

  /* --- the prompt to look at something -------------------------- */
  setPrompt(label) {
    if (!label) {
      this.el.prompt.classList.add('hidden');
      this.el.crosshair.classList.remove('hot');
      return;
    }
    this.el.promptText.textContent = label;
    this.el.prompt.classList.remove('hidden');
    this.el.crosshair.classList.add('hot');
  }

  /* --- discovery toasts ----------------------------------------- */
  toast(name, sub) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = `<span class="t-name"></span><span class="t-sub"></span>`;
    d.querySelector('.t-name').textContent = name;
    if (sub) d.querySelector('.t-sub').textContent = sub;
    this.el.toasts.appendChild(d);
    this._toasts.push(d);
    if (this._toasts.length > 3) this._killToast(this._toasts[0]);
    setTimeout(() => this._killToast(d), 4600);
  }

  _killToast(d) {
    const i = this._toasts.indexOf(d);
    if (i >= 0) this._toasts.splice(i, 1);
    if (!d.isConnected) return;
    d.classList.add('out');
    setTimeout(() => d.remove(), 800);
  }

  /* --- stats ------------------------------------------------------ */
  setStats(text) {
    this.el.stats.textContent = text;
  }
  toggleStats(on) { this.el.stats.classList.toggle('hidden', !on); }

  /* --- the map ---------------------------------------------------- */
  toggleMap() {
    this.mapOpen = !this.mapOpen;
    this.el.minimap.classList.toggle('hidden', !this.mapOpen);
    this.el.btnMap && this.el.btnMap.classList.toggle('on', this.mapOpen);
    return this.mapOpen;
  }

  drawMap(px, pz, heading) {
    if (!this.mapOpen || !this.mctx) return;
    const c = this.mctx;
    const W = this.el.minimapCanvas.width;
    const SPAN = 620;            // metres across the map
    const s = W / SPAN;
    const toX = (x) => W / 2 + (x - px) * s;
    const toY = (z) => W / 2 + (z - pz) * s;

    c.clearRect(0, 0, W, W);
    // ground
    const g = c.createRadialGradient(W / 2, W / 2, W * 0.1, W / 2, W / 2, W * 0.72);
    g.addColorStop(0, '#26301f');
    g.addColorStop(1, '#161d12');
    c.fillStyle = g;
    c.fillRect(0, 0, W, W);

    // fields
    c.fillStyle = 'rgba(150,150,80,0.14)';
    for (const f of FIELDS) {
      c.save();
      c.translate(toX(f.x), toY(f.z));
      c.rotate(f.rot);
      c.fillRect(-f.w * s, -f.h * s, f.w * 2 * s, f.h * 2 * s);
      c.restore();
    }

    // the Water
    c.lineWidth = Math.max(2, 11 * s);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#3a5a68';
    c.beginPath();
    for (let i = 0; i < RIVER.length; i++) {
      const p = RIVER[i];
      if (i === 0) c.moveTo(toX(p[0]), toY(p[1])); else c.lineTo(toX(p[0]), toY(p[1]));
    }
    c.stroke();

    // the Great West Road
    c.lineWidth = Math.max(1, 4 * s);
    c.strokeStyle = 'rgba(214,190,140,0.55)';
    c.setLineDash([6, 4]);
    c.beginPath();
    for (let i = 0; i < ROAD.length; i++) {
      const p = ROAD[i];
      if (i === 0) c.moveTo(toX(p[0]), toY(p[1])); else c.lineTo(toX(p[0]), toY(p[1]));
    }
    c.stroke();
    c.setLineDash([]);

    // the water you are nearest
    const r = riverAt(px, pz);
    if (r.d < 60) {
      c.fillStyle = 'rgba(58,90,104,0.5)';
      c.beginPath();
      c.arc(toX(px), toY(pz), r.width * 1.3 * s, 0, TAU);
      c.fill();
    }

    // places
    c.textAlign = 'center';
    for (const p of PLACES) {
      const x = toX(p.x), y = toY(p.z);
      if (x < -30 || y < -30 || x > W + 30 || y > W + 30) continue;
      const found = this._found ? this._found.has(p.id) : true;
      c.beginPath();
      c.arc(x, y, 3.1, 0, TAU);
      c.fillStyle = found ? '#e2c877' : 'rgba(243,233,210,0.34)';
      c.fill();
      if (found) {
        c.strokeStyle = 'rgba(226,200,119,0.4)';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(x, y, 6, 0, TAU);
        c.stroke();
      }
      c.font = '9px Georgia, serif';
      c.fillStyle = found ? 'rgba(243,233,210,0.9)' : 'rgba(243,233,210,0.42)';
      c.fillText(p.name, x, y - 7);
    }

    // you
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(heading);
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(4.6, 5.5);
    c.lineTo(0, 2.6);
    c.lineTo(-4.6, 5.5);
    c.closePath();
    c.fillStyle = '#f3e9d2';
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = 1;
    c.stroke();
    c.restore();

    // north point and a ring for the edge of the world
    c.fillStyle = 'rgba(243,233,210,0.55)';
    c.font = 'italic 10px Georgia, serif';
    c.fillText('N', W / 2, 13);
    c.strokeStyle = 'rgba(243,233,210,0.12)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(W / 2, W / 2, W / 2 - 3, 0, TAU);
    c.stroke();
  }

  setFound(set) { this._found = set; }

  /* --- the phone's thumbs ---------------------------------------- */
  bindTouch(player, onAction, onMap, onHelp) {
    if (!this.isTouch) return;
    const stick = this.el.stick;
    const knob = this.el.knob;
    let id = null;
    const R = 46;

    const start = (e) => {
      if (id !== null) return;
      const t = e.changedTouches ? e.changedTouches[0] : e;
      id = t.identifier ?? 0;
      const r = stick.getBoundingClientRect();
      this._stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      move(e);
      e.preventDefault();
    };
    const move = (e) => {
      if (id === null) return;
      const list = e.changedTouches ? Array.from(e.changedTouches) : [e];
      const t = list.find(x => (x.identifier ?? 0) === id);
      if (!t) return;
      let dx = t.clientX - this._stickOrigin.x;
      let dy = t.clientY - this._stickOrigin.y;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      player.stickInput(dx / R, -dy / R);
      e.preventDefault();
    };
    const end = (e) => {
      if (id === null) return;
      const list = e.changedTouches ? Array.from(e.changedTouches) : [e];
      if (!(list.find(x => (x.identifier ?? 0) === id) && e.type !== 'touchend')) return;
      id = null;
      knob.style.transform = '';
      player.stickInput(0, 0);
    };
    stick.addEventListener('touchstart', start, { passive: false });
    stick.addEventListener('touchmove', move, { passive: false });
    stick.addEventListener('touchend', end);
    stick.addEventListener('touchcancel', end);

    // the right half of the screen looks around
    let lookId = null, lx = 0, ly = 0;
    const surface = document.getElementById('stage');
    surface.addEventListener('touchstart', (e) => {
      if (player.stick.active) return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.42) continue;
        if (lookId !== null) continue;
        lookId = t.identifier;
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: true });
    surface.addEventListener('touchmove', (e) => {
      if (lookId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        player.lookDrag((t.clientX - lx) * 1.5, (t.clientY - ly) * 1.5);
        lx = t.clientX; ly = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const clear = (e) => {
      if (lookId === null) return;
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    };
    surface.addEventListener('touchend', clear);
    surface.addEventListener('touchcancel', clear);

    const tap = (el, fn) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      el.addEventListener('click', (e) => { e.preventDefault(); fn(); });
    };
    tap(this.el.btnAct, onAction);
    tap(this.el.btnMap, onMap);
    tap(this.el.btnHelp, onHelp);
    tap(this.el.btnRun, () => {
      const on = this.el.btnRun.classList.toggle('on');
      this.el.btnRun.textContent = on ? 'stop' : 'run';
    });
    // and the run button actually runs
    this.runHeld = false;
    this.el.btnRun.addEventListener('touchstart', () => { this.runHeld = true; player.keys.shift = true; }, { passive: true });
    const rel = () => { this.runHeld = false; player.keys.shift = false; };
    this.el.btnRun.addEventListener('touchend', rel);
    this.el.btnRun.addEventListener('touchcancel', rel);
  }
}

export { $, lerp };
