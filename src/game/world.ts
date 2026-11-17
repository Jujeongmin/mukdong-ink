// Zone scenery built from ZONES[zone].theme. Static scenery is baked into one mesh per material
// (mergeGeometries) to keep draw calls low; tall scenery only goes north of the play area because the
// camera looks from the south. On a zone change everything this file created is disposed (OWNED baked
// geometry); materials and unit geometries come from materials.ts and are SHARED.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Npc, Portal, ZoneDef } from "../shared/world";
import { ITEM, type ItemDef } from "../shared/items";
import { fbm3, rng } from "./util";
import { G, M, dyeMat, lam } from "./render/materials";
import { overlay, scene } from "./render/gfx";
import { QUAD_VERT } from "./render/fx";
import { flatGeo, glowMat, moonStreakMat } from "./render/ambient";
import { POSE, Rig } from "./render/rig";
import type { Collider, Field } from "./actor";

export interface Anchor {
  x: number;
  y: number;
  z: number;
  text: string;
  kind: "portal" | "npc";
  /** NPC id (for quest marks) */
  id?: string;
}

/* ---------- baking ---------- */
class Baker {
  private readonly bins = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const mat = m.material as THREE.Material;
      let list = this.bins.get(mat);
      if (!list) { list = []; this.bins.set(mat, list); }
      list.push(g);
    });
  }
  flush(parent: THREE.Group, owned: THREE.BufferGeometry[]): void {
    for (const [mat, list] of this.bins) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      owned.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.bins.clear();
  }
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** Lumpy rock; a temporary geometry the baker copies (disposed right after). */
function makeRock(sx: number, sy: number, sz: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = fbm3(v.x * 1.5 + seed, v.y * 1.5, v.z * 1.5);
    const s = fbm3(v.x * 4 + seed, v.y * 1.1, v.z * 4, 3);
    const r = 0.75 + 0.5 * n + 0.15 * (s - 0.5);
    p.setXYZ(i, v.x * r * sx, (v.y < 0 ? v.y * 0.35 : v.y) * r * sy, v.z * r * sz);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const out = mergeVertices(g, 1e-4);
  g.dispose();
  out.computeVertexNormals();
  out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

/* ---------- portal veil (overlay, animated ink swirl; SHARED material) ---------- */
const VEIL_FRAG = `
  uniform float uTime; varying vec2 vUv;
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p * vec2(1.0, 0.8)), a = atan(p.y, p.x);
    float sw = noise(vec2(a * 2.0 + r * 4.0 - uTime * 1.2, r * 3.0 - uTime * 0.5));
    float m = smoothstep(1.0, 0.55, r) * smoothstep(0.25, 0.75, sw);
    float alpha = m * 0.55;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(vec3(0.08, 0.075, 0.07), alpha);
  }`;
const veilMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 } }, vertexShader: QUAD_VERT, fragmentShader: VEIL_FRAG,
});
const veilGeo = new THREE.PlaneGeometry(2.4, 2.6);
// Lantern paper and lit windows: unlit warm color written with the dyed alpha, so the ink pass keeps it.
const GLOW_PARAMS: THREE.MeshBasicMaterialParameters = {
  opacity: 0.5, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
};
const M_lanternGlow = new THREE.MeshBasicMaterial({ color: 0xffa24a, ...GLOW_PARAMS });
const M_windowGlow = new THREE.MeshBasicMaterial({ color: 0xf2b45e, ...GLOW_PARAMS });

export class ZoneScene {
  readonly group = new THREE.Group();
  readonly field: Field;
  readonly anchors: Anchor[] = [];
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly baker = new Baker();
  private readonly rand: () => number;
  private readonly colliders: Collider[] = [];
  private readonly npcRigs: { rig: Rig; base: Float32Array; phase: number }[] = [];
  private readonly veils: THREE.Mesh[] = [];
  /** overlay glow/reflection meshes (OWNED meshes, SHARED geometry/material) */
  private readonly glows: THREE.Mesh[] = [];

  constructor(readonly def: ZoneDef) {
    this.rand = rng(def.id.length * 977 + def.radius * 31 + def.id.charCodeAt(0));
    this.field = { radius: def.radius, colliders: this.colliders };
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    this.ground();
    switch (def.theme) {
      case "village": this.village(); break;
      case "bamboo": this.bambooGrove(); break;
      case "pond": this.pond(); break;
      case "peak": this.peak(); break;
    }
    for (const p of def.portals) this.portal(p);
    for (const n of def.npcs) this.npc(n);
    this.baker.flush(this.group, this.owned);
  }

  update(dt: number, time: number): void {
    veilMat.uniforms.uTime.value = time;
    for (const n of this.npcRigs) {
      n.rig.pose.set(n.base);
      n.rig.pose[11] += Math.sin(time * 1.8 + n.phase) * 0.02;
      n.rig.pose[0] += Math.sin(time * 1.8 + n.phase) * 0.015;
      n.rig.apply();
    }
    void dt;
  }

  dispose(): void {
    scene.remove(this.group);
    for (const g of this.owned) g.dispose(); // OWNED baked geometry
    this.owned.length = 0;
    for (const n of this.npcRigs) scene.remove(n.rig.group); // rig parts are SHARED
    for (const v of this.veils) overlay.remove(v); // SHARED veil geometry/material
    for (const m of this.glows) overlay.remove(m); // SHARED glow geometry/material
  }

  /* ---------- common pieces ---------- */
  private ground(): void {
    const g = new THREE.Group();
    g.add(part(G.disc, lam(this.def.ground), 0, 0, 0, this.def.radius + 16, 1, this.def.radius + 16));
    // a worn path from the south portal to the north one
    const R = this.def.radius;
    for (let i = 0; i < 26; i++) {
      const t = i / 25, z = R - 1 - t * (R * 2 - 2);
      const x = Math.sin(t * 5 + this.def.radius) * 2.2;
      g.add(part(G.ball, M.path, x, 0, z, 0.5 + this.rand() * 0.15, 0.05, 0.36, 0, t * 2 + this.rand(), 0));
    }
    this.baker.add(g);
    // low boulders mark the edge on the south side (they never hide the player)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI + 0.1;
      const d = R + 0.8 + this.rand() * 1.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < 3.5 && z > 0) continue; // keep the portal path clear
      this.rock(x, z, 0.35 + this.rand() * 0.35, false);
    }
  }

  private rock(x: number, z: number, s: number, collide: boolean, mat: THREE.Material = M.rock): void {
    const geo = makeRock(s * 1.5, s * 1.1, s * 1.2, x * 0.37 + z + s);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.rotation.y = this.rand() * 6.28;
    this.baker.add(m);
    geo.dispose();
    if (collide) this.colliders.push({ x, z, r: s * 1.25 });
  }

  private bamboo(x: number, z: number, h: number): void {
    const r = this.rand, g = new THREE.Group();
    g.add(part(G.stalk, M.bamboo, 0, 0, 0, 1, h, 1));
    for (let y = 1.4; y < h; y += 1.5) g.add(part(G.node, M.bamboo, 0, y, 0));
    for (let k = 0; k < 6; k++) g.add(part(G.leaf, M.leaf, 0, h * (0.55 + k * 0.08), 0, 0.8 + r() * 0.6, 1, 1, r() * 0.6 - 0.3, r() * 6.28, -0.4 - r() * 0.7));
    g.position.set(x, 0, z);
    g.rotation.z = (r() - 0.5) * 0.12;
    this.baker.add(g);
  }

  private tree(x: number, z: number, s: number, m1: THREE.Material, m2: THREE.Material): void {
    const r = this.rand, g = new THREE.Group();
    g.add(part(G.trunk, M.trunk, 0, 0, 0, 1, 2.8, 1, 0, 0, (r() - 0.5) * 0.3));
    for (let k = 0; k < 3; k++) g.add(part(G.trunk, M.trunk, 0, 2.4, 0, 0.5, 1.8, 0.5, 0, k * 2.1, 0.7));
    for (let k = 0; k < 8; k++) {
      const a = r() * 6.28, rr = r() * 1.6, sc = 0.7 + r() * 0.6;
      g.add(part(G.ball, r() < 0.65 ? m1 : m2, Math.cos(a) * rr, 3.3 + r() * 1.4, Math.sin(a) * rr, sc, sc * 0.8, sc));
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    this.baker.add(g);
    this.colliders.push({ x, z, r: 0.5 * s });
  }

  private pine(x: number, z: number, s: number): void {
    const g = new THREE.Group();
    g.add(part(G.trunk, M.trunk, 0, 0, 0, 1.1, 3.2, 1.1, 0, 0, (this.rand() - 0.5) * 0.2));
    for (let k = 0; k < 4; k++) {
      const y = 2.2 + k * 1.05, w = 2.1 - k * 0.42;
      g.add(part(G.cone, M.pine, (this.rand() - 0.5) * 0.4, y, (this.rand() - 0.5) * 0.4, w, 1.3, w * 0.85, 0, this.rand() * 6, 0));
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    this.baker.add(g);
    this.colliders.push({ x, z, r: 0.45 * s });
  }

  private willow(x: number, z: number, s: number): void {
    const r = this.rand, g = new THREE.Group();
    g.add(part(G.trunk, M.trunk, 0, 0, 0, 1.3, 3.6, 1.3, 0, 0, (r() - 0.5) * 0.25));
    g.add(part(G.ball, M.willow, 0, 4.1, 0, 1.9, 0.9, 1.9));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 6.28 + r() * 0.3, rr = 1.2 + r() * 0.7, len = 2 + r() * 1.6;
      g.add(part(G.cone, M.willow, Math.cos(a) * rr, 4.0 - len * 0.5, Math.sin(a) * rr, 0.12, len, 0.12, Math.PI, 0, 0));
    }
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    this.baker.add(g);
    this.colliders.push({ x, z, r: 0.5 * s });
  }

  private house(x: number, z: number, ry: number, s: number): void {
    const g = new THREE.Group();
    g.add(part(G.box, M.stone, 0, 0.2, 0, 4.6, 0.4, 3.6));
    g.add(part(G.box, M.wall, 0, 1.4, 0, 4, 2.0, 3));
    for (const px of [-2, 2]) for (const pz of [-1.5, 1.5]) g.add(part(G.box, M.wood, px, 1.4, pz, 0.22, 2.2, 0.22));
    g.add(part(G.box, M.wood, 0, 2.45, 0, 4.3, 0.18, 3.3));
    g.add(part(G.box, M.wood, 0, 1.1, 1.52, 1.1, 1.6, 0.05)); // door
    g.add(part(G.box, this.def.theme === "village" ? M_windowGlow : M.wood, -1.3, 1.6, 1.52, 0.7, 0.6, 0.05)); // window
    g.add(part(G.pyramid, M.roof, 0, 3.35, 0, 3.6, 1.6, 2.9));
    g.add(part(G.box, M.roof, 0, 3.95, 0, 2.2, 0.16, 0.22)); // ridge
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.scale.setScalar(s);
    this.baker.add(g);
    this.colliders.push({ x, z, r: 2.4 * s });
  }

  private pavilion(x: number, z: number): void {
    const t = new THREE.Group();
    t.add(part(G.box, M.stone, 0, 0.25, 0, 5, 0.5, 5));
    for (const px of [-2, 2]) for (const pz of [-2, 2]) t.add(part(G.pillar, M.pillar, px, 1.8, pz, 0.16, 3, 0.16));
    t.add(part(G.box, M.beam, 0, 3.4, 0, 5, 0.4, 5));
    t.add(part(G.pyramid, M.roof, 0, 4.6, 0, 4.4, 2.2, 4.4));
    t.add(part(G.ball, M.gold, 0, 5.8, 0, 0.2, 0.2, 0.2));
    t.add(part(G.ball, M_lanternGlow, 0, 2.8, 2.3, 0.3, 0.38, 0.3));
    t.position.set(x, 0, z);
    this.baker.add(t);
    this.glowPool(x, z + 2.3, 3);
    for (const px of [-2, 2]) for (const pz of [-2, 2]) this.colliders.push({ x: x + px, z: z + pz, r: 0.35 });
  }

  private lantern(x: number, z: number): void {
    const g = new THREE.Group();
    g.add(part(G.box, M.wood, 0, 0.9, 0, 0.12, 1.8, 0.12));
    g.add(part(G.box, M.wood, 0.25, 1.75, 0, 0.6, 0.08, 0.08));
    g.add(part(G.ball, M_lanternGlow, 0.5, 1.45, 0, 0.22, 0.3, 0.22));
    g.position.set(x, 0, z);
    g.rotation.y = this.rand() * 6.28;
    this.baker.add(g);
    this.colliders.push({ x, z, r: 0.25 });
    this.glowPool(x, z, 3.2);
  }

  private glowPool(x: number, z: number, r: number): void {
    const m = new THREE.Mesh(flatGeo, glowMat);
    m.position.set(x, 0.05, z);
    m.scale.set(r * 2, 1, r * 2);
    m.frustumCulled = false;
    overlay.add(m);
    this.glows.push(m);
  }

  private fence(x: number, z: number, len: number, ry: number): void {
    const g = new THREE.Group();
    const n = Math.max(2, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) g.add(part(G.box, M.wood, -len / 2 + (i / n) * len, 0.45, 0, 0.12, 0.9, 0.12));
    g.add(part(G.box, M.wood, 0, 0.7, 0, len, 0.08, 0.06));
    g.add(part(G.box, M.wood, 0, 0.35, 0, len, 0.08, 0.06));
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.baker.add(g);
  }

  private northRing(count: number, from: number, depth: number, make: (x: number, z: number) => void): void {
    for (let i = 0; i < count; i++) {
      const a = Math.PI + this.rand() * Math.PI, d = from + this.rand() * depth;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.9;
      if (z > 4) continue;
      if (Math.abs(x) < 4 && z < -this.def.radius + 6) continue; // keep the north portal open
      make(x, z);
    }
  }

  /* ---------- themes ---------- */
  private village(): void {
    const R = this.def.radius;
    this.house(-12, -17, 0.35, 1);
    this.house(12, -17, -0.35, 1);
    this.house(-20, -8, 1.2, 1.05);
    this.house(20, -8, -1.2, 1.05);
    this.house(-8, -27, 0.1, 1.1);
    this.house(9, -28, -0.15, 1.1);
    this.house(-26, -18, 0.8, 1.2);
    this.house(26, -18, -0.8, 1.2);
    this.pavilion(-14, -4);
    this.tree(-17, -13, 1.1, M.plum, M.plum2);
    this.tree(16, -12, 1.0, M.plum, M.plum2);
    this.tree(-4, -24, 1.2, M.plum, M.plum2);
    this.northRing(30, R + 9, 12, (x, z) => this.bamboo(x, z, 7 + this.rand() * 6));
    for (const [x, z] of [[-3, 2], [3, 2], [-3, -6], [3, -6], [-3, -14], [3, -14]] as const) this.lantern(x, z);
    this.fence(-10, 8, 6, 0.1);
    this.fence(11, 7, 6, -0.15);
    for (const [x, z, s] of [[-17, 10, 0.9], [15, 12, 0.8], [-9, 14, 0.6]] as const) this.rock(x, z, s, true);
    // dye works: vats and drying cloth (the cloth is dyed, so it keeps its color)
    {
      const g = new THREE.Group();
      g.add(part(G.pillar, M.wood, 1.6, 0.4, -1.2, 0.55, 0.8, 0.55));
      g.add(part(G.pillar, M.wood, 2.6, 0.35, -0.2, 0.45, 0.7, 0.45));
      g.add(part(G.disc, dyeMat(0x2a4f8a), 1.6, 0.81, -1.2, 0.48, 1, 0.48));
      g.add(part(G.disc, dyeMat(0xc0281c), 2.6, 0.71, -0.2, 0.38, 1, 0.38));
      for (const px of [-1.8, 1.8]) g.add(part(G.box, M.wood, px, 1.3, -2.4, 0.1, 2.6, 0.1));
      g.add(part(G.box, M.wood, 0, 2.55, -2.4, 3.8, 0.06, 0.06));
      const cloth = [0xe58aa5, 0xd9b13a, 0x5fa8a0];
      for (let i = 0; i < 3; i++) g.add(part(G.box, dyeMat(cloth[i]), -1.1 + i * 1.1, 1.75, -2.4, 0.8, 1.55, 0.03));
      g.position.set(7, 0, -2);
      this.baker.add(g);
      this.colliders.push({ x: 8.6, z: -3.2, r: 0.6 }, { x: 9.6, z: -2.2, r: 0.5 });
    }
    // weapon altar: stone steps, table, brush rack
    {
      const g = new THREE.Group();
      g.add(part(G.box, M.stone, 0, 0.15, -1.4, 5, 0.3, 2.6));
      g.add(part(G.box, M.stone, 0, 0.75, -1.6, 2.6, 0.9, 1.1));
      g.add(part(G.box, M.wood, 0, 1.25, -1.6, 2.9, 0.1, 1.3));
      for (const px of [-1.6, 1.6]) g.add(part(G.pillar, M.pillar, px, 1.6, -2.4, 0.12, 3.2, 0.12));
      g.add(part(G.box, M.beam, 0, 3.25, -2.4, 3.8, 0.25, 0.3));
      for (let i = 0; i < 5; i++) g.add(part(G.box, M.wood, -0.8 + i * 0.4, 1.75, -1.9, 0.05, 1.0, 0.05, 0.15, 0, 0));
      g.add(part(G.box, M.gold, 0, 1.33, -1.4, 0.5, 0.06, 0.5));
      g.position.set(0, 0, -9);
      this.baker.add(g);
      this.colliders.push({ x: -0.8, z: -10.6, r: 0.8 }, { x: 0.8, z: -10.6, r: 0.8 });
    }
  }

  private bambooGrove(): void {
    const R = this.def.radius;
    this.northRing(150, R + 1, 15, (x, z) => this.bamboo(x, z, 8 + this.rand() * 8));
    // clumps inside the field, north half only, away from the path
    for (let c = 0; c < 6; c++) {
      const cx = (this.rand() < 0.5 ? -1 : 1) * (8 + this.rand() * 14), cz = -4 - this.rand() * 18;
      for (let k = 0; k < 5; k++) {
        const x = cx + (this.rand() - 0.5) * 2.4, z = cz + (this.rand() - 0.5) * 2.4;
        this.bamboo(x, z, 6 + this.rand() * 6);
        this.colliders.push({ x, z, r: 0.25 });
      }
    }
    for (let i = 0; i < 26; i++) {
      const a = this.rand() * Math.PI, d = R + 1 + this.rand() * 5;
      this.rock(Math.cos(a) * d, Math.sin(a) * d, 0.6 + this.rand() * 0.8, false);
    }
    for (const [x, z, s] of [[-18, 8, 1.3], [10, 12, 0.9], [-6, -6, 1.0], [17, 15, 1.1], [20, -2, 0.8]] as const) this.rock(x, z, s, true);
    this.pavilion(-13, -17);
  }

  private pond(): void {
    const R = this.def.radius;
    const g = new THREE.Group();
    g.add(part(G.disc, M.water, 9, 0.02, -5, 8, 1, 6.5));
    g.add(part(G.disc, M.water, -13, 0.02, 7, 4, 1, 3.2));
    for (let i = 0; i < 22; i++) {
      const a = this.rand() * 6.28, d = this.rand();
      const x = 9 + Math.cos(a) * d * 6.5, z = -5 + Math.sin(a) * d * 5;
      g.add(part(G.disc, M.lily, x, 0.04, z, 0.5, 1, 0.5));
      if (this.rand() < 0.4) {
        g.add(part(G.cone, M.lotus, x, 0.25, z, 0.22, 0.4, 0.22));
        g.add(part(G.ball, M.lotus, x, 0.18, z, 0.18, 0.12, 0.18));
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * 6.28, d = this.rand() * 3;
      g.add(part(G.disc, M.lily, -13 + Math.cos(a) * d, 0.04, 7 + Math.sin(a) * d * 0.8, 0.45, 1, 0.45));
    }
    // a little bridge over the big pond's west tip
    g.add(part(G.box, M.wood, 1.5, 0.35, -5, 3.5, 0.15, 1.4, 0, 0, 0));
    for (const px of [0, 3]) for (const pz of [-0.6, 0.6]) g.add(part(G.box, M.wood, px, 0.55, -5 + pz, 0.1, 0.5, 0.1));
    this.baker.add(g);
    {
      const streak = new THREE.Mesh(flatGeo, moonStreakMat);
      streak.position.set(9, 0.06, -6);
      streak.scale.set(3.2, 1, 11);
      streak.frustumCulled = false;
      overlay.add(streak);
      this.glows.push(streak);
    }
    this.northRing(55, R + 2, 14, (x, z) => (this.rand() < 0.5 ? this.willow(x, z, 0.9 + this.rand() * 0.5) : this.tree(x, z, 0.9 + this.rand() * 0.6, M.maple, M.maple2)));
    this.willow(-8, -14, 1.1);
    this.willow(20, -16, 1.0);
    this.tree(-20, -8, 1.1, M.maple, M.maple2);
    this.tree(-14, -21, 1.0, M.maple, M.maple2);
    this.tree(14, -22, 1.2, M.maple, M.maple2);
    for (let i = 0; i < 20; i++) {
      const a = this.rand() * Math.PI, d = R + 1 + this.rand() * 4;
      this.rock(Math.cos(a) * d, Math.sin(a) * d, 0.5 + this.rand() * 0.6, false);
    }
    for (const [x, z, s] of [[-18, 14, 1.0], [16, 13, 0.8], [-4, 10, 0.6]] as const) this.rock(x, z, s, true);
  }

  private peak(): void {
    const R = this.def.radius;
    this.northRing(45, R + 1, 14, (x, z) => this.pine(x, z, 1 + this.rand() * 0.7));
    this.northRing(40, R + 2, 16, (x, z) => this.rock(x, z, 1.4 + this.rand() * 2.2, false, this.rand() < 0.5 ? M.rock : M.rockDark));
    for (let i = 0; i < 30; i++) {
      const a = this.rand() * Math.PI, d = R + 1 + this.rand() * 6;
      this.rock(Math.cos(a) * d, Math.sin(a) * d, 0.5 + this.rand() * 0.9, false, M.rockDark);
    }
    for (const [x, z, s] of [[-19, 6, 1.4], [18, 9, 1.2], [-12, 16, 0.8], [13, -6, 1.0], [-15, -9, 1.1], [22, -12, 1.3]] as const) this.rock(x, z, s, true);
    this.pine(-21, -18, 1.3);
    this.pine(21, -20, 1.2);
    // temple ruins beyond the boss ground
    const t = new THREE.Group();
    t.add(part(G.box, M.stone, 0, 0.3, 0, 12, 0.6, 6));
    t.add(part(G.box, M.stone, 0, 0.75, -0.5, 9, 0.3, 4.5));
    const hs = [3.6, 1.6, 3.6, 0.9, 2.4, 3.6];
    for (let i = 0; i < 6; i++) {
      const px = -4.5 + (i % 3) * 4.5, pz = i < 3 ? -2 : 1.2;
      t.add(part(G.pillar, M.pillar, px, 0.9 + hs[i] / 2, pz, 0.28, hs[i], 0.28));
    }
    t.add(part(G.box, M.beam, -2.2, 4.6, -2, 5.4, 0.35, 0.5, 0, 0, 0.05));
    t.add(part(G.pyramid, M.roof, 6.5, 0.9, 3.4, 3.2, 1.2, 2.4, 0.5, 0.4, 0.35)); // fallen roof
    t.add(part(G.pillar, M.pillar, -6.8, 0.5, 3.2, 0.28, 2.6, 0.28, 0, 0.6, Math.PI / 2)); // toppled pillar
    for (const px of [-7, 7]) {
      t.add(part(G.box, M.stone, px, 0.5, 4, 0.6, 1, 0.6));
      t.add(part(G.box, M.stone, px, 1.15, 4, 0.9, 0.3, 0.9));
      t.add(part(G.pyramid, M.stone, px, 1.55, 4, 0.7, 0.5, 0.7));
    }
    t.position.set(0, 0, -24);
    this.baker.add(t);
  }

  /* ---------- portals and NPCs ---------- */
  private portal(p: Portal): void {
    const g = new THREE.Group();
    const half = 1.6, h = 3.2;
    for (const s of [-1, 1]) {
      g.add(part(G.pillar, M.gate, s * half, h / 2, 0, 0.16, h, 0.16));
      g.add(part(G.box, M.stone, s * half, 0.15, 0, 0.6, 0.3, 0.6));
    }
    g.add(part(G.box, M.gate, 0, h - 0.4, 0, half * 2 + 0.4, 0.16, 0.18));
    g.add(part(G.box, M.gateRoof, 0, h + 0.05, 0, half * 2 + 1.3, 0.18, 0.5, 0, 0, 0));
    g.add(part(G.box, M.gateRoof, -half - 0.6, h + 0.18, 0, 0.6, 0.14, 0.5, 0, 0, 0.35));
    g.add(part(G.box, M.gateRoof, half + 0.6, h + 0.18, 0, 0.6, 0.14, 0.5, 0, 0, -0.35));
    g.add(part(G.disc, M.path, 0, 0.025, 0, 2.6, 1, 1.6));
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(p.x, p.z); // gate spans across the way out
    this.baker.add(g);
    const cx = Math.cos(g.rotation.y), sz = -Math.sin(g.rotation.y);
    this.colliders.push({ x: p.x + cx * half, z: p.z + sz * half, r: 0.3 }, { x: p.x - cx * half, z: p.z - sz * half, r: 0.3 });
    const veil = new THREE.Mesh(veilGeo, veilMat);
    veil.position.set(p.x, 1.4, p.z);
    veil.rotation.y = g.rotation.y;
    veil.frustumCulled = false;
    overlay.add(veil);
    this.veils.push(veil);
    this.anchors.push({ x: p.x, y: h + 0.9, z: p.z, text: p.label, kind: "portal" });
  }

  private npc(n: Npc): void {
    const rig = new Rig();
    const look = NPC_LOOK[n.id] ?? NPC_LOOK[n.role] ?? NPC_LOOK.elder;
    rig.setHat(look.hat);
    rig.setSash(look.sash);
    rig.pose.set(look.pose);
    dressNpc(rig, n.id);
    rig.place(n.x, 0, n.z, -Math.PI / 2 + 0.55);
    rig.apply();
    scene.add(rig.group);
    this.npcRigs.push({ rig, base: look.pose, phase: n.x });
    this.anchors.push({ x: n.x, y: 2.7, z: n.z, text: n.name, kind: "npc", id: n.id });
    this.colliders.push({ x: n.x, z: n.z, r: 0.45 });
  }
}

const NPC_LOOK: Record<string, { hat: ItemDef | undefined; sash: number | null; pose: Float32Array }> = {
  elder: { hat: ITEM.h_satgat, sash: null, pose: POSE.elder },
  dyer: { hat: ITEM.h_none, sash: 0xc0281c, pose: POSE.bow },
  altar: { hat: ITEM.h_gat, sash: 0xd9a640, pose: POSE.idle },
  guide: { hat: ITEM.h_none, sash: null, pose: POSE.idle },
  baram: { hat: ITEM.h_none, sash: 0x5fa8a0, pose: POSE.idle },
  noeul: { hat: ITEM.h_satgat, sash: 0xe07a3a, pose: POSE.idle },
  heukwol: { hat: ITEM.h_gat, sash: null, pose: POSE.idle },
};

/* ---------- field NPC props (SHARED geometry/materials; nothing to dispose) ---------- */
const G_band = new THREE.TorusGeometry(0.245, 0.035, 6, 20).rotateY(Math.PI / 2);
const G_tail = new THREE.BoxGeometry(0.04, 0.32, 0.06).translate(0, -0.16, 0);
const G_shaftShort = new THREE.CylinderGeometry(0.028, 0.034, 0.9, 8).translate(0, 0.45, 0);
const G_tip = new THREE.ConeGeometry(0.07, 0.3, 8).translate(0, 1.05, 0);
const G_oar = new THREE.CylinderGeometry(0.03, 0.035, 2.2, 8).translate(0, 0.9, 0);
const G_blade = new THREE.BoxGeometry(0.2, 0.55, 0.04).translate(0, 2.15, 0);
const M_shadowHalf = new THREE.MeshBasicMaterial({ color: 0x0c0b10, transparent: true, opacity: 0.38, depthWrite: false });
const M_dark = lam(0x1a1816);

function dressNpc(rig: Rig, id: string): void {
  if (id === "baram") {
    // headband with two short tails, a short brush slung across the back
    const band = new THREE.Group();
    band.add(new THREE.Mesh(G_band, dyeMat(0x5fa8a0)));
    for (const z of [-0.05, 0.05]) {
      const t = new THREE.Mesh(G_tail, dyeMat(0x5fa8a0));
      t.position.set(-0.24, 0.02, z);
      t.rotation.z = 0.5 + z * 3;
      band.add(t);
    }
    rig.addProp(band, "head");
    const brush = new THREE.Group();
    brush.add(new THREE.Mesh(G_shaftShort, lam(0xa88f5c)), new THREE.Mesh(G_tip, M_dark));
    brush.position.z = -0.05;
    const back = new THREE.Group();
    back.add(brush);
    brush.position.y = -0.5;
    rig.addProp(back, "back");
  } else if (id === "noeul") {
    const oar = new THREE.Group();
    oar.add(new THREE.Mesh(G_oar, M.wood), new THREE.Mesh(G_blade, M.wood));
    rig.setHeld(oar);
  } else if (id === "heukwol") {
    rig.shadeSide(M_shadowHalf);
  }
}
