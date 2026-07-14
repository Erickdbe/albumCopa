import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  RPG_POLY_BASE_PATH,
  RPG_POLY_TEXTURE,
  RPG_POLY_FOREST_COLLIDERS,
  RPG_POLY_FOREST_ITEMS,
  RPG_POLY_FOREST_TERRAINS
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

function terrainHeightAt(terrain, x, z) {
  const [originX, , originZ] = terrain.position;
  const [sizeX, , sizeZ] = terrain.size;
  const localX = (x - originX) / sizeX;
  const localZ = (z - originZ) / sizeZ;
  if (localX < 0 || localX > 1 || localZ < 0 || localZ > 1) return null;

  const resolution = terrain.resolution;
  const gridX = localX * (resolution - 1);
  const gridZ = localZ * (resolution - 1);
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(resolution - 1, x0 + 1);
  const z1 = Math.min(resolution - 1, z0 + 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const sample = (sx, sz) => terrain.heights[sz * resolution + sx] ?? terrain.position[1];
  const a = THREE.MathUtils.lerp(sample(x0, z0), sample(x1, z0), tx);
  const b = THREE.MathUtils.lerp(sample(x0, z1), sample(x1, z1), tx);
  return THREE.MathUtils.lerp(a, b, tz);
}

function terrainColorForHeight(y, minY, maxY) {
  const range = Math.max(0.001, maxY - minY);
  const t = THREE.MathUtils.clamp((y - minY) / range, 0, 1);
  const low = new THREE.Color(0x385b2d);
  const mid = new THREE.Color(0x66833d);
  const high = new THREE.Color(0x8d8d82);
  return t < 0.58
    ? low.clone().lerp(mid, t / 0.58)
    : mid.clone().lerp(high, (t - 0.58) / 0.42);
}

function createTerrainMesh(terrain) {
  const resolution = terrain.resolution;
  const [originX, , originZ] = terrain.position;
  const [sizeX, , sizeZ] = terrain.size;
  const positions = [];
  const colors = [];
  const indices = [];

  for (let z = 0; z < resolution; z++) {
    const nz = z / (resolution - 1);
    for (let x = 0; x < resolution; x++) {
      const nx = x / (resolution - 1);
      const index = z * resolution + x;
      const y = terrain.heights[index] ?? 0;
      positions.push(originX + nx * sizeX, y, originZ + nz * sizeZ);
      const color = terrainColorForHeight(y, terrain.minY, terrain.maxY);
      colors.push(color.r, color.g, color.b);
    }
  }

  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = (z + 1) * resolution + x;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      flatShading: true
    })
  );
  mesh.name = `unity-terrain-${terrain.name}`;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function attachRpgPolyForestTerrain(world) {
  if (!RPG_POLY_FOREST_TERRAINS.length) return false;

  const group = new THREE.Group();
  group.name = "unity-rpg-poly-terrain";
  world.root.add(group);
  world.groundRaycastMeshes = world.groundRaycastMeshes || [];
  world.requireExplicitGround = true;

  RPG_POLY_FOREST_TERRAINS.forEach((terrain) => {
    const mesh = createTerrainMesh(terrain);
    group.add(mesh);
    world.groundRaycastMeshes.push(mesh);
  });

  const safeTerrain = RPG_POLY_FOREST_TERRAINS[0];
  const safeY = terrainHeightAt(safeTerrain, 0, 0) ?? safeTerrain.position[1] ?? 0;
  world.safeSpawn = { x: 0, y: safeY + 0.08, z: 0, yaw: 0 };
  return true;
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
