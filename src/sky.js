/* ============================================================
   sky.js — the dome, the sun, the moon, the stars, the clouds,
   and the three lights that make the Shire look lit.

   One `phase` value (0..1 = fraction of a 24 h day) drives
   everything, so dawn, noon, dusk and night are the same code.
   ============================================================ */

import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep } from './constants.js';
import { cloudTexture, glowTexture } from './textures.js';

/* Colour keyframes, indexed by sun elevation (sin of altitude). */
const KEYS = [
  { y: -1.00, zen: [0.006, 0.011, 0.036], hor: [0.020, 0.032, 0.070], sun: [0, 0, 0],          sunI: 0.00, amb: 0.10, night: 1.0 },
  { y: -0.22, zen: [0.022, 0.042, 0.110], hor: [0.090, 0.078, 0.130], sun: [0, 0, 0],          sunI: 0.00, amb: 0.16, night: 0.92 },
  { y: -0.09, zen: [0.055, 0.090, 0.215], hor: [0.320, 0.180, 0.190], sun: [0.60, 0.26, 0.14], sunI: 0.03, amb: 0.24, night: 0.55 },
  { y: -0.015,zen: [0.120, 0.190, 0.420], hor: [0.720, 0.300, 0.180], sun: [1.00, 0.46, 0.20], sunI: 0.44, amb: 0.46, night: 0.16 },
  { y: 0.055, zen: [0.170, 0.310, 0.610], hor: [1.000, 0.540, 0.270], sun: [1.00, 0.66, 0.34], sunI: 1.02, amb: 0.56, night: 0.0 },
  { y: 0.16,  zen: [0.190, 0.370, 0.760], hor: [0.900, 0.700, 0.470], sun: [1.00, 0.82, 0.58], sunI: 1.10, amb: 0.64, night: 0.0 },
  { y: 0.36,  zen: [0.170, 0.380, 0.840], hor: [0.720, 0.820, 0.900], sun: [1.00, 0.93, 0.80], sunI: 1.00, amb: 0.70, night: 0.0 },
  { y: 1.00,  zen: [0.140, 0.350, 0.880], hor: [0.660, 0.800, 0.940], sun: [1.00, 0.97, 0.92], sunI: 1.06, amb: 0.78, night: 0.0 }
];

function sampleKeys(y) {
  let i = 0;
  while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((y - a.y) / (b.y - a.y || 1), 0, 1);
  const s = t * t * (3 - 2 * t);
  return {
    zen: new THREE.Color(lerp(a.zen[0], b.zen[0], s), lerp(a.zen[1], b.zen[1], s), lerp(a.zen[2], b.zen[2], s)),
    hor: new THREE.Color(lerp(a.hor[0], b.hor[0], s), lerp(a.hor[1], b.hor[1], s), lerp(a.hor[2], b.hor[2], s)),
    sun: new THREE.Color(lerp(a.sun[0], b.sun[0], s), lerp(a.sun[1], b.sun[1], s), lerp(a.sun[2], b.sun[2], s)),
    sunI: lerp(a.sunI, b.sunI, s),
    amb: lerp(a.amb, b.amb, s),
    night: lerp(a.night, b.night, s)
  };
}

const PHASES = [
  [0.00, 'the small hours'],
  [4.2, 'before dawn'],
  [5.0, 'first light'],
  [6.2, 'sunrise'],
  [8.0, 'early morning'],
  [11.0, 'mid-morning'],
  [13.0, 'high noon'],
  [16.0, 'afternoon'],
  [18.0, 'the light going gold'],
  [19.6, 'sunset'],
  [20.6, 'dusk'],
  [22.0, 'evening'],
  [23.4, 'night'],
  [24.01, 'the small hours']
];

export class Sky {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.phase = 4.6 / 24;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.palette = sampleKeys(0);
    this.haze = new THREE.Color(0.6, 0.7, 0.8);
    this.fogColor = new THREE.Color(0.6, 0.7, 0.8);
    this.mistAmount = 0;

    this._buildDome();
    this._buildLights();
    this._buildFog();
    this.setPhase(this.phase);
  }

  _buildDome() {
    const geo = new THREE.SphereGeometry(1, 48, 32);
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: cloudTexture() },
      uGlow: { value: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)') },
      uCloudCover: { value: 0.52 },
      uHaze: { value: new THREE.Color(0.6, 0.7, 0.8) }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.999999;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec3 uZenith, uHorizon, uSunCol, uSunDir, uMoonDir, uHaze;
        uniform float uNight, uTime, uCloudCover;
        uniform sampler2D uCloud;
        varying vec3 vDir;

        float h31(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float hash21(vec2 p) {
          p = fract(p * vec2(0.1031, 0.1030));
          p += dot(p, p.yx + 33.33);
          return fract((p.x + p.y) * p.x);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                     mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec3 rd = normalize(vDir);
          float up = clamp(rd.y, -1.0, 1.0);

          // ---- base gradient, with a compressed band at the horizon
          float t = pow(clamp(up * 0.5 + 0.5, 0.0, 1.0), 0.42);
          float k = smoothstep(0.5, 0.98, t);
          vec3 col = mix(uHorizon, uZenith, k);

          // a little warmth piled up on the horizon
          float horizonGlow = exp(-abs(up) * 9.0);
          col = mix(col, uHorizon * 1.14, horizonGlow * 0.55);

          // ---- the sun: disc, aureole, and a long soft pillar
          float sd = dot(rd, uSunDir);
          float disc = smoothstep(0.99930, 0.99968, sd);
          float aureole = pow(clamp(sd, 0.0, 1.0), 900.0) * 0.6
                        + pow(clamp(sd, 0.0, 1.0), 62.0) * 0.16
                        + pow(clamp(sd, 0.0, 1.0), 7.0) * 0.05;
          float pillar = pow(clamp(1.0 - abs(rd.y - uSunDir.y) * 5.5, 0.0, 1.0), 3.0)
                       * pow(clamp(sd * 0.5 + 0.5, 0.0, 1.0), 5.0) * 0.05;
          float sunUp = smoothstep(-0.10, 0.02, uSunDir.y);
          col += uSunCol * (disc * 5.0 + aureole * 1.7 + pillar) * sunUp;

          // ---- the moon, with a phase and a soft halo
          float md = dot(rd, uMoonDir);
          float mdisc = smoothstep(0.99930, 0.99960, md);
          // carve the terminator
          vec3 mOff = normalize(uMoonDir + vec3(0.9, 0.22, 0.38));
          float mlit = smoothstep(-0.35, 0.55, dot(normalize(rd - uMoonDir * md * 0.9999), mOff));
          mdisc *= mix(0.12, 1.0, mlit);
          float mhalo = pow(clamp(md, 0.0, 1.0), 380.0) * 0.5 + pow(clamp(md, 0.0, 1.0), 26.0) * 0.07;
          float moonUp = smoothstep(-0.06, 0.06, uMoonDir.y);
          col += vec3(0.86, 0.90, 1.0) * (mdisc * 2.6 + mhalo) * moonUp * (0.35 + 0.65 * uNight);

          // ---- stars and the Milky Way
          if (uNight > 0.02 && up > -0.06) {
            vec3 sd3 = rd * 190.0;
            vec3 cell = floor(sd3);
            float rnd = h31(cell);
            if (rnd > 0.9915) {
              vec3 off = vec3(h31(cell + 1.7), h31(cell + 3.3), h31(cell + 5.9)) - 0.5;
              float d = length(fract(sd3) - 0.5 - off * 0.7);
              float mag = (rnd - 0.9915) / 0.0085;
              float tw = 0.72 + 0.28 * sin(uTime * (1.4 + rnd * 5.0) + rnd * 40.0);
              vec3 tint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.88, 0.72), h31(cell + 9.1));
              col += tint * smoothstep(0.16, 0.0, d) * (0.35 + mag * 1.5) * tw * uNight * smoothstep(-0.06, 0.12, up);
            }
            // galactic band
            float band = exp(-pow((dot(rd, normalize(vec3(0.6, 0.42, -0.68)))) * 3.4, 2.0));
            float mw = band * (0.35 + 0.65 * vnoise(rd.xz * 9.0 + rd.y * 4.0));
            col += vec3(0.42, 0.46, 0.62) * mw * 0.075 * uNight * smoothstep(0.0, 0.24, up);
          }

          // ---- clouds, on a plane above us
          float cy = max(up, 0.035);
          vec2 cuv = rd.xz / cy;
          float drift = uTime * 0.0035;
          float cover = uCloudCover;
          vec4 c1 = texture2D(uCloud, cuv * 0.030 + vec2(drift, drift * 0.34));
          vec4 c2 = texture2D(uCloud, cuv * 0.071 - vec2(drift * 1.9, drift * 0.7));
          float a = clamp((c1.a * 1.0 + c2.a * 0.62) * (0.55 + cover), 0.0, 1.0);
          a *= smoothstep(0.0, 0.20, up);
          a = smoothstep(0.20, 0.78, a);

          // shade the cloud: brighter toward the sun, cool and dark away
          vec2 sunOff = normalize(uSunDir).xz * 0.09;
          vec4 cS = texture2D(uCloud, cuv * 0.030 + vec2(drift, drift * 0.34) + sunOff);
          float lit = clamp((c1.a - cS.a) * 2.4 + 0.5, 0.0, 1.0);
          vec3 cloudLit = mix(uHorizon * 0.72, vec3(1.06, 1.0, 0.95), 0.62) * (0.7 + uSunCol * 0.5);
          vec3 cloudDark = mix(uZenith * 0.62, uHorizon * 0.5, 0.45);
          vec3 cc = mix(cloudDark, cloudLit, lit);
          cc = mix(cc, cc * 1.12 + uSunCol * 0.28, pow(clamp(sd, 0.0, 1.0), 8.0));
          cc = mix(cc, uHaze * 0.9, horizonGlow * 0.6);
          cc = mix(cc, vec3(0.10, 0.13, 0.22), uNight * 0.72);
          col = mix(col, cc, a * 0.94);

          // ---- ground haze band so the dome meets the ring cleanly
          col = mix(col, uHaze, smoothstep(0.02, -0.14, up) * 0.92);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.setScalar(3000);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.castShadow = this.quality.shadows;
    const s = this.quality.shadow || 1024;
    this.sun.shadow.mapSize.set(s, s);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.55;
    this.sun.shadow.radius = 2.2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9ab4e8, 0.0);
    this.moon.castShadow = false;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.hemi = new THREE.HemisphereLight(0x9fc4e8, 0x4a5f33, 0.5);
    this.scene.add(this.hemi);

    this.bounce = new THREE.DirectionalLight(0xbcd0a0, 0.12);
    this.bounce.position.set(-0.4, 0.55, -0.8);
    this.scene.add(this.bounce);
  }

  _buildFog() {
    this.scene.fog = new THREE.FogExp2(0x9fb6c8, 0.0016);
  }

  /* ------------------------------------------------------------ */
  setPhase(phase) {
    this.phase = ((phase % 1) + 1) % 1;
    const t = this.phase * 24;
    // theta: 0 at midnight; sun overhead at noon (t = 12)
    const theta = (t / 24) * TAU - Math.PI / 2;
    const tilt = 0.36;
    this.sunDir.set(
      Math.cos(theta),
      Math.sin(theta) * Math.cos(tilt),
      Math.sin(theta) * Math.sin(tilt) + 0.16
    ).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.z = -this.moonDir.z * 0.8;
    this.moonDir.normalize();

    const y = this.sunDir.y;
    const p = sampleKeys(y);
    this.palette = p;

    this.uniforms.uZenith.value.copy(p.zen);
    this.uniforms.uHorizon.value.copy(p.hor);
    this.uniforms.uSunCol.value.copy(p.sun);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uMoonDir.value.copy(this.moonDir);
    this.uniforms.uNight.value = p.night;

    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunI;
    this.moon.color.setRGB(0.66, 0.75, 1.0);
    // Enough moon to walk home by. The films' nights are dark but
    // they are not holes: there is a cold light on the grass and you
    // can see the shape of the hill.
    this.moon.intensity = p.night * 0.34;
    this.hemi.color.copy(p.zen).lerp(p.hor, 0.55).multiplyScalar(2.2);
    this.hemi.groundColor.setRGB(0.22, 0.26, 0.15);
    // never let the county go completely black: the sky is always
    // doing something, and the eye adapts
    this.hemi.intensity = 0.34 + p.amb * 0.52 + p.night * 0.16;
    this.bounce.color.copy(p.hor).lerp(new THREE.Color(0x8fae64), 0.5);
    this.bounce.intensity = 0.06 + p.amb * 0.14;

    // haze: what the far mountains and the fog turn into. It must sit
    // just behind the sky, not in front of it, or the whole middle
    // distance goes to milk.
    this.haze.copy(p.hor).lerp(p.zen, 0.30);
    this.haze.multiplyScalar(0.80);
    this.haze.lerp(new THREE.Color(0.42, 0.52, 0.66), 0.22 + p.night * 0.3);
    this.uniforms.uHaze.value.copy(this.haze);

    this.fogColor.copy(p.hor).lerp(p.zen, 0.5);
    this.fogColor.multiplyScalar(0.92);
    this.fogColor.lerp(this.haze, 0.45);
    this.scene.fog.color.copy(this.fogColor);

    // morning mist, and a thick one at the turn of the day
    this.mistAmount = clamp(
      smoothstep(0.16, -0.02, y) * (1 - Math.abs(t - 5.6) / 3.4) * 0.9 +
      smoothstep(0.05, -0.16, y) * 0.25, 0, 1);
  }

  get phaseName() {
    const t = this.phase * 24;
    let name = PHASES[0][1];
    for (const [h, n] of PHASES) if (t >= h) name = n;
    return name;
  }

  get clockString() {
    const t = this.phase * 24;
    const hh = Math.floor(t) % 24;
    const mm = Math.floor((t % 1) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /* Keep the shadow frustum tight around the player. */
  followShadow(target, radius) {
    const d = 120;
    this.sun.target.position.set(target.x, target.y, target.z);
    this.sun.position.set(
      target.x + this.sunDir.x * d,
      target.y + this.sunDir.y * d,
      target.z + this.sunDir.z * d
    );
    const cam = this.sun.shadow.camera;
    const r = radius;
    if (cam.left !== -r) {
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
      cam.updateProjectionMatrix();
    }
    this.moon.target.position.set(target.x, target.y, target.z);
    this.moon.position.set(
      target.x + this.moonDir.x * d,
      target.y + this.moonDir.y * d,
      target.z + this.moonDir.z * d
    );
  }

  update(t) {
    this.uniforms.uTime.value = t;
    if (this.mesh.parent) {
      this.mesh.position.copy(this.scene.userData.cameraPos || this.mesh.position);
      this.mesh.updateMatrix();
      this.mesh.updateMatrixWorld();
    }
  }

  setCloudCover(v) { this.uniforms.uCloudCover.value = v; }
}
