/* ============================================================
   vegetation.js — grass and trees.

   GRASS: a toroidal field of blades that follows the player. The
   instance grid is fixed; each blade wraps to the nearest cell
   around the camera, samples the shared field texture for the
   ground height and how much grass grows there, and throws itself
   away where there is none. Zero CPU cost, infinite field.

   TREES: every species is generated once, merged into a single
   geometry, and scattered as an InstancedMesh. One draw call for
   the entire forest.
   ============================================================ */

import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, makeRng, hash2
} from './constants.js';
import { riverAt, roadAt, fbm2, noise2 } from './noise.js';
import {
  barkTexture, leafClusterTexture, willowFrondTexture, turfTexture
} from './textures.js';

/* ============================================================
   GRASS
   ============================================================ */

const GRASS_VERT_PARS = /* glsl */`
  uniform sampler2D uField;
  uniform float uSpan;
  uniform float uCell;
  uniform float uRadius;
  uniform vec2  uCamXZ;
  uniform float uTime;
  uniform vec2  uWind;
  uniform float uWidth;
  uniform float uHeight;
  attribute vec2 aCell;
  attribute vec2 aJitter;
  attribute vec3 aRand;
  varying vec3 vTint;
  varying float vY;
  varying float vTip;
`;

const GRASS_FRAG_PARS = /* glsl */`
  varying vec3 vTint;
  varying float vY;
  varying float vTip;
`;

function bladeGeometry() {
  // A single tapered blade, three rows: two quads, four triangles.
  // Four rows looks a shade better and costs a third more blades than
  // the eye can pick out at running speed.
  const rows = 3, cols = 2;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    const w = Math.pow(1 - v, 0.95) * 0.5;
    for (let c = 0; c < cols; c++) {
      const x = (c === 0 ? -1 : 1) * w;
      pos.push(x, v, v * v * 0.2);
      nrm.push(0, 0, 1);
      uv.push(c, v);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = (r + 1) * cols + c, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(field, quality) {
    this.field = field;
    this.quality = quality;
    this.uniforms = {
      uField: { value: field.texture },
      uSpan: { value: field.span },
      uCell: { value: quality.grassCell },
      uRadius: { value: quality.grassRadius },
      uCamXZ: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(0.86, 0.51) },
      uWidth: { value: quality.grassWidth },
      uHeight: { value: quality.grassHeight }
    };

    const geo = bladeGeometry();
    const side = quality.grassSide;
    const per = quality.grassPerCell;
    const total = side * side * per;
    const aCell = new Float32Array(total * 2);
    const aJitter = new Float32Array(total * 2);
    const aRand = new Float32Array(total * 3);
    let k = 0;
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) {
        for (let p = 0; p < per; p++) {
          aCell[k * 2] = i - side / 2;
          aCell[k * 2 + 1] = j - side / 2;
          // a golden-angle offset keeps the scatter from clumping
          aJitter[k * 2] = hash2(i * 7.13 + p * 3.1, j * 5.77);
          aJitter[k * 2 + 1] = hash2(i * 2.91 - p * 1.7, j * 8.31 + p * 2.3);
          aRand[k * 3] = hash2(i * 1.7 + p * 9.1, j * 3.3 - p * 4.4);
          aRand[k * 3 + 1] = hash2(i * 5.9 - p * 2.2, j * 1.1 + p * 6.6);
          aRand[k * 3 + 2] = hash2(i * 8.3 + p * 1.3, j * 9.7 - p * 5.2);
          k++;
        }
      }
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 2));
    geo.setAttribute('aJitter', new THREE.InstancedBufferAttribute(aJitter, 2));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(aRand, 3));
    geo.instanceCount = total;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      dithering: true
    });
    mat.fog = true;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
        .replace('#include <beginnormal_vertex>', /* glsl */`
          #include <beginnormal_vertex>
          {
            float ang = aRand.x * 6.2831853;
            float ca = cos(ang), sa = sin(ang);
            objectNormal = vec3(ca * objectNormal.x + sa * objectNormal.z,
                                objectNormal.y,
                               -sa * objectNormal.x + ca * objectNormal.z);
            // A blade is a vertical surface, and a vertical surface
            // catches almost nothing from a sun that is mostly overhead
            // -- which is why naive grass is a field of dark slivers
            // lying on bright ground. Lean the normal back toward the
            // sky and the meadow lights like the meadow.
            objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), objectNormal, 0.55));
          }
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          vec3 transformed = vec3(position);
          float _ang = aRand.x * 6.2831853;
          float _ca = cos(_ang), _sa = sin(_ang);
          mat3 _rot = mat3(_ca, 0.0, -_sa, 0.0, 1.0, 0.0, _sa, 0.0, _ca);

          // The blade's own cell, wrapped into a grid that follows the
          // camera. Wrapping is the whole trick: it lets a fixed pool
          // of instances stand in for an endless field. Get the sign
          // wrong and every blade in the county piles onto the spot
          // you are standing in.
          const vec2 SPAN = vec2(${side.toFixed(1)});
          const vec2 HALF = SPAN * 0.5;
          vec2 _base = aCell + aJitter;
          vec2 _c = uCamXZ / uCell;
          vec2 _rel = mod(_base - _c + HALF, SPAN) - HALF;
          vec2 _wp = (_c + _rel) * uCell;
          vec2 _uv = _wp / (uSpan * 2.0) + 0.5;
          vec4 _F = texture2D(uField, _uv);
          float _gh = _F.r * 100.0;
          float _dens = _F.g;
          float _dist = length(_wp - uCamXZ);

          float _fade = 1.0 - smoothstep(uRadius * 0.60, uRadius, _dist);
          float _keep = step(aRand.z * 0.94 + 0.03, _dens);
          float _lod = mix(1.0, step(aRand.y, 0.5) * 0.5 + 0.5,
                           smoothstep(uRadius * 0.34, uRadius * 0.66, _dist));
          float _alive = _fade * _keep * _lod;

          vTip = 0.0;
          if (_alive < 0.5) {
            transformed = vec3(0.0);
            vTint = vec3(0.0);
            vY = 0.0;
          } else {
            float _h = uHeight * (0.46 + aRand.x * 0.82) * (0.66 + 0.6 * _dens);
            float _w = uWidth * (0.62 + aRand.y * 0.72);
            vec3 _p = _rot * vec3(position.x * _w, position.y * _h, position.z * _h);

            // wind: a travelling gust, plus a fine flutter at the tip
            float _gust = sin(uTime * 0.42 - _wp.x * 0.011 - _wp.y * 0.009) * 0.5 + 0.5;
            float _w1 = sin(uTime * 1.7 + _wp.x * 0.28 + _wp.y * 0.34 + aRand.x * 6.28);
            float _w2 = sin(uTime * 3.3 + aRand.y * 6.28);
            float _bend = position.y * position.y;
            float _amt = (0.10 + 0.16 * _gust) * _bend * _h;
            _p.xz += uWind * (_w1 * _amt + _w2 * _amt * 0.28);
            _p.y -= abs(_w1) * 0.05 * _bend * _h;

            transformed = vec3(_wp.x, _gh - 0.035, _wp.y) + _p;

            // colour: patches of the meadow, sun-bleached tips. The
            // blades have to be a shade lighter and warmer than the
            // ground under them or they vanish into it.
            float _patch = texture2D(uField, _uv * 3.1 + vec2(0.37, 0.61)).g;
            vec3 _lo = vec3(0.26, 0.35, 0.15);
            vec3 _hi = vec3(0.53, 0.63, 0.31);
            vec3 _col = mix(_lo, _hi, _dens * 0.5 + _patch * 0.5);
            _col *= 0.84 + 0.40 * aRand.y;
            vTip = pow(position.y, 1.3);
            vTint = _col;
            vY = _gh;
          }
        `);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GRASS_FRAG_PARS)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // darker at the root, bleached and warmer at the tip
            vec3 root = diffuseColor.rgb * 0.52;
            vec3 tip  = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.34), 0.34);
            diffuseColor.rgb *= mix(root, tip, vTip);
            diffuseColor.rgb *= vTint;
          }
        `);
    };
    mat.customProgramCacheKey = () => 'shire-grass';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'grass';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.updateMatrix();
    this.material = mat;
    this.count = total;
  }

  update(t, cam) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCamXZ.value.set(cam.position.x, cam.position.z);
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

/* ============================================================
   TREES
   ============================================================ */

/* --- geometry helpers ---------------------------------------- */
function tube(path, radii, radial = 5) {
  // Sweep a tapering tube along a path. Returns {pos, nrm, uv, idx}.
  const pos = [], nrm = [], uv = [], idx = [];
  const n = path.length;
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3(), nx = new THREE.Vector3(), nz = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = path[i];
    if (i < n - 1) tan.copy(path[i + 1]).sub(p).normalize();
    else tan.copy(p).sub(path[i - 1]).normalize();
    nx.copy(up).cross(tan);
    if (nx.lengthSq() < 1e-6) nx.set(1, 0, 0);
    nx.normalize();
    nz.copy(tan).cross(nx).normalize();
    const r = radii[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      tmp.set(0, 0, 0).addScaledVector(nx, ca).addScaledVector(nz, sa);
      pos.push(p.x + tmp.x * r, p.y + tmp.y * r, p.z + tmp.z * r);
      nrm.push(tmp.x, tmp.y, tmp.z);
      uv.push(j / radial, i / (n - 1));
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j, b = a + 1, c = (i + 1) * ring + j, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos, nrm, uv, idx };
}

class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  add(gb, matrix, colour) {
    const base = this.count;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < gb.pos.length; i += 3) {
      v.set(gb.pos[i], gb.pos[i + 1], gb.pos[i + 2]).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.set(gb.nrm[i], gb.nrm[i + 1], gb.nrm[i + 2]).applyMatrix3(nm).normalize();
      this.nrm.push(v.x, v.y, v.z);
      this.uv.push(gb.uv[(i / 3) * 2], gb.uv[(i / 3) * 2 + 1]);
      const c = typeof colour === 'function' ? colour(i / 3) : colour;
      this.col.push(c.r, c.g, c.b);
    }
    for (const k of gb.idx) this.idx.push(base + k);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const CARD = () => {
  // a single quad, unit size, centred
  return {
    pos: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
    nrm: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uv: [0, 0, 1, 0, 1, 1, 0, 1],
    idx: [0, 1, 2, 0, 2, 3]
  };
};

const CUBE = () => {
  const p = [], n = [], u = [], i = [];
  const faces = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]]
  ];
  for (const [nrm, quad] of faces) {
    const b = p.length / 3;
    quad.forEach((q, k) => {
      p.push(q[0], q[1], q[2]);
      n.push(nrm[0], nrm[1], nrm[2]);
      u.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
    });
    i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { pos: p, nrm: n, uv: u, idx: i };
};

/* A leafy clump: crossed quads, jittered in the vertex colours so
   the canopy is not one flat green. Two cards, placed as an X, and
   the tip they sit on is generous — a tree is mostly leaves, and
   that is what makes it read as a tree rather than a stick. */
function clump(builder, matrix, size, tint, rng, cards = 3) {
  const hue = new THREE.Color();
  for (let c = 0; c < cards; c++) {
    // each card gets its own angle on all three axes, and a size of its
    // own: a stand of crossed planes reads as a box, a scatter of
    // small ones reads as foliage
    const a = rng() * TAU;
    const tilt = (rng() - 0.5) * 1.5;
    const roll = rng() * TAU;
    const s = size * (0.42 + rng() * 0.62);
    const m = matrix.clone()
      .multiply(new THREE.Matrix4().makeRotationY(a))
      .multiply(new THREE.Matrix4().makeRotationX(tilt))
      .multiply(new THREE.Matrix4().makeRotationZ(roll))
      .multiply(new THREE.Matrix4().makeTranslation(
        (rng() - 0.5) * size * 0.5, (rng() - 0.5) * size * 0.5, (rng() - 0.5) * size * 0.5))
      .multiply(new THREE.Matrix4().makeScale(s, s * (0.8 + rng() * 0.4), s));
    const jitter = 0.70 + rng() * 0.55;
    hue.copy(tint).multiplyScalar(jitter);
    builder.add(CARD(), m, hue);
  }
}

/* --- species -------------------------------------------------- */
/* Kept deliberately lean. A tree is one tube for the leader, three
   for the main limbs and two more per generation, and every terminal
   tip gets a clump. That is roughly 600 triangles of wood and 200 of
   leaf: enough silhouette to read as a tree at a hundred metres, and
   cheap enough to have eight hundred of them. */
function branchTree(gb, opts) {
  const { rng, height, spread, lean, bark, leaf, cards, levels, tipSize, seed } = opts;
  const LIMBS = opts.limbs || 3;
  const path = [], radii = [];
  const segs = 4;
  const dir = new THREE.Vector3(lean * 0.1, 1, lean * 0.06).normalize();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const wobble = fbm2(t * 3 + seed, 0.3, 2) * 0.16;
    path.push(new THREE.Vector3(
      dir.x * height * t + wobble * height * 0.12 * t,
      height * t * (1 - t * 0.06),
      dir.z * height * t + Math.cos(t * 4 + seed) * height * 0.08 * t
    ));
    // root flare, then a slim taper
    const r = (0.28 + 0.55 * (1 - t) * (1 - t)) * (0.8 + height * 0.055);
    radii.push(r * (1 - t * 0.62) * (t < 0.14 ? 1 + (0.14 - t) * 3.4 : 1));
  }
  gb.add(tube(path, radii, 6), new THREE.Matrix4(), (i) => {
    const c = bark.clone();
    c.multiplyScalar(0.82 + 0.3 * noise2(i * 0.4, seed));
    return c;
  });

  // recursive limbs. Two whorls off the leader and the limbs go out
  // as well as up: a tree is a dome of leaves, not a mushroom.
  const grow = (origin, dirV, len, rad, depth) => {
    const n = 4;
    const p = [origin.clone()], r = [rad];
    const d = dirV.clone().normalize();
    const bendAxis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      d.addScaledVector(bendAxis, 0.2 * (1 - t)).normalize();
      // flatten out as it rises, so the crown spreads
      d.y = lerp(d.y, d.y * 0.55, t);
      d.y = Math.max(d.y, 0.1);
      p.push(p[p.length - 1].clone().addScaledVector(d, len / n));
      r.push(rad * (1 - t * 0.7));
    }
    gb.add(tube(p, r, depth > 1 ? 4 : 3), new THREE.Matrix4(), (i) => {
      const c = bark.clone().multiplyScalar(0.86 + 0.24 * (i / n));
      return c;
    });
    const tip = p[p.length - 1];
    // a clump at the midpoint too, so the inside of the crown is not empty
    if (depth < levels) {
      const mid = p[2];
      clump(gb, new THREE.Matrix4().setPosition(mid.x, mid.y, mid.z),
        tipSize * 0.86, leaf, rng, cards);
    }
    if (depth >= levels) {
      clump(gb, new THREE.Matrix4().setPosition(tip.x, tip.y, tip.z), tipSize, leaf, rng, cards);
      return;
    }
    for (let k = 0; k < 2; k++) {
      const a = (k / 2) * TAU + rng() * 1.7 + depth * 0.9;
      const out = new THREE.Vector3(Math.cos(a) * spread, 0.5 + rng() * 0.45, Math.sin(a) * spread);
      grow(tip, out, len * (0.74 + rng() * 0.18), r[r.length - 1], depth + 1);
    }
  };
  const top = path[path.length - 1];
  for (let k = 0; k < LIMBS; k++) {
    const a = (k / LIMBS) * TAU + rng() * 0.9;
    grow(top, new THREE.Vector3(Math.cos(a) * spread, 0.62 + rng() * 0.35, Math.sin(a) * spread),
      height * (0.4 + rng() * 0.12), 0.16 + height * 0.014, 0);
  }
  // a lower whorl, so the crown has depth and the trunk is not bare
  for (let k = 0; k < 2; k++) {
    const a = (k / 2) * TAU + 1.1 + rng() * 0.8;
    const start = path[Math.max(1, path.length - 3)].clone();
    grow(start, new THREE.Vector3(Math.cos(a) * spread, 0.5, Math.sin(a) * spread),
      height * 0.3, 0.11 + height * 0.01, 1);
  }
  // the crown itself
  clump(gb, new THREE.Matrix4().setPosition(top.x, top.y + tipSize * 0.3, top.z),
    tipSize * 1.5, leaf, rng, cards);
  clump(gb, new THREE.Matrix4().setPosition(top.x, top.y - tipSize * 0.75, top.z),
    tipSize * 1.15, leaf, rng, cards);
}

function willowTree(gb, rng, height, bark, d = 2) {
  const path = [], radii = [];
  const segs = 6;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push(new THREE.Vector3(fbm2(t * 2.4, 9.1, 2) * 0.9 * t, height * t, fbm2(t * 2.4, 3.3, 2) * 0.9 * t));
    radii.push((0.34 + 0.42 * (1 - t) * (1 - t)) * (1 - t * 0.66));
  }
  gb.add(tube(path, radii, 6), new THREE.Matrix4(), () => bark);
  const top = path[path.length - 1];
  const leaf = new THREE.Color(0xc3d47e);
  const nw = d === 0 ? 5 : 7;
  for (let k = 0; k < nw; k++) {
    const a = (k / nw) * TAU + rng();
    const tip = new THREE.Vector3(top.x + Math.cos(a) * height * 0.3, top.y - height * 0.06 + rng() * 0.5, top.z + Math.sin(a) * height * 0.3);
    const p = [new THREE.Vector3(top.x, top.y - 0.2, top.z)], r = [0.14];
    const d = new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize();
    for (let i = 1; i <= 4; i++) {
      p.push(p[p.length - 1].clone().addScaledVector(d, height * 0.12));
      r.push(0.12 * (1 - i * 0.19));
    }
    gb.add(tube(p, r, 3), new THREE.Matrix4(), () => bark);
    // drooping fronds
    const nf = d === 0 ? 2 : 3;
    for (let f = 0; f < nf; f++) {
      const t = 0.3 + f * 0.3;
      const at = p[Math.min(p.length - 1, Math.round(t * 4))];
      const m = new THREE.Matrix4().setPosition(at.x, at.y - 0.1, at.z)
        .multiply(new THREE.Matrix4().makeScale(height * 0.2, height * 0.62, height * 0.2));
      const col = leaf.clone().multiplyScalar(0.82 + rng() * 0.4);
      gb.add(CARD(), m, col);
    }
  }
}

function pineTree(gb, rng, height, bark, d = 2) {
  const path = [], radii = [];
  const segs = 5;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push(new THREE.Vector3(0, height * t, 0));
    radii.push(height * 0.045 * (1 - t * 0.86) * (t < 0.1 ? 1 + (0.1 - t) * 4 : 1));
  }
  gb.add(tube(path, radii, 5), new THREE.Matrix4(), () => bark);
  const dark = new THREE.Color(0x3d6a2f);
  const tiers = d === 0 ? 6 : 8;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = height * (0.22 + t * 0.72);
    const r = height * 0.30 * Math.pow(1 - t, 0.86) + 0.25;
    const cone = new THREE.ConeGeometry(r, height * 0.2, 7, 1);
    cone.translate(0, y + height * 0.06, 0);
    const arr = cone.attributes;
    const gbCone = {
      pos: [], nrm: [], uv: [], idx: []
    };
    const idxArr = cone.index ? cone.index.array : null;
    for (let k = 0; k < arr.position.count; k++) {
      gbCone.pos.push(arr.position.getX(k), arr.position.getY(k), arr.position.getZ(k));
      gbCone.nrm.push(arr.normal.getX(k), arr.normal.getY(k), arr.normal.getZ(k));
      gbCone.uv.push(arr.uv ? arr.uv.getX(k) : 0, arr.uv ? arr.uv.getY(k) : 0);
    }
    if (idxArr) for (const k of idxArr) gbCone.idx.push(k);
    else for (let k = 0; k < arr.position.count; k++) gbCone.idx.push(k);
    cone.dispose();
    gb.add(gbCone, new THREE.Matrix4().multiply(
      new THREE.Matrix4().makeRotationY(rng() * TAU)), () => dark.clone().multiplyScalar(0.7 + rng() * 0.5));
  }
}

function bushTree(gb, rng, height, leaf, spread, d = 2) {
  const path = [], radii = [];
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    path.push(new THREE.Vector3(0, height * 0.42 * t, 0));
    radii.push(height * 0.055 * (1 - t * 0.5));
  }
  const bark = new THREE.Color(0x6b5238);
  gb.add(tube(path, radii, 4), new THREE.Matrix4(), () => bark);
  const top = new THREE.Vector3(0, height * 0.42, 0);
  const nc = d === 0 ? 4 : 6;
  for (let k = 0; k < nc; k++) {
    const a = (k / nc) * TAU + rng() * 0.8;
    const m = new THREE.Matrix4()
      .setPosition(top.x + Math.cos(a) * spread, top.y + height * (0.12 + rng() * 0.3), top.z + Math.sin(a) * spread);
    clump(gb, m, height * (0.5 + rng() * 0.28), leaf, rng, d === 0 ? 2 : 3);
  }
  clump(gb, new THREE.Matrix4().setPosition(top.x, top.y + height * 0.4, top.z),
    height * 0.62, leaf, rng, d === 0 ? 2 : 3);
}

/* --- the species table ----------------------------------------
   `d` is the detail tier: 0 for a phone, 2 for a good desktop.
   A low tier drops branch levels and leaf cards, which is most of
   the triangle budget in the whole scene. */
function sp(height, spread, lean, seed, bark, leaf, tip, s) {
  return {
    2: { height, spread, lean, seed, bark, leaf, tipSize: tip, levels: 2, cards: 4, limbs: 4 },
    1: { height: height * 1.02, spread, lean, seed, bark, leaf, tipSize: tip * 1.06, levels: 1, cards: 3, limbs: 3 },
    0: { height: height * 1.05, spread, lean, seed, bark, leaf, tipSize: tip * 1.14, levels: 1, cards: 2, limbs: 3 }
  };
}

export const SPECIES = {
  oak: {
    make: (rng, d) => { const gb = new GeoBuilder(); branchTree(gb, Object.assign({ rng }, sp(11.5, 0.72, 0.5, 3.1, new THREE.Color(0x6b5238), new THREE.Color(0x74a83e), 3.0)[d])); return gb.build(); },
    barkTex: () => barkTexture('#4b3a27', '#2a2016', '#7a6444'),
    leafTex: () => leafClusterTexture(['#40682a', '#33521f', '#557c33', '#6f9440']),
    s: [0.78, 1.35]
  },
  ash: {
    make: (rng, d) => { const gb = new GeoBuilder(); branchTree(gb, Object.assign({ rng }, sp(12.5, 0.55, 0.2, 8.7, new THREE.Color(0x7d7462), new THREE.Color(0x86bb52), 2.7)[d])); return gb.build(); },
    barkTex: () => barkTexture('#5b5442', '#3a3527', '#8a8270'),
    leafTex: () => leafClusterTexture(['#4b7a34', '#3a6127', '#679148', '#7fa355']),
    s: [0.75, 1.25]
  },
  birch: {
    make: (rng, d) => { const gb = new GeoBuilder(); branchTree(gb, Object.assign({ rng }, sp(9.5, 0.4, -0.3, 14.2, new THREE.Color(0xf2eee2), new THREE.Color(0xa3c463), 2.1)[d])); return gb.build(); },
    barkTex: () => barkTexture('#dedacd', '#a8a496', '#f4f1e6'),
    leafTex: () => leafClusterTexture(['#6c9440', '#557c31', '#87ab55', '#a0bd6a']),
    s: [0.7, 1.2]
  },
  willow: {
    make: (rng, d) => { const gb = new GeoBuilder(); willowTree(gb, rng, 8.0 * (d === 0 ? 1.05 : 1), new THREE.Color(0x77604a), d); return gb.build(); },
    barkTex: () => barkTexture('#4e4030', '#2e251a', '#7a684e'),
    leafTex: () => leafClusterTexture(['#9cb05a', '#84993f', '#b5c470', '#c9d488']),
    s: [0.8, 1.35]
  },
  pine: {
    make: (rng, d) => { const gb = new GeoBuilder(); pineTree(gb, rng, 15.0 * (d === 0 ? 1.06 : 1), new THREE.Color(0x5e4a33), d); return gb.build(); },
    barkTex: () => barkTexture('#3d2f20', '#231a12', '#5e4a33'),
    leafTex: () => leafClusterTexture(['#25401f', '#1b3118', '#33532a']),
    s: [0.7, 1.3]
  },
  apple: {
    make: (rng, d) => { const gb = new GeoBuilder(); bushTree(gb, rng, 4.4, new THREE.Color(0x7cb03e), 1.05, d); return gb.build(); },
    barkTex: () => barkTexture('#54402e', '#33261a', '#826845'),
    leafTex: () => leafClusterTexture(['#46702c', '#375a22', '#628c3c', '#7aa24a']),
    s: [0.8, 1.2]
  },
  cherry: {
    make: (rng, d) => { const gb = new GeoBuilder(); bushTree(gb, rng, 4.0, new THREE.Color(0xa2c058), 1.15, d); return gb.build(); },
    barkTex: () => barkTexture('#4e3a2a', '#2e2216', '#7a5f3e'),
    leafTex: () => leafClusterTexture(['#6a8a3c', '#54702e', '#88a552', '#a0b866']),
    s: [0.8, 1.2]
  },
  rowan: {
    make: (rng, d) => { const gb = new GeoBuilder(); bushTree(gb, rng, 5.2, new THREE.Color(0x92bd4e), 1.3, d); return gb.build(); },
    barkTex: () => barkTexture('#4a3a2a', '#2a2016', '#78603f'),
    leafTex: () => leafClusterTexture(['#5c8236', '#476629', '#7a9c4a', '#93ad5c']),
    s: [0.85, 1.15]
  }
};

/* --- scatter -------------------------------------------------- */
const CLUMPS = [
  // a copse of oaks out west, where the Old Forest begins to matter
  { kind: 'oak', x: -300, z: 210, r: 62, n: 26, spread: 46 },
  { kind: 'oak', x: -348, z: 60, r: 54, n: 20, spread: 40 },
  { kind: 'oak', x: -240, z: 300, r: 50, n: 16, spread: 38 },
  { kind: 'oak', x: 340, z: 330, r: 58, n: 18, spread: 44 },
  { kind: 'oak', x: -60, z: -300, r: 62, n: 18, spread: 46 },
  { kind: 'ash', x: 150, z: -280, r: 70, n: 22, spread: 54 },
  { kind: 'ash', x: -180, z: -260, r: 66, n: 18, spread: 50 },
  { kind: 'birch', x: 60, z: -350, r: 90, n: 26, spread: 70 },
  { kind: 'birch', x: 330, z: -180, r: 66, n: 16, spread: 50 },
  { kind: 'ash', x: -330, z: -120, r: 48, n: 12, spread: 38 }
];

export class Trees {
  constructor(field, plan, quality) {
    this.field = field;
    this.plan = plan;
    this.quality = quality;
    this.detail = quality.name === 'high' ? 2 : quality.name === 'medium' ? 1 : 0;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.colliders = [];
    this.lanternAnchors = [];

    const rng = makeRng(20260929);
    const byKind = new Map();
    const add = (kind, x, z, s, rot, extra) => {
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push({ x, z, s, rot, ...extra });
    };

    /* --- the hedgerow and copse trees ------------------------- */
    const budget = quality.trees;
    for (const c of CLUMPS) {
      const count = Math.round(c.n * budget);
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU, rr = Math.pow(rng(), 0.55) * c.spread;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        if (!this._ok(x, z, 1.2)) continue;
        add(c.kind, x, z, lerp(c.spread ? 0.8 : 0.8, 1.3, rng()) * (0.85 + rng() * 0.3), rng() * TAU);
      }
    }

    /* --- willows, hugging the Water --------------------------- */
    const river = [];
    for (let i = 0; i < 1500; i++) {
      const x = (rng() * 2 - 1) * 380;
      const z = (rng() * 2 - 1) * 380;
      const r = riverAt(x, z);
      if (r.d > r.width * 2.9 || r.d < r.width * 1.05) continue;
      if (!this._ok(x, z, 1.6)) continue;
      river.push({ x, z });
    }
    for (const p of river) add('willow', p.x, p.z, lerp(0.75, 1.25, rng()), rng() * TAU);

    /* --- the Old Forest edge, east ----------------------------- */
    const eastN = Math.round(190 * budget);
    for (let i = 0; i < eastN; i++) {
      const x = 200 + Math.pow(rng(), 0.7) * 190 + rng() * 40;
      const z = (rng() * 2 - 1) * 380;
      if (!this._ok(x, z, 2.0)) continue;
      add(rng() < 0.72 ? 'pine' : 'ash', x, z, lerp(0.85, 1.35, rng()), rng() * TAU);
    }
    // and the dark band beyond
    const deepN = Math.round(150 * budget);
    for (let i = 0; i < deepN; i++) {
      const x = 340 + rng() * 60;
      const z = (rng() * 2 - 1) * 400;
      if (!this._ok(x, z, 2.4)) continue;
      add('pine', x, z, lerp(0.9, 1.4, rng()), rng() * TAU);
    }
    // a northern treeline, so the Misty Mountains have a foreground
    const northN = Math.round(140 * budget);
    for (let i = 0; i < northN; i++) {
      const x = (rng() * 2 - 1) * 390;
      const z = -300 - rng() * 90;
      if (!this._ok(x, z, 2.2)) continue;
      add(rng() < 0.5 ? 'pine' : 'ash', x, z, lerp(0.8, 1.3, rng()), rng() * TAU);
    }

    /* --- a general scatter, so nothing looks planted ------------ */
    const scatN = Math.round(430 * budget);
    for (let i = 0; i < scatN; i++) {
      const x = (rng() * 2 - 1) * 372;
      const z = (rng() * 2 - 1) * 372;
      const l = this.field;
      const d = l.grassAt(x, z);
      if (d < 0.28) continue;
      if (rng() > 0.35 + d * 0.5) continue;
      if (!this._ok(x, z, 2.6)) continue;
      const r = riverAt(x, z);
      if (r.d < r.width * 1.4) continue;
      const kind = rng() < 0.5 ? 'oak' : (rng() < 0.6 ? 'ash' : 'birch');
      add(kind, x, z, lerp(0.6, 1.1, rng()), rng() * TAU);
    }

    /* --- the Party Tree, and Sam's rowan ------------------------ */
    add(plan.partyTree.kind, plan.partyTree.x, plan.partyTree.z, plan.partyTree.s, plan.partyTree.rot, { landmark: 'partytree' });
    add(plan.rowan.kind, plan.rowan.x, plan.rowan.z, plan.rowan.s, plan.rowan.rot, { landmark: 'rowan' });
    for (const t of plan.orchard.trees) add(t.kind, t.x, t.z, t.s, t.rot, { orchard: true });

    this._all = [];
    for (const list of byKind.values()) this._all.push(...list);
    for (const t of this._all) {
      if (t.s > 0.8 || t.landmark) {
        this.colliders.push({ x: t.x, z: t.z, r: 0.36 * t.s + 0.32, tall: true });
      }
    }

    /* --- build one InstancedMesh per species, per patch -----------
       The county is 800 m across. If every oak lived in a single
       InstancedMesh, the whole forest would be submitted every
       frame whether or not you could see it. So the map is cut
       into 200 m patches and each species is instanced per patch:
       the draw calls are grouped, and the ones behind you are
       simply not there. */
    const PATCH = 200;
    const patchOf = (x, z) => {
      const i = clamp(Math.floor((x + 400) / PATCH), 0, 3);
      const j = clamp(Math.floor((z + 400) / PATCH), 0, 3);
      return j * 4 + i;
    };
    const barkMat = new Map();
    const leafMat = new Map();
    this.meshes = [];
    let total = 0;
    const PATCHES = 16;

    for (const [kind, list] of byKind) {
      if (!list.length) continue;
      const spec = SPECIES[kind];
      const geo = spec.make(makeRng(kind.length * 977 + 13), this.detail);
      const y0 = this.field.height(list[0].x, list[0].z);
      geo.translate(0, -y0, 0);   // so the instance matrix can use a plain y

      if (!barkMat.has(kind)) {
        const bt = spec.barkTex();
        barkMat.set(kind, new THREE.MeshStandardMaterial({
          map: bt, color: 0xffffff, roughness: 0.94, metalness: 0, vertexColors: true
        }));
      }
      if (!leafMat.has(kind)) {
        const lt = spec.leafTex();
        leafMat.set(kind, new THREE.MeshStandardMaterial({
          map: lt, alphaTest: 0.30, side: THREE.DoubleSide,
          roughness: 0.86, metalness: 0, vertexColors: true, dithering: true
        }));
      }

      for (let patch = 0; patch < PATCHES; patch++) {
        const inPatch = list.filter(t => patchOf(t.x, t.z) === patch);
        if (!inPatch.length) continue;
        for (const [mat, isLeaf] of [[barkMat.get(kind), false], [leafMat.get(kind), true]]) {
          const inst = new THREE.InstancedMesh(geo, mat, inPatch.length);
          inst.name = `tree-${kind}-${isLeaf ? 'leaf' : 'wood'}-${patch}`;
          inst.castShadow = quality.shadowsTrees && !isLeaf;
          inst.receiveShadow = true;
          inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const axis = new THREE.Vector3(0, 1, 0);
          const pos = new THREE.Vector3();
          const scl = new THREE.Vector3();
          const col = new THREE.Color();
          for (let i = 0; i < inPatch.length; i++) {
            const t = inPatch[i];
            const y = this.field.height(t.x, t.z);
            pos.set(t.x, y - 0.25, t.z);
            q.setFromAxisAngle(axis, t.rot);
            const wob = 0.94 + 0.12 * hash2(Math.round(t.x), Math.round(t.z));
            scl.set(t.s * wob, t.s * (0.95 + 0.12 * hash2(Math.round(t.z), Math.round(t.x))), t.s * wob);
            m.compose(pos, q, scl);
            inst.setMatrixAt(i, m);
            const v = 0.86 + 0.28 * hash2(i * 3 + kind.length, i);
            col.setRGB(v, v * (0.97 + 0.08 * hash2(i, 5)), v * 0.96);
            inst.setColorAt(i, col);
            if (t.landmark === 'partytree' && isLeaf) {
              this.lanternAnchors.push({ x: t.x, y: y + t.s * 6.2, z: t.z, s: t.s });
            }
          }
          inst.instanceMatrix.needsUpdate = true;
          if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.frustumCulled = true;
          this.group.add(inst);
          this.meshes.push(inst);
          total += inPatch.length;
        }
      }
    }
    this.total = total;
  }

  _ok(x, z, pad) {
    if (Math.abs(x) > 396 || Math.abs(z) > 396) return false;
    if (this.plan.inExclusion(x, z, pad)) return false;
    if (roadAt(x, z) < 5.2) return false;
    const r = riverAt(x, z);
    if (r.d < r.width * 1.15) return false;
    return true;
  }

  /** Trunks you can walk into — only the big ones. */
  colliderList() {
    const out = [];
    for (const t of this._all) {
      if (t.s > 0.8 || t.landmark) {
        out.push({ x: t.x, z: t.z, r: 0.36 * t.s + 0.32, tall: true });
      }
    }
    return out;
  }

  update() {}
  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.material.dispose(); }
  }
}

export { turfTexture, willowFrondTexture, smoothstep, clamp };
