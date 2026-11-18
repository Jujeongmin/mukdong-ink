// Dialogue portraits rendered in-engine: a waist-up cutout (transparent background) of the speaker's actual rig
// (the NPC standing in this zone, or the player's own figure with their dyes), drawn once per speaker into a
// 320×384 render target with the main renderer, read back to a canvas and kept as one PNG data URL (speaking is a
// gentle CSS breath on the same picture: a second, tilted frame made the head twitch). The render target, temporary scene, camera and lights are created per
// capture and disposed right after (memory checklist). About ten small images are cached.

import * as THREE from "three";
import { renderOffscreen } from "../render/gfx";
import type { Rig } from "../render/rig";

const W = 320, H = 384;
const ray = new THREE.Raycaster();
const _c = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector2();
const _box = new THREE.Box3(), _sz = new THREE.Vector3();
const MAX_CACHE = 12;

export interface PortraitPair {
  neutral: string;
  /** the same picture as `neutral` (kept for callers that swap frames) */
  speak: string;
}

/**
 * A held weapon or staff that crosses the face (바람이's bamboo staff, a brush held upright) is left out of the
 * portrait: rays from the camera through a few points on the head; whatever held thing they hit first is hidden.
 * Props off to the side (the elder's cane, the smith's raised hammer) stay.
 */
function hideFaceCovers(rig: Rig, cam: THREE.Camera): THREE.Object3D[] {
  const held = rig.held();
  const head = rig.headMesh();
  _box.setFromObject(head);
  _box.getCenter(_c);
  _box.getSize(_sz);
  const r = Math.max(_sz.x, _sz.y) * 0.32;
  const out: THREE.Object3D[] = [];
  for (let i = 0; i < 9; i++) {
    const ox = ((i % 3) - 1) * r, oy = (Math.floor(i / 3) - 1) * r;
    _p.set(_c.x + ox, _c.y + oy, _c.z).project(cam);
    _n.set(_p.x, _p.y);
    ray.setFromCamera(_n, cam);
    const hits = ray.intersectObjects([head, ...held], true);
    if (!hits.length) continue;
    // the first thing in front: if it belongs to a held object, that object covers the face
    for (const o of held) {
      if (out.includes(o)) continue;
      let h: THREE.Object3D | null = hits[0].object;
      while (h && h !== o) h = h.parent;
      if (h) { o.visible = false; out.push(o); }
    }
  }
  return out;
}

export class Portraits {
  private readonly cache = new Map<string, PortraitPair>();
  /** one readback buffer and one canvas, reused for every capture */
  private readonly buf = new Uint8Array(W * H * 4);
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
    const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 30);
    const rt = new THREE.WebGLRenderTarget(W, H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    let pair: PortraitPair | null = null;
    let hidden: THREE.Object3D[] = [];
    try {
      rig.apply();
      g.updateMatrixWorld(true);
      // frame from the top of the figure (hats included) down to about the waist; the dialogue box hides the cut
      const box = new THREE.Box3().setFromObject(g);
      const h = box.max.y - box.min.y;
      const span = Math.max(0.8, h * 0.66);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const ty = box.max.y + span * 0.04 - span * 0.5;
      const dist = span / (2 * Math.tan((24 * Math.PI) / 360)) * 1.04;
      cam.position.set(cx + dist * 0.12, ty + span * 0.04, cz + dist);
      cam.lookAt(cx, ty, cz);
      cam.updateMatrixWorld(true);
      hidden = hideFaceCovers(rig, cam);
      if (renderOffscreen(scene, cam, rt, this.buf)) {
        const neutral = this.toUrl();
        pair = { neutral, speak: neutral };
      }
    } finally {
      for (const o of hidden) o.visible = true;
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

  /**
   * A whole figure (a 먹그림 도감 monster), feet to top, three-quarter on: drawn once per key into the same
   * kind of offscreen target and kept as a data URL. `g` is a throwaway group built from SHARED geometry and
   * materials, so nothing here needs disposing but the target and lights.
   */
  figure(key: string, g: THREE.Object3D): string | null {
    const have = this.figures.get(key);
    if (have) return have;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xe8e2d4, 0x4a4540, 1.6);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(1.5, 3, 4);
    scene.add(hemi, sun, g);
    g.position.set(0, 0, 0);
    g.rotation.y = -0.6;
    const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 60);
    const rt = new THREE.WebGLRenderTarget(W, H);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    let url: string | null = null;
    try {
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g);
      const h = box.max.y - box.min.y, w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      // fit the taller of height and (width scaled to the frame's aspect), with a little air
      const span = Math.max(0.6, h, (w * H) / W) * 1.12;
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, cy = (box.min.y + box.max.y) / 2;
      const dist = span / (2 * Math.tan((24 * Math.PI) / 360));
      cam.position.set(cx + dist * 0.1, cy + span * 0.12, cz + dist);
      cam.lookAt(cx, cy, cz);
      cam.updateMatrixWorld(true);
      if (renderOffscreen(scene, cam, rt, this.buf)) url = this.toUrl();
    } finally {
      scene.remove(g, hemi, sun);
      rt.dispose();
      hemi.dispose();
      sun.dispose();
    }
    if (url) this.figures.set(key, url);
    return url;
  }
  private readonly figures = new Map<string, string>();
  /** a figure already drawn (so the caller needn't build one) */
  figureOf(key: string): string | null {
    return this.figures.get(key) ?? null;
  }

  /** Drop a cached portrait (the player's dyes changed). */
  forget(key: string): void {
    this.cache.delete(key);
  }

  /** The readback (bottom row first) flipped into the canvas, as a PNG data URL. */
  private toUrl(): string {
    const c = this.canvas ?? (this.canvas = document.createElement("canvas"));
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(this.buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
}
