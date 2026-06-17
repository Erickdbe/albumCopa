import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const ASSET_ROOT = "./Granny_Game-main/assets";
const PLAYER_START = new THREE.Vector3(55, 8, 18);
const PLAYER_SPEED = 5.2;
const SPRINT_SPEED = 7.2;
const INTERACT_DISTANCE = 3.4;
const GRANNY_CATCH_DISTANCE = 3.0;
const GRANNY_NOTICE_DISTANCE = 8.5;

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
scene.background = new THREE.Color(0x050706);
scene.fog = new THREE.FogExp2(0x050706, 0.035);

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
const tempVec = new THREE.Vector3();

let running = false;
let loadedCount = 0;
let totalToLoad = 0;
let activePrompt = null;
let eventTimer = 0;

const player = {
  pos: PLAYER_START.clone(),
  yaw: -Math.PI / 2,
  pitch: 0,
  held: null,
  lives: 10,
  caughtCooldown: 0,
  rescuedBoy: false,
  escaped: false
};

const granny = {
  object: null,
  pos: new THREE.Vector3(50, 5.7, 23),
  targetIndex: 0,
  noiseTarget: null,
  state: "patrol"
};

const patrolPoints = [
  [3.7, 11.4, 25.7],
  [46.85, 11.4, 20.2],
  [52.0, 11.4, 19.1],
  [57.6, 11.4, 14.8],
  [48.45, 7.8, 20.2],
  [53.0, 7.8, 23.3],
  [0.0, 0.0, 0.0],
  [44.7, 10.1, 25.45],
  [57.0, 10.8, 19.63],
  [57.8, 7.16, 18.2],
  [47.7, 6.65, 21.45],
  [50.8, 4.7, 28.4],
  [54.8, 11.2, 18.7],
  [54.0, 7.3, 23.0],
  [45.7, 11.25, 14.45]
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
    position: [50, 5.7, 23],
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
  scene.add(new THREE.HemisphereLight(0x8ba695, 0x110706, 0.62));

  const moon = new THREE.DirectionalLight(0x9ab2ff, 0.9);
  moon.position.set(44, 34, 16);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  scene.add(moon);

  const handLight = new THREE.SpotLight(0xffe1a6, 3.2, 26, Math.PI / 5.5, 0.45, 1.35);
  handLight.position.set(0, 0, 0);
  handLight.target.position.set(0, 0, -1);
  camera.add(handLight);
  camera.add(handLight.target);
  scene.add(camera);

  [
    [50.3, 11.6, 26.8, 0xe7bd73, 1.8],
    [45.2, 10.9, 18.5, 0xd4f1ff, 1.2],
    [54.7, 7.6, 22.5, 0xe7bd73, 1.4],
    [50.4, 4.9, 28.5, 0xc8d6ff, 1.6]
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
      loaded.push(object);
      registerEntity(def, object);
      onAssetLoaded();
    })
    .catch(() => {
      const fallback = makeFallback(def, material);
      scene.add(fallback);
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
  }
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
    if (document.pointerLockElement !== canvas && running && !player.escaped) {
      startOverlay.classList.add("is-visible");
      startButton.disabled = loadedCount < totalToLoad;
      loadText.textContent = "A partida esta pausada.";
      running = false;
    }
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
    if (["w", "a", "s", "d", "shift", "control", "e", "p", "g", "t"].includes(key)) {
      event.preventDefault();
    }
    if (!running) return;
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
  startOverlay.classList.remove("is-visible");
  endOverlay.classList.remove("is-visible");
  canvas.requestPointerLock?.();
  playAudio(audio.ambient, false);
}

function startDemoMode() {
  if (running || loadedCount < totalToLoad) return;
  running = true;
  startOverlay.classList.remove("is-visible");
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

  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw) * -1).normalize();
  const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
  const move = new THREE.Vector3();

  if (keys.has("w")) move.add(forward);
  if (keys.has("s")) move.sub(forward);
  if (keys.has("d")) move.add(right);
  if (keys.has("a")) move.sub(right);
  if (keys.has(" ")) player.pos.y += dt * 2.8;
  if (keys.has("control")) player.pos.y -= dt * 2.8;

  if (move.lengthSq() > 0) {
    move.normalize();
    const speed = keys.has("shift") ? SPRINT_SPEED : PLAYER_SPEED;
    const next = player.pos.clone().addScaledVector(move, speed * dt);
    next.x = THREE.MathUtils.clamp(next.x, 39.6, 61.0);
    next.z = THREE.MathUtils.clamp(next.z, 12.6, 29.4);
    next.y = THREE.MathUtils.clamp(next.y, 3.5, 12.2);
    if (!blockedByClosedDoor(next)) {
      player.pos.copy(next);
    }
    if (keys.has("shift")) emitNoise(player.pos, 7);
    if (Math.random() < dt * 1.5) playAudio(audio.step, true);
  }
}

function blockedByClosedDoor(nextPos) {
  for (const door of doors.values()) {
    if (door.opened || door.id === "prison") continue;
    const dist = flatDistance(nextPos, door.object.position);
    if (dist < 0.82 && Math.abs(nextPos.y - door.object.position.y) < 2.2) return true;
  }
  return false;
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
  }
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
  if (!player.held) return;
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const dropPos = player.pos.clone().addScaledVector(forward, 1.4);
  player.held.object.position.copy(dropPos);
  player.held.picked = false;
  player.held = null;
  emitNoise(dropPos, 12);
  showEvent("Algo caiu no chao.");
  updateHud();
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

  const playerFlatDistance = flatDistance(granny.pos, player.pos);
  if (playerFlatDistance < GRANNY_NOTICE_DISTANCE && Math.abs(granny.pos.y - player.pos.y) < 3.6) {
    granny.state = "chase";
    granny.noiseTarget = player.pos.clone();
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

  if (flatDistance(granny.pos, player.pos) < GRANNY_CATCH_DISTANCE && Math.abs(granny.pos.y - player.pos.y) < 3.2) {
    finishGame(false);
  }

  presenceText.textContent = granny.state === "chase" ? "Perto" : granny.state === "investigate" ? "Ouvindo" : "Distante";
  if (granny.state === "chase") playAudio(audio.chase, false);
  else stopAudio(audio.chase);
}

function moveGrannyToward(target, speed, dt) {
  const direction = target.clone().sub(granny.pos);
  const distance = direction.length();
  if (distance > 0.001) {
    direction.normalize();
    granny.pos.addScaledVector(direction, Math.min(distance, speed * dt));
  }

  granny.object.position.copy(granny.pos);
  if (distance > 0.05) {
    granny.object.rotation.y = Math.atan2(direction.x, direction.z);
  }
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
    granny.noiseTarget = position.clone();
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
