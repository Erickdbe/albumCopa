import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const ASSET_ROOT = "./Granny_Game-main/assets";
const PLAYER_START = new THREE.Vector3(55, 8, 18);
const GRANNY_ORIGIN_Y = {
  basement: 2.84,
  main: 5.76,
  top: 9.15
};
const GRANNY_START = new THREE.Vector3(49.5, GRANNY_ORIGIN_Y.main, 24.5);
const PLAYER_SPEED = 5.0;
const SPRINT_SPEED = 6.6;
const PLAYER_RADIUS = 0.34;
const PLAYER_EYE_HEIGHT = 1.34;
const PLAYER_STEP_HEIGHT = 0.72;
const PLAYER_MAX_DROP = 1.15;
const PLAYER_JUMP_SPEED = 4.8;
const GRAVITY = 13.5;
const GRANNY_RADIUS = 0.32;
const GRANNY_FOOT_OFFSET = 0.9;
const GRANNY_STEP_HEIGHT = 0.78;
const GRANNY_MAX_DROP = 1.35;
const FLOOR_RAY_LIFT = 1.25;
const FLOOR_RAY_DEPTH = 4.8;
const WALKABLE_NORMAL_MIN = 0.42;
const ITEM_VISUAL_SCALE = 0.62;
const MAX_COLLISION_STEP = 0.12;
const INTERACT_DISTANCE = 3.4;
const GRANNY_CATCH_DISTANCE = 3.0;
const GRANNY_NOTICE_DISTANCE = 8.5;
const MAP_BOUNDS = {
  minX: 40.05,
  maxX: 60.65,
  minZ: 13.2,
  maxZ: 29.25
};
const PLAYER_BODY = {
  radius: PLAYER_RADIUS,
  heightFromGround: PLAYER_EYE_HEIGHT,
  bottomOffset: -PLAYER_EYE_HEIGHT + 0.12,
  topOffset: -0.08,
  stepHeight: PLAYER_STEP_HEIGHT,
  maxDrop: PLAYER_MAX_DROP
};
const GRANNY_BODY = {
  radius: GRANNY_RADIUS,
  heightFromGround: -GRANNY_FOOT_OFFSET,
  bottomOffset: GRANNY_FOOT_OFFSET + 0.12,
  topOffset: GRANNY_FOOT_OFFSET + 2.35,
  stepHeight: GRANNY_STEP_HEIGHT,
  maxDrop: GRANNY_MAX_DROP
};

const canvas = document.getElementById("gameCanvas");
const startOverlay = document.getElementById("startOverlay");
const endOverlay = document.getElementById("endOverlay");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const loadText = document.getElementById("loadText");
const objectiveText = document.getElementById("objectiveText");
const inventoryText = document.getElementById("inventoryText");
const livesText = document.getElementById("livesText");
const presenceText = document.getElementById("presenceText");
const promptText = document.getElementById("promptText");
const eventText = document.getElementById("eventText");
const endEyebrow = document.getElementById("endEyebrow");
const endTitle = document.getElementById("endTitle");
const endCopy = document.getElementById("endCopy");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020303);
scene.fog = new THREE.FogExp2(0x020303, 0.062);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 120);
camera.rotation.order = "YXZ";

const textureLoader = new THREE.TextureLoader();
const objLoader = new OBJLoader();
const clock = new THREE.Clock();
const keys = new Set();
const textureMaterials = new Map();
const modelSources = new Map();
const loaded = [];
const pickables = new Map();
const doors = new Map();
const spiders = [];
const walkableMeshes = [];
const wallMeshes = [];
const solidRayMeshes = [];
const solidObjects = [];
const tempVec = new THREE.Vector3();
const tempBox = new THREE.Box3();
const downVector = new THREE.Vector3(0, -1, 0);
const groundRaycaster = new THREE.Raycaster();
const wallRaycaster = new THREE.Raycaster();

let running = false;
let loadedCount = 0;
let totalToLoad = 0;
let activePrompt = null;
let eventTimer = 0;
let pointerLockWasActive = false;
let ignorePointerUnlockUntil = 0;

const player = {
  pos: PLAYER_START.clone(),
  yaw: -Math.PI / 2,
  pitch: 0,
  held: null,
  lives: 10,
  caughtCooldown: 0,
  verticalVelocity: 0,
  grounded: false,
  hiddenSpot: null,
  rescuedBoy: false,
  escaped: false
};

const granny = {
  object: null,
  pos: GRANNY_START.clone(),
  targetIndex: 0,
  noiseTarget: null,
  state: "patrol",
  lastMoved: false,
  walkTime: 0,
  attackTimer: 0,
  baseScale: new THREE.Vector3(1, 1, 1)
};

const patrolPoints = [
  [49.5, GRANNY_ORIGIN_Y.main, 24.5],
  [49.5, GRANNY_ORIGIN_Y.main, 20.2],
  [48.45, GRANNY_ORIGIN_Y.main, 20.2],
  [49.5, GRANNY_ORIGIN_Y.main, 20.2],
  [49.5, GRANNY_ORIGIN_Y.main, 24.5],
  [47.5, 6.05, 24.5],
  [49.5, GRANNY_ORIGIN_Y.main, 24.5]
].map(([x, y, z]) => new THREE.Vector3(x, y, z));

const audio = {
  ambient: makeAudio("audio/granny_house_music.mp3", { loop: true, volume: 0.34 }),
  chase: makeAudio("audio/chased.mp3", { loop: true, volume: 0.28 }),
  door: makeAudio("audio/openDoor.mp3", { volume: 0.5 }),
  hit: makeAudio("audio/scream.mp3", { volume: 0.46 }),
  secret: makeAudio("audio/secret.mp3", { volume: 0.45 }),
  step: makeAudio("audio/walking-on-a-wooden-floor-14743.mp3", { volume: 0.18 })
};

const modelDefs = [
  {
    id: "house",
    path: "models/granny_1_house.obj",
    texture: "textures/granny/house2.png",
    position: [50, 0, 20],
    scale: [50, 50, 50]
  },
  {
    id: "granny",
    path: "models/test2.obj",
    texture: "textures/Torso1_diff (1).png",
    position: [GRANNY_START.x, GRANNY_START.y, GRANNY_START.z],
    scale: [0.05, 0.05, 0.05],
    kind: "granny"
  },
  {
    id: "door1",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [53.7, 11.4, 25.7],
    rotation: [0, 180, 0],
    scale: [0.05, 0.03, 0.04],
    kind: "door",
    label: "Porta com parafuso",
    required: "screw",
    openedPosition: [52.8, 11.4, 26.5],
    openedRotation: [0, 90, 0]
  },
  {
    id: "door2",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [46.85, 11.4, 20.2],
    rotation: [0, 180, 180],
    scale: [0.035, 0.03, 0.035],
    kind: "door",
    label: "Porta do quarto",
    required: "key3",
    openedPosition: [45.85, 11.4, 21.2],
    openedRotation: [0, 90, 180]
  },
  {
    id: "door3",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [52, 11.4, 19.1],
    rotation: [0, 90, 180],
    scale: [0.035, 0.03, 0.035],
    kind: "door",
    label: "Porta do segundo andar",
    required: "key2",
    openedPosition: [53, 11.4, 20],
    openedRotation: [0, 180, 180]
  },
  {
    id: "door4",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [57.6, 11.4, 14.8],
    rotation: [0, 180, 0],
    scale: [0.03, 0.03, 0.03],
    kind: "door",
    label: "Porta trancada",
    required: null
  },
  {
    id: "door5",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [48.45, 7.8, 20.2],
    rotation: [0, 180, 180],
    scale: [0.028, 0.032, 0.028],
    kind: "door",
    label: "Porta da sala",
    required: "key4",
    openedPosition: [49.2, 7.8, 21],
    openedRotation: [0, 90, 180]
  },
  {
    id: "door6",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [53.0, 7.8, 23.3],
    rotation: [0, 90, 180],
    scale: [0.03, 0.032, 0.03],
    kind: "door",
    label: "Porta interna",
    required: "key1",
    openedPosition: [53.5, 7.8, 24.2],
    openedRotation: [0, 180, 180]
  },
  {
    id: "masterdoor",
    path: "models/door.obj",
    texture: "textures/door.png",
    position: [50.25, 7.8, 27.0],
    rotation: [0, 270, 180],
    scale: [0.03, 0.032, 0.03],
    kind: "door",
    label: "Porta principal",
    required: "key6",
    win: true
  },
  {
    id: "table",
    path: "models/table.obj",
    texture: "textures/wood.jpg",
    position: [39.6, 10.1, 26],
    rotation: [0, 180, 0],
    scale: [0.09, 0.06, 0.08]
  },
  {
    id: "drawer",
    path: "models/drawer.obj",
    texture: "textures/drawer.jpeg",
    position: [45.7, 11.25, 14.45],
    rotation: [-180, -180, 180],
    scale: [1.1, 0.55, 0.65],
    kind: "container",
    label: "Gaveta pesada",
    required: "hummer"
  },
  {
    id: "screw",
    path: "models/screw.obj",
    texture: "textures/screw.png",
    position: [54, 7.3, 23.0],
    scale: [0.05, 0.05, 0.05],
    kind: "item",
    label: "Parafuso"
  },
  {
    id: "hummer",
    path: "models/hummer.obj",
    texture: "textures/hummer.png",
    position: [54.8, 11.2, 18.7],
    rotation: [0, 0, 90],
    scale: [0.0003, 0.0003, 0.0003],
    kind: "item",
    label: "Martelo"
  },
  {
    id: "key1",
    path: "models/key_low.obj",
    texture: "textures/KeyRust_A.png",
    position: [45.7, 11.25, 15],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.09],
    kind: "item",
    label: "Chave 1",
    hidden: true
  },
  {
    id: "key2",
    path: "models/key_low.obj",
    texture: "textures/KeyRust_A.png",
    position: [44.7, 10.1, 25.45],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.09],
    kind: "item",
    label: "Chave 2"
  },
  {
    id: "key3",
    path: "models/key_low.obj",
    texture: "textures/KeyRust_A.png",
    position: [57.0, 10.8, 19.63],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.06],
    kind: "item",
    label: "Chave 3"
  },
  {
    id: "key4",
    path: "models/key_low.obj",
    texture: "textures/KeyRust_A.png",
    position: [57.8, 7.16, 18.2],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.06],
    kind: "item",
    label: "Chave 4"
  },
  {
    id: "key5",
    path: "models/key_low.obj",
    texture: "textures/KeyRust_A.png",
    position: [47.7, 6.65, 21.45],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.09],
    kind: "item",
    label: "Chave da prisao"
  },
  {
    id: "key6",
    path: "models/key_low.obj",
    texture: "textures/MK.jpg",
    position: [50.7, 3.85, 23.45],
    rotation: [90, 0, 0],
    scale: [0.03, 0.03, 0.09],
    kind: "item",
    label: "Chave mestra"
  },
  {
    id: "boy",
    path: "models/boy.obj",
    texture: "textures/boy.png",
    position: [50.8, 3.7, 23.8],
    rotation: [0, -90, 0],
    scale: [0.01, 0.01, 0.01],
    kind: "boy"
  },
  {
    id: "prison1",
    path: "models/prison.obj",
    texture: "textures/prison.png",
    position: [54.8, 4.7, 28.4],
    rotation: [0, -90, 0],
    scale: [0.01, 0.01, 0.01]
  },
  {
    id: "prison",
    path: "models/prison.obj",
    texture: "textures/prison.png",
    position: [49.8, 4.7, 28.4],
    rotation: [0, -90, 0],
    scale: [0.01, 0.01, 0.01],
    kind: "door",
    label: "Cela",
    required: "key5",
    prison: true,
    openedPosition: [50.8, 4.7, 29.5],
    openedRotation: [0, -90, 0]
  },
  ...[
    [47, 6.6, 15],
    [48, 6.6, 15],
    [55, 6.6, 13],
    [50, 6.6, 15],
    [45, 6.6, 15]
  ].map((position, index) => ({
    id: `spider${index + 1}`,
    path: "models/Spider.obj",
    texture: "textures/spider.png",
    position,
    scale: [0.003, 0.003, 0.003],
    kind: "spider"
  }))
];

const hidingSpots = [
  {
    id: "bed-top",
    label: "Debaixo da cama",
    position: new THREE.Vector3(44.8, 11.25, 18.9),
    hidePosition: new THREE.Vector3(44.8, 10.55, 18.9),
    exitPosition: new THREE.Vector3(46.2, 11.39, 20.2),
    yaw: Math.PI * 0.5
  },
  {
    id: "wardrobe-main",
    label: "Dentro do armario",
    position: new THREE.Vector3(51.2, 8.05, 16.35),
    hidePosition: new THREE.Vector3(51.2, 7.25, 16.35),
    exitPosition: new THREE.Vector3(50.2, 8.0, 17.6),
    yaw: -Math.PI * 0.15
  },
  {
    id: "cabinet-basement",
    label: "Atras do movel",
    position: new THREE.Vector3(49.0, 5.0, 21.0),
    hidePosition: new THREE.Vector3(49.0, 4.45, 21.0),
    exitPosition: new THREE.Vector3(50.1, 5.07, 22.1),
    yaw: Math.PI * 0.85
  }
];

init();

function init() {
  buildLighting();
  loadScene();
  bindEvents();
  updateHud();
  renderer.setAnimationLoop(loop);
}

function asset(path) {
  return `${ASSET_ROOT}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function makeAudio(path, options = {}) {
  const element = new Audio(asset(path));
  element.loop = Boolean(options.loop);
  element.volume = options.volume ?? 0.4;
  element.preload = "auto";
  return element;
}

function playAudio(sound, restart = true) {
  if (!sound) return;
  if (restart) sound.currentTime = 0;
  sound.play().catch(() => {});
}

function stopAudio(sound) {
  if (!sound) return;
  sound.pause();
  sound.currentTime = 0;
}

function makeMaterial(texturePath, options = {}) {
  const cacheKey = `${texturePath}:${options.color || ""}:${options.roughness ?? ""}:${options.metalness ?? ""}`;
  if (textureMaterials.has(cacheKey)) return textureMaterials.get(cacheKey);

  const texture = textureLoader.load(asset(texturePath));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: options.color || 0xffffff,
    roughness: options.roughness ?? 0.82,
    metalness: options.metalness ?? 0.04,
    side: THREE.DoubleSide
  });
  textureMaterials.set(cacheKey, material);
  return material;
}

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0x46554d, 0x050202, 0.2));

  const moon = new THREE.DirectionalLight(0x7c8fbf, 0.26);
  moon.position.set(44, 34, 16);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  scene.add(moon);

  const handLight = new THREE.SpotLight(0xffc27d, 1.35, 15, Math.PI / 7.2, 0.62, 1.6);
  handLight.position.set(0, 0, 0);
  handLight.target.position.set(0, 0, -1);
  camera.add(handLight);
  camera.add(handLight.target);
  scene.add(camera);

  [
    [50.3, 11.6, 26.8, 0xe7bd73, 0.52],
    [45.2, 10.9, 18.5, 0xd4f1ff, 0.38],
    [54.7, 7.6, 22.5, 0xe7bd73, 0.44],
    [50.4, 4.9, 28.5, 0xc8d6ff, 0.48]
  ].forEach(([x, y, z, color, power]) => {
    const light = new THREE.PointLight(color, power, 10, 1.8);
    light.position.set(x, y, z);
    scene.add(light);
  });
}

function loadScene() {
  totalToLoad = modelDefs.length;
  modelDefs.forEach(loadModel);
}

function loadModel(def) {
  const material = def.texture ? makeMaterial(def.texture) : new THREE.MeshStandardMaterial({ color: 0x807060 });
  loadObjSource(def.path)
    .then((source) => {
      const object = source.clone(true);
      object.name = def.id;
      object.position.fromArray(def.position || [0, 0, 0]);
      object.rotation.set(...(def.rotation || [0, 0, 0]).map(THREE.MathUtils.degToRad));
      object.scale.fromArray(def.scale || [1, 1, 1]);
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.material = material;
        child.castShadow = def.id !== "house";
        child.receiveShadow = true;
      });
      scene.add(object);
      object.updateMatrixWorld(true);
      loaded.push(object);
      registerEntity(def, object);
      onAssetLoaded();
    })
    .catch(() => {
      const fallback = makeFallback(def, material);
      scene.add(fallback);
      fallback.updateMatrixWorld(true);
      registerEntity(def, fallback);
      onAssetLoaded();
    });
}

function loadObjSource(path) {
  if (modelSources.has(path)) return modelSources.get(path);

  const promise = new Promise((resolve, reject) => {
    objLoader.load(asset(path), resolve, undefined, reject);
  });
  modelSources.set(path, promise);
  return promise;
}

function makeFallback(def, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = def.id;
  mesh.position.fromArray(def.position || [0, 0, 0]);
  mesh.rotation.set(...(def.rotation || [0, 0, 0]).map(THREE.MathUtils.degToRad));
  mesh.scale.fromArray(def.scale || [1, 1, 1]);
  return mesh;
}

function registerEntity(def, object) {
  const pos = new THREE.Vector3().fromArray(def.position || [0, 0, 0]);
  if (def.hidden) object.visible = false;

  if (def.id === "house") registerHouseCollision(object);
  if (isSolidObject(def)) {
    solidObjects.push({ id: def.id, kind: def.kind, object });
    registerSolidObjectMeshes(object);
  }
  if (def.kind === "item") applyItemPresentation(object);

  if (def.kind === "item") {
    pickables.set(def.id, {
      ...def,
      object,
      basePosition: pos,
      picked: false
    });
  }

  if (def.kind === "door") {
    doors.set(def.id, {
      ...def,
      object,
      basePosition: pos,
      opened: false
    });
  }

  if (def.kind === "container") {
    pickables.set(def.id, {
      ...def,
      object,
      basePosition: pos,
      container: true,
      opened: false
    });
  }

  if (def.kind === "spider") {
    spiders.push({
      object,
      center: pos.clone(),
      angle: Math.random() * Math.PI * 2,
      damageCooldown: 0
    });
  }

  if (def.kind === "granny") {
    granny.object = object;
    granny.pos.copy(pos);
    prepareGrannyModel(object);
  }
}

function prepareGrannyModel(object) {
  object.visible = true;
  granny.baseScale.copy(object.scale);
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.frustumCulled = false;
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.material?.isMaterial) {
      child.material = child.material.clone();
      child.material.emissive = new THREE.Color(0x210606);
      child.material.emissiveIntensity = 0.16;
      child.material.needsUpdate = true;
    }
  });
}

function applyItemPresentation(object) {
  object.scale.multiplyScalar(ITEM_VISUAL_SCALE);
  object.traverse((child) => {
    if (!child.isMesh || !child.material?.isMaterial) return;
    child.material = child.material.clone();
    child.material.emissive = new THREE.Color(0x080604);
    child.material.emissiveIntensity = 0.04;
    child.material.needsUpdate = true;
  });
  object.updateMatrixWorld(true);
}

function registerSolidObjectMeshes(object) {
  object.traverse((child) => {
    if (child.isMesh) solidRayMeshes.push(child);
  });
}

function registerHouseCollision(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    if (/HouseFloor|HouseWalls/i.test(child.name)) walkableMeshes.push(child);
    if (!/HouseFloor|blood/i.test(child.name)) {
      solidRayMeshes.push(child);
    }
    if (/HouseWalls|ExitDoor|ElectricCabinet|Furniture|Microwave|Tunna|cup|Bench|Klocka|Proppskop|Cellar/i.test(child.name)) {
      wallMeshes.push(child);
    }
    if (/ExitDoor|ElectricCabinet|Microwave|Tunna|cup/i.test(child.name)) {
      solidObjects.push({ id: `house:${child.name}`, kind: "house-solid", object: child });
    }
  });
}

function isSolidObject(def) {
  if (def.id === "house") return false;
  if (["item", "spider", "granny", "boy"].includes(def.kind)) return false;
  return def.kind === "door" || def.kind === "container" || ["table", "prison1"].includes(def.id);
}

function onAssetLoaded() {
  loadedCount += 1;
  loadText.textContent = `Carregando a casa... ${loadedCount}/${totalToLoad}`;
  if (loadedCount >= totalToLoad) {
    loadText.textContent = "A casa esta pronta.";
    startButton.disabled = false;
    if (new URLSearchParams(window.location.search).has("autostart")) {
      window.setTimeout(startDemoMode, 150);
    }
  }
}

function bindEvents() {
  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", restartGame);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === canvas) {
      pointerLockWasActive = true;
      return;
    }

    if (!running || player.escaped) return;
    if (!pointerLockWasActive || performance.now() < ignorePointerUnlockUntil) return;

    startOverlay.classList.add("is-visible");
    startButton.disabled = loadedCount < totalToLoad;
    loadText.textContent = "A partida esta pausada.";
    running = false;
  });

  canvas.addEventListener("click", () => {
    if (!running || document.pointerLockElement === canvas) return;
    ignorePointerUnlockUntil = performance.now() + 900;
    requestGamePointerLock();
  });

  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas || !running) return;
    player.yaw -= event.movementX * 0.0022;
    player.pitch -= event.movementY * 0.0018;
    player.pitch = THREE.MathUtils.clamp(player.pitch, -1.25, 1.1);
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    keys.add(key);
    if (["w", "a", "s", "d", "shift", "control", "e", "p", "g", "t", " "].includes(key)) {
      event.preventDefault();
    }
    if (!running) return;
    if (key === " ") tryJump();
    if (key === "e" || key === "p") interact();
    if (key === "g" || key === "t") dropHeld();
  });

  document.addEventListener("keyup", (event) => {
    keys.delete(event.key.toLowerCase());
  });
}

function startGame() {
  if (loadedCount < totalToLoad) return;
  running = true;
  pointerLockWasActive = false;
  ignorePointerUnlockUntil = performance.now() + 1200;
  startOverlay.classList.remove("is-visible");
  endOverlay.classList.remove("is-visible");
  requestGamePointerLock();
  playAudio(audio.ambient, false);
}

function startDemoMode() {
  if (running || loadedCount < totalToLoad) return;
  running = true;
  startOverlay.classList.remove("is-visible");
}

function requestGamePointerLock() {
  if (document.pointerLockElement === canvas) return;
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // Pointer lock can be denied by the browser; the game keeps running.
  }
}

function restartGame() {
  window.location.reload();
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.04);
  if (running) {
    updatePlayer(dt);
    updateGranny(dt);
    updateSpiders(dt);
    updateInteraction();
    updateHud();
  }
  updateCamera();
  renderer.render(scene, camera);
}

function updatePlayer(dt) {
  player.caughtCooldown = Math.max(0, player.caughtCooldown - dt);
  if (player.hiddenSpot) {
    player.verticalVelocity = 0;
    player.grounded = true;
    return;
  }

  const cameraYaw = new THREE.Euler(0, player.yaw, 0, "YXZ");
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(cameraYaw).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyEuler(cameraYaw).normalize();
  const move = new THREE.Vector3();

  if (keys.has("w")) move.add(forward);
  if (keys.has("s")) move.sub(forward);
  if (keys.has("d")) move.add(right);
  if (keys.has("a")) move.sub(right);

  if (move.lengthSq() > 0) {
    move.normalize();
    const speed = keys.has("shift") ? SPRINT_SPEED : PLAYER_SPEED;
    const step = move.multiplyScalar(speed * dt);
    const movedX = movePlayerAxis(step.x, 0, dt);
    const movedZ = movePlayerAxis(0, step.z, dt);
    if (movedX || movedZ) {
      if (keys.has("shift")) emitNoise(player.pos, 7);
      if (Math.random() < dt * 1.5) playAudio(audio.step, true);
    }
  } else if (player.grounded || player.verticalVelocity <= 0) {
    settlePlayerOnGround(dt);
  }

  applyPlayerVerticalMotion(dt);
}

function movePlayerAxis(deltaX, deltaZ, dt) {
  if (Math.abs(deltaX) + Math.abs(deltaZ) < 0.0001) return false;

  const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / MAX_COLLISION_STEP));
  let moved = false;
  for (let i = 0; i < steps; i += 1) {
    if (movePlayerAxisStep(deltaX / steps, deltaZ / steps, dt / steps)) moved = true;
    else break;
  }
  return moved;
}

function movePlayerAxisStep(deltaX, deltaZ, dt) {
  const next = player.pos.clone();
  next.x = THREE.MathUtils.clamp(next.x + deltaX, MAP_BOUNDS.minX, MAP_BOUNDS.maxX);
  next.z = THREE.MathUtils.clamp(next.z + deltaZ, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ);

  if (!player.grounded && player.verticalVelocity > 0) {
    next.y = player.pos.y;
    if (blockedByWorld(player.pos, next, PLAYER_BODY)) return false;
    player.pos.copy(next);
    return true;
  }

  const grounded = resolveGroundedPosition(next, dt, true);
  if (!grounded || blockedByWorld(player.pos, grounded, PLAYER_BODY)) return false;

  player.pos.copy(grounded);
  player.grounded = true;
  player.verticalVelocity = Math.min(0, player.verticalVelocity);
  return true;
}

function settlePlayerOnGround(dt) {
  const grounded = resolveGroundedPosition(player.pos.clone(), dt, false);
  if (grounded) {
    player.pos.y = grounded.y;
    player.grounded = true;
    if (player.verticalVelocity < 0) player.verticalVelocity = 0;
  } else {
    player.grounded = false;
  }
}

function tryJump() {
  if (player.hiddenSpot || !player.grounded) return;
  player.grounded = false;
  player.verticalVelocity = PLAYER_JUMP_SPEED;
  emitNoise(player.pos, 6);
}

function applyPlayerVerticalMotion(dt) {
  if (player.grounded && player.verticalVelocity <= 0) return;

  player.verticalVelocity -= GRAVITY * dt;
  const next = player.pos.clone();
  next.y += player.verticalVelocity * dt;

  const groundY = findGroundHeightForBody(next, player.pos.y, PLAYER_BODY);
  if (groundY !== null) {
    const groundEyeY = groundY + PLAYER_EYE_HEIGHT;
    if (player.verticalVelocity <= 0 && next.y <= groundEyeY + 0.04) {
      next.y = groundEyeY;
      player.verticalVelocity = 0;
      player.grounded = true;
      player.pos.copy(next);
      return;
    }
  }

  player.grounded = false;
  player.pos.y = next.y;
}

function resolveGroundedPosition(position, dt, allowStep) {
  return resolveActorGroundedPosition(position, player.pos.y, dt, allowStep, PLAYER_BODY);
}

function resolveActorGroundedPosition(position, currentY, dt, allowStep, body) {
  const currentGroundY = currentY - body.heightFromGround;
  const groundY = findGroundHeightForBody(position, currentY, body);
  if (groundY === null) return null;

  const targetY = groundY + body.heightFromGround;
  const rise = groundY - currentGroundY;
  if (rise > body.stepHeight) return null;
  if (allowStep && rise < -body.maxDrop) return null;

  if (targetY < currentY) {
    position.y = Math.max(targetY, currentY - Math.max(body.maxDrop, dt * 12));
  } else {
    position.y = targetY;
  }

  return position;
}

function findGroundHeight(position, currentEyeY) {
  return findGroundHeightForBody(position, currentEyeY, PLAYER_BODY);
}

function findGroundHeightForBody(position, currentY, body) {
  if (!walkableMeshes.length) return null;

  const currentGroundY = currentY - body.heightFromGround;
  const directGround = findGroundHeightAt(position.x, position.z, currentGroundY, body);
  if (directGround !== null) return directGround;

  const probe = Math.min(body.radius * 0.45, 0.22);
  const offsets = [
    [probe, 0],
    [-probe, 0],
    [0, probe],
    [0, -probe],
    [probe, probe],
    [-probe, probe],
    [probe, -probe],
    [-probe, -probe]
  ];

  for (const [dx, dz] of offsets) {
    const nearbyGround = findGroundHeightAt(position.x + dx, position.z + dz, currentGroundY, body);
    if (nearbyGround !== null) return nearbyGround;
  }

  return null;
}

function findGroundHeightAt(x, z, currentGroundY, body) {
  groundRaycaster.set(
    new THREE.Vector3(x, currentGroundY + FLOOR_RAY_LIFT, z),
    downVector
  );
  groundRaycaster.near = 0;
  groundRaycaster.far = FLOOR_RAY_DEPTH;

  const hits = groundRaycaster.intersectObjects(walkableMeshes, false);
  for (const hit of hits) {
    if (!isWalkableHit(hit)) continue;
    const rise = hit.point.y - currentGroundY;
    if (rise <= body.stepHeight + 0.04 && rise >= -body.maxDrop) {
      return hit.point.y;
    }
  }

  return null;
}

function isWalkableHit(hit) {
  const normal = hit.face?.normal?.clone();
  if (!normal) return false;
  normal.transformDirection(hit.object.matrixWorld);
  return normal.y >= WALKABLE_NORMAL_MIN;
}

function blockedByWorld(from, nextPos, body) {
  return blockedByClosedDoor(nextPos, body) || blockedBySolidObject(nextPos, body) || blockedByHouseWall(from, nextPos, body);
}

function blockedByClosedDoor(nextPos, body = PLAYER_BODY) {
  for (const door of doors.values()) {
    if (door.opened || door.id === "prison") continue;
    const dist = flatDistance(nextPos, door.object.position);
    if (dist < body.radius + 0.45 && Math.abs(nextPos.y - door.object.position.y) < 2.4) return true;
  }
  return false;
}

function blockedBySolidObject(nextPos, body = PLAYER_BODY) {
  const bodyBottom = nextPos.y + body.bottomOffset;
  const bodyTop = nextPos.y + body.topOffset;

  for (const solid of solidObjects) {
    if (solid.object.visible === false) continue;
    const door = doors.get(solid.id);
    if (door?.opened) continue;

    solid.object.updateMatrixWorld(true);
    tempBox.setFromObject(solid.object);
    if (bodyTop < tempBox.min.y || bodyBottom > tempBox.max.y) continue;

    const insideX = nextPos.x >= tempBox.min.x - body.radius && nextPos.x <= tempBox.max.x + body.radius;
    const insideZ = nextPos.z >= tempBox.min.z - body.radius && nextPos.z <= tempBox.max.z + body.radius;
    if (insideX && insideZ) return true;
  }

  return false;
}

function blockedByHouseWall(from, nextPos, body = PLAYER_BODY) {
  const meshes = solidRayMeshes.length ? solidRayMeshes : wallMeshes;
  if (!meshes.length) return false;

  const direction = nextPos.clone().sub(from).setY(0);
  const distance = direction.length();
  if (distance < 0.0001) return false;
  direction.normalize();
  const side = new THREE.Vector3(-direction.z, 0, direction.x);

  const rayHeights = [
    nextPos.y + body.bottomOffset + 0.26,
    nextPos.y + (body.bottomOffset + body.topOffset) * 0.5,
    nextPos.y + body.topOffset - 0.26
  ];
  const lateralOffsets = [
    0,
    body.radius * 0.72,
    -body.radius * 0.72
  ];

  for (const y of rayHeights) {
    for (const offset of lateralOffsets) {
      const origin = new THREE.Vector3(from.x, y, from.z).addScaledVector(side, offset);
      wallRaycaster.set(origin, direction);
      wallRaycaster.near = 0.02;
      wallRaycaster.far = distance + body.radius + 0.08;
      const hits = wallRaycaster.intersectObjects(meshes, false);
      if (hits.some((hit) => isBlockingWallHit(hit, nextPos))) return true;
    }
  }

  const probeDirections = [
    direction,
    direction.clone().negate(),
    side,
    side.clone().negate(),
    direction.clone().add(side).normalize(),
    direction.clone().sub(side).normalize(),
    direction.clone().negate().add(side).normalize(),
    direction.clone().negate().sub(side).normalize()
  ];

  for (const y of rayHeights) {
    const origin = new THREE.Vector3(nextPos.x, y, nextPos.z);
    for (const probeDirection of probeDirections) {
      wallRaycaster.set(origin, probeDirection);
      wallRaycaster.near = 0.01;
      wallRaycaster.far = body.radius + 0.06;
      const hits = wallRaycaster.intersectObjects(meshes, false);
      if (hits.some((hit) => isBlockingWallHit(hit, nextPos))) return true;
    }
  }

  return false;
}

function isBlockingWallHit(hit, nextPos) {
  const normal = hit.face?.normal?.clone();
  if (!normal) return false;
  normal.transformDirection(hit.object.matrixWorld);
  if (normal.y >= WALKABLE_NORMAL_MIN) return false;

  // The stair mesh is grouped with the house walls, so its risers must stay climbable.
  if (isStairArea(hit.point) && isStairArea(nextPos)) return false;

  return true;
}

function isStairArea(point) {
  return isMainStairArea(point) || isBasementStairArea(point);
}

function isMainStairArea(point) {
  return point.x >= 46.2 && point.x <= 49.1
    && point.z >= 21.1 && point.z <= 24.9
    && point.y >= 5.65 && point.y <= 12.25;
}

function isBasementStairArea(point) {
  return point.x >= 52.15 && point.x <= 53.85
    && point.z >= 19.1 && point.z <= 23.4
    && point.y >= 3.85 && point.y <= 8.15;
}

function updateCamera() {
  camera.position.copy(player.pos);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  if (player.held?.object) {
    const heldPos = new THREE.Vector3(0.55, -0.45, -1.15);
    player.held.object.position.copy(camera.localToWorld(heldPos));
    player.held.object.rotation.set(player.pitch * 0.4, player.yaw + Math.PI * 0.18, 0);
  }
}

function updateInteraction() {
  if (player.hiddenSpot) {
    activePrompt = { type: "hide-exit", ref: player.hiddenSpot, prompt: "Sair do esconderijo" };
    promptText.textContent = activePrompt.prompt;
    return;
  }

  activePrompt = findInteractable();
  promptText.textContent = activePrompt ? activePrompt.prompt : "";
  if (eventTimer > 0) {
    eventTimer -= clock.getDelta();
    if (eventTimer <= 0) eventText.textContent = "";
  }
}

function findInteractable() {
  const candidates = [];

  for (const item of pickables.values()) {
    if (item.picked || item.object.visible === false) continue;
    const distance = interactionDistance(item.object.position);
    if (distance <= INTERACT_DISTANCE) {
      const prompt = item.container ? item.label : item.label;
      candidates.push({ distance, type: item.container ? "container" : "item", ref: item, prompt });
    }
  }

  for (const door of doors.values()) {
    if (door.opened) continue;
    const distance = interactionDistance(door.object.position);
    if (distance <= INTERACT_DISTANCE + 0.4) {
      candidates.push({ distance, type: "door", ref: door, prompt: door.label });
    }
  }

  for (const spot of hidingSpots) {
    const distance = interactionDistance(spot.position);
    if (distance <= INTERACT_DISTANCE) {
      candidates.push({ distance, type: "hiding-spot", ref: spot, prompt: spot.label });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0] || null;
}

function interactionDistance(pos) {
  tempVec.copy(pos);
  const yWeight = Math.abs(tempVec.y - player.pos.y) * 0.45;
  const xz = flatDistance(tempVec, player.pos);
  const cameraForward = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).setY(0).normalize();
  const toTarget = tempVec.clone().sub(player.pos).setY(0).normalize();
  const facing = cameraForward.dot(toTarget);
  return facing < -0.2 ? Infinity : xz + yWeight;
}

function interact() {
  if (player.hiddenSpot) {
    exitHidingSpot();
    return;
  }

  const target = activePrompt || findInteractable();
  if (!target) return;

  if (target.type === "item") {
    pickItem(target.ref);
    return;
  }

  if (target.type === "container") {
    openContainer(target.ref);
    return;
  }

  if (target.type === "door") {
    openDoor(target.ref);
    return;
  }

  if (target.type === "hiding-spot") enterHidingSpot(target.ref);
}

function pickItem(item) {
  if (player.held) {
    showEvent("Voce ja esta segurando algo.");
    return;
  }
  player.held = item;
  item.picked = true;
  item.object.visible = true;
  emitNoise(player.pos, 4);
  showEvent(`${item.label} coletado.`);
  updateHud();
}

function dropHeld() {
  if (!player.held || player.hiddenSpot) return;
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).setY(0).normalize();
  const dropPos = player.pos.clone().addScaledVector(forward, 1.4);
  const groundY = findGroundHeightForBody(dropPos, player.pos.y, PLAYER_BODY);
  dropPos.y = groundY === null ? player.pos.y - PLAYER_EYE_HEIGHT + 0.18 : groundY + 0.18;
  player.held.object.position.copy(dropPos);
  player.held.picked = false;
  player.held = null;
  emitNoise(dropPos, 12);
  showEvent("Algo caiu no chao.");
  updateHud();
}

function enterHidingSpot(spot) {
  if (player.held) {
    showEvent("Solte o item antes de se esconder.");
    return;
  }

  player.hiddenSpot = spot;
  player.pos.copy(spot.hidePosition);
  player.yaw = spot.yaw;
  player.pitch = 0;
  player.verticalVelocity = 0;
  player.grounded = true;
  stopAudio(audio.chase);
  showEvent("Voce se escondeu.");
}

function exitHidingSpot() {
  const spot = player.hiddenSpot;
  if (!spot) return;
  player.hiddenSpot = null;
  player.pos.copy(spot.exitPosition);
  player.verticalVelocity = 0;
  player.grounded = true;
  showEvent("Voce saiu do esconderijo.");
  emitNoise(player.pos, 4);
}

function openContainer(container) {
  if (container.opened) return;
  if (!hasRequired(container.required)) {
    showEvent("A gaveta nao abre desse jeito.");
    emitNoise(container.object.position, 5);
    return;
  }

  container.opened = true;
  container.object.position.set(45.7, 11.2, 15);
  revealItem("key1");
  showEvent("A gaveta abriu.");
  playAudio(audio.secret);
  emitNoise(container.object.position, 13);
}

function openDoor(door) {
  if (door.opened) return;

  if (door.required && !hasRequired(door.required)) {
    showEvent("Esta trancado.");
    emitNoise(door.object.position, 8);
    return;
  }

  door.opened = true;
  if (door.openedPosition) door.object.position.fromArray(door.openedPosition);
  if (door.openedRotation) door.object.rotation.set(...door.openedRotation.map(THREE.MathUtils.degToRad));
  playAudio(audio.door);
  emitNoise(door.object.position, 14);

  if (door.prison) {
    player.rescuedBoy = true;
    const boy = loaded.find((object) => object.name === "boy");
    if (boy) boy.position.set(50, 6.65, 26);
    showEvent("O menino saiu da cela.");
    playAudio(audio.secret);
  } else if (door.win) {
    player.escaped = true;
    finishGame(true);
  } else {
    showEvent("A porta abriu.");
  }
}

function hasRequired(required) {
  return !required || player.held?.id === required;
}

function revealItem(id) {
  const item = pickables.get(id);
  if (!item) return;
  item.object.visible = true;
  item.hidden = false;
}

function updateGranny(dt) {
  if (!granny.object || player.escaped) return;

  if (granny.attackTimer > 0) {
    granny.attackTimer = Math.max(0, granny.attackTimer - dt);
    granny.object.position.copy(granny.pos);
    applyGrannyAnimation(false, dt);
    if (granny.attackTimer <= 0) finishGame(false);
    return;
  }

  const playerFlatDistance = flatDistance(granny.pos, player.pos);
  if (!player.hiddenSpot && playerFlatDistance < GRANNY_NOTICE_DISTANCE && isGrannyOnPlayerLevel()) {
    granny.state = "chase";
    granny.noiseTarget = makeGrannyTarget(player.pos);
  } else if (granny.noiseTarget) {
    granny.state = "investigate";
  } else {
    granny.state = "patrol";
  }

  const target = granny.noiseTarget || patrolPoints[granny.targetIndex];
  const speed = granny.state === "chase" ? 4.0 : granny.state === "investigate" ? 3.0 : 1.8;
  moveGrannyToward(target, speed, dt);

  if (flatDistance(granny.pos, target) < 0.35 && Math.abs(granny.pos.y - target.y) < 0.7) {
    if (granny.noiseTarget) {
      granny.noiseTarget = null;
    } else {
      granny.targetIndex = (granny.targetIndex + 1) % patrolPoints.length;
    }
  }

  if (!player.hiddenSpot && flatDistance(granny.pos, player.pos) < GRANNY_CATCH_DISTANCE && isGrannyOnPlayerLevel()) {
    triggerGrannyAttack();
    return;
  }

  presenceText.textContent = granny.state === "chase" ? "Perto" : granny.state === "investigate" ? "Ouvindo" : "Distante";
  if (granny.state === "chase") playAudio(audio.chase, false);
  else stopAudio(audio.chase);
}

function moveGrannyToward(target, speed, dt) {
  const direction = target.clone().sub(granny.pos).setY(0);
  const distance = direction.length();
  let moved = false;
  if (distance > 0.001) {
    direction.normalize();
    const step = direction.multiplyScalar(Math.min(distance, speed * dt));
    const movedX = moveGrannyAxis(step.x, 0, dt);
    const movedZ = moveGrannyAxis(0, step.z, dt);
    moved = movedX || movedZ;
  }

  settleGrannyOnGround(dt);
  granny.object.position.copy(granny.pos);
  if (distance > 0.05) {
    granny.object.rotation.y = Math.atan2(direction.x, direction.z);
  }
  granny.lastMoved = moved;
  applyGrannyAnimation(moved, dt);

  if (!moved && distance > 0.8 && granny.state === "patrol") {
    granny.targetIndex = (granny.targetIndex + 1) % patrolPoints.length;
  }
}

function applyGrannyAnimation(moved, dt) {
  if (!granny.object) return;

  if (granny.attackTimer > 0) {
    const t = 1 - granny.attackTimer / 0.55;
    granny.object.rotation.x = -Math.sin(t * Math.PI) * 0.32;
    granny.object.rotation.z = Math.sin(t * Math.PI * 2) * 0.08;
    granny.object.position.y = granny.pos.y + Math.sin(t * Math.PI) * 0.14;
    return;
  }

  if (moved) {
    granny.walkTime += dt * (granny.state === "chase" ? 9.5 : 6.4);
    const stride = Math.sin(granny.walkTime);
    granny.object.position.y = granny.pos.y + Math.abs(stride) * 0.055;
    granny.object.rotation.z = stride * 0.055;
    granny.object.rotation.x = Math.sin(granny.walkTime * 0.5) * 0.035;
  } else {
    granny.object.position.y = granny.pos.y;
    granny.object.rotation.x *= 0.82;
    granny.object.rotation.z *= 0.82;
  }
}

function triggerGrannyAttack() {
  if (granny.attackTimer > 0) return;
  granny.attackTimer = 0.55;
  stopAudio(audio.chase);
  playAudio(audio.hit);
  showEvent("Ela te acertou.");
}

function moveGrannyAxis(deltaX, deltaZ, dt) {
  if (Math.abs(deltaX) + Math.abs(deltaZ) < 0.0001) return false;

  const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / MAX_COLLISION_STEP));
  let moved = false;
  for (let i = 0; i < steps; i += 1) {
    if (moveGrannyAxisStep(deltaX / steps, deltaZ / steps, dt / steps)) moved = true;
    else break;
  }
  return moved;
}

function moveGrannyAxisStep(deltaX, deltaZ, dt) {
  const next = granny.pos.clone();
  next.x = THREE.MathUtils.clamp(next.x + deltaX, MAP_BOUNDS.minX, MAP_BOUNDS.maxX);
  next.z = THREE.MathUtils.clamp(next.z + deltaZ, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ);

  const grounded = resolveActorGroundedPosition(next, granny.pos.y, dt, true, GRANNY_BODY);
  if (!grounded || blockedByWorld(granny.pos, grounded, GRANNY_BODY)) return false;

  granny.pos.copy(grounded);
  return true;
}

function settleGrannyOnGround(dt) {
  const grounded = resolveActorGroundedPosition(granny.pos.clone(), granny.pos.y, dt, false, GRANNY_BODY);
  if (grounded) granny.pos.y = grounded.y;
}

function makeGrannyTarget(position) {
  return new THREE.Vector3(position.x, getGrannyOriginY(position.y), position.z);
}

function isGrannyOnPlayerLevel() {
  return getHouseLevelFromGrannyY(granny.pos.y) === getHouseLevelFromPlayerY(player.pos.y);
}

function getHouseLevelFromPlayerY(y) {
  if (y >= 10.0) return "top";
  if (y >= 6.4) return "main";
  return "basement";
}

function getHouseLevelFromGrannyY(y) {
  if (y >= 8.25) return "top";
  if (y >= 4.8) return "main";
  return "basement";
}

function getGrannyOriginY(sourceY) {
  if (sourceY >= 10.0) return GRANNY_ORIGIN_Y.top;
  if (sourceY >= 6.4) return GRANNY_ORIGIN_Y.main;
  return GRANNY_ORIGIN_Y.basement;
}

function updateSpiders(dt) {
  spiders.forEach((spider) => {
    spider.damageCooldown = Math.max(0, spider.damageCooldown - dt);
    spider.angle += dt * (0.6 + Math.random() * 0.8);
    spider.object.position.x = spider.center.x + Math.cos(spider.angle) * 0.72;
    spider.object.position.z = spider.center.z + Math.sin(spider.angle * 0.8) * 0.55;
    spider.object.rotation.y += dt * 1.8;

    if (spider.damageCooldown <= 0 && flatDistance(spider.object.position, player.pos) < 1.2 && Math.abs(spider.object.position.y - player.pos.y) < 2.2) {
      spider.damageCooldown = 1.5;
      damagePlayer();
    }
  });
}

function damagePlayer() {
  if (player.caughtCooldown > 0) return;
  player.caughtCooldown = 1.3;
  player.lives = Math.max(0, player.lives - 1);
  document.body.classList.add("is-caught");
  window.setTimeout(() => document.body.classList.remove("is-caught"), 450);
  playAudio(audio.hit);
  showEvent("As aranhas sentiram seu medo.");
  emitNoise(player.pos, 14);
  if (player.lives <= 0) finishGame(false);
}

function emitNoise(position, intensity) {
  if (!running || intensity <= 0) return;
  if (flatDistance(position, granny.pos) < intensity || intensity >= 12) {
    granny.noiseTarget = makeGrannyTarget(position);
  }
}

function updateHud() {
  inventoryText.textContent = player.held ? player.held.label : "Vazio";
  livesText.textContent = String(player.lives);
  objectiveText.textContent = getObjective();
}

function getObjective() {
  if (player.escaped) return "Livre";
  if (!doors.get("prison")?.opened) return "Resgate o menino";
  if (!player.held || player.held.id !== "key6") return "Ache a chave mestra";
  return "Abra a porta principal";
}

function showEvent(message) {
  eventText.textContent = message;
  eventTimer = 2.6;
}

function finishGame(escaped) {
  running = false;
  stopAudio(audio.ambient);
  stopAudio(audio.chase);
  document.exitPointerLock?.();
  endOverlay.classList.add("is-visible");
  endEyebrow.textContent = escaped ? "Livre" : "Capturado";
  endTitle.textContent = escaped ? "Voce escapou" : "Ela te encontrou";
  endCopy.textContent = escaped
    ? "A chave mestra abriu a saida da casa."
    : "A casa ficou quieta de novo.";
}

function flatDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}
