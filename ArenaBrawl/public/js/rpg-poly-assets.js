import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import {
  FANTASY_MOUNTAIN_BASE_PATH,
  FANTASY_MOUNTAIN_TEXTURES,
  RPG_POLY_BASE_PATH,
  RPG_POLY_TEXTURE,
  RPG_POLY_FOREST_COLLIDERS,
  RPG_POLY_FOREST_ITEMS,
  RPG_POLY_FOREST_TERRAINS
} from "./forest-rpg-poly-data.js";

const assetLoadingManager = new THREE.LoadingManager();
assetLoadingManager.setURLModifier((url) => {
  if (/rpgpp_lt_tex_a\.tga$/i.test(url)) {
    return resolveAssetUrl(`${RPG_POLY_BASE_PATH}${RPG_POLY_TEXTURE}`);
  }
  return url;
});

const fbxLoader = new FBXLoader(assetLoadingManager);
const textureLoader = new THREE.TextureLoader();
const modelCache = new Map();
let texturePromise = null;
const fantasyTextureCache = new Map();
const windUniforms = new Set();
let windTime = 0;
const snapRaycaster = new THREE.Raycaster();
const snapRayOrigin = new THREE.Vector3();
const snapRayDirection = new THREE.Vector3(0, -1, 0);

const GROUND_SURFACE_ASSETS = [
  "rpgpp_lt_terrain_",
  "rpgpp_lt_hill_",
  "rpgpp_lt_mountain_"
];

const NON_SNAPPING_ASSETS = [
  "rpgpp_lt_cloud",
  "rpgpp_lt_sky"
];

function resolveAssetUrl(path) {
  const moduleRelativePath = path.startsWith("./assets/")
    ? `../${path.slice(2)}`
    : path;
  return new URL(moduleRelativePath, import.meta.url).href;
}

function loadAtlasTexture() {
  if (!texturePromise) {
    texturePromise = textureLoader.loadAsync(resolveAssetUrl(`${RPG_POLY_BASE_PATH}${RPG_POLY_TEXTURE}`)).then((texture) => {
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

function loadFantasyTexture(name, repeat = true) {
  const cacheKey = `${name}:${repeat}`;
  if (!fantasyTextureCache.has(cacheKey)) {
    const texture = textureLoader.load(resolveAssetUrl(`${FANTASY_MOUNTAIN_BASE_PATH}textures/${name}`));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    fantasyTextureCache.set(cacheKey, texture);
  }
  return fantasyTextureCache.get(cacheKey);
}

function loadRpgPolyModel(assetName) {
  if (!modelCache.has(assetName)) {
    const promise = Promise.all([
      fbxLoader.loadAsync(resolveAssetUrl(`${RPG_POLY_BASE_PATH}models/${assetName}.fbx`)),
      loadAtlasTexture()
    ]).then(([model, atlas]) => prepareRpgPolyModel(model, atlas));
    modelCache.set(assetName, promise);
  }
  return modelCache.get(assetName);
}

function loadFantasyModel(assetName, modelName) {
  const cacheKey = `holotna:${modelName}`;
  if (!modelCache.has(cacheKey)) {
    const promise = fbxLoader
      .loadAsync(resolveAssetUrl(`${FANTASY_MOUNTAIN_BASE_PATH}models/${modelName}.fbx`))
      .then((model) => prepareFantasyModel(model, assetName));
    modelCache.set(cacheKey, promise);
  }
  return modelCache.get(cacheKey);
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

function fantasyTextureKey(assetName, materialName = "") {
  const token = `${assetName} ${materialName}`.toLowerCase();
  if (token.includes("bridge")) return "bridge";
  if (token.includes("leaf")) return "leaf";
  if (token.includes("trunk")) return "trunk";
  if (token.includes("tree")) return materialName.toLowerCase().includes("leaf") ? "leaf" : "trunk";
  if (token.includes("flower")) return "flower";
  if (token.includes("grass")) return "grass";
  if (token.includes("bush")) return "bush";
  return "rock";
}

function fantasyMaterial(assetName, sourceMaterial) {
  const key = fantasyTextureKey(assetName, sourceMaterial?.name || "");
  const vegetation = /leaf|flower|grass|bush/.test(key);
  const colorMap = loadFantasyTexture(FANTASY_MOUNTAIN_TEXTURES[key], false);
  const material = new THREE.MeshStandardMaterial({
    map: colorMap,
    color: 0xffffff,
    roughness: key === "bridge" ? 0.76 : 0.88,
    metalness: 0,
    side: vegetation ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: vegetation ? 0.32 : 0,
    transparent: false
  });
  if (vegetation) {
    material.emissive.set(key === "flower" ? 0x17221a : 0x101d0b);
    material.emissiveMap = colorMap;
    material.emissiveIntensity = key === "leaf" ? 0.42 : 0.28;
  }
  if (vegetation) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.fantasyWindTime = { value: windTime };
      windUniforms.add(shader.uniforms.fantasyWindTime);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float fantasyWindTime;")
        .replace(
          "#include <begin_vertex>",
          "vec3 transformed = vec3(position);\nfloat windMask = clamp(max(position.y, 0.0) * 0.012, 0.0, 1.0);\nfloat windWave = sin(fantasyWindTime * 1.7 + position.x * 0.035 + position.z * 0.025);\ntransformed.x += windWave * windMask * 1.7;\ntransformed.z += cos(fantasyWindTime * 1.25 + position.x * 0.022) * windMask * 0.65;"
        );
    };
    material.customProgramCacheKey = () => `fantasy-wind-${key}-v1`;
  }
  return material;
}

function lodLevel(object) {
  let current = object;
  while (current) {
    const match = String(current.name || "").match(/(?:^|[_\s-])lod[_\s-]?([0-3])(?:$|[_\s-])/i);
    if (match) return Number(match[1]);
    current = current.parent;
  }
  return null;
}

function prepareFantasyModel(model, assetName) {
  const meshes = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    meshes.push(child);
  });
  const availableLods = [...new Set(meshes.map(lodLevel).filter((value) => value != null))].sort();
  const lightweight = /tree|grass|flower|bush/.test(assetName.toLowerCase());
  const preferredLod = availableLods.includes(lightweight ? 1 : 0)
    ? (lightweight ? 1 : 0)
    : availableLods[0];

  meshes.forEach((child) => {
    const level = lodLevel(child);
    if (level != null && preferredLod != null && level !== preferredLod) {
      child.visible = false;
      return;
    }
    child.castShadow = !/grass|flower/.test(assetName.toLowerCase());
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const replacements = materials.map((material) => fantasyMaterial(assetName, material));
    child.material = Array.isArray(child.material) ? replacements : replacements[0];
    child.geometry?.computeBoundingBox();
    child.geometry?.computeBoundingSphere();
  });
  return model;
}

function loadItemModel(item) {
  return item.pack === "holotna"
    ? loadFantasyModel(item.asset, item.model || item.asset)
    : loadRpgPolyModel(item.model || item.asset);
}

function applyUnityTransform(object, item) {
  const unitScale = item.pack === "holotna" ? 0.01 : 1;
  object.position.set(item.position[0], item.position[1], item.position[2]);
  object.rotation.set(
    THREE.MathUtils.degToRad(item.rotation[0]),
    THREE.MathUtils.degToRad(item.rotation[1]),
    THREE.MathUtils.degToRad(item.rotation[2])
  );
  object.scale.set(item.scale[0] * unitScale, item.scale[1] * unitScale, item.scale[2] * unitScale);
}

function isolateInstanceMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
}

function matrixForItem(item, world, assetName) {
  const transform = new THREE.Object3D();
  applyUnityTransform(transform, item);
  if (shouldSnapToGround(assetName)) {
    const groundY = raycastGroundHeight(world, item.position[0], item.position[2], Math.max(96, (item.position[1] || 0) + 48));
    if (groundY != null && (groundY > transform.position.y + 0.04 || transform.position.y < groundY - 0.12)) {
      transform.position.y = groundY + 0.015;
    }
  }
  transform.updateMatrix();
  return transform.matrix.clone();
}

function createInstancedBatch(source, items, world, assetName) {
  const group = new THREE.Group();
  group.name = `static-batch-${assetName}`;
  source.updateMatrixWorld(true);
  const sourceInverse = source.matrixWorld.clone().invert();
  const itemMatrices = items.map((item) => matrixForItem(item, world, assetName));

  source.traverse((child) => {
    if (!child.isMesh || !child.visible || !child.geometry || !child.material) return;
    const relativeMatrix = sourceInverse.clone().multiply(child.matrixWorld);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material, materialIndex) => {
      let geometry = child.geometry;
      if (materials.length > 1 && child.geometry.groups?.length) {
        const sourceGroup = child.geometry.groups.find((entry) => entry.materialIndex === materialIndex);
        if (!sourceGroup) return;
        geometry = child.geometry.clone();
        geometry.clearGroups();
        geometry.addGroup(sourceGroup.start, sourceGroup.count, 0);
      }
      const instances = new THREE.InstancedMesh(geometry, material, items.length);
      instances.name = `${assetName}-${child.name || "mesh"}-${materialIndex}`;
      instances.castShadow = child.castShadow;
      instances.receiveShadow = child.receiveShadow;
      itemMatrices.forEach((itemMatrix, index) => {
        instances.setMatrixAt(index, itemMatrix.clone().multiply(relativeMatrix));
      });
      instances.instanceMatrix.needsUpdate = true;
      instances.computeBoundingBox();
      instances.computeBoundingSphere();
      group.add(instances);
    });
  });
  return group;
}

function isGroundSurfaceAsset(assetName) {
  const lower = assetName.toLowerCase();
  return GROUND_SURFACE_ASSETS.some((token) => lower.includes(token));
}

function shouldSnapToGround(assetName) {
  const lower = assetName.toLowerCase();
  if (isGroundSurfaceAsset(lower)) return false;
  return !NON_SNAPPING_ASSETS.some((token) => lower.includes(token));
}

function registerGroundSurfaceMeshes(root, world) {
  world.groundRaycastMeshes = world.groundRaycastMeshes || [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.updateMatrixWorld(true);
    if (!world.groundRaycastMeshes.includes(child)) world.groundRaycastMeshes.push(child);
  });
}

function raycastGroundHeight(world, x, z, startY = 96) {
  const meshes = world.groundRaycastMeshes || [];
  if (!meshes.length) return null;

  snapRayOrigin.set(x, startY, z);
  snapRaycaster.set(snapRayOrigin, snapRayDirection);
  snapRaycaster.far = startY + 12;
  const hits = snapRaycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].point.y : null;
}

function snapInstanceToGround(instance, item, world) {
  const x = item.position[0];
  const z = item.position[2];
  const currentY = item.position[1] || 0;
  const groundY = raycastGroundHeight(world, x, z, Math.max(96, currentY + 48));
  if (groundY == null) return;

  const desiredY = groundY + 0.015;
  if (desiredY > instance.position.y + 0.04 || instance.position.y < groundY - 0.12) {
    instance.position.y = desiredY;
  }
}

function adjustedCollider(collider, world) {
  const centerX = (collider.minX + collider.maxX) / 2;
  const centerZ = (collider.minZ + collider.maxZ) / 2;
  const groundY = raycastGroundHeight(world, centerX, centerZ);
  if (groundY == null) return collider;

  const baseY = Math.max(0, collider.minY);
  const offsetY = groundY > baseY + 0.12 ? groundY - baseY : 0;
  if (offsetY <= 0) return collider;

  return {
    ...collider,
    minY: collider.minY + offsetY,
    maxY: collider.maxY + offsetY
  };
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

function createTerrainMaterial() {
  const grass = loadFantasyTexture(FANTASY_MOUNTAIN_TEXTURES.ground[0]);
  const rock = loadFantasyTexture(FANTASY_MOUNTAIN_TEXTURES.ground[1]);
  const dirt = loadFantasyTexture(FANTASY_MOUNTAIN_TEXTURES.ground[2]);
  const material = new THREE.MeshStandardMaterial({
    map: grass,
    color: 0xc8d4b7,
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    flatShading: false
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.terrainRockMap = { value: rock };
    shader.uniforms.terrainDirtMap = { value: dirt };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_pars_fragment>", "#include <map_pars_fragment>\nuniform sampler2D terrainRockMap;\nuniform sampler2D terrainDirtMap;")
      .replace(
        "vec4 sampledDiffuseColor = texture2D( map, vMapUv );",
        "vec4 terrainGrass = texture2D(map, vMapUv);\nvec4 terrainRock = texture2D(terrainRockMap, vMapUv * 0.72);\nvec4 terrainDirt = texture2D(terrainDirtMap, vMapUv * 0.86);\nvec4 sampledDiffuseColor = terrainGrass * vColor.r + terrainRock * vColor.g + terrainDirt * vColor.b;"
      )
      .replace("#include <color_fragment>", "");
  };
  material.customProgramCacheKey = () => "arena-fantasy-terrain-v1";
  return material;
}

export function updateRpgPolyForest(delta) {
  windTime += Math.min(0.05, Math.max(0, delta || 0));
  windUniforms.forEach((uniform) => { uniform.value = windTime; });
}

function createTerrainMesh(terrain) {
  const resolution = terrain.resolution;
  const [originX, , originZ] = terrain.position;
  const [sizeX, , sizeZ] = terrain.size;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];

  for (let z = 0; z < resolution; z++) {
    const nz = z / (resolution - 1);
    for (let x = 0; x < resolution; x++) {
      const nx = x / (resolution - 1);
      const index = z * resolution + x;
      const y = terrain.heights[index] ?? 0;
      positions.push(originX + nx * sizeX, y, originZ + nz * sizeZ);
      uvs.push(nx * 18, nz * 18);
      const surfaceIndex = index * 3;
      if (terrain.surface?.length >= surfaceIndex + 3) {
        colors.push(terrain.surface[surfaceIndex], terrain.surface[surfaceIndex + 1], terrain.surface[surfaceIndex + 2]);
      } else {
        const color = terrainColorForHeight(y, terrain.minY, terrain.maxY);
        colors.push(color.r, color.g, color.b);
      }
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    createTerrainMaterial()
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

  const requestedSpawn = world.safeSpawn || { x: 0, z: 0, yaw: 0 };
  const spawnTerrain = RPG_POLY_FOREST_TERRAINS.find((terrain) => (
    terrainHeightAt(terrain, requestedSpawn.x || 0, requestedSpawn.z || 0) != null
  )) || RPG_POLY_FOREST_TERRAINS[0];
  const safeY = terrainHeightAt(spawnTerrain, requestedSpawn.x || 0, requestedSpawn.z || 0)
    ?? spawnTerrain.position[1]
    ?? 0;
  world.safeSpawn = { ...requestedSpawn, y: safeY + 0.08 };
  return true;
}

export function registerRpgPolyForestCollisions(world) {
  if (world.userData?.rpgPolyCollisionsRegistered) return;
  world.userData = world.userData || {};
  world.userData.rpgPolyCollisionsRegistered = true;

  RPG_POLY_FOREST_COLLIDERS.forEach((rawCollider) => {
    const collider = adjustedCollider(rawCollider, world);
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

    const source = String(collider.source || "").toLowerCase();
    const collisionPadding = source.includes("fence")
      ? 0.1
      : /barrel|crate|bench|sign|lamp/.test(source)
        ? 0.16
        : 0.23;
    const obstacle = {
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
      collisionPadding,
      source: `rpg-poly:${collider.source}`
    };
    world.obstacles.push(obstacle);
    if (collider.destructibleId) {
      const bridge = world.fantasyDestructibleMeshes?.get(collider.destructibleId);
      if (bridge) world.registerDestructible?.(collider.destructibleId, bridge, "bridge", obstacle);
    }
  });
}

export function attachRpgPolyForest(world, options = {}) {
  const anchor = new THREE.Group();
  anchor.name = "unity-rpg-poly-forest";
  world.root.add(anchor);

  world.fantasyDestructibleMeshes = world.fantasyDestructibleMeshes || new Map();
  const batches = new Map();
  RPG_POLY_FOREST_ITEMS.forEach((item) => {
    if (world.requireExplicitGround && isGroundSurfaceAsset(item.asset)) return;
    const key = `${item.pack || "rpg"}:${item.model || item.asset}:${item.asset}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(item);
  });

  Promise.allSettled(
    [...batches.values()].map((items) => (
      loadItemModel(items[0]).then((source) => ({ assetName: items[0].asset, items, source }))
    ))
  ).then((results) => {
    if (!anchor.parent) return;

    const loaded = [];
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        loaded.push(result.value);
      } else {
        console.warn("Nao foi possivel carregar asset RPG Poly:", result.reason);
      }
    });

    const terrainBatches = loaded.filter(({ assetName }) => isGroundSurfaceAsset(assetName));
    const objectBatches = loaded.filter(({ assetName }) => !isGroundSurfaceAsset(assetName));

    terrainBatches.forEach(({ assetName, items, source }) => {
      const group = new THREE.Group();
      group.name = `rpg-poly-${assetName}`;
      items.forEach((item) => {
        const instance = source.clone(true);
        instance.name = item.name || assetName;
        applyUnityTransform(instance, item);
        group.add(instance);
        registerGroundSurfaceMeshes(instance, world);
      });
      anchor.add(group);
    });

    world.root.updateMatrixWorld(true);
    const safeY = raycastGroundHeight(world, world.safeSpawn?.x || 0, world.safeSpawn?.z || 0);
    if (safeY != null) {
      world.safeSpawn = { ...(world.safeSpawn || {}), y: safeY + 0.08 };
    }

    objectBatches.forEach(({ assetName, items, source }) => {
      const group = new THREE.Group();
      group.name = `rpg-poly-${assetName}`;
      const staticItems = items.filter((item) => !item.name?.includes("destructible"));
      const dynamicItems = items.filter((item) => item.name?.includes("destructible"));
      if (staticItems.length) group.add(createInstancedBatch(source, staticItems, world, assetName));
      dynamicItems.forEach((item) => {
        const instance = source.clone(true);
        instance.name = item.name || assetName;
        applyUnityTransform(instance, item);
        isolateInstanceMaterials(instance);
        if (shouldSnapToGround(assetName)) snapInstanceToGround(instance, item, world);
        group.add(instance);
        world.fantasyDestructibleMeshes.set(item.name, instance);
      });
      anchor.add(group);
    });

    options.onReady?.(anchor);
  });

  return anchor;
}
