import * as THREE from "three";
import { MAP_HALF_SIZES, MAP_META, SKETCHBOOK_GROUND_Y } from "./config.js";
import { attachMeshyModel } from "./meshy-assets.js";
import { addFloodedCollision, attachFloodedModel } from "./flooded-grounds-assets.js?v=20260722-2";
import { attachRpgPolyForest, attachRpgPolyForestTerrain, registerRpgPolyForestCollisions, updateRpgPolyForest } from "./rpg-poly-assets.js";
import { attachSketchbookWorld } from "./sketchbook-assets.js";
import { buildUnifiedMap } from "./unified-map.js";

const textureLoader = new THREE.TextureLoader();
const groundTextureCache = new Map();

function getGroundTexture(url, repeat) {
  const cacheKey = `${url}:${repeat}`;
  if (groundTextureCache.has(cacheKey)) return groundTextureCache.get(cacheKey);

  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  groundTextureCache.set(cacheKey, texture);
  return texture;
}

function collisionBox(x, z, w, d, topY, solid = true) {
  return {
    minX: x - w / 2, maxX: x + w / 2,
    minZ: z - d / 2, maxZ: z + d / 2,
    topY, solid, active: true
  };
}

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...options });
}

function addMesh(world, geometry, color, x, y, z, options = {}) {
  const mesh = new THREE.Mesh(geometry, makeMaterial(color, options.material));
  mesh.position.set(x, y, z);
  mesh.rotation.set(options.rotX || 0, options.rotY || 0, options.rotZ || 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  world.root.add(mesh);
  return mesh;
}

function registerDestructible(world, id, mesh, kind, obstacle = null) {
  mesh.userData.destructibleId = id;
  mesh.traverse((child) => { child.userData.destructibleId = id; });
  const materials = [];
  mesh.traverse((child) => {
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.filter(Boolean).forEach((material) => {
      if (material.color) materials.push({ material, color: material.color.clone() });
    });
  });
  world.destructibles.set(id, {
    id, mesh, kind, obstacle, destroyed: false, falling: false,
    damageStage: 0, materials,
    velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    linkedMeshes: [], linkedObstacles: []
  });
  return mesh;
}

function addSolidBox(world, x, z, w, h, d, color, baseY = 0, destructible = null) {
  const mesh = addMesh(world, new THREE.BoxGeometry(w, h, d), color, x, baseY + h / 2, z);
  const obstacle = collisionBox(x, z, w, d, baseY + h, true);
  world.obstacles.push(obstacle);
  if (destructible) registerDestructible(world, destructible.id, mesh, destructible.kind, obstacle);
  return mesh;
}

function addPlatform(world, x, y, z, w, d, color) {
  const mesh = addMesh(world, new THREE.BoxGeometry(w, 0.28, d), color, x, y, z);
  const obstacle = collisionBox(x, z, w, d, y + 0.14, false);
  world.obstacles.push(obstacle);
  return { mesh, obstacle };
}

function addRamp(world, x, z, length, width, height, axis, color, baseY = 0) {
  const steps = Math.max(4, Math.round(height / 0.42));
  for (let i = 0; i < steps; i++) {
    const stepY = baseY + (height / steps) * i;
    const offset = (i - steps / 2) * (length / steps);
    const sx = axis === "x" ? x + offset : x;
    const sz = axis === "z" ? z + offset : z;
    const w = axis === "x" ? length / steps + 0.2 : width;
    const d = axis === "z" ? length / steps + 0.2 : width;
    addPlatform(world, sx, stepY + 0.16, sz, w, d, color);
  }
}

function addLadder(world, options) {
  const { x, z, w, d, height, side = "south", baseY = 0, color = 0x7a6245 } = options;
  const outward = {
    south: { x: 0, z: 1 }, north: { x: 0, z: -1 },
    east: { x: 1, z: 0 }, west: { x: -1, z: 0 }
  }[side] || { x: 0, z: 1 };
  const alongX = outward.z !== 0;
  const faceDistance = alongX ? d / 2 + 0.24 : w / 2 + 0.24;
  const centerX = x + outward.x * faceDistance;
  const centerZ = z + outward.z * faceDistance;
  const ladderWidth = 1.25;
  const railOffset = ladderWidth * 0.46;
  const railGeometry = new THREE.CylinderGeometry(0.065, 0.065, height + 0.35, 8);

  for (const offset of [-railOffset, railOffset]) {
    addMesh(
      world, railGeometry.clone(), color,
      centerX + (alongX ? offset : 0), baseY + height / 2,
      centerZ + (alongX ? 0 : offset), { castShadow: false }
    );
  }
  const rungCount = Math.max(5, Math.floor(height / 0.42));
  for (let i = 0; i <= rungCount; i++) {
    const y = baseY + 0.22 + (height - 0.25) * (i / rungCount);
    const geometry = new THREE.BoxGeometry(alongX ? ladderWidth : 0.1, 0.075, alongX ? 0.1 : ladderWidth);
    addMesh(world, geometry, color, centerX, y, centerZ, { castShadow: false });
  }

  const halfWidth = ladderWidth * 0.72;
  const reach = 0.95;
  world.ladders.push({
    centerX,
    centerZ,
    alongX,
    minX: centerX - (alongX ? halfWidth : reach),
    maxX: centerX + (alongX ? halfWidth : reach),
    minZ: centerZ - (alongX ? reach : halfWidth),
    maxZ: centerZ + (alongX ? reach : halfWidth),
    bottomY: baseY,
    topY: baseY + height + 0.2,
    dismountX: -outward.x * 0.9,
    dismountZ: -outward.z * 0.9
  });
}

function addBoundary(world, color) {
  const half = world.half;
  addSolidBox(world, 0, -half, half * 2, 8, 1, color);
  addSolidBox(world, 0, half, half * 2, 8, 1, color);
  addSolidBox(world, -half, 0, 1, 8, half * 2, color);
  addSolidBox(world, half, 0, 1, 8, half * 2, color);
}

function addInvisibleBoundary(world) {
  const half = world.half;
  world.obstacles.push(
    collisionBox(0, -half, half * 2, 1, 8, true),
    collisionBox(0, half, half * 2, 1, 8, true),
    collisionBox(-half, 0, 1, half * 2, 8, true),
    collisionBox(half, 0, 1, half * 2, 8, true)
  );
}

function addGround(world, color, textureUrl = null, tileSize = 28) {
  const material = textureUrl
    ? { map: getGroundTexture(textureUrl, (world.half * 2) / tileSize) }
    : undefined;
  const ground = addMesh(
    world,
    new THREE.PlaneGeometry(world.half * 2, world.half * 2),
    color, 0, -0.03, 0,
    { rotX: -Math.PI / 2, castShadow: false, material }
  );
  ground.receiveShadow = true;
  world.groundRaycastMeshes = world.groundRaycastMeshes || [];
  world.groundRaycastMeshes.push(ground);
}

function addClimbableBuilding(world, options) {
  const { x, z, w, d, h, wallColor, roofColor, stairSide = "south", destructiblePrefix = "" } = options;
  const id = destructiblePrefix ? `${destructiblePrefix}-core` : null;
  addSolidBox(world, x, z, w, h, d, wallColor, 0, id ? { id, kind: "building" } : null);
  const roof = addPlatform(world, x, h + 0.18, z, w + 0.5, d + 0.5, roofColor);
  if (id) {
    roof.mesh.userData.destructibleId = id;
    const core = world.destructibles.get(id);
    core.linkedMeshes.push(roof.mesh);
    core.linkedObstacles.push(roof.obstacle);
  }

  addLadder(world, { x, z, w, d, height: h, side: stairSide, color: 0x66533f });

  const floors = Math.max(1, Math.floor(h / 3.1));
  for (let floor = 0; floor < floors; floor++) {
    const y = 2.1 + floor * 2.8;
    const columns = Math.max(2, Math.floor(w / 3.2));
    for (let column = 0; column < columns; column++) {
      const px = x - w * 0.34 + (columns === 1 ? 0 : column * (w * 0.68 / (columns - 1)));
      addMesh(world, new THREE.BoxGeometry(1.15, 1.05, 0.08), 0x78c6d8, px, y, z - d / 2 - 0.065, {
        castShadow: false,
        material: { emissive: 0x102a32, roughness: 0.35 }
      });
      addMesh(world, new THREE.BoxGeometry(1.15, 1.05, 0.08), 0x78c6d8, px, y, z + d / 2 + 0.065, {
        castShadow: false,
        material: { emissive: 0x102a32, roughness: 0.35 }
      });
    }
  }

  if (h > 7) {
    addMesh(world, new THREE.BoxGeometry(w * 0.72, 0.22, 0.18), 0xffd56b, x, 1.15, z - d / 2 - 0.12, {
      castShadow: false,
      material: { emissive: 0x372400 }
    });
  }

  if (destructiblePrefix) {
    const pieces = [
      [-w * 0.28, h * 0.72, d / 2 + 0.05, 0], [w * 0.28, h * 0.72, d / 2 + 0.05, 0],
      [-w * 0.28, h * 0.35, -d / 2 - 0.05, 0], [w * 0.28, h * 0.35, -d / 2 - 0.05, 0]
    ];
    pieces.forEach(([ox, y, oz], index) => {
      const panel = addMesh(world, new THREE.BoxGeometry(w * 0.42, h * 0.28, 0.18), index % 2 ? 0x737b84 : 0x8c949d, x + ox, y, z + oz);
      registerDestructible(world, `${destructiblePrefix}-panel-${index}`, panel, "building-piece");
    });
  }
}

function addTree(world, x, z, scale = 1, large = false) {
  const height = (large ? 11 : 6.5) * scale;
  const radius = (large ? 1.35 : 0.7) * scale;
  const trunk = addMesh(world, new THREE.CylinderGeometry(radius * 0.75, radius, height, 9), 0x654326, x, height / 2, z);
  world.obstacles.push(collisionBox(x, z, radius * 1.5, radius * 1.5, height, true));
  const crown = addMesh(world, new THREE.IcosahedronGeometry((large ? 4.5 : 2.7) * scale, 1), large ? 0x285f31 : 0x34743a, x, height + 1.8 * scale, z);
  world.animated.trees.push({ trunk, crown, phase: (x * 0.13 + z * 0.07) % Math.PI });
  return { trunk, crown, height, radius };
}

function addTreeHouse(world, x, z, rotation = 0) {
  const tree = addTree(world, x, z, 1.2, true);
  const level = tree.height * 0.72;
  addPlatform(world, x, level, z, 8.5, 7.5, 0x624025);
  addSolidBox(world, x, z, 5.5, 3.3, 4.5, 0x91623a, level, null);
  addMesh(world, new THREE.ConeGeometry(4.4, 2.5, 4), 0x3f2a1a, x, level + 4.5, z, { rotY: Math.PI / 4 });
  addPlatform(world, x + Math.cos(rotation) * 5.5, level + 0.1, z + Math.sin(rotation) * 5.5, 5.5, 1.4, 0x76502f);
  const bridgeSide = Math.abs(Math.cos(rotation)) > Math.abs(Math.sin(rotation))
    ? (Math.cos(rotation) >= 0 ? "east" : "west")
    : (Math.sin(rotation) >= 0 ? "south" : "north");
  const ladderSide = { east: "west", west: "east", north: "south", south: "north" }[bridgeSide];
  addLadder(world, { x, z, w: 8.5, d: 7.5, height: level, side: ladderSide, color: 0x6c4a2d });
}

function addMountain(world, x, z, radius, height, color = 0x53604d) {
  const mesh = addMesh(world, new THREE.ConeGeometry(radius, height, 8), color, x, height / 2 - 0.1, z, { rotY: Math.PI / 8 });
  mesh.receiveShadow = true;
  world.obstacles.push(collisionBox(x, z, radius * 1.25, radius * 1.25, height * 0.72, true));
}

function addForestTrail(world, x, z, w, d, rotation = 0, color = 0x7f6a42) {
  const trail = addMesh(world, new THREE.PlaneGeometry(w, d), color, x, 0.012, z, {
    rotX: -Math.PI / 2,
    rotZ: rotation,
    castShadow: false,
    receiveShadow: true,
    material: { roughness: 0.96 }
  });
  trail.renderOrder = -1;
  return trail;
}

function addPineTree(world, x, z, scale = 1) {
  const trunkHeight = 4.2 * scale;
  const trunk = addMesh(world, new THREE.CylinderGeometry(0.45 * scale, 0.62 * scale, trunkHeight, 8), 0x674423, x, trunkHeight / 2, z);
  const tiers = 3 + Math.floor(scale);
  for (let i = 0; i < tiers; i++) {
    addMesh(world, new THREE.ConeGeometry((2.9 - i * 0.35) * scale, 3.4 * scale, 8), i % 2 ? 0x2f713a : 0x276334,
      x, trunkHeight + 0.7 * scale + i * 1.45 * scale, z, { rotY: (i * Math.PI) / 8 });
  }
  world.obstacles.push(collisionBox(x, z, 1.5 * scale, 1.5 * scale, trunkHeight + tiers * 1.35 * scale, true));
  world.animated.trees.push({ trunk, crown: trunk, phase: (x * 0.11 + z * 0.09) % Math.PI });
}

function addForestCabin(world, x, z, rotation = 0, id = "") {
  const prefix = id || `forest-cabin-${Math.round(x)}-${Math.round(z)}`;
  const body = addSolidBox(world, x, z, 10, 5.2, 8, 0x9c6a3b, 0, { id: `${prefix}-body`, kind: "building" });
  body.rotation.y = rotation;
  const roof = addMesh(world, new THREE.ConeGeometry(7.4, 3.6, 4), 0x4b2d1c, x, 6.95, z, { rotY: rotation + Math.PI / 4 });
  const core = world.destructibles.get(`${prefix}-body`);
  if (core) core.linkedMeshes.push(roof);
  addMesh(world, new THREE.BoxGeometry(1.9, 2.6, 0.16), 0x2d1f17, x + Math.sin(rotation) * 4.08, 1.45, z + Math.cos(rotation) * 4.08, {
    rotY: rotation,
    castShadow: false
  });
  [-2.7, 2.7].forEach((offset) => {
    addMesh(world, new THREE.BoxGeometry(1.45, 1.15, 0.14), 0xffd77a,
      x + Math.cos(rotation) * offset - Math.sin(rotation) * 4.12,
      2.75,
      z - Math.sin(rotation) * offset + Math.cos(rotation) * 4.12,
      { rotY: rotation, castShadow: false, material: { emissive: 0x332000, roughness: 0.5 } });
  });
  addLadder(world, { x, z, w: 10, d: 8, height: 5.4, side: Math.cos(rotation) > 0 ? "west" : "east", color: 0x6d4a2f });
}

function addWatchTower(world, x, z, rotation = 0, id = "") {
  const topY = 8.6;
  const legGeometry = new THREE.CylinderGeometry(0.18, 0.28, topY, 7);
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    addMesh(world, legGeometry.clone(), 0x6b4a2d, x + sx * 2.4, topY / 2, z + sz * 2.4, { rotZ: sx * 0.06, rotX: sz * 0.06 });
  }));
  addPlatform(world, x, topY, z, 7.4, 7.4, 0x76502f);
  addMesh(world, new THREE.ConeGeometry(5.6, 2.8, 4), 0x3f2a1a, x, topY + 2.0, z, { rotY: rotation + Math.PI / 4 });
  addLadder(world, { x, z, w: 7.4, d: 7.4, height: topY, side: "south", color: 0x6d4a2f });
  const obstacle = collisionBox(x, z, 4.4, 4.4, topY, true);
  world.obstacles.push(obstacle);
  if (id) registerDestructible(world, id, world.root.children[world.root.children.length - 1], "tower", obstacle);
}

function addFenceLine(world, x1, z1, x2, z2, count, color = 0x6f4b2d) {
  const angle = Math.atan2(z2 - z1, x2 - x1);
  for (let i = 0; i <= count; i++) {
    const t = count ? i / count : 0;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    addMesh(world, new THREE.BoxGeometry(3.4, 1.25, 0.18), color, x, 0.72, z, { rotY: -angle, castShadow: true });
  }
}

function addForestRockCluster(world, x, z, scale = 1) {
  const colors = [0x72766e, 0x5d655c, 0x83877f];
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI * 0.55;
    const distance = (i ? 1.5 : 0.1) * scale;
    addMesh(world, new THREE.DodecahedronGeometry((1.2 + (i % 2) * 0.45) * scale, 0), colors[i % colors.length],
      x + Math.cos(angle) * distance, 0.85 * scale, z + Math.sin(angle) * distance, { rotY: i * 0.4 });
  }
  world.obstacles.push(collisionBox(x, z, 4.4 * scale, 3.8 * scale, 2.5 * scale, true));
}

function addFallenLog(world, x, z, length = 8, rotation = 0) {
  addMesh(world, new THREE.CylinderGeometry(0.7, 0.85, length, 9), 0x6b4426, x, 0.75, z, {
    rotZ: Math.PI / 2,
    rotY: rotation
  });
  const width = Math.abs(Math.cos(rotation)) * length + Math.abs(Math.sin(rotation)) * 1.8 + 1.4;
  const depth = Math.abs(Math.sin(rotation)) * length + Math.abs(Math.cos(rotation)) * 1.8 + 1.4;
  world.obstacles.push(collisionBox(x, z, width, depth, 1.55, true));
}

function addPalm(world, x, z, scale = 1) {
  const trunkHeight = 5.5 * scale;
  addMesh(world, new THREE.CylinderGeometry(0.32 * scale, 0.45 * scale, trunkHeight, 8), 0x8c5d2c, x, trunkHeight / 2, z, {
    rotZ: 0.1 * Math.sin(x + z)
  });
  world.obstacles.push(collisionBox(x, z, 1.1 * scale, 1.1 * scale, trunkHeight, true));
  for (let i = 0; i < 7; i++) {
    const leaf = addMesh(world, new THREE.BoxGeometry(0.42 * scale, 0.16 * scale, 4.8 * scale), 0x3a9f42, x, trunkHeight + 0.55 * scale, z, {
      rotY: i * Math.PI * 2 / 7,
      rotX: 0.22,
      castShadow: false
    });
    leaf.position.x += Math.sin(leaf.rotation.y) * 1.8 * scale;
    leaf.position.z += Math.cos(leaf.rotation.y) * 1.8 * scale;
  }
}

function addRoadStripe(world, x, z, w, d, color = 0xf3d45b) {
  addMesh(world, new THREE.BoxGeometry(w, 0.035, d), color, x, 0.08, z, {
    castShadow: false,
    receiveShadow: false,
    material: { emissive: 0x2c2400, roughness: 0.65 }
  });
}

function addBeachCabana(world, x, z, rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  world.root.add(group);
  addMesh(world, new THREE.BoxGeometry(4.8, 0.35, 3.5), 0xd6a24a, x, 1.9, z, { rotY: rotation });
  addMesh(world, new THREE.BoxGeometry(0.28, 2.2, 0.28), 0x835126, x - Math.cos(rotation) * 1.8, 1.1, z - Math.sin(rotation) * 1.8);
  addMesh(world, new THREE.BoxGeometry(0.28, 2.2, 0.28), 0x835126, x + Math.cos(rotation) * 1.8, 1.1, z + Math.sin(rotation) * 1.8);
  addMesh(world, new THREE.BoxGeometry(4.9, 0.16, 3.6), 0x3fb6df, x, 2.35, z, { rotY: rotation, rotZ: 0.08 });
  world.obstacles.push(collisionBox(x, z, 5.2, 3.8, 2.45, true));
}

function addFlowerPatch(world, x, z, radius = 3, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399;
    const distance = radius * (0.25 + ((i * 37) % 100) / 130);
    addMesh(world, new THREE.IcosahedronGeometry(0.18 + (i % 3) * 0.04, 0), i % 2 ? 0xff70ac : 0xffd15e,
      x + Math.cos(angle) * distance, 0.16, z + Math.sin(angle) * distance, { castShadow: false });
  }
}

function addLampPost(world, id, x, z, rotY = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 5.8, 9), makeMaterial(0x34383d, { metalness: 0.65 }));
  pole.position.y = 2.9;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.13), makeMaterial(0x34383d));
  arm.position.set(0.65, 5.65, 0);
  group.add(arm);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.35), makeMaterial(0xffe8a0, { emissive: 0x554411 }));
  lamp.position.set(1.3, 5.48, 0);
  group.add(lamp);
  world.root.add(group);
  const obstacle = collisionBox(x, z, 0.45, 0.45, 5.8, true);
  world.obstacles.push(obstacle);
  registerDestructible(world, id, group, "lamp", obstacle);
}

function createWorld(mapId, scene) {
  const root = new THREE.Group();
  root.name = `world-${mapId}`;
  scene.add(root);
  const world = {
    mapId, scene, root, half: MAP_HALF_SIZES[mapId], obstacles: [], ladders: [], destructibles: new Map(),
    groundRaycastMeshes: [], raycastMeshes: [], safeSpawn: { x: 0, y: 0, z: 0, yaw: 0 },
    animated: { trees: [], waves: [], sharks: [], debris: [], craters: [], elapsed: 0 },
    water: null, tsunami: null, tornado: null, event: null
  };
  world.registerDestructible = (id, mesh, kind, obstacle = null) => registerDestructible(world, id, mesh, kind, obstacle);
  return world;
}

function addMeshyLandmark(world, assetName, x, z, options = {}) {
  const anchor = new THREE.Group();
  anchor.position.set(x, options.y || 0, z);
  world.root.add(anchor);
  attachMeshyModel(anchor, assetName, {
    targetHeight: options.height,
    targetSize: options.size,
    rotation: [0, options.rotation || 0, 0],
    hideExisting: false
  });
  if (options.collision) {
    const [width, depth, topY = options.height || 4] = options.collision;
    world.obstacles.push(collisionBox(x, z, width, depth, topY, true));
  }
  return anchor;
}

function buildPraia(scene) {
  const world = createWorld("praia", scene);
  const meta = MAP_META.praia;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 105, 285);
  addGround(world, 0xffffff, "./assets/textures/beach-sand.jpg", 26);
  addBoundary(world, 0x89764d);

  world.water = addMesh(world, new THREE.PlaneGeometry(world.half * 2 - 2, 92, 36, 12), 0x238fd0, 0, 0.02, 79, {
    rotX: -Math.PI / 2, castShadow: false,
    material: { transparent: true, opacity: 0.82, metalness: 0.05, roughness: 0.24 }
  });

  for (let i = 0; i < 10; i++) {
    const wave = addMesh(world, new THREE.BoxGeometry(world.half * 1.92, 0.18, 0.8), 0x8edbf2, 0, 0.16, 38 + i * 8.5, {
      castShadow: false, material: { transparent: true, opacity: 0.58 }
    });
    world.animated.waves.push({ mesh: wave, phase: i * 0.8 });
  }

  for (let i = 0; i < 3; i++) {
    const shark = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.2, 5, 10), makeMaterial(0x405662));
    body.rotation.z = Math.PI / 2;
    shark.add(body);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 3), makeMaterial(0x344854));
    fin.position.y = 0.55;
    shark.add(fin);
    world.root.add(shark);
    world.animated.sharks.push({ mesh: shark, radius: 22 + i * 9, speed: 0.18 + i * 0.04, phase: i * 2.1 });
  }

  world.tsunami = addMesh(world, new THREE.BoxGeometry(world.half * 2, 1, 6), 0x3cb9df, 0, -8, world.half - 4, {
    castShadow: false, material: { transparent: true, opacity: 0.78, roughness: 0.18 }
  });
  world.tsunami.visible = false;

  addSolidBox(world, 0, -10, 19, 2.4, 19, 0xd8c16f);
  addRamp(world, 0, -25, 12, 5, 2.4, "z", 0xd8c16f);
  addRamp(world, 0, 8, 10, 5, 2.1, "z", 0xd8c16f);

  for (let i = 0; i < 28; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * (28 + (i % 7) * 13);
    const z = -70 + Math.floor(i / 7) * 28 + Math.sin(i) * 3;
    addPalm(world, x, z, 0.85 + (i % 4) * 0.12);
  }

  [[-84,-70],[-55,-88],[-22,-82],[24,-86],[58,-72],[92,-55],[-92,-18],[88,-16]].forEach(([x,z],i)=>{
    addClimbableBuilding(world,{x,z,w:9,d:8,h:4.4,wallColor:i%2?0xd7e0d0:0xf1d6a2,roofColor:i%2?0x3975a9:0xb34d42,stairSide:i%2?"west":"east"});
  });
  addMeshyLandmark(world,"house",86,-38,{height:6.8,rotation:-0.45,collision:[8.5,8,6.8]});
  addMeshyLandmark(world,"house",-94,-44,{height:6.2,rotation:0.35,collision:[8.2,7.8,6.2]});

  [[-74,12],[74,18],[-96,3],[98,-6],[-34,30],[42,34]].forEach(([x,z])=>addSolidBox(world,x,z,3.2,2,3.2,0x888b8c));
  for(let i=0;i<18;i++) addPlatform(world,-28+i*3.3,0.24,47+i*0.35,3.25,2.2,0x76502f);
  for(let i=0;i<9;i++) addPlatform(world,-8+i*2.2,0.32,67,2.2,4.2,0x76502f);
  [-72,-42,-12,18,48,78].forEach((x,i)=>addBeachCabana(world,x,-38 + (i % 2) * 12,i*0.18));
  [[-62,-4],[62,-2],[-35,-55],[36,-58],[0,-72]].forEach(([x,z],i)=>addFlowerPatch(world,x,z,2.4+i%2,8));
  return world;
}

function buildCidade(scene) {
  const world = createWorld("cidade", scene);
  const meta = MAP_META.cidade;
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 115, 275);
  addGround(world, 0x62676c);
  addBoundary(world, 0x25292e);

  const roadMat = makeMaterial(0x30343a, { roughness: 0.94 });
  [-78,-39,0,39,78].forEach((x)=>{
    const road=new THREE.Mesh(new THREE.PlaneGeometry(12,world.half*2),roadMat);road.rotation.x=-Math.PI/2;road.position.set(x,0.02,0);world.root.add(road);
    for(let z=-100;z<=100;z+=16)addRoadStripe(world,x,z,0.5,5.5);
  });
  [-78,-39,0,39,78].forEach((z)=>{
    const road=new THREE.Mesh(new THREE.PlaneGeometry(world.half*2,12),roadMat);road.rotation.x=-Math.PI/2;road.position.set(0,0.025,z);world.root.add(road);
    for(let x=-100;x<=100;x+=16)addRoadStripe(world,x,z,5.5,0.5);
  });

  const buildings=[
    [-101,-100,13,12,16],[-58,-100,14,12,21],[-20,-100,13,12,13],[20,-100,14,12,19],[58,-100,13,12,14],[101,-100,12,12,22],
    [-101,-58,13,14,11],[-58,-58,15,14,25],[58,-58,15,14,18],[101,-58,13,14,15],
    [-101,-20,13,14,20],[-58,-20,15,14,14],[58,-20,15,14,24],[101,-20,13,14,12],
    [-101,20,13,14,12],[-58,20,15,14,22],[58,20,15,14,13],[101,20,13,14,19],
    [-101,58,13,14,18],[-58,58,15,14,15],[58,58,15,14,26],[101,58,13,14,14],
    [-101,100,13,12,22],[-58,100,14,12,14],[-20,100,13,12,18],[20,100,14,12,13],[58,100,13,12,20],[101,100,12,12,16]
  ];
  buildings.forEach(([x,z,w,d,h],i)=>addClimbableBuilding(world,{
    x,z,w,d,h,wallColor:i%3===0?0x89939c:i%3===1?0xa28f78:0x77838d,roofColor:0x353a40,
    stairSide:i%2?"east":"west",destructiblePrefix:`city-building-${i}`
  }));
  addMeshyLandmark(world,"house",-24,-24,{height:8.5,rotation:0.75,collision:[8,8,8.5]});
  addMeshyLandmark(world,"house",24,24,{height:8.2,rotation:-0.4,collision:[8,8,8.2]});
  addSolidBox(world, 0, 0, 22, 1.2, 22, 0x48613c);
  addPlatform(world, 0, 1.05, 0, 16, 16, 0x567348);
  addTree(world, -8, -8, 0.65, false);
  addTree(world, 8, 8, 0.65, false);
  addTree(world, -8, 8, 0.65, false);
  addTree(world, 8, -8, 0.65, false);

  let lampIndex=0;
  [-102,-82,-60,-42,-22,-8,8,22,42,60,82,102].forEach((n)=>{
    addLampPost(world,`city-lamp-${lampIndex++}`,n,-7,0);
    addLampPost(world,`city-lamp-${lampIndex++}`,n,7,Math.PI);
    if(Math.abs(n)>10){addLampPost(world,`city-lamp-${lampIndex++}`,-7,n,Math.PI/2);addLampPost(world,`city-lamp-${lampIndex++}`,7,n,-Math.PI/2);}
  });
  [[-34,-34],[34,34],[-34,34],[34,-34],[-78,0],[78,0],[0,-78],[0,78]].forEach(([x,z],index)=>addSolidBox(
    world,x,z,index<4?10:13,2.3,0.7,0x555b62,0,{id:`city-barrier-${index}`,kind:"barrier"}
  ));
  addPlatform(world, -39, 10.8, -39, 27, 2.1, 0x46505a);
  addPlatform(world, 39, 13.2, 39, 27, 2.1, 0x46505a);
  addRamp(world, -39, -52, 18, 4, 5.8, "z", 0x4b555e);
  addRamp(world, 39, 52, 18, 4, 5.8, "z", 0x4b555e);
  return world;
}

function buildFloresta(scene) {
  const world = createWorld("floresta", scene);
  const meta = MAP_META.floresta;
  world.requireExplicitGround = true;
  world.safeSpawn = { x: -54, y: 0, z: -78, yaw: 0.62 };
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 108, 350);
  const hasUnityTerrain = attachRpgPolyForestTerrain(world);
  if (!hasUnityTerrain) addGround(world, 0x4d6b3f);
  addBoundary(world, 0x243421);
  attachRpgPolyForest(world, {
    onReady: () => registerRpgPolyForestCollisions(world)
  });

  const motePositions = [];
  for (let i = 0; i < 140; i++) {
    const angle = i * 2.39996;
    const radius = 14 + (i % 23) * 4.7;
    motePositions.push(Math.cos(angle) * radius, 1.2 + (i % 9) * 0.56, Math.sin(angle) * radius);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute("position", new THREE.Float32BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({
    color: 0xffe8a6, size: 0.085, transparent: true, opacity: 0.52,
    depthWrite: false, blending: THREE.AdditiveBlending
  }));
  motes.name = "fantasy-forest-motes";
  world.root.add(motes);
  world.animated.motes = motes;

  world.tornado = new THREE.Group();
  for(let i=0;i<9;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.1+i*0.35,0.12,6,20),makeMaterial(0xaab7a7,{transparent:true,opacity:0.35}));
    ring.rotation.x=Math.PI/2;ring.position.y=i*1.25;world.tornado.add(ring);
  }
  world.tornado.visible=false;world.root.add(world.tornado);
  return world;
}

function seeded(index) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function localPoint(x, z, yaw, ox, oz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x + c * ox - s * oz, z: z + s * ox + c * oz };
}

function addRotatedBox(world, x, z, w, h, d, color, yaw = 0, baseY = 0, options = {}) {
  const mesh = addMesh(world, new THREE.BoxGeometry(w, h, d), color, x, baseY + h / 2, z, {
    rotY: yaw,
    material: options.material || {},
    castShadow: options.castShadow !== false,
    receiveShadow: options.receiveShadow !== false
  });
  if (options.collision !== false) addFloodedCollision(world, x, z, w, d, baseY + h, yaw, options.solid !== false);
  return mesh;
}

function addPuddle(world, x, z, w, d, yaw = 0, color = 0x425f64) {
  const puddle = addMesh(world, new THREE.PlaneGeometry(w, d, 4, 4), color, x, 0.018, z, {
    rotX: -Math.PI / 2,
    rotZ: yaw,
    castShadow: false,
    receiveShadow: false,
    material: { transparent: true, opacity: 0.48, roughness: 0.22, metalness: 0.05 }
  });
  puddle.userData.ignoreRaycast = true;
  world.animated.swampWater ||= [];
  world.animated.swampWater.push({ mesh: puddle, phase: (x * 0.17 + z * 0.09) % Math.PI });
  return puddle;
}

function attachFloodedLocal(world, asset, x, z, yaw, ox, oz, options = {}) {
  const point = localPoint(x, z, yaw, ox, oz);
  const localYaw = Number(options.localYaw) || 0;
  return attachFloodedModel(world, asset, {
    ...options,
    x: point.x,
    z: point.z,
    y: Number(options.y) || 0,
    yaw: yaw + localYaw
  });
}

function addFloodedLocalBox(world, x, z, yaw, ox, oz, w, h, d, color, baseY = 0, options = {}) {
  const point = localPoint(x, z, yaw, ox, oz);
  return addRotatedBox(world, point.x, point.z, w, h, d, color, yaw + (Number(options.localYaw) || 0), baseY, options);
}

function addMuddyTrack(world, x, z, length, width, yaw, color = 0x5b5038) {
  const track = addMesh(world, new THREE.PlaneGeometry(width, length), color, x, 0.022, z, {
    rotX: -Math.PI / 2,
    rotZ: yaw,
    castShadow: false,
    receiveShadow: true,
    material: { roughness: 1, transparent: true, opacity: 0.92 }
  });
  track.userData.ignoreRaycast = true;
  return track;
}

function addFloodedFenceLine(world, x1, z1, x2, z2, count, brokenEvery = 4) {
  const angle = Math.atan2(z2 - z1, x2 - x1);
  for (let i = 0; i <= count; i++) {
    if (brokenEvery && i % brokenEvery === brokenEvery - 1) continue;
    const t = count ? i / count : 0;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    const asset = i % 3 === 0
      ? "mBuildings/mStructures/Struct_Fence1_Mid_C.fbx"
      : i % 2
        ? "mBuildings/mStructures/Struct_Fence1_Mid_B.fbx"
        : "mBuildings/mStructures/Struct_Fence1_Mid_A.fbx";
    attachFloodedModel(world, asset, {
      x, z,
      yaw: angle + Math.PI / 2 + (i % 5 === 0 ? 0.08 : 0),
      targetSize: 3.8,
      raycast: false
    });
    addFloodedCollision(world, x, z, 3.4, 0.38, 1.25, angle, true);
  }
}

function addFloodedUtilityPole(world, x, z, yaw = 0) {
  attachFloodedModel(world, "mBuildings/mStructures/Struct_Pole_A.fbx", {
    x, z, yaw, targetHeight: 7.2, collision: [0.55, 0.55, 7.2], tint: 0x5e5142
  });
  const arm = addMesh(world, new THREE.BoxGeometry(3.8, 0.12, 0.12), 0x2d2923, x, 5.8, z, { rotY: yaw, castShadow: true });
  arm.userData.ignoreRaycast = true;
}

function addFloodedCabin(world, x, z, yaw = 0, variant = 0) {
  const asset = variant % 3 === 1
    ? "mBuildings/mCabins/Cabin1_DM.fbx"
    : variant % 3 === 2
      ? "mBuildings/mCabins/Outhouse_A.fbx"
      : "mBuildings/mCabins/Cabin1.fbx";
  const size = variant % 3 === 2 ? 4.8 : 10.4;
  attachFloodedModel(world, asset, {
    x, z, yaw, targetSize: size, collision: [size * 0.9, size * 0.75, variant % 3 === 2 ? 3.6 : 5.1],
    tint: variant % 2 ? 0x5a594b : 0x554736
  });
  if (variant % 3 !== 2) {
    attachFloodedLocal(world, "mBuildings/mCabins/Cabin1_Stairs.fbx", x, z, yaw, 0, 4.5, {
      targetSize: 4.2,
      raycast: false
    });
    const wetStep = localPoint(x, z, yaw, -3.8, 5.8);
    addPuddle(world, wetStep.x, wetStep.z, 3.4, 1.5, yaw + 0.25);
  }
}

function addFloodedInteriorCabin(world, x, z, yaw = 0) {
  const width = 9.4;
  const depth = 7.8;
  const wallHeight = 3.05;
  const wall = 0.32;
  const wood = 0x4f4333;
  const dampWood = 0x38372e;
  addFloodedLocalBox(world, x, z, yaw, 0, 0, width, 0.16, depth, 0x332d23, 0, {
    collision: false,
    material: { roughness: 0.96 }
  });
  addFloodedLocalBox(world, x, z, yaw, 0, depth / 2, width, wallHeight, wall, wood, 0.12);
  addFloodedLocalBox(world, x, z, yaw, -width / 2, 0, wall, wallHeight, depth, dampWood, 0.12);
  addFloodedLocalBox(world, x, z, yaw, width / 2, 0, wall, wallHeight, depth, dampWood, 0.12);
  addFloodedLocalBox(world, x, z, yaw, -3.1, -depth / 2, 3.0, wallHeight, wall, wood, 0.12);
  addFloodedLocalBox(world, x, z, yaw, 3.25, -depth / 2, 2.9, wallHeight, wall, wood, 0.12);
  addFloodedLocalBox(world, x, z, yaw, 0, 0, width + 0.85, 0.34, depth + 0.85, 0x25231f, wallHeight + 0.24, {
    collision: false,
    material: { roughness: 0.94 }
  });
  attachFloodedLocal(world, "mBuildings/mCabins/Cabin1_Door_A.fbx", x, z, yaw, 0, -depth / 2 - 0.18, {
    targetHeight: 2.25,
    y: 0.08,
    raycast: false,
    tint: 0x5c4a34
  });
  attachFloodedLocal(world, "mBuildings/mCabins/Cabin1_Deco_WindowGlass_A.fbx", x, z, yaw, -3.15, -depth / 2 - 0.2, {
    targetHeight: 1.05,
    y: 1.48,
    raycast: false
  });
  attachFloodedLocal(world, "mProps/lo_Prop_Bed_A.fbx", x, z, yaw, -2.85, 1.8, {
    targetSize: 2.5,
    localYaw: Math.PI / 2,
    raycast: false,
    tint: 0x5a5148
  });
  attachFloodedLocal(world, "mProps/lo_Prop_Cabinet_A.fbx", x, z, yaw, 3.25, 1.7, {
    targetHeight: 1.75,
    localYaw: -Math.PI / 2,
    raycast: false,
    tint: 0x554734
  });
  attachFloodedLocal(world, "mProps/lo_Prop_SmallTable_A.fbx", x, z, yaw, 1.3, -0.8, {
    targetSize: 1.4,
    raycast: false,
    tint: 0x4a3e30
  });
  const step = localPoint(x, z, yaw, 0, -depth / 2 - 1.25);
  addPuddle(world, step.x, step.z, 2.9, 1.25, yaw - 0.08);
}

function addFloodedMansion(world, x, z, yaw = 0) {
  addFloodedCollision(world, x, z, 27, 21, 9.2, yaw, true);

  [-8, 0, 8].forEach((offset) => {
    attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Base_Mid_A.fbx", x, z, yaw, offset, -2.5, {
      targetSize: 8.4,
      tint: 0x62645d
    });
    attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Floor_Mid_A.fbx", x, z, yaw, offset, 3.8, {
      targetSize: 8.7,
      y: 4.1,
      tint: 0x5d6058
    });
  });
  [-12, 12].forEach((offset) => {
    attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Wall_Cor_A.fbx", x, z, yaw, offset, -4.5, {
      targetHeight: 5.6,
      tint: 0x686a62
    });
  });

  const wallAssets = [
    "mBuildings/mVilla1/Villa1_Wall_Mid_A.fbx",
    "mBuildings/mVilla1/Villa1_Wall_Mid_B.fbx",
    "mBuildings/mVilla1/Villa1_Wall_Mid_C.fbx"
  ];
  [-9, -3, 3, 9].forEach((offset, index) => {
    attachFloodedLocal(world, wallAssets[index % wallAssets.length], x, z, yaw, offset, -10.1, {
      targetHeight: 5.6,
      tint: 0x6b6d63
    });
    attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Deco_WindowGlass_A.fbx", x, z, yaw, offset, -10.35, {
      targetHeight: 2.2,
      y: 2.5,
      raycast: false
    });
  });
  [-8, 0, 8].forEach((offset) => {
    attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Roof_Mid_A.fbx", x, z, yaw, offset, 0, {
      targetSize: 9.4,
      y: 8.7,
      tint: 0x34312b,
      raycast: false
    });
  });
  attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Base_Stairs_A.fbx", x, z, yaw, 0, -12.2, {
    targetSize: 8.2,
    raycast: false
  });
  attachFloodedLocal(world, "mBuildings/mVilla1/Villa1_Door_A.fbx", x, z, yaw, 0, -10.55, {
    targetHeight: 3.2,
    y: 0.1
  });
  attachFloodedLocal(world, "mBuildings/mStructures/Struct_RadioTower_A.fbx", x, z, yaw, 17, 8, {
    targetHeight: 18,
    collision: [2.2, 2.2, 18],
    tint: 0x4b4d48
  });
}

function addFloodedChurch(world, x, z, yaw = 0) {
  addFloodedCollision(world, x, z, 18, 30, 8.2, yaw, true);

  attachFloodedLocal(world, "mBuildings/mChurches/Church1_End_A.fbx", x, z, yaw, 0, -13, {
    targetSize: 11,
    tint: 0x61645d
  });
  attachFloodedLocal(world, "mBuildings/mChurches/Church1_Mid_A.fbx", x, z, yaw, 0, 0, {
    targetSize: 13,
    tint: 0x61645d
  });
  attachFloodedLocal(world, "mBuildings/mChurches/Church1_End_B.fbx", x, z, yaw, 0, 13, {
    targetSize: 11,
    tint: 0x61645d
  });
  attachFloodedLocal(world, "mBuildings/mChurches/Church1_Base_Stairs_A.fbx", x, z, yaw, 0, -17.2, {
    targetSize: 6.4,
    raycast: false
  });
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 6);
    const col = i % 6;
    const point = localPoint(x, z, yaw, -12 + col * 4.8, 22 + row * 5.2);
    attachFloodedModel(world, `mProps/lo_Prop_Gravestone_${String.fromCharCode(65 + (i % 5))}.fbx`, {
      x: point.x,
      z: point.z,
      yaw: yaw + (i % 2 ? 0.1 : -0.06),
      targetHeight: 1.2,
      raycast: false,
      tint: 0x6d6f68
    });
  }
}

function addFloodedGreenhouse(world, x, z, yaw = 0) {
  addRotatedBox(world, x, z, 13.5, 4.3, 22, 0x7f9a90, yaw, 0, {
    material: { transparent: true, opacity: 0.22, roughness: 0.32 },
    solid: false
  });
  addFloodedCollision(world, x, z, 13.5, 22, 4.3, yaw, true);
  [-6.2, 0, 6.2].forEach((offset) => {
    attachFloodedLocal(world, "mBuildings/mGreenHouse/GreenHouse1_Mid_A.fbx", x, z, yaw, 0, offset, {
      targetSize: 9.2,
      raycast: false
    });
  });
  attachFloodedLocal(world, "mBuildings/mGreenHouse/GreenHouse1_End_A.fbx", x, z, yaw, 0, -11, {
    targetSize: 9.4,
    raycast: false
  });
  attachFloodedLocal(world, "mBuildings/mGreenHouse/GreenHouse1_Door_A.fbx", x, z, yaw, 0, -13, {
    targetHeight: 2.4
  });
  for (let i = 0; i < 18; i++) {
    const px = x - 8 + (i % 6) * 3.1;
    const pz = z - 9 + Math.floor(i / 6) * 6.1;
    attachFloodedModel(world, i % 2 ? "mNature/mGrass/Grass_Tall_B.fbx" : "mNature/mBushes/DecoBush_C.fbx", {
      x: px,
      z: pz,
      yaw: i * 0.7,
      targetHeight: i % 2 ? 1.3 : 1.0,
      raycast: false,
      tint: 0x38523d
    });
  }
}

function addSwampTree(world, x, z, scale = 1) {
  const trunkHeight = 6.4 * scale;
  const trunk = addMesh(world, new THREE.CylinderGeometry(0.36 * scale, 0.58 * scale, trunkHeight, 7), 0x47382a, x, trunkHeight / 2, z, {
    rotZ: 0.08 * Math.sin(x * 0.07 + z * 0.11)
  });
  world.obstacles.push(collisionBox(x, z, 1.1 * scale, 1.1 * scale, trunkHeight, true));
  const crownColors = [0x223f2e, 0x2f5339, 0x1e3528];
  for (let i = 0; i < 3; i++) {
    addMesh(world, new THREE.IcosahedronGeometry((2.4 - i * 0.18) * scale, 1), crownColors[i % crownColors.length],
      x + Math.sin(i * 2.1) * 0.45 * scale,
      trunkHeight + 0.8 * scale + i * 0.8 * scale,
      z + Math.cos(i * 1.8) * 0.45 * scale,
      { castShadow: true });
  }
  world.animated.trees.push({ trunk, crown: trunk, phase: (x * 0.21 + z * 0.13) % Math.PI });
}

function scatterFloodedVegetation(world) {
  for (let i = 0; i < 110; i++) {
    const sideForest = i < 58;
    const x = sideForest
      ? -190 + seeded(i) * 96
      : -194 + seeded(i + 41) * 382;
    const z = sideForest
      ? -12 + seeded(i + 8) * 185
      : -190 + seeded(i + 19) * 370;
    if (!sideForest && Math.abs(x) < 54 && z < 74 && z > -132) continue;
    const scale = 0.72 + seeded(i + 2) * 0.85;
    if (i % 3 === 0) addSwampTree(world, x, z, scale);
    else if (i % 3 === 1) addPineTree(world, x, z, 0.68 + scale * 0.34);
    else addTree(world, x, z, 0.56 + scale * 0.24, scale > 1.2);
  }

  for (let i = 0; i < 160; i++) {
    const nearPath = i < 72;
    const x = nearPath ? -76 + seeded(i + 10) * 180 : -205 + seeded(i + 70) * 410;
    const z = nearPath ? -150 + seeded(i + 21) * 225 : -205 + seeded(i + 88) * 410;
    if (Math.abs(x) < 20 && z < -92) continue;
    const asset = i % 5 === 0
      ? "mNature/mBushes/DecoBush_A.fbx"
      : i % 5 === 1
        ? "mNature/mBushes/DecoBush_D.fbx"
        : i % 2
          ? "mNature/mGrass/Grass_Tall_A.fbx"
          : "mNature/mGrass/Grass_Med_B.fbx";
    attachFloodedModel(world, asset, {
      x, z,
      yaw: seeded(i + 99) * Math.PI * 2,
      targetHeight: 0.7 + seeded(i + 14) * 1.05,
      raycast: false,
      tint: i % 2 ? 0x304b35 : 0x425536
    });
  }
}

function addFloodedMotes(world) {
  const positions = [];
  for (let i = 0; i < 180; i++) {
    positions.push(
      -190 + seeded(i) * 380,
      0.8 + seeded(i + 44) * 7.5,
      -190 + seeded(i + 88) * 380
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xb7c4ad,
    size: 0.13,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  }));
  points.userData.ignoreRaycast = true;
  world.root.add(points);
  world.animated.floodedMotes = points;
}

function addSwampProps(world) {
  [
    [-122, -118, 0.18], [-84, -96, -0.4], [-12, -42, 0.2],
    [46, -8, -0.3], [108, -96, 0.9], [146, 18, -0.55],
    [-160, 42, 0.5], [136, 104, -0.2]
  ].forEach(([x, z, yaw], index) => {
    attachFloodedModel(world, index % 2 ? "mProps/lo_Prop_Car1_DM.fbx" : "mProps/lo_Prop_Car_A.fbx", {
      x, z, yaw, targetSize: 5.4, collision: [4.7, 2.4, 1.8], tint: 0x575144
    });
  });
  [
    [100, 54, -0.2], [132, 70, 0.6], [158, 37, 1.1], [72, 94, -0.9]
  ].forEach(([x, z, yaw]) => {
    attachFloodedModel(world, "mProps/lo_Prop_Boat_A.fbx", {
      x, z, yaw, targetSize: 6.8, raycast: false, tint: 0x4c4534
    });
  });
  [
    [-34, -94], [-18, -64], [34, -58], [68, 30], [-132, 92], [110, -38]
  ].forEach(([x, z], index) => {
    attachFloodedModel(world, index % 2 ? "mProps/lo_Prop_ParkBench_A.fbx" : "mProps/lo_Prop_Lamp_A.fbx", {
      x, z, yaw: index * 0.45, targetHeight: index % 2 ? 1.1 : 3.4, raycast: false
    });
  });
}

function addFloodedEntranceDressing(world) {
  attachFloodedModel(world, "mBuildings/mStructures/Struct_Fence1_Gate_A.fbx", {
    x: 0, z: -151, yaw: 0.02, targetSize: 10, collision: [10, 1.2, 2.8], tint: 0x66513a
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_Billboard_A_DM.fbx", {
    x: -27, z: -150, yaw: 0.18, targetSize: 6.8, raycast: false, tint: 0x4c473a
  });
  attachFloodedModel(world, "mBuildings/mCabins/Cabin1_DM.fbx", {
    x: -44, z: -124, yaw: 0.28, targetSize: 13.2, collision: [11.4, 8.4, 5.3], tint: 0x68533a
  });
  attachFloodedModel(world, "mBuildings/mCabins/Cabin2_Mid1.fbx", {
    x: 34, z: -126, yaw: -0.22, targetSize: 12.6, collision: [10.6, 7.8, 5.0], tint: 0x604d37
  });
  attachFloodedModel(world, "mBuildings/mBarns/Barn1_End_A.fbx", {
    x: 70, z: -136, yaw: -0.48, targetSize: 13.4, collision: [12.2, 9.2, 6.2], tint: 0x5d4b36
  });
  attachFloodedModel(world, "mProps/lo_Prop_Car1_DM.fbx", {
    x: -64, z: -144, yaw: 0.9, targetSize: 5.8, collision: [4.8, 2.5, 1.8], tint: 0x6a5b43
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_WoodPath_A.fbx", {
    x: 8, z: -132, yaw: 0.05, targetSize: 16, raycast: false, tint: 0x57472f
  });

  [
    [-30, -160], [-18, -151], [-8, -139], [12, -141], [26, -154], [45, -142],
    [-56, -134], [-72, -126], [58, -121], [76, -126]
  ].forEach(([x, z], index) => {
    attachFloodedModel(world, index % 3 === 0 ? "mNature/mBushes/DecoBush_B.fbx" : "mNature/mGrass/Grass_Tall_C.fbx", {
      x, z,
      yaw: index * 0.71,
      targetHeight: index % 3 === 0 ? 1.15 : 1.65,
      raycast: false,
      tint: 0x3d5c3f
    });
  });
}

function updateFlooded(world, elapsed, event) {
  world.animated.swampWater?.forEach(({ mesh, phase }, index) => {
    mesh.position.y = 0.015 + Math.sin(elapsed * 1.25 + phase) * 0.016;
    mesh.material.opacity = 0.34 + Math.sin(elapsed * 0.8 + phase + index) * 0.08;
  });
  world.animated.trees.forEach(({ trunk, crown, phase }) => {
    const nightWind = event?.type === "storm" ? 0.055 : 0.018;
    trunk.rotation.z = Math.sin(elapsed * 1.2 + phase) * nightWind;
    if (crown && crown !== trunk) crown.rotation.z = trunk.rotation.z * 1.2;
  });
  if (world.animated.floodedMotes) {
    world.animated.floodedMotes.rotation.y = elapsed * 0.015;
    world.animated.floodedMotes.material.opacity = 0.18 + Math.sin(elapsed * 0.55) * 0.06;
  }
}

function buildAlagado(scene) {
  const world = createWorld("alagado", scene);
  const meta = MAP_META.alagado;
  world.safeSpawn = { x: 0, y: 0, z: -162, yaw: Math.PI };
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(0x52636a, 28, 245);

  addGround(world, 0x273121, null, 30);
  addInvisibleBoundary(world);

  addMuddyTrack(world, 0, -142, 94, 10, 0, 0x5c4f38);
  addMuddyTrack(world, -42, -72, 92, 7.5, -0.42, 0x554b35);
  addMuddyTrack(world, 46, -18, 118, 7, 0.34, 0x514934);
  addMuddyTrack(world, -104, 40, 105, 6.2, -0.62, 0x4f4631);
  addMuddyTrack(world, 95, 54, 116, 7.2, 0.88, 0x514936);
  addMuddyTrack(world, -36, 110, 120, 5.6, Math.PI / 2.7, 0x4b432f);

  [
    [112, 62, 82, 44, -0.12], [155, 28, 38, 64, 0.5], [85, 112, 60, 34, 0.25],
    [-166, -26, 32, 26, 0.7], [-74, 132, 46, 22, -0.2], [10, -118, 28, 14, 0.1],
    [44, -84, 20, 12, -0.35], [-44, -118, 26, 12, 0.3], [142, -80, 58, 26, -0.15]
  ].forEach(([x, z, w, d, yaw]) => addPuddle(world, x, z, w, d, yaw));
  attachFloodedModel(world, "mBackgrounds/WaterPlane.fbx", {
    x: 126, z: 52, yaw: 0.2, targetSize: 88, y: 0.004, raycast: false
  });
  addFloodedEntranceDressing(world);

  for (let z = -178; z <= -98; z += 18) {
    addFloodedUtilityPole(world, -13, z, 0.12);
    if ((z + 178) % 36 === 0) addFloodedUtilityPole(world, 16, z + 8, -0.08);
  }
  addFloodedFenceLine(world, -34, -184, -34, -92, 16, 5);
  addFloodedFenceLine(world, 34, -180, 34, -94, 15, 4);

  [
    [-58, -96, 0.22, 0], [-18, -70, -0.35, 1], [34, -62, 0.42, 0],
    [-84, -42, 0.78, 1], [8, -24, -0.1, 2], [-52, 4, -0.55, 0],
    [62, -108, -0.68, 1], [88, -44, 0.9, 0]
  ].forEach(([x, z, yaw, variant], index) => {
    addFloodedCabin(world, x, z, yaw, variant + index);
    addFloodedFenceLine(world, x - 10, z + 8, x + 10, z + 8, 5, 3);
  });
  addFloodedInteriorCabin(world, -106, -84, 0.34);
  addFloodedInteriorCabin(world, 74, -20, -0.62);

  addFloodedMansion(world, 54, 38, -0.22);
  addFloodedChurch(world, -124, 82, 0.42);
  addFloodedGreenhouse(world, 126, -72, -0.28);

  attachFloodedModel(world, "mBuildings/mBridge/BLD_Bridge_A.fbx", {
    x: 78, z: 92, yaw: 0.95, targetSize: 21, collision: [22, 5, 1.1], tint: 0x4d4332
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_Docking_A.fbx", {
    x: 116, z: 86, yaw: -0.4, targetSize: 14, collision: [13, 4, 0.7], tint: 0x4b4334
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_FloodWall_A.fbx", {
    x: 152, z: 5, yaw: Math.PI / 2, targetSize: 22, collision: [23, 3, 2.2], tint: 0x5a5d55
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_WoodPath_A.fbx", {
    x: 115, z: -21, yaw: -0.25, targetSize: 18, raycast: false, tint: 0x4b4231
  });
  attachFloodedModel(world, "mBuildings/mStructures/Struct_Fence1_Gate_A.fbx", {
    x: -8, z: -110, yaw: 0.02, targetSize: 7, collision: [7, 1.1, 2.7], tint: 0x574631
  });

  addFloodedFenceLine(world, -150, 54, -100, 126, 15, 4);
  addFloodedFenceLine(world, 98, -92, 154, -48, 13, 5);
  addFloodedFenceLine(world, 36, 18, 82, 18, 10, 3);
  addFloodedFenceLine(world, 40, 66, 84, 66, 10, 4);

  scatterFloodedVegetation(world);
  addSwampProps(world);
  addFloodedMotes(world);

  for (let i = 0; i < 28; i++) {
    const x = -180 + seeded(i + 230) * 360;
    const z = -184 + seeded(i + 250) * 360;
    if (Math.abs(x) < 38 && z < -112) continue;
    addForestRockCluster(world, x, z, 0.55 + seeded(i + 270) * 0.65);
  }

  world.updateFlooded = (elapsed, _delta, event) => updateFlooded(world, elapsed, event);
  return world;
}

function buildSketchbook(scene) {
  const world = createWorld("sketchbook", scene);
  const meta = MAP_META.sketchbook;
  world.sketchbookGroundY = SKETCHBOOK_GROUND_Y;
  world.requireExplicitGround = true;
  world.safeSpawn = { x: 0, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: 0 };
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 120, 360);

  addGround(world, meta.ground, null, 36);
  world.obstacles.push(collisionBox(0, -2, 148, 112, SKETCHBOOK_GROUND_Y, false));

  attachSketchbookWorld(world, { scale: 0.36, y: -0.04, usePhysicsCollisions: true, usePhysicsGround: true });
  addPlatform(world, 0, SKETCHBOOK_GROUND_Y + 0.18, -38, 78, 2.8, 0x38424d);
  addPlatform(world, 0, SKETCHBOOK_GROUND_Y + 0.22, 38, 78, 2.8, 0x38424d);
  addPlatform(world, -42, SKETCHBOOK_GROUND_Y + 0.2, 0, 2.8, 76, 0x38424d);
  addPlatform(world, 42, SKETCHBOOK_GROUND_Y + 0.2, 0, 2.8, 76, 0x38424d);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const x = Math.cos(angle) * 36;
    const z = Math.sin(angle) * 32;
    addSolidBox(world, x, z, 2.6, 2.4 + (i % 3) * 0.7, 2.6, i % 2 ? 0x5d6b78 : 0xc9863b, SKETCHBOOK_GROUND_Y);
  }
  [-56, -28, 0, 28, 56].forEach((x, i) => {
    addMesh(world, new THREE.TorusGeometry(3.2 + i * 0.22, 0.16, 8, 26), i % 2 ? 0xf2c94c : 0x47c6ff, x, SKETCHBOOK_GROUND_Y + 5.2, 64, {
      rotX: Math.PI / 2,
      castShadow: false,
      material: { emissive: i % 2 ? 0x442d00 : 0x003047 }
    });
  });
  return world;
}

function spawnDebris(world, position, count = 6, strength = 1, color = 0x777777) {
  for (let i = 0; i < count; i++) {
    const size = 0.08 + Math.random() * 0.18 * strength;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * (0.65 + Math.random()), size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true })
    );
    mesh.position.copy(position).add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.2) * 0.7,
      (Math.random() - 0.5) * 0.8
    ));
    world.root.add(mesh);
    world.animated.debris.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 1.5 + Math.random() * 4 * strength, (Math.random() - 0.5) * 4),
      spin: new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5),
      life: 0.75 + Math.random() * 1.15
    });
  }
}

function groundImpactPoint(world, x, z) {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0), 0, 180);
  const hits = raycaster.intersectObjects(world.groundRaycastMeshes || [], false);
  return hits[0]?.point || new THREE.Vector3(x, 0.03, z);
}

function spawnExplosionCrater(world, x, z, strength = 1) {
  if (world.mapId !== "floresta" && world.mapId !== "mundo") return;
  const point = groundImpactPoint(world, x, z);
  const radius = THREE.MathUtils.clamp(1.35 + strength * 0.42, 1.6, 3.4);
  const group = new THREE.Group();
  group.name = "grenade-scorch-crater";
  group.position.copy(point).addScaledVector(new THREE.Vector3(0, 1, 0), 0.035);

  const center = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.68, 32),
    new THREE.MeshStandardMaterial({
      color: 0x171812, roughness: 1, transparent: true, opacity: 0.86,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
    })
  );
  center.rotation.x = -Math.PI / 2;
  group.add(center);

  const scorch = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.54, radius, 36),
    new THREE.MeshStandardMaterial({
      color: 0x34291d, roughness: 1, transparent: true, opacity: 0.76,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
    })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.rotation.z = Math.random() * Math.PI;
  group.add(scorch);

  const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x625d52, roughness: 0.96 });
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.28;
    const size = 0.12 + Math.random() * 0.22;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), stoneMaterial);
    stone.position.set(Math.cos(angle) * radius * (0.72 + Math.random() * 0.34), size * 0.35, Math.sin(angle) * radius * (0.72 + Math.random() * 0.34));
    stone.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    group.add(stone);
  }

  world.root.add(group);
  world.animated.craters.push({ group, age: 0, life: 58 + Math.random() * 14 });
  while (world.animated.craters.length > 18) {
    const oldest = world.animated.craters.shift();
    world.root.remove(oldest.group);
  }
  spawnDebris(world, point.clone().add(new THREE.Vector3(0, 0.2, 0)), 14, 1.4, 0x716b60);
}

function objectImpactPosition(object) {
  const bounds = new THREE.Box3().setFromObject(object.mesh);
  if (bounds.isEmpty()) return object.mesh.getWorldPosition(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  center.y = Math.min(bounds.max.y, Math.max(0.35, center.y));
  return center;
}

function updateDestructibles(world, delta) {
  world.destructibles.forEach((object)=>{
    if (!object.falling) return;
    if (object.kind === "lamp") {
      object.mesh.rotation.z = Math.min(Math.PI / 2, object.mesh.rotation.z + delta * 1.65);
      if (object.mesh.rotation.z >= Math.PI / 2) object.falling = false;
      return;
    }
    object.velocity.y -= 12 * delta;
    object.mesh.position.addScaledVector(object.velocity, delta);
    object.mesh.rotation.x += object.angularVelocity.x * delta;
    object.mesh.rotation.z += object.angularVelocity.z * delta;
    if (object.mesh.position.y < -3) {
      object.mesh.visible = false;
      object.falling = false;
    }
  });
  for (let i = world.animated.debris.length - 1; i >= 0; i--) {
    const debris = world.animated.debris[i];
    debris.life -= delta;
    debris.velocity.y -= 13 * delta;
    debris.mesh.position.addScaledVector(debris.velocity, delta);
    debris.mesh.rotation.x += debris.spin.x * delta;
    debris.mesh.rotation.y += debris.spin.y * delta;
    debris.mesh.rotation.z += debris.spin.z * delta;
    if (debris.mesh.position.y < 0.04) {
      debris.mesh.position.y = 0.04;
      debris.velocity.y = Math.abs(debris.velocity.y) * 0.22;
      debris.velocity.x *= 0.68;
      debris.velocity.z *= 0.68;
    }
    debris.mesh.material.opacity = Math.min(1, Math.max(0, debris.life * 1.7));
    if (debris.life <= 0) {
      world.root.remove(debris.mesh);
      debris.mesh.geometry.dispose();
      debris.mesh.material.dispose();
      world.animated.debris.splice(i, 1);
    }
  }
  for (let i = world.animated.craters.length - 1; i >= 0; i--) {
    const crater = world.animated.craters[i];
    crater.age += delta;
    if (crater.age > crater.life - 8) {
      const opacity = Math.max(0, (crater.life - crater.age) / 8);
      crater.group.traverse((child) => {
        if (child.material?.transparent) child.material.opacity = opacity * 0.78;
      });
    }
    if (crater.age >= crater.life) {
      world.root.remove(crater.group);
      world.animated.craters.splice(i, 1);
    }
  }
}

function updateWater(world, elapsed, event) {
  world.animated.waves.forEach(({mesh,phase},index)=>{
    mesh.position.y = 0.12 + Math.sin(elapsed*1.8+phase)*0.13;
    mesh.scale.z = 0.8 + Math.sin(elapsed*1.4+phase)*0.22;
    mesh.material.opacity = 0.42 + index*0.025;
  });
  world.animated.sharks.forEach(({mesh,radius,speed,phase})=>{
    const a=elapsed*speed+phase;mesh.position.set(Math.cos(a)*radius,-0.25,57+Math.sin(a)*radius*0.58);mesh.rotation.y=-a;
  });
  if(!event||event.type!=="tsunami"){
    world.tsunami.visible=false;world.water.position.y=0.02;return;
  }
  const progress=Math.max(0,Math.min(1,event.progress||0));
  if(event.phase==="warning"){
    world.tsunami.visible=true;world.tsunami.position.set(0,1+progress*8,world.half-4);world.tsunami.scale.y=1+progress*8;
  }else if(event.phase==="surge"){
    world.tsunami.visible=true;world.tsunami.position.z=world.half-(world.half*2-8)*progress;world.tsunami.position.y=7;world.tsunami.scale.y=13;
  }else if(event.phase==="flooded"){
    world.tsunami.visible=false;world.water.position.y=1.05;
  }else if(event.phase==="drain"){
    world.tsunami.visible=false;world.water.position.y=1.05*(1-progress);
  }
}

function updateForest(world, elapsed, event) {
  updateRpgPolyForest(Math.min(0.05, elapsed - (world.animated.lastForestElapsed || 0)));
  world.animated.lastForestElapsed = elapsed;
  if (world.animated.motes) {
    world.animated.motes.rotation.y = elapsed * 0.025;
    world.animated.motes.material.opacity = 0.42 + Math.sin(elapsed * 0.75) * 0.1;
  }
  world.animated.trees.forEach(({trunk,crown,phase})=>{
    const strength=event?.type==="tornado"&&event.phase==="active"?0.085:0.012;
    trunk.rotation.z=Math.sin(elapsed*1.8+phase)*strength;crown.rotation.z=trunk.rotation.z*1.4;
  });
  if(!event||event.type!=="tornado"||event.phase!=="active"){world.tornado.visible=false;return;}
  world.tornado.visible=true;
  const p=Math.max(0,Math.min(1,event.progress||0));
  world.tornado.position.set(-134+p*268,0,Math.sin(p*Math.PI*3)*62);
  world.tornado.rotation.y=elapsed*2.8;
}

function applyObjectState(world, state) {
  const object=world.destructibles.get(state?.id);
  if(!object||object.destroyed)return;
  const nextStage=Math.max(0,Math.min(3,Number(state.stage)||0));
  if(nextStage<=object.damageStage&&!state.destroyed)return;
  object.damageStage=nextStage;
  const tint=nextStage===1?0.24:nextStage===2?0.48:0.68;
  object.materials.forEach(({material,color})=>{
    material.color.copy(color).lerp(new THREE.Color(0x252a2d),tint);
    material.roughness=Math.min(1,(material.roughness||0.7)+nextStage*0.07);
  });
  const impactPosition=objectImpactPosition(object);
  const debrisColor=object.materials[0]?.color?.getHex()||0x74787b;
  spawnDebris(world,impactPosition,nextStage>=2?10:5,nextStage>=2?1.25:0.75,debrisColor);
  if(object.kind==="lamp"&&nextStage<3)object.mesh.rotation.z=nextStage===1?0.08:0.24;
  if(!state.destroyed&&nextStage<3)return;

  object.destroyed=true;
  if(object.obstacle)object.obstacle.active=false;
  if(object.waterBridge)object.waterBridge.active=false;
  object.linkedObstacles.forEach((obstacle)=>{obstacle.active=false;});
  object.linkedMeshes.forEach((mesh)=>{mesh.visible=false;});
  if(object.kind==="building"){
    const prefix=object.id.replace(/-core$/,"");
    world.destructibles.forEach((piece)=>{
      if(piece.id.startsWith(`${prefix}-panel-`)&&!piece.falling){piece.falling=true;piece.velocity.set((Math.random()-.5)*3,3,(Math.random()-.5)*3);piece.angularVelocity.set(1.2,0,1.4);}
    });
  }
  if(object.kind==="bridge"){
    spawnDebris(world,impactPosition,22,1.55,0x6f4b2d);
    object.angularVelocity.set(0.42+(Math.random()-.5)*0.2,0,(Math.random()-.5)*0.75);
  }
  object.falling=true;
  object.velocity.set((Math.random()-0.5)*2.5,object.kind==="building-piece"?2.5:object.kind==="bridge"?-0.6:0,(Math.random()-0.5)*2.5);
  if(object.kind!=="bridge")object.angularVelocity.set((Math.random()-0.5)*2,0,(Math.random()-0.5)*2);
}

function updateWorld(world, delta, event = null) {
  world.animated.elapsed += delta;
  updateDestructibles(world,delta);
  if(world.mapId==="praia")updateWater(world,world.animated.elapsed,event);
  if(world.mapId==="floresta")updateForest(world,world.animated.elapsed,event);
  if(world.mapId==="alagado")world.updateFlooded?.(world.animated.elapsed,delta,event);
  if(world.mapId==="mundo")world.updateUnified?.(world.animated.elapsed,delta,event);
}

const BUILDERS={mundo:buildUnifiedMap,sketchbook:buildSketchbook,praia:buildPraia,cidade:buildCidade,floresta:buildFloresta,alagado:buildAlagado};

export function buildMap(mapId, scene) {
  const world=(BUILDERS[mapId]||BUILDERS.mundo)(scene);
  world.update=(delta,event)=>updateWorld(world,delta,event);
  world.applyObjectState=(state)=>applyObjectState(world,state);
  world.showImpact=(point,strength=1)=>spawnDebris(world,point,Math.max(2,Math.round(4*strength)),strength,0x9a927f);
  world.showExplosionImpact=(x,z,strength=1)=>spawnExplosionCrater(world,x,z,strength);
  world.destructiblesNear=(x,z,radius)=>[...world.destructibles.values()].filter((object)=>{
    const dx=object.mesh.position.x-x,dz=object.mesh.position.z-z;return !object.destroyed&&Math.hypot(dx,dz)<=radius;
  });
  return world;
}
