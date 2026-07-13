import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { loadSketchbookCharacter } from "./sketchbook-assets.js";

const MODEL_ROOTS = {
  emberbound: "./assets/models/emberbound/",
  scout: "./assets/models/scout/"
};
const FPS_CHARACTER_PACK = "./assets/models/fps-characters/arena_brawl_fps_characters_enhanced_export.glb";
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
    await attachFpsCharacter(avatar, characterId);
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
  const next = avatar.actions?.[name] || avatar.actions?.idle;
  if (!next) return;
  let defaultSpeed = name === "death" ? 2.8 : 1;
  if (avatar.sketchbookCharacter && name === "walk") defaultSpeed = 0.68;
  if (avatar.sketchbookCharacter && name === "crouch") defaultSpeed = 0.9;
  if (avatar.fpsCharacter && name === "walk") defaultSpeed = 1.12;
  if (avatar.fpsCharacter && name === "run") defaultSpeed = 1.08;
  if (avatar.fpsCharacter && name === "jump") defaultSpeed = 1.25;
  if (avatar.fpsCharacter && name === "fall") defaultSpeed = 1;
  if (avatar.fpsCharacter && name === "land") defaultSpeed = 1.2;
  if (avatar.fpsCharacter && name === "crouchWalk") defaultSpeed = 0.95;
  if (avatar.fpsCharacter && name === "drive") defaultSpeed = 1;
  if (avatar.fpsCharacter && (name === "driveBike" || name === "drivePlane" || name === "driveJetski")) defaultSpeed = 1;
  if (avatar.fpsCharacter && name === "death") defaultSpeed = 1.35;
  const effectiveSpeed = Number.isFinite(Number(speed)) ? Number(speed) : defaultSpeed;
  next.setEffectiveTimeScale(effectiveSpeed);
  if (avatar.animationName === name) {
    if (!next.isRunning()) next.reset().play();
    return;
  }
  const previous = avatar.actions?.[avatar.animationName];
  if (immediate) {
    if (previous && previous !== next) previous.stop();
    next.reset().setEffectiveWeight(1).play();
  } else {
    if (previous && previous !== next) previous.fadeOut(0.16);
    next.reset().fadeIn(0.16).play();
  }
  avatar.animationName = name;
}
