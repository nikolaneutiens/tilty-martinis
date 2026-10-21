import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'public', 'assets')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in ARGS
PROPS_ONLY = '--props' in ARGS

BAKE_SIZE = 2048
BAKE_SAMPLES = 256

os.makedirs(ASSETS, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
pub_col = bpy.data.collections.new('Pub')
shader_col = bpy.data.collections.new('ShaderSurfaces')
props_col = bpy.data.collections.new('Props')
for c in (pub_col, shader_col, props_col):
    scene.collection.children.link(c)

materials = {}

def material(name, color, rough=0.7, metal=0.0, emit=None, strength=0.0):
    if name in materials:
        return materials[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*color, 1.0)
    materials[name] = m
    return m

WOOD_FLOOR = material('WoodFloor', (0.13, 0.06, 0.025), 0.6)
WOOD_DARK = material('WoodDark', (0.06, 0.025, 0.01), 0.5)
WOOD_MID = material('WoodMid', (0.2, 0.09, 0.035), 0.45)
WOOD_TOP = material('WoodTop', (0.28, 0.13, 0.05), 0.3)
PLASTER = material('Plaster', (0.42, 0.3, 0.18), 0.9)
CEILING = material('Ceiling', (0.25, 0.17, 0.1), 0.9)
BRICK = material('Brick', (0.25, 0.08, 0.04), 0.9)
STONE = material('Stone', (0.18, 0.15, 0.12), 0.85)
SOOT = material('Soot', (0.02, 0.015, 0.01), 0.9)
LEATHER = material('Leather', (0.22, 0.035, 0.02), 0.5)
BRASS = material('Brass', (0.6, 0.38, 0.12), 0.3, 1.0)
SHADE = material('LampShade', (0.03, 0.06, 0.03), 0.4, 0.3)
BULB = material('Bulb', (1, 0.8, 0.5), 0.5, 0, (1.0, 0.62, 0.3), 12.0)
FRAME = material('Frame', (0.35, 0.22, 0.08), 0.4, 0.6)
PAINTING_A = material('PaintingA', (0.12, 0.2, 0.15), 0.8)
PAINTING_B = material('PaintingB', (0.3, 0.15, 0.08), 0.8)
DART_BLACK = material('DartBlack', (0.02, 0.02, 0.02), 0.6)
DART_CREAM = material('DartCream', (0.6, 0.5, 0.3), 0.6)
BOTTLE_COLORS = [
    material('BottleGreen', (0.02, 0.15, 0.04), 0.15),
    material('BottleAmber', (0.4, 0.15, 0.02), 0.15),
    material('BottleClear', (0.6, 0.6, 0.55), 0.1),
    material('BottleBlue', (0.03, 0.06, 0.2), 0.15),
    material('BottleRed', (0.3, 0.02, 0.02), 0.15),
]
FIRE_MAT = material('FireGlow', (0, 0, 0), 1, 0, (1.0, 0.35, 0.08), 6.0)
WINDOW_MAT = material('WindowNight', (0, 0, 0), 1, 0, (0.08, 0.12, 0.3), 1.5)
NEON_MAT = material('NeonGlow', (0, 0, 0), 1, 0, (1.0, 0.15, 0.4), 4.0)
TV_MAT = material('TvGlow', (0, 0, 0), 1, 0, (0.3, 0.45, 0.6), 1.5)

def make_object(name, bm, location=(0, 0, 0), rotation=(0, 0, 0), mat=None, collection=pub_col):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    if mat:
        mesh.materials.append(mat)
    collection.objects.link(obj)
    return obj

def box(name, center, size, mat, rotation=(0, 0, 0), collection=pub_col):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return make_object(name, bm, center, rotation, mat, collection)

def cylinder(name, center, radius, depth, mat, segments=16, radius_top=None, rotation=(0, 0, 0), collection=pub_col):
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius if radius_top is None else radius_top, depth=depth,
    )
    return make_object(name, bm, center, rotation, mat, collection)

def sphere(name, center, radius, mat, collection=pub_col):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=radius)
    return make_object(name, bm, center, (0, 0, 0), mat, collection)

def plane(name, center, size, mat, rotation=(0, 0, 0), collection=shader_col):
    bm = bmesh.new()
    sx, sy = size[0] / 2, size[1] / 2
    verts = [bm.verts.new(v) for v in ((-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0))]
    face = bm.faces.new(verts)
    uv = bm.loops.layers.uv.new('UVMap')
    for loop, coord in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coord
    return make_object(name, bm, center, rotation, mat, collection)

def lathe(name, profile, mat, segments=32, uv_mode='cylinder', collection=props_col):
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(
        bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1),
        angle=math.tau, steps=segments, use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    uv = bm.loops.layers.uv.new('UVMap')
    zs = [z for _, z in profile]
    zmin, zmax = min(zs), max(zs)
    rmax = max(r for r, _ in profile)
    for face in bm.faces:
        coords = []
        for loop in face.loops:
            x, y, z = loop.vert.co
            if uv_mode == 'planar':
                coords.append((0.5 + x / (2 * rmax), 0.5 + y / (2 * rmax)))
            else:
                coords.append(((math.atan2(y, x) / math.tau) % 1.0, (z - zmin) / (zmax - zmin)))
        if uv_mode != 'planar':
            us = [c[0] for c in coords]
            if max(us) - min(us) > 0.5:
                coords = [(u + 1.0 if u < 0.5 else u, v) for u, v in coords]
        for loop, c in zip(face.loops, coords):
            loop[uv].uv = c
    return make_object(name, bm, (0, 0, 0), (0, 0, 0), mat, collection)

def point_light(name, location, watts, color=(1.0, 0.68, 0.38), radius=0.15):
    data = bpy.data.lights.new(name, type='POINT')
    data.energy = watts
    data.color = color
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    scene.collection.objects.link(obj)
    return obj

W = 4.0
Y0, Y1 = -3.0, 18.0
H = 3.6
T = 0.2

box('Floor', (0, (Y0 + Y1) / 2, -T / 2), (2 * W + 2 * T, Y1 - Y0 + 2 * T, T), WOOD_FLOOR)
box('Ceiling', (0, (Y0 + Y1) / 2, H + T / 2), (2 * W + 2 * T, Y1 - Y0 + 2 * T, T), CEILING)
box('WallLeft', (-W - T / 2, (Y0 + Y1) / 2, H / 2), (T, Y1 - Y0, H), PLASTER)
box('WallRight', (W + T / 2, (Y0 + Y1) / 2, H / 2), (T, Y1 - Y0, H), PLASTER)
box('WallBack', (0, Y1 + T / 2, H / 2), (2 * W, T, H), BRICK)
box('WallFront', (0, Y0 - T / 2, H / 2), (2 * W, T, H), PLASTER)

for i in range(-7, 8):
    box(f'FloorGroove{i}', (i * 0.5, (Y0 + Y1) / 2, 0.001), (0.015, Y1 - Y0, 0.002), WOOD_DARK)

for side in (-1, 1):
    x = side * (W - 0.03)
    box(f'Wainscot{side}', (x, (Y0 + Y1) / 2, 0.55), (0.06, Y1 - Y0, 1.1), WOOD_MID)
    box(f'WainscotRail{side}', (side * (W - 0.06), (Y0 + Y1) / 2, 1.12), (0.1, Y1 - Y0, 0.06), WOOD_DARK)
box('WainscotBack', (0, Y1 - 0.03, 0.55), (2 * W, 0.06, 1.1), WOOD_MID)

y = Y0 + 1.0
while y < Y1:
    box(f'Beam{y:.1f}', (0, y, H - 0.12), (2 * W, 0.22, 0.24), WOOD_DARK)
    y += 2.4
for x in (-2.0, 2.0):
    box(f'BeamLong{x}', (x, (Y0 + Y1) / 2, H - 0.3), (0.18, Y1 - Y0, 0.12), WOOD_DARK)

BAR_X = -2.7
BAR_Y0, BAR_Y1 = 1.5, 13.5
box('BarBody', (BAR_X, (BAR_Y0 + BAR_Y1) / 2, 0.52), (0.6, BAR_Y1 - BAR_Y0, 1.04), WOOD_MID)
box('BarTop', (BAR_X + 0.05, (BAR_Y0 + BAR_Y1) / 2, 1.07), (0.8, BAR_Y1 - BAR_Y0 + 0.1, 0.06), WOOD_TOP)
box('BarFootRail', (BAR_X + 0.42, (BAR_Y0 + BAR_Y1) / 2, 0.2), (0.04, BAR_Y1 - BAR_Y0, 0.04), BRASS)
y = BAR_Y0 + 0.6
while y < BAR_Y1 - 0.4:
    box(f'BarPanel{y:.1f}', (BAR_X + 0.31, y, 0.55), (0.03, 0.9, 0.6), WOOD_DARK)
    y += 1.2
box('BarEnd', (BAR_X + 0.05, BAR_Y0 - 0.02, 0.55), (0.66, 0.08, 1.1), WOOD_DARK)

for i, y in enumerate((4.0, 4.35, 4.7, 8.0, 8.35)):
    cylinder(f'TapPole{i}', (BAR_X - 0.05, y, 1.3), 0.025, 0.42, BRASS, 10)
    cylinder(f'TapHandle{i}', (BAR_X - 0.05, y, 1.58), 0.02, 0.16, WOOD_DARK, 8)

rng_state = [7]

def rand():
    rng_state[0] = (rng_state[0] * 1103515245 + 12345) % 2 ** 31
    return rng_state[0] / 2 ** 31

box('BackBarCabinet', (-W + 0.3, (BAR_Y0 + BAR_Y1) / 2, 0.5), (0.6, BAR_Y1 - BAR_Y0, 1.0), WOOD_DARK)
box('BackBarCabinetTop', (-W + 0.3, (BAR_Y0 + BAR_Y1) / 2, 1.02), (0.64, BAR_Y1 - BAR_Y0, 0.04), WOOD_TOP)
for s, z in enumerate((1.45, 1.9, 2.35)):
    box(f'Shelf{s}', (-W + 0.16, (BAR_Y0 + BAR_Y1) / 2, z), (0.3, BAR_Y1 - BAR_Y0, 0.04), WOOD_TOP)
    y = BAR_Y0 + 0.2
    while y < BAR_Y1 - 0.2:
        mat = BOTTLE_COLORS[int(rand() * len(BOTTLE_COLORS))]
        h = 0.22 + rand() * 0.12
        r = 0.035 + rand() * 0.015
        cylinder(f'Bottle{s}_{y:.2f}', (-W + 0.16, y, z + 0.02 + h / 2), r, h, mat, 10)
        cylinder(f'BottleNeck{s}_{y:.2f}', (-W + 0.16, y, z + 0.02 + h + 0.05), r * 0.35, 0.1, mat, 8)
        y += 0.12 + rand() * 0.1
box('MirrorFrame', (-W + 0.02, (BAR_Y0 + BAR_Y1) / 2, 2.0), (0.04, BAR_Y1 - BAR_Y0 - 1.0, 1.2), FRAME)

y = BAR_Y0 + 0.8
while y < BAR_Y1 - 0.4:
    cylinder(f'StoolLeg{y:.1f}', (BAR_X + 0.85, y, 0.38), 0.03, 0.76, BRASS, 8)
    cylinder(f'StoolBase{y:.1f}', (BAR_X + 0.85, y, 0.015), 0.18, 0.03, WOOD_DARK, 16)
    cylinder(f'StoolSeat{y:.1f}', (BAR_X + 0.85, y, 0.78), 0.2, 0.07, LEATHER, 16)
    y += 1.3

def table(name, x, y):
    cylinder(f'{name}Top', (x, y, 0.75), 0.42, 0.05, WOOD_TOP, 24)
    cylinder(f'{name}Leg', (x, y, 0.37), 0.05, 0.72, WOOD_DARK, 10)
    cylinder(f'{name}Foot', (x, y, 0.02), 0.3, 0.04, WOOD_DARK, 16)
    for a in (0, math.pi):
        cx, cy = x + math.cos(a) * 0.65, y + math.sin(a) * 0.65
        box(f'{name}ChairSeat{a:.1f}', (cx, cy, 0.46), (0.42, 0.42, 0.05), WOOD_MID)
        box(f'{name}ChairBack{a:.1f}', (cx + math.cos(a) * 0.19, cy, 0.8), (0.04, 0.42, 0.65), WOOD_MID)
        for dx in (-0.17, 0.17):
            for dy in (-0.17, 0.17):
                box(f'{name}ChairLeg{a:.1f}{dx}{dy}', (cx + dx, cy + dy, 0.22), (0.04, 0.04, 0.44), WOOD_DARK)

table('TableA', 1.9, 3.5)
table('TableB', 1.9, 6.6)
table('TableC', 1.7, 14.5)

def booth(name, y):
    x = W - 0.5
    box(f'{name}Seat', (x, y, 0.42), (0.9, 1.6, 0.12), LEATHER)
    box(f'{name}SeatBase', (x, y, 0.18), (0.85, 1.55, 0.36), WOOD_DARK)
    box(f'{name}Back', (W - 0.1, y, 0.85), (0.15, 1.6, 0.8), LEATHER)
    box(f'{name}Table', (x - 0.1, y + 1.15, 0.74), (0.75, 0.6, 0.05), WOOD_TOP)
    box(f'{name}TableLeg', (x - 0.1, y + 1.15, 0.36), (0.08, 0.08, 0.72), WOOD_DARK)
    box(f'{name}Divider', (x, y + 1.95, 0.75), (0.95, 0.08, 1.5), WOOD_DARK)

booth('BoothA', 11.5)
booth('BoothB', 15.0)

FIRE_Y = 8.0
box('FireplaceLeft', (W - 0.3, FIRE_Y - 0.75, 0.7), (0.6, 0.35, 1.4), STONE)
box('FireplaceRight', (W - 0.3, FIRE_Y + 0.75, 0.7), (0.6, 0.35, 1.4), STONE)
box('FireplaceLintel', (W - 0.3, FIRE_Y, 1.25), (0.6, 1.15, 0.3), STONE)
box('FireplaceMantel', (W - 0.33, FIRE_Y, 1.45), (0.72, 2.0, 0.08), WOOD_DARK)
box('FireplaceChimney', (W - 0.25, FIRE_Y, 2.5), (0.5, 1.4, 2.1), BRICK)
box('FireplaceBack', (W - 0.05, FIRE_Y, 0.55), (0.1, 1.15, 1.1), SOOT)
box('FireplaceHearth', (W - 0.45, FIRE_Y, 0.04), (0.9, 2.0, 0.08), STONE)
for i, dy in enumerate((-0.25, 0.0, 0.25)):
    cylinder(f'Log{i}', (W - 0.3, FIRE_Y + dy, 0.16), 0.06, 0.45, WOOD_DARK, 8, rotation=(0, math.pi / 2, 0))
plane('Fire_Plane', (W - 0.2, FIRE_Y, 0.55), (0.95, 0.85), FIRE_MAT, rotation=(math.pi / 2, 0, -math.pi / 2))

box('TvBody', (W - 0.58, FIRE_Y, 2.15), (0.14, 1.0, 0.62), DART_BLACK)
plane('TV_Screen', (W - 0.66, FIRE_Y, 2.15), (0.9, 0.52), TV_MAT, rotation=(math.pi / 2, 0, -math.pi / 2))

for i, (y, mat) in enumerate(((2.5, PAINTING_A), (4.6, PAINTING_B), (12.3, PAINTING_A))):
    box(f'PictureFrame{i}', (W - 0.03, y, 1.9), (0.04, 0.9, 0.7), FRAME)
    box(f'Picture{i}', (W - 0.05, y, 1.9), (0.02, 0.75, 0.55), mat)
cylinder('Dartboard', (W - 0.04, 5.9, 1.75), 0.23, 0.04, DART_BLACK, 24, rotation=(0, math.pi / 2, 0))
cylinder('DartboardRing', (W - 0.065, 5.9, 1.75), 0.15, 0.02, DART_CREAM, 24, rotation=(0, math.pi / 2, 0))

box('WindowFrameL', (1.35, Y1 - 0.05, 1.7), (0.1, 0.12, 1.6), WOOD_DARK)
box('WindowFrameR', (3.05, Y1 - 0.05, 1.7), (0.1, 0.12, 1.6), WOOD_DARK)
box('WindowFrameT', (2.2, Y1 - 0.05, 2.5), (1.8, 0.12, 0.1), WOOD_DARK)
box('WindowFrameB', (2.2, Y1 - 0.08, 0.9), (1.9, 0.2, 0.08), WOOD_DARK)
box('WindowMullion', (2.2, Y1 - 0.05, 1.7), (0.05, 0.1, 1.6), WOOD_DARK)
plane('Window_Plane', (2.2, Y1 - 0.02, 1.7), (1.6, 1.5), WINDOW_MAT, rotation=(math.pi / 2, 0, 0))

box('Door', (-1.4, Y1 - 0.04, 1.05), (1.0, 0.08, 2.1), WOOD_MID)
box('DoorFrame', (-1.4, Y1 - 0.02, 1.1), (1.2, 0.04, 2.25), WOOD_DARK)
sphere('DoorKnob', (-1.05, Y1 - 0.1, 1.0), 0.04, BRASS)
box('NeonBacking', (-1.4, Y1 - 0.02, 2.75), (1.6, 0.04, 0.55), DART_BLACK)
plane('Neon_Sign', (-1.4, Y1 - 0.05, 2.75), (1.5, 0.45), NEON_MAT, rotation=(math.pi / 2, 0, 0))

def pendant(name, x, y, drop=1.0, watts=60):
    z = H - drop
    cylinder(f'{name}Cord', (x, y, z + drop / 2), 0.008, drop, DART_BLACK, 6)
    cylinder(f'{name}Shade', (x, y, z - 0.08), 0.22, 0.18, SHADE, 16, radius_top=0.06)
    sphere(f'{name}Bulb', (x, y, z - 0.15), 0.05, BULB)
    point_light(f'{name}Light', (x, y, z - 0.22), watts)

for i, y in enumerate((3.0, 6.5, 10.0, 13.0)):
    pendant(f'BarLamp{i}', BAR_X + 0.05, y, 1.1, 70)
pendant('TableLampA', 1.9, 3.5, 1.4, 55)
pendant('TableLampB', 1.9, 6.6, 1.4, 55)
pendant('TableLampC', 1.7, 14.5, 1.4, 55)
pendant('BoothLampA', W - 0.6, 12.6, 1.4, 45)
pendant('BoothLampB', W - 0.6, 16.1, 1.4, 45)
point_light('FireLight', (W - 0.7, FIRE_Y, 0.5), 180, (1.0, 0.45, 0.15), 0.4)
point_light('BackBarGlow', (-W + 0.6, 7.5, 2.6), 60, (1.0, 0.6, 0.3), 1.0)
point_light('FrontFill', (0, -1.5, 2.8), 40, (1.0, 0.75, 0.5), 1.5)

world = bpy.data.worlds.new('World')
scene.world = world
try:
    world.use_nodes = True
except AttributeError:
    pass
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.05, 0.03, 0.02, 1)
bg.inputs['Strength'].default_value = 0.3

TRAY_START = Vector((0, 1.6, 1.25))
cam_data = bpy.data.cameras.new('GameCamera')
cam_data.lens = 30
cam = bpy.data.objects.new('GameCamera', cam_data)
cam.location = (0, -2.6, 1.85)
cam.rotation_euler = (Vector((0, 6.0, 1.15)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
pub_col.objects.link(cam)
scene.camera = cam

TRAY_MAT = material('TrayMetal', (0.75, 0.73, 0.7), 0.25, 1.0)
GLASS_MAT = material('GlassPlaceholder', (0.85, 0.9, 0.88), 0.1)
MARTINI_MAT = material('Martini', (0.85, 0.86, 0.65), 0.2)

tray = lathe('Tray', [
    (0.0, 0.0), (0.38, 0.0), (0.4, 0.004), (0.405, 0.028), (0.398, 0.03),
    (0.392, 0.01), (0.38, 0.008), (0.0, 0.008),
], TRAY_MAT, 48, 'planar')
glass = lathe('Glass_Martini', [
    (0.0, 0.0), (0.038, 0.0), (0.039, 0.003), (0.012, 0.008), (0.004, 0.016), (0.0035, 0.09),
    (0.006, 0.095), (0.058, 0.165), (0.055, 0.165), (0.003, 0.098), (0.0, 0.097),
], GLASS_MAT, 32)
liquid = lathe('Liquid_Martini', [
    (0.0, 0.099), (0.04, 0.144), (0.0, 0.144),
], MARTINI_MAT, 32, 'planar')

for obj in (tray, glass, liquid):
    obj.location = TRAY_START
glass.location = TRAY_START + Vector((0, 0, 0.03))
liquid.location = glass.location

if PROPS_ONLY:
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (tray, glass, liquid))
    bpy.context.view_layer.objects.active = glass
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(ASSETS, 'props.glb'), export_format='GLB', use_selection=True,
        export_cameras=False, export_lights=False, export_materials='EXPORT', export_apply=True,
    )
    print('PROPS DONE')
    sys.exit(0)

scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
    print('Cycles devices:', [(d.name, d.type, d.use) for d in prefs.devices])
except Exception as err:
    print('GPU setup failed, using CPU:', err)
scene.view_settings.view_transform = 'AgX'

bpy.context.view_layer.update()

def select_only(objs, active=None):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

if PREVIEW:
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = os.path.join(ROOT, 'blender', 'preview.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'pub.blend'))
    print('PREVIEW DONE')
    sys.exit(0)

pub_meshes = [o for o in pub_col.objects if o.type == 'MESH']
select_only(pub_meshes)
bpy.ops.object.join()
pub = bpy.context.view_layer.objects.active
pub.name = 'Pub'
pub.data.name = 'Pub'

while pub.data.uv_layers:
    pub.data.uv_layers.remove(pub.data.uv_layers[0])
pub.data.uv_layers.new(name='BakeUV')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, scale_to_bounds=False)
bpy.ops.object.mode_set(mode='OBJECT')

bake_image = bpy.data.images.new('Baked', BAKE_SIZE, BAKE_SIZE, float_buffer=True)
for slot in pub.material_slots:
    nodes = slot.material.node_tree.nodes
    node = nodes.new('ShaderNodeTexImage')
    node.image = bake_image
    nodes.active = node

scene.cycles.samples = BAKE_SAMPLES
scene.render.bake.margin = 8
select_only([pub])
print('BAKING...')
bpy.ops.object.bake(type='COMBINED', use_clear=True, margin=8)

scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 90
bake_image.save_render(os.path.join(ASSETS, 'baked.jpg'), scene=scene)
print('BAKED')

select_only([pub, cam] + list(shader_col.objects))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(ASSETS, 'pub.glb'), export_format='GLB', use_selection=True,
    export_cameras=True, export_lights=False, export_materials='NONE', export_apply=True,
)
select_only(list(props_col.objects))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(ASSETS, 'props.glb'), export_format='GLB', use_selection=True,
    export_cameras=False, export_lights=False, export_materials='EXPORT', export_apply=True,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'pub.blend'))
print('EXPORT DONE')
