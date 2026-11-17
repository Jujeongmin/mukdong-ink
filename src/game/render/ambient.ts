// Atmosphere per zone theme: the post-pass mood (palette, sky, moon, haze), drifting fireflies in the
// bamboo grove, rain and lightning on the peak, ash / embers / chimney smoke motes, warm lantern light
// pools and the moon's streak on water. Every pool is created once (SHARED) and only shown/hidden; nothing
// allocates per frame.

import * as THREE from "three";
import type { ZoneDef } from "../../shared/world";
import { G, setActorShadow } from "./materials";
import { camera, onQuality, overlay, setFlash, setMood, type Mood } from "./gfx";

type Theme = ZoneDef["theme"];
interface ThemeMood extends Mood {
  fireflies: number;
  rain: boolean;
  lightning: boolean;
  /** pooled drifting specks: ash falling (kiln), paper-white embers rising from the censer, ash blowing in at the peak's east door */
  motes?: "ash" | "embers" | "drift";
}

const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export const MOODS: Record<Theme, ThemeMood> = {
  // night village: violet-blue sky, a high moon in cloud, soft wooded ridges; lantern glows carry the warmth
  village: {
    paper: [0.62, 0.64, 0.72], ink: [0.035, 0.04, 0.085], skyTop: [0.1, 0.11, 0.22], skyLow: [0.52, 0.54, 0.68], mist: [0.6, 0.62, 0.74],
    moon: [0.8, 0.9, 0.05, 1], fogLow: 0.35, hazeNear: 26, hazeFar: 72,
    hemiSky: 0xa8b4d8, hemiGround: 0x34303e, hemiI: 1.15, moonCol: 0xbfd0ff, moonI: 2.0, fireflies: 0, rain: false, lightning: false,
    pillars: 0.15, pillarH: 1.0, stalks: 0, glow: 0.35, clouds: 0.8, fgDark: 0.55,
    sun: [-62, 38], shade: [0.8, 1.0, 7],
  },
  // bamboo: blue moonlight in heavy mist, a grove of distant stalks, fireflies
  bamboo: {
    paper: [0.6, 0.67, 0.74], ink: [0.025, 0.05, 0.08], skyTop: [0.08, 0.14, 0.25], skyLow: [0.58, 0.68, 0.78], mist: [0.66, 0.75, 0.83],
    moon: [0.62, 0.9, 0.055, 0.95], fogLow: 0.55, hazeNear: 22, hazeFar: 66,
    hemiSky: 0xa6c4dc, hemiGround: 0x2e3a3c, hemiI: 1.2, moonCol: 0xb8d4ff, moonI: 2.2, fireflies: coarse ? 26 : 44, rain: false, lightning: false,
    pillars: 1, pillarH: 1.2, stalks: 1, glow: 0.45, clouds: 0.6, fgDark: 0.6,
    sun: [-80, 48], shade: [0.8, 1.1, 7],
  },
  // pond: dusk, violet overhead burning down to peach and rose over the water, a low moon and its streak
  pond: {
    paper: [0.79, 0.7, 0.69], ink: [0.09, 0.05, 0.1], skyTop: [0.27, 0.2, 0.44], skyLow: [0.98, 0.7, 0.55], mist: [0.92, 0.75, 0.7],
    moon: [0.74, 0.86, 0.06, 0.9], fogLow: 0.6, hazeNear: 24, hazeFar: 70,
    hemiSky: 0xf0c4b8, hemiGround: 0x3e3444, hemiI: 1.3, moonCol: 0xffc8a8, moonI: 2.0, fireflies: coarse ? 10 : 16, rain: false, lightning: false,
    pillars: 0.1, pillarH: 1.0, stalks: 0, glow: 0.8, clouds: 0.9, fgDark: 0.5,
    // the low dusk light lays long, soft shadows across the banks
    sun: [-68, 22], shade: [0.74, 1.9, 12],
  },
  // peak: storm, no moon, heavy cloud, rain and lightning over tall karst pillars
  peak: {
    paper: [0.5, 0.53, 0.58], ink: [0.025, 0.03, 0.045], skyTop: [0.07, 0.08, 0.11], skyLow: [0.42, 0.45, 0.52], mist: [0.48, 0.51, 0.58],
    moon: [0.5, 0.9, 0, 0], fogLow: 0.45, hazeNear: 22, hazeFar: 62,
    hemiSky: 0x8e9ab0, hemiGround: 0x26262c, hemiI: 1.1, moonCol: 0xaab8d8, moonI: 1.6, fireflies: 0, rain: true, lightning: true,
    pillars: 1, pillarH: 1.7, stalks: 0, glow: 0.25, clouds: 1.6, fgDark: 0.7,
    // no moon in the storm: light from high above, shadows pool softly at the feet of things
    sun: [-100, 74], shade: [0.66, 3.2, 4], motes: "drift",
  },
  // chapter 2. old kiln yard: warm ink on yellowed paper, a low grey sky with a white sun that gives no light, ash falling
  kiln: {
    paper: [0.85, 0.81, 0.75], ink: [0.08, 0.062, 0.05], skyTop: [0.42, 0.39, 0.35], skyLow: [0.72, 0.68, 0.62], mist: [0.76, 0.72, 0.66],
    moon: [0.68, 0.86, 0.065, 1], sunRing: 0.08, skyPow: 0.95, fogLow: 0.4, hazeNear: 24, hazeFar: 70,
    hemiSky: 0xd8ccb8, hemiGround: 0x3a3028, hemiI: 1.25, moonCol: 0xf0e4d0, moonI: 1.9, fireflies: 0, rain: false, lightning: false,
    pillars: 0.2, pillarH: 0.95, stalks: 0, glow: 0.3, clouds: 0.5, fgDark: 0.5,
    sun: [-55, 30], shade: [0.72, 1.4, 9], motes: "ash",
  },
  // burnt temple: cold violet ink, a dawn that never comes (a thin paper band under dark ink), white mist on the ground
  temple: {
    paper: [0.85, 0.845, 0.83], ink: [0.045, 0.04, 0.065], skyTop: [0.06, 0.055, 0.09], skyLow: [0.82, 0.81, 0.82], mist: [0.88, 0.88, 0.9],
    moon: [0.5, 0.9, 0, 0], skyPow: 0.22, fogLow: 1.0, hazeNear: 22, hazeFar: 64,
    hemiSky: 0xa8a8c8, hemiGround: 0x2a2834, hemiI: 1.1, moonCol: 0xc8c8e8, moonI: 1.6, fireflies: 0, rain: false, lightning: false,
    pillars: 0.6, pillarH: 1.0, stalks: 0, glow: 0.65, clouds: 0.4, fgDark: 0.6,
    sun: [-90, 55], shade: [0.6, 2.2, 6],
  },
  // censer yard (boss): the darkest ink and sharp paper only, a huge empty white sun with ink bleeding in, paper embers
  censer: {
    paper: [0.9, 0.88, 0.84], ink: [0.02, 0.018, 0.022], skyTop: [0.035, 0.03, 0.04], skyLow: [0.16, 0.15, 0.16], mist: [0.22, 0.21, 0.22],
    moon: [0.5, 0.78, 0.13, 1], sunRing: 0.32, skyPow: 0.5, contrast: 0.6, fogLow: 0.3, hazeNear: 20, hazeFar: 56,
    hemiSky: 0x9898a0, hemiGround: 0x1c1a1e, hemiI: 1.0, moonCol: 0xe8e4dc, moonI: 2.2, fireflies: 0, rain: false, lightning: false,
    pillars: 1, pillarH: 1.3, stalks: 0, glow: 0.15, clouds: 0.3, fgDark: 0.75,
    sun: [-90, 62], shade: [0.7, 1.6, 6], motes: "embers",
  },
};

/* ---------- motes: ash flakes and paper embers (camera-facing, instanced, pooled; quality halves them) ---------- */
const MOTE_N = 180;
const moteMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uCol: { value: new THREE.Vector3(0.82, 0.8, 0.76) }, uSoft: { value: 0.5 }, uA: { value: 0.75 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv; varying float vSeed;
    void main(){
      vUv = uv; vSeed = float(gl_InstanceID);
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float s = length(instanceMatrix[0].xyz);
      mv.xy += position.xy * s;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uCol; uniform float uSoft, uA; varying vec2 vUv; varying float vSeed;
    void main(){
      vec2 p = vUv - 0.5;
      // a ragged flake (ash) or a soft point (embers)
      float a = atan(p.y, p.x), r = length(p) * 2.0 * (1.0 + (0.1 * sin(a * 3.0 + vSeed) + 0.07 * sin(a * 7.0 + vSeed * 2.0)) * (1.0 - uSoft) + 0.1 * sin(a * 2.0 + vSeed * 3.0));
      float m = 1.0 - smoothstep(0.35 * (1.0 - uSoft), 1.0, r);
      if (m < 0.02) discard;
      gl_FragColor = vec4(uCol, m * uA);
    }`,
});
const motes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), moteMat, MOTE_N);
motes.frustumCulled = false;
motes.count = 0;
overlay.add(motes);
const mx = new Float32Array(MOTE_N), my = new Float32Array(MOTE_N), mz = new Float32Array(MOTE_N), mv = new Float32Array(MOTE_N), mph = new Float32Array(MOTE_N);
let moteKind: ThemeMood["motes"] = undefined;
/** the censer the embers rise from (scenery at the boss spot) */
const EMBER_SRC = { x: 0, z: -7 };
/** the kiln yard's chimney tops (world.ts kiln(): two climbing kilns and the big kiln); thin smoke rises straight from each */
const KILN_SMOKE = [[-23.28, 8.55, -8.16], [24.52, 8.55, -14.4], [-19.47, 7.5, -19.47]] as const;
/** in the kiln yard every other mote is chimney smoke instead of falling ash (so a quality cut keeps both) */
const isSmoke = (i: number): boolean => (i & 1) === 1;
const smokeSrc = (i: number) => KILN_SMOKE[(i >> 1) % KILN_SMOKE.length];
/** the peak's east door the ash blows in through */
const DRIFT_SRC = { x: 28, z: 3 };
let emberTint = 0;
/** The fragment of fire shows itself: the censer's embers bloom cinnabar for a moment (skill-colour moment). */
export function emberBloom(): void {
  emberTint = 2.5;
}

/* ---------- fireflies: camera-facing glow quads, instanced ---------- */
const FLY_N = 48;
const flyMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    uniform float uTime; varying vec2 vUv; varying float vA;
    void main(){
      vUv = uv;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float s = length(instanceMatrix[0].xyz);
      mv.xy += position.xy * s;
      vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.3 + float(gl_InstanceID) * 1.7), 3.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; varying float vA;
    void main(){
      float r = length(vUv - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.0, 0.18, r);
      float glow = exp(-r * 3.2) * 0.55;
      float a = (core + glow) * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vec3(0.85, 0.95, 0.5) * a, a);
    }`,
});
const flies = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), flyMat, FLY_N);
flies.frustumCulled = false;
flies.count = 0;
overlay.add(flies);
const fx = new Float32Array(FLY_N), fy = new Float32Array(FLY_N), fz = new Float32Array(FLY_N), fph = new Float32Array(FLY_N);

/* ---------- rain: line segments around the camera target ---------- */
const RAIN_N = coarse ? 170 : 320;
const rainPos = new Float32Array(RAIN_N * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb4c4dc, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }));
rain.frustumCulled = false;
rain.visible = false;
overlay.add(rain);
const rx = new Float32Array(RAIN_N), ry = new Float32Array(RAIN_N), rz = new Float32Array(RAIN_N), rv = new Float32Array(RAIN_N);
/** graphics quality: share of fireflies and rain streaks drawn (low halves them) */
let ambDensity = 1;
let rainActive = RAIN_N;
let curFlies = 0;
let moteTarget = 0;
onQuality((l) => {
  ambDensity = l === "low" ? 0.5 : 1;
  rainActive = Math.round(RAIN_N * ambDensity);
  rainGeo.setDrawRange(0, rainActive * 2);
  flies.count = Math.round(curFlies * ambDensity);
  motes.count = Math.round(moteTarget * ambDensity);
});

/* ---------- lightning: a jagged bolt far to the north + the post-pass flash ---------- */
const BOLT_N = 12;
const boltGeo = new THREE.BufferGeometry();
boltGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BOLT_N * 3), 3));
const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
bolt.frustumCulled = false;
bolt.visible = false;
overlay.add(bolt);

/* ---------- warm light pools (lanterns, windows) and the moon streak on water ---------- */
/** SHARED: soft additive pool, flickering by its world position. Owned meshes live in world.ts. */
export const glowMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; varying float vSeed;
    void main(){ vUv = uv; vSeed = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.71;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv; varying float vSeed;
    void main(){
      float r = length(vUv - 0.5) * 2.0;
      float f = 0.85 + 0.15 * sin(uTime * 7.0 + vSeed) * sin(uTime * 3.1 + vSeed * 2.0);
      float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.85, 1.0, r)) * 0.32 * f;
      gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a, a);
    }`,
});
export const moonStreakMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 p = vUv - 0.5;
      float w = exp(-pow(p.x * 5.0, 2.0)) * (1.0 - smoothstep(0.3, 0.5, abs(p.y)));
      float row = floor(vUv.y * 46.0);
      float rip = step(0.45, fract(vUv.x * 3.0 + hash(row) * 7.0 + sin(uTime * 1.3 + row) * 0.3));
      float a = w * (0.35 + 0.65 * rip) * 0.42;
      gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a);
    }`,
});
export const flatGeo = G.flat;

const dummy = new THREE.Object3D();

export class Ambient {
  private mood: ThemeMood = MOODS.village;
  private flashT = 0;
  private flashNext = 6;
  private boltLife = 0;
  private seeded = false;

  setTheme(theme: Theme): void {
    this.mood = MOODS[theme] ?? MOODS.village;
    setMood(this.mood);
    setActorShadow(this.mood.sun, this.mood.shade);
    setFlash(0);
    curFlies = this.mood.fireflies;
    flies.count = Math.round(curFlies * ambDensity);
    moteKind = this.mood.motes;
    moteTarget = moteKind === "ash" ? MOTE_N : moteKind === "embers" ? 90 : moteKind === "drift" ? 50 : 0;
    motes.count = Math.round(moteTarget * ambDensity);
    emberTint = 0;
    if (moteKind === "ash" || moteKind === "drift") { moteMat.uniforms.uCol.value.set(0.8, 0.78, 0.74); moteMat.uniforms.uSoft.value = 0.4; moteMat.uniforms.uA.value = 0.6; }
    else { moteMat.uniforms.uCol.value.set(0.97, 0.96, 0.92); moteMat.uniforms.uSoft.value = 0.85; moteMat.uniforms.uA.value = 0.9; }
    rain.visible = this.mood.rain;
    bolt.visible = false;
    this.flashT = 0;
    this.flashNext = 4 + Math.random() * 4;
    this.seeded = false;
  }

  /** Leaving the field (back to the title): the pools are SHARED and stay; nothing to free. */
  dispose(): void {
    // nothing OWNED
  }

  update(dt: number, time: number, cx: number, cz: number): void {
    glowMat.uniforms.uTime.value = time;
    moonStreakMat.uniforms.uTime.value = time;
    flyMat.uniforms.uTime.value = time;
    const m = this.mood;
    if (!this.seeded) { this.seed(cx, cz); this.seeded = true; }
    if (motes.count > 0) this.updateMotes(dt, time, cx, cz);
    // fireflies wander around the player and wrap back when left behind
    if (m.fireflies > 0) {
      for (let i = 0; i < flies.count; i++) {
        fph[i] += dt * (0.4 + (i % 5) * 0.08);
        fx[i] += Math.sin(fph[i] * 1.3 + i) * dt * 0.8;
        fz[i] += Math.cos(fph[i] * 0.9 + i * 2.1) * dt * 0.8;
        if (fx[i] - cx > 16) fx[i] -= 32; else if (cx - fx[i] > 16) fx[i] += 32;
        if (fz[i] - cz > 14) fz[i] -= 28; else if (cz - fz[i] > 14) fz[i] += 28;
        dummy.position.set(fx[i], fy[i] + Math.sin(fph[i] * 2 + i) * 0.4, fz[i]);
        dummy.scale.setScalar(0.62);
        dummy.updateMatrix();
        flies.setMatrixAt(i, dummy.matrix);
      }
      flies.instanceMatrix.needsUpdate = true;
    }
    if (m.rain) {
      for (let i = 0; i < rainActive; i++) {
        ry[i] -= rv[i] * dt;
        rx[i] += 3 * dt;
        if (ry[i] < 0) this.dropRain(i, cx, cz, false);
        if (rx[i] - cx > 18) rx[i] -= 36;
        if (rz[i] - cz > 16) rz[i] -= 30; else if (cz - rz[i] > 16) rz[i] += 30;
        const j = i * 6;
        rainPos[j] = rx[i]; rainPos[j + 1] = ry[i]; rainPos[j + 2] = rz[i];
        rainPos[j + 3] = rx[i] - 0.18; rainPos[j + 4] = ry[i] + 1.1; rainPos[j + 5] = rz[i];
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (m.lightning) {
      this.flashNext -= dt;
      if (this.flashNext <= 0) {
        this.flashT = 0.0001;
        this.flashNext = 5 + Math.random() * 7;
        this.strike(cx, cz);
      }
      if (this.flashT > 0) {
        this.flashT += dt;
        const t = this.flashT;
        // a bright crack, a dip, a second softer flicker
        const v = t < 0.08 ? t / 0.08 : t < 0.16 ? 1 - (t - 0.08) / 0.08 * 0.8 : t < 0.24 ? 0.2 + (t - 0.16) / 0.08 * 0.5 : Math.max(0, 0.7 - (t - 0.24) * 1.6);
        setFlash(v);
        if (t > 0.7) { this.flashT = 0; setFlash(0); }
      }
      if (this.boltLife > 0) {
        this.boltLife -= dt;
        if (this.boltLife <= 0) bolt.visible = false;
      }
    }
  }

  private updateMotes(dt: number, time: number, cx: number, cz: number): void {
    const n = motes.count;
    if (emberTint > 0) {
      // the cinnabar bloom fades back to paper white
      emberTint = Math.max(0, emberTint - dt);
      const k = Math.min(1, emberTint);
      moteMat.uniforms.uCol.value.set(0.97 - k * 0.12, 0.96 - k * 0.66, 0.92 - k * 0.74);
    }
    for (let i = 0; i < n; i++) {
      if (moteKind === "ash" && isSmoke(i)) {
        // chimney smoke: a thin column rising straight up, the faintest sway
        const src = smokeSrc(i);
        my[i] += mv[i] * dt;
        mx[i] = src[0] + Math.sin(time * 0.6 + mph[i]) * 0.06 * (my[i] - src[1]) * 0.3;
        if (my[i] > src[1] + 11) my[i] = src[1];
      } else if (moteKind === "ash") {
        my[i] -= mv[i] * dt;
        mx[i] += Math.sin(time * 0.7 + mph[i]) * 0.35 * dt + 0.15 * dt;
        mz[i] += Math.cos(time * 0.5 + mph[i] * 1.3) * 0.25 * dt;
        if (my[i] < 0) { my[i] = 9 + Math.random() * 4; mx[i] = cx + (Math.random() - 0.5) * 34; mz[i] = cz + (Math.random() - 0.5) * 30 - 3; }
        if (mx[i] - cx > 17) mx[i] -= 34; else if (cx - mx[i] > 17) mx[i] += 34;
        if (mz[i] - cz > 15) mz[i] -= 30; else if (cz - mz[i] > 15) mz[i] += 30;
      } else if (moteKind === "embers") {
        my[i] += mv[i] * dt;
        mx[i] += Math.sin(time * 1.3 + mph[i]) * 0.4 * dt;
        mz[i] += Math.cos(time * 1.1 + mph[i]) * 0.3 * dt;
        if (my[i] > 11) this.dropMote(i, cx, cz);
      } else {
        // blown in through the east door, westward, sinking slowly
        mx[i] -= mv[i] * dt;
        my[i] += Math.sin(time * 1.7 + mph[i]) * 0.2 * dt - 0.08 * dt;
        mz[i] += Math.cos(time * 0.9 + mph[i]) * 0.3 * dt;
        if (mx[i] < DRIFT_SRC.x - 12 || my[i] < 0.05) this.dropMote(i, cx, cz);
      }
      dummy.position.set(mx[i], my[i], mz[i]);
      const smoke = moteKind === "ash" && isSmoke(i);
      dummy.scale.setScalar(moteKind === "embers" ? 0.09 + (i % 4) * 0.02 : smoke ? 0.45 + (my[i] - smokeSrc(i)[1]) * 0.09 : 0.11 + (i % 5) * 0.025);
      dummy.updateMatrix();
      motes.setMatrixAt(i, dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;
  }

  private dropMote(i: number, cx: number, cz: number): void {
    mph[i] = Math.random() * 10;
    if (moteKind === "ash" && isSmoke(i)) {
      const src = smokeSrc(i);
      mx[i] = src[0]; mz[i] = src[2]; my[i] = src[1] + Math.random() * 11; mv[i] = 0.7 + Math.random() * 0.3;
    } else if (moteKind === "ash") {
      mx[i] = cx + (Math.random() - 0.5) * 34; mz[i] = cz + (Math.random() - 0.5) * 30 - 3; my[i] = Math.random() * 12; mv[i] = 0.45 + Math.random() * 0.45;
    } else if (moteKind === "embers") {
      // most rise out of the censer, a few anywhere in the yard
      const near = Math.random() < 0.75, a = Math.random() * 6.28, r = near ? Math.random() * 2.2 : Math.random() * 18;
      mx[i] = (near ? EMBER_SRC.x : cx) + Math.cos(a) * r; mz[i] = (near ? EMBER_SRC.z : cz) + Math.sin(a) * r;
      my[i] = near ? 1.6 + Math.random() * 1.5 : Math.random() * 3; mv[i] = 0.6 + Math.random() * 1.1;
    } else {
      mx[i] = DRIFT_SRC.x + Math.random() * 3; mz[i] = DRIFT_SRC.z + (Math.random() - 0.5) * 6; my[i] = 0.3 + Math.random() * 3; mv[i] = 1.2 + Math.random() * 1.4;
    }
  }

  private seed(cx: number, cz: number): void {
    for (let i = 0; i < MOTE_N; i++) {
      this.dropMote(i, cx, cz);
      if (moteKind === "embers") my[i] = 1.6 + Math.random() * 9;
      if (moteKind === "drift") mx[i] = DRIFT_SRC.x - Math.random() * 12;
    }
    for (let i = 0; i < FLY_N; i++) {
      fx[i] = cx + (Math.random() - 0.5) * 32;
      fz[i] = cz + (Math.random() - 0.5) * 28;
      fy[i] = 0.6 + Math.random() * 2.6;
      fph[i] = Math.random() * 10;
    }
    for (let i = 0; i < RAIN_N; i++) this.dropRain(i, cx, cz, true);
  }

  private dropRain(i: number, cx: number, cz: number, anyHeight: boolean): void {
    rx[i] = cx + (Math.random() - 0.5) * 36;
    rz[i] = cz + (Math.random() - 0.5) * 30 - 4;
    ry[i] = anyHeight ? Math.random() * 16 : 14 + Math.random() * 4;
    rv[i] = 24 + Math.random() * 10;
  }

  private strike(cx: number, cz: number): void {
    // somewhere in the distant north, from the clouds down onto a pillar
    const pos = boltGeo.attributes.position.array as Float32Array;
    let x = cx + (Math.random() - 0.5) * 70, y = 70;
    const z = camera.position.z - 75 - Math.random() * 30;
    for (let k = 0; k < BOLT_N; k++) {
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      x += (Math.random() - 0.5) * 7;
      y -= 4 + Math.random() * 3;
    }
    boltGeo.attributes.position.needsUpdate = true;
    bolt.visible = true;
    this.boltLife = 0.16;
    void cz;
  }
}
