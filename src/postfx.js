/* ============================================================
   postfx.js — the look.

   RenderPass -> god rays -> bloom -> output/tonemap ->
   film grade (split tone, vignette, aberration, grain) -> FXAA

   The grade runs on display-referred colour, after tone mapping,
   because that is where an artist's eye works. Everything is
   subtle by default; the whole point is that you feel it rather
   than see it.
   ============================================================ */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/* ------------------------------------------------------------
   God rays: a radial blur of the bright parts of the frame,
   taken from the sun's position on screen. Twenty-four taps is
   enough once it is heavily blurred and tinted.
   ------------------------------------------------------------ */
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0.0 },
    uTint: { value: new THREE.Color(1.0, 0.88, 0.66) },
    uThreshold: { value: 0.68 },
    uAspect: { value: 1.0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uStrength, uThreshold, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (uStrength < 0.002) { gl_FragColor = vec4(base, 1.0); return; }

      vec2 delta = (vUv - uSun) * (1.0 / 24.0) * 0.82;
      vec2 uv = vUv;
      float decay = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 24; i++) {
        uv -= delta;
        // A sample that has walked off the edge of the frame
        // contributes nothing. Clamping it to the edge instead makes
        // twenty-four identical taps of one bright border texel, and
        // the sky ends up covered in hard bright blocks.
        float inside = step(0.0, uv.x) * step(uv.x, 1.0)
                     * step(0.0, uv.y) * step(uv.y, 1.0);
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb * inside;
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        float w = smoothstep(uThreshold, uThreshold + 0.32, lum);
        acc += s * w * decay;
        decay *= 0.955;
      }
      acc /= 24.0;
      // only add rays where the sky is actually visible
      float srcLum = dot(base, vec3(0.2126, 0.7152, 0.0722));
      float mask = smoothstep(0.35, 0.85, srcLum) * 0.7 + 0.3;
      float fall = 1.0 - smoothstep(0.15, 1.05, length((vUv - uSun) * vec2(uAspect, 1.0)));
      vec3 rays = acc * uTint * uStrength * mask * fall * 6.0;
      gl_FragColor = vec4(base + rays, 1.0);
    }
  `
};

/* ------------------------------------------------------------
   The film grade.
   ------------------------------------------------------------ */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.028 },
    uAberration: { value: 0.0016 },
    uLift: { value: new THREE.Color(0.012, 0.017, 0.032) },
    uGain: { value: new THREE.Color(1.03, 1.0, 0.965) },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.055 },
    uWarmth: { value: 0.04 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uContrast, uWarmth;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // lateral chromatic aberration, strongest at the corners
      float ab = uAberration * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;

      // lift / gain, and a touch of warmth into the highlights
      col = col * uGain + uLift;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col += uWarmth * vec3(1.0, 0.62, -0.4) * smoothstep(0.35, 1.0, lum);
      // cool the shadows very slightly, the way a film print does
      col += vec3(-0.006, 0.0, 0.016) * (1.0 - smoothstep(0.0, 0.42, lum));

      // vignette
      float vig = 1.0 - uVignette * smoothstep(0.16, 0.78, r2 * 1.45);
      col *= vig;

      // grain, slightly stronger in the mids than in the highlights
      float g = hash(vUv * vec2(1024.0, 768.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (0.35 + 0.9 * (1.0 - abs(lum - 0.5) * 2.0) * 0.6);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.enabled = true;

    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (quality.godrays) {
      this.godrays = new ShaderPass(GodRaysShader);
      this.composer.addPass(this.godrays);
    }

    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), quality.bloomStrength, quality.bloomRadius ?? 0.55, quality.bloomThreshold ?? 0.94);
      this.composer.addPass(this.bloom);
    }

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    if (quality.fxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    this.composer.setSize(w, h);
    if (this.fxaa) {
      this.fxaa.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
    }
    if (this.bloom) this.bloom.setSize(w * dpr, h * dpr);
    if (this.godrays) this.godrays.material.uniforms.uAspect.value = w / h;
  }

  /** Point the rays at the sun, and dial them with how low it is. */
  setSun(sunDir, camPos, sunColour, night) {
    if (!this.godrays) return;
    const u = this.godrays.material.uniforms;
    // project the sun (a long way off in that direction) to screen space
    const far = camPos.clone().addScaledVector(sunDir, 2000);
    const p = far.project(this.camera);
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const low = Math.max(0, 1 - Math.abs(sunDir.y) * 3.0);
    const facing = Math.max(0, sunDir.clone().negate().normalize().dot(camPos.clone().sub(far).normalize().negate()));
    u.uStrength.value = low * (1 - night) * (0.35 + facing * 0.65) * 0.55;
    u.uTint.value.copy(sunColour).lerp(new THREE.Color(1, 1, 1), 0.25);
  }

  setNight(n) {
    this.grade.material.uniforms.uSaturation.value = 1.06 - n * 0.22;
    this.grade.material.uniforms.uWarmth.value = 0.04 - n * 0.03;
    this.grade.material.uniforms.uVignette.value = 0.34 + n * 0.1;
    this.grade.material.uniforms.uLift.value.setRGB(0.012 + n * 0.004, 0.017 + n * 0.006, 0.032 + n * 0.018);
  }

  render(dt, t) {
    this.grade.material.uniforms.uTime.value = t;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
