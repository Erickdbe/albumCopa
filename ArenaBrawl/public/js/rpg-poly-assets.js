import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  RPG_POLY_BASE_PATH,
  RPG_POLY_TEXTURE,
  RPG_POLY_FOREST_COLLIDERS,
  RPG_POLY_FOREST_ITEMS
} from "./forest-rpg-poly-data.js";

const fbxLoader = new FBXLoader();
const textureLoader = new THREE.TextureLoader();
const modelCache = new Map();
let texturePromise = null;

function loadAtlasTexture() {
  if (!texturePromise) {
    texturePromise = textureLoader.loadAsync(`${RPG_POLY_BASE_PATH}${RPG_POLY_TEXTURE}`).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestMipMapLinearFilter;
      return texture;
    });
  }
  return texturePromise;
}

function loadRpgPolyModel(assetName) {
  if (!modelCache.has(assetName)) {
    const promise = Promise.all([
      fbxLoader.loadAsync(`${RPG_POLY_BASE_PATH}models/${assetName}.fbx`),
      loadAtlasTexture()
    ]).then(([model, atlas]) => prepareRpgPolyModel(model, atlas));
    modelCache.set(assetName, promise);
  }
  return modelCache.get(assetName);
}

function prepareRpgPolyModel(model, atlas) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const material = new THREE.MeshStandardMaterial({
      map: atlas,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.02
    });
    material.map.colorSpace = THREE.SRGBColorSpace;
    child.material = material;
    if (child.geometry) {
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
  return model;
}

function applyUnityTransform(object, item) {
  object.position.set(item.position[0], item.position[1], item.position[2]);
  object.rotation.set(
    THREE.MathUtils.degToRad(item.rotation[0]),
    THREE.MathUtils.degToRad(item.rotation[1]),
    THREE.MathUtils.degToRad(item.rotation[2])
  );
  object.scale.set(item.scale[0], item.scale[1], item.scale[2]);
}

export function registerRpgPolyForestCollisions(world) {
  if (world.userData?.rpgPolyCollisionsRegistered) return;
  world.userData = world.userData || {};
  world.userData.rpgPolyCollisionsRegistered = true;

  RPG_POLY_FOREST_COLLIDERS.forEach((collider) => {
    if (collider.kind === "ladder") {
      const centerX = (collider.minX + collider.maxX) / 2;
      const centerZ = (collider.minZ + collider.maxZ) / 2;
      world.ladders.push({
        centerX,
        centerZ,
        alongX: (collider.maxX - collider.minX) > (collider.maxZ - collider.minZ),
        minX: collider.minX - 0.25,
        maxX: collider.maxX + 0.25,
        minZ: collider.minZ - 0.25,
        maxZ: collider.maxZ + 0.25,
        bottomY: Math.max(0, collider.minY),
        topY: collider.maxY + 0.2,
        dismountX: 0,
        dismountZ: 0.95
      });
      return;
    }

    world.obstacles.push({
      type: "aabb",
      minX: collider.minX,
      maxX: collider.maxX,
      minY: collider.minY,
      maxY: collider.maxY,
      minZ: collider.minZ,
      maxZ: collider.maxZ,
      topY: collider.maxY,
      solid: collider.kind !== "platform",
      active: true,
      source: `rpg-poly:${collider.source}`
    });
  });
}

export function attachRpgPolyForest(world, options = {}) {
  const anchor = new THREE.Group();
  anchor.name = "unity-rpg-poly-forest";
  world.root.add(anchor);

  const batches = new Map();
  RPG_POLY_FOREST_ITEMS.forEach((item) => {
    if (!batches.has(item.asset)) batches.set(item.asset, []);
    batches.get(item.asset).push(item);
  });

  let loadedAssets = 0;
  const totalAssets = batches.size;
  batches.forEach((items, assetName) => {
    loadRpgPolyModel(assetName).then((source) => {
      if (!anchor.parent) return;
      const group = new THREE.Group();
      group.name = `rpg-poly-${assetName}`;
      items.forEach((item) => {
        const instance = source.clone(true);
        instance.name = item.name || assetName;
        applyUnityTransform(instance, item);
        group.add(instance);
      });
      anchor.add(group);
      loadedAssets += 1;
      if (loadedAssets === totalAssets) options.onReady?.(anchor);
    }).catch((error) => {
      console.warn(`Nao foi possivel carregar asset RPG Poly ${assetName}:`, error);
    });
  });

  return anchor;
}
