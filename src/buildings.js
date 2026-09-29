/* ============================================================
   buildings.js — Bag End, Hobbiton, the Green Dragon, the Mill.

   Every facade is a round green door in a gently curved wall
   set into a turf mound, with porthole windows glowing warm
   and a chimney smoking. The films' proportions are kept: a
   hobbit door is 1.1 m across, a window 0.85 m, and Bag End is
   15.5 m of frontage buried in the flank of the Hill.

   Everything is merged into six materials, so the whole of
   Hobbiton costs about a dozen draw calls.
   ============================================================ */

import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, makeRng, hash2, PALETTE
} from './constants.js';
import { landAt, heightAt, riverAt } from './noise.js';
import { renderTexture, plankTexture, windowGlowTexture, drystoneTexture, leafClusterTexture } from './textures.js';

const TAU_ = TAU;

/* ------------------------------------------------------------
   Small geometry kit
   ------------------------------------------------------------ */
class Builder {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  get n0() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, c) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.u.push(u, v);
    this.c.push(c.r, c.g, c.b);
    return this.n0 - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  /** Append a built BufferGeometry, transformed. */
  mergeGeo(geo, m) {
    const base = this.n0;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const p = geo.attributes.position.array;
    const n = geo.attributes.normal.array;
    const u = geo.attributes.uv.array;
    const c = geo.attributes.color ? geo.attributes.color.array : null;
    const n3 = p.length / 3;
    for (let k = 0; k < n3; k++) {
      v.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
      v.set(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]).applyMatrix3(nm).normalize();
      this.n.push(v.x, v.y, v.z);
      this.u.push(u[k * 2], u[k * 2 + 1]);
      if (c) this.c.push(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]);
      else this.c.push(1, 1, 1);
    }
    const gi = geo.index.array;
    for (let k = 0; k < gi.length; k++) this.i.push(base + gi[k]);
    geo.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    if (!g.boundingSphere) g.computeBoundingSphere();
    return g;
  }
}

/* A box, with per-face UVs scaled to metres. */
function box(b, cx, cy, cz, hx, hy, hz, m, colour, uvScale = 0.5) {
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] }
  ];
  for (const f of faces) {
    const idx = [];
    for (let k = 0; k < 4; k++) {
      const q = f.v[k];
      const x = cx + q[0] * hx, y = cy + q[1] * hy, z = cz + q[2] * hz;
      const uv = k === 0 || k === 3 ? [0, 0] : k === 1 ? [2 * hx, 0] : [2 * hx, 2 * hy];
      idx.push(b.vert(x, y, z, f.n[0], f.n[1], f.n[2], uv[0] * uvScale, uv[1] * uvScale, colour));
    }
    b.quad(idx[0], idx[1], idx[2], idx[3]);
  }
  void m;
}

/* A cylinder along +Y. */
function cyl(b, cx, cy, cz, r0, r1, h, seg, m, colour, capTop = true, uRep = 1) {
  const ring = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * TAU_;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nx = ca, nz = sa;
    ring.push([
      b.vert(cx + ca * r0, cy, cz + sa * r0, nx, 0, nz, (j / seg) * uRep, 0, colour),
      b.vert(cx + ca * r1, cy + h, cz + sa * r1, nx, 0, nz, (j / seg) * uRep, h * 0.5, colour)
    ]);
  }
  for (let j = 0; j < seg; j++) b.quad(ring[j][0], ring[j][1], ring[j + 1][1], ring[j + 1][0]);
  if (capTop && r1 > 0.001) {
    const c0 = b.vert(cx, cy + h, cz, 0, 1, 0, 0.5, 0.5, colour);
    const top = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU_;
      top.push(b.vert(cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1, 0, 1, 0,
        0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, colour));
    }
    for (let j = 0; j < seg; j++) b.tri(c0, top[j], top[j + 1]);
  }
  void m;
}

/* A disc facing +Z (for doors), or +Y if you like. */
function disc(b, cx, cy, cz, r, seg, nx, ny, nz, colour, flip = false) {
  const cen = b.vert(cx, cy, cz, nx, ny, nz, 0.5, 0.5, colour);
  const ring = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * TAU_;
    const ca = Math.cos(a), sa = Math.sin(a);
    ring.push(b.vert(cx + ca * r, cy + sa * r, cz, nx, ny, nz,
      0.5 + ca * 0.5, 0.5 + sa * 0.5, colour));
  }
  for (let j = 0; j < seg; j++) {
    if (flip) b.tri(cen, ring[j + 1], ring[j]);
    else b.tri(cen, ring[j], ring[j + 1]);
  }
  return ring;
}

/* A torus ring lying in a plane. */
function ring(b, cx, cy, cz, R, r, segU, segV, colour, axis = 'z') {
  const grid = [];
  for (let i = 0; i <= segU; i++) {
    const a = (i / segU) * TAU_;
    const ca = Math.cos(a), sa = Math.sin(a);
    const row = [];
    for (let j = 0; j <= segV; j++) {
      const t = (j / segV) * TAU_;
      const ct = Math.cos(t), st = Math.sin(t);
      const rr = R + ct * r;
      const ox = ca * rr, oy = sa * rr, oz = st * r;
      let px, py, pz, nx, ny, nz;
      if (axis === 'z') {
        px = cx + ox; py = cy + oy; pz = cz + oz;
        nx = ca * ct; ny = sa * ct; nz = st;
      } else if (axis === 'y') {
        px = cx + ox; py = cy + oz; pz = cz + oy;
        nx = ca * ct; ny = st; nz = sa * ct;
      } else {
        px = cx + oz; py = cy + oy; pz = cz + ox;
        nx = st; ny = sa * ct; nz = ca * ct;
      }
      row.push(b.vert(px, py, pz, nx, ny, nz, i / segU, j / segV, colour));
    }
    grid.push(row);
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) b.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
  }
}

/* ------------------------------------------------------------
   Materials — six for the whole county.
   ------------------------------------------------------------ */
function makeMaterials(terrain) {
  const plaster = renderTexture('#e9e2d4', 5);
  plaster.repeat.set(1, 1);
  const mWall = new THREE.MeshStandardMaterial({
    map: plaster, color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true
  });
  const mWood = new THREE.MeshStandardMaterial({
    map: plankTexture('#8a6a3e'), color: 0xffffff, roughness: 0.82, metalness: 0, vertexColors: true
  });
  const mPaint = new THREE.MeshStandardMaterial({
    map: plankTexture('#ffffff', true), color: 0xffffff, roughness: 0.5, metalness: 0, vertexColors: true
  });
  const mStone = new THREE.MeshStandardMaterial({
    map: drystoneTexture(), color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true
  });
  const mBrass = new THREE.MeshStandardMaterial({
    color: 0xd9b14a, roughness: 0.28, metalness: 0.92, vertexColors: true
  });
  const mGlow = new THREE.MeshBasicMaterial({
    map: windowGlowTexture(), color: 0xffffff, toneMapped: false, side: THREE.DoubleSide
  });
  const mMound = terrain ? terrain.splatMaterial({ ao: false, bank: true, name: 'shire-mound' }) : null;
  return { mWall, mWood, mPaint, mStone, mBrass, mGlow, mMound };
}

/* ------------------------------------------------------------
   One hobbit hole.
   ------------------------------------------------------------ */
function buildHole(h, field, out, rng) {
  const g = new THREE.Group();
  const w = h.w, d = h.d, wallH = h.wallH;
  const isGrand = h.kind === 'grand';
  const isInn = h.kind === 'inn';
  const isMill = h.kind === 'mill';
  const isSemi = h.kind === 'semi';
  const isCottage = h.kind === 'cottage';

  /* --- local frame: +Z is out of the door, -Z is into the hill */
  const M = new THREE.Matrix4()
    .makeRotationY(h.rot)
    .setPosition(h.x, 0, h.z);
  const put = (b) => { out.wall.mergeGeo(b.build(), M); };

  const wallCol = new THREE.Color(h.wallHex);
  const trimCol = new THREE.Color(0xf1e6c8);
  const timberCol = new THREE.Color(0x8a6537);
  const darkTimber = new THREE.Color(0x60452a);

  /* ============================================================
     1. The mound: a turf hill, matched to the terrain material
        so the grass carries straight over the roof.
     ============================================================ */

  /* ============================================================
     2. The facade: a gently curved wall with a heavy brow.
     ============================================================ */
  // The door is the size of a hobbit, which is the whole point of it:
  // two metres of green paint you can walk through. Bag End's is a
  // little grander, and the films' round doors are round enough to
  // need a lintel over them.
  const doorR = isGrand ? 0.92 : 0.78;
  const doorY = doorR + 0.06;
  const wallR = w * 1.15;
  const halfA = Math.asin(clamp((w * 0.5) / wallR, -0.99, 0.99));
  // The eaves line: the height of the facade above the garden at the
  // door. Everything on the front of the house is measured from here.
  const eavesY = field.height(h.x, h.z) + wallH;

  const arcPoint = (a, y) => [
    Math.sin(a) * wallR,
    y,
    Math.cos(a) * wallR - wallR
  ];

  {
    const b = new Builder();
    const N = Math.max(10, Math.round(w * 1.6));
    const rows = [];
    // Where the turf is, a little behind the wall. The facade is the
    // face the bank is held back by, so its top follows the turf line
    // along the arc: high where the bank stands over the house, low
    // at the ends where the bank has run out. A single level eaves
    // line is what makes a facade read as a wall stood on a hill
    // rather than a hole dug into it.
    const wAt = (lx, lz) => field.height(
      h.x + Math.cos(h.rot) * lx + Math.sin(h.rot) * lz,
      h.z - Math.sin(h.rot) * lx + Math.cos(h.rot) * lz);
    // Work out the whole eaves line first and smooth it: the height
    // field is a couple of metres per sample, and a wall that steps
    // with the grid reads as a staircase, not as a curve.
    const top = [], ground = [];
    for (let i = 0; i <= N; i++) {
      const a = -halfA + (i / N) * halfA * 2;
      const lx = Math.sin(a) * wallR;
      const lz = Math.cos(a) * wallR - wallR;
      const g0 = wAt(lx, lz);
      ground.push(g0);
      // Enough wall to stand the door in: the leaf, a lintel over it,
      // and a little to spare -- then follow the turf above that, so
      // the facade is a face the bank is held back by and not a wall
      // stood on a hill.
      const head = doorR * 2 + 0.85;
      top.push(Math.min(
        Math.max(wAt(lx, lz - 1.7) + 0.5, g0 + head),
        g0 + wallH * 1.9));
    }
    const smooth = top.slice();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < N; i++) {
        smooth[i] = (smooth[i - 1] + smooth[i] * 2 + smooth[i + 1]) * 0.25;
      }
      smooth[0] = top[0]; smooth[N] = top[N];
    }
    for (let i = 0; i <= N; i++) {
      const a = -halfA + (i / N) * halfA * 2;
      const g0 = ground[i];
      const yTop = smooth[i];
      const base = Math.min(g0, yTop) - 1.1;
      const row = [];
      // The arc's outward normal, in the wall's own frame: straight
      // out of the door at a = 0, round to +X at a = 90 degrees. This
      // is stored LOCAL — the whole hole is rotated into place later —
      // and putting the already-rotated vector here lights every
      // facade from the inside.
      const lnx = Math.sin(a), lnz = Math.cos(a);
      const u = (i / N) * w * 0.42;
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        // slight batter: the wall leans back a touch as it rises
        const inset = t * t * 0.16;
        const y = lerp(base, yTop, t);
        row.push([
          Math.sin(a) * (wallR - inset), y, Math.cos(a) * (wallR - inset) - wallR,
          lnx, 0, lnz, u, t * (yTop - base) * 0.42, wallCol
        ]);
      }
      rows.push(row);
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) {
        const a = rows[i][k], b2 = rows[i + 1][k], c = rows[i][k + 1], d2 = rows[i + 1][k + 1];
        b.quad(
          b.vert(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]),
          b.vert(b2[0], b2[1], b2[2], b2[3], b2[4], b2[5], b2[6], b2[7], b2[8]),
          b.vert(d2[0], d2[1], d2[2], d2[3], d2[4], d2[5], d2[6], d2[7], d2[8]),
          b.vert(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8])
        );
      }
    }
    // a stone plinth along the base, with a matching radial normal
    for (let i = 0; i < N; i++) {
      const aA = -halfA + (i / N) * halfA * 2;
      const aB = -halfA + ((i + 1) / N) * halfA * 2;
      const A = [Math.sin(aA) * wallR, 0, Math.cos(aA) * wallR - wallR];
      const B = [Math.sin(aB) * wallR, 0, Math.cos(aB) * wallR - wallR];
      const gA = field.height(
        h.x + Math.cos(h.rot) * A[0] + Math.sin(h.rot) * A[2],
        h.z - Math.sin(h.rot) * A[0] + Math.cos(h.rot) * A[2]);
      const gB = field.height(
        h.x + Math.cos(h.rot) * B[0] + Math.sin(h.rot) * B[2],
        h.z - Math.sin(h.rot) * B[0] + Math.cos(h.rot) * B[2]);
      const th = 0.34, o = 0.05;
      const sc = new THREE.Color(0xc0b6a2);
      const mk = (P, g, y) => [
        P[0] - Math.sin(aA) * 0, y, P[2] - Math.cos(0) * 0
      ];
      void mk;
      const nA = [Math.sin(aA), 0, Math.cos(aA)];
      const nB = [Math.sin(aB), 0, Math.cos(aB)];
      const pa = [A[0] - nA[2] * o, gA - 0.5, A[2] + nA[0] * o];
      const pb = [B[0] - nB[2] * o, gB - 0.5, B[2] + nB[0] * o];
      const pc = [B[0] - nB[2] * o * 1.4, gB + th, B[2] + nB[0] * o * 1.4];
      const pd = [A[0] - nA[2] * o * 1.4, gA + th, A[2] + nA[0] * o * 1.4];
      const q = [
        b.vert(pa[0], pa[1], pa[2], nA[0], 0, nA[2], 0, 0, sc),
        b.vert(pb[0], pb[1], pb[2], nB[0], 0, nB[2], 1, 0, sc),
        b.vert(pc[0], pc[1], pc[2], nB[0], 0, nB[2], 1, 1, sc),
        b.vert(pd[0], pd[1], pd[2], nA[0], 0, nA[2], 0, 1, sc)
      ];
      b.quad(q[0], q[1], q[2], q[3]);
    }
    put(b);
  }

  /* ============================================================
     3. The door: round, painted, with a brass knocker dead centre
     ============================================================ */
  const doorA = h.doorU * w * 0.5;
  const doorLocal = arcPoint(doorA / wallR, 0);
  const doorWorldX = h.x + Math.cos(h.rot) * doorLocal[0] + Math.sin(h.rot) * doorLocal[2];
  const doorWorldZ = h.z - Math.sin(h.rot) * doorLocal[0] + Math.cos(h.rot) * doorLocal[2];
  const doorGround = field.height(doorWorldX, doorWorldZ);
  const doorOpen = isGrand || isInn || h.id === 'mill';
  const inner = doorR * 0.94;

  // door leaf, kept separate so it can swing on its hinge
  const doorPivot = new THREE.Group();
  const holder = new THREE.Group();
  {
    const b = new Builder();
    const col = new THREE.Color(h.doorCol);
    const R = doorR;
    const th = 0.075;
    // slab
    const c0 = b.vert(0, 0, 0, 0, 0, 1, 0.5, 0.5, col);
    const rim = [];
    for (let j = 0; j <= 22; j++) {
      const a = (j / 22) * TAU_;
      rim.push(b.vert(Math.cos(a) * R, Math.sin(a) * R, 0, 0, 0, 1,
        0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, col));
    }
    for (let j = 0; j < 22; j++) b.tri(c0, rim[j], rim[j + 1]);
    // the edge of the slab, so it has thickness when it opens
    for (let j = 0; j < 22; j++) {
      const a = (j / 22) * TAU_, a2 = ((j + 1) / 22) * TAU_;
      const p = [
        [Math.cos(a) * R, Math.sin(a) * R, 0],
        [Math.cos(a2) * R, Math.sin(a2) * R, 0],
        [Math.cos(a2) * R, Math.sin(a2) * R, -th],
        [Math.cos(a) * R, Math.sin(a) * R, -th]
      ];
      const nx = Math.cos((a + a2) / 2), ny = Math.sin((a + a2) / 2);
      const q = p.map((q2, k) => b.vert(q2[0], q2[1], q2[2], nx, ny, 0,
        (k === 1 || k === 2) ? 1 : 0, k > 1 ? 1 : 0, col));
      b.quad(q[0], q[1], q[2], q[3]);
    }
    // the knocker: a ring on a boss, dead in the middle, as it is on screen
    const brass = new THREE.Color(0xd9b14a);
    const brassDark = new THREE.Color(0x8c6c26);
    ring(b, 0, 0, 0.055, 0.088, 0.018, 12, 6, brass, 'z');
    disc(b, 0, 0, 0.026, 0.042, 10, 0, 0, 1, brassDark);
    // hinges on the left
    for (const sy of [0.44, -0.44]) {
      box(b, -R * 0.93, sy * R, 0.014, 0.05, 0.022, 0.016, null, brassDark, 4);
    }
    const mesh = new THREE.Mesh(b.build(), out.mats.mPaint);
    mesh.position.set(R, 0, 0.015);
    mesh.castShadow = false;
    doorPivot.add(mesh);
    holder.add(doorPivot);
  }
  {
    // stand it on the wall, hinged on its left edge
    const a = doorA / wallR;
    const p = arcPoint(a, 0);
    const phi = h.rot + a;
    const tx = Math.cos(phi), tz = -Math.sin(phi);   // the tangent, i.e. +X in local
    const cx = h.x + Math.cos(h.rot) * p[0] + Math.sin(h.rot) * p[2];
    const cz = h.z - Math.sin(h.rot) * p[0] + Math.cos(h.rot) * p[2];
    holder.position.set(cx - tx * doorR, doorGround + doorY, cz - tz * doorR);
    holder.rotation.y = phi;
    g.add(holder);
    out.doors.push({
      id: h.id, pivot: doorPivot, x: cx, z: cz, open: 0, canOpen: doorOpen, r: doorR
    });
  }

  /* the frame and the warm recess behind an openable door */
  {
    const b = new Builder();
    const a = doorA / wallR;
    const p = arcPoint(a, 0);
    const jc = new THREE.Color(0x8a6537);
    const lw = new THREE.Color(h.doorCol).multiplyScalar(0.55);
    // a stone surround, just proud of the wall
    ring(b, p[0], doorY, p[2] + 0.06, doorR + 0.10, 0.10, 20, 6, jc, 'z');
    // a dark reveal so the doorway reads as a hole even when shut
    disc(b, p[0], doorY, p[2] + 0.015, inner, 20, 0, 0, 1, new THREE.Color(0x120d08));
    // lintel beam
    box(b, p[0], doorY + doorR + 0.19, p[2] + 0.10, doorR + 0.24, 0.075, 0.075, null, jc, 1.6);
    // The brow: a heavy timber hood curved over the top of the door,
    // which is the thing you actually remember about Bag End from a
    // hundred yards away. It has to clear the leaf -- arc it over the
    // top of the doorway, not through the middle of it.
    {
      const brow = new THREE.Color(0x4e3a24);
      const browLit = new THREE.Color(0x6d5233);
      const segs = 11, r = doorR + 0.30;
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI, t1 = ((i + 1) / segs) * Math.PI;
        const a0 = Math.cos(t0) * r, y0 = doorGround + doorY + Math.sin(t0) * (doorR + 0.20);
        const a1 = Math.cos(t1) * r, y1 = doorGround + doorY + Math.sin(t1) * (doorR + 0.20);
        const mx = (a0 + a1) / 2, my = (y0 + y1) / 2;
        const len = Math.hypot(a1 - a0, y1 - y0) * 1.14;
        const ang = Math.atan2(y1 - y0, a1 - a0);
        const m = new THREE.Matrix4()
          .makeRotationZ(ang)
          .multiply(new THREE.Matrix4().makeTranslation(p[0] + mx, my, p[2] + 0.19));
        const sb = new Builder();
        box(sb, 0, 0, 0, len, 0.20, 0.40, null, i % 2 ? brow : browLit, 2);
        b.mergeGeo(sb.build(), m);
      }
    }
    // a step
    const g0 = doorGround;
    box(b, p[0] - Math.sin(a) * 0, g0 + 0.07, p[2] + 0.42, doorR + 0.3, 0.075, 0.42, null, new THREE.Color(0xc2b8a4), 1.2);
    box(b, p[0], g0 - 0.02, p[2] + 0.86, doorR + 0.42, 0.06, 0.4, null, new THREE.Color(0xc2b8a4), 1.2);
    // door-side jamb posts
    for (const s of [-1, 1]) {
      box(b, p[0] + s * (doorR + 0.14) * Math.cos(a), doorGround + doorY * 0.5 + 0.2,
        p[2] - s * (doorR + 0.14) * Math.sin(a) + 0.07, 0.075, doorY * 0.55, 0.09, null, jc, 1.6);
    }
    void lw;
    put(b);
  }

  /* the interior: a shallow warm round room, only for the doors
     that actually open */
  if (doorOpen) {
    const b = new Builder();
    const a = doorA / wallR;
    const p = arcPoint(a, 0);
    const warm = new THREE.Color(1.0, 0.72, 0.38);
    const wallIn = new THREE.Color(0xd0a86c);
    const depth = 1.7;
    // a barrel-vaulted room: half cylinder + back disc
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * Math.PI, a2 = ((i + 1) / N) * Math.PI;
      const x1 = Math.cos(a1) * inner, y1 = Math.sin(a1) * inner;
      const x2 = Math.cos(a2) * inner, y2 = Math.sin(a2) * inner;
      const q = [
        [p[0] + x1, doorGround + doorY + y1, p[2] - depth],
        [p[0] + x2, doorGround + doorY + y2, p[2] - depth],
        [p[0] + x2, doorGround + doorY + y2, p[2] - 0.02],
        [p[0] + x1, doorGround + doorY + y1, p[2] - 0.02]
      ];
      const nx = -Math.cos((a1 + a2) / 2), ny = -Math.sin((a1 + a2) / 2);
      const idx = q.map((qq, k) => b.vert(qq[0], qq[1], qq[2], nx, ny, 0, k === 1 || k === 2 ? 1 : 0, k > 1 ? 1 : 0, wallIn));
      b.quad(idx[0], idx[3], idx[2], idx[1]);
    }
    disc(b, p[0], doorGround + doorY, p[2] - depth, inner, 16, 0, 0, 1, warm);
    // floor
    disc(b, p[0], doorGround + 0.02, p[2] - depth * 0.5, inner * 1.02, 16, 0, 1, 0, new THREE.Color(0x8a6537));
    put(b);
    out.interiorGlow.push({
      x: h.x + Math.cos(h.rot) * p[0] + Math.sin(h.rot) * (p[2] - depth * 0.5),
      y: doorGround + doorY,
      z: h.z - Math.sin(h.rot) * p[0] + Math.cos(h.rot) * (p[2] - depth * 0.5),
      id: h.id
    });
  }

  /* ============================================================
     4. Porthole windows, warm and round, with mullions.
     ============================================================ */
  {
    const winB = new Builder();
    const frameCol = new THREE.Color(h.doorCol).multiplyScalar(0.6);
    const glassCol = new THREE.Color(0xffffff);
    const R = isGrand ? 0.44 : 0.38;
    const nWin = h.windows;
    for (let k = 0; k < nWin; k++) {
      const u = nWin === 1 ? 0 : (k / (nWin - 1)) * 2 - 1;
      let a = (u * 0.78 + h.doorU) * w * 0.5 / wallR;
      // never put a window on top of the door
      if (Math.abs(u * 0.78 * w * 0.5) < doorR + 1.1 && k < nWin) {
        a = ((h.doorU + (u < h.doorU ? -1 : 1) * (doorR + 1.5) / (w * 0.5)) * w * 0.5) / wallR;
      }
      const p = arcPoint(a, 0);
      // Kept inside the eaves: a porthole that floats above the wall
      // with turf showing under it is the give-away that the facade
      // and the bank were drawn without reference to each other.
      const yy = doorGround + wallH * (0.56 + (k % 2) * 0.17);
      // stone ring
      ring(winB, p[0], yy, p[2] - 0.012, R + 0.085, 0.075, 16, 5, frameCol, 'z');
      // a sill
      box(winB, p[0], yy - R - 0.11, p[2] + 0.05, R + 0.2, 0.05, 0.12, null, frameCol, 2);
      // the glass — a separate mesh, drawn unlit and bright
      const gb = new Builder();
      disc(gb, p[0], yy, p[2] - 0.05, R, 18, 0, 0, 1, glassCol);
      const gg = gb.build();
      const gm = new THREE.Mesh(gg, out.mats.mGlow);
      const m = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z);
      gg.applyMatrix4(m);
      gm.matrixAutoUpdate = false;
      gm.updateMatrix();
      out.glowGeo.push(gg);
      // mullions, in the films' cross
      const mb = new Builder();
      const mc = new THREE.Color(0x3a2a18);
      box(mb, p[0], yy, p[2] - 0.035, 0.022, R, 0.022, null, mc, 8);
      box(mb, p[0], yy, p[2] - 0.035, R, 0.022, 0.022, null, mc, 8);
      put(mb);
      // a flower box under the window
      if (rng() < 0.62) {
        const fb = new Builder();
        box(fb, p[0], yy - R - 0.22, p[2] + 0.14, R * 0.9, 0.11, 0.1, null, new THREE.Color(0x9a7346), 3);
        put(fb);
        out.flowers.push({
          x: h.x + Math.cos(h.rot) * p[0] + Math.sin(h.rot) * (p[2] + 0.14),
          y: yy - R - 0.11, z: h.z - Math.sin(h.rot) * p[0] + Math.cos(h.rot) * (p[2] + 0.14),
          w: R * 1.8, rot: h.rot, seed: (h.seed | 0) + k
        });
      }
    }
    // a couple of extra round windows in the mound, like Bag End has
    if (isGrand || isInn) {
      for (let k = 0; k < 2; k++) {
        const s = -1 + k * 2;
        const z = -d * (0.42 + k * 0.2);
        const p = [s * w * 0.34, 0, z];
        const m2 = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z);
        const v = new THREE.Vector3(p[0], 0, p[2]).applyMatrix4(m2);
        const gy = field.height(v.x, v.z) + 1.5;
        const gb = new Builder();
        disc(gb, v.x, gy, v.z, 0.38, 16, 0, 0, 1, new THREE.Color(0xffffff));
        out.glowGeo.push(gb.build());
        const rb = new Builder();
        ring(rb, v.x, gy, v.z, 0.46, 0.075, 14, 5, new THREE.Color(0x3a2a18), 'z');
        const m3 = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z);
        out.stone.mergeGeo(rb.build(), new THREE.Matrix4());
        void m3;
      }
    }
    put(winB);
  }

  /* ============================================================
     5. The chimney.
     ============================================================ */
  {
    const b = new Builder();
    const zc = -d * (isGrand ? 0.72 : 0.5);
    const m2 = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z);
    const v = new THREE.Vector3(w * (rng() - 0.5) * 0.4, 0, zc).applyMatrix4(m2);
    const g0 = field.height(v.x, v.z);
    const rr = isGrand ? 0.44 : 0.3;
    // The house is under the turf; all that should show is the top of
    // the stack, the way it does over the roof of Bag End.
    const top = g0 + (isGrand ? 2.4 : 1.8);
    const col = new THREE.Color(0xb08a72);
    cyl(b, v.x, g0 - 1.2, v.z, rr * 1.15, rr, top - g0 + 1.2, 9, null, col, true, 2);
    // a corbelled cap
    cyl(b, v.x, top, v.z, rr * 1.32, rr * 1.32, 0.12, 9, null, new THREE.Color(0x9c7a68), true, 2);
    cyl(b, v.x, top + 0.12, v.z, rr * 0.82, rr * 0.82, 0.14, 9, null, new THREE.Color(0x4b3d30), true, 2);
    out.chimneys.push({ x: v.x, y: top + 0.3, z: v.z, s: isGrand ? 1.5 : 1 });
  }

  /* ============================================================
     6. Garden: a low wall, a gate, a path, a vegetable plot.
     ============================================================ */
  {
    const b = new Builder();
    const gd = h.gardenDepth;
    const m2 = new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z);
    const local = (x, z) => {
      const v = new THREE.Vector3(x, 0, z).applyMatrix4(m2);
      return v;
    };
    const stoneCol = new THREE.Color(0xc2b8a4);
    // garden wall, in three short runs with a gap for the gate
    const segs = [[-1, -0.42], [0.42, 1]];
    for (const [a0, a1] of segs) {
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t0 = lerp(a0, a1, i / steps), t1 = lerp(a0, a1, (i + 1) / steps);
        const p0 = local(t0 * w * 0.62, gd), p1 = local(t1 * w * 0.62, gd);
        const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) / 2;
        const ang = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        box(b, cx, field.height(cx, cz) + 0.22, cz, 0.16, 0.34, len, null, stoneCol, 1.4);
        void ang;
      }
    }
    // side walls
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = gd * (0.24 + i * 0.3);
        const p0 = local(s * w * 0.62, z), p1 = local(s * w * 0.62, z + gd * 0.3);
        const cx = (p0.x + p1.x) / 2, cz = (p0.z + p1.z) / 2;
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) / 2;
        box(b, cx, field.height(cx, cz) + 0.22, cz, 0.16, 0.34, len, null, stoneCol, 1.4);
      }
    }
    // gate posts
    for (const s of [-1, 1]) {
      const p0 = local(s * 0.42 * w * 0.62, gd);
      box(b, p0.x, field.height(p0.x, p0.z) + 0.42, p0.z, 0.1, 0.5, 0.1, null, timberCol, 3);
    }
    // a picket gate, slightly ajar
    const p0 = local(-0.42 * w * 0.62, gd), p1 = local(0.42 * w * 0.62, gd);
    const gateW = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const gm = new THREE.Matrix4()
      .makeRotationY(Math.atan2(p1.x - p0.x, p1.z - p0.z) + 0.55)
      .setPosition(p0.x, field.height(p0.x, p0.z) + 0.3, p0.z);
    const gb = new Builder();
    const gc = new THREE.Color(0xa87f45);
    for (let i = 0; i <= 5; i++) {
      const x = (i / 5) * gateW * 0.94;
      box(gb, x, 0.14, 0, 0.035, 0.34, 0.03, null, gc, 4);
    }
    box(gb, gateW * 0.47, 0.3, 0, gateW * 0.47, 0.035, 0.025, null, gc, 4);
    box(gb, gateW * 0.47, 0.1, 0, gateW * 0.47, 0.035, 0.025, null, gc, 4);
    out.wood.mergeGeo(gb.build(), gm);
    // a soil bed, planted
    const bed0 = local(-w * 0.34, gd * 0.52), bed1 = local(w * 0.34, gd * 0.9);
    const bcx = (bed0.x + bed1.x) / 2, bcz = (bed0.z + bed1.z) / 2;
    out.soil.push({ x: bcx, z: bcz, w: w * 0.36, d: gd * 0.2, rot: h.rot });
    // The garden is laid out through `local()`, which already puts it
    // in world coordinates, and every wall in it has to ask the field
    // for its ground. Merging it with the hole's own matrix as well
    // turns each garden round a second time and throws it a hundred
    // metres across the county, hanging in the air.
    out.wall.mergeGeo(b.build(), new THREE.Matrix4());
  }

  /* ============================================================
     7. Climbing roses over the facade — the films' homes are
        always tangled with something.
     ============================================================ */
  {
    const b = new Builder();
    const N = Math.round(w * 0.42);
    for (let i = 0; i < N; i++) {
      const u = (rng() < 0.5 ? -1 : 1) * (0.42 + rng() * 0.5);
      const a = (u * w * 0.5) / wallR;
      const p = arcPoint(a, 0);
      const y = doorGround + 0.6 + rng() * (wallH - 0.7);
      const s = 0.34 + rng() * 0.34;
      const mm = new THREE.Matrix4()
        .makeRotationY(rng() * TAU_)
        .premultiply(new THREE.Matrix4().makeRotationZ(rng() * TAU))
        .setPosition(p[0] + (rng() - 0.5) * 0.2, y, p[2] + 0.16 + rng() * 0.1)
        .multiply(new THREE.Matrix4().makeScale(s, s, s));
      out.roseCards.push({ m: new THREE.Matrix4().makeRotationY(h.rot).setPosition(h.x, 0, h.z).multiply(mm), tint: rng() });
    }
    void b;
  }

  /* --- collider: you cannot walk into a hobbit hole ------------- */
  out.colliders.push({
    box: true, x: h.x, z: h.z, rot: h.rot,
    hw: w * 0.5 + 0.5, hd: d * 0.5 + 0.8, cx: 0, cz: -d * 0.25
  });
  void isSemi; void isCottage;
  return g;
}

/* A tiny deterministic fbm stand-in for the mound roughness. */
function fbmLike(x, y) {
  const s = Math.sin(x * 1.7) * Math.cos(y * 1.3) + Math.sin(x * 0.6 + 1.1) * Math.cos(y * 0.9 - 0.4);
  return s * 0.5;
}

/* ------------------------------------------------------------
   The mill's wheel — the one thing in the Shire that must turn.
   ------------------------------------------------------------ */
function buildMillWheel(out, field, mill) {
  const b = new Builder();
  const R = 2.7, W = 1.2, paddles = 16;
  const wood = new THREE.Color(0x8a6537);
  const dark = new THREE.Color(0x6a4c2c);
  // The wheel stands in the XY plane with its axle along Z, so the
  // rims are rings in that plane, the spokes turn about Z, and the
  // paddles are radial plates whose faces the Water pushes on.
  for (const z of [-W / 2, W / 2]) {
    ring(b, 0, 0, z, R, 0.1, 24, 6, wood, 'z');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const m = new THREE.Matrix4().makeRotationZ(a)
        .multiply(new THREE.Matrix4().makeTranslation(0, R * 0.5, 0));
      const sb = new Builder();
      box(sb, 0, 0, 0, 0.045, R * 0.5, 0.045, null, dark, 3);
      b.mergeGeo(sb.build(), new THREE.Matrix4().makeTranslation(0, 0, z).multiply(m));
    }
  }
  // axle
  {
    const sb = new Builder();
    cyl(sb, 0, -W * 0.5 - 0.5, 0, 0.12, 0.12, W + 1.0, 8, null, dark, true, 2);
    b.mergeGeo(sb.build(), new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  }
  // paddles
  for (let i = 0; i < paddles; i++) {
    const a = (i / paddles) * TAU;
    const m = new THREE.Matrix4().makeRotationZ(a)
      .multiply(new THREE.Matrix4().makeTranslation(0, R * 0.80, 0));
    const pb = new Builder();
    box(pb, 0, 0, 0, 0.09, 0.60, W / 2 + 0.02, null, wood, 2.0);
    b.mergeGeo(pb.build(), m);
  }
  const geo = b.build();
  const mesh = new THREE.Mesh(geo, out.mats.mWood);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const holder = new THREE.Group();
  // The wheel stands on the water side of the mill, and its axle sits
  // where the Water puts it -- a wheel hung off the height of the
  // ground ends up either buried in the channel or in the air, and
  // both look like a bug because both are one.
  const mv = mill || { x: -36, z: 48, rot: 0 };
  const r = { x: mv.x + Math.cos(mv.rot) * 7.4, z: mv.z - Math.sin(mv.rot) * 7.4 };
  const riv = riverAt(r.x, r.z);
  const y = (riv.d < 900 ? riv.level : field.height(r.x, r.z)) + 1.5;
  holder.position.set(r.x, y, r.z);
  holder.rotation.set(0, -mv.rot, 0);
  holder.add(mesh);
  out.group.add(holder);
  out.animated.push({ obj: holder, kind: 'wheel' });
  out.colliders.push({ x: r.x, z: r.z, r: 3.0, tall: true });
  // the mill race: a stone channel carrying water to the wheel
  const rb = new Builder();
  const stone = new THREE.Color(0xc0b6a2);
  box(rb, r.x, y - 1.6, r.z + 1.6, 2.2, 0.3, 3.2, null, stone, 1.1);
  for (const s of [-1, 1]) {
    box(rb, r.x + s * 2.2, y - 1.3, r.z + 1.6, 0.2, 0.4, 3.2, null, stone, 1.1);
  }
  out.mount.mergeGeo(rb.build(), new THREE.Matrix4());
  return { x: r.x, y, z: r.z };
}

/* ------------------------------------------------------------
   The Party Tree's lanterns.
   ------------------------------------------------------------ */
function buildLanterns(out, anchor, rng) {
  const b = new Builder();
  const c = new THREE.Color(0x3a2a18);
  const pts = [];
  const R = 3.2 * (anchor.s || 1);
  for (let i = 0; i < 46; i++) {
    const a = rng() * TAU;
    const rr = R * (0.5 + rng() * 0.75);
    const hgt = (anchor.y || 8) - 0.4 - rng() * 3.4;
    pts.push({ x: anchor.x + Math.cos(a) * rr, y: hgt, z: anchor.z + Math.sin(a) * rr, r: 0.11 });
  }
  for (const p of pts) {
    // the string
    box(b, p.x, p.y + 0.34, p.z, 0.012, 0.34, 0.012, null, c, 8);
    cyl(b, p.x, p.y - 0.1, p.z, 0.075, 0.055, 0.16, 6, null, new THREE.Color(0x4b3d30), false, 1);
  }
  out.wood.mergeGeo(b.build(), new THREE.Matrix4());
  // the lit part
  const gb = new Builder();
  for (const p of pts) {
    disc(gb, p.x, p.y, p.z, 0.055, 6, 0, 1, 0, new THREE.Color(1.0, 0.82, 0.5));
  }
  out.lanternGeo.push(gb.build());
  return pts;
}

/* ============================================================
   Assemble
   ============================================================ */
export class Buildings {
  constructor(field, plan, terrain, quality) {
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    this.colliders = [];
    this.chimneys = [];
    this.doors = [];
    this.interiorGlow = [];
    this.animated = [];
    this.lanternPositions = [];
    this.flowerSpots = [];
    this.glowMeshes = [];

    const mats = makeMaterials(terrain);
    this.mats = mats;

    const out = {
      wall: new Builder(), wood: new Builder(), paint: new Builder(),
      stone: new Builder(), brass: new Builder(), mound: new Builder(),
      mount: new Builder(), glowGeo: [], lanternGeo: [], doors: [],
      colliders: this.colliders, chimneys: this.chimneys,
      interiorGlow: this.interiorGlow, animated: this.animated,
      flowers: this.flowerSpots, soil: [], roseCards: [], mats, group: this.group
    };

    for (const h of plan.holes) {
      const rng = makeRng(h.seed || 7);
      buildHole(h, field, out, rng);
    }

    // merge and upload
    const add = (builder, material, cast, receive, name) => {
      if (!builder.p.length) return null;
      const geo = builder.build();
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    };
    add(out.wall, mats.mWall, true, true, 'facades');
    add(out.wood, mats.mWood, true, true, 'timber');
    add(out.stone, mats.mStone, true, true, 'stonework');
    add(out.mount, mats.mStone, true, true, 'stonework-2');
    if (false) {
      // the fringe at the foot of the bank sits just under the door sill
      const lowest = out.mound.p.reduce((m, y) => Math.min(m, y), Infinity);
      mats.mMound.userData.shader?.uniforms.uBankBase &&
        (mats.mMound.userData.shader.uniforms.uBankBase.value = lowest);
      const mesh = add(out.mound, mats.mMound, true, true, 'mounds');
      if (mesh) mesh.name = 'mounds';
    }
    add(out.brass, mats.mBrass, false, false, 'brass');

    // the warm windows
    if (out.glowGeo.length) {
      const merged = mergeGeometries(out.glowGeo);
      const mesh = new THREE.Mesh(merged, mats.mGlow);
      mesh.name = 'window-light';
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.glowMeshes.push(mesh);
    }
    if (out.lanternGeo.length) {
      const merged = mergeGeometries(out.lanternGeo);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, vertexColors: true });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'lanterns';
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.lanternMesh = mesh;
      this.lanternMat = mat;
    }

    // doors, each its own group so it can swing
    this.doorHolders = out.doors;
    for (const d of out.doors) {
      if (d.pivot.parent) this.group.add(d.pivot.parent);
    }

    // the mill wheel
    const wheel = buildMillWheel(out, field,
      (plan.holes || []).find(h => h.kind === 'mill'));

    // roses: one instanced mesh of leaf cards over the facades
    if (out.roseCards.length) {
      const card = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshStandardMaterial({
        map: leafClusterTexture(['#4a6f30', '#385a24', '#628a3a']),
        alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85
      });
      const inst = new THREE.InstancedMesh(card, mat, out.roseCards.length);
      const col = new THREE.Color();
      for (let i = 0; i < out.roseCards.length; i++) {
        inst.setMatrixAt(i, out.roseCards[i].m);
        const v = 0.62 + out.roseCards[i].tint * 0.5;
        // the map is luminance only, so the green has to come from here
        col.setRGB(v * 0.44, v * 0.92, v * 0.40);
        inst.setColorAt(i, col);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.name = 'roses';
      this.group.add(inst);
    }

    // the lantern strings on the Party Tree
    if (plan.partyTree) {
      const y = field.height(plan.partyTree.x, plan.partyTree.z);
      this.lanternPositions = buildLanterns(out,
        { x: plan.partyTree.x, z: plan.partyTree.z, y: y + plan.partyTree.s * 5.2, s: plan.partyTree.s },
        makeRng(5150));
    }

    this.soilBeds = out.soil;
    this.wheel = wheel;
    this.quality = quality;
  }

  update(t, dt, nightAmount) {
    for (const a of this.animated) {
      if (a.kind === 'wheel') a.obj.rotation.x = t * 0.42;
    }
    // doors ease open
    for (const d of this.doorHolders) {
      if (d.target !== undefined && Math.abs(d.open - d.target) > 1e-4) {
        d.open += (d.target - d.open) * Math.min(1, dt * 3.4);
        d.pivot.rotation.y = -d.open * 1.9;
      }
    }
    if (this.lanternMat) {
      const k = 0.25 + nightAmount * 1.5;
      this.lanternMat.color.setRGB(k, k * 0.86, k * 0.62);
    }
  }

  knock(id) {
    const d = this.doorHolders.find(x => x.id === id);
    if (!d || !d.canOpen) return false;
    d.target = d.target > 0.5 ? 0 : 1;
    return true;
  }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) if (m && m.dispose) m.dispose();
  }
}

/* Merge an array of BufferGeometries that share the same layout. */
function mergeGeometries(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const uv = new Float32Array(vc * 2);
  const col = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = g.attributes.color;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (u) uv.set(u.array.subarray(0, u.count * 2), vo * 2);
    if (c) col.set(c.array.subarray(0, c.count * 3), vo * 3);
    else for (let i = 0; i < p.count; i++) { col[(vo + i) * 3] = 1; col[(vo + i) * 3 + 1] = 1; col[(vo + i) * 3 + 2] = 1; }
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += p.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export { mergeGeometries, Builder, heightAt, landAt, clamp, lerp, smoothstep, hash2, PALETTE };
