/* ============================================================
   terrain.js — the ground, the horizon, and the mountains.

   Three pieces:
     1. inner  — an 800 m grid at 2 m, split-splatted in the
                 fragment shader (turf / rock / road / crop /
                 mud) off the shared field texture.
     2. ring   — a low-resolution annulus out to 2.6 km so the
                 land never just stops.
     3. ridges — the Misty Mountains and the other far ranges,
                 as unlit haze-tinted curtains.
   ============================================================ */

import * as THREE from 'three';
import {
  WORLD, RIDGES, TAU, clamp, lerp, smoothstep, makeRng
} from './constants.js';
import { heightAt, baseHeight, fbm2, ridge2, Field } from './noise.js';
import { turfTexture, waterNormalTexture, forestBandTexture } from './textures.js';

/* ------------------------------------------------------------
   The shared GLSL. Both the inner terrain and the ring use it,
   so they cannot drift apart.
   ------------------------------------------------------------ */
const SPLAT_PARS = /* glsl */`
  uniform sampler2D uField;
  uniform sampler2D uMask;
  uniform sampler2D uDetail;
  uniform sampler2D uTurb;
  uniform float uSpan;
  uniform float uTime;
  uniform float uWetness;
  uniform float uRock;
  uniform vec3  uHaze;
  varying vec3  vWPos;
  varying vec3  vWNrm;

  vec2 fieldUv(vec2 p) { return clamp(p / (uSpan * 2.0) + 0.5, 0.002, 0.998); }
  vec4 fieldAt(vec2 p) { return texture2D(uField, fieldUv(p)); }
  vec4 maskAt(vec2 p)  { return texture2D(uMask,  fieldUv(p)); }
  float fbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * (texture2D(uDetail, p).g - 0.5) * 2.0;
      p = p * 2.03 + vec2(0.31, -0.17);
      a *= 0.5;
    }
    return v;
  }
`;

const VERT_PARS = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vWNrm;
  uniform float uSpan;
`;

const VERT_BODY = /* glsl */`
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWPos = wp.xyz;
  vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = SPLAT_PARS;

const FRAG_BODY = /* glsl */`
  vec3 WN = normalize(vWNrm);
  vec2 P = vWPos.xz;
  // Two planes, blended by steepness. On anything near-vertical — the
  // face of a hobbit-hole mound, a scarp, the flank of the Hill — a
  // single XZ projection stretches into vertical streaks, because X and
  // Z barely change while Y runs away. Rolling the horizontal axis
  // through by height gives the face its own, correct, coordinates.
  float steepness = clamp(1.0 - WN.y, 0.0, 1.0);
  vec2 Pwall = vec2(vWPos.x + vWPos.z, vWPos.y * 0.85);
  float wBlend = smoothstep(0.30, 0.72, steepness);
  vec2 Puv = mix(P, Pwall, wBlend);
  // keep the ground plane's own coordinates for the field lookup
  vec2 Pg = P;

  float inside = step(max(abs(Pg.x), abs(Pg.y)), uSpan - 1.0);
  vec4 F = fieldAt(Pg);        // r height, g grass, b crop, a road
  vec4 M = maskAt(Pg);         // r wet,   g ao,   b water
  float gh = F.r * 100.0;
  float slope = steepness;

  // --- detail normal, from the tiling noise map ------------------
  vec2 duv = Puv * 0.42;
  float b0 = texture2D(uDetail, duv).g;
  float bx = texture2D(uDetail, duv + vec2(0.011, 0.0)).g;
  float bz = texture2D(uDetail, duv + vec2(0.0, 0.011)).g;
  vec3 up = abs(WN.y) > 0.985 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 T = normalize(cross(up, WN));
  vec3 B = cross(WN, T);
  float bumpAmt = 1.35 * (1.0 - smoothstep(0.05, 0.42, slope));
  vec3 Nw = normalize(WN - (T * (bx - b0) + B * (bz - b0)) * bumpAmt);

  // --- turf layers ------------------------------------------------
  vec3 turfA = texture2D(uTurb, Puv * 0.0075).rgb;   // the shape of the county
  vec3 turfB = texture2D(uTurb, Puv * 0.041).rgb;    // fields and hollows
  vec3 turfC = texture2D(uTurb, Puv * 0.185).rgb;    // within a stride
  vec3 turfD = texture2D(uTurb, Puv * 0.72).rgb;     // under your boots
  float macro = fbm3(Puv * 0.0031);
  float meso  = fbm3(Puv * 0.019);
  float fine  = fbm3(Puv * 0.085);
  vec3 grass = mix(turfA, turfB, 0.40 + 0.22 * (meso * 0.5 + 0.5));
  grass = mix(grass, turfC, 0.28);
  grass = mix(grass, turfD, 0.16 * (0.5 + 0.5 * fine));
  // sun-bleached ridges vs damp hollows, gently
  grass *= mix(vec3(1.09, 1.06, 0.86), vec3(0.84, 0.94, 0.80),
               clamp(gh / 70.0 + macro * 0.25, 0.0, 1.0));
  // and a last break-up so a big flat field is never one flat value
  grass *= 0.90 + 0.20 * fine;

  // meadow flowers, only in the good grass
  float fl = texture2D(uTurb, Puv * 0.27 + vec2(0.37, 0.11)).r;
  fl = smoothstep(0.74, 0.95, fl) * smoothstep(0.35, 0.9, F.g) * (1.0 - smoothstep(0.3, 0.03, slope));
  grass = mix(grass, mix(vec3(0.94, 0.91, 0.7), vec3(0.86, 0.79, 0.92), step(0.86, fl)), fl * 0.5);

  // --- rock on the steep ground ----------------------------------
  // (uRock is 0 on the hobbit-hole mounds: their whole front is a
  // steep face of turf, which is the entire point of a hobbit hole)
  float rock = smoothstep(0.36, 0.70, slope + macro * 0.06) * uRock;
  vec3 stone = mix(vec3(0.40, 0.38, 0.34), turfB * 0.85, 0.3);
  stone *= 0.72 + 0.55 * texture2D(uTurb, Puv * 0.29 + vec2(0.7, 0.2)).b;
  vec3 col = mix(grass, stone, rock);

  // --- the Fields: crop rows east of Hobbiton ---------------------
  // A patchwork, not a wheat desert: mostly green, going to gold in
  // patches, with the rows and the hedges doing the dividing.
  float crop = F.b * inside * (1.0 - rock);
  float pick = fract(dot(P, vec2(0.0043, 0.0037)) * 0.5 + 0.31);
  vec3 cropCol = pick < 0.30 ? vec3(0.37, 0.34, 0.175)  // barley, going gold
              : pick < 0.58 ? vec3(0.21, 0.30, 0.145)  // kale
              : pick < 0.80 ? vec3(0.27, 0.33, 0.165)  // young wheat
                            : vec3(0.225, 0.275, 0.14); // turnip
  cropCol *= 0.92 + 0.08 * sin(dot(P, vec2(2.7, 0.35)) + macro * 2.0);
  cropCol *= 0.86 + 0.26 * fbm3(P * 0.09);
  col = mix(col, cropCol, crop * 0.88);

  // --- wet ground and the river's edge ---------------------------
  float wet = M.r * inside;

  // --- the road: pale trodden dirt with ruts ----------------------
  float road = F.a * inside;
  float rut = 0.5 + 0.5 * sin(dot(P, normalize(vec2(0.82, 0.57))) * 3.4);
  vec3 dirt = mix(vec3(0.40, 0.33, 0.235), vec3(0.50, 0.42, 0.30), fbm3(Puv * 0.16) * 0.5 + 0.5);
  dirt *= 0.90 + 0.18 * rut;
  dirt = mix(dirt, vec3(0.29, 0.24, 0.17), smoothstep(0.6, 0.98, rut) * 0.30);
  col = mix(col, dirt, road * 0.93 * (1.0 - wet * 0.4));

  vec3 mud = mix(vec3(0.28, 0.22, 0.14), vec3(0.38, 0.33, 0.22), texture2D(uTurb, Puv * 0.55).r);
  col = mix(col, mud, wet * 0.9 * uWetness);

  // --- aerial perspective ----------------------------------------
  // Beyond the field texture it is the same turf, just more of the
  // haze in it; and the further you look the more of it there is.
  float d2 = length(P);
  float air = max((1.0 - inside) * 0.26, smoothstep(1200.0, 3400.0, d2) * 0.46);
  col = mix(col, uHaze * 0.88, air);

  // --- cloud shadows, drifting downwind -------------------------
  // The single cheapest thing that stops a big landscape reading as
  // a big flat plane of one colour.
  float cs = fbm3(P * 0.0019 + vec2(uTime * 0.0055, uTime * 0.0026));
  cs = smoothstep(0.06, 0.66, cs);
  col *= 0.70 + 0.38 * cs;

  // --- wetness sheen ---------------------------------------------
  col *= 1.0 - wet * uWetness * (0.2 + 0.2 * Nw.y);

  diffuseColor.rgb *= col;
`;

function makeDataTex(data, res) {
  const t = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class Terrain {
  constructor(field, quality) {
    this.field = field;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'terrain';

    this.haze = new THREE.Color(0.5, 0.6, 0.7);
    this._buildMaterials();
    this._buildInner();
    this._buildRing();
    this._buildTreeline();
    this._buildRidges();
  }

  _buildMaterials() {
    this.fieldTexture = makeDataTex(this.field.data, this.field.res);
    this.maskTexture = makeDataTex(this.field.data2, this.field.res);
    // the grass shader samples the very same texture
    this.field.texture = this.fieldTexture;

    this.turb = turfTexture();
    this.detail = waterNormalTexture();

    this.material = this.splatMaterial({ ao: true });
    this.material.name = 'shire-ground';
  }

  /**
   * The ground shader. The mounds that roof the hobbit holes use the
   * same one, so the turf runs straight over the top of Bag End with
   * no seam — only the baked occlusion is left off for them.
   */
  splatMaterial({ ao = true, rock = 1, name = 'shire-splat' } = {}) {
    // Lambert, not Standard. The ground is the largest surface in the
    // scene and it has no business having a specular highlight: a sun
    // glinting off a hillside at grazing incidence blows out a white
    // sheet across the whole county. Lambert is also markedly cheaper.
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      dithering: true
    });
    mat.fog = true;
    const uniforms = {
      uField: { value: this.fieldTexture },
      uMask: { value: this.maskTexture },
      uDetail: { value: this.detail },
      uTurb: { value: this.turb },
      uSpan: { value: this.field.span },
      uTime: { value: 0 },
      uWetness: { value: 1 },
      uRock: { value: rock },
      uHaze: { value: this.haze }
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <fog_vertex>', VERT_BODY + '\n#include <fog_vertex>');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_BODY);
      if (ao) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>',
          `#include <aomap_fragment>
           float _in = step(max(abs(vWPos.x), abs(vWPos.z)), uSpan - 1.0);
           float _baked = mix(1.0, 0.42 + 0.58 * maskAt(vWPos.xz).g, _in);
           reflectedLight.indirectDiffuse *= _baked;
           reflectedLight.indirectSpecular *= _baked;
          `);
      }
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () => name;
    this.uniforms = uniforms;
    return mat;
  }
  _buildInner() {
    const seg = this.quality.seg;
    const span = WORLD.inner;
    const step = (span * 2) / seg;
    const n = seg + 1;
    const count = n * n;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const idx = new Uint32Array(seg * seg * 6);

    const H = new Float32Array(count);
    for (let j = 0; j < n; j++) {
      const z = -span + j * step;
      for (let i = 0; i < n; i++) {
        const x = -span + i * step;
        const k = j * n + i;
        const h = this.field.height(x, z);
        H[k] = h;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        uv[k * 2] = (x + span) / (span * 2);
        uv[k * 2 + 1] = (z + span) / (span * 2);
      }
    }
    // normals straight from the grid, so they match the geometry exactly
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const l = H[j * n + Math.max(0, i - 1)];
        const r = H[j * n + Math.min(n - 1, i + 1)];
        const d = H[Math.max(0, j - 1) * n + i];
        const u = H[Math.min(n - 1, j + 1) * n + i];
        const nx = l - r, nz = d - u, ny = 2 * step;
        const l2 = Math.hypot(nx, ny, nz) || 1;
        nrm[k * 3] = nx / l2;
        nrm[k * 3 + 1] = ny / l2;
        nrm[k * 3 + 2] = nz / l2;
      }
    }
    let o = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'ground';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    this.inner = mesh;
    this.group.add(mesh);
  }

  _buildRing() {
    // Rings of increasing radius; the hole is exactly the inner square.
    const inner = WORLD.inner * 1.0;
    const outer = WORLD.annulus;
    const rings = this.quality.seg > 260 ? 46 : 30;
    const segs = this.quality.seg > 260 ? 128 : 80;
    const vpr = segs + 1;
    const count = rings * vpr;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    const idx = new Uint32Array((rings - 1) * segs * 6);

    const radiusAt = (r) => inner * Math.pow(outer / inner, r / (rings - 1));

    for (let r = 0; r < rings; r++) {
      const rad = radiusAt(r);
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        // square off the first ring to meet the inner grid's border exactly
        let x = ca * rad, z = sa * rad;
        if (r === 0) {
          const m = Math.max(Math.abs(ca), Math.abs(sa));
          x = ca / m * inner;
          z = sa / m * inner;
        }
        const y = r === 0 ? this.field.height(clamp(x, -WORLD.inner + 1, WORLD.inner - 1), clamp(z, -WORLD.inner + 1, WORLD.inner - 1)) : heightAt(x, z);
        const k = r * vpr + s;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const k = r * vpr + s;
        // the ring is broad and almost flat, so its shading is simply
        // its up vector. Deriving it from the triangles gives zero
        // normals along the degenerate first ring, and those become
        // NaNs that paint half the horizon white.
        nrm[k * 3] = 0; nrm[k * 3 + 1] = 1; nrm[k * 3 + 2] = 0;
        const k2 = r * vpr + ((s + 1) % segs);
        nrm[k2 * 3] = 0; nrm[k2 * 3 + 1] = 1; nrm[k2 * 3 + 2] = 0;
      }
    }
    let o = 0;
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < segs; s++) {
        const s2 = (s + 1) % segs;
        const a = r * vpr + s, b = r * vpr + s2;
        const c = (r + 1) * vpr + s, d = (r + 1) * vpr + s2;
        // wound so the face points at the sky
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mat = this.material;
    const ring = new THREE.Mesh(geo, mat);
    ring.name = 'far-ground';
    ring.matrixAutoUpdate = false;
    ring.receiveShadow = false;
    this.ring = ring;
    this.group.add(ring);
  }

  _buildTreeline() {
    // The films always put woodland between the fields and the
    // mountains. Without it the far half of the county is a bare
    // plate of one colour and reads, wrongly, as a lake.
    const g = new THREE.Group();
    g.name = 'treeline';
    const bands = [
      { r: 560, h: 34, tint: 0x33501f, rep: 26, y: -4 },
      { r: 880, h: 46, tint: 0x2c4520, rep: 20, y: -6 },
      { r: 1450, h: 58, tint: 0x33482a, rep: 15, y: -8 }
    ];
    for (const b of bands) {
      const segs = 220;
      const pos = new Float32Array((segs + 1) * 2 * 3);
      const uv = new Float32Array((segs + 1) * 2 * 2);
      const idx = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        const x = Math.cos(a) * b.r, z = Math.sin(a) * b.r;
        const y0 = heightAt(x, z) + b.y;
        const k = i * 2;
        pos[k * 3] = x; pos[k * 3 + 1] = y0; pos[k * 3 + 2] = z;
        pos[(k + 1) * 3] = x; pos[(k + 1) * 3 + 1] = y0 + b.h; pos[(k + 1) * 3 + 2] = z;
        uv[k * 2] = (i / segs) * b.rep; uv[k * 2 + 1] = 0;
        uv[(k + 1) * 2] = (i / segs) * b.rep; uv[(k + 1) * 2 + 1] = 1;
        if (i < segs) {
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mat = new THREE.MeshBasicMaterial({
        map: forestBandTexture(),
        color: b.tint,
        transparent: true,
        alphaTest: 0.34,
        side: THREE.DoubleSide,
        depthWrite: true,
        fog: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -4;
      g.add(mesh);
    }
    this.treeline = g;
    this.group.add(g);
  }

  _buildRidges() {
    const g = new THREE.Group();
    g.name = 'ridges';
    const haze = this.haze;

    for (const R of RIDGES) {
      const steps = 90;
      const cols = 2;
      const vpr = steps + 1;
      const count = vpr * 2;
      const pos = new Float32Array(count * 3);
      const colA = new Float32Array(count * 3);
      const idx = [];
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const spread = (u - 0.5) * (R.width / R.dist) * 2.0;
        const ang = R.bearing + spread;
        const dist = R.dist * (0.86 + 0.28 * fbm2(u * 6 + R.bearing * 10, 0.5, 3) * 0.5 + 0.5);
        const cx = Math.sin(ang) * dist;
        const cz = -Math.cos(ang) * dist;
        // ridge profile: a few big massifs with sharp tops
        const shape = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) * 2, 1.6)), 0.75);
        const peaks = ridge2(u * 5.2 + R.bearing * 3, 0.5, 4, 2.1, 0.52);
        const detail = ridge2(u * 17 + R.bearing * 7, 3.1, 3, 2.2, 0.5);
        const hh = R.height * shape * (0.42 + peaks * 0.86) * (0.85 + detail * 0.3 * R.rough);
        const k = s;
        pos[k * 3] = cx; pos[k * 3 + 1] = -60; pos[k * 3 + 2] = cz;
        pos[(vpr + k) * 3] = cx; pos[(vpr + k) * 3 + 1] = hh; pos[(vpr + k) * 3 + 2] = cz;
        // haze at the base, rock and snow at the top
        const snow = R.snow * smoothstep(0.55, 0.92, hh / (R.height || 1));
        const cr = lerp(0.42, 0.86, snow), cg = lerp(0.45, 0.9, snow), cb = lerp(0.52, 0.98, snow);
        colA[k * 3] = cr; colA[k * 3 + 1] = cg; colA[k * 3 + 2] = cb;
        colA[(vpr + k) * 3] = cr * 0.9; colA[(vpr + k) * 3 + 1] = cg * 0.9; colA[(vpr + k) * 3 + 2] = cb * 0.95;
      }
      for (let s = 0; s < steps; s++) {
        const a = s, b = s + 1, c = vpr + s, d = vpr + s + 1;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      void cols;

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uHaze: { value: haze },
          uSnow: { value: R.snow },
          uBase: { value: R.height }
        },
        vertexShader: /* glsl */`
          varying vec3 vC;
          varying float vY;
          void main() {
            vC = color;
            vY = position.y;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */`
          uniform vec3 uHaze;
          uniform float uSnow;
          varying vec3 vC;
          varying float vY;
          void main() {
            // Aerial perspective: a far ridge is not a white cut-out.
            // It is the sky's own colour, a little deeper and bluer,
            // with the rock showing through only near the summits.
            float up = smoothstep(-40.0, 240.0, vY);
            vec3 rock = mix(vec3(0.16, 0.19, 0.26), vec3(0.34, 0.37, 0.44), up);
            float snow = uSnow * smoothstep(0.74, 0.99, up) * smoothstep(0.35, 0.8, up * 1.3);
            vec3 c = mix(rock, vec3(0.86, 0.90, 0.98), snow * 0.85);
            // the base of the range is always lost in air
            float low = 1.0 - smoothstep(-30.0, 130.0, vY);
            c = mix(c, uHaze * 0.96, 0.30 + low * 0.55);
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        vertexColors: true,
        side: THREE.DoubleSide,
        depthWrite: true,
        fog: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -5;
      g.add(mesh);
    }
    this.ridges = g;
    this.group.add(g);
  }

  /* ------------------------------------------------------------ */
  setHaze(color) { this.haze.copy(color); }
  setWetness(v) { this.uniforms.uWetness.value = v; }
  update(t) { this.uniforms.uTime.value = t; }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.material.dispose();
    this.fieldTexture.dispose();
    this.maskTexture.dispose();
  }
}

export { Field, heightAt, baseHeight };
