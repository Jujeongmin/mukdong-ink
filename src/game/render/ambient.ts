// Atmosphere per zone theme: the post-pass mood (palette, sky, moon, haze), drifting fireflies in the
// bamboo grove, rain and lightning on the peak, warm lantern light pools and the moon's streak on water.
// Every pool is created once (SHARED) and only shown/hidden; nothing allocates per frame.

import * as THREE from "three";
import type { ZoneDef } from "../../shared/world";
import { G } from "./materials";
import { camera, overlay, setFlash, setMood, type Mood } from "./gfx";

type Theme = ZoneDef["theme"];
interface ThemeMood extends Mood {
  fireflies: number;
  rain: boolean;
  lightning: boolean;
}

const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export const MOODS: Record<Theme, ThemeMood> = {
  // night village: violet-blue sky, a high moon, lantern glows carry the warmth
  village: {
    paper: [0.62, 0.64, 0.72], ink: [0.04, 0.045, 0.09], skyTop: [0.12, 0.13, 0.25], skyLow: [0.5, 0.52, 0.66], mist: [0.58, 0.6, 0.72],
    moon: [0.8, 0.88, 0.042, 1], fogLow: 0.3, hazeNear: 28, hazeFar: 74,
    hemiSky: 0xa8b4d8, hemiGround: 0x34303e, hemiI: 1.15, moonCol: 0xbfd0ff, moonI: 2.0, fireflies: 0, rain: false, lightning: false, pillars: 0.35, pillarH: 0.9,
  },
  // bamboo: blue moonlight in heavy mist, fireflies
  bamboo: {
    paper: [0.62, 0.69, 0.75], ink: [0.03, 0.06, 0.09], skyTop: [0.1, 0.17, 0.28], skyLow: [0.6, 0.7, 0.78], mist: [0.66, 0.75, 0.82],
    moon: [0.22, 0.86, 0.05, 0.9], fogLow: 0.45, hazeNear: 26, hazeFar: 72,
    hemiSky: 0xa6c4dc, hemiGround: 0x2e3a3c, hemiI: 1.2, moonCol: 0xb8d4ff, moonI: 2.2, fireflies: coarse ? 26 : 44, rain: false, lightning: false, pillars: 1, pillarH: 1.1,
  },
  // pond: dusk fading violet to peach over the water, low moon and its streak
  pond: {
    paper: [0.74, 0.7, 0.72], ink: [0.08, 0.05, 0.1], skyTop: [0.3, 0.25, 0.46], skyLow: [0.93, 0.74, 0.64], mist: [0.86, 0.76, 0.76],
    moon: [0.72, 0.8, 0.055, 0.85], fogLow: 0.6, hazeNear: 26, hazeFar: 72,
    hemiSky: 0xe0c4c8, hemiGround: 0x3e3444, hemiI: 1.3, moonCol: 0xffd6c0, moonI: 1.9, fireflies: coarse ? 10 : 16, rain: false, lightning: false, pillars: 0.7, pillarH: 0.8,
  },
  // peak: storm, no moon, rain and lightning
  peak: {
    paper: [0.5, 0.53, 0.58], ink: [0.03, 0.035, 0.05], skyTop: [0.08, 0.09, 0.12], skyLow: [0.4, 0.43, 0.5], mist: [0.46, 0.49, 0.56],
    moon: [0.5, 0.9, 0, 0], fogLow: 0.4, hazeNear: 24, hazeFar: 64,
    hemiSky: 0x8e9ab0, hemiGround: 0x26262c, hemiI: 1.1, moonCol: 0xaab8d8, moonI: 1.6, fireflies: 0, rain: true, lightning: true, pillars: 1, pillarH: 1.5,
  },
};

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
    setFlash(0);
    flies.count = this.mood.fireflies;
    rain.visible = this.mood.rain;
    bolt.visible = false;
    this.flashT = 0;
    this.flashNext = 4 + Math.random() * 4;
    this.seeded = false;
  }

  update(dt: number, time: number, cx: number, cz: number): void {
    glowMat.uniforms.uTime.value = time;
    moonStreakMat.uniforms.uTime.value = time;
    flyMat.uniforms.uTime.value = time;
    const m = this.mood;
    if (!this.seeded) { this.seed(cx, cz); this.seeded = true; }
    // fireflies wander around the player and wrap back when left behind
    if (m.fireflies > 0) {
      for (let i = 0; i < m.fireflies; i++) {
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
      for (let i = 0; i < RAIN_N; i++) {
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

  private seed(cx: number, cz: number): void {
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
