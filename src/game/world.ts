// Zone scenery built from ZONES[zone].theme. Static scenery is baked into one mesh per material
// (mergeGeometries) to keep draw calls low; tall scenery only goes north of the play area (or far out to
// the sides) because the camera looks from the south. Set dressing (grass, reeds, shore stones, walls,
// far groves and spires) keeps clear of gates, arrival points, NPCs, the boss ground and the worn path.
// Gates are their own mesh so one standing between the camera and the player can fade to a pale wash.
// On a zone change everything this file created is disposed (OWNED baked geometry); materials and unit
// geometries come from materials.ts and are SHARED.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { ZONES, type Npc, type Portal, type ZoneDef } from "../shared/world";
import { ITEM, type ItemDef } from "../shared/items";
import { fbm3, rng } from "./util";
import { G, G2, M, M_blade, M_bladeDark, dyeMat, gateFadeMat, groundMat, lam, setGround, setGroundShade, waterMat } from "./render/materials";
import { bakeShadows, camFocus, clearShadows, noNormalPass, overlay, scene, setOcclusion, setShadowSink } from "./render/gfx";
import { QUAD_VERT } from "./render/fx";
import { clearPrints, setPrintWater } from "./render/prints";
import { clearStrokes } from "./render/strokes";
import { MOODS, flatGeo, glowMat, moonStreakMat } from "./render/ambient";
import { POSE, Rig, type Build } from "./render/rig";
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
      mesh.userData.noCast = NO_CAST.has(mat); // flat things cast no baked shadow
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
// Lantern paper and lit windows: written with the dyed alpha so the ink pass keeps them bright, but in paper
// white, not orange: the world has no color left, so even its lights are colorless (the one exception is
// 해담's cinnabar lantern below, a story beat).
const GLOW_PARAMS: THREE.MeshBasicMaterialParameters = {
  opacity: 0.5, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor,
};
const M_lanternGlow = new THREE.MeshBasicMaterial({ color: 0xf4f0e6, ...GLOW_PARAMS });
const M_windowGlow = new THREE.MeshBasicMaterial({ color: 0xe6e1d4, ...GLOW_PARAMS });
/** dark ink ring under water and puddles (the bank) */
const M_bank = lam(0x2b2a30);
/* chapter 2 scenery: SHARED geometry and materials (module level, never disposed) */
const M_clay = lam(0x7d6550);
const M_ash = lam(0xb4aca0);
const M_char = lam(0x231e1b);
const M_stoneC = lam(0x8a8680);
const M_bronze = lam(0x4a3e2c);
const M_paper = lam(0xe9e5dc);
const _spin = new THREE.Object3D();
/** how much higher each chamber of a climbing kiln sits than the one below it */
const KILN_RISE = 0.55;
function lathe(prof: number[][], seg = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}
const CG = {
  /** an onggi jar: wide shoulders, a narrow mouth */
  jar: lathe([[0, 0], [0.32, 0], [0.5, 0.25], [0.56, 0.55], [0.48, 0.85], [0.3, 1.0], [0.28, 1.08], [0.32, 1.12], [0.24, 1.12], [0, 0.95]]),
  lid: lathe([[0, 0.18], [0.38, 0.05], [0.4, 0], [0.2, 0.0], [0, 0.04]], 12),
  /** a kiln chamber: half a tunnel, its axis across +x */
  arch: new THREE.CylinderGeometry(1, 1, 2.6, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 1, 0.85),
  /** a temple bell */
  bell: lathe([[0, 1.6], [0.45, 1.58], [0.62, 1.3], [0.72, 0.6], [0.95, 0.08], [0.98, 0], [0.8, 0.05], [0.6, 0.6], [0.5, 1.3], [0, 1.45]], 18),
  /** a curved eave fragment */
  eave: new THREE.CylinderGeometry(1.4, 1.4, 0.3, 10, 1, true, 0, Math.PI * 0.5).rotateX(Math.PI / 2),
  /** an unlit paper lantern */
  paperLantern: lathe([[0, -0.32], [0.14, -0.3], [0.22, -0.15], [0.23, 0.05], [0.18, 0.22], [0.08, 0.3], [0, 0.31]], 10),
  /** the great sun drawn on the censer yard's floor */
  sunRing: new THREE.RingGeometry(9.4, 10.1, 72).rotateX(-Math.PI / 2),
};
/** materials of flat things (ground, water, path, grass) that cast no baked shadow */
const NO_CAST = new Set<THREE.Material>([groundMat, waterMat, M_bank, M.path, M.lily, M_blade, M_bladeDark]);

interface Gate {
  mesh: THREE.Mesh;
  veil: THREE.Mesh;
  x: number;
  z: number;
  /** 1 = solid, down to ~0.2 while it stands between the camera and the player */
  f: number;
  init: boolean;
}

export class ZoneScene {
  readonly group = new THREE.Group();
  readonly field: Field;
  readonly anchors: Anchor[] = [];
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly baker = new Baker();
  private readonly rand: () => number;
  private readonly colliders: Collider[] = [];
  private readonly npcRigs: { id: string; rig: Rig; base: Float32Array; phase: number; idle: (rig: Rig, t: number) => void }[] = [];

  /** The rig of an NPC standing in this zone (dialogue portraits), or null. */
  npcRig(id: string): Rig | null {
    for (const n of this.npcRigs) if (n.id === id) return n.rig;
    return null;
  }
  private readonly veils: THREE.Mesh[] = [];
  /** overlay glow/reflection meshes (OWNED meshes, SHARED geometry/material) */
  private readonly glows: THREE.Mesh[] = [];
  private readonly gates: Gate[] = [];
  /** temple paper lanterns turning slowly in the wind (OWNED instanced mesh; SHARED geometry/material) */
  private spin: { mesh: THREE.InstancedMesh; pos: Float32Array; n: number } | null = null;
  /** still water as [x, z, rx, rz, ...]: footprints turn to ripples there */
  private readonly waters: number[] = [];
  /** where players arrive in this zone (kept clear of scenery) */
  private readonly arrivals: { x: number; z: number }[] = [];

  constructor(readonly def: ZoneDef) {
    this.rand = rng(def.id.length * 977 + def.radius * 31 + def.id.charCodeAt(0));
    this.field = { radius: def.radius, colliders: this.colliders };
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    for (const z of Object.values(ZONES)) for (const p of z.portals) if (p.to === def.id) this.arrivals.push({ x: p.arriveX, z: p.arriveZ });
    this.ground();
    switch (def.theme) {
      case "village": this.village(); break;
      case "bamboo": this.bambooGrove(); break;
      case "pond": this.pond(); break;
      case "peak": this.peak(); break;
      case "kiln": this.kiln(); break;
      case "temple": this.temple(); break;
      case "censer": this.censer(); break;
      case "pass": this.pass(); break;
    }
    for (const p of def.portals) this.portal(p);
    for (const n of def.npcs) this.npc(n);
    this.dressing();
    this.baker.flush(this.group, this.owned);
    // scenery and the standing NPCs cast their shadows once, into a mask the ground samples
    const mood = MOODS[def.theme] ?? MOODS.village;
    const roots: THREE.Object3D[] = [this.group];
    for (const n of this.npcRigs) roots.push(n.rig.group);
    const sink = (b: { tex: THREE.Texture; box: THREE.Vector3 } | null) => setGroundShade(b ? b.tex : null, b ? b.box : null, mood.shade[0]);
    setShadowSink(sink); // a quality change re-bakes this zone and hands the mask over here
    sink(bakeShadows(roots, def.radius + 12, mood.sun, mood.shade));
    clearPrints();
    clearStrokes();
    setOcclusion(true);
    setPrintWater(this.waters);
  }

  update(dt: number, time: number): void {
    veilMat.uniforms.uTime.value = time;
    // a gate between the camera and the player (arriving through it, walking past it) fades to a wash
    for (const g of this.gates) {
      const dz = g.z - camFocus.z, dx = Math.abs(g.x - camFocus.x);
      const target = dz > -0.8 && dz < 7.5 && dx < 4.8 ? 0.16 : 1;
      g.f = g.init ? g.f + (target - g.f) * Math.min(1, dt * 5) : target;
      g.init = true;
      if (g.f < 0.97) {
        g.mesh.material = gateFadeMat;
        gateFadeMat.opacity = g.f;
        noNormalPass.add(g.mesh);
      } else if (g.mesh.material !== M.gate) {
        g.mesh.material = M.gate;
        noNormalPass.delete(g.mesh);
      }
      g.veil.visible = g.f > 0.55;
    }
    if (this.spin) {
      const sp = this.spin;
      for (let i = 0; i < sp.n; i++) {
        _spin.position.set(sp.pos[i * 3], sp.pos[i * 3 + 1] + Math.sin(time * 0.9 + i) * 0.03, sp.pos[i * 3 + 2]);
        _spin.rotation.set(Math.sin(time * 0.7 + i * 0.7) * 0.08, time * 0.35 + i * 1.3, 0);
        _spin.updateMatrix();
        sp.mesh.setMatrixAt(i, _spin.matrix);
      }
      sp.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const n of this.npcRigs) {
      n.rig.pose.set(n.base);
      n.idle(n.rig, time + n.phase);
      n.rig.apply();
    }
    void dt;
  }

  dispose(): void {
    setPrintWater(null);
    setOcclusion(false);
    scene.remove(this.group);
    for (const g of this.owned) g.dispose(); // OWNED baked geometry
    this.owned.length = 0;
    for (const n of this.npcRigs) scene.remove(n.rig.group); // rig parts are SHARED
    for (const v of this.veils) overlay.remove(v); // SHARED veil geometry/material
    for (const m of this.glows) overlay.remove(m); // SHARED glow geometry/material
    for (const g of this.gates) noNormalPass.delete(g.mesh); // gate geometry is in `owned`
    if (this.spin) { this.group.remove(this.spin.mesh); this.spin.mesh.dispose(); this.spin = null; } // OWNED instance buffers
    setGroundShade(null, null, 0);
    setShadowSink(null);
    clearShadows(); // OWNED shadow mask
  }

  /* ---------- common pieces ---------- */
  private ground(): void {
    const g = new THREE.Group();
    const th = this.def.theme;
    setGround(this.def.ground, this.def.radius, th === "village" || th === "pass" ? 1 : th === "peak" ? 0.75 : 0, th === "pond" ? 0.35 : th === "peak" ? 0.5 : 0.42);
    g.add(part(G.disc, groundMat, 0, 0, 0, this.def.radius + 16, 1, this.def.radius + 16));
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
    // nodes only where they can be seen; far stalks are a silhouette in the mist
    if (Math.hypot(x, z) < this.def.radius + 8) for (let y = 1.4; y < h; y += 1.5) g.add(part(G.node, M.bamboo, 0, y, 0));
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
    // a leaning trunk carrying flat, layered crowns (the painted Korean pine, not a fir)
    const lean = (this.rand() - 0.5) * 0.35;
    g.add(part(G.trunk, M.trunk, 0, 0, 0, 1.1, 4.6, 1.1, 0, 0, lean));
    for (let k = 0; k < 4; k++) {
      const y = 3.0 + k * 0.7, side = k % 2 ? 1 : -1, off = (k === 3 ? 0 : side * (0.5 + this.rand() * 0.5)) - lean * y;
      const w = 1.5 - k * 0.22 + this.rand() * 0.25;
      g.add(part(G.trunk, M.trunk, off * 0.5, y - 0.3, 0, 0.35, Math.abs(off) + 0.3, 0.35, 0, 0, -side * 1.1));
      // each tier: a few overlapping cushions, so the crown reads as one ragged mass
      for (let j = 0; j < 3; j++) {
        const jx = off + (j - 1) * w * 0.55, jz = (this.rand() - 0.5) * 0.8;
        g.add(part(G2.cushion, M.pine, jx, y + (j === 1 ? 0.12 : 0), jz, w * (0.6 + this.rand() * 0.25), 0.5, w * 0.6, 0, this.rand() * 6, 0));
      }
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
    g.add(part(G.box, this.def.safe ? M_windowGlow : M.wood, -1.3, 1.6, 1.52, 0.7, 0.6, 0.05)); // window
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

  /* ---------- set dressing ---------- */
  /** x of the worn path (the same curve the ground shader paints) at z */
  private pathX(z: number): number {
    const R = this.def.radius, t = (R - 1 - z) / (R * 2 - 2);
    return Math.sin(t * 5 + R) * 2.2;
  }

  /** A prop of radius r at (x, z) keeps clear of gates, arrivals, NPCs, the boss ground, colliders, the path. */
  private clear(x: number, z: number, r: number, path = true): boolean {
    const d = this.def;
    if (path && Math.abs(z) < d.radius + 2 && Math.abs(x - this.pathX(z)) < 2.2 + r) return false;
    for (const p of d.portals) if (Math.hypot(x - p.x, z - p.z) < 4.5 + r) return false;
    for (const a of this.arrivals) if (Math.hypot(x - a.x, z - a.z) < 3.5 + r) return false;
    for (const n of d.npcs) if (Math.hypot(x - n.x, z - n.z) < 2.5 + r) return false;
    if (d.boss && Math.hypot(x - d.boss.x, z - d.boss.z) < 6 + r) return false;
    // fixed monster spots (the kiln lord, the temple's stone lanterns) keep their ground
    for (const sp of d.spawns) if (sp.at) for (const a of sp.at) if (Math.hypot(x - a.x, z - a.z) < 3.5 + r) return false;
    for (const c of this.colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + r + 0.2) return false;
    return true;
  }

  /** Grass tufts (dark brush flicks), thicker toward the rim than in the open middle. */
  private tufts(n: number, reach: number, dark: number): void {
    const R = this.def.radius, g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, d = (R + reach) * Math.pow(this.rand(), 0.42);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!this.clear(x, z, 0.3)) continue;
      const sc = 0.6 + this.rand() * 0.7, h = 0.45 + this.rand() * 0.6;
      g.add(part(G2.tuft, this.rand() < dark ? M_bladeDark : M_blade, x, 0, z, sc, h, sc, 0, this.rand() * 6.28, 0));
      if (this.rand() < 0.4) g.add(part(G2.tuft, M_blade, x + (this.rand() - 0.5) * 0.9, 0, z + (this.rand() - 0.5) * 0.9, sc * 0.7, h * 0.8, sc * 0.7, 0, this.rand() * 6.28, 0));
    }
    this.baker.add(g);
  }

  /** A low lumpy stone (no collider). */
  private stone(x: number, z: number, sc: number, mat: THREE.Material = M.rock): void {
    this.baker.add(part(G2.stone, mat, x, 0, z, sc * (1 + this.rand() * 0.5), sc * (0.5 + this.rand() * 0.4), sc, 0, this.rand() * 6.28, 0));
  }

  /** Still water with a dark bank; the ink pass mirrors the sky into it. */
  private water(x: number, z: number, rx: number, rz: number): void {
    const g = new THREE.Group();
    g.add(part(G.disc, M_bank, x, 0.012, z, rx + 0.35, 1, rz + 0.3));
    g.add(part(G.disc, waterMat, x, 0.02, z, rx, 1, rz));
    this.baker.add(g);
    this.waters.push(x, z, rx, rz);
  }

  /** Dry-stone wall along an arc of the rim (outside the walkable disc, so no colliders). */
  private wallArc(r: number, a0: number, a1: number): void {
    const g = new THREE.Group();
    const n = Math.round((Math.abs(a1 - a0) * r) / 0.75);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, rr = r + (this.rand() - 0.5) * 0.25;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!this.clear(x, z, 0.5, false)) continue;
      g.add(part(G2.stone, M.rock, x, 0.25, z, 0.5 + this.rand() * 0.15, 0.32, 0.4, 0, -a + this.rand() * 0.4, 0));
      if (this.rand() < 0.8) g.add(part(G2.stone, this.rand() < 0.5 ? M.rock : M.rockDark, x + (this.rand() - 0.5) * 0.3, 0.65, z, 0.38 + this.rand() * 0.12, 0.26, 0.32, 0, this.rand() * 6.28, 0));
    }
    this.baker.add(g);
  }

  /** A tall karst spire with a pine or two clinging to its crown. */
  private spire(x: number, z: number, h: number, w: number): void {
    const geo = makeRock(w, h, w * 0.9, x * 0.31 + z * 0.17);
    const m = new THREE.Mesh(geo, this.rand() < 0.5 ? M.rock : M.rockDark);
    m.position.set(x, -0.5, z);
    m.rotation.y = this.rand() * 6.28;
    this.baker.add(m);
    geo.dispose();
    const t = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      const a = this.rand() * 6.28, rr = w * 0.35;
      t.add(part(G.cone, M.pine, x + Math.cos(a) * rr, h * 0.92 + k * 0.3, z + Math.sin(a) * rr, 0.8 + this.rand() * 0.5, 1.2, 0.8, 0, 0, (this.rand() - 0.5) * 0.4));
    }
    this.baker.add(t);
  }

  private dressing(): void {
    const th = this.def.theme;
    this.tufts(th === "bamboo" ? 240 : th === "pond" ? 200 : th === "village" || th === "pass" ? 150 : 130, 8, th === "peak" ? 0.6 : 0.25);
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
    this.dyeWorks(7, -2);
    this.altarStand(0, -9);
    // pines standing out past the square's sides, crowns dark against the ridges
    for (const [x, z, sc] of [[-R - 3, -3, 1.5], [-R - 6, 5, 1.8], [R + 3.5, -5, 1.6], [R + 6, 4, 1.4], [-R - 1, -21, 1.4], [R + 1.5, -22, 1.5], [-R - 9, -12, 1.9], [R + 9, -13, 1.8]] as const) this.pine(x, z, sc);
    // the far end of the village, lit windows fading in the haze beyond the field
    for (const [x, z, ry, sc] of [[-20, -34, 0.4, 1.1], [17, -36, -0.3, 1.2], [-5, -44, 0.1, 1.3], [31, -30, -0.9, 1.2], [-33, -28, 0.9, 1.2], [8, -52, 0, 1.4], [-24, -50, 0.3, 1.4]] as const) this.house(x, z, ry, sc);
    for (const [x, z] of [[-11, -38], [24, -42], [2, -36]] as const) this.pine(x, z, 1.6 + this.rand() * 0.4);
    // dry-stone walls round the rim, open at the north gate
    this.wallArc(R + 0.7, -Math.PI + 0.12, -Math.PI / 2 - 0.2);
    this.wallArc(R + 0.7, -Math.PI / 2 + 0.2, -0.12);
    this.wallArc(R + 0.7, 0.15, Math.PI - 0.15);
  }

  /** Dye works: vats and drying cloth (the cloth is dyed, so it keeps its color), set at (ox, oz). */
  private dyeWorks(ox: number, oz: number, cloth: readonly number[] = [0xe58aa5, 0xd9b13a, 0x5fa8a0]): void {
    const g = new THREE.Group();
    g.add(part(G.pillar, M.wood, 1.6, 0.4, -1.2, 0.55, 0.8, 0.55));
    g.add(part(G.pillar, M.wood, 2.6, 0.35, -0.2, 0.45, 0.7, 0.45));
    g.add(part(G.disc, dyeMat(0x2a4f8a), 1.6, 0.81, -1.2, 0.48, 1, 0.48));
    g.add(part(G.disc, dyeMat(0xc0281c), 2.6, 0.71, -0.2, 0.38, 1, 0.38));
    for (const px of [-1.8, 1.8]) g.add(part(G.box, M.wood, px, 1.3, -2.4, 0.1, 2.6, 0.1));
    g.add(part(G.box, M.wood, 0, 2.55, -2.4, 3.8, 0.06, 0.06));
    for (let i = 0; i < cloth.length; i++) g.add(part(G.box, dyeMat(cloth[i]), -1.1 + i * 1.1, 1.75, -2.4, 0.8, 1.55, 0.03));
    g.position.set(ox, 0, oz);
    this.baker.add(g);
    this.colliders.push({ x: ox + 1.6, z: oz - 1.2, r: 0.6 }, { x: ox + 2.6, z: oz - 0.2, r: 0.5 });
  }

  /** The weapon altar: stone steps, table, brush rack, set at (ox, oz). */
  private altarStand(ox: number, oz: number): void {
    const g = new THREE.Group();
    g.add(part(G.box, M.stone, 0, 0.15, -1.4, 5, 0.3, 2.6));
    g.add(part(G.box, M.stone, 0, 0.75, -1.6, 2.6, 0.9, 1.1));
    g.add(part(G.box, M.wood, 0, 1.25, -1.6, 2.9, 0.1, 1.3));
    for (const px of [-1.6, 1.6]) g.add(part(G.pillar, M.pillar, px, 1.6, -2.4, 0.12, 3.2, 0.12));
    g.add(part(G.box, M.beam, 0, 3.25, -2.4, 3.8, 0.25, 0.3));
    for (let i = 0; i < 5; i++) g.add(part(G.box, M.wood, -0.8 + i * 0.4, 1.75, -1.9, 0.05, 1.0, 0.05, 0.15, 0, 0));
    g.add(part(G.box, M.gold, 0, 1.33, -1.4, 0.5, 0.06, 0.5));
    g.position.set(ox, 0, oz);
    this.baker.add(g);
    this.colliders.push({ x: ox - 0.8, z: oz - 1.6, r: 0.8 }, { x: ox + 0.8, z: oz - 1.6, r: 0.8 });
  }

  /**
   * 솔재 마을: a pine pass between the peak and the kiln. Gates south (from the peak) and north (to the kiln),
   * houses stepping up both sides, a well, a lookout pavilion over the drop, pines everywhere, ridges beyond.
   */
  private pass(): void {
    const R = this.def.radius;
    // houses up the two slopes, roofs turned to the road
    for (const [x, z, ry, sc] of [[-12, -14, 0.45, 1], [12, -14, -0.45, 1], [-19, -4, 1.3, 1.05], [19, -5, -1.3, 1.05], [-15, 9, 2.1, 0.95], [16, 9, -2.1, 0.95], [-25, -14, 0.9, 1.2], [25, -15, -0.9, 1.2]] as const) this.house(x, z, ry, sc);
    this.pavilion(-13, 2);
    this.dyeWorks(7, -1, [0xd9a640, 0xc0281c, 0x6a8fc8]);
    this.altarStand(0, -9);
    // a well in the square
    {
      const g = new THREE.Group();
      g.add(part(G.pillar, M.stone, 0, 0.4, 0, 1.0, 0.8, 1.0));
      g.add(part(G.disc, waterMat, 0, 0.81, 0, 0.75, 1, 0.75));
      for (const px of [-0.95, 0.95]) g.add(part(G.box, M.wood, px, 1.3, 0, 0.1, 1.8, 0.1));
      g.add(part(G.box, M.wood, 0, 2.15, 0, 2.3, 0.1, 0.1));
      g.add(part(G.pyramid, M.roof, 0, 2.55, 0, 1.6, 0.6, 1.3));
      g.position.set(6, 0, 7);
      this.baker.add(g);
      this.colliders.push({ x: 6, z: 7, r: 1.1 });
    }
    for (const [x, z] of [[-3, 14], [3, 14], [-3, 5], [3, 5], [-3, -4], [3, -4], [-3, -14], [3, -14]] as const) this.lantern(x, z);
    this.fence(-9, 13, 5, 0.25);
    this.fence(10, 14, 5, -0.25);
    for (const [x, z, s] of [[-18, 15, 0.9], [17, -10, 0.7], [-8, -17, 0.6]] as const) this.rock(x, z, s, true);
    // pines inside the walls and thick on the slopes beyond them
    for (const [x, z, sc] of [[-9, -6, 1.15], [11, -8, 1.0], [-20, 5, 1.3], [21, 3, 1.25], [-7, 18, 1.1], [9, 18, 1.2]] as const) this.pine(x, z, sc);
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * Math.PI * 2, d = R + 3 + this.rand() * 16;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < 5) continue; // both gates stay open
      if (!this.clear(x, z, 1, false)) continue;
      this.pine(x, z, 1.3 + this.rand() * 0.8);
    }
    // the ridges the pass cuts through, far off on both sides
    for (const [x, z, h, w] of [[-44, -30, 22, 9], [-52, 4, 26, 11], [-40, 30, 18, 8], [46, -26, 24, 10], [54, 8, 20, 9], [42, 32, 17, 8], [-18, -58, 30, 12], [20, -60, 27, 11]] as const) this.spire(x, z, h, w);
    // dry-stone walls round the rim, open at the north and south gates
    this.wallArc(R + 0.7, -Math.PI + 0.12, -Math.PI / 2 - 0.2);
    this.wallArc(R + 0.7, -Math.PI / 2 + 0.2, -0.12);
    this.wallArc(R + 0.7, 0.15, Math.PI / 2 - 0.2);
    this.wallArc(R + 0.7, Math.PI / 2 + 0.2, Math.PI - 0.15);
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
    // a deeper, taller grove behind the first, lost in the mist
    this.northRing(80, R + 15, 18, (x, z) => this.bamboo(x, z, 13 + this.rand() * 10));
    // thick stands down both flanks
    for (let i = 0; i < 110; i++) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const z = -R - 2 + this.rand() * (R + 6);
      // the camera sits south of the player: in the southern half the stands step back from the rim so their
      // stalks don't stand between the camera and a player walking the edge
      const x = side * (z > -8 ? R + 3 + this.rand() * 10 : R - 2 + this.rand() * 13);
      if (!this.clear(x, z, 0.4, false)) continue;
      this.bamboo(x, z, 8 + this.rand() * 9);
      if (Math.hypot(x, z) < R + 0.5) this.colliders.push({ x, z, r: 0.25 });
    }
    for (let i = 0; i < 24; i++) {
      const a = this.rand() * Math.PI * 2, d = R - 1 + this.rand() * 4;
      if (this.clear(Math.cos(a) * d, Math.sin(a) * d, 0.5)) this.stone(Math.cos(a) * d, Math.sin(a) * d, 0.35 + this.rand() * 0.4, M.rockDark);
    }
  }

  private pond(): void {
    const R = this.def.radius;
    const g = new THREE.Group();
    this.water(9, -5, 8, 6.5);
    this.water(-13, 7, 4, 3.2);
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
    // reeds and stones along both banks (the bridge end stays open)
    const reeds = new THREE.Group();
    for (const [cx, cz, rx, rz, n] of [[9, -5, 8, 6.5, 46], [-13, 7, 4, 3.2, 22]] as const) {
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2, out = 0.15 + this.rand() * 0.9;
        const x = cx + Math.cos(a) * (rx + out), z = cz + Math.sin(a) * (rz + out);
        if (cx > 0 && x < cx - rx + 3 && Math.abs(z - cz) < 2.2) continue;
        if (!this.clear(x, z, 0.2, false)) continue;
        const sc = 0.8 + this.rand() * 0.6;
        reeds.add(part(G2.reed, this.rand() < 0.3 ? M_bladeDark : M_blade, x, 0, z, sc, 1.0 + this.rand() * 1.0, sc, 0, this.rand() * 6.28, 0));
        if (this.rand() < 0.3) this.stone(x + (this.rand() - 0.5), z + (this.rand() - 0.5), 0.25 + this.rand() * 0.3);
      }
    }
    this.baker.add(reeds);
    // willows and maples further out to the sides
    for (const [x, z, sc] of [[-R - 3, 2, 1.3], [R + 4, -2, 1.2], [-R - 6, -12, 1.4], [R + 7, -14, 1.3]] as const) this.willow(x, z, sc);
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
    // karst spires beyond the rim, rising out of the mist
    for (let i = 0; i < 18; i++) {
      const a = Math.PI + 0.1 + this.rand() * (Math.PI - 0.2), d = R + 7 + this.rand() * 24;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < 9 && z < -R) continue; // the ruins keep a clear sky behind them
      this.spire(x, z, 8 + this.rand() * 14, 1.8 + this.rand() * 1.8);
    }
    // a short worn way from the middle to the east door (to the old kiln yard)
    for (const p of this.def.portals) {
      if (p.x < 10) continue;
      const g2 = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const t = i / 8, x = 4 + (p.x - 7) * t, z = p.z + Math.sin(t * 4) * 0.8;
        g2.add(part(G.ball, M.path, x, 0, z, 0.55 + this.rand() * 0.15, 0.05, 0.4, 0, this.rand() * 3, 0));
      }
      this.baker.add(g2);
    }
    // the storm's puddles
    for (let i = 0, n = 0; i < 60 && n < 7; i++) {
      const x = (this.rand() - 0.5) * R * 1.6, z = (this.rand() - 0.5) * R * 1.6;
      if (!this.clear(x, z, 2.2)) continue;
      this.water(x, z, 1.1 + this.rand() * 1.6, 0.6 + this.rand() * 0.9);
      n++;
    }
  }

  /* ---------- chapter 2 ---------- */
  /** One chamber of a climbing kiln: an arched tunnel with a dark fire hole, set at a height along its slope. */
  private kilnChamber(g: THREE.Group, x: number, z: number, y: number, ry: number, s: number, hole = true): void {
    const c = new THREE.Group();
    c.add(part(CG.arch, M_clay, 0, 0, 0, s, s, s));
    if (hole) c.add(part(G.box, M_bank, 0, s * 0.42, s * 0.86, s * 0.6, s * 0.45, 0.06));
    c.position.set(x, y, z);
    c.rotation.y = ry;
    g.add(c);
  }

  /** A climbing kiln: `n` chambers stepping up the slope from (x0, z0) toward (x1, z1), a chimney at the top. */
  private climbingKiln(x0: number, z0: number, x1: number, z1: number, n: number): void {
    const g = new THREE.Group();
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      // chambers overlap into one stepped tunnel, each a step higher up the slope
      this.kilnChamber(g, x, z, i * KILN_RISE, ry, 1.5 - t * 0.15, i % 2 === 0);
      // the slope it climbs: an earth bank under each chamber
      g.add(part(G.ball, M_ash, x, 0, z, 2.2, 0.45 + i * KILN_RISE, 2.2));
      if (Math.hypot(x, z) < this.def.radius + 1) this.colliders.push({ x, z, r: 1.5 });
    }
    g.add(part(G.pillar, M_clay, x1 + (x1 - x0) * 0.12, n * KILN_RISE + 2.4, z1 + (z1 - z0) * 0.12, 0.35, 4.6, 0.35));
    this.baker.add(g);
  }

  private jarRow(x0: number, z0: number, x1: number, z1: number, n: number): void {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0, x = x0 + (x1 - x0) * t + (this.rand() - 0.5) * 0.3, z = z0 + (z1 - z0) * t + (this.rand() - 0.5) * 0.3;
      if (!this.clear(x, z, 0.6)) continue;
      const k = this.rand(), sc = k < 0.3 ? 0.7 : k < 0.7 ? 1 : 1.3;
      g.add(part(CG.jar, M_clay, x, 0, z, sc, sc, sc, 0, this.rand() * 6.28, 0));
      if (this.rand() < 0.5) g.add(part(CG.lid, M_clay, x, 1.1 * sc, z, sc, sc, sc, (this.rand() - 0.5) * 0.3, 0, (this.rand() - 0.5) * 0.3));
      this.colliders.push({ x, z, r: 0.55 * sc });
    }
    this.baker.add(g);
  }

  private burntPine(x: number, z: number, h: number): void {
    const g = new THREE.Group();
    g.add(part(G.trunk, M_char, 0, 0, 0, 1.1, h, 1.1, 0, 0, (this.rand() - 0.5) * 0.15));
    for (let k = 0; k < 3; k++) g.add(part(G.trunk, M_char, 0, h * (0.45 + k * 0.15), 0, 0.35, 0.9 + this.rand(), 0.35, 0, this.rand() * 6, 0.9 + this.rand() * 0.4));
    g.position.set(x, 0, z);
    this.baker.add(g);
    if (Math.hypot(x, z) < this.def.radius + 1) this.colliders.push({ x, z, r: 0.4 });
  }

  private kiln(): void {
    const R = this.def.radius;
    // two climbing kilns up the west and east slopes
    // (their chimney tops are ambient.ts KILN_SMOKE: keep them in step)
    this.climbingKiln(-30, 12, -24, -6, 7);
    this.climbingKiln(29, 8, 25, -12, 7);
    // the big kiln on the west slope: its mouth gapes behind the kiln lord's spot
    {
      const g = new THREE.Group();
      g.add(part(CG.arch, M_clay, 0, 0, 0, 3.2, 3.2, 3.2));
      g.add(part(G.disc, M_bank, 3.2 * 1.31, 1.25, 0, 1.5, 1, 2.1, 0, 0, -Math.PI / 2)); // the black mouth
      g.add(part(G.ball, M_ash, -1, 0, 0, 5.5, 1.4, 4.5));
      g.add(part(G.pillar, M_clay, -4.2, 4.5, 0, 0.6, 6, 0.6));
      g.position.set(-16.5, 0, -16.5);
      g.rotation.y = Math.atan2(-(-12 + 16.5), -12 + 16.5);
      this.baker.add(g);
      this.colliders.push({ x: -17, z: -17, r: 3.2 });
    }
    // onggi rows, broken jar heaps, ash mounds, burnt pines, woodpiles
    this.jarRow(9, -20, 21, -16, 8);
    this.jarRow(12, 13, 23, 9, 7);
    this.jarRow(-22, 16, -12, 20, 6);
    this.jarRow(16, -4, 22, 2, 5);
    for (const [x, z] of [[18, 20], [-6, -22], [24, -20], [-26, 2]] as const) {
      if (!this.clear(x, z, 1.5)) continue;
      const g = new THREE.Group();
      for (let k = 0; k < 7; k++) {
        const a = this.rand() * 6.28, d = this.rand() * 1.2;
        g.add(part(CG.jar, M_clay, x + Math.cos(a) * d, -0.2, z + Math.sin(a) * d, 0.6, 0.45 + this.rand() * 0.3, 0.6, 1.2 + this.rand() * 0.6, this.rand() * 6, 0));
        g.add(part(G2.stone, M.rockDark, x + Math.cos(a) * d * 1.4, 0, z + Math.sin(a) * d * 1.4, 0.18, 0.1, 0.16));
      }
      this.baker.add(g);
      this.colliders.push({ x, z, r: 1.3 });
    }
    for (let i = 0; i < 14; i++) {
      const a = this.rand() * Math.PI * 2, d = 8 + this.rand() * (R - 6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this.clear(x, z, 1.2)) this.baker.add(part(G.ball, M_ash, x, 0, z, 1.2 + this.rand() * 1.4, 0.25 + this.rand() * 0.3, 1 + this.rand()));
    }
    this.northRing(26, R + 2, 14, (x, z) => this.burntPine(x, z, 5 + this.rand() * 5));
    for (const [x, z] of [[-9, 6], [14, -9], [-20, -2], [20, 18]] as const) if (this.clear(x, z, 0.6)) this.burntPine(x, z, 4 + this.rand() * 3);
    for (const [x, z] of [[-26, 18], [26, 14], [-21, -12]] as const) {
      if (!this.clear(x, z, 1)) continue;
      const g = new THREE.Group();
      for (let k = 0; k < 9; k++) g.add(part(G.pillar, M_char, x + (k % 3 - 1) * 0.36, 0.2 + Math.floor(k / 3) * 0.32, z, 0.17, 1.6, 0.17, Math.PI / 2, 0, 0));
      this.baker.add(g);
      this.colliders.push({ x, z, r: 0.9 });
    }
    for (let i = 0; i < 28; i++) {
      const a = Math.PI + this.rand() * Math.PI, d = R + 2 + this.rand() * 10;
      this.rock(Math.cos(a) * d, Math.sin(a) * d, 0.8 + this.rand() * 1.2, false, M.rockDark);
    }
  }

  private temple(): void {
    const R = this.def.radius;
    const g = new THREE.Group();
    // the hall: only its charred pillars stand, broken eaves lie between them
    const hx = [-21, -17.5, -14, -10.5], hz = [-3, -9, -15];
    for (const x of hx) for (const z of hz) {
      const h = 3.6 + this.rand() * 2;
      g.add(part(G.pillar, M_char, x, h / 2, z, 0.32, h, 0.32));
      g.add(part(G.box, M.stone, x, 0.15, z, 0.9, 0.3, 0.9));
      this.colliders.push({ x, z, r: 0.45 });
    }
    for (let k = 0; k < 5; k++) g.add(part(CG.eave, M_char, -21 + this.rand() * 10, 0.25, -15 + this.rand() * 12, 1.4 + this.rand(), 1, 1, (this.rand() - 0.5) * 0.4, this.rand() * 6, (this.rand() - 0.5) * 0.5));
    g.add(part(G.box, M_char, -15.5, 0.3, -6, 7, 0.25, 0.3, 0, 0.4, 0.12)); // a fallen beam
    // the three-storey stone pagoda, scorched
    {
      const p = new THREE.Group();
      p.add(part(G.box, M_stoneC, 0, 0.3, 0, 3.2, 0.6, 3.2));
      let y = 0.6;
      for (let k = 0; k < 3; k++) {
        const w = 1.8 - k * 0.35, h = 1.2 - k * 0.15;
        p.add(part(G.box, M_stoneC, 0, y + h / 2, 0, w, h, w));
        y += h;
        p.add(part(G.box, k === 1 ? M.rockDark : M_stoneC, 0, y + 0.12, 0, w + 1.2, 0.24, w + 1.2));
        y += 0.24;
      }
      p.add(part(G.pillar, M.rockDark, 0, y + 0.5, 0, 0.1, 1, 0.1));
      p.position.set(14, 0, -10);
      g.add(p);
      this.colliders.push({ x: 14, z: -10, r: 1.9 });
    }
    // the bell, half sunk and leaning
    g.add(part(CG.bell, M_bronze, 13, -0.55, 10, 1.15, 1.15, 1.15, 0.55, 0, 0.3));
    this.colliders.push({ x: 13, z: 10, r: 1.1 });
    // stone steps climbing north to the censer yard (flush with the ground)
    for (let k = 0; k < 9; k++) g.add(part(G.box, M_stoneC, 0, 0.02 + k * 0.004, -19 - k * 1.05, 5.2 - k * 0.1, 0.05, 0.85));
    // the stone lanterns' bases (the lantern keepers stand on them; when one falls its place stays)
    for (const sp of this.def.spawns) if (sp.kind === "lantern" && sp.at) for (const a of sp.at) g.add(part(G.box, M_stoneC, a.x, 0.17, a.z, 1.3, 0.34, 1.3));
    this.baker.add(g);
    // unlit paper lanterns: strung between the hall's pillars and on posts beside the steps, turning slowly
    const spots: number[] = [];
    for (const z of hz) for (let x = -20.6; x < -10.5; x += 1.75) spots.push(x, 3.2, z);
    const posts = new THREE.Group();
    for (const z of hz) posts.add(part(G.box, M_char, -15.75, 3.55, z, 10.6, 0.05, 0.05));
    for (let z = -2; z > -27; z -= 3.2) for (const x of [-3.4, 3.4]) {
      if (Math.hypot(x, z - 21) < 4 || !this.clear(x, z, 0.3, false)) continue;
      posts.add(part(G.box, M_char, x, 1.3, z, 0.1, 2.6, 0.1));
      posts.add(part(G.box, M_char, x * 0.92, 2.55, z, 0.5, 0.05, 0.05));
      spots.push(x * 0.86, 2.2, z);
    }
    this.baker.add(posts);
    const n = spots.length / 3;
    const mesh = new THREE.InstancedMesh(CG.paperLantern, M_paper, n);
    mesh.frustumCulled = false;
    mesh.userData.noCast = true;
    this.group.add(mesh);
    this.spin = { mesh, pos: Float32Array.from(spots), n };
    // the far side: more pillars and ruined walls lost in the mist
    this.northRing(24, R + 3, 14, (x, z) => {
      const h = 3 + this.rand() * 3;
      this.baker.add(part(G.pillar, M_char, x, h / 2, z, 0.34, h, 0.34));
    });
    for (let i = 0; i < 18; i++) {
      const a = this.rand() * Math.PI * 2, d = R + 1 + this.rand() * 6;
      this.rock(Math.cos(a) * d, Math.sin(a) * d, 0.5 + this.rand() * 0.7, false, M_stoneC);
    }
  }

  private censer(): void {
    const R = this.def.radius;
    const g = new THREE.Group();
    // a ring of broken stone walls, open at the south gate
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.28) continue; // the gate side (+z)
      if (this.rand() < 0.22) continue; // breaches
      const r = R + 0.8 + this.rand() * 0.6, h = 1 + this.rand() * 2.2;
      g.add(part(G.box, M_stoneC, Math.cos(a) * r, h / 2, Math.sin(a) * r, 0.7, h, 3.6 + this.rand(), 0, -a, (this.rand() - 0.5) * 0.1));
      if (this.rand() < 0.5) g.add(part(G2.stone, M.rockDark, Math.cos(a) * (r - 1.2), 0, Math.sin(a) * (r - 1.2), 0.4 + this.rand() * 0.4, 0.3, 0.35));
    }
    // where the censer stands: a round stone plinth (the boss is the censer itself)
    const b = this.def.boss ?? { x: 0, z: -7 };
    g.add(part(G.pillar, M_stoneC, b.x, 0.15, b.z, 3.4, 0.3, 3.4));
    // the great sun drawn in ink on the yard's floor, cracked every way
    g.add(part(CG.sunRing, M_bank, 0, 0.012, -2, 1, 1, 1));
    for (let k = 0; k < 18; k++) {
      const a = this.rand() * Math.PI * 2, r0 = 4 + this.rand() * 8, len = 3 + this.rand() * 7;
      const cx = Math.cos(a) * (r0 + len / 2), cz = -2 + Math.sin(a) * (r0 + len / 2);
      g.add(part(G.box, M_bank, cx, 0.013, cz, len, 0.01, 0.06 + this.rand() * 0.08, 0, -a + (this.rand() - 0.5) * 0.3, 0));
    }
    // bronze shards of the split lid
    for (let k = 0; k < 6; k++) {
      const a = this.rand() * Math.PI * 2, d = 4 + this.rand() * 5;
      g.add(part(CG.lid, M_bronze, b.x + Math.cos(a) * d, 0.05, b.z + Math.sin(a) * d, 1.2, 0.6, 1.2, 0.6 + this.rand(), this.rand() * 6, 0.3));
    }
    this.baker.add(g);
    this.northRing(20, R + 4, 12, (x, z) => this.spire(x, z, 6 + this.rand() * 10, 1.6 + this.rand() * 1.4));
  }

  /* ---------- portals and NPCs ---------- */
  private portal(p: Portal): void {
    const g = new THREE.Group();
    const half = 1.6, h = 3.2;
    for (const s of [-1, 1]) g.add(part(G.box, M.stone, s * half, 0.15, 0, 0.6, 0.3, 0.6));
    g.add(part(G.disc, M.path, 0, 0.025, 0, 2.6, 1, 1.6));
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(p.x, p.z); // gate spans across the way out
    this.baker.add(g);
    // the gate itself: one mesh of its own (OWNED geometry) so it can fade when it hides the player
    const gg = new THREE.Group();
    for (const s of [-1, 1]) gg.add(part(G.pillar, M.gate, s * half, h / 2, 0, 0.16, h, 0.16));
    gg.add(part(G.box, M.gate, 0, h - 0.4, 0, half * 2 + 0.4, 0.16, 0.18));
    gg.add(part(G.box, M.gate, 0, h + 0.05, 0, half * 2 + 1.3, 0.18, 0.5, 0, 0, 0));
    gg.add(part(G.box, M.gate, -half - 0.6, h + 0.18, 0, 0.6, 0.14, 0.5, 0, 0, 0.35));
    gg.add(part(G.box, M.gate, half + 0.6, h + 0.18, 0, 0.6, 0.14, 0.5, 0, 0, -0.35));
    gg.position.copy(g.position);
    gg.rotation.y = g.rotation.y;
    gg.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    gg.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) parts.push(m.geometry.clone().applyMatrix4(m.matrixWorld)); });
    const merged = mergeGeometries(parts, false)!;
    for (const q of parts) q.dispose();
    this.owned.push(merged);
    const gateMesh = new THREE.Mesh(merged, M.gate);
    gateMesh.matrixAutoUpdate = false;
    this.group.add(gateMesh);
    const cx = Math.cos(g.rotation.y), sz = -Math.sin(g.rotation.y);
    this.colliders.push({ x: p.x + cx * half, z: p.z + sz * half, r: 0.3 }, { x: p.x - cx * half, z: p.z - sz * half, r: 0.3 });
    const veil = new THREE.Mesh(veilGeo, veilMat);
    veil.position.set(p.x, 1.4, p.z);
    veil.rotation.y = g.rotation.y;
    veil.frustumCulled = false;
    overlay.add(veil);
    this.veils.push(veil);
    this.gates.push({ mesh: gateMesh, veil, x: p.x, z: p.z, f: 1, init: false });
    this.anchors.push({ x: p.x, y: h + 0.9, z: p.z, text: p.label, kind: "portal" });
  }

  private npc(n: Npc): void {
    const rig = new Rig();
    const look = NPC_LOOK[n.id] ?? NPC_LOOK[n.role] ?? NPC_LOOK.elder;
    rig.setBuild(look.build);
    rig.setHat(look.hat);
    rig.setSash(look.sash);
    rig.pose.set(look.pose);
    const idle = dressNpc(rig, n.id);
    rig.place(n.x, 0, n.z, look.head ?? -Math.PI / 2 + 0.55);
    rig.apply();
    scene.add(rig.group);
    this.npcRigs.push({ id: n.id, rig, base: look.pose, phase: n.x, idle });
    // name plate and quest mark sit above this figure's own height
    // the name and quest mark sit over the head, wherever the pose put it (the elder leans out over his cane)
    rig.group.updateMatrixWorld(true);
    const head = rig.headMesh().getWorldPosition(new THREE.Vector3());
    this.anchors.push({ x: head.x, y: rig.topY() + 0.45, z: head.z, text: n.name, kind: "npc", id: n.id });
    this.colliders.push({ x: n.x, z: n.z, r: 0.45 });
    if (n.id === "dalrae") {
      // her wheel and a drying shelf of jars beside her
      const g = new THREE.Group();
      g.add(part(G.pillar, M.wood, 1.8, 0.25, 1.4, 0.18, 0.5, 0.18));
      g.add(part(G.pillar, M.wood, 1.8, 0.52, 1.4, 0.55, 0.06, 0.55));
      g.add(part(CG.jar, M_clay, 1.8, 0.55, 1.4, 0.25, 0.22, 0.25));
      for (const sx of [-0.9, 0.9]) g.add(part(G.box, M.wood, 3.4 + sx, 0.75, -1.2, 0.08, 1.5, 0.08));
      for (const y of [0.55, 1.15]) {
        g.add(part(G.box, M.wood, 3.4, y, -1.2, 2.0, 0.05, 0.42));
        for (let k = 0; k < 4; k++) g.add(part(CG.jar, M_clay, 2.75 + k * 0.42, y + 0.03, -1.2, 0.22, 0.24, 0.22));
      }
      g.position.set(n.x, 0, n.z);
      this.baker.add(g);
      this.colliders.push({ x: n.x + 1.8, z: n.z + 1.4, r: 0.5 }, { x: n.x + 3.4, z: n.z - 1.2, r: 1.0 });
    }
    if (n.id === "haedam") this.glowPool(n.x + 0.4, n.z, 3.2);
    if (n.id === "noeul") {
      // he sits on a bank stone, a small lantern hanging from a stake beside him (paper-white glow)
      this.baker.add(part(G2.stone, M.rock, n.x - 0.15, 0, n.z, 0.6, 0.48, 0.55));
      const g = new THREE.Group();
      g.add(part(G.box, M.wood, 0, 0.75, 0, 0.07, 1.5, 0.07));
      g.add(part(G.box, M.wood, 0.18, 1.48, 0, 0.42, 0.05, 0.05));
      g.add(part(G.box, M.wood, 0.36, 1.36, 0, 0.02, 0.22, 0.02));
      g.add(part(G.ball, M_lanternGlow, 0.36, 1.15, 0, 0.13, 0.18, 0.13));
      g.position.set(n.x + 0.9, 0, n.z + 0.5);
      this.baker.add(g);
      this.glowPool(n.x + 1.2, n.z + 0.5, 2.2);
    }
  }
}

/* ---------- field NPCs: each its own silhouette (proportions, props, idle) ----------
   Same ink stick-figure as 먹동이, reshaped through Rig.setBuild and dressed with props only (no robes).
   Prop geometry and materials are SHARED (module level); the per-NPC meshes only reference them, so a
   zone change just drops the rig from the scene. Idle closures are made once at build, never per frame. */
const M_dark = lam(0x1a1816);
const M_beard = lam(0xd6d0c2);
const M_caneWood = lam(0x4e3d2c);
const M_iron = lam(0x2c2a28);
const M_bambooPale = lam(0x8f9a5c);
const M_wisp = lam(0x0e0d12);
// the hermit's crescent: pale silver that keeps its tone in the ink pass (dyed alpha path)
const M_crescent = new THREE.MeshBasicMaterial({ color: 0xdfe5ef, ...GLOW_PARAMS });

function rod(r0: number, r1: number, y0: number, y1: number, seg = 7): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, y1 - y0, seg).translate(0, (y0 + y1) / 2, 0);
}
const M_towel = lam(0xcfc8b8);
const M_clayArm = lam(0x6e5c4a);
// 해담's lantern: the temple's one lit fire, warm cinnabar (lantern exception), kept in colour by the ink pass
const M_cinnabarGlow = new THREE.MeshBasicMaterial({ color: 0xe0442a, ...GLOW_PARAMS });
const NG = {
  // elder: a long tapering beard (three strands) and a gnarled cane with a knob above the hand
  beard: mergeGeometries([
    new THREE.ConeGeometry(0.09, 0.62, 7).rotateX(Math.PI).translate(0, -0.31, 0),
    new THREE.ConeGeometry(0.045, 0.42, 6).rotateX(Math.PI).translate(0.04, -0.21, 0.07),
    new THREE.ConeGeometry(0.045, 0.42, 6).rotateX(Math.PI).translate(0.04, -0.21, -0.07),
  ])!,
  cane: mergeGeometries([
    rod(0.03, 0.036, -0.12, 0.98),
    new THREE.SphereGeometry(0.07, 8, 6).translate(0, -0.15, 0),
    new THREE.SphereGeometry(0.045, 7, 5).translate(0.01, 0.3, 0),
    new THREE.SphereGeometry(0.04, 7, 5).translate(-0.01, 0.62, 0),
  ])!,
  // dyer: hair bun, ribbon tails, a long stirring paddle
  bun: new THREE.SphereGeometry(0.11, 10, 8),
  ribbon: new THREE.BoxGeometry(0.025, 0.62, 0.075).translate(0, -0.31, 0),
  paddle: mergeGeometries([rod(0.028, 0.028, -0.55, 1.35), new THREE.BoxGeometry(0.2, 0.42, 0.035).translate(0, 1.5, 0)])!,
  // altar keeper: a smith's hammer
  hammer: mergeGeometries([rod(0.04, 0.045, -0.12, 1.02), new THREE.BoxGeometry(0.42, 0.26, 0.26).translate(0, 1.04, 0)])!,
  // guide: hair tails, a bamboo staff, a flute
  hair: new THREE.ConeGeometry(0.05, 0.85, 6).rotateX(Math.PI).translate(0, -0.42, 0),
  staff: mergeGeometries([rod(0.03, 0.03, -1.0, 1.05), new THREE.CylinderGeometry(0.038, 0.038, 0.03, 7).translate(0, -0.4, 0), new THREE.CylinderGeometry(0.038, 0.038, 0.03, 7).translate(0, 0.3, 0)])!,
  flute: rod(0.022, 0.022, -0.3, 0.3),
  sashTail: new THREE.BoxGeometry(0.03, 0.55, 0.08).translate(0, -0.27, 0),
  // ferryman: oar
  oar: mergeGeometries([rod(0.03, 0.035, -0.25, 2.0), new THREE.BoxGeometry(0.2, 0.55, 0.04).translate(0, 2.2, 0)])!,
  // potter: a headband with a tail, a wooden mallet
  band: new THREE.TorusGeometry(0.245, 0.04, 6, 20).rotateY(Math.PI / 2).translate(0, 0.06, 0),
  towelTail: new THREE.BoxGeometry(0.03, 0.3, 0.09).translate(0, -0.15, 0),
  mallet: mergeGeometries([rod(0.03, 0.035, -0.15, 0.55), new THREE.CylinderGeometry(0.09, 0.09, 0.26, 10).rotateZ(Math.PI / 2).translate(0, 0.62, 0)])!,
  // lantern keeper: a tall pole with a hook, a hanging lantern, wrist beads, a moktak
  pole: mergeGeometries([rod(0.03, 0.034, -0.9, 2.3), new THREE.BoxGeometry(0.4, 0.04, 0.04).translate(0.18, 2.28, 0)])!,
  lamp: lathe([[0, -0.2], [0.11, -0.17], [0.15, 0], [0.11, 0.17], [0, 0.2]], 10),
  lampFrame: mergeGeometries([new THREE.BoxGeometry(0.01, 0.12, 0.01).translate(0.32, 2.2, 0), new THREE.CylinderGeometry(0.1, 0.1, 0.03, 8).translate(0.32, 2.25, 0)])!,
  beads: new THREE.TorusGeometry(0.07, 0.022, 5, 12).rotateX(Math.PI / 2),
  moktak: new THREE.SphereGeometry(0.1, 8, 6).scale(1.2, 0.8, 1),
  // hermit: a crescent behind the head, ink wisps
  crescent: new THREE.TorusGeometry(0.2, 0.026, 6, 26, 4.3),
  wisp: new THREE.SphereGeometry(1, 6, 5),
};

interface NpcLook {
  hat: ItemDef | undefined;
  sash: number | null;
  build: Build;
  pose: Float32Array;
  /** world-space heading; default faces the camera a little to the right */
  head?: number;
}
const Pz = (...a: number[]) => Float32Array.from(a);
const NPC_LOOK: Record<string, NpcLook> = {
  // pose = [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR, weapon, rootY]
  elder: { hat: ITEM.h_satgat, sash: null, build: { height: 0.84, head: 1.12, limb: 0.92, legs: 0.86, torso: 0.9 },
    pose: Pz(0.55, -0.32, -0.1, 0.3, 0.55, 0.15, 0.2, -0.4, -0.05, -0.25, -0.7, -0.1), head: -0.35 },
  dyer: { hat: ITEM.h_none, sash: 0xc0281c, build: { height: 1.0, head: 0.95, limb: 0.82, legs: 1.06, arms: 1.05 },
    pose: Pz(0.2, 0, 0.75, 0.5, 0.95, 0.3, 0.35, -0.5, -0.2, -0.2, -0.9, -0.08), head: 0.64 },
  altar: { hat: ITEM.h_gat, sash: 0xd9a640, build: { height: 1.14, head: 0.84, limb: 1.5, torso: 1.1, arms: 1.05, legs: 0.95 },
    pose: Pz(0.02, 0, -0.18, 0.25, 0.6, 2.2, 0.28, -0.12, -0.28, -0.1, 0.86, -0.05), head: -0.6 },
  guide: { hat: ITEM.h_none, sash: null, build: {}, pose: POSE.idle },
  baram: { hat: ITEM.h_none, sash: 0x5fa8a0, build: { height: 1.13, head: 0.94, limb: 0.8, legs: 1.12, torso: 1.03 },
    pose: Pz(0.04, 0.05, -0.4, 1.5, 0.25, 0.35, 0.15, -0.15, -0.12, -0.08, -0.6, -0.03), head: -0.3 },
  noeul: { hat: ITEM.h_satgat, sash: 0xe07a3a, build: { height: 0.96, head: 0.95, limb: 0.74, arms: 1.05, hatW: 1.75 },
    pose: Pz(0.28, -0.1, 0.9, -0.35, 0.4, 0.6, 1.45, -1.55, 1.3, -1.25, 2.14, -0.55), head: Math.PI + 0.35 },
  // 솔재 마을 (the second village): an old woman bent over a pine staff, a dyer with her sleeves rolled, the smith's younger brother
  sanhalmi: { hat: ITEM.h_none, sash: 0x7a5a8e, build: { height: 0.8, head: 1.1, limb: 0.9, legs: 0.84, torso: 0.88 },
    pose: Pz(0.6, -0.25, -0.1, 0.35, 0.6, 0.2, 0.2, -0.45, -0.05, -0.3, -0.7, -0.12), head: -0.2 },
  yeoul: { hat: ITEM.h_none, sash: 0xd9a640, build: { height: 1.02, head: 0.94, limb: 0.82, legs: 1.08, arms: 1.05 },
    pose: Pz(0.15, 0.05, 0.6, 0.6, 0.9, 0.35, 0.3, -0.45, -0.18, -0.2, -0.9, -0.07), head: 0.4 },
  musoe: { hat: ITEM.h_none, sash: 0x8e2a22, build: { height: 1.08, head: 0.9, limb: 1.6, torso: 1.15, arms: 1.1, legs: 0.92 },
    pose: Pz(0.04, 0, -0.2, 0.3, 0.55, 2.1, 0.28, -0.12, -0.28, -0.1, 0.86, -0.05), head: -0.4 },
  // chapter 2
  dalrae: { hat: ITEM.h_none, sash: null, build: { height: 0.97, head: 1.02, limb: 1.3, legs: 0.93, torso: 0.95 },
    pose: Pz(0.18, 0.05, 0.85, 1.35, 0.7, 1.2, 0.18, -0.2, -0.12, -0.18, 1.2, -0.05) },
  haedam: { hat: ITEM.h_none, sash: null, build: { height: 1.06, head: 0.95, limb: 0.95, legs: 1.04 },
    pose: Pz(0.0, 0.02, -0.1, 0.25, 0.3, 0.5, 0.05, -0.04, -0.06, -0.03, 2.34, -0.01) },
  heukwol: { hat: ITEM.h_mask, sash: null, build: { height: 1.3, head: 0.9, limb: 0.62, legs: 1.22, torso: 1.18, arms: 1.15 },
    pose: Pz(-0.03, 0.04, -0.12, 0.12, 0.08, 0.1, 0.06, -0.04, -0.06, -0.03, 0, -0.01), head: -0.3 },
};

type Idle = (rig: Rig, t: number) => void;
const BREATHE: Idle = (rig, t) => {
  rig.pose[11] += Math.sin(t * 1.8) * 0.02;
  rig.pose[0] += Math.sin(t * 1.8) * 0.015;
};

/** Props and idle for one NPC; returns its idle animation (built once). */
/**
 * A free-standing figure of an NPC from its look (build, hat, sash, pose, props), not placed in any scene:
 * for portraits of speakers who aren't in the current zone. Parts are SHARED geometry/materials (nothing to
 * dispose beyond letting it go). Null for ids with no look.
 */
export function buildNpcRig(id: string): Rig | null {
  const look = NPC_LOOK[id];
  if (!look) return null;
  const rig = new Rig();
  rig.setBuild(look.build);
  rig.setHat(look.hat);
  rig.setSash(look.sash);
  rig.pose.set(look.pose);
  dressNpc(rig, id);
  rig.apply();
  return rig;
}

function dressNpc(rig: Rig, id: string): Idle {
  if (id === "elder") {
    const beard = new THREE.Group();
    const b = new THREE.Mesh(NG.beard, M_beard);
    b.position.set(0.17, -0.17, 0);
    b.rotation.z = 0.15;
    beard.add(b);
    rig.addProp(beard, "head");
    rig.setHeld(new THREE.Mesh(NG.cane, M_caneWood));
    return (r, t) => {
      // a slow sway over the cane; now and then a hand comes up to stroke the beard
      r.pose[0] += Math.sin(t * 0.9) * 0.04;
      r.pose[11] += Math.sin(t * 0.9) * 0.015;
      const c = t % 8;
      const k = c > 5.2 && c < 7.6 ? Math.sin(((c - 5.2) / 2.4) * Math.PI) : 0;
      r.pose[2] += k * 1.25;
      r.pose[3] += k * 1.75 + k * Math.sin(t * 6) * 0.15;
      b.rotation.z = 0.15 + Math.sin(t * 1.3) * 0.05 - k * 0.1;
    };
  }
  if (id === "dyer") {
    const hair = new THREE.Group();
    const bun = new THREE.Mesh(NG.bun, M_dark);
    bun.position.set(-0.13, 0.2, 0);
    hair.add(bun);
    const tails: THREE.Mesh[] = [];
    for (const z of [-0.04, 0.04]) {
      const t = new THREE.Mesh(NG.ribbon, dyeMat(0xc0281c));
      t.position.set(-0.2, 0.22, z);
      hair.add(t);
      tails.push(t);
    }
    rig.addProp(hair, "head");
    rig.paintForearms(dyeMat(0x2a4f8a), dyeMat(0xc0281c)); // indigo and madder up to the elbows
    rig.setHeld(new THREE.Mesh(NG.paddle, M.wood));
    return (r, t) => {
      // stirring the vat: both arms trace a slow circle, the body follows
      const s = Math.sin(t * 2.2), c = Math.cos(t * 2.2);
      r.pose[2] += s * 0.22; r.pose[3] += c * 0.15;
      r.pose[4] += s * 0.25; r.pose[5] += c * 0.18;
      r.pose[0] += c * 0.05; r.pose[10] += s * 0.12;
      for (let i = 0; i < tails.length; i++) tails[i].rotation.z = -0.9 + Math.sin(t * 5.3 + i * 1.7) * 0.25 + Math.sin(t * 2.1 + i) * 0.15;
    };
  }
  if (id === "altar") {
    rig.setHeld(new THREE.Mesh(NG.hammer, M_iron));
    return (r, t) => {
      // a heavy breath and, every few seconds, a roll of the hammer shoulder
      BREATHE(r, t * 0.7);
      const c = t % 6;
      const k = c > 4 && c < 5.4 ? Math.sin(((c - 4) / 1.4) * Math.PI) : 0;
      r.pose[4] += k * 0.35; r.pose[5] -= k * 0.3; r.pose[0] -= k * 0.06; r.pose[1] += k * 0.12;
    };
  }
  if (id === "sanhalmi") {
    // her hair up in a bun, leaning on a pine staff; every so often she straightens and looks up the pass
    const hair = new THREE.Group();
    const bun = new THREE.Mesh(NG.bun, M_beard);
    bun.position.set(-0.12, 0.18, 0);
    hair.add(bun);
    rig.addProp(hair, "head");
    rig.setHeld(new THREE.Mesh(NG.cane, M_caneWood));
    return (r, t) => {
      r.pose[0] += Math.sin(t * 0.8) * 0.035;
      r.pose[11] += Math.sin(t * 0.8) * 0.012;
      const c = t % 9;
      const k = c > 6 && c < 8.4 ? Math.sin(((c - 6) / 2.4) * Math.PI) : 0;
      r.pose[0] -= k * 0.25;
      r.pose[1] -= k * 0.35;
    };
  }
  if (id === "yeoul") {
    // loose hair tied with a gold ribbon, sleeves dyed to the elbow, wringing cloth over the vat
    const hair = new THREE.Group();
    const tails: THREE.Mesh[] = [];
    for (const z of [-0.05, 0.05]) {
      const h = new THREE.Mesh(NG.hair, M_dark);
      h.position.set(-0.2, 0.06, z);
      hair.add(h);
      tails.push(h);
    }
    const tie = new THREE.Mesh(NG.ribbon, dyeMat(0xd9a640));
    tie.position.set(-0.18, 0.12, 0);
    hair.add(tie);
    rig.addProp(hair, "head");
    rig.paintForearms(dyeMat(0xd9a640), dyeMat(0x6a8fc8));
    rig.setHeld(new THREE.Mesh(NG.paddle, M.wood));
    return (r, t) => {
      const s = Math.sin(t * 1.7), c = Math.cos(t * 1.7);
      r.pose[2] += s * 0.18; r.pose[4] -= s * 0.18;
      r.pose[3] += c * 0.12; r.pose[5] -= c * 0.12;
      r.pose[0] += c * 0.04;
      for (let i = 0; i < tails.length; i++) tails[i].rotation.z = -1.0 + Math.sin(t * 3.1 + i * 1.4) * 0.15;
      tie.rotation.z = -0.9 + Math.sin(t * 4.3) * 0.2;
    };
  }
  if (id === "musoe") {
    rig.setHeld(new THREE.Mesh(NG.hammer, M_iron));
    return (r, t) => {
      // taps the hammer on his palm, now and then
      BREATHE(r, t * 0.8);
      const c = t % 4.5;
      const k = c > 3 && c < 3.8 ? Math.sin(((c - 3) / 0.8) * Math.PI * 2) : 0;
      r.pose[5] += k * 0.3; r.pose[4] += k * 0.12;
    };
  }
  if (id === "baram") {
    const hair = new THREE.Group();
    const strands: THREE.Mesh[] = [];
    for (const z of [-0.06, 0.06]) {
      const h = new THREE.Mesh(NG.hair, M_dark);
      h.position.set(-0.2, 0.08, z);
      hair.add(h);
      strands.push(h);
    }
    rig.addProp(hair, "head");
    const hip = new THREE.Group();
    const flute = new THREE.Mesh(NG.flute, M_bambooPale);
    flute.position.set(0.05, -0.12, 0.2);
    flute.rotation.z = -1.0;
    const tail = new THREE.Mesh(NG.sashTail, dyeMat(0x5fa8a0));
    tail.position.set(-0.05, -0.05, -0.12);
    hip.add(flute, tail);
    rig.addProp(hip, "back");
    rig.setHeld(new THREE.Mesh(NG.staff, M_bambooPale));
    return (r, t) => {
      // weight shifts from foot to foot; hair and sash tail always in the wind
      const w = Math.sin(t * 0.8);
      r.pose[6] += w * 0.08; r.pose[8] -= w * 0.08; r.pose[0] += w * 0.03;
      BREATHE(r, t);
      for (let i = 0; i < strands.length; i++) strands[i].rotation.z = -1.05 + Math.sin(t * 3.4 + i * 1.3) * 0.18 + Math.sin(t * 7.1 + i) * 0.06;
      tail.rotation.z = -1.3 + Math.sin(t * 4.1) * 0.25;
    };
  }
  if (id === "noeul") {
    rig.setHeld(new THREE.Mesh(NG.oar, M.wood));
    return (r, t) => {
      // rocking as if still on the boat
      r.pose[0] += Math.sin(t * 1.1) * 0.07;
      r.pose[1] -= Math.sin(t * 1.1) * 0.05;
      r.pose[4] += Math.sin(t * 1.1 + 0.6) * 0.05;
    };
  }
  if (id === "dalrae") {
    // a towel tied round the head with a short tail, a smear of soot on the brow, clay to the elbows
    const towel = new THREE.Group();
    towel.add(new THREE.Mesh(NG.band, M_towel));
    const tail = new THREE.Mesh(NG.towelTail, M_towel);
    tail.position.set(-0.22, 0.08, 0.06);
    towel.add(tail);
    const soot = new THREE.Mesh(G.box, M_dark);
    soot.scale.set(0.02, 0.025, 0.2);
    soot.position.set(0.23, 0.12, 0);
    towel.add(soot);
    rig.addProp(towel, "head");
    rig.paintForearms(M_clayArm, M_clayArm);
    rig.setHeld(new THREE.Mesh(NG.mallet, M.wood));
    // a little jar held against the hip
    const jar = new THREE.Group();
    const j = new THREE.Mesh(CG.jar, M_clay);
    j.scale.setScalar(0.32);
    j.position.set(0.05, -0.2, -0.05);
    jar.add(j);
    rig.addProp(jar, "handL");
    return (r, t) => {
      // taps the jar with the mallet and leans in to listen
      const c = t % 4.2, tap = c < 1.6 ? Math.max(0, Math.sin(c * 9)) : 0;
      r.pose[4] -= tap * 0.35; r.pose[5] += tap * 0.25;
      r.pose[1] += c > 1.6 && c < 3.2 ? Math.sin(((c - 1.6) / 1.6) * Math.PI) * 0.3 : 0;
      r.pose[0] += c > 1.6 && c < 3.2 ? Math.sin(((c - 1.6) / 1.6) * Math.PI) * 0.12 : 0;
      tail.rotation.z = -0.9 + Math.sin(t * 3) * 0.15;
    };
  }
  if (id === "haedam") {
    // a tall pole with the only lit lantern in the temple (cinnabar), beads at the wrist, a small moktak at the waist
    const pole = new THREE.Group();
    pole.add(new THREE.Mesh(NG.pole, M.wood));
    const lamp = new THREE.Mesh(NG.lamp, M_cinnabarGlow);
    lamp.position.set(0.32, 2.05, 0);
    pole.add(lamp);
    pole.add(new THREE.Mesh(NG.lampFrame, M_dark));
    rig.setHeld(pole);
    const beads = new THREE.Group();
    beads.add(new THREE.Mesh(NG.beads, M_dark));
    rig.addProp(beads, "handL");
    const waist = new THREE.Group();
    const mok = new THREE.Mesh(NG.moktak, M.wood);
    mok.position.set(0.12, -0.25, 0.2);
    waist.add(mok);
    rig.addProp(waist, "back");
    return (r, t) => {
      BREATHE(r, t * 0.8);
      // re-grips the pole now and then; holds a palm under the lantern to feel its warmth
      const c = t % 9;
      const g = c < 0.8 ? Math.sin((c / 0.8) * Math.PI) : 0;
      r.pose[4] += g * 0.12; r.pose[5] -= g * 0.2;
      const palm = c > 4 && c < 7 ? Math.sin(((c - 4) / 3) * Math.PI) : 0;
      r.pose[2] += palm * 1.9; r.pose[3] += palm * 0.9; r.pose[1] += palm * 0.25;
      lamp.rotation.z = Math.sin(t * 1.4) * 0.08;
    };
  }
  if (id === "heukwol") {
    rig.setHeld(new THREE.Group());
    const halo = new THREE.Group();
    const moon = new THREE.Mesh(NG.crescent, M_crescent);
    moon.position.set(-0.38, 0.14, 0);
    moon.rotation.set(0, Math.PI / 2, 0.83); // opening to one side: a crescent, not a cup
    halo.add(moon);
    rig.addProp(halo, "head");
    // ink wisps drifting off the limbs (children of the rig, in its local space)
    const wisps: { m: THREE.Mesh; x: number; y: number; z: number; ph: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(NG.wisp, M_wisp);
      m.scale.setScalar(0.001); // grows in the idle; tiny at the shadow bake
      const y = 0.3 + (i / 9) * 1.6;
      wisps.push({ m, x: (i % 3) * 0.08 - 0.08, y, z: (i % 2 ? 1 : -1) * (0.12 + (i % 4) * 0.05), ph: i * 0.37 });
      rig.group.add(m);
    }
    return (r, t) => {
      // almost still; the crescent hangs and turns slowly, the wisps rise and thin out
      r.pose[11] += Math.sin(t * 0.6) * 0.01;
      moon.position.y = 0.14 + Math.sin(t * 0.9) * 0.04;
      moon.rotation.z = 0.83 + Math.sin(t * 0.4) * 0.1;
      for (const w of wisps) {
        const u = (t * 0.35 + w.ph) % 1;
        w.m.position.set(w.x - u * 0.5, w.y + u * 0.7, w.z * (1 + u * 0.6));
        w.m.scale.set(0.07 * (1 - u), 0.1 * (1 - u) + 0.01, 0.07 * (1 - u));
      }
    };
  }
  return BREATHE;
}
