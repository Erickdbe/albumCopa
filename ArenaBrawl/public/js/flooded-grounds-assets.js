import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const FLOODED_ROOT = "./assets/models/flooded-grounds/Content/Meshes/";
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => (/_prev_.*\.tif$/i.test(url) ? TRANSPARENT_PIXEL : url));
const loader = new FBXLoader(loadingManager);
const sourcePromises = new Map();
const tempBox = new THREE.Box3();
const tempSize = new THREE.Vector3();
const tempCenter = new THREE.Vector3();

const MATERIAL_PROFILES = [
  [/grass|bush|nature|leaf/i, { color: 0x314c36, roughness: 0.96 }],
  [/rock|cobble/i, { color: 0x5f655f, roughness: 0.92 }],
  [/water/i, { color: 0x506f78, roughness: 0.28, metalness: 0.05, transparent: true, opacity: 0.64 }],
  [/glass|window|greenhouse/i, { color: 0x91a7a2, roughness: 0.34, transparent: true, opacity: 0.45 }],
  [/church|villa|brick|indbuilding/i, { color: 0x777870, roughness: 0.9 }],
  [/cabin|barn|bridge|fence|wood|dock|pole/i, { color: 0x5a4633, roughness: 0.94 }],
  [/grave|rubble|floodwall/i, { color: 0x6b6b64, roughness: 0.94 }],
  [/car|lamp|smallprops/i, { color: 0x6d6456, roughness: 0.82, metalness: 0.08 }]
];

function profileFor(path, materialName = "", objectName = "") {
  const key = `${path} ${materialName} ${objectName}`;
  return MATERIAL_PROFILES.find(([pattern]) => pattern.test(key))?.[1] || { color: 0x6f6657, roughness: 0.88 };
}

function sourceFor(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!sourcePromises.has(normalized)) {
    sourcePromises.set(normalized, loader.loadAsync(`${FLOODED_ROOT}${normalized}`));
  }
  return sourcePromises.get(normalized);
}

function prepareMaterials(model, relativePath, tint = null) {
  const tintColor = tint == null ? null : new THREE.Color(tint);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const prepared = materials.map((source) => {
      const profile = profileFor(relativePath, source?.name, child.name);
      const material = new THREE.MeshStandardMaterial(profile);
      const profileColor = new THREE.Color(profile.color);
      const sourceColor = source?.color?.clone?.();
      if (sourceColor && sourceColor.r + sourceColor.g + sourceColor.b > 0.18) {
        material.color.copy(profileColor).lerp(sourceColor, 0.18);
      } else {
        material.color.copy(profileColor);
      }
      if (tintColor) material.color.lerp(tintColor, 0.28);
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? prepared : prepared[0];
  });
}

function normalizeModel(model, options = {}) {
  model.updateMatrixWorld(true);
  tempBox.setFromObject(model);
  if (tempBox.isEmpty()) return;
  tempBox.getSize(tempSize);
  let scale = Number(options.scale) || 1;
  if (Number.isFinite(Number(options.targetHeight)) && tempSize.y > 0) {
    scale *= Number(options.targetHeight) / tempSize.y;
  } else if (Number.isFinite(Number(options.targetSize))) {
    const maxSide = Math.max(tempSize.x, tempSize.z, tempSize.y * 0.45);
    if (maxSide > 0) scale *= Number(options.targetSize) / maxSide;
  }
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  tempBox.setFromObject(model);
  tempBox.getCenter(tempCenter);
  model.position.x -= tempCenter.x;
  model.position.z -= tempCenter.z;
  model.position.y -= tempBox.min.y;
}

export function addFloodedCollision(world, x, z, width, depth, topY, yaw = 0, solid = true) {
  const obstacle = {
    type: "obb",
    centerX: x,
    centerZ: z,
    halfX: width / 2,
    halfZ: depth / 2,
    topY,
    yaw,
    solid,
    active: true
  };
  world.obstacles.push(obstacle);
  return obstacle;
}

export function attachFloodedModel(world, relativePath, options = {}) {
  const anchor = new THREE.Group();
  anchor.name = options.name || `flooded-${relativePath.split(/[\\/]/).pop()}`;
  anchor.position.set(Number(options.x) || 0, Number(options.y) || 0, Number(options.z) || 0);
  anchor.rotation.y = Number(options.yaw) || 0;
  world.root.add(anchor);

  if (!world.raycastMeshes) world.raycastMeshes = [];

  sourceFor(relativePath)
    .then((source) => {
      if (!anchor.parent) return;
      const model = source.clone(true);
      prepareMaterials(model, relativePath, options.tint ?? null);
      normalizeModel(model, options);
      anchor.add(model);
      model.traverse((child) => {
        if (!child.isMesh) return;
        child.userData.ignoreRaycast = options.raycast === false;
        if (options.raycast !== false && !world.raycastMeshes.includes(child)) world.raycastMeshes.push(child);
      });
    })
    .catch((error) => {
      console.warn(`Flooded Grounds asset nao carregou: ${relativePath}`, error);
    });

  if (options.collision) {
    const [width, depth, topY = options.targetHeight || 3.5, solid = true] = options.collision;
    addFloodedCollision(world, anchor.position.x, anchor.position.z, width, depth, topY, anchor.rotation.y, solid);
  }

  return anchor;
}
