/* ============================================================
   locations.js — the plan of the Shire on paper.

   Where every hole, door, window, chimney, fence and path sits.
   Buildings, props, vegetation, the minimap and the discovery
   toasts all read this one description, so nothing can drift.
   ============================================================ */

import * as THREE from 'three';
import {
  PLACES, DOOR_COLOURS, WORLD, TAU, clamp, lerp, smoothstep, makeRng, hash2
} from './constants.js';
import { riverAt, roadAt, heightAt, landAt, setBanks } from './noise.js';

/* Which way a facade looks, in radians (0 = +Z / south). */
const faceDir = (dx, dz) => Math.atan2(dx, dz);

/**
 * A row of hobbit-holes along a lane, alternating hillside and
 * semi-detached, the way the films stagger them.
 */
function layOutVillage(opts) {
  const {
    centre, count, seed, spread, arc, gap,
    wallHexes, doorStart, minH, maxH, depthBias
  } = opts;
  const rng = makeRng(seed);
  const holes = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    // walk along a gentle arc, alternating sides
    const side = i % 2 === 0 ? 1 : -1;
    const along = (t - 0.5) * spread;
    const bend = Math.sin(t * Math.PI) * arc * side;
    const x = centre.x + along * Math.cos(opts.rot) - bend * Math.sin(opts.rot);
    const z = centre.z + along * Math.sin(opts.rot) + bend * Math.cos(opts.rot);
    const facing = opts.rot + Math.PI * 0.5 + side * 0.0 + (rng() - 0.5) * 0.5;
    const w = lerp(minH, maxH, rng());
    const d = w * lerp(0.72, 0.94, rng()) * (1 + depthBias * 0.1);
    const y = heightAt(x, z);
    holes.push({
      x, y, z,
      rot: facing,
      w, d,
      wallH: lerp(2.0, 2.5, rng()),
      doorCol: DOOR_COLOURS[(doorStart + i) % DOOR_COLOURS.length],
      wallHex: wallHexes[(doorStart + i) % wallHexes.length],
      kind: rng() < 0.55 ? 'hill' : (rng() < 0.7 ? 'semi' : 'cottage'),
      doorU: lerp(-0.26, 0.26, rng()),
      windows: Math.max(1, Math.round(w / 3.1)),
      gardenDepth: lerp(3.4, 6.2, rng()),
      seed: (seed * 7 + i * 31) & 0xffff,
      hedge: rng() < 0.5
    });
  }
  return holes;
}

/* Bag End: big, round-doored, green, in the flank of the Hill. */
function bagEnd() {
  // On the Hill with the rest of Hobbiton, on the shoulder where the
  // ground still rises behind: the bank needs a hillside to be the
  // bank of a hill, and the Water has to be somewhere over there to
  // look at, not under the doorstep.
  const x = 22, z = 104;
  const y = heightAt(x, z);
  return {
    id: 'bagend',
    x, y, z,
    rot: faceDir(0.52, 0.85),        // the door looks down the slope, south
    w: 17.0, d: 13.0,
    wallH: 2.2,
    doorCol: 0x3f7a2a,
    wallHex: 0xf6e6c4,
    kind: 'grand',
    doorU: -0.06,
    windows: 5,
    gardenDepth: 9.5,
    seed: 4711,
    hedge: false
  };
}

/* The Green Dragon: wider, lower, green door, warm and busy. */
function greenDragon() {
  const x = -96, z = 116;
  const y = heightAt(x, z);
  const g = {
    id: 'dragon',
    x, y, z,
    rot: faceDir(0.86, 0.52),
    w: 17.5, d: 13.5,
    wallH: 3.0,
    doorCol: 0x2f6f4a,
    wallHex: 0xf0dcb4,
    kind: 'inn',
    doorU: -0.18,
    windows: 5,
    gardenDepth: 8.5,
    seed: 8123,
    hedge: false
  };
  // a lower wing, built on as an afterthought — the films' buildings lean
  const wing = {
    id: 'dragon-wing',
    x: x + Math.cos(g.rot - 1.9) * 12.5, y, z: z + Math.sin(g.rot - 1.9) * 12.5,
    rot: g.rot - 0.5,
    w: 8.5, d: 7.5, wallH: 2.4,
    doorCol: 0x2f6f4a, wallHex: 0xead6ae, kind: 'semi', doorU: 0,
    windows: 2, gardenDepth: 3.5, seed: 8124, hedge: false
  };
  return [g, wing];
}

/* The Mill: two storeys of cob, a big wheel, sacks in the yard. */
function mill() {
  // Close enough to the channel that the wheel turns in it, and no
  // closer: the bank of the Water is a cliff, and a mill whose floor
  // stands in the river is a mill nobody could work.
  const x = -38, z = 50;
  const y = heightAt(x, z);
  return [{
    id: 'mill',
    x, y, z,
    rot: faceDir(0.9, 0.42),
    w: 11.5, d: 10.0, wallH: 5.6,
    doorCol: 0x8a5a2a, wallHex: 0xe8dcc0,
    kind: 'mill', doorU: 0.1, windows: 6, gardenDepth: 4.5,
    seed: 6060, hedge: false
  }];
}

/* The bridge over the Water at Bywater. */
function bridge() {
  return { id: 'bridge', x: 95, z: 8, rot: faceDir(-0.72, 0.7), w: 4.6, d: 26 };
}

/* An orchard: a grid of small fruit trees inside a low fence. */
function orchard(field) {
  const cx = 96, cz = 128;
  const trees = [];
  const rng = makeRng(3141);
  for (let gz = 0; gz < 5; gz++) {
    for (let gx = 0; gx < 6; gx++) {
      if (gx === 0 && gz === 0) continue;
      const x = cx + (gx - 2.5) * 6.4 + (rng() - 0.5) * 1.1;
      const z = cz + (gz - 2) * 6.0 + (rng() - 0.5) * 1.1;
      trees.push({ x, z, rot: rng() * TAU, s: lerp(0.82, 1.2, rng()), kind: rng() < 0.72 ? 'apple' : 'cherry' });
    }
  }
  return {
    trees,
    fence: { x: cx, z: cz, w: 40, d: 32, rot: 0.06, gate: [cx, cz - 16] }
  };
}

/* Hedgerow and wall lines: drystone round the Fields, hedge round
   the pastures, the way the films show it. */
function fieldBoundaries() {
  const walls = [];
  const rng = makeRng(9091);
  for (const f of [
    { x: 214, z: 214, w: 62, h: 46, rot: 0.24 },
    { x: 292, z: 176, w: 54, h: 62, rot: -0.16 },
    { x: 226, z: 132, w: 66, h: 44, rot: 0.08 },
    { x: 300, z: 268, w: 70, h: 52, rot: 0.34 },
    { x: 168, z: 186, w: 48, h: 40, rot: -0.3 },
    { x: 140, z: 246, w: 56, h: 38, rot: 0.14 },
    { x: 344, z: 210, w: 58, h: 66, rot: -0.1 },
    { x: 258, z: 62, w: 60, h: 44, rot: 0.2 },
    { x: 330, z: 20, w: 52, h: 48, rot: -0.24 },
    { x: 148, z: 116, w: 44, h: 34, rot: 0.18 },
    { x: 62, z: 176, w: 46, h: 36, rot: -0.12 },
    { x: -60, z: 208, w: 52, h: 42, rot: 0.3 }
  ]) {
    // four sides, with a gap for a gate on the longest one
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const pt = (u, v) => [f.x + u * c - v * s, f.z + u * s + v * c];
    const sides = [
      [pt(-f.w, -f.h), pt(f.w, -f.h), 'hedge'],
      [pt(f.w, -f.h), pt(f.w, f.h), 'hedge'],
      [pt(f.w, f.h), pt(-f.w, f.h), 'stone'],
      [pt(-f.w, f.h), pt(-f.w, -f.h), 'stone']
    ];
    for (const [a, b, kind] of sides) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 6) continue;
      const gate = rng() < 0.4;
      walls.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], kind, gate, h: kind === 'stone' ? 0.95 : 1.35 });
    }
    // a couple of cross-hedgerows, so a big field is a patchwork
    // rather than one open rectangle
    const cross = 1 + Math.floor(rng() * 2);
    for (let k = 1; k <= cross; k++) {
      const u = (k / (cross + 1)) * 2 - 1;
      const g2 = rng() < 0.55;
      const q0 = pt(u * f.w, -f.h), q1 = pt(u * f.w, f.h);
      walls.push({ ax: q0[0], az: q0[1], bx: q1[0], bz: q1[1], kind: g2 ? 'hedge' : 'stone', gate: true, h: g2 ? 1.3 : 0.9 });
      const v = (k / (cross + 1)) * 2 - 1;
      const r0 = pt(-f.w, v * f.h), r1 = pt(f.w, v * f.h);
      walls.push({ ax: r0[0], az: r0[1], bx: r1[0], bz: r1[1], kind: g2 ? 'stone' : 'hedge', gate: true, h: g2 ? 1.3 : 0.9 });
    }
  }
  return walls;
}

/* The Party Tree: a great spreading oak, hung with lanterns. */
function partyTree() {
  const x = 2, z = 22;
  return {
    x, z, y: heightAt(x, z),
    rot: 0.4,
    s: 2.35,             // considerably larger than any other tree
    kind: 'oak',
    lanterns: true
  };
}

/* Sam's rowan, by Bag End's gate. */
function rowanTree() {
  const x = 31, z = 110;
  return { x, z, y: heightAt(x, z), rot: 1.1, s: 0.78, kind: 'rowan', lanterns: false };
}

export function buildPlan() {
  const hobbiton = layOutVillage({
    centre: { x: 62, z: 104 }, count: 14, seed: 11,
    spread: 62, arc: 9, gap: 5, rot: 0.42,
    wallHexes: [0xfae8c6, 0xf2dcb8, 0xfdf1d8, 0xeccfa4, 0xf6e0bc, 0xf7ead0],
    doorStart: 0, minH: 7.0, maxH: 10.5, depthBias: 0
  });
  const bywater = layOutVillage({
    centre: { x: 108, z: 26 }, count: 8, seed: 27,
    spread: 34, arc: 5, gap: 4, rot: -0.7,
    wallHexes: [0xeddcb8, 0xe6d2ae, 0xf2e4c2, 0xdfc99e],
    doorStart: 5, minH: 6.4, maxH: 8.6, depthBias: 0
  });
  const dragontail = layOutVillage({
    centre: { x: -128, z: 78 }, count: 4, seed: 33,
    spread: 22, arc: 3, gap: 4, rot: 1.4,
    wallHexes: [0xe8d6b0, 0xdfcfa8],
    doorStart: 9, minH: 6.0, maxH: 7.4, depthBias: 0
  });

  const holes = [
    bagEnd(),
    ...greenDragon(),
    ...mill(),
    ...hobbiton, ...bywater, ...dragontail
  ];

  const walls = fieldBoundaries();
  const orch = orchard();
  const pTree = partyTree();
  const rowan = rowanTree();

  /* ----------------------------------------------------------------
     Keep-off discs. Anything that plants or props must not sit in
     these, so we compute them once, here.
     ---------------------------------------------------------------- */
  const exclusions = [];
  for (const h of holes) {
    exclusions.push({ x: h.x, z: h.z, r: Math.max(h.w, h.d) * 0.72 + 2.4 });
  }
  exclusions.push({ x: pTree.x, z: pTree.z, r: 7 });
  exclusions.push({ x: rowan.x, z: rowan.z, r: 3.4 });
  // the village greens and lanes
  exclusions.push({ x: 62, z: 104, r: 12 });
  exclusions.push({ x: 108, z: 26, r: 8 });
  // the Party Field, kept clear for the party
  exclusions.push({ x: 2, z: 44, r: 22 });
  for (const f of [
    { x: 214, z: 214, w: 62, h: 46, rot: 0.24 }, { x: 292, z: 176, w: 54, h: 62, rot: -0.16 },
    { x: 226, z: 132, w: 66, h: 44, rot: 0.08 }, { x: 300, z: 268, w: 70, h: 52, rot: 0.34 },
    { x: 168, z: 186, w: 48, h: 40, rot: -0.3 }, { x: 140, z: 246, w: 56, h: 38, rot: 0.14 },
    { x: 344, z: 210, w: 58, h: 66, rot: -0.1 }, { x: 258, z: 62, w: 60, h: 44, rot: 0.2 },
    { x: 330, z: 20, w: 52, h: 48, rot: -0.24 }, { x: 148, z: 116, w: 44, h: 34, rot: 0.18 },
    { x: 62, z: 176, w: 46, h: 36, rot: -0.12 }, { x: -60, z: 208, w: 52, h: 42, rot: 0.3 }
  ]) {
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * TAU;
      const c = Math.cos(f.rot), sn = Math.sin(f.rot);
      const lx = Math.cos(a) * f.w, lz = Math.sin(a) * f.h;
      exclusions.push({ x: f.x + lx * c - lz * sn, z: f.z + lx * sn + lz * c, r: 5.5 });
    }
  }
  // the mill's wheel and the river banks
  exclusions.push({ x: -36, z: 48, r: 16 });
  exclusions.push({ x: 95, z: 8, r: 16 });

  const inExclusion = (x, z, pad = 0) => {
    for (const e of exclusions) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz < (e.r + pad) * (e.r + pad)) return true;
    }
    return false;
  };

  return {
    holes, walls, orchard: orch, partyTree: pTree, rowan,
    bridge: bridge(), exclusions, inExclusion, banks: bankShapes(holes),
    place: (id) => PLACES.find(p => p.id === id)
  };
}

/**
 * The turf bank over each hole, as the height field wants it. The
 * films put a garden and a good deal of earth over the house, and
 * the bank is what you walk up to knock.
 *
 * The bank is sized from the house, not guessed: its crest has to
 * clear the ridge of the roof (which the facade builder puts at
 * `wallH + w * 0.20 + 1.1` above the door, more for Bag End), and
 * it has to run far enough behind the house to fall away in a
 * green shoulder rather than stop at the back wall.
 */
function bankShapes(holes) {
  const out = [];
  for (const h of holes) {
    const isGrand = h.kind === 'grand';
    const isMill = h.kind === 'mill';
    const w = h.w;
    const d = h.d;
    out.push({
      x: h.x, z: h.z, rot: h.rot, seed: h.seed | 0,
      w,
      // long enough behind the house for the bank to lie down again
      depth: Math.max(d * (isGrand ? 2.1 : 1.9),
                      (h.wallH + (isGrand ? 3.0 : 2.2)) * 2.4),
      rise: 0.17,
      // The bank only has to clear the facade by a good margin: the
      // house is under the turf, and the whole point of a hobbit hole
      // is that the grass is higher than the bricks.
      ridgeH: h.wallH + (isGrand ? 3.0 : isMill ? 0.6 : 2.2),
      baseY: heightAt(h.x, h.z) - 0.4
    });
  }
  return out;
}

/* ------------------------------------------------------------
   Discovery: a place is found when you first come near it.
   ------------------------------------------------------------ */
export class Discovery {
  constructor(save) {
    this.save = save;
    this.found = new Set(save.get('found', []));
    this.pending = null;
    this._onFind = null;
  }
  onFind(fn) { this._onFind = fn; }
  update(x, z) {
    for (const p of PLACES) {
      if (this.found.has(p.id)) continue;
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r) {
        this.found.add(p.id);
        this.save.set('found', [...this.found]);
        if (this._onFind) this._onFind(p);
        return p;
      }
    }
    return null;
  }
  get count() { return this.found.size; }
  get total() { return PLACES.length; }
}

/* ------------------------------------------------------------
   Things you can press E on. Each has a place, a label, and a
   line of flavour. The best bits of writing in the whole thing.
   ------------------------------------------------------------ */
export const INTERACTIVES = [
  {
    id: 'bagend-door', place: 'bagend', r: 6.5,
    label: 'Knock on the green door',
    text: 'The door is round, and the knocker is brass, and it answers the third time you knock — as it should.'
  },
  {
    id: 'party-tree', place: 'partytree', r: 9,
    label: 'Look up into the Party Tree',
    text: 'A hundred lanterns still hang there, though no one has lit them since the fireworks. The branches go on further than seems reasonable.'
  },
  {
    id: 'dragon-door', place: 'dragon', r: 7.5,
    label: 'Try the Green Dragon',
    text: 'It is warm inside, and loud, and smells of woodsmoke and ottermasher. Someone is singing, badly, and being told to stop.'
  },
  {
    id: 'mill-wheel', place: 'mill', r: 8,
    label: 'Put a hand to the mill wheel',
    text: 'The Water turns it, and the sacks go up the stairs, and nobody has had to do this by hand in eighty years.'
  },
  {
    id: 'well', place: 'hobbiton', r: 6,
    label: 'Look down the well',
    text: 'Cold, and a long way down, and somebody has tied a bright red ribbon to the bucket handle. Probably a birthday.'
  },
  {
    id: 'bridge-stone', place: 'bridge', r: 8,
    label: 'Lean on the bridge',
    text: 'Old stone, worn hollow in the middle by all the feet that have gone over it to somewhere.'
  },
  {
    id: 'vane', place: 'mill', r: 12,
    label: 'Watch the weather vane',
    text: 'The Shire has no weather to speak of. It has drizzle, and damp, and occasionally a wind that smells of the far countries.'
  },
  {
    id: 'signpost', place: 'road', r: 7,
    label: 'Read the signpost',
    text: 'BREE 4 · HOBBITON 2 · THE WATER AND THE MILE COUNTRY, THIS WAY AND THAT. The paint has been done more than once.'
  },
  {
    id: 'bywater-bench', place: 'bywater', r: 7,
    label: 'Sit on the bench a while',
    text: 'Across the water, the mill is turning, and nobody is in a hurry about anything.'
  }
];

export { heightAt, landAt, riverAt, roadAt, hash2, smoothstep, clamp, lerp, WORLD };
