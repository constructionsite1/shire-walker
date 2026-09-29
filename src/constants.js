/* ============================================================
   constants.js — the shape of the Shire.
   Pure data + small math helpers. No three.js in this file.
   All coordinates are metres, X east, Z south, Y up.
   The world is centred on the Hill at the origin.
   ============================================================ */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/* Deterministic 2D hash in [0,1) — no allocation, no RNG state. */
export const hash2 = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
};
/* Small deterministic PRNG for one-off placements. */
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Shortest signed angular difference, radians. */
export const angDelta = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/* ------------------------------------------------------------
   World extent. Inner terrain is simulated at full detail;
   the annulus beyond carries the horizon out to the mountains.
   ------------------------------------------------------------ */
export const WORLD = {
  inner: 400,        // half-extent of the detailed terrain, metres
  annulus: 3250,     // outer radius of the ring mesh
  seg: 384,          // inner terrain grid divisions (per side)
  dataRes: 512,      // baked height/mask texture resolution
  walkLimit: 372,    // beyond this you are gently turned home
  seaLevel: 0
};

/* Real minutes per in-world day, at real time. */
export const DAY_SECONDS = 480;

/* ------------------------------------------------------------
   Time presets as fractions of a 24h day.
   ------------------------------------------------------------ */
/* Times of day, as fractions of a 24 h day. The sun rises at 6 and
   sets at 18 in the sky model, so "golden" is late afternoon and
   "dusk" is the moment after it goes. */
export const TIME_PRESETS = {
  dawn: 6.62 / 24,      // first light, the sun just clear of the trees
  gold: 17.25 / 24,     // the long warm afternoon
  noon: 12.2 / 24,
  dusk: 18.62 / 24,     // just after the sun has gone
  night: 22.4 / 24
};

/* ------------------------------------------------------------
   The Water — the Shire's river, with a tributary that joins
   at Waymeadow. Each node: x, z, surface level, half-width.
   The level falls monotonically, so the water always runs out
   to the south-east, and the terrain is carved to match.
   ------------------------------------------------------------ */
export const RIVER = [
  [-400, -330, 10.4, 5.0],
  [-352, -286, 9.4, 5.1],
  [-296, -238, 8.3, 5.2],
  [-238, -196, 7.2, 5.2],
  [-186, -150, 6.1, 5.3],
  [-142, -104, 5.2, 5.5],
  [-112, -58, 4.4, 5.7],
  [-86, -12, 3.9, 6.1],
  [-58, 22, 3.4, 6.3],
  [-32, 44, 3.0, 6.5],   // the Mill sits on the north bank here
  [2, 62, 2.5, 6.8],
  [40, 58, 2.1, 7.0],
  [68, 30, 1.7, 7.2],
  [95, 8, 1.35, 7.4],    // Bywater and its bridge
  [140, -14, 1.05, 7.4],
  [186, 6, 0.8, 7.8],
  [232, 62, 0.5, 8.2],
  [284, 138, 0.25, 8.6],
  [348, 226, 0.0, 9.0]
];

export const TRIBUTARY = [
  [232, -196, 8.2, 2.6],
  [196, -152, 6.6, 2.6],
  [162, -104, 5.2, 2.7],
  [126, -58, 3.9, 2.8],
  [92, -18, 2.7, 3.0],
  [68, 30, 1.7, 3.2]
];

/* The Great West Road — a pale dirt track, SW to NE. It keeps clear
   of Bag End's garden: a road that runs through the front of the
   house is a road, but it is not the one in the films. */
export const ROAD = [
  [-372, 232], [-318, 216], [-262, 198], [-206, 182], [-152, 168],
  [-104, 158], [-58, 146], [-14, 132], [14, 124], [40, 114],
  [72, 102], [104, 90], [140, 74], [180, 50], [220, 22],
  [262, -12], [304, -48], [344, -92], [372, -146]
];

/* Lanes: narrower, and only where feet would actually go. */
export const LANES = [
  [[-14, 132], [4, 126], [18, 119], [27, 114]],                     // down to Bag End's gate
  [[27, 114], [24, 121], [18, 125], [12, 117], [8, 101], [4, 80], [2, 60], [2, 44]],  // gate to the Party Field
  [[-58, 146], [-74, 136], [-86, 126], [-96, 116]],                   // to the Green Dragon
  [[-38, 50], [-42, 60], [-46, 72], [-48, 84]],                       // mill to the fields
  [[95, 8], [104, 20], [112, 34], [116, 50]],                        // Bywater lane
  [[40, 58], [58, 74], [74, 88], [88, 100]]                           // Hobbiton lane
];

/* The Hill: a broad, gentle knoll, the Shire's high point. */
export const HILL = { x: 6, z: 78, radius: 168, height: 31 };

/* North-farthing rise, so the land climbs toward the Misty Mountains. */
export const NORTH_RISE = { z0: -250, z1: -420, height: 26 };

/* Far ranges: bearing (radians, 0 = north), distance, height,
   width, how much snow it carries, and how rough it looks. The
   Misty Mountains are the two ranges to the north-north-west;
   the rest are lower, hazier shoulders that keep the horizon
   from being a straight line. */
export const RIDGES = [
  { bearing: -1.9, dist: 2050, height: 250, width: 620, snow: 0.55, rough: 1.0 },
  { bearing: -1.15, dist: 2250, height: 225, width: 700, snow: 0.4, rough: 0.9 },
  { bearing: -0.35, dist: 2450, height: 180, width: 760, snow: 0.15, rough: 0.8 },
  { bearing: 0.55, dist: 2350, height: 140, width: 820, snow: 0.0, rough: 0.7 },
  { bearing: 1.7, dist: 2400, height: 125, width: 780, snow: 0.0, rough: 0.6 },
  { bearing: 2.6, dist: 2300, height: 155, width: 700, snow: 0.0, rough: 0.7 },
  { bearing: -2.75, dist: 2200, height: 200, width: 640, snow: 0.35, rough: 0.9 },
  { bearing: 3.2, dist: 2500, height: 105, width: 700, snow: 0.0, rough: 0.6 },
  { bearing: -0.75, dist: 2900, height: 190, width: 900, snow: 0.3, rough: 0.7 }
];

/* Landmarks. x/z are world metres; `r` is the discovery radius. */
export const PLACES = [
  { id: 'bagend',   name: 'Bag End',           sub: 'of Bagshot Row',            x: 22,   z: 104, r: 30 },
  { id: 'hill',     name: 'The Hill',          sub: 'and the Party Field below',  x: 6,    z: 60,  r: 34 },
  { id: 'partytree',name: 'The Party Tree',    sub: 'where a hundred lanterns hang', x: 2,  z: 22,  r: 24 },
  { id: 'partyfield', name: 'The Party Field', sub: 'where the fireworks went up', x: 2,  z: 44,  r: 30 },
  { id: 'hobbiton', name: 'Hobbiton',          sub: 'of the Water',              x: 62,   z: 104, r: 46 },
  { id: 'dragon',   name: 'The Green Dragon',  sub: 'and its cellar',            x: -96,  z: 116, r: 30 },
  { id: 'mill',     name: 'The Mill',          sub: 'and the Water below it',    x: -36,  z: 48,  r: 26 },
  { id: 'bywater',  name: 'Bywater',           sub: 'across the bridge',         x: 106,  z: 26,  r: 34 },
  { id: 'bridge',   name: 'The Bridge',        sub: 'over the Water',            x: 95,   z: 8,   r: 16 },
  { id: 'water',    name: 'The Water',         sub: 'running south-east',        x: -60,  z: -4,  r: 30 },
  { id: 'road',     name: 'The Great West Road', sub: 'the way to Bree',         x: -104, z: 156, r: 22 },
  { id: 'fields',   name: 'The Fields',        sub: 'barley, kale and good barley', x: 190, z: 176, r: 44 },
  { id: 'orchard',  name: 'The Orchard',       sub: 'apples, and a good apple',  x: 96,   z: 128, r: 26 },
  { id: 'wood',     name: 'The Wood',          sub: 'the edge of the Old Forest', x: 232, z: -30, r: 46 },
  { id: 'bywood',   name: 'Bywater Wood',      sub: 'elven lamps ahead',         x: 168,  z: -66, r: 34 }
];

/* Field patches: x, z, half-size, rotation, crop type. */
export const FIELDS = [
  { x: 214, z: 214, w: 62, h: 46, rot: 0.24, crop: 'barley' },
  { x: 292, z: 176, w: 54, h: 62, rot: -0.16, crop: 'wheat' },
  { x: 226, z: 132, w: 66, h: 44, rot: 0.08, crop: 'kale' },
  { x: 300, z: 268, w: 70, h: 52, rot: 0.34, crop: 'barley' },
  { x: 168, z: 186, w: 48, h: 40, rot: -0.3, crop: 'turnip' },
  { x: 140, z: 246, w: 56, h: 38, rot: 0.14, crop: 'wheat' },
  { x: 344, z: 210, w: 58, h: 66, rot: -0.1, crop: 'kale' },
  { x: 258, z: 62, w: 60, h: 44, rot: 0.2, crop: 'turnip' },
  { x: 330, z: 20, w: 52, h: 48, rot: -0.24, crop: 'barley' },
  { x: 148, z: 116, w: 44, h: 34, rot: 0.18, crop: 'kale' },
  { x: 62,  z: 176, w: 46, h: 36, rot: -0.12, crop: 'barley' },
  { x: -60, z: 208, w: 52, h: 42, rot: 0.3, crop: 'wheat' }
];

/* The film's door colours, as hex. Bag End's green is #4a7a2e-ish. */
export const DOOR_COLOURS = [
  0x3f7a2a, 0xd8a72a, 0x2f6f9e, 0xb0453a, 0xd9c04a, 0x2f8f86,
  0x6d3b63, 0x7b4a2a, 0x4a8f4f, 0xc96a2b, 0x8a9a3c, 0x9c3f52,
  0x35607a, 0xa8763c
];

export const PALETTE = {
  cream: 0xf3e9d2,
  gold: 0xc9a227,
  goldSoft: 0xe2c877,
  leaf: 0x4e7a33,
  leafDeep: 0x2c4a1e,
  bark: 0x4a3826,
  thatch: 0x8a6f3c,
  turf: 0x4a6b2f,
  stone: 0x8d8578,
  slate: 0x4b4f52,
  water: 0x2f4a52,
  lantern: 0xffcf7a,
  paintTrim: 0xf1e6c8
};

/* ------------------------------------------------------------
   Quality tiers. 0 = low (phones), 1 = medium, 2 = high.
   ------------------------------------------------------------ */
export const QUALITY = [
  { // 0 — low (phones)
    name: 'low',
    dpr: 1.0,
    seg: 190,
    dataRes: 256,
    grassCell: 0.55,
    grassSide: 64,
    grassPerCell: 2,
    grassWidth: 0.13,
    grassHeight: 0.46,
    grassRadius: 18,
    shadow: 0,
    shadows: false,
    bloom: false,
    bloomStrength: 0,
    fxaa: false,
    godrays: false,
    drawDistance: 1250,
    fogNear: 40,
    far: 3400,
    trees: 0.4,
    creatures: 0.3,
    shadowsTrees: false,
    waterSegments: 80,
    lanternGlow: false
  },
  { // 1 — medium
    name: 'medium',
    dpr: 1.5,
    seg: 300,
    dataRes: 384,
    grassCell: 0.62,
    grassSide: 96,
    grassPerCell: 4,
    grassWidth: 0.115,
    grassHeight: 0.50,
    grassRadius: 30,
    shadow: 1024,
    shadows: true,
    bloom: true,
    bloomStrength: 0.34,
    bloomThreshold: 0.94,
    bloomRadius: 0.55,
    fxaa: true,
    godrays: false,
    drawDistance: 1900,
    fogNear: 90,
    far: 3400,
    trees: 0.75,
    creatures: 0.7,
    shadowsTrees: true,
    waterSegments: 150,
    lanternGlow: true
  },
  { // 2 — high
    name: 'high',
    dpr: 2.0,
    seg: 384,
    dataRes: 512,
    grassCell: 0.7,
    grassSide: 120,
    grassPerCell: 6,
    grassWidth: 0.10,
    grassHeight: 0.48,
    grassRadius: 42,
    shadow: 2048,
    shadows: true,
    bloom: true,
    bloomStrength: 0.38,
    bloomThreshold: 0.94,
    bloomRadius: 0.55,
    fxaa: true,
    godrays: true,
    drawDistance: 2700,
    fogNear: 140,
    far: 3400,
    trees: 1.0,
    creatures: 1.0,
    shadowsTrees: true,
    waterSegments: 210,
    lanternGlow: true
  }
];

export const EYE_HEIGHT = 1.68;
export const WALK_SPEED = 2.5;
export const RUN_SPEED = 4.6;
export const SLOPE_LIMIT = Math.cos(0.86); // ~49 deg
