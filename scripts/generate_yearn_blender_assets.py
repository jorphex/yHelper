from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "web/public/home-assets-yearn-blender"
DEFAULT_LOGO_CANDIDATES = [
    ROOT / "web/public/yearn-symbol-white-rgb.png",
    Path("/tmp/yearn-press-kit/public/downloads/YEARN_SYMBOL_WHITE_RGB.png"),
]
SCENE_OUTPUTS: dict[str, tuple[str, tuple[int, int]]] = {
    "hero": ("hero-yearn-blender-coins.png", (1400, 820)),
    "purpose": ("purpose-yearn-blender-coins.png", (1000, 420)),
    "divider": ("divider-yearn-blender-coins.png", (1600, 220)),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(
        description="Render Yearn home page Blender assets (hero/purpose/divider).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Output directory for rendered PNGs (default: {DEFAULT_OUT_DIR}).",
    )
    parser.add_argument(
        "--logo-png",
        type=Path,
        default=None,
        help="Path to Yearn logo PNG with alpha. Overrides YEARN_LOGO_PNG env var and defaults.",
    )
    parser.add_argument(
        "--scenes",
        type=str,
        default="hero,purpose,divider",
        help="Comma-separated scene list from: hero,purpose,divider.",
    )
    return parser.parse_args(argv)


def resolve_logo_png(explicit_logo: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit_logo is not None:
        candidates.append(explicit_logo)
    env_logo = os.getenv("YEARN_LOGO_PNG")
    if env_logo:
        candidates.append(Path(env_logo))
    candidates.extend(DEFAULT_LOGO_CANDIDATES)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    checked = ", ".join(str(path) for path in candidates) or "(none)"
    raise RuntimeError(
        "Missing Yearn logo PNG. Provide --logo-png or YEARN_LOGO_PNG. "
        f"Checked: {checked}"
    )


def normalize_scene_selection(raw: str) -> list[str]:
    selected = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not selected:
        return list(SCENE_OUTPUTS.keys())
    invalid = [item for item in selected if item not in SCENE_OUTPUTS]
    if invalid:
        raise ValueError(f"Unknown scene(s): {', '.join(invalid)}")
    ordered_unique: list[str] = []
    for item in selected:
        if item not in ordered_unique:
            ordered_unique.append(item)
    return ordered_unique


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def setup_render(width: int, height: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.eevee.use_gtao = True
    scene.eevee.taa_render_samples = 96
    if hasattr(scene.eevee, "use_soft_shadows"):
        scene.eevee.use_soft_shadows = True
    if hasattr(scene.eevee, "use_ssr"):
        scene.eevee.use_ssr = True
    if hasattr(scene.eevee, "use_bloom"):
        scene.eevee.use_bloom = True
    if hasattr(scene.eevee, "bloom_intensity"):
        scene.eevee.bloom_intensity = 0.04
    if hasattr(scene.eevee, "bloom_radius"):
        scene.eevee.bloom_radius = 6.0
    if hasattr(scene.eevee, "bloom_threshold"):
        scene.eevee.bloom_threshold = 0.68
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.58
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
        bg.inputs["Strength"].default_value = 0.44


def ensure_socket_link(links, from_socket, to_socket) -> None:
    for link in list(to_socket.links):
        links.remove(link)
    links.new(from_socket, to_socket)


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


def apply_coin_surface(mat: bpy.types.Material, color: tuple[float, float, float, float]) -> None:
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
    noise.inputs["Scale"].default_value = 62.0
    noise.inputs["Detail"].default_value = 13.5
    noise.inputs["Roughness"].default_value = 0.54
    noise.inputs["Distortion"].default_value = 0.08

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
    mix.inputs["Fac"].default_value = 0.26
    mix.inputs["Color1"].default_value = color

    bump = nodes.get("CoinBump")
    if bump is None:
        bump = nodes.new(type="ShaderNodeBump")
        bump.name = "CoinBump"
    bump.location = (-120, -180)
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.18

    ensure_socket_link(links, tex_coord.outputs["Object"], noise.inputs["Vector"])
    ensure_socket_link(links, noise.outputs["Fac"], ramp.inputs["Fac"])
    ensure_socket_link(links, ramp.outputs["Color"], mix.inputs["Color2"])
    ensure_socket_link(links, mix.outputs["Color"], bsdf.inputs["Base Color"])
    ensure_socket_link(links, noise.outputs["Fac"], bump.inputs["Height"])
    ensure_socket_link(links, bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Metallic"].default_value = 0.08
    bsdf.inputs["Roughness"].default_value = 0.42
    set_specular(bsdf, 0.4)
    set_coat(bsdf, value=0.22, roughness=0.28)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.06
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = (
            min(1.0, color[0] * 1.7),
            min(1.0, color[1] * 1.7),
            min(1.0, color[2] * 1.7),
            1.0,
        )
    elif "Emission" in bsdf.inputs:
        bsdf.inputs["Emission"].default_value = (
            min(1.0, color[0] * 1.7),
            min(1.0, color[1] * 1.7),
            min(1.0, color[2] * 1.7),
            1.0,
        )


def make_coin_mat(
    name: str,
    color: tuple[float, float, float, float],
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    apply_coin_surface(mat, color)
    return mat


def set_mat_color(mat: bpy.types.Material, color: tuple[float, float, float, float]) -> None:
    apply_coin_surface(mat, color)


def get_logo_decal_mat(logo_png: Path, name: str = "YearnLogoDecal") -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    if not logo_png.exists():
        raise RuntimeError(f"Missing logo PNG at {logo_png}")

    mat = bpy.data.materials.new(name=name)
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
    emission.inputs["Strength"].default_value = 0.68
    mix = nodes.new(type="ShaderNodeMixShader")
    mix.location = (120, 0)
    tex = nodes.new(type="ShaderNodeTexImage")
    tex.location = (-360, 0)
    tex.image = bpy.data.images.load(str(logo_png), check_existing=True)
    tex.image.alpha_mode = "STRAIGHT"
    tex.interpolation = "Cubic"
    tex.extension = "CLIP"

    ensure_socket_link(links, tex.outputs["Color"], emission.inputs["Color"])
    ensure_socket_link(links, tex.outputs["Alpha"], mix.inputs["Fac"])
    ensure_socket_link(links, transparent.outputs["BSDF"], mix.inputs[1])
    ensure_socket_link(links, emission.outputs["Emission"], mix.inputs[2])
    ensure_socket_link(links, mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def build_logo_plane_template(logo_png: Path) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0.0, 0.0, 0.0))
    logo = bpy.context.active_object
    logo.name = "YearnLogoPlaneTemplate"

    # Yearn symbol aspect ratio (roughly 308 x 361)
    logo.scale = (0.853, 1.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    logo_mat = get_logo_decal_mat(logo_png=logo_png)
    logo.data.materials.clear()
    logo.data.materials.append(logo_mat)

    logo.hide_render = True
    logo.hide_set(True)
    return logo


def build_token_prefab(logo_template: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=180, radius=1.0, depth=0.29, location=(0.0, 0.0, 0.0))
    token = bpy.context.active_object
    token.name = "TokenPrefab"

    bevel = token.modifiers.new(name="Bevel", type="BEVEL")
    bevel.width = 0.022
    bevel.segments = 7
    bevel.limit_method = "NONE"

    bpy.ops.object.shade_smooth()
    token.data.use_auto_smooth = True
    token.data.auto_smooth_angle = math.radians(40)

    base_mat = make_coin_mat("TokenBaseMat", (0.006, 0.12, 0.62, 1.0))
    token.data.materials.append(base_mat)

    logo = logo_template.copy()
    logo.data = logo_template.data.copy()
    bpy.context.collection.objects.link(logo)
    logo.name = "TokenPrefabLogo"
    logo.parent = token
    logo.location = (0.0, 0.0, 0.154)
    logo.rotation_euler = (0.0, 0.0, 0.0)
    logo.scale = (0.92, 0.92, 0.92)
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
) -> bpy.types.Object:
    token = prefab.copy()
    token.data = prefab.data.copy()
    bpy.context.collection.objects.link(token)

    token.name = name
    token.location = location
    token.rotation_euler = tuple(math.radians(v) for v in rotation_deg)
    token.scale = (scale, scale, scale)

    if token.data.materials:
        mat = token.data.materials[0].copy()
    else:
        mat = make_coin_mat(f"{name}Mat", color)
    set_mat_color(mat, color)
    token.data.materials.clear()
    token.data.materials.append(mat)

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


def add_lights() -> None:
    set_world_lighting()

    bpy.ops.object.light_add(type="AREA", location=(1.4, -3.0, 4.2))
    key = bpy.context.active_object
    key.data.energy = 260
    key.data.size = 3.4
    key.data.color = (0.95, 0.98, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(-3.4, 2.5, 2.7))
    fill = bpy.context.active_object
    fill.data.energy = 70
    fill.data.size = 2.8
    fill.data.color = (0.66, 0.78, 1.0)

    bpy.ops.object.light_add(type="POINT", location=(0.1, -1.6, 2.6))
    rim = bpy.context.active_object
    rim.data.energy = 46
    rim.data.color = (0.82, 0.9, 1.0)

    bpy.ops.object.light_add(type="AREA", location=(0.0, 0.2, 4.8))
    top = bpy.context.active_object
    top.data.energy = 26
    top.data.size = 2.2
    top.data.color = (0.74, 0.84, 1.0)


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


def render(path: Path, width: int, height: int) -> None:
    setup_render(width, height)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def hero_scene(prefab: bpy.types.Object) -> None:
    add_lights()
    set_camera((0.0, -7.2, 2.1), (77, 0, 0), 72)

    instance_token(
        prefab=prefab,
        name="HeroA",
        location=(0.7, -0.08, 0.42),
        rotation_deg=(16, -30, 6),
        scale=1.02,
        color=(0.006, 0.12, 0.62, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="HeroB",
        location=(1.95, 0.8, -0.2),
        rotation_deg=(14, 18, -10),
        scale=0.82,
        color=(0.005, 0.095, 0.5, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="HeroC",
        location=(-0.12, 1.0, -0.4),
        rotation_deg=(12, 34, 14),
        scale=0.7,
        color=(0.003, 0.07, 0.38, 1.0),
    )


def purpose_scene(prefab: bpy.types.Object) -> None:
    add_lights()
    set_camera((0.0, -6.1, 1.82), (76, 0, 0), 70)

    instance_token(
        prefab=prefab,
        name="PurposeA",
        location=(-0.94, -0.14, 0.24),
        rotation_deg=(16, -26, 2),
        scale=0.68,
        color=(0.006, 0.12, 0.62, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="PurposeB",
        location=(0.56, 0.56, -0.12),
        rotation_deg=(13, 14, -10),
        scale=0.68,
        color=(0.005, 0.095, 0.5, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="PurposeC",
        location=(-0.98, 0.86, -0.34),
        rotation_deg=(14, 26, 12),
        scale=0.62,
        color=(0.003, 0.07, 0.38, 1.0),
    )


def divider_scene(prefab: bpy.types.Object) -> None:
    add_lights()
    cam = set_camera((0.0, -6.8, 2.2), (72, 0, 0), 70)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 7.2

    instance_token(
        prefab=prefab,
        name="DividerA",
        location=(-2.4, 0.0, -0.22),
        rotation_deg=(22, -14, -14),
        scale=0.42,
        color=(0.005, 0.095, 0.5, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="DividerB",
        location=(0.0, 0.02, -0.24),
        rotation_deg=(16, 10, 0),
        scale=0.43,
        color=(0.0055, 0.102, 0.53, 1.0),
    )
    instance_token(
        prefab=prefab,
        name="DividerC",
        location=(2.4, 0.0, -0.22),
        rotation_deg=(22, 14, 14),
        scale=0.42,
        color=(0.005, 0.095, 0.5, 1.0),
    )


def render_scene(kind: str, out_dir: Path, logo_png: Path) -> None:
    out_name, size = SCENE_OUTPUTS[kind]
    clear_scene()
    logo_template = build_logo_plane_template(logo_png)
    prefab = build_token_prefab(logo_template)

    if kind == "hero":
        hero_scene(prefab)
    elif kind == "purpose":
        purpose_scene(prefab)
    elif kind == "divider":
        divider_scene(prefab)
    else:
        raise ValueError(kind)

    output_path = out_dir / out_name
    print(f"Rendering {kind}: {output_path} ({size[0]}x{size[1]})")
    render(output_path, size[0], size[1])


def main() -> None:
    args = parse_args()
    logo_png = resolve_logo_png(args.logo_png)
    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    scenes = normalize_scene_selection(args.scenes)

    print(f"Output dir: {output_dir}")
    print(f"Logo PNG:   {logo_png}")
    print(f"Scenes:     {', '.join(scenes)}")

    for scene_name in scenes:
        render_scene(scene_name, out_dir=output_dir, logo_png=logo_png)

    print("Render complete.")


if __name__ == "__main__":
    main()
