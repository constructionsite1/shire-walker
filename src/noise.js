/* ============================================================
   noise.js — the shape of the land, as pure functions.
   Everything that needs to know "how high is the ground here"
   imports from here: terrain, grass shader baking, tree
   placement, the player, the water. One source of truth.
   No three.js in this file.
   ============================================================ */

import {
  TAU, clamp, lerp, smoothstep,
  RIVER, TRIBUTARY, ROAD, LANES, HILL, NORTH_RISE, FIELDS, WORLD
} from './constants.js';

/* ------------------------------------------------------------
   Value-gradient noise. Cheap, smooth, and — crucially —
   deterministic and dependency-free so the CPU and the GPU
   always agree.
   ------------------------------------------------------------ */
const PERM = new Uint8Array(512);
const GX = new Float32Array(256);
const GZ = new Float32Array(256);
(function seedTables() {
  let s = 20250929;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * TAU;
    GX[i] = Math.cos(a);
    GZ[i] = Math.sin(a);
  }
})();

function grad2(hash, x, y) {
  const h = hash & 255;
  return GX[h] * x + GZ[h] * y;
}

/** Perlin-style gradient noise in [-1, 1]. */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const X = xi & 255, Y = yi & 255;
  const aa = PERM[X + PERM[Y]];
  const ab = PERM[X + PERM[Y + 1]];
  const ba = PERM[X + 1 + PERM[Y]];
  const bb = PERM[X + 1 + PERM[Y + 1]];
  const n00 = grad2(aa, xf, yf);
  const n10 = grad2(ba, xf - 1, yf);
  const n01 = grad2(ab, xf, yf - 1);
  const n11 = grad2(bb, xf - 1, yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Fractal sum. `oct` octaves, each half the amplitude and twice the frequency. */
export function fbm2(x, y, oct = 4, lac = 2.02, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise2(x * f, y * f);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** Ridged multifractal — gives hills a spine instead of a dome. */
export function ridge2(x, y, oct = 4, lac = 2.07, gain = 0.5) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f));
    sum += a * n * n;
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm;
}

/* ------------------------------------------------------------
   Curve helpers. Rivers, roads and lanes are stored as polylines;
   we query them often, so each gets a small uniform grid index.
   ------------------------------------------------------------ */
function buildIndex(points, cell) {
  const xs = points.map(p => p[0]);
  const zs = points.map(p => p[1]);
  const minX = Math.min(...xs) - cell, maxX = Math.max(...xs) + cell;
  const minZ = Math.min(...zs) - cell, maxZ = Math.max(...zs) + cell;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const buckets = new Array(nx * nz);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1];
    const gx0 = clamp(Math.floor((Math.min(a[0], b[0]) - minX) / cell), 0, nx - 1);
    const gx1 = clamp(Math.floor((Math.max(a[0], b[0]) - minX) / cell), 0, nx - 1);
    const gz0 = clamp(Math.floor((Math.min(a[1], b[1]) - minZ) / cell), 0, nz - 1);
    const gz1 = clamp(Math.floor((Math.max(a[1], b[1]) - minZ) / cell), 0, nz - 1);
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++)
        buckets[gz * nx + gx].push(s);
  }
  return {
    points, minX, minZ, nx, nz, cell, buckets,
    query(x, z) {
      const gx = clamp(Math.floor((x - this.minX) / this.cell), 0, this.nx - 1);
      const gz = clamp(Math.floor((z - this.minZ) / this.cell), 0, this.nz - 1);
      return this.buckets[gz * this.nx + gx];
    }
  };
}

/* Distance to a polyline, plus the parameter along it. */
function segDist(ax, az, bx, bz, px, pz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
  t = clamp(t, 0, 1);
  const dx = wx - vx * t, dz = wz - vz * t;
  return { d: Math.sqrt(dx * dx + dz * dz), t };
}

const riverIdx = buildIndex(RIVER, 48);
const tribIdx = buildIndex(TRIBUTARY, 40);
const roadIdx = buildIndex(ROAD, 48);

/* All lanes flattened into one index so the hot path stays a lookup. */
const LANE_PTS = [];
for (const lane of LANES) for (const p of lane) LANE_PTS.push([p[0], p[1]]);
const laneIdx = buildIndex(LANE_PTS, 40);

/* Ribbon width and surface level at a point along a river index. */
function riverSample(idx, seg, t) {
  const p = idx.points[seg];
  const q = idx.points[seg + 1];
  if (!q) return { w: p[3], level: p[2] };
  return { w: lerp(p[3], q[3], t), level: lerp(p[2], q[2], t) };
}

/**
 * The Water. Returns
 *   dist    — metres to the nearest channel centre (0 inside)
 *   level   — the water surface height there
 *   width   — channel half-width at the nearest point
 *   flow    — unit direction of flow at that point
 *   t       — 0..1 along the river, used for foam variation
 */
export function riverAt(x, z) {
  let best = { d: 1e9, level: 0, width: 6, flowX: 0, flowZ: 1, t: 0 };
  for (const idx of [riverIdx, tribIdx]) {
    const segs = idx.query(x, z);
    for (const s of segs) {
      const a = idx.points[s], b = idx.points[s + 1];
      const r = segDist(a[0], a[1], b[0], b[1], x, z);
      if (r.d < best.d) {
        const sm = riverSample(idx, s, r.t);
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        best = {
          d: r.d, level: sm.level, width: sm.w,
          flowX: dx / len, flowZ: dz / len,
          t: (s + r.t) / (idx.points.length - 1)
        };
      }
    }
  }
  return best;
}

/** Distance to the nearest road centre (and to any lane). */
export function roadAt(x, z) {
  let best = 1e9;
  for (const s of roadIdx.query(x, z)) {
    const a = roadIdx.points[s], b = roadIdx.points[s + 1];
    const r = segDist(a[0], a[1], b[0], b[1], x, z);
    if (r.d < best) best = r.d;
  }
  for (const s of laneIdx.query(x, z)) {
    const a = laneIdx.points[s], b = laneIdx.points[s + 1];
    const r = segDist(a[0], a[1], b[0], b[1], x, z);
    if (r.d < best) best = r.d;
  }
  return best;
}

/** How much of a crop field covers this point, 0..1. */
export function fieldAt(x, z) {
  let m = 0;
  for (const f of FIELDS) {
    const dx = x - f.x, dz = z - f.z;
    const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    const u = Math.abs(rx) / f.w, v = Math.abs(rz) / f.h;
    const inside = 1 - smoothstep(0.86, 1.02, Math.max(u, v));
    if (inside > m) m = inside;
  }
  return m;
}

/* ------------------------------------------------------------
   The land itself.
   ------------------------------------------------------------ */
export function baseHeight(x, z) {
  // Long, low swells — the Shire is not mountainous, it is rolling.
  let h = fbm2(x * 0.0042, z * 0.0042, 4) * 17.0;
  h += fbm2(x * 0.0125 + 31.7, z * 0.0125 - 12.3, 3) * 4.6;
  h += fbm2(x * 0.036 + 9.1, z * 0.036 + 4.4, 2) * 1.15;

  // The Hill.
  const hd = Math.hypot(x - HILL.x, z - HILL.z) / HILL.radius;
  const hillShape = Math.pow(Math.max(0, 1 - hd * hd), 1.55);
  h += HILL.height * hillShape;
  // A brow of higher ground just north of the Hill, so it reads as a hill and not a bump.
  h += 7.5 * Math.pow(Math.max(0, 1 - Math.hypot(x - 20, z + 6) / 210), 2.0);

  // The land climbs toward the Misty Mountains in the north.
  h += NORTH_RISE.height * smoothstep(NORTH_RISE.z0, NORTH_RISE.z1, z);

  // A low southern dip, the way to the downs.
  h -= 5.0 * smoothstep(150, 340, z);

  return h;
}

/** Terrain height with rivers carved. This is the ground truth. */
export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const r = riverAt(x, z);
  if (r.d < r.width * 4.2) {
    // Flatten the floodplain, then cut the channel.
    const flat = smoothstep(r.width * 4.2, r.width * 1.15, r.d);
    const bank = r.level + 0.55;
    h = lerp(h, Math.min(h, bank + (h - bank) * flat * 0.55 + 0.9), flat);
    const bed = r.level - 1.5 - 0.9 * smoothstep(0, r.width, r.d);
    h = lerp(h, Math.min(h, bed), 1 - smoothstep(r.width * 0.72, r.width * 1.5, r.d));
    h += (1 - flat) * 0;
  }
  // Roads sit in a shallow cut and are otherwise level.
  const rd = roadAt(x, z);
  if (rd < 9) {
    const w = 1 - smoothstep(3.4, 8.6, rd);
    const target = baseHeight(x, z) - 0.28;
    h = lerp(h, Math.min(h, target) * w + h * (1 - w), w * 0.85);
  }
  return h;
}

/** Surface normal via central differences. */
export function normalAt(x, z, eps = 1.1) {
  const hL = heightAt(x - eps, z), hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps), hU = heightAt(x, z + eps);
  const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
  const l = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / l, y: ny / l, z: nz / l };
}

/** 0 = flat, 1 = vertical. */
export function slopeAt(x, z, eps = 1.4) {
  return 1 - clamp(normalAt(x, z, eps).y, 0, 1);
}

/**
 * Everything the renderer needs to know about a spot, in one call.
 * `h` height, `grass` 0..1 blade density, `crop` 0..1 field mask,
 * `road` 0..1, `wet` 0..1 shoreline, `water` water depth or 0.
 */
export function landAt(x, z) {
  const r = riverAt(x, z);
  const h = heightAt(x, z);
  const road = 1 - smoothstep(1.9, 4.4, roadAt(x, z));
  // crops keep clear of the river's bank, and of the roads
  const crop = fieldAt(x, z) * (1 - road) * smoothstep(r.width * 0.9, r.width * 2.6, r.d);
  const shore = 1 - smoothstep(r.width * 0.86, r.width * 2.1, r.d);
  // Water only exists inside the channel. Without this gate the whole
  // map counts as underwater wherever it lies below the level of the
  // nearest point on the river — which, given the river starts at ten
  // metres, is most of it.
  const inChannel = smoothstep(r.width * 1.55, r.width * 0.72, r.d);
  const water = Math.max(0, r.level - h) * inChannel;
  const wet = clamp(shore * (1 - smoothstep(0.35, 1.5, water)) + water * 0.8, 0, 1);

  // Grass likes gentle ground, dislikes roads, water and stone.
  const steep = slopeAt(x, z, 2.0);
  const patch = fbm2(x * 0.014 + 77.0, z * 0.014 - 41.0, 3) * 0.5 + 0.5;
  let grass = patch * 1.35;
  grass *= 1 - smoothstep(0.34, 0.66, steep);
  grass *= 1 - road;
  grass *= 1 - crop * 0.86;
  grass *= 1 - smoothstep(0.0, 0.35, water);      // no grass in the Water
  grass *= 1 - wet * 0.55;
  grass = clamp(grass * 1.12, 0, 1);

  return { h, grass, crop, road, wet, water, shore, river: r };
}

/* ------------------------------------------------------------
   The field grid. One bake, shared by everybody: the terrain
   mesh, the grass shader, tree scatter, the player's feet and
   the water's edge all read the same numbers, so nothing can
   ever disagree about where the ground is.
   ------------------------------------------------------------ */
export class Field {
  constructor(res) {
    this.res = res;
    this.span = WORLD.inner;
    this.step = (this.span * 2) / (res - 1);
    this.h = new Float32Array(res * res);
    this.grass = new Float32Array(res * res);
    this.crop = new Float32Array(res * res);
    this.wet = new Float32Array(res * res);
    this.road = new Float32Array(res * res);
    this.ao = new Float32Array(res * res);
    this.river = new Float32Array(res * res);
    this.data = new Uint8Array(res * res * 4);
    this.data2 = new Uint8Array(res * res * 4);
  }

  /** Bake rows [from, to) of the grid. Call finish() when done. */
  bakeRange(from, to) {
    const { res, span, h, grass, crop, wet, road, river } = this;
    const j0 = Math.max(0, from | 0);
    const j1 = Math.min(res, to | 0);
    for (let j = j0; j < j1; j++) {
      const z = (j / (res - 1)) * 2 * span - span;
      for (let i = 0; i < res; i++) {
        const x = (i / (res - 1)) * 2 * span - span;
        const l = landAt(x, z);
        const k = j * res + i;
        h[k] = l.h;
        grass[k] = l.grass;
        crop[k] = l.crop;
        road[k] = l.road;
        wet[k] = Math.max(l.wet, clamp(l.water * 1.4, 0, 1));
        river[k] = clamp(l.water * 1.2, 0, 1);
      }
    }
    return this;
  }

  finish() {
    this._occlusion();
    this._pack();
    return this;
  }

  bake(onProgress) {
    const { res } = this;
    const step = Math.max(8, Math.floor(res / 8));
    for (let j = 0; j < res; j += step) {
      this.bakeRange(j, Math.min(res, j + step));
      if (onProgress) onProgress(j / res);
    }
    return this.finish();
  }

  /* Cheap horizon AO: how much of the sky a point can see,
     measured by marching outwards on the baked heights. */
  _occlusion() {
    const { res, h, ao, span } = this;
    const DIRS = 8, STEPS = 5;
    const cos = [], sin = [];
    for (let d = 0; d < DIRS; d++) {
      const a = (d / DIRS) * TAU + 0.31;
      cos.push(Math.cos(a));
      sin.push(Math.sin(a));
    }
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const h0 = h[k];
        let occ = 0;
        for (let d = 0; d < DIRS; d++) {
          let maxSlope = 0;
          for (let s = 1; s <= STEPS; s++) {
            const dist = s * s * 2.1 + 1.4;      // 3.5, 9.6, 20.3, ...
            const si = clamp(Math.round(i + cos[d] * dist), 0, res - 1);
            const sj = clamp(Math.round(j + sin[d] * dist), 0, res - 1);
            const dh = h[sj * res + si] - h0;
            const slope = dh / dist;
            if (slope > maxSlope) maxSlope = slope;
          }
          occ += maxSlope / Math.sqrt(1 + maxSlope * maxSlope); // sin(atan(slope))
        }
        ao[k] = clamp(1 - (occ / DIRS) * 1.25, 0.12, 1);
      }
    }
    // soften
    const tmp = new Float32Array(ao.length);
    for (let j = 1; j < res - 1; j++) {
      for (let i = 1; i < res - 1; i++) {
        const k = j * res + i;
        tmp[k] = (ao[k] * 4 + ao[k - 1] + ao[k + 1] + ao[k - res] + ao[k + res]) / 8;
      }
    }
    this.ao.set(tmp);
  }

  _pack() {
    const { res, h, grass, crop, wet, road, river, ao, data, data2 } = this;
    for (let k = 0; k < res * res; k++) {
      const o = k * 4;
      data[o] = clamp(Math.round((h[k] / 100) * 255), 0, 255);
      data[o + 1] = clamp(Math.round(grass[k] * 255), 0, 255);
      data[o + 2] = clamp(Math.round(crop[k] * 255), 0, 255);
      data[o + 3] = clamp(Math.round(road[k] * 255), 0, 255);
      data2[o] = clamp(Math.round(wet[k] * 255), 0, 255);
      data2[o + 1] = clamp(Math.round(ao[k] * 255), 0, 255);
      data2[o + 2] = clamp(Math.round(river[k] * 255), 0, 255);
      data2[o + 3] = clamp(Math.round(Math.min(1, Math.abs(h[k]) / 100) * 255), 0, 255);
    }
  }

  /* Bilinear sample of any channel, in world coordinates. */
  sample(arr, x, z) {
    const { res, span, step } = this;
    const fx = (x + span) / step;
    const fz = (z + span) / step;
    const i0 = clamp(Math.floor(fx), 0, res - 2);
    const j0 = clamp(Math.floor(fz), 0, res - 2);
    const tx = clamp(fx - i0, 0, 1);
    const tz = clamp(fz - j0, 0, 1);
    const a = arr[j0 * res + i0], b = arr[j0 * res + i0 + 1];
    const c = arr[(j0 + 1) * res + i0], d = arr[(j0 + 1) * res + i0 + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  height(x, z) { return this.sample(this.h, x, z); }
  grassAt(x, z) { return this.sample(this.grass, x, z); }
  cropAt(x, z) { return this.sample(this.crop, x, z); }
  wetAt(x, z) { return this.sample(this.wet, x, z); }
  aoAt(x, z) { return this.sample(this.ao, x, z); }
  waterAt(x, z) { return this.sample(this.river, x, z); }

  normalAt(x, z, eps = 1.2) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  slopeAt(x, z, eps = 1.4) {
    return 1 - clamp(this.normalAt(x, z, eps).y, 0, 1);
  }
}
