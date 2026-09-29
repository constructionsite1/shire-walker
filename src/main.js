/* ============================================================
   main.js — the Shire, assembled.

   Boot order: renderer, sky, the field bake, the ground, the
   Water, grass, the county, the life, post. Then a walk.
   ============================================================ */

import * as THREE from 'three';
import {
  QUALITY, WORLD, DAY_SECONDS, TIME_PRESETS, PLACES, EYE_HEIGHT,
  clamp, lerp, smoothstep, TAU
} from './constants.js';
import { Field, riverAt, roadAt, heightAt, setBanks } from './noise.js';
import { Sky } from './sky.js';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Grass, Trees } from './vegetation.js';
import { Buildings } from './buildings.js';
import { Props } from './props.js';
import { Creatures } from './creatures.js';
import { buildPlan, Discovery, INTERACTIVES } from './locations.js';
import { PostFX } from './postfx.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { Save } from './save.js';
import { UI } from './ui.js';

const $ = (id) => document.getElementById(id);
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

/* ------------------------------------------------------------
   Device guess
   ------------------------------------------------------------ */
function guessQuality(save) {
  const p = new URLSearchParams(location.search);
  const forced0 = p.get('q');
  if (forced0 !== null) return clamp(parseInt(forced0, 10) || 0, 0, 2);
  const forced = save.get('quality');
  if (forced !== null && forced !== undefined) return clamp(forced | 0, 0, 2);

  const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const mem = navigator.deviceMemory || (coarse ? 4 : 8);
  const cores = navigator.hardwareConcurrency || 4;
  const px = window.innerWidth * window.innerHeight * (window.devicePixelRatio || 1);
  let q = 2;
  if (coarse) q = 1;
  if (mem <= 4 || cores <= 4) q = Math.min(q, 1);
  if (mem <= 2 || cores <= 2) q = 0;
  if (px > 4.2e6) q = Math.min(q, 1);
  return clamp(q, 0, 2);
}

/* ------------------------------------------------------------
   The Shire
   ------------------------------------------------------------ */
class Shire {
  constructor() {
    this.save = new Save();
    this.ui = new UI();
    this.audio = new Audio();
    this.qIndex = guessQuality(this.save);
    this.quality = QUALITY[this.qIndex];
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.paused = true;
    this.started = false;
    this.fpsSamples = [];
    this.degraded = 0;
    this.indoors = 0;
    this.wind = 0.35;
    this.lastHour = -1;
    this.interactCool = 0;
  }

  /* ============================================================
     Boot
     ============================================================ */
  async boot() {
    const canvas = $('scene');
    const ui = this.ui;
    ui.progress(0.02, 'waking the county…');

    /* --- renderer ------------------------------------------------ */
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        stencil: false,
        depth: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
      });
    } catch (e) {
      ui.showLost(true);
      ui.hideLoader();
      throw e;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.dpr));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = this.quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      ui.showLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      ui.showLost(false);
    });

    /* --- scene and camera --------------------------------------- */
    this.scene = new THREE.Scene();
    this.scene.userData.cameraPos = new THREE.Vector3();
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.08, this.quality.far);
    this.camera.rotation.order = 'YXZ';

    ui.progress(0.06, 'hanging the sky…');
    await frame();
    this.sky = new Sky(this.scene, this.quality);
    const p = new URLSearchParams(location.search);
    const startPhase = this._readPhase(p);
    this.sky.setPhase(startPhase);
    this.clockLocked = p.has('t');

    /* --- the land ------------------------------------------------ */
    ui.progress(0.12, 'raising the county…');
    await frame();
    // The plan comes first: it owns the turf banks over the hobbit
    // holes, and those have to be part of the ground before the
    // ground is baked. Otherwise the grass never grows up Bag End.
    this.plan = buildPlan();
    setBanks(this.plan.banks);
    this.field = new Field(this.quality.dataRes);
    await this._bake();

    ui.progress(0.34, 'laying the turf…');
    await frame();
    this.terrain = new Terrain(this.field, this.quality);
    this.scene.add(this.terrain.group);

    ui.progress(0.44, 'letting in the Water…');
    await frame();
    this.water = new Water(this.field, this.quality, this.sky);
    this.scene.add(this.water.group);

    /* --- the county ---------------------------------------------- */
    ui.progress(0.5, 'building the front doors…');
    await frame();
    this.buildings = new Buildings(this.field, this.plan, this.terrain, this.quality);
    this.scene.add(this.buildings.group);

    ui.progress(0.7, 'sowing the grass…');
    await frame();
    this.grass = new Grass(this.field, this.quality);
    this.scene.add(this.grass.mesh);

    ui.progress(0.8, 'planting the trees…');
    await frame();
    this.trees = new Trees(this.field, this.plan, this.quality);
    this.scene.add(this.trees.group);

    ui.progress(0.88, 'setting out the benches…');
    await frame();
    this.props = new Props(this.field, this.plan, this.quality);
    this.scene.add(this.props.group);

    ui.progress(0.93, 'letting the fireflies out…');
    await frame();
    this.life = new Creatures(this.field, this.buildings.chimneys, this.quality);
    this.scene.add(this.life.group);

    /* --- the walker ------------------------------------------------ */
    ui.progress(0.97, 'polishing the lens…');
    await frame();
    this.player = new Player(this.field, this.camera, canvas, this.quality);
    this.player.setTouch(this.ui.isTouch);
    this.player.addColliders([
      ...this.buildings.colliders,
      ...this.trees.colliders,
      ...this.props.colliders
    ]);
    this.player.onStep = (kind, wet) => this.audio.footstep(kind, wet);
    this.player.onLockChange = (locked) => {
      if (!locked && this.started) this.ui.showMenu(true);
    };
    this.ui.setTouch(this.ui.isTouch);

    this.post = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    this.scene.fog.density = this._fogDensity();
    this._applyViewpoint();

    this.discovery = new Discovery(this.save);
    this.discovery.onFind((p) => this.ui.toast(p.name, p.sub));
    this.ui.setFound(this.discovery.found);

    this._bindUI();
    this._bindResize();

    // one warm-up render so the first visible frame is not a stutter
    this.player.update(0.016);
    this._syncSky(0);
    this.renderer.compile(this.scene, this.camera);
    ui.progress(1, 'ready');
    await frame();
    ui.hideLoader();
    this.ui.showMenu(true);
    this.clock.start();
    this.loop();
  }

  async _bake() {
    const res = this.quality.dataRes;
    const step = Math.max(12, Math.floor(res / 8));
    for (let j = 0; j < res; j += step) {
      this.field.bakeRange(j, Math.min(res, j + step));
      this.ui.progress(0.12 + 0.22 * (Math.min(res, j + step) / res));
      await frame();
    }
    this.field.finish();
  }

  _fogDensity() {
    // exponential-squared fog that reaches about 3/4 opacity at the
    // quality tier's stated draw distance
    const d = this.quality.drawDistance;
    return Math.sqrt(Math.log(4)) / d;
  }

  /**
   * Where in the day we start. `?t=gold` or `?t=0.78` wins, then
   * whatever the browser remembers, then first light.
   */
  _readPhase(p) {
    const t = p.get('t');
    if (t !== null) {
      const named = TIME_PRESETS[t];
      if (named !== undefined) return named;
      const v = parseFloat(t);
      if (Number.isFinite(v)) return (v % 1 + 1) % 1;
    }
    const saved = this.save.get('phase');
    if (saved !== null && saved !== undefined && Number.isFinite(saved)) return saved;
    return TIME_PRESETS.dawn;
  }

  /* ============================================================
     Wiring
     ============================================================ */
  _bindUI() {
    const ui = this.ui;
    const canvas = $('scene');

    const enter = () => {
      ui.showMenu(false);
      ui.showHelp(false);
      this.started = true;
      this.paused = false;
      this.audio.start();
      if (!this.ui.isTouch) this.player.requestLock();
    };
    $('btn-enter').addEventListener('click', enter);
    canvas.addEventListener('click', () => {
      if (this.started && !this.paused && !this.ui.isTouch && !this.player.locked) {
        this.player.requestLock();
      }
    });

    ui.el.selQuality.value = String(this.qIndex);
    ui.el.selQuality.addEventListener('change', (e) => {
      this.save.set('quality', parseInt(e.target.value, 10));
      this.ui.toast('Detail', 'takes effect on your next visit');
    });
    ui.el.selTime.value = 'dawn';
    ui.el.selTime.addEventListener('change', (e) => {
      this.sky.setPhase(TIME_PRESETS[e.target.value] ?? TIME_PRESETS.dawn);
      this.save.set('phase', this.sky.phase);
    });
    ui.el.chkCycle.checked = this.save.get('cycle') !== false;
    ui.el.chkCycle.addEventListener('change', (e) => this.save.set('cycle', e.target.checked));

    ui.bindTouch(this.player,
      () => this.interact(),
      () => ui.toggleMap(),
      () => ui.showHelp(!ui.helpOpen));

    $('btn-help').addEventListener('click', () => ui.showHelp(!ui.helpOpen));
    ui.el.help.addEventListener('click', (e) => { if (e.target === ui.el.help) ui.showHelp(false); });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'e') { this.interact(); return; }
      if (k === 'h') { ui.showHelp(!ui.helpOpen); return; }
      if (k === 'm') { ui.toggleMap(); return; }
      if (k === 'p') {
        document.body.classList.toggle('photo');
        return;
      }
      if (k === 'n') {
        const m = this.audio.toggleMute();
        this.save.set('muted', m);
        ui.toast(m ? 'Silence' : 'Sound', m ? 'the county holds its breath' : 'the wind returns');
        return;
      }
      if (k === 't') {
        this.sky.setPhase(this.sky.phase + 1 / 24);
        this.save.set('phase', this.sky.phase);
        return;
      }
      if (k === 'f') { ui.toggleStats(ui.el.stats.classList.contains('hidden')); return; }
      if (k === 'escape') { ui.showHelp(false); }
      if (k >= '1' && k <= '3') {
        this._rebuild(parseInt(k, 10) - 1);
      }
    });

    // any audio that wants to happen gets the gesture
    const kick = () => { this.audio.start(); };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('touchstart', kick, { once: true });
  }

  _bindResize() {
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const w = window.innerWidth, h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.dpr * this._dprScale()));
        this.renderer.setSize(w, h, false);
        this.post.setSize(w, h);
      }, 90);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  _dprScale() { return this.degraded >= 1 ? 0.72 : this.degraded >= 2 ? 0.55 : 1; }

  /**
   * `?at=x,z&yaw=deg&pitch=deg` puts you somewhere and points you
   * somewhere. Handy for looking at one thing, and for sharing a
   * view of the county with somebody.
   */
  _applyViewpoint() {
    const p = new URLSearchParams(location.search);
    const at = p.get('at');
    if (!at) return;
    const parts = at.split(',').map(Number);
    if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return;
    this.player.position.x = clamp(parts[0], -370, 370);
    this.player.position.z = clamp(parts[1], -370, 370);
    this.player.groundY = this.field.height(this.player.position.x, this.player.position.z);
    this.player.position.y = this.player.groundY;
    if (parts.length > 2 && Number.isFinite(parts[2])) this.player.position.y += parts[2];
    const yaw = parseFloat(p.get('yaw'));
    if (Number.isFinite(yaw)) this.player.yaw = (yaw * Math.PI) / 180;
    const pitch = parseFloat(p.get('pitch'));
    if (Number.isFinite(pitch)) this.player.pitch = clamp((pitch * Math.PI) / 180, -1.32, 1.28);
  }

  /* ============================================================
     Looking at things
     ============================================================ */
  _findInteractive() {
    const p = this.player.position;
    let best = null, bestScore = -1;
    const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
    for (const it of INTERACTIVES) {
      const place = this.plan.place(it.place);
      if (!place) continue;
      const dx = place.x - p.x, dz = place.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > it.r) continue;
      const facing = (dx / (d || 1)) * fx + (dz / (d || 1)) * fz;
      const score = facing * 0.6 + (1 - d / it.r) * 0.4;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return bestScore > 0.12 ? best : null;
  }

  interact() {
    if (this.interactCool > 0) return;
    const it = this._findInteractive();
    if (!it) return;
    this.interactCool = 0.5;
    switch (it.id) {
      case 'bagend-door':
        this.buildings.knock('bagend');
        this.audio.knock();
        break;
      case 'dragon-door':
        this.buildings.knock('dragon');
        this.audio.knock();
        break;
      case 'party-tree':
        this.treeGlow = 1;
        this.audio.chime('chime');
        break;
      case 'mill-wheel':
        this.audio.chime();
        break;
      case 'vane':
      case 'well':
      case 'signpost':
      case 'bridge-stone':
      case 'bywater-bench':
        this.audio.chime();
        break;
      default:
        this.audio.chime();
    }
    this.ui.toast(this._placeNameFor(it), it.text);
  }

  _placeNameFor(it) {
    const words = {
      'bagend-door': 'Bag End',
      'party-tree': 'The Party Tree',
      'dragon-door': 'The Green Dragon',
      'mill-wheel': 'The Mill',
      'well': 'The Well',
      'bridge-stone': 'Bywater Bridge',
      'vane': 'A Weathervane',
      'signpost': 'The Signpost',
      'bywater-bench': 'Bywater'
    };
    return words[it.id] || 'The Shire';
  }

  /* ============================================================
     Per-frame
     ============================================================ */
  _syncSky(dt) {
    const cycle = this.save.get('cycle') !== false && !this.clockLocked;
    if (cycle && this.started) {
      this.sky.setPhase(this.sky.phase + dt / DAY_SECONDS);
    }
    const sunY = this.sky.sunDir.y;
    const night = this.sky.palette.night;
    this.terrain.setHaze(this.sky.haze);
    this.terrain.setWetness(1);
    this.water.uniforms.uFogDensity.value = this.scene.fog.density;
    this.post.setNight(night);
    this.sky.followShadow(this.player.position, this.quality.shadow > 1500 ? 52 : 34);
    this.scene.userData.cameraPos.copy(this.camera.position);
    this.sky.update(this.elapsed);
    this.water.update(this.elapsed, this.sky, this.camera);
    return { night, sunY };
  }

  loop = () => {
    requestAnimationFrame(this.loop);
    if (this.contextLost) return;
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.elapsed += dt;
    this.interactCool = Math.max(0, this.interactCool - dt);

    /* --- simulate ------------------------------------------------ */
    if (this.started && !this.paused) this.player.update(dt);
    else { this.player.update(0.0001); }

    const { night } = this._syncSky(dt);
    this.terrain.update(this.elapsed);
    this.grass.update(this.elapsed, this.camera);
    this.trees.update();
    this.buildings.update(this.elapsed, dt, night);
    this.props.update(this.elapsed, dt, night);

    const mist = this.sky.mistAmount;
    this.life.update(this.elapsed, this.camera, night, mist, this.sky, this.indoors);

    // wind picks up a little and eases off again
    this.wind = 0.32 + 0.26 * Math.sin(this.elapsed * 0.07) + 0.12 * Math.sin(this.elapsed * 0.23);

    // the Party Tree answers when you look up at it
    if (this.treeGlow !== undefined) {
      this.treeGlow = Math.max(0, this.treeGlow - dt * 0.5);
      const base = 0.25 + night * 1.5;
      this.buildings.lanternMat.color.setRGB(
        base + this.treeGlow * 0.9,
        (base + this.treeGlow * 0.9) * 0.86,
        (base + this.treeGlow * 0.9) * 0.62);
    }

    /* --- discovery, prompt, place -------------------------------- */
    const found = this.discovery.update(this.player.position.x, this.player.position.z);
    if (found) this.ui.setFound(this.discovery.found);
    const near = this._nearestPlace();
    this.ui.setPlace(near ? near.name : '');
    this.ui.setClock(this.sky.clockString, this.sky.phaseName);
    const it = this._findInteractive();
    this.ui.setPrompt(it ? it.label : null);
    this.currentInteractive = it;

    /* --- audio ----------------------------------------------------- */
    const r = riverAt(this.player.position.x, this.player.position.z);
    this.audio.update(dt, {
      night,
      riverDist: r.d,
      wind: this.wind,
      indoors: this.indoors
    });
    const hour = Math.floor(this.sky.phase * 24);
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      if (this.audio.ready) this.audio.bell(hour);
    }

    /* --- map --------------------------------------------------------- */
    this.ui.drawMap(this.player.position.x, this.player.position.z, this.player.yaw + Math.PI);

    /* --- draw --------------------------------------------------------- */
    this.renderer.info.reset();
    this.post.setSun(this.sky.sunDir, this.camera.position, this.sky.palette.sun, night);
    this.post.render(dt, this.elapsed);

    this._watchPerformance(raw);
  };

  _nearestPlace() {
    const p = this.player.position;
    let best = null, bestD = Infinity;
    for (const pl of PLACES) {
      const d = Math.hypot(pl.x - p.x, pl.z - p.z);
      const near = d - pl.r;
      if (near < bestD) { bestD = near; best = pl; }
    }
    return bestD < 26 ? best : (bestD < 90 ? best : null);
  }

  _watchPerformance(raw) {
    if (this.degraded >= 3 || !this.started) return;
    const fps = 1 / Math.max(raw, 0.0001);
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length < 180) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    if (avg >= 46) return;
    // it is not coping: take something away, gently
    this.degraded++;
    this.quality = { ...this.quality, dpr: this.quality.dpr };
    if (this.degraded === 1) {
      this.grass.uniforms.uRadius.value *= 0.78;
      this.scene.fog.density = this.scene.fog.density * 1.12;
      if (this.post.godrays) this.post.godrays.enabled = false;
    } else if (this.degraded === 2) {
      this.grass.uniforms.uRadius.value *= 0.7;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0 * this._dprScale()));
      if (this.post.bloom) this.post.bloom.enabled = false;
      this.renderer.shadowMap.enabled = false;
      this.sky.sun.castShadow = false;
    } else {
      this.grass.uniforms.uRadius.value *= 0.6;
      this.renderer.setPixelRatio(0.75);
      this.life.group.visible = false;
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.post.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.needsUpdate = true;
    this.ui.toast('Detail eased', 'so the walk stays smooth');
  }

  /* ============================================================
     Changing the tier needs a fresh build; simplest is a reload.
     ============================================================ */
  _rebuild(index) {
    if (index === this.qIndex) return;
    this.save.set('quality', index);
    const p = new URLSearchParams(location.search);
    p.set('q', String(index));
    location.search = p.toString();
  }
}

/* ============================================================
   Go
   ============================================================ */
const shire = new Shire();
window.shire = shire;
shire.boot().catch((err) => {
  console.error(err);
  const ui = shire.ui;
  if (ui) {
    ui.hideLoader();
    ui.showLost(true);
    const p = $('lost') && $('lost').querySelector('.sub');
    if (p) p.textContent = 'This browser could not start WebGL. Try a different one.';
  }
});

export { Shire, lerp, smoothstep, TAU, WORLD, EYE_HEIGHT, QUALITY, heightAt, roadAt };
