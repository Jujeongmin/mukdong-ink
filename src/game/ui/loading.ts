// Loading screen: the zone's still (ken-burns drift, vignette, a dark foot for legibility), an ensō painted
// clockwise as the work goes on (brush head at the leading end; on completion the gap closes with a flick and
// a small ink bloom), the zone name with one line about the place, and a tip or lore line on a paper tablet.
// Shown on first connect and on every zone change. Only one image is held at a time (one <img>, its src
// dropped after hiding, so the decoded bitmap can go). All motion is CSS; progress is one custom property.

import { IDLE_LINES, NPC_INFO } from "../../shared/story";
import { ZONES } from "../../shared/world";
import { el, esc } from "./dom";

// In-engine stills per zone; a missing file just leaves the paper-and-ink wash.
const ART: Record<string, string> = {
  village: "./assets/art/loading-village.webp",
  bamboo: "./assets/art/loading-bamboo.webp",
  pond: "./assets/art/loading-pond.webp",
  peak: "./assets/art/loading-peak.webp",
  kiln: "./assets/art/loading-kiln.webp",
  temple: "./assets/art/loading-temple.webp",
  censer: "./assets/art/loading-censer.webp",
};

/** One line about each place, under its name. */
const FLAVOR: Record<string, string> = {
  village: "등불이 먹빛 골목을 지킨다.",
  bamboo: "바람이 댓잎마다 먹을 털어 낸다.",
  pond: "물빛이 남은 마지막 연못.",
  peak: "먹구름이 봉우리를 삼켰다.",
  kiln: "식은 가마마다 재가 아직 숨을 쉰다.",
  temple: "꺼진 등 사이에 하나가 서른 해를 버텼다.",
  censer: "깨진 향로가 아직도 뜨겁다.",
};

const TIPS = [
  "클릭을 누른 채로 있으면 세 번째 한 수는 회전베기가 된다.",
  "구르는 동안은 먹귀신의 공격이 닿지 않는다. 붉은 먹 자국이 보이면 굴러서 피하자.",
  "수련(K)에서 검법을 단련하면 5단계와 10단계에 각성한다.",
  "+12부터는 강화가 실패하면 붓이 부서질 수 있다. 파괴방지권을 챙기자.",
  "물들인 목도리와 허리띠는 같은 채널의 다른 이들 눈에도 보인다.",
  "먹귀신을 베면 안료와 먹돌이, 드물게 색 조각이 나온다.",
  "물약은 Q. 마을의 단이에게서 살 수 있다. 설정에서 자동으로 마시게 할 수도 있다.",
  "오방 검법은 1–5 또는 고리를 눌러 쓴다. 자동 사냥 중에는 저절로 나간다.",
  "Space, Shift, 오른쪽 클릭 어느 것으로도 구를 수 있다.",
  "머리 위의 붉은 표식은 맡길 일이 있다는 뜻이다.",
];

const MIN_MS = 900;
/** the closing flick and ink bloom before the wipe */
const DONE_MS = 520;

function pickLine(): string {
  if (Math.random() < 0.6) return esc(TIPS[Math.floor(Math.random() * TIPS.length)]);
  const ids = Object.keys(IDLE_LINES);
  const id = ids[Math.floor(Math.random() * ids.length)];
  const sets = IDLE_LINES[id];
  const line = sets[Math.floor(Math.random() * sets.length)][0];
  return `<b>${esc(NPC_INFO[id]?.name ?? "")}</b> ${esc(line.text)}`;
}

export class Loading {
  private readonly box: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly enso: HTMLElement;
  private shownAt = 0;
  private open = false;
  private src = "";
  /** bumps when show() interrupts a hide() that is still waiting, so that hide() gives up */
  private gen = 0;
  private hiding = false;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML("beforeend", `
      <section class="loading" data-loading hidden aria-live="polite">
        <div class="loading-art"><img data-art alt="" decoding="async"></div>
        <div class="loading-veil"></div>
        <div class="loading-stage">
          <div class="loading-mark">
            <div class="enso-load" data-enso role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="불러오는 중">
              <i class="bloom" aria-hidden="true"></i>
              <i class="ring-track" aria-hidden="true"></i>
              <i class="ring" aria-hidden="true"></i>
              <i class="seam" aria-hidden="true"></i>
              <i class="head" aria-hidden="true"></i>
            </div>
            <p class="loading-status" data-status></p>
          </div>
          <div class="loading-place">
            <h2 data-zname></h2>
            <p class="flavor" data-zflavor></p>
            <small class="chan" data-zchan hidden></small>
          </div>
        </div>
        <p class="loading-tip" data-tip></p>
      </section>`);
    this.box = el("[data-loading]", root);
    this.img = el<HTMLImageElement>("[data-art]", this.box);
    this.enso = el("[data-enso]", this.box);
    this.img.addEventListener("load", () => this.img.classList.add("ready"));
    this.img.addEventListener("error", () => this.img.classList.remove("ready"));
  }

  isOpen(): boolean {
    return this.open;
  }

  show(zone: string, status = ""): void {
    this.setZone(zone);
    this.status(status);
    if (this.open && !this.hiding) return;
    if (this.hiding) { this.gen++; this.hiding = false; }
    this.open = true;
    this.shownAt = performance.now();
    el("[data-tip]", this.box).innerHTML = pickLine();
    el("[data-zchan]", this.box).hidden = true;
    this.box.classList.remove("out", "done");
    // start from an empty circle without animating back from the last fill
    this.enso.classList.add("snap");
    this.progress(0);
    this.box.hidden = false;
    void this.enso.offsetWidth;
    this.enso.classList.remove("snap");
    this.progress(0.12);
  }

  setZone(zone: string): void {
    el("[data-zname]", this.box).textContent = ZONES[zone]?.name ?? "";
    el("[data-zflavor]", this.box).textContent = FLAVOR[zone] ?? "";
    const src = ART[zone] ?? ART.village;
    if (this.src === src) return;
    this.src = src;
    this.img.classList.remove("ready");
    this.img.src = src;
  }

  /** The channel, once the server has placed us. */
  channel(n: number): void {
    const c = el("[data-zchan]", this.box);
    c.textContent = `${n}채널`;
    c.hidden = !(n > 0);
  }

  status(text: string): void {
    el("[data-status]", this.box).textContent = text;
  }

  progress(f: number): void {
    const v = Math.max(0, Math.min(1, f));
    this.enso.style.setProperty("--f", v.toFixed(3));
    this.enso.setAttribute("aria-valuenow", String(Math.round(v * 100)));
  }

  /** Waits out the minimum time, closes the circle (flick + bloom), wipes away, and lets the image go. */
  async hide(): Promise<void> {
    if (!this.open || this.hiding) return;
    this.hiding = true;
    const gen = this.gen;
    this.progress(1);
    const left = MIN_MS - (performance.now() - this.shownAt);
    await new Promise((r) => window.setTimeout(r, Math.max(420, left)));
    if (gen !== this.gen) return;
    this.box.classList.add("done");
    await new Promise((r) => window.setTimeout(r, DONE_MS));
    if (gen !== this.gen) return;
    this.box.classList.add("out");
    await new Promise((r) => window.setTimeout(r, 520));
    if (gen !== this.gen) return;
    this.hiding = false;
    this.box.hidden = true;
    this.box.classList.remove("out", "done");
    this.open = false;
    // release the decoded art; the next show() loads only the zone it needs
    this.img.removeAttribute("src");
    this.img.classList.remove("ready");
    this.src = "";
  }
}
