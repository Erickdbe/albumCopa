import {
  CLASSES, CLASS_ORDER, SECONDARY_WEAPONS, SECONDARY_ORDER, MAP_META, MAP_ORDER,
  MATCH_DURATIONS_MIN, SCORE_LIMITS
} from "./config.js";
import { attachSocket, onMatchEnd, initGamePlayerJoinHandler } from "./game.js";

const socket = window.io(window.location.origin);
attachSocket(socket);
initGamePlayerJoinHandler(socket);

const el = (id) => document.getElementById(id);
const screens = {
  title: el("screenTitle"),
  setup: el("screenSetup"),
  room: el("screenRoom")
};
function showScreen(name) {
  Object.values(screens).forEach((s) => { s.hidden = true; });
  screens[name].hidden = false;
}

const state = {
  username: "Jogador" + Math.floor(Math.random() * 900 + 100),
  classId: "rifle",
  secondaryId: "pistol_common",
  settings: {
    mapId: "praia", durationMin: 10, scoreLimit: 50, mode: "ffa",
    moveSpeedMul: 1, jumpHeightMul: 1, grenadesEnabled: true, secondaryEnabled: true, maxPlayers: 10
  },
  currentRoom: null
};

/* ── Tela inicial ───────────────────────────────────────────────────── */
el("nicknameInput").value = state.username;
el("nicknameInput").addEventListener("input", (e) => { state.username = e.target.value.slice(0, 18) || state.username; });
el("playBtn").addEventListener("click", () => { buildSetupScreen(); showScreen("setup"); });

/* ── Tela de setup (classe, mapa, opcoes) ───────────────────────────── */
function buildSetupScreen() {
  const classGrid = el("classGrid");
  classGrid.innerHTML = "";
  CLASS_ORDER.forEach((id) => {
    const c = CLASSES[id];
    const card = document.createElement("div");
    card.className = "pick-card" + (id === state.classId ? " selected" : "");
    card.style.setProperty("--accent", c.color);
    card.innerHTML = `<strong>${c.name}</strong><small>${c.desc}</small><small class="ability-tag">Q: ${c.ability.name}</small>`;
    card.addEventListener("click", () => {
      state.classId = id;
      classGrid.querySelectorAll(".pick-card").forEach((n) => n.classList.remove("selected"));
      card.classList.add("selected");
    });
    classGrid.appendChild(card);
  });

  const secGrid = el("secondaryGrid");
  secGrid.innerHTML = "";
  SECONDARY_ORDER.forEach((id) => {
    const w = SECONDARY_WEAPONS[id];
    const card = document.createElement("div");
    card.className = "pick-card small" + (id === state.secondaryId ? " selected" : "");
    card.innerHTML = `<strong>${w.name}</strong>`;
    card.addEventListener("click", () => {
      state.secondaryId = id;
      secGrid.querySelectorAll(".pick-card").forEach((n) => n.classList.remove("selected"));
      card.classList.add("selected");
    });
    secGrid.appendChild(card);
  });

  const mapGrid = el("mapGrid");
  mapGrid.innerHTML = "";
  MAP_ORDER.forEach((id) => {
    const m = MAP_META[id];
    const card = document.createElement("div");
    card.className = "pick-card map-card" + (id === state.settings.mapId ? " selected" : "");
    card.style.background = `linear-gradient(160deg, #${m.sky.toString(16).padStart(6, "0")}, #${m.ground.toString(16).padStart(6, "0")})`;
    card.innerHTML = `<strong>${m.name}</strong>`;
    card.addEventListener("click", () => {
      state.settings.mapId = id;
      mapGrid.querySelectorAll(".pick-card").forEach((n) => n.classList.remove("selected"));
      card.classList.add("selected");
    });
    mapGrid.appendChild(card);
  });

  fillSelect(el("durationSelect"), MATCH_DURATIONS_MIN, state.settings.durationMin, (v) => `${v} min`);
  fillSelect(el("scoreLimitSelect"), SCORE_LIMITS, state.settings.scoreLimit, (v) => `${v} pts`);
  el("modeSelect").value = state.settings.mode;
  el("speedRange").value = state.settings.moveSpeedMul;
  el("jumpRange").value = state.settings.jumpHeightMul;
  el("grenadesToggle").checked = state.settings.grenadesEnabled;
  el("secondaryToggle").checked = state.settings.secondaryEnabled;
  el("maxPlayersRange").value = state.settings.maxPlayers;
  el("maxPlayersLabel").textContent = state.settings.maxPlayers;
  el("speedLabel").textContent = `${Math.round(state.settings.moveSpeedMul * 100)}%`;

  refreshLobbyRooms();
}

function fillSelect(selectEl, options, current, label) {
  selectEl.innerHTML = options.map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${label(v)}</option>`).join("");
}

function readSettingsFromForm() {
  state.settings.durationMin = Number(el("durationSelect").value);
  state.settings.scoreLimit = Number(el("scoreLimitSelect").value);
  state.settings.mode = el("modeSelect").value;
  state.settings.moveSpeedMul = Number(el("speedRange").value);
  state.settings.jumpHeightMul = Number(el("jumpRange").value);
  state.settings.grenadesEnabled = el("grenadesToggle").checked;
  state.settings.secondaryEnabled = el("secondaryToggle").checked;
  state.settings.maxPlayers = Number(el("maxPlayersRange").value);
  return { ...state.settings };
}

el("maxPlayersRange").addEventListener("input", (e) => { el("maxPlayersLabel").textContent = e.target.value; });
el("speedRange").addEventListener("input", (e) => { el("speedLabel").textContent = `${Math.round(e.target.value * 100)}%`; });

el("createRoomBtn").addEventListener("click", () => {
  socket.emit("room:create", {
    username: state.username,
    settings: readSettingsFromForm(),
    classId: state.classId,
    secondaryId: state.secondaryId
  });
});

el("joinRoomBtn").addEventListener("click", () => {
  const roomId = el("joinRoomInput").value.trim().toUpperCase();
  if (!roomId) return;
  socket.emit("room:join", { username: state.username, roomId, classId: state.classId, secondaryId: state.secondaryId });
});

el("backToTitleBtn").addEventListener("click", () => showScreen("title"));

function refreshLobbyRooms() {
  socket.emit("lobby:list");
}
socket.on("lobby:rooms", (rooms) => {
  const listEl = el("lobbyRoomList");
  if (!listEl) return;
  listEl.innerHTML = rooms.length ? rooms.map((r) =>
    `<div class="room-row" data-room="${r.roomId}">
      <span>${r.roomId} — ${MAP_META[r.mapId]?.name || r.mapId} (${r.mode === "teams" ? "Time x Time" : "Todos contra todos"})</span>
      <span>${r.playerCount}/${r.maxPlayers} <button class="mini-btn" data-join="${r.roomId}">Entrar</button></span>
    </div>`
  ).join("") : `<div class="room-row empty">Nenhuma sala aberta. Crie a primeira!</div>`;
  listEl.querySelectorAll("[data-join]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("room:join", { username: state.username, roomId: btn.dataset.join, classId: state.classId, secondaryId: state.secondaryId });
    });
  });
});
socket.on("connect", refreshLobbyRooms);

/* ── Tela de sala ───────────────────────────────────────────────────── */
socket.on("room:error", (message) => { el("setupError").textContent = message || "Erro."; });

socket.on("room:joined", (roomState) => {
  state.currentRoom = roomState.roomId;
  renderRoomScreen(roomState);
  showScreen("room");
});

socket.on("room:update", (roomState) => {
  if (roomState.roomId !== state.currentRoom) return;
  if (roomState.status === "waiting") renderRoomScreen(roomState);
});

socket.on("room:player-left", () => {
  // room:update ja chega em seguida com a lista atualizada
});

function renderRoomScreen(roomState) {
  const isHost = roomState.hostSocketId === socket.id;
  el("roomCodeLabel").textContent = roomState.roomId;
  el("roomSettingsLabel").textContent =
    `${MAP_META[roomState.settings.mapId]?.name || roomState.settings.mapId} · ${roomState.settings.durationMin} min · ${roomState.settings.scoreLimit} pts · ${roomState.settings.mode === "teams" ? "Time x Time" : "Todos contra todos"}`;
  el("roomPlayerList").innerHTML = roomState.players.map((p) =>
    `<div class="room-player-row">
      <span>${p.username}${p.socketId === roomState.hostSocketId ? " (host)" : ""}</span>
      <span class="tag" style="color:${CLASSES[p.classId]?.color || "#fff"}">${CLASSES[p.classId]?.name || p.classId}</span>
      ${p.team ? `<span class="tag team-${p.team}">${p.team === "red" ? "Vermelho" : "Azul"}</span>` : ""}
    </div>`
  ).join("");
  el("startMatchBtn").hidden = !isHost;
  el("startMatchBtn").disabled = roomState.players.length < 1;
}

el("startMatchBtn").addEventListener("click", () => socket.emit("room:start"));
el("leaveRoomBtn").addEventListener("click", () => {
  socket.emit("room:leave");
  state.currentRoom = null;
  showScreen("setup");
});

onMatchEnd(() => {
  showScreen("room");
  refreshLobbyRooms();
});

showScreen("title");
