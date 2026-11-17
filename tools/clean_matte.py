"""Clean the matte of a painted icon sheet (RGBA): drop the faint coloured fringe the background removal left,
pull the edge colour from the opaque paint next to it (no red/yellow halo), and soften the cut edge by ~1 px.

    python tools/clean_matte.py public/assets/items.png public/assets/items_v2.png [--lo 40 --hi 232]

Writes a new file; the source is never touched (deploys cache by filename).
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def clean(src: np.ndarray, lo: float, hi: float, erode: int) -> np.ndarray:
    rgb = src[..., :3].astype(np.float32)
    a = src[..., 3].astype(np.float32)

    # 1. levels on alpha: the faint wash under `lo` is matting noise, paint above `hi` is solid
    a = np.clip((a - lo) / (hi - lo), 0, 1)

    # 2. kill saturated red / yellow / magenta edge pixels that sit next to transparency (the halo)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    near_clear = ndimage.binary_dilation(a < 0.05, iterations=3)
    hot = (sat > 0.55) & (mx > 140) & ((r >= g) | (g > b + 60)) & (b < 0.6 * mx)
    a = np.where(near_clear & hot & (a < 0.98), 0, a)

    # 3. erode the cut edge, then feather it
    if erode:
        a = np.minimum(a, ndimage.grey_erosion(a, size=(2 * erode + 1, 2 * erode + 1)) * 0.6 + a * 0.4)
    a = ndimage.gaussian_filter(a, 0.7)
    a[a < 0.03] = 0

    # 4. colour decontamination: every not-quite-solid pixel takes the colour of the nearest solid paint
    solid = a > 0.9
    if solid.any():
        _, (iy, ix) = ndimage.distance_transform_edt(~solid, return_indices=True)
        nearest = rgb[iy, ix]
        w = np.clip((a - 0.35) / 0.55, 0, 1)[..., None]  # keep some own colour in the inner half of the edge
        rgb = np.where(solid[..., None], rgb, nearest * (1 - w) + rgb * w)

    out = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)]).astype(np.uint8)
    out[out[..., 3] == 0, :3] = 0
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--lo", type=float, default=40)
    ap.add_argument("--hi", type=float, default=232)
    ap.add_argument("--erode", type=int, default=1)
    o = ap.parse_args()
    im = np.array(Image.open(o.src).convert("RGBA"))
    Image.fromarray(clean(im, o.lo, o.hi, o.erode)).save(o.dst, optimize=True)


if __name__ == "__main__":
    main()
