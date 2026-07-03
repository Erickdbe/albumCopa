import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { buildMap } from "./maps.js";
import { buildWeaponModel, setBowChargeVisual } from "./weapon-models.js";
import { buildVehicleModel, createCannonProjectile, createExplosion } from "./vehicle-models.js";
import {
  CLASSES, CLASS_ORDER, SECONDARY_WEAPONS, SECONDARY_ORDER, GRENADES, GRENADE_ORDER, GRENADE_CHARGES_PER_LIFE,
  ARENA_HALF, MAP_HALF_SIZES, VEHICLE_STATS, EYE_HEIGHT, GRAVITY, WALK_SPEED, SPRINT_MUL, CROUCH_MUL, MOVE_SEND_MS,
  HEADSHOT_MULTIPLIER
} from "./config.js";

const STEP_TOLERANCE = 0.65;
const JUMP_HEIGHT_BASE = 1.5; // altura de pulo de referencia (multiplicada por jumpHeightMul)
const DEFAULT_FOV = 78;

let scene, camera, renderer, controls, clock, raycaster;
let obstacles = [];
let solidMeshesForRaycast = [];
let weaponRig, currentWeaponMesh, muzzleFlash;
let mapWorld = null;
let activeWorldEvent = null;
let socket = null;
let room = null;
let selfId = null;
let onEndCallback = null;

const keys = {};
const remotePlayers = new Map();
const vehicles = new Map();
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
  mouseDown: false,
  aiming: false,
  charging: false,
  chargeStartedAt: 0,
  vehicleId: null,
  externalVelocity: new THREE.Vector3(),
  pendingFallDamage: 0,
  lastVehicleShotAt: 0
};

/* ── DOM ────────────────────────────────────────────────────────────── */
const dom = {};
function cacheDom() {
  [
    "gameCanvas", "crosshair", "healthFill", "healthText", "ammoCount", "weaponName",
    "scoreboardList", "killFeed", "deathScreen", "deathBy", "pauseHint", "hudTopLeft",
    "hudBottomRight", "hudTopRight", "abilityFill", "abilityName", "grenadeCount", "grenadeName",
    "matchTimer", "endScreen", "endResults", "gameRoot", "scopeOverlay", "chargeMeter", "chargeFill",
    "eventAlert", "vehicleStatus", "vehicleHealthFill", "respawnClassSelect", "respawnSecondarySelect",
    "respawnLoadoutStatus"
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
  document.addEventListener("mouseup", onMouseUp);
  dom.gameCanvas.addEventListener("click", () => { if (local.alive) controls.lock(); });
  dom.pauseHint.addEventListener("click", () => { if (local.alive) controls.lock(); });
  controls.addEventListener("lock", () => { dom.pauseHint.hidden = true; });
  controls.addEventListener("unlock", () => {
    setAiming(false);
    cancelCharge();
    if (local.alive) dom.pauseHint.hidden = false;
  });
  setupRespawnLoadoutControls();

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
  vehicles.clear();
  mapWorld = null;
  activeWorldEvent = null;
}

/* ── Terreno (piso + colisao generalizada) ─────────────────────────── */
function groundHeightAt(x, z, feetY) {
  let best = 0;
  for (const ob of obstacles) {
    if (ob.active === false) continue;
    if (x > ob.minX && x < ob.maxX && z > ob.minZ && z < ob.maxZ) {
      if (ob.topY <= feetY + STEP_TOLERANCE && ob.topY > best) best = ob.topY;
    }
  }
  return best;
}
function isBlockedAt(x, z, feetY) {
  for (const ob of obstacles) {
    if (ob.active === false) continue;
    if (!ob.solid) continue;
    if (x > ob.minX && x < ob.maxX && z > ob.minZ && z < ob.maxZ) {
      if (feetY + STEP_TOLERANCE < ob.topY) return true;
    }
  }
  return false;
}

/* ── Armas em 1a pessoa (view model) ───────────────────────────────── */
function setViewWeapon(color, kind) {
  if (currentWeaponMesh) weaponRig.remove(currentWeaponMesh);
  currentWeaponMesh = buildWeaponModel(kind, color);
  weaponRig.add(currentWeaponMesh);
  const muzzle = currentWeaponMesh.userData.muzzlePosition || new THREE.Vector3(0, 0, -0.8);
  muzzleFlash.position.copy(currentWeaponMesh.position).add(muzzle);
  setBowChargeVisual(currentWeaponMesh, 0);
}
function playMuzzleFlash() {
  muzzleFlash.intensity = 6;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 60);
}
function recoilKick() {
  if (!currentWeaponMesh) return;
  const weaponMesh = currentWeaponMesh;
  const base = weaponMesh.position.z;
  weaponMesh.position.z = base + 0.09;
  setTimeout(() => { weaponMesh.position.z = base; }, 90);
}

function setAiming(enabled) {
  local.aiming = Boolean(enabled && local.alive && room?.status === "playing");
}

function currentChargeAmount() {
  const weapon = currentWeapon();
  if (!local.charging || !weapon.chargeable) return 0;
  return THREE.MathUtils.clamp((performance.now() - local.chargeStartedAt) / weapon.chargeMs, 0, 1);
}

function cancelCharge() {
  const wasCharging = local.charging;
  local.charging = false;
  local.chargeStartedAt = 0;
  if (wasCharging && socket) socket.emit("match:charge-cancel");
  if (currentWeaponMesh) setBowChargeVisual(currentWeaponMesh, 0);
  if (dom.chargeMeter) dom.chargeMeter.classList.remove("active");
}

function updateWeaponPresentation(delta) {
  if (!camera || !currentWeaponMesh) return;
  const weapon = currentWeapon();
  const scoped = local.aiming && weapon.id === "sniper_rifle";
  const abilityZoom = local.abilityActive && local.classId === "sniper";
  const targetFov = scoped ? 28 : local.aiming ? 58 : abilityZoom ? 62 : DEFAULT_FOV;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, delta * 13));
  camera.updateProjectionMatrix();

  const targetPosition = local.aiming
    ? currentWeaponMesh.userData.aimPosition
    : currentWeaponMesh.userData.hipPosition;
  currentWeaponMesh.position.lerp(targetPosition, Math.min(1, delta * 14));
  currentWeaponMesh.visible = !scoped;
  dom.scopeOverlay.classList.toggle("active", scoped);
  dom.crosshair.style.opacity = scoped ? "0" : "1";
  dom.crosshair.classList.toggle("aiming", local.aiming && !scoped);

  const charge = currentChargeAmount();
  setBowChargeVisual(currentWeaponMesh, charge);
  dom.chargeMeter.classList.toggle("active", local.charging);
  dom.chargeFill.style.width = `${Math.round(charge * 100)}%`;
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

  const remoteWeaponId = CLASSES[p.classId]?.primary?.id || "assault_rifle";
  const gun = buildWeaponModel(remoteWeaponId, teamColor);
  rightArm.add(gun);
  gun.scale.setScalar(0.24);
  gun.position.set(0.03, -0.18, -0.12);
  gun.rotation.set(0, 0, 0);

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
    username: p.username, classId: p.classId, kills: p.kills || 0, deaths: p.deaths || 0, team: p.team
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

function syncVehicles(vehicleStates = []) {
  const present = new Set();
  vehicleStates.forEach((state) => {
    present.add(state.id);
    let entry = vehicles.get(state.id);
    if (!entry) {
      const model = buildVehicleModel(state);
      scene.add(model);
      entry = { model, state: { ...state }, target: { ...state }, destroyedStyled: false };
      vehicles.set(state.id, entry);
    }
    entry.target = { ...state };
  });
  vehicles.forEach((entry, id) => {
    if (present.has(id)) return;
    scene.remove(entry.model);
    vehicles.delete(id);
  });
}

function gatherVehicleHittable() {
  const meshes = [];
  vehicles.forEach((entry) => {
    if (entry.target.destroyed) return;
    entry.model.traverse((child) => { if (child.isMesh) meshes.push(child); });
  });
  return meshes;
}

function nearestVehicle() {
  let nearest = null;
  let nearestDistance = 4.2;
  vehicles.forEach((entry) => {
    if (entry.target.destroyed || entry.target.driverId) return;
    const distance = Math.hypot(camera.position.x - entry.target.x, camera.position.z - entry.target.z);
    if (distance < nearestDistance && Math.abs(camera.position.y - entry.target.y) < 6) {
      nearest = entry.target;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function updateVehicleHud() {
  const entry = vehicles.get(local.vehicleId);
  if (!entry) {
    dom.vehicleStatus.classList.remove("active");
    return;
  }
  const stats = VEHICLE_STATS[entry.target.type];
  dom.vehicleStatus.classList.add("active");
  dom.vehicleStatus.querySelector("strong").textContent = stats?.name || entry.target.type;
  dom.vehicleHealthFill.style.width = `${Math.max(0, entry.target.health / entry.target.maxHealth * 100)}%`;
}

function updateVehiclePresentation(delta) {
  vehicles.forEach((entry) => {
    const t = Math.min(1, delta * 12);
    entry.state.x = THREE.MathUtils.lerp(entry.state.x, entry.target.x, t);
    entry.state.y = THREE.MathUtils.lerp(entry.state.y, entry.target.y, t);
    entry.state.z = THREE.MathUtils.lerp(entry.state.z, entry.target.z, t);
    let yawDelta = entry.target.yaw - entry.state.yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    entry.state.yaw += yawDelta * t;
    entry.model.position.set(entry.state.x, entry.state.y, entry.state.z);
    entry.model.rotation.y = entry.state.yaw;

    if (entry.target.destroyed && !entry.destroyedStyled) {
      entry.destroyedStyled = true;
      entry.model.rotation.z = 0.16;
      entry.model.traverse((child) => {
        if (!child.isMesh) return;
        child.material = child.material.clone();
        child.material.color.multiplyScalar(0.28);
      });
    }
  });

  const driven = vehicles.get(local.vehicleId);
  if (!driven) {
    weaponRig.visible = true;
    return;
  }
  const offset = driven.model.userData.cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), driven.state.yaw);
  const desired = driven.model.position.clone().add(offset);
  camera.position.lerp(desired, Math.min(1, delta * 16));
  local.jumpOffset = driven.state.y;
  weaponRig.visible = !VEHICLE_STATS[driven.target.type]?.builtInWeapon;
  updateVehicleHud();
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

function setupRespawnLoadoutControls() {
  dom.respawnClassSelect.innerHTML = CLASS_ORDER.map((classId) => (
    `<option value="${classId}">${CLASSES[classId].name} - ${CLASSES[classId].primary.name}</option>`
  )).join("");
  dom.respawnSecondarySelect.innerHTML = SECONDARY_ORDER.map((weaponId) => (
    `<option value="${weaponId}">${SECONDARY_WEAPONS[weaponId].name}</option>`
  )).join("");
  const sendLoadout = () => {
    if (local.alive || !socket) return;
    socket.emit("player:setLoadout", {
      classId: dom.respawnClassSelect.value,
      secondaryId: dom.respawnSecondarySelect.value
    });
    dom.respawnLoadoutStatus.textContent = "Alteracao preparada";
  };
  dom.respawnClassSelect.addEventListener("change", sendLoadout);
  dom.respawnSecondarySelect.addEventListener("change", sendLoadout);
}

function showRespawnLoadout() {
  dom.respawnClassSelect.value = local.classId;
  dom.respawnSecondarySelect.value = local.secondaryId;
  dom.respawnLoadoutStatus.textContent = "";
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
  const vehicleHittable = gatherVehicleHittable();
  const pelletHits = new Map();
  const vehicleHits = new Map();
  const worldHits = new Map();
  let headshotFor = null;
  const pelletCount = weapon.pellets || 1;
  const spread = weapon.spread * (local.aiming ? 0.35 : 1);
  for (let i = 0; i < pelletCount; i++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();
    raycaster.set(camera.getWorldPosition(new THREE.Vector3()), dir);
    raycaster.far = weapon.range;
    const hits = raycaster.intersectObjects([...hittable, ...vehicleHittable, ...solidMeshesForRaycast], false);
    if (!hits.length) continue;
    const hit = hits[0];
    const socketId = hit.object.userData.socketId;
    const vehicleId = hit.object.userData.vehicleId;
    const destructibleId = hit.object.userData.destructibleId;
    if (socketId) {
      pelletHits.set(socketId, (pelletHits.get(socketId) || 0) + 1);
      if (hit.object.userData.isHead) headshotFor = socketId;
    } else if (vehicleId) {
      vehicleHits.set(vehicleId, (vehicleHits.get(vehicleId) || 0) + 1);
    } else if (destructibleId) {
      worldHits.set(destructibleId, { count: (worldHits.get(destructibleId)?.count || 0) + 1, point: hit.point });
    }
  }
  let targetSocketId = null, bestHits = 0;
  pelletHits.forEach((count, id) => { if (count > bestHits) { bestHits = count; targetSocketId = id; } });
  socket.emit("match:shoot", {
    slot, targetSocketId, pelletHits: bestHits || 1,
    hitZone: targetSocketId && headshotFor === targetSocketId ? "head" : "body"
  });
  vehicleHits.forEach((count, vehicleId) => {
    socket.emit("vehicle:hit", { vehicleId, slot, pelletHits: count });
  });
  worldHits.forEach(({ count, point }, id) => {
    socket.emit("world:hit", { id, damage: weapon.damage * count, x: point.x, z: point.z });
  });
}

function fireProjectile(weapon, slot, charge = 1) {
  // Visual: flecha/virote viaja ate o ponto de impacto. O acerto e resolvido de imediato
  // no servidor (mesma logica de hitscan), a viagem e apenas cosmetica.
  scene.updateMatrixWorld(true);
  const hittable = gatherHittable();
  const vehicleHittable = gatherVehicleHittable();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const spread = weapon.spread * (local.aiming ? 0.35 : 1);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, dir);
  raycaster.far = weapon.range;
  const hits = raycaster.intersectObjects([...hittable, ...vehicleHittable, ...solidMeshesForRaycast], false);
  const endPoint = hits.length ? hits[0].point : origin.clone().add(dir.multiplyScalar(weapon.range));
  const socketId = hits.length ? hits[0].object.userData.socketId : null;
  const isHead = hits.length ? hits[0].object.userData.isHead : false;
  const vehicleId = hits.length ? hits[0].object.userData.vehicleId : null;
  const destructibleId = hits.length ? hits[0].object.userData.destructibleId : null;

  const projMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: 0x6b4c30 }));
  projMesh.position.copy(origin);
  projMesh.lookAt(endPoint);
  scene.add(projMesh);
  const projectileSpeed = weapon.projectileSpeed * (weapon.chargeable ? 0.45 + charge * 0.55 : 1);
  const travelMs = Math.min(1200, Math.max(80, origin.distanceTo(endPoint) / projectileSpeed * 1000));
  const start = performance.now();
  (function step() {
    const t = Math.min(1, (performance.now() - start) / travelMs);
    projMesh.position.lerpVectors(origin, endPoint, t);
    if (t < 1) requestAnimationFrame(step);
    else scene.remove(projMesh);
  })();

  socket.emit("match:shoot", {
    slot, targetSocketId: socketId, pelletHits: 1,
    hitZone: socketId && isHead ? "head" : "body",
    charge
  });
  if (vehicleId) socket.emit("vehicle:hit", { vehicleId, slot, pelletHits: 1 });
  if (destructibleId && hits[0]) {
    socket.emit("world:hit", { id: destructibleId, damage: weapon.damage, x: hits[0].point.x, z: hits[0].point.z });
  }
}

function fireVehicleWeapon() {
  const entry = vehicles.get(local.vehicleId);
  if (!entry || !VEHICLE_STATS[entry.target.type]?.builtInWeapon) return;
  const now = performance.now();
  const cooldown = entry.target.type === "cannon" ? 2400 : 125;
  if (now - local.lastVehicleShotAt < cooldown) return;
  local.lastVehicleShotAt = now;

  scene.updateMatrixWorld(true);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, direction);
  raycaster.far = entry.target.type === "cannon" ? 140 : 120;
  const hits = raycaster.intersectObjects([...gatherHittable(), ...gatherVehicleHittable(), ...solidMeshesForRaycast], false);
  const hit = hits.find((item) => item.object.userData.socketId !== selfId && item.object.userData.vehicleId !== local.vehicleId);
  socket.emit("vehicle:fire", {
    vehicleId: local.vehicleId,
    targetSocketId: hit?.object.userData.socketId || null,
    targetVehicleId: hit?.object.userData.vehicleId || null,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: { x: direction.x, y: direction.y, z: direction.z }
  });
}

function renderVehicleFire({ type, origin, direction }) {
  const start = new THREE.Vector3(Number(origin?.x) || 0, Number(origin?.y) || 0, Number(origin?.z) || 0);
  const dir = new THREE.Vector3(Number(direction?.x) || 0, Number(direction?.y) || 0, Number(direction?.z) || -1).normalize();
  if (type === "cannon") {
    createCannonProjectile(scene, start, dir, (point) => createExplosion(scene, point, 0xffa13d));
    return;
  }
  const end = start.clone().addScaledVector(dir, 70);
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const tracer = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffe36e, transparent: true, opacity: 0.9 }));
  scene.add(tracer);
  setTimeout(() => scene.remove(tracer), 70);
}

function shoot(charge = 1) {
  if (!local.alive || !room) return;
  const slot = local.slot;
  const weapon = currentWeapon(slot);
  const now = performance.now();
  if (now < local.reloadUntil[slot]) return;
  if (weapon.kind !== "melee" && now - local.lastShotAt[slot] < weapon.fireRateMs) return;
  if (weapon.kind !== "melee" && local.ammo[slot] <= 0) { reload(); return; }

  local.lastShotAt[slot] = now;
  if (weapon.kind === "hitscan") playMuzzleFlash();
  recoilKick();

  if (weapon.kind === "projectile") fireProjectile(weapon, slot, charge);
  else fireHitscan(weapon, slot);

  if (weapon.kind !== "melee") {
    local.ammo[slot] = Math.max(0, local.ammo[slot] - 1);
    updateAmmoHud();
  }
}

function beginCharge() {
  const weapon = currentWeapon();
  if (!weapon.chargeable || local.charging) return;
  if (local.ammo[local.slot] <= 0) {
    reload();
    return;
  }
  local.charging = true;
  local.chargeStartedAt = performance.now();
  socket.emit("match:charge-start", { slot: local.slot });
}

function releaseCharge() {
  if (!local.charging) return;
  const charge = currentChargeAmount();
  local.charging = false;
  local.chargeStartedAt = 0;
  shoot(charge);
  setBowChargeVisual(currentWeaponMesh, 0);
  dom.chargeMeter.classList.remove("active");
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
  if (local.vehicleId && slot === "primary") return;
  if (slot === "secondary" && !room.settings.secondaryEnabled) return;
  cancelCharge();
  setAiming(false);
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
    const grenade = GRENADES[state.id];
    mapWorld?.destructiblesNear(pos.x, pos.z, grenade.radius + 2).forEach((object) => {
      socket.emit("world:hit", {
        id: object.id,
        damage: state.id === "explosive" || state.id === "impact" ? 65 : 0,
        x: object.mesh.position.x,
        z: object.mesh.position.z
      });
    });
    socket.emit("world:blast", { x: pos.x, z: pos.z, radius: grenade.radius + 2, damage: 65 });
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
/* ── Input ──────────────────────────────────────────────────────────── */
function onMouseDown(e) {
  if (!controls.isLocked) return;
  if (e.button === 0) {
    const vehicle = vehicles.get(local.vehicleId);
    if (vehicle && VEHICLE_STATS[vehicle.target.type]?.builtInWeapon) {
      local.mouseDown = true;
      fireVehicleWeapon();
      return;
    }
    const weapon = currentWeapon();
    if (weapon.chargeable) beginCharge();
    else {
      local.mouseDown = true;
      shoot();
    }
  }
  if (e.button === 2) {
    e.preventDefault();
    setAiming(true);
  }
}

function onMouseUp(e) {
  if (e.button === 0) {
    local.mouseDown = false;
    releaseCharge();
  }
  if (e.button === 2) setAiming(false);
}
document.addEventListener("contextmenu", (e) => { if (controls?.isLocked) e.preventDefault(); });

function onKeyDown(e) {
  if (!room || !local.alive) return;
  if (e.code === "KeyE") {
    if (local.vehicleId) socket.emit("vehicle:exit");
    else {
      const vehicle = nearestVehicle();
      if (vehicle) socket.emit("vehicle:enter", { vehicleId: vehicle.id });
    }
    return;
  }
  if (e.code === "Space" && vehicles.get(local.vehicleId)?.target.type === "cannon") {
    socket.emit("vehicle:launch-self", { vehicleId: local.vehicleId });
    return;
  }
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
let lastVehicleInputSent = 0;
function updateVehicleControls() {
  const entry = vehicles.get(local.vehicleId);
  if (!entry) return;
  const now = performance.now();
  if (local.mouseDown && entry.target.type === "plane") fireVehicleWeapon();
  if (now - lastVehicleInputSent < MOVE_SEND_MS) return;
  lastVehicleInputSent = now;
  socket.emit("vehicle:input", {
    throttle: Number(Boolean(keys.KeyW)) - Number(Boolean(keys.KeyS)),
    steer: Number(Boolean(keys.KeyA)) - Number(Boolean(keys.KeyD)),
    lift: Number(Boolean(keys.Space)) - Number(Boolean(keys.ControlLeft || keys.ControlRight))
  });
}

function updateMovement(delta) {
  if (!controls.isLocked || !local.alive) return;
  if (local.vehicleId) {
    updateVehicleControls();
    return;
  }
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
  const mapHalf = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
  camera.position.x = Math.max(-mapHalf + 1, Math.min(mapHalf - 1, camera.position.x));
  camera.position.z = Math.max(-mapHalf + 1, Math.min(mapHalf - 1, camera.position.z));

  const feetY = local.jumpOffset;
  if (isBlockedAt(camera.position.x, camera.position.z, feetY)) {
    camera.position.x = prevX;
    camera.position.z = prevZ;
  }

  if (local.externalVelocity.lengthSq() > 0.01) {
    camera.position.x += local.externalVelocity.x * delta;
    camera.position.z += local.externalVelocity.z * delta;
    local.verticalVelocity = Math.max(local.verticalVelocity, local.externalVelocity.y);
    local.externalVelocity.x *= Math.max(0, 1 - delta * 2.4);
    local.externalVelocity.z *= Math.max(0, 1 - delta * 2.4);
    local.externalVelocity.y = 0;
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
    const landed = !local.onGround;
    local.jumpOffset = groundY;
    local.verticalVelocity = 0;
    local.onGround = true;
    if (landed && local.pendingFallDamage > 0) {
      socket.emit("world:fall-damage", { damage: local.pendingFallDamage });
      local.pendingFallDamage = 0;
    }
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
    updateVehiclePresentation(delta);
    updateMovement(delta);
    updateGrenadesPhysics(delta);
    animateAvatars(delta);
    mapWorld?.update(delta, activeWorldEvent);
    updateAbilityHud();
    updateWeaponPresentation(delta);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

/* ── API publica ────────────────────────────────────────────────────── */
let lastEventAlertKey = "";
function updateEventAlert(event) {
  activeWorldEvent = event;
  if (!event) return;
  const key = `${event.type}:${event.phase}`;
  if (key === lastEventAlertKey) return;
  lastEventAlertKey = key;
  const messages = {
    "tsunami:warning": "ALERTA DE EVENTO: tsunami se formando",
    "tsunami:surge": "TSUNAMI: a onda esta atravessando a ilha",
    "tsunami:flooded": "ILHA INUNDADA: a agua recua em 15 segundos",
    "tsunami:drain": "A agua esta baixando",
    "tornado:warning": "ALERTA DE EVENTO: a floresta esta despertando",
    "tornado:active": "TORNADO ANCESTRAL: procure abrigo nas montanhas",
    "tornado:recovery": "O vento esta enfraquecendo"
  };
  dom.eventAlert.textContent = messages[key] || "Evento mundial";
  dom.eventAlert.classList.add("active");
  if (event.phase === "drain" || event.phase === "recovery") {
    setTimeout(() => dom.eventAlert.classList.remove("active"), 4500);
  }
}

export function attachSocket(activeSocket) {
  socket = activeSocket;

  socket.on("match:start", (roomState) => {
    ensureScene();
    clearSceneObjects();
    room = roomState;
    selfId = socket.id;
    mapWorld = buildMap(room.settings.mapId, scene);
    obstacles = mapWorld.obstacles;
    solidMeshesForRaycast = [];
    scene.traverse((obj) => { if (obj.isMesh && obj.userData.socketId === undefined) solidMeshesForRaycast.push(obj); });
    syncVehicles(room.vehicles || []);
    activeWorldEvent = room.worldEvent || null;

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
    local.aiming = false;
    local.charging = false;
    local.chargeStartedAt = 0;
    local.vehicleId = null;
    local.externalVelocity.set(0, 0, 0);
    local.pendingFallDamage = 0;

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
    dom.vehicleStatus.classList.remove("active");
    dom.eventAlert.classList.remove("active");
    updateHealthHud(); updateAmmoHud(); updateGrenadeHud(); updateScoreboard();
    controls.lock();
  });

  socket.on("room:player-left", ({ socketId }) => { removeAvatar(socketId); updateScoreboard(); });

  socket.on("vehicle:state", (states) => syncVehicles(states));

  socket.on("vehicle:entered", (vehicle) => {
    local.vehicleId = vehicle.id;
    local.lastVehicleShotAt = 0;
    syncVehicles([...(Array.from(vehicles.values()).map((entry) => entry.target).filter((item) => item.id !== vehicle.id)), vehicle]);
    if (!VEHICLE_STATS[vehicle.type]?.builtInWeapon) switchSlot("secondary");
    else weaponRig.visible = false;
    updateVehicleHud();
  });

  socket.on("vehicle:exited", ({ x, y, z }) => {
    local.vehicleId = null;
    local.mouseDown = false;
    weaponRig.visible = true;
    camera.position.set(Number(x) || camera.position.x, EYE_HEIGHT + (Number(y) || 0), Number(z) || camera.position.z);
    local.jumpOffset = Number(y) || 0;
    switchSlot("primary");
    updateVehicleHud();
  });

  socket.on("vehicle:damaged", ({ vehicleId, health, maxHealth }) => {
    const entry = vehicles.get(vehicleId);
    if (!entry) return;
    entry.target.health = health;
    entry.target.maxHealth = maxHealth;
    if (local.vehicleId === vehicleId) updateVehicleHud();
  });

  socket.on("vehicle:exploded", ({ vehicleId, x, y, z }) => {
    const entry = vehicles.get(vehicleId);
    if (entry) entry.target.destroyed = true;
    createExplosion(scene, new THREE.Vector3(x, y + 1, z));
  });

  socket.on("vehicle:fired", renderVehicleFire);

  socket.on("arena-world:event", (event) => updateEventAlert(event?.type === "none" ? null : event));

  socket.on("world:object-state", (state) => mapWorld?.applyObjectState(state));

  socket.on("world:force", ({ x, y, z, fallDamage }) => {
    local.externalVelocity.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    local.verticalVelocity = Math.max(local.verticalVelocity, Number(y) || 0);
    local.onGround = false;
    local.pendingFallDamage = Math.max(local.pendingFallDamage, Number(fallDamage) || 0);
  });

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
      local.vehicleId = null;
      local.mouseDown = false;
      local.externalVelocity.set(0, 0, 0);
      local.pendingFallDamage = 0;
      weaponRig.visible = true;
      dom.vehicleStatus.classList.remove("active");
      setAiming(false);
      cancelCharge();
      updateHealthHud();
      dom.deathBy.textContent = killerName ? `Eliminado por ${killerName}` : "";
      showRespawnLoadout();
      dom.deathScreen.hidden = false;
      dom.pauseHint.hidden = true;
      controls.unlock();
    } else {
      const a = remotePlayers.get(victimId);
      if (a) a.deaths += 1;
    }
    updateScoreboard();
  });

  socket.on("player:loadoutPending", ({ classId, secondaryId }) => {
    if (classId) dom.respawnClassSelect.value = classId;
    if (secondaryId) dom.respawnSecondarySelect.value = secondaryId;
    dom.respawnLoadoutStatus.textContent = "Equipamento confirmado";
  });

  socket.on("match:respawn", ({ socketId, x, y, z, yaw, health, classId, secondaryId, team }) => {
    if (socketId === selfId) {
      local.alive = true; local.health = health;
      local.vehicleId = null;
      local.mouseDown = false;
      local.externalVelocity.set(0, 0, 0);
      local.pendingFallDamage = 0;
      local.classId = classId || local.classId;
      local.secondaryId = secondaryId || local.secondaryId;
      local.team = team || local.team;
      local.slot = "primary";
      local.jumpOffset = y; local.verticalVelocity = 0;
      local.onGround = true;
      camera.position.set(x, EYE_HEIGHT + y, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      local.ammo.primary = CLASSES[local.classId].primary.magSize;
      local.ammo.secondary = SECONDARY_WEAPONS[local.secondaryId].magSize;
      local.grenadeCharges = Object.fromEntries(GRENADE_ORDER.map((id) => [id, GRENADE_CHARGES_PER_LIFE]));
      weaponRig.visible = true;
      setViewWeapon("#4c5a3a", CLASSES[local.classId].primary.id);
      dom.vehicleStatus.classList.remove("active");
      updateHealthHud(); updateAmmoHud(); updateGrenadeHud();
      dom.deathScreen.hidden = true;
      dom.pauseHint.textContent = "Clique para voltar a partida";
      dom.pauseHint.hidden = false;
    } else {
      const a = remotePlayers.get(socketId);
      if (a && classId && a.classId !== classId) {
        const username = a.username;
        removeAvatar(socketId);
        spawnOrUpdateRemote({ socketId, username, classId, secondaryId, team, x, y, z, yaw, alive: true });
      } else if (a) {
        a.root.visible = true;
        a.root.position.set(x, y, z);
      }
    }
  });

  socket.on("match:ability", ({ socketId, abilityId, durationMs }) => {
    if (socketId === selfId) {
      local.abilityActive = true;
      local.abilityExpiresAt = performance.now() + durationMs;
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
    setAiming(false);
    cancelCharge();
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
