"""Score the reconstructed symbol contour against the official PNG's alpha mask.

The 3D hero and the brand mark both come from
site/assets/yearn-symbol-contour.json, which tools/trace_symbol.py builds by
tracing the Y and rebuilding the band analytically. Simplification can quietly
eat silhouette, so this checks the artifact instead of trusting the generator:
it denormalizes the rings back into image space and reports IoU against the
white pixels of the source PNG.

Run: uv run --with shapely --with numpy --with pillow python tools/verify_symbol_contour.py
Exit 1 if the silhouette drifts below the floor.
"""

import json
import sys

import numpy as np
from PIL import Image
from shapely import contains_xy
from shapely.geometry import Polygon

PNG = "site/assets/yearn-symbol-white-rgb.png"
CONTOUR = sys.argv[1] if len(sys.argv) > 1 else "site/assets/yearn-symbol-contour.json"
IOU_FLOOR = 0.96
BAND_MIN_POINTS = 400  # the analytic band must stay dense enough to read as a circle


def main() -> int:
    img = Image.open(PNG).convert("RGBA")
    w, h = img.size
    mask = np.asarray(img)[:, :, 3] > 128

    data = json.load(open(CONTOUR))
    if (data["w"], data["h"]) != (w, h):
        print(f"FAIL contour size {data['w']}x{data['h']} != image {w}x{h}")
        return 1

    # Same transform as trace_symbol.normalized_ring.
    cx, cy = w / 2.0, h / 2.0
    scale = max(w, h) / 2.0

    polys = []
    densest = 0
    for shape in data["shapes"]:
        ring = [(nx * scale + cx, cy - ny * scale) for nx, ny in shape["outer"]]
        holes = [
            [(nx * scale + cx, cy - ny * scale) for nx, ny in hole]
            for hole in shape["holes"]
        ]
        polys.append(Polygon(ring, holes))
        densest = max(densest, len(ring))

    gx, gy = np.meshgrid(
        np.arange(w, dtype=float), np.arange(h, dtype=float), indexing="xy"
    )
    inside = np.zeros((h, w), dtype=bool)
    for poly in polys:
        inside |= contains_xy(poly, gx.ravel(), gy.ravel()).reshape(h, w)

    iou = float((inside & mask).sum()) / float((inside | mask).sum())
    band_lo = int(h * 0.55)  # below the Y's fork, where only the band lives
    band_inter = float((inside[band_lo:] & mask[band_lo:]).sum())
    band_union = float((inside[band_lo:] | mask[band_lo:]).sum())
    band_iou = band_inter / band_union

    print(f"{PNG} {w}x{h}: mask {int(mask.sum())} px, contour {int(inside.sum())} px")
    print(
        f"IoU = {iou:.4f}   band region = {band_iou:.4f}   densest ring = {densest} pts"
    )

    failed = False
    if iou < IOU_FLOOR:
        print(f"FAIL IoU {iou:.4f} below floor {IOU_FLOOR}")
        failed = True
    if densest < BAND_MIN_POINTS:
        print(
            f"FAIL band ring simplified to {densest} pts; the extruded curve will facet"
        )
        failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
