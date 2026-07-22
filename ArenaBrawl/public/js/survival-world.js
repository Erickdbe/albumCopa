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
  arm: "Zombie_Basic.gltf"
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
  const file = ZOMBIE_ASSETS[kind] || ZOMBIE_ASSETS.basic;
  if (!zombieSourcePromises.has(file)) {
    zombieSourcePromises.set(file, zombieGltfLoader.loadAsync(`${ZOMBIE_ASSET_ROOT}${file}`));
  }
  return zombieSourcePromises.get(file);
}

function makeFallbackZombie(kind = "basic") {
  const group = new THREE.Group();
  const skin = kind === "ribcage" ? 0x8c947f : kind === "chubby" ? 0x6d8068 : 0x536b58;
  const cloth = kind === "ribcage" ? 0x473b35 : 0x303833;
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.88 });
  const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(kind === "chubby" ? 0.68 : 0.48, 0.82, 0.3), clothMat);
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

async function attachQuaterniusZombie(entry, kind) {
  try {
    const source = await zombieSource(kind);
    if (!entry.root.parent) return;
    const model = cloneSkeleton(source.scene);
    model.name = `quaternius-${kind || "basic"}-zombie`;
    normalizeAssetModel(model, kind === "chubby" ? 1.9 : 1.84);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.userData.zombieId = entry.id;
      const material = child.material?.clone?.() || new THREE.MeshStandardMaterial();
      material.roughness = 0.86;
      material.metalness = 0.02;
      material.needsUpdate = true;
      child.material = material;
    });
    entry.fallback.visible = false;
    entry.assetModel = model;
    entry.root.add(model);
  } catch (error) {
    console.warn("Zombie Quaternius nao carregou, usando fallback low-poly:", error);
  }
}

function makeZombieEntry(zombie, terrainHeightAt) {
  const root = new THREE.Group();
  root.name = `survival-zombie-${zombie.id}`;
  const fallback = makeFallbackZombie(zombie.kind);
  root.add(fallback);
  const bodyHitbox = makeZombieHitbox(zombie.id, zombie.kind === "chubby" ? 0.46 : 0.34, 1.15, false);
  bodyHitbox.position.y = 0.98;
  const headHitbox = makeZombieHitbox(zombie.id, 0.24, 0.24, true);
  headHitbox.position.y = 1.68;
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
    deadAt: 0
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

export function syncSurvivalZombies(scene, zombies = [], terrainHeightAt = null) {
  const activeIds = new Set();
  zombies.forEach((zombie) => {
    if (!zombie?.id) return;
    activeIds.add(zombie.id);
    let entry = zombieEntries.get(zombie.id);
    if (!entry) {
      entry = makeZombieEntry(zombie, terrainHeightAt);
      zombieEntries.set(zombie.id, entry);
      scene.add(entry.root);
    }
    const y = terrainY(terrainHeightAt, zombie.x, zombie.z, zombie.y);
    entry.target = { ...zombie, y };
    if (zombie.alive === false && !entry.deadAt) entry.deadAt = performance.now();
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
    entry.root.position.lerp(targetPosition, Math.min(1, delta * (alive ? 7.5 : 3.5)));
    const yaw = Number(entry.target.yaw) || 0;
    let yawDelta = yaw - entry.root.rotation.y;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    entry.root.rotation.y += yawDelta * Math.min(1, delta * 8);
    const pulse = now * 0.006 + entry.phase;
    const speed = Math.max(0, Number(entry.target.speedMul) || 1);
    if (alive) {
      entry.root.rotation.z = Math.sin(pulse * speed) * 0.045;
      const limbs = entry.fallback.userData.limbs;
      if (limbs) {
        limbs.leftLeg.rotation.x = Math.sin(pulse * 1.4) * 0.42;
        limbs.rightLeg.rotation.x = -Math.sin(pulse * 1.4) * 0.42;
        limbs.leftArm.rotation.x = -0.82 + Math.sin(pulse * 1.2) * 0.12;
        limbs.rightArm.rotation.x = -0.92 - Math.sin(pulse * 1.2) * 0.12;
        limbs.head.rotation.z = Math.sin(pulse * 0.7) * 0.06;
      }
      if (entry.assetModel) {
        entry.assetModel.rotation.z = Math.sin(pulse * 1.1) * 0.035;
      }
    } else {
      entry.root.rotation.z = THREE.MathUtils.lerp(entry.root.rotation.z, 1.32, Math.min(1, delta * 4));
      entry.hittable.forEach((mesh) => { mesh.visible = false; });
      if (entry.deadAt && now - entry.deadAt > 1800) {
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
