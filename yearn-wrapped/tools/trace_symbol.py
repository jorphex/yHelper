"""Reconstruct the yearn symbol as clean polygon rings for 3D extrusion.

The PNG alpha mask is two white regions: the Y-with-stem (a simple polygon)
and the bottom band (an annulus sector whose outer circle is clipped by the
image bottom edge). Contour tracing alone gets tangled by the shared
boundaries and the clip, so we:

  1. trace the Y region outline directly (simple ring), and
  2. rebuild the band analytically: Kasa-fit the outer and inner circles from
     the band's row edges, measure the angular span from the mask, and emit
     the annulus sector as a polygon ring.

Output: site/assets/yearn-symbol-contour.json with shapes in normalized coords
([-1,1], y up) ready for THREE.Shape / ExtrudeGeometry.
"""

import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.ops import orient, unary_union
from skimage import measure

# Douglas-Peucker tolerance in source pixels. The official PNG is 308px wide, so
# the traced Y carries mask burrs and stair-steps along its long diagonals; at hero
# size those read as a rough, chipped edge. 1.0px clears them while leaving the
# corners intact (silhouette IoU against the mask drops only 0.9715 -> 0.9684, all
# of it sub-pixel edge drift). Override with TRACE_SIMPLIFY when tuning edges.
SIMPLIFY_TOLERANCE = float(os.environ.get("TRACE_SIMPLIFY", "1.0"))


def normalized_ring(coords, w, h):
    cx, cy = w / 2.0, h / 2.0
    scale = max(w, h) / 2.0
    return [
        [round((x - cx) / scale, 5), round(-(y - cy) / scale, 5)] for (x, y) in coords
    ]


def kasa_fit(points):
    """Least-squares circle fit: returns (cx, cy, r)."""
    pts = np.asarray(points, dtype=float)
    x, y = pts[:, 0], pts[:, 1]
    A = np.column_stack([x, y, np.ones_like(x)])
    b = x * x + y * y
    c = np.linalg.lstsq(A, b, rcond=None)[0]
    cx, cy = c[0] / 2.0, c[1] / 2.0
    r = math.sqrt(c[2] + cx * cx + cy * cy)
    return cx, cy, r


def band_geometry(band_mask, w, h):
    """Fit (center, r_inner, r_outer) and measure the band's angular span."""
    # Center guess: centroid of the band region (near-symmetric C). Only the
    # vertical centroid is used; the row scan below walks y.
    ys, xs = np.nonzero(band_mask)
    _, cy0 = xs.mean(), ys.mean()

    # Row-run edges of the band: for each row, leftmost/rightmost band pixel
    # lies on the outer circle; inner run edges lie on the inner circle.
    outer_pts, inner_pts = [], []
    for y in range(int(cy0) + 6, h):
        row = band_mask[y]
        if not row.any():
            continue
        runs, start = [], None
        for x in range(w):
            if row[x] and start is None:
                start = x
            elif not row[x] and start is not None:
                runs.append((start, x - 1))
                start = None
        if start is not None:
            runs.append((start, w - 1))
        if not runs:
            continue
        outer_pts.append((runs[0][0], y))
        outer_pts.append((runs[-1][1], y))
        if len(runs) >= 2:
            inner_pts.append((runs[0][1] + 1, y))
            inner_pts.append((runs[-1][0] - 1, y))

    ox, oy, R = kasa_fit(outer_pts)
    ix, iy, r = kasa_fit(inner_pts)
    cx, cy = (ox + ix) / 2.0, (oy + iy) / 2.0

    # Angular span at mid-radius, measured from the mask. Image coords: y
    # down; angle 0 = +x axis, increasing clockwise (toward +y = down).
    midr = (r + R) / 2.0
    span_hits = []
    for deg in np.arange(0, 360, 0.25):
        a = math.radians(deg)
        px, py = cx + midr * math.cos(a), cy + midr * math.sin(a)
        xi, yi = int(round(px)), int(round(py))
        if 0 <= xi < w and 0 <= yi < h and band_mask[yi, xi]:
            span_hits.append(deg)
    if not span_hits:
        raise RuntimeError("band span not found")

    # Walk the hits; the band should form one run (wrapping at 360).
    runs, prev, start = [], None, None
    for deg in span_hits:
        if prev is None:
            start = deg
        elif deg - prev > 0.5:  # gap: new run
            runs.append((start, prev))
            start = deg
        prev = deg
    runs.append((start, prev))
    if len(runs) > 1 and abs(runs[0][0]) < 0.5 and abs(runs[-1][1] - 359.75) < 0.5:
        span = (runs[-1][0], runs[0][1] + 360.0)
    else:
        s = max(runs, key=lambda t: t[1] - t[0])
        span = (s[0], s[1] + 0.25)  # extend to the far edge of last bin

    return cx, cy, r, R, span


def band_polygon(cx, cy, r, R, span, n=240):
    """Annulus sector polygon covering span (deg, clockwise, y-down)."""
    a0, a1 = span
    outer_arc = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        outer_arc.append((cx + R * math.cos(a), cy + R * math.sin(a)))
    inner_arc = []
    for i in range(n + 1):
        a = math.radians(a1 - (a1 - a0) * i / n)
        inner_arc.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return Polygon(outer_arc + inner_arc)


def main():
    im = Image.open("site/assets/yearn-symbol-white-rgb.png").convert("RGBA")
    alpha = np.asarray(im.getchannel("A"), dtype=float) / 255.0
    w, h = im.size
    mask = alpha > 0.5
    labels, n = ndimage.label(mask)

    # Identify the two regions by vertical position: the band starts lower.
    infos = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(labels == k)
        infos.append((k, int(ys.min()), len(ys)))
    infos.sort(key=lambda t: t[1])
    band_k = infos[-1][0]
    y_k = infos[0][0]

    # --- Y region: simple outer ring from the mask boundary.
    y_mask = labels == y_k
    rings = measure.find_contours(y_mask.astype(float), 0.5)
    y_ring = max(rings, key=len)
    pts = [(float(x), float(y)) for (y, x) in y_ring]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    y_poly = orient(Polygon(pts), sign=1.0)

    # --- Band region: analytic annulus sector.
    band_mask = labels == band_k
    cx, cy, r, R, span = band_geometry(band_mask, w, h)
    print(
        f"band fit: center=({cx:.2f},{cy:.2f}) r_inner={r:.2f} "
        f"r_outer={R:.2f} span={span[0]:.2f}..{span[1]:.2f} deg"
    )
    band_poly = band_polygon(cx, cy, r, R, span)

    # Simplify the traced Y only. The band is analytic, and a global simplify after
    # the union collapses its 240-step arcs into an 80-gon, which reads as faceted
    # edges once the shape is extruded at hero size.
    y_clean = y_poly.buffer(0).simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    union = unary_union([y_clean, band_poly.buffer(0)])

    shapes = []
    geoms = union.geoms if union.geom_type == "MultiPolygon" else [union]
    for geom in geoms:
        exterior = list(geom.exterior.coords)
        if exterior[0] == exterior[-1]:
            exterior = exterior[:-1]
        holes = []
        for hole in geom.interiors:
            hc = list(hole.coords)
            if hc[0] == hc[-1]:
                hc = hc[:-1]
            holes.append(normalized_ring(hc, w, h))
        shapes.append({"outer": normalized_ring(exterior, w, h), "holes": holes})

    payload = {"w": w, "h": h, "shapes": shapes}
    with open("site/assets/yearn-symbol-contour.json", "w") as f:
        json.dump(payload, f)
    print(f"polygons: {len(shapes)}")
    for s in shapes:
        print(f"  outer pts: {len(s['outer'])}, holes: {[len(r) for r in s['holes']]}")


if __name__ == "__main__":
    main()
