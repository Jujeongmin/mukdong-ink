// Character creation: name, scarf color and sash color, with a live 먹동이 turning slowly in the ink pass.
// Shown once per account (Profile.created === false). Styling lives in style.css (.create*).

import * as THREE from "three";
import { DYES, STARTER_DYE } from "../../shared/items";
import type { Look } from "../../shared/types";
import { Actor } from "../actor";
import { G, lam } from "../render/materials";
import { camFwd, camera, feel, renderFrame, resize, scene, setEdge, setHorizon, setLoop, setMood } from "../render/gfx";
import { MOODS } from "../render/ambient";
import { updateFx } from "../render/fx";
import { hexCss } from "../util";
import { el, esc } from "./dom";

export interface Creation {
  name: string;
  scarf: number | null;
  sash: number | null;
}

const hz = new THREE.Vector3();

/** The turning figure on a patch of ground; owns nothing but its actor (shared geometry/materials). */
class Preview {
  private readonly ground = new THREE.Mesh(G.disc, lam(0xb7b08f));
  private readonly actor = new Actor(false, null, { radius: 6, colliders: [] });
  private last = performance.now();

  constructor() {
    this.ground.scale.set(7, 1, 7);
    scene.add(this.ground);
    this.actor.teleport(0, 0);
    setMood(MOODS.village);
    setEdge(3);
  }

  look(l: Look): void {
    this.actor.applyLook(l);
  }

  start(): void {
    this.last = performance.now();
    setLoop(() => this.frame());
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    feel.time += dt;
    resize();
    this.actor.head += dt * 0.45;
    const portrait = window.innerWidth / Math.max(1, window.innerHeight) < 0.9;
    // keep the figure clear of the panel: left of it on wide screens, above it on phones
    // phones: the figure sits in the top third, above the panel
    const sx = portrait ? 0 : 1.15, ly = portrait ? -1.4 : 1.0;
    camera.position.set(sx, portrait ? 1.0 : 1.75, portrait ? 11 : 5.0);
    camera.lookAt(sx, ly, 0);
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    hz.set(sx, 0, -14).project(camera);
    setHorizon(Math.min(0.99, Math.max(0.45, hz.y * 0.5 + 0.5)), sx);
    this.actor.render(dt);
    updateFx(dt);
    renderFrame(dt);
  }

  dispose(): void {
    scene.remove(this.ground); // SHARED geometry/material
    this.actor.dispose();
  }
}

export class CharacterCreator {
  private readonly box: HTMLElement;
  private readonly preview = new Preview();
  private scarf: number | null = STARTER_DYE.scarf;
  private sash: number | null = STARTER_DYE.sash;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML("beforeend", `
      <section class="create" data-create>
        <div class="create-wrap">
        <form class="create-panel" data-form>
          <h2>먹동이를 그리다</h2>
          <p class="sub">몸은 먹, 천 두 자락에만 색이 남는다. 이 색은 다른 이들 눈에도 보인다.</p>
          <label class="create-name"><span>이름</span><input data-name maxlength="10" autocomplete="off" placeholder="2~10자" aria-label="이름"></label>
          <div class="create-row"><span>목도리</span><div class="swatches" data-sw="scarf"></div></div>
          <div class="create-row"><span>허리띠</span><div class="swatches" data-sw="sash"></div></div>
          <p class="create-err" data-err aria-live="polite"></p>
          <button class="start btn btn-lg" type="submit">이대로 시작</button>
        </form>
        <i class="panel-frame" aria-hidden="true"></i>
        </div>
      </section>`);
    this.box = el("[data-create]", root);
    this.paint("scarf");
    this.paint("sash");
    this.updateLook();
  }

  private paint(key: "scarf" | "sash"): void {
    const box = el(`[data-sw="${key}"]`, this.box);
    const cur = key === "scarf" ? this.scarf : this.sash;
    box.innerHTML = DYES.map((d, k) => `<button type="button" class="sw${cur === d.hex ? " on" : ""}" data-k="${k}" aria-pressed="${cur === d.hex}" aria-label="${esc(d.name)}" style="--c:${d.hex == null ? "#2b2926" : hexCss(d.hex)}"><span>${esc(d.name)}</span></button>`).join("");
    box.querySelectorAll<HTMLButtonElement>(".sw").forEach((b) => b.addEventListener("click", () => {
      const hex = DYES[Number(b.dataset.k)].hex;
      if (key === "scarf") this.scarf = hex; else this.sash = hex;
      this.paint(key);
      this.updateLook();
    }));
  }

  private updateLook(): void {
    this.preview.look({ weapon: "w_brush", hat: "h_none", sash: "s_plain", sashDye: this.sash, scarfDye: this.scarf, plus: 0, skills: [1, 1, 1, 1, 1] });
  }

  /** Shows the screen and resolves on "이대로 시작" (validation is the server's; errors via error()). */
  ask(): Promise<Creation> {
    this.box.hidden = false;
    this.preview.start();
    const input = el<HTMLInputElement>("[data-name]", this.box);
    input.focus();
    return new Promise((resolve) => {
      const form = el<HTMLFormElement>("[data-form]", this.box);
      const go = (e: Event) => {
        e.preventDefault();
        form.removeEventListener("submit", go);
        resolve({ name: input.value.trim(), scarf: this.scarf, sash: this.sash });
      };
      form.addEventListener("submit", go);
    });
  }

  error(text: string): void {
    el("[data-err]", this.box).textContent = text;
  }

  close(): void {
    this.box.remove();
    this.preview.dispose();
  }
}
