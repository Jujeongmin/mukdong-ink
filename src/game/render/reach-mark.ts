// Where to stand under a floating monster (the field boss 떠도는 먹구름): it hangs in the air, but blows land on
// the ground circle under it (the server's hit test is on the ground plane), so that circle is painted on the
// ground: a pale ink wash with a broken brush ring at its edge, turning slowly. Overlay pass (fog never hides it),
// tested against the scene depth so figures stand in front of it; under the route (-3) and the telegraphs (-1).
// One mesh, geometry and material created once (OWNED here, alive all session; no per-frame allocation).

import * as THREE from "three";
import { GROUND_DEPTH_GLSL, groundDepthU, overlay } from "./gfx";

const FRAG = `
uniform float uTime;
varying vec2 vUv;
${GROUND_DEPTH_GLSL}
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  if (behindScene()) discard;
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x) + uTime * 0.25;
  // the brush ring: eight strokes with gaps, thick-to-thin, rough-edged
  float seg = fract(ang / 6.28318 * 8.0);
  float on = smoothstep(0.02, 0.08, seg) * (1.0 - smoothstep(0.72, 0.8, seg));
  float th = mix(0.11, 0.045, seg);
  float rough = (rn(vec2(ang * 9.0, r * 20.0)) - 0.5) * 0.03;
  float ring = (1.0 - smoothstep(th - 0.02, th, abs(r - 0.9) + rough)) * on;
  // a faint wash inside, breathing a little
  float wash = (1.0 - smoothstep(0.5, 0.9, r)) * (0.24 + 0.05 * sin(uTime * 2.0)) * (0.8 + 0.4 * rn(p * 6.0));
  float a = max(ring * 0.88, wash);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.07, 0.06, 0.055), a);
}`;

export class ReachMark {
  private readonly time = { value: 0 };
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private readonly mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uTime: this.time, ...groundDepthU },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: FRAG,
  });
  private readonly mesh = new THREE.Mesh(this.geo, this.mat);

  constructor() {
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -4;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    overlay.add(this.mesh);
  }

  /** Under (x, z), sized to a hit circle of `radius` metres. */
  show(x: number, z: number, radius: number, time: number): void {
    const s = radius * 2 / 0.9; // the ring sits at 0.9 of the quad's half-width
    this.mesh.position.set(x, 0.05, z);
    this.mesh.scale.set(s, s, 1);
    this.time.value = time;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
