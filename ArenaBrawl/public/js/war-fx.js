import * as THREE from "three";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const ROOT = "./assets/unity-packs/warfx/";
const textureCache = new Map();

// Orcamento de efeitos simultaneos. Sob fogo intenso (varios jogadores
// atirando juntos) o excesso de sprites/particulas e loops de animacao era o
// que travava o jogo. Limitamos os efeitos leves (fogacho/impacto) a um teto;
// explosoes (raras) nao entram no teto para nao sumirem.
const MAX_LIGHT_FX = 26;
let activeLightFx = 0;
function fxBudgetAvailable() {
  return activeLightFx < MAX_LIGHT_FX;
}

function assetUrl(file) {
  return `${ROOT}${encodeURIComponent(file)}`;
}

function loadTexture(file) {
  if (!textureCache.has(file)) {
    const loader = file.toLowerCase().endsWith(".tga") ? new TGALoader() : new THREE.TextureLoader();
    textureCache.set(file, loader.loadAsync(assetUrl(file)).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      return texture;
    }).catch((error) => {
      console.warn(`War FX nao carregou ${file}`, error);
      return null;
    }));
  }
  return textureCache.get(file);
}

function sprite(textureFile, color, opacity = 1, additive = true) {
  const material = new THREE.SpriteMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  loadTexture(textureFile).then((texture) => {
    if (!texture) return;
    material.map = texture;
    material.needsUpdate = true;
  });
  return new THREE.Sprite(material);
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  });
  object.parent?.remove(object);
}

function animateFor(durationMs, update, complete) {
  const started = performance.now();
  function frame(now) {
    const progress = Math.min(1, (now - started) / durationMs);
    update(progress, Math.min(0.05, (now - (frame.last || started)) / 1000));
    frame.last = now;
    if (progress < 1) requestAnimationFrame(frame);
    else complete?.();
  }
  requestAnimationFrame(frame);
}

export function emitMuzzleFx(scene, origin, direction = new THREE.Vector3(0, 0, -1), scale = 1) {
  // Sem PointLight aqui: uma luz dinamica por disparo (x N jogadores atirando)
  // era a principal causa do lag/travamento. Os sprites aditivos ja dao o
  // brilho do fogacho. O jogador local ainda tem uma unica luz de cano
  // reutilizada (muzzleFlash em game.js).
  if (!fxBudgetAvailable()) return null;
  activeLightFx += 1;
  const group = new THREE.Group();
  group.position.copy(origin);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
  scene.add(group);

  const front = sprite("WFX_T_MF FrontRear RIFLE1 A8.png", 0xffd080, 1, true);
  front.scale.setScalar(0.72 * scale);
  group.add(front);
  const side = sprite("WFX_T_MF Side RIFLE1 A8.png", 0xffa23c, 0.92, true);
  side.scale.set(1.55 * scale, 0.5 * scale, 1);
  side.position.z = 0.18 * scale;
  group.add(side);

  animateFor(95, (progress) => {
    const pulse = 1 + progress * 0.65;
    front.scale.setScalar(0.72 * scale * pulse);
    side.scale.multiplyScalar(1 + progress * 0.05);
    front.material.opacity = 1 - progress;
    side.material.opacity = 0.92 * (1 - progress);
  }, () => { activeLightFx -= 1; disposeObject(group); });
  return group;
}

function sparkBurst(group, count, strength, color = 0xffb348) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color, size: 0.11 * strength, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  loadTexture("WFX_T_Sparks Metal A8.png").then((texture) => {
    if (!texture) return;
    material.map = texture;
    material.alphaTest = 0.02;
    material.needsUpdate = true;
  });
  const points = new THREE.Points(geometry, material);
  group.add(points);
  const velocities = Array.from({ length: count }, (_, index) => {
    const angle = index * 2.39996 + Math.random() * 0.45;
    const speed = (2.4 + Math.random() * 6.2) * strength;
    return new THREE.Vector3(Math.cos(angle) * speed, (1.8 + Math.random() * 5.4) * strength, Math.sin(angle) * speed);
  });
  return { points, positions, velocities };
}

export function emitImpactFx(scene, point, strength = 1) {
  if (!fxBudgetAvailable()) return null;
  activeLightFx += 1;
  const group = new THREE.Group();
  group.position.copy(point);
  scene.add(group);
  const flash = sprite("WFX_T_GlowCircle A8.png", 0xffc064, 0.95, true);
  flash.scale.setScalar(0.45 * strength);
  group.add(flash);
  const sparks = sparkBurst(group, Math.round(8 + strength * 5), 0.55 * strength);
  animateFor(460, (progress, delta) => {
    for (let i = 0; i < sparks.velocities.length; i++) {
      const velocity = sparks.velocities[i];
      velocity.y -= 12 * delta;
      sparks.positions[i * 3] += velocity.x * delta;
      sparks.positions[i * 3 + 1] += velocity.y * delta;
      sparks.positions[i * 3 + 2] += velocity.z * delta;
    }
    sparks.points.geometry.attributes.position.needsUpdate = true;
    sparks.points.material.opacity = 1 - progress;
    flash.material.opacity = Math.max(0, 0.95 - progress * 2.4);
    flash.scale.setScalar(0.45 * strength * (1 + progress * 1.8));
  }, () => { activeLightFx -= 1; disposeObject(group); });
  return group;
}

export function emitExplosionFx(scene, position, color = 0xff762f, scale = 1) {
  const group = new THREE.Group();
  group.position.copy(position);
  scene.add(group);

  const core = sprite("WFX_T_FlamesBig A8.tga", color, 1, true);
  core.scale.setScalar(3.2 * scale);
  group.add(core);
  const glow = sprite("WFX_T_GlowCircle A8.png", 0xff9b45, 0.9, true);
  glow.scale.setScalar(4.5 * scale);
  group.add(glow);
  const smoke = Array.from({ length: 7 }, (_, index) => {
    const particle = sprite("WFX_T_SmokeLoopAlpha Average.tga", index % 2 ? 0x555a5f : 0x353a40, 0.72, false);
    const angle = index * 2.39996;
    particle.position.set(Math.cos(angle) * 0.45 * scale, 0.8 + (index % 3) * 0.42 * scale, Math.sin(angle) * 0.45 * scale);
    particle.scale.setScalar((1.3 + (index % 3) * 0.42) * scale);
    particle.userData.velocity = new THREE.Vector3(Math.cos(angle) * 0.55, 1.5 + (index % 2) * 0.6, Math.sin(angle) * 0.55).multiplyScalar(scale);
    group.add(particle);
    return particle;
  });
  const sparks = sparkBurst(group, Math.round(26 * scale), 1.15 * scale);
  animateFor(1550, (progress, delta) => {
    core.material.opacity = Math.max(0, 1 - progress * 1.9);
    core.scale.setScalar(3.2 * scale * (1 + progress * 1.4));
    glow.material.opacity = Math.max(0, 0.9 - progress * 2.7);
    glow.scale.setScalar(4.5 * scale * (1 + progress * 2.2));
    smoke.forEach((particle, index) => {
      particle.position.addScaledVector(particle.userData.velocity, delta);
      particle.position.x += Math.sin(progress * 8 + index) * delta * 0.32;
      particle.scale.multiplyScalar(1 + delta * 0.7);
      particle.material.opacity = 0.72 * Math.max(0, 1 - progress * 0.82);
    });
    for (let i = 0; i < sparks.velocities.length; i++) {
      const velocity = sparks.velocities[i];
      velocity.y -= 10 * delta;
      sparks.positions[i * 3] += velocity.x * delta;
      sparks.positions[i * 3 + 1] += velocity.y * delta;
      sparks.positions[i * 3 + 2] += velocity.z * delta;
    }
    sparks.points.geometry.attributes.position.needsUpdate = true;
    sparks.points.material.opacity = Math.max(0, 1 - progress * 1.7);
  }, () => disposeObject(group));
  return group;
}

export function emitNapalmExplosionFx(scene, position, scale = 1) {
  const group = new THREE.Group();
  group.position.copy(position);
  scene.add(group);

  const stem = sprite("WFX_T_FlamesBig A8.tga", 0xff7a22, 1, true);
  stem.position.y = 1.2 * scale;
  stem.scale.set(2.4 * scale, 4.8 * scale, 2.4 * scale);
  group.add(stem);

  const capSprites = Array.from({ length: 9 }, (_, index) => {
    const smoke = sprite("WFX_T_SmokeLoopAlpha Average.tga", index % 2 ? 0x4a4038 : 0x2f3032, 0.78, false);
    const angle = index / 9 * Math.PI * 2;
    smoke.position.set(Math.cos(angle) * 1.1 * scale, 4.2 * scale, Math.sin(angle) * 1.1 * scale);
    smoke.scale.setScalar((2.4 + (index % 3) * 0.34) * scale);
    smoke.userData.velocity = new THREE.Vector3(Math.cos(angle) * 1.05, 1.15, Math.sin(angle) * 1.05).multiplyScalar(scale);
    group.add(smoke);
    return smoke;
  });

  const groundFire = Array.from({ length: 14 }, (_, index) => {
    const flame = sprite("WFX_T_FlamesBig A8.tga", index % 2 ? 0xff9b2f : 0xff4b19, 0.82, true);
    const angle = index / 14 * Math.PI * 2;
    const radius = (1.6 + (index % 5) * 0.55) * scale;
    flame.position.set(Math.cos(angle) * radius, 0.28 * scale, Math.sin(angle) * radius);
    flame.scale.setScalar((0.9 + (index % 4) * 0.22) * scale);
    group.add(flame);
    return flame;
  });
  const sparks = sparkBurst(group, Math.round(44 * scale), 1.65 * scale, 0xff8a2e);

  animateFor(2400, (progress, delta) => {
    stem.material.opacity = Math.max(0, 1 - progress * 1.55);
    stem.scale.y = 4.8 * scale * (1 + progress * 0.85);
    stem.scale.x = stem.scale.z = 2.4 * scale * (1 + progress * 1.2);
    capSprites.forEach((smoke, index) => {
      smoke.position.addScaledVector(smoke.userData.velocity, delta);
      smoke.position.y += Math.sin(progress * 10 + index) * delta * 0.55;
      smoke.scale.multiplyScalar(1 + delta * 0.58);
      smoke.material.opacity = 0.78 * Math.max(0, 1 - progress * 0.72);
    });
    groundFire.forEach((flame, index) => {
      flame.scale.y = (0.9 + (index % 4) * 0.22) * scale * (1 + Math.sin(progress * 32 + index) * 0.18);
      flame.material.opacity = Math.max(0, 0.82 - progress * 1.2);
    });
    for (let i = 0; i < sparks.velocities.length; i++) {
      const velocity = sparks.velocities[i];
      velocity.y -= 8 * delta;
      sparks.positions[i * 3] += velocity.x * delta;
      sparks.positions[i * 3 + 1] += velocity.y * delta;
      sparks.positions[i * 3 + 2] += velocity.z * delta;
    }
    sparks.points.geometry.attributes.position.needsUpdate = true;
    sparks.points.material.opacity = Math.max(0, 1 - progress * 1.45);
  }, () => disposeObject(group));
  return group;
}

export function preloadWarFx() {
  return Promise.all([
    "WFX_T_MF FrontRear RIFLE1 A8.png",
    "WFX_T_MF Side RIFLE1 A8.png",
    "WFX_T_GlowCircle A8.png",
    "WFX_T_Sparks Metal A8.png",
    "WFX_T_FlamesBig A8.tga",
    "WFX_T_SmokeLoopAlpha Average.tga"
  ].map(loadTexture));
}
