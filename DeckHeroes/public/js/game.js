import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
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

let scene, camera, renderer, clock, raycaster;
const units = new Map();
const towers = new Map();
const supports = new Map();
const modelPromises = new Map();
const transient = [];

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

function renderHeroCatalog() {
  const indexes = new Map(state.deck.map((id, index) => [id, index + 1]));
  dom.deckCount.textContent = `${state.deck.length}/8`;
  dom.heroCatalog.innerHTML = HERO_ORDER.map((id) => {
    const hero = HEROES[id];
    const selected = indexes.has(id);
    return `<button class="hero-card${selected ? " selected" : ""}" style="--hero-color:${hero.color}" data-hero="${id}" type="button">
      ${selected ? `<em>${indexes.get(id)}</em>` : ""}
      <img src="${sampleForHero(id)}" alt="">
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

function toggleDeckHero(heroId) {
  const index = state.deck.indexOf(heroId);
  if (index >= 0) {
    if (state.deck.length <= 1) return;
    state.deck.splice(index, 1);
  } else if (state.deck.length < 8) {
    state.deck.push(heroId);
  }
  state.deck = normalizeDeck(state.deck);
  renderHeroCatalog();
  if (state.room?.status === "waiting") socket.emit("deck-heroes:setDeck", { deck: state.deck });
}

function me() {
  return state.room?.players?.find((player) => player.socketId === state.selfId) || null;
}

function enemyTeam(team) {
  return team === "blue" ? "red" : "blue";
}

function renderLobby() {
  const room = state.room;
  dom.roomCode.textContent = room ? room.roomId : "Offline";
  dom.openRoomBtn.textContent = room ? "Reenviar convites" : "Abrir sala";
  const playerCount = room?.players?.length || 0;
  dom.statusText.textContent = room
    ? playerCount % 2 === 0 && playerCount >= 2 ? "Pronto para iniciar com times pares." : "Aguardando entrar mais 1 jogador para fechar par."
    : token ? "Abra uma sala para convidar todos online." : "Entre na sua conta do Album para jogar online.";
  dom.playerList.innerHTML = room?.players?.length ? room.players.map((player) => {
    const hero = HEROES[player.heroId] || HEROES.archer;
    return `<div class="player-row">
      <strong>${escapeHtml(player.username)}${player.socketId === room.hostSocketId ? " (host)" : ""}</strong>
      <span>${player.ready ? "Pronto" : "Montando"} · ${hero.name}</span>
    </div>`;
  }).join("") : `<div class="player-row"><strong>Nenhuma sala aberta</strong><span>offline</span></div>`;
  const self = me();
  dom.readyBtn.disabled = !room;
  dom.startBtn.disabled = !room || room.hostSocketId !== state.selfId || playerCount < 2 || playerCount % 2 !== 0;
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
  renderer.shadowMap.enabled = true;
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

function loadHeroAsset(heroId) {
  const hero = HEROES[heroId] || HEROES.archer;
  if (hero.model === "balloon") {
    return Promise.resolve({ root: buildBalloonModel(hero.color), animations: [] });
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
  return loadHeroAsset(heroId).then((asset) => ({
    model: cloneSkeleton(asset.root),
    animations: asset.animations
  }));
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
  unit.mixer?.update(delta);
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
  return group;
}

function buildBalloonModel(color) {
  const group = new THREE.Group();
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  balloon.position.y = 2.25;
  balloon.scale.y = 1.22;
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: 0x7a5132, roughness: 0.8 }));
  basket.position.y = 0.95;
  const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2f2319 });
  [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]].forEach(([x, z]) => {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 6), ropeMat);
    rope.position.set(x, 1.55, z);
    group.add(rope);
  });
  group.add(balloon, basket);
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
  group.add(fallback);
  scene.add(group);
  const unit = {
    group,
    model: fallback,
    mixer: null,
    actions: {},
    currentAction: null,
    actionLockUntil: 0,
    heroId,
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
    unit.group.remove(unit.model);
    unit.model = buildFallback(data.heroId);
    unit.group.add(unit.model);
    setupUnitAnimations(unit, []);
    instantiateHeroModel(data.heroId).then(({ model, animations }) => {
      if (!unit.group.parent || unit.heroId !== data.heroId) return;
      unit.group.remove(unit.model);
      unit.model = model;
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
    new THREE.CylinderGeometry(isKing ? 2.65 : 2.05, isKing ? 2.95 : 2.35, 0.55, 8),
    shadowMat
  );
  plinth.position.y = 0.28;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 1.85 : 1.35, isKing ? 2.15 : 1.62, isKing ? 4.1 : 3.15, 8),
    stoneMat
  );
  base.position.y = isKing ? 2.42 : 2.02;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const midBand = new THREE.Mesh(
    new THREE.CylinderGeometry(isKing ? 1.93 : 1.42, isKing ? 1.93 : 1.42, 0.28, 8),
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
    new THREE.CylinderGeometry(isKing ? 2.05 : 1.52, isKing ? 2.05 : 1.52, 0.36, 8),
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
  const entry = { group, data: tower };
  towers.set(tower.id, entry);
  return entry;
}

function syncTowers(room) {
  const present = new Set();
  room.towers.forEach((tower) => {
    present.add(tower.id);
    const entry = towers.get(tower.id) || createTower(tower);
    entry.data = tower;
    entry.group.visible = tower.alive !== false;
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
  state.pitch = Math.max(-0.85, Math.min(0.08, state.pitch - event.movementY * 0.002));
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
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
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
  const target = findAimTarget();
  triggerUnitAction(units.get(state.selfId), "attack");
  socket.emit("deck-heroes:attack", target || {});
}

function findAimTarget() {
  const self = me();
  if (!self) return null;
  const hero = HEROES[self.heroId] || HEROES.archer;
  const origin = state.localPosition;
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  let best = null;
  let bestScore = -Infinity;

  state.room.players.forEach((player) => {
    if (player.team === self.team || !player.alive || player.socketId === state.selfId) return;
    const to = new THREE.Vector3(player.x - origin.x, 0, player.z - origin.z);
    const dist = to.length();
    if (dist > hero.range + 3 || dist < 0.01) return;
    const dot = forward.dot(to.normalize());
    const score = dot * 2 - dist / Math.max(1, hero.range);
    if (dot > 0.45 && score > bestScore) {
      bestScore = score;
      best = { targetSocketId: player.socketId };
    }
  });

  state.room.towers.forEach((tower) => {
    if (tower.team === self.team || !tower.alive) return;
    const to = new THREE.Vector3(tower.x - origin.x, 0, tower.z - origin.z);
    const dist = to.length();
    if (dist > hero.range + 4 || dist < 0.01) return;
    const dot = forward.dot(to.normalize());
    const score = dot * 1.5 - dist / Math.max(1, hero.range);
    if (dot > 0.35 && score > bestScore) {
      bestScore = score;
      best = { towerId: tower.id };
    }
  });
  return best;
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
    state.localPosition.add(movement);
    state.localPosition.x = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, state.localPosition.x));
    state.localPosition.z = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, state.localPosition.z));
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
  target.y = 1.35;
  const back = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).multiplyScalar(7.8);
  const height = 4.8 + Math.abs(state.pitch) * 2.2;
  const desired = target.clone().add(back).add(new THREE.Vector3(0, height, 0));
  camera.position.lerp(desired, Math.min(1, delta * 9));
  camera.lookAt(target.add(new THREE.Vector3(0, 1.1, 0)));
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
    item.life -= delta;
    if (item.material) item.material.opacity = Math.max(0, item.life / item.maxLife);
    if (item.life > 0) continue;
    scene.remove(item.object);
    item.object.geometry?.dispose?.();
    item.material?.dispose?.();
    transient.splice(i, 1);
  }
}

function projectileLine(from, to, color = 0xffe082) {
  if (!scene) return;
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(from.x, 1.6, from.z),
    new THREE.Vector3(to.x, 1.3, to.z)
  ]), material);
  scene.add(line);
  transient.push({ object: line, material, life: 0.18, maxLife: 0.18 });
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
  renderer?.render(scene, camera);
  requestAnimationFrame(render);
}

function applyRoom(room) {
  state.room = room;
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
socket.on("deck-heroes:attack", ({ from, targetSocketId, towerId }) => {
  const attacker = state.room?.players?.find((player) => player.socketId === from);
  if (!attacker) return;
  triggerUnitAction(units.get(from), "attack");
  const targetPlayer = state.room.players.find((player) => player.socketId === targetSocketId);
  const targetTower = state.room.towers.find((tower) => tower.id === towerId);
  const target = targetPlayer || targetTower;
  if (target) projectileLine(attacker, target, HEROES[attacker.heroId]?.color || 0xffe082);
});
socket.on("deck-heroes:ability", ({ socketId, x, z, heroId }) => {
  triggerUnitAction(units.get(socketId), "ability");
  abilityMarker(x, z, HEROES[heroId]?.color || 0xc98bff);
});
socket.on("deck-heroes:tower-fire", ({ towerId, targetId }) => {
  const tower = state.room?.towers?.find((item) => item.id === towerId);
  const target = state.room?.players?.find((item) => item.socketId === targetId);
  if (tower && target) projectileLine(tower, target, tower.team === "blue" ? 0x8ec7ff : 0xff8e8e);
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
