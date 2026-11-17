// Dialogue portraits rendered in-engine: a head-and-shoulders view of the speaker's actual rig (the NPC
// standing in this zone, or the player's own figure with their dyes), drawn once per speaker into a 256²
// render target with the main renderer, read back to a canvas and kept as two PNG data URLs (neutral and a
// slight head tilt for "speaking"). The render target, temporary scene, camera and lights are created per
// capture and disposed right after (memory checklist). About ten small images are cached.

import * as THREE from "three";
import { renderOffscreen } from "../render/gfx";
import type { Rig } from "../render/rig";

const SIZE = 256;
const MAX_CACHE = 12;

export interface PortraitPair {
  neutral: string;
  speak: string;
}

export class Portraits {
  private readonly cache = new Map<string, PortraitPair>();
  /** one readback buffer and one canvas, reused for every capture */
  private readonly buf = new Uint8Array(SIZE * SIZE * 4);
  private canvas: HTMLCanvasElement | null = null;

  get(key: string): PortraitPair | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Capture `rig` (temporarily lifted out of the world scene, then put back exactly where it was).
   * Returns null if the renderer isn't up.
   */
  capture(key: string, rig: Rig): PortraitPair | null {
    const have = this.cache.get(key);
    if (have) return have;
    const g = rig.group;
    const parent = g.parent;
    const pos = g.position.clone(), rotY = g.rotation.y;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xe8e2d4, 0x4a4540, 1.6);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(1.5, 3, 4);
    scene.add(hemi, sun);
    // stand the figure at the origin, three-quarter to the camera, like in the field
    scene.add(g);
    g.position.set(0, 0, 0);
    g.rotation.y = -0.5;
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const pose1 = rig.pose[1];
    let pair: PortraitPair | null = null;
    try {
      rig.apply();
      g.updateMatrixWorld(true);
      // frame head and shoulders from the figure's actual bounds (props and hats included)
      const box = new THREE.Box3().setFromObject(g);
      const h = box.max.y - box.min.y;
      const bust = Math.max(0.45, h * 0.4);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const ty = box.max.y - bust * 0.46;
      const dist = bust / (2 * Math.tan((24 * Math.PI) / 360)) * 1.05;
      cam.position.set(cx + dist * 0.12, ty + bust * 0.06, cz + dist);
      cam.lookAt(cx, ty, cz);
      cam.updateMatrixWorld(true);
      if (renderOffscreen(scene, cam, rt, this.buf)) {
        const neutral = this.toUrl();
        rig.pose[1] = pose1 + 0.14; // the head tips as they speak
        rig.apply();
        g.updateMatrixWorld(true);
        renderOffscreen(scene, cam, rt, this.buf);
        const speak = this.toUrl();
        pair = { neutral, speak };
      }
    } finally {
      rig.pose[1] = pose1;
      rig.apply();
      scene.remove(g);
      g.position.copy(pos);
      g.rotation.y = rotY;
      parent?.add(g);
      rt.dispose();
      scene.remove(hemi, sun);
      hemi.dispose();
      sun.dispose();
    }
    if (pair) {
      if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, pair);
    }
    return pair;
  }

  /** Drop a cached portrait (the player's dyes changed). */
  forget(key: string): void {
    this.cache.delete(key);
  }

  /** The readback (bottom row first) flipped into the canvas, as a PNG data URL. */
  private toUrl(): string {
    const c = this.canvas ?? (this.canvas = document.createElement("canvas"));
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(SIZE, SIZE);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) img.data.set(this.buf.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
}
