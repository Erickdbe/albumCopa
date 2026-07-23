import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, VignetteEffect } from "postprocessing";
import { buildMap } from "./maps.js?v=20260722-2";
import { buildWeaponModel, setBowChargeVisual } from "./weapon-models.js?v=20260723-4";
import { buildVehicleModel, createAirBomb, createCannonProjectile, createExplosion } from "./vehicle-models.js";
import { emitExplosionFx, emitImpactFx, emitMuzzleFx, emitNapalmExplosionFx, preloadWarFx } from "./war-fx.js";
import { UNIFIED_RIVER_POINTS } from "./water-world.js";
import {
  clearSurvivalWorld,
  gatherSurvivalZombieHittable,
  nearestSurvivalLoot,
  removeSurvivalLoot,
  syncSurvivalLoot,
  syncSurvivalZombies,
  updateSurvivalWorld
} from "./survival-world.js?v=20260723-4";
import {
  attachAnimatedCharacter,
  playCharacterAction,
  playCharacterWeaponAction,
  setCharacterAiming,
  setCharacterAnimation,
  updateCharacterPose
} from "./character-model.js?v=20260722-2";
import { attachMeshyModel } from "./meshy-assets.js";
import {
  unlockAudio, playWeaponSound, playImpactSound, playExplosionSound, playReloadSound,
  playFootstep, updateAudioListener, updateVehicleEngine
} from "./game-audio.js";
import {
  CLASSES, CLASS_ORDER, SECONDARY_WEAPONS, SECONDARY_ORDER, GRENADES, GRENADE_ORDER,
  ARENA_HALF, MAP_HALF_SIZES, MAP_META, VEHICLE_STATS, EYE_HEIGHT, GRAVITY, WALK_SPEED, SPRINT_MUL, CROUCH_MUL, MOVE_SEND_MS,
  HEADSHOT_MULTIPLIER
} from "./config.js";

const STEP_TOLERANCE = 0.65;
const PLAYER_COLLISION_RADIUS = 0.32;
const GRENADE_RELEASE_MS = 950;
const JUMP_HEIGHT_BASE = 1.5; // altura de pulo de referencia (multiplicada por jumpHeightMul)
const DEFAULT_FOV = 78;
const VEHICLE_INPUT_SEND_MS = 34;
const LADDER_SPEED = 4.8;
const PRONE_SPEED_MUL = 0.3;
const PRONE_EYE_OFFSET = 1.08;
const EMPTY_SLOT = "hands";
const DANCE_OPTIONS = {
  dance: { label: "Passinho", speed: 1, animation: "dance" },
  dance_fast: { label: "Energia", speed: 1.35, animation: "dance_fast" },
  dance_slow: { label: "Flow", speed: 0.72, animation: "dance_slow" }
};

let scene, camera, renderer, composer, controls, clock, raycaster;
let hemiLight, sunLight;
let obstacles = [];
let solidMeshesForRaycast = [];
let weaponRig, currentWeaponMesh, muzzleFlash;
let mapWorld = null;
let activeWorldEvent = null;
let activeWorldTime = null;
let cameraMode = localStorage.getItem("arenaBrawlCameraMode") === "third" ? "third" : "first";
let localViewAvatar = null;
let socket = null;
let room = null;
let selfId = null;
let onEndCallback = null;

const keys = {};
// Teclas usadas pelo jogo — enquanto a partida esta ativa, seguramos o default
// do navegador nelas (inclui Control e Shift, o que neutraliza Ctrl+A / Ctrl+Shift+A).
const GAME_KEY_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyF", "KeyG", "KeyQ", "KeyR",
  "KeyV", "KeyB", "KeyC", "KeyZ", "Space", "Tab",
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft",
  "Digit1", "Digit2", "Digit3", "Digit4",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
]);
function shouldCaptureGameKey(e) {
  // So intercepta quando o jogo esta em foco (ponteiro travado) e o alvo nao e
  // um campo de texto. Preserva F5, F11, F12 e Ctrl+Shift+I pro usuario nunca
  // ficar preso.
  if (!controls?.isLocked) return false;
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return false;
  if (e.key === "F5" || e.key === "F11" || e.key === "F12") return false;
  return GAME_KEY_CODES.has(e.code);
}
const remotePlayers = new Map();
const vehicles = new Map();
const activeGrenades = [];
const activeBallistics = [];
const _readEuler = new THREE.Euler(0, 0, 0, "YXZ");
const groundRaycaster = new THREE.Raycaster();
const groundRayOrigin = new THREE.Vector3();
const groundRayDirection = new THREE.Vector3(0, -1, 0);
const localMoveVelocity = new THREE.Vector3();
const localMoveTarget = new THREE.Vector3();
const localViewTargetPosition = new THREE.Vector3();
const thirdPersonRenderPosition = new THREE.Vector3();
const thirdPersonRenderTarget = new THREE.Vector3();
const vehicleCameraDesired = new THREE.Vector3();
const vehicleCameraAnchor = new THREE.Vector3();
const vehicleCameraDirection = new THREE.Vector3();
const vehicleCameraPath = new THREE.Vector3();
const vehicleCameraLookAt = new THREE.Vector3();
const vehicleCameraLift = new THREE.Vector3();
const vehicleForward = new THREE.Vector3();
const vehicleMuzzle = new THREE.Vector3();
let thirdPersonCameraReady = false;
let lastFootstepAt = 0;
let lastMinimapDrawAt = 0;
let danceHubOpen = false;
let hitMarkerTimer = null;
let survivalStatus = { wave: 1, activeZombies: 0 };

const local = {
  x: 0, y: 0, z: 0, jumpOffset: 0, verticalVelocity: 0, onGround: true,
  health: 100, alive: true, classId: "rifle", secondaryId: "pistol_common",
  kills: 0, deaths: 0, score: 0, team: null,
  slot: EMPTY_SLOT,
  inventory: { primary: false, secondary: false, grenades: {}, fuel: 0, medkits: 0 },
  ammo: { primary: 0, secondary: 0 },
  reloadUntil: { primary: 0, secondary: 0 },
  lastShotAt: { primary: 0, secondary: 0 },
  grenadeCharges: {},
  grenadeSelected: "explosive",
  grenadeThrowPending: false,
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
  lastVehicleShotAt: 0,
  vehicleLookYaw: 0,
  vehicleLookPitch: 0,
  vehicleBombReadyAt: 0,
  harpoonSlowUntil: 0,
  harpoonSlowStrength: 1,
  emoteActive: false,
  emoteUntil: 0,
  emoteSpeed: 1,
  emoteAnimation: "dance",
  climbing: false,
  moving: false,
  moveForward: 0,
  moveStrafe: 0,
  sprinting: false,
  crouching: false,
  jumping: false,
  prone: false,
  proneExitUntil: 0
};

/* ── DOM ────────────────────────────────────────────────────────────── */
const dom = {};
function cacheDom() {
  [
    "gameCanvas", "crosshair", "healthFill", "healthText", "ammoCount", "weaponName",
    "scoreboardList", "killFeed", "deathScreen", "deathBy", "pauseHint", "hudTopLeft",
    "hudBottomRight", "hudTopRight", "abilityFill", "abilityName", "grenadeCount", "grenadeName",
    "matchTimer", "endScreen", "endResults", "gameRoot", "scopeOverlay", "chargeMeter", "chargeFill",
    "eventAlert", "interactionHint", "vehicleStatus", "vehicleHealthFill", "vehicleHealthText", "vehicleAbility", "respawnClassSelect", "respawnSecondarySelect",
    "respawnLoadoutStatus", "minimap", "minimapCanvas", "hitMarker", "danceHub", "danceGrid", "closeDanceHub",
    "cameraToggle", "medkitCount", "fuelCount", "survivalWave", "zombieCount"
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

/* ── Setup de cena ──────────────────────────────────────────────────── */
function ensureScene() {
  if (scene) return;
  cacheDom();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 720);
  renderer = new THREE.WebGLRenderer({ canvas: dom.gameCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  setupPostProcessing();

  hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
  sunLight.position.set(30, 45, 15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  scene.add(sunLight);

  controls = new PointerLockControls(camera, document.body);
  camera.rotation.order = "YXZ";

  weaponRig = new THREE.Group();
  camera.add(weaponRig);
  scene.add(camera);

  muzzleFlash = new THREE.PointLight(0xffddaa, 0, 6);
  weaponRig.add(muzzleFlash);
  preloadWarFx();

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener("keydown", (e) => {
    unlockAudio();
    // Durante a partida (ponteiro travado), impede que as teclas de controle
    // acionem atalhos do navegador: Ctrl+A selecionava a pagina (fica azul),
    // Ctrl+Shift+A e afins fechavam/atrapalhavam, e Espaco rolava a pagina.
    // Fora do jogo (menus/lobby) nao interferimos.
    if (shouldCaptureGameKey(e)) e.preventDefault();
    keys[e.code] = true;
    onKeyDown(e);
  });
  window.addEventListener("keyup", (e) => {
    if (shouldCaptureGameKey(e)) e.preventDefault();
    keys[e.code] = false;
    if (e.code === "Space" && !Number.isFinite(local.proneExitUntil)) local.proneExitUntil = 0;
  });
  document.addEventListener("mousedown", (event) => { unlockAudio(); onMouseDown(event); });
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mousemove", onVehicleMouseMove);
  dom.gameCanvas.addEventListener("click", () => { if (local.alive && !danceHubOpen) controls.lock(); });
  dom.pauseHint.addEventListener("click", () => { if (local.alive && !danceHubOpen) controls.lock(); });
  dom.cameraToggle?.addEventListener("click", toggleCameraMode);
  controls.addEventListener("lock", () => { dom.pauseHint.hidden = true; });
  controls.addEventListener("unlock", () => {
    setAiming(false);
    cancelCharge();
    if (local.alive && !danceHubOpen && !local.vehicleId) dom.pauseHint.hidden = false;
  });
  setupRespawnLoadoutControls();
  setupDanceHub();
  updateCameraToggle();

  requestAnimationFrame(render);
}

function setupPostProcessing() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({
      intensity: 0.52,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.24
    });
    const vignette = new VignetteEffect({
      darkness: 0.28,
      offset: 0.42
    });
    composer.addPass(new EffectPass(camera, bloom, vignette));
    composer.setSize(window.innerWidth, window.innerHeight);
  } catch (error) {
    console.warn("Postprocessing desativado:", error);
    composer = null;
  }
}

function applyWorldLighting(delta) {
  if (!scene || !activeWorldTime || !room) return;
  const sun = Math.max(0, Math.min(1, Number(activeWorldTime.sun) || 0));
  const progress = Math.max(0, Math.min(1, Number(activeWorldTime.progress) || 0));
  const mapMeta = MAP_META[room.settings.mapId] || MAP_META.cidade;
  const baseSky = new THREE.Color(mapMeta.sky || 0x7db6d6);
  const nightSky = new THREE.Color(0x101722);
  const dawnSky = new THREE.Color(0xff9168);
  const sky = nightSky.clone().lerp(baseSky, sun);
  const horizonWarmth = Math.max(0, 1 - Math.abs(sun - 0.46) / 0.25);
  sky.lerp(dawnSky, horizonWarmth * 0.22);

  scene.background?.lerp?.(sky, Math.min(1, delta * 0.8));
  if (scene.fog?.color) scene.fog.color.lerp(sky, Math.min(1, delta * 0.8));

  const ambient = 0.36 + sun * 0.78;
  const sunIntensity = 0.18 + sun * 1.28;
  if (hemiLight) {
    hemiLight.intensity = THREE.MathUtils.lerp(hemiLight.intensity, ambient, Math.min(1, delta * 1.2));
    hemiLight.color.lerp(new THREE.Color(sun > 0.45 ? 0xffffff : 0x9eb8ff), Math.min(1, delta * 0.8));
    hemiLight.groundColor.lerp(new THREE.Color(sun > 0.45 ? 0x445566 : 0x161a2b), Math.min(1, delta * 0.8));
  }
  if (sunLight) {
    sunLight.intensity = THREE.MathUtils.lerp(sunLight.intensity, sunIntensity, Math.min(1, delta * 1.4));
    const angle = progress * Math.PI * 2 - Math.PI * 0.45;
    sunLight.position.set(Math.cos(angle) * 52, 12 + sun * 58, Math.sin(angle) * 52);
    sunLight.color.lerp(new THREE.Color(horizonWarmth > 0.1 ? 0xffd3a0 : 0xffffff), Math.min(1, delta * 0.8));
  }
  if (renderer) {
    const targetExposure = 0.78 + sun * 0.38 + horizonWarmth * 0.08;
    renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, targetExposure, Math.min(1, delta * 0.9));
  }
}

function clearSceneObjects() {
  clearSurvivalWorld();
  [...scene.children].forEach((child) => {
    if (child === camera) return;
    scene.remove(child);
  });
  hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 1);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
  sunLight.position.set(30, 45, 15);
  sunLight.castShadow = true;
  scene.add(sunLight);
  remotePlayers.forEach((a) => scene.remove(a.root));
  remotePlayers.clear();
  activeGrenades.forEach((g) => scene.remove(g.mesh));
  activeGrenades.length = 0;
  activeBallistics.forEach((shot) => {
    scene.remove(shot.mesh);
    scene.remove(shot.trail);
  });
  activeBallistics.length = 0;
  updateVehicleEngine(false);
  vehicles.clear();
  if (localViewAvatar) {
    localViewAvatar.mixer?.stopAllAction();
    scene.remove(localViewAvatar.root);
    localViewAvatar = null;
  }
  mapWorld = null;
  activeWorldEvent = null;
}

function updateCameraToggle() {
  if (!dom.cameraToggle) return;
  const vehicleCamera = Boolean(local.vehicleId);
  const thirdPersonActive = vehicleCamera || cameraMode === "third";
  dom.cameraToggle.textContent = thirdPersonActive ? "3a pessoa" : "1a pessoa";
  dom.cameraToggle.classList.toggle("third", thirdPersonActive);
}

function toggleCameraMode() {
  if (local.vehicleId) {
    weaponRig.visible = false;
    updateCameraToggle();
    return;
  }
  cameraMode = cameraMode === "third" ? "first" : "third";
  localStorage.setItem("arenaBrawlCameraMode", cameraMode);
  thirdPersonCameraReady = false;
  updateCameraToggle();
  if (cameraMode === "first" && !local.vehicleId) weaponRig.visible = Boolean(currentWeaponMesh);
}

/* ── Terreno (piso + colisao generalizada) ─────────────────────────── */
function pointInsideObstacle2D(ob, x, z, padding = 0) {
  if (ob.type === "obb") {
    const dx = x - ob.centerX;
    const dz = z - ob.centerZ;
    const cos = Math.cos(-(ob.yaw || 0));
    const sin = Math.sin(-(ob.yaw || 0));
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return Math.abs(localX) <= (ob.halfX || 0) + padding &&
      Math.abs(localZ) <= (ob.halfZ || 0) + padding;
  }
  return x > ob.minX - padding && x < ob.maxX + padding &&
    z > ob.minZ - padding && z < ob.maxZ + padding;
}

function lerpAngle(current, target, alpha) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * alpha;
}

function groundInfoAt(x, z, feetY) {
  let best = mapWorld?.requireExplicitGround ? -Infinity : 0;
  let found = !mapWorld?.requireExplicitGround;
  const groundMeshes = mapWorld?.groundRaycastMeshes || [];
  if (groundMeshes.length) {
    groundRayOrigin.set(x, Math.max(feetY + 18, (mapWorld.safeSpawn?.y || 0) + 80), z);
    groundRaycaster.set(groundRayOrigin, groundRayDirection);
    groundRaycaster.far = 180;
    const hits = groundRaycaster.intersectObjects(groundMeshes, false);
    for (const hit of hits) {
      const y = hit.point.y;
      const initialTerrainSnap = mapWorld?.requireExplicitGround && feetY <= STEP_TOLERANCE && y >= feetY;
      if ((y <= feetY + STEP_TOLERANCE || initialTerrainSnap) && y > best) {
        best = y;
        found = true;
        break;
      }
    }
  }
  for (const ob of obstacles) {
    if (ob.active === false) continue;
    if (!pointInsideObstacle2D(ob, x, z, 0.08)) continue;
    if (ob.solid && feetY + STEP_TOLERANCE < ob.topY) continue;
    if (ob.topY <= feetY + STEP_TOLERANCE && ob.topY > best) {
      best = ob.topY;
      found = true;
    }
  }
  if (!Number.isFinite(best)) best = mapWorld?.safeSpawn?.y || 0;
  return { height: best, found };
}
function groundHeightAt(x, z, feetY) {
  return groundInfoAt(x, z, feetY).height;
}

function terrainSurfaceHeightAt(x, z, fallback = 0) {
  const groundMeshes = mapWorld?.groundRaycastMeshes || [];
  if (!groundMeshes.length) return fallback;
  groundRayOrigin.set(x, 110, z);
  groundRaycaster.set(groundRayOrigin, groundRayDirection);
  groundRaycaster.far = 180;
  const hit = groundRaycaster.intersectObjects(groundMeshes, false)
    .find((item) => item.object.visible !== false);
  return hit?.point?.y ?? fallback;
}
function snapLocalToSafeGround() {
  const safe = mapWorld?.safeSpawn || { x: 0, y: 0, z: 0, yaw: 0 };
  local.jumpOffset = safe.y || 0;
  local.verticalVelocity = 0;
  local.onGround = true;
  local.prone = false;
  local.proneExitUntil = 0;
  localMoveVelocity.set(0, 0, 0);
  localMoveTarget.set(0, 0, 0);
  camera.position.set(safe.x || 0, EYE_HEIGHT + local.jumpOffset, safe.z || 0);
  if (Number.isFinite(safe.yaw)) camera.quaternion.setFromEuler(new THREE.Euler(0, safe.yaw, 0, "YXZ"));
}
function ensureLocalPlayablePosition() {
  if (!mapWorld?.requireExplicitGround) return;
  const ground = groundInfoAt(camera.position.x, camera.position.z, local.jumpOffset);
  if (!ground.found) {
    snapLocalToSafeGround();
    return;
  }
  if (ground.height > local.jumpOffset + 0.04 || local.jumpOffset < ground.height - 0.12) {
    local.jumpOffset = ground.height;
    local.verticalVelocity = 0;
    local.onGround = true;
    camera.position.y = EYE_HEIGHT + ground.height;
  }
}
function isBlockedAt(x, z, feetY) {
  for (const ob of obstacles) {
    if (ob.active === false) continue;
    if (!ob.solid) continue;
    const padding = Number.isFinite(ob.collisionPadding) ? ob.collisionPadding : PLAYER_COLLISION_RADIUS;
    if (pointInsideObstacle2D(ob, x, z, padding)) {
      if (feetY + STEP_TOLERANCE < ob.topY) return true;
    }
  }
  return false;
}

function findLadderAt(x, z, feetY) {
  const ladders = mapWorld?.ladders || [];
  return ladders.find((ladder) => (
    x >= ladder.minX && x <= ladder.maxX &&
    z >= ladder.minZ && z <= ladder.maxZ &&
    feetY >= ladder.bottomY - 0.35 &&
    feetY <= ladder.topY + 0.5
  )) || null;
}

/* ── Armas em 1a pessoa (view model) ───────────────────────────────── */
function setViewWeapon(color, kind) {
  if (currentWeaponMesh) weaponRig.remove(currentWeaponMesh);
  currentWeaponMesh = null;
  if (!kind) {
    muzzleFlash.intensity = 0;
    return;
  }
  currentWeaponMesh = buildWeaponModel(kind, color);
  currentWeaponMesh.traverse((object) => { object.userData.viewModel = true; });
  weaponRig.add(currentWeaponMesh);
  const muzzle = currentWeaponMesh.userData.muzzlePosition || new THREE.Vector3(0, 0, -0.8);
  muzzleFlash.position.copy(currentWeaponMesh.position).add(muzzle);
  setBowChargeVisual(currentWeaponMesh, 0);
}
function playMuzzleFlash() {
  muzzleFlash.intensity = 6;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 60);
  if (!currentWeaponMesh) return;
  scene.updateMatrixWorld(true);
  const localMuzzle = (currentWeaponMesh.userData.muzzlePosition || new THREE.Vector3(0, 0, -0.9)).clone();
  const origin = currentWeaponMesh.localToWorld(localMuzzle);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  emitMuzzleFx(scene, origin, direction, currentWeapon()?.id === "heavy_mg" ? 1.18 : 1);
}
function recoilKick() {
  if (!currentWeaponMesh) return;
  const weaponMesh = currentWeaponMesh;
  const base = weaponMesh.position.z;
  weaponMesh.position.z = base + 0.09;
  setTimeout(() => { weaponMesh.position.z = base; }, 90);
}

function setAiming(enabled) {
  local.aiming = Boolean(enabled && local.alive && room?.status === "playing" && currentWeapon());
}

function currentChargeAmount() {
  const weapon = currentWeapon();
  if (!local.charging || !weapon?.chargeable) return 0;
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
  if (!camera) return;
  if (!currentWeaponMesh) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, DEFAULT_FOV, Math.min(1, delta * 10));
    camera.updateProjectionMatrix();
    return;
  }
  const weapon = currentWeapon();
  if (!weapon) return;
  const scoped = local.aiming && weapon.id === "sniper_rifle";
  const abilityZoom = local.abilityActive && CLASSES[local.classId]?.ability?.id === "foco_letal";
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

function characterIdForPlayer(player) {
  const seed = String(player?.socketId || player?.username || "");
  if (room?.settings?.mapId === "alagado") {
    const survivors = ["quaternius_sam", "quaternius_lis", "quaternius_matt", "quaternius_shaun"];
    let survivorHash = 0;
    for (let i = 0; i < seed.length; i += 1) survivorHash = (survivorHash * 31 + seed.charCodeAt(i)) >>> 0;
    return survivors[survivorHash % survivors.length];
  }
  if (player?.team === "red") return "fps_female";
  if (player?.team === "blue") return "fps_male";
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 2 === 0 ? "fps_male" : "fps_female";
}

function directionalMoveAnimation(avatar, prefix) {
  const forward = Math.sign(Number(avatar.moveForward) || 0);
  const strafe = Math.sign(Number(avatar.moveStrafe) || 0);
  if (forward > 0 && strafe < 0) return `${prefix}_forward_left`;
  if (forward > 0 && strafe > 0) return `${prefix}_forward_right`;
  if (forward < 0 && strafe < 0) return `${prefix}_back_left`;
  if (forward < 0 && strafe > 0) return `${prefix}_back_right`;
  if (forward < 0) return `${prefix}_back`;
  if (strafe < 0) return `${prefix}_left`;
  if (strafe > 0) return `${prefix}_right`;
  return `${prefix}_forward`;
}

function animationForAvatar(avatar) {
  if (!avatar.alive) return "death";
  if (avatar.inVehicle) return avatar.vehicleAnimation || "drive";
  if (avatar.emoteUntil > performance.now() && !avatar.moving && !avatar.jumping && !avatar.prone) return avatar.emoteAnimation || "dance";
  if (avatar.jumping) return "jump";
  if (avatar.prone && avatar.moving) return "proneCrawl";
  if (avatar.prone) return "prone";
  if (avatar.crouching && avatar.moving) return "crouchWalk";
  if (avatar.crouching) return "crouch";
  if (avatar.sprinting) return directionalMoveAnimation(avatar, "run");
  if (avatar.moving) return directionalMoveAnimation(avatar, "walk");
  return "idle";
}

function vehicleAnimationForType(type) {
  if (type === "bike" || type === "moto" || type === "motorcycle") return "driveBike";
  if (type === "plane" || type === "helicopter") return "drivePlane";
  if (type === "jetski") return "driveJetski";
  return "drive";
}

function normalizeSlot(slot) {
  return slot === "primary" || slot === "secondary" ? slot : EMPTY_SLOT;
}

function slotUnlockedForState(state, slot) {
  const normalized = normalizeSlot(slot);
  if (normalized === EMPTY_SLOT) return false;
  if (state?.inventory) return Boolean(state.inventory[normalized]);
  return normalizeSlot(state?.slot) !== EMPTY_SLOT;
}

function weaponIdForPlayerState(state, slot = state?.slot) {
  const normalized = normalizeSlot(slot);
  if (!slotUnlockedForState(state, normalized)) return null;
  if (normalized === "secondary") return SECONDARY_WEAPONS[state?.secondaryId || "pistol_common"]?.id || "pistol_common";
  return CLASSES[state?.classId || "rifle"]?.primary?.id || "assault_rifle";
}

function updateAvatarGun(avatar, weaponId) {
  if (!avatar?.gun) return;
  const normalizedWeaponId = weaponId || null;
  if (avatar.gun.userData.weaponId === normalizedWeaponId) {
    avatar.gun.visible = Boolean(normalizedWeaponId);
    return;
  }
  const parent = avatar.gun.parent || avatar.rightArm;
  const position = avatar.gun.position.clone();
  const rotation = avatar.gun.rotation.clone();
  const scale = avatar.gun.scale.clone();
  parent.remove(avatar.gun);
  const gun = buildWeaponModel(normalizedWeaponId || "knife", avatar.teamColor || "#4c5a3a");
  gun.userData.weaponId = normalizedWeaponId;
  gun.visible = Boolean(normalizedWeaponId);
  gun.position.copy(position);
  gun.rotation.copy(rotation);
  gun.scale.copy(scale);
  parent.add(gun);
  avatar.gun = gun;
}

function buildAvatar(p) {
  const teamColor = p.team === "red" ? "#e05555" : p.team === "blue" ? "#4d8fe0" : colorFromId(p.socketId);
  const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a978 });
  const root = new THREE.Group();

  const teamMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 32),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
  );
  teamMarker.rotation.x = -Math.PI / 2;
  teamMarker.position.y = 0.025;
  root.add(teamMarker);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.38), bodyMat);
  torso.position.y = 1.15;
  root.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skinMat);
  head.position.y = 1.78;
  root.add(head);

  // Tight body-part volumes avoid registering shots in the empty space around the avatar.
  const hitboxMaterial = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false
  });
  const hitboxRig = new THREE.Group();
  hitboxRig.name = "player-hitbox-rig";
  root.add(hitboxRig);
  const bodyHitboxes = [];
  const hitboxParts = {};
  const addBodyHitbox = (part, geometry, position, isHead = false) => {
    const hitbox = new THREE.Mesh(geometry, hitboxMaterial.clone());
    hitbox.position.copy(position);
    hitbox.userData.isHead = isHead;
    hitbox.userData.hitZone = isHead ? "head" : "body";
    hitbox.userData.hitPart = part;
    hitboxRig.add(hitbox);
    bodyHitboxes.push(hitbox);
    hitboxParts[part] = hitbox;
    return hitbox;
  };
  const bodyHitbox = addBodyHitbox(
    "torso",
    new THREE.BoxGeometry(0.54, 1, 0.32),
    new THREE.Vector3(0, 1.16, 0)
  );
  const lowerHitbox = addBodyHitbox(
    "pelvis",
    new THREE.BoxGeometry(0.46, 0.3, 0.32),
    new THREE.Vector3(0, 0.7, 0)
  );
  addBodyHitbox("upperArmL", new THREE.BoxGeometry(0.17, 1, 0.18), new THREE.Vector3(-0.39, 1.12, 0));
  addBodyHitbox("forearmL", new THREE.BoxGeometry(0.15, 1, 0.17), new THREE.Vector3(-0.39, 0.86, 0));
  addBodyHitbox("upperArmR", new THREE.BoxGeometry(0.17, 1, 0.18), new THREE.Vector3(0.39, 1.12, 0));
  addBodyHitbox("forearmR", new THREE.BoxGeometry(0.15, 1, 0.17), new THREE.Vector3(0.39, 0.86, 0));
  addBodyHitbox("thighL", new THREE.BoxGeometry(0.22, 1, 0.23), new THREE.Vector3(-0.15, 0.52, 0));
  addBodyHitbox("calfL", new THREE.BoxGeometry(0.18, 1, 0.2), new THREE.Vector3(-0.15, 0.2, 0));
  addBodyHitbox("footL", new THREE.BoxGeometry(0.2, 1, 0.32), new THREE.Vector3(-0.15, 0.08, -0.08));
  addBodyHitbox("thighR", new THREE.BoxGeometry(0.22, 1, 0.23), new THREE.Vector3(0.15, 0.52, 0));
  addBodyHitbox("calfR", new THREE.BoxGeometry(0.18, 1, 0.2), new THREE.Vector3(0.15, 0.2, 0));
  addBodyHitbox("footR", new THREE.BoxGeometry(0.2, 1, 0.32), new THREE.Vector3(0.15, 0.08, -0.08));
  const headHitbox = addBodyHitbox(
    "head",
    new THREE.SphereGeometry(0.22, 14, 12),
    new THREE.Vector3(0, 1.76, 0),
    true
  );

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

  const remoteWeaponId = weaponIdForPlayerState(p);
  const gun = buildWeaponModel(remoteWeaponId || "knife", teamColor);
  gun.userData.weaponId = remoteWeaponId;
  gun.visible = Boolean(remoteWeaponId);
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
  tagSprite.position.y = 1.95;
  root.add(tagSprite);

  scene.add(root);
  const avatar = {
    root, leftArm, rightArm, leftLeg, rightLeg, gun, teamMarker, tagSprite,
    bodyHitbox, lowerHitbox, hitboxRig, hitboxParts,
    hittable: bodyHitboxes,
    fallbackMeshes: [torso, head, leftArm, rightArm, leftLeg, rightLeg],
    headMesh: headHitbox,
    walkPhase: Math.random() * 10,
    username: p.username, classId: p.classId, secondaryId: p.secondaryId || "pistol_common",
    inventory: p.inventory || { primary: Boolean(remoteWeaponId && p.slot !== "secondary"), secondary: Boolean(remoteWeaponId && p.slot === "secondary") },
    kills: p.kills || 0, deaths: p.deaths || 0, team: p.team,
    alive: p.alive !== false,
    moving: Boolean(p.moving), sprinting: Boolean(p.sprinting), jumping: Boolean(p.jumping), crouching: Boolean(p.crouching), prone: Boolean(p.prone),
    aiming: Boolean(p.aiming), slot: normalizeSlot(p.slot), weaponId: remoteWeaponId,
    moveForward: Number(p.moveForward) || 0, moveStrafe: Number(p.moveStrafe) || 0,
    model: null, mixer: null, actions: null, animationName: null, desiredAnimation: "idle",
    characterId: characterIdForPlayer(p), emoteUntil: 0, emoteSpeed: 1, emoteAnimation: "dance",
    inVehicle: Boolean(p.vehicleId), vehicleAnimation: "drive",
    targetPosition: new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
    targetYaw: Number.isFinite(Number(p.yaw)) ? Number(p.yaw) : 0,
    hasNetworkTarget: false
  };
  avatar.setAnimation = (name, immediate = false, speed = null) => {
    avatar.desiredAnimation = name;
    setCharacterAnimation(avatar, name, immediate, speed);
  };
  avatar.fallbackMeshes.forEach((mesh) => { mesh.visible = false; });
  attachAnimatedCharacter(avatar).catch((error) => console.warn("Nao foi possivel carregar o personagem 3D:", error));
  return avatar;
}

function createLocalViewAvatar(player) {
  if (localViewAvatar) {
    localViewAvatar.mixer?.stopAllAction();
    scene.remove(localViewAvatar.root);
  }
  localViewAvatar = buildAvatar({
    ...player,
    socketId: selfId || player.socketId || "local",
    username: "Voce",
    alive: true
  });
  localViewAvatar.root.visible = false;
  localViewAvatar.root.traverse((child) => {
    if (child.isSprite) child.visible = false;
  });
}

function updateLocalViewAvatar(delta) {
  if (!localViewAvatar || !local.alive || local.vehicleId) {
    if (localViewAvatar) localViewAvatar.root.visible = false;
    return;
  }
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
  localViewAvatar.root.visible = cameraMode === "third";
  localViewTargetPosition.set(camera.position.x, local.jumpOffset, camera.position.z);
  if (!localViewAvatar.visualReady || localViewAvatar.root.position.distanceTo(localViewTargetPosition) > 3) {
    localViewAvatar.root.position.copy(localViewTargetPosition);
    localViewAvatar.visualYaw = yaw;
    localViewAvatar.visualReady = true;
  } else {
    localViewAvatar.root.position.lerp(localViewTargetPosition, Math.min(1, delta * 18));
    localViewAvatar.visualYaw = lerpAngle(localViewAvatar.visualYaw ?? yaw, yaw, Math.min(1, delta * 12));
  }
  const feelSpeed = Math.max(1, WALK_SPEED * (room?.settings?.mapId === "sketchbook" ? 0.74 : 1) * (room?.settings?.moveSpeedMul || 1));
  const targetLean = THREE.MathUtils.clamp(-localMoveVelocity.x / feelSpeed * 0.18, -0.18, 0.18);
  const lean = THREE.MathUtils.lerp(localViewAvatar.root.rotation.z, targetLean, Math.min(1, delta * 9));
  localViewAvatar.root.rotation.set(0, localViewAvatar.visualYaw, lean);
  localViewAvatar.alive = local.alive;
  localViewAvatar.moving = local.moving;
  localViewAvatar.sprinting = local.sprinting;
  localViewAvatar.jumping = local.jumping;
  localViewAvatar.crouching = local.crouching;
  localViewAvatar.prone = local.prone;
  localViewAvatar.aiming = local.aiming;
  localViewAvatar.weaponId = currentWeapon()?.id || null;
  updateAvatarGun(localViewAvatar, localViewAvatar.weaponId);
  localViewAvatar.moveForward = local.moveForward;
  localViewAvatar.moveStrafe = local.moveStrafe;
  localViewAvatar.inVehicle = false;
  localViewAvatar.emoteUntil = local.emoteActive ? local.emoteUntil : 0;
  localViewAvatar.emoteSpeed = local.emoteSpeed || 1;
  localViewAvatar.emoteAnimation = local.emoteAnimation || "dance";
  if (localViewAvatar.mixer) {
    const animation = animationForAvatar(localViewAvatar);
    localViewAvatar.setAnimation(animation, false, animation.startsWith("dance") ? localViewAvatar.emoteSpeed : null);
    setCharacterAiming(localViewAvatar, localViewAvatar.weaponId, localViewAvatar.aiming && Boolean(localViewAvatar.weaponId));
    localViewAvatar.mixer.update(delta);
    updateCharacterPose(localViewAvatar, delta);
  }
}

function spawnOrUpdateRemote(p) {
  let avatar = remotePlayers.get(p.socketId);
  if (!avatar) {
    avatar = buildAvatar(p);
    remotePlayers.set(p.socketId, avatar);
  }
  avatar.targetPosition = avatar.targetPosition || new THREE.Vector3();
  avatar.targetPosition.set(p.x, p.y, p.z);
  avatar.targetYaw = Number.isFinite(Number(p.yaw)) ? Number(p.yaw) : avatar.root.rotation.y;
  if (!avatar.hasNetworkTarget) {
    avatar.root.position.copy(avatar.targetPosition);
    avatar.root.rotation.y = avatar.targetYaw;
    avatar.hasNetworkTarget = true;
  }
  avatar.root.rotation.z = 0;
  avatar.root.visible = p.alive;
  avatar.alive = p.alive !== false;
  avatar.moving = Boolean(p.moving);
  avatar.sprinting = Boolean(p.sprinting);
  avatar.jumping = Boolean(p.jumping);
  avatar.crouching = Boolean(p.crouching);
  avatar.prone = Boolean(p.prone);
  avatar.classId = p.classId || avatar.classId;
  avatar.secondaryId = p.secondaryId || avatar.secondaryId;
  avatar.inventory = p.inventory || avatar.inventory || {};
  avatar.aiming = Boolean(p.aiming);
  avatar.slot = normalizeSlot(p.slot);
  avatar.weaponId = weaponIdForPlayerState(avatar, avatar.slot);
  updateAvatarGun(avatar, avatar.weaponId);
  avatar.moveForward = Number(p.moveForward) || 0;
  avatar.moveStrafe = Number(p.moveStrafe) || 0;
  avatar.kills = p.kills || 0;
  avatar.deaths = p.deaths || 0;
  avatar.score = p.score || avatar.kills || 0;
  avatar.inVehicle = Boolean(p.vehicleId);
}
function removeAvatar(socketId) {
  const avatar = remotePlayers.get(socketId);
  if (!avatar) return;
  avatar.mixer?.stopAllAction();
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
      model.rotation.order = "YXZ";
      scene.add(model);
      entry = {
        model,
        state: { ...state },
        target: { ...state },
        lastTargetAt: performance.now(),
        destroyedStyled: false
      };
      vehicles.set(state.id, entry);
    }
    entry.lastTargetAt = performance.now();
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
    entry.model.traverse((child) => { if (child.isMesh && child.visible !== false) meshes.push(child); });
  });
  return meshes;
}

function nearestVehicle() {
  let nearest = null;
  let nearestDistance = 4.2;
  vehicles.forEach((entry) => {
    if (entry.target.destroyed || entry.target.driverId) return;
    const distance = Math.hypot(camera.position.x - entry.target.x, camera.position.z - entry.target.z);
    const vehicleY = entry.model?.position.y ?? entry.target.y;
    if (distance < nearestDistance && Math.abs(camera.position.y - vehicleY) < 6) {
      nearest = entry.target;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function labelForLootPrompt(loot) {
  if (!loot) return "";
  if (loot.kind === "weapon") {
    if (loot.slot === "secondary") return SECONDARY_WEAPONS[loot.weaponId]?.name || "arma";
    const primary = Object.values(CLASSES).find((classInfo) => classInfo.primary.id === loot.weaponId)?.primary;
    return primary?.name || "arma";
  }
  if (loot.kind === "ammo") return "municao";
  if (loot.kind === "fuel") return "gasolina";
  if (loot.kind === "medkit") return "kit medico";
  if (loot.kind === "grenade") return GRENADES[loot.grenadeId]?.name || "granada";
  return "item";
}

function updateInteractionHint() {
  if (!dom.interactionHint) return;
  if (!room || room.status !== "playing" || !local.alive || !controls?.isLocked) {
    dom.interactionHint.hidden = true;
    return;
  }
  if (local.vehicleId) {
    dom.interactionHint.textContent = "E - Sair do veiculo";
    dom.interactionHint.hidden = false;
    return;
  }
  const loot = nearestSurvivalLoot(camera.position);
  if (loot) {
    dom.interactionHint.textContent = `E - Coletar ${labelForLootPrompt(loot)}`;
    dom.interactionHint.hidden = false;
    return;
  }
  const vehicle = nearestVehicle();
  if (vehicle) {
    const fuel = Math.max(0, Math.round(local.inventory.fuel || 0));
    dom.interactionHint.textContent = fuel > 0 ? `E - Entrar no veiculo (${fuel} gasolina)` : "E - Entrar no veiculo (sem gasolina)";
    dom.interactionHint.hidden = false;
    return;
  }
  dom.interactionHint.hidden = true;
}

function isAirVehicleType(type) {
  return type === "plane" || type === "helicopter";
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
  const health = Math.max(0, Math.round(Number(entry.target.health) || 0));
  const maxHealth = Math.max(1, Math.round(Number(entry.target.maxHealth) || 1200));
  dom.vehicleHealthFill.style.width = `${Math.max(0, health / maxHealth * 100)}%`;
  if (dom.vehicleHealthText) dom.vehicleHealthText.textContent = `${health} / ${maxHealth}`;
  if (dom.vehicleAbility) {
    const isBomber = entry.target.type === "plane";
    dom.vehicleAbility.hidden = !isBomber;
    if (isBomber) {
      const readyAt = Math.max(local.vehicleBombReadyAt || 0, Number(entry.target.bombReadyAt) || 0);
      const remaining = Math.max(0, readyAt - Date.now());
      dom.vehicleAbility.textContent = remaining > 0
        ? `F - Bombardeio ${Math.ceil(remaining / 1000)}s`
        : "F - Bombardeio pronto";
      dom.vehicleAbility.classList.toggle("ready", remaining <= 0);
    }
  }
}

function updateVehiclePresentation(delta) {
  remotePlayers.forEach((avatar) => { avatar.inVehicle = false; });
  vehicles.forEach((entry) => {
    const dx = (entry.target.x || 0) - (entry.state.x || 0);
    const dy = (entry.target.y || 0) - (entry.state.y || 0);
    const dz = (entry.target.z || 0) - (entry.state.z || 0);
    const error = Math.hypot(dx, dz);
    const drivenByLocal = entry.target.driverId === selfId;
    const smoothing = drivenByLocal ? 24 : 16;
    const t = Math.min(1, delta * (error > 6 || Math.abs(dy) > 3 ? smoothing * 2.4 : smoothing));
    if (error > 14 || Math.abs(dy) > 8) {
      entry.state.x = entry.target.x;
      entry.state.y = entry.target.y;
      entry.state.z = entry.target.z;
    }
    entry.state.x = THREE.MathUtils.lerp(entry.state.x, entry.target.x, t);
    entry.state.y = THREE.MathUtils.lerp(entry.state.y, entry.target.y, t);
    entry.state.z = THREE.MathUtils.lerp(entry.state.z, entry.target.z, t);
    let yawDelta = entry.target.yaw - entry.state.yaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    entry.state.yaw += yawDelta * t;
    entry.state.pitch = THREE.MathUtils.lerp(entry.state.pitch || 0, entry.target.pitch || 0, t);
    entry.state.roll = THREE.MathUtils.lerp(entry.state.roll || 0, entry.target.roll || 0, t);
    entry.state.enginePower = THREE.MathUtils.lerp(entry.state.enginePower || 0, entry.target.enginePower || 0, t);
    entry.state.speed = THREE.MathUtils.lerp(entry.state.speed || 0, entry.target.speed || 0, t);
    const airVehicle = isAirVehicleType(entry.target.type);
    const groundY = airVehicle ? null : terrainSurfaceHeightAt(entry.state.x, entry.state.z, entry.state.y);
    const presentationY = groundY == null ? entry.state.y : Math.max(entry.state.y, groundY + 0.04);
    entry.model.position.set(entry.state.x, presentationY, entry.state.z);
    entry.model.rotation.set(entry.state.pitch || 0, entry.state.yaw, entry.state.roll || 0);
    entry.model.userData.wheels?.forEach((wheel) => {
      wheel.rotation.x += (entry.state.speed || 0) * delta * 2.4;
    });
    if (entry.model.userData.propeller) {
      entry.model.userData.propeller.rotation.z += (10 + (entry.state.enginePower || 0) * 58) * delta;
    }

    const driverAvatar = remotePlayers.get(entry.target.driverId);
    if (driverAvatar?.alive && !entry.target.destroyed) {
      const seatOffsets = {
        car: new THREE.Vector3(0, 0.58, 0.05),
        motorcycle: new THREE.Vector3(0, 0.62, -0.05),
        quad: new THREE.Vector3(0, 0.66, 0),
        jetski: new THREE.Vector3(0, 0.68, 0.05),
        plane: new THREE.Vector3(0, 0.92, 0.1),
        helicopter: new THREE.Vector3(0, 0.9, 0.05),
        cannon: new THREE.Vector3(0, 0.72, 0.25)
      };
      const seat = (seatOffsets[entry.target.type] || seatOffsets.car)
        .clone().applyEuler(entry.model.rotation);
      driverAvatar.root.position.copy(entry.model.position).add(seat);
      driverAvatar.root.rotation.y = entry.state.yaw;
      driverAvatar.root.rotation.z = (entry.state.roll || 0) * 0.35;
      driverAvatar.root.visible = true;
      driverAvatar.inVehicle = true;
      driverAvatar.vehicleAnimation = vehicleAnimationForType(entry.target.type);
      driverAvatar.moving = false;
      driverAvatar.jumping = false;
      driverAvatar.emoteUntil = 0;
      driverAvatar.setAnimation(driverAvatar.vehicleAnimation);
    }

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
    weaponRig.visible = Boolean(currentWeaponMesh);
    return;
  }
  dom.pauseHint.hidden = true;
  const airVehicle = isAirVehicleType(driven.target.type);
  const cameraOffset = driven.model.userData.cameraOffset || new THREE.Vector3(0, airVehicle ? 4.6 : 3, airVehicle ? 12 : 7);
  const lookHeight = driven.model.userData.lookHeight || 1.1;
  const viewPitch = THREE.MathUtils.clamp(local.vehicleLookPitch + (airVehicle ? (driven.state.pitch || 0) * 0.22 : 0), -0.85, 0.72);
  const viewYaw = driven.state.yaw + local.vehicleLookYaw;
  vehicleCameraDirection.set(0, 0, -1).applyEuler(new THREE.Euler(viewPitch, viewYaw, 0, "YXZ")).normalize();
  vehicleCameraLift.set(0, lookHeight, 0);
  vehicleCameraAnchor.copy(driven.model.position).add(vehicleCameraLift);
  vehicleCameraDesired.copy(vehicleCameraAnchor)
    .addScaledVector(vehicleCameraDirection, -cameraOffset.z)
    .add(vehicleCameraLift.set(0, Math.max(0.45, cameraOffset.y - lookHeight), 0));

  vehicleCameraPath.copy(vehicleCameraDesired).sub(vehicleCameraAnchor);
  const cameraDistance = vehicleCameraPath.length();
  if (cameraDistance > 0.01) {
    vehicleCameraPath.normalize();
    raycaster.set(vehicleCameraAnchor, vehicleCameraPath);
    raycaster.far = cameraDistance;
    const obstruction = raycaster.intersectObjects(solidMeshesForRaycast, false)
      .find((item) => item.object.visible !== false && item.distance > 0.7);
    if (obstruction) {
      vehicleCameraDesired.copy(vehicleCameraAnchor)
        .addScaledVector(vehicleCameraPath, Math.max(1.2, obstruction.distance - 0.5));
    }
  }

  camera.position.lerp(vehicleCameraDesired, Math.min(1, delta * (airVehicle ? 7.5 : 11)));
  vehicleCameraLookAt.copy(vehicleCameraAnchor).addScaledVector(vehicleCameraDirection, airVehicle ? 34 : 18);
  camera.lookAt(vehicleCameraLookAt);
  local.x = driven.state.x;
  local.y = driven.model.position.y;
  local.z = driven.state.z;
  local.jumpOffset = driven.model.position.y;
  weaponRig.visible = false;
  updateVehicleHud();
}

/* ── HUD ────────────────────────────────────────────────────────────── */
function currentWeapon(slot = local.slot) {
  const normalized = normalizeSlot(slot);
  if (normalized === "secondary") return local.inventory.secondary ? SECONDARY_WEAPONS[local.secondaryId] || null : null;
  if (normalized === "primary") return local.inventory.primary ? CLASSES[local.classId]?.primary || null : null;
  return null;
}

function slotHasWeapon(slot) {
  return Boolean(currentWeapon(slot));
}

function chooseEquippedSlot(preferred = local.slot) {
  const normalized = normalizeSlot(preferred);
  if (slotHasWeapon(normalized)) return normalized;
  if (slotHasWeapon("primary")) return "primary";
  if (room?.settings?.secondaryEnabled !== false && slotHasWeapon("secondary")) return "secondary";
  return EMPTY_SLOT;
}

function refreshEquippedWeapon(preferred = local.slot) {
  local.slot = chooseEquippedSlot(preferred);
  const weapon = currentWeapon();
  if (!weapon) {
    setAiming(false);
    cancelCharge();
    setViewWeapon(null, null);
  } else {
    setViewWeapon(local.slot === "primary" ? "#4c5a3a" : "#555a63", weapon.id);
  }
  updateAmmoHud();
  updateGrenadeHud();
}

function syncLocalAvatarLoadout() {
  if (!localViewAvatar) return;
  localViewAvatar.classId = local.classId;
  localViewAvatar.secondaryId = local.secondaryId;
  localViewAvatar.inventory = { ...local.inventory };
  localViewAvatar.slot = local.slot;
  localViewAvatar.weaponId = weaponIdForPlayerState(localViewAvatar, local.slot);
  updateAvatarGun(localViewAvatar, localViewAvatar.weaponId);
}

function emptyGrenadeCharges() {
  return Object.fromEntries(GRENADE_ORDER.map((id) => [id, 0]));
}

function applyInventorySnapshot(snapshot = {}) {
  local.inventory = {
    primary: Boolean(snapshot.inventory?.primary),
    secondary: Boolean(snapshot.inventory?.secondary),
    grenades: { ...(snapshot.inventory?.grenades || {}) },
    fuel: Number(snapshot.inventory?.fuel) || 0,
    medkits: Number(snapshot.inventory?.medkits) || 0
  };
  local.ammo.primary = Math.max(0, Number(snapshot.ammo?.primary) || 0);
  local.ammo.secondary = Math.max(0, Number(snapshot.ammo?.secondary) || 0);
  local.grenadeCharges = {
    ...emptyGrenadeCharges(),
    ...(snapshot.grenadeCharges || snapshot.inventory?.grenades || {})
  };
  if (snapshot.classId) local.classId = snapshot.classId;
  if (snapshot.secondaryId) local.secondaryId = snapshot.secondaryId;
  local.slot = normalizeSlot(snapshot.slot);
  refreshEquippedWeapon(local.slot);
  syncLocalAvatarLoadout();
  updateSurvivalHud();
}
function updateHealthHud() {
  dom.healthFill.style.width = `${Math.max(0, local.health)}%`;
  dom.healthText.textContent = Math.max(0, Math.round(local.health));
}
function updateAmmoHud() {
  const w = currentWeapon();
  if (!w) {
    dom.ammoCount.textContent = "0 / 0";
    dom.weaponName.textContent = "Maos vazias";
    return;
  }
  dom.ammoCount.textContent = w.kind === "melee" ? "-" : `${local.ammo[local.slot]} / ${w.magSize}`;
  dom.weaponName.textContent = `${local.slot === "primary" ? "Primaria" : "Secundaria"} - ${w.name}`;
}
function updateGrenadeHud() {
  const g = GRENADES[local.grenadeSelected];
  dom.grenadeCount.textContent = local.grenadeCharges[local.grenadeSelected] ?? 0;
  dom.grenadeName.textContent = g.name;
}
function updateSurvivalHud() {
  if (dom.medkitCount) dom.medkitCount.textContent = `Kit ${Math.max(0, Math.round(local.inventory.medkits || 0))}`;
  if (dom.fuelCount) dom.fuelCount.textContent = `Gasolina ${Math.max(0, Math.round(local.inventory.fuel || 0))}`;
  if (dom.survivalWave) dom.survivalWave.textContent = `Onda ${Math.max(1, Math.round(survivalStatus.wave || room?.survivalWave || 1))}`;
  if (dom.zombieCount) {
    const active = Number.isFinite(Number(survivalStatus.activeZombies))
      ? Number(survivalStatus.activeZombies)
      : (room?.zombies || []).filter((zombie) => zombie.alive !== false).length;
    dom.zombieCount.textContent = `Zumbis ${Math.max(0, Math.round(active))}`;
  }
}
function updateAbilityHud() {
  const ability = CLASSES[local.classId].ability;
  const now = performance.now();
  const remain = Math.max(0, local.abilityCooldownUntil - now);
  const pct = ability.cooldownMs ? 100 - Math.min(100, (remain / ability.cooldownMs) * 100) : 100;
  dom.abilityFill.style.width = `${pct}%`;
  dom.abilityName.textContent = remain > 0 ? `Q - ${ability.name} ${Math.ceil(remain / 1000)}s` : `Q - ${ability.name}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
function updateScoreboard() {
  const rows = [{
    id: selfId, name: "Voce", kills: local.kills || 0, deaths: local.deaths || 0,
    score: local.score || 0, self: true, team: local.team
  }];
  remotePlayers.forEach((a, id) => rows.push({
    id, name: a.username, kills: a.kills || 0, deaths: a.deaths || 0,
    score: a.score || a.kills || 0, self: false, team: a.team
  }));
  rows.sort((a, b) => b.score - a.score);
  dom.scoreboardList.innerHTML = rows.slice(0, 10).map((r) =>
    `<div class="scoreboard-row${r.self ? " self" : ""}" style="${r.team ? `border-left:3px solid ${r.team === "red" ? "#e05555" : "#4d8fe0"}` : ""}"><span class="scoreboard-name">${escapeHtml(r.self ? "Voce" : r.name)}</span><span class="scoreboard-stats">${r.score} pts <small>${r.kills}K/${r.deaths}D</small></span></div>`
  ).join("");
}
function pushKillFeed(text) {
  const row = document.createElement("div");
  row.className = "killfeed-row";
  row.textContent = text;
  dom.killFeed.appendChild(row);
  setTimeout(() => row.remove(), 4200);
}

function showHitMarker({ headshot = false, kill = false } = {}) {
  if (!dom.hitMarker) return;
  clearTimeout(hitMarkerTimer);
  dom.hitMarker.classList.remove("active", "headshot", "kill");
  void dom.hitMarker.offsetWidth;
  if (headshot) dom.hitMarker.classList.add("headshot");
  if (kill) dom.hitMarker.classList.add("kill");
  dom.hitMarker.classList.add("active");
  hitMarkerTimer = setTimeout(() => {
    dom.hitMarker.classList.remove("active", "headshot", "kill");
  }, kill ? 260 : 150);
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

function setupDanceHub() {
  if (!dom.danceHub || !dom.danceGrid) return;
  dom.danceGrid.innerHTML = Object.entries(DANCE_OPTIONS).map(([id, option]) => (
    `<button class="dance-option" type="button" data-dance="${id}">
      <strong>${option.label}</strong>
      <span>${option.speed > 1 ? "Rapida" : option.speed < 1 ? "Lenta" : "Padrao"}</span>
    </button>`
  )).join("");
  dom.danceGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dance]");
    if (!button) return;
    event.preventDefault();
    selectDance(button.dataset.dance);
  });
  dom.closeDanceHub?.addEventListener("click", () => closeDanceHub({ relock: true }));
  dom.danceHub.addEventListener("click", (event) => {
    if (event.target === dom.danceHub) closeDanceHub({ relock: true });
  });
}

function openDanceHub() {
  if (!local.alive || local.vehicleId || local.prone || room?.status !== "playing") return;
  danceHubOpen = true;
  cancelCharge();
  setAiming(false);
  controls.unlock();
  dom.pauseHint.hidden = true;
  dom.danceHub.hidden = false;
}

function closeDanceHub({ relock = false } = {}) {
  if (!dom.danceHub) return;
  danceHubOpen = false;
  dom.danceHub.hidden = true;
  if (local.alive && room?.status === "playing") {
    dom.pauseHint.hidden = false;
    if (relock) controls.lock();
  }
}

function selectDance(emote) {
  if (!DANCE_OPTIONS[emote] || !socket || !local.alive || local.vehicleId || local.prone) return;
  socket.emit("match:emote", { emote });
  closeDanceHub({ relock: true });
}

function stopLocalEmote() {
  if (!local.emoteActive || !socket) return;
  local.emoteActive = false;
  local.emoteUntil = 0;
  local.emoteSpeed = 1;
  local.emoteAnimation = "dance";
  socket.emit("match:emote-stop");
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

const BULLET_SPEEDS = {
  sniper_rifle: 180,
  assault_rifle: 125,
  heavy_mg: 112,
  smg: 92,
  heavy_pistol: 105,
  revolver: 98,
  pistol_common: 88,
  auto_pistol_weak: 84,
  mini_shotgun: 74
};
const BULLET_GRAVITY = -9.8;

function weaponById(weaponId) {
  for (const classInfo of Object.values(CLASSES)) {
    if (classInfo.primary.id === weaponId) return classInfo.primary;
  }
  return Object.values(SECONDARY_WEAPONS).find((weapon) => weapon.id === weaponId) || null;
}

function ballisticForWeapon(weapon, charge = 1) {
  if (weapon.kind === "projectile") {
    return {
      speed: weapon.projectileSpeed * (weapon.chargeable ? 0.45 + charge * 0.55 : 1),
      gravity: weapon.id === "bow" ? -11.5 : -9.8,
      kind: "arrow"
    };
  }
  return { speed: BULLET_SPEEDS[weapon.id] || 95, gravity: BULLET_GRAVITY, kind: "bullet" };
}

function muzzleWorldPosition() {
  scene.updateMatrixWorld(true);
  if (!currentWeaponMesh || !currentWeaponMesh.visible) return camera.getWorldPosition(new THREE.Vector3());
  const muzzle = (currentWeaponMesh.userData.muzzlePosition || new THREE.Vector3(0, 0, -0.8)).clone();
  return currentWeaponMesh.localToWorld(muzzle);
}

function traceBallistic(origin, direction, speed, gravity, range, targets = []) {
  const points = [origin.clone()];
  const velocity = direction.clone().normalize().multiplyScalar(speed);
  let position = origin.clone();
  let traveled = 0;
  let elapsed = 0;
  const step = Math.min(1 / 30, 2.2 / speed);
  const maxTime = Math.max(0.08, range / speed * 1.45);

  while (traveled < range && elapsed < maxTime) {
    const next = position.clone().addScaledVector(velocity, step);
    velocity.y += gravity * step;
    const segment = next.clone().sub(position);
    const segmentLength = segment.length();
    raycaster.set(position, segment.normalize());
    raycaster.far = Math.min(segmentLength, range - traveled);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      points.push(hits[0].point.clone());
      return { points, hit: hits[0], distance: traveled + hits[0].distance };
    }
    position = next;
    traveled += segmentLength;
    elapsed += step;
    points.push(position.clone());
  }
  return { points, hit: null, distance: traveled };
}

const MAX_ACTIVE_BALLISTICS = 90;
function spawnBallisticVisual(trace, speed, kind = "bullet", audibleImpact = false) {
  if (!trace?.points?.length || trace.points.length < 2) return;
  // Teto de tracejados simultaneos: sob fogo intenso o array crescia demais e
  // enchia a cena de malhas. Ao estourar o teto, descarta o mais antigo.
  if (activeBallistics.length >= MAX_ACTIVE_BALLISTICS) {
    const oldest = activeBallistics.shift();
    if (oldest) {
      scene.remove(oldest.mesh, oldest.trail);
      oldest.mesh.geometry.dispose();
      oldest.mesh.material.dispose();
      oldest.trail.geometry.dispose();
      oldest.trail.material.dispose();
    }
  }
  const isArrow = kind === "arrow";
  const mesh = new THREE.Mesh(
    isArrow ? new THREE.BoxGeometry(0.035, 0.035, 0.52) : new THREE.SphereGeometry(0.045, 6, 6),
    isArrow
      ? new THREE.MeshStandardMaterial({ color: 0x765033, roughness: 0.72 })
      : new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  mesh.position.copy(trace.points[0]);
  const trailGeometry = new THREE.BufferGeometry().setFromPoints([trace.points[0], trace.points[0]]);
  const trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({
    color: isArrow ? 0xc9aa79 : 0xffcf67, transparent: true, opacity: isArrow ? 0.42 : 0.82
  }));
  scene.add(mesh, trail);
  activeBallistics.push({
    mesh, trail, points: trace.points, speed, segment: 0, segmentOffset: 0,
    previous: trace.points[0].clone(), impact: trace.hit?.point?.clone() || null,
    audibleImpact, kind
  });
}

function updateBallistics(delta) {
  for (let i = activeBallistics.length - 1; i >= 0; i--) {
    const shot = activeBallistics[i];
    let movement = shot.speed * delta;
    shot.previous.copy(shot.mesh.position);
    while (movement > 0 && shot.segment < shot.points.length - 1) {
      const start = shot.points[shot.segment];
      const end = shot.points[shot.segment + 1];
      const length = start.distanceTo(end);
      const remaining = length - shot.segmentOffset;
      if (movement < remaining) {
        shot.segmentOffset += movement;
        shot.mesh.position.lerpVectors(start, end, shot.segmentOffset / Math.max(0.001, length));
        movement = 0;
      } else {
        movement -= remaining;
        shot.segment += 1;
        shot.segmentOffset = 0;
        shot.mesh.position.copy(end);
      }
    }
    const nextPoint = shot.points[Math.min(shot.segment + 1, shot.points.length - 1)];
    if (nextPoint) shot.mesh.lookAt(nextPoint);
    const tail = shot.trail.geometry.attributes.position;
    tail.setXYZ(0, shot.previous.x, shot.previous.y, shot.previous.z);
    tail.setXYZ(1, shot.mesh.position.x, shot.mesh.position.y, shot.mesh.position.z);
    tail.needsUpdate = true;

    if (shot.segment >= shot.points.length - 1) {
      scene.remove(shot.mesh, shot.trail);
      shot.mesh.geometry.dispose();
      shot.mesh.material.dispose();
      shot.trail.geometry.dispose();
      shot.trail.material.dispose();
      activeBallistics.splice(i, 1);
      if (shot.impact) {
        mapWorld?.showImpact?.(shot.impact, shot.kind === "arrow" ? 0.55 : 1);
        emitImpactFx(scene, shot.impact, shot.kind === "arrow" ? 0.55 : 1);
        if (shot.audibleImpact) playImpactSound(shot.impact, shot.kind !== "arrow");
      }
    }
  }
}

function fireHitscan(weapon, slot) {
  scene.updateMatrixWorld(true);
  const hittable = gatherHittable();
  const vehicleHittable = gatherVehicleHittable();
  const zombieHittable = gatherSurvivalZombieHittable();
  const pelletHits = new Map();
  const vehicleHits = new Map();
  const zombieHits = new Map();
  const worldHits = new Map();
  let headshotFor = null;
  const pelletCount = weapon.pellets || 1;
  const spread = weapon.spread * (local.aiming ? 0.35 : 1);
  const origin = muzzleWorldPosition();
  const ballistic = ballisticForWeapon(weapon);
  let broadcastDirection = null;
  for (let i = 0; i < pelletCount; i++) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();
    if (!broadcastDirection) broadcastDirection = dir.clone();
    const targets = [...hittable, ...vehicleHittable, ...zombieHittable, ...solidMeshesForRaycast];
    const trace = traceBallistic(origin, dir, ballistic.speed, ballistic.gravity, weapon.range, targets);
    if (weapon.kind !== "melee" && i < Math.min(3, pelletCount)) {
      spawnBallisticVisual(trace, ballistic.speed, ballistic.kind, i === 0);
    }
    if (!trace.hit) continue;
    const hit = trace.hit;
    const socketId = hit.object.userData.socketId;
    const vehicleId = hit.object.userData.vehicleId;
    const zombieId = hit.object.userData.zombieId;
    const destructibleId = hit.object.userData.destructibleId;
    if (socketId) {
      pelletHits.set(socketId, (pelletHits.get(socketId) || 0) + 1);
      if (hit.object.userData.isHead) headshotFor = socketId;
    } else if (vehicleId) {
      vehicleHits.set(vehicleId, (vehicleHits.get(vehicleId) || 0) + 1);
    } else if (zombieId) {
      zombieHits.set(zombieId, (zombieHits.get(zombieId) || 0) + 1);
    } else if (destructibleId) {
      worldHits.set(destructibleId, { count: (worldHits.get(destructibleId)?.count || 0) + 1, point: hit.point });
    }
  }
  let targetSocketId = null, bestHits = 0;
  pelletHits.forEach((count, id) => { if (count > bestHits) { bestHits = count; targetSocketId = id; } });
  socket.emit("match:shoot", {
    slot, targetSocketId, pelletHits: bestHits || 1,
    hitZone: targetSocketId && headshotFor === targetSocketId ? "head" : "body",
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: { x: broadcastDirection?.x || 0, y: broadcastDirection?.y || 0, z: broadcastDirection?.z || -1 },
    ballistics: { speed: ballistic.speed, gravity: ballistic.gravity, range: weapon.range }
  });
  vehicleHits.forEach((count, vehicleId) => {
    socket.emit("vehicle:hit", { vehicleId, slot, pelletHits: count });
  });
  zombieHits.forEach((count, zombieId) => {
    socket.emit("survival:zombie-hit", { zombieId, slot, pelletHits: count });
  });
  worldHits.forEach(({ count, point }, id) => {
    socket.emit("world:hit", { id, damage: weapon.damage * count, x: point.x, z: point.z });
  });
}

function fireProjectile(weapon, slot, charge = 1) {
  scene.updateMatrixWorld(true);
  const hittable = gatherHittable();
  const vehicleHittable = gatherVehicleHittable();
  const zombieHittable = gatherSurvivalZombieHittable();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const spread = weapon.spread * (local.aiming ? 0.35 : 1);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.normalize();
  const origin = muzzleWorldPosition();
  const ballistic = ballisticForWeapon(weapon, charge);
  const trace = traceBallistic(origin, dir, ballistic.speed, ballistic.gravity, weapon.range, [
    ...hittable, ...vehicleHittable, ...zombieHittable, ...solidMeshesForRaycast
  ]);
  const hit = trace.hit;
  const socketId = hit?.object.userData.socketId || null;
  const isHead = Boolean(hit?.object.userData.isHead);
  const vehicleId = hit?.object.userData.vehicleId || null;
  const zombieId = hit?.object.userData.zombieId || null;
  const destructibleId = hit?.object.userData.destructibleId || null;
  spawnBallisticVisual(trace, ballistic.speed, ballistic.kind, true);

  socket.emit("match:shoot", {
    slot, targetSocketId: socketId, pelletHits: 1,
    hitZone: socketId && isHead ? "head" : "body",
    charge,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: { x: dir.x, y: dir.y, z: dir.z },
    ballistics: { speed: ballistic.speed, gravity: ballistic.gravity, range: weapon.range }
  });
  if (vehicleId) socket.emit("vehicle:hit", { vehicleId, slot, pelletHits: 1 });
  if (zombieId) socket.emit("survival:zombie-hit", { zombieId, slot, pelletHits: 1 });
  if (destructibleId && hit) {
    socket.emit("world:hit", { id: destructibleId, damage: weapon.damage, x: hit.point.x, z: hit.point.z });
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
  const aimOrigin = camera.getWorldPosition(new THREE.Vector3());
  const muzzleOffset = entry.model.userData.muzzleOffset || new THREE.Vector3(0, 0.8, -1.6);
  vehicleMuzzle.copy(muzzleOffset);
  entry.model.localToWorld(vehicleMuzzle);
  raycaster.set(aimOrigin, direction);
  raycaster.far = entry.target.type === "cannon" ? 140 : 120;
  const hits = raycaster.intersectObjects([...gatherHittable(), ...gatherVehicleHittable(), ...solidMeshesForRaycast], false);
  const hit = hits.find((item) => item.object.userData.socketId !== selfId && item.object.userData.vehicleId !== local.vehicleId);
  socket.emit("vehicle:fire", {
    vehicleId: local.vehicleId,
    targetSocketId: hit?.object.userData.socketId || null,
    targetVehicleId: hit?.object.userData.vehicleId || null,
    origin: { x: vehicleMuzzle.x, y: vehicleMuzzle.y, z: vehicleMuzzle.z },
    direction: { x: direction.x, y: direction.y, z: direction.z }
  });
}

function dropPlaneBomb() {
  const entry = vehicles.get(local.vehicleId);
  if (!entry || entry.target.type !== "plane") return;
  const readyAt = Math.max(local.vehicleBombReadyAt || 0, Number(entry.target.bombReadyAt) || 0);
  if (Date.now() < readyAt) return;

  const origin = entry.model.position.clone().add(new THREE.Vector3(0, -0.45, 0));
  const aimDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const groundBelow = terrainSurfaceHeightAt(origin.x, origin.z, 0);
  const fallbackFallSeconds = THREE.MathUtils.clamp(Math.sqrt(2 * Math.max(1, origin.y - groundBelow) / 16), 0.65, 2.5);
  const fallbackTravel = Math.max(12, Math.abs(entry.state.speed || 0) * fallbackFallSeconds * 0.72);
  let travel = fallbackTravel;
  if (aimDirection.y < -0.08) {
    const roughGround = terrainSurfaceHeightAt(
      origin.x + aimDirection.x * fallbackTravel,
      origin.z + aimDirection.z * fallbackTravel,
      groundBelow
    );
    travel = THREE.MathUtils.clamp((origin.y - roughGround) / Math.abs(aimDirection.y), 12, 86);
  }
  const targetX = origin.x + aimDirection.x * travel;
  const targetZ = origin.z + aimDirection.z * travel;
  const targetY = terrainSurfaceHeightAt(targetX, targetZ, groundBelow) + 0.12;
  socket.emit("vehicle:bomb", {
    vehicleId: local.vehicleId,
    target: { x: targetX, y: targetY, z: targetZ }
  });
}

function renderVehicleFire({ type, origin, direction }) {
  const start = new THREE.Vector3(Number(origin?.x) || 0, Number(origin?.y) || 0, Number(origin?.z) || 0);
  const dir = new THREE.Vector3(Number(direction?.x) || 0, Number(direction?.y) || 0, Number(direction?.z) || -1).normalize();
  if (type === "cannon") {
    playWeaponSound("sniper_rifle", start);
    createCannonProjectile(scene, start, dir, (point) => {
      createExplosion(scene, point, 0xffa13d);
      playExplosionSound(point);
    });
    return;
  }
  playWeaponSound("heavy_mg", start);
  const end = start.clone().addScaledVector(dir, 70);
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const tracer = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffe36e, transparent: true, opacity: 0.9 }));
  scene.add(tracer);
  setTimeout(() => scene.remove(tracer), 70);
}

function renderPlaneBomb({ origin, target, flightMs }) {
  const start = new THREE.Vector3(Number(origin?.x) || 0, Number(origin?.y) || 0, Number(origin?.z) || 0);
  const end = new THREE.Vector3(Number(target?.x) || 0, Number(target?.y) || 0, Number(target?.z) || 0);
  createAirBomb(scene, start, end, flightMs);
}

function renderPlaneBombExplosion({ x, y, z }) {
  const point = new THREE.Vector3(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  emitNapalmExplosionFx(scene, point, 1.75);
  mapWorld?.showExplosionImpact?.(point.x, point.z, 3.2);
  playExplosionSound(point);
}

function shoot(charge = 1) {
  if (!local.alive || !room) return;
  const slot = local.slot;
  const weapon = currentWeapon(slot);
  if (!weapon) return;
  const now = performance.now();
  if (now < local.reloadUntil[slot]) return;
  if (weapon.kind !== "melee" && now - local.lastShotAt[slot] < weapon.fireRateMs) return;
  if (weapon.kind !== "melee" && local.ammo[slot] <= 0) { reload(); return; }

  local.lastShotAt[slot] = now;
  if (weapon.kind === "hitscan") playMuzzleFlash();
  playWeaponSound(weapon.id);
  recoilKick();
  playCharacterWeaponAction(localViewAvatar, weapon.id, "shoot");

  if (weapon.kind === "projectile") fireProjectile(weapon, slot, charge);
  else fireHitscan(weapon, slot);

  if (weapon.kind !== "melee") {
    local.ammo[slot] = Math.max(0, local.ammo[slot] - 1);
    updateAmmoHud();
  }
}

function beginCharge() {
  const weapon = currentWeapon();
  if (!weapon?.chargeable || local.charging) return;
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
  if (!weapon || weapon.kind === "melee") return;
  playReloadSound();
  local.reloadUntil[local.slot] = performance.now() + weapon.reloadMs;
  socket.emit("match:reload", { slot: local.slot });
  playCharacterWeaponAction(localViewAvatar, weapon.id, "reload");
  setTimeout(() => { local.ammo[local.slot] = weapon.magSize; updateAmmoHud(); }, weapon.reloadMs);
}

function useMedkit() {
  if (!socket || local.vehicleId || !local.alive) return;
  if ((local.inventory.medkits || 0) <= 0 || local.health >= 100) return;
  socket.emit("survival:use-medkit");
}

function switchSlot(slot) {
  if (local.vehicleId && slot === "primary") return;
  if (slot === "secondary" && !room.settings.secondaryEnabled) return;
  cancelCharge();
  setAiming(false);
  if (!slotHasWeapon(slot)) {
    if (!currentWeapon()) refreshEquippedWeapon(EMPTY_SLOT);
    else updateAmmoHud();
    return;
  }
  local.slot = slot;
  const weapon = currentWeapon(slot);
  setViewWeapon(slot === "primary" ? "#4c5a3a" : "#555a63", weapon.id);
  updateAmmoHud();
}

/* ── Granadas ───────────────────────────────────────────────────────── */
function throwGrenade() {
  if (!room.settings.grenadesEnabled || !local.alive) return;
  const id = local.grenadeSelected;
  if ((local.grenadeCharges[id] || 0) <= 0 || local.grenadeThrowPending) return;
  local.grenadeThrowPending = true;
  playCharacterAction(localViewAvatar, "grenade");
  socket.emit("match:grenadePrepare", { grenadeId: id });

  setTimeout(() => {
    local.grenadeThrowPending = false;
    if (!local.alive || room?.status !== "playing" || (local.grenadeCharges[id] || 0) <= 0) return;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    socket.emit("match:grenadeThrow", {
      grenadeId: id, x: origin.x, y: origin.y, z: origin.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z
    });
    simulateGrenadeArc(id, origin, dir, true);
  }, GRENADE_RELEASE_MS);
}

function simulateGrenadeArc(id, origin, dir, isLocal, fromSocketId) {
  const grenade = GRENADES[id];
  const mesh = new THREE.Group();
  mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshStandardMaterial({ color: grenade.color })));
  mesh.position.copy(origin);
  scene.add(mesh);
  attachMeshyModel(mesh,"grenade",{targetSize:0.32,anchor:"center"});
  const velocity = dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 6, 0));
  const state = { mesh, velocity, id, isLocal, fromSocketId };
  activeGrenades.push(state);

  const fuseMs = grenade.fuseMs || 900;
  if (isLocal) {
    if (grenade.detonateOnImpact) {
      if (fuseMs > 0) setTimeout(() => detonateGrenade(state), fuseMs + 1400);
    } else {
      setTimeout(() => detonateGrenade(state), fuseMs);
    }
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
    const environmentDamage = state.id === "molotov" ? 28 : state.id === "explosive" || state.id === "impact" ? 75 : 0;
    mapWorld?.destructiblesNear(pos.x, pos.z, grenade.radius + 2).forEach((object) => {
      if (!environmentDamage) return;
      socket.emit("world:hit", {
        id: object.id,
        damage: environmentDamage,
        x: object.mesh.position.x,
        z: object.mesh.position.z
      });
    });
    if (environmentDamage) socket.emit("world:blast", { x: pos.x, z: pos.z, radius: grenade.radius + 2, damage: environmentDamage });
  }
}

function renderGrenadeExplosionVisual(grenadeId, x, z) {
  const grenade = GRENADES[grenadeId];
  if (grenadeId === "molotov") {
    emitNapalmExplosionFx(scene, new THREE.Vector3(x, 0.45, z), 0.82);
  } else if (grenadeId === "explosive" || grenadeId === "impact") {
    emitExplosionFx(
      scene,
      new THREE.Vector3(x, 0.55, z),
      grenadeId === "impact" ? 0xffb04d : 0xff6b28,
      grenadeId === "impact" ? 0.9 : 1.25
    );
  }
  const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(grenade.radius * (grenadeId === "explosive" || grenadeId === "impact" ? 0.6 : 1), 12, 12), new THREE.MeshBasicMaterial({ color: grenade.color, transparent: true, opacity: 0.65 }));
  flashMesh.position.set(x, 1, z);
  scene.add(flashMesh);
  const duration = grenadeId === "smoke" || grenadeId === "molotov" ? (grenade.durationMs || 6000) : 500;
  const start = performance.now();
  (function fade() {
    const t = (performance.now() - start) / duration;
    flashMesh.material.opacity = Math.max(0, 0.65 * (1 - t));
    flashMesh.scale.setScalar(1 + t * (grenadeId === "smoke" ? 1.5 : grenadeId === "molotov" ? 0.35 : 0.6));
    if (t < 1) requestAnimationFrame(fade);
    else scene.remove(flashMesh);
  })();
}

/* ── Habilidade ─────────────────────────────────────────────────────── */
function vectorPayload(v) {
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function aimedDirection() {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
}

function shooterAbilityOrigin(socketId) {
  if (socketId === selfId) {
    return currentWeaponMesh?.visible ? muzzleWorldPosition() : camera.getWorldPosition(new THREE.Vector3());
  }
  const avatar = remotePlayers.get(socketId);
  if (!avatar) return null;
  return avatar.root.position.clone().add(new THREE.Vector3(0, 1.35, 0));
}

function disposeAbilityObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function temporarySceneObject(object, durationMs) {
  scene.add(object);
  setTimeout(() => {
    scene.remove(object);
    disposeAbilityObject(object);
  }, Math.max(120, Number(durationMs) || 600));
  return object;
}

function pickAimPoint({ maxDistance = 72, includeSolids = true, requireGround = false } = {}) {
  scene.updateMatrixWorld(true);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = aimedDirection();
  const groundMeshes = mapWorld?.groundRaycastMeshes || [];
  const targets = [
    ...(includeSolids ? solidMeshesForRaycast : []),
    ...groundMeshes
  ];
  raycaster.set(origin, dir);
  raycaster.far = maxDistance;
  const hit = raycaster.intersectObjects(targets, false)
    .find((item) => item.object.visible !== false && item.distance > 1.05);
  if (hit) {
    const point = hit.point.clone();
    if (!requireGround && includeSolids && !groundMeshes.includes(hit.object)) {
      const box = new THREE.Box3().setFromObject(hit.object);
      if (Number.isFinite(box.max.y) && box.max.y > point.y + 1) point.y = Math.min(box.max.y - 0.25, point.y + 8);
    }
    if (requireGround) point.y = terrainSurfaceHeightAt(point.x, point.z, point.y);
    return point;
  }
  const fallback = origin.addScaledVector(dir, maxDistance * 0.58);
  fallback.y = terrainSurfaceHeightAt(fallback.x, fallback.z, local.jumpOffset);
  return fallback;
}

function pickHarpoonTarget(maxDistance = 66) {
  scene.updateMatrixWorld(true);
  const origin = camera.getWorldPosition(new THREE.Vector3());
  raycaster.set(origin, aimedDirection());
  raycaster.far = maxDistance;
  const hits = raycaster.intersectObjects(gatherHittable(), false)
    .filter((hit) => hit.object.visible !== false && hit.distance > 1);
  return hits[0]?.object.userData.socketId || null;
}

function renderGrappleAbility(socketId, target) {
  const origin = shooterAbilityOrigin(socketId);
  if (!origin || !target) return;
  const targetPoint = new THREE.Vector3(Number(target.x) || 0, Number(target.y) || 0, Number(target.z) || 0);
  const group = new THREE.Group();
  const cable = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin, targetPoint]),
    new THREE.LineBasicMaterial({ color: 0x9dd7ff, transparent: true, opacity: 0.92 })
  );
  const hook = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xdff6ff })
  );
  hook.position.copy(targetPoint);
  group.add(cable, hook);
  temporarySceneObject(group, 720);
  playImpactSound(targetPoint, false);
}

function renderArrowRainAbility(target, radius = 7.5, warningMs = 650, durationMs = 4200) {
  if (!target) return;
  const center = new THREE.Vector3(Number(target.x) || 0, Number(target.y) || 0, Number(target.z) || 0);
  center.y = terrainSurfaceHeightAt(center.x, center.z, center.y) + 0.04;
  const group = new THREE.Group();
  const warning = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.78, radius, 64),
    new THREE.MeshBasicMaterial({ color: 0xffd05c, transparent: true, opacity: 0.56, side: THREE.DoubleSide })
  );
  warning.rotation.x = -Math.PI / 2;
  warning.position.copy(center);
  group.add(warning);
  temporarySceneObject(group, durationMs + warningMs + 500);

  const start = performance.now();
  const arrows = [];
  function spawnArrow() {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    const x = center.x + Math.cos(angle) * distance;
    const z = center.z + Math.sin(angle) * distance;
    const y = terrainSurfaceHeightAt(x, z, center.y) + 8 + Math.random() * 5;
    const arrow = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, 0.86),
      new THREE.MeshStandardMaterial({ color: 0x7b5736, roughness: 0.7 })
    );
    arrow.position.set(x, y, z);
    arrow.rotation.x = Math.PI * 0.48;
    group.add(arrow);
    arrows.push({ mesh: arrow, speed: 10 + Math.random() * 4 });
  }

  (function animate() {
    const elapsed = performance.now() - start;
    const active = elapsed >= warningMs && elapsed <= warningMs + durationMs;
    warning.material.opacity = elapsed < warningMs
      ? 0.34 + Math.sin(elapsed * 0.025) * 0.18
      : Math.max(0.12, 0.42 * (1 - (elapsed - warningMs) / durationMs));
    if (active && arrows.length < 54 && Math.random() < 0.72) spawnArrow();
    for (let i = arrows.length - 1; i >= 0; i--) {
      const item = arrows[i];
      item.mesh.position.y -= item.speed * 0.016;
      const ground = terrainSurfaceHeightAt(item.mesh.position.x, item.mesh.position.z, center.y) + 0.12;
      if (item.mesh.position.y <= ground) {
        emitImpactFx(scene, item.mesh.position, 0.35);
        group.remove(item.mesh);
        disposeAbilityObject(item.mesh);
        arrows.splice(i, 1);
      }
    }
    if (elapsed < warningMs + durationMs + 450) requestAnimationFrame(animate);
  })();
}

function renderHarpoonAbility(socketId, targetSocketId, target, heavy = false) {
  const origin = shooterAbilityOrigin(socketId);
  if (!origin) return;
  const avatar = targetSocketId ? remotePlayers.get(targetSocketId) : null;
  const targetPoint = target
    ? new THREE.Vector3(Number(target.x) || 0, Number(target.y) || 0, Number(target.z) || 0)
    : avatar?.root.position.clone().add(new THREE.Vector3(0, 1.05, 0));
  if (!targetPoint) return;
  const group = new THREE.Group();
  const chain = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin, targetPoint]),
    new THREE.LineBasicMaterial({ color: heavy ? 0xffb35a : 0xd7d7d7, transparent: true, opacity: 0.95 })
  );
  const bolt = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: heavy ? 0xff824a : 0xced6dc, metalness: 0.25, roughness: 0.45 })
  );
  bolt.position.copy(targetPoint);
  bolt.lookAt(origin);
  group.add(chain, bolt);
  temporarySceneObject(group, 820);
  emitImpactFx(scene, targetPoint, heavy ? 0.65 : 0.45);
}

function useAbility() {
  const now = performance.now();
  if (now < local.abilityCooldownUntil) return;
  const ability = CLASSES[local.classId]?.ability;
  if (!ability || !socket || !local.alive || local.vehicleId) return;
  if (ability.id === "gancho_reposicionamento") {
    const target = pickAimPoint({ maxDistance: 78, includeSolids: true });
    if (!target || target.y < local.jumpOffset + 1.8) return;
    socket.emit("match:ability", { target: vectorPayload(target) });
    return;
  }
  if (ability.id === "chuva_flechas") {
    const target = pickAimPoint({ maxDistance: 92, includeSolids: true, requireGround: true });
    socket.emit("match:ability", { target: vectorPayload(target) });
    return;
  }
  if (ability.id === "arpao_corrente") {
    const targetSocketId = pickHarpoonTarget();
    if (!targetSocketId) return;
    socket.emit("match:ability", { targetSocketId });
    return;
  }
  socket.emit("match:ability");
}
/* ── Input ──────────────────────────────────────────────────────────── */
function onMouseDown(e) {
  if (!controls.isLocked) return;
  stopLocalEmote();
  if (e.button === 0) {
    const vehicle = vehicles.get(local.vehicleId);
    if (vehicle && VEHICLE_STATS[vehicle.target.type]?.builtInWeapon) {
      local.mouseDown = true;
      fireVehicleWeapon();
      return;
    }
    const weapon = currentWeapon();
    if (!weapon) return;
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

function onVehicleMouseMove(event) {
  if (!local.vehicleId || !controls?.isLocked) return;
  local.vehicleLookYaw -= (Number(event.movementX) || 0) * 0.00215;
  local.vehicleLookPitch -= (Number(event.movementY) || 0) * 0.0019;
  local.vehicleLookPitch = THREE.MathUtils.clamp(local.vehicleLookPitch, -0.82, 0.68);
  if (local.vehicleLookYaw > Math.PI) local.vehicleLookYaw -= Math.PI * 2;
  if (local.vehicleLookYaw < -Math.PI) local.vehicleLookYaw += Math.PI * 2;
}

function onKeyDown(e) {
  if (!room || !local.alive) return;
  if (e.code === "Escape" && danceHubOpen) {
    closeDanceHub({ relock: false });
    return;
  }
  if (e.code === "KeyB" && !local.vehicleId && !local.prone) {
    if (danceHubOpen) closeDanceHub({ relock: true });
    else openDanceHub();
    return;
  }
  if (e.code === "KeyE") {
    if (local.vehicleId) socket.emit("vehicle:exit");
    else {
      const loot = nearestSurvivalLoot(camera.position);
      if (loot) {
        socket.emit("survival:pickup", { lootId: loot.id });
        return;
      }
      const vehicle = nearestVehicle();
      if (vehicle) socket.emit("vehicle:enter", { vehicleId: vehicle.id });
    }
    return;
  }
  if (e.code === "Space" && vehicles.get(local.vehicleId)?.target.type === "cannon") {
    socket.emit("vehicle:launch-self", { vehicleId: local.vehicleId });
    return;
  }
  if (e.code === "KeyF" && local.vehicleId) {
    dropPlaneBomb();
    return;
  }
  if (e.code === "KeyF") {
    useMedkit();
    return;
  }
  if (e.code === "KeyZ" && !e.repeat && !local.vehicleId && local.onGround && !local.climbing) {
    local.prone = !local.prone;
    local.crouching = false;
    local.sprinting = false;
    local.proneExitUntil = 0;
    stopLocalEmote();
    return;
  }
  if (e.code === "Space" && local.prone) {
    local.prone = false;
    local.proneExitUntil = Number.POSITIVE_INFINITY;
    return;
  }
  if (e.code === "KeyC") {
    toggleCameraMode();
    return;
  }
  if (["KeyR", "Digit1", "Digit2", "KeyG", "KeyQ"].includes(e.code)) stopLocalEmote();
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
  if (local.mouseDown && isAirVehicleType(entry.target.type)) fireVehicleWeapon();
  if (now - lastVehicleInputSent < VEHICLE_INPUT_SEND_MS) return;
  lastVehicleInputSent = now;
  const isPlane = isAirVehicleType(entry.target.type);
  const throttle = Number(Boolean(keys.KeyW)) - Number(Boolean(keys.KeyS));
  const steer = Number(Boolean(keys.KeyA)) - Number(Boolean(keys.KeyD));
  const lift = Number(Boolean(keys.Space)) - Number(Boolean(keys.ControlLeft || keys.ControlRight));
  let groundY = null;
  let groundAheadY = null;
  let groundBehindY = null;
  let collision = false;
  if (!isPlane && entry.target.type !== "cannon" && entry.target.type !== "jetski") {
    const radius = Math.max(1.2, Number(entry.model.userData.radius) || 1.5);
    const speedLookAhead = Math.min(4.8, Math.abs(entry.state.speed || 0) * 0.18);
    const sampleDistance = radius + speedLookAhead;
    vehicleForward.set(-Math.sin(entry.state.yaw), 0, -Math.cos(entry.state.yaw));
    groundY = terrainSurfaceHeightAt(entry.state.x, entry.state.z, entry.state.y);
    groundAheadY = terrainSurfaceHeightAt(
      entry.state.x + vehicleForward.x * sampleDistance,
      entry.state.z + vehicleForward.z * sampleDistance,
      groundY
    );
    groundBehindY = terrainSurfaceHeightAt(
      entry.state.x - vehicleForward.x * radius,
      entry.state.z - vehicleForward.z * radius,
      groundY
    );
    const nextX = entry.state.x + vehicleForward.x * Math.max(1.1, radius * 0.78);
    const nextZ = entry.state.z + vehicleForward.z * Math.max(1.1, radius * 0.78);
    collision = throttle > 0 && isBlockedAt(nextX, nextZ, groundY);
  }
  socket.emit("vehicle:input", {
    throttle,
    steer,
    lift: isPlane ? lift : 0,
    pitch: isPlane ? lift : 0,
    roll: isPlane ? steer : 0,
    yaw: 0,
    brake: !isPlane && Boolean(keys.Space),
    groundY,
    groundAheadY,
    groundBehindY,
    collision
  });
}

function updateMovement(delta) {
  if (!local.alive) return;
  if (local.vehicleId) {
    updateVehicleControls();
    return;
  }
  if (!controls.isLocked) {
    localMoveVelocity.multiplyScalar(Math.max(0, 1 - delta * 12));
    localMoveTarget.set(0, 0, 0);
    return;
  }
  if (local.prone && !local.onGround) local.prone = false;
  const weapon = currentWeapon(local.slot);
  const prone = Boolean(local.prone);
  const sprinting = !prone && Boolean(keys.ShiftLeft || keys.ShiftRight);
  const crouching = !prone && Boolean(keys.ControlLeft || keys.ControlRight);
  const sketchbookFeel = room.settings.mapId === "sketchbook";
  const harpoonSlowMul = performance.now() < local.harpoonSlowUntil ? local.harpoonSlowStrength : 1;
  const speed = WALK_SPEED * (sketchbookFeel ? 0.74 : 1) * (weapon?.speedMul || 1) * room.settings.moveSpeedMul *
    (sprinting ? SPRINT_MUL : 1) * (crouching ? CROUCH_MUL : 1) * (prone ? PRONE_SPEED_MUL : 1) *
    (local.abilityActive && CLASSES[local.classId].ability.id === "sprint_tatico" ? 1.8 : 1) *
    (local.abilityActive && CLASSES[local.classId].ability.id === "supressao" ? 0.5 : 1) *
    harpoonSlowMul;

  const forward = Number(Boolean(keys.KeyW)) - Number(Boolean(keys.KeyS));
  const strafe = Number(Boolean(keys.KeyD)) - Number(Boolean(keys.KeyA));
  local.moveForward = forward;
  local.moveStrafe = strafe;
  const ladder = findLadderAt(camera.position.x, camera.position.z, local.jumpOffset);
  const climbing = Boolean(!prone && ladder && forward !== 0 && !keys.Space);
  local.climbing = climbing;

  const rawMoveInput = new THREE.Vector3(strafe, 0, climbing ? 0 : -forward);
  const wantsMove = rawMoveInput.lengthSq() > 0;
  if (wantsMove) rawMoveInput.normalize();
  localMoveTarget.copy(rawMoveInput).multiplyScalar(wantsMove && !climbing ? speed : 0);
  const response = sketchbookFeel
    ? (wantsMove ? (sprinting ? 10.5 : 9.2) : 11.5)
    : (wantsMove ? (sprinting ? 17 : 14) : 19);
  localMoveVelocity.x = THREE.MathUtils.damp(localMoveVelocity.x, localMoveTarget.x, response, delta);
  localMoveVelocity.z = THREE.MathUtils.damp(localMoveVelocity.z, localMoveTarget.z, response, delta);
  if (Math.abs(localMoveVelocity.x) < 0.015) localMoveVelocity.x = 0;
  if (Math.abs(localMoveVelocity.z) < 0.015) localMoveVelocity.z = 0;
  const moveVec = new THREE.Vector3(localMoveVelocity.x * delta, 0, localMoveVelocity.z * delta);
  let moving = localMoveVelocity.lengthSq() > 0.08 || climbing;
  local.moving = moving;
  local.sprinting = sprinting;
  local.crouching = crouching;
  local.prone = prone;
  local.jumping = !local.onGround || climbing;
  if (wantsMove || climbing) stopLocalEmote();

  const prevX = camera.position.x, prevZ = camera.position.z;
  controls.moveRight(moveVec.x);
  controls.moveForward(-moveVec.z);
  const mapHalf = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
  camera.position.x = Math.max(-mapHalf + 1, Math.min(mapHalf - 1, camera.position.x));
  camera.position.z = Math.max(-mapHalf + 1, Math.min(mapHalf - 1, camera.position.z));

  const feetY = local.jumpOffset;
  if (mapWorld?.isWaterAt?.(camera.position.x, camera.position.z)) {
    camera.position.x = prevX;
    camera.position.z = prevZ;
    localMoveVelocity.multiplyScalar(0.35);
  }
  if (isBlockedAt(camera.position.x, camera.position.z, feetY)) {
    const movedX = camera.position.x;
    const movedZ = camera.position.z;
    const canSlideX = !isBlockedAt(movedX, prevZ, feetY);
    const canSlideZ = !isBlockedAt(prevX, movedZ, feetY);
    if (canSlideX && (!canSlideZ || Math.abs(moveVec.x) >= Math.abs(moveVec.z))) {
      camera.position.z = prevZ;
      localMoveVelocity.z = 0;
    } else if (canSlideZ) {
      camera.position.x = prevX;
      localMoveVelocity.x = 0;
    } else {
      camera.position.x = prevX;
      camera.position.z = prevZ;
      localMoveVelocity.multiplyScalar(0.2);
    }
  }
  if (mapWorld?.requireExplicitGround && !groundInfoAt(camera.position.x, camera.position.z, feetY).found) {
    camera.position.x = prevX;
    camera.position.z = prevZ;
    localMoveVelocity.multiplyScalar(0.25);
  }

  if (!climbing && local.externalVelocity.lengthSq() > 0.01) {
    const beforeExternalX = camera.position.x;
    const beforeExternalZ = camera.position.z;
    camera.position.x += local.externalVelocity.x * delta;
    camera.position.z += local.externalVelocity.z * delta;
    if (
      isBlockedAt(camera.position.x, camera.position.z, feetY) ||
      (mapWorld?.requireExplicitGround && !groundInfoAt(camera.position.x, camera.position.z, feetY).found)
    ) {
      camera.position.x = beforeExternalX;
      camera.position.z = beforeExternalZ;
    }
    local.verticalVelocity = Math.max(local.verticalVelocity, local.externalVelocity.y);
    local.externalVelocity.x *= Math.max(0, 1 - delta * 2.4);
    local.externalVelocity.z *= Math.max(0, 1 - delta * 2.4);
    local.externalVelocity.y = 0;
  }

  const groundInfo = groundInfoAt(camera.position.x, camera.position.z, feetY);
  if (mapWorld?.requireExplicitGround && !groundInfo.found) {
    snapLocalToSafeGround();
    return;
  }
  const groundY = groundInfo.height;
  const jumpHeight = JUMP_HEIGHT_BASE * room.settings.jumpHeightMul;
  if (climbing) {
    local.externalVelocity.set(0, 0, 0);
    local.verticalVelocity = 0;
    local.onGround = false;
    local.jumpOffset = THREE.MathUtils.clamp(
      local.jumpOffset + forward * LADDER_SPEED * delta,
      ladder.bottomY,
      ladder.topY
    );
    if (ladder.alongX) camera.position.z = THREE.MathUtils.lerp(camera.position.z, ladder.centerZ, Math.min(1, delta * 10));
    else camera.position.x = THREE.MathUtils.lerp(camera.position.x, ladder.centerX, Math.min(1, delta * 10));
    if (local.jumpOffset >= ladder.topY - 0.04 && forward > 0) {
      local.jumpOffset = ladder.topY;
      local.onGround = true;
      camera.position.x += ladder.dismountX;
      camera.position.z += ladder.dismountZ;
    } else if (local.jumpOffset <= ladder.bottomY + 0.02 && forward < 0) {
      local.jumpOffset = ladder.bottomY;
      local.onGround = true;
    }
  } else {
    if (keys.Space && !prone && local.onGround && performance.now() >= local.proneExitUntil) {
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
  }
  const stanceOffset = prone ? PRONE_EYE_OFFSET : crouching ? 0.35 : 0;
  camera.position.y = EYE_HEIGHT + local.jumpOffset - stanceOffset;
  local.jumping = !local.onGround || climbing;

  const now = performance.now();
  if (moving && local.onGround && !prone && now - lastFootstepAt > (sprinting ? 260 : 390)) {
    lastFootstepAt = now;
    playFootstep(null, sprinting);
  }

  if (local.mouseDown && weapon?.auto) shoot();

  if (now - lastMoveSent > MOVE_SEND_MS) {
    lastMoveSent = now;
    _readEuler.setFromQuaternion(camera.quaternion);
    socket.emit("match:move", {
      x: camera.position.x, y: Math.max(0, local.jumpOffset), z: camera.position.z,
      yaw: _readEuler.y, pitch: _readEuler.x,
      moving, sprinting, jumping: !local.onGround || climbing, crouching, prone: local.prone, aiming: local.aiming, slot: local.slot,
      moveForward: forward, moveStrafe: strafe
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
    if (!avatar.inVehicle && avatar.targetPosition) {
      const posAlpha = Math.min(1, delta * 13);
      const yawAlpha = Math.min(1, delta * 14);
      const distance = avatar.root.position.distanceTo(avatar.targetPosition);
      if (distance > 8) avatar.root.position.copy(avatar.targetPosition);
      else avatar.root.position.lerp(avatar.targetPosition, posAlpha);
      avatar.root.rotation.y = lerpAngle(avatar.root.rotation.y, avatar.targetYaw || avatar.root.rotation.y, yawAlpha);
    }
    if (avatar.mixer) {
      const animation = animationForAvatar(avatar);
      avatar.setAnimation(animation, false, animation.startsWith("dance") ? avatar.emoteSpeed : null);
      updateAvatarGun(avatar, avatar.weaponId);
      setCharacterAiming(avatar, avatar.weaponId, avatar.aiming && avatar.alive && Boolean(avatar.weaponId));
      avatar.mixer.update(delta);
      updateCharacterPose(avatar, delta);
      return;
    }
    avatar.walkPhase += delta * 6;
    const swing = avatar.moving ? Math.sin(avatar.walkPhase) * 0.35 : 0;
    avatar.leftLeg.rotation.x = swing;
    avatar.rightLeg.rotation.x = -swing;
    avatar.leftArm.rotation.x = -swing * 0.7;
    avatar.rightArm.rotation.x = swing * 0.7;
  });
}

function drawFrame(delta) {
  if (composer) composer.render(delta);
  else renderer.render(scene, camera);
}

function renderWithCameraMode(delta) {
  updateLocalViewAvatar(delta);
  const useThirdPerson = cameraMode === "third" && room?.status === "playing" && local.alive && !local.vehicleId;
  if (!useThirdPerson) {
    thirdPersonCameraReady = false;
    if (localViewAvatar) localViewAvatar.root.visible = false;
    drawFrame(delta);
    return;
  }

  const eyePosition = camera.position.clone();
  const eyeQuaternion = camera.quaternion.clone();
  const viewDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(eyeQuaternion).normalize();
  const rightDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(eyeQuaternion).setY(0).normalize();
  const lookHeight = local.prone ? 0.5 : local.crouching ? 0.96 : 1.28;
  const lookTarget = new THREE.Vector3(eyePosition.x, local.jumpOffset + lookHeight, eyePosition.z);
  const desired = lookTarget.clone()
    .addScaledVector(viewDirection, -6.8)
    .addScaledVector(rightDirection, 0.42);
  desired.y = Math.max(local.jumpOffset + (local.prone ? 0.42 : 0.78), desired.y + (local.prone ? 0.28 : 0.5));
  const aimTarget = lookTarget.clone().addScaledVector(viewDirection, 10.5);
  const direction = desired.clone().sub(lookTarget);
  const distance = direction.length();
  let tooClose = false;

  if (distance > 0.01) {
    direction.normalize();
    raycaster.set(lookTarget, direction);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(solidMeshesForRaycast, false)
      .find((item) => item.object.visible !== false && item.distance > 0.45);
    if (hit) {
      const cameraDistance = Math.max(0.65, hit.distance - 0.35);
      tooClose = cameraDistance < 2.4;
      desired.copy(lookTarget).addScaledVector(direction, cameraDistance);
    }
  }

  if (!thirdPersonCameraReady) {
    thirdPersonRenderPosition.copy(desired);
    thirdPersonRenderTarget.copy(aimTarget);
    thirdPersonCameraReady = true;
  } else {
    const cameraAlpha = Math.min(1, delta * 9.5);
    const targetAlpha = Math.min(1, delta * 12);
    thirdPersonRenderPosition.lerp(desired, cameraAlpha);
    thirdPersonRenderTarget.lerp(aimTarget, targetAlpha);
  }

  const previousWeaponVisible = weaponRig.visible;
  if (tooClose) {
    if (localViewAvatar) localViewAvatar.root.visible = false;
    weaponRig.visible = previousWeaponVisible;
    drawFrame(delta);
    return;
  }

  weaponRig.visible = false;
  camera.position.copy(thirdPersonRenderPosition);
  camera.lookAt(thirdPersonRenderTarget);
  drawFrame(delta);
  camera.position.copy(eyePosition);
  camera.quaternion.copy(eyeQuaternion);
  weaponRig.visible = previousWeaponVisible;
}

function drawMinimap() {
  const canvas = dom.minimapCanvas;
  if (!canvas || !room) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const half = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
  const point = (x, z) => ({ x: (x / half * 0.5 + 0.5) * size, y: (z / half * 0.5 + 0.5) * size });
  const mapColors = { mundo: "#436d3d", sketchbook: "#b8b2a5", praia: "#d7bd68", cidade: "#555d64", floresta: "#375c36" };
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = mapColors[room.settings.mapId] || "#3d4d46";
  ctx.fillRect(0, 0, size, size);

  if (room.settings.mapId === "mundo") {
    const cityMin = point(-290, -240);
    const cityMax = point(-12, 90);
    ctx.fillStyle = "#60696d";
    ctx.fillRect(cityMin.x, cityMin.y, cityMax.x - cityMin.x, cityMax.y - cityMin.y);
    const beachStart = point(0, 116).y;
    const oceanStart = point(0, 190).y;
    ctx.fillStyle = "#d7bd68";
    ctx.fillRect(0, beachStart, size, oceanStart - beachStart);
    ctx.fillStyle = "#267ca8";
    ctx.fillRect(0, oceanStart, size, size - oceanStart);
    ctx.fillStyle = "#287f9e";
    const lake = point(126, -62);
    ctx.beginPath(); ctx.arc(lake.x, lake.y, 31 / (half * 2) * size, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3a9eb3";
    ctx.lineWidth = Math.max(3, 13 / (half * 2) * size);
    ctx.beginPath();
    UNIFIED_RIVER_POINTS.forEach((riverPoint, index) => {
      const marker = point(riverPoint.x, riverPoint.z);
      if (index === 0) ctx.moveTo(marker.x, marker.y);
      else ctx.lineTo(marker.x, marker.y);
    });
    ctx.stroke();
    ctx.strokeStyle = "rgba(32,38,42,0.8)";
    ctx.lineWidth = Math.max(2, 15 / (half * 2) * size);
    [-258, -206, -154, -102, -50].forEach((x) => {
      const start = point(x, -240); const end = point(x, 90);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    });
    [-224, -166, -108, -50, 8, 66].forEach((z) => {
      const start = point(-290, z); const end = point(-12, z);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    });
  } else if (room.settings.mapId === "cidade") {
    ctx.fillStyle = "#272d32";
    [-34, 0, 34].forEach((coordinate) => {
      const vertical = point(coordinate - 6, 0).x;
      const horizontal = point(0, coordinate - 6).y;
      const width = 12 / (half * 2) * size;
      ctx.fillRect(vertical, 0, width, size);
      ctx.fillRect(0, horizontal, size, width);
    });
  } else if (room.settings.mapId === "praia") {
    const waterStart = point(0, 27).y;
    ctx.fillStyle = "#267ca8";
    ctx.fillRect(0, waterStart, size, size - waterStart);
    ctx.strokeStyle = "rgba(225,247,255,0.62)";
    ctx.beginPath(); ctx.moveTo(0, waterStart); ctx.lineTo(size, waterStart); ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(171,193,153,0.24)";
    ctx.lineWidth = 11;
    ctx.strokeRect(5.5, 5.5, size - 11, size - 11);
  }

  if (activeWorldEvent?.type === "tsunami" && activeWorldEvent.phase === "surge") {
    const progress = Math.max(0, Math.min(1, activeWorldEvent.progress || 0));
    const z = room.settings.mapId === "mundo" ? half - 185 * progress : half - (half * 2 - 8) * progress;
    const wave = point(0, z).y;
    ctx.strokeStyle = "#8de4ff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, wave); ctx.lineTo(size, wave); ctx.stroke();
  }
  if (activeWorldEvent?.type === "tornado" && activeWorldEvent.phase === "active") {
    const progress = Math.max(0, Math.min(1, activeWorldEvent.progress || 0));
    const marker = room.settings.mapId === "mundo"
      ? point(30 + progress * 230, -190 + progress * 250)
      : point(-70 + progress * 140, Math.sin(progress * Math.PI * 3) * 30);
    ctx.strokeStyle = "#f2e7a5"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 6, 0, Math.PI * 2); ctx.stroke();
  }

  vehicles.forEach((entry) => {
    if (entry.target.destroyed) return;
    const marker = point(entry.target.x, entry.target.z);
    ctx.fillStyle = entry.target.driverId ? "#ffd75d" : "rgba(245,245,245,0.7)";
    ctx.fillRect(marker.x - 2.5, marker.y - 2.5, 5, 5);
  });

  const now = performance.now();
  remotePlayers.forEach((avatar) => {
    if (!avatar.alive || !avatar.root.visible) return;
    const ally = room.settings.mode === "teams" && avatar.team === local.team;
    const marker = point(avatar.root.position.x, avatar.root.position.z);
    ctx.fillStyle = ally ? "#71a9ff" : "#ff6565";
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 3.5, 0, Math.PI * 2); ctx.fill();
    if (!ally) {
      ctx.strokeStyle = "rgba(255,82,82,0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 5.5 + Math.sin(now * 0.008) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  const self = point(camera.position.x, camera.position.z);
  _readEuler.setFromQuaternion(camera.quaternion);
  const yaw = _readEuler.y;
  ctx.save();
  ctx.translate(self.x, self.y);
  ctx.rotate(-yaw);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 3); ctx.lineTo(-5, 5); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
}

function render() {
  const delta = Math.min(clock.getDelta(), 0.05);
  if (room && room.status === "playing") {
    updateVehiclePresentation(delta);
    applyWorldLighting(delta);
    updateMovement(delta);
    if (!local.vehicleId && mapWorld?.kickSoccerBalls) {
      mapWorld.kickSoccerBalls(camera.position, new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
    }
    updateGrenadesPhysics(delta);
    updateBallistics(delta);
    updateSurvivalWorld(delta, performance.now());
    animateAvatars(delta);
    mapWorld?.update(delta, activeWorldEvent);
    updateAbilityHud();
    updateWeaponPresentation(delta);
    updateInteractionHint();
    updateSurvivalHud();
    updateAudioListener(camera);
    // Som de motor dos veiculos removido a pedido: mantemos o motor sempre
    // desligado (silencia qualquer node que por acaso esteja tocando).
    updateVehicleEngine(false, 0);
    if (performance.now() - lastMinimapDrawAt > 80) {
      lastMinimapDrawAt = performance.now();
      drawMinimap();
    }
  }
  renderWithCameraMode(delta);
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
    "tsunami:flooded": "COSTA INUNDADA: a agua recua em 15 segundos",
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
    survivalStatus = {
      wave: roomState.survivalWave || 1,
      activeZombies: (roomState.zombies || []).filter((zombie) => zombie.alive !== false).length
    };
    if (room.settings.mapId === "sketchbook") {
      cameraMode = "third";
      thirdPersonCameraReady = false;
      updateCameraToggle();
    }
    mapWorld = buildMap(room.settings.mapId, scene);
    obstacles = mapWorld.obstacles;
    solidMeshesForRaycast = mapWorld.raycastMeshes || [];
    scene.traverse((obj) => {
      if (obj.isMesh && !obj.userData.ignoreRaycast && obj.userData.socketId === undefined && !solidMeshesForRaycast.includes(obj)) {
        solidMeshesForRaycast.push(obj);
      }
    });
    syncVehicles(room.vehicles || []);
    activeWorldEvent = room.worldEvent || null;
    activeWorldTime = room.worldTime || null;
    syncSurvivalLoot(scene, room.survivalLoot || [], terrainSurfaceHeightAt);
    syncSurvivalZombies(scene, room.zombies || [], terrainSurfaceHeightAt);

    const me = room.players.find((p) => p.socketId === selfId);
    local.classId = me?.classId || "rifle";
    local.secondaryId = me?.secondaryId || "pistol_common";
    local.team = me?.team || null;
    local.slot = normalizeSlot(me?.slot);
    local.health = 100;
    local.alive = true;
    local.kills = 0;
    local.deaths = 0;
    local.score = 0;
    local.jumpOffset = me?.y || 0;
    local.grenadeCharges = emptyGrenadeCharges();
    local.grenadeThrowPending = false;
    local.ammo.primary = 0;
    local.ammo.secondary = 0;
    local.abilityCooldownUntil = 0;
    local.aiming = false;
    local.charging = false;
    local.chargeStartedAt = 0;
    local.vehicleId = null;
    local.emoteActive = false;
    local.emoteUntil = 0;
    local.emoteSpeed = 1;
    local.emoteAnimation = "dance";
    local.climbing = false;
    local.moving = false;
    local.sprinting = false;
    local.crouching = false;
    local.prone = false;
    local.proneExitUntil = 0;
    local.jumping = false;
    local.externalVelocity.set(0, 0, 0);
    local.pendingFallDamage = 0;
    local.harpoonSlowUntil = 0;
    local.harpoonSlowStrength = 1;
    localMoveVelocity.set(0, 0, 0);
    localMoveTarget.set(0, 0, 0);
    thirdPersonCameraReady = false;

    camera.position.set(me?.x || 0, EYE_HEIGHT + (me?.y || 0), me?.z || 0);
    camera.quaternion.setFromEuler(new THREE.Euler(0, me?.yaw || 0, 0, "YXZ"));
    ensureLocalPlayablePosition();

    applyInventorySnapshot(me || {});
    if (me) createLocalViewAvatar(me);
    room.players.forEach((p) => { if (p.socketId !== selfId) spawnOrUpdateRemote(p); });

    document.getElementById("lobbyRoot").style.display = "none";
    dom.gameRoot.style.display = "block";
    dom.crosshair.style.display = "block";
    dom.hudTopLeft.style.display = "block";
    dom.hudBottomRight.style.display = "block";
    dom.hudTopRight.style.display = "block";
    dom.minimap.style.display = "block";
    if (dom.cameraToggle) dom.cameraToggle.style.display = "block";
    dom.endScreen.hidden = true;
    closeDanceHub({ relock: false });
    dom.vehicleStatus.classList.remove("active");
    dom.eventAlert.classList.remove("active");
    updateHealthHud(); updateAmmoHud(); updateGrenadeHud(); updateSurvivalHud(); updateScoreboard();
    controls.lock();
  });

  socket.on("room:player-left", ({ socketId }) => { removeAvatar(socketId); updateScoreboard(); });

  socket.on("vehicle:state", (states) => syncVehicles(states));

  socket.on("vehicle:occupied", ({ vehicleId, driverId }) => {
    const entry = vehicles.get(vehicleId);
    if (entry) entry.target.driverId = driverId || null;
  });

  socket.on("vehicle:entered", (vehicle) => {
    local.vehicleId = vehicle.id;
    local.vehicleLookYaw = 0;
    local.vehicleLookPitch = 0;
    local.vehicleBombReadyAt = Number(vehicle.bombReadyAt) || 0;
    setAiming(false);
    localMoveVelocity.set(0, 0, 0);
    localMoveTarget.set(0, 0, 0);
    local.emoteActive = false;
    local.emoteUntil = 0;
    local.emoteSpeed = 1;
    local.emoteAnimation = "dance";
    local.moving = false;
    local.sprinting = false;
    local.crouching = false;
    local.prone = false;
    local.proneExitUntil = 0;
    local.jumping = false;
    dom.pauseHint.hidden = true;
    closeDanceHub({ relock: false });
    local.lastVehicleShotAt = 0;
    syncVehicles([...(Array.from(vehicles.values()).map((entry) => entry.target).filter((item) => item.id !== vehicle.id)), vehicle]);
    if (!VEHICLE_STATS[vehicle.type]?.builtInWeapon) switchSlot("secondary");
    weaponRig.visible = false;
    updateCameraToggle();
    updateVehicleHud();
  });

  socket.on("vehicle:exited", ({ x, y, z }) => {
    local.vehicleId = null;
    local.vehicleLookYaw = 0;
    local.vehicleLookPitch = 0;
    localMoveVelocity.set(0, 0, 0);
    localMoveTarget.set(0, 0, 0);
    local.mouseDown = false;
    local.climbing = false;
    local.moving = false;
    local.sprinting = false;
    local.crouching = false;
    local.prone = false;
    local.proneExitUntil = 0;
    local.jumping = false;
    weaponRig.visible = cameraMode !== "third";
    camera.position.set(Number(x) || camera.position.x, EYE_HEIGHT + (Number(y) || 0), Number(z) || camera.position.z);
    local.jumpOffset = Number(y) || 0;
    ensureLocalPlayablePosition();
    refreshEquippedWeapon("primary");
    updateCameraToggle();
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
    playExplosionSound({ x, y: y + 1, z });
  });

  socket.on("vehicle:fired", renderVehicleFire);
  socket.on("vehicle:bomb-dropped", renderPlaneBomb);
  socket.on("vehicle:bomb-exploded", renderPlaneBombExplosion);
  socket.on("vehicle:bomb-cooldown", ({ vehicleId, readyAt }) => {
    const entry = vehicles.get(vehicleId);
    if (entry) entry.target.bombReadyAt = Number(readyAt) || 0;
    if (local.vehicleId === vehicleId) {
      local.vehicleBombReadyAt = Number(readyAt) || 0;
      updateVehicleHud();
    }
  });

  socket.on("arena-world:event", (event) => updateEventAlert(event?.type === "none" ? null : event));
  socket.on("arena-world:time", (time) => { activeWorldTime = time || activeWorldTime; });

  socket.on("world:object-state", (state) => mapWorld?.applyObjectState(state));

  socket.on("survival:loot-picked", ({ lootId }) => {
    removeSurvivalLoot(lootId);
    const picked = room?.survivalLoot?.find((loot) => loot.id === lootId);
    if (picked) picked.active = false;
  });

  socket.on("survival:loot", (lootList) => {
    const nextLoot = Array.isArray(lootList) ? lootList : [];
    if (room) room.survivalLoot = nextLoot;
    syncSurvivalLoot(scene, nextLoot, terrainSurfaceHeightAt);
  });

  socket.on("survival:inventory", (snapshot) => {
    applyInventorySnapshot(snapshot || {});
    updateAmmoHud();
    updateGrenadeHud();
  });

  socket.on("survival:healed", (snapshot) => {
    local.health = Math.max(0, Math.min(100, Number(snapshot?.health) || local.health));
    applyInventorySnapshot(snapshot || {});
    updateHealthHud();
    updateSurvivalHud();
  });

  socket.on("survival:fuel-empty", () => {
    pushKillFeed("Veiculo sem gasolina");
  });

  socket.on("survival:status", (status = {}) => {
    survivalStatus = {
      wave: Math.max(1, Number(status.wave) || survivalStatus.wave || 1),
      activeZombies: Math.max(0, Number(status.activeZombies) || 0)
    };
    if (room) room.survivalWave = survivalStatus.wave;
    updateSurvivalHud();
  });

  socket.on("survival:zombies", (zombies) => {
    if (!scene) return;
    if (room) room.zombies = zombies || [];
    syncSurvivalZombies(scene, zombies || [], terrainSurfaceHeightAt);
    survivalStatus.activeZombies = (zombies || []).filter((zombie) => zombie.alive !== false).length;
    updateSurvivalHud();
  });

  socket.on("survival:zombie-damaged", ({ byId }) => {
    if (byId === selfId) showHitMarker({});
  });

  socket.on("survival:zombie-killed", ({ byId, zombies }) => {
    if (byId === selfId) {
      local.score += 1;
      showHitMarker({ kill: true });
      updateScoreboard();
      pushKillFeed("Zumbi eliminado");
    }
    const nextZombies = Array.isArray(zombies) ? zombies : room?.zombies || [];
    if (room) room.zombies = nextZombies;
    syncSurvivalZombies(scene, nextZombies, terrainSurfaceHeightAt);
    survivalStatus.activeZombies = nextZombies.filter((zombie) => zombie.alive !== false).length;
    updateSurvivalHud();
  });

  socket.on("survival:zombie-attack", ({ targetSocketId }) => {
    if (targetSocketId === selfId) playCharacterAction(localViewAvatar, "damage", 1.15);
  });

  socket.on("world:force", ({ x, y, z, fallDamage }) => {
    local.externalVelocity.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    local.verticalVelocity = Math.max(local.verticalVelocity, Number(y) || 0);
    local.onGround = false;
    local.pendingFallDamage = Math.max(local.pendingFallDamage, Number(fallDamage) || 0);
  });

  socket.on("match:player-move", (p) => {
    const avatar = remotePlayers.get(p.socketId);
    if (!avatar) return;
    avatar.targetPosition = avatar.targetPosition || new THREE.Vector3();
    avatar.targetPosition.set(p.x, p.y, p.z);
    avatar.targetYaw = Number.isFinite(Number(p.yaw)) ? Number(p.yaw) : avatar.targetYaw || avatar.root.rotation.y;
    if (!p.vehicleId) avatar.root.rotation.z = 0;
    avatar.root.visible = true;
    avatar.alive = true;
    avatar.moving = Boolean(p.moving);
    avatar.sprinting = Boolean(p.sprinting);
    avatar.jumping = Boolean(p.jumping);
    avatar.crouching = Boolean(p.crouching);
    avatar.prone = Boolean(p.prone);
    avatar.classId = p.classId || avatar.classId;
    avatar.secondaryId = p.secondaryId || avatar.secondaryId;
    avatar.inventory = p.inventory || avatar.inventory || {};
    avatar.aiming = Boolean(p.aiming);
    avatar.slot = normalizeSlot(p.slot);
    avatar.weaponId = weaponIdForPlayerState(avatar, avatar.slot);
    updateAvatarGun(avatar, avatar.weaponId);
    avatar.moveForward = Number(p.moveForward) || 0;
    avatar.moveStrafe = Number(p.moveStrafe) || 0;
    if (avatar.moving || avatar.jumping) {
      avatar.emoteUntil = 0;
      avatar.emoteSpeed = 1;
      avatar.emoteAnimation = "dance";
    }
  });

  socket.on("match:shot-fired", ({ socketId, weaponId, origin, direction, ballistics }) => {
    const avatar = remotePlayers.get(socketId);
    if (!avatar) return;
    avatar.revealedUntil = performance.now() + 1800;
    playCharacterWeaponAction(avatar, weaponId, "shoot");
    // Sem PointLight por disparo remoto: com varios jogadores atirando juntos,
    // uma luz dinamica por tiro multiplicava o custo de iluminacao por pixel e
    // travava o jogo. O fogacho (emitMuzzleFx) ja da o brilho visual.
    const weapon = weaponById(weaponId);
    const shotOrigin = new THREE.Vector3(Number(origin?.x) || avatar.root.position.x, Number(origin?.y) || avatar.root.position.y + 1.3, Number(origin?.z) || avatar.root.position.z);
    playWeaponSound(weaponId, shotOrigin);
    if (!weapon || weapon.kind === "melee") return;
    const dir = new THREE.Vector3(Number(direction?.x) || 0, Number(direction?.y) || 0, Number(direction?.z) || -1).normalize();
    emitMuzzleFx(scene, shotOrigin, dir, weaponId === "heavy_mg" ? 1.18 : 1);
    const profile = ballisticForWeapon(weapon);
    const speed = THREE.MathUtils.clamp(Number(ballistics?.speed) || profile.speed, 30, 220);
    const gravity = THREE.MathUtils.clamp(Number(ballistics?.gravity) || profile.gravity, -20, 0);
    const range = Math.min(weapon.range, Number(ballistics?.range) || weapon.range);
    const trace = traceBallistic(shotOrigin, dir, speed, gravity, range, solidMeshesForRaycast);
    spawnBallisticVisual(trace, speed, profile.kind, true);
  });

  socket.on("match:reload-started", ({ socketId, weaponId }) => {
    const avatar = remotePlayers.get(socketId);
    if (avatar) playCharacterWeaponAction(avatar, weaponId, "reload");
  });

  socket.on("match:damage", ({ targetSocketId, health, byId, headshot }) => {
    if (byId === selfId && targetSocketId !== selfId) showHitMarker({ headshot: Boolean(headshot) });
    if (targetSocketId === selfId) {
      local.health = health;
      updateHealthHud();
      playCharacterAction(localViewAvatar, "damage", 1.15);
    } else {
      const avatar = remotePlayers.get(targetSocketId);
      if (avatar) playCharacterAction(avatar, "damage", 1.15);
    }
  });

  socket.on("match:kill", ({ killerId, killerName, victimId, victimName, headshot }) => {
    pushKillFeed(`${killerName} eliminou ${victimName}${headshot ? " (na cabeca)" : ""}`);
    if (killerId === selfId) { local.kills += 1; local.score += 1; showHitMarker({ headshot: Boolean(headshot), kill: true }); }
    else { const a = remotePlayers.get(killerId); if (a) { a.kills += 1; a.score = (a.score || 0) + 1; } }
    if (victimId === selfId) {
      local.alive = false; local.health = 0;
      local.deaths += 1;
      local.vehicleId = null;
      localMoveVelocity.set(0, 0, 0);
      localMoveTarget.set(0, 0, 0);
      thirdPersonCameraReady = false;
      local.mouseDown = false;
      local.emoteActive = false;
      local.emoteUntil = 0;
      local.emoteSpeed = 1;
      local.emoteAnimation = "dance";
      local.moving = false;
      local.sprinting = false;
      local.crouching = false;
      local.prone = false;
      local.proneExitUntil = 0;
      local.jumping = false;
      local.grenadeThrowPending = false;
      closeDanceHub({ relock: false });
      local.externalVelocity.set(0, 0, 0);
      local.pendingFallDamage = 0;
      local.harpoonSlowUntil = 0;
      local.harpoonSlowStrength = 1;
      weaponRig.visible = Boolean(currentWeaponMesh);
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
      if (a) {
        a.deaths += 1;
        a.alive = false;
        a.moving = false;
        a.prone = false;
        a.emoteUntil = 0;
        a.emoteSpeed = 1;
        a.emoteAnimation = "dance";
        a.setAnimation("death", true);
      }
    }
    updateScoreboard();
  });

  socket.on("player:loadoutPending", ({ classId, secondaryId }) => {
    if (classId) dom.respawnClassSelect.value = classId;
    if (secondaryId) dom.respawnSecondarySelect.value = secondaryId;
    dom.respawnLoadoutStatus.textContent = "Equipamento confirmado";
  });

  socket.on("match:respawn", ({ socketId, x, y, z, yaw, health, classId, secondaryId, team, slot, inventory, ammo, grenadeCharges }) => {
    if (socketId === selfId) {
      local.alive = true; local.health = health;
      local.vehicleId = null;
      local.mouseDown = false;
      local.emoteActive = false;
      local.emoteUntil = 0;
      local.emoteSpeed = 1;
      local.emoteAnimation = "dance";
      local.climbing = false;
      local.moving = false;
      local.sprinting = false;
      local.crouching = false;
      local.prone = false;
      local.proneExitUntil = 0;
      local.jumping = false;
      local.externalVelocity.set(0, 0, 0);
      local.pendingFallDamage = 0;
      local.harpoonSlowUntil = 0;
      local.harpoonSlowStrength = 1;
      local.classId = classId || local.classId;
      local.secondaryId = secondaryId || local.secondaryId;
      local.team = team || local.team;
      local.slot = normalizeSlot(slot);
      local.jumpOffset = y; local.verticalVelocity = 0;
      localMoveVelocity.set(0, 0, 0);
      localMoveTarget.set(0, 0, 0);
      thirdPersonCameraReady = false;
      local.onGround = true;
      camera.position.set(x, EYE_HEIGHT + y, z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      ensureLocalPlayablePosition();
      local.ammo.primary = 0;
      local.ammo.secondary = 0;
      local.grenadeCharges = emptyGrenadeCharges();
      local.grenadeThrowPending = false;
      weaponRig.visible = Boolean(currentWeaponMesh);
      applyInventorySnapshot({ slot, inventory, ammo, grenadeCharges, classId: local.classId, secondaryId: local.secondaryId });
      dom.vehicleStatus.classList.remove("active");
      updateHealthHud(); updateAmmoHud(); updateGrenadeHud(); updateSurvivalHud();
      dom.deathScreen.hidden = true;
      dom.pauseHint.textContent = "Clique para voltar a partida";
      dom.pauseHint.hidden = false;
    } else {
      const a = remotePlayers.get(socketId);
      if (a && classId && a.classId !== classId) {
        const username = a.username;
        removeAvatar(socketId);
        spawnOrUpdateRemote({ socketId, username, classId, secondaryId, team, slot, inventory, x, y, z, yaw, alive: true });
      } else if (a) {
        a.root.visible = true;
        a.root.position.set(x, y, z);
        a.root.rotation.y = yaw;
        a.alive = true;
        a.classId = classId || a.classId;
        a.secondaryId = secondaryId || a.secondaryId;
        a.inventory = inventory || a.inventory || {};
        a.slot = normalizeSlot(slot);
        a.weaponId = weaponIdForPlayerState(a, a.slot);
        updateAvatarGun(a, a.weaponId);
        a.moving = false;
        a.sprinting = false;
        a.jumping = false;
        a.crouching = false;
        a.prone = false;
        a.emoteUntil = 0;
        a.emoteSpeed = 1;
        a.emoteAnimation = "dance";
        a.setAnimation("idle", true);
      }
    }
  });

  socket.on("match:harpoon-slow", ({ durationMs, strength }) => {
    local.harpoonSlowUntil = performance.now() + Math.max(250, Number(durationMs) || 1200);
    local.harpoonSlowStrength = THREE.MathUtils.clamp(Number(strength) || 0.55, 0.25, 1);
  });

  socket.on("match:ability", ({ socketId, abilityId, durationMs, target, radius, warningMs, targetSocketId, heavy }) => {
    if (abilityId === "gancho_reposicionamento") renderGrappleAbility(socketId, target);
    if (abilityId === "chuva_flechas") renderArrowRainAbility(target, Number(radius) || 7.5, Number(warningMs) || 650, Number(durationMs) || 4200);
    if (abilityId === "arpao_corrente") renderHarpoonAbility(socketId, targetSocketId, target, Boolean(heavy));
    if (socketId === selfId) {
      const duration = Math.max(0, Number(durationMs) || 0);
      local.abilityActive = true;
      local.abilityExpiresAt = performance.now() + duration;
      if (duration > 0) setTimeout(() => { local.abilityActive = false; }, duration);
    }
  });
  socket.on("match:emote", ({ socketId, emote, animation, speed, durationMs }) => {
    if (!DANCE_OPTIONS[emote]) return;
    if (socketId === selfId) {
      local.emoteActive = true;
      local.emoteUntil = performance.now() + Math.max(1000, Number(durationMs) || 5200);
      local.emoteSpeed = Number(speed) || DANCE_OPTIONS[emote].speed || 1;
      local.emoteAnimation = animation || DANCE_OPTIONS[emote].animation || "dance";
      return;
    }
    const avatar = remotePlayers.get(socketId);
    if (!avatar?.alive) return;
    avatar.moving = false;
    avatar.emoteUntil = performance.now() + Math.max(1000, Number(durationMs) || 5200);
    avatar.emoteSpeed = Number(speed) || 1;
    avatar.emoteAnimation = animation || DANCE_OPTIONS[emote].animation || "dance";
    avatar.setAnimation(animation || "dance", true, avatar.emoteSpeed);
  });

  socket.on("match:emote-stop", ({ socketId }) => {
    if (socketId === selfId) {
      local.emoteActive = false;
      local.emoteUntil = 0;
      local.emoteSpeed = 1;
      local.emoteAnimation = "dance";
      return;
    }
    const avatar = remotePlayers.get(socketId);
    if (!avatar) return;
    avatar.emoteUntil = 0;
    avatar.emoteSpeed = 1;
    avatar.emoteAnimation = "dance";
    avatar.setAnimation(animationForAvatar(avatar), true);
  });
  socket.on("match:ability-state", ({ cooldownUntil }) => {
    local.abilityCooldownUntil = performance.now() + Math.max(0, cooldownUntil - Date.now());
  });

  socket.on("match:grenade-ammo", ({ grenadeId, charges }) => {
    local.grenadeCharges[grenadeId] = charges;
    updateGrenadeHud();
  });

  socket.on("match:grenadePrepare", ({ socketId }) => {
    if (socketId === selfId) return;
    const avatar = remotePlayers.get(socketId);
    if (avatar) playCharacterAction(avatar, "grenade");
  });

  socket.on("match:grenadeThrow", ({ socketId, grenadeId, x, y, z, dirX, dirY, dirZ }) => {
    if (socketId === selfId) return;
    simulateGrenadeArc(grenadeId, new THREE.Vector3(x, y, z), new THREE.Vector3(dirX, dirY, dirZ), false, socketId);
  });

  socket.on("match:grenadeDetonate", ({ grenadeId, x, z }) => {
    renderGrenadeExplosionVisual(grenadeId, x, z);
    if (grenadeId === "explosive" || grenadeId === "impact") {
      playExplosionSound({ x, y: 1, z });
      mapWorld?.showExplosionImpact?.(x, z, grenadeId === "impact" ? 0.9 : 1.35);
    }
    else playImpactSound({ x, y: 1, z }, false);
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
      if (dom.cameraToggle) dom.cameraToggle.style.display = "none";
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
      activeWorldTime = roomState.worldTime || activeWorldTime;
      roomState.players.forEach((p) => {
        if (p.socketId !== selfId && !remotePlayers.has(p.socketId)) spawnOrUpdateRemote(p);
      });
    }
  });
}
