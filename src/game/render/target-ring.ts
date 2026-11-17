// The auto-target mark: a small ink ring with a thin cinnabar rim under whatever the next swing would pick.
// Overlay pass (never washed out by fog), below the telegraphs. One pooled pair of meshes, geometry and
// materials created once (OWNED here); position updated in place each frame, no allocation.

import * as THREE from "three";
import { overlay } from "./gfx";

const Y = 0.05;

export class TargetRing {
  private readonly inkGeo = new THREE.RingGeometry(0.62, 0.8, 36);
  private readonly rimGeo = new THREE.RingGeometry(0.8, 0.88, 36);
  private readonly inkMat = new THREE.MeshBasicMaterial({ color: 0x1d1916, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false });
  private readonly rimMat = new THREE.MeshBasicMaterial({ color: 0xc8322a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private readonly ink = new THREE.Mesh(this.inkGeo, this.inkMat);
  private readonly rim = new THREE.Mesh(this.rimGeo, this.rimMat);

  constructor() {
    for (const m of [this.ink, this.rim]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = -2; // over the route dots, under the red telegraphs
      m.frustumCulled = false;
      m.visible = false;
      overlay.add(m);
    }
  }

  /** Under a target of the given radius at (x, z); a slow breath so it reads as alive. */
  show(x: number, z: number, radius: number, time: number): void {
    const s = Math.max(0.8, radius * 1.35) * (1 + Math.sin(time * 4) * 0.04);
    this.ink.position.set(x, Y, z);
    this.rim.position.set(x, Y, z);
    this.ink.scale.set(s, s, s);
    this.rim.scale.set(s, s, s);
    this.ink.visible = true;
    this.rim.visible = true;
  }

  hide(): void {
    this.ink.visible = false;
    this.rim.visible = false;
  }

  dispose(): void {
    overlay.remove(this.ink, this.rim);
    this.inkGeo.dispose();
    this.rimGeo.dispose();
    this.inkMat.dispose();
    this.rimMat.dispose();
  }
}
