import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const canvas = document.getElementById("gameCanvas");
const startOverlay = document.getElementById("startOverlay");
const startButton = document.getElementById("startButton");
const endOverlay = document.getElementById("endOverlay");
const endTitle = document.getElementById("endTitle");
const endMessage = document.getElementById("endMessage");
const restartButton = document.getElementById("restartButton");
const objectiveText = document.getElementById("objectiveText");
const inventoryText = document.getElementById("inventoryText");
const dangerText = document.getElementById("dangerText");
const interactionText = document.getElementById("interactionText");

const ASSET_ROOT = "./casaSombria/assets/";
const PLAYER_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.42;
const HOUSE_WIDTH = 36;
const HOUSE_DEPTH = 28;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070807);
scene.fog = new THREE.FogExp2(0x070807, 0.044);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 110);
camera.rotation.order = "YXZ";
scene.add(camera);

const clock = new THREE.Clock();
const textureLoader = new THREE.TextureLoader();
const objLoader = new OBJLoader();
const colliders = [];
const interactables = [];
const keys = new Set();

let audioContext = null;
let gameStarted = false;
let gameEnded = false;
let pointerLocked = false;
let yaw = 0;
let pitch = 0;
let currentInteraction = null;
let lastNoiseAt = 0;
let objectivePulse = 0;

const player = {
  position: new THREE.Vector3(-14, PLAYER_HEIGHT, 10),
  hidden: false,
  hideSpot: null,
  inventory: {
    key: false,
    hammer: false,
    screw: false
  }
};

const monster = {
  group: new THREE.Group(),
  position: new THREE.Vector3(0, 0, -2),
  state: "patrol",
  target: new THREE.Vector3(-13, 0, -9),
  patrolIndex: 0,
  lastSeenAt: 0,
  lastKnown: new THREE.Vector3(0, 0, -2)
};

const patrolPoints = [
  new THREE.Vector3(-13, 0, -9),
  new THREE.Vector3(-2, 0, -10),
  new THREE.Vector3(12, 0, -8),
  new THREE.Vector3(14, 0, 8),
  new THREE.Vector3(-12, 0, 10),
  new THREE.Vector3(-2, 0, 1)
];

const materials = {};
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

function asset(path) {
  return encodeURI(`${ASSET_ROOT}${path}`);
}

function makeTexture(path, repeatX = 1, repeatY = 1) {
  const texture = textureLoader.load(asset(path));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

function setupMaterials() {
  materials.floor = new THREE.MeshStandardMaterial({
    map: makeTexture("textures/wood.jpg", 14, 11),
    roughness: 0.86,
    metalness: 0.02
  });
  materials.wall = new THREE.MeshStandardMaterial({
    map: makeTexture("textures/granny/house2.png", 3, 2),
    roughness: 0.9
  });
  materials.ceiling = new THREE.MeshStandardMaterial({
    color: 0x151713,
    roughness: 0.95
  });
  materials.door = new THREE.MeshStandardMaterial({
    map: makeTexture("textures/door.png"),
    roughness: 0.78
  });
  materials.darkWood = new THREE.MeshStandardMaterial({
    color: 0x2b2018,
    roughness: 0.82
  });
  materials.gold = new THREE.MeshStandardMaterial({
    color: 0xd9ab50,
    roughness: 0.44,
    metalness: 0.65,
    emissive: 0x2f1b02,
    emissiveIntensity: 0.2
  });
  materials.red = new THREE.MeshStandardMaterial({
    color: 0x8c2f34,
    roughness: 0.8
  });
  materials.spider = new THREE.MeshStandardMaterial({
    color: 0x16120f,
    roughness: 0.9,
    emissive: 0x180707,
    emissiveIntensity: 0.28
  });
  materials.prison = new THREE.MeshStandardMaterial({
    color: 0x60656b,
    roughness: 0.42,
    metalness: 0.72
  });
}

function setupLights() {
  scene.add(new THREE.HemisphereLight(0x6a6f80, 0x080604, 0.42));

  const moon = new THREE.DirectionalLight(0xa8b6ff, 1.25);
  moon.position.set(-14, 20, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  scene.add(moon);

  const hallLight = new THREE.PointLight(0xd6a650, 2.5, 18, 1.8);
  hallLight.position.set(-2, 2.6, 2);
  scene.add(hallLight);

  const redLight = new THREE.PointLight(0xb43634, 1.55, 16, 2);
  redLight.position.set(14, 1.9, -8);
  scene.add(redLight);

  const flash = new THREE.SpotLight(0xfff2d5, 4.1, 22, Math.PI / 6.2, 0.55, 1.2);
  flash.position.set(0, 0, 0);
  flash.target.position.set(0, 0, -1);
  camera.add(flash);
  camera.add(flash.target);
}

function addCollider(x, z, width, depth) {
  colliders.push({
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2
  });
}

function addBox({ x, y, z, width, height, depth, material, collider = true, cast = true }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collider) addCollider(x, z, width, depth);
  return mesh;
}

function setupHouse() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE_WIDTH, HOUSE_DEPTH), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE_WIDTH, HOUSE_DEPTH), materials.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.25;
  scene.add(ceiling);

  const wallHeight = 3.25;
  const wallY = wallHeight / 2;
  addBox({ x: -18, y: wallY, z: 0, width: .6, height: wallHeight, depth: HOUSE_DEPTH, material: materials.wall });
  addBox({ x: 18, y: wallY, z: 0, width: .6, height: wallHeight, depth: HOUSE_DEPTH, material: materials.wall });
  addBox({ x: -9.8, y: wallY, z: -14, width: 16.4, height: wallHeight, depth: .6, material: materials.wall });
  addBox({ x: 9.8, y: wallY, z: -14, width: 16.4, height: wallHeight, depth: .6, material: materials.wall });
  addBox({ x: 0, y: 1.58, z: -14.05, width: 3.4, height: 3.1, depth: .34, material: materials.door });
  addBox({ x: 0, y: wallY, z: 14, width: HOUSE_WIDTH, height: wallHeight, depth: .6, material: materials.wall });

  addBox({ x: -8, y: wallY, z: -8.2, width: .5, height: wallHeight, depth: 11.2, material: materials.wall });
  addBox({ x: -8, y: wallY, z: 7.7, width: .5, height: wallHeight, depth: 8.6, material: materials.wall });
  addBox({ x: 5, y: wallY, z: -10.4, width: .5, height: wallHeight, depth: 7.2, material: materials.wall });
  addBox({ x: 5, y: wallY, z: 2.1, width: .5, height: wallHeight, depth: 10.2, material: materials.wall });
  addBox({ x: 5, y: wallY, z: 11.5, width: .5, height: wallHeight, depth: 5, material: materials.wall });
  addBox({ x: -13.7, y: wallY, z: -5.4, width: 8.6, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: -1.5, y: wallY, z: -5.4, width: 7, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: 12.6, y: wallY, z: -5.4, width: 10.8, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: -13.8, y: wallY, z: 5, width: 8.4, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: 1.2, y: wallY, z: 5, width: 8.2, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: 15, y: wallY, z: 5, width: 6, height: wallHeight, depth: .5, material: materials.wall });
  addBox({ x: 3, y: wallY, z: 10, width: 20, height: wallHeight, depth: .5, material: materials.wall });

  createWardrobe(-14.2, -10.6, Math.PI / 2);
  createWardrobe(-12.4, 11.2, 0);
  createBed(13, 10.9);
  createTable(-13.5, 0.6);
  createDrawer(13.2, -10.6);
  createPrisonScene();
}

function createWardrobe(x, z, rotation) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, .75), materials.darkWood);
  body.position.y = 1.15;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(.03, 2.0, .79), materials.gold);
  seam.position.set(0, 1.12, -.01);
  group.add(seam);
  scene.add(group);
  addCollider(x, z, 1.5, .95);
  interactables.push({
    type: "hide",
    label: "Esconder",
    position: new THREE.Vector3(x, PLAYER_HEIGHT, z),
    spot: new THREE.Vector3(x, PLAYER_HEIGHT, z)
  });
}

function createBed(x, z) {
  addBox({ x, y: .33, z, width: 3.1, height: .66, depth: 1.55, material: materials.darkWood });
  addBox({ x: x - 1, y: .78, z: z - .15, width: .8, height: .32, depth: 1.26, material: materials.red, collider: false });
}

function createTable(x, z) {
  addBox({ x, y: .82, z, width: 2.2, height: .22, depth: 1.4, material: materials.darkWood });
  for (const dx of [-.82, .82]) {
    for (const dz of [-.5, .5]) {
      addBox({ x: x + dx, y: .42, z: z + dz, width: .16, height: .82, depth: .16, material: materials.darkWood, collider: false });
    }
  }
}

function createDrawer(x, z) {
  addBox({ x, y: .72, z, width: 1.6, height: 1.44, depth: .9, material: materials.darkWood });
  for (let i = 0; i < 3; i++) {
    addBox({ x, y: .36 + i * .38, z: z - .47, width: 1.28, height: .08, depth: .04, material: materials.gold, collider: false });
  }
}

function createPrisonScene() {
  const prison = new THREE.Group();
  prison.position.set(14.3, 0, -1.5);
  scene.add(prison);

  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 2.2, 10), materials.prison);
    bar.position.set(-.8 + i * .4, 1.1, 0);
    prison.add(bar);
  }

  addModelToGroup({
    group: prison,
    modelPath: "models/boy.obj",
    texturePath: "textures/boy.png",
    size: 1.15,
    position: new THREE.Vector3(.05, .06, .72),
    rotation: new THREE.Euler(0, Math.PI, 0)
  });
}

function makeItemFallback(kind) {
  if (kind === "key") {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.18, .045, 12, 24), materials.gold);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(.42, .08, .08), materials.gold);
    shaft.position.x = .3;
    group.add(ring, shaft);
    return group;
  }
  if (kind === "hammer") {
    const group = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, .72), materials.darkWood);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.62, .22, .18), materials.prison);
    head.position.z = -.38;
    group.add(handle, head);
    return group;
  }
  const group = new THREE.Group();
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .62, 16), materials.prison);
  screw.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .08, 18), materials.prison);
  head.rotation.z = Math.PI / 2;
  head.position.x = -.34;
  group.add(screw, head);
  return group;
}

function createItem({ id, label, position, modelPath, texturePath, size }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.userData.spin = true;

  const glow = new THREE.PointLight(0xd9ab50, .92, 4.5, 2);
  glow.position.y = .7;
  group.add(glow);

  const fallback = makeItemFallback(id);
  fallback.position.y = .55;
  fallback.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.add(fallback);

  scene.add(group);
  interactables.push({ type: "item", id, label, position: group.position, group });

  addModelToGroup({
    group,
    modelPath,
    texturePath,
    size,
    position: new THREE.Vector3(0, .42, 0),
    rotation: new THREE.Euler(0, 0, id === "screw" ? Math.PI / 2 : 0),
    onReady: () => {
      fallback.visible = false;
    }
  });
}

function setupItems() {
  createItem({
    id: "key",
    label: "Chave enferrujada",
    position: new THREE.Vector3(13.2, 0, 10.2),
    modelPath: "models/key_low.obj",
    texturePath: "textures/KeyRust_A.png",
    size: .72
  });
  createItem({
    id: "hammer",
    label: "Martelo",
    position: new THREE.Vector3(-13.6, 0, -10.8),
    modelPath: "models/hummer.obj",
    texturePath: "textures/hummer.png",
    size: .9
  });
  createItem({
    id: "screw",
    label: "Parafuso",
    position: new THREE.Vector3(13.8, 0, -10.2),
    modelPath: "models/screw.obj",
    texturePath: "textures/screw.png",
    size: .72
  });

  interactables.push({
    type: "exit",
    label: "Porta principal",
    position: new THREE.Vector3(0, PLAYER_HEIGHT, -12.4)
  });
}

function createMonsterFallback() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.34, .52, 1.75, 18), new THREE.MeshStandardMaterial({
    color: 0xd9d5c8,
    roughness: .86,
    emissive: 0x180707,
    emissiveIntensity: .25
  }));
  body.position.y = .9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 12), materials.red);
  head.position.y = 1.85;
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffece2 });
  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 8), eyeMaterial);
  const rightEye = leftEye.clone();
  leftEye.position.set(-.1, 1.88, -.24);
  rightEye.position.set(.1, 1.88, -.24);
  group.add(body, head, leftEye, rightEye);
  group.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return group;
}

function setupMonster() {
  monster.group.add(createMonsterFallback());
  monster.group.position.copy(monster.position);
  scene.add(monster.group);

  addModelToGroup({
    group: monster.group,
    modelPath: "models/test2.obj",
    texturePath: "textures/Torso1_diff (1).png",
    size: 2.4,
    position: new THREE.Vector3(0, 0, 0),
    rotation: new THREE.Euler(0, Math.PI, 0),
    onReady: object => {
      monster.group.clear();
      monster.group.add(object);
    }
  });
}

function addModelToGroup({ group, modelPath, texturePath, size, position, rotation, onReady }) {
  const material = new THREE.MeshStandardMaterial({
    map: texturePath ? makeTexture(texturePath) : null,
    roughness: .82,
    metalness: .05
  });

  objLoader.load(
    asset(modelPath),
    object => {
      object.traverse(child => {
        if (child.isMesh) {
          child.material = material;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      normalizeObject(object, size);
      if (position) object.position.add(position);
      if (rotation) object.rotation.copy(rotation);
      group.add(object);
      onReady?.(object);
    },
    undefined,
    () => {}
  );
}

function normalizeObject(object, targetSize) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  object.scale.multiplyScalar(targetSize / maxSize);
  const fitted = new THREE.Box3().setFromObject(object);
  const center = fitted.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= fitted.min.y;
}

function resetGame() {
  player.position.set(-14, PLAYER_HEIGHT, 10);
  player.hidden = false;
  player.hideSpot = null;
  player.inventory.key = false;
  player.inventory.hammer = false;
  player.inventory.screw = false;
  monster.position.set(0, 0, -2);
  monster.group.position.copy(monster.position);
  monster.state = "patrol";
  monster.patrolIndex = 0;
  monster.target.copy(patrolPoints[0]);
  gameEnded = false;
  yaw = -Math.PI / 2;
  pitch = 0;

  interactables.forEach(item => {
    if (item.type === "item" && item.group) {
      item.group.visible = true;
    }
  });
  updateHud();
}

function startGame() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  gameStarted = true;
  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  canvas.requestPointerLock?.();
  tone(180, .08, "sine", .04);
}

function endGame(won) {
  gameEnded = true;
  document.exitPointerLock?.();
  endOverlay.classList.remove("hidden");
  endTitle.textContent = won ? "Voce escapou" : "Ela te achou";
  endMessage.textContent = won
    ? "A porta abriu antes que a casa fechasse de novo."
    : "A criatura ouviu seus passos no escuro.";
  tone(won ? 520 : 90, .4, won ? "triangle" : "sawtooth", .06);
}

function updateCamera() {
  camera.position.copy(player.position);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function isColliding(x, z, radius = PLAYER_RADIUS) {
  return colliders.some(col =>
    x + radius > col.minX
    && x - radius < col.maxX
    && z + radius > col.minZ
    && z - radius < col.maxZ
  );
}

function movePlayer(delta) {
  if (player.hidden || gameEnded || !gameStarted) return;

  tmpMove.set(0, 0, 0);
  tmpForward.set(Math.sin(yaw), 0, Math.cos(yaw) * -1).normalize();
  tmpRight.set(Math.cos(yaw), 0, Math.sin(yaw)).normalize();

  if (keys.has("KeyW") || keys.has("ArrowUp")) tmpMove.add(tmpForward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) tmpMove.sub(tmpForward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) tmpMove.add(tmpRight);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) tmpMove.sub(tmpRight);

  const moving = tmpMove.lengthSq() > 0;
  if (!moving) return;

  tmpMove.normalize();
  const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const speed = sprinting ? 5.3 : 3.35;
  const step = speed * delta;
  const nextX = player.position.x + tmpMove.x * step;
  const nextZ = player.position.z + tmpMove.z * step;

  if (!isColliding(nextX, player.position.z)) player.position.x = nextX;
  if (!isColliding(player.position.x, nextZ)) player.position.z = nextZ;

  if (sprinting && clock.elapsedTime - lastNoiseAt > .9) {
    makeNoise(player.position, 12);
  }
}

function makeNoise(position, range) {
  lastNoiseAt = clock.elapsedTime;
  if (monster.state !== "chase" && monster.position.distanceTo(position) < range) {
    monster.state = "investigate";
    monster.target.copy(position);
  }
}

function hasLineOfSight(from, to) {
  const distance = from.distanceTo(to);
  const steps = Math.max(1, Math.floor(distance / .28));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = THREE.MathUtils.lerp(from.x, to.x, t);
    const z = THREE.MathUtils.lerp(from.z, to.z, t);
    if (isColliding(x, z, .08)) return false;
  }
  return true;
}

function canMonsterSeePlayer() {
  if (player.hidden) return false;
  const monsterEye = tmpVec.set(monster.position.x, 1.55, monster.position.z);
  const playerEye = new THREE.Vector3(player.position.x, 1.35, player.position.z);
  const distance = monsterEye.distanceTo(playerEye);
  if (distance > 13.5) return false;

  const toPlayer = playerEye.sub(monsterEye).normalize();
  const monsterForward = new THREE.Vector3(0, 0, 1).applyQuaternion(monster.group.quaternion).normalize();
  const visionDot = monsterForward.dot(toPlayer);
  return visionDot > .28 && hasLineOfSight(monsterEye, player.position);
}

function updateMonster(delta) {
  if (!gameStarted || gameEnded) return;

  const seesPlayer = canMonsterSeePlayer();
  if (seesPlayer) {
    monster.state = "chase";
    monster.lastSeenAt = clock.elapsedTime;
    monster.lastKnown.copy(player.position);
    monster.target.copy(player.position);
  } else if (monster.state === "chase" && clock.elapsedTime - monster.lastSeenAt > 2.9) {
    monster.state = "investigate";
    monster.target.copy(monster.lastKnown);
  }

  if (monster.state === "patrol") {
    monster.target.copy(patrolPoints[monster.patrolIndex]);
    if (monster.position.distanceTo(monster.target) < .6) {
      monster.patrolIndex = (monster.patrolIndex + 1) % patrolPoints.length;
    }
  }

  if (monster.state === "investigate" && monster.position.distanceTo(monster.target) < .7) {
    monster.state = "patrol";
  }

  const speed = monster.state === "chase" ? 3.15 : 1.35;
  const direction = monster.target.clone().sub(monster.position);
  direction.y = 0;
  if (direction.lengthSq() > .0001) {
    direction.normalize();
    monster.position.addScaledVector(direction, speed * delta);
    monster.group.rotation.y = Math.atan2(direction.x, direction.z);
  }
  monster.group.position.copy(monster.position);

  if (!player.hidden && monster.position.distanceTo(player.position) < 1.08) {
    endGame(false);
  }
}

function updateInteraction() {
  currentInteraction = null;
  if (!gameStarted || gameEnded) {
    interactionText.classList.remove("is-visible");
    return;
  }

  if (player.hidden) {
    interactionText.textContent = "Escondido";
    interactionText.classList.add("is-visible");
    currentInteraction = { type: "unhide" };
    return;
  }

  const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  let best = null;
  let bestDistance = Infinity;

  for (const item of interactables) {
    if (item.type === "item" && item.group && !item.group.visible) continue;
    const distance = player.position.distanceTo(item.position);
    if (distance > 2.45 || distance > bestDistance) continue;
    const direction = item.position.clone().sub(player.position);
    direction.y = 0;
    if (direction.lengthSq() < .01) continue;
    direction.normalize();
    if (forward.dot(direction) < .18) continue;
    best = item;
    bestDistance = distance;
  }

  if (best) {
    currentInteraction = best;
    interactionText.textContent = best.type === "exit" ? "Porta principal" : best.label;
    interactionText.classList.add("is-visible");
  } else {
    interactionText.classList.remove("is-visible");
  }
}

function interact() {
  if (!currentInteraction || gameEnded) return;

  if (currentInteraction.type === "unhide") {
    player.hidden = false;
    player.hideSpot = null;
    makeNoise(player.position, 5);
    return;
  }

  if (currentInteraction.type === "hide") {
    player.hidden = true;
    player.hideSpot = currentInteraction.spot.clone();
    player.position.copy(player.hideSpot);
    return;
  }

  if (currentInteraction.type === "item") {
    player.inventory[currentInteraction.id] = true;
    currentInteraction.group.visible = false;
    makeNoise(player.position, 7);
    tone(420, .09, "triangle", .04);
    updateHud();
    return;
  }

  if (currentInteraction.type === "exit") {
    if (canEscape()) {
      endGame(true);
    } else {
      objectivePulse = 1;
      makeNoise(player.position, 11);
      tone(110, .12, "square", .04);
    }
  }
}

function canEscape() {
  return player.inventory.key && player.inventory.hammer && player.inventory.screw;
}

function updateHud() {
  const missing = [];
  if (!player.inventory.key) missing.push("chave");
  if (!player.inventory.hammer) missing.push("martelo");
  if (!player.inventory.screw) missing.push("parafuso");
  objectiveText.textContent = missing.length ? `Ache ${missing.join(", ")}` : "Abra a porta principal";

  const inventory = [];
  if (player.inventory.key) inventory.push("Chave");
  if (player.inventory.hammer) inventory.push("Martelo");
  if (player.inventory.screw) inventory.push("Parafuso");
  inventoryText.textContent = inventory.length ? inventory.join(" + ") : "Vazio";
}

function updateDanger() {
  const distance = monster.position.distanceTo(player.position);
  if (monster.state === "chase") {
    dangerText.textContent = "Critico";
    dangerText.style.color = "#ff7770";
  } else if (monster.state === "investigate" || distance < 6) {
    dangerText.textContent = "Alto";
    dangerText.style.color = "#f1c36d";
  } else {
    dangerText.textContent = "Baixo";
    dangerText.style.color = "#8ed7a2";
  }
}

function updateSpinners(delta) {
  scene.traverse(object => {
    if (object.userData.spin && object.visible) {
      object.rotation.y += delta * 1.2;
      object.position.y = Math.sin(clock.elapsedTime * 2.3) * .08;
    }
  });
}

function tone(frequency, duration, type = "sine", gain = .05) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const volume = audioContext.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = type;
  volume.gain.setValueAtTime(gain, audioContext.currentTime);
  volume.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
  oscillator.connect(volume);
  volume.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function animate() {
  const delta = Math.min(clock.getDelta(), .04);
  movePlayer(delta);
  if (player.hidden && player.hideSpot) {
    player.position.lerp(player.hideSpot, 1 - Math.pow(.001, delta));
  }
  updateCamera();
  updateMonster(delta);
  updateInteraction();
  updateDanger();
  updateSpinners(delta);

  if (objectivePulse > 0) {
    objectivePulse = Math.max(0, objectivePulse - delta * 1.9);
    objectiveText.style.color = `rgb(255, ${Math.round(184 + objectivePulse * 45)}, ${Math.round(130 + objectivePulse * 44)})`;
  } else {
    objectiveText.style.color = "";
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupEvents() {
  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", () => {
    endOverlay.classList.add("hidden");
    resetGame();
    startGame();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  window.addEventListener("resize", resize);

  window.addEventListener("mousemove", event => {
    if (!pointerLocked || !gameStarted || gameEnded) return;
    yaw -= event.movementX * .0022;
    pitch -= event.movementY * .0022;
    pitch = THREE.MathUtils.clamp(pitch, -1.22, 1.22);
  });

  window.addEventListener("keydown", event => {
    keys.add(event.code);
    if (event.code === "KeyE") interact();
    if (event.code === "Escape" && gameStarted && !gameEnded) {
      startOverlay.classList.remove("hidden");
    }
  });

  window.addEventListener("keyup", event => {
    keys.delete(event.code);
  });

  canvas.addEventListener("click", () => {
    if (gameStarted && !gameEnded && !pointerLocked) canvas.requestPointerLock?.();
  });
}

setupMaterials();
setupLights();
setupHouse();
setupItems();
setupMonster();
setupEvents();
resetGame();
updateCamera();
if (new URLSearchParams(window.location.search).get("autostart") === "1") {
  gameStarted = true;
  startOverlay.classList.add("hidden");
}
animate();
