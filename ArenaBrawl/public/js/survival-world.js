import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { buildWeaponModel } from "./weapon-models.js";
import { CLASSES, SECONDARY_WEAPONS, GRENADES } from "./config.js";

const ZOMBIE_ASSET_ROOT = "./assets/models/quaternius/zombie-apocalypse/Characters/glTF/";
const SURVIVAL_ASSET_ROOT = "./assets/models/quaternius/survival-pack/FBX/";
const WEAPON_ASSET_ROOT = "./assets/models/quaternius/zombie-apocalypse/Weapons/glTF/";
const ZOMBIE_ASSETS = {
  basic: "Zombie_Basic.gltf",
  chubby: "Zombie_Chubby.gltf",
  ribcage: "Zombie_Ribcage.gltf",
  runner: "Zombie_Basic.gltf",
  stalker: "Zombie_Ribcage.gltf",
  brute: "Zombie_Chubby.gltf",
  drowned: "Zombie_Basic.gltf",
  arm: "Zombie_Basic.gltf"
};
const ZOMBIE_MODEL_KIND = {
  runner: "basic",
  stalker: "ribcage",
  brute: "chubby",
  drowned: "basic"
};
const WEAPON_LOOT_ASSETS = {
  assault_rifle: { file: "Rifle.gltf", targetHeight: 0.42 },
  sniper_rifle: { file: "Rifle.gltf", targetHeight: 0.48 },
  smg: { file: "SMG.gltf", targetHeight: 0.4 },
  pistol_common: { file: "Pistol.gltf", targetHeight: 0.34 },
  revolver: { file: "Pistol.gltf", targetHeight: 0.34 },
  mini_shotgun: { file: "Shotgun.gltf", targetHeight: 0.42 },
  knife: { file: "Knife.gltf", targetHeight: 0.32 }
};
const ZOMBIE_HEIGHTS = {
  basic: 1.62,
  ribcage: 1.62,
  chubby: 1.68,
  runner: 1.58,
  stalker: 1.64,
  brute: 1.7,
  drowned: 1.6
};
const ZOMBIE_TINTS = {
  runner: 0x6b8a5d,
  stalker: 0x9a907a,
  brute: 0x59684e,
  drowned: 0x4d6f73
};
const ZOMBIE_CORPSE_CLIENT_MS = 14500;

const lootEntries = new Map();
const zombieEntries = new Map();
const zombieHittable = [];
const reusableColor = new THREE.Color();
const zombieLoader = new FBXLoader();
const zombieGltfLoader = new GLTFLoader();
const zombieSourcePromises = new Map();
const survivalSourcePromises = new Map();
const weaponSourcePromises = new Map();
let zombieAtlasPromise = null;

function terrainY(terrainHeightAt, x, z, fallback = 0) {
  const value = terrainHeightAt?.(x, z, fallback);
  return Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
}

function labelForLoot(loot) {
  if (loot.kind === "weapon") {
    if (loot.slot === "secondary") return SECONDARY_WEAPONS[loot.weaponId]?.name || "Arma";
    const primary = Object.values(CLASSES).find((item) => item.primary.id === loot.weaponId)?.primary;
    return primary?.name || "Arma";
  }
  if (loot.kind === "grenade") return GRENADES[loot.grenadeId]?.name || "Granada";
  if (loot.kind === "fuel") return "Gasolina";
  if (loot.kind === "medkit") return "Kit medico";
  return "Municao";
}

function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(9, 13, 12, 0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255, 214, 94, 0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = "#ffe28a";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 24), canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.25, 0.56, 1);
  sprite.position.y = 1.45;
  return sprite;
}

function lootGlowMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function makeAmmoCrate() {
  const group = new THREE.Group();
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x5f4a2f, roughness: 0.86 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x202626, roughness: 0.7, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.46), crateMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  [-0.23, 0.23].forEach((x) => {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.38, 0.5), bandMat);
    band.position.x = x;
    band.castShadow = true;
    group.add(band);
  });
  group.position.y = 0.28;
  return group;
}

function makeFuelCan() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb6382c, roughness: 0.62, metalness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.75 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.25), mat);
  body.position.y = 0.46;
  body.castShadow = true;
  group.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.026, 8, 18, Math.PI), dark);
  handle.position.set(0, 0.86, 0);
  handle.rotation.z = Math.PI;
  group.add(handle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 8), dark);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(0.26, 0.76, 0);
  group.add(cap);
  return group;
}

function makeMedkitModel() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe5e9e1, roughness: 0.72 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb22d2d, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 0.38), white);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);
  const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.04), red);
  crossA.position.set(0, 0.43, -0.21);
  group.add(crossA);
  const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.04), red);
  crossB.position.set(0, 0.43, -0.215);
  group.add(crossB);
  return group;
}

function survivalSource(file) {
  if (!survivalSourcePromises.has(file)) {
    survivalSourcePromises.set(file, zombieLoader.loadAsync(`${SURVIVAL_ASSET_ROOT}${file}`));
  }
  return survivalSourcePromises.get(file);
}

function weaponLootSource(file) {
  if (!weaponSourcePromises.has(file)) {
    weaponSourcePromises.set(file, zombieGltfLoader.loadAsync(`${WEAPON_ASSET_ROOT}${file}`));
  }
  return weaponSourcePromises.get(file);
}

function normalizeLootAsset(model, targetHeight = 0.62) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const nextBounds = new THREE.Box3().setFromObject(model);
  model.position.x -= (nextBounds.min.x + nextBounds.max.x) / 2;
  model.position.y -= nextBounds.min.y;
  model.position.z -= (nextBounds.min.z + nextBounds.max.z) / 2;
}

function attachSurvivalLootAsset(group, fallback, file, options = {}) {
  survivalSource(file).then((source) => {
    if (!group.parent) return;
    const model = source.clone(true);
    normalizeLootAsset(model, options.targetHeight || 0.62);
    model.rotation.y = options.yaw || 0;
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.ignoreRaycast = true;
      const material = child.material?.clone?.() || new THREE.MeshStandardMaterial();
      material.roughness = 0.82;
      if (options.tint && material.color) material.color.lerp(new THREE.Color(options.tint), 0.34);
      child.material = material;
    });
    fallback.visible = false;
    group.add(model);
  }).catch(() => {
    fallback.visible = true;
  });
}

function attachWeaponLootAsset(group, fallback, weaponId) {
  const asset = WEAPON_LOOT_ASSETS[weaponId];
  if (!asset) return;
  weaponLootSource(asset.file).then((source) => {
    if (!group.parent) return;
    const model = source.scene.clone(true);
    normalizeLootAsset(model, asset.targetHeight || 0.4);
    model.rotation.set(-0.16, Math.PI / 2, -0.04);
    model.position.y = 0.22;
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.ignoreRaycast = true;
      const material = child.material?.clone?.() || new THREE.MeshStandardMaterial({ color: 0x7a7668 });
      material.roughness = Math.min(0.9, Math.max(0.62, material.roughness ?? 0.8));
      material.metalness = Math.min(0.2, material.metalness ?? 0.04);
      child.material = material;
    });
    fallback.visible = false;
    group.add(model);
  }).catch(() => {
    fallback.visible = true;
  });
}

function makeGrenadeModel(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.18 })
  );
  body.castShadow = true;
  body.position.y = 0.34;
  group.add(body);
  const pin = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.012, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xd8c47a, roughness: 0.45, metalness: 0.6 })
  );
  pin.position.set(0.04, 0.58, 0);
  pin.rotation.x = Math.PI / 2;
  group.add(pin);
  return group;
}

function makeLootModel(loot) {
  const group = new THREE.Group();
  group.name = `survival-loot-${loot.id}`;
  const glowColor = loot.kind === "weapon" ? 0xffd24b : loot.kind === "fuel" ? 0xff674d : loot.kind === "grenade" ? 0x93d6ff : 0xd1ff75;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.025, 8, 48), lootGlowMaterial(glowColor));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.035;
  ring.userData.survivalGlow = true;
  group.add(ring);

  let model;
  if (loot.kind === "weapon") {
    model = buildWeaponModel(loot.weaponId, loot.slot === "secondary" ? "#6f7580" : "#596c3f");
    model.scale.setScalar(loot.slot === "secondary" ? 0.58 : 0.42);
    model.rotation.set(-0.08, Math.PI / 2, -0.08);
    model.position.y = 0.46;
    attachWeaponLootAsset(group, model, loot.weaponId);
  } else if (loot.kind === "fuel") {
    model = makeFuelCan();
    attachSurvivalLootAsset(group, model, "GasCan.fbx", { targetHeight: 0.82, tint: 0xb6382c });
  } else if (loot.kind === "medkit") {
    model = makeMedkitModel();
    attachSurvivalLootAsset(group, model, "FirstAidKit.fbx", { targetHeight: 0.58, tint: 0xe1e1d4 });
  } else if (loot.kind === "grenade") {
    model = makeGrenadeModel(GRENADES[loot.grenadeId]?.color || 0xdddddd);
  } else {
    model = makeAmmoCrate();
  }
  model.traverse?.((child) => {
    child.userData.ignoreRaycast = true;
    if (child.isMesh) child.receiveShadow = true;
  });
  group.add(model);
  group.add(makeLabel(labelForLoot(loot)));
  return { group, model, ring, target: loot };
}

function zombieTexture() {
  if (!zombieAtlasPromise) {
    zombieAtlasPromise = new THREE.TextureLoader().loadAsync("./assets/models/quaternius/zombie-apocalypse/Zombie_Atlas.png")
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = true;
        texture.anisotropy = 4;
        return texture;
      })
      .catch(() => null);
  }
  return zombieAtlasPromise;
}

function zombieSource(kind) {
  const modelKind = ZOMBIE_MODEL_KIND[kind] || kind || "basic";
  const file = ZOMBIE_ASSETS[modelKind] || ZOMBIE_ASSETS.basic;
  if (!zombieSourcePromises.has(file)) {
    zombieSourcePromises.set(file, zombieGltfLoader.loadAsync(`${ZOMBIE_ASSET_ROOT}${file}`));
  }
  return zombieSourcePromises.get(file);
}

function makeFallbackZombie(kind = "basic") {
  const group = new THREE.Group();
  const modelKind = ZOMBIE_MODEL_KIND[kind] || kind;
  const skin = ZOMBIE_TINTS[kind] || (modelKind === "ribcage" ? 0x8c947f : modelKind === "chubby" ? 0x6d8068 : 0x536b58);
  const cloth = modelKind === "ribcage" ? 0x473b35 : kind === "runner" ? 0x273227 : 0x303833;
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.88 });
  const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(modelKind === "chubby" ? 0.68 : 0.48, 0.82, 0.3), clothMat);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skinMat);
  head.position.y = 1.72;
  const armGeo = new THREE.BoxGeometry(0.16, 0.72, 0.16);
  const leftArm = new THREE.Mesh(armGeo, skinMat);
  leftArm.position.set(-0.42, 1.22, -0.14);
  leftArm.rotation.x = -0.72;
  const rightArm = new THREE.Mesh(armGeo.clone(), skinMat);
  rightArm.position.set(0.42, 1.22, -0.14);
  rightArm.rotation.x = -0.84;
  const legGeo = new THREE.BoxGeometry(0.19, 0.78, 0.2);
  const leftLeg = new THREE.Mesh(legGeo, clothMat);
  leftLeg.position.set(-0.16, 0.48, 0);
  const rightLeg = new THREE.Mesh(legGeo.clone(), clothMat);
  rightLeg.position.set(0.16, 0.48, 0);
  [torso, head, leftArm, rightArm, leftLeg, rightLeg].forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  group.userData.limbs = { leftArm, rightArm, leftLeg, rightLeg, torso, head };
  return group;
}

function makeZombieHitbox(zombieId, radius, height, head = false) {
  const material = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.001, depthWrite: false });
  material.colorWrite = false;
  const mesh = new THREE.Mesh(
    head ? new THREE.SphereGeometry(radius, 10, 8) : new THREE.BoxGeometry(radius * 2, height, radius * 1.5),
    material
  );
  mesh.name = head ? `survival-zombie-head-${zombieId}` : `survival-zombie-body-${zombieId}`;
  mesh.userData.zombieId = zombieId;
  mesh.userData.isHead = head;
  mesh.userData.ignoreRaycast = false;
  return mesh;
}

function normalizeAssetModel(model, targetHeight = 1.85) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(model);
  model.position.x -= (scaledBounds.min.x + scaledBounds.max.x) / 2;
  model.position.y -= scaledBounds.min.y;
  model.position.z -= (scaledBounds.min.z + scaledBounds.max.z) / 2;
  model.rotation.y = Math.PI;
}

function zombieClip(animations = [], candidates = []) {
  const lookup = new Map(animations.map((clip) => [String(clip.name || "").toLowerCase(), clip]));
  for (const name of candidates) {
    const clip = lookup.get(name.toLowerCase());
    if (clip) return clip;
  }
  return animations[0] || null;
}

function setZombieAssetAction(entry, actionName, fade = 0.14, options = {}) {
  const action = entry.assetActions?.[actionName] || entry.assetActions?.idle || entry.assetActions?.move;
  if (!action || (entry.assetAction === action && !options.forceReset)) return;
  action.enabled = true;
  if (options.forceReset && entry.assetAction === action) action.stop();
  action.reset();
  const once = options.once || actionName === "death" || actionName === "attack";
  if (once) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = actionName === "death";
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }
  action.setEffectiveWeight(1);
  if (entry.assetAction && entry.assetAction !== action && fade > 0) {
    entry.assetAction.fadeOut(fade);
    action.fadeIn(fade).play();
  } else {
    action.play();
  }
  entry.assetAction = action;
  entry.assetActionName = actionName;
}

function prepareZombieAssetAnimations(entry, model, animations = []) {
  if (!animations.length) return;
  const mixer = new THREE.AnimationMixer(model);
  const makeAction = (clip) => (clip ? mixer.clipAction(clip, model) : null);
  entry.assetMixer = mixer;
  entry.assetActions = {
    idle: makeAction(zombieClip(animations, ["Idle"])),
    move: makeAction(zombieClip(animations, ["Run_Arms", "Run", "Walk"])),
    attack: makeAction(zombieClip(animations, ["Punch", "Idle_Attack", "Run_Attack"])),
    death: makeAction(zombieClip(animations, ["Death"]))
  };
  Object.values(entry.assetActions).forEach((action) => {
    if (!action) return;
    action.enabled = true;
    action.weight = 0;
  });
  setZombieAssetAction(entry, "idle", 0);
}

function collectZombieAssetRig(model) {
  const bones = new Map();
  model.traverse((child) => {
    if (!child.isBone) return;
    bones.set(child.name, child);
    child.userData.survivalBaseRotation = child.rotation.clone();
    child.userData.survivalBasePosition = child.position.clone();
  });
  return {
    hips: bones.get("Hips"),
    abdomen: bones.get("Abdomen"),
    torso: bones.get("Torso") || bones.get("Body"),
    neck: bones.get("Neck"),
    head: bones.get("Head"),
    upperArmL: bones.get("UpperArm.L"),
    upperArmR: bones.get("UpperArm.R"),
    lowerArmL: bones.get("LowerArm.L"),
    lowerArmR: bones.get("LowerArm.R"),
    upperLegL: bones.get("UpperLeg.L"),
    upperLegR: bones.get("UpperLeg.R"),
    lowerLegL: bones.get("LowerLeg.L"),
    lowerLegR: bones.get("LowerLeg.R"),
    footL: bones.get("Foot.L"),
    footR: bones.get("Foot.R")
  };
}

function poseBone(bone, x = 0, y = 0, z = 0) {
  if (!bone) return;
  const base = bone.userData.survivalBaseRotation;
  if (!base) return;
  bone.rotation.set(base.x + x, base.y + y, base.z + z);
}

function poseBonePosition(bone, x = 0, y = 0, z = 0) {
  if (!bone) return;
  const base = bone.userData.survivalBasePosition;
  if (!base) return;
  bone.position.set(base.x + x, base.y + y, base.z + z);
}

function animateZombieAssetRig(entry, isMoving, pulse, bob, now, isAttacking = false) {
  const rig = entry.assetRig;
  if (!rig) return;
  const speed = Math.max(0.75, Number(entry.target.speedMul) || 1);
  const stride = isMoving ? 0.72 : 0.12;
  const armStride = isMoving ? 0.46 : 0.08;
  const leg = Math.sin(pulse * 1.75);
  const arm = Math.sin(pulse * 1.55 + Math.PI);
  poseBonePosition(rig.hips, 0, bob * 0.55, 0);
  poseBone(rig.hips, Math.sin(pulse * 0.9) * (isMoving ? 0.035 : 0.012), 0, Math.sin(pulse) * (isMoving ? 0.08 : 0.025));
  poseBone(rig.abdomen, Math.sin(pulse * 0.8 + 0.6) * (isMoving ? 0.06 : 0.022), 0, Math.sin(pulse * 0.9) * (isMoving ? -0.055 : -0.018));
  poseBone(rig.torso, -0.12 + Math.sin(pulse * 1.05) * (isMoving ? 0.08 : 0.03), 0, Math.sin(pulse * 0.95) * (isMoving ? 0.06 : 0.02));
  poseBone(rig.neck, Math.sin(now * 0.003 + entry.phase) * 0.03, 0, 0);
  poseBone(rig.head, Math.sin(now * 0.0027 + entry.phase) * 0.045, Math.sin(now * 0.0021 + entry.phase) * 0.045, 0);
  poseBone(rig.upperLegL, leg * stride, 0, 0);
  poseBone(rig.upperLegR, -leg * stride, 0, 0);
  poseBone(rig.lowerLegL, Math.max(0, -leg) * stride * 0.72, 0, 0);
  poseBone(rig.lowerLegR, Math.max(0, leg) * stride * 0.72, 0, 0);
  poseBone(rig.footL, Math.max(0, leg) * 0.18 * speed, 0, 0);
  poseBone(rig.footR, Math.max(0, -leg) * 0.18 * speed, 0, 0);
  poseBone(rig.upperArmL, -0.74 + arm * armStride, 0, -0.18);
  poseBone(rig.upperArmR, -0.78 - arm * armStride, 0, 0.18);
  poseBone(rig.lowerArmL, -0.38 + Math.sin(pulse * 1.7) * (isMoving ? 0.16 : 0.05), 0, 0);
  poseBone(rig.lowerArmR, -0.42 - Math.sin(pulse * 1.7) * (isMoving ? 0.16 : 0.05), 0, 0);
  if (isAttacking) {
    const progress = THREE.MathUtils.clamp(1 - ((entry.attackUntil || now) - now) / 720, 0, 1);
    const strike = Math.sin(progress * Math.PI);
    poseBone(rig.torso, -0.22 - strike * 0.2, 0, Math.sin(pulse) * 0.04);
    poseBone(rig.head, 0.12 + strike * 0.08, Math.sin(now * 0.01) * 0.08, 0);
    poseBone(rig.upperArmL, -1.34 + strike * 0.32, 0, -0.26);
    poseBone(rig.upperArmR, -1.38 + strike * 0.34, 0, 0.26);
    poseBone(rig.lowerArmL, -0.32 - strike * 0.42, 0, 0);
    poseBone(rig.lowerArmR, -0.34 - strike * 0.42, 0, 0);
  }
}

async function attachQuaterniusZombie(entry, kind) {
  try {
    const source = await zombieSource(kind);
    if (!entry.root.parent) return;
    const model = cloneSkeleton(source.scene);
    model.name = `quaternius-${kind || "basic"}-zombie`;
    normalizeAssetModel(model, ZOMBIE_HEIGHTS[kind] || ZOMBIE_HEIGHTS.basic);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.zombieId = entry.id;
      const material = child.material?.clone?.() || new THREE.MeshStandardMaterial();
      const tint = ZOMBIE_TINTS[kind];
      if (tint && material.color) material.color.lerp(new THREE.Color(tint), 0.36);
      material.roughness = 0.86;
      material.metalness = 0.02;
      material.needsUpdate = true;
      child.material = material;
    });
    entry.fallback.visible = false;
    entry.assetModel = model;
    entry.assetBaseY = model.position.y;
    entry.assetRig = collectZombieAssetRig(model);
    prepareZombieAssetAnimations(entry, model, source.animations || []);
    entry.root.add(model);
  } catch (error) {
    console.warn("Zombie Quaternius nao carregou, usando fallback low-poly:", error);
  }
}

function makeZombieEntry(zombie, terrainHeightAt) {
  const root = new THREE.Group();
  root.name = `survival-zombie-${zombie.id}`;
  const modelKind = ZOMBIE_MODEL_KIND[zombie.kind] || zombie.kind;
  const fallback = makeFallbackZombie(zombie.kind);
  fallback.scale.setScalar(modelKind === "chubby" ? 0.88 : 0.86);
  root.add(fallback);
  const bodyHitbox = makeZombieHitbox(zombie.id, modelKind === "chubby" ? 0.42 : 0.31, 1.02, false);
  bodyHitbox.position.y = 0.86;
  const headHitbox = makeZombieHitbox(zombie.id, 0.2, 0.22, true);
  headHitbox.position.y = 1.46;
  root.add(bodyHitbox, headHitbox);
  const y = terrainY(terrainHeightAt, zombie.x, zombie.z, zombie.y);
  root.position.set(zombie.x || 0, y, zombie.z || 0);
  root.rotation.y = Number(zombie.yaw) || 0;
  const entry = {
    id: zombie.id,
    root,
    fallback,
    target: { ...zombie, y },
    hittable: [bodyHitbox, headHitbox],
    phase: Math.random() * Math.PI * 2,
    walkPhase: Math.random() * Math.PI * 2,
    lastFramePosition: new THREE.Vector3(zombie.x || 0, y, zombie.z || 0),
    deadAt: 0,
    deathStarted: false,
    attackUntil: 0
  };
  zombieHittable.push(bodyHitbox, headHitbox);
  attachQuaterniusZombie(entry, zombie.kind || "basic");
  return entry;
}

export function clearSurvivalWorld() {
  lootEntries.forEach((entry) => entry.group.parent?.remove(entry.group));
  zombieEntries.forEach((entry) => entry.root.parent?.remove(entry.root));
  lootEntries.clear();
  zombieEntries.clear();
  zombieHittable.length = 0;
}

export function syncSurvivalLoot(scene, lootList = [], terrainHeightAt = null) {
  const activeIds = new Set();
  lootList.filter((loot) => loot && loot.active !== false).forEach((loot) => {
    activeIds.add(loot.id);
    let entry = lootEntries.get(loot.id);
    if (!entry) {
      entry = makeLootModel(loot);
      lootEntries.set(loot.id, entry);
      scene.add(entry.group);
    }
    const y = terrainY(terrainHeightAt, loot.x, loot.z, loot.y) + 0.04;
    entry.target = { ...loot, y };
    entry.group.position.set(Number(loot.x) || 0, y, Number(loot.z) || 0);
  });
  lootEntries.forEach((entry, id) => {
    if (activeIds.has(id)) return;
    entry.group.parent?.remove(entry.group);
    lootEntries.delete(id);
  });
}

export function removeSurvivalLoot(lootId) {
  const entry = lootEntries.get(lootId);
  if (!entry) return;
  entry.group.parent?.remove(entry.group);
  lootEntries.delete(lootId);
}

function syncZombieEntry(scene, zombie, terrainHeightAt = null, options = {}) {
  if (!zombie?.id) return null;
  let entry = zombieEntries.get(zombie.id);
  if (!entry) {
    entry = makeZombieEntry(zombie, terrainHeightAt);
    zombieEntries.set(zombie.id, entry);
    scene.add(entry.root);
  }
  const x = Number(zombie.x) || 0;
  const z = Number(zombie.z) || 0;
  const y = terrainY(terrainHeightAt, x, z, zombie.y);
  const serverPosition = new THREE.Vector3(x, y, z);
  if (zombie.alive === false) {
    if (!entry.deadAt) {
      entry.deadAt = performance.now();
      entry.deathStarted = false;
      entry.attackUntil = 0;
      entry.target = {
        ...zombie,
        x: entry.root.position.x,
        y: entry.root.position.y,
        z: entry.root.position.z,
        yaw: entry.root.rotation.y,
        moving: false
      };
    }
    return entry;
  }

  const syncNow = performance.now();
  const previousTarget = entry.target || {};
  const syncDt = Math.max(0.001, (syncNow - (entry.lastSyncAt || syncNow)) / 1000);
  const previousX = Number(previousTarget.x);
  const previousY = Number(previousTarget.y);
  const previousZ = Number(previousTarget.z);
  if (Number.isFinite(previousX) && Number.isFinite(previousY) && Number.isFinite(previousZ)) {
    entry.targetVelocity = new THREE.Vector3(
      (x - previousX) / syncDt,
      (y - previousY) / syncDt,
      (z - previousZ) / syncDt
    ).clampLength(0, 4.2 * Math.max(1, Number(zombie.speedMul) || 1));
  }
  entry.lastSyncAt = syncNow;
  entry.deadAt = 0;
  entry.deathStarted = false;
  entry.target = { ...zombie, x, y, z };

  const visualDistance = entry.root.position.distanceTo(serverPosition);
  if (options.snap || visualDistance > 9) {
    entry.root.position.copy(serverPosition);
    if (entry.lastFramePosition) entry.lastFramePosition.copy(serverPosition);
    if (entry.targetVelocity) entry.targetVelocity.set(0, 0, 0);
  }
  return entry;
}

export function syncSurvivalZombies(scene, zombies = [], terrainHeightAt = null) {
  const activeIds = new Set();
  zombies.forEach((zombie) => {
    if (!zombie?.id) return;
    activeIds.add(zombie.id);
    syncZombieEntry(scene, zombie, terrainHeightAt);
  });
  zombieEntries.forEach((entry, id) => {
    if (activeIds.has(id)) return;
    entry.root.parent?.remove(entry.root);
    entry.hittable.forEach((mesh) => {
      const index = zombieHittable.indexOf(mesh);
      if (index >= 0) zombieHittable.splice(index, 1);
    });
    zombieEntries.delete(id);
  });
}

export function syncSurvivalZombie(scene, zombie, terrainHeightAt = null, options = {}) {
  syncZombieEntry(scene, zombie, terrainHeightAt, { snap: true, ...options });
}

export function playSurvivalZombieAttack(zombieId) {
  const entry = zombieEntries.get(zombieId);
  if (!entry || entry.target?.alive === false) return;
  const now = performance.now();
  entry.attackUntil = now + 720;
  if (entry.assetMixer && entry.assetActions?.attack) {
    setZombieAssetAction(entry, "attack", 0.06, { forceReset: true, once: true });
    if (entry.assetAction) entry.assetAction.timeScale = 1.08 * Math.max(0.85, Number(entry.target.speedMul) || 1);
  }
}

export function updateSurvivalWorld(delta, now = performance.now()) {
  lootEntries.forEach((entry) => {
    entry.group.rotation.y += delta * 0.85;
    entry.group.position.y = entry.target.y + Math.sin(now * 0.003 + entry.group.id) * 0.06;
    entry.ring.material.opacity = 0.36 + Math.sin(now * 0.006 + entry.group.id) * 0.16;
    reusableColor.setHex(entry.ring.material.color.getHex()).offsetHSL(0, 0, Math.sin(now * 0.004) * 0.02);
  });

  zombieEntries.forEach((entry) => {
    const alive = entry.target.alive !== false;
    const targetPosition = new THREE.Vector3(entry.target.x || 0, entry.target.y || 0, entry.target.z || 0);
    if (alive && entry.target.moving && entry.targetVelocity && entry.lastSyncAt) {
      targetPosition.addScaledVector(entry.targetVelocity, Math.min(0.12, (now - entry.lastSyncAt) / 1000));
    }
    const distanceToTarget = entry.root.position.distanceTo(targetPosition);
    if (alive) {
      if (distanceToTarget > 7) {
        entry.root.position.copy(targetPosition);
      } else {
        entry.root.position.lerp(targetPosition, Math.min(1, delta * (distanceToTarget > 2.2 ? 18 : 12)));
      }
    }
    const yaw = Number(entry.target.yaw) || 0;
    let yawDelta = yaw - entry.root.rotation.y;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    if (alive) entry.root.rotation.y += yawDelta * Math.min(1, delta * 8);
    const frameDistance = entry.root.position.distanceTo(entry.lastFramePosition || entry.root.position);
    if (entry.lastFramePosition) entry.lastFramePosition.copy(entry.root.position);
    const isAttacking = alive && Number(entry.attackUntil || 0) > now;
    const isMoving = alive && !isAttacking && (Boolean(entry.target.moving) || frameDistance > 0.006 || distanceToTarget > 0.08);
    entry.walkPhase += (isMoving ? Math.min(11, frameDistance / Math.max(0.001, delta)) * 0.19 + 3.1 : 0.65) * delta * Math.max(0.75, Number(entry.target.speedMul) || 1);
    const pulse = entry.walkPhase + entry.phase;
    const speed = Math.max(0, Number(entry.target.speedMul) || 1);
    const bob = isMoving ? Math.abs(Math.sin(pulse * 1.25)) * 0.045 : Math.sin(now * 0.0024 + entry.phase) * 0.012;
    entry.fallback.position.y = bob;
    if (alive) {
      entry.root.rotation.z = Math.sin(pulse * speed) * (isMoving ? 0.05 : 0.018);
      const limbs = entry.fallback.userData.limbs;
      if (limbs) {
        const stride = isMoving ? 0.48 : 0.08;
        limbs.leftLeg.rotation.x = Math.sin(pulse * 1.55) * stride;
        limbs.rightLeg.rotation.x = -Math.sin(pulse * 1.55) * stride;
        if (isAttacking) {
          const strike = Math.sin(THREE.MathUtils.clamp(1 - ((entry.attackUntil || now) - now) / 720, 0, 1) * Math.PI);
          limbs.leftArm.rotation.x = -1.38 + strike * 0.28;
          limbs.rightArm.rotation.x = -1.42 + strike * 0.3;
          limbs.torso.rotation.x = -0.18 - strike * 0.16;
        } else {
          limbs.leftArm.rotation.x = -0.82 + Math.sin(pulse * 1.35) * (isMoving ? 0.18 : 0.05);
          limbs.rightArm.rotation.x = -0.92 - Math.sin(pulse * 1.35) * (isMoving ? 0.18 : 0.05);
          limbs.torso.rotation.x = 0;
        }
        limbs.head.rotation.z = Math.sin(pulse * 0.7) * 0.06;
      }
      if (entry.assetModel) {
        entry.assetModel.position.y = (entry.assetBaseY || 0) + bob;
        entry.assetModel.rotation.z = Math.sin(pulse * 1.1) * (isMoving ? 0.042 : 0.015);
      }
      if (entry.assetMixer) {
        setZombieAssetAction(entry, isAttacking ? "attack" : isMoving ? "move" : "idle", isAttacking ? 0.06 : 0.14, { once: isAttacking });
        const actionSpeed = (isAttacking ? 1.08 : isMoving ? 0.92 : 0.72) * Math.max(0.75, Number(entry.target.speedMul) || 1);
        if (entry.assetAction) entry.assetAction.timeScale = actionSpeed;
        entry.assetMixer.update(delta);
      }
      animateZombieAssetRig(entry, isMoving, pulse, bob, now, isAttacking);
    } else {
      if (entry.assetMixer) {
        if (!entry.deathStarted) {
          setZombieAssetAction(entry, "death", 0.08, { forceReset: true, once: true });
          entry.deathStarted = true;
        }
        entry.assetMixer.update(delta);
      }
      entry.root.rotation.z = THREE.MathUtils.lerp(entry.root.rotation.z, 1.32, Math.min(1, delta * 4));
      entry.hittable.forEach((mesh) => { mesh.visible = false; });
      if (entry.deadAt && now - entry.deadAt > ZOMBIE_CORPSE_CLIENT_MS) {
        entry.root.parent?.remove(entry.root);
        entry.hittable.forEach((mesh) => {
          const index = zombieHittable.indexOf(mesh);
          if (index >= 0) zombieHittable.splice(index, 1);
        });
        zombieEntries.delete(entry.id);
      }
    }
  });
}

export function gatherSurvivalZombieHittable() {
  return zombieHittable.filter((mesh) => mesh.parent?.parent && mesh.visible !== false);
}

export function nearestSurvivalLoot(position, maxDistance = 3.2) {
  let nearest = null;
  let nearestDistance = maxDistance;
  lootEntries.forEach((entry) => {
    const distance = Math.hypot(position.x - entry.group.position.x, position.z - entry.group.position.z);
    if (distance < nearestDistance && Math.abs(position.y - entry.group.position.y) < 4) {
      nearest = entry.target;
      nearestDistance = distance;
    }
  });
  return nearest;
}
