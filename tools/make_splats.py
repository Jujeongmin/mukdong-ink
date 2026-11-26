"""Ink splatter atlas for the screen splashes (public/assets/fx/ink-splats-v1.png).

Eight hand-tuned procedural patterns in a 4 x 2 grid of 256 px cells, so a splash on the picture plane can be
one of several shapes instead of the same round blot every time:
  0 impact: a heavy blot thrown one way, drops and streaks flung after it
  1 burst: a blot with sharp spikes all round
  2 spray: a cloud of small dots, denser at the middle
  3 drip: a blot with runs hanging down
  4 flick: a dry-brush stroke broken into hair lines
  5 twin: two blots run together, a few drops
  6 crown: a ring of drops round a thin centre
  7 trail: a line of drops shrinking away
Channels: R = ink (0..255), G = when that pixel appears as the splash spreads (0 = at once, 255 = last), so the
shader can grow it outward. B unused, A = 255. Deterministic (fixed seeds): re-running gives the same file.
Run: python tools/make_splats.py
"""
import math
import pathlib
import numpy as np
from PIL import Image, ImageFilter

CELL = 256
COLS, ROWS = 4, 2
OUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "assets" / "fx" / "ink-splats-v1.png"

yy, xx = np.mgrid[0:CELL, 0:CELL].astype(np.float32)
cx = cy = CELL / 2


def disc(img, x, y, r, v=1.0):
    d = np.hypot(xx - x, yy - y)
    img[:] = np.maximum(img, np.clip((r - d) / 1.6 + 0.5, 0, 1) * v)


def ellipse(img, x, y, rx, ry, ang, v=1.0):
    c, s = math.cos(ang), math.sin(ang)
    u = ((xx - x) * c + (yy - y) * s) / rx
    w = (-(xx - x) * s + (yy - y) * c) / ry
    d = np.hypot(u, w)
    img[:] = np.maximum(img, np.clip((1 - d) * min(rx, ry) / 1.6 + 0.5, 0, 1) * v)


def ragged(img, x, y, r, rng, lobes=7, amp=0.28, v=1.0):
    """A blot whose edge wanders: radius modulated by a few random lobes."""
    ang = np.arctan2(yy - y, xx - x)
    rr = np.full_like(ang, r)
    for k in range(1, lobes + 1):
        rr += r * amp / k * np.sin(ang * (k + 1) + rng.uniform(0, 6.28))
    d = np.hypot(xx - x, yy - y)
    img[:] = np.maximum(img, np.clip((rr - d) / 1.8 + 0.5, 0, 1) * v)


def spike(img, x0, y0, a, L, w0, rng, bend=0.0):
    """A thrown streak: thick where it leaves the blot, tapering to a point, bending a little."""
    n = max(6, int(L / 2.2))
    for j in range(n + 1):
        t = j / n
        aa = a + bend * t
        x = x0 + math.cos(aa) * L * t
        y = y0 + math.sin(aa) * L * t
        disc(img, x, y, max(0.7, w0 * (1 - t) ** 0.8))


def drops_along(img, rng, ang0, spread, n, rmin, rmax, dmin, dmax, size):
    for _ in range(n):
        a = ang0 + rng.uniform(-spread, spread)
        dist = rng.uniform(dmin, dmax)
        r = size * rng.uniform(rmin, rmax) * (1.15 - dist / dmax * 0.6)
        disc(img, cx + math.cos(a) * dist, cy + math.sin(a) * dist, max(1.2, r))


def finish(img, rng):
    """Edge fibres and a little bleed, then the reveal channel (distance from the centre, wobbled)."""
    noise = rng.random((CELL // 8, CELL // 8)).astype(np.float32)
    n = np.array(Image.fromarray((noise * 255).astype(np.uint8)).resize((CELL, CELL), Image.BICUBIC), dtype=np.float32) / 255
    ink = np.clip(img * (0.9 + 0.14 * n), 0, 1)
    ink_img = Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    ink = np.array(ink_img, dtype=np.float32) / 255
    # pooled ink at the wet edge: a touch darker just inside the boundary
    edge = np.array(ink_img.filter(ImageFilter.GaussianBlur(3)), dtype=np.float32) / 255
    ink = np.clip(ink * (0.82 + 0.25 * np.clip((ink - edge) * 4 + 0.5, 0, 1)), 0, 1)
    d = np.hypot(xx - cx, yy - cy) / (CELL * 0.5)
    reveal = np.clip(d * (0.85 + 0.3 * n), 0, 1)
    # keep the cell's border clear so bilinear sampling never pulls in a neighbour
    m = np.ones_like(ink)
    m[:3, :] = m[-3:, :] = 0
    m[:, :3] = m[:, -3:] = 0
    return ink * m, reveal


def pattern(i):
    rng = np.random.default_rng(1000 + i)
    img = np.zeros((CELL, CELL), np.float32)
    if i == 0:  # impact
        ragged(img, cx - 8, cy, 40, rng, amp=0.22)
        ellipse(img, cx + 34, cy + 2, 46, 18, 0.05)
        drops_along(img, rng, 0.0, 0.55, 22, 0.08, 0.22, 60, 118, 40)
        for _ in range(4):
            a = rng.uniform(-0.35, 0.35)
            ellipse(img, cx + math.cos(a) * 88, cy + math.sin(a) * 88, 22, 2.6, a)
    elif i == 1:  # burst
        ragged(img, cx, cy, 36, rng, lobes=5, amp=0.2)
        for k in range(11):
            a = k / 11 * 6.283 + rng.uniform(-0.25, 0.25)
            L = rng.uniform(34, 92)
            spike(img, cx + math.cos(a) * 28, cy + math.sin(a) * 28, a, L, rng.uniform(4, 8), rng, rng.uniform(-0.15, 0.15))
            if rng.random() < 0.5:
                disc(img, cx + math.cos(a) * (34 + L * 1.15), cy + math.sin(a) * (34 + L * 1.15), rng.uniform(1.6, 3.6))
    elif i == 2:  # spray
        for _ in range(170):
            r = abs(rng.normal(0, 46))
            a = rng.uniform(0, 6.283)
            disc(img, cx + math.cos(a) * r, cy + math.sin(a) * r * 0.8, max(1.3, rng.uniform(1.5, 7) * (1 - r / 140)))
        ragged(img, cx, cy, 18, rng, amp=0.3)
    elif i == 3:  # drip
        ragged(img, cx, cy - 26, 44, rng, amp=0.2)
        for _ in range(5):
            x = cx + rng.uniform(-34, 34)
            L = rng.uniform(34, 96)
            w = rng.uniform(3.5, 6.5)
            spike(img, x, cy - 6, math.pi / 2, L, w, rng, rng.uniform(-0.05, 0.05))
            disc(img, x + rng.uniform(-1, 1), cy - 6 + L, w * 1.2)
        drops_along(img, rng, -1.57, 1.4, 9, 0.06, 0.16, 54, 96, 40)
    elif i == 4:  # flick: a dry brush dragged and lifted, hairs parting toward the end
        ang = -0.32
        for k in range(11):
            off = rng.normal(0, 11)
            L = rng.uniform(110, 200)
            sx = cx - 100 + rng.uniform(0, 20)
            n = int(L / 2)
            gap_at = rng.uniform(0.55, 0.95)
            for j in range(n):
                t = j / n
                if t > gap_at and rng.random() < 0.55:
                    continue
                x = sx + L * t
                y = cy + off * (1 + t * 0.6) + (x - cx) * math.tan(ang)
                disc(img, x, y, max(0.8, (3.4 - abs(off) / 9) * (1 - t * 0.75)))
        ragged(img, cx - 92, cy + 30, 22, rng, amp=0.25)
    elif i == 5:  # twin
        ragged(img, cx - 26, cy - 8, 34, rng, amp=0.25)
        ragged(img, cx + 28, cy + 14, 26, rng, amp=0.3)
        ellipse(img, cx, cy + 3, 30, 14, 0.4)
        drops_along(img, rng, 0.4, 3.1, 14, 0.06, 0.18, 54, 108, 40)
    elif i == 6:  # crown: a thin centre, ink thrown out all round in uneven tongues
        ragged(img, cx, cy, 24, rng, amp=0.3)
        for k in range(16):
            a = k / 16 * 6.283 + rng.uniform(-0.18, 0.18)
            L = rng.uniform(26, 70)
            spike(img, cx + math.cos(a) * 20, cy + math.sin(a) * 20, a, L, rng.uniform(3, 9), rng, rng.uniform(-0.25, 0.25))
        drops_along(img, rng, 0, 3.14, 14, 0.05, 0.14, 70, 118, 40)
    elif i == 7:  # trail
        ang = 0.25
        for k in range(15):
            t = k / 14
            d = -70 + t * 190
            r = 26 * (1 - t) ** 1.4 + 2
            x = cx + math.cos(ang) * d + rng.normal(0, 4)
            y = cy + math.sin(ang) * d + rng.normal(0, 4)
            ragged(img, x, y, r, rng, lobes=4, amp=0.2) if r > 8 else disc(img, x, y, r)
    return finish(img, rng)


def main():
    atlas = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
    for i in range(COLS * ROWS):
        ink, reveal = pattern(i)
        r, c = divmod(i, COLS)
        cell = atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
        cell[..., 0] = (ink * 255).astype(np.uint8)
        cell[..., 1] = (reveal * 255).astype(np.uint8)
        cell[..., 3] = 255
    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas, "RGBA").save(OUT, optimize=True)
    print(OUT, OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
