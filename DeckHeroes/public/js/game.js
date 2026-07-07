import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, VignetteEffect } from "postprocessing";
import { ARENA_HALF, MOVE_SPEED, MOVE_SEND_MS, HEROES, HERO_ORDER, DEFAULT_DECK, SUPPORT_ORDER, normalizeDeck } from "./cards.js";

const token = localStorage.getItem("mp_token");
const query = new URLSearchParams(location.search);
const invitedRoomId = query.get("room")?.trim().toUpperCase() || "";
const previewMode = Boolean(window.DECK_HEROES_PREVIEW) || query.has("preview") || location.hash.includes("preview");
const socket = window.io(window.location.origin, { auth: { token } });

const dom = {
  setupScreen: document.getElementById("setupScreen"),
  gameScreen: document.getElementById("gameScreen"),
  heroCatalog: document.getElementById("heroCatalog"),
  deckCount: document.getElementById("deckCount"),
  roomCode: document.getElementById("roomCode"),
  playerList: document.getElementById("playerList"),
  openRoomBtn: document.getElementById("openRoomBtn"),
  readyBtn: document.getElementById("readyBtn"),
  startBtn: document.getElementById("startBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  statusText: document.getElementById("statusText"),
  canvas: document.getElementById("gameCanvas"),
  heroName: document.getElementById("heroName"),
  healthFill: document.getElementById("healthFill"),
  healthText: document.getElementById("healthText"),
  scoreLabel: document.getElementById("scoreLabel"),
  timerLabel: document.getElementById("timerLabel"),
  towerList: document.getElementById("towerList"),
  deckBar: document.getElementById("deckBar"),
  abilityBtn: document.getElementById("abilityBtn"),
  supportBtn: document.getElementById("supportBtn"),
  supportSelect: document.getElementById("supportSelect"),
  pauseHint: document.getElementById("pauseHint"),
  endOverlay: document.getElementById("endOverlay"),
  endTitle: document.getElementById("endTitle"),
  backToLobbyBtn: document.getElementById("backToLobbyBtn")
};

const state = {
  deck: [...DEFAULT_DECK],
  room: null,
  selfId: null,
  playing: false,
  locked: false,
  yaw: 0,
  pitch: -0.35,
  lastMoveSent: 0,
  lastAttackAt: 0,
  localReady: false,
  lastSelfAlive: null,
  lastSelfHeroId: null,
  lastDeckKey: "",
  lastTowerKey: "",
  keys: {},
  localPosition: new THREE.Vector3(0, 0, 0)
};

let scene, camera, renderer, composer, clock, raycaster;
const units = new Map();
const towers = new Map();
const supports = new Map();
const modelPromises = new Map();
const transient = [];
const MODEL_FORWARD_OFFSET = Math.PI;
const WATER_HALF_WIDTH = 2.35;
const BRIDGE_HALF_WIDTH = 6.35;
const BRIDGE_CENTERS = [-14, 14];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function sampleForHero(heroId) {
  const map = {
    archer: "rogue.png",
    rogue: "rogue.png",
    knight: "knight.png",
    lancer: "knight.png",
    mage: "mage.png",
    bomber: "mage.png",
    healer: "mage.png",
    barbarian: "barbarian.png",
    giant: "barbarian.png",
    balloon: "barbarian.png"
  };
  return `./assets/kaykit/samples/${map[heroId] || "knight.png"}`;
}

function heroArt(heroId, compact = false) {
  const hero = HEROES[heroId] || HEROES.archer;
  const color = hero.color || "#ffe082";
  const icons = {
    archer: `<path d="M32 18c18 14 18 46 0 60" fill="none" stroke="#f4e7c2" stroke-width="6"/><path d="M33 24l33 26-33 26" fill="none" stroke="#1b2421" stroke-width="5"/><path d="M31 50h50" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`,
    knight: `<path d="M50 16l28 12v22c0 18-11 31-28 38-17-7-28-20-28-38V28z" fill="${color}"/><path d="M50 23v54" stroke="#fff4ca" stroke-width="6"/><path d="M31 44h38" stroke="#1b2421" stroke-width="6"/>`,
    mage: `<circle cx="50" cy="46" r="17" fill="${color}"/><path d="M29 76l42-52" stroke="#f8e4a1" stroke-width="8" stroke-linecap="round"/><circle cx="74" cy="21" r="8" fill="#fff4ca"/>`,
    barbarian: `<path d="M31 73l40-45" stroke="#d7dde0" stroke-width="10" stroke-linecap="round"/><path d="M64 22l16 16-17 8-8-8z" fill="${color}"/><circle cx="37" cy="70" r="11" fill="#7a4a2f"/>`,
    rogue: `<path d="M52 17l21 23-32 44-14-15z" fill="${color}"/><path d="M58 27l15-12 12 12-15 12" fill="#e7edf0"/><circle cx="42" cy="66" r="10" fill="#253029"/>`,
    giant: `<circle cx="50" cy="37" r="22" fill="${color}"/><rect x="24" y="47" width="52" height="34" rx="12" fill="#8f5640"/><path d="M31 55h38" stroke="#f5d083" stroke-width="7"/>`,
    balloon: `<ellipse cx="50" cy="33" rx="25" ry="29" fill="${color}"/><path d="M31 58h38l-8 13H39z" fill="#f5d083"/><rect x="36" y="69" width="28" height="15" rx="4" fill="#7a5132"/>`,
    bomber: `<circle cx="48" cy="55" r="22" fill="#2f3435"/><path d="M58 36c5-10 13-12 20-7" stroke="#f6cf57" stroke-width="6" fill="none"/><circle cx="43" cy="49" r="6" fill="${color}"/>`,
    healer: `<circle cx="50" cy="50" r="28" fill="${color}"/><path d="M50 31v38M31 50h38" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`,
    lancer: `<path d="M25 77l51-51" stroke="${color}" stroke-width="8" stroke-linecap="round"/><path d="M68 16l18-4-4 18z" fill="#e7edf0"/><path d="M39 61l-12-12" stroke="#f5d083" stroke-width="7"/>`,
    skeleton: `<circle cx="50" cy="31" r="17" fill="#e7edf0"/><circle cx="43" cy="29" r="4" fill="#27332e"/><circle cx="57" cy="29" r="4" fill="#27332e"/><rect x="39" y="48" width="22" height="28" rx="5" fill="#d8dee2"/><path d="M28 61h44M35 80l30-30" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`,
    skeletonArcher: `<circle cx="45" cy="32" r="15" fill="#e7edf0"/><circle cx="40" cy="30" r="3.5" fill="#27332e"/><circle cx="50" cy="30" r="3.5" fill="#27332e"/><path d="M63 20c16 13 16 47 0 60" fill="none" stroke="${color}" stroke-width="6"/><path d="M63 27v46" stroke="#f4e7c2" stroke-width="4"/><path d="M29 56h48" stroke="#d8dee2" stroke-width="6" stroke-linecap="round"/>`,
    witch: `<path d="M50 13l27 32H23z" fill="${color}"/><path d="M28 46h44l-7 37H35z" fill="#39254f"/><circle cx="50" cy="44" r="12" fill="#e8c79a"/><circle cx="75" cy="25" r="8" fill="#b6ffef"/><path d="M73 32L55 78" stroke="#d8c2ff" stroke-width="7" stroke-linecap="round"/>`
  };
  const body = icons[heroId] || icons.knight;
  const sizeClass = compact ? "hero-thumb compact" : "hero-thumb";
  return `<span class="${sizeClass}" aria-hidden="true">
    <svg viewBox="0 0 100 100" focusable="false">
      <defs>
        <linearGradient id="g-${heroId}" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#27332e"/>
          <stop offset="1" stop-color="#111815"/>
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="12" fill="url(#g-${heroId})"/>
      <circle cx="82" cy="20" r="18" fill="${color}" opacity="0.22"/>
      ${body}
    </svg>
  </span>`;
}

function renderHeroCatalog() {
  const indexes = new Map(state.deck.map((id, index) => [id, index + 1]));
  dom.deckCount.textContent = `${state.deck.length}/8`;
  dom.heroCatalog.innerHTML = HERO_ORDER.map((id) => {
    const hero = HEROES[id];
    const selected = indexes.has(id);
    return `<button class="hero-card${selected ? " selected" : ""}" style="--hero-color:${hero.color}" data-hero="${id}" type="button">
      ${selected ? `<em>${indexes.get(id)}</em>` : ""}
      ${heroArt(id)}
      <span class="meta">
        <strong>${hero.name}</strong>
        <small>${hero.role} · ${hero.damage} dano</small>
        <small>${hero.ability.name}</small>
      </span>
    </button>`;
  }).join("");
  dom.heroCatalog.querySelectorAll("[data-hero]").forEach((button) => {
    button.addEventListener("click", () => toggleDeckHero(button.dataset.hero));
  });
}

function cleanDeckSelection(deck) {
  const unique = [];
  (Array.isArray(deck) ? deck : []).forEach((id) => {
    if (HEROES[id] && !unique.includes(id)) unique.push(id);
  });
  return unique.slice(0, 8);
}

function toggleDeckHero(heroId) {
  const index = state.deck.indexOf(heroId);
  if (index >= 0) {
    if (state.deck.length <= 1) return;
    state.deck.splice(index, 1);
  } else if (state.deck.length < 8) {
    state.deck.push(heroId);
  } else {
    state.deck[state.deck.length - 1] = heroId;
  }
  state.deck = cleanDeckSelection(state.deck);
  renderHeroCatalog();
  if (state.room?.status === "waiting") socket.emit("deck-heroes:setDeck", { deck: state.deck });
}

function me() {
  return state.room?.players?.find((player) => player.socketId === state.selfId) || null;
}

function enemyTeam(team) {
  return team === "blue" ? "red" : "blue";
}

function isOnBridge(x, z) {
  return Math.abs(z) <= WATER_HALF_WIDTH + 0.85
    && BRIDGE_CENTERS.some((center) => Math.abs(x - center) <= BRIDGE_HALF_WIDTH);
}

function canStandAt(heroId, x, z) {
  if (HEROES[heroId]?.canCrossWater) return true;
  return Math.abs(z) > WATER_HALF_WIDTH || isOnBridge(x, z);
}

function legalLocalPosition(heroId, previous, next) {
  if (canStandAt(heroId, next.x, next.z)) return next;
  const safeSide = previous.z < 0 ? -1 : 1;
  return new THREE.Vector3(previous.x, 0, safeSide * (WATER_HALF_WIDTH + 0.18));
}

function aimDirection(includePitch = true) {
  const pitch = includePitch ? state.pitch : 0;
  const flat = Math.cos(pitch);
  return new THREE.Vector3(
    -Math.sin(state.yaw) * flat,
    Math.sin(pitch),
    -Math.cos(state.yaw) * flat
  ).normalize();
}

function heroFloatHeight(heroId) {
  return heroId === "balloon" ? 1.45 : 0;
}

function unitHeight(heroId) {
  if (heroId === "balloon") return 2.7 + heroFloatHeight(heroId);
  return 1.15 * (HEROES[heroId]?.visualScale || 1);
}

function targetPosition(target) {
  const heroId = target.heroId || "tower";
  const y = target.kind ? (target.kind === "king" ? 4.8 : 3.6) : unitHeight(heroId);
  return new THREE.Vector3(Number(target.x) || 0, y, Number(target.z) || 0);
}

function renderLobby() {
  const room = state.room;
  dom.roomCode.textContent = room ? room.roomId : "Offline";
  dom.openRoomBtn.textContent = room ? "Reenviar convites" : "Abrir sala";
  const playerCount = room?.players?.length || 0;
  const self = me();
  const selfDeckReady = !room || self?.deck?.length === 8;
  const roomDeckReady = !room || room.players.every((player) => player.deck?.length === 8);
  dom.statusText.textContent = room
    ? !selfDeckReady ? "Escolha 8 cartas para fechar seu deck."
      : !roomDeckReady ? "Aguardando todo mundo fechar o deck."
        : playerCount % 2 === 0 && playerCount >= 2 ? "Pronto para iniciar com times pares." : "Aguardando entrar mais 1 jogador para fechar par."
    : token ? "Abra uma sala para convidar todos online." : "Entre na sua conta do Album para jogar online.";
  dom.playerList.innerHTML = room?.players?.length ? room.players.map((player) => {
    const hero = HEROES[player.heroId] || HEROES.archer;
    return `<div class="player-row">
      <strong>${escapeHtml(player.username)}${player.socketId === room.hostSocketId ? " (host)" : ""}</strong>
      <span>${player.ready ? "Pronto" : "Montando"} · ${hero.name}</span>
    </div>`;
  }).join("") : `<div class="player-row"><strong>Nenhuma sala aberta</strong><span>offline</span></div>`;
  dom.readyBtn.disabled = !room || !selfDeckReady;
  dom.startBtn.disabled = !room || room.hostSocketId !== state.selfId || playerCount < 2 || playerCount % 2 !== 0 || !roomDeckReady;
  dom.leaveBtn.disabled = !room;
  dom.readyBtn.textContent = self?.ready ? "Cancelar pronto" : "Pronto";
}

function ensureScene() {
  if (scene) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7db6d6);
  scene.fog = new THREE.Fog(0x7db6d6, 70, 145);
  camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 180);
  renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  setupPostProcessing();
  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();

  const hemi = new THREE.HemisphereLight(0xffffff, 0x334034, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(30, 55, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  buildArena();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
  });
  addEventListener("keydown", (event) => onKey(event, true));
  addEventListener("keyup", (event) => onKey(event, false));
  addEventListener("mousemove", onMouseMove);
  addEventListener("mousedown", onMouseDown);
  document.addEventListener("pointerlockchange", () => {
    state.locked = document.pointerLockElement === dom.canvas;
    dom.pauseHint.hidden = state.locked || !state.playing;
  });
  dom.canvas.addEventListener("click", () => {
    if (state.playing) dom.canvas.requestPointerLock();
  });
  dom.pauseHint.addEventListener("click", () => {
    if (state.playing) dom.canvas.requestPointerLock();
  });
  requestAnimationFrame(render);
}

function setupPostProcessing() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({
      intensity: 0.42,
      luminanceThreshold: 0.68,
      luminanceSmoothing: 0.22
    });
    const vignette = new VignetteEffect({
      darkness: 0.24,
      offset: 0.46
    });
    composer.addPass(new EffectPass(camera, bloom, vignette));
    composer.setSize(innerWidth, innerHeight);
  } catch (error) {
    console.warn("Postprocessing desativado:", error);
    composer = null;
  }
}

function makeTexture(size, repeat, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat.x, repeat.y);
  texture.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
  return texture;
}

function grassTexture() {
  return makeTexture(256, { x: 11, y: 11 }, (ctx, size) => {
    ctx.fillStyle = "#4f713e";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 16) {
      ctx.fillStyle = y % 32 ? "rgba(75,112,57,0.36)" : "rgba(96,137,65,0.32)";
      ctx.fillRect(0, y, size, 8);
    }
    for (let i = 0; i < 230; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 1 + Math.random() * 2.3;
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(127,169,76,0.65)" : "rgba(42,86,42,0.42)";
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.42, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function pathTexture() {
  return makeTexture(256, { x: 1.2, y: 9 }, (ctx, size) => {
    ctx.fillStyle = "#a7854e";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 2 + Math.random() * 8;
      ctx.fillStyle = Math.random() > 0.5 ? "rgba(236,205,135,0.22)" : "rgba(75,55,35,0.20)";
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(64,43,30,0.22)";
    ctx.lineWidth = 3;
    for (let y = 18; y < size; y += 38) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.25, y + 7, size * 0.7, y - 6, size, y + 4);
      ctx.stroke();
    }
  });
}

function waterTexture() {
  return makeTexture(256, { x: 10, y: 1 }, (ctx, size) => {
    ctx.fillStyle = "#3c8db9";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(197,232,255,0.36)";
    ctx.lineWidth = 4;
    for (let y = 22; y < size; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.22, y - 10, size * 0.42, y + 12, size * 0.62, y);
      ctx.bezierCurveTo(size * 0.78, y - 9, size * 0.88, y + 8, size, y);
      ctx.stroke();
    }
  });
}

function addBridge(side, material) {
  const bridge = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.18, 5.8), material);
  deck.position.y = 0.14;
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4d3524, roughness: 0.82 });
  [-2.65, 2.65].forEach((z) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(12.9, 0.34, 0.18), railMat);
    rail.position.set(0, 0.48, z);
    rail.castShadow = true;
    bridge.add(rail);
  });
  for (let x = -5; x <= 5; x += 2.5) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 5.9), railMat);
    plank.position.set(x, 0.31, 0);
    bridge.add(plank);
  }
  bridge.position.set(side * 14, 0, 0);
  scene.add(bridge);
}

function buildArena() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2.1, ARENA_HALF * 2.1, 24, 24),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.93 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const laneMat = new THREE.MeshStandardMaterial({ map: pathTexture(), roughness: 0.92 });
  const laneEdgeMat = new THREE.MeshStandardMaterial({ color: 0x5f462b, roughness: 0.95 });
  [-14, 14, 0].forEach((x, index) => {
    const width = index === 2 ? 7 : 5;
    const lane = new THREE.Mesh(new THREE.BoxGeometry(width, 0.045, ARENA_HALF * 1.86), laneMat);
    lane.position.set(x, 0.035, 0);
    lane.receiveShadow = true;
    scene.add(lane);
    [-1, 1].forEach((side) => {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.065, ARENA_HALF * 1.86), laneEdgeMat);
      edge.position.set(x + side * width * 0.5, 0.055, 0);
      scene.add(edge);
    });
  });

  const river = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_HALF * 2, 0.05, 4.2),
    new THREE.MeshStandardMaterial({ map: waterTexture(), roughness: 0.35, metalness: 0.02 })
  );
  river.position.y = 0.055;
  scene.add(river);

  const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x6f4c2f, roughness: 0.86 });
  addBridge(-1, bridgeMat);
  addBridge(1, bridgeMat);

  const center = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 3.7, 48),
    new THREE.MeshBasicMaterial({ color: 0xf3d27a, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
  );
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.08;
  scene.add(center);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x405844, roughness: 0.86 });
  [
    [0, -ARENA_HALF, ARENA_HALF * 2, 0.9], [0, ARENA_HALF, ARENA_HALF * 2, 0.9],
    [-ARENA_HALF, 0, 0.9, ARENA_HALF * 2], [ARENA_HALF, 0, 0.9, ARENA_HALF * 2]
  ].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), wallMat);
    wall.position.set(x, 1.2, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  });
}

function modelUrl(fileName) {
  return new URL(`../assets/kaykit/characters/${fileName}`, import.meta.url).href;
}

function prepareHeroRoot(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? 2.05 / size.y : 1;
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;
  return root;
}

function applyHeroModelStyle(model, heroId) {
  const hero = HEROES[heroId] || HEROES.archer;
  model.rotation.y = MODEL_FORWARD_OFFSET;
  model.scale.multiplyScalar(hero.visualScale || 1);
}

function loadHeroAsset(heroId) {
  const hero = HEROES[heroId] || HEROES.archer;
  if (hero.model === "balloon") {
    return Promise.resolve({ root: buildBalloonModel(hero.color), animations: [] });
  }
  if (hero.model === "skeleton" || hero.model === "skeleton_archer") {
    return Promise.resolve({ root: buildSkeletonModel(hero.model === "skeleton_archer", hero.color), animations: [] });
  }
  if (!modelPromises.has(hero.model)) {
    const loader = new GLTFLoader();
    modelPromises.set(hero.model, loader.loadAsync(modelUrl(hero.model)).then((gltf) => {
      return {
        root: prepareHeroRoot(gltf.scene),
        animations: gltf.animations || []
      };
    }));
  }
  return modelPromises.get(hero.model);
}

function instantiateHeroModel(heroId) {
  return loadHeroAsset(heroId).then((asset) => {
    const model = cloneSkeleton(asset.root);
    applyHeroModelStyle(model, heroId);
    return {
      model,
      animations: asset.animations
    };
  });
}

function clipByName(clips, names) {
  for (const name of names) {
    const exact = clips.find((clip) => clip.name === name);
    if (exact) return exact;
  }
  for (const name of names) {
    const partial = clips.find((clip) => clip.name.toLowerCase().includes(name.toLowerCase()));
    if (partial) return partial;
  }
  return clips[0] || null;
}

function pickClip(clips, kind, heroId) {
  if (!clips?.length) return null;
  const ranged = ["archer", "lancer"].includes(heroId);
  const caster = ["mage", "bomber", "healer"].includes(heroId);
  if (kind === "idle") return clipByName(clips, ["Idle", "2H_Melee_Idle", "Unarmed_Idle"]);
  if (kind === "run") return clipByName(clips, ["Running_A", "Running_B", "Walking_A"]);
  if (kind === "death") return clipByName(clips, ["Death_A", "Death_B"]);
  if (kind === "ability") return clipByName(clips, caster ? ["Spellcast_Long", "Spellcast_Raise", "Spellcast_Shoot"] : ["2H_Melee_Attack_Spin", "Jump_Full_Short", "Spellcast_Raise"]);
  if (kind === "attack") {
    if (caster) return clipByName(clips, ["Spellcast_Shoot", "Spellcast_Long", "1H_Ranged_Shoot"]);
    if (ranged) return clipByName(clips, ["1H_Ranged_Shoot", "Throw", "1H_Melee_Attack_Stab"]);
    return clipByName(clips, ["1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Horizontal", "2H_Melee_Attack_Chop"]);
  }
  return clips[0];
}

function setupUnitAnimations(unit, clips) {
  unit.mixer = null;
  unit.actions = {};
  unit.currentAction = null;
  unit.actionLockUntil = 0;
  if (!clips?.length) return;
  unit.mixer = new THREE.AnimationMixer(unit.model);
  ["idle", "run", "attack", "ability", "death"].forEach((kind) => {
    const clip = pickClip(clips, kind, unit.heroId);
    if (!clip) return;
    const action = unit.mixer.clipAction(clip);
    if (["attack", "ability", "death"].includes(kind)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = kind === "death";
    }
    unit.actions[kind] = action;
  });
}

function playUnitAction(unit, kind, fade = 0.12, lockMs = 0) {
  if (!unit?.actions) return;
  const action = unit.actions[kind] || unit.actions.idle;
  if (!action || unit.currentAction === action) return;
  const previous = unit.currentAction;
  action.enabled = true;
  action.reset();
  action.fadeIn(fade).play();
  if (previous) previous.fadeOut(fade);
  unit.currentAction = action;
  if (lockMs > 0) unit.actionLockUntil = performance.now() + lockMs;
}

function triggerUnitAction(unit, kind) {
  if (!unit?.actions?.[kind]) return;
  const action = unit.actions[kind];
  const duration = Math.max(260, Math.min(900, (action.getClip().duration || 0.6) * 720));
  if (unit.currentAction === action) {
    action.reset().fadeIn(0.04).play();
    unit.actionLockUntil = performance.now() + duration;
    return;
  }
  playUnitAction(unit, kind, 0.05, duration);
}

function updateUnitAnimation(unit, delta) {
  unit.animTime = (unit.animTime || 0) + delta * (unit.moving ? 11 : 3);
  unit.mixer?.update(delta);
  if (!unit.mixer && unit.model) {
    unit.model.position.y = (unit.floatHeight || 0) + Math.max(0, Math.sin(unit.animTime) * (unit.moving ? 0.055 : 0.018));
    unit.model.rotation.z = Math.sin(unit.animTime * 0.7) * (unit.moving ? 0.045 : 0.018);
  }
  if (unit.actionLockUntil > performance.now()) return;
  playUnitAction(unit, unit.moving ? "run" : "idle", 0.16);
}

function buildFallback(heroId) {
  const hero = HEROES[heroId] || HEROES.archer;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: hero.color }));
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);
  applyHeroModelStyle(group, heroId);
  return group;
}

function buildBalloonModel(color) {
  const group = new THREE.Group();
  const envelopeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.58 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x7d2f47, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf4d06f, roughness: 0.52 });
  const basketMat = new THREE.MeshStandardMaterial({ color: 0x7a5132, roughness: 0.85 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x2f2319, roughness: 0.9 });
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x2d3233, roughness: 0.65 });

  const envelope = new THREE.Mesh(new THREE.SphereGeometry(1.22, 24, 18), envelopeMat);
  envelope.position.y = 3.05;
  envelope.scale.set(1, 1.32, 1);
  envelope.castShadow = true;
  group.add(envelope);

  for (let i = 0; i < 6; i += 1) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.95, 0.05), i % 2 ? trimMat : darkMat);
    stripe.position.y = 3.05;
    stripe.position.x = Math.cos(i / 6 * Math.PI * 2) * 1.03;
    stripe.position.z = Math.sin(i / 6 * Math.PI * 2) * 1.03;
    stripe.rotation.y = -i / 6 * Math.PI * 2;
    stripe.castShadow = true;
    group.add(stripe);
  }

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.26, 12), trimMat);
  collar.position.y = 1.74;
  collar.castShadow = true;
  group.add(collar);

  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.95), basketMat);
  basket.position.y = 0.92;
  basket.castShadow = true;
  group.add(basket);

  [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]].forEach(([x, z]) => {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.35, 7), ropeMat);
    rope.position.set(x, 1.55, z);
    rope.rotation.x = z * 0.12;
    rope.rotation.z = -x * 0.12;
    group.add(rope);
  });

  const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), bombMat);
  bomb.position.set(0, 0.34, -0.18);
  bomb.castShadow = true;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 7), trimMat);
  fuse.position.set(0.1, 0.67, -0.18);
  fuse.rotation.z = -0.55;
  group.add(bomb, fuse);
  return group;
}

function boneBetween(from, to, radius, material) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  bone.position.copy(from).addScaledVector(direction, 0.5);
  bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  bone.castShadow = true;
  return bone;
}

function buildSkeletonModel(archer = false, color = "#e7edf0") {
  const group = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe7edf0, roughness: 0.72 });
  const clothMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x283034, roughness: 0.85 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x7dd7ff, emissive: 0x4cc6ff, emissiveIntensity: 0.8 });

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), boneMat);
  skull.position.y = 1.68;
  skull.scale.set(0.92, 1.05, 0.86);
  skull.castShadow = true;
  group.add(skull);
  [-0.09, 0.09].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
    eye.position.set(x, 1.69, -0.23);
    group.add(eye);
  });

  const ribs = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.24 - i * 0.018, 0.016, 6, 18, Math.PI), boneMat);
    rib.position.y = 1.34 - i * 0.08;
    rib.rotation.x = Math.PI / 2;
    rib.castShadow = true;
    ribs.add(rib);
  }
  ribs.add(boneBetween(new THREE.Vector3(0, 1.06, 0), new THREE.Vector3(0, 1.48, 0), 0.035, boneMat));
  group.add(ribs);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.22), boneMat);
  pelvis.position.y = 0.95;
  pelvis.castShadow = true;
  group.add(pelvis);

  const limbPairs = [
    [[-0.25, 1.36, 0], [-0.58, 1.1, -0.04], [-0.38, 0.9, -0.02]],
    [[0.25, 1.36, 0], [0.58, 1.1, -0.04], [0.38, 0.9, -0.02]],
    [[-0.15, 0.9, 0], [-0.25, 0.48, 0], [-0.18, 0.08, -0.02]],
    [[0.15, 0.9, 0], [0.25, 0.48, 0], [0.18, 0.08, -0.02]]
  ];
  limbPairs.forEach(([a, b, c]) => {
    group.add(boneBetween(new THREE.Vector3(...a), new THREE.Vector3(...b), 0.035, boneMat));
    group.add(boneBetween(new THREE.Vector3(...b), new THREE.Vector3(...c), 0.03, boneMat));
  });

  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.34, 5), clothMat);
  hood.position.y = 1.88;
  hood.rotation.y = Math.PI / 5;
  hood.castShadow = true;
  group.add(hood);

  if (archer) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.018, 6, 28, Math.PI * 1.25), clothMat);
    bow.position.set(0.55, 1.04, -0.12);
    bow.rotation.set(0.4, 0.2, -0.9);
    group.add(bow);
    group.add(boneBetween(new THREE.Vector3(0.36, 1.12, -0.18), new THREE.Vector3(0.95, 1.12, -0.18), 0.018, boneMat));
  } else {
    const sword = boneBetween(new THREE.Vector3(0.42, 0.9, -0.08), new THREE.Vector3(0.78, 1.55, -0.18), 0.025, darkMat);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4), new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.35 }));
    blade.position.set(0.86, 1.7, -0.2);
    blade.rotation.z = -0.55;
    group.add(sword, blade);
  }

  group.position.y = 0.05;
  return group;
}

function createUnit(id, heroId, team) {
  const group = new THREE.Group();
  group.userData.id = id;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.9, 32),
    new THREE.MeshBasicMaterial({ color: team === "blue" ? 0x5aa7ff : 0xff6767, side: THREE.DoubleSide, transparent: true, opacity: 0.76 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  group.add(ring);
  const fallback = buildFallback(heroId);
  fallback.position.y += heroFloatHeight(heroId);
  group.add(fallback);
  scene.add(group);
  const unit = {
    group,
    model: fallback,
    mixer: null,
    actions: {},
    currentAction: null,
    actionLockUntil: 0,
    animTime: Math.random() * Math.PI,
    heroId,
    floatHeight: heroFloatHeight(heroId),
    team,
    moving: false,
    target: { x: 0, z: 0, yaw: 0 },
    hp: 1,
    maxHp: 1
  };
  instantiateHeroModel(heroId).then(({ model, animations }) => {
    if (!group.parent) return;
    group.remove(unit.model);
    unit.model = model;
    unit.model.position.y += unit.floatHeight || 0;
    group.add(model);
    setupUnitAnimations(unit, animations);
    playUnitAction(unit, "idle", 0);
  }).catch(() => {});
  units.set(id, unit);
  return unit;
}

function updateUnitVisual(unit, data, instant = false) {
  if (unit.heroId !== data.heroId) {
    unit.heroId = data.heroId;
    unit.floatHeight = heroFloatHeight(data.heroId);
    unit.group.remove(unit.model);
    unit.model = buildFallback(data.heroId);
    unit.model.position.y += unit.floatHeight || 0;
    unit.group.add(unit.model);
    setupUnitAnimations(unit, []);
    instantiateHeroModel(data.heroId).then(({ model, animations }) => {
      if (!unit.group.parent || unit.heroId !== data.heroId) return;
      unit.group.remove(unit.model);
      unit.model = model;
      unit.model.position.y += unit.floatHeight || 0;
      unit.group.add(model);
      setupUnitAnimations(unit, animations);
      playUnitAction(unit, "idle", 0);
    }).catch(() => {});
  }
  unit.team = data.team;
  unit.hp = data.hp;
  unit.maxHp = data.maxHp || HEROES[data.heroId]?.hp || 100;
  unit.target.x = Number(data.x) || 0;
  unit.target.z = Number(data.z) || 0;
  unit.target.yaw = Number(data.yaw) || 0;
  unit.group.visible = data.alive !== false;
  if (instant) {
    unit.group.position.set(unit.target.x, 0, unit.target.z);
    unit.group.rotation.y = unit.target.yaw;
  }
}

function syncUnits(room) {
  const present = new Set();
  room.players.forEach((player) => {
    present.add(player.socketId);
    const unit = units.get(player.socketId) || createUnit(player.socketId, player.heroId, player.team);
    if (player.socketId === state.selfId) {
      const serverPosition = new THREE.Vector3(player.x, 0, player.z);
      const desync = state.localPosition.distanceTo(serverPosition);
      const respawned = state.lastSelfAlive === false && player.alive;
      const died = state.lastSelfAlive !== false && player.alive === false;
      const shouldSnap = !state.playing || !state.localReady || respawned || died || desync > 7;
      if (shouldSnap) {
        state.localPosition.copy(serverPosition);
        state.localReady = true;
        state.yaw = Number(player.yaw) || state.yaw;
      }
      player.x = state.localPosition.x;
      player.z = state.localPosition.z;
      player.yaw = state.yaw;
      updateUnitVisual(unit, player, true);
      state.lastSelfAlive = player.alive;
      state.lastSelfHeroId = player.heroId;
      return;
    }
    updateUnitVisual(unit, player, !state.playing);
  });
  units.forEach((unit, id) => {
    if (String(id).startsWith("support:")) return;
    if (present.has(id)) return;
    scene.remove(unit.group);
    units.delete(id);
  });
}

function createTowerHealthBillboard(tower) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 72;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.position.y = tower.kind === "king" ? 7.15 : 5.5;
  sprite.scale.set(tower.kind === "king" ? 5.2 : 4.4, tower.kind === "king" ? 1.45 : 1.22, 1);
  sprite.renderOrder = 20;
  return { canvas, ctx: canvas.getContext("2d"), texture, sprite, lastKey: "" };
}

function updateTowerHealthBillboard(entry, tower) {
  if (!entry.healthBillboard) {
    entry.healthBillboard = createTowerHealthBillboard(tower);
    entry.group.add(entry.healthBillboard.sprite);
  }
  const hp = Math.max(0, Math.round(tower.hp));
  const maxHp = Math.max(1, Math.round(tower.maxHp || tower.hp || 1));
  const key = `${hp}/${maxHp}:${tower.alive}`;
  if (entry.healthBillboard.lastKey === key) return;
  entry.healthBillboard.lastKey = key;
  const { canvas, ctx, texture } = entry.healthBillboard;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8,12,14,0.82)";
  ctx.roundRect(14, 8, 228, 54, 14);
  ctx.fill();
  ctx.strokeStyle = tower.team === "blue" ? "#7dbdff" : "#ff8c91";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#efe7c8";
  ctx.font = "800 21px Segoe UI, Arial";
  ctx.textAlign = "center";
  ctx.fillText(`${hp}/${maxHp}`, 128, 30);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.roundRect(34, 39, 188, 12, 6);
  ctx.fill();
  ctx.fillStyle = hp / maxHp > 0.38 ? "#8bd450" : "#ef645d";
  ctx.roundRect(34, 39, 188 * Math.max(0, Math.min(1, hp / maxHp)), 12, 6);
  ctx.fill();
  texture.needsUpdate = true;
}

function createTower(tower) {
  const group = new THREE.Group();
  const teamColor = tower.team === "blue" ? 0x397bdc : 0xc73f45;
  const accent = tower.team === "blue" ? 0x8cc6ff : 0xffa0a0;
  const isKing = tower.kind === "king";
  const stoneMat = new THREE.MeshStandardMaterial({ color: isKing ? 0x758072 : 0x687269, roughness: 0.86 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3f4a43, roughness: 0.9 });
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.72 });
  const roofMat = new THREE.MeshStandardMaterial({ color: isKing ? 0xe4b84c : 0x5f4434, roughness: 0.62 });
  const shadowMat = new THREE.MeshStandardMaterial({ color: 0x273029, roughness: 0.9 });

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 2.75 : 2.15, isKing ? 3.05 : 2.45, 0.46, 6),
    shadowMat
  );
  plinth.position.y = 0.28;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const hexTile = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 3.35 : 2.7, isKing ? 3.35 : 2.7, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: tower.team === "blue" ? 0x334f6f : 0x6b3d43, roughness: 0.88 })
  );
  hexTile.position.y = 0.09;
  hexTile.rotation.y = Math.PI / 6;
  hexTile.receiveShadow = true;
  group.add(hexTile);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 1.85 : 1.35, isKing ? 2.15 : 1.62, isKing ? 4.1 : 3.15, 6),
    stoneMat
  );
  base.position.y = isKing ? 2.42 : 2.02;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const midBand = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 1.93 : 1.42, isKing ? 1.93 : 1.42, 0.28, 6),
    trimMat
  );
  midBand.position.y = isKing ? 3.35 : 2.75;
  midBand.castShadow = true;
  group.add(midBand);

  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(isKing ? 1.05 : 0.78, isKing ? 1.75 : 1.25, 0.08),
    teamMat
  );
  banner.position.set(0, isKing ? 2.55 : 2.05, tower.team === "blue" ? -1.9 : 1.45);
  banner.castShadow = true;
  group.add(banner);

  const bannerMark = new THREE.Mesh(
    new THREE.BoxGeometry(isKing ? 0.48 : 0.34, 0.18, 0.09),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55 })
  );
  bannerMark.position.copy(banner.position);
  bannerMark.position.y += isKing ? 0.28 : 0.18;
  bannerMark.position.z += tower.team === "blue" ? -0.05 : 0.05;
  group.add(bannerMark);

  const topY = isKing ? 4.55 : 3.55;
  const crownBase = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 2.05 : 1.52, isKing ? 2.05 : 1.52, 0.36, 6),
    trimMat
  );
  crownBase.position.y = topY;
  crownBase.castShadow = true;
  group.add(crownBase);

  for (let i = 0; i < 8; i += 1) {
    const angle = i / 8 * Math.PI * 2;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(isKing ? 0.56 : 0.42, 0.52, isKing ? 0.46 : 0.34),
      stoneMat
    );
    block.position.set(Math.cos(angle) * (isKing ? 1.75 : 1.27), topY + 0.4, Math.sin(angle) * (isKing ? 1.75 : 1.27));
    block.rotation.y = -angle;
    block.castShadow = true;
    group.add(block);
  }

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(isKing ? 2.15 : 1.58, isKing ? 1.15 : 0.92, 4),
    roofMat
  );
  roof.position.y = topY + (isKing ? 1.18 : 0.98);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  if (isKing) {
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 8), trimMat);
    flagPole.position.y = topY + 2.05;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.38, 0.06), teamMat);
    flag.position.set(0.38, topY + 2.24, 0);
    group.add(flagPole, flag);
  } else {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.25, 10), trimMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, topY + 0.7, tower.team === "blue" ? -0.74 : 0.74);
    barrel.castShadow = true;
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.34, 0.7), teamMat);
    mount.position.set(0, topY + 0.55, 0);
    mount.castShadow = true;
    group.add(mount, barrel);
  }

  group.position.set(tower.x, 0, tower.z);
  scene.add(group);
  const entry = { group, data: tower, lastAlive: tower.alive !== false };
  updateTowerHealthBillboard(entry, tower);
  towers.set(tower.id, entry);
  return entry;
}

function towerBreakEffect(entry, tower) {
  if (!scene) return;
  const teamColor = tower.team === "blue" ? 0x4d83ff : 0xd85d55;
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a937f, roughness: 0.82, transparent: true, opacity: 0.95 });
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.62, transparent: true, opacity: 0.9 });
  const dustMat = new THREE.MeshBasicMaterial({ color: 0xdfd0ac, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  const materials = [stoneMat, teamMat, dustMat];
  const group = new THREE.Group();
  group.position.copy(entry?.group?.position || new THREE.Vector3(tower.x, 0, tower.z));

  for (let i = 0; i < 14; i += 1) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.38 + Math.random() * 0.42, 0.22 + Math.random() * 0.34, 0.38 + Math.random() * 0.42),
      i % 4 === 0 ? teamMat : stoneMat
    );
    block.position.set((Math.random() - 0.5) * 2.8, 0.9 + Math.random() * 3.2, (Math.random() - 0.5) * 2.8);
    block.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    block.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 5.2, 2.8 + Math.random() * 3.2, (Math.random() - 0.5) * 5.2);
    group.add(block);
  }

  const dust = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.55, 36), dustMat);
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = 0.12;
  group.add(dust);

  addTransient(group, 1.15, null, (delta, item) => {
    item.elapsed += delta;
    const t = Math.min(1, item.elapsed / item.maxLife);
    group.children.forEach((child) => {
      if (child === dust) return;
      child.position.addScaledVector(child.userData.velocity, delta);
      child.userData.velocity.y -= delta * 8.5;
      child.rotation.x += delta * 3.2;
      child.rotation.z += delta * 2.6;
    });
    dust.scale.setScalar(1 + t * 5.6);
    materials.forEach((material) => {
      material.opacity = Math.max(0, 1 - t);
    });
  });
}

function syncTowers(room) {
  const present = new Set();
  room.towers.forEach((tower) => {
    present.add(tower.id);
    const entry = towers.get(tower.id) || createTower(tower);
    const wasAlive = entry.lastAlive !== false;
    entry.data = tower;
    if (wasAlive && tower.alive === false) towerBreakEffect(entry, tower);
    entry.lastAlive = tower.alive !== false;
    entry.group.visible = tower.alive !== false;
    updateTowerHealthBillboard(entry, tower);
  });
  towers.forEach((entry, id) => {
    if (present.has(id)) return;
    scene.remove(entry.group);
    towers.delete(id);
  });
}

function syncSupports(room) {
  const present = new Set();
  room.supports.forEach((support) => {
    present.add(support.id);
    const unit = supports.get(support.id) || createUnit(`support:${support.id}`, support.heroId, support.team);
    supports.set(support.id, unit);
    updateUnitVisual(unit, {
      socketId: support.id,
      heroId: support.heroId,
      team: support.team,
      x: support.x,
      z: support.z,
      yaw: 0,
      hp: support.hp,
      maxHp: support.maxHp,
      alive: support.alive
    });
  });
  supports.forEach((unit, id) => {
    if (present.has(id)) return;
    scene.remove(unit.group);
    supports.delete(id);
    units.delete(`support:${id}`);
  });
}

function startGame(room) {
  const wasPlaying = state.playing;
  ensureScene();
  state.playing = true;
  state.room = room;
  if (!wasPlaying) {
    state.localReady = false;
    state.lastDeckKey = "";
    state.lastTowerKey = "";
  }
  dom.setupScreen.hidden = true;
  dom.gameScreen.hidden = false;
  dom.endOverlay.hidden = true;
  dom.pauseHint.hidden = false;
  syncTowers(room);
  syncUnits(room);
  syncSupports(room);
  renderHud();
}

function leaveGameView() {
  state.playing = false;
  if (document.pointerLockElement) document.exitPointerLock();
  dom.gameScreen.hidden = true;
  dom.setupScreen.hidden = false;
  dom.endOverlay.hidden = true;
  renderLobby();
}

function renderHud() {
  const self = me();
  if (!self) return;
  const hero = HEROES[self.heroId] || HEROES.archer;
  dom.heroName.textContent = `${hero.name} · ${hero.ability.name}`;
  const hpPct = Math.max(0, Math.min(100, self.hp / Math.max(1, self.maxHp) * 100));
  dom.healthFill.style.width = `${hpPct}%`;
  dom.healthText.textContent = `${Math.max(0, Math.round(self.hp))}/${self.maxHp}`;
  const blueKing = state.room.towers.find((tower) => tower.id === "blue-king");
  const redKing = state.room.towers.find((tower) => tower.id === "red-king");
  dom.scoreLabel.textContent = `Azul ${Math.max(0, blueKing?.hp || 0)} x ${Math.max(0, redKing?.hp || 0)} Vermelho`;
  const remain = Math.max(0, Math.ceil(((state.room.endsAt || Date.now()) - Date.now()) / 1000));
  dom.timerLabel.textContent = `${String(Math.floor(remain / 60)).padStart(2, "0")}:${String(remain % 60).padStart(2, "0")}`;
  const towerKey = state.room.towers.map((tower) => `${tower.id}:${Math.round(tower.hp)}:${tower.alive}`).join("|");
  if (towerKey !== state.lastTowerKey) {
    state.lastTowerKey = towerKey;
    dom.towerList.innerHTML = state.room.towers.map((tower) => {
      const pct = Math.max(0, tower.hp / tower.maxHp * 100);
      return `<div class="tower-row">
        <span>${tower.team === "blue" ? "Azul" : "Verm"} ${tower.kind}</span>
        <div class="tower-meter"><div style="width:${pct}%"></div></div>
        <strong>${Math.max(0, Math.round(tower.hp))}</strong>
      </div>`;
    }).join("");
  }
  renderDeckBar(self);
  renderAbility(self, hero);
}

function renderDeckBar(self) {
  const now = Date.now();
  const deckKey = self.deck.map((heroId) => `${heroId}:${Math.max(0, Math.ceil(((self.cooldowns?.[heroId] || 0) - now) / 1000))}`).join("|") + `:${self.heroId}`;
  if (deckKey === state.lastDeckKey) return;
  state.lastDeckKey = deckKey;
  dom.deckBar.innerHTML = self.deck.map((heroId, index) => {
    const hero = HEROES[heroId] || HEROES.archer;
    const cooldown = Math.max(0, Math.ceil(((self.cooldowns?.[heroId] || 0) - now) / 1000));
    const active = heroId === self.heroId;
    return `<button class="deck-slot${active ? " active" : ""}${cooldown ? " disabled" : ""}" style="--hero-color:${hero.color}" data-slot="${index}" type="button">
      ${heroArt(heroId, true)}
      <span>${index + 1}. ${hero.name}</span>
      <small>${hero.role}</small>
      ${cooldown ? `<div class="cooldown">${cooldown}</div>` : ""}
    </button>`;
  }).join("");
  dom.deckBar.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => selectDeckIndex(Number(button.dataset.slot)));
  });
}

function renderAbility(self, hero) {
  const now = Date.now();
  const abilityReady = now >= (self.abilityCooldownUntil || 0);
  dom.abilityBtn.textContent = abilityReady ? `Q ${hero.ability.name}` : `Q ${Math.ceil(((self.abilityCooldownUntil || 0) - now) / 1000)}s`;
  dom.abilityBtn.classList.toggle("ready", abilityReady);
  const supportAllowed = self.heroId === "balloon" && state.room.players.length === 2;
  const supportReady = supportAllowed && now >= (self.supportCooldownUntil || 0);
  dom.supportBtn.disabled = !supportAllowed;
  dom.supportBtn.textContent = supportAllowed ? supportReady ? "E Suporte" : `E ${Math.ceil(((self.supportCooldownUntil || 0) - now) / 1000)}s` : "E 1v1";
  dom.supportBtn.classList.toggle("ready", supportReady);
}

function selectDeckIndex(index) {
  const self = me();
  const heroId = self?.deck?.[index];
  if (!heroId) return;
  socket.emit("deck-heroes:selectHero", { heroId });
}

function onKey(event, pressed) {
  if (state.playing && ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  state.keys[event.code] = pressed;
  if (!pressed) return;
  if (/^Digit[1-8]$/.test(event.code)) selectDeckIndex(Number(event.code.slice(5)) - 1);
  if (event.code === "KeyQ") castAbility();
  if (event.code === "KeyE") callSupport();
}

function onMouseMove(event) {
  if (!state.locked || !state.playing) return;
  state.yaw -= event.movementX * 0.0026;
  state.pitch = Math.max(-0.82, Math.min(0.55, state.pitch - event.movementY * 0.0022));
}

function onMouseDown(event) {
  if (!state.playing) return;
  if (!state.locked) {
    dom.canvas.requestPointerLock();
    return;
  }
  if (event.button === 0) attack();
}

function castAbility() {
  if (!state.playing) return;
  const forward = aimDirection(false);
  const point = state.localPosition.clone().addScaledVector(forward, 14);
  triggerUnitAction(units.get(state.selfId), "ability");
  socket.emit("deck-heroes:ability", { x: point.x, z: point.z });
}

function callSupport() {
  if (!state.playing) return;
  socket.emit("deck-heroes:support", { heroId: dom.supportSelect.value || "knight" });
}

function attack() {
  const self = me();
  if (!self?.alive) return;
  const now = performance.now();
  if (now - state.lastAttackAt < 130) return;
  state.lastAttackAt = now;
  const aim = aimDirection(true);
  triggerUnitAction(units.get(state.selfId), "attack");
  socket.emit("deck-heroes:attack", { aimX: aim.x, aimY: aim.y, aimZ: aim.z });
}

function updateMovement(delta) {
  const self = me();
  if (!self?.alive) return;
  const hero = HEROES[self.heroId] || HEROES.archer;
  const forwardInput = Number(Boolean(state.keys.KeyW)) - Number(Boolean(state.keys.KeyS));
  const strafeInput = Number(Boolean(state.keys.KeyD)) - Number(Boolean(state.keys.KeyA));
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const movement = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(strafeInput));
  const isMoving = movement.lengthSq() > 0;
  if (movement.lengthSq() > 0) {
    movement.normalize().multiplyScalar(MOVE_SPEED * hero.speed * delta);
    const next = state.localPosition.clone().add(movement);
    next.x = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, next.x));
    next.z = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, next.z));
    state.localPosition.copy(legalLocalPosition(self.heroId, state.localPosition, next));
    self.x = state.localPosition.x;
    self.z = state.localPosition.z;
  }
  self.yaw = state.yaw;
  const selfUnit = units.get(state.selfId);
  if (selfUnit) {
    selfUnit.moving = isMoving;
    updateUnitVisual(selfUnit, self, true);
  }
  const now = performance.now();
  if (now - state.lastMoveSent > MOVE_SEND_MS) {
    state.lastMoveSent = now;
    socket.emit("deck-heroes:move", {
      x: state.localPosition.x,
      z: state.localPosition.z,
      yaw: state.yaw
    });
  }
}

function updateCamera(delta) {
  const target = state.localPosition.clone();
  target.y = unitHeight(me()?.heroId || "archer") + 0.2;
  const back = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).multiplyScalar(7.8);
  const height = 4.4 - Math.min(0, state.pitch) * 1.5;
  const desired = target.clone().add(back).add(new THREE.Vector3(0, height, 0));
  const lookTarget = target.clone().addScaledVector(aimDirection(true), 12);
  camera.position.lerp(desired, Math.min(1, delta * 9));
  camera.lookAt(lookTarget);
}

function updateVisuals(delta) {
  units.forEach((unit, id) => {
    if (String(id).startsWith("support:")) return;
    if (id !== state.selfId) {
      const beforeX = unit.group.position.x;
      const beforeZ = unit.group.position.z;
      unit.group.position.x = THREE.MathUtils.lerp(unit.group.position.x, unit.target.x, Math.min(1, delta * 12));
      unit.group.position.z = THREE.MathUtils.lerp(unit.group.position.z, unit.target.z, Math.min(1, delta * 12));
      unit.group.rotation.y = THREE.MathUtils.lerp(unit.group.rotation.y, unit.target.yaw, Math.min(1, delta * 12));
      unit.moving = Math.hypot(unit.group.position.x - beforeX, unit.group.position.z - beforeZ) > 0.006;
    }
    updateUnitAnimation(unit, delta);
  });
  supports.forEach((unit) => {
    const beforeX = unit.group.position.x;
    const beforeZ = unit.group.position.z;
    unit.group.position.x = THREE.MathUtils.lerp(unit.group.position.x, unit.target.x, Math.min(1, delta * 9));
    unit.group.position.z = THREE.MathUtils.lerp(unit.group.position.z, unit.target.z, Math.min(1, delta * 9));
    unit.moving = Math.hypot(unit.group.position.x - beforeX, unit.group.position.z - beforeZ) > 0.006;
    updateUnitAnimation(unit, delta);
  });
  for (let i = transient.length - 1; i >= 0; i--) {
    const item = transient[i];
    item.update?.(delta, item);
    item.life -= delta;
    if (item.material) item.material.opacity = Math.max(0, item.life / item.maxLife);
    if (item.life > 0) continue;
    scene.remove(item.object);
    item.object.geometry?.dispose?.();
    item.material?.dispose?.();
    transient.splice(i, 1);
  }
}

function projectileObject(heroId, color) {
  const hero = HEROES[heroId] || {};
  const type = heroId === "tower" ? "cannon" : hero.projectile || "slash";
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.45, emissive: type === "magic" || type === "heal" ? color : 0x000000, emissiveIntensity: 0.35 });
  if (type === "arrow" || type === "spear" || type === "bone_arrow") {
    const isBone = type === "bone_arrow";
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(type === "spear" ? 0.045 : 0.028, type === "spear" ? 0.045 : 0.028, type === "spear" ? 1.35 : 1.05, 8), isBone ? new THREE.MeshStandardMaterial({ color: 0xe7edf0, roughness: 0.7 }) : material);
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(type === "spear" ? 0.14 : 0.1, type === "spear" ? 0.34 : 0.24, 8), new THREE.MeshStandardMaterial({ color: isBone ? 0xbac3c7 : 0xe8eef0, roughness: 0.35 }));
    head.rotation.x = Math.PI / 2;
    head.position.z = type === "spear" ? 0.78 : 0.62;
    group.add(shaft, head);
  } else if (type === "bomb" || type === "cannon") {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(type === "cannon" ? 0.28 : 0.34, 16, 12), new THREE.MeshStandardMaterial({ color: type === "cannon" ? 0x22292b : 0x313638, roughness: 0.62 }));
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 6), new THREE.MeshStandardMaterial({ color: 0xf3ca58 }));
    fuse.position.set(0.12, 0.25, 0);
    fuse.rotation.z = -0.55;
    group.add(ball, fuse);
  } else if (type === "magic" || type === "heal") {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12), material);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 }));
    halo.rotation.x = Math.PI / 2;
    group.add(orb, halo);
  } else {
    const slash = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 28, Math.PI * 1.25), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82 }));
    slash.rotation.x = Math.PI / 2;
    group.add(slash);
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return group;
}

function projectileLine(from, to, heroId = "tower", endOverride = null) {
  if (!scene) return;
  const color = new THREE.Color(HEROES[heroId]?.color || (heroId === "tower" ? "#ffe082" : "#ffffff"));
  const start = targetPosition(from);
  const end = endOverride
    ? new THREE.Vector3(Number(endOverride.x) || 0, Number(endOverride.y) || 0, Number(endOverride.z) || 0)
    : targetPosition(to);
  start.y += from.kind ? 0.2 : 0.45;
  const object = projectileObject(heroId, color);
  object.position.copy(start);
  scene.add(object);
  const duration = HEROES[heroId]?.projectile === "bomb" || heroId === "tower" ? 0.46 : 0.28;
  transient.push({
    object,
    life: duration,
    maxLife: duration,
    start,
    end,
    elapsed: 0,
    update(delta, item) {
      item.elapsed += delta;
      const t = Math.min(1, item.elapsed / item.maxLife);
      object.position.lerpVectors(item.start, item.end, t);
      object.position.y += Math.sin(t * Math.PI) * (HEROES[heroId]?.projectile === "bomb" || heroId === "tower" ? 2.1 : 0.45);
      const dir = item.end.clone().sub(item.start).normalize();
      if (dir.lengthSq() > 0) object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      object.rotation.z += delta * 7;
    }
  });
}

function addTransient(object, life, material = null, update = null) {
  scene.add(object);
  transient.push({ object, material, life, maxLife: life, elapsed: 0, update });
}

function expandingRing(x, z, color, radius = 4, life = 0.7) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.1, 42), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(Number(x) || 0, 0.12, Number(z) || 0);
  addTransient(ring, life, material, (delta, item) => {
    item.elapsed += delta;
    const t = Math.min(1, item.elapsed / item.maxLife);
    ring.scale.setScalar(0.35 + t * radius);
    material.opacity = 0.62 * (1 - t);
  });
}

function fallingProjectile(heroId, start, end, life = 0.55, arc = 0) {
  const object = projectileObject(heroId, new THREE.Color(HEROES[heroId]?.color || "#ffffff"));
  object.position.copy(start);
  addTransient(object, life, null, (delta, item) => {
    item.elapsed += delta;
    const t = Math.min(1, item.elapsed / item.maxLife);
    object.position.lerpVectors(start, end, t);
    object.position.y += Math.sin(t * Math.PI) * arc;
    const dir = end.clone().sub(start).normalize();
    if (dir.lengthSq() > 0) object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    object.rotation.z += delta * 10;
  });
}

function arrowRainEffect(x, z) {
  expandingRing(x, z, 0x8bd450, 5.2, 0.85);
  for (let i = 0; i < 16; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 4.8;
    const end = new THREE.Vector3(x + Math.cos(angle) * distance, 0.45, z + Math.sin(angle) * distance);
    const start = end.clone().add(new THREE.Vector3(-1.8 + Math.random() * 1.2, 10 + Math.random() * 4, -1.4 + Math.random() * 1.1));
    fallingProjectile("archer", start, end, 0.42 + Math.random() * 0.28);
  }
}

function meteorEffect(x, z) {
  const start = new THREE.Vector3(x - 7, 13, z - 5);
  const end = new THREE.Vector3(x, 0.65, z);
  const meteor = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 18, 12),
    new THREE.MeshStandardMaterial({ color: 0xff6d3a, emissive: 0xff461a, emissiveIntensity: 1.2, roughness: 0.4 })
  );
  addTransient(meteor, 0.72, null, (delta, item) => {
    item.elapsed += delta;
    const t = Math.min(1, item.elapsed / item.maxLife);
    meteor.position.lerpVectors(start, end, t);
    meteor.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.35);
    if (t > 0.86 && !item.burst) {
      item.burst = true;
      expandingRing(x, z, 0xff7a32, 6.3, 0.62);
    }
  });
}

function smokeStepEffect(x, z) {
  for (let i = 0; i < 10; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0x2b2634, transparent: true, opacity: 0.45 });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.3, 10, 8), material);
    puff.position.set(x + (Math.random() - 0.5) * 1.8, 0.45 + Math.random() * 0.8, z + (Math.random() - 0.5) * 1.8);
    addTransient(puff, 0.62, material, (delta, item) => {
      item.elapsed += delta;
      puff.position.y += delta * 0.9;
      puff.scale.multiplyScalar(1 + delta * 1.5);
      material.opacity = 0.45 * (1 - item.elapsed / item.maxLife);
    });
  }
}

function rageEffect(socketId, x, z) {
  const material = new THREE.MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.55, 36), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.16, z);
  addTransient(ring, 1.1, material, (delta, item) => {
    item.elapsed += delta;
    const unit = units.get(socketId);
    if (unit) ring.position.copy(unit.group.position).setY(0.16);
    ring.scale.setScalar(1 + Math.sin(item.elapsed * 16) * 0.18 + item.elapsed * 0.7);
    material.opacity = 0.62 * (1 - item.elapsed / item.maxLife);
  });
}

function healWaveEffect(x, z) {
  expandingRing(x, z, 0x7de0c5, 7.8, 0.9);
  const material = new THREE.MeshBasicMaterial({ color: 0xbffff1, transparent: true, opacity: 0.45 });
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.2, 0.16), material);
  const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.34, 0.16), material);
  const group = new THREE.Group();
  group.add(cross, cross2);
  group.position.set(x, 2.1, z);
  addTransient(group, 0.82, material, (delta, item) => {
    item.elapsed += delta;
    group.position.y += delta * 1.4;
    group.rotation.y += delta * 2.2;
    material.opacity = 0.45 * (1 - item.elapsed / item.maxLife);
  });
}

function bombEffect(x, z, color = 0xf0c34a) {
  fallingProjectile("bomber", new THREE.Vector3(x - 2.8, 6.5, z - 2), new THREE.Vector3(x, 0.6, z), 0.55, 1.1);
  setTimeout(() => {
    if (scene) expandingRing(x, z, color, 5.8, 0.62);
  }, 360);
}

function pierceEffect(x, z, color = 0xa6d3ff) {
  expandingRing(x, z, color, 3.8, 0.45);
  for (let i = -1; i <= 1; i += 1) {
    const start = new THREE.Vector3(x - 5, 1.2, z + i * 0.8);
    const end = new THREE.Vector3(x + 5, 1.2, z + i * 0.8);
    fallingProjectile("lancer", start, end, 0.3);
  }
}

function playAbilityEffect({ socketId, x, z, heroId, abilityId }) {
  const unit = units.get(socketId);
  const base = unit?.group?.position || new THREE.Vector3(Number(x) || 0, 0, Number(z) || 0);
  const effectX = Number.isFinite(Number(x)) ? Number(x) : base.x;
  const effectZ = Number.isFinite(Number(z)) ? Number(z) : base.z;
  if (abilityId === "arrow_rain") arrowRainEffect(effectX, effectZ);
  else if (abilityId === "meteor") meteorEffect(effectX, effectZ);
  else if (abilityId === "shield_dash") pierceEffect(effectX, effectZ, 0x6aa8ff);
  else if (abilityId === "rage") rageEffect(socketId, effectX, effectZ);
  else if (abilityId === "smoke_step") smokeStepEffect(effectX, effectZ);
  else if (abilityId === "stomp") expandingRing(effectX, effectZ, 0xdf7d5e, 6.8, 0.75);
  else if (abilityId === "big_bomb") bombEffect(effectX, effectZ);
  else if (abilityId === "heal_wave") healWaveEffect(effectX, effectZ);
  else if (abilityId === "pierce" || abilityId === "bone_volley") pierceEffect(effectX, effectZ, heroId === "skeletonArcher" ? 0xe7edf0 : 0xa6d3ff);
  else if (abilityId === "curse") {
    expandingRing(effectX, effectZ, 0xa36bff, 5.6, 0.8);
    smokeStepEffect(effectX, effectZ);
  } else if (abilityId === "bone_dash") {
    expandingRing(effectX, effectZ, 0xe7edf0, 3.2, 0.5);
  } else {
    abilityMarker(effectX, effectZ, HEROES[heroId]?.color || 0xc98bff);
  }
}

function abilityMarker(x, z, color = 0xc98bff) {
  if (!scene) return;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 4.8, 32), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(Number(x) || 0, 0.09, Number(z) || 0);
  scene.add(ring);
  transient.push({ object: ring, material, life: 0.55, maxLife: 0.55 });
}

function render() {
  const delta = Math.min(clock?.getDelta?.() || 0.016, 0.05);
  if (state.playing && state.room) {
    updateMovement(delta);
    updateCamera(delta);
    updateVisuals(delta);
    renderHud();
  }
  if (composer) composer.render(delta);
  else renderer?.render(scene, camera);
  requestAnimationFrame(render);
}

function applyRoom(room) {
  state.room = room;
  if (room.status !== "playing") {
    const self = room.players?.find((player) => player.socketId === state.selfId);
    if (self?.deck?.length) {
      state.deck = cleanDeckSelection(self.deck);
      renderHeroCatalog();
    }
  }
  if (room.status === "playing") {
    if (!state.playing) startGame(room);
    else {
      syncTowers(room);
      syncUnits(room);
      syncSupports(room);
    }
  } else {
    if (state.playing) leaveGameView();
    renderLobby();
  }
  if (scene && room.status !== "playing") {
    syncTowers(room);
    syncUnits(room);
    syncSupports(room);
  }
}

dom.openRoomBtn.addEventListener("click", () => socket.emit("deck-heroes:open", { deck: state.deck }));
dom.readyBtn.addEventListener("click", () => socket.emit("deck-heroes:ready", { ready: !me()?.ready }));
dom.startBtn.addEventListener("click", () => socket.emit("deck-heroes:start"));
dom.leaveBtn.addEventListener("click", () => {
  socket.emit("deck-heroes:leave");
  state.room = null;
  leaveGameView();
});
dom.abilityBtn.addEventListener("click", castAbility);
dom.supportBtn.addEventListener("click", callSupport);
dom.backToLobbyBtn.addEventListener("click", leaveGameView);
dom.supportSelect.innerHTML = SUPPORT_ORDER.map((id) => `<option value="${id}">${HEROES[id].name}</option>`).join("");
window.addEventListener("error", (event) => {
  if (previewMode && dom.statusText) dom.statusText.textContent = `Preview erro: ${event.message}`;
});

socket.on("connect", () => {
  if (previewMode) return;
  state.selfId = socket.id;
  if (invitedRoomId) socket.emit("deck-heroes:join", { roomId: invitedRoomId, deck: state.deck });
  else socket.emit("deck-heroes:open", { deck: state.deck });
});
socket.on("connect_error", () => {
  if (previewMode) return;
  dom.statusText.textContent = token ? "Nao foi possivel conectar." : "Entre na sua conta do Album da Copa para jogar online.";
});
socket.on("deck-heroes:joined", applyRoom);
socket.on("deck-heroes:room", applyRoom);
socket.on("deck-heroes:state", applyRoom);
socket.on("deck-heroes:error", (message) => { dom.statusText.textContent = message || "Erro na sala."; });
socket.on("deck-heroes:move", (player) => {
  const unit = units.get(player.socketId);
  if (!unit) return;
  unit.target.x = player.x;
  unit.target.z = player.z;
  unit.target.yaw = player.yaw;
});
socket.on("deck-heroes:attack", ({ from, targetSocketId, towerId, heroId, endX, endY, endZ }) => {
  const attacker = state.room?.players?.find((player) => player.socketId === from);
  if (!attacker) return;
  triggerUnitAction(units.get(from), "attack");
  const targetPlayer = state.room.players.find((player) => player.socketId === targetSocketId);
  const targetTower = state.room.towers.find((tower) => tower.id === towerId);
  const targetSupport = state.room.supports?.find((support) => support.id === targetSocketId);
  const target = targetPlayer || targetSupport || targetTower;
  const hasEndPoint = Number.isFinite(Number(endX)) && Number.isFinite(Number(endY)) && Number.isFinite(Number(endZ));
  if (target || hasEndPoint) {
    projectileLine(attacker, target || attacker, heroId || attacker.heroId, hasEndPoint ? { x: endX, y: endY, z: endZ } : null);
  }
});
socket.on("deck-heroes:ability", ({ socketId, x, z, heroId, abilityId }) => {
  triggerUnitAction(units.get(socketId), "ability");
  playAbilityEffect({ socketId, x, z, heroId, abilityId });
});
socket.on("deck-heroes:summon", ({ socketId, heroId }) => {
  const summoner = state.room?.players?.find((player) => player.socketId === socketId);
  if (!summoner) return;
  triggerUnitAction(units.get(socketId), "ability");
  abilityMarker(summoner.x, summoner.z + (summoner.team === "blue" ? 2.4 : -2.4), HEROES[heroId]?.color || 0xa36bff);
});
socket.on("deck-heroes:support", ({ socketId, heroId }) => {
  const summoner = state.room?.players?.find((player) => player.socketId === socketId);
  if (!summoner) return;
  triggerUnitAction(units.get(socketId), "ability");
  expandingRing(summoner.x, summoner.z + (summoner.team === "blue" ? 2.8 : -2.8), HEROES[heroId]?.color || 0xa36bff, 3.8, 0.65);
});
socket.on("deck-heroes:tower-fire", ({ towerId, targetId }) => {
  const tower = state.room?.towers?.find((item) => item.id === towerId);
  const target = state.room?.players?.find((item) => item.socketId === targetId)
    || state.room?.supports?.find((item) => item.id === targetId);
  if (tower && target) projectileLine(tower, target, "tower");
});
socket.on("deck-heroes:end", ({ winner }) => {
  dom.endTitle.textContent = winner === "draw" ? "Empate" : `${winner === "blue" ? "Azul" : "Vermelho"} venceu`;
  dom.endOverlay.hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
});

renderHeroCatalog();
renderLobby();
if (previewMode) {
  state.selfId = "preview-blue";
  try {
    applyRoom({
      roomId: "PREV",
      status: "playing",
      hostSocketId: "preview-blue",
      endsAt: Date.now() + 360000,
      message: "Preview local",
      players: [
        {
          socketId: "preview-blue", username: "Voce", team: "blue", deck: state.deck, ready: true,
          heroId: "archer", x: -7, z: -31, yaw: Math.PI, hp: 130, maxHp: 130, alive: true,
          cooldowns: {}, abilityCooldownUntil: 0, supportCooldownUntil: 0, kills: 0, deaths: 0
        },
        {
          socketId: "preview-red", username: "Rival", team: "red", deck: state.deck, ready: true,
          heroId: "knight", x: 7, z: 31, yaw: 0, hp: 220, maxHp: 220, alive: true,
          cooldowns: {}, abilityCooldownUntil: 0, supportCooldownUntil: 0, kills: 0, deaths: 0
        }
      ],
      towers: [
        { id: "red-left", team: "red", kind: "side", x: -14, z: 29, hp: 620, maxHp: 620, alive: true },
        { id: "red-right", team: "red", kind: "side", x: 14, z: 29, hp: 620, maxHp: 620, alive: true },
        { id: "red-king", team: "red", kind: "king", x: 0, z: 37, hp: 980, maxHp: 980, alive: true },
        { id: "blue-left", team: "blue", kind: "side", x: -14, z: -29, hp: 620, maxHp: 620, alive: true },
        { id: "blue-right", team: "blue", kind: "side", x: 14, z: -29, hp: 620, maxHp: 620, alive: true },
        { id: "blue-king", team: "blue", kind: "king", x: 0, z: -37, hp: 980, maxHp: 980, alive: true }
      ],
      supports: []
    });
  } catch (error) {
    dom.statusText.textContent = `Preview erro: ${error.message}`;
  }
}
