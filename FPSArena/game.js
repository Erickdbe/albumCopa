import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

/* ── Config (deve espelhar fps-shooter-api.js no servidor) ────────────── */
const WEAPONS = {
  pistol: { id: "pistol", name: "Pistola", category: "Secundaria", damage: 24, fireRateMs: 250, magSize: 12, reloadMs: 1100, spread: 0.01, pellets: 1, range: 60, speedMul: 1.05, auto: false, color: 0x555a63 },
  rifle: { id: "rifle", name: "Rifle de Assalto", category: "Automatica", damage: 19, fireRateMs: 110, magSize: 30, reloadMs: 1700, spread: 0.02, pellets: 1, range: 70, speedMul: 1, auto: true, color: 0x4c5a3a },
  smg: { id: "smg", name: "Submetralhadora", category: "Automatica", damage: 13, fireRateMs: 80, magSize: 35, reloadMs: 1500, spread: 0.035, pellets: 1, range: 45, speedMul: 1.12, auto: true, color: 0x22242a },
  shotgun: { id: "shotgun", name: "Escopeta", category: "Curta distancia", damage: 16, fireRateMs: 700, magSize: 6, reloadMs: 2200, spread: 0.09, pellets: 6, range: 22, speedMul: 0.95, auto: false, color: 0x6b4a2b },
  sniper: { id: "sniper", name: "Sniper", category: "Precisao", damage: 95, fireRateMs: 1250, magSize: 5, reloadMs: 2400, spread: 0.002, pellets: 1, range: 120, speedMul: 0.9, auto: false, color: 0x243247 }
};
const WEAPON_ORDER = ["pistol", "rifle", "smg", "shotgun", "sniper"];

const ARENA_HALF = 34;
const EYE_HEIGHT = 1.7;
const GRAVITY = -22;
const JUMP_SPEED = 8.2;
const WALK_SPEED = 6.2;
const SPRINT_MUL = 1.55;
const CROUCH_MUL = 0.5;
const MOVE_SEND_MS = 60;

const OBSTACLES = [
  { x: 0, z: 0, w: 8, d: 8, h: 2.4, color: 0x3a4048 },
  { x: -14, z: -10, w: 4, d: 4, h: 1.6, color: 0x50403a },
  { x: 14, z: 10, w: 4, d: 4, h: 1.6, color: 0x50403a },
  { x: -14, z: 10, w: 4, d: 4, h: 1.6, color: 0x3a4a50 },
  { x: 14, z: -10, w: 4, d: 4, h: 1.6, color: 0x3a4a50 },
  { x: 0, z: -22, w: 12, d: 2, h: 1.3, color: 0x44403a },
  { x: 0, z: 22, w: 12, d: 2, h: 1.3, color: 0x44403a },
  { x: -22, z: 0, w: 2, d: 12, h: 1.3, color: 0x44403a },
  { x: 22, z: 0, w: 2, d: 12, h: 1.3, color: 0x44403a }
];

/* ── DOM ────────────────────────────────────────────────────────────── */
const canvas = document.getElementById("gameCanvas");
const lobbyEl = document.getElementById("lobby");
const weaponGridEl = document.getElementById("weaponGrid");
const playBtn = document.getElementById("playBtn");
const lobbyStatusEl = document.getElementById("lobbyStatus");
const crosshairEl = document.getElementById("crosshair");
const healthFillEl = document.getElementById("healthFill");
const healthTextEl = document.getElementById("healthText");
const ammoCountEl = document.getElementById("ammoCount");
const weaponNameEl = document.getElementById("weaponName");
const scoreboardListEl = document.getElementById("scoreboardList");
const killFeedEl = document.getElementById("killFeed");
const deathScreenEl = document.getElementById("deathScreen");
const deathByEl = document.getElementById("deathBy");
const pauseHintEl = document.getElementById("pauseHint");
const hudTopLeft = document.querySelector(".hud-top-left");
const hudBottomRight = document.querySelector(".hud-bottom-right");
const hudTopRight = document.querySelector(".hud-top-right");

let selectedWeapon = "rifle";

function buildWeaponGrid() {
  weaponGridEl.innerHTML = "";
  WEAPON_ORDER.forEach((id) => {
    const w = WEAPONS[id];
    const card = document.createElement("div");
    card.className = "weapon-card" + (id === selectedWeapon ? " selected" : "");
    card.dataset.weapon = id;
    card.innerHTML = `<strong>${w.name}</strong><small>${w.category}</small>`;
    card.addEventListener("click", () => {
      selectedWeapon = id;
      weaponGridEl.querySelectorAll(".weapon-card").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
    });
    weaponGridEl.appendChild(card);
  });
}
buildWeaponGrid();

/* ── Three.js scene ─────────────────────────────────────────────────── */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd1ff);
scene.fog = new THREE.Fog(0x9fd1ff, 40, 90);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 40, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const groundGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x496b3f });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36 });
const wallHeight = 6;
function addWall(x, z, w, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
  mesh.position.set(x, wallHeight / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
const solidMeshes = [
  addWall(0, -ARENA_HALF, ARENA_HALF * 2, 1),
  addWall(0, ARENA_HALF, ARENA_HALF * 2, 1),
  addWall(-ARENA_HALF, 0, 1, ARENA_HALF * 2),
  addWall(ARENA_HALF, 0, 1, ARENA_HALF * 2)
];

const obstacleBoxes = [];
OBSTACLES.forEach((o) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(o.w, o.h, o.d),
    new THREE.MeshStandardMaterial({ color: o.color })
  );
  mesh.position.set(o.x, o.h / 2, o.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  solidMeshes.push(mesh);
  obstacleBoxes.push({
    minX: o.x - o.w / 2, maxX: o.x + o.w / 2,
    minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2
  });
});

/* ── Controles em 1a pessoa ─────────────────────────────────────────── */
const controls = new PointerLockControls(camera, document.body);
camera.rotation.order = "YXZ";
camera.position.set(0, EYE_HEIGHT, 0);
const _readEuler = new THREE.Euler(0, 0, 0, "YXZ");

const keys = {};
window.addEventListener("keydown", (e) => { keys[e.code] = true; });
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

const velocity = new THREE.Vector3();
let jumpOffset = 0;
let verticalVelocity = 0;
let onGround = true;
let sprinting = false;
let crouching = false;

canvas.addEventListener("click", () => {
  if (state.joined && state.alive) controls.lock();
});
controls.addEventListener("lock", () => { pauseHintEl.hidden = true; });
controls.addEventListener("unlock", () => {
  if (state.joined && state.alive) pauseHintEl.hidden = false;
});

/* ── Arma em primeira pessoa (view model) ──────────────────────────── */
const weaponRig = new THREE.Group();
camera.add(weaponRig);
scene.add(camera);

function buildWeaponMesh(weaponId) {
  const w = WEAPONS[weaponId];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: w.color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), bodyMat);
  body.position.set(0, 0, -0.1);
  group.add(body);
  const barrelLen = weaponId === "sniper" ? 0.75 : weaponId === "shotgun" ? 0.45 : 0.55;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, barrelLen), bodyMat);
  barrel.position.set(0, 0.01, -0.35 - barrelLen / 2 + 0.2);
  group.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), bodyMat);
  mag.position.set(0, -0.15, 0.02);
  group.add(mag);
  if (weaponId === "sniper") {
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: 0x111318 }));
    scope.position.set(0, 0.1, -0.1);
    group.add(scope);
  }
  group.position.set(0.28, -0.28, -0.55);
  group.rotation.y = Math.PI;
  return group;
}

let currentWeaponMesh = null;
function setViewWeapon(weaponId) {
  if (currentWeaponMesh) weaponRig.remove(currentWeaponMesh);
  currentWeaponMesh = buildWeaponMesh(weaponId);
  weaponRig.add(currentWeaponMesh);
}
setViewWeapon("rifle");

const muzzleFlash = new THREE.PointLight(0xffddaa, 0, 6);
weaponRig.add(muzzleFlash);

function playMuzzleFlash() {
  muzzleFlash.intensity = 6;
  muzzleFlash.position.copy(currentWeaponMesh.position).add(new THREE.Vector3(0, 0, -0.6));
  setTimeout(() => { muzzleFlash.intensity = 0; }, 60);
}

function recoilKick() {
  if (!currentWeaponMesh) return;
  const base = currentWeaponMesh.position.z;
  currentWeaponMesh.position.z = base + 0.09;
  setTimeout(() => { if (currentWeaponMesh) currentWeaponMesh.position.z = base; }, 90);
}

/* ── Avatares dos outros jogadores (estilo blocky) ─────────────────── */
function colorFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
}

function buildAvatar(socketId, username) {
  const color = colorFromId(socketId);
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a978 });
  const bodyMat = new THREE.MeshStandardMaterial({ color });

  const root = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.38), bodyMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
  head.position.y = 1.78;
  head.castShadow = true;
  root.add(head);

  const armGeo = new THREE.BoxGeometry(0.2, 0.65, 0.2);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.42, 1.2, 0);
  leftArm.geometry.translate(0, -0.32, 0);
  leftArm.castShadow = true;
  root.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo.clone(), bodyMat);
  rightArm.position.set(0.42, 1.2, 0);
  rightArm.geometry.translate(0, -0.32, 0);
  rightArm.castShadow = true;
  root.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.24, 0.75, 0.24);
  const leftLeg = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x2c2f36 }));
  leftLeg.position.set(-0.16, 0.72, 0);
  leftLeg.geometry.translate(0, -0.37, 0);
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo.clone(), leftLeg.material);
  rightLeg.position.set(0.16, 0.72, 0);
  rightLeg.geometry.translate(0, -0.37, 0);
  rightLeg.castShadow = true;
  root.add(rightLeg);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), new THREE.MeshStandardMaterial({ color: 0x24262c }));
  gun.position.set(0.42, 1.15, -0.3);
  rightArm.add(gun);
  gun.position.set(0.05, -0.1, -0.35);

  const canvasTag = document.createElement("canvas");
  canvasTag.width = 256; canvasTag.height = 64;
  const ctx = canvasTag.getContext("2d");
  ctx.fillStyle = "rgba(10,12,18,0.55)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(username || "Jogador", 128, 42);
  const tagTexture = new THREE.CanvasTexture(canvasTag);
  const tagMat = new THREE.SpriteMaterial({ map: tagTexture, depthTest: false });
  const tagSprite = new THREE.Sprite(tagMat);
  tagSprite.scale.set(1.4, 0.35, 1);
  tagSprite.position.y = 2.25;
  root.add(tagSprite);

  scene.add(root);

  return {
    root, torso, head, leftArm, rightArm, leftLeg, rightLeg, gun,
    hittable: [torso, head, leftArm, rightArm, leftLeg, rightLeg],
    walkPhase: Math.random() * 10,
    username: username || "Jogador",
    kills: 0,
    deaths: 0
  };
}

const remotePlayers = new Map();

function removeAvatar(socketId) {
  const avatar = remotePlayers.get(socketId);
  if (!avatar) return;
  scene.remove(avatar.root);
  remotePlayers.delete(socketId);
}

/* ── Estado local ───────────────────────────────────────────────────── */
const state = {
  socket: null,
  joined: false,
  selfId: null,
  alive: true,
  health: 100,
  ammo: WEAPONS.rifle.magSize,
  weaponId: "rifle",
  kills: 0,
  deaths: 0,
  players: new Map(),
  lastShotAt: 0,
  reloadUntil: 0,
  mouseDown: false
};

function connectSocket() {
  const token = localStorage.getItem("mp_token");
  if (!token) {
    lobbyStatusEl.textContent = "Faca login no album para jogar online.";
    playBtn.disabled = true;
    return;
  }
  const socket = window.io(window.location.origin, { auth: { token } });
  state.socket = socket;

  socket.on("connect", () => {
    lobbyStatusEl.textContent = "Conectado. Escolha uma arma e entre na partida.";
    playBtn.disabled = false;
  });

  socket.on("connect_error", () => {
    lobbyStatusEl.textContent = "Nao foi possivel conectar. Faca login no album.";
    playBtn.disabled = true;
  });

  socket.on("disconnect", () => {
    lobbyStatusEl.textContent = "Desconectado.";
  });

  socket.on("fps:error", (message) => {
    lobbyStatusEl.textContent = message || "Erro na arena.";
    playBtn.disabled = false;
  });

  socket.on("fps:joined", (room) => {
    state.joined = true;
    state.selfId = room.selfId;
    state.alive = true;
    state.health = 100;
    state.weaponId = selectedWeapon;
    state.ammo = WEAPONS[selectedWeapon].magSize;
    setViewWeapon(selectedWeapon);

    room.players.forEach((p) => {
      if (p.socketId === state.selfId) return;
      spawnOrUpdateRemote(p);
    });

    enterGame();
  });

  socket.on("fps:player-joined", (p) => {
    if (p.socketId === state.selfId) return;
    spawnOrUpdateRemote(p);
    updateScoreboard();
  });

  socket.on("fps:player-left", ({ socketId }) => {
    removeAvatar(socketId);
    pushKillFeed(`${socketId === state.selfId ? "Voce" : "Jogador"} saiu da arena.`);
    updateScoreboard();
  });

  socket.on("fps:player-move", (p) => {
    const avatar = remotePlayers.get(p.socketId);
    if (!avatar) return;
    avatar.root.position.set(p.x, p.y, p.z);
    avatar.root.rotation.y = p.yaw;
    avatar.moving = p.moving;
    avatar.crouching = p.crouching;
    avatar.jumping = p.jumping;
  });

  socket.on("fps:player-weapon", ({ socketId, weaponId }) => {
    const avatar = remotePlayers.get(socketId);
    if (avatar) avatar.gun.material.color.set(WEAPONS[weaponId]?.color || 0x24262c);
  });

  socket.on("fps:shot-fired", ({ socketId, weaponId }) => {
    const avatar = remotePlayers.get(socketId);
    if (!avatar) return;
    const flash = new THREE.PointLight(0xffddaa, 5, 4);
    avatar.gun.add(flash);
    setTimeout(() => avatar.gun.remove(flash), 60);
  });

  socket.on("fps:damage", ({ targetSocketId, health }) => {
    if (targetSocketId === state.selfId) {
      state.health = health;
      updateHealthHud();
    }
  });

  socket.on("fps:ammo", ({ ammo }) => {
    state.ammo = ammo;
    updateAmmoHud();
  });

  socket.on("fps:kill", ({ killerId, killerName, victimId, victimName, weaponId }) => {
    const weaponName = WEAPONS[weaponId]?.name || "arma";
    pushKillFeed(`${killerName} eliminou ${victimName} (${weaponName})`);
    if (killerId === state.selfId) {
      state.kills += 1;
    } else {
      const killerAvatar = remotePlayers.get(killerId);
      if (killerAvatar) killerAvatar.kills += 1;
    }
    if (victimId === state.selfId) {
      state.deaths += 1;
      state.alive = false;
      state.health = 0;
      updateHealthHud();
      showDeathScreen(killerName);
      controls.unlock();
    } else {
      const victimAvatar = remotePlayers.get(victimId);
      if (victimAvatar) victimAvatar.deaths += 1;
    }
    updateScoreboard();
  });

  socket.on("fps:respawn", ({ socketId, x, y, z, yaw, health }) => {
    if (socketId === state.selfId) {
      state.alive = true;
      state.health = health;
      updateHealthHud();
      hideDeathScreen();
      camera.position.set(x, EYE_HEIGHT + y, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      jumpOffset = 0;
      verticalVelocity = 0;
      velocity.set(0, 0, 0);
    } else {
      const avatar = remotePlayers.get(socketId);
      if (avatar) {
        avatar.root.visible = true;
        avatar.root.rotation.x = 0;
        avatar.root.position.set(x, y, z);
      }
    }
  });
}

function spawnOrUpdateRemote(p) {
  let avatar = remotePlayers.get(p.socketId);
  if (!avatar) {
    avatar = buildAvatar(p.socketId, p.username);
    remotePlayers.set(p.socketId, avatar);
  }
  avatar.root.position.set(p.x, p.y, p.z);
  avatar.root.rotation.y = p.yaw;
  avatar.root.visible = p.alive;
  avatar.kills = p.kills || 0;
  avatar.deaths = p.deaths || 0;
  avatar.gun.material.color.set(WEAPONS[p.weaponId]?.color || 0x24262c);
}

/* ── HUD ────────────────────────────────────────────────────────────── */
function updateHealthHud() {
  healthFillEl.style.width = `${Math.max(0, state.health)}%`;
  healthTextEl.textContent = Math.max(0, Math.round(state.health));
}
function updateAmmoHud() {
  ammoCountEl.textContent = state.ammo;
  weaponNameEl.textContent = WEAPONS[state.weaponId].name;
}
function updateScoreboard() {
  const rows = [{ id: state.selfId, name: "Voce", kills: state.kills, deaths: state.deaths, self: true }];
  remotePlayers.forEach((avatar, id) => {
    rows.push({ id, name: avatar.username, kills: avatar.kills || 0, deaths: avatar.deaths || 0, self: false });
  });
  rows.sort((a, b) => b.kills - a.kills);
  scoreboardListEl.innerHTML = rows.slice(0, 8).map((r) =>
    `<div class="scoreboard-row${r.self ? " self" : ""}"><span>${r.self ? "Voce" : r.name}</span><span>${r.kills}/${r.deaths}</span></div>`
  ).join("");
}
function pushKillFeed(text) {
  const row = document.createElement("div");
  row.className = "killfeed-row";
  row.textContent = text;
  killFeedEl.appendChild(row);
  setTimeout(() => row.remove(), 4000);
}
function showDeathScreen(killerName) {
  deathByEl.textContent = killerName ? `Eliminado por ${killerName}` : "";
  deathScreenEl.hidden = false;
}
function hideDeathScreen() {
  deathScreenEl.hidden = true;
}

/* ── Entrar na partida ──────────────────────────────────────────────── */
function enterGame() {
  lobbyEl.style.display = "none";
  crosshairEl.style.display = "block";
  hudTopLeft.style.display = "block";
  hudBottomRight.style.display = "block";
  hudTopRight.style.display = "block";
  updateHealthHud();
  updateAmmoHud();
  updateScoreboard();
  controls.lock();
}

playBtn.addEventListener("click", () => {
  if (!state.socket || !state.socket.connected) return;
  state.socket.emit("fps:quickplay", { weaponId: selectedWeapon });
  lobbyStatusEl.textContent = "Entrando na arena...";
});

/* ── Tiro ───────────────────────────────────────────────────────────── */
const raycaster = new THREE.Raycaster();

function shoot() {
  if (!state.alive || !state.joined) return;
  const weapon = WEAPONS[state.weaponId];
  const now = performance.now();
  if (now < state.reloadUntil) return;
  if (now - state.lastShotAt < weapon.fireRateMs) return;
  if (state.ammo <= 0) { reload(); return; }

  state.lastShotAt = now;
  playMuzzleFlash();
  recoilKick();

  scene.updateMatrixWorld(true);
  const hittable = [];
  remotePlayers.forEach((avatar, socketId) => {
    if (!avatar.root.visible) return;
    avatar.hittable.forEach((mesh) => { mesh.userData.socketId = socketId; hittable.push(mesh); });
  });

  const pelletHits = new Map();
  let closestDistance = null;
  const pelletCount = weapon.pellets;
  for (let i = 0; i < pelletCount; i++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.x += (Math.random() - 0.5) * weapon.spread;
    dir.y += (Math.random() - 0.5) * weapon.spread;
    dir.z += (Math.random() - 0.5) * weapon.spread * 0.3;
    dir.normalize();
    raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
    raycaster.far = weapon.range;
    const targets = raycaster.intersectObjects([...hittable, ...solidMeshes], false);
    if (!targets.length) continue;
    const hit = targets[0];
    const socketId = hit.object.userData.socketId;
    if (socketId) {
      pelletHits.set(socketId, (pelletHits.get(socketId) || 0) + 1);
      if (closestDistance === null || hit.distance < closestDistance) closestDistance = hit.distance;
    }
  }

  let targetSocketId = null;
  let bestHits = 0;
  pelletHits.forEach((count, socketId) => {
    if (count > bestHits) { bestHits = count; targetSocketId = socketId; }
  });

  state.socket.emit("fps:shoot", {
    targetSocketId,
    pelletHits: bestHits || 1,
    distance: closestDistance
  });

  state.ammo = Math.max(0, state.ammo - 1);
  updateAmmoHud();
}

function reload() {
  if (!state.alive) return;
  const weapon = WEAPONS[state.weaponId];
  state.reloadUntil = performance.now() + weapon.reloadMs;
  state.socket.emit("fps:reload");
}

document.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || !controls.isLocked) return;
  state.mouseDown = true;
  shoot();
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) state.mouseDown = false;
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyR") reload();
  const idx = Number(e.key);
  if (idx >= 1 && idx <= WEAPON_ORDER.length) switchWeapon(WEAPON_ORDER[idx - 1]);
});

function switchWeapon(weaponId) {
  if (!state.alive || weaponId === state.weaponId) return;
  state.weaponId = weaponId;
  state.ammo = WEAPONS[weaponId].magSize;
  state.reloadUntil = 0;
  setViewWeapon(weaponId);
  updateAmmoHud();
  state.socket.emit("fps:switch-weapon", { weaponId });
}

/* ── Loop principal ─────────────────────────────────────────────────── */
let lastMoveSent = 0;
const clock = new THREE.Clock();

function updateMovement(delta) {
  if (!controls.isLocked || !state.alive) return;

  const weapon = WEAPONS[state.weaponId];
  sprinting = Boolean(keys.ShiftLeft || keys.ShiftRight) && !crouching;
  crouching = Boolean(keys.ControlLeft || keys.ControlRight);

  const speed = WALK_SPEED * weapon.speedMul * (sprinting ? SPRINT_MUL : 1) * (crouching ? CROUCH_MUL : 1);

  const forward = Number(Boolean(keys.KeyW)) - Number(Boolean(keys.KeyS));
  const strafe = Number(Boolean(keys.KeyD)) - Number(Boolean(keys.KeyA));

  const moveVec = new THREE.Vector3(strafe, 0, -forward);
  const moving = moveVec.lengthSq() > 0;
  if (moving) moveVec.normalize().multiplyScalar(speed * delta);

  const object = camera;
  const prevX = object.position.x;
  const prevZ = object.position.z;

  controls.moveRight(moveVec.x);
  controls.moveForward(-moveVec.z);

  object.position.x = Math.max(-ARENA_HALF + 1, Math.min(ARENA_HALF - 1, object.position.x));
  object.position.z = Math.max(-ARENA_HALF + 1, Math.min(ARENA_HALF - 1, object.position.z));

  for (const box of obstacleBoxes) {
    if (object.position.x > box.minX - 0.6 && object.position.x < box.maxX + 0.6 &&
        object.position.z > box.minZ - 0.6 && object.position.z < box.maxZ + 0.6) {
      object.position.x = prevX;
      object.position.z = prevZ;
      break;
    }
  }

  if (keys.Space && onGround) {
    verticalVelocity = JUMP_SPEED;
    onGround = false;
  }
  verticalVelocity += GRAVITY * delta;
  jumpOffset += verticalVelocity * delta;
  if (jumpOffset <= 0) {
    jumpOffset = 0;
    verticalVelocity = 0;
    onGround = true;
  }
  object.position.y = EYE_HEIGHT + jumpOffset - (crouching ? 0.35 : 0);

  if (state.mouseDown && weapon.auto) shoot();

  const now = performance.now();
  if (now - lastMoveSent > MOVE_SEND_MS) {
    lastMoveSent = now;
    _readEuler.setFromQuaternion(camera.quaternion);
    state.socket.emit("fps:move", {
      x: object.position.x,
      y: Math.max(0, jumpOffset),
      z: object.position.z,
      yaw: _readEuler.y,
      pitch: _readEuler.x,
      moving,
      sprinting,
      jumping: !onGround,
      crouching
    });
  }
}

function animateAvatars(delta) {
  remotePlayers.forEach((avatar) => {
    avatar.walkPhase += delta * (avatar.moving ? 8 : 2);
    const swing = avatar.moving ? Math.sin(avatar.walkPhase) * 0.5 : Math.sin(avatar.walkPhase) * 0.04;
    avatar.leftLeg.rotation.x = swing;
    avatar.rightLeg.rotation.x = -swing;
    avatar.leftArm.rotation.x = -swing * 0.8;
    avatar.rightArm.rotation.x = swing * 0.8;
    const targetScale = avatar.crouching ? 0.75 : 1;
    avatar.root.scale.y += (targetScale - avatar.root.scale.y) * 0.2;
    if (!avatar.root.visible) return;
  });
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  animateAvatars(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

connectSocket();
render();
