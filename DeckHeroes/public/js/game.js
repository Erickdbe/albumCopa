import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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

function buildArena() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2.1, ARENA_HALF * 2.1),
    new THREE.MeshStandardMaterial({ color: 0x66874e, roughness: 0.88 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const laneMat = new THREE.MeshStandardMaterial({ color: 0xc8a965, roughness: 0.9 });
  [-14, 14, 0].forEach((x, index) => {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(index === 2 ? 7 : 5, 0.045, ARENA_HALF * 1.86), laneMat);
    lane.position.set(x, 0.025, 0);
    lane.receiveShadow = true;
    scene.add(lane);
  });
  const river = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2, 0.05, 4.2), new THREE.MeshStandardMaterial({ color: 0x5ba6d1, roughness: 0.35 }));
  river.position.y = 0.04;
  scene.add(river);
  [-1, 1].forEach((side) => {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 5.4), new THREE.MeshStandardMaterial({ color: 0x806343, roughness: 0.8 }));
    bridge.position.set(side * 14, 0.12, 0);
    bridge.receiveShadow = true;
    scene.add(bridge);
  });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x475d4b });
  [
    [0, -ARENA_HALF, ARENA_HALF * 2, 0.8], [0, ARENA_HALF, ARENA_HALF * 2, 0.8],
    [-ARENA_HALF, 0, 0.8, ARENA_HALF * 2], [ARENA_HALF, 0, 0.8, ARENA_HALF * 2]
  ].forEach(([x, z, w, d]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), wallMat);
    wall.position.set(x, 1.1, z);
    wall.castShadow = true;
    scene.add(wall);
  });
}

function modelUrl(fileName) {
  return new URL(`../assets/kaykit/characters/${fileName}`, import.meta.url).href;
}

function loadHeroModel(heroId) {
  const hero = HEROES[heroId] || HEROES.archer;
  if (hero.model === "balloon") return Promise.resolve(buildBalloonModel(hero.color));
  if (!modelPromises.has(hero.model)) {
    const loader = new GLTFLoader();
    modelPromises.set(hero.model, loader.loadAsync(modelUrl(hero.model)).then((gltf) => {
      const root = gltf.scene;
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
    }));
  }
  return modelPromises.get(hero.model).then((source) => source.clone(true));
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
  const unit = { group, model: fallback, heroId, team, target: { x: 0, z: 0, yaw: 0 }, hp: 1, maxHp: 1 };
  loadHeroModel(heroId).then((model) => {
    if (!group.parent) return;
    group.remove(unit.model);
    unit.model = model;
    group.add(model);
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
    loadHeroModel(data.heroId).then((model) => {
      if (!unit.group.parent || unit.heroId !== data.heroId) return;
      unit.group.remove(unit.model);
      unit.model = model;
      unit.group.add(model);
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
    updateUnitVisual(unit, player, !state.playing);
    if (player.socketId === state.selfId) state.localPosition.set(player.x, 0, player.z);
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
  const color = tower.team === "blue" ? 0x4f8de8 : 0xd94e4e;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(tower.kind === "king" ? 1.8 : 1.35, tower.kind === "king" ? 2.1 : 1.55, tower.kind === "king" ? 4.2 : 3.2, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
  base.position.y = tower.kind === "king" ? 2.1 : 1.6;
  base.castShadow = true;
  group.add(base);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(tower.kind === "king" ? 2 : 1.45, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0xffdf75, roughness: 0.55 }));
  crown.position.y = tower.kind === "king" ? 4.8 : 3.7;
  crown.rotation.y = Math.PI / 4;
  group.add(crown);
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
  ensureScene();
  state.playing = true;
  state.room = room;
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
  dom.towerList.innerHTML = state.room.towers.map((tower) => {
    const pct = Math.max(0, tower.hp / tower.maxHp * 100);
    return `<div class="tower-row">
      <span>${tower.team === "blue" ? "Azul" : "Verm"} ${tower.kind}</span>
      <div class="tower-meter"><div style="width:${pct}%"></div></div>
      <strong>${Math.max(0, Math.round(tower.hp))}</strong>
    </div>`;
  }).join("");
  renderDeckBar(self);
  renderAbility(self, hero);
}

function renderDeckBar(self) {
  const now = Date.now();
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
  if (!state.locked || !self?.alive) return;
  const hero = HEROES[self.heroId] || HEROES.archer;
  const forwardInput = Number(Boolean(state.keys.KeyW)) - Number(Boolean(state.keys.KeyS));
  const strafeInput = Number(Boolean(state.keys.KeyD)) - Number(Boolean(state.keys.KeyA));
  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const movement = forward.multiplyScalar(forwardInput).add(right.multiplyScalar(strafeInput));
  if (movement.lengthSq() > 0) {
    movement.normalize().multiplyScalar(MOVE_SPEED * hero.speed * delta);
    state.localPosition.add(movement);
    state.localPosition.x = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, state.localPosition.x));
    state.localPosition.z = Math.max(-ARENA_HALF + 2, Math.min(ARENA_HALF - 2, state.localPosition.z));
    self.x = state.localPosition.x;
    self.z = state.localPosition.z;
    self.yaw = state.yaw;
    const selfUnit = units.get(state.selfId);
    if (selfUnit) updateUnitVisual(selfUnit, self, true);
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
    if (id === state.selfId) return;
    unit.group.position.x = THREE.MathUtils.lerp(unit.group.position.x, unit.target.x, Math.min(1, delta * 12));
    unit.group.position.z = THREE.MathUtils.lerp(unit.group.position.z, unit.target.z, Math.min(1, delta * 12));
    unit.group.rotation.y = THREE.MathUtils.lerp(unit.group.rotation.y, unit.target.yaw, Math.min(1, delta * 12));
  });
  supports.forEach((unit) => {
    unit.group.position.x = THREE.MathUtils.lerp(unit.group.position.x, unit.target.x, Math.min(1, delta * 9));
    unit.group.position.z = THREE.MathUtils.lerp(unit.group.position.z, unit.target.z, Math.min(1, delta * 9));
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
    startGame(room);
  } else {
    if (state.playing) leaveGameView();
    renderLobby();
  }
  if (scene) {
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
  const targetPlayer = state.room.players.find((player) => player.socketId === targetSocketId);
  const targetTower = state.room.towers.find((tower) => tower.id === towerId);
  const target = targetPlayer || targetTower;
  if (target) projectileLine(attacker, target, HEROES[attacker.heroId]?.color || 0xffe082);
});
socket.on("deck-heroes:ability", ({ x, z, heroId }) => abilityMarker(x, z, HEROES[heroId]?.color || 0xc98bff));
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
