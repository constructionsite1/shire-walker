/* ============================================================
   props.js — everything a hobbit leaves lying about.

   Drystone walls and hedgerows round the Fields, the village
   well, lamp posts, benches, barrels, handcarts, hayricks,
   scarecrows, washing lines, beehives, the signpost on the
   Great West Road, and the stone bridge at Bywater.

   All merged, all instanced. A county's worth of clutter for
   about eight draw calls.
   ============================================================ */

import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, hash2, PALETTE } from './constants.js';
import { heightAt, riverAt, roadAt, fieldAt } from './noise.js';
import {
  plankTexture, drystoneTexture, soilTexture, flowerTexture,
  signTexture, paintTexture, glowTexture, leafClusterTexture, cropTexture
} from './textures.js';
import { mergeGeometries, Builder } from './buildings.js';

/* Local helper: a quad in the XZ plane, facing up, with a colour. */
function quadXZ(b, cx, cy, cz, w, d, rot, colour) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const idx = pts.map((p, k) => {
    const x = cx + p[0] * c - p[1] * s;
    const z = cz + p[0] * s + p[1] * c;
    return b.vert(x, cy, z, 0, 1, 0, (k === 1 || k === 2) ? 1 : 0, k > 1 ? 1 : 0, colour);
  });
  b.quad(idx[0], idx[1], idx[2], idx[3]);
}

function boxGeo(b, cx, cy, cz, hx, hy, hz, colour, uvScale = 0.6) {
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] }
  ];
  for (const f of faces) {
    const idx = f.v.map((q, k) => b.vert(
      cx + q[0] * hx, cy + q[1] * hy, cz + q[2] * hz,
      f.n[0], f.n[1], f.n[2],
      ((k === 1 || k === 2) ? 1 : 0) * 2 * hx * uvScale,
      (k > 1 ? 1 : 0) * 2 * hy * uvScale, colour));
    b.quad(idx[0], idx[1], idx[2], idx[3]);
  }
}

function cylGeo(b, cx, cy, cz, r0, r1, h, seg, colour, cap = true) {
  const lower = [], upper = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    lower.push(b.vert(cx + ca * r0, cy, cz + sa * r0, ca, 0, sa, j / seg, 0, colour));
    upper.push(b.vert(cx + ca * r1, cy + h, cz + sa * r1, ca, 0, sa, j / seg, h * 0.5, colour));
  }
  for (let j = 0; j < seg; j++) b.quad(lower[j], upper[j], upper[j + 1], lower[j + 1]);
  if (cap) {
    const c0 = b.vert(cx, cy + h, cz, 0, 1, 0, 0.5, 0.5, colour);
    const t = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * TAU;
      t.push(b.vert(cx + Math.cos(a) * r1, cy + h, cz + Math.sin(a) * r1, 0, 1, 0,
        0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5, colour));
    }
    for (let j = 0; j < seg; j++) b.tri(c0, t[j], t[j + 1]);
  }
}

export class Props {
  constructor(field, plan, quality) {
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.colliders = [];
    this.lampPositions = [];
    this.windmill = null;
    this.animated = [];
    const rng = makeRng(70707);

    const bWood = new Builder();
    const bStone = new Builder();
    const bHedge = new Builder();
    const bSoil = new Builder();
    const bMisc = new Builder();
    const bGlow = new Builder();
    const bGrassCard = new Builder();

    /* ============================================================
       Drystone walls and hedgerows
       ============================================================ */
    for (const w of plan.walls) {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      const n = Math.max(1, Math.round(len / 1.1));
      const ang = Math.atan2(w.bx - w.ax, w.bz - w.az);
      const nx = Math.cos(ang), nz = -Math.sin(ang);      // across the wall
      let prevRing = null;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = lerp(w.ax, w.bx, t), z = lerp(w.az, w.bz, t);
        if (w.gate && Math.abs(t - 0.5) < 0.09) { prevRing = null; continue; }
        const g0 = heightAt(x, z);
        if (w.kind === 'stone') {
          const hh = w.h * (0.86 + 0.28 * hash2(i, Math.round(x)));
          boxGeo(bStone, x, g0 + hh * 0.5, z, 0.36, hh * 0.5, (len / n) * 0.62,
            new THREE.Color(0xc2b8a4).multiplyScalar(0.86 + 0.3 * hash2(i * 3, i)), 1.1);
        } else {
          // A hedge: a solid green wall with a rounded top, extruded
          // along the boundary and capped at both ends. The heights
          // are hashed per station so it lumps like something that has
          // been clipped by hand for a hundred years.
          const hh = w.h * (0.74 + 0.44 * hash2(i * 5, i + 7));
          const r = 0.42 * (0.86 + 0.32 * hash2(i * 3, i));
          const lit = 0.84 + 0.34 * hash2(i * 7, i + 5);
          const dark = 0.62 + 0.2 * hash2(i * 13, i);
          const sec = [
            [-r, -0.3, new THREE.Color(0x4a6b2c).multiplyScalar(dark)],
            [-r * 0.55, hh, new THREE.Color(0x5c8338).multiplyScalar(lit)],
            [r * 0.55, hh, new THREE.Color(0x67903c).multiplyScalar(lit * 1.05)],
            [r, -0.3, new THREE.Color(0x4a6b2c).multiplyScalar(dark)]
          ];
          const ring = sec.map(([o, up, c], k) => bHedge.vert(
            x + nx * o, g0 + up, z + nz * o,
            nx * (k === 0 ? -0.9 : k === 3 ? 0.9 : 0),
            k === 1 || k === 2 ? 0.9 : -0.3,
            nz * (k === 0 ? -0.9 : k === 3 ? 0.9 : 0),
            0.5 + o * 0.5, up > 0 ? 1 : 0, c));
          if (prevRing) {
            for (let k = 0; k < 4; k++) {
              const k2 = (k + 1) % 4;
              bHedge.quad(prevRing[k], prevRing[k2], ring[k2], ring[k]);
            }
          } else {
            // cap the start of a run
            const c0 = bHedge.vert(x - nx * r, g0 + hh * 0.4, z - nz * r, -Math.cos(ang), 0, -Math.sin(ang), 0.5, 0.5,
              new THREE.Color(0x4c6d2e).multiplyScalar(0.9));
            for (let k = 0; k < 4; k++) bHedge.tri(c0, ring[(k + 1) % 4], ring[k]);
          }
          prevRing = ring;
          if (i === n - 2) {
            // cap the end
            const xe = lerp(w.ax, w.bx, (i + 1.5) / n), ze = lerp(w.az, w.bz, (i + 1.5) / n);
            const c1 = bHedge.vert(xe - nx * r, g0 + hh * 0.4, ze - nz * r, Math.cos(ang), 0, Math.sin(ang), 0.5, 0.5,
              new THREE.Color(0x4c6d2e).multiplyScalar(0.9));
            for (let k = 0; k < 4; k++) bHedge.tri(c1, prevRing[k], prevRing[(k + 1) % 4]);
          }
        }
      }
    }

    /* ============================================================
       The village well, on Hobbiton green
       ============================================================ */
    {
      const wx = 62, wz = 104;
      const gy = heightAt(wx, wz);
      const stone = new THREE.Color(0xc2b8a4);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const hh = 0.62;
        boxGeo(bStone, wx + Math.cos(a) * 1.05, gy + hh * 0.5, wz + Math.sin(a) * 1.05,
          0.2, hh * 0.5, 0.24, stone.clone().multiplyScalar(0.85 + 0.3 * hash2(i, 3)), 1.4);
      }
      // the dark of the well
      cylGeo(bMisc, wx, gy + 0.5, wz, 0.86, 0.86, 0.02, 14, new THREE.Color(0x0a0d0a), true);
      // a little roof on two posts
      for (const s of [-1, 1]) {
        boxGeo(bWood, wx + s * 0.95, gy + 1.5, wz, 0.07, 1.0, 0.07, new THREE.Color(0x9a7346), 3);
      }
      const rb = new Builder();
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(-1.3, 1.3, t);
        rb.vert(wx + x, gy + 2.5 + Math.cos(t * Math.PI) * 0.22, wz - 0.75, 0, 1, 0, t, 0, new THREE.Color(0x7a5c33));
        rb.vert(wx + x, gy + 2.5 + Math.cos(t * Math.PI) * 0.22, wz + 0.75, 0, 1, 0, t, 1, new THREE.Color(0x7a5c33));
      }
      for (let i = 0; i < 6; i++) {
        bWood.quad(rb.n0 - 14 + i * 2, rb.n0 - 14 + i * 2 + 1, rb.n0 - 12 + i * 2, rb.n0 - 12 + i * 2 + 1);
      }
      // the bucket on a rope
      cylGeo(bWood, wx, gy + 1.72, wz, 0.14, 0.16, 0.2, 8, new THREE.Color(0x9a7346), false);
      boxGeo(bMisc, wx, gy + 1.94, wz, 0.012, 0.2, 0.012, new THREE.Color(0x4b3d30), 8);
      this.colliders.push({ x: wx, z: wz, r: 1.35, tall: false });
      this.well = { x: wx, y: gy, z: wz };
    }

    /* ============================================================
       Lamp posts along the lanes — the Shire's only street lamps
       ============================================================ */
    {
      const spots = [];
      for (let t = 0; t < 1; t += 0.075) {
        const i = Math.min(17, Math.floor(t * 17));
        const f = t * 17 - i;
        const a = [[24, 112], [8, 96], [-8, 82], [-22, 70], [-32, 58]][Math.min(4, Math.floor(i / 4))];
        const b2 = [[24, 112], [8, 96], [-8, 82], [-22, 70], [-32, 58]][Math.min(4, Math.floor(i / 4) + 1)];
        if (!b2) break;
        const x = lerp(a[0], b2[0], f), z = lerp(a[1], b2[1], f);
        spots.push([x + 2.6, z + 2.0]);
      }
      for (const [x, z] of spots) {
        const gy = heightAt(x, z);
        cylGeo(bWood, x, gy, z, 0.1, 0.07, 2.5, 7, new THREE.Color(0x5d4a33), false);
        boxGeo(bWood, x, gy + 2.5, z, 0.05, 0.05, 0.05, new THREE.Color(0x5d4a33), 4);
        // a little glazed lantern
        boxGeo(bMisc, x, gy + 2.42, z, 0.11, 0.14, 0.11, new THREE.Color(0x55554c), 3);
        const t = bGlow.n0;
        bGlow.vert(x - 0.08, gy + 2.30, z - 0.08, 0, 0, 1, 0, 0, new THREE.Color(1, 0.85, 0.55));
        bGlow.vert(x + 0.08, gy + 2.30, z - 0.08, 0, 0, 1, 1, 0, new THREE.Color(1, 0.85, 0.55));
        bGlow.vert(x + 0.08, gy + 2.30, z + 0.08, 0, 0, 1, 1, 1, new THREE.Color(1, 0.85, 0.55));
        bGlow.vert(x - 0.08, gy + 2.30, z + 0.08, 0, 0, 1, 0, 1, new THREE.Color(1, 0.85, 0.55));
        bGlow.quad(t, t + 1, t + 2, t + 3);
        bGlow.quad(t + 3, t + 2, t + 1, t);
        this.lampPositions.push({ x, y: gy + 2.4, z });
        this.colliders.push({ x, z, r: 0.22, tall: false });
      }
    }

    /* ============================================================
       The signpost on the Great West Road
       ============================================================ */
    {
      const x = -104, z = 156;
      const gy = heightAt(x, z);
      cylGeo(bWood, x, gy, z, 0.11, 0.09, 2.2, 8, new THREE.Color(0x87673f), false);
      const arms = [
        { a: 0.5, label: 'BREE', sub: '4 miles' },
        { a: 0.5 + Math.PI, label: 'HOBBITON', sub: '2 miles' },
        { a: 0.5 + Math.PI * 0.5, label: 'THE WATER', sub: 'and the mill' }
      ];
      this.signboards = [];
      for (const arm of arms) {
        const len = 1.15;
        const cx = x + Math.cos(arm.a) * len * 0.5, cz = z + Math.sin(arm.a) * len * 0.5;
        const gg = new Builder();
        const b = gg.n0;
        gg.vert(-len / 2, -0.16, 0, 0, 0, 1, 0, 0, new THREE.Color(0xffffff));
        gg.vert(len / 2, -0.16, 0, 0, 0, 1, 1, 0, new THREE.Color(0xffffff));
        gg.vert(len / 2, 0.16, 0, 0, 0, 1, 1, 1, new THREE.Color(0xffffff));
        gg.vert(-len / 2, 0.16, 0, 0, 0, 1, 0, 1, new THREE.Color(0xffffff));
        gg.quad(b, b + 1, b + 2, b + 3);
        const mesh = new THREE.Mesh(gg.build(), new THREE.MeshStandardMaterial({
          map: signTexture(arm.label, arm.sub), roughness: 0.8, side: THREE.DoubleSide
        }));
        mesh.position.set(cx, gy + 1.85, cz);
        mesh.rotation.y = -arm.a + Math.PI / 2;
        this.group.add(mesh);
        this.signboards.push(mesh);
      }
      this.colliders.push({ x, z, r: 0.24, tall: false });
    }

    /* ============================================================
       The bridge at Bywater
       ============================================================ */
    {
      const br = plan.bridge;
      const stone = new THREE.Color(0xc2b8a4);
      const steps = 15;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const s = (t - 0.5) * 2;
        const x = br.x + Math.sin(br.rot) * s * br.w * 0.5 * 1.6;
        const z = br.z + Math.cos(br.rot) * s * br.w * 0.5 * 1.6;
        const along = (t - 0.5) * br.d;
        const bx = br.x + Math.sin(br.rot + Math.PI / 2) * along * 0.0 + Math.cos(br.rot + Math.PI / 2) * along;
        const bz = br.z + Math.sin(br.rot + Math.PI / 2) * along;
        void bx; void bz; void x; void z;
        const px = br.x + Math.cos(br.rot) * along, pz = br.z + Math.sin(br.rot) * along;
        const river = riverAt(px, pz);
        const deck = river.level + 1.15 + Math.cos(s * Math.PI * 0.5) * 0.32;
        const w = br.w * 0.5;
        const ang = br.rot + Math.PI / 2;
        const cx = px + Math.cos(ang) * 0, cz = pz + Math.sin(ang) * 0;
        // deck
        boxGeo(bStone, cx, deck, cz, Math.cos(ang) * w, 0.22, Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * w,
          stone.clone().multiplyScalar(0.92 + 0.16 * hash2(i, 2)), 1.1);
        // parapets
        for (const side of [-1, 1]) {
          const ox = Math.cos(ang) * side * w, oz = Math.sin(ang) * side * w;
          boxGeo(bStone, cx + ox, deck + 0.42, cz + oz, 0.16, 0.28, 0.42,
            stone.clone().multiplyScalar(0.86 + 0.2 * hash2(i, side)), 1.3);
        }
      }
      // the pier
      const riverMid = riverAt(br.x, br.z);
      for (const off of [-5, 5]) {
        const px = br.x + Math.cos(br.rot + Math.PI / 2) * off;
        const pz = br.z + Math.sin(br.rot + Math.PI / 2) * off;
        for (let k = 0; k < 4; k++) {
          boxGeo(bStone, px, riverMid.level - 1.2 + k * 0.7, pz, 2.4 - k * 0.14, 0.36, 0.5,
            stone.clone().multiplyScalar(0.8 + 0.2 * hash2(k, off)), 1);
        }
      }
    }

    /* ============================================================
       Yards, carts, barrels, benches, beehives, hayricks
       ============================================================ */
    const yardSpots = [
      { x: -96, z: 116, n: 9 },     // the Green Dragon's yard
      { x: -36, z: 48, n: 8 },      // the mill
      { x: 62, z: 104, n: 7 },      // Hobbiton green
      { x: 108, z: 26, n: 5 },      // Bywater
      { x: -34, z: 56, n: 4 }       // Bag End
    ];
    for (const spot of yardSpots) {
      for (let i = 0; i < spot.n; i++) {
        const a = rng() * TAU, rr = 3 + rng() * 8;
        const x = spot.x + Math.cos(a) * rr, z = spot.z + Math.sin(a) * rr;
        if (plan.inExclusion(x, z, -2.2)) continue;
        const gy = heightAt(x, z);
        const pick = rng();
        if (pick < 0.3) {
          // barrel
          const h = 0.85 + rng() * 0.2;
          cylGeo(bWood, x, gy, z, 0.3, 0.34, h, 10, new THREE.Color(0x9a7346), true);
          cylGeo(bWood, x, gy + h * 0.16, z, 0.345, 0.345, 0.06, 10, new THREE.Color(0x6c6c6c), false);
          cylGeo(bWood, x, gy + h * 0.72, z, 0.345, 0.345, 0.06, 10, new THREE.Color(0x6c6c6c), false);
          this.colliders.push({ x, z, r: 0.42, tall: false });
        } else if (pick < 0.55) {
          // a handcart: a bed, two wheels, and a pair of shafts
          const rot = rng() * TAU;
          const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, gy, z);
          const cb = new Builder();
          const wood = new THREE.Color(0x7a5a34);
          const dark = new THREE.Color(0x87673f);
          boxGeo(cb, 0, 0.62, 0, 0.62, 0.1, 0.95, wood, 1.2);
          for (const s of [-1, 1]) {
            boxGeo(cb, s * 0.6, 0.86, 0, 0.05, 0.28, 0.9, wood, 1.6);
            // the wheel: a rim disc with six spokes and a hub
            const wb = new Builder();
            cylGeo(wb, 0, -0.05, 0, 0.42, 0.42, 0.1, 12, dark, true);
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * TAU;
              const sb = new Builder();
              boxGeo(sb, 0, 0.19, 0, 0.03, 0.22, 0.035, new THREE.Color(0x9a7346), 3);
              wb.mergeGeo(sb.build(), new THREE.Matrix4().makeRotationX(-a));
            }
            cylGeo(wb, 0, -0.09, 0, 0.1, 0.1, 0.2, 8, new THREE.Color(0x6e5333), true);
            cb.mergeGeo(wb.build(), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(s * 0.68, 0.42, 0));
          }
          for (const s of [-1, 1]) {
            boxGeo(cb, s * 0.42, 0.55, 1.4, 0.045, 0.045, 0.65, wood, 2);
          }
          bWood.mergeGeo(cb.build(), M);
          this.colliders.push({ x, z, r: 0.9, tall: false });
        } else if (pick < 0.75) {
          // a bench
          const rot = rng() * TAU;
          const M = new THREE.Matrix4().makeRotationY(rot).setPosition(x, gy, z);
          const cb = new Builder();
          const wood = new THREE.Color(0xb28c54);
          boxGeo(cb, 0, 0.45, 0, 0.9, 0.06, 0.22, wood, 1.4);
          boxGeo(cb, 0, 0.72, -0.2, 0.9, 0.2, 0.05, wood, 1.4);
          for (const s of [-1, 1]) boxGeo(cb, s * 0.8, 0.22, 0, 0.07, 0.22, 0.2, new THREE.Color(0x6e5333), 2);
          bWood.mergeGeo(cb.build(), M);
        } else if (pick < 0.88) {
          // a beehive, or a stack of crates
          if (rng() < 0.5) {
            for (let k = 0; k < 3; k++) {
              cylGeo(bWood, x, gy + k * 0.34, z, 0.28, 0.3, 0.32, 10, new THREE.Color(0xdec189), true);
            }
            boxGeo(bWood, x, gy + 1.06, z, 0.34, 0.05, 0.34, new THREE.Color(0x9a7346), 2);
          } else {
            for (let k = 0; k < 3; k++) {
              boxGeo(bWood, x + (rng() - 0.5) * 0.2, gy + 0.22 + k * 0.44, z + (rng() - 0.5) * 0.2,
                0.32, 0.22, 0.26, new THREE.Color(0xb28c54), 2);
            }
          }
          this.colliders.push({ x, z, r: 0.4, tall: false });
        } else {
          // a log pile
          for (let k = 0; k < 7; k++) {
            const row = Math.floor(k / 3), col2 = k % 3;
            cylGeo(bWood, x + (col2 - 1) * 0.24, gy + row * 0.22, z, 0.12, 0.12, 1.2, 7,
              new THREE.Color(0x87673f), true);
          }
          this.colliders.push({ x, z, r: 0.7, tall: false });
        }
      }
    }

    /* ============================================================
       Hayricks and scarecrows in the Fields
       ============================================================ */
    {
      let placed = 0;
      for (let i = 0; i < 240 && placed < 22; i++) {
        const x = (rng() * 2 - 1) * 340 + 120;
        const z = (rng() * 2 - 1) * 340;
        if (fieldAt(x, z) < 0.4) continue;
        if (roadAt(x, z) < 12) continue;
        const gy = heightAt(x, z);
        if (rng() < 0.62) {
          // a hayrick: a cone on a cylinder
          const h = 2.0 + rng() * 0.8;
          const r = 1.3 + rng() * 0.5;
          cylGeo(bMisc, x, gy, z, r * 0.9, r, h * 0.62, 12, new THREE.Color(0xc7a75a), false);
          const cb = new Builder();
          const cap = new THREE.ConeGeometry(r * 1.08, h * 0.6, 12, 1);
          cap.translate(0, h * 0.92, 0);
          const pos = cap.attributes.position.array, nrm = cap.attributes.normal.array;
          const gi = cap.index ? cap.index.array : null;
          const gb = { p: Array.from(pos), n: Array.from(nrm), u: [], i: [] };
          for (let k = 0; k < pos.length; k += 3) gb.u.push(0.5 + pos[k] * 0.3, 0.5 + pos[k + 2] * 0.3);
          if (gi) for (const k of gi) gb.i.push(k); else for (let k = 0; k < pos.length / 3; k++) gb.i.push(k);
          cap.dispose();
          const cc = new THREE.Color(0xd8b96a);
          const tmp = new Builder();
          for (let k = 0; k < gb.p.length; k += 3) {
            tmp.vert(gb.p[k], gb.p[k + 1], gb.p[k + 2], gb.n[k], gb.n[k + 1], gb.n[k + 2],
              gb.u[(k / 3) * 2], gb.u[(k / 3) * 2 + 1], cc.clone().multiplyScalar(0.82 + 0.3 * hash2(k, x)));
          }
          for (const k of gb.i) tmp.i.push(k);
          bMisc.mergeGeo(tmp.build(), new THREE.Matrix4().makeRotationY(rng() * TAU).setPosition(x, gy, z));
          this.colliders.push({ x, z, r: r * 1.2, tall: true });
        } else {
          // a scarecrow
          cylGeo(bWood, x, gy, z, 0.05, 0.04, 1.7, 6, new THREE.Color(0x9a7346), false);
          boxGeo(bWood, x, gy + 1.35, z, 0.55, 0.04, 0.04, new THREE.Color(0x9a7346), 3);
          boxGeo(bMisc, x, gy + 1.5, z, 0.24, 0.3, 0.16, new THREE.Color(0xb2a26e), 2);
          cylGeo(bMisc, x, gy + 1.78, z, 0.02, 0.3, 0.26, 9, new THREE.Color(0xdabd74), true);
        }
        placed++;
      }
    }

    /* ============================================================
       Flower beds and vegetable plots under the windows
       ============================================================ */
    this.flowerGeo = null;
    {
      const spots = [];
      for (const s of plan.holes) {
        for (let i = 0; i < 5; i++) {
          const a = rng() * TAU, rr = s.gardenDepth * (0.4 + rng() * 0.6);
          const lx = Math.cos(a) * s.w * 0.42, lz = rr;
          const x = s.x + Math.cos(s.rot) * lx + Math.sin(s.rot) * lz;
          const z = s.z - Math.sin(s.rot) * lx + Math.cos(s.rot) * lz;
          spots.push([x, z, 0.5 + rng() * 0.6]);
        }
      }
      if (spots.length) {
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          map: flowerTexture(), roughness: 0.9, side: THREE.DoubleSide
        });
        const inst = new THREE.InstancedMesh(geo, mat, spots.length);
        const m = new THREE.Matrix4();
        const col = new THREE.Color();
        for (let i = 0; i < spots.length; i++) {
          const [x, z, s] = spots[i];
          m.makeRotationY(rng() * TAU);
          m.scale(new THREE.Vector3(s * 1.4, 1, s * 1.4));
          m.setPosition(x, heightAt(x, z) + 0.03, z);
          inst.setMatrixAt(i, m);
          const v = 0.8 + rng() * 0.4;
          col.setRGB(v, v, v * 0.95);
          inst.setColorAt(i, col);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.receiveShadow = true;
        inst.name = 'flower-beds';
        this.group.add(inst);
      }
    }

    /* --- soil beds, for the vegetable gardens -------------------- */
    {
      const beds = [];
      for (const h of plan.holes) {
        const lx = h.w * 0.3, lz = h.gardenDepth * 0.7;
        const x = h.x + Math.cos(h.rot) * lx + Math.sin(h.rot) * lz;
        const z = h.z - Math.sin(h.rot) * lx + Math.cos(h.rot) * lz;
        beds.push({ x, z, w: h.w * 0.34, d: h.gardenDepth * 0.22, rot: h.rot });
      }
      if (beds.length) {
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({
          map: soilTexture(), roughness: 1.0
        });
        const inst = new THREE.InstancedMesh(geo, mat, beds.length);
        const m = new THREE.Matrix4();
        for (let i = 0; i < beds.length; i++) {
          const b = beds[i];
          m.makeRotationY(b.rot);
          m.scale(new THREE.Vector3(b.w, 1, b.d));
          m.setPosition(b.x, heightAt(b.x, b.z) + 0.02, b.z);
          inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.receiveShadow = true;
        inst.name = 'garden-beds';
        this.group.add(inst);
      }
    }

    /* ============================================================
       A windmill on the ridge — the one thing on the horizon that
       turns, and the films' sign of open country.
       ============================================================ */
    {
      const x = 176, z = 322;
      const gy = heightAt(x, z);
      const wb = new Builder();
      const stone = new THREE.Color(0xc9bda0);
      const cc = new THREE.Matrix4().makeRotationY(0.4);
      // a tapered tower
      const segs = 5;
      for (let k = 0; k < segs; k++) {
        const t0 = k / segs, t1 = (k + 1) / segs;
        const y0 = gy + t0 * 9, y1 = gy + t1 * 9;
        const r0 = lerp(2.6, 1.9, t0), r1 = lerp(2.6, 1.9, t1);
        const rb = new Builder();
        cylGeo(rb, 0, y0, 0, r0, r1, y1 - y0, 12, stone.clone().multiplyScalar(0.9 + 0.14 * k), false);
        bStone.mergeGeo(rb.build(), cc.clone().setPosition(x, 0, z));
      }
      const cap = new THREE.ConeGeometry(2.3, 1.7, 12);
      cap.translate(0, gy + 9.85, 0);
      const cb = new Builder();
      const capPos = cap.attributes.position.array, capN = cap.attributes.normal.array;
      const capI = cap.index ? cap.index.array : null;
      for (let k = 0; k < capPos.length; k += 3) {
        cb.vert(capPos[k], capPos[k + 1], capPos[k + 2], capN[k], capN[k + 1], capN[k + 2],
          0.5 + capPos[k] * 0.2, 0.5 + capPos[k + 2] * 0.2, new THREE.Color(0x9a7346));
      }
      if (capI) for (const k of capI) cb.i.push(k);
      else for (let k = 0; k < capPos.length / 3; k++) cb.i.push(k);
      cap.dispose();
      bWood.mergeGeo(cb.build(), cc.clone().setPosition(x, 0, z));
      // sails
      const hub = new THREE.Group();
      hub.position.set(x, gy + 9.4, z + 1.9);
      hub.rotation.y = 0.4;
      const sailB = new Builder();
      const hubB = new Builder();
      cylGeo(hubB, 0, -0.3, -0.3, 0.34, 0.3, 0.7, 8, new THREE.Color(0x6e5333), true);
      sailB.mergeGeo(hubB.build(), new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      for (let i = 0; i < 4; i++) {
        const m2 = new THREE.Matrix4().makeRotationZ((i / 4) * TAU);
        const sb = new Builder();
        const stock = new Builder();
        boxGeo(stock, 0, 3.0, 0, 0.08, 3.0, 0.08, new THREE.Color(0x87673f), 2);
        sb.mergeGeo(stock.build(), new THREE.Matrix4());
        const cloth = new Builder();
        boxGeo(cloth, 0.4, 3.5, 0, 0.34, 2.1, 0.02, new THREE.Color(0xd8cfae), 1);
        for (let r = 0; r < 6; r++) {
          boxGeo(cloth, 0.4, 1.5 + r * 0.8, 0.04, 0.36, 0.025, 0.02, new THREE.Color(0x9a8f70), 3);
        }
        sb.mergeGeo(cloth.build(), new THREE.Matrix4());
        sailB.mergeGeo(sb.build(), m2);
      }
      const mesh = new THREE.Mesh(sailB.build(), this._woodMaterial());
      mesh.castShadow = true;
      hub.add(mesh);
      this.group.add(hub);
      this.animated.push({ obj: hub, kind: 'sails' });
      this.windmill = { x, z, y: gy, hub };
      this.colliders.push({ x, z, r: 2.8, tall: true });
    }

    /* ============================================================
       Merge and upload
       ============================================================ */
    this.mats = {
      wood: this._woodMaterial(),
      stone: new THREE.MeshStandardMaterial({ map: drystoneTexture(), roughness: 0.95, vertexColors: true }),
      hedge: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }),
      misc: new THREE.MeshStandardMaterial({ map: cropTexture('barley'), roughness: 0.92, vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide })
    };
    const put = (builder, key, cast, receive) => {
      if (!builder.p.length) return;
      const mesh = new THREE.Mesh(builder.build(), this.mats[key]);
      mesh.name = 'props-' + key;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    };
    put(bWood, 'wood', true, true);
    put(bStone, 'stone', true, true);
    put(bHedge, 'hedge', true, true);
    put(bMisc, 'misc', true, true);
    put(bGlow, 'glow', false, false);
    void bSoil; void bGrassCard; void PALETTE;
  }

  _woodMaterial() {
    if (!this._wm) {
      this._wm = new THREE.MeshStandardMaterial({
        map: plankTexture('#8a6a3e'), roughness: 0.84, vertexColors: true
      });
    }
    return this._wm;
  }

  update(t, dt, nightAmount) {
    for (const a of this.animated) {
      if (a.kind === 'sails') a.obj.rotation.z = t * 0.55;
    }
    this.mats.glow.color.setRGB(
      0.16 + nightAmount * 1.2, 0.13 + nightAmount * 0.95, 0.1 + nightAmount * 0.6);
  }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of Object.values(this.mats)) if (m && m.dispose) m.dispose();
  }
}

export { Builder, glowTexture, paintTexture, leafClusterTexture, clamp, smoothstep, hash2, riverAt, heightAt, roadAt, fieldAt, TAU, PALETTE };
