import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const CELL = 4;
const WALL_HEIGHT = 3.5;
const PLAYER_RADIUS = 0.58;
const PLAYER_HEIGHT = 1.68;
const CROUCH_HEIGHT = 1.08;
const PLAYER_SPEED = 3.25;
const SPRINT_SPEED = 5.05;
const CROUCH_SPEED = 1.55;
const MONSTER_PATROL_SPEED = 1.25;
const MONSTER_INVESTIGATE_SPEED = 1.85;
const MONSTER_CHASE_SPEED = 3.45;
const MONSTER_VIEW_DISTANCE = 18;
const MONSTER_VIEW_COS = Math.cos(THREE.MathUtils.degToRad(58));
const MONSTER_CATCH_DISTANCE = 1.25;

const RAW_MAP = [
  "###################",
  "#S....#.....#.....#",
  "#.##..#.###.#.###.#",
  "#.#...#...#.#...#.#",
  "#.#.#####.#.###.#.#",
  "#...#K..#.#.....#.#",
  "###.#.#.#.#####.#.#",
  "#...#.#.#.....#.#.#",
  "#.###.#.#####.#.#.#",
  "#.....#...#...#...#",
  "#.#######.#.#####.#",
  "#...N.....#...M...#",
  "#.#############.#E#",
  "#...............#.#",
  "###################"
];

const MAP_H = RAW_MAP.length;
const MAP_W = RAW_MAP[0].length;
const tmpVec3 = new THREE.Vector3();
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();

const canvas = document.getElementById("gameCanvas");
const startOverlay = document.getElementById("startOverlay");
const endOverlay = document.getElementById("endOverlay");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const objectiveText = document.getElementById("objectiveText");
const inventoryText = document.getElementById("inventoryText");
const alertPanel = document.getElementById("alertPanel");
const alertText = document.getElementById("alertText");
const promptText = document.getElementById("promptText");
const eventText = document.getElementById("eventText");
const endEyebrow = document.getElementById("endEyebrow");
const endTitle = document.getElementById("endTitle");
const endCopy = document.getElementById("endCopy");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050706);
scene.fog = new THREE.FogExp2(0x050706, 0.035);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 80);
camera.rotation.order = "YXZ";

const listener = new THREE.AudioListener();
camera.add(listener);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const loaderManager = new THREE.LoadingManager();
const fbxLoader = new FBXLoader(loaderManager);

const keys = new Set();
const colliders = [];
const interactables = [];
const noisyItems = [];
const noiseRipples = [];
const patrolWaypoints = [];

const player = {
  pos: findMarker("S"),
  yaw: -Math.PI / 2,
  pitch: 0,
  hasKey: false,
  holding: null,
  alive: true,
  escaped: false,
  crouching: false,
  stepTimer: 0
};

const monster = {
  root: null,
  model: null,
  mixer: null,
  actions: {},
  activeAction: null,
  pos: findMarker("M"),
  state: "patrol",
  path: [],
  pathIndex: 0,
  patrolIndex: 0,
  investigateTarget: null,
  lastSeenPos: null,
  waitTimer: 0,
  repathTimer: 0,
  forward: new THREE.Vector3(0, 0, -1)
};

let keyMesh = null;
let exitDoor = null;
let gameStarted = false;
let pointerLocked = false;
let audioCtx = null;
let eventTimer = 0;
let lastPrompt = "";

init();

function init() {
  buildLighting();
  buildHouse();
  buildInteractables();
  buildMonster();
  updateCamera(0);
  updateHud();
  bindEvents();
  requestAnimationFrame(loop);
}

function bindEvents() {
  startButton.addEventListener("click", () => startGame());
  restartButton.addEventListener("click", () => restartGame());

  canvas.addEventListener("click", () => {
    if (!gameStarted || !player.alive || player.escaped) return;
    if (!pointerLocked) {
      canvas.requestPointerLock();
      return;
    }
    dropHeldItem(true);
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener("mousemove", (event) => {
    if (!pointerLocked || !gameStarted || !player.alive || player.escaped) return;
    player.yaw -= event.movementX * 0.0021;
    player.pitch -= event.movementY * 0.0018;
    player.pitch = THREE.MathUtils.clamp(player.pitch, -1.25, 1.25);
  });

  document.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (!gameStarted || !player.alive || player.escaped) return;

    if (event.code === "KeyE") {
      interact();
    }

    if (event.code === "KeyG" || event.code === "KeyQ") {
      dropHeldItem(false);
    }
  });

  document.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function startGame() {
  ensureAudio();
  gameStarted = true;
  startOverlay.classList.remove("is-visible");
  canvas.requestPointerLock();
  showEvent("A porta bateu atras de voce.");
}

function restartGame() {
  window.location.reload();
}

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function buildLighting() {
  const hemi = new THREE.HemisphereLight(0x98ac93, 0x150b08, 0.68);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0x93b5a3, 0.44);
  moon.position.set(-20, 20, -14);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -38;
  moon.shadow.camera.right = 38;
  moon.shadow.camera.top = 38;
  moon.shadow.camera.bottom = -38;
  scene.add(moon);

  const flashlight = new THREE.SpotLight(0xffe4b4, 2.7, 30, Math.PI / 5.8, 0.5, 1.55);
  flashlight.position.set(0, 0, 0);
  flashlight.target.position.set(0, 0, -1);
  camera.add(flashlight);
  camera.add(flashlight.target);

  const handLight = new THREE.PointLight(0xe1b36f, 0.42, 5.8, 2.1);
  handLight.position.set(0, -0.25, -0.15);
  camera.add(handLight);
  scene.add(camera);

  [
    { cell: [4, 1], color: 0xd48a3d, power: 1.7 },
    { cell: [7, 5], color: 0x9cae98, power: 1.1 },
    { cell: [15, 9], color: 0xd48a3d, power: 1.35 },
    { cell: [4, 13], color: 0x96353b, power: 1.0 }
  ].forEach((lamp) => {
    const pos = worldFromCell(lamp.cell[0], lamp.cell[1]);
    const light = new THREE.PointLight(lamp.color, lamp.power, 12, 1.8);
    light.position.set(pos.x, 2.55, pos.z);
    scene.add(light);

    const shade = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: lamp.color })
    );
    shade.position.copy(light.position);
    scene.add(shade);
  });
}

function buildHouse() {
  const floorTexture = makeFloorTexture();
  const wallTexture = makeWallTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    color: 0x5c5142,
    roughness: 0.84,
    metalness: 0.02
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: wallTexture,
    color: 0x6a6659,
    roughness: 0.92
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c211a,
    roughness: 0.95
  });

  const floorGeo = new THREE.BoxGeometry(CELL, 0.14, CELL);
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
  const ceilingGeo = new THREE.BoxGeometry(CELL, 0.12, CELL);

  for (let z = 0; z < MAP_H; z += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const marker = RAW_MAP[z][x];
      const pos = worldFromCell(x, z);

      if (marker === "#") {
        const wall = new THREE.Mesh(wallGeo, wallMaterial);
        wall.position.set(pos.x, WALL_HEIGHT / 2, pos.z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
        colliders.push({ x: pos.x, z: pos.z, halfX: CELL / 2, halfZ: CELL / 2 });
        continue;
      }

      const floor = new THREE.Mesh(floorGeo, floorMaterial);
      floor.position.set(pos.x, -0.08, pos.z);
      floor.receiveShadow = true;
      scene.add(floor);

      const ceiling = new THREE.Mesh(ceilingGeo, ceilingMaterial);
      ceiling.position.set(pos.x, WALL_HEIGHT + 0.03, pos.z);
      ceiling.receiveShadow = true;
      scene.add(ceiling);

      if (marker === "." && Math.random() < 0.045) {
        addFloorDebris(pos);
      }
    }
  }

  addFurniture();
}

function buildInteractables() {
  const keyPos = findMarker("K");
  const keyGroup = new THREE.Group();
  const keyMat = new THREE.MeshStandardMaterial({
    color: 0xf1bf5a,
    metalness: 0.8,
    roughness: 0.28,
    emissive: 0x352000,
    emissiveIntensity: 0.35
  });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.08), keyMat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 10, 22), keyMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = -0.4;
  keyGroup.add(shaft, ring);
  keyGroup.position.set(keyPos.x, 0.86, keyPos.z);
  keyGroup.rotation.y = 0.5;
  keyMesh = keyGroup;
  scene.add(keyGroup);
  interactables.push({
    id: "key",
    label: "Chave antiga",
    pos: keyGroup.position,
    radius: 1.5,
    action: () => pickupKey()
  });

  const exitPos = findMarker("E");
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x573425,
    roughness: 0.68,
    metalness: 0.04
  });
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.25, 3.05, 0.28), doorMat);
  door.position.set(exitPos.x, 1.5, exitPos.z);
  door.castShadow = true;
  door.receiveShadow = true;
  exitDoor = door;
  scene.add(door);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 10),
    new THREE.MeshStandardMaterial({ color: 0xd0a35c, metalness: 0.6, roughness: 0.24 })
  );
  knob.position.set(exitPos.x + 0.72, 1.4, exitPos.z - 0.18);
  scene.add(knob);
  interactables.push({
    id: "exit",
    label: "Porta principal",
    pos: door.position,
    radius: 2.0,
    action: () => tryEscape()
  });

  [
    [4, 11, "Vaso"],
    [13, 3, "Garrafa"],
    [15, 5, "Lata"],
    [9, 9, "Caixa"],
    [1, 13, "Castiçal"]
  ].forEach(([x, z, name], index) => {
    const pos = worldFromCell(x, z);
    createNoisyItem(pos, name, index);
  });

  patrolWaypoints.push(
    worldFromCell(15, 11),
    worldFromCell(15, 9),
    worldFromCell(11, 7),
    worldFromCell(7, 5),
    worldFromCell(3, 11),
    worldFromCell(1, 13),
    worldFromCell(1, 1)
  );
}

function buildMonster() {
  const fallback = createFallbackMonster();
  fallback.position.copy(monster.pos);
  monster.root = fallback;
  monster.model = fallback;
  scene.add(fallback);
  setMonsterAction("walk");

  const baseUrl = "/assets/horror/wraith/";
  fbxLoader.load(
    `${baseUrl}Meshy_AI_Ragged_Wraith_biped_Animation_Walking_withSkin.fbx`,
    (object) => {
      scene.remove(fallback);
      const wrapped = wrapMonsterModel(object);
      wrapped.position.copy(monster.pos);
      monster.root = wrapped;
      monster.model = object;
      monster.mixer = new THREE.AnimationMixer(object);
      object.animations.forEach((clip, index) => {
        clip.name = index === 0 ? "walk" : clip.name || `walk_${index}`;
        monster.actions.walk = monster.mixer.clipAction(clip);
        monster.actions.walk.play();
      });
      scene.add(wrapped);
      setMonsterAction("walk");
      loadMonsterRunAnimation(baseUrl);
    },
    undefined,
    () => {
      showEvent("O modelo 3D nao carregou, usando sombra provisoria.");
    }
  );
}

function loadMonsterRunAnimation(baseUrl) {
  fbxLoader.load(
    `${baseUrl}Meshy_AI_Ragged_Wraith_biped_Animation_Running_withSkin.fbx`,
    (object) => {
      if (!monster.mixer || !object.animations.length) return;
      const clip = object.animations[0];
      clip.name = "run";
      monster.actions.run = monster.mixer.clipAction(clip, monster.model);
    },
    undefined,
    () => {}
  );
}

function wrapMonsterModel(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.roughness = Math.max(0.72, child.material.roughness || 0.72);
      }
    }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(0.001, size.y);
  const scale = 2.45 / height;
  object.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(object);
  const center = scaledBox.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -scaledBox.min.y, -center.z);

  const group = new THREE.Group();
  group.add(object);
  return group;
}

function createFallbackMonster() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: 0x251d1b,
    roughness: 0.9,
    metalness: 0.0
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x141812,
    roughness: 0.96
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff3636 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.55, 8, 16), cloth);
  body.position.y = 1.25;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12), skin);
  head.position.set(0, 2.25, -0.05);
  head.castShadow = true;
  group.add(head);

  const eyeA = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glow);
  const eyeB = eyeA.clone();
  eyeA.position.set(-0.11, 2.28, -0.34);
  eyeB.position.set(0.11, 2.28, -0.34);
  group.add(eyeA, eyeB);

  const armGeo = new THREE.CapsuleGeometry(0.08, 1.1, 6, 10);
  const armA = new THREE.Mesh(armGeo, skin);
  const armB = new THREE.Mesh(armGeo, skin);
  armA.position.set(-0.44, 1.35, -0.04);
  armB.position.set(0.44, 1.35, -0.04);
  armA.rotation.z = 0.24;
  armB.rotation.z = -0.24;
  group.add(armA, armB);
  return group;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameStarted && player.alive && !player.escaped) {
    updatePlayer(dt);
    updateInteractions(dt);
    updateMonster(dt);
    updateItems(dt);
    updateNoiseRipples(dt);
    updateHud(dt);
  }

  if (monster.mixer) {
    monster.mixer.update(dt);
  } else if (monster.root) {
    const sway = Math.sin(performance.now() * 0.006) * 0.04;
    monster.root.rotation.z = sway;
  }

  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  player.crouching = keys.has("ControlLeft") || keys.has("ControlRight") || keys.has("KeyC");
  const sprinting = (keys.has("ShiftLeft") || keys.has("ShiftRight")) && !player.crouching;
  const speed = player.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : PLAYER_SPEED;

  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  const move = new THREE.Vector3();
  if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(forward);
  if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(forward);
  if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    tryMove(move);
    player.stepTimer -= dt;
    if (player.stepTimer <= 0) {
      player.stepTimer = sprinting ? 0.32 : player.crouching ? 0.75 : 0.52;
      if (sprinting) emitNoise(player.pos, 7.5, "Passos apressados");
      playFootstep(player.crouching ? 0.04 : sprinting ? 0.13 : 0.075);
    }
  } else {
    player.stepTimer = Math.min(player.stepTimer, 0.15);
  }

  updateCamera(dt);
}

function tryMove(delta) {
  const next = player.pos.clone().add(delta);
  if (!isPositionBlocked(next)) {
    player.pos.copy(next);
    return;
  }

  const nextX = player.pos.clone();
  nextX.x += delta.x;
  if (!isPositionBlocked(nextX)) player.pos.copy(nextX);

  const nextZ = player.pos.clone();
  nextZ.z += delta.z;
  if (!isPositionBlocked(nextZ)) player.pos.copy(nextZ);
}

function updateCamera(dt) {
  const targetHeight = player.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
  camera.position.x = player.pos.x;
  camera.position.z = player.pos.z;
  camera.position.y = THREE.MathUtils.lerp(camera.position.y || targetHeight, targetHeight, Math.min(1, dt * 9));

  if (player.holding) {
    const heldPos = camera.localToWorld(new THREE.Vector3(0.42, -0.32, -1.2));
    player.holding.mesh.position.lerp(heldPos, 0.55);
    player.holding.mesh.quaternion.slerp(camera.quaternion, 0.42);
  }
}

function isPositionBlocked(pos) {
  const cell = cellFromWorld(pos);
  if (!isWalkable(cell.x, cell.z)) return true;

  for (const collider of colliders) {
    const dx = Math.abs(pos.x - collider.x);
    const dz = Math.abs(pos.z - collider.z);
    if (dx < collider.halfX + PLAYER_RADIUS && dz < collider.halfZ + PLAYER_RADIUS) {
      return true;
    }
  }
  return false;
}

function updateInteractions() {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const item of interactables) {
    if (item.disabled) continue;
    const dist = flatDistance(player.pos, item.pos);
    if (dist < item.radius && dist < nearestDistance) {
      nearest = item;
      nearestDistance = dist;
    }
  }

  if (player.holding) {
    setPrompt(`Segurando: ${player.holding.label}`);
    return;
  }

  if (nearest) {
    setPrompt(nearest.label);
  } else {
    setPrompt("");
  }
}

function interact() {
  if (player.holding) {
    dropHeldItem(false);
    return;
  }

  let nearest = null;
  let nearestDistance = Infinity;
  for (const item of interactables) {
    if (item.disabled) continue;
    const dist = flatDistance(player.pos, item.pos);
    if (dist < item.radius && dist < nearestDistance) {
      nearest = item;
      nearestDistance = dist;
    }
  }

  if (nearest) nearest.action();
}

function pickupKey() {
  player.hasKey = true;
  const item = interactables.find((entry) => entry.id === "key");
  if (item) item.disabled = true;
  if (keyMesh) scene.remove(keyMesh);
  showEvent("Chave encontrada.");
  playTone(520, 0.08, 0.05, "triangle");
}

function tryEscape() {
  if (!player.hasKey) {
    showEvent("A fechadura esta intacta.");
    emitNoise(player.pos, 5.5, "Macaneta");
    playDoorKnock();
    return;
  }

  player.escaped = true;
  if (document.pointerLockElement) document.exitPointerLock();
  exitDoor.rotation.y = -0.92;
  objectiveText.textContent = "Livre";
  showEnd(true);
}

function createNoisyItem(pos, label, index) {
  const material = new THREE.MeshStandardMaterial({
    color: [0x8c6f52, 0x9b494e, 0x879078, 0x6e7184, 0xb89455][index % 5],
    roughness: 0.7,
    metalness: index === 2 ? 0.35 : 0.05
  });
  const geometry = index % 2 === 0
    ? new THREE.CylinderGeometry(0.22, 0.28, 0.62, 14)
    : new THREE.BoxGeometry(0.44, 0.56, 0.36);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pos.x, 0.34, pos.z);
  mesh.rotation.y = index * 0.8;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const item = {
    id: `noise-${index}`,
    label,
    mesh,
    pos: mesh.position,
    radius: 1.4,
    held: false,
    falling: false,
    velocity: new THREE.Vector3(),
    action: () => pickupNoisyItem(item)
  };
  noisyItems.push(item);
  interactables.push(item);
}

function pickupNoisyItem(item) {
  if (player.holding || item.held) return;
  item.held = true;
  item.falling = false;
  item.velocity.set(0, 0, 0);
  player.holding = item;
  item.mesh.castShadow = false;
  showEvent(`${item.label} na mao.`);
}

function dropHeldItem(thrown) {
  if (!player.holding) return;
  const item = player.holding;
  player.holding = null;
  item.held = false;
  item.falling = true;
  item.mesh.castShadow = true;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  item.velocity.copy(direction.multiplyScalar(thrown ? 4.8 : 1.2));
  item.velocity.y = thrown ? 1.4 : 0.25;
  showEvent(`${item.label} caiu.`);
}

function updateItems(dt) {
  for (const item of noisyItems) {
    if (item.held || !item.falling) continue;
    item.velocity.y -= 9.8 * dt;
    item.mesh.position.addScaledVector(item.velocity, dt);
    item.mesh.rotation.x += dt * item.velocity.z * 1.8;
    item.mesh.rotation.z -= dt * item.velocity.x * 1.8;

    if (item.mesh.position.y <= 0.32) {
      item.mesh.position.y = 0.32;
      item.falling = false;
      item.velocity.set(0, 0, 0);
      emitNoise(item.mesh.position, 24, item.label);
      playThud();
    }
  }
}

function updateMonster(dt) {
  const canSee = canMonsterSeePlayer();
  monster.repathTimer -= dt;

  if (canSee) {
    if (monster.state !== "chase") showEvent("Ele viu voce.");
    monster.state = "chase";
    monster.lastSeenPos = player.pos.clone();
    monster.waitTimer = 0;
    alertPanel.className = "hud-block alert-state is-alert";
    alertText.textContent = "Perto";
  }

  if (monster.state === "chase") {
    setMonsterAction("run");
    if (monster.repathTimer <= 0) {
      monster.repathTimer = 0.28;
      monster.path = makePath(monster.pos, player.pos);
      monster.pathIndex = 0;
    }
    followMonsterPath(MONSTER_CHASE_SPEED, dt);

    if (!canSee && monster.lastSeenPos && flatDistance(monster.pos, monster.lastSeenPos) < 1.1) {
      monster.state = "investigate";
      monster.investigateTarget = monster.lastSeenPos.clone();
      monster.waitTimer = 2.1;
      monster.path = [];
    }
  } else if (monster.state === "investigate") {
    setMonsterAction("walk");
    if (!monster.investigateTarget) {
      monster.state = "patrol";
    } else {
      if (!monster.path.length || monster.repathTimer <= 0) {
        monster.repathTimer = 0.85;
        monster.path = makePath(monster.pos, monster.investigateTarget);
        monster.pathIndex = 0;
      }
      followMonsterPath(MONSTER_INVESTIGATE_SPEED, dt);
      if (flatDistance(monster.pos, monster.investigateTarget) < 1.0) {
        monster.waitTimer -= dt;
        if (monster.waitTimer <= 0) {
          monster.state = "patrol";
          monster.investigateTarget = null;
          monster.path = [];
        }
      }
    }
  } else {
    setMonsterAction("walk");
    const waypoint = patrolWaypoints[monster.patrolIndex % patrolWaypoints.length];
    if (!monster.path.length || monster.repathTimer <= 0) {
      monster.repathTimer = 1.0;
      monster.path = makePath(monster.pos, waypoint);
      monster.pathIndex = 0;
    }
    followMonsterPath(MONSTER_PATROL_SPEED, dt);
    if (flatDistance(monster.pos, waypoint) < 0.9) {
      monster.patrolIndex = (monster.patrolIndex + 1) % patrolWaypoints.length;
      monster.path = [];
    }
  }

  if (flatDistance(monster.pos, player.pos) < MONSTER_CATCH_DISTANCE) {
    player.alive = false;
    if (document.pointerLockElement) document.exitPointerLock();
    playSting();
    showEnd(false);
  }
}

function followMonsterPath(speed, dt) {
  if (!monster.path.length || !monster.root) return;

  const target = monster.path[Math.min(monster.pathIndex, monster.path.length - 1)];
  tmpVecA.subVectors(target, monster.pos);
  tmpVecA.y = 0;
  const distance = tmpVecA.length();
  if (distance < 0.14) {
    monster.pathIndex += 1;
    if (monster.pathIndex >= monster.path.length) monster.path = [];
    return;
  }

  tmpVecA.normalize();
  monster.forward.lerp(tmpVecA, 0.12).normalize();
  monster.pos.addScaledVector(tmpVecA, speed * dt);
  monster.root.position.copy(monster.pos);
  tmpVecB.copy(monster.pos).add(monster.forward);
  monster.root.lookAt(tmpVecB.x, monster.root.position.y, tmpVecB.z);
}

function setMonsterAction(name) {
  const action = monster.actions[name] || monster.actions.walk || null;
  if (!action || monster.activeAction === action) return;

  if (monster.activeAction) monster.activeAction.fadeOut(0.18);
  action.reset().fadeIn(0.18).play();
  monster.activeAction = action;
}

function canMonsterSeePlayer() {
  if (!monster.root) return false;
  const distance = flatDistance(monster.pos, player.pos);
  if (distance < 2.2) return hasLineOfSight(monster.pos, player.pos);
  if (distance > MONSTER_VIEW_DISTANCE) return false;

  tmpVecA.subVectors(player.pos, monster.pos);
  tmpVecA.y = 0;
  tmpVecA.normalize();
  if (tmpVecA.dot(monster.forward) < MONSTER_VIEW_COS) return false;
  return hasLineOfSight(monster.pos, player.pos);
}

function emitNoise(pos, intensity, label) {
  if (!gameStarted || !player.alive || player.escaped) return;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.36, 48),
    new THREE.MeshBasicMaterial({
      color: 0xd48a3d,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  ring.position.set(pos.x, 0.045, pos.z);
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  noiseRipples.push({ mesh: ring, age: 0, maxAge: 1.15, intensity });

  const heard = flatDistance(monster.pos, pos) <= intensity;
  if (heard && monster.state !== "chase") {
    monster.state = "investigate";
    monster.investigateTarget = pos.clone();
    monster.waitTimer = 2.2;
    monster.path = [];
    monster.repathTimer = 0;
    showEvent(`Ele ouviu: ${label}.`);
  }
}

function updateNoiseRipples(dt) {
  for (let i = noiseRipples.length - 1; i >= 0; i -= 1) {
    const ripple = noiseRipples[i];
    ripple.age += dt;
    const t = ripple.age / ripple.maxAge;
    ripple.mesh.scale.setScalar(1 + t * Math.max(3, ripple.intensity * 0.32));
    ripple.mesh.material.opacity = Math.max(0, 0.48 * (1 - t));
    if (ripple.age >= ripple.maxAge) {
      scene.remove(ripple.mesh);
      noiseRipples.splice(i, 1);
    }
  }
}

function makePath(fromPos, toPos) {
  const start = cellFromWorld(fromPos);
  const end = cellFromWorld(toPos);
  if (!isWalkable(end.x, end.z)) return [];

  const queue = [start];
  const seen = new Set([cellKey(start.x, start.z)]);
  const parent = new Map();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length) {
    const current = queue.shift();
    if (current.x === end.x && current.z === end.z) break;

    for (const [dx, dz] of dirs) {
      const next = { x: current.x + dx, z: current.z + dz };
      const key = cellKey(next.x, next.z);
      if (seen.has(key) || !isWalkable(next.x, next.z)) continue;
      seen.add(key);
      parent.set(key, current);
      queue.push(next);
    }
  }

  const endKey = cellKey(end.x, end.z);
  if (!seen.has(endKey)) return [];

  const cells = [];
  let current = end;
  while (current && !(current.x === start.x && current.z === start.z)) {
    cells.push(current);
    current = parent.get(cellKey(current.x, current.z));
  }
  cells.reverse();
  return cells.map((cell) => worldFromCell(cell.x, cell.z));
}

function hasLineOfSight(from, to) {
  tmpVecA.copy(from);
  tmpVecB.copy(to);
  const distance = flatDistance(tmpVecA, tmpVecB);
  const steps = Math.max(4, Math.ceil(distance / 0.45));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    tmpVec3.lerpVectors(tmpVecA, tmpVecB, t);
    const cell = cellFromWorld(tmpVec3);
    if (!isWalkable(cell.x, cell.z)) return false;
  }
  return true;
}

function updateHud(dt = 0) {
  objectiveText.textContent = player.hasKey ? "Abra a porta" : "Encontre a chave";
  inventoryText.textContent = player.hasKey ? "Chave" : player.holding ? player.holding.label : "Vazio";

  if (monster.state === "chase") {
    alertPanel.className = "hud-block alert-state is-alert";
    alertText.textContent = "Perseguindo";
  } else if (monster.state === "investigate") {
    alertPanel.className = "hud-block alert-state is-listening";
    alertText.textContent = "Ouvindo";
  } else {
    alertPanel.className = "hud-block alert-state";
    const dist = flatDistance(monster.pos, player.pos);
    alertText.textContent = dist < 10 ? "Proxima" : "Distante";
  }

  if (eventTimer > 0) {
    eventTimer -= dt;
    if (eventTimer <= 0) {
      eventText.classList.remove("is-visible");
    }
  }
}

function setPrompt(text) {
  if (text === lastPrompt) return;
  lastPrompt = text;
  promptText.textContent = text;
  promptText.classList.toggle("is-visible", Boolean(text));
}

function showEvent(text) {
  eventText.textContent = text;
  eventText.classList.add("is-visible");
  eventTimer = 2.25;
}

function showEnd(escaped) {
  endOverlay.classList.add("is-visible");
  endEyebrow.textContent = escaped ? "Fuga concluida" : "Capturado";
  endTitle.textContent = escaped ? "Voce escapou" : "Ele pegou voce";
  endCopy.textContent = escaped
    ? "A fechadura cedeu e o ar frio da rua nunca pareceu tao bom."
    : "O corredor escureceu antes que a porta pudesse abrir.";
}

function addFurniture() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3528, roughness: 0.72 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x243f35, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x343c3c, roughness: 0.62, metalness: 0.2 });

  [
    { cell: [3, 1], size: [1.6, 0.72, 0.9], mat: wood },
    { cell: [8, 1], size: [2.0, 1.5, 0.55], mat: wood },
    { cell: [15, 1], size: [1.2, 0.9, 1.2], mat: cloth },
    { cell: [3, 5], size: [1.8, 0.74, 1.1], mat: wood },
    { cell: [12, 5], size: [0.9, 1.65, 0.8], mat: metal },
    { cell: [15, 7], size: [1.8, 0.64, 0.9], mat: wood },
    { cell: [8, 9], size: [1.1, 1.4, 0.6], mat: wood },
    { cell: [3, 13], size: [1.8, 0.8, 1.0], mat: cloth }
  ].forEach((item) => {
    const pos = worldFromCell(item.cell[0], item.cell[1]);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(item.size[0], item.size[1], item.size[2]), item.mat);
    mesh.position.set(pos.x, item.size[1] / 2 - 0.02, pos.z);
    mesh.rotation.y = (item.cell[0] + item.cell[1]) * 0.17;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}

function addFloorDebris(pos) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f3028, roughness: 0.95 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.13), mat);
  mesh.position.set(pos.x + rand(-0.9, 0.9), 0.04, pos.z + rand(-0.9, 0.9));
  mesh.rotation.y = rand(0, Math.PI);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function makeFloorTexture() {
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = 256;
  canvasTexture.height = 256;
  const ctx = canvasTexture.getContext("2d");
  ctx.fillStyle = "#574b3e";
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? "#625646" : "#4d4237";
    ctx.fillRect(0, y, 256, 28);
    ctx.fillStyle = "rgba(20,15,10,.28)";
    ctx.fillRect(0, y + 27, 256, 2);
  }
  for (let x = 0; x < 256; x += 48) {
    ctx.fillStyle = "rgba(255,255,255,.035)";
    ctx.fillRect(x + 4, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 2.2);
  return texture;
}

function makeWallTexture() {
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = 256;
  canvasTexture.height = 256;
  const ctx = canvasTexture.getContext("2d");
  ctx.fillStyle = "#625f52";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i += 1) {
    const shade = Math.floor(rand(58, 112));
    ctx.fillStyle = `rgba(${shade},${shade - 6},${shade - 14},${rand(0.07, 0.18)})`;
    ctx.fillRect(rand(0, 256), rand(0, 256), rand(1, 5), rand(1, 7));
  }
  ctx.fillStyle = "rgba(35,25,18,.35)";
  ctx.fillRect(0, 0, 256, 14);
  ctx.fillRect(0, 242, 256, 14);
  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.1);
  return texture;
}

function playTone(freq, duration, gainValue, type = "sine") {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainValue, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playThud() {
  playTone(82, 0.2, 0.2, "sine");
  setTimeout(() => playTone(48, 0.18, 0.11, "triangle"), 35);
}

function playFootstep(volume) {
  playTone(rand(90, 140), 0.045, volume, "triangle");
}

function playDoorKnock() {
  playTone(120, 0.08, 0.16, "square");
  setTimeout(() => playTone(104, 0.08, 0.1, "square"), 90);
}

function playSting() {
  playTone(44, 0.55, 0.24, "sawtooth");
  setTimeout(() => playTone(31, 0.7, 0.18, "sawtooth"), 80);
}

function worldFromCell(x, z) {
  return new THREE.Vector3(
    (x - MAP_W / 2 + 0.5) * CELL,
    0,
    (z - MAP_H / 2 + 0.5) * CELL
  );
}

function cellFromWorld(pos) {
  return {
    x: Math.floor(pos.x / CELL + MAP_W / 2),
    z: Math.floor(pos.z / CELL + MAP_H / 2)
  };
}

function findMarker(marker) {
  for (let z = 0; z < MAP_H; z += 1) {
    const x = RAW_MAP[z].indexOf(marker);
    if (x >= 0) return worldFromCell(x, z);
  }
  return worldFromCell(1, 1);
}

function isWalkable(x, z) {
  if (z < 0 || z >= MAP_H || x < 0 || x >= MAP_W) return false;
  return RAW_MAP[z][x] !== "#";
}

function cellKey(x, z) {
  return `${x},${z}`;
}

function flatDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}
