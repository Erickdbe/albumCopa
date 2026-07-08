import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const ROOT = "./assets/models/sketchbook/";
const loader = new GLTFLoader();
const cache = new Map();

function loadSketchbookAsset(name) {
  if (!cache.has(name)) {
    cache.set(name, loader.loadAsync(`${ROOT}${name}.glb`));
  }
  return cache.get(name);
}

function prepareObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.data === "collision") {
      child.visible = false;
      child.castShadow = false;
      child.receiveShadow = false;
      return;
    }
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = 4;
      }
      material.needsUpdate = true;
    });
  });
}

function renderableBounds(object) {
  const bounds = new THREE.Box3();
  let found = false;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!child.isMesh || child.userData?.data === "collision") return;
    const childBounds = new THREE.Box3().setFromObject(child);
    if (childBounds.isEmpty()) return;
    bounds.union(childBounds);
    found = true;
  });
  return found ? bounds : new THREE.Box3().setFromObject(object);
}

function normalizeObject(object, options = {}) {
  const bounds = renderableBounds(object);
  const size = bounds.getSize(new THREE.Vector3());
  const scalar = options.targetHeight
    ? options.targetHeight / Math.max(0.001, size.y)
    : options.targetSize
      ? options.targetSize / Math.max(0.001, Math.max(size.x, size.y, size.z))
      : 1;
  object.scale.multiplyScalar(scalar);
  object.updateMatrixWorld(true);

  const scaledBounds = renderableBounds(object);
  object.position.x -= (scaledBounds.min.x + scaledBounds.max.x) / 2;
  object.position.y -= scaledBounds.min.y;
  object.position.z -= (scaledBounds.min.z + scaledBounds.max.z) / 2;
  if (options.rotation) object.rotation.set(...options.rotation);
  if (options.offset) object.position.add(options.offset);
}

function hideAnchorMeshes(anchor) {
  anchor.traverse((child) => {
    if (child.isMesh) {
      child.visible = false;
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
}

export async function attachSketchbookModel(anchor, name, options = {}) {
  const gltf = await loadSketchbookAsset(name);
  const model = cloneSkeleton(gltf.scene);
  model.name = `sketchbook-${name}`;
  normalizeObject(model, options);
  prepareObject(model);
  if (options.hideExisting) hideAnchorMeshes(anchor);
  anchor.add(model);
  return { model, animations: gltf.animations || [] };
}

export function attachSketchbookVehicle(anchor, vehicleType, options = {}) {
  const assetName = vehicleType === "plane" ? "airplane" : vehicleType === "helicopter" ? "heli" : "car";
  anchor.userData.wheels = anchor.userData.wheels || [];

  return attachSketchbookModel(anchor, assetName, {
    targetSize: options.targetSize,
    targetHeight: options.targetHeight,
    rotation: options.rotation,
    offset: options.offset,
    hideExisting: true
  }).then(({ model }) => {
    const wheels = [];
    const rotors = [];
    model.traverse((child) => {
      if (!child.userData) return;
      if (child.userData.data === "wheel") wheels.push(child);
      if (child.userData.data === "rotor") rotors.push(child);
    });
    if (wheels.length) anchor.userData.wheels = wheels;
    if (rotors.length) anchor.userData.propeller = rotors[0];
    return model;
  });
}

function addAabbCollision(world, box, solid = true, source = "sketchbook") {
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  if (width < 0.08 || depth < 0.08 || height < 0.025) return false;
  world.obstacles.push({
    type: "aabb",
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    minY: box.min.y,
    maxY: box.max.y,
    topY: box.max.y,
    solid,
    active: true,
    source
  });
  return true;
}

function addObbCollision(world, mesh, box, solid = true, source = "sketchbook") {
  const geometry = mesh.geometry;
  if (!geometry) return addAabbCollision(world, box, solid, source);
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return addAabbCollision(world, box, solid, source);

  const rotation = new THREE.Euler().setFromQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()), "YXZ");
  const tilted = Math.abs(rotation.x) > 0.16 || Math.abs(rotation.z) > 0.16;
  if (tilted) return addAabbCollision(world, box, solid, source);

  const center = geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const scale = mesh.getWorldScale(new THREE.Vector3());
  const halfX = Math.abs(size.x * scale.x) * 0.5;
  const halfY = Math.abs(size.y * scale.y) * 0.5;
  const halfZ = Math.abs(size.z * scale.z) * 0.5;
  if (halfX < 0.04 || halfZ < 0.04 || halfY < 0.012) return false;

  world.obstacles.push({
    type: "obb",
    centerX: center.x,
    centerZ: center.z,
    halfX,
    halfZ,
    minY: center.y - halfY,
    maxY: center.y + halfY,
    topY: center.y + halfY,
    yaw: rotation.y,
    solid,
    active: true,
    source
  });
  return true;
}

function classifySketchbookCollider(world, box, userData = {}) {
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  const topY = box.max.y;
  const minY = box.min.y;
  const footprint = width * depth;
  const groundY = world.sketchbookGroundY || 5.35;

  if (minY > groundY + 62) return null;
  if (Math.min(width, depth) < 0.08 || height < 0.025) return null;
  if (width > 230 || depth > 260) return null;

  const nearWalkableFloor = topY >= groundY - 0.28 && topY <= groundY + 1.15;
  const broadLowSurface = footprint > 5 && height <= 4.8;
  if (nearWalkableFloor && broadLowSurface) return "ground";

  const type = String(userData.type || "").toLowerCase();
  if (type === "trimesh" && minY <= groundY + 0.35 && topY <= groundY + 2.45 && footprint > 4) return "ground";
  if (type === "trimesh" && topY <= groundY + 0.45) return "ground";
  if (height < 0.22 && footprint > 1) return "ground";
  if (height < 0.9 && footprint < 0.8) return null;

  return "solid";
}

function registerSketchbookCollider(world, mesh, kind) {
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return false;
  const solid = kind === "solid";
  const useObb = String(mesh.userData?.type || "").toLowerCase() === "box";
  const added = useObb
    ? addObbCollision(world, mesh, box, solid)
    : addAabbCollision(world, box, solid);
  if (added) {
    world.sketchbookColliderStats = world.sketchbookColliderStats || { ground: 0, solid: 0 };
    world.sketchbookColliderStats[kind] = (world.sketchbookColliderStats[kind] || 0) + 1;
  }
  return added;
}

export function attachSketchbookWorld(world, options = {}) {
  const anchor = new THREE.Group();
  anchor.name = "sketchbook-world-anchor";
  world.root.add(anchor);
  world.raycastMeshes = world.raycastMeshes || [];
  world.groundRaycastMeshes = world.groundRaycastMeshes || [];

  loadSketchbookAsset("world").then((gltf) => {
    const model = gltf.scene.clone(true);
    model.name = "sketchbook-world";
    model.scale.setScalar(options.scale || 0.36);
    model.position.set(options.x || 0, options.y || -0.04, options.z || 0);
    anchor.add(model);
    model.updateMatrixWorld(true);

    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const isPhysics = child.userData?.data === "physics";
      if (isPhysics) {
        child.visible = false;
        child.castShadow = false;
        child.receiveShadow = false;
        const kind = classifySketchbookCollider(world, new THREE.Box3().setFromObject(child), child.userData);
        if (kind === "ground" && options.usePhysicsGround !== false) {
          world.groundRaycastMeshes.push(child);
          registerSketchbookCollider(world, child, "ground");
        } else if (kind === "solid" && options.usePhysicsCollisions !== false) {
          registerSketchbookCollider(world, child, "solid");
        }
        return;
      }
      world.raycastMeshes.push(child);
    });

    world.loaded = true;
  }).catch((error) => {
    console.warn("Nao foi possivel carregar o mapa Sketchbook:", error);
  });

  return anchor;
}

export async function loadSketchbookCharacter() {
  const gltf = await loadSketchbookAsset("boxman");
  const model = cloneSkeleton(gltf.scene);
  normalizeObject(model, {
    targetHeight: 1.55,
    rotation: [0, Math.PI, 0]
  });
  prepareObject(model);
  return { model, animations: gltf.animations || [] };
}
