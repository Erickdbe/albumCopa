import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const MODEL_ROOT = "./assets/models/emberbound/";
const ANIMATION_NAMES = ["walk", "run", "crouch", "death"];
let characterAssetsPromise = null;

function loadTexture(loader, name) {
  return loader.loadAsync(`${MODEL_ROOT}${name}`).then((texture) => {
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

async function loadCharacterAssets() {
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const [base, normalMap, metalnessMap, roughnessMap, ...animations] = await Promise.all([
    loader.loadAsync(`${MODEL_ROOT}character.gltf`),
    loadTexture(textureLoader, "normal.jpg"),
    loadTexture(textureLoader, "metallic.jpg"),
    loadTexture(textureLoader, "roughness.jpg"),
    ...ANIMATION_NAMES.map((name) => loader.loadAsync(`${MODEL_ROOT}${name}.gltf`))
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

  const clips = { idle: base.animations[0] };
  animations.forEach((asset, index) => {
    clips[ANIMATION_NAMES[index]] = asset.animations[0];
  });
  return { model: base.scene, clips };
}

function assets() {
  if (!characterAssetsPromise) characterAssetsPromise = loadCharacterAssets();
  return characterAssetsPromise;
}

export async function attachAnimatedCharacter(avatar) {
  const loaded = await assets();
  if (!avatar.root.parent) return;

  const model = cloneSkeleton(loaded.model);
  model.name = "emberbound-character";
  avatar.root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  Object.entries(loaded.clips).forEach(([name, clip]) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    if (name === "death") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 2.8;
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

export function setCharacterAnimation(avatar, name, immediate = false) {
  const next = avatar.actions?.[name] || avatar.actions?.idle;
  if (!next || avatar.animationName === name) return;
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
