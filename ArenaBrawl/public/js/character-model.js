import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { loadSketchbookCharacter } from "./sketchbook-assets.js";

const MODEL_ROOTS = {
  emberbound: "./assets/models/emberbound/",
  scout: "./assets/models/scout/"
};
const FPS_CHARACTER_PACK = "./assets/models/fps-characters/arena_brawl_fps_characters_enhanced_export.glb";
const HUMAN_SOLDIER_ROOT = "./assets/models/human-soldier";
const SHARED_ANIMATIONS = {
  idle: `${MODEL_ROOTS.emberbound}idle.gltf`,
  walk: `${MODEL_ROOTS.emberbound}walk.gltf`,
  run: `${MODEL_ROOTS.emberbound}run.gltf`,
  crouch: `${MODEL_ROOTS.emberbound}crouch.gltf`,
  death: `${MODEL_ROOTS.emberbound}death.gltf`,
  dance: `${MODEL_ROOTS.scout}dance.gltf`
};
const characterModelPromises = new Map();
let sharedClipsPromise = null;
let sketchbookCharacterPromise = null;
let fpsCharacterPackPromise = null;
const humanSoldierPackPromises = new Map();
const oneShotTimers = new WeakMap();
const aimStopTimers = new WeakMap();
const poseEuler = new THREE.Euler();
const poseQuaternion = new THREE.Quaternion();
const ikJointPosition = new THREE.Vector3();
const ikEffectorPosition = new THREE.Vector3();
const ikTargetPosition = new THREE.Vector3();
const ikCurrentDirection = new THREE.Vector3();
const ikTargetDirection = new THREE.Vector3();
const ikParentWorldQuaternion = new THREE.Quaternion();
const ikDeltaWorldQuaternion = new THREE.Quaternion();
const ikDeltaLocalQuaternion = new THREE.Quaternion();
const ikDesiredQuaternion = new THREE.Quaternion();

function loadTexture(loader, root, name) {
  return loader.loadAsync(`${root}${name}`).then((texture) => {
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

async function loadCharacterModel(characterId) {
  const root = MODEL_ROOTS[characterId] || MODEL_ROOTS.emberbound;
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const [base, normalMap, metalnessMap, roughnessMap] = await Promise.all([
    loader.loadAsync(`${root}character.gltf`),
    loadTexture(textureLoader, root, "normal.jpg"),
    loadTexture(textureLoader, root, "metallic.jpg"),
    loadTexture(textureLoader, root, "roughness.jpg")
  ]);

  base.scene.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const prepared = materials.map((source) => {
      const material = source.clone();
      material.normalMap = normalMap;
      material.metalnessMap = metalnessMap;
      material.roughnessMap = roughnessMap;
      material.metalness = 1;
      material.roughness = 1;
      material.emissiveMap = null;
      material.emissive?.set(0x000000);
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? prepared : prepared[0];
  });

  const bounds = new THREE.Box3().setFromObject(base.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? 1.82 / size.y : 1;
  base.scene.scale.multiplyScalar(scale);
  base.scene.position.y = -bounds.min.y * scale;
  base.scene.rotation.y = Math.PI;

  return base.scene;
}

function characterModel(characterId) {
  if (!characterModelPromises.has(characterId)) {
    characterModelPromises.set(characterId, loadCharacterModel(characterId));
  }
  return characterModelPromises.get(characterId);
}

function sharedClips() {
  if (!sharedClipsPromise) {
    const loader = new GLTFLoader();
    sharedClipsPromise = Promise.all(Object.entries(SHARED_ANIMATIONS).map(async ([name, url]) => {
      const asset = await loader.loadAsync(url);
      return [name, asset.animations[0]];
    })).then((entries) => Object.fromEntries(entries));
  }
  return sharedClipsPromise;
}

async function loadFpsCharacterPack() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(FPS_CHARACTER_PACK);
  gltf.scene.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const prepared = materials.map((source) => {
      const material = source.clone();
      material.roughness = Math.min(0.9, Math.max(0.42, material.roughness ?? 0.58));
      material.metalness = Math.min(0.45, material.metalness ?? 0.08);
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? prepared : prepared[0];
  });
  return { model: gltf.scene, animations: gltf.animations };
}

function animationClipMap(animations) {
  return new Map(animations.map((clip) => [clip.name, clip]));
}

function firstClip(byName, names) {
  for (const name of names) {
    const clip = byName.get(name);
    if (clip) return clip;
  }
  return null;
}

function clipForFpsCharacter(sourceClip, characterId, targetRoot = null) {
  if (!sourceClip) return null;
  if (targetRoot) {
    const nodeNames = new Set();
    targetRoot.traverse((object) => {
      if (object.name) nodeNames.add(object.name);
    });
    const tracks = sourceClip.tracks
      .filter((track) => nodeNames.has(track.name.split(".")[0]))
      .map((track) => track.clone());
    if (tracks.length > 0) {
      return new THREE.AnimationClip(`${sourceClip.name}_${characterId}`, sourceClip.duration, tracks);
    }
  }

  const useSecondRigTracks = characterId === "fps_female";
  const hasAutoSuffixedRigTracks = sourceClip.tracks.some((track) => /_\d+\./.test(track.name));
  if (hasAutoSuffixedRigTracks) {
    const tracks = sourceClip.tracks
      .filter((track) => {
        const nodeName = track.name.split(".")[0];
        const isSuffixed = /_\d+$/.test(nodeName);
        return useSecondRigTracks ? isSuffixed : !isSuffixed;
      })
      .map((track) => track.clone());
    return new THREE.AnimationClip(`${sourceClip.name}_${characterId}`, sourceClip.duration, tracks);
  }

  const totals = new Map();
  sourceClip.tracks.forEach((track) => {
    totals.set(track.name, (totals.get(track.name) || 0) + 1);
  });

  const seen = new Map();
  const tracks = [];
  sourceClip.tracks.forEach((track) => {
    const index = seen.get(track.name) || 0;
    seen.set(track.name, index + 1);
    const total = totals.get(track.name) || 1;
    if (total === 1 || index === (useSecondRigTracks ? 1 : 0)) {
      tracks.push(track.clone());
    }
  });

  return new THREE.AnimationClip(`${sourceClip.name}_${characterId}`, sourceClip.duration, tracks);
}

function applyTeamTint(model, team) {
  const color = team === "red" ? new THREE.Color("#e05555") : new THREE.Color("#4d8fe0");
  model.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      const name = `${material.name || ""} ${child.name || ""}`.toLowerCase();
      if (name.includes("team") || name.includes("accent") || name.includes("highlight")) {
        material.color?.lerp(color, 0.72);
        material.needsUpdate = true;
      }
    });
  });
}

function prepareFpsCharacterScene(sourceModel, characterId, team) {
  const isFemale = characterId === "fps_female";
  const selectedName = isFemale ? "Character_FemaleSoldier" : "Character_MaleSoldier";
  const selectedSource = sourceModel.getObjectByName(selectedName) || sourceModel;
  const selectedRoot = cloneSkeleton(selectedSource);
  selectedRoot.visible = true;

  const model = new THREE.Group();
  model.name = `${characterId}-character`;
  model.add(selectedRoot);

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? 1.82 / size.y : 1;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(model);
  model.position.x -= (scaledBounds.min.x + scaledBounds.max.x) / 2;
  model.position.y -= scaledBounds.min.y;
  model.position.z -= (scaledBounds.min.z + scaledBounds.max.z) / 2;

  // Blender exports the soldier facing the opposite direction from Arena Brawl's avatar yaw.
  // Keep this as an outer transform so animation tracks cannot overwrite it.
  const facingGroup = new THREE.Group();
  facingGroup.name = `${characterId}-character-facing`;
  facingGroup.rotation.y = Math.PI;
  facingGroup.add(model);
  applyTeamTint(facingGroup, team);
  return facingGroup;
}

function attachWeaponToFpsSocket(avatar, model, characterId) {
  const prefix = characterId === "fps_female" ? "Female" : "Male";
  const socket = model.getObjectByName(`${prefix}_socket_weapon_right_hand`);
  if (socket) {
    socket.add(avatar.gun);
    avatar.gun.position.set(0, 0, 0);
    avatar.gun.rotation.set(0, 0, 0);
    avatar.gun.scale.setScalar(0.28);
  } else {
    avatar.root.attach(avatar.gun);
    avatar.gun.position.set(0.3, 1.15, -0.38);
    avatar.gun.rotation.set(-0.12, 0, 0);
    avatar.gun.scale.setScalar(0.34);
  }
  avatar.gun.visible = true;
}

function humanSoldierDescriptor(characterId) {
  const female = characterId === "fps_female";
  return {
    gender: female ? "Female" : "Male",
    prefix: female ? "HumanF" : "HumanM",
    model: female ? "HumanF_Model.fbx" : "HumanM_Model.fbx",
    height: female ? 1.74 : 1.82
  };
}

function humanSoldierAnimationFiles({ gender, prefix }) {
  const root = `${HUMAN_SOLDIER_ROOT}/animations/${gender}`;
  return {
    idle: `${root}/Idles/${prefix}@MilitaryIdle01.fbx`,
    walk_forward: `${root}/Movement/Walk/${prefix}@Walk01_Forward.fbx`,
    walk_forward_left: `${root}/Movement/Walk/${prefix}@Walk01_ForwardLeft.fbx`,
    walk_forward_right: `${root}/Movement/Walk/${prefix}@Walk01_ForwardRight.fbx`,
    walk_left: `${root}/Movement/Walk/${prefix}@Walk01_Left.fbx`,
    walk_right: `${root}/Movement/Walk/${prefix}@Walk01_Right.fbx`,
    walk_back: `${root}/Movement/Walk/${prefix}@Walk01_Backward.fbx`,
    walk_back_left: `${root}/Movement/Walk/${prefix}@Walk01_BackwardLeft.fbx`,
    walk_back_right: `${root}/Movement/Walk/${prefix}@Walk01_BackwardRight.fbx`,
    run_forward: `${root}/Movement/Run/${prefix}@Run01_Forward.fbx`,
    run_forward_left: `${root}/Movement/Run/${prefix}@Run01_ForwardLeft.fbx`,
    run_forward_right: `${root}/Movement/Run/${prefix}@Run01_ForwardRight.fbx`,
    run_left: `${root}/Movement/Run/${prefix}@Run01_Left.fbx`,
    run_right: `${root}/Movement/Run/${prefix}@Run01_Right.fbx`,
    run_back: `${root}/Movement/Run/${prefix}@Run01_Backward.fbx`,
    run_back_left: `${root}/Movement/Run/${prefix}@Run01_BackwardLeft.fbx`,
    run_back_right: `${root}/Movement/Run/${prefix}@Run01_BackwardRight.fbx`,
    damage: `${root}/Combat/${prefix}@Damage01.fbx`,
    death: `${root}/Combat/${prefix}@Death01.fbx`,
    grenade: `${root}/Combat/Grenade/${prefix}@ThrowGrenade01_L.fbx`,
    aim_assault: `${root}/Combat/AssaultRifle/${prefix}@AssaultRifle_Aim01.fbx`,
    shoot_assault: `${root}/Combat/AssaultRifle/${prefix}@AssaultRifle_Aim01_Shoot01.fbx`,
    reload_assault: `${root}/Combat/AssaultRifle/${prefix}@AssaultRifle_Reload01.fbx`,
    aim_rifle: `${root}/Combat/Rifle/${prefix}@Rifle_Aim01.fbx`,
    shoot_rifle: `${root}/Combat/Rifle/${prefix}@Rifle_Aim01_Shoot01.fbx`,
    reload_rifle: `${root}/Combat/Rifle/${prefix}@Rifle_Reload01.fbx`,
    aim_gun: `${root}/Combat/Gun/${prefix}@Gun_Aim01.fbx`,
    shoot_gun: `${root}/Combat/Gun/${prefix}@Gun_Aim01_Shoot01.fbx`,
    reload_gun: `${root}/Combat/Gun/${prefix}@Gun_Reload01.fbx`,
    aim_bazooka: `${root}/Combat/Bazooka/${prefix}@Bazooka_Aim01.fbx`,
    shoot_bazooka: `${root}/Combat/Bazooka/${prefix}@Bazooka_Aim01_Shoot01.fbx`,
    reload_bazooka: `${root}/Combat/Bazooka/${prefix}@Bazooka_Reload01.fbx`
  };
}

async function loadHumanSoldierPack(characterId) {
  if (!humanSoldierPackPromises.has(characterId)) {
    const descriptor = humanSoldierDescriptor(characterId);
    const loader = new FBXLoader();
    const promise = Promise.all([
      loader.loadAsync(`${HUMAN_SOLDIER_ROOT}/models/${descriptor.model}`),
      Promise.all(Object.entries(humanSoldierAnimationFiles(descriptor)).map(async ([name, url]) => {
        const asset = await loader.loadAsync(url);
        const sourceClip = asset.animations?.[0];
        const upperBodyOnly = name === "grenade" || name.startsWith("aim_") || name.startsWith("shoot_") || name.startsWith("reload_");
        const clip = sourceClip
          ? new THREE.AnimationClip(
            name,
            sourceClip.duration,
            sourceClip.tracks.filter((track) => {
              const nodeName = track.name.split(".")[0];
              if (nodeName === "Rig") return false;
              if (!upperBodyOnly) return true;
              return /^(B-(spine|chest|neck|head|jaw|shoulder|upperArm|forearm|hand|thumb|index|middle|ring|pinky))/.test(nodeName);
            }).map((track) => track.clone())
          )
          : null;
        return [name, clip];
      }))
    ]).then(([model, clipEntries]) => ({
      descriptor,
      model,
      clips: Object.fromEntries(clipEntries.filter(([, clip]) => Boolean(clip)))
    }));
    humanSoldierPackPromises.set(characterId, promise);
  }
  return humanSoldierPackPromises.get(characterId);
}

function prepareHumanSoldierScene(sourceModel, descriptor, team) {
  const model = cloneSkeleton(sourceModel);
  model.name = `${descriptor.prefix}-arena-character`;
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const prepared = materials.map((source) => {
      const material = source.clone();
      const teamColor = new THREE.Color(team === "red" ? "#d95358" : "#3f82d6");
      material.color?.lerp(teamColor, 0.48);
      material.roughness = Math.min(0.92, Math.max(0.48, material.roughness ?? 0.7));
      material.metalness = Math.min(0.25, material.metalness ?? 0.02);
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? prepared : prepared[0];
  });

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? descriptor.height / size.y : 0.01;

  const scaledModel = new THREE.Group();
  scaledModel.name = `${descriptor.prefix}-scaled`;
  scaledModel.scale.setScalar(scale);
  scaledModel.add(model);
  scaledModel.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(scaledModel);
  scaledModel.position.x -= (scaledBounds.min.x + scaledBounds.max.x) / 2;
  scaledModel.position.y -= scaledBounds.min.y;
  scaledModel.position.z -= (scaledBounds.min.z + scaledBounds.max.z) / 2;

  const facingGroup = new THREE.Group();
  facingGroup.name = `${descriptor.prefix}-facing`;
  facingGroup.rotation.y = Math.PI;
  facingGroup.add(scaledModel);
  return facingGroup;
}

function createHumanSoldierJumpClip(model, prefix) {
  const times = [0, 0.12, 0.34, 0.58, 0.82];
  const poses = {
    "B-hips": [[0, 0, 0], [0.08, 0, 0], [0.04, 0, 0], [-0.04, 0, 0], [0, 0, 0]],
    "B-spine": [[0, 0, 0], [0.12, 0, 0], [0.08, 0, 0], [-0.02, 0, 0], [0, 0, 0]],
    "B-chest": [[0, 0, 0], [-0.04, 0, 0], [-0.1, 0, 0], [0.02, 0, 0], [0, 0, 0]],
    "B-thighL": [[-0.08, 0, 0], [-0.72, 0, 0.08], [-0.94, 0, 0.12], [-0.38, 0, 0.04], [0, 0, 0]],
    "B-thighR": [[-0.08, 0, 0], [-0.68, 0, -0.08], [-0.86, 0, -0.12], [-0.34, 0, -0.04], [0, 0, 0]],
    "B-shinL": [[0.12, 0, 0], [1.02, 0, 0], [1.26, 0, 0], [0.58, 0, 0], [0, 0, 0]],
    "B-shinR": [[0.12, 0, 0], [0.96, 0, 0], [1.16, 0, 0], [0.52, 0, 0], [0, 0, 0]],
    "B-footL": [[0, 0, 0], [-0.22, 0, 0], [-0.18, 0, 0], [-0.06, 0, 0], [0, 0, 0]],
    "B-footR": [[0, 0, 0], [-0.2, 0, 0], [-0.16, 0, 0], [-0.05, 0, 0], [0, 0, 0]]
  };
  const tracks = [];
  Object.entries(poses).forEach(([boneName, rotations]) => {
    const bone = model.getObjectByName(boneName);
    if (!bone) return;
    const values = [];
    rotations.forEach(([x, y, z]) => {
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
  });
  return new THREE.AnimationClip(`${prefix}_jump`, times[times.length - 1], tracks);
}

function createHumanSoldierProneClip(model, prefix, crawling = false) {
  const times = crawling ? [0, 0.36, 0.72, 1.08] : [0, 0.8];
  const steady = (value) => [value, value];
  const cycle = (a, b) => [a, b, a, b];
  const poses = {
    "B-hips": crawling
      ? cycle([0.02, -0.08, 0], [0.02, 0.08, 0])
      : steady([0.02, 0, 0]),
    "B-spine": crawling
      ? cycle([-0.08, 0.07, 0], [-0.08, -0.07, 0])
      : steady([-0.08, 0, 0]),
    "B-chest": crawling
      ? cycle([0.1, -0.08, 0], [0.1, 0.08, 0])
      : steady([0.1, 0, 0]),
    "B-neck": steady([-0.16, 0, 0]),
    "B-thighL": crawling
      ? cycle([-0.58, 0, 0.14], [-0.16, 0, 0.08])
      : steady([-0.34, 0, 0.12]),
    "B-thighR": crawling
      ? cycle([-0.16, 0, -0.08], [-0.58, 0, -0.14])
      : steady([-0.34, 0, -0.12]),
    "B-shinL": crawling
      ? cycle([0.92, 0, 0], [0.42, 0, 0])
      : steady([0.66, 0, 0]),
    "B-shinR": crawling
      ? cycle([0.42, 0, 0], [0.92, 0, 0])
      : steady([0.66, 0, 0]),
    "B-footL": steady([-0.2, 0, 0]),
    "B-footR": steady([-0.2, 0, 0])
  };
  const tracks = [];
  Object.entries(poses).forEach(([boneName, rotations]) => {
    const bone = model.getObjectByName(boneName);
    if (!bone) return;
    const values = [];
    rotations.forEach(([x, y, z]) => {
      const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
      const pose = bone.quaternion.clone().multiply(offset).normalize();
      values.push(pose.x, pose.y, pose.z, pose.w);
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
  });
  const name = crawling ? "prone_crawl" : "prone";
  return new THREE.AnimationClip(`${prefix}_${name}`, times[times.length - 1], tracks);
}

function weaponGripPoint(weaponId = "") {
  if (["pistol_common", "heavy_pistol", "auto_pistol_weak", "revolver"].includes(weaponId)) {
    return new THREE.Vector3(0, -0.2, 0);
  }
  if (weaponId === "knife") return new THREE.Vector3(0, 0, 0.16);
  if (weaponId === "bow") return new THREE.Vector3(0, 0, 0);
  return new THREE.Vector3(0, -0.23, 0.24);
}

function weaponSupportPoint(weaponId = "") {
  if (["knife", "bow"].includes(weaponId)) return null;
  if (["pistol_common", "heavy_pistol", "auto_pistol_weak", "revolver"].includes(weaponId)) {
    return new THREE.Vector3(-0.03, -0.12, -0.02);
  }
  if (weaponId === "sniper_rifle") return new THREE.Vector3(-0.02, -0.08, -0.68);
  if (weaponId === "heavy_mg") return new THREE.Vector3(-0.02, -0.12, -0.54);
  if (weaponId === "mini_shotgun") return new THREE.Vector3(-0.02, -0.1, -0.48);
  if (weaponId === "crossbow") return new THREE.Vector3(-0.02, -0.08, -0.42);
  if (weaponId === "smg") return new THREE.Vector3(-0.02, -0.1, -0.36);
  return new THREE.Vector3(-0.02, -0.1, -0.5);
}

function rotateIkJointToward(joint, effector, target, weight) {
  if (!joint?.parent || !effector || weight <= 0) return;
  joint.updateWorldMatrix(true, true);
  effector.getWorldPosition(ikEffectorPosition);
  joint.getWorldPosition(ikJointPosition);
  ikCurrentDirection.copy(ikEffectorPosition).sub(ikJointPosition);
  ikTargetDirection.copy(target).sub(ikJointPosition);
  if (ikCurrentDirection.lengthSq() < 1e-8 || ikTargetDirection.lengthSq() < 1e-8) return;
  ikCurrentDirection.normalize();
  ikTargetDirection.normalize();
  ikDeltaWorldQuaternion.setFromUnitVectors(ikCurrentDirection, ikTargetDirection);
  joint.parent.getWorldQuaternion(ikParentWorldQuaternion);
  ikDeltaLocalQuaternion
    .copy(ikParentWorldQuaternion)
    .invert()
    .multiply(ikDeltaWorldQuaternion)
    .multiply(ikParentWorldQuaternion);
  ikDesiredQuaternion.copy(joint.quaternion).premultiply(ikDeltaLocalQuaternion).normalize();
  joint.quaternion.slerp(ikDesiredQuaternion, weight);
  joint.updateWorldMatrix(true, true);
}

function applyWeaponSupportIk(avatar) {
  const chain = avatar.weaponSupportChain;
  const supportPoint = weaponSupportPoint(avatar.weaponId);
  if (
    !chain || !supportPoint || !avatar.gun?.visible || avatar.inVehicle ||
    avatar.alive === false || performance.now() < (avatar.weaponIkSuppressedUntil || 0)
  ) return;
  avatar.gun.updateWorldMatrix(true, false);
  ikTargetPosition.copy(supportPoint);
  avatar.gun.localToWorld(ikTargetPosition);
  for (let pass = 0; pass < 2; pass += 1) {
    rotateIkJointToward(chain.forearm, chain.hand, ikTargetPosition, pass === 0 ? 0.72 : 0.48);
    rotateIkJointToward(chain.upperArm, chain.hand, ikTargetPosition, pass === 0 ? 0.62 : 0.4);
  }
}

function attachWeaponToHumanSoldier(avatar, model) {
  const socket = model.getObjectByName("B-handPropR") || model.getObjectByName("B-handR");
  if (!socket) {
    avatar.root.attach(avatar.gun);
    avatar.gun.position.set(0.28, 1.18, -0.38);
    avatar.gun.rotation.set(-0.04, 0, 0);
    avatar.gun.scale.setScalar(0.34);
    avatar.gun.visible = true;
    return;
  }

  model.updateMatrixWorld(true);
  const socketScale = socket.getWorldScale(new THREE.Vector3());
  const targetWorldScale = 0.34;
  const localScale = targetWorldScale / Math.max(0.0001, Math.abs(socketScale.x));
  socket.add(avatar.gun);
  // Human Soldier's prop socket is authored in Z-up FBX space. This offset
  // keeps Arena Brawl's -Z weapon axis pointed forward after the FBX conversion.
  avatar.gun.rotation.set(
    THREE.MathUtils.degToRad(78.94),
    THREE.MathUtils.degToRad(49.99),
    THREE.MathUtils.degToRad(-90.12),
    "XYZ"
  );
  avatar.gun.scale.setScalar(localScale);
  const gripOffset = weaponGripPoint(avatar.weaponId)
    .applyEuler(avatar.gun.rotation)
    .multiplyScalar(localScale);
  avatar.gun.position.copy(gripOffset).multiplyScalar(-1);
  avatar.weaponSocket = socket;
  avatar.gun.visible = true;
}

async function attachHumanSoldierCharacter(avatar, characterId) {
  const { descriptor, model: sourceModel, clips } = await loadHumanSoldierPack(characterId);
  if (!avatar.root.parent) return;

  const model = prepareHumanSoldierScene(sourceModel, descriptor, avatar.team);
  avatar.root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clipSources = {
    ...clips,
    jump: createHumanSoldierJumpClip(model, descriptor.prefix),
    prone: createHumanSoldierProneClip(model, descriptor.prefix),
    proneCrawl: createHumanSoldierProneClip(model, descriptor.prefix, true)
  };
  const actions = {};
  const locomotionAliases = {
    idle: "idle",
    walk: "walk_forward",
    run: "run_forward",
    jump: "jump",
    fall: "idle",
    land: "idle",
    crouch: "idle",
    crouchWalk: "walk_forward",
    prone: "prone",
    proneCrawl: "proneCrawl",
    drive: "idle",
    driveBike: "idle",
    drivePlane: "idle",
    driveJetski: "idle",
    death: "death",
    dance: "idle",
    dance_fast: "idle",
    dance_slow: "idle"
  };

  const actionDefinitions = new Map(Object.entries(locomotionAliases));
  Object.keys(clipSources).forEach((name) => {
    if (!actionDefinitions.has(name)) actionDefinitions.set(name, name);
  });

  actionDefinitions.forEach((clipName, name) => {
    const sourceClip = clipSources[clipName] || clipSources.idle;
    if (!sourceClip) return;

    // AnimationMixer caches actions by clip UUID. Aliases such as jump/run and
    // drive/idle must use independent clips or fading one state also fades the other.
    const clip = sourceClip.clone();
    clip.name = `${descriptor.prefix}_${name}`;
    const action = mixer.clipAction(clip, model);
    action.enabled = true;
    action.paused = false;
    action.zeroSlopeAtStart = false;
    action.zeroSlopeAtEnd = false;
    if (["death", "damage", "grenade"].includes(name) || name.startsWith("shoot_") || name.startsWith("reload_")) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = name === "death";
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    actions[name] = action;
  });

  avatar.model = model;
  avatar.mixer = mixer;
  avatar.actions = actions;
  avatar.currentAnimationAction = null;
  avatar.aimAnimationAction = null;
  avatar.crouchBlend = 0;
  avatar.proneBlend = 0;
  avatar.modelBasePosition = model.position.clone();
  avatar.modelBaseRotationX = model.rotation.x;
  model.rotation.order = "YXZ";
  avatar.crouchBones = {
    hips: model.getObjectByName("B-hips"),
    spine: model.getObjectByName("B-spine"),
    thighL: model.getObjectByName("B-thighL"),
    thighR: model.getObjectByName("B-thighR"),
    shinL: model.getObjectByName("B-shinL"),
    shinR: model.getObjectByName("B-shinR")
  };
  avatar.weaponSupportChain = {
    upperArm: model.getObjectByName("B-upperArmL"),
    forearm: model.getObjectByName("B-forearmL"),
    hand: model.getObjectByName("B-handL")
  };
  avatar.humanSoldierCharacter = true;
  avatar.fpsCharacter = true;
  avatar.fallbackMeshes.forEach((mesh) => {
    mesh.material = mesh.material.clone();
    mesh.material.colorWrite = false;
    mesh.material.depthWrite = false;
  });
  attachWeaponToHumanSoldier(avatar, model);
  avatar.setAnimation(avatar.desiredAnimation || "idle", true);
}

async function attachFpsCharacter(avatar, characterId) {
  if (!fpsCharacterPackPromise) fpsCharacterPackPromise = loadFpsCharacterPack();
  const { model: sourceModel, animations } = await fpsCharacterPackPromise;
  if (!avatar.root.parent) return;

  const model = prepareFpsCharacterScene(sourceModel, characterId, avatar.team);
  avatar.root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const byName = animationClipMap(animations);
  const aliases = {
    idle: ["Idle"],
    walk: ["Walk", "AimWalk"],
    run: ["Sprint", "Run"],
    jump: ["JumpStart", "JumpLoop", "Jump"],
    fall: ["Fall", "JumpLoop", "JumpStart"],
    land: ["Land", "Idle"],
    crouch: ["CrouchIdle", "AimIdle"],
    crouchWalk: ["CrouchWalk", "CrouchIdle", "AimWalk"],
    prone: ["CrouchIdle", "AimIdle", "Idle"],
    proneCrawl: ["CrouchWalk", "AimWalk", "Walk"],
    drive: ["DriveCar"],
    driveBike: ["RideBike", "DriveCar"],
    drivePlane: ["PilotPlane", "DriveCar"],
    driveJetski: ["DriveJetSki", "DriveCar"],
    death: ["Death"],
    dance: ["Dance01"],
    dance_fast: ["Dance02", "Dance01"],
    dance_slow: ["Dance03", "Dance01"]
  };
  const actions = {};
  Object.entries(aliases).forEach(([name, clipNames]) => {
    const clip = clipForFpsCharacter(firstClip(byName, clipNames) || byName.get("Idle"), characterId, model);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    if (name === "death") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 1.35;
    }
    if (name.startsWith("dance")) {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    actions[name] = action;
  });

  avatar.model = model;
  avatar.mixer = mixer;
  avatar.actions = actions;
  avatar.fpsCharacter = true;
  avatar.fallbackMeshes.forEach((mesh) => {
    mesh.material = mesh.material.clone();
    mesh.material.colorWrite = false;
    mesh.material.depthWrite = false;
  });
  attachWeaponToFpsSocket(avatar, model, characterId);
  avatar.setAnimation(avatar.desiredAnimation || "idle", true);
}

export async function attachAnimatedCharacter(avatar) {
  const characterId = avatar.characterId || "fps_male";
  if (characterId === "fps_male" || characterId === "fps_female") {
    try {
      await attachHumanSoldierCharacter(avatar, characterId);
    } catch (error) {
      console.warn("Human Soldier Animations nao carregou; usando personagem anterior.", error);
      await attachFpsCharacter(avatar, characterId);
    }
    return;
  }

  if ((avatar.characterId || "boxman") === "boxman") {
    if (!sketchbookCharacterPromise) sketchbookCharacterPromise = loadSketchbookCharacter();
    const { model: sourceModel, animations } = await sketchbookCharacterPromise;
    if (!avatar.root.parent) return;

    const model = cloneSkeleton(sourceModel);
    model.name = "boxman-character";
    avatar.root.add(model);

    const mixer = new THREE.AnimationMixer(model);
    const byName = new Map(animations.map((clip) => [clip.name, clip]));
    const aliases = {
      idle: "idle",
      walk: "run",
      run: "sprint",
      jump: "jump_running",
      drive: "driving",
      crouch: "sitting",
      prone: "drop_idle",
      proneCrawl: "run",
      death: "drop_idle",
      dance: "rotate_left"
    };
    const actions = {};
    Object.entries(aliases).forEach(([name, clipName]) => {
      const clip = byName.get(clipName) || byName.get("idle");
      if (!clip) return;
      const action = mixer.clipAction(clip);
      if (name === "death") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      if (name === "dance") {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      actions[name] = action;
    });

    avatar.model = model;
    avatar.mixer = mixer;
    avatar.actions = actions;
    avatar.sketchbookCharacter = true;
    avatar.fallbackMeshes.forEach((mesh) => {
      mesh.material = mesh.material.clone();
      mesh.material.colorWrite = false;
      mesh.material.depthWrite = false;
    });
    avatar.root.attach(avatar.gun);
    avatar.gun.position.set(0.34, 1.18, -0.46);
    avatar.gun.rotation.set(-0.06, 0, 0);
    avatar.gun.scale.setScalar(0.32);
    avatar.gun.visible = true;
    avatar.setAnimation(avatar.desiredAnimation || "idle", true);
    return;
  }

  const [sourceModel, clips] = await Promise.all([
    characterModel(avatar.characterId || "emberbound"),
    sharedClips()
  ]);
  if (!avatar.root.parent) return;

  const model = cloneSkeleton(sourceModel);
  model.name = `${avatar.characterId || "emberbound"}-character`;
  avatar.root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  Object.entries(clips).forEach(([name, clip]) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    if (name === "death") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 2.8;
    }
    if (name === "dance") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions[name] = action;
  });

  avatar.model = model;
  avatar.mixer = mixer;
  avatar.actions = actions;
  avatar.fallbackMeshes.forEach((mesh) => {
    mesh.material = mesh.material.clone();
    mesh.material.colorWrite = false;
    mesh.material.depthWrite = false;
  });
  avatar.root.attach(avatar.gun);
  avatar.gun.position.set(0.3, 1.15, -0.38);
  avatar.gun.rotation.set(-0.12, 0, 0);
  avatar.gun.scale.setScalar(0.34);
  avatar.gun.visible = true;
  avatar.setAnimation(avatar.desiredAnimation || "idle", true);
}

export function setCharacterAnimation(avatar, name, immediate = false, speed = null) {
  const resolvedName = avatar.actions?.[name] ? name : "idle";
  const next = avatar.actions?.[resolvedName];
  if (!next) return;
  let defaultSpeed = name === "death" ? 2.8 : 1;
  if (avatar.sketchbookCharacter && name === "walk") defaultSpeed = 0.68;
  if (avatar.sketchbookCharacter && name === "crouch") defaultSpeed = 0.9;
  if (avatar.fpsCharacter && name.startsWith("walk")) defaultSpeed = 1.12;
  if (avatar.fpsCharacter && name.startsWith("run")) defaultSpeed = 1.08;
  if (avatar.fpsCharacter && name === "jump") defaultSpeed = 1.25;
  if (avatar.fpsCharacter && name === "fall") defaultSpeed = 1;
  if (avatar.fpsCharacter && name === "land") defaultSpeed = 1.2;
  if (avatar.fpsCharacter && name === "crouchWalk") defaultSpeed = 0.95;
  if (avatar.fpsCharacter && name === "prone") defaultSpeed = 0.78;
  if (avatar.fpsCharacter && name === "proneCrawl") defaultSpeed = 0.72;
  if (avatar.fpsCharacter && name === "drive") defaultSpeed = 1;
  if (avatar.fpsCharacter && (name === "driveBike" || name === "drivePlane" || name === "driveJetski")) defaultSpeed = 1;
  if (avatar.fpsCharacter && name === "death") defaultSpeed = 1.35;
  const requestedSpeed = speed == null ? Number.NaN : Number(speed);
  const effectiveSpeed = Number.isFinite(requestedSpeed) && requestedSpeed > 0
    ? requestedSpeed
    : defaultSpeed;
  next.setEffectiveTimeScale(effectiveSpeed);
  next.enabled = true;
  next.paused = false;

  if (avatar.currentAnimationAction === next && avatar.animationName === resolvedName) {
    if (!next.isRunning() && resolvedName !== "death") next.play();
    return;
  }

  const previous = avatar.currentAnimationAction;
  next.reset();
  next.enabled = true;
  next.paused = false;
  next.setEffectiveTimeScale(effectiveSpeed);
  next.setEffectiveWeight(1);

  if (immediate || !previous) {
    if (previous && previous !== next) previous.stop();
    next.play();
  } else {
    next.play();
    previous.crossFadeTo(next, 0.22, false);
  }
  avatar.currentAnimationAction = next;
  avatar.animationName = resolvedName;
}

function applyBoneRotation(bone, x, y, z, weight) {
  if (!bone || weight <= 0.001) return;
  poseEuler.set(x * weight, y * weight, z * weight);
  poseQuaternion.setFromEuler(poseEuler);
  bone.quaternion.multiply(poseQuaternion);
}

export function updateCharacterPose(avatar, delta) {
  if (!avatar?.humanSoldierCharacter || !avatar.crouchBones) return;
  const poseDelta = Math.max(0, delta);
  const canPose = avatar.alive !== false && !avatar.inVehicle;
  const proneTarget = avatar.prone && canPose ? 1 : 0;
  const crouchTarget = avatar.crouching && canPose && !avatar.prone ? 1 : 0;
  avatar.crouchBlend = THREE.MathUtils.damp(avatar.crouchBlend || 0, crouchTarget, 13, poseDelta);
  avatar.proneBlend = THREE.MathUtils.damp(avatar.proneBlend || 0, proneTarget, 11, poseDelta);
  const crouchBlend = avatar.crouchBlend;
  const proneBlend = avatar.proneBlend;

  if (avatar.model && avatar.modelBasePosition) {
    avatar.model.position.copy(avatar.modelBasePosition);
    avatar.model.position.y += 0.38 * proneBlend;
    avatar.model.position.z += 0.22 * proneBlend;
    avatar.model.rotation.x = (avatar.modelBaseRotationX || 0) - Math.PI * 0.5 * proneBlend;
  }

  if (avatar.bodyHitbox) {
    avatar.bodyHitbox.position.set(
      0,
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.9, 0.68, crouchBlend), 0.42, proneBlend),
      THREE.MathUtils.lerp(0, -0.88, proneBlend)
    );
    avatar.bodyHitbox.scale.set(1, THREE.MathUtils.lerp(1, 0.42, proneBlend), THREE.MathUtils.lerp(1, 2.15, proneBlend));
  }
  if (avatar.lowerHitbox) {
    avatar.lowerHitbox.position.set(
      0,
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.32, 0.25, crouchBlend), 0.34, proneBlend),
      THREE.MathUtils.lerp(0, -0.25, proneBlend)
    );
    avatar.lowerHitbox.scale.set(1, THREE.MathUtils.lerp(1, 0.55, proneBlend), THREE.MathUtils.lerp(1, 1.65, proneBlend));
  }
  if (avatar.headMesh) {
    avatar.headMesh.position.set(
      0,
      THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.56, 1.22, crouchBlend), 0.4, proneBlend),
      THREE.MathUtils.lerp(0, -1.55, proneBlend)
    );
  }
  if (avatar.tagSprite) {
    avatar.tagSprite.position.y = THREE.MathUtils.lerp(1.95, 0.92, proneBlend);
    avatar.tagSprite.position.z = THREE.MathUtils.lerp(0, -0.82, proneBlend);
  }

  const bones = avatar.crouchBones;
  if (crouchBlend > 0.001) {
    if (bones.hips) bones.hips.position.y -= 30 * crouchBlend;
    applyBoneRotation(bones.spine, 0.12, 0, 0, crouchBlend);
    applyBoneRotation(bones.thighL, -0.7, 0, 0, crouchBlend);
    applyBoneRotation(bones.thighR, -0.7, 0, 0, crouchBlend);
    applyBoneRotation(bones.shinL, 1.15, 0, 0, crouchBlend);
    applyBoneRotation(bones.shinR, 1.15, 0, 0, crouchBlend);
  }

  avatar.model?.updateMatrixWorld(true);
  applyWeaponSupportIk(avatar);
}

export function setCharacterAiming(avatar, weaponId, enabled) {
  if (!avatar?.humanSoldierCharacter || !avatar.actions) return false;
  const canHoldWeapon = avatar.alive !== false && !avatar.inVehicle;
  const next = canHoldWeapon ? avatar.actions[`aim_${weaponAnimationFamily(weaponId)}`] : null;
  const targetWeight = enabled ? 1.35 : 0.9;
  if (avatar.aimAnimationAction === next) {
    if (next) {
      next.enabled = true;
      next.paused = false;
      next.setEffectiveWeight(targetWeight);
      if (!next.isRunning()) next.play();
    }
    return Boolean(next);
  }

  const previous = avatar.aimAnimationAction;
  avatar.aimAnimationAction = next;
  if (previous) {
    previous.fadeOut(0.14);
    const oldTimer = aimStopTimers.get(previous);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      if (avatar.aimAnimationAction !== previous) previous.stop();
      aimStopTimers.delete(previous);
    }, 180);
    aimStopTimers.set(previous, timer);
  }

  if (!next) return false;
  const pendingStop = aimStopTimers.get(next);
  if (pendingStop) {
    clearTimeout(pendingStop);
    aimStopTimers.delete(next);
  }
  next.reset();
  next.enabled = true;
  next.paused = false;
  next.setLoop(THREE.LoopRepeat, Infinity);
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(targetWeight);
  next.fadeIn(0.12).play();
  return true;
}

export function playCharacterAction(avatar, name, speed = 1) {
  const action = avatar?.actions?.[name];
  if (!action) return false;

  const previousTimer = oneShotTimers.get(action);
  if (previousTimer) clearTimeout(previousTimer);
  action.stop();
  action.reset();
  action.enabled = true;
  action.clampWhenFinished = name === "death";
  action.setLoop(THREE.LoopOnce, 1);
  action.setEffectiveTimeScale(Math.max(0.1, Number(speed) || 1));
  const upperBodyAction = name === "grenade" || name.startsWith("shoot_") || name.startsWith("reload_");
  action.setEffectiveWeight(upperBodyAction ? 1.35 : 0.9);
  action.fadeIn(upperBodyAction ? 0.07 : 0.1).play();

  if (name !== "death") {
    const durationMs = Math.max(140, (action.getClip().duration / Math.max(0.1, Number(speed) || 1)) * 1000);
    if (name === "grenade" || name.startsWith("reload_")) {
      avatar.weaponIkSuppressedUntil = performance.now() + durationMs;
    }
    const timer = setTimeout(() => {
      const fadeSeconds = Math.min(0.16, durationMs / 3000);
      action.fadeOut(fadeSeconds);
      setTimeout(() => action.stop(), fadeSeconds * 1000 + 20);
      oneShotTimers.delete(action);
    }, Math.max(80, durationMs - 120));
    oneShotTimers.set(action, timer);
  }
  return true;
}

function weaponAnimationFamily(weaponId = "") {
  if (["sniper_rifle", "bow", "crossbow"].includes(weaponId)) return "rifle";
  if (["pistol_common", "heavy_pistol", "auto_pistol_weak", "revolver", "mini_shotgun"].includes(weaponId)) return "gun";
  if (["bazooka", "rocket_launcher"].includes(weaponId)) return "bazooka";
  return "assault";
}

export function playCharacterWeaponAction(avatar, weaponId, actionName) {
  const family = weaponAnimationFamily(weaponId);
  return playCharacterAction(avatar, `${actionName}_${family}`);
}
