import bpy
import bmesh
import os
import sys


def argument(name):
    marker = "--"
    args = sys.argv[sys.argv.index(marker) + 1 :] if marker in sys.argv else []
    index = args.index(name)
    return os.path.abspath(args[index + 1])


source_fbx = argument("--source")
source_texture = argument("--texture")
output_glb = argument("--output")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=source_fbx, use_anim=False)

# The demo mesh includes a rifle permanently weighted to the right hand. Arena
# Brawl supplies its own weapon models, so remove the disconnected rifle parts.
for obj in [item for item in bpy.context.scene.objects if item.type == "MESH"]:
    mesh = obj.data
    parent = list(range(len(mesh.vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    for edge in mesh.edges:
        union(edge.vertices[0], edge.vertices[1])

    components = {}
    for vertex in mesh.vertices:
        components.setdefault(find(vertex.index), []).append(vertex.index)
    remove_indices = []
    for indices in components.values():
        if max(mesh.vertices[index].co.x for index in indices) < -25:
            remove_indices.extend(indices)

    if remove_indices:
        editable = bmesh.new()
        editable.from_mesh(mesh)
        editable.verts.ensure_lookup_table()
        bmesh.ops.delete(editable, geom=[editable.verts[index] for index in remove_indices], context="VERTS")
        editable.to_mesh(mesh)
        editable.free()
        mesh.update()

image = bpy.data.images.load(source_texture, check_existing=True)
for material in bpy.data.materials:
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if shader is None:
        continue
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "Toon Soldier Color"
    texture.image = image
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.72
    shader.inputs["Metallic"].default_value = 0.0

for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True

os.makedirs(os.path.dirname(output_glb), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format="GLB",
    export_animations=False,
    export_skins=True,
    export_materials="EXPORT",
    export_yup=True,
)

armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
for armature in armatures:
    print("TOON_BONES=" + ",".join(bone.name for bone in armature.data.bones))
print("TOON_EXPORT=" + output_glb)
