import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const MODEL_ROOTS = {
  emberbound: "./assets/models/emberbound/",
  scout: "./assets/models/scout/"
};
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

export async function attachAnimatedCharacter(avatar) {
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
  const effectiveSpeed = Number.isFinite(Number(speed)) ? Number(speed) : (name === "death" ? 2.8 : 1);
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
