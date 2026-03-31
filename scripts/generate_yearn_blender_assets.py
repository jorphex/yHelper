from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_THEME_LOGO_PNG_CANDIDATES: dict[str, list[Path]] = {
    "yearn": [
        ROOT / "web/public/yearn-symbol-white-rgb.png",
        Path("/tmp/yearn-press-kit/public/downloads/YEARN_SYMBOL_WHITE_RGB.png"),
    ],
    "styfi": [
        ROOT / "web/public/stYFI-mark-tight.png",
        ROOT / "web/public/stYFI-logo-flat-removebg-preview.png",
    ],
}
DEFAULT_THEME_LOGO_SVG_CANDIDATES: dict[str, list[Path]] = {
    "yearn": [],
    "styfi": [
        ROOT / "web/public/stYFI-mark.svg",
        ROOT / "web/public/stYFI-logo.svg",
        Path("/tmp/stYFI-logo.svg"),
    ],
}
THEME_DEFAULTS: dict[str, dict[str, Path | str]] = {
    "yearn": {
        "output_dir": ROOT / "web/public/home-assets-yearn-blender",
        "basename": "yearn-blender-coins",
    },
    "styfi": {
        "output_dir": ROOT / "web/public/styfi-assets-blender",
        "basename": "styfi-blender-coin",
    },
}
SCENE_SIZES: dict[str, tuple[int, int]] = {
    "hero": (1400, 820),
    "purpose": (1000, 420),
    "divider": (1600, 220),
}

CoinColor = tuple[float, float, float, float]
PaletteIndex = int
TokenPose = tuple[tuple[float, float, float], tuple[float, float, float], float, PaletteIndex]

C0: PaletteIndex = 0
C1: PaletteIndex = 1
C2: PaletteIndex = 2
C3: PaletteIndex = 3
C4: PaletteIndex = 4
C5: PaletteIndex = 5
C6: PaletteIndex = 6

PALETTES: dict[str, list[CoinColor]] = {
    "yearn": [
        (0.006, 0.12, 0.62, 1.0),
        (0.005, 0.095, 0.5, 1.0),
        (0.003, 0.07, 0.38, 1.0),
        (0.01, 0.14, 0.7, 1.0),
        (0.008, 0.11, 0.56, 1.0),
        (0.0025, 0.06, 0.33, 1.0),
        (0.011, 0.16, 0.76, 1.0),
    ],
    "styfi": [
        (0.984, 0.498, 0.2, 1.0),
        (0.949, 0.42, 0.13, 1.0),
        (0.851, 0.337, 0.09, 1.0),
        (1.0, 0.62, 0.38, 1.0),
        (0.792, 0.286, 0.082, 1.0),
        (0.464, 0.149, 0.035, 1.0),
        (0.996, 0.84, 0.76, 1.0),
    ],
}

HERO_LAYOUTS: dict[str, list[TokenPose]] = {
    "default": [
        ((0.34, -0.02, 0.62), (16, -30, 6), 0.98, C0),
        ((1.22, 0.8, 0.14), (14, 18, -10), 0.78, C1),
        ((-0.46, 1.0, 0.02), (12, 34, 14), 0.66, C2),
    ],
    "arc4": [
        ((0.18, -0.1, 0.68), (15, -28, 4), 1.02, C0),
        ((0.78, 0.34, 0.38), (15, -4, -10), 0.86, C4),
        ((1.26, 0.96, 0.02), (18, 24, -12), 0.62, C1),
        ((-0.96, 1.06, -0.2), (11, 40, 20), 0.5, C5),
    ],
    "stack5": [
        ((0.06, -0.22, 0.82), (18, -22, 2), 1.08, C3),
        ((0.72, 0.24, 0.48), (14, -6, -8), 0.9, C0),
        ((1.18, 0.9, 0.16), (14, 20, -14), 0.7, C1),
        ((-0.64, 0.86, -0.02), (11, 34, 14), 0.6, C2),
        ((-1.02, 0.18, -0.32), (10, 44, 24), 0.48, C5),
    ],
    "spread6": [
        ((-0.06, -0.14, 0.76), (16, -24, 4), 1.0, C0),
        ((0.72, 0.18, 0.52), (15, -12, -8), 0.86, C4),
        ((1.24, 0.68, 0.24), (15, 12, -10), 0.72, C1),
        ((-0.56, 1.18, -0.04), (12, 32, 14), 0.54, C2),
        ((-1.18, 0.66, -0.22), (10, 42, 24), 0.42, C6),
        ((1.56, 1.24, -0.16), (13, 30, -16), 0.4, C5),
    ],
    "field7": [
        ((0.02, -0.16, 0.84), (17, -24, 4), 1.06, C0),
        ((0.82, 0.08, 0.58), (14, -10, -8), 0.84, C3),
        ((1.3, 0.58, 0.32), (14, 8, -10), 0.72, C1),
        ((1.58, 1.08, 0.04), (14, 24, -14), 0.54, C2),
        ((-0.62, 0.82, 0.08), (11, 34, 16), 0.54, C5),
        ((-1.28, 0.52, -0.2), (10, 44, 22), 0.42, C6),
        ((-0.2, 1.38, -0.28), (11, 30, 12), 0.38, C4),
    ],
}

PURPOSE_LAYOUTS: dict[str, list[TokenPose]] = {
    "default": [
        ((-0.88, -0.06, 0.34), (16, -26, 2), 0.7, C0),
        ((0.44, 0.5, 0.12), (13, 14, -10), 0.68, C1),
        ((-0.94, 0.8, 0.04), (14, 26, 12), 0.6, C2),
    ],
    "arc4": [
        ((-0.9, -0.08, 0.38), (16, -26, 2), 0.74, C0),
        ((-0.22, 0.08, 0.3), (14, -8, -4), 0.62, C4),
        ((0.5, 0.48, 0.12), (13, 14, -10), 0.58, C1),
        ((-0.92, 0.96, -0.12), (15, 32, 16), 0.46, C5),
    ],
    "stack5": [
        ((-0.98, -0.08, 0.4), (18, -24, 0), 0.8, C3),
        ((-0.42, 0.02, 0.32), (15, -10, -4), 0.7, C0),
        ((0.14, 0.28, 0.2), (13, 0, -8), 0.62, C4),
        ((0.62, 0.56, 0.08), (12, 16, -12), 0.56, C1),
        ((-1.16, 0.98, -0.08), (14, 32, 16), 0.44, C2),
    ],
    "spread6": [
        ((-1.0, -0.08, 0.4), (17, -24, 2), 0.74, C0),
        ((-0.42, -0.02, 0.34), (15, -14, -2), 0.66, C3),
        ((0.12, 0.14, 0.26), (14, -4, -8), 0.56, C4),
        ((0.56, 0.42, 0.14), (13, 12, -10), 0.5, C1),
        ((-0.86, 0.96, -0.08), (14, 30, 14), 0.44, C2),
        ((0.94, 0.92, -0.16), (13, 24, -16), 0.38, C5),
    ],
    "field7": [
        ((-1.06, -0.1, 0.42), (17, -24, 2), 0.76, C0),
        ((-0.56, -0.02, 0.36), (16, -14, -2), 0.68, C6),
        ((-0.08, 0.1, 0.28), (14, -4, -8), 0.6, C4),
        ((0.36, 0.28, 0.18), (13, 8, -10), 0.52, C1),
        ((0.76, 0.58, 0.04), (12, 20, -14), 0.46, C2),
        ((-0.86, 1.04, -0.1), (14, 34, 16), 0.4, C5),
        ((1.02, 0.98, -0.2), (12, 28, -18), 0.32, C3),
    ],
}

LAYOUT_NAMES = sorted(set(HERO_LAYOUTS) & set(PURPOSE_LAYOUTS))

STYFI_HERO_LAYOUTS: dict[str, list[TokenPose]] = {
    "tilt-left": [
        ((0.28, -0.02, 0.38), (24, -22, 12), 1.08, C0),
    ],
    "tilt-front": [
        ((0.34, 0.0, 0.34), (22, -6, 4), 1.06, C0),
    ],
    "tilt-right": [
        ((0.4, -0.02, 0.38), (24, 22, -12), 1.08, C0),
    ],
}

STYFI_PURPOSE_LAYOUTS: dict[str, list[TokenPose]] = {
    "tilt-left": [
        ((-0.14, 0.0, 0.22), (13, -26, 16), 0.82, C0),
    ],
    "tilt-front": [
        ((-0.08, 0.02, 0.2), (11, -8, 8), 0.8, C0),
    ],
    "tilt-right": [
        ((0.02, 0.02, 0.18), (13, 24, -16), 0.78, C0),
    ],
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(
        description="Render branded token Blender assets (hero/purpose/divider).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory for rendered PNGs. Defaults depend on --theme.",
    )
    parser.add_argument(
        "--logo-png",
        type=Path,
        default=None,
        help="Path to logo PNG with alpha. Overrides LOGO_PNG env var and defaults.",
    )
    parser.add_argument(
        "--logo-svg",
        type=Path,
        default=None,
        help="Path to logo SVG. When provided, the script imports vector artwork instead of a PNG decal.",
    )
    parser.add_argument(
        "--scenes",
        type=str,
        default="hero,purpose,divider",
        help="Comma-separated scene list from: hero,purpose,divider.",
    )
    parser.add_argument(
        "--layout",
        type=str,
        default="default",
        help=f"Single coin layout for hero/purpose scenes from: {', '.join(LAYOUT_NAMES)}.",
    )
    parser.add_argument(
        "--layouts",
        type=str,
        default=None,
        help="Optional comma-separated layout list. When set, renders one output per layout.",
    )
    parser.add_argument(
        "--theme",
        type=str,
        default="yearn",
        help="Color/output theme: yearn, styfi.",
    )
    parser.add_argument(
        "--basename",
        type=str,
        default=None,
        help="Base filename stem used for outputs. Defaults depend on --theme.",
    )
    return parser.parse_args(argv)


def resolve_logo_png(explicit_logo: Path | None, theme: str) -> Path:
    candidates: list[Path] = []
    if explicit_logo is not None:
        candidates.append(explicit_logo)
    env_logo = os.getenv("LOGO_PNG") or os.getenv("YEARN_LOGO_PNG")
    if env_logo:
        candidates.append(Path(env_logo))
    candidates.extend(DEFAULT_THEME_LOGO_PNG_CANDIDATES.get(theme, []))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    checked = ", ".join(str(path) for path in candidates) or "(none)"
    raise RuntimeError(
        "Missing logo PNG. Provide --logo-png or LOGO_PNG. "
        f"Checked: {checked}"
    )


def resolve_logo_svg(explicit_logo: Path | None, theme: str) -> Path:
    candidates: list[Path] = []
    if explicit_logo is not None:
        candidates.append(explicit_logo)
    env_logo = os.getenv("LOGO_SVG")
    if env_logo:
        candidates.append(Path(env_logo))
    candidates.extend(DEFAULT_THEME_LOGO_SVG_CANDIDATES.get(theme, []))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    checked = ", ".join(str(path) for path in candidates) or "(none)"
    raise RuntimeError(
        "Missing logo SVG. Provide --logo-svg or LOGO_SVG. "
        f"Checked: {checked}"
    )


def normalize_scene_selection(raw: str) -> list[str]:
    selected = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not selected:
        return list(SCENE_SIZES.keys())
    invalid = [item for item in selected if item not in SCENE_SIZES]
    if invalid:
        raise ValueError(f"Unknown scene(s): {', '.join(invalid)}")
    ordered_unique: list[str] = []
    for item in selected:
        if item not in ordered_unique:
            ordered_unique.append(item)
    return ordered_unique


def normalize_layout(raw: str) -> str:
    choice = raw.strip().lower()
    if choice not in LAYOUT_NAMES:
        raise ValueError(f"Unknown layout '{raw}'. Choose from: {', '.join(LAYOUT_NAMES)}")
    return choice


def available_layout_names(theme: str) -> list[str]:
    if theme == "styfi":
        return sorted(set(STYFI_HERO_LAYOUTS) & set(STYFI_PURPOSE_LAYOUTS))
    return LAYOUT_NAMES


def normalize_layouts(raw: str | None, fallback: str, theme: str) -> list[str]:
    available = available_layout_names(theme)
    if raw is None:
        choice = fallback.strip().lower()
        if choice not in available:
            choice = available[0]
        return [choice]
    choices = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not choices:
        return normalize_layouts(None, fallback, theme)
    invalid = [item for item in choices if item not in available]
    if invalid:
        raise ValueError(f"Unknown layout(s): {', '.join(invalid)}. Choose from: {', '.join(available)}")
    ordered_unique: list[str] = []
    for item in choices:
        if item not in ordered_unique:
            ordered_unique.append(item)
    return ordered_unique


def hero_layouts(theme: str) -> dict[str, list[TokenPose]]:
    return STYFI_HERO_LAYOUTS if theme == "styfi" else HERO_LAYOUTS


def purpose_layouts(theme: str) -> dict[str, list[TokenPose]]:
    return STYFI_PURPOSE_LAYOUTS if theme == "styfi" else PURPOSE_LAYOUTS


def normalize_theme(raw: str) -> str:
    choice = raw.strip().lower()
    if choice not in PALETTES:
        raise ValueError(f"Unknown theme '{raw}'. Choose from: {', '.join(PALETTES)}")
    return choice


def srgb_channel_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def srgb_color_to_linear(color: CoinColor) -> CoinColor:
    return (
        srgb_channel_to_linear(color[0]),
        srgb_channel_to_linear(color[1]),
        srgb_channel_to_linear(color[2]),
        color[3],
    )


def palette_color(theme: str, index: PaletteIndex) -> CoinColor:
    color = PALETTES[theme][index]
    if theme == "styfi":
        return srgb_color_to_linear(color)
    return color


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def setup_render(width: int, height: int, theme: str = "yearn") -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 0
    scene.render.film_transparent = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.eevee.use_gtao = True
    scene.eevee.taa_render_samples = 192 if theme == "styfi" else 128
    if hasattr(scene.eevee, "use_soft_shadows"):
        scene.eevee.use_soft_shadows = True
    if hasattr(scene.eevee, "use_ssr"):
        scene.eevee.use_ssr = True
    if hasattr(scene.eevee, "use_bloom"):
        scene.eevee.use_bloom = theme != "styfi"
    if hasattr(scene.eevee, "bloom_intensity"):
        scene.eevee.bloom_intensity = 0.0 if theme == "styfi" else 0.06
    if hasattr(scene.eevee, "bloom_radius"):
        scene.eevee.bloom_radius = 4.2 if theme == "styfi" else 6.0
    if hasattr(scene.eevee, "bloom_threshold"):
        scene.eevee.bloom_threshold = 1.0 if theme == "styfi" else 0.62
    scene.render.filter_size = 0.65 if theme == "styfi" else 1.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.42
    scene.view_settings.gamma = 1.0


def set_world_lighting() -> None:
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    world = scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs["Color"].default_value = (0.006, 0.016, 0.05, 1.0)
        bg.inputs["Strength"].default_value = 0.54


def ensure_socket_link(links, from_socket, to_socket) -> None:
    for link in list(to_socket.links):
        links.remove(link)
    links.new(from_socket, to_socket)


def set_input(node, socket_name: str, value: float) -> None:
    if socket_name in node.inputs:
        node.inputs[socket_name].default_value = value


def set_specular(bsdf, value: float) -> None:
    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = value
    elif "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = value


def set_coat(bsdf, value: float, roughness: float) -> None:
    if "Clearcoat" in bsdf.inputs:
        bsdf.inputs["Clearcoat"].default_value = value
    elif "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = value
    if "Clearcoat Roughness" in bsdf.inputs:
        bsdf.inputs["Clearcoat Roughness"].default_value = roughness
    elif "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = roughness


def rim_tint(color: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    return (
        min(1.0, max(0.0, color[0] * 0.52 + 0.03)),
        min(1.0, max(0.0, color[1] * 0.62 + 0.05)),
        min(1.0, max(0.0, color[2] * 0.94 + 0.08)),
        1.0,
    )


def apply_coin_surface(
    mat: bpy.types.Material,
    color: tuple[float, float, float, float],
    *,
    theme: str = "yearn",
) -> None:
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 0)

    tex_coord = nodes.get("CoinTexCoord")
    if tex_coord is None:
        tex_coord = nodes.new(type="ShaderNodeTexCoord")
        tex_coord.name = "CoinTexCoord"
    tex_coord.location = (-760, -40)

    noise = nodes.get("CoinNoise")
    if noise is None:
        noise = nodes.new(type="ShaderNodeTexNoise")
        noise.name = "CoinNoise"
    noise.location = (-560, -40)
    noise.inputs["Scale"].default_value = 74.0
    noise.inputs["Detail"].default_value = 14.5
    noise.inputs["Roughness"].default_value = 0.56
    noise.inputs["Distortion"].default_value = 0.11

    ramp = nodes.get("CoinNoiseRamp")
    if ramp is None:
        ramp = nodes.new(type="ShaderNodeValToRGB")
        ramp.name = "CoinNoiseRamp"
    ramp.location = (-360, -40)
    ramp.color_ramp.elements[0].position = 0.24
    ramp.color_ramp.elements[0].color = (0.54, 0.54, 0.54, 1.0)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)

    mix = nodes.get("CoinColorMix")
    if mix is None:
        mix = nodes.new(type="ShaderNodeMixRGB")
        mix.name = "CoinColorMix"
    mix.location = (-90, 120)
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 0.14 if theme == "styfi" else 0.23
    mix.inputs["Color1"].default_value = color

    bump = nodes.get("CoinBump")
    if bump is None:
        bump = nodes.new(type="ShaderNodeBump")
        bump.name = "CoinBump"
    bump.location = (-120, -180)
    bump.inputs["Strength"].default_value = 0.11
    bump.inputs["Distance"].default_value = 0.16

    ensure_socket_link(links, tex_coord.outputs["Object"], noise.inputs["Vector"])
    ensure_socket_link(links, noise.outputs["Fac"], ramp.inputs["Fac"])
    ensure_socket_link(links, ramp.outputs["Color"], mix.inputs["Color2"])
    ensure_socket_link(links, mix.outputs["Color"], bsdf.inputs["Base Color"])
    ensure_socket_link(links, noise.outputs["Fac"], bump.inputs["Height"])
    ensure_socket_link(links, bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Metallic"].default_value = 0.12 if theme == "styfi" else 0.16
    bsdf.inputs["Roughness"].default_value = 0.4 if theme == "styfi" else 0.31
    set_specular(bsdf, 0.36 if theme == "styfi" else 0.5)
    set_coat(bsdf, value=0.14 if theme == "styfi" else 0.34, roughness=0.34 if theme == "styfi" else 0.22)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.0 if theme == "styfi" else 0.1
    if "Emission Color" in bsdf.inputs:
        emission_scale = 1.0 if theme == "styfi" else 1.7
        bsdf.inputs["Emission Color"].default_value = (
            min(1.0, color[0] * emission_scale),
            min(1.0, color[1] * emission_scale),
            min(1.0, color[2] * (1.14 if theme == "styfi" else 1.82)),
            1.0,
        )
    elif "Emission" in bsdf.inputs:
        emission_scale = 1.0 if theme == "styfi" else 1.7
        bsdf.inputs["Emission"].default_value = (
            min(1.0, color[0] * emission_scale),
            min(1.0, color[1] * emission_scale),
            min(1.0, color[2] * (1.14 if theme == "styfi" else 1.82)),
            1.0,
        )


def apply_rim_surface(
    mat: bpy.types.Material,
    color: tuple[float, float, float, float],
    *,
    theme: str = "yearn",
) -> None:
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 0)

    tex_coord = nodes.get("RimTexCoord")
    if tex_coord is None:
        tex_coord = nodes.new(type="ShaderNodeTexCoord")
        tex_coord.name = "RimTexCoord"
    tex_coord.location = (-840, -40)

    mapping = nodes.get("RimMapping")
    if mapping is None:
        mapping = nodes.new(type="ShaderNodeMapping")
        mapping.name = "RimMapping"
    mapping.location = (-640, -40)
    if hasattr(mapping, "inputs") and "Scale" in mapping.inputs:
        mapping.inputs["Scale"].default_value[0] = 1.0
        mapping.inputs["Scale"].default_value[1] = 1.0
        mapping.inputs["Scale"].default_value[2] = 6.4

    wave = nodes.get("RimWave")
    if wave is None:
        wave = nodes.new(type="ShaderNodeTexWave")
        wave.name = "RimWave"
    wave.location = (-460, 42)
    set_input(wave, "Scale", 260.0)
    set_input(wave, "Distortion", 4.4)
    set_input(wave, "Detail", 5.8)
    set_input(wave, "Detail Scale", 1.2)

    noise = nodes.get("RimNoise")
    if noise is None:
        noise = nodes.new(type="ShaderNodeTexNoise")
        noise.name = "RimNoise"
    noise.location = (-460, -170)
    set_input(noise, "Scale", 56.0)
    set_input(noise, "Detail", 11.0)
    set_input(noise, "Roughness", 0.5)
    set_input(noise, "Distortion", 0.2)

    blend = nodes.get("RimBlend")
    if blend is None:
        blend = nodes.new(type="ShaderNodeMixRGB")
        blend.name = "RimBlend"
    blend.location = (-220, -40)
    blend.blend_type = "ADD"
    blend.inputs["Fac"].default_value = 0.56

    ramp = nodes.get("RimRamp")
    if ramp is None:
        ramp = nodes.new(type="ShaderNodeValToRGB")
        ramp.name = "RimRamp"
    ramp.location = (-12, -40)
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.34, 0.34, 0.34, 1.0)
    ramp.color_ramp.elements[1].position = 0.76
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)

    mix = nodes.get("RimColorMix")
    if mix is None:
        mix = nodes.new(type="ShaderNodeMixRGB")
        mix.name = "RimColorMix"
    mix.location = (170, 120)
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 0.2 if theme == "styfi" else 0.32
    mix.inputs["Color1"].default_value = rim_tint(color)

    bump = nodes.get("RimBump")
    if bump is None:
        bump = nodes.new(type="ShaderNodeBump")
        bump.name = "RimBump"
    bump.location = (164, -150)
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.08

    ensure_socket_link(links, tex_coord.outputs["Object"], mapping.inputs["Vector"])
    ensure_socket_link(links, mapping.outputs["Vector"], wave.inputs["Vector"])
    ensure_socket_link(links, mapping.outputs["Vector"], noise.inputs["Vector"])
    ensure_socket_link(links, wave.outputs["Fac"], blend.inputs["Color1"])
    ensure_socket_link(links, noise.outputs["Fac"], blend.inputs["Color2"])
    ensure_socket_link(links, blend.outputs["Color"], ramp.inputs["Fac"])
    ensure_socket_link(links, ramp.outputs["Color"], mix.inputs["Color2"])
    ensure_socket_link(links, mix.outputs["Color"], bsdf.inputs["Base Color"])
    ensure_socket_link(links, blend.outputs["Color"], bump.inputs["Height"])
    ensure_socket_link(links, bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Metallic"].default_value = 0.18 if theme == "styfi" else 0.26
    bsdf.inputs["Roughness"].default_value = 0.34 if theme == "styfi" else 0.22
    set_specular(bsdf, 0.4 if theme == "styfi" else 0.54)
    set_coat(bsdf, value=0.12 if theme == "styfi" else 0.2, roughness=0.32 if theme == "styfi" else 0.24)
    if "Anisotropic" in bsdf.inputs:
        bsdf.inputs["Anisotropic"].default_value = 0.35
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.0 if theme == "styfi" else 0.09
    tint = rim_tint(color)
    rim_emission = (
        min(1.0, tint[0] * 1.32),
        min(1.0, tint[1] * 1.32),
        min(1.0, tint[2] * 1.42),
        1.0,
    )
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = rim_emission
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = rim_emission


def make_coin_mat(
    name: str,
    color: tuple[float, float, float, float],
    *,
    theme: str = "yearn",
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    apply_coin_surface(mat, color, theme=theme)
    return mat


def make_rim_mat(
    name: str,
    color: tuple[float, float, float, float],
    *,
    theme: str = "yearn",
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    apply_rim_surface(mat, color, theme=theme)
    return mat


def set_mat_color(mat: bpy.types.Material, color: tuple[float, float, float, float], *, theme: str = "yearn") -> None:
    apply_coin_surface(mat, color, theme=theme)


def set_rim_color(mat: bpy.types.Material, color: tuple[float, float, float, float], *, theme: str = "yearn") -> None:
    apply_rim_surface(mat, color, theme=theme)


def get_logo_decal_mat(
    logo_png: Path,
    theme: str,
    name: str = "LogoDecal",
) -> bpy.types.Material:
    themed_name = f"{name}_{theme}"
    existing = bpy.data.materials.get(themed_name)
    if existing:
        return existing
    if not logo_png.exists():
        raise RuntimeError(f"Missing logo PNG at {logo_png}")

    mat = bpy.data.materials.new(name=themed_name)
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.shadow_method = "NONE"
    mat.use_backface_culling = False

    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    for node in list(nodes):
        nodes.remove(node)

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (360, 0)
    transparent = nodes.new(type="ShaderNodeBsdfTransparent")
    transparent.location = (-130, -160)
    emission = nodes.new(type="ShaderNodeEmission")
    emission.location = (-130, 80)
    emission.inputs["Strength"].default_value = 0.92 if theme == "styfi" else 0.68
    emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    mix = nodes.new(type="ShaderNodeMixShader")
    mix.location = (120, 0)
    tex = nodes.new(type="ShaderNodeTexImage")
    tex.location = (-360, 0)
    tex.image = bpy.data.images.load(str(logo_png), check_existing=True)
    tex.image.alpha_mode = "STRAIGHT"
    tex.interpolation = "Cubic"
    tex.extension = "CLIP"

    ensure_socket_link(links, tex.outputs["Alpha"], mix.inputs["Fac"])
    ensure_socket_link(links, transparent.outputs["BSDF"], mix.inputs[1])
    ensure_socket_link(links, emission.outputs["Emission"], mix.inputs[2])
    ensure_socket_link(links, mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def build_logo_plane_template(logo_png: Path, theme: str) -> list[bpy.types.Object]:
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0.0, 0.0, 0.0))
    logo = bpy.context.active_object
    logo.name = "LogoPlaneTemplate"

    image = bpy.data.images.load(str(logo_png), check_existing=True)
    width = max(image.size[0], 1)
    height = max(image.size[1], 1)
    aspect = width / height
    height_scale = 1.16 if theme == "styfi" else 1.0
    logo.scale = (aspect * height_scale, 1.0 * height_scale, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    logo_mat = get_logo_decal_mat(logo_png=logo_png, theme=theme)
    logo.data.materials.clear()
    logo.data.materials.append(logo_mat)

    logo.hide_render = True
    logo.hide_set(True)
    return [logo]


def object_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum


def curve_material_base_color(mat: bpy.types.Material) -> CoinColor:
    color = tuple(mat.diffuse_color[:4])
    if len(color) == 4:
        return color
    if len(color) == 3:
        return (color[0], color[1], color[2], 1.0)
    return (1.0, 1.0, 1.0, 1.0)


def apply_curve_fill_surface(mat: bpy.types.Material, color: CoinColor) -> None:
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    for node in list(nodes):
        nodes.remove(node)

    output = nodes.new(type="ShaderNodeOutputMaterial")
    output.location = (320, 0)
    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (60, 0)
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = 0.08
    bsdf.inputs["Roughness"].default_value = 0.22
    set_specular(bsdf, 0.58)
    set_coat(bsdf, value=0.22, roughness=0.16)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.08
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = color
    ensure_socket_link(links, bsdf.outputs["BSDF"], output.inputs["Surface"])


def build_logo_curve_templates(logo_svg: Path) -> list[bpy.types.Object]:
    existing_names = {obj.name for obj in bpy.data.objects}
    bpy.ops.import_curve.svg(filepath=str(logo_svg))
    imported = [obj for obj in bpy.context.scene.objects if obj.name not in existing_names]
    if not imported:
        raise RuntimeError(f"Failed to import logo SVG at {logo_svg}")

    mins: list[Vector] = []
    maxs: list[Vector] = []
    for obj in imported:
        if obj.type == "CURVE":
            obj.data.fill_mode = "BOTH"
            obj.data.extrude = 0.0014
            obj.data.resolution_u = 24
            obj.data.render_resolution_u = 24
        min_corner, max_corner = object_bounds(obj)
        mins.append(min_corner)
        maxs.append(max_corner)
        for mat in obj.data.materials:
            apply_curve_fill_surface(mat, curve_material_base_color(mat))

    minimum = Vector((min(v.x for v in mins), min(v.y for v in mins), min(v.z for v in mins)))
    maximum = Vector((max(v.x for v in maxs), max(v.y for v in maxs), max(v.z for v in maxs)))
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    max_dim = max(size.x, size.y, 0.001)
    scale_factor = 1.62 / max_dim

    for obj in imported:
        obj.location = (obj.location - center) * scale_factor
        obj.scale = tuple(component * scale_factor for component in obj.scale)
        obj.hide_render = True
        obj.hide_set(True)

    return imported


def build_token_prefab(logo_templates: list[bpy.types.Object], theme: str) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=220, radius=1.0, depth=0.29, location=(0.0, 0.0, 0.0))
    token = bpy.context.active_object
    token.name = "TokenPrefab"

    bevel = token.modifiers.new(name="Bevel", type="BEVEL")
    bevel.width = 0.024
    bevel.segments = 8
    bevel.limit_method = "NONE"

    bpy.ops.object.shade_smooth()
    token.data.use_auto_smooth = True
    token.data.auto_smooth_angle = math.radians(40)

    base_mat = make_coin_mat("TokenBaseMat", palette_color(theme, C0), theme=theme)
    rim_mat = make_rim_mat("TokenRimMat", palette_color(theme, C0), theme=theme)
    token.data.materials.append(base_mat)
    token.data.materials.append(rim_mat)
    for poly in token.data.polygons:
        poly.material_index = 1 if abs(poly.normal.z) < 0.3 else 0

    for idx, logo_template in enumerate(logo_templates):
        logo = logo_template.copy()
        if getattr(logo_template, "data", None) is not None:
            logo.data = logo_template.data.copy()
        bpy.context.collection.objects.link(logo)
        logo.name = f"TokenPrefabLogo{idx}"
        logo.parent = token
        logo.location = (
            logo_template.location.x,
            logo_template.location.y,
            0.156 + logo_template.location.z,
        )
        logo.rotation_euler = (0.0, 0.0, 0.0)
        logo.scale = tuple(component for component in logo_template.scale)
        logo.hide_render = True
        logo.hide_set(True)

    token.hide_render = True
    token.hide_set(True)
    return token


def instance_token(
    *,
    prefab: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    rotation_deg: tuple[float, float, float],
    scale: float,
    color: tuple[float, float, float, float],
    theme: str,
) -> bpy.types.Object:
    token = prefab.copy()
    token.data = prefab.data.copy()
    bpy.context.collection.objects.link(token)

    token.name = name
    token.location = location
    token.rotation_euler = tuple(math.radians(v) for v in rotation_deg)
    token.scale = (scale, scale, scale)

    if len(token.data.materials) >= 2:
        face_mat = token.data.materials[0].copy()
        rim_mat = token.data.materials[1].copy()
    else:
        face_mat = make_coin_mat(f"{name}Mat", color, theme=theme)
        rim_mat = make_rim_mat(f"{name}RimMat", color, theme=theme)
    set_mat_color(face_mat, color, theme=theme)
    set_rim_color(rim_mat, color, theme=theme)
    token.data.materials.clear()
    token.data.materials.append(face_mat)
    token.data.materials.append(rim_mat)
    for poly in token.data.polygons:
        poly.material_index = 1 if abs(poly.normal.z) < 0.3 else 0

    token.hide_render = False
    token.hide_set(False)

    for child in prefab.children:
        child_copy = child.copy()
        child_copy.data = child.data.copy()
        bpy.context.collection.objects.link(child_copy)
        child_copy.name = f"{name}_{child.name}"
        child_copy.parent = token
        child_copy.location = child.location.copy()
        child_copy.rotation_euler = child.rotation_euler.copy()
        child_copy.scale = child.scale.copy()
        child_copy.hide_render = False
        child_copy.hide_set(False)

    return token


def add_lights(theme: str) -> None:
    set_world_lighting()

    bpy.ops.object.light_add(type="AREA", location=(1.4, -3.0, 4.2))
    key = bpy.context.active_object
    key.data.energy = 320 if theme == "styfi" else 320
    key.data.size = 3.4
    key.data.color = (0.95, 0.98, 1.0) if theme == "styfi" else (0.95, 0.98, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(-3.4, 2.5, 2.7))
    fill = bpy.context.active_object
    fill.data.energy = 98 if theme == "styfi" else 98
    fill.data.size = 2.8
    fill.data.color = (0.7, 0.82, 1.0) if theme == "styfi" else (0.7, 0.82, 1.0)

    bpy.ops.object.light_add(type="POINT", location=(0.1, -1.6, 2.6))
    rim = bpy.context.active_object
    rim.data.energy = 84 if theme == "styfi" else 84
    rim.data.color = (0.88, 0.94, 1.0) if theme == "styfi" else (0.88, 0.94, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(0.0, 0.2, 4.8))
    top = bpy.context.active_object
    top.data.energy = 46 if theme == "styfi" else 46
    top.data.size = 2.2
    top.data.color = (0.78, 0.88, 1.0) if theme == "styfi" else (0.78, 0.88, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(3.3, 2.1, 1.85))
    side = bpy.context.active_object
    side.data.energy = 72 if theme == "styfi" else 72
    side.data.size = 2.1
    side.data.color = (0.7, 0.81, 1.0) if theme == "styfi" else (0.7, 0.81, 1.0)


def set_camera(
    loc: tuple[float, float, float],
    rot_deg: tuple[float, float, float],
    lens: float,
) -> bpy.types.Object:
    bpy.ops.object.camera_add(location=loc, rotation=tuple(math.radians(v) for v in rot_deg))
    cam = bpy.context.active_object
    bpy.context.scene.camera = cam
    cam.data.lens = lens
    return cam


def render(path: Path, width: int, height: int, theme: str = "yearn") -> None:
    setup_render(width, height, theme=theme)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def apply_token_layout(prefab: bpy.types.Object, prefix: str, poses: list[TokenPose], theme: str) -> None:
    for idx, (location, rotation_deg, scale, color_idx) in enumerate(poses):
        instance_token(
            prefab=prefab,
            name=f"{prefix}{idx + 1}",
            location=location,
            rotation_deg=rotation_deg,
            scale=scale,
            color=palette_color(theme, color_idx),
            theme=theme,
        )


def hero_scene(prefab: bpy.types.Object, layout: str, theme: str) -> None:
    add_lights(theme)
    if theme == "styfi":
        set_camera((0.0, -7.2, 2.1), (77, 0, 0), 72)
    else:
        set_camera((0.0, -7.2, 2.1), (77, 0, 0), 72)
    apply_token_layout(prefab, "Hero", hero_layouts(theme)[layout], theme)


def purpose_scene(prefab: bpy.types.Object, layout: str, theme: str) -> None:
    add_lights(theme)
    set_camera((0.0, -6.1, 1.82), (76, 0, 0), 70)
    apply_token_layout(prefab, "Purpose", purpose_layouts(theme)[layout], theme)


def divider_scene(prefab: bpy.types.Object, theme: str) -> None:
    add_lights(theme)
    cam = set_camera((0.0, -6.8, 2.2), (72, 0, 0), 70)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 7.8

    instance_token(
        prefab=prefab,
        name="DividerA",
        location=(-2.4, 0.0, -0.08),
        rotation_deg=(22, -14, -14),
        scale=0.37,
        color=palette_color(theme, C1),
        theme=theme,
    )
    instance_token(
        prefab=prefab,
        name="DividerB",
        location=(0.0, 0.02, -0.08),
        rotation_deg=(16, 10, 0),
        scale=0.38,
        color=palette_color(theme, C0),
        theme=theme,
    )
    instance_token(
        prefab=prefab,
        name="DividerC",
        location=(2.4, 0.0, -0.08),
        rotation_deg=(22, 14, 14),
        scale=0.37,
        color=palette_color(theme, C1),
        theme=theme,
    )


def output_name(kind: str, basename: str, layout: str, layout_count: int) -> str:
    suffix = f"-{layout}" if kind != "divider" and layout_count > 1 else ""
    return f"{kind}-{basename}{suffix}.png"


def render_scene(
    kind: str,
    out_dir: Path,
    logo_png: Path | None,
    logo_svg: Path | None,
    layout: str,
    theme: str,
    basename: str,
    layout_count: int,
) -> None:
    size = SCENE_SIZES[kind]
    clear_scene()
    if logo_svg is not None:
        logo_templates = build_logo_curve_templates(logo_svg)
    elif logo_png is not None:
        logo_templates = build_logo_plane_template(logo_png, theme=theme)
    else:
        raise RuntimeError("Either logo_png or logo_svg must be provided.")
    prefab = build_token_prefab(logo_templates, theme=theme)

    if kind == "hero":
        hero_scene(prefab, layout=layout, theme=theme)
    elif kind == "purpose":
        purpose_scene(prefab, layout=layout, theme=theme)
    elif kind == "divider":
        divider_scene(prefab, theme=theme)
    else:
        raise ValueError(kind)

    output_path = out_dir / output_name(kind, basename=basename, layout=layout, layout_count=layout_count)
    print(f"Rendering {kind}: {output_path} ({size[0]}x{size[1]})")
    render(output_path, size[0], size[1], theme=theme)


def main() -> None:
    args = parse_args()
    theme = normalize_theme(args.theme)
    layout_choices = normalize_layouts(args.layouts, args.layout, theme)
    basename = args.basename or str(THEME_DEFAULTS[theme]["basename"])
    output_dir: Path = args.output_dir or Path(THEME_DEFAULTS[theme]["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)
    scenes = normalize_scene_selection(args.scenes)
    logo_png: Path | None = None
    logo_svg: Path | None = None
    if args.logo_svg is not None:
        logo_svg = resolve_logo_svg(args.logo_svg, theme)
    else:
        try:
            logo_png = resolve_logo_png(args.logo_png, theme)
        except RuntimeError:
            logo_svg = resolve_logo_svg(args.logo_svg, theme)

    print(f"Output dir: {output_dir}")
    print(f"Theme:      {theme}")
    if logo_svg is not None:
        print(f"Logo SVG:   {logo_svg}")
    if logo_png is not None:
        print(f"Logo PNG:   {logo_png}")
    print(f"Scenes:     {', '.join(scenes)}")
    print(f"Layouts:    {', '.join(layout_choices)}")

    for layout in layout_choices:
        for scene_name in scenes:
            render_scene(
                scene_name,
                out_dir=output_dir,
                logo_png=logo_png,
                logo_svg=logo_svg,
                layout=layout,
                theme=theme,
                basename=basename,
                layout_count=len(layout_choices),
            )

    print("Render complete.")


if __name__ == "__main__":
    main()
