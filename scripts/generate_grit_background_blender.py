from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "web/public/bg/grit-abstract-v1.jpg"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Generate a gritty abstract background texture with Blender.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output path for generated JPEG (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument("--width", type=int, default=3200, help="Render width in pixels.")
    parser.add_argument("--height", type=int, default=2000, help="Render height in pixels.")
    parser.add_argument("--seed", type=float, default=23.17, help="Procedural seed offset.")
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def setup_render(width: int, height: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 96
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    if hasattr(scene.eevee, "taa_render_samples"):
        scene.eevee.taa_render_samples = 96
    if hasattr(scene.eevee, "use_gtao"):
        scene.eevee.use_gtao = False

    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.28
    scene.view_settings.gamma = 1.0


def set_world() -> None:
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg is not None:
        bg.inputs[0].default_value = (0.01, 0.02, 0.05, 1.0)
        bg.inputs[1].default_value = 1.0


def set_input(node: bpy.types.Node, name: str, value: float | tuple[float, ...]) -> None:
    sock = node.inputs.get(name)
    if sock is None:
        return
    sock.default_value = value


def set_simple_ramp(
    ramp_node: bpy.types.ShaderNodeValToRGB,
    left_pos: float,
    left: tuple[float, float, float, float],
    right_pos: float,
    right: tuple[float, float, float, float],
    interpolation: str = "LINEAR",
) -> None:
    ramp = ramp_node.color_ramp
    ramp.interpolation = interpolation
    els = ramp.elements
    while len(els) > 2:
        els.remove(els[-1])
    els[0].position = left_pos
    els[0].color = left
    els[1].position = right_pos
    els[1].color = right


def make_material(seed: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name="GritAbstract")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out = nodes.new(type="ShaderNodeOutputMaterial")
    out.location = (1860, 60)

    emission = nodes.new(type="ShaderNodeEmission")
    emission.location = (1650, 60)
    emission.inputs[1].default_value = 1.0

    tex = nodes.new(type="ShaderNodeTexCoord")
    tex.location = (-1460, 80)

    map_a = nodes.new(type="ShaderNodeMapping")
    map_a.location = (-1260, 80)
    map_a.inputs[1].default_value = (seed * 0.09, -seed * 0.06, 0.0)
    map_a.inputs[3].default_value = (0.92, 0.84, 1.0)

    map_b = nodes.new(type="ShaderNodeMapping")
    map_b.location = (-1260, -150)
    map_b.inputs[1].default_value = (-seed * 0.08, seed * 0.1, 0.0)
    map_b.inputs[2].default_value = (0.0, 0.0, 0.21)
    map_b.inputs[3].default_value = (1.34, 1.14, 1.0)

    map_c = nodes.new(type="ShaderNodeMapping")
    map_c.location = (-1260, -380)
    map_c.inputs[1].default_value = (seed * 0.12, -seed * 0.1, 0.0)
    map_c.inputs[2].default_value = (0.0, 0.0, -0.31)
    map_c.inputs[3].default_value = (2.36, 2.04, 1.0)

    noise_base = nodes.new(type="ShaderNodeTexNoise")
    noise_base.location = (-1040, 80)
    noise_base.noise_dimensions = "2D"
    set_input(noise_base, "Scale", 1.28)
    set_input(noise_base, "Detail", 2.4)
    set_input(noise_base, "Roughness", 0.52)
    set_input(noise_base, "Distortion", 0.04)

    voronoi_big = nodes.new(type="ShaderNodeTexVoronoi")
    voronoi_big.location = (-1040, -150)
    voronoi_big.voronoi_dimensions = "2D"
    voronoi_big.feature = "SMOOTH_F1"
    set_input(voronoi_big, "Scale", 1.42)
    set_input(voronoi_big, "Randomness", 0.9)

    voronoi_mid = nodes.new(type="ShaderNodeTexVoronoi")
    voronoi_mid.location = (-1040, -380)
    voronoi_mid.voronoi_dimensions = "2D"
    voronoi_mid.feature = "SMOOTH_F1"
    set_input(voronoi_mid, "Scale", 2.8)
    set_input(voronoi_mid, "Randomness", 0.74)

    noise_patch = nodes.new(type="ShaderNodeTexNoise")
    noise_patch.location = (-1040, -610)
    noise_patch.noise_dimensions = "2D"
    set_input(noise_patch, "Scale", 6.2)
    set_input(noise_patch, "Detail", 2.2)
    set_input(noise_patch, "Roughness", 0.54)
    set_input(noise_patch, "Distortion", 0.03)

    g_base = nodes.new(type="ShaderNodeMath")
    g_base.location = (-820, 80)
    g_base.operation = "MULTIPLY"
    g_base.inputs[1].default_value = 0.44

    g_big = nodes.new(type="ShaderNodeMath")
    g_big.location = (-820, -150)
    g_big.operation = "MULTIPLY"
    g_big.inputs[1].default_value = 0.3

    g_mid = nodes.new(type="ShaderNodeMath")
    g_mid.location = (-820, -380)
    g_mid.operation = "MULTIPLY"
    g_mid.inputs[1].default_value = 0.2

    g_patch = nodes.new(type="ShaderNodeMath")
    g_patch.location = (-820, -610)
    g_patch.operation = "MULTIPLY"
    g_patch.inputs[1].default_value = 0.16

    add_a = nodes.new(type="ShaderNodeMath")
    add_a.location = (-600, -30)
    add_a.operation = "ADD"

    add_b = nodes.new(type="ShaderNodeMath")
    add_b.location = (-380, -130)
    add_b.operation = "ADD"

    add_c = nodes.new(type="ShaderNodeMath")
    add_c.location = (-160, -230)
    add_c.operation = "ADD"

    norm = nodes.new(type="ShaderNodeMapRange")
    norm.location = (60, -230)
    norm.clamp = True
    norm.inputs[1].default_value = 0.06
    norm.inputs[2].default_value = 1.02
    norm.inputs[3].default_value = 0.0
    norm.inputs[4].default_value = 1.0

    palette = nodes.new(type="ShaderNodeValToRGB")
    palette.location = (280, -230)
    palette.color_ramp.interpolation = "B_SPLINE"
    stops = palette.color_ramp.elements
    while len(stops) > 2:
        stops.remove(stops[-1])
    stops[0].position = 0.0
    stops[0].color = (0.012, 0.026, 0.092, 1.0)
    stops[1].position = 1.0
    stops[1].color = (0.072, 0.2, 0.42, 1.0)
    a = stops.new(0.2)
    a.color = (0.052, 0.172, 0.42, 1.0)
    b = stops.new(0.4)
    b.color = (0.068, 0.3, 0.42, 1.0)
    c = stops.new(0.58)
    c.color = (0.18, 0.16, 0.4, 1.0)
    d = stops.new(0.78)
    d.color = (0.1, 0.26, 0.25, 1.0)

    hue_sat = nodes.new(type="ShaderNodeHueSaturation")
    hue_sat.location = (500, -230)
    hue_sat.inputs[0].default_value = 0.5
    hue_sat.inputs[1].default_value = 1.18
    hue_sat.inputs[2].default_value = 0.84
    hue_sat.inputs[3].default_value = 1.0

    bright_contrast = nodes.new(type="ShaderNodeBrightContrast")
    bright_contrast.location = (700, -230)
    bright_contrast.inputs[1].default_value = -0.03
    bright_contrast.inputs[2].default_value = 0.26

    dirt_noise = nodes.new(type="ShaderNodeTexNoise")
    dirt_noise.location = (500, -470)
    dirt_noise.noise_dimensions = "2D"
    set_input(dirt_noise, "Scale", 10.0)
    set_input(dirt_noise, "Detail", 5.0)
    set_input(dirt_noise, "Roughness", 0.7)
    set_input(dirt_noise, "Distortion", 0.07)

    dirt_ramp = nodes.new(type="ShaderNodeValToRGB")
    dirt_ramp.location = (700, -470)
    set_simple_ramp(
        dirt_ramp,
        0.12,
        (0.74, 0.74, 0.74, 1.0),
        0.9,
        (1.18, 1.18, 1.18, 1.0),
        "LINEAR",
    )

    dirt_mul = nodes.new(type="ShaderNodeMixRGB")
    dirt_mul.location = (920, -280)
    dirt_mul.blend_type = "MULTIPLY"
    dirt_mul.inputs[0].default_value = 1.0

    grain_map_a = nodes.new(type="ShaderNodeMapping")
    grain_map_a.location = (500, -670)
    grain_map_a.inputs[1].default_value = (seed * 1.8, -seed * 1.4, 0.0)
    grain_map_a.inputs[3].default_value = (19.0, 16.0, 1.0)

    grain_map_b = nodes.new(type="ShaderNodeMapping")
    grain_map_b.location = (500, -870)
    grain_map_b.inputs[1].default_value = (-seed * 2.2, seed * 1.9, 0.0)
    grain_map_b.inputs[2].default_value = (0.0, 0.0, 0.6)
    grain_map_b.inputs[3].default_value = (42.0, 34.0, 1.0)

    white_a = nodes.new(type="ShaderNodeTexWhiteNoise")
    white_a.location = (700, -670)
    white_a.noise_dimensions = "2D"

    white_b = nodes.new(type="ShaderNodeTexWhiteNoise")
    white_b.location = (700, -870)
    white_b.noise_dimensions = "2D"

    bw_a = nodes.new(type="ShaderNodeRGBToBW")
    bw_a.location = (900, -670)

    bw_b = nodes.new(type="ShaderNodeRGBToBW")
    bw_b.location = (900, -870)

    grain_add = nodes.new(type="ShaderNodeMath")
    grain_add.location = (1120, -770)
    grain_add.operation = "ADD"

    grain_map = nodes.new(type="ShaderNodeMapRange")
    grain_map.location = (1320, -770)
    grain_map.clamp = True
    grain_map.inputs[1].default_value = 0.0
    grain_map.inputs[2].default_value = 2.0
    grain_map.inputs[3].default_value = 0.32
    grain_map.inputs[4].default_value = 1.86

    grain_mul = nodes.new(type="ShaderNodeMixRGB")
    grain_mul.location = (1540, -280)
    grain_mul.blend_type = "MULTIPLY"
    grain_mul.inputs[0].default_value = 1.0

    links.new(tex.outputs["UV"], map_a.inputs["Vector"])
    links.new(tex.outputs["UV"], map_b.inputs["Vector"])
    links.new(tex.outputs["UV"], map_c.inputs["Vector"])

    links.new(map_a.outputs["Vector"], noise_base.inputs["Vector"])
    links.new(map_b.outputs["Vector"], voronoi_big.inputs["Vector"])
    links.new(map_c.outputs["Vector"], voronoi_mid.inputs["Vector"])
    links.new(map_b.outputs["Vector"], noise_patch.inputs["Vector"])

    links.new(noise_base.outputs["Fac"], g_base.inputs[0])
    links.new(voronoi_big.outputs["Distance"], g_big.inputs[0])
    links.new(voronoi_mid.outputs["Distance"], g_mid.inputs[0])
    links.new(noise_patch.outputs["Fac"], g_patch.inputs[0])

    links.new(g_base.outputs[0], add_a.inputs[0])
    links.new(g_big.outputs[0], add_a.inputs[1])
    links.new(add_a.outputs[0], add_b.inputs[0])
    links.new(g_mid.outputs[0], add_b.inputs[1])
    links.new(add_b.outputs[0], add_c.inputs[0])
    links.new(g_patch.outputs[0], add_c.inputs[1])
    links.new(add_c.outputs[0], norm.inputs["Value"])

    links.new(norm.outputs["Result"], palette.inputs["Fac"])
    links.new(palette.outputs["Color"], hue_sat.inputs["Color"])
    links.new(hue_sat.outputs["Color"], bright_contrast.inputs["Color"])

    links.new(map_a.outputs["Vector"], dirt_noise.inputs["Vector"])
    links.new(dirt_noise.outputs["Fac"], dirt_ramp.inputs["Fac"])
    links.new(bright_contrast.outputs["Color"], dirt_mul.inputs[1])
    links.new(dirt_ramp.outputs["Color"], dirt_mul.inputs[2])

    links.new(map_a.outputs["Vector"], grain_map_a.inputs["Vector"])
    links.new(map_c.outputs["Vector"], grain_map_b.inputs["Vector"])
    links.new(grain_map_a.outputs["Vector"], white_a.inputs["Vector"])
    links.new(grain_map_b.outputs["Vector"], white_b.inputs["Vector"])
    links.new(white_a.outputs["Color"], bw_a.inputs["Color"])
    links.new(white_b.outputs["Color"], bw_b.inputs["Color"])
    links.new(bw_a.outputs["Val"], grain_add.inputs[0])
    links.new(bw_b.outputs["Val"], grain_add.inputs[1])
    links.new(grain_add.outputs["Value"], grain_map.inputs["Value"])

    links.new(dirt_mul.outputs["Color"], grain_mul.inputs[1])
    links.new(grain_map.outputs["Result"], grain_mul.inputs[2])

    links.new(grain_mul.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], out.inputs["Surface"])

    return mat


def setup_plane(material: bpy.types.Material) -> None:
    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, 0.0))
    plane = bpy.context.object
    if plane is None or plane.type != "MESH":
        raise RuntimeError("Failed to create plane")
    plane.data.materials.clear()
    plane.data.materials.append(material)


def setup_camera() -> None:
    bpy.ops.object.camera_add(location=(0.0, 0.0, 4.0), rotation=(0.0, 0.0, 0.0))
    camera = bpy.context.object
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError("Failed to create camera")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 8.0
    bpy.context.scene.camera = camera


def render(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    clear_scene()
    setup_render(args.width, args.height)
    set_world()
    mat = make_material(args.seed)
    setup_plane(mat)
    setup_camera()
    render(args.output)
    print(f"Generated {args.output}")


if __name__ == "__main__":
    main()
