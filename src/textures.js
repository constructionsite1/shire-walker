/* ============================================================
   textures.js — every surface in the Shire, painted in code.
   No image files anywhere. Canvases are drawn once at boot and
   uploaded as CanvasTextures.
   ============================================================ */

import * as THREE from 'three';
import { TAU, clamp, lerp, makeRng } from './constants.js';
import { fbm2, noise2 } from './noise.js';

const cache = new Map();

function canvas(size, h) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h || size;
  return c;
}

function finish(c, { repeat = 1, srgb = true, aniso = 4, linear = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function memo(key, build) {
  if (cache.has(key)) return cache.get(key);
  const t = build();
  cache.set(key, t);
  return t;
}

/* ------------------------------------------------------------
   A note on colour, which matters more here than it looks.

   Everything that is drawn with vertex colours gets its tint from
   the geometry, and the map is multiplied on top. So every map
   used that way is drawn in luminance only — greyscale, with the
   value doing the work. If a texture also carries its own colour,
   the two multiply and the surface comes out squared: a leaf that
   should be a mid green arrives as near-black.
   ------------------------------------------------------------ */
const GREY = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

/* ------------------------------------------------------------
   Grass / turf detail. This one is the opposite case: it is the
   albedo, multiplied into the terrain's own colour, so it keeps
   its green.
   ------------------------------------------------------------ */
export function turfTexture() {
  return memo('turf', () => {
    const N = 512, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = '#67754f';
    g.fillRect(0, 0, N, N);
    const img = g.getImageData(0, 0, N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const a = fbm2(x * 0.021, y * 0.021, 4) * 0.5 + 0.5;
        const b = fbm2(x * 0.11 + 50, y * 0.11 - 30, 3) * 0.5 + 0.5;
        const c2 = fbm2(x * 0.42, y * 0.42, 2) * 0.5 + 0.5;
        let l = a * 0.55 + b * 0.3 + c2 * 0.15;
        l = 0.34 + l * 0.5;
        d[o] = clamp(d[o] * (0.80 + l * 0.42), 0, 255);
        d[o + 1] = clamp(d[o + 1] * (0.84 + l * 0.34), 0, 255);
        d[o + 2] = clamp(d[o + 2] * (0.76 + l * 0.28), 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // blades
    const rng = makeRng(4242);
    g.lineWidth = 1;
    for (let i = 0; i < 6400; i++) {
      const x = rng() * N, y = rng() * N, h = 3 + rng() * 8;
      const lean = (rng() - 0.5) * 4;
      const v = rng();
      g.strokeStyle = v > 0.60
        ? `rgba(168,186,110,${0.12 + rng() * 0.20})`
        : `rgba(30,50,22,${0.14 + rng() * 0.24})`;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + lean * 0.5, y - h * 0.6, x + lean, y - h);
      g.stroke();
    }
    return finish(c, { repeat: 1 });
  });
}

/* ------------------------------------------------------------
   Grass blade sprite for the cross-quad foliage and canopies.
   Luminance only: the hue comes from the vertex colour.
   ------------------------------------------------------------ */
export function leafClusterTexture(hues = ['#4f7a30', '#3d6326', '#6a9440', '#87a94c']) {
  const key = 'leaf' + hues.join('');
  return memo(key, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.clearRect(0, 0, N, N);
    const rng = makeRng(9182);
    // three values of grey, so the canopy has depth once tinted
    const vals = [186, 148, 118];
    // a cloud of small leaf shapes, denser in the middle
    for (let i = 0; i < 900; i++) {
      const a = rng() * TAU;
      const rr = Math.pow(rng(), 0.5);
      const x = N * 0.5 + Math.cos(a) * rr * N * 0.46;
      const y = N * 0.5 + Math.sin(a) * rr * N * 0.48;
      const s = 7 + rng() * 15 * (1 - rr * 0.45);
      g.save();
      g.translate(x, y);
      g.rotate(rng() * TAU);
      g.globalAlpha = 0.88 + rng() * 0.12;
      g.fillStyle = GREY(vals[(rng() * vals.length) | 0] * (0.82 + rng() * 0.36));
      g.beginPath();
      g.ellipse(0, 0, s, s * (0.42 + rng() * 0.3), 0, 0, TAU);
      g.fill();
      // a darker underside on some, so the mass has form
      if (rng() > 0.55) {
        g.globalAlpha = 0.42;
        g.fillStyle = GREY(74);
        g.beginPath();
        g.ellipse(0, s * 0.24, s * 0.8, s * 0.3, 0, 0, TAU);
        g.fill();
      }
      g.restore();
    }
    // knock the alpha back only at the very rim, so the card has no
    // hard edge but the middle stays solid enough to survive alphaTest
    const grad = g.createRadialGradient(N / 2, N / 2, N * 0.40, N / 2, N / 2, N * 0.5);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'source-over';
    return finish(c, { repeat: 1 });
  });
}

/* Willow: long, drooping fronds. Luminance only, as above. */
export function willowFrondTexture() {
  return memo('willow', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const rng = makeRng(551);
    g.clearRect(0, 0, N, N);
    for (let i = 0; i < 300; i++) {
      const x = rng() * N, len = N * (0.35 + rng() * 0.6);
      const y0 = rng() * N * 0.2;
      const sway = (rng() - 0.5) * 40;
      const v = 120 + rng() * 110;
      g.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.4 + rng() * 0.5})`;
      g.lineWidth = 1 + rng() * 2.4;
      g.beginPath();
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + sway * 0.4, y0 + len * 0.6, x + sway, y0 + len);
      g.stroke();
    }
    return finish(c, { repeat: 1 });
  });
}

/* ------------------------------------------------------------
   Bark. Vertical fibrous grain with knots. Luminance only.
   ------------------------------------------------------------ */
export function barkTexture(base = '#4b3a27', dark = '#2c2116', light = '#7a6444') {
  const key = 'bark' + base + dark + light;
  return memo(key, () => {
    const N = 256, c = canvas(N, N), g = c.getContext('2d');
    g.fillStyle = GREY(150);
    g.fillRect(0, 0, N, N);
    const img = g.getImageData(0, 0, N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const warp = fbm2(x * 0.02, y * 0.005, 3) * 22;
        let v = fbm2((x + warp) * 0.075, y * 0.008, 4) * 0.5 + 0.5;
        v = Math.pow(v, 1.2);
        const l = 62 + v * 150;
        d[o] = l; d[o + 1] = l * 0.99; d[o + 2] = l * 0.96;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // deep fissures
    g.lineWidth = 1;
    for (let i = 0; i < 150; i++) {
      const x0 = Math.random() * N;
      g.strokeStyle = `rgba(28,24,20,${0.12 + Math.random() * 0.3})`;
      g.beginPath();
      let x = x0, y = 0;
      g.moveTo(x, y);
      while (y < N) {
        y += 12;
        x += (Math.random() - 0.5) * 7;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // a few pale highlights so the trunk catches the light
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(255,250,238,${0.04 + Math.random() * 0.1})`;
      g.lineWidth = 1 + Math.random() * 2;
      const x0 = Math.random() * N;
      g.beginPath();
      g.moveTo(x0, 0);
      g.bezierCurveTo(x0 + 8, N * 0.33, x0 - 8, N * 0.66, x0 + 3, N);
      g.stroke();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* ------------------------------------------------------------
   Thatch — straw laid in courses, with a ridge cap.
   ------------------------------------------------------------ */
export function thatchTexture() {
  return memo('thatch', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = GREY(168);
    g.fillRect(0, 0, N, N);
    const rng = makeRng(777);
    // courses
    for (let y = 0; y < N; y += 16) {
      g.fillStyle = `rgba(96,96,96,${0.16 + rng() * 0.12})`;
      g.fillRect(0, y, N, 2);
    }
    for (let i = 0; i < 7000; i++) {
      const x = rng() * N, y = rng() * N;
      const len = 8 + rng() * 20, a = (rng() - 0.5) * 0.5;
      const v = rng();
      g.strokeStyle = v > 0.7
        ? `rgba(238,238,238,${0.14 + rng() * 0.34})`
        : v > 0.35
          ? `rgba(200,200,200,${0.16 + rng() * 0.32})`
          : `rgba(110,110,110,${0.16 + rng() * 0.32})`;
      g.lineWidth = 0.7 + rng() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(a) * len, y + Math.cos(a) * len);
      g.stroke();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* Turf roof — grass growing over the whole mound, as Bag End has. */
export function turfRoofTexture() {
  return memo('turfroof', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = '#4a6d2f';
    g.fillRect(0, 0, N, N);
    const rng = makeRng(31337);
    for (let i = 0; i < 9000; i++) {
      const x = rng() * N, y = rng() * N;
      const v = rng();
      g.fillStyle = v > 0.66 ? `rgba(134,172,74,${0.1 + rng() * 0.3})`
        : v > 0.3 ? `rgba(78,112,44,${0.1 + rng() * 0.3})`
          : `rgba(40,62,26,${0.1 + rng() * 0.3})`;
      g.beginPath();
      g.ellipse(x, y, 1 + rng() * 2.4, 0.7 + rng() * 1.6, rng() * TAU, 0, TAU);
      g.fill();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* ------------------------------------------------------------
   Painted render: plaster, limewash, cob. The films' hobbit
   walls are warm cream, pink and ochre, always a little worn.
   ------------------------------------------------------------ */
export function renderTexture(hex = '#e6d5b0', seed = 1) {
  return memo('render' + hex + seed, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const rng = makeRng(9000 + seed * 37);
    g.fillStyle = GREY(238);
    g.fillRect(0, 0, N, N);
    // uneven wash
    for (let i = 0; i < 90; i++) {
      const x = rng() * N, y = rng() * N, r = 18 + rng() * 62;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() > 0.5;
      grad.addColorStop(0, dark ? 'rgba(150,150,150,0.12)' : 'rgba(255,255,255,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    // stone showing through at the bottom
    const img = g.getImageData(0, 0, N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const n = fbm2(x * 0.06 + seed * 13, y * 0.06, 3) * 0.5 + 0.5;
        const k = 0.92 + n * 0.16;
        d[o] *= k; d[o + 1] *= k; d[o + 2] *= k;
      }
    }
    g.putImageData(img, 0, 0);
    // small pebbles
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(172,172,172,${0.1 + rng() * 0.22})`;
      g.beginPath();
      g.ellipse(rng() * N, rng() * N, 0.8 + rng() * 2, 0.8 + rng() * 1.6, rng() * TAU, 0, TAU);
      g.fill();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* Drystone walling — the field boundaries of the Shire. */
export function drystoneTexture() {
  return memo('drystone', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = GREY(120);
    g.fillRect(0, 0, N, N);
    const rng = makeRng(2024);
    const rows = 9, rh = N / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 20;
      while (x < N) {
        const w = 16 + rng() * 26;
        const v = 0.72 + rng() * 0.5;
        const base = [206, 206, 206];
        g.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
        const y = r * rh + 1.5, h = rh - 3;
        g.beginPath();
        const rr = 3;
        g.moveTo(x + rr, y);
        g.arcTo(x + w, y, x + w, y + h, rr);
        g.arcTo(x + w, y + h, x, y + h, rr);
        g.arcTo(x, y + h, x, y, rr);
        g.arcTo(x, y, x + w, y, rr);
        g.fill();
        // top highlight, bottom shade
        g.fillStyle = 'rgba(255,255,240,0.14)';
        g.fillRect(x + 2, y + 1, w - 4, 1.6);
        g.fillStyle = 'rgba(30,28,22,0.24)';
        g.fillRect(x + 2, y + h - 2.6, w - 4, 1.6);
        x += w + 1.5 + rng() * 2;
      }
    }
    // moss in the joints
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(158,158,158,${0.06 + rng() * 0.18})`;
      g.beginPath();
      g.ellipse(rng() * N, rng() * N, 2 + rng() * 7, 1 + rng() * 4, rng() * TAU, 0, TAU);
      g.fill();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* A round, panelled wooden door. The films' doors are the point. */
export function doorTexture(hex = '#3f7a2a') {
  return memo('door' + hex, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const rng = makeRng(hex.length * 131 + 7);
    g.clearRect(0, 0, N, N);
    g.fillStyle = hex;
    g.beginPath();
    g.arc(N / 2, N / 2, N / 2, 0, TAU);
    g.fill();
    // vertical planking
    g.save();
    g.beginPath();
    g.arc(N / 2, N / 2, N / 2, 0, TAU);
    g.clip();
    for (let x = 0; x < N; x += 13) {
      const v = 0.86 + rng() * 0.28;
      g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.1})`;
      g.fillRect(x, 0, 1.6, N);
      g.fillStyle = `rgba(255,255,255,${0.03 * v})`;
      g.fillRect(x + 2, 0, 1, N);
    }
    // horizontal ledges, top and bottom
    for (const y of [N * 0.14, N * 0.86]) {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(0, y, N, 7);
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(0, y - 2, N, 2);
    }
    // wear
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(0,0,0,${0.02 + rng() * 0.05})`;
      g.beginPath();
      g.ellipse(rng() * N, N * 0.4 + rng() * N * 0.55, 2 + rng() * 12, 1 + rng() * 4, rng() * TAU, 0, TAU);
      g.fill();
    }
    g.restore();
    // painted rim
    g.strokeStyle = 'rgba(0,0,0,0.32)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(N / 2, N / 2, N / 2 - 3, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(N / 2, N / 2, N / 2 - 7, 0, TAU);
    g.stroke();
    const t = finish(c, { repeat: 1, aniso: 8 });
    return t;
  });
}

/* Warm interior seen through a round window. */
export function windowGlowTexture() {
  return memo('winglow', () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    const grad = g.createRadialGradient(N * 0.5, N * 0.55, 2, N * 0.5, N * 0.5, N * 0.5);
    grad.addColorStop(0, '#fff2c8');
    grad.addColorStop(0.35, '#ffcf7a');
    grad.addColorStop(0.75, '#c8873a');
    grad.addColorStop(1, '#2a1a0c');
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    // mullions
    g.strokeStyle = 'rgba(40,26,12,0.9)';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(N * 0.5, 0); g.lineTo(N * 0.5, N);
    g.moveTo(0, N * 0.5); g.lineTo(N, N * 0.5);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.arc(N / 2, N / 2, N * 0.46, 0, TAU);
    g.stroke();
    return finish(c, { repeat: 1 });
  });
}

/* Tilled earth, for gardens and the mill yard. */
export function soilTexture() {
  return memo('soil', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = '#4a3826';
    g.fillRect(0, 0, N, N);
    const img = g.getImageData(0, 0, N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = (y * N + x) * 4;
        const n = fbm2(x * 0.09, y * 0.09, 3) * 0.5 + 0.5;
        const cl = noise2(x * 0.3, y * 0.3) * 0.5 + 0.5;
        const k = 0.62 + n * 0.62 + cl * 0.16;
        d[o] = clamp(118 * k, 0, 255);
        d[o + 1] = clamp(92 * k, 0, 255);
        d[o + 2] = clamp(64 * k, 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* A flower bed seen from above — the pride of a hobbit. */
export function flowerTexture() {
  return memo('flowers', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = '#3f5c28';
    g.fillRect(0, 0, N, N);
    const rng = makeRng(661);
    const cols = ['#e8e2c8', '#e6c04a', '#d97a3c', '#c0506a', '#a878c8', '#f0f0e8'];
    for (let i = 0; i < 240; i++) {
      const x = rng() * N, y = rng() * N, s = 2.4 + rng() * 3.4;
      g.fillStyle = 'rgba(60,92,36,0.7)';
      g.beginPath();
      g.ellipse(x, y, s * 1.5, s * 0.8, rng() * TAU, 0, TAU);
      g.fill();
      g.fillStyle = cols[(rng() * cols.length) | 0];
      for (let p = 0; p < 5; p++) {
        const a = p / 5 * TAU;
        g.beginPath();
        g.arc(x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.46, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#f6e37a';
      g.beginPath();
      g.arc(x, y, s * 0.32, 0, TAU);
      g.fill();
    }
    return finish(c, { repeat: 1 });
  });
}

/* Planks for doors, fences, shutters, the mill, the bridge. */
export function plankTexture(hex = '#7b5a34', vertical = false) {
  return memo('plank' + hex + vertical, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = GREY(198);
    g.fillRect(0, 0, N, N);
    const rng = makeRng(hex.length * 41 + (vertical ? 1 : 0));
    const step = 21;
    for (let i = 0; i < N; i += step) {
      const v = 0.82 + rng() * 0.36;
      g.fillStyle = `rgba(0,0,0,${0.1 + rng() * 0.12})`;
      g.fillRect(i, 0, 2, N);
      g.fillStyle = `rgba(255,255,255,${0.05 * v})`;
      g.fillRect(i + 2, 0, 1.4, N);
      // grain
      for (let k = 0; k < 8; k++) {
        g.strokeStyle = `rgba(0,0,0,${0.03 + rng() * 0.07})`;
        g.lineWidth = 0.8 + rng();
        g.beginPath();
        if (vertical) { g.moveTo(i + 3 + rng() * 14, 0); g.lineTo(i + 3 + rng() * 14, N); }
        else { g.moveTo(0, i + 3 + rng() * 14); g.lineTo(N, i + 3 + rng() * 14); }
        g.stroke();
      }
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* Crop rows, for the Fields east of Hobbiton. */
export function cropTexture(kind = 'barley') {
  return memo('crop' + kind, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const base = { barley: '#a89a5c', wheat: '#bcae70', kale: '#4e7040', turnip: '#6f7d48' }[kind] || '#8f9a56';
    g.fillStyle = base;
    g.fillRect(0, 0, N, N);
    const rng = makeRng(kind.length * 97);
    const rows = kind === 'kale' ? 8 : 14;
    for (let r = 0; r < rows; r++) {
      const y = (r / rows) * N;
      for (let x = 0; x < N; x += 2.4) {
        const h = 8 + rng() * 16;
        const v = rng();
        g.strokeStyle = v > 0.7 ? `rgba(214,196,120,${0.2 + rng() * 0.4})`
          : v > 0.4 ? `rgba(120,130,58,${0.2 + rng() * 0.4})`
            : `rgba(46,54,24,${0.14 + rng() * 0.3})`;
        g.lineWidth = 1 + rng() * 1.6;
        g.beginPath();
        g.moveTo(x, y + 6);
        g.lineTo(x + (rng() - 0.5) * 4, y - h);
        g.stroke();
      }
      g.fillStyle = 'rgba(30,26,14,0.16)';
      g.fillRect(0, y, N, 3);
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* A soft round blob — lantern glows, fireflies, smoke, sun disc. */
export function glowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,200,110,0)') {
  return memo('glow' + inner + outer, () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.25, inner.replace(/,\s*1\)$/, ',0.72)'));
    grad.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.22)'));
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* A four-point star flare, for the brightest highlights. */
export function flareTexture() {
  return memo('flare', () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    g.clearRect(0, 0, N, N);
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.22);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(N / 2, N / 2);
      g.rotate(i * Math.PI / 4);
      const lg = g.createLinearGradient(0, 0, N / 2, 0);
      lg.addColorStop(0, 'rgba(255,248,224,0.9)');
      lg.addColorStop(1, 'rgba(255,248,224,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, -2.2);
      g.lineTo(N / 2, 0);
      g.lineTo(0, 2.2);
      g.closePath();
      g.fill();
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* A single butterfly / moth wing pair. */
export function wingTexture(a = '#e6c04a', b = '#3a2a18', kind = 'butterfly') {
  return memo('wing' + a + b + kind, () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    g.clearRect(0, 0, N, N);
    const rng = makeRng(a.length * 17 + kind.length);
    g.fillStyle = a;
    g.beginPath();
    g.ellipse(N * 0.3, N * 0.42, N * 0.26, N * 0.3, -0.4, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(N * 0.34, N * 0.72, N * 0.2, N * 0.2, 0.3, 0, TAU);
    g.fill();
    g.fillStyle = b;
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      g.arc(N * (0.14 + rng() * 0.34), N * (0.26 + rng() * 0.5), 1 + rng() * 4, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.ellipse(N * 0.3, N * 0.4, N * 0.05, N * 0.04, 0, 0, TAU);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* Chimmney-smoke puff. */
export function smokeTexture() {
  return memo('smoke', () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    const rng = makeRng(4004);
    g.clearRect(0, 0, N, N);
    for (let i = 0; i < 26; i++) {
      const x = N / 2 + (rng() - 0.5) * N * 0.4;
      const y = N / 2 + (rng() - 0.5) * N * 0.4;
      const r = N * (0.1 + rng() * 0.22);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.1 + rng() * 0.14})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* A small round water ripple normal, tiled. */
export function waterNormalTexture() {
  return memo('waternormal', () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const d = img.data;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        h[y * N + x] =
          fbm2(x * 0.028, y * 0.028, 4) * 0.7 +
          fbm2(x * 0.11, y * 0.11, 3) * 0.3;
      }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const xl = h[y * N + ((x - 1 + N) % N)], xr = h[y * N + ((x + 1) % N)];
        const yu = h[((y - 1 + N) % N) * N + x], yd = h[((y + 1) % N) * N + x];
        const nx = (xl - xr) * 3.2, ny = (yu - yd) * 3.2, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const o = (y * N + x) * 4;
        d[o] = ((nx / l) * 0.5 + 0.5) * 255;
        d[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        d[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return finish(c, { repeat: 1, srgb: false, aniso: 8 });
  });
}

/* Cloud alpha sheet for the sky dome. */
export function cloudTexture() {
  return memo('cloud', () => {
    const N = 512, c = canvas(N, N / 2), g = c.getContext('2d');
    const W = N, H = N / 2;
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // domain-warped fbm gives billows rather than blobs
        const wx = fbm2(x * 0.008, y * 0.016, 3) * 34;
        const wy = fbm2(x * 0.008 + 51, y * 0.016 - 17, 3) * 20;
        let v = fbm2((x + wx) * 0.011, (y + wy) * 0.021, 5, 2.1, 0.55) * 0.5 + 0.5;
        v = Math.pow(clamp(v, 0, 1), 1.35);
        // fade at the sheet edges so tiling seams vanish
        const u = x / W, vv = y / H;
        const edge = Math.min(1, Math.sin(u * Math.PI) * 6) * Math.min(1, Math.sin(vv * Math.PI) * 6);
        const a = clamp((v - 0.44) * 3.1, 0, 1) * edge;
        const o = (y * W + x) * 4;
        d[o] = 255; d[o + 1] = 255; d[o + 2] = 255;
        d[o + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* Distant forest / hedge mass seen as a silhouette band. */
export function forestBandTexture() {
  return memo('forestband', () => {
    const N = 1024, c = canvas(N, 128), g = c.getContext('2d');
    const rng = makeRng(8080);
    g.clearRect(0, 0, N, 128);
    for (let layer = 0; layer < 3; layer++) {
      const shade = ['rgba(28,52,28,0.95)', 'rgba(38,66,34,0.9)', 'rgba(50,80,40,0.8)'][layer];
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(0, 128);
      const baseY = 108 - layer * 12;
      for (let x = 0; x <= N; x += 4) {
        const n = fbm2(x * 0.012 + layer * 40, layer * 7, 4) * 0.5 + 0.5;
        const spike = Math.abs(noise2(x * 0.09, layer * 3.3)) * 16;
        const y = baseY - n * 34 - spike;
        g.lineTo(x, y);
      }
      g.lineTo(N, 128);
      g.closePath();
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

/* Sign-post board with a pointing arm. */
export function signTexture(label = 'Bree', sub = '4 miles') {
  return memo('sign' + label + sub, () => {
    const W = 256, H = 128, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#6b4f2c';
    g.fillRect(0, 0, W, H);
    const rng = makeRng(label.length * 71);
    for (let i = 0; i < 200; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.12})`;
      g.fillRect(rng() * W, 0, 1.4, H);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, H - 8, W, 8);
    g.textAlign = 'center';
    g.fillStyle = '#efe3c4';
    g.font = '600 40px Georgia, serif';
    g.fillText(label, W / 2, 62);
    g.font = 'italic 22px Georgia, serif';
    g.fillStyle = 'rgba(239,227,196,0.72)';
    g.fillText(sub, W / 2, 96);
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* A painted window shutter / signboard. */
export function paintTexture(hex = '#b0453a', glyph = '') {
  return memo('paint' + hex + glyph, () => {
    const N = 128, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = hex;
    g.fillRect(0, 0, N, N);
    const rng = makeRng(hex.length * 53);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(0,0,0,${rng() * 0.1})`;
      g.beginPath();
      g.ellipse(rng() * N, rng() * N, 2 + rng() * 14, 1 + rng() * 6, rng() * TAU, 0, TAU);
      g.fill();
    }
    if (glyph) {
      g.fillStyle = 'rgba(255,240,214,0.86)';
      g.font = '600 64px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, N / 2, N / 2 + 4);
    }
    return finish(c, { repeat: 1 });
  });
}

/* Lime-washed cob wall for the Green Dragon and the Mill. */
export function cobTexture(seed = 3) {
  return memo('cob' + seed, () => {
    const N = 256, c = canvas(N), g = c.getContext('2d');
    const pal = [224, 208, 192, 230, 200];
    const rng = makeRng(1200 + seed);
    g.fillStyle = GREY(150);
    g.fillRect(0, 0, N, N);
    // irregular cob stones
    for (let y = 0; y < N; y += 11) {
      for (let x = 0; x < N; x += 13) {
        const w = 12 + rng() * 8, h = 10 + rng() * 6;
        g.fillStyle = GREY(pal[(rng() * pal.length) | 0] * (0.88 + rng() * 0.26));
        g.beginPath();
        const cx = x + rng() * 5, cy = y + rng() * 4;
        g.ellipse(cx, cy, w / 2, h / 2, rng() * TAU, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(122,122,122,0.5)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
    // weathering
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(196,196,196,${rng() * 0.12})`;
      g.beginPath();
      g.ellipse(rng() * N, rng() * N, 10 + rng() * 40, 6 + rng() * 20, rng() * TAU, 0, TAU);
      g.fill();
    }
    return finish(c, { repeat: 1, aniso: 8 });
  });
}

/* Free every cached texture (used only when tearing down). */
export function disposeTextures() {
  for (const t of cache.values()) if (t && t.dispose) t.dispose();
  cache.clear();
}
