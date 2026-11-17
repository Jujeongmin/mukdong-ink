"""Turn Codex ink-on-white UI images into alpha masks (black RGB, alpha = ink density).

usage: python ui_masks.py <src_dir> <out_dir>
- ui-paper.png: made seamless (offset + cross-fade seams), downscaled to 512, saved as JPEG-quality PNG.
- ui-frame.png: kept on its full canvas (9-slice insets are measured and printed).
- the rest: trimmed to the ink bounding box + small pad.
"""
import sys, os
from PIL import Image, ImageChops, ImageFilter
import numpy as np

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def to_mask(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA", "P"):
        # some came back already cut out (with a light fringe): flatten onto white, then read ink density
        rgba = im.convert("RGBA")
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        im = Image.alpha_composite(white, rgba)
    g = np.asarray(im.convert("L"), dtype=np.float32) / 255.0
    # white (>= .93) is empty; black (<= .08) is full ink; smooth curve between
    a = np.clip((0.93 - g) / (0.93 - 0.08), 0, 1)
    a = a ** 0.9
    alpha = Image.fromarray((a * 255).astype(np.uint8), "L")
    rgba = Image.new("RGBA", im.size, (0, 0, 0, 0))
    rgba.putalpha(alpha)
    return rgba


def trim(rgba: Image.Image, pad: int = 8) -> Image.Image:
    box = rgba.getchannel("A").point(lambda v: 255 if v > 10 else 0).getbbox()
    if not box:
        return rgba
    l, t, r, b = box
    return rgba.crop((max(0, l - pad), max(0, t - pad), min(rgba.width, r + pad), min(rgba.height, b + pad)))


def seamless(im: Image.Image, size: int = 512) -> Image.Image:
    im = im.convert("RGB")
    w, h = im.size
    shifted = ImageChops.offset(im, w // 2, h // 2)
    # blend the original over the shifted copy except near the original's edges (where the seam was)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.minimum(xs, w - 1 - xs) / (w * 0.25)
    dy = np.minimum(ys, h - 1 - ys) / (h * 0.25)
    m = np.clip(np.minimum(dx, dy), 0, 1)
    mask = Image.fromarray((m * 255).astype(np.uint8), "L")
    # the shifted image has its seam in the middle; the original has none in the middle
    merged = Image.composite(im, shifted, mask)
    merged = ImageChops.offset(merged, w // 2, h // 2)
    return merged.resize((size, size), Image.LANCZOS)


for name in sorted(os.listdir(src)):
    if not name.endswith(".png"):
        continue
    im = Image.open(os.path.join(src, name))
    base = name[:-4]
    if base == "ui-paper":
        seamless(im).save(os.path.join(out, "ui-paper.jpg"), quality=86)
        print(name, "-> ui-paper.jpg 512")
        continue
    m = to_mask(im)
    if base == "ui-frame":
        a = np.asarray(m.getchannel("A")) > 40
        h, w = a.shape
        rows = np.where(a[:, w // 2])[0]
        cols = np.where(a[h // 2, :])[0]
        print("frame insets: top", rows.min(), "bottom", h - rows.max(), "left", cols.min(), "right", w - cols.max())
        m = m.resize((512, 512), Image.LANCZOS)
    else:
        m = trim(m)
        longest = max(m.size)
        cap = 768 if base in ("ui-stroke", "ui-line") else 384
        if longest > cap:
            k = cap / longest
            m = m.resize((round(m.width * k), round(m.height * k)), Image.LANCZOS)
    m.save(os.path.join(out, base + ".png"), optimize=True)
    print(name, "->", base + ".png", m.size)
