import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildMap } from "./maps.js";
import {
  CLASSES, SECONDARY_WEAPONS, GRENADES, GRENADE_ORDER, GRENADE_CHARGES_PER_LIFE,
  ARENA_HALF, EYE_HEIGHT, GRAVITY, WALK_SPEED, SPRINT_MUL, CROUCH_MUL, MOVE_SEND_MS,
  HEADSHOT_MULTIPLIER
} from "./config.js";

const STEP_TOLERANCE = 0.65;
const JUMP_HEIGHT_BASE = 1.5; // altura de pulo de referencia (multiplicada por jumpHeightMul)

let scene, camera, renderer, controls, clock, raycaster;
let obstacles = [];
let solidMeshesForRaycast = [];
let weaponRig, currentWeaponMesh, muzzleFlash;
let socket = null;
let room = null;
let selfId = null;
let onEndCallback = null;

const keys = {};
const remotePlayers = new Map();
const activeGrenades = [];
const _readEuler = new THREE.Euler(0, 0, 0, "YXZ");

const local = {
  x: 0, y: 0, z: 0, jumpOffset: 0, verticalVelocity: 0, onGround: true,
  health: 100, alive: true, classId: "rifle", secondaryId: "pistol_common",
  slot: "primary",
  ammo: { primary: 0, secondary: 0 },
  reloadUntil: { primary: 0, secondary: 0 },
  lastShotAt: { primary: 0, secondary: 0 },
  grenadeCharges: {},
  grenadeSelected: "explosive",
  abilityActive: false, abilityExpiresAt: 0, abilityCooldownUntil: 0,
  pendingSpecialShot: null,
  blindedUntil: 0,
  mouseDown: false
};

/* ── DOM ────────────────────────────────────────────────────────────── */
const dom = {};
function cacheDom() {
  [
    "gameCanvas", "crosshair", "healthFill", "healthText", "ammoCount", "weaponName",
    "scoreboardList", "killFeed", "deathScreen", "deathBy", "pauseHint", "hudTopLeft",
    "hudBottomRight", "hudTopRight", "abilityFill", "abilityName", "grenadeCount", "grenadeName",
    "matchTimer", "endScreen", "endResults", "gameRoot"
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

/* ── Setup de cena ──────────────────────────────────────────────────── */
function ensureScene() {
  if (scene) return;
  cacheDom();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 220);
  renderer = new THREE.WebGLRenderer({ canvas: dom.gameCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 45, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  controls = new PointerLockControls(camera, document.body);
  camera.rotation.order = "YXZ";

  weaponRig = new THREE.Group();
  camera.add(weaponRig);
  scene.add(camera);

  muzzleFlash = new THREE.PointLight(0xffddaa, 0, 6);
  weaponRig.add(muzzleFlash);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener("keydown", (e) => { keys[e.code] = true; onKeyDown(e); });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", (e) => { if (e.button === 0) local.mouseDown = false; });
  dom.gameCanvas.addEventListener("click", () => { if (local.alive) controls.lock(); });
  controls.addEventListener("lock", () => { dom.pauseHint.hidden = true; });
  controls.addEventListener("unlock", () => { if (local.alive) dom.pauseHint.hidden = false; });

  requestAnimationFrame(render);
}

function clearSceneObjects() {
  [...scene.children].forEach((child) => {
    if (child === camera) return;
    scene.remove(child);
  });
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 45, 15);
  sun.castShadow = true;
  scene.add(sun);
  remotePlayers.forEach((a) => scene.remove(a.root));
  remotePlayers.clear();
  activeGrenades.forEach((g) => scene.remove(g.mesh));
  activeGrenades.length = 0;
}

/* ── Terreno (piso + colisao generalizada) ─────────────────────────── */
function groundHeightAt(x, z, feetY) {
  let best = 0;
  for (const ob of obstacles) {
    if (x > ob.minX && x < ob.maxX && z > ob.minZ && z < ob.maxZ) {
      if (ob.topY <= feetY + STEP_TOLERANCE && ob.topY > best) best = ob.topY;
    }
  }
  return best;
}
function isBlockedAt(x, z, feetY) {
  for (const ob of obstacles) {
    if (!ob.solid) continue;
    if (x > ob.minX && x < ob.maxX && z > ob.minZ && z < ob.maxZ) {
      if (feetY + STEP_TOLERANCE < ob.topY) return true;
    }
  }
  return false;
}

/* ── Armas em 1a pessoa (view model) ───────────────────────────────── */
function buildWeaponMesh(color, kind) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), mat);
  body.position.set(0, 0, -0.1);
  group.add(body);
  const barrelLen = kind === "sniper_rifle" ? 0.8 : kind === "crossbow" || kind === "bow" ? 0.35 : 0.55;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, barrelLen), mat);
  barrel.position.set(0, 0.01, -0.35 - barrelLen / 2 + 0.2);
  group.add(barrel);
  if (kind !== "knife") {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.1), mat);
    mag.position.set(0, -0.15, 0.02);
    group.add(mag);
  }
  group.position.set(0.28, -0.28, -0.55);
  group.rotation.y = Math.PI;
  return group;
}
function setViewWeapon(color, kind) {
  if (currentWeaponMesh) weaponRig.remove(currentWeaponMesh);
  currentWeaponMesh = buildWeaponMesh(color, kind);
  weaponRig.add(currentWeaponMesh);
}
function playMuzzleFlash() {
  muzzleFlash.intensity = 6;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 60);
}
function recoilKick() {
  if (!currentWeaponMesh) return;
  const base = currentWeaponMesh.position.z;
  currentWeaponMesh.position.z = base + 0.09;
  setTimeout(() => { if (currentWeaponMesh) currentWeaponMesh.position.z = base; }, 90);
}

/* ── Avatares ───────────────────────────────────────────────────────── */
function colorFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 55%)`;
}
function buildAvatar(p) {
  const teamColor = p.team === "red" ? "#e05555" : p.team === "blue" ? "#4d8fe0" : colorFromId(p.socketId);
  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a978 });
  const root = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.38), bodyMat);
  torso.position.y = 1.15;
  root.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
  head.position.y = 1.78;
  root.add(head);

  const armGeo = new THREE.BoxGeometry(0.2, 0.65, 0.2);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.42, 1.2, 0);
  leftArm.geometry.translate(0, -0.32, 0);
  root.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo.clone(), bodyMat);
  rightArm.position.set(0.42, 1.2, 0);
  rightArm.geometry.translate(0, -0.32, 0);
  root.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.24, 0.75, 0.24);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36 });
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.16, 0.72, 0);
  leftLeg.geometry.translate(0, -0.37, 0);
  root.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo.clone(), legMat);
  rightLeg.position.set(0.16, 0.72, 0);
  rightLeg.geometry.translate(0, -0.37, 0);
  root.add(rightLeg);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), new THREE.MeshStandardMaterial({ color: 0x24262c }));
  rightArm.add(gun);
  gun.position.set(0.05, -0.1, -0.35);

  const tagCanvas = document.createElement("canvas");
  tagCanvas.width = 256; tagCanvas.height = 64;
  const ctx = tagCanvas.getContext("2d");
  ctx.fillStyle = "rgba(10,12,18,0.55)"; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fff"; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(p.username || "Jogador", 128, 42);
  const tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tagCanvas), depthTest: false }));
  tagSprite.scale.set(1.4, 0.35, 1);
  tagSprite.position.y = 2.25;
  root.add(tagSprite);

  scene.add(root);
  return {
    root, leftArm, rightArm, leftLeg, rightLeg, gun,
    hittable: [torso, head, leftArm, rightArm, leftLeg, rightLeg],
    headMesh: head,
    walkPhase: Math.random() * 10,
    username: p.username, kills: p.kills || 0, deaths: p.deaths || 0, team: p.team
  };
}
function spawnOrUpdateRemote(p) {
  let avatar = remotePlayers.get(p.socketId);
  if (!avatar) {
    avatar = buildAvatar(p);
    remotePlayers.set(p.socketId, avatar);
  }
  avatar.root.position.set(p.x, p.y, p.z);
  avatar.root.rotation.y = p.yaw;
  avatar.root.visible = p.alive;
  avatar.kills = p.kills || 0;
  avatar.deaths = p.deaths || 0;
}
function removeAvatar(socketId) {
  const avatar = remotePlayers.get(socketId);
  if (!avatar) return;
  scene.remove(avatar.root);
  remotePlayers.delete(socketId);
}

/* ── HUD ────────────────────────────────────────────────────────────── */
function currentWeapon(slot = local.slot) {
  return slot === "secondary" ? SECONDARY_WEAPONS[local.secondaryId] : CLASSES[local.classId].primary;
}
function updateHealthHud() {
  dom.healthFill.style.width = `${Math.max(0, local.health)}%`;
  dom.healthText.textContent = Math.max(0, Math.round(local.health));
}
function updateAmmoHud() {
  const w = currentWeapon();
  dom.ammoCount.textContent = w.kind === "melee" ? "-" : local.ammo[local.slot];
  dom.weaponName.textContent = w.name;
}
function updateGrenadeHud() {
  const g = GRENADES[local.grenadeSelected];
  dom.grenadeCount.textContent = local.grenadeCharges[local.grenadeSelected] ?? 0;
  dom.grenadeName.textContent = g.name;
}
function updateAbilityHud() {
  const ability = CLASSES[local.classId].ability;
  const now = performance.now();
  const remain = Math.max(0, local.abilityCooldownUntil - now);
  const pct = ability.cooldownMs ? 100 - Math.min(100, (remain / ability.cooldownMs) * 100) : 100;
  dom.abilityFill.style.width = `${pct}%`;
  dom.abilityName.textContent = ability.name;
}
function updateScoreboard() {
  const rows = [{ id: selfId, name: "Voce", kills: local.kills || 0, score: local.score || 0, self: true, team: local.team }];
  remotePlayers.forEach((a, id) => rows.push({ id, name: a.username, kills: a.kills, score: a.score || a.kills, self: false, team: a.team }));
  rows.sort((a, b) => b.score - a.score);
  dom.scoreboardList.innerHTML = rows.slice(0, 10).map((r) =>
    `<div class="scoreboard-row${r.self ? " self" : ""}" style="${r.team ? `border-left:3px solid ${r.team === "red" ? "#e05555" : "#4d8fe0"}` : ""}"><span>${r.self ? "Voce" : r.name}</span><span>${r.score}</span></div>`
  ).join("");
}
function pushKillFeed(text) {
  const row = document.createElement("div");
  row.className = "killfeed-row";
  row.textContent = text;
  dom.killFeed.appendChild(row);
  setTimeout(() => row.remove(), 4200);
}

/* ── Tiro ───────────────────────────────────────────────────────────── */
function gatherHittable() {
  const hittable = [];
  remotePlayers.forEach((avatar, socketId) => {
    if (!avatar.root.visible) return;
    avatar.hittable.forEach((mesh) => { mesh.userData.socketId = socketId; mesh.userData.isHead = mesh === avatar.headMesh; hittable.push(mesh); });
  });
  return hittable;
}

function fireHitscan(weapon, slot) {
  scene.updateMatrixWorld(true);
  const hittable = gatherHittable();
  const pelletHits = new Map();
  let headshotFor = null;
  const pelletCount = weapon.pellets || 1;
  for (let i = 0; i < pelletCount; i++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.x += (Math.random() - 0.5) * weapon.spread;
    dir.y += (Math.random() - 0.5) * weapon.spread;
    dir.normalize();
    raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
    raycaster.far = weapon.range;
    const hits = raycaster.intersectObjects([...hittable, ...solidMeshesForRaycast], false);
    if (!hits.length) continue;
    const hit = hits[0];
    const socketId = hit.object.userData.socketId;
    if (socketId) {
      pelletHits.set(socketId, (pelletHits.get(socketId) || 0) + 1);
      if (hit.object.userData.isHead) headshotFor = socketId;
    }
  }
  let targetSocketId = null, bestHits = 0;
  pelletHits.forEach((count, id) => { if (count > bestHits) { bestHits = count; targetSocketId = id; } });
  socket.emit("match:shoot", {
    slot, targetSocketId, pelletHits: bestHits || 1,
    hitZone: targetSocketId && headshotFor === targetSocketId ? "head" : "body"
  });
}

function fireProjectile(weapon, slot) {
  // Visual: flecha/virote viaja ate o ponto de impacto. O acerto e resolvido de imediato
  // no servidor (mesma logica de hitscan), a viagem e apenas cosmetica.
  scene.updateMatrixWorld(true);
  const hittable = gatherHittable();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  dir.x += (Math.random() - 0.5) * weapon.spread;
  dir.y += (Math.random() - 0.5) * weapon.spread;
  dir.normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = weapon.range;
  const hits = raycaster.intersectObjects([...hittable, ...solidMeshesForRaycast], false);
  const endPoint = hits.length ? hits[0].point : origin.clone().add(dir.multiplyScalar(weapon.range));
  const socketId = hits.length ? hits[0].object.userData.socketId : null;
  const isHead = hits.length ? hits[0].object.userData.isHead : false;

  const projMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: 0x6b4c30 }));
  projMesh.position.copy(origin);
  projMesh.lookAt(endPoint);
  scene.add(projMesh);
  const travelMs = Math.min(300, origin.distanceTo(endPoint) * 4);
  const start = performance.now();
  (function step() {
    const t = Math.min(1, (performance.now() - start) / travelMs);
    projMesh.position.lerpVectors(origin, endPoint, t);
    if (t < 1) requestAnimationFrame(step);
    else scene.remove(projMesh);
  })();

  socket.emit("match:shoot", {
    slot, targetSocketId: socketId, pelletHits: 1,
    hitZone: socketId && isHead ? "head" : "body"
  });
}

function shoot() {
  if (!local.alive || !room) return;
  const slot = local.slot;
  const weapon = currentWeapon(slot);
  const now = performance.now();
  if (now < local.reloadUntil[slot]) return;
  if (weapon.kind !== "melee" && now - local.lastShotAt[slot] < weapon.fireRateMs) return;
  if (weapon.kind !== "melee" && local.ammo[slot] <= 0) { reload(); return; }

  local.lastShotAt[slot] = now;
  playMuzzleFlash();
  recoilKick();

  if (weapon.kind === "projectile") fireProjectile(weapon, slot);
  else fireHitscan(weapon, slot);

  if (weapon.kind !== "melee") {
    local.ammo[slot] = Math.max(0, local.ammo[slot] - 1);
    updateAmmoHud();
  }
}

function reload() {
  if (!local.alive) return;
  const weapon = currentWeapon(local.slot);
  if (weapon.kind === "melee") return;
  local.reloadUntil[local.slot] = performance.now() + weapon.reloadMs;
  socket.emit("match:reload", { slot: local.slot });
  setTimeout(() => { local.ammo[local.slot] = weapon.magSize; updateAmmoHud(); }, weapon.reloadMs);
}

function switchSlot(slot) {
  if (slot === "secondary" && !room.settings.secondaryEnabled) return;
  local.slot = slot;
  const weapon = currentWeapon(slot);
  setViewWeapon(slot === "primary" ? "#4c5a3a" : "#555a63", weapon.id);
  updateAmmoHud();
}

/* ── Granadas ───────────────────────────────────────────────────────── */
function throwGrenade() {
  if (!room.settings.grenadesEnabled || !local.alive) return;
  const id = local.grenadeSelected;
  if ((local.grenadeCharges[id] || 0) <= 0) return;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const grenade = GRENADES[id];

  socket.emit("match:grenadeThrow", {
    grenadeId: id, x: origin.x, y: origin.y, z: origin.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z
  });

  simulateGrenadeArc(id, origin, dir, true);
}

function simulateGrenadeArc(id, origin, dir, isLocal, fromSocketId) {
  const grenade = GRENADES[id];
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshStandardMaterial({ color: grenade.color }));
  mesh.position.copy(origin);
  scene.add(mesh);
  const velocity = dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 6, 0));
  const state = { mesh, velocity, id, isLocal, fromSocketId };
  activeGrenades.push(state);

  const fuseMs = grenade.fuseMs || 900;
  if (isLocal) {
    setTimeout(() => detonateGrenade(state), grenade.detonateOnImpact ? 0 : fuseMs);
  }
}

function detonateGrenade(state) {
  const idx = activeGrenades.indexOf(state);
  if (idx === -1) return;
  activeGrenades.splice(idx, 1);
  const pos = state.mesh.position.clone();
  scene.remove(state.mesh);
  if (state.isLocal) {
    socket.emit("match:grenadeDetonate", { grenadeId: state.id, x: pos.x, z: pos.z });
  }
}

function renderGrenadeExplosionVisual(grenadeId, x, z) {
  const grenade = GRENADES[grenadeId];
  const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(grenade.radius * (grenadeId === "explosive" || grenadeId === "impact" ? 0.6 : 1), 12, 12), new THREE.MeshBasicMaterial({ color: grenade.color, transparent: true, opacity: 0.65 }));
  flashMesh.position.set(x, 1, z);
  scene.add(flashMesh);
  const duration = grenadeId === "smoke" ? (grenade.durationMs || 6000) : 500;
  const start = performance.now();
  (function fade() {
    const t = (performance.now() - start) / duration;
    flashMesh.material.opacity = Math.max(0, 0.65 * (1 - t));
    flashMesh.scale.setScalar(1 + t * (grenadeId === "smoke" ? 1.5 : 0.6));
    if (t < 1) requestAnimationFrame(fade);
    else scene.remove(flashMesh);
  })();
}

/* ── Habilidade ─────────────────────────────────────────────────────── */
function useAbility() {
  const now = performance.now();
  if (now < local.abilityCooldownUntil) return;
  socket.emit("match:ability");
}
function applyAbilityVisual(classId, durationMs) {
  if (classId === "sniper") {
    const original = camera.fov;
    camera.fov = 45;
    camera.updateProjectionMatrix();
    setTimeout(() => { camera.fov = original; camera.updateProjectionMatrix(); }, durationMs);
  }
}

/* ── Input ──────────────────────────────────────────────────────────── */
function onMouseDown(e) {
  if (!controls.isLocked) return;
  if (e.button === 0) { local.mouseDown = true; shoot(); }
  if (e.button === 2) e.preventDefault();
}
document.addEventListener("contextmenu", (e) => { if (controls?.isLocked) e.preventDefault(); });

function onKeyDown(e) {
  if (!room || !local.alive) return;
  if (e.code === "KeyR") reload();
  if (e.code === "Digit1") switchSlot("primary");
  if (e.code === "Digit2") switchSlot("secondary");
  if (e.code === "KeyG") throwGrenade();
  if (e.code === "KeyQ") useAbility();
  if (e.code === "KeyV") {
    const idx = GRENADE_ORDER.indexOf(local.grenadeSelected);
    local.grenadeSelected = GRENADE_ORDER[(idx + 1) % GRENADE_ORDER.length];
    updateGrenadeHud();
  }
}

/* ── Movimento ──────────────────────────────────────────────────────── */
let lastMoveSent = 0;
function updateMovement(delta) {
  if (!controls.isLocked || !local.alive) return;
  const weapon = currentWeapon(local.slot);
  const sprinting = Boolean(keys.ShiftLeft || keys.ShiftRight);
  const crouching = Boolean(keys.ControlLeft || keys.ControlRight);
  const speed = WALK_SPEED * (weapon.speedMul || 1) * room.settings.moveSpeedMul *
    (sprinting ? SPRINT_MUL : 1) * (crouching ? CROUCH_MUL : 1) *
    (local.abilityActive && CLASSES[local.classId].ability.id === "sprint_tatico" ? 1.8 : 1) *
    (local.abilityActive && CLASSES[local.classId].ability.id === "supressao" ? 0.5 : 1);

  const forward = Number(Boolean(keys.KeyW)) - Number(Boolean(keys.KeyS));
  const strafe = Number(Boolean(keys.KeyD)) - Number(Boolean(keys.KeyA));
  const moveVec = new THREE.Vector3(strafe, 0, -forward);
  const moving = moveVec.lengthSq() > 0;
  if (moving) moveVec.normalize().multiplyScalar(speed * delta);

  const prevX = camera.position.x, prevZ = camera.position.z;
  controls.moveRight(moveVec.x);
  controls.moveForward(-moveVec.z);
  camera.position.x = Math.max(-ARENA_HALF + 1, Math.min(ARENA_HALF - 1, camera.position.x));
  camera.position.z = Math.max(-ARENA_HALF + 1, Math.min(ARENA_HALF - 1, camera.position.z));

  const feetY = local.jumpOffset;
  if (isBlockedAt(camera.position.x, camera.position.z, feetY)) {
    camera.position.x = prevX;
    camera.position.z = prevZ;
  }

  const groundY = groundHeightAt(camera.position.x, camera.position.z, feetY);
  const jumpHeight = JUMP_HEIGHT_BASE * room.settings.jumpHeightMul;
  if (keys.Space && local.onGround) {
    local.verticalVelocity = Math.sqrt(2 * Math.abs(GRAVITY) * jumpHeight);
    local.onGround = false;
  }
  local.verticalVelocity += GRAVITY * delta;
  local.jumpOffset += local.verticalVelocity * delta;
  if (local.jumpOffset <= groundY) {
    local.jumpOffset = groundY;
    local.verticalVelocity = 0;
    local.onGround = true;
  }
  camera.position.y = EYE_HEIGHT + local.jumpOffset - (crouching ? 0.35 : 0);

  if (local.mouseDown && weapon.auto) shoot();

  const now = performance.now();
  if (now - lastMoveSent > MOVE_SEND_MS) {
    lastMoveSent = now;
    _readEuler.setFromQuaternion(camera.quaternion);
    socket.emit("match:move", {
      x: camera.position.x, y: Math.max(0, local.jumpOffset), z: camera.position.z,
      yaw: _readEuler.y, pitch: _readEuler.x,
      moving, sprinting, jumping: !local.onGround, crouching
    });
  }
}

function updateGrenadesPhysics(delta) {
  activeGrenades.forEach((g) => {
    g.velocity.y += GRAVITY * delta;
    g.mesh.position.addScaledVector(g.velocity, delta);
    if (g.mesh.position.y <= 0.14) {
      g.mesh.position.y = 0.14;
      if (g.isLocal && GRENADES[g.id].detonateOnImpact) detonateGrenade(g);
    }
  });
}

function animateAvatars(delta) {
  remotePlayers.forEach((avatar) => {
    avatar.walkPhase += delta * 6;
    const swing = Math.sin(avatar.walkPhase) * 0.35;
    avatar.leftLeg.rotation.x = swing;
    avatar.rightLeg.rotation.x = -swing;
    avatar.leftArm.rotation.x = -swing * 0.7;
    avatar.rightArm.rotation.x = swing * 0.7;
  });
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (room && room.status === "playing") {
    updateMovement(delta);
    updateGrenadesPhysics(delta);
    animateAvatars(delta);
    updateAbilityHud();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

/* ── API publica ────────────────────────────────────────────────────── */
export function attachSocket(activeSocket) {
  socket = activeSocket;

  socket.on("match:start", (roomState) => {
    ensureScene();
    clearSceneObjects();
    room = roomState;
    selfId = socket.id;
    obstacles = buildMap(room.settings.mapId, scene);
    solidMeshesForRaycast = [];
    scene.traverse((obj) => { if (obj.isMesh && obj.userData.socketId === undefined) solidMeshesForRaycast.push(obj); });

    const me = room.players.find((p) => p.socketId === selfId);
    local.classId = me?.classId || "rifle";
    local.secondaryId = me?.secondaryId || "pistol_common";
    local.team = me?.team || null;
    local.slot = "primary";
    local.health = 100;
    local.alive = true;
    local.kills = 0;
    local.score = 0;
    local.jumpOffset = me?.y || 0;
    local.grenadeCharges = Object.fromEntries(GRENADE_ORDER.map((id) => [id, GRENADE_CHARGES_PER_LIFE]));
    local.ammo.primary = CLASSES[local.classId].primary.magSize;
    local.ammo.secondary = SECONDARY_WEAPONS[local.secondaryId].magSize;
    local.abilityCooldownUntil = 0;

    camera.position.set(me?.x || 0, EYE_HEIGHT + (me?.y || 0), me?.z || 0);
    camera.quaternion.setFromEuler(new THREE.Euler(0, me?.yaw || 0, 0, "YXZ"));

    setViewWeapon("#4c5a3a", CLASSES[local.classId].primary.id);
    room.players.forEach((p) => { if (p.socketId !== selfId) spawnOrUpdateRemote(p); });

    document.getElementById("lobbyRoot").style.display = "none";
    dom.gameRoot.style.display = "block";
    dom.crosshair.style.display = "block";
    dom.hudTopLeft.style.display = "block";
    dom.hudBottomRight.style.display = "block";
    dom.hudTopRight.style.display = "block";
    dom.endScreen.hidden = true;
    updateHealthHud(); updateAmmoHud(); updateGrenadeHud(); updateScoreboard();
    controls.lock();
  });

  socket.on("room:player-left", ({ socketId }) => { removeAvatar(socketId); updateScoreboard(); });

  socket.on("match:player-move", (p) => {
    const avatar = remotePlayers.get(p.socketId);
    if (!avatar) return;
    avatar.root.position.set(p.x, p.y, p.z);
    avatar.root.rotation.y = p.yaw;
    avatar.root.visible = local.alive || true;
  });

  socket.on("match:shot-fired", ({ socketId }) => {
    const avatar = remotePlayers.get(socketId);
    if (!avatar) return;
    const flash = new THREE.PointLight(0xffddaa, 5, 4);
    avatar.gun.add(flash);
    setTimeout(() => avatar.gun.remove(flash), 60);
  });

  socket.on("match:damage", ({ targetSocketId, health }) => {
    if (targetSocketId === selfId) { local.health = health; updateHealthHud(); }
  });

  socket.on("match:kill", ({ killerId, killerName, victimId, victimName, headshot }) => {
    pushKillFeed(`${killerName} eliminou ${victimName}${headshot ? " (na cabeca)" : ""}`);
    if (killerId === selfId) { local.kills += 1; local.score += 1; }
    else { const a = remotePlayers.get(killerId); if (a) { a.kills += 1; a.score = (a.score || 0) + 1; } }
    if (victimId === selfId) {
      local.alive = false; local.health = 0;
      updateHealthHud();
      dom.deathBy.textContent = killerName ? `Eliminado por ${killerName}` : "";
      dom.deathScreen.hidden = false;
      controls.unlock();
    } else {
      const a = remotePlayers.get(victimId);
      if (a) a.deaths += 1;
    }
    updateScoreboard();
  });

  socket.on("match:respawn", ({ socketId, x, y, z, yaw, health }) => {
    if (socketId === selfId) {
      local.alive = true; local.health = health;
      local.jumpOffset = y; local.verticalVelocity = 0;
      camera.position.set(x, EYE_HEIGHT + y, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      local.ammo.primary = CLASSES[local.classId].primary.magSize;
      local.ammo.secondary = SECONDARY_WEAPONS[local.secondaryId].magSize;
      local.grenadeCharges = Object.fromEntries(GRENADE_ORDER.map((id) => [id, GRENADE_CHARGES_PER_LIFE]));
      updateHealthHud(); updateAmmoHud(); updateGrenadeHud();
      dom.deathScreen.hidden = true;
    } else {
      const a = remotePlayers.get(socketId);
      if (a) { a.root.visible = true; a.root.position.set(x, y, z); }
    }
  });

  socket.on("match:ability", ({ socketId, abilityId, durationMs }) => {
    if (socketId === selfId) {
      local.abilityActive = true;
      local.abilityExpiresAt = performance.now() + durationMs;
      applyAbilityVisual(local.classId, durationMs);
      if (durationMs > 0) setTimeout(() => { local.abilityActive = false; }, durationMs);
    }
  });
  socket.on("match:ability-state", ({ cooldownUntil }) => {
    local.abilityCooldownUntil = performance.now() + Math.max(0, cooldownUntil - Date.now());
  });

  socket.on("match:grenade-ammo", ({ grenadeId, charges }) => {
    local.grenadeCharges[grenadeId] = charges;
    updateGrenadeHud();
  });

  socket.on("match:grenadeThrow", ({ socketId, grenadeId, x, y, z, dirX, dirY, dirZ }) => {
    if (socketId === selfId) return;
    simulateGrenadeArc(grenadeId, new THREE.Vector3(x, y, z), new THREE.Vector3(dirX, dirY, dirZ), false, socketId);
  });

  socket.on("match:grenadeDetonate", ({ grenadeId, x, z }) => {
    renderGrenadeExplosionVisual(grenadeId, x, z);
  });

  socket.on("match:blinded", ({ durationMs }) => {
    local.blindedUntil = performance.now() + durationMs;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed"; overlay.style.inset = "0"; overlay.style.background = "#fff";
    overlay.style.zIndex = "40"; overlay.style.transition = `opacity ${durationMs}ms`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = "0"; });
    setTimeout(() => overlay.remove(), durationMs);
  });

  socket.on("match:end", ({ reason, results, teamScores }) => {
    room = { ...room, status: "finished" };
    controls.unlock();
    dom.endScreen.hidden = false;
    const header = teamScores ? `<h3>Vermelho ${teamScores.red} x ${teamScores.blue} Azul</h3>` : "";
    dom.endResults.innerHTML = header + results.map((r, i) =>
      `<div class="end-row">${i + 1}. ${r.username} — ${r.score} pts (${r.kills}K/${r.deaths}D)</div>`
    ).join("");
    setTimeout(() => {
      dom.endScreen.hidden = true;
      dom.gameRoot.style.display = "none";
      document.getElementById("lobbyRoot").style.display = "flex";
      if (onEndCallback) onEndCallback();
    }, 5500);
  });
}

export function onMatchEnd(cb) { onEndCallback = cb; }

export function initGamePlayerJoinHandler(socketRef) {
  socketRef.on("room:update", (roomState) => {
    if (room && room.status === "playing" && roomState.status === "playing") {
      room.settings = roomState.settings;
      roomState.players.forEach((p) => {
        if (p.socketId !== selfId && !remotePlayers.has(p.socketId)) spawnOrUpdateRemote(p);
      });
    }
  });
}
