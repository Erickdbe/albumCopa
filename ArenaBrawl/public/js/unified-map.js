import * as THREE from "three";
import { attachCityModel, attachFantasyMountainModel } from "./unity-pack-assets.js";
import { addUnifiedWater, UNIFIED_RIVER_POINTS } from "./water-world.js";

export const UNIFIED_HALF = 260;

const textureLoader = new THREE.TextureLoader();
const grassTexture = textureLoader.load("./assets/textures/forest-grass.jpg");
const sandTexture = textureLoader.load("./assets/textures/beach-sand.jpg");
[grassTexture, sandTexture].forEach((texture) => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
});
grassTexture.repeat.set(32, 32);
sandTexture.repeat.set(24, 7);

function seededRandom(seed = 928371) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const random = seededRandom();

function smoothstep(min, max, value) {
  const t = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

function distanceToSegment(x, z, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const lengthSq = vx * vx + vz * vz;
  const t = lengthSq > 0
    ? THREE.MathUtils.clamp(((x - a.x) * vx + (z - a.z) * vz) / lengthSq, 0, 1)
    : 0;
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}

function distanceToRiver(x, z) {
  let best = Infinity;
  for (let i = 0; i < UNIFIED_RIVER_POINTS.length - 1; i++) {
    best = Math.min(best, distanceToSegment(x, z, UNIFIED_RIVER_POINTS[i], UNIFIED_RIVER_POINTS[i + 1]));
  }
  return best;
}

export function unifiedTerrainHeight(x, z) {
  if (x < -12 && z < 91) return 0;
  if (z > 116) {
    const transition = 1 - smoothstep(116, 178, z);
    return Math.max(0, transition * (0.75 + Math.sin(x * 0.046) * 0.38));
  }

  const forestBlend = smoothstep(-12, 28, x);
  const rolling =
    Math.sin(x * 0.027 + z * 0.012) * 1.65 +
    Math.cos(z * 0.034 - x * 0.009) * 1.25 +
    Math.sin((x + z) * 0.055) * 0.55;
  const eastRidge = smoothstep(150, 282, x) * (7 + Math.sin(z * 0.026) * 3.2);
  const northRidge = smoothstep(125, 286, -z) * (5.5 + Math.cos(x * 0.024) * 2.4);
  const mountainA = Math.exp(-((x - 218) ** 2 / 2700 + (z + 145) ** 2 / 5200)) * 13;
  const mountainB = Math.exp(-((x - 82) ** 2 / 3500 + (z + 224) ** 2 / 2100)) * 10;
  let height = Math.max(0.25, 1.7 + rolling + eastRidge + northRidge + mountainA + mountainB);

  const lakeDistance = Math.hypot(x - 126, z + 62);
  if (lakeDistance < 43) height = THREE.MathUtils.lerp(0.65, height, smoothstep(27, 43, lakeDistance));
  const riverDistance = distanceToRiver(x, z);
  if (riverDistance < 18) height = THREE.MathUtils.lerp(0.38, height, smoothstep(7, 18, riverDistance));
  return height * forestBlend;
}

function obstacle(x, z, width, depth, topY, solid = true, collisionPadding = -0.1) {
  return {
    minX: x - width * 0.5,
    maxX: x + width * 0.5,
    minZ: z - depth * 0.5,
    maxZ: z + depth * 0.5,
    topY,
    solid,
    active: true,
    collisionPadding
  };
}

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...options });
}

function mesh(world, geometry, material, position, rotation = null) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(position[0], position[1], position[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  object.castShadow = true;
  object.receiveShadow = true;
  world.root.add(object);
  return object;
}

function addLadderToBox(world, spec, side = "east") {
  const outward = {
    south: { x: 0, z: 1 }, north: { x: 0, z: -1 },
    east: { x: 1, z: 0 }, west: { x: -1, z: 0 }
  }[side] || { x: 1, z: 0 };
  const alongX = outward.z !== 0;
  const faceDistance = alongX ? spec.depth * 0.36 + 0.18 : spec.width * 0.36 + 0.18;
  const centerX = spec.x + outward.x * faceDistance;
  const centerZ = spec.z + outward.z * faceDistance;
  const baseY = 0.22;
  const height = Math.max(4.2, spec.height - 0.85);
  const ladderWidth = 1.2;
  const railOffset = ladderWidth * 0.45;
  const material = standardMaterial(0x6f5438, { roughness: 0.9 });

  for (const offset of [-railOffset, railOffset]) {
    mesh(
      world,
      new THREE.CylinderGeometry(0.055, 0.055, height, 7),
      material,
      [
        centerX + (alongX ? offset : 0),
        baseY + height * 0.5,
        centerZ + (alongX ? 0 : offset)
      ]
    ).castShadow = false;
  }
  const rungs = Math.max(7, Math.floor(height / 0.45));
  for (let i = 0; i <= rungs; i++) {
    const y = baseY + 0.22 + (height - 0.35) * (i / rungs);
    mesh(
      world,
      new THREE.BoxGeometry(alongX ? ladderWidth : 0.12, 0.07, alongX ? 0.12 : ladderWidth),
      material,
      [centerX, y, centerZ]
    ).castShadow = false;
  }

  const halfWidth = ladderWidth * 0.74;
  const reach = 0.84;
  world.ladders.push({
    centerX,
    centerZ,
    alongX,
    minX: centerX - (alongX ? halfWidth : reach),
    maxX: centerX + (alongX ? halfWidth : reach),
    minZ: centerZ - (alongX ? reach : halfWidth),
    maxZ: centerZ + (alongX ? reach : halfWidth),
    bottomY: baseY,
    topY: baseY + height + 0.3,
    dismountX: -outward.x * 1.2,
    dismountZ: -outward.z * 1.2
  });
}

function makeWorld(scene) {
  const root = new THREE.Group();
  root.name = "world-mundo";
  scene.add(root);
  return {
    mapId: "mundo",
    scene,
    root,
    half: UNIFIED_HALF,
    obstacles: [],
    ladders: [],
    destructibles: new Map(),
    groundRaycastMeshes: [],
    raycastMeshes: [],
    requireExplicitGround: true,
    safeSpawn: { x: -145, y: 0.12, z: 53, yaw: Math.PI },
    animated: { trees: [], waves: [], sharks: [], debris: [], craters: [], soccerBalls: [], elapsed: 0 },
    water: null,
    tsunami: null,
    tornado: null,
    event: null
  };
}

function addTerrain(world) {
  const geometry = new THREE.PlaneGeometry(UNIFIED_HALF * 2, UNIFIED_HALF * 2, 112, 112);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = [];
  const lowGrass = new THREE.Color(0x426d32);
  const highGrass = new THREE.Color(0x658557);
  const rock = new THREE.Color(0x77786c);
  const cityUnderlay = new THREE.Color(0x52694c);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = unifiedTerrainHeight(x, z);
    positions.setY(i, y);
    let color;
    if (x < -12 && z < 91) color = cityUnderlay.clone();
    else {
      const rocky = smoothstep(7, 17, y);
      color = lowGrass.clone().lerp(highGrass, 0.45 + Math.sin((x + z) * 0.04) * 0.18).lerp(rock, rocky * 0.72);
    }
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = mesh(world, geometry, new THREE.MeshStandardMaterial({
    map: grassTexture,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0
  }), [0, -0.04, 0]);
  terrain.name = "unified-terrain";
  terrain.castShadow = false;
  world.groundRaycastMeshes.push(terrain);
  world.raycastMeshes.push(terrain);

  const sand = mesh(world, new THREE.PlaneGeometry(516, 82, 44, 8), new THREE.MeshStandardMaterial({
    map: sandTexture,
    color: 0xffe6a1,
    roughness: 0.97
  }), [0, 0.06, 151], [-Math.PI / 2, 0, 0]);
  sand.name = "coastal-sand";
  sand.castShadow = false;
  world.groundRaycastMeshes.push(sand);
  world.raycastMeshes.push(sand);
}

function addInvisibleBoundaries(world) {
  const half = UNIFIED_HALF;
  world.obstacles.push(
    obstacle(0, -half, half * 2, 2, 18, true, 0),
    obstacle(0, half, half * 2, 2, 18, true, 0),
    obstacle(-half, 0, 2, half * 2, 18, true, 0),
    obstacle(half, 0, 2, half * 2, 18, true, 0)
  );
}

function fallbackBuilding(width, height, depth, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), standardMaterial(color));
  body.position.y = height * 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x9ed6df, emissive: 0x10262c, roughness: 0.38 });
  const rows = Math.max(1, Math.floor(height / 4));
  for (let row = 0; row < rows; row++) {
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.5, width * 0.2), 1.15, 0.08), windowMaterial);
      window.position.set(side * width * 0.24, 2.2 + row * 3.55, -depth * 0.5 - 0.05);
      group.add(window);
    }
  }
  return group;
}

function addCityBuilding(world, spec) {
  const anchor = new THREE.Group();
  anchor.name = `city-${spec.id}`;
  anchor.position.set(spec.x, 0.1, spec.z);
  anchor.rotation.y = spec.yaw || 0;
  const fallback = fallbackBuilding(spec.width, spec.height, spec.depth, spec.color || 0x87949b);
  anchor.add(fallback);
  world.root.add(anchor);

  const collision = obstacle(spec.x, spec.z, spec.width * 0.64, spec.depth * 0.64, spec.height, true, -0.22);
  world.obstacles.push(collision);
  if (spec.height >= 12) addLadderToBox(world, spec, spec.ladderSide || "east");
  fallback.traverse((child) => { if (child.isMesh) world.raycastMeshes.push(child); });
  attachCityModel(anchor, spec.file, {
    targetHeight: spec.height,
    rotation: [0, spec.modelYaw || 0, 0],
    hideExisting: true,
    onReady(model) {
      model.traverse((child) => {
        if (!child.isMesh) return;
        child.userData.cityBuilding = spec.id;
        world.raycastMeshes.push(child);
      });
    }
  }).catch((error) => console.warn(`Predio ${spec.id} nao carregou`, error));
  return anchor;
}

function addRoad(world, x, z, width, depth) {
  const road = mesh(world, new THREE.BoxGeometry(width, 0.12, depth), standardMaterial(0x30363d, { roughness: 0.92 }), [x, 0.08, z]);
  road.castShadow = false;
  world.groundRaycastMeshes.push(road);
  world.raycastMeshes.push(road);
  return road;
}

function addLaneMarkings(world, x, z, length, vertical) {
  const count = Math.floor(length / 11);
  const material = new THREE.MeshBasicMaterial({ color: 0xf3d76a });
  for (let i = 0; i < count; i++) {
    const offset = -length * 0.5 + 6 + i * 11;
    const marker = mesh(
      world,
      new THREE.BoxGeometry(vertical ? 0.22 : 4.5, 0.025, vertical ? 4.5 : 0.22),
      material,
      [x + (vertical ? 0 : offset), 0.155, z + (vertical ? offset : 0)]
    );
    marker.castShadow = false;
  }
}

function addCrosswalk(world, x, z, vertical) {
  const material = new THREE.MeshBasicMaterial({ color: 0xe9eef0 });
  for (let i = -4; i <= 4; i++) {
    const stripe = mesh(
      world,
      new THREE.BoxGeometry(vertical ? 1.05 : 7.8, 0.028, vertical ? 7.8 : 1.05),
      material,
      [x + (vertical ? i * 1.55 : 0), 0.16, z + (vertical ? 0 : i * 1.55)]
    );
    stripe.castShadow = false;
  }
}

function addCityProp(world, file, x, z, options = {}) {
  const anchor = new THREE.Group();
  anchor.position.set(x, options.y || 0.12, z);
  anchor.rotation.y = options.yaw || 0;
  world.root.add(anchor);
  attachCityModel(anchor, file, {
    targetSize: options.size || 4,
    rotation: [0, options.modelYaw || 0, 0],
    onReady(model) {
      model.traverse((child) => { if (child.isMesh) world.raycastMeshes.push(child); });
    }
  }).catch((error) => console.warn(`Objeto urbano ${file} nao carregou`, error));
  if (options.collision) {
    world.obstacles.push(obstacle(x, z, options.collision[0], options.collision[1], options.collision[2], true, -0.2));
  }
}

function addSoccerField(world) {
  const x = -231;
  const z = -238;
  const width = 38;
  const depth = 23;
  const y = 0.19;
  const turf = mesh(world, new THREE.BoxGeometry(width, 0.08, depth), standardMaterial(0x3c8a45, { roughness: 0.96 }), [x, y, z]);
  turf.castShadow = false;
  world.groundRaycastMeshes.push(turf);
  world.raycastMeshes.push(turf);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf1f7e7 });
  const addLine = (lx, lz, lw, ld) => {
    const line = mesh(world, new THREE.BoxGeometry(lw, 0.025, ld), lineMaterial, [lx, y + 0.065, lz]);
    line.castShadow = false;
  };
  addLine(x, z - depth * 0.5 + 0.35, width - 1.5, 0.18);
  addLine(x, z + depth * 0.5 - 0.35, width - 1.5, 0.18);
  addLine(x - width * 0.5 + 0.35, z, 0.18, depth - 1.2);
  addLine(x + width * 0.5 - 0.35, z, 0.18, depth - 1.2);
  addLine(x, z, 0.18, depth - 1.2);
  const center = mesh(world, new THREE.TorusGeometry(3.4, 0.06, 6, 42), lineMaterial, [x, y + 0.08, z], [Math.PI / 2, 0, 0]);
  center.castShadow = false;

  const goalMaterial = standardMaterial(0xd8ded2, { roughness: 0.7 });
  for (const side of [-1, 1]) {
    const gx = x + side * (width * 0.5 - 0.45);
    const postA = mesh(world, new THREE.BoxGeometry(0.12, 1.55, 0.12), goalMaterial, [gx, y + 0.82, z - 3.2]);
    const postB = mesh(world, new THREE.BoxGeometry(0.12, 1.55, 0.12), goalMaterial, [gx, y + 0.82, z + 3.2]);
    const cross = mesh(world, new THREE.BoxGeometry(0.14, 0.12, 6.55), goalMaterial, [gx, y + 1.58, z]);
    postA.castShadow = postB.castShadow = cross.castShadow = true;
  }

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0xf4f4ed, roughness: 0.55 })
  );
  ball.position.set(x, y + 0.48, z);
  ball.castShadow = true;
  world.root.add(ball);
  world.animated.soccerBalls.push({
    mesh: ball,
    velocity: new THREE.Vector3(),
    bounds: { minX: x - width * 0.5 + 1.2, maxX: x + width * 0.5 - 1.2, minZ: z - depth * 0.5 + 1.2, maxZ: z + depth * 0.5 - 1.2 },
    y: y + 0.48,
    lastKickAt: 0
  });
}

function addCity(world) {
  const slab = mesh(world, new THREE.BoxGeometry(278, 0.16, 330), standardMaterial(0x77827f), [-151, 0, -75]);
  slab.castShadow = false;
  world.groundRaycastMeshes.push(slab);
  world.raycastMeshes.push(slab);

  [-258, -206, -154, -102, -50, -18].forEach((x) => {
    addRoad(world, x, -75, 15, 330);
    addLaneMarkings(world, x, -75, 320, true);
  });
  [-224, -166, -108, -50, 8, 66].forEach((z) => {
    addRoad(world, -151, z, 278, 15);
    addLaneMarkings(world, -151, z, 268, false);
  });
  [-206, -154, -102, -50].forEach((x) => [-166, -108, -50, 8].forEach((z) => addCrosswalk(world, x, z, (x + z) % 2 === 0)));

  const buildings = [
    { id: "stadium", file: "Building_Stadium.fbx", x: -231, z: -195, width: 38, depth: 38, height: 18, yaw: Math.PI / 2, color: 0xc9544f },
    { id: "sky-a", file: "Building Sky_big_color01.fbx", x: -180, z: -195, width: 30, depth: 30, height: 44, color: 0x7b9dae },
    { id: "sky-b", file: "Building Sky_small_color01.fbx", x: -127, z: -195, width: 30, depth: 30, height: 34, color: 0x8ca2a9 },
    { id: "res-a", file: "Building_Residential_color01.fbx", x: -76, z: -195, width: 30, depth: 31, height: 29, color: 0xa98776 },
    { id: "factory", file: "Building_Factory.fbx", x: -231, z: -137, width: 38, depth: 31, height: 17, color: 0x798184 },
    { id: "market", file: "Building_Super Market.fbx", x: -180, z: -137, width: 31, depth: 30, height: 15, color: 0x92a8a3 },
    { id: "clothes", file: "Building_Clothing.fbx", x: -127, z: -137, width: 29, depth: 28, height: 19, color: 0xb97c7c },
    { id: "bakery", file: "Building_Bakery.fbx", x: -76, z: -137, width: 28, depth: 28, height: 17, color: 0xd5a66a },
    { id: "auto", file: "Building_Auto Service.fbx", x: -231, z: -79, width: 36, depth: 30, height: 14, color: 0x8597a0 },
    { id: "gas", file: "Building_Gas Station.fbx", x: -180, z: -79, width: 34, depth: 30, height: 13, color: 0xcd6b54 },
    { id: "coffee", file: "Building_Coffee Shop.fbx", x: -127, z: -79, width: 28, depth: 27, height: 16, color: 0x9d725a },
    { id: "fastfood", file: "Building_Fast Food.fbx", x: -76, z: -79, width: 28, depth: 27, height: 16, color: 0xd29356 },
    { id: "sky-c", file: "Building Sky_small_color01.fbx", x: -231, z: -21, width: 31, depth: 31, height: 36, color: 0x7994a5 },
    { id: "res-b", file: "Building_Residential_color01.fbx", x: -180, z: -21, width: 31, depth: 31, height: 27, color: 0xa37c70 },
    { id: "house-a", file: "Building_House_01_color01.fbx", x: -127, z: -21, width: 27, depth: 26, height: 15, color: 0xd0b47b },
    { id: "house-b", file: "Building_House_02_color01.fbx", x: -76, z: -21, width: 27, depth: 26, height: 15, color: 0x8fb0a2 },
    { id: "house-c", file: "Building_House_02_color01.fbx", x: -231, z: 37, width: 27, depth: 26, height: 15, color: 0xa7b990 },
    { id: "house-d", file: "Building_House_01_color01.fbx", x: -180, z: 37, width: 27, depth: 26, height: 15, color: 0xc8a479 },
    { id: "shop-a", file: "Building_Coffee Shop.fbx", x: -127, z: 37, width: 27, depth: 26, height: 16, color: 0xb98c68 },
    { id: "shop-b", file: "Building_Bakery.fbx", x: -76, z: 37, width: 27, depth: 26, height: 16, color: 0xd2a05f }
  ];
  buildings.forEach((building) => addCityBuilding(world, building));

  addCityProp(world, "Props_Roof Helipad.fbx", -180, -195, { y: 44.2, size: 10 });
  const streetX = [-258, -206, -154, -102, -50];
  for (let i = 0; i < 18; i++) {
    addCityProp(world, "Props_Street Light.fbx", streetX[i % streetX.length] + 6, -218 + Math.floor(i / 5) * 58, { size: 5.8, yaw: (i % 2) * Math.PI });
  }
  [[-205, -165], [-153, -107], [-101, -49], [-49, 9]].forEach(([x, z]) => {
    addCityProp(world, "Props_Traffic Signal_big.fbx", x + 6, z + 6, { size: 4.5 });
  });
  const traffic = [
    ["Vehicle_Bus.fbx", -258, -122, 8.8, 0],
    ["Vehicle_Taxi.fbx", -154, -181, 4.2, 0],
    ["Vehicle_Ambulance.fbx", -102, -92, 5.1, Math.PI],
    ["Vehicle_Police Car.fbx", -206, 18, 4.4, Math.PI],
    ["Vehicle_Truck.fbx", -50, -152, 7.5, 0],
    ["Vehicle_Car.fbx", -154, 53, 4.2, Math.PI]
  ];
  traffic.forEach(([file, x, z, size, yaw]) => addCityProp(world, file, x, z, { size, yaw, collision: [size * 0.75, size * 0.36, 2.3] }));
  addSoccerField(world);
}

function isForestPlacementClear(x, z) {
  if (x < 8 || z > 112) return false;
  if (Math.hypot(x - 126, z + 62) < 43) return false;
  if (distanceToRiver(x, z) < 17) return false;
  const clearings = [
    [34, -210, 22], [72, -20, 19], [178, 24, 24], [230, -116, 23], [38, 76, 17]
  ];
  return !clearings.some(([cx, cz, radius]) => Math.hypot(x - cx, z - cz) < radius);
}

function setInstanceMatrix(target, index, x, y, z, sx, sy, sz, rotationY = 0) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(sx, sy, sz)
  );
  target.setMatrixAt(index, matrix);
}

function addForest(world) {
  const treeCount = 300;
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.38, 0.58, 4.6, 7),
    standardMaterial(0x655038),
    treeCount
  );
  const crown = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.65, 7.2, 8),
    standardMaterial(0x2f6837),
    treeCount
  );
  trunk.castShadow = crown.castShadow = true;
  trunk.receiveShadow = crown.receiveShadow = true;
  world.root.add(trunk, crown);
  world.raycastMeshes.push(trunk, crown);
  let treeIndex = 0;
  let attempts = 0;
  while (treeIndex < treeCount && attempts++ < treeCount * 12) {
    const x = 10 + random() * 238;
    const z = -242 + random() * 350;
    if (!isForestPlacementClear(x, z)) continue;
    const y = unifiedTerrainHeight(x, z);
    const scale = 0.72 + random() * 0.78;
    const yaw = random() * Math.PI * 2;
    setInstanceMatrix(trunk, treeIndex, x, y + 2.3 * scale, z, scale, scale, scale, yaw);
    setInstanceMatrix(crown, treeIndex, x, y + 6.1 * scale, z, scale, scale, scale, yaw);
    if (treeIndex % 2 === 0) world.obstacles.push(obstacle(x, z, 0.8 * scale, 0.8 * scale, y + 5.2 * scale, true, -0.25));
    treeIndex++;
  }
  trunk.count = crown.count = treeIndex;
  trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < 18; i++) {
    let x;
    let z;
    do {
      x = 20 + random() * 220;
      z = -238 + random() * 340;
    } while (!isForestPlacementClear(x, z));
    const anchor = new THREE.Group();
    anchor.position.set(x, unifiedTerrainHeight(x, z), z);
    anchor.rotation.y = random() * Math.PI * 2;
    world.root.add(anchor);
    world.animated.trees.push({ trunk: anchor, crown: anchor, phase: random() * Math.PI * 2 });
    attachCityModel(anchor, i % 3 === 0 ? "Natures_Big Tree.fbx" : "Natures_Fir Tree.fbx", {
      targetHeight: 8 + random() * 5,
      onReady(model) { model.traverse((child) => { if (child.isMesh) world.raycastMeshes.push(child); }); }
    }).catch((error) => console.warn("Arvore do pack nao carregou", error));
  }

  const assetFoliage = [
    { file: "Tree01.fbx", count: 24, height: [7.8, 12.5], raycast: true, obstacle: true },
    { file: "Bush01.fbx", count: 44, size: [1.2, 2.2], raycast: false },
    { file: "Grass01.fbx", count: 70, size: [1.1, 2.3], raycast: false },
    { file: "Flowers01.fbx", count: 46, size: [0.8, 1.35], raycast: false },
    { file: "Flower01.fbx", count: 54, size: [0.55, 1.05], raycast: false }
  ];
  assetFoliage.forEach((spec) => {
    for (let i = 0; i < spec.count; i++) {
      let x;
      let z;
      let attempts = 0;
      do {
        x = 12 + random() * 232;
        z = -244 + random() * 348;
      } while (!isForestPlacementClear(x, z) && attempts++ < 25);
      const y = unifiedTerrainHeight(x, z);
      const anchor = new THREE.Group();
      anchor.name = `fantasy-pack-${spec.file.replace(/\.[^.]+$/, "").toLowerCase()}`;
      anchor.position.set(x, y, z);
      anchor.rotation.y = random() * Math.PI * 2;
      anchor.userData.ignoreRaycast = !spec.raycast;
      world.root.add(anchor);
      const options = {
        targetHeight: spec.height ? spec.height[0] + random() * (spec.height[1] - spec.height[0]) : undefined,
        targetSize: spec.size ? spec.size[0] + random() * (spec.size[1] - spec.size[0]) : undefined,
        roughness: 0.92,
        metalness: 0.02,
        onReady(model) {
          model.traverse((child) => {
            if (!child.isMesh) return;
            child.userData.ignoreRaycast = !spec.raycast;
            child.castShadow = spec.file.includes("Tree") || spec.file.includes("Bush");
            child.receiveShadow = true;
            if (spec.raycast) world.raycastMeshes.push(child);
          });
        }
      };
      attachFantasyMountainModel(anchor, spec.file, options)
        .catch((error) => console.warn(`Asset de floresta ${spec.file} nao carregou`, error));
      if (spec.obstacle) {
        const radius = 0.65 + random() * 0.38;
        world.obstacles.push(obstacle(x, z, radius, radius, y + 5.8, true, -0.2));
        world.animated.trees.push({ trunk: anchor, crown: anchor, phase: random() * Math.PI * 2 });
      }
    }
  });

  const grassCount = 2200;
  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.22, 1.3, 4),
    standardMaterial(0x4d9b42, { side: THREE.DoubleSide }),
    grassCount
  );
  const bushes = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.8, 0),
    standardMaterial(0x3f7d3d),
    500
  );
  const flowers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 5, 4),
    new THREE.MeshStandardMaterial({ color: 0x8eb9ff, emissive: 0x0b1222, roughness: 0.8 }),
    360
  );
  [grass, bushes, flowers].forEach((object) => {
    object.castShadow = object === bushes;
    object.receiveShadow = true;
    object.userData.ignoreRaycast = true;
    world.root.add(object);
  });
  for (let i = 0; i < grassCount; i++) {
    let x;
    let z;
    do {
      x = 4 + random() * 244;
      z = -248 + random() * 360;
    } while (!isForestPlacementClear(x, z));
    const height = 0.5 + random() * 1.45;
    setInstanceMatrix(grass, i, x, unifiedTerrainHeight(x, z) + height * 0.5, z, 0.6 + random() * 0.9, height, 0.6 + random() * 0.9, random() * Math.PI);
  }
  for (let i = 0; i < 500; i++) {
    let x;
    let z;
    do {
      x = 5 + random() * 242;
      z = -245 + random() * 355;
    } while (!isForestPlacementClear(x, z));
    const scale = 0.55 + random() * 1.25;
    setInstanceMatrix(bushes, i, x, unifiedTerrainHeight(x, z) + 0.45 * scale, z, scale * 1.2, scale * 0.7, scale, random() * Math.PI);
  }
  for (let i = 0; i < 360; i++) {
    let x;
    let z;
    do {
      x = 12 + random() * 232;
      z = -240 + random() * 338;
    } while (!isForestPlacementClear(x, z));
    const y = unifiedTerrainHeight(x, z);
    setInstanceMatrix(flowers, i, x, y + 0.38, z, 1, 1, 1, 0);
  }
  grass.instanceMatrix.needsUpdate = bushes.instanceMatrix.needsUpdate = flowers.instanceMatrix.needsUpdate = true;

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), standardMaterial(0x777b72), 76);
  rocks.castShadow = rocks.receiveShadow = true;
  world.root.add(rocks);
  world.raycastMeshes.push(rocks);
  for (let i = 0; i < 76; i++) {
    let x;
    let z;
    do {
      x = 14 + random() * 232;
      z = -242 + random() * 350;
    } while (Math.hypot(x - 126, z + 62) < 36 || distanceToRiver(x, z) < 11);
    const scale = 0.55 + random() * 2.1;
    setInstanceMatrix(rocks, i, x, unifiedTerrainHeight(x, z) + scale * 0.42, z, scale, scale * (0.55 + random() * 0.45), scale * (0.75 + random() * 0.35), random() * Math.PI);
    if (scale > 1.65) world.obstacles.push(obstacle(x, z, scale * 1.25, scale * 1.15, unifiedTerrainHeight(x, z) + scale * 1.5, true, -0.28));
  }
  rocks.instanceMatrix.needsUpdate = true;
}

function addWoodBridge(world, id, x, z, width, yaw, topY) {
  const group = new THREE.Group();
  group.name = id;
  group.position.set(x, topY - 0.18, z);
  group.rotation.y = yaw;
  const wood = standardMaterial(0x8a5a32);
  const rope = standardMaterial(0x4d3827);
  const plankCount = Math.max(8, Math.round(width / 0.82));
  for (let i = 0; i < plankCount; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 4.4), wood);
    plank.position.x = (i - (plankCount - 1) * 0.5) * 0.82;
    plank.rotation.z = Math.sin(i * 1.7) * 0.018;
    plank.castShadow = plank.receiveShadow = true;
    plank.userData.destructibleId = id;
    group.add(plank);
  }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, width, 7), rope);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.15, side * 2.05);
    rail.userData.destructibleId = id;
    group.add(rail);
  }
  world.root.add(group);
  const bridgeObstacle = obstacle(x, z, width, 4.4, topY + 0.1, false, -0.18);
  if (Math.abs(Math.sin(yaw)) > 0.5) {
    bridgeObstacle.minX = x - 2.2;
    bridgeObstacle.maxX = x + 2.2;
    bridgeObstacle.minZ = z - width * 0.5;
    bridgeObstacle.maxZ = z + width * 0.5;
  }
  world.obstacles.push(bridgeObstacle);
  world.groundRaycastMeshes.push(...group.children.filter((child) => child.isMesh));
  world.raycastMeshes.push(...group.children.filter((child) => child.isMesh));
  const materials = [{ material: wood, color: wood.color.clone() }, { material: rope, color: rope.color.clone() }];
  const waterBridge = world.registerWaterBridge(x, z,
    Math.abs(Math.sin(yaw)) > 0.5 ? 5 : width,
    Math.abs(Math.sin(yaw)) > 0.5 ? width : 5
  );
  world.destructibles.set(id, {
    id,
    mesh: group,
    kind: "bridge",
    obstacle: bridgeObstacle,
    destroyed: false,
    falling: false,
    damageStage: 0,
    materials,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    linkedMeshes: [],
    linkedObstacles: [],
    waterBridge
  });
}

function addCabin(world, x, z, yaw = 0) {
  const y = unifiedTerrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = yaw;
  const wall = standardMaterial(0x8a6845);
  const roof = standardMaterial(0x3c4938);
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 7), wall);
  body.position.y = 2.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(6.3, 3.5, 4), roof);
  cap.position.y = 6.35;
  cap.rotation.y = Math.PI / 4;
  group.add(body, cap);
  group.traverse((child) => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
  world.root.add(group);
  world.obstacles.push(obstacle(x, z, 6.3, 4.8, y + 6, true, -0.22));
  world.raycastMeshes.push(body, cap);
}

function addBeach(world) {
  for (let i = 0; i < 24; i++) {
    const x = -250 + random() * 500;
    const z = 126 + random() * 51;
    const palm = new THREE.Group();
    palm.position.set(x, 0.14, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 6.8, 7), standardMaterial(0x8a6238));
    trunk.position.y = 3.4;
    palm.add(trunk);
    for (let leaf = 0; leaf < 7; leaf++) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 4.4, 5), standardMaterial(0x3c854d));
      blade.position.y = 6.8;
      blade.rotation.z = Math.PI / 2.5;
      blade.rotation.y = leaf / 7 * Math.PI * 2;
      palm.add(blade);
    }
    palm.rotation.y = random() * Math.PI * 2;
    world.root.add(palm);
    palm.traverse((child) => { if (child.isMesh) { child.castShadow = true; world.raycastMeshes.push(child); } });
    world.obstacles.push(obstacle(x, z, 0.6, 0.6, 7.2, true, -0.28));
  }
  addCabin(world, -86, 137, 0.12);
  addCabin(world, 9, 145, -0.08);
  addCabin(world, 205, 139, Math.PI);

  for (let i = 0; i < 5; i++) {
    const fire = new THREE.Group();
    const x = -210 + i * 102;
    const z = 165 + (i % 2) * 8;
    fire.position.set(x, 0.15, z);
    for (let stone = 0; stone < 9; stone++) {
      const angle = stone / 9 * Math.PI * 2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), standardMaterial(0x77746d));
      rock.position.set(Math.cos(angle) * 0.8, 0.2, Math.sin(angle) * 0.8);
      fire.add(rock);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.4, 7), new THREE.MeshStandardMaterial({ color: 0xff8b36, emissive: 0x8a2400 }));
    flame.position.y = 0.82;
    fire.add(flame);
    world.root.add(fire);
    world.animated.beachFires ||= [];
    world.animated.beachFires.push({ flame, phase: i * 1.37 });
  }
}

function addEventVisuals(world) {
  const tornadoMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c2a9, transparent: true, opacity: 0.42, roughness: 1, side: THREE.DoubleSide });
  const tornado = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8 + i * 0.72, 0.2 + i * 0.04, 7, 28), tornadoMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = i * 1.18;
    tornado.add(ring);
  }
  tornado.visible = false;
  world.root.add(tornado);
  world.tornado = tornado;
}

function updateUnified(world, elapsed, delta, event) {
  world.updateWaterWorks?.(elapsed);
  world.animated.soccerBalls.forEach((ball) => {
    ball.mesh.position.x += ball.velocity.x * delta;
    ball.mesh.position.z += ball.velocity.z * delta;
    ball.velocity.multiplyScalar(Math.pow(0.91, delta * 60));
    if (ball.mesh.position.x < ball.bounds.minX || ball.mesh.position.x > ball.bounds.maxX) {
      ball.mesh.position.x = THREE.MathUtils.clamp(ball.mesh.position.x, ball.bounds.minX, ball.bounds.maxX);
      ball.velocity.x *= -0.48;
    }
    if (ball.mesh.position.z < ball.bounds.minZ || ball.mesh.position.z > ball.bounds.maxZ) {
      ball.mesh.position.z = THREE.MathUtils.clamp(ball.mesh.position.z, ball.bounds.minZ, ball.bounds.maxZ);
      ball.velocity.z *= -0.48;
    }
    ball.mesh.position.y = ball.y;
    ball.mesh.rotation.x += ball.velocity.z * delta * 1.8;
    ball.mesh.rotation.z -= ball.velocity.x * delta * 1.8;
    if (ball.velocity.lengthSq() < 0.006) ball.velocity.set(0, 0, 0);
  });
  world.animated.trees.forEach(({ trunk, phase }) => {
    const wind = event?.type === "tornado" && event.phase === "active" ? 0.07 : 0.008;
    trunk.rotation.z = Math.sin(elapsed * 1.4 + phase) * wind;
  });
  world.animated.beachFires?.forEach(({ flame, phase }) => {
    flame.scale.y = 0.8 + Math.sin(elapsed * 8 + phase) * 0.22;
    flame.rotation.y += delta * 1.8;
  });
  if (event?.type === "tornado" && event.phase === "active") {
    const progress = THREE.MathUtils.clamp(event.progress || 0, 0, 1);
    world.tornado.visible = true;
    world.tornado.position.set(30 + progress * 230, unifiedTerrainHeight(30 + progress * 230, -190 + progress * 250), -190 + progress * 250);
    world.tornado.rotation.y += delta * 3.4;
  } else {
    world.tornado.visible = false;
  }
  const ocean = world.waterBodies?.ocean;
  if (ocean) {
    const tsunami = event?.type === "tsunami";
    const progress = tsunami ? THREE.MathUtils.clamp(event.progress || 0, 0, 1) : 0;
    ocean.position.y = tsunami && event.phase === "flooded" ? 1.2 : tsunami && event.phase === "drain" ? 1.2 * (1 - progress) : 0.08;
  }
}

export function buildUnifiedMap(scene) {
  const world = makeWorld(scene);
  scene.background = new THREE.Color(0x91c9ee);
  scene.fog = new THREE.FogExp2(0xaccfdf, 0.00145);
  addTerrain(world);
  addInvisibleBoundaries(world);
  addUnifiedWater(world);
  addCity(world);
  addForest(world);
  addBeach(world);
  addWoodBridge(world, "unified-bridge-north", 93, 18, 22, 0, 1.48);
  addWoodBridge(world, "unified-bridge-south", 58, 108, 26, -0.08, 0.9);
  addEventVisuals(world);
  world.updateUnified = (elapsed, delta, event) => updateUnified(world, elapsed, delta, event);
  world.kickSoccerBalls = (playerPosition, viewDirection) => {
    const flatView = new THREE.Vector3(viewDirection.x, 0, viewDirection.z);
    if (flatView.lengthSq() < 0.001) flatView.set(0, 0, -1);
    flatView.normalize();
    const now = performance.now();
    world.animated.soccerBalls.forEach((ball) => {
      const dx = ball.mesh.position.x - playerPosition.x;
      const dz = ball.mesh.position.z - playerPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 1.45 || now - ball.lastKickAt < 240) return;
      const away = distance > 0.001 ? new THREE.Vector3(dx / distance, 0, dz / distance) : flatView.clone();
      ball.velocity.add(flatView.multiplyScalar(8.5)).add(away.multiplyScalar(4.2));
      ball.velocity.clampLength(0, 16);
      ball.lastKickAt = now;
    });
  };
  return world;
}
