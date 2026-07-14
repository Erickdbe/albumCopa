import * as THREE from "three";
import { MAP_HALF_SIZES, MAP_META, SKETCHBOOK_GROUND_Y } from "./config.js";
import { attachMeshyModel } from "./meshy-assets.js";
import { attachRpgPolyForest, registerRpgPolyForestCollisions } from "./rpg-poly-assets.js";
import { attachSketchbookWorld } from "./sketchbook-assets.js";

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
  return {
    mapId, scene, root, half: MAP_HALF_SIZES[mapId], obstacles: [], ladders: [], destructibles: new Map(),
    animated: { trees: [], waves: [], sharks: [], debris: [], elapsed: 0 },
    water: null, tsunami: null, tornado: null, event: null
  };
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
  scene.background = new THREE.Color(meta.sky);
  scene.fog = new THREE.Fog(meta.sky, 108, 350);
  addGround(world, 0x4d6b3f);
  addBoundary(world, 0x243421);
  registerRpgPolyForestCollisions(world);
  attachRpgPolyForest(world);

  world.tornado = new THREE.Group();
  for(let i=0;i<9;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.1+i*0.35,0.12,6,20),makeMaterial(0xaab7a7,{transparent:true,opacity:0.35}));
    ring.rotation.x=Math.PI/2;ring.position.y=i*1.25;world.tornado.add(ring);
  }
  world.tornado.visible=false;world.root.add(world.tornado);
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
  object.linkedObstacles.forEach((obstacle)=>{obstacle.active=false;});
  object.linkedMeshes.forEach((mesh)=>{mesh.visible=false;});
  if(object.kind==="building"){
    const prefix=object.id.replace(/-core$/,"");
    world.destructibles.forEach((piece)=>{
      if(piece.id.startsWith(`${prefix}-panel-`)&&!piece.falling){piece.falling=true;piece.velocity.set((Math.random()-.5)*3,3,(Math.random()-.5)*3);piece.angularVelocity.set(1.2,0,1.4);}
    });
  }
  object.falling=true;
  object.velocity.set((Math.random()-0.5)*2.5,object.kind==="building-piece"?2.5:0,(Math.random()-0.5)*2.5);
  object.angularVelocity.set((Math.random()-0.5)*2,0,(Math.random()-0.5)*2);
}

function updateWorld(world, delta, event = null) {
  world.animated.elapsed += delta;
  updateDestructibles(world,delta);
  if(world.mapId==="praia")updateWater(world,world.animated.elapsed,event);
  if(world.mapId==="floresta")updateForest(world,world.animated.elapsed,event);
}

const BUILDERS={sketchbook:buildSketchbook,praia:buildPraia,cidade:buildCidade,floresta:buildFloresta};

export function buildMap(mapId, scene) {
  const world=(BUILDERS[mapId]||BUILDERS.praia)(scene);
  world.update=(delta,event)=>updateWorld(world,delta,event);
  world.applyObjectState=(state)=>applyObjectState(world,state);
  world.showImpact=(point,strength=1)=>spawnDebris(world,point,Math.max(2,Math.round(4*strength)),strength,0x9a927f);
  world.destructiblesNear=(x,z,radius)=>[...world.destructibles.values()].filter((object)=>{
    const dx=object.mesh.position.x-x,dz=object.mesh.position.z-z;return !object.destroyed&&Math.hypot(dx,dz)<=radius;
  });
  return world;
}
