/* ============================================================
   water.js — the Water, and its tributary.

   A ribbon mesh swept along the river spline, with the surface
   height taken from the same node levels the terrain was carved
   against. Shallow water shows the bed; deep water goes to a
   cold green-black; the sun lays a track of light along it.
   ============================================================ */

import * as THREE from 'three';
import { RIVER, TRIBUTARY, TAU, clamp, lerp, smoothstep } from './constants.js';
import { riverAt } from './noise.js';
import { waterNormalTexture } from './textures.js';

function resample(points, step) {
  // Walk the polyline and emit evenly spaced nodes with tangents.
  const out = [];
  let carry = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({
        x: lerp(a[0], b[0], t),
        z: lerp(a[1], b[1], t),
        level: lerp(a[2], b[2], t),
        w: lerp(a[3], b[3], t),
        tx: dx / len, tz: dz / len
      });
    }
    carry = n;
  }
  void carry;
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last[0] - prev[0], dz = last[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  out.push({ x: last[0], z: last[1], level: last[2], w: last[3], tx: dx / len, tz: dz / len });
  return out;
}

function extend(nodes, count, step) {
  const head = [];
  for (let i = count; i >= 1; i--) {
    const a = nodes[0], b = nodes[1];
    head.unshift({
      x: a.x - a.tx * step * i,
      z: a.z - a.tz * step * i,
      level: a.level + (a.level - b.level) / Math.max(1e-3, Math.hypot(b.x - a.x, b.z - a.z)) * step * i * 0.6,
      w: a.w * (1 + i * 0.06),
      tx: a.tx, tz: a.tz
    });
  }
  const tail = [];
  const n = nodes.length;
  for (let i = 1; i <= count; i++) {
    const a = nodes[n - 1], b = nodes[n - 2];
    tail.push({
      x: a.x + a.tx * step * i,
      z: a.z + a.tz * step * i,
      level: a.level - (b.level - a.level) / Math.max(1e-3, Math.hypot(b.x - a.x, b.z - a.z)) * step * i * 0.6,
      w: a.w * (1 + i * 0.05),
      tx: a.tx, tz: a.tz
    });
  }
  return head.concat(nodes, tail);
}

export class Water {
  constructor(field, quality, sky) {
    this.field = field;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.meshes = [];

    const step = 780 / quality.waterSegments;
    const cross = 7;
    const a = extend(resample(RIVER, step), 7, step);
    const b = extend(resample(TRIBUTARY, step), 5, step);
    this._ribbon(a, cross, 1.0);
    this._ribbon(b, 5, 0.85);

    this.normalMap = waterNormalTexture();
    this.uniforms = {
      uTime: { value: 0 },
      uNormal: { value: this.normalMap },
      uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
      uNight: { value: 0 },
      uFogCol: { value: new THREE.Color(0.7, 0.8, 0.9) },
      uFogDensity: { value: 0.0016 },
      uCam: { value: new THREE.Vector3() },
      uShallow: { value: new THREE.Color(0.30, 0.36, 0.28) },
      uDeep: { value: new THREE.Color(0.035, 0.085, 0.10) }
    };
    this.material = this._material();
    for (const g of this._geoms) {
      const m = new THREE.Mesh(g, this.material);
      m.renderOrder = 4;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.group.add(m);
      this.meshes.push(m);
    }
    this._geoms.length = 0;
    void sky;
  }

  _ribbon(nodes, cross, widthScale) {
    const n = nodes.length;
    const vpr = cross + 1;
    const count = n * vpr;
    const pos = new Float32Array(count * 3);
    const depth = new Float32Array(count);
    const flow = new Float32Array(count * 2);
    const side = new Float32Array(count);
    const idx = new Uint32Array((n - 1) * cross * 6);

    for (let i = 0; i < n; i++) {
      const nd = nodes[i];
      const px = -nd.tz, pz = nd.tx;               // perpendicular
      for (let s = 0; s <= cross; s++) {
        const u = s / cross;
        const w = nd.w * widthScale * (1 + 0.28 * Math.sin(u * Math.PI) * 0);
        // widen at the very ends so the water runs off the map
        const off = (u - 0.5) * 2 * w;
        const x = nd.x + px * off;
        const z = nd.z + pz * off;
        const ground = riverAt(x, z);
        const k = i * vpr + s;
        pos[k * 3] = x;
        pos[k * 3 + 1] = nd.level;
        pos[k * 3 + 2] = z;
        depth[k] = Math.max(0, nd.level - (ground.level - 1.4));
        flow[k * 2] = nd.tx;
        flow[k * 2 + 1] = nd.tz;
        side[k] = u * 2 - 1;
      }
    }
    let o = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < cross; s++) {
        const a = i * vpr + s, b = a + 1, c = (i + 1) * vpr + s, d = c + 1;
        idx[o++] = a; idx[o++] = c; idx[o++] = b;
        idx[o++] = b; idx[o++] = c; idx[o++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    if (!this._geoms) this._geoms = [];
    this._geoms.push(geo);
  }

  _material() {
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */`
        uniform float uTime;
        attribute float aDepth;
        attribute vec2  aFlow;
        attribute float aSide;
        varying vec3 vWPos;
        varying float vDepth;
        varying vec2 vFlow;
        varying float vSide;
        varying vec3 vView;
        void main() {
          vWPos = position;
          vDepth = aDepth;
          vFlow = aFlow;
          vSide = aSide;
          vec3 p = position;
          // long swell down the channel, faster in the middle
          float mid = 1.0 - abs(aSide);
          float t = uTime;
          float sw = sin(dot(p.xz, aFlow) * 0.55 - t * 1.5) * 0.035
                   + sin(dot(p.xz, vec2(-aFlow.y, aFlow.x)) * 0.9 + t * 0.9) * 0.02;
          p.y += sw * mid * smoothstep(0.0, 0.5, aDepth);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uNormal;
        uniform float uTime;
        uniform vec3 uZenith, uHorizon, uSunCol, uSunDir, uFogCol, uCam;
        uniform vec3 uShallow, uDeep;
        uniform float uFogDensity, uNight;
        varying vec3 vWPos;
        varying float vDepth;
        varying vec2 vFlow;
        varying float vSide;
        varying vec3 vView;

        void main() {
          float depth = vDepth;
          if (depth < 0.005) discard;

          vec2 fp = vFlow;
          vec2 pp = vec2(-fp.y, fp.x);
          float t = uTime;

          // A long, slow swell underneath the chop. Two hundred
          // metres out the fine ripple is smaller than a pixel and
          // averages away to nothing, which is why distant water
          // reads as a flat wash of paint: the eye needs something
          // with a wavelength it can still see.
          vec3 n0 = texture2D(uNormal, vWPos.xz * 0.014 - fp * t * 0.045).xyz * 2.0 - 1.0;
          vec3 n1 = texture2D(uNormal, vWPos.xz * 0.085 + fp * t * 0.10).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormal, vWPos.xz * 0.21 - fp * t * 0.16 + pp * t * 0.03).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uNormal, vWPos.xz * 0.62 + pp * t * 0.26).xyz * 2.0 - 1.0;
          float rip = (1.0 - smoothstep(0.0, 2.2, depth)) * 0.35 + 1.0;
          vec3 N = normalize(vec3(
            (n0.x * 0.95 + n1.x * 0.7 + n2.x * 0.4 + n3.x * 0.16) * rip,
            1.0,
            (n0.z * 0.95 + n1.z * 0.7 + n2.z * 0.4 + n3.z * 0.16) * rip));

          // Current lines: the noise stretched along the flow and
          // squeezed across it, drifting downstream. This is the
          // thing that makes moving water look like it is going
          // somewhere rather than sitting there being blue.
          vec2 fuv = vec2(dot(vWPos.xz, fp), dot(vWPos.xz, pp));
          float cur = texture2D(uNormal, fuv * vec2(0.05, 0.55) - vec2(t * 0.09, 0.0)).y;
          float cur2 = texture2D(uNormal, fuv * vec2(0.13, 1.30) - vec2(t * 0.22, 0.0)).y;
          float streak = (cur * 0.65 + cur2 * 0.35 - 0.5) * 2.0;

          vec3 V = normalize(vView);
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          fres = mix(0.035, 1.0, fres);

          // the sky, reflected: cheap analytic gradient
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y * 0.5 + 0.5, 0.0, 1.0), 0.6));
          float sunSpec = pow(clamp(dot(R, uSunDir), 0.0, 1.0), 620.0) * 3.4
                        + pow(clamp(dot(R, uSunDir), 0.0, 1.0), 46.0) * 0.28
                        + pow(clamp(dot(R, uSunDir), 0.0, 1.0), 9.0) * 0.10;
          sky += uSunCol * sunSpec * (1.0 - uNight);

          // the bed, seen through the shallows
          float dt = 1.0 - exp(-depth * 1.55);
          vec3 body = mix(uShallow, uDeep, dt);
          // a hint of the gravel bed, refracted by the ripples
          body += uShallow * 0.5 * (1.0 - dt) * (0.6 + 0.4 * n2.y);

          vec3 col = mix(body, sky, fres * 0.86);

          // the current, drawn on the surface rather than in it
          col *= 1.0 + streak * 0.085 * (1.0 - uNight * 0.7);
          col += uSunCol * max(0.0, streak) * 0.05 * (1.0 - uNight);

          // sparkle where the light finds the ripples
          float sp = pow(max(0.0, n3.y - 0.72) * 3.4, 3.0);
          col += uSunCol * sp * 0.5 * (1.0 - uNight) * clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);

          // shoreline: a wet band, then foam, then nothing
          float edge = 1.0 - smoothstep(0.0, 0.30, depth);
          float foam = smoothstep(0.10, 0.0, depth) * (0.55 + 0.45 * sin(depth * 44.0 - t * 2.4 + n1.x * 6.0));
          foam += smoothstep(0.34, 0.16, depth) * 0.35;
          col = mix(col, vec3(0.86, 0.90, 0.88), clamp(foam, 0.0, 1.0) * 0.55);
          float alpha = smoothstep(0.0, 0.16, depth) * 0.94;
          alpha = max(alpha, clamp(foam, 0.0, 1.0) * 0.8);

          // fog, by hand
          float dist = length(vWPos - uCam);
          float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
          col = mix(col, uFogCol, clamp(fogF, 0.0, 1.0));

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
  }

  update(t, sky, camera) {
    const u = this.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(camera.position);
    if (sky) {
      u.uZenith.value.copy(sky.palette.zen);
      u.uHorizon.value.copy(sky.palette.hor);
      u.uSunDir.value.copy(sky.sunDir);
      u.uSunCol.value.copy(sky.palette.sun);
      u.uNight.value = sky.palette.night;
      u.uFogCol.value.copy(sky.fogColor);
      if (this.group.parent) u.uFogDensity.value = this.group.parent.fog ? this.group.parent.fog.density : 0.0016;
    }
    // the water rides with the sky dome so it never clips
    for (const m of this.meshes) {
      m.updateMatrix();
      m.updateMatrixWorld();
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
  }
}

export { TAU, clamp, smoothstep };
