/* ============================================================
   creatures.js — what moves.

   Fireflies and pollen in the light shafts, butterflies by day
   and moths by night, swifts and thrushes overhead, woodsmoke
   from every chimney, elf-lights at the edge of the Old Forest,
   and the low ground mist that pools in the hollows before
   the sun is properly up.

   Everything is animated in the vertex shader from a seed, so
   the CPU cost is nil and the draw-call count is tiny.
   ============================================================ */

import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, hash2 } from './constants.js';
import { glowTexture, wingTexture, smokeTexture } from './textures.js';

const MOTE_PARS = /* glsl */`
  uniform float uTime;
  uniform vec2  uCamXZ;
  uniform float uCell;
  uniform float uRadius;
  uniform float uSize;
  uniform float uPixelScale;
  uniform vec3  uColour;
  uniform float uOpacity;
  uniform float uAmount;
  attribute vec3 aBase;
  attribute vec4 aRnd;
  varying float vAlpha;
  varying vec3 vTint;
`;

function moteSystem(field, opts) {
  const {
    count, cell, radius, size, colour, kind, dayAmount = 0, nightAmount = 0,
    height = 3.2, rise = 0, blink = 0, sprite, additive = true
  } = opts;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 4);
  const rng = makeRng(opts.seed || 1234);
  for (let i = 0; i < count; i++) {
    base[i * 3] = Math.floor(rng() * 1000) - 500;
    base[i * 3 + 1] = rng();
    base[i * 3 + 2] = Math.floor(rng() * 1000) - 500;
    rnd[i * 4] = rng();
    rnd[i * 4 + 1] = rng();
    rnd[i * 4 + 2] = rng();
    rnd[i * 4 + 3] = rng();
    pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime: { value: 0 },
    uCamXZ: { value: new THREE.Vector2() },
    uCell: { value: cell },
    uRadius: { value: radius },
    uSize: { value: size },
    uPixelScale: { value: 600 },
    uColour: { value: new THREE.Color(colour) },
    uOpacity: { value: 1 },
    uAmount: { value: 0 },
    uField: { value: field.texture },
    uSpan: { value: field.span },
    uHeight: { value: height },
    uRise: { value: rise },
    uBlink: { value: blink },
    uDay: { value: 0 },
    uNight: { value: 0 },
    uSprite: { value: sprite }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      ${MOTE_PARS}
      uniform sampler2D uField;
      uniform sampler2D uSprite;
      uniform float uSpan, uHeight, uRise, uBlink, uDay, uNight;
      void main() {
        vec2 anchor = vec2(aBase.x, aBase.z);
        vec2 cell = floor(uCamXZ / uCell + 0.5 - anchor);
        vec2 xz = (anchor + cell) * uCell;
        vec2 uv = xz / (uSpan * 2.0) + 0.5;
        vec4 F = texture2D(uField, clamp(uv, 0.0015, 0.9985));
        float ground = F.r * 100.0;
        float dens = F.g;
        float water = F.b;

        float t = uTime;
        float ph = aRnd.x * 6.2831853;

        // three rates of wander, so nothing loops visibly
        float wx = sin(t * (0.31 + aRnd.y * 0.4) + ph) * 1.5
                 + sin(t * (0.11 + aRnd.z * 0.2) + ph * 2.1) * 3.2;
        float wz = cos(t * (0.27 + aRnd.z * 0.35) + ph * 1.7) * 1.5
                 + cos(t * (0.13 + aRnd.y * 0.18) + ph) * 3.2;
        xz += vec2(wx, wz);
        float h = aBase.y * uHeight;
        h += sin(t * (0.5 + aRnd.w * 0.7) + ph) * 0.34 + uRise * t * 0.0;
        // a slow climb for pollen and smoke-like motes
        h = mod(h + uRise * t, uHeight);
        vec3 wp = vec3(xz.x, ground + h, xz.y);

        float dist = length(xz - uCamXZ);
        float fade = 1.0 - smoothstep(uRadius * 0.5, uRadius, dist);
        float near = smoothstep(0.4, 2.2, dist);
        float keep = step(aRnd.w * 0.85 + 0.05, dens * 0.9 + 0.16);
        float sub = step(aRnd.z, 0.9);

        float amt = uAmount;
        vAlpha = fade * near * keep * sub * uOpacity * (0.35 + 0.65 * aRnd.y);
        vAlpha *= mix(0.25, 1.0, dens) * smoothstep(0.5, 1.8, dist);
        vAlpha *= 1.0 - water;

        if (uBlink > 0.0) {
          float b = sin(t * (1.4 + aRnd.y * 2.2) + ph * 3.1);
          vAlpha *= pow(clamp(b * 0.5 + 0.5, 0.0, 1.0), uBlink);
        }
        vAlpha *= mix(1.0, 0.0, step(0.999, amt * 0.0 + 0.0));
        vAlpha *= step(aRnd.x, amt);
        vTint = uColour * (0.7 + 0.6 * aRnd.y);
        if (uBlink > 0.0) vTint = mix(vTint, vTint * 1.6, vAlpha);

        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPixelScale / max(0.5, -mv.z);
        if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uSprite;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        if (vAlpha < 0.004) discard;
        vec4 t = texture2D(uSprite, gl_PointCoord);
        gl_FragColor = vec4(vTint, 1.0) * t.a * vAlpha;
        if (gl_FragColor.a < 0.004) discard;
      }
    `
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 12;
  pts.matrixAutoUpdate = false;
  pts.updateMatrix();
  return { points: pts, uniforms, mat };
}

/* ------------------------------------------------------------
   Winged things: butterflies, moths, birds.
   ------------------------------------------------------------ */
function flyerSystem(field, opts) {
  const {
    count, cell, radius, size, kind, sprite, speed, flap, height, dayAmount, nightAmount
  } = opts;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  geo.instanceCount = count;
  base.dispose();

  const aBase = new Float32Array(count * 3);
  const aRnd = new Float32Array(count * 4);
  const rng = makeRng(opts.seed || 77);
  for (let i = 0; i < count; i++) {
    aBase[i * 3] = Math.floor(rng() * 1000) - 500;
    aBase[i * 3 + 1] = rng();
    aBase[i * 3 + 2] = Math.floor(rng() * 1000) - 500;
    for (let k = 0; k < 4; k++) aRnd[i * 4 + k] = rng();
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime: { value: 0 },
    uCamXZ: { value: new THREE.Vector2() },
    uCell: { value: cell },
    uRadius: { value: radius },
    uSize: { value: size },
    uField: { value: field.texture },
    uSpan: { value: field.span },
    uHeight: { value: height },
    uSpeed: { value: speed },
    uFlap: { value: flap },
    uSprite: { value: sprite },
    uAmount: { value: 1 },
    uPixelScale: { value: 600 }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime, uSpan, uHeight, uSpeed, uFlap, uRadius, uCell, uAmount, uSize;
      uniform vec2 uCamXZ;
      uniform sampler2D uField;
      attribute vec3 aBase;
      attribute vec4 aRnd;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vShade;
      void main() {
        vec2 anchor = vec2(aBase.x, aBase.z);
        vec2 cell = floor(uCamXZ / uCell + 0.5 - anchor);
        vec2 xz = (anchor + cell) * uCell;
        vec2 uv = xz / (uSpan * 2.0) + 0.5;
        vec4 F = texture2D(uField, clamp(uv, 0.0015, 0.9985));
        float ground = F.r * 100.0;
        float dens = F.g;
        float t = uTime;
        float ph = aRnd.x * 6.2831853;

        // a wandering loop, closed enough to be cheap and open enough to wander
        float s = uSpeed * (0.6 + aRnd.y * 0.8);
        vec2 orbit = vec2(
          sin(t * 0.37 * s + ph) * (3.0 + aRnd.z * 5.0) + sin(t * 1.13 * s + ph * 2.3) * 1.1,
          cos(t * 0.29 * s + ph * 1.4) * (3.0 + aRnd.w * 5.0) + cos(t * 0.91 * s + ph) * 1.1
        );
        xz += orbit;
        float h = aBase.y * uHeight;
        h += sin(t * (1.1 + aRnd.w * 1.4) + ph) * 0.42;
        h += 0.35;
        vec3 wp = vec3(xz.x, ground + h, xz.y);

        float dist = length(xz - uCamXZ);
        float fade = 1.0 - smoothstep(uRadius * 0.45, uRadius, dist);
        float keep = step(aRnd.x, dens * 0.55 + 0.42);
        vAlpha = fade * keep * step(aRnd.y, uAmount) * smoothstep(0.7, 2.4, dist);

        // the beat: wings fold in and out
        float beat = abs(sin(t * uFlap * (0.8 + aRnd.z * 0.5) + ph));
        float spread = 0.18 + beat * 0.82;
        float sx = cos(ph) * spread;
        float sy = sin(ph) * spread;
        vec3 right = vec3(cos(ph + 1.5707963), 0.0, sin(ph + 1.5707963));
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 p = position;
        // billboard toward the camera, then squash along the wing axis
        vec3 toCam = normalize(cameraPosition - wp);
        vec3 fwd = normalize(cross(up, toCam));
        vec3 realUp = cross(toCam, fwd);
        float w = p.x * uSize * spread;
        float hh = p.y * uSize;
        vec3 offset = fwd * w + realUp * hh;
        offset += up * (uSize * 0.12 * (1.0 - beat));
        vUv = uv;
        vShade = 0.55 + 0.45 * beat;

        if (vAlpha < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp + offset, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uSprite;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vShade;
      void main() {
        vec4 t = texture2D(uSprite, vUv);
        if (t.a < 0.05) discard;
        gl_FragColor = vec4(t.rgb * vShade, t.a * vAlpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, uniforms, mat, kind };
}

/* ------------------------------------------------------------
   Birds: a V of two triangles that beats, high overhead.
   ------------------------------------------------------------ */
function birdSystem(count, sprite) {
  const shape = new THREE.BufferGeometry();
  const p = new Float32Array([
    0, 0, 0.22, -0.5, 0, -0.12, -0.13, 0, 0.0,
    0, 0, 0.22, 0.13, 0, 0.0, 0.5, 0, -0.12
  ]);
  const n = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const uv = new Float32Array([0.5, 1, 0, 0.6, 0.38, 0.5, 0.5, 1, 0.62, 0.5, 1, 0.6]);
  shape.setAttribute('position', new THREE.BufferAttribute(p, 3));
  shape.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  shape.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  shape.setIndex([0, 1, 2, 3, 4, 5]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = shape.index;
  geo.attributes.position = shape.attributes.position;
  geo.attributes.normal = shape.attributes.normal;
  geo.attributes.uv = shape.attributes.uv;
  geo.instanceCount = count;
  const aBase = new Float32Array(count * 3);
  const aRnd = new Float32Array(count * 4);
  const rng = makeRng(4004);
  for (let i = 0; i < count; i++) {
    aBase[i * 3] = Math.floor(rng() * 1000) - 500;
    aBase[i * 3 + 1] = rng();
    aBase[i * 3 + 2] = Math.floor(rng() * 1000) - 500;
    for (let k = 0; k < 4; k++) aRnd[i * 4 + k] = rng();
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime: { value: 0 },
    uCamXZ: { value: new THREE.Vector2() },
    uCell: { value: 220 },
    uRadius: { value: 300 },
    uAmount: { value: 1 },
    uColour: { value: new THREE.Color(0x1a1c18) }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      uniform float uTime, uRadius, uCell, uAmount;
      uniform vec2 uCamXZ;
      attribute vec3 aBase;
      attribute vec4 aRnd;
      varying float vA;
      void main() {
        vec2 anchor = vec2(aBase.x, aBase.z);
        vec2 cell = floor(uCamXZ / uCell + 0.5 - anchor);
        vec2 xz = (anchor + cell) * uCell;
        float t = uTime;
        float ph = aRnd.x * 6.2831853;
        float sp = 0.28 + aRnd.y * 0.34;
        float rad = 30.0 + aRnd.z * 120.0;
        xz += vec2(cos(t * sp + ph), sin(t * sp * 0.83 + ph)) * rad;
        float h = 26.0 + aRnd.w * 46.0 + sin(t * 0.5 + ph) * 6.0;
        vec3 wp = vec3(xz.x, h, xz.y);

        float beat = sin(t * (7.0 + aRnd.y * 5.0) + ph);
        // heading: tangent of the orbit
        vec2 dir = normalize(vec2(-sin(t * sp + ph) * sp, cos(t * sp * 0.83 + ph) * sp * 0.83) + 1e-5);
        vec3 fwd = normalize(vec3(dir.x, 0.0, dir.y));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
        vec3 p = position;
        float side = sign(p.x);
        p.y += abs(p.x) * beat * 0.55;
        p.x *= 0.8 + 0.35 * abs(beat);
        vec3 wp2 = wp + fwd * p.z + right * p.x + vec3(0.0, p.y, 0.0);

        float dist = length(xz - uCamXZ);
        vA = (1.0 - smoothstep(uRadius * 0.6, uRadius, dist)) * step(aRnd.z, uAmount);
        if (vA < 0.03) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp2, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3 uColour;
      varying float vA;
      void main() { gl_FragColor = vec4(uColour, vA * 0.9); }
    `
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, uniforms, mat };
}

/* ------------------------------------------------------------
   Chimney smoke — world space, so it does not follow the player.
   ------------------------------------------------------------ */
function smokeSystem(chimneys, quality) {
  if (!chimneys.length) return null;
  const perChimney = quality > 1 ? 14 : quality > 0 ? 9 : 5;
  const count = chimneys.length * perChimney;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.attributes.position = plane.attributes.position;
  geo.attributes.uv = plane.attributes.uv;
  geo.instanceCount = count;
  plane.dispose();

  const aAnchor = new Float32Array(count * 3);
  const aRnd = new Float32Array(count * 4);
  let k = 0;
  for (let c = 0; c < chimneys.length; c++) {
    for (let p = 0; p < perChimney; p++) {
      aAnchor[k * 3] = chimneys[c].x;
      aAnchor[k * 3 + 1] = chimneys[c].y;
      aAnchor[k * 3 + 2] = chimneys[c].z;
      aRnd[k * 4] = p / perChimney;
      aRnd[k * 4 + 1] = hash2(c, p);
      aRnd[k * 4 + 2] = hash2(p, c);
      aRnd[k * 4 + 3] = chimneys[c].s || 1;
      k++;
    }
  }
  geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(aAnchor, 3));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(aRnd, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime: { value: 0 },
    uSprite: { value: smokeTexture() },
    uAmount: { value: 0 },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.8) }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uAmount;
      uniform vec3 uSun;
      uniform vec3 uSunCol;
      attribute vec3 aAnchor;
      attribute vec4 aRnd;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vCol;
      void main() {
        float life = fract(uTime * (0.05 + aRnd.w * 0.018) + aRnd.x);
        float rise = life * (5.5 + aRnd.w * 4.0);
        float drift = life * life;
        vec3 wp = aAnchor;
        wp.y += rise;
        wp.x += drift * (6.0 + aRnd.y * 4.0) + sin(uTime * 0.5 + aRnd.y * 6.28) * life * 1.1;
        wp.z += drift * (3.0 + aRnd.z * 3.0) + cos(uTime * 0.43 + aRnd.z * 6.28) * life * 0.9;
        float s = (0.32 + aRnd.y * 0.44) * (0.3 + life * 1.7) * aRnd.w;
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        // billboard
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 p = position * s;
        vec3 off = right * p.x + up * p.y;
        vUv = uv;
        vA = smoothstep(0.0, 0.14, life) * (1.0 - smoothstep(0.22, 0.95, life)) * uAmount;
        vA *= 0.20 + 0.16 * aRnd.y;
        // grey woodsmoke, warmed by the sun, and much dimmer after dark
        vCol = mix(vec3(0.60, 0.60, 0.60), vec3(1.0, 0.96, 0.90), 0.45) * (0.55 + 0.5 * uSunCol * 0.4);
        if (vA < 0.005) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = projectionMatrix * (mv + vec4(off, 0.0));
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform sampler2D uSprite;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vCol;
      void main() {
        float a = texture2D(uSprite, vUv).a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol, a * vA);
      }
    `
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, uniforms, mat };
}

/* ------------------------------------------------------------
   Ground mist that hugs the terrain, using the field texture for
   the height so it pools in the hollows and slides off the rises.
   ------------------------------------------------------------ */
function mistSystem(field, sprite) {
  const SEG = 40;
  const plane = new THREE.PlaneGeometry(1, 1, SEG, SEG);
  plane.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uField: { value: field.texture },
    uSpan: { value: field.span },
    uCamXZ: { value: new THREE.Vector2() },
    uAmount: { value: 0 },
    uColour: { value: new THREE.Color(0.86, 0.9, 0.94) },
    uSprite: { value: sprite },
    uRadius: { value: 190 },
    uOffset: { value: 0.0 },
    uScale: { value: 260 },
    uOpacity: { value: 0.0 }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uSpan, uOffset, uScale;
      uniform sampler2D uField;
      uniform vec2 uCamXZ;
      varying vec2 vW;
      varying float vH;
      varying float vDist;
      varying float vIn;
      void main() {
        // the plane follows the player, in metre units
        vec3 p = position * uScale;
        p.x += uCamXZ.x;
        p.z += uCamXZ.y;
        vec2 uv = p.xz / (uSpan * 2.0) + 0.5;
        float inside = step(max(abs(p.x), abs(p.z)), uSpan - 2.0);
        vec4 F = texture2D(uField, clamp(uv, 0.0015, 0.9985));
        float g = F.r * 100.0;
        vH = F.g;
        p.y += g + uOffset;
        vW = p.xz;
        vDist = length(p.xz - uCamXZ);
        vIn = inside;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform float uTime, uAmount, uRadius, uOpacity;
      uniform vec3 uColour;
      uniform sampler2D uSprite;
      varying vec2 vW;
      varying float vH;
      varying float vDist;
      varying float vIn;
      float h21(vec2 p){ p = fract(p*vec2(0.1031,0.1030)); p += dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
      float vn(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
      }
      void main() {
        float t = uTime * 0.012;
        float n = vn(vW * 0.028 + vec2(t, t * 0.6)) * 0.6
                + vn(vW * 0.071 - vec2(t * 1.7, t)) * 0.4;
        n = smoothstep(0.36, 0.86, n);
        float radial = 1.0 - smoothstep(uRadius * 0.35, uRadius, vDist);
        float a = n * radial * uAmount * uOpacity;
        a *= smoothstep(0.02, 0.3, vDist);
        a *= vIn;
        if (a < 0.006) discard;
        gl_FragColor = vec4(uColour, a);
      }
    `
  });
  const mesh = new THREE.Mesh(plane, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return { mesh, uniforms, mat };
}

/* ============================================================
   The whole menagerie
   ============================================================ */
export class Creatures {
  constructor(field, chimneys, quality) {
    this.group = new THREE.Group();
    this.group.name = 'life';
    this.quality = quality;
    const t = quality.creatures;
    const q = quality.name === 'high' ? 2 : quality.name === 'medium' ? 1 : 0;
    const soft = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const softWarm = glowTexture('rgba(255,236,170,1)', 'rgba(255,200,90,0)');

    this.fireflies = moteSystem(field, {
      count: Math.round(320 * t), cell: 3.2, radius: 56, size: 0.13,
      colour: 0xc8ff88, seed: 11, height: 2.4, rise: 0, blink: 5.5, sprite: softWarm
    });
    this.pollen = moteSystem(field, {
      count: Math.round(300 * t), cell: 3.0, radius: 44, size: 0.028,
      colour: 0xffe6a8, seed: 22, height: 4.4, rise: 0.11, sprite: soft
    });
    this.motes = moteSystem(field, {
      count: Math.round(200 * t), cell: 2.6, radius: 38, size: 0.055,
      colour: 0xffd894, seed: 33, height: 3.0, rise: 0.2, sprite: softWarm
    });
    this.elflight = moteSystem(field, {
      count: Math.round(150 * t), cell: 5.0, radius: 120, size: 0.26,
      colour: 0x9fe8ff, seed: 44, height: 4.5, rise: 0.06, blink: 2.2, sprite: soft
    });

    const butterfly = wingTexture('#e8c455', '#3a2a18', 'butterfly');
    const moth = wingTexture('#c8bca0', '#4a4030', 'moth');
    this.butterflies = flyerSystem(field, {
      count: Math.round(30 * t), cell: 26, radius: 40, size: 0.085, sprite: butterfly,
      speed: 1.5, flap: 11, height: 2.4, seed: 55
    });
    this.moths = flyerSystem(field, {
      count: Math.round(20 * t), cell: 22, radius: 36, size: 0.075, sprite: moth,
      speed: 1.1, flap: 7, height: 3.0, seed: 66
    });
    this.birds = birdSystem(Math.round(26 * t), soft);
    this.smoke = smokeSystem(chimneys, q);
    this.mist = mistSystem(field, soft);

    this.all = [this.fireflies, this.pollen, this.motes, this.elflight];
    this.flies = [this.butterflies, this.moths];
    for (const s of this.all) this.group.add(s.points);
    for (const s of this.flies) this.group.add(s.mesh);
    this.group.add(this.birds.mesh);
    if (this.smoke) this.group.add(this.smoke.mesh);
    this.group.add(this.mist.mesh);
  }

  /**
   * @param {number} t        elapsed seconds
   * @param {THREE.Camera} cam
   * @param {number} night    0 in day, 1 at midnight
   * @param {number} mist     0..1, how much ground mist there is
   * @param {THREE.Sky} sky
   */
  update(t, cam, night, mist, sky, indoors) {
    const camXZ = [cam.position.x, cam.position.z];
    for (const s of this.all) {
      s.uniforms.uTime.value = t;
      s.uniforms.uCamXZ.value.set(camXZ[0], camXZ[1]);
    }
    for (const s of this.flies) {
      s.uniforms.uTime.value = t;
      s.uniforms.uCamXZ.value.set(camXZ[0], camXZ[1]);
    }
    this.birds.uniforms.uTime.value = t;
    this.birds.uniforms.uCamXZ.value.set(camXZ[0], camXZ[1]);

    // fireflies come out at dusk and go in at dawn
    this.fireflies.uniforms.uAmount.value = clamp(night * 1.35 - 0.12, 0, 1);
    this.motes.uniforms.uAmount.value = clamp(1 - night * 1.6, 0, 1) * 0.7;
    this.pollen.uniforms.uAmount.value = clamp(1 - night * 2.2, 0, 1);
    this.butterflies.uniforms.uAmount.value = clamp(1 - night * 2.4, 0, 1);
    this.moths.uniforms.uAmount.value = clamp(night * 1.4 - 0.2, 0, 1);
    this.birds.uniforms.uAmount.value = clamp(1 - night * 1.5, 0, 1) * 0.9;
    // elf-light only where the Old Forest begins
    const forest = smoothstep(150, 260, cam.position.x);
    this.elflight.uniforms.uAmount.value = forest * clamp(night * 1.3, 0, 1);

    // point size must follow the drawing buffer, or it changes with zoom
    const px = 1 / Math.max(0.2, cam.position.y * 0 + (window.innerHeight || 800));
    for (const s of this.all) s.uniforms.uPixelScale.value = (window.innerHeight || 800) * 0.5;

    if (this.smoke) {
      this.smoke.uniforms.uTime.value = t;
      this.smoke.uniforms.uAmount.value = indoors ? 0.25 : 0.85;
      if (sky) this.smoke.uniforms.uSunCol.value.copy(sky.palette.sun).multiplyScalar(0.6 + sky.palette.sunI * 0.2);
    }

    const mu = this.mist.uniforms;
    mu.uTime.value = t;
    mu.uCamXZ.value.set(camXZ[0], camXZ[1]);
    mu.uAmount.value = mist;
    mu.uOffset.value = 0.55;
    if (sky) mu.uColour.value.copy(sky.fogColor).lerp(new THREE.Color(0.92, 0.94, 0.96), 0.35);
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
