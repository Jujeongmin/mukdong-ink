// Bakes motion-capture sword clips onto 먹동이's planar rig.
//
//   node tools/bake-motion.mjs <path/to/UAL2_Standard.glb> [--report]
//
// Source: Quaternius "Universal Animation Library 2" (CC0, see CREDITS.md). The GLB is read as plain data
// (JSON chunk + binary accessors); nothing in it is executed and it never ships: only the baked angles in
// src/game/render/motion/sword.ts do (a few KB).
//
// Retarget by limb direction, not length (먹동이 is ~5 heads tall with long thin limbs): every frame the
// skeleton is evaluated in world space, each bone's direction is projected onto the body's own plane
// (forward/up of the pelvis-chest frame, after taking out the upper body's yaw, which becomes `twist`),
// and turned into the rig's angles: pose = [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR,
// weapon, rootY] + twist. The weapon angle comes from the right hand's grip axis (pinky -> index knuckles).

import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";

const SRC = process.argv[2];
const REPORT = process.argv.includes("--report");
if (!SRC) {
  console.error("usage: node tools/bake-motion.mjs <UAL2_Standard.glb> [--report]");
  process.exit(1);
}
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../src/game/render/motion/sword.ts");
const FPS = 30;

/* ---------- GLB as data ---------- */
const buf = fs.readFileSync(SRC);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
  if (a.componentType !== 5126) throw new Error("only float accessors are expected for animation data");
  const n = COMPS[a.type], stride = bv.byteStride || n * 4, off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(off + k * stride + c * 4);
  return { data: out, n, count: a.count };
}

/* ---------- skeleton ---------- */
const nodes = gltf.nodes.map((n, i) => ({
  i, name: n.name, children: n.children || [],
  t: new THREE.Vector3().fromArray(n.translation || [0, 0, 0]),
  r: new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]),
  s: new THREE.Vector3().fromArray(n.scale || [1, 1, 1]),
  parent: -1, world: new THREE.Matrix4(), local: new THREE.Matrix4(),
}));
for (const n of nodes) for (const c of n.children) nodes[c].parent = n.i;
const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
const rest = nodes.map((n) => ({ t: n.t.clone(), r: n.r.clone(), s: n.s.clone() }));
const roots = nodes.filter((n) => n.parent < 0);
function updateWorld() {
  const walk = (n, parentM) => {
    n.local.compose(n.t, n.r, n.s);
    n.world.multiplyMatrices(parentM, n.local);
    for (const c of n.children) walk(nodes[c], n.world);
  };
  const I = new THREE.Matrix4();
  for (const r of roots) walk(r, I);
}
const P = (name) => new THREE.Vector3().setFromMatrixPosition(byName[name].world);

/* ---------- clip sampling ---------- */
function clip(name) {
  const a = gltf.animations.find((x) => x.name === name);
  if (!a) throw new Error("no clip " + name);
  const ch = a.channels.map((c) => {
    const s = a.samplers[c.sampler];
    return { node: nodes[c.target.node], path: c.target.path, input: accessor(s.input).data, output: accessor(s.output), interp: s.interpolation || "LINEAR" };
  });
  let dur = 0;
  for (const c of ch) dur = Math.max(dur, c.input[c.input.length - 1]);
  return { name, ch, dur };
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function pose(c, t) {
  for (let i = 0; i < nodes.length; i++) { nodes[i].t.copy(rest[i].t); nodes[i].r.copy(rest[i].r); nodes[i].s.copy(rest[i].s); }
  for (const k of c.ch) {
    const inp = k.input, n = k.output.n, o = k.output.data, cubic = k.interp === "CUBICSPLINE";
    const val = (idx) => (cubic ? (idx * 3 + 1) * n : idx * n); // cubic spline: [in-tangent, value, out-tangent]
    let j = 0;
    while (j < inp.length - 2 && inp[j + 1] < t) j++;
    const u = inp.length < 2 ? 0 : Math.min(1, Math.max(0, (t - inp[j]) / (inp[j + 1] - inp[j] || 1)));
    const a = val(j), b = val(Math.min(j + 1, inp.length - 1));
    if (k.path === "rotation") {
      qa.fromArray(o, a); qb.fromArray(o, b);
      k.node.r.copy(k.interp === "STEP" ? qa : qa.slerp(qb, u));
    } else {
      const tgt = k.path === "translation" ? k.node.t : k.node.s;
      for (let c2 = 0; c2 < 3; c2++) tgt.setComponent(c2, k.interp === "STEP" ? o[a + c2] : o[a + c2] + (o[b + c2] - o[a + c2]) * u);
    }
  }
  updateWorld();
}

/* ---------- retarget ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (x) => { while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };
const hor = (v) => new THREE.Vector3(v.x, 0, v.z).normalize();
/** the body's facing in the source: from the feet's toe direction in the clip's first frame */
function facing() {
  const f = P("ball_l").add(P("ball_r")).sub(P("foot_l")).sub(P("foot_r"));
  return hor(f);
}
let F0 = new THREE.Vector3(0, 0, 1);
const STAND = { pelvisY: 0, leg: 0 };
function frame(mirror) {
  // upper-body yaw: the chest's left->right axis against the rest facing
  const sideL = mirror ? "_r" : "_l", sideR = mirror ? "_l" : "_r";
  const chestRight = hor(P("upperarm" + sideR).sub(P("upperarm" + sideL)));
  const fwdChest = new THREE.Vector3().crossVectors(UP, chestRight).normalize(); // up x right = forward... (right-handed: forward = up x right)
  let twist = Math.atan2(new THREE.Vector3().crossVectors(F0, fwdChest).y, F0.dot(fwdChest));
  if (mirror) twist = -twist;
  // the plane: forward = the twisted facing, up = world up, right = forward x up
  const F = fwdChest.clone();
  const R = new THREE.Vector3().crossVectors(F, UP).normalize();
  const proj = (v) => [v.dot(F), v.dot(UP), v.dot(R) * (mirror ? -1 : 1)];
  const dirA = (a, b) => proj(P(b).sub(P(a)));
  const ang = ([x, y]) => Math.atan2(x, -y); // rig limb angle: (sin a, -cos a) points along the limb
  const spine = dirA("pelvis", "neck_01");
  const torso = Math.atan2(spine[0], spine[1]);
  const neck = dirA("neck_01", "Head");
  const head = wrap(Math.atan2(neck[0], neck[1]) - torso);
  const arm = (s) => {
    const sh = ang(dirA("upperarm" + s, "lowerarm" + s));
    const fa = ang(dirA("lowerarm" + s, "hand" + s));
    return [sh, wrap(fa - sh), fa];
  };
  const [shL, elL] = arm(sideL);
  const [shR, elR, faR] = arm(sideR);
  const leg = (s) => {
    const hip = ang(dirA("thigh" + s, "calf" + s));
    const a = ang(dirA("calf" + s, "foot" + s));
    return [hip, wrap(a - hip)];
  };
  const [hipL, kneeL] = leg(sideL);
  const [hipR, kneeR] = leg(sideR);
  // grip axis of the weapon hand: from the little finger's knuckle to the index finger's
  const grip = dirA("pinky_01" + sideR, "index_01" + sideR);
  const weapon = wrap(ang(grip) - faR);
  const rootY = (P("pelvis").y - STAND.pelvisY) * (1.0 / STAND.leg);
  // the arms and the blade in 3D too (unit directions in the body frame: forward, up, right), so sweeps
  // across the body survive: the rig uses these for the arms and the brush during strikes
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const d3 = [
    ...unit(dirA("upperarm" + sideL, "lowerarm" + sideL)), ...unit(dirA("lowerarm" + sideL, "hand" + sideL)),
    ...unit(dirA("upperarm" + sideR, "lowerarm" + sideR)), ...unit(dirA("lowerarm" + sideR, "hand" + sideR)),
    ...unit(grip),
  ];
  return [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR, weapon, rootY, twist, ...d3];
}

/** the chest's facing (up x shoulder line) in the current pose */
function chestForward() {
  return new THREE.Vector3().crossVectors(UP, hor(P("upperarm_r").sub(P("upperarm_l")))).normalize();
}
/** when the weapon hand moves fastest in [t0, t1] */
function fastest(c, t0, t1) {
  let best = -1, bestT = t0, prev = null;
  for (let t = t0; t <= t1 + 1e-6; t += 1 / FPS) {
    pose(c, t);
    const h = P("hand_r");
    if (prev) { const v = h.distanceTo(prev) * FPS; if (v > best) { best = v; bestT = t; } }
    prev = h;
  }
  return { t: bestT, speed: best };
}
/**
 * Samples [t0, t1] of a clip at FPS. The body frame is the chest's facing at `ref` (the impact of the hit
 * this part belongs to), so at impact the figure faces its heading and twist turns around that.
 */
function bake(name, t0, t1, mirror, ref) {
  const c = clip(name);
  t1 = Math.min(t1 ?? c.dur, c.dur);
  const f = fastest(c, t0, t1);
  if (!ref) { pose(c, f.t); ref = chestForward(); }
  F0 = ref.clone();
  const out = [];
  for (let t = t0; t <= t1 + 1e-6; t += 1 / FPS) {
    pose(c, t);
    out.push(frame(mirror));
  }
  return { name, dur: c.dur, frames: out, fastest: f.t - t0, speed: f.speed, ref };
}

// standing reference (pelvis height and leg length) from the rest pose
updateWorld();
STAND.pelvisY = P("pelvis").y;
STAND.leg = P("thigh_l").distanceTo(P("calf_l")) + P("calf_l").distanceTo(P("foot_l"));

if (REPORT) {
  for (const a of gltf.animations.filter((x) => /Sword|Hit_Knock/.test(x.name))) {
    const b = bake(a.name, 0, undefined, false);
    let lMove = 0, rMove = 0;
    for (const s of ["_l", "_r"]) {
      const c = clip(a.name); let prev = null, sum = 0;
      for (let t = 0; t <= c.dur; t += 1 / FPS) { pose(c, t); const p = P("hand" + s); if (prev) sum += p.distanceTo(prev); prev = p; }
      if (s === "_l") lMove = sum; else rMove = sum;
    }
    const tw = b.frames.map((f) => f[12]);
    console.log(a.name.padEnd(22), "dur", b.dur.toFixed(2), "fastest@", b.fastest.toFixed(2), "handL", lMove.toFixed(2), "handR", rMove.toFixed(2),
      "twist", Math.min(...tw).toFixed(2), Math.max(...tw).toFixed(2));
  }
  process.exit(0);
}

/* ---------- the combo ---------- */
// Which source clips make each basic hit, the trimmed range, and playback speed (wuxia snap).
const PLAN = [
  { key: "hit1", parts: [["Sword_Regular_A", 0, null], ["Sword_Regular_A_Rec", 0, 0.42]], speed: 1.25 },
  { key: "hit2", parts: [["Sword_Regular_B", 0, null], ["Sword_Regular_B_Rec", 0, 0.42]], speed: 1.25 },
  { key: "hit3", parts: [["Sword_Regular_C", 0.1, 1.25]], speed: 1.55 },
];
const r2 = (x) => Math.round(x * 100) / 100;
let ts = `// GENERATED by tools/bake-motion.mjs from Quaternius "Universal Animation Library 2" (CC0, see CREDITS.md).
// Do not edit by hand. Each hit: frames at ${FPS} fps of [torso, head, shL, elL, shR, elR, hipL, kneeL, hipR,
// kneeR, weapon, rootY, twist] (the rig's angles, see rig.ts) followed by 15 unit directions in the body
// frame (left upper arm, left forearm, right upper arm, right forearm, blade), the playback duration in seconds, the impact
// time (the brush moving fastest: damage numbers, hit-stop and ink fire there) and when the next hit may chain.

export interface MotionClip {
  /** frames x 28 values, flattened (13 angles + 15 direction components) */
  data: Float32Array;
  frames: number;
  /** playback seconds (already sped up) */
  dur: number;
  /** seconds into the clip */
  impact: number;
  /** seconds into the clip after which the next combo hit may start */
  chain: number;
}
const C = (frames: number, dur: number, impact: number, chain: number, d: number[]): MotionClip => ({ data: Float32Array.from(d), frames, dur, impact, chain });

`;
const summary = [];
for (const p of PLAN) {
  const frames = [];
  let impactT = 0, ref = null, tAcc = 0;
  for (let i = 0; i < p.parts.length; i++) {
    const [name, a, b] = p.parts[i];
    const k = bake(name, a, b ?? undefined, false, ref);
    if (i === 0) { impactT = k.fastest; ref = k.ref; }
    for (const f of k.frames) frames.push(f);
    tAcc += k.frames.length / FPS;
  }
  // unwrap angles frame to frame so interpolation never takes the long way round
  for (let j = 0; j < 12 + 1; j++) for (let i = 1; i < frames.length; i++) {
    let d = frames[i][j] - frames[i - 1][j];
    while (d > Math.PI) { frames[i][j] -= Math.PI * 2; d -= Math.PI * 2; }
    while (d < -Math.PI) { frames[i][j] += Math.PI * 2; d += Math.PI * 2; }
  }
  const dur = frames.length / FPS / p.speed, impact = impactT / p.speed;
  const chain = Math.min(dur - 0.04, impact + 0.1);
  ts += `export const ${p.key.toUpperCase()} = C(${frames.length}, ${r2(dur)}, ${r2(impact)}, ${r2(chain)}, [\n`;
  for (const f of frames) ts += "  " + f.map((x) => r2(x)).join(", ") + ",\n";
  ts += "]);\n";
  summary.push(`${p.key}: ${frames.length} frames, ${dur.toFixed(2)} s, impact ${impact.toFixed(2)} s, chain ${chain.toFixed(2)} s`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, ts);
console.log("wrote", OUT, (ts.length / 1024).toFixed(1) + " KB");
for (const s of summary) console.log(" ", s);
