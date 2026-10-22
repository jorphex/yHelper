"""Build the shared lockup from Yearn's press-kit SVG and Aeonik Bold.

uv run --with fonttools --with uharfbuzz python tools/build_brand.py reference.svg
Reference: https://presskit.yearn.fi/index/logo_black_background.svg
"""

import argparse
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
import uharfbuzz as hb

ROOT = Path(__file__).resolve().parents[1]
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)


def build(reference: Path, output: Path) -> None:
    source = ET.parse(reference).getroot()
    font_path = ROOT / "site/assets/fonts/Aeonik-Bold.ttf"
    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    bounds = BoundsPen(glyphs)
    glyphs[font.getBestCmap()[ord("e")]].draw(bounds)
    scale = 53.792 / (bounds.bounds[3] - bounds.bounds[1])
    shaped_font = hb.Font(hb.Face(font_path.read_bytes()))
    buffer = hb.Buffer()
    buffer.add_str("wrapped")
    buffer.guess_segment_properties()
    hb.shape(shaped_font, buffer)
    # Preserve all seven official paths and the original symbol/wordmark spacing.
    paths = [node for node in source if node.tag == f"{{{NS}}}path"]
    baseline = 175.04
    cursor = 471 + glyphs[font.getBestCmap()[ord(" ")]].width * scale
    combined = BoundsPen(glyphs)
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        glyph = glyphs[font.getGlyphName(info.codepoint)]
        transform = (scale, 0, 0, -scale, cursor + position.x_offset * scale,
                     baseline - position.y_offset * scale)
        pen = SVGPathPen(glyphs)
        glyph.draw(TransformPen(pen, transform))
        glyph.draw(TransformPen(combined, transform))
        paths.append(ET.Element(f"{{{NS}}}path", {"d": pen.getCommands(), "fill": "white"}))
        cursor += position.x_advance * scale
    # Integer intrinsic dimensions prevent Image.width/height rounding from
    # changing the aspect ratio when Canvas draws the exact same asset.
    top = math.floor(min(105, combined.bounds[1]))
    width, height = math.ceil(combined.bounds[2]) - 89, 210 - top
    root = ET.Element(f"{{{NS}}}svg", {"viewBox": f"89 {top} {width} {height}",
                      "width": str(width), "height": str(height), "fill": "none"})
    root.append(ET.Comment(" Yearn press-kit paths; wrapped: Aeonik Bold, matched x-height and baseline. "))
    root.extend(paths)
    ET.indent(root)
    output.write_text(ET.tostring(root, encoding="unicode") + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "site/assets/yearn-wrapped-lockup.svg")
    args = parser.parse_args()
    build(args.reference, args.output)
