/* ============================================================
   player.js — walking.

   Pointer lock on a desktop, a thumb on each side of the screen
   on a phone. Walks the heightfield, slides off anything too
   steep, cannot walk into a hobbit hole, wades the Water at
   half pace, and bobs its head in time with its own footfalls.
   ============================================================ */

import * as THREE from 'three';
import {
  EYE_HEIGHT, WALK_SPEED, RUN_SPEED, SLOPE_LIMIT, WORLD, TAU,
  clamp, lerp, smoothstep
} from './constants.js';
import { riverAt } from './noise.js';

const STEP_HEIGHT = 0.55;

export class Player {
  constructor(field, camera, dom, quality) {
    this.field = field;
    this.camera = camera;
    this.dom = dom;
    this.quality = quality;

    this.position = new THREE.Vector3(-6, 0, 96);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.03;
    this.onGround = true;
    this.groundY = 0;
    this.speed = 0;
    this.bob = 0;
    this.bobAmount = 0;
    this.locked = false;
    this.enabled = false;
    this.lookSensitivity = 0.0022;
    this.pace = 1.0;
    this.inWater = 0;
    this.waterDepth = 0;
    this.blocked = false;

    this.keys = Object.create(null);
    this.move = { x: 0, y: 0 };
    this.touchLook = { active: false, id: -1, x: 0, y: 0 };
    this.stick = { active: false, id: -1, x: 0, y: 0 };

    this.colliders = [];
    this.onStep = null;
    this.onBlocked = null;
    this._lastStepPhase = 0;
    this._viewOffset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.spawn();
    this._bind();
  }

  spawn() {
    // the lane outside Bag End's gate, looking at the door
    this.position.set(-24, 0, 66);
    this.groundY = this.field.height(this.position.x, this.position.z);
    this.position.y = this.groundY;
    this.yaw = Math.atan2(-34 - this.position.x, 56 - this.position.z) + Math.PI;
    this.pitch = -0.02;
  }

  _bind() {
    const dom = this.dom;
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'arrowup' ||
        k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => { this.keys[e.key.toLowerCase()] = false; };
    this._onMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.lookSensitivity;
      this.pitch -= e.movementY * this.lookSensitivity;
      this.pitch = clamp(this.pitch, -1.32, 1.28);
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.keys = Object.create(null);
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onWheel = (e) => {
      if (!this.locked) return;
      this.pace = clamp(this.pace - Math.sign(e.deltaY) * 0.08, 0.55, 1.6);
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('wheel', this._onWheel, { passive: true });
  }

  requestLock() {
    if (this.touch) return;
    const p = this.dom.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setTouch(on) { this.touch = on; }

  /* --- touch: the joystick ------------------------------------ */
  stickInput(x, y) { this.move.x = x; this.move.y = y; }

  lookDrag(dx, dy) {
    const s = this.lookSensitivity * 1.55;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.32, 1.28);
  }

  /* ------------------------------------------------------------ */
  addColliders(list) { this.colliders.push(...list); }

  update(dt) {
    const k = this.keys;
    let ix = 0, iy = 0;
    if (k.w || k.arrowup) iy += 1;
    if (k.s || k.arrowdown) iy -= 1;
    if (k.d || k.arrowright) ix += 1;
    if (k.a || k.arrowleft) ix -= 1;
    if (this.move.x || this.move.y) { ix += this.move.x; iy += this.move.y; }
    const mag = Math.hypot(ix, iy);
    if (mag > 1) { ix /= mag; iy /= mag; }

    const running = !!(k.shift);
    const water = this.waterDepth;
    this.inWater = clamp(water / 0.7, 0, 1);
    let target = (running ? RUN_SPEED : WALK_SPEED) * this.pace;
    target *= 1 - this.inWater * 0.55;
    // a wet, boggy, lovely slowdown on the steep bits
    const slope = this.field.slopeAt(this.position.x, this.position.z, 1.6);
    target *= 1 - smoothstep(0.25, 0.7, slope) * 0.45;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -Z rotated by yaw
    const wishX = (ix * cos - iy * sin);
    const wishZ = (ix * sin + iy * cos);

    const accel = this.onGround ? 15 : 4;
    this.velocity.x += (wishX * target - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (wishZ * target - this.velocity.z) * Math.min(1, accel * dt);
    if (!ix && !iy) {
      const damp = Math.max(0, 1 - 11 * dt);
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    }

    // --- try to move, then resolve -------------------------------
    const px = this.position.x, pz = this.position.z;
    let nx = px + this.velocity.x * dt;
    let nz = pz + this.velocity.z * dt;

    // walkable limits, gently
    const L = WORLD.walkLimit;
    if (Math.abs(nx) > L) { nx = Math.sign(nx) * L; this.velocity.x *= 0.3; }
    if (Math.abs(nz) > L) { nz = Math.sign(nz) * L; this.velocity.z *= 0.3; }

    // do not climb what is too steep, and never walk into a wall
    this.blocked = false;
    const stepH = STEP_HEIGHT;
    const candY = this.field.height(nx, nz);
    if (candY - this.groundY > stepH) {
      // too high: slide along whichever axis is still open
      const ax = this.field.height(nx, pz);
      const az = this.field.height(px, nz);
      if (ax - this.groundY <= stepH) { nz = pz; this.velocity.z *= 0.2; }
      else if (az - this.groundY <= stepH) { nx = px; this.velocity.x *= 0.2; }
      else { nx = px; nz = pz; this.velocity.x *= 0.2; this.velocity.z *= 0.2; }
      this.blocked = true;
    }

    const solved = this._resolve(nx, nz);
    this.position.x = solved.x;
    this.position.z = solved.z;

    // --- follow the ground ---------------------------------------
    const gy = this.field.height(this.position.x, this.position.z);
    this.groundY += (gy - this.groundY) * Math.min(1, 22 * dt);
    this.position.y = this.groundY;
    this.onGround = true;

    // --- the Water ----------------------------------------------
    const r = riverAt(this.position.x, this.position.z);
    this.waterDepth = Math.max(0, r.level - this.groundY);
    if (this.waterDepth > 1.0) {
      // too deep to wade: the current sets you back towards the bank
      const out = this._outward(this.position.x, this.position.z);
      this.position.x = out.x;
      this.position.z = out.z;
      this.groundY = this.field.height(this.position.x, this.position.z);
      this.waterDepth = Math.max(0, riverAt(this.position.x, this.position.z).level - this.groundY);
    }

    // --- head bob and footsteps -----------------------------------
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = hs;
    const moving = hs > 0.25;
    this.bobAmount += ((moving ? clamp(hs / WALK_SPEED, 0, 1.7) : 0) - this.bobAmount) * Math.min(1, 8 * dt);
    if (moving) this.bob += dt * hs * 3.05;
    const phase = Math.sin(this.bob);
    if (this._lastStepPhase <= 0 && phase > 0 && moving && this.onStep) {
      const f = this.field;
      const l = {
        road: f.sample(f.road, this.position.x, this.position.z),
        wet: f.sample(f.wet, this.position.x, this.position.z),
        crop: f.sample(f.crop, this.position.x, this.position.z)
      };
      this.onStep(this.waterDepth > 0.05 ? 'water' : l.road > 0.4 ? 'road' : l.crop > 0.4 ? 'field' : 'grass', this.inWater);
    }
    this._lastStepPhase = phase;

    // --- camera ----------------------------------------------------
    const bobY = Math.sin(this.bob * 2) * 0.035 * this.bobAmount;
    const bobX = Math.sin(this.bob) * 0.028 * this.bobAmount;
    const roll = Math.sin(this.bob) * 0.0075 * this.bobAmount;
    const breathe = Math.sin(performance.now() * 0.0011) * 0.006;
    this.camera.position.set(
      this.position.x + bobX * Math.cos(this.yaw),
      this.groundY + EYE_HEIGHT + bobY + breathe - this.inWater * 0.16,
      this.position.z - bobX * Math.sin(this.yaw)
    );
    this._euler.set(this.pitch, this.yaw, roll);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  _outward(x, z) {
    // step away from the channel centre, found as the gradient of the
    // distance field — cheap, and it always points at the bank
    const e = 1.2;
    const gx = riverAt(x + e, z).d - riverAt(x - e, z).d;
    const gz = riverAt(x, z + e).d - riverAt(x, z - e).d;
    const l = Math.hypot(gx, gz) || 1;
    return { x: x + (gx / l) * 1.8, z: z + (gz / l) * 1.8 };
  }

  _resolve(x, z) {
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const c of this.colliders) {
        if (c.box) {
          // oriented box
          const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
          const ox = x - c.x, oz = z - c.z;
          let lx = ox * cs - oz * sn, lz = ox * sn + oz * cs;
          lx -= c.cx; lz -= c.cz;
          const hx = c.hw + 0.34, hz = c.hd + 0.34;
          if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
            const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
            if (px < pz) lx += Math.sign(lx || 1) * px;
            else lz += Math.sign(lz || 1) * pz;
            const cs2 = Math.cos(c.rot), sn2 = Math.sin(c.rot);
            x = c.x + (lx + c.cx) * cs2 - (lz + c.cz) * sn2;
            z = c.z + (lx + c.cx) * sn2 + (lz + c.cz) * cs2;
            this.blocked = true;
            hit = true;
          }
        } else {
          const dx = x - c.x, dz = z - c.z;
          const rr = c.r + 0.34;
          if (dx * dx + dz * dz < rr * rr) {
            const d = Math.sqrt(dx * dx + dz * dz) || 1e-4;
            x = c.x + (dx / d) * rr;
            z = c.z + (dz / d) * rr;
            this.blocked = true;
            hit = true;
          }
        }
      }
      if (!hit) break;
    }
    return { x, z };
  }

  forward(out) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    window.removeEventListener('wheel', this._onWheel);
  }
}

export { TAU, lerp, smoothstep };
