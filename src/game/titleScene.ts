// The title backdrop, rendered live by the game's own renderer and ink pass: 먹동이 standing on a tall rock
// pillar at the lower left, looking toward the moon over a sea of karst pillars and mist (the painted
// backdrop from the post pass), scarf in the wind, a slow camera drift. Everything created here is disposed
// in dispose(); unit geometry/materials come from materials.ts (SHARED).

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { STARTER_DYE } from "../shared/items";
import { Actor } from "./actor";
import { G, M } from "./render/materials";
import { MOODS } from "./render/ambient";
import { camFwd, camera, feel, renderFrame, resize, scene, setEdge, setHorizon, setLoop, setMood } from "./render/gfx";
import { updateFx } from "./render/fx";
import { fbm3 } from "./util";

const PILLAR_X = -3.4;
const PILLAR_TOP = 6;

/** A craggy column; OWNED geometry (disposed with the scene). */
function pillarGeometry(): THREE.BufferGeometry {
  const h = PILLAR_TOP + 14;
  const g = new THREE.CylinderGeometry(1.0, 2.4, h, 16, 22);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = (v.y + h / 2) / h;
    const a = Math.atan2(v.z, v.x);
    const n = fbm3(Math.cos(a) * 1.4 + 3.1, t * 5, Math.sin(a) * 1.4, 3);
    const k = 0.62 + 0.75 * n;
    const crown = t > 0.95 ? (n - 0.5) * 1.1 - 0.3 : 0;
    const sway = Math.sin(t * 7 + 1.3) * 0.25 + Math.sin(t * 17) * 0.08;
    p.setXYZ(i, v.x * k + sway, v.y + h / 2 - 14 + crown, v.z * k);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const out = mergeVertices(g, 1e-4);
  g.dispose();
  out.computeVertexNormals();
  return out;
}

const hz = new THREE.Vector3();
/** The village's night, with a tall karst sea in the backdrop and the moon high on the right. */
const TITLE_MOOD = { ...MOODS.village, pillars: 1, pillarH: 1.7, moon: [0.8, 0.84, 0.05, 1] };

export class TitleScene {
  private readonly group = new THREE.Group();
  private readonly pillarGeo = pillarGeometry();
  private readonly actor = new Actor(false, null, { radius: 50, colliders: [] });
  private last = 0;
  private t = 0;
  private running = false;

  constructor() {
    this.group.add(new THREE.Mesh(this.pillarGeo, M.rockDark));
    this.group.children[0].position.x = PILLAR_X;
    // two small pines clinging to the top (shared geometry/material)
    for (const [x, z, s] of [[-0.75, 0.35, 0.45]] as const) {
      const pine = new THREE.Mesh(G.cone, M.pine);
      pine.position.set(PILLAR_X + x, PILLAR_TOP + 0.35 * s, z);
      pine.scale.set(0.9 * s, 1.5 * s, 0.9 * s);
      this.group.add(pine);
    }
    this.actor.teleport(PILLAR_X + 0.2, 0);
    this.actor.y = PILLAR_TOP - 0.05;
    this.actor.head = 0.75; // three-quarter back view, toward the moon
    this.actor.applyLook({ weapon: "w_brush", hat: "h_none", sash: "s_plain", sashDye: STARTER_DYE.sash, scarfDye: STARTER_DYE.scarf, plus: 0, skills: [1, 1, 1, 1, 1] });
    this.actor.scarf.reset(PILLAR_X, PILLAR_TOP + 1.8, 0);
    for (const t of this.actor.tails) t.reset(PILLAR_X, PILLAR_TOP + 0.9, 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    scene.add(this.group);
    setMood(TITLE_MOOD);
    setEdge(1);
    this.last = performance.now();
    setLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    this.t += dt;
    feel.time += dt;
    resize();
    const portrait = window.innerWidth / Math.max(1, window.innerHeight) < 0.9;
    // slow drift; on phones the camera backs off so hero and moon both fit
    const back = portrait ? 16 : 12;
    // landscape: the hero stands well inside the left edge however narrow the window (a 4:3 window cut him in half)
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfW = Math.tan((camera.fov * Math.PI) / 360) * back * aspect;
    const cx = (portrait ? PILLAR_X + 1.3 : Math.min(1.5, PILLAR_X + halfW * 0.62)) + Math.sin(this.t * 0.11) * 0.4;
    const cy = PILLAR_TOP + 1.1 + Math.sin(this.t * 0.07) * 0.2;
    camera.position.set(cx, cy, back);
    camera.lookAt(cx, PILLAR_TOP + (portrait ? 0.2 : 1.6), 0);
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    hz.set(cx, PILLAR_TOP - 3, -60).project(camera);
    setHorizon(Math.min(0.8, Math.max(0.3, hz.y * 0.5 + 0.5)), cx * 4);
    // the actor stands on the pillar: keep its height, let the scarf and sash fly
    this.actor.y = PILLAR_TOP - 0.05;
    this.actor.render(dt);
    updateFx(dt);
    renderFrame(dt);
  }

  /** Stop the loop and free what this scene made. */
  dispose(): void {
    if (this.running) setLoop(null);
    this.running = false;
    scene.remove(this.group);
    this.pillarGeo.dispose(); // OWNED; pines and the rock material are SHARED
    this.actor.dispose();
  }
}
