from __future__ import annotations

import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "web/public/home-assets-yearn-blender"
LOGO_PNG = Path("/tmp/yearn-press-kit/public/downloads/YEARN_SYMBOL_WHITE_RGB.png")


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
    scene.eevee.taa_render_samples = 64
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.7
    scene.view_settings.gamma = 1.0


def make_coin_mat(
    name: str,
    color: tuple[float, float, float, float],
    metallic: float = 0.02,
    roughness: float = 0.58,
    specular: float = 0.2,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    assert bsdf
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Specular" in bsdf.inputs:
        bsdf.inputs["Specular"].default_value = specular
    elif "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    return mat


def set_mat_color(mat: bpy.types.Material, color: tuple[float, float, float, float]) -> None:
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color


def get_logo_decal_mat(name: str = "YearnLogoDecal") -> bpy.types.Material:
    existing = bpy.data.materials.get(name)
    if existing:
        return existing

    if not LOGO_PNG.exists():
        raise RuntimeError(f"Missing logo PNG at {LOGO_PNG}")

    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    mat.blend_method = "CLIP"
    mat.alpha_threshold = 0.4
    mat.shadow_method = "NONE"

    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    for n in list(nodes):
        nodes.remove(n)

    output = nodes.new(type="ShaderNodeOutputMaterial")
    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    tex = nodes.new(type="ShaderNodeTexImage")

    tex.image = bpy.data.images.load(str(LOGO_PNG), check_existing=True)
    tex.image.alpha_mode = "STRAIGHT"
    tex.interpolation = "Linear"

    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])

    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.22
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.15
    if "Emission Color" in bsdf.inputs:
        links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    elif "Emission" in bsdf.inputs:
        links.new(tex.outputs["Color"], bsdf.inputs["Emission"])

    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat


def build_logo_plane_template() -> bpy.types.Object:
    if not LOGO_PNG.exists():
        raise RuntimeError(f"Missing logo PNG at {LOGO_PNG}")

    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0.0, 0.0, 0.0))
    logo = bpy.context.active_object
    logo.name = "YearnLogoPlaneTemplate"

    # Yearn symbol aspect ratio (roughly 308 x 361)
    logo.scale = (0.853, 1.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    logo_mat = get_logo_decal_mat()
    logo.data.materials.clear()
    logo.data.materials.append(logo_mat)

    logo.hide_render = True
    logo.hide_set(True)
    return logo


def build_token_prefab(logo_template: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=160, radius=1.0, depth=0.32, location=(0.0, 0.0, 0.0))
    token = bpy.context.active_object
    token.name = "TokenPrefab"

    bevel = token.modifiers.new(name="Bevel", type="BEVEL")
    bevel.width = 0.028
    bevel.segments = 6
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
    logo.location = (0.0, 0.0, 0.168)
    logo.rotation_euler = (0.0, 0.0, 0.0)
    logo.scale = (0.82, 0.82, 0.82)
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
    bpy.ops.object.light_add(type="AREA", location=(1.0, -2.6, 3.9))
    key = bpy.context.active_object
    key.data.energy = 185
    key.data.size = 3.2

    bpy.ops.object.light_add(type="AREA", location=(-3.0, 2.2, 2.8))
    fill = bpy.context.active_object
    fill.data.energy = 38
    fill.data.size = 2.5

    bpy.ops.object.light_add(type="POINT", location=(0.0, -0.3, 2.3))
    rim = bpy.context.active_object
    rim.data.energy = 12


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


def render_scene(kind: str, out_name: str, size: tuple[int, int]) -> None:
    clear_scene()
    logo_template = build_logo_plane_template()
    prefab = build_token_prefab(logo_template)

    if kind == "hero":
        hero_scene(prefab)
    elif kind == "purpose":
        purpose_scene(prefab)
    elif kind == "divider":
        divider_scene(prefab)
    else:
        raise ValueError(kind)

    render(OUT_DIR / out_name, size[0], size[1])


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    render_scene("hero", "hero-yearn-blender-coins.png", (1400, 820))
    render_scene("purpose", "purpose-yearn-blender-coins.png", (1000, 420))
    render_scene("divider", "divider-yearn-blender-coins.png", (1600, 220))


if __name__ == "__main__":
    main()
