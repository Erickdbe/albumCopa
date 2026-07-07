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

function normalizeObject(object, options = {}) {
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  const scalar = options.targetHeight
    ? options.targetHeight / Math.max(0.001, size.y)
    : options.targetSize
      ? options.targetSize / Math.max(0.001, Math.max(size.x, size.y, size.z))
      : 1;
  object.scale.multiplyScalar(scalar);
  object.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(object);
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

function addCollisionFromBox(world, box, solid = true) {
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const height = box.max.y - box.min.y;
  if (width < 0.15 || depth < 0.15 || height < 0.05) return;
  if (Math.abs(box.min.x) > world.half + 45 && Math.abs(box.max.x) > world.half + 45) return;
  if (Math.abs(box.min.z) > world.half + 45 && Math.abs(box.max.z) > world.half + 45) return;
  world.obstacles.push({
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    topY: box.max.y,
    solid,
    active: true
  });
}

export function attachSketchbookWorld(world, options = {}) {
  const anchor = new THREE.Group();
  anchor.name = "sketchbook-world-anchor";
  world.root.add(anchor);
  world.raycastMeshes = world.raycastMeshes || [];

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
      const box = new THREE.Box3().setFromObject(child);
      if (isPhysics) {
        child.visible = false;
        if (options.usePhysicsCollisions) addCollisionFromBox(world, box, true);
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
    targetHeight: 1.82,
    rotation: [0, Math.PI, 0]
  });
  prepareObject(model);
  return { model, animations: gltf.animations || [] };
}
