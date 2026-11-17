// Small math helpers shared by the client modules (no allocation in the hot ones).

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
  const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
  const x00 = a + (b - a) * u, x10 = c + (d - c) * u, x01 = e + (f - e) * u, x11 = g + (h - g) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

export function fbm3(x: number, y: number, z: number, oct = 4): number {
  let s = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * fr, y * fr, z * fr);
    fr *= 2.02;
    amp *= 0.5;
  }
  return s / (1 - Math.pow(0.5, oct));
}

/** Seeded PRNG (mulberry32) so a zone's scenery is the same every time it is built. */
export function rng(seed: number): () => number {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hexCss = (hex: number): string => "#" + hex.toString(16).padStart(6, "0");

export const fmt = (n: number): string => n.toLocaleString("ko-KR");

export type RGB = readonly [number, number, number];

/** Anything with a ground position that an effect can follow. */
export interface Spot {
  x: number;
  z: number;
}
