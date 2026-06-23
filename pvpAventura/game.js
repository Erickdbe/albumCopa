(function () {
  const SERVER_URL = window.location.origin;
  const token = localStorage.getItem("mp_token") || "";
  const params = new URLSearchParams(window.location.search);

  const CHARACTER_IDS = ["blade", "stretch", "alchemist", "frost", "shadow", "robot"];
  const CHARACTERS = {
    blade: {
      name: "Espadachim Aventureiro",
      short: "Espadachim",
      role: "combo, dash e bloqueio",
      color: "#2d8cff",
      accent: "#f7c948",
      hp: 120,
      speed: 222,
      attack: "corte"
    },
    stretch: {
      name: "Heroi Elastico",
      short: "Elastico",
      role: "soco longo e agarrar",
      color: "#f6bd2b",
      accent: "#ff8c42",
      hp: 130,
      speed: 205,
      attack: "projetil"
    },
    alchemist: {
      name: "Alquimista Doce",
      short: "Alquimista",
      role: "cura e pocoes",
      color: "#f17cb0",
      accent: "#78d64b",
      hp: 104,
      speed: 198,
      attack: "projetil"
    },
    frost: {
      name: "Mago Gelado",
      short: "Gelo",
      role: "lentidao e controle",
      color: "#8dd8ff",
      accent: "#f7f4dc",
      hp: 112,
      speed: 188,
      attack: "projetil"
    },
    shadow: {
      name: "Guerreira Sombria",
      short: "Sombria",
      role: "teleporte e dano alto",
      color: "#37284f",
      accent: "#a970ff",
      hp: 108,
      speed: 230,
      attack: "corte"
    },
    robot: {
      name: "Robo Sucata",
      short: "Robo",
      role: "canhao, mina e escudo",
      color: "#6f8794",
      accent: "#ff8c42",
      hp: 142,
      speed: 176,
      attack: "projetil"
    }
  };

  const FIELD = { width: 1280, height: 768, tile: 32, playerRadius: 18, projectileRadius: 8 };

  const els = {
    connectionLabel: document.getElementById("connectionLabel"),
    userLabel: document.getElementById("userLabel"),
    characterGrid: document.getElementById("characterGrid"),
    characterHint: document.getElementById("characterHint"),
    betInput: document.getElementById("betInput"),
    trainingBtn: document.getElementById("trainingBtn"),
    createRoomBtn: document.getElementById("createRoomBtn"),
    leaveRoomBtn: document.getElementById("leaveRoomBtn"),
    onlineList: document.getElementById("onlineList"),
    onlineCount: document.getElementById("onlineCount"),
    chatLog: document.getElementById("chatLog"),
    chatCount: document.getElementById("chatCount"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    matchTitle: document.getElementById("matchTitle"),
    matchStatus: document.getElementById("matchStatus"),
    timerLabel: document.getElementById("timerLabel"),
    meCard: document.getElementById("meCard"),
    enemyCard: document.getElementById("enemyCard"),
    centerCard: document.getElementById("centerCard"),
    inviteBox: document.getElementById("inviteBox"),
    inviteText: document.getElementById("inviteText"),
    acceptInviteBtn: document.getElementById("acceptInviteBtn"),
    rejectInviteBtn: document.getElementById("rejectInviteBtn"),
    toast: document.getElementById("toast")
  };

  const state = {
    socket: null,
    connected: false,
    user: null,
    selectedCharacter: "blade",
    onlinePlayers: [],
    chat: [],
    room: null,
    pendingInviteRoomId: params.get("join") || "",
    localTraining: false,
    localLastTime: performance.now(),
    localProjectiles: [],
    localEffects: [],
    input: {
      keys: new Set(),
      pointerX: FIELD.width / 2,
      pointerY: FIELD.height / 2,
      attack: false,
      strong: false
    },
    phaserGame: null,
    scene: null,
    inputTimer: 0,
    toastTimer: 0,
    autoRequestHandled: false
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function setCenter(title, text, visible = true) {
    els.centerCard.classList.toggle("hidden", !visible);
    els.centerCard.innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  }

  function mapTemplate() {
    return {
      id: "forest",
      name: "Floresta de Aventura",
      theme: "forest",
      obstacles: [
        { x: 62, y: 64, w: 138, h: 112, type: "tower" },
        { x: 1038, y: 108, w: 152, h: 96, type: "house" },
        { x: 884, y: 584, w: 150, h: 94, type: "house" },
        { x: 328, y: 330, w: 78, h: 70, type: "rocks" },
        { x: 732, y: 298, w: 110, h: 78, type: "cliff" },
        { x: 154, y: 548, w: 118, h: 72, type: "trees" },
        { x: 538, y: 86, w: 92, h: 116, type: "trees" },
        { x: 1110, y: 474, w: 92, h: 146, type: "trees" }
      ],
      grass: [
        { x: 238, y: 112, w: 178, h: 96 },
        { x: 768, y: 130, w: 130, h: 92 },
        { x: 94, y: 390, w: 148, h: 82 },
        { x: 932, y: 358, w: 184, h: 82 },
        { x: 488, y: 586, w: 234, h: 86 }
      ],
      hazards: [
        { x: 512, y: 316, r: 42, type: "mud", slow: 0.55 },
        { x: 970, y: 250, r: 46, type: "mud", slow: 0.55 }
      ],
      decor: [
        { x: 252, y: 226, type: "stump" },
        { x: 440, y: 206, type: "rock" },
        { x: 704, y: 178, type: "rock" },
        { x: 798, y: 524, type: "stump" },
        { x: 1004, y: 506, type: "rock" },
        { x: 1170, y: 320, type: "flag" }
      ]
    };
  }

  function renderCharacters() {
    els.characterGrid.innerHTML = CHARACTER_IDS.map((id) => {
      const character = CHARACTERS[id];
      return `
        <button class="character-card ${state.selectedCharacter === id ? "is-active" : ""}" type="button" data-character="${id}">
          <span class="character-pixel" style="--c:${character.color};--a:${character.accent}"></span>
          <span>
            <strong>${esc(character.short)}</strong>
            <small>${esc(character.role)}</small>
          </span>
        </button>
      `;
    }).join("");
    els.characterHint.textContent = CHARACTERS[state.selectedCharacter].name;
  }

  function selectCharacter(id) {
    if (!CHARACTERS[id]) return;
    state.selectedCharacter = id;
    renderCharacters();
  }

  function updateConnectionLabel() {
    if (!token) {
      els.connectionLabel.textContent = "Offline";
      els.userLabel.textContent = "Treino liberado";
      return;
    }
    els.connectionLabel.textContent = state.connected ? "Online" : "Conectando...";
    els.userLabel.textContent = state.user?.username || "Jogador online";
  }

  function renderOnlineList(list = state.onlinePlayers) {
    const players = Array.isArray(list) ? list : [];
    state.onlinePlayers = players;
    els.onlineCount.textContent = `${players.length} players`;
    const usable = players.filter((player) => player.socketId !== state.socket?.id);
    if (!usable.length) {
      els.onlineList.innerHTML = `<div class="chat-message is-system">Ninguem disponivel agora.</div>`;
      return;
    }
    els.onlineList.innerHTML = usable.map((player) => {
      const status = player.inGame
        ? `${player.game || "jogo"}${player.spectatable ? " ao vivo" : ""}`
        : "disponivel";
      const action = player.inGame && player.spectatable
        ? `<button type="button" data-spectate="${esc(player.roomId)}">Assistir</button>`
        : !player.inGame
          ? `<button type="button" data-challenge="${esc(player.socketId)}">Desafiar</button>`
          : "";
      return `
        <div class="online-row">
          <span class="online-avatar">${player.avatar ? `<img src="${esc(player.avatar)}" alt="">` : ""}</span>
          <span><strong>${esc(player.username)}</strong><small>${esc(status)}</small></span>
          ${action}
        </div>
      `;
    }).join("");
  }

  function renderChat() {
    const messages = state.chat.slice(-80);
    els.chatCount.textContent = `${messages.length} msg`;
    if (!messages.length) {
      els.chatLog.innerHTML = `<div class="chat-message is-system">Chat online vazio.</div>`;
      return;
    }
    els.chatLog.innerHTML = messages.map((message) => {
      if (message.type === "system") {
        return `<div class="chat-message is-system">${esc(message.text)}</div>`;
      }
      return `<div class="chat-message"><strong>${esc(message.username || "Player")}:</strong> ${esc(message.text)}</div>`;
    }).join("");
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function myPlayer() {
    return state.room?.players?.find((player) => player.isMe) || null;
  }

  function enemyPlayer() {
    return state.room?.players?.find((player) => !player.isMe && !player.disconnected) || null;
  }

  function updateHud() {
    const room = state.room;
    const me = myPlayer();
    const enemy = enemyPlayer();
    els.matchTitle.textContent = room?.map?.name || "Floresta de Aventura";
    els.matchStatus.textContent = room?.message || "Escolha um personagem e abra uma sala.";
    if (room?.status === "playing") {
      els.centerCard.classList.add("hidden");
    }
    if (room?.status === "waiting") {
      setCenter("Sala aberta", "Aguardando outro jogador aceitar o desafio.", true);
    }
    if (room?.status === "finished") {
      setCenter("Partida encerrada", room.message || "Resultado definido.", true);
    }
    if (room?.gameLeftMs) {
      els.timerLabel.textContent = `${Math.ceil(room.gameLeftMs / 1000)}s`;
    } else {
      els.timerLabel.textContent = room?.status || "--";
    }
    updateFighterCard(els.meCard, me, "Voce");
    updateFighterCard(els.enemyCard, enemy, "Oponente");
  }

  function updateFighterCard(card, player, fallback) {
    const hp = player ? Math.max(0, Math.round(player.hp)) : 0;
    const maxHp = player ? Math.max(1, Math.round(player.maxHp)) : 100;
    card.querySelector("strong").textContent = player ? player.username : fallback;
    card.querySelector("span").textContent = player ? `${player.characterName} - ${hp} HP` : "Aguardando";
    card.querySelector("i").style.width = `${clamp((hp / maxHp) * 100, 0, 100)}%`;
  }

  class AdventureScene extends Phaser.Scene {
    constructor() {
      super("AdventureScene");
    }

    create() {
      state.scene = this;
      this.mapLayer = this.add.graphics();
      this.dynamicLayer = this.add.container(0, 0);
      this.input.mouse.disableContextMenu();
      this.input.on("pointermove", (pointer) => {
        state.input.pointerX = pointer.worldX;
        state.input.pointerY = pointer.worldY;
      });
      drawMap(this, mapTemplate());
      if (state.room) renderRoom(state.room);
    }

    update(_time, deltaMs) {
      if (state.localTraining) {
        updateTraining(deltaMs / 1000);
      }
    }
  }

  function ensureGame() {
    if (state.phaserGame) return;
    if (!window.Phaser) {
      setCenter("Phaser nao carregou", "Confira sua internet ou rode novamente quando a CDN estiver acessivel.", true);
      return;
    }
    state.phaserGame = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "gameMount",
      width: FIELD.width,
      height: FIELD.height,
      backgroundColor: "#4fb5b1",
      pixelArt: true,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: AdventureScene
    });
  }

  function drawMap(scene, map) {
    const g = scene.mapLayer;
    g.clear();
    g.fillStyle(0x4fb5b1, 1);
    g.fillRect(0, 0, FIELD.width, FIELD.height);

    g.fillStyle(0x7bc96f, 1);
    g.fillRoundedRect(34, 32, 1210, 704, 8);
    g.fillStyle(0x99d668, 1);
    for (let y = 48; y < FIELD.height - 48; y += FIELD.tile) {
      for (let x = 48; x < FIELD.width - 48; x += FIELD.tile) {
        if ((x / FIELD.tile + y / FIELD.tile) % 3 === 0) g.fillRect(x, y, 17, 8);
      }
    }

    g.fillStyle(0xd3b36a, 1);
    g.fillRect(180, 352, 920, 64);
    g.fillRect(610, 96, 76, 574);
    g.fillStyle(0xb9d664, 1);
    (map.grass || []).forEach((patch) => {
      g.fillStyle(0x5da84f, .72);
      g.fillRoundedRect(patch.x, patch.y, patch.w, patch.h, 8);
      g.fillStyle(0x315f42, .24);
      for (let x = patch.x + 8; x < patch.x + patch.w; x += 18) {
        g.fillRect(x, patch.y + 8 + ((x / 18) % 4) * 9, 5, 14);
      }
    });

    (map.hazards || []).forEach((hazard) => {
      g.fillStyle(0x8b7249, .7);
      g.fillCircle(hazard.x, hazard.y, hazard.r);
      g.fillStyle(0x5f4a31, .34);
      g.fillCircle(hazard.x - 10, hazard.y + 8, hazard.r * .45);
    });

    (map.obstacles || []).forEach((item) => drawObstacle(g, item));
    (map.decor || []).forEach((item) => drawDecor(g, item));
  }

  function drawObstacle(g, item) {
    if (item.type === "house") {
      g.fillStyle(0x8f5b34, 1);
      g.fillRect(item.x, item.y + 28, item.w, item.h - 28);
      g.fillStyle(0x2f6e8a, 1);
      g.fillTriangle(item.x - 10, item.y + 34, item.x + item.w / 2, item.y, item.x + item.w + 10, item.y + 34);
      g.fillStyle(0x203528, 1);
      g.fillRect(item.x + item.w / 2 - 12, item.y + item.h - 34, 24, 34);
      return;
    }
    if (item.type === "tower") {
      g.fillStyle(0x54778a, 1);
      g.fillRoundedRect(item.x, item.y, item.w, item.h, 8);
      g.fillStyle(0x2d5364, 1);
      g.fillRect(item.x + 12, item.y + 16, item.w - 24, item.h - 32);
      g.fillStyle(0xf4c247, 1);
      g.fillRect(item.x + item.w / 2 - 14, item.y + item.h - 34, 28, 28);
      return;
    }
    if (item.type === "trees") {
      for (let x = item.x; x < item.x + item.w; x += 34) {
        drawTree(g, x + 16, item.y + 28 + ((x / 34) % 2) * 18);
      }
      return;
    }
    g.fillStyle(item.type === "cliff" ? 0x7d918d : 0x6f8682, 1);
    g.fillRoundedRect(item.x, item.y, item.w, item.h, 6);
    g.fillStyle(0x536864, 1);
    g.fillRect(item.x + 8, item.y + item.h - 12, item.w - 16, 8);
  }

  function drawDecor(g, item) {
    if (item.type === "stump") {
      g.fillStyle(0x8f5b34, 1);
      g.fillRect(item.x - 12, item.y - 8, 24, 16);
      g.fillStyle(0x5b3b24, 1);
      g.fillRect(item.x - 7, item.y - 3, 14, 6);
      return;
    }
    if (item.type === "flag") {
      g.fillStyle(0x203528, 1);
      g.fillRect(item.x, item.y - 38, 5, 44);
      g.fillStyle(0xf05a48, 1);
      g.fillTriangle(item.x + 5, item.y - 38, item.x + 44, item.y - 28, item.x + 5, item.y - 18);
      return;
    }
    g.fillStyle(0x6f8682, 1);
    g.fillCircle(item.x, item.y, 13);
  }

  function drawTree(g, x, y) {
    g.fillStyle(0x6b4a2f, 1);
    g.fillRect(x - 5, y, 10, 22);
    g.fillStyle(0x2f7d56, 1);
    g.fillTriangle(x - 28, y + 6, x, y - 32, x + 28, y + 6);
    g.fillStyle(0x3fae66, 1);
    g.fillTriangle(x - 22, y - 12, x, y - 48, x + 22, y - 12);
  }

  function renderRoom(room) {
    state.room = room;
    ensureGame();
    if (!state.scene) return;
    if (state.scene.currentMapId !== room.map?.id) {
      state.scene.currentMapId = room.map?.id;
      drawMap(state.scene, room.map || mapTemplate());
    }
    state.scene.dynamicLayer.removeAll(true);
    const layer = state.scene.dynamicLayer;
    (room.mines || []).forEach((mine) => drawMine(state.scene, layer, mine));
    (room.projectiles || []).forEach((projectile) => drawProjectile(state.scene, layer, projectile));
    (room.players || []).slice().sort((a, b) => a.y - b.y).forEach((player) => drawPlayer(state.scene, layer, player));
    (room.effects || []).forEach((effect) => drawEffect(state.scene, layer, effect));
    updateHud();
  }

  function drawPlayer(scene, layer, player) {
    const color = Phaser.Display.Color.HexStringToColor(player.color || "#2d8cff").color;
    const accent = Phaser.Display.Color.HexStringToColor(player.accent || "#f7c948").color;
    const g = scene.add.graphics();
    g.setAlpha(player.disconnected ? .36 : 1);
    g.fillStyle(0x1b2d24, .24);
    g.fillEllipse(player.x, player.y + 20, 42, 16);
    if (player.shieldMs > 0) {
      g.lineStyle(4, accent, .74);
      g.strokeCircle(player.x, player.y, 34);
    }
    if (player.slowedMs > 0) {
      g.lineStyle(3, 0x8dd8ff, .72);
      g.strokeCircle(player.x, player.y + 2, 28);
    }

    const bob = Math.sin(performance.now() / 150 + player.x) * 2;
    g.fillStyle(color, 1);
    g.fillRect(player.x - 13, player.y - 14 + bob, 26, 31);
    g.fillStyle(accent, 1);
    g.fillRect(player.x - 10, player.y - 8 + bob, 20, 7);
    g.fillStyle(0xffead4, 1);
    g.fillRect(player.x - 10, player.y - 34 + bob, 20, 18);
    g.fillStyle(0x111812, 1);
    g.fillRect(player.x - 5 + Math.sign(player.faceX || 1) * 3, player.y - 27 + bob, 4, 4);
    g.fillRect(player.x + 4 + Math.sign(player.faceX || 1) * 3, player.y - 27 + bob, 4, 4);

    if (player.characterId === "blade") {
      g.lineStyle(5, accent, 1);
      g.lineBetween(player.x + 14, player.y - 7, player.x + 14 + (player.faceX || 1) * 26, player.y - 7 + (player.faceY || 0) * 26);
    } else if (player.characterId === "robot") {
      g.fillStyle(0x263943, 1);
      g.fillRect(player.x + 13, player.y - 9, 18, 10);
    } else if (player.characterId === "stretch") {
      g.lineStyle(6, accent, 1);
      g.lineBetween(player.x + 12, player.y - 6, player.x + 12 + (player.faceX || 1) * 24, player.y - 6 + (player.faceY || 0) * 24);
    }

    g.fillStyle(0x17251e, 1);
    g.fillRect(player.x - 25, player.y - 52, 50, 7);
    g.fillStyle(player.isMe ? 0x46c06f : 0xf05a48, 1);
    g.fillRect(player.x - 24, player.y - 51, 48 * clamp(player.hp / Math.max(1, player.maxHp), 0, 1), 5);

    const name = scene.add.text(player.x, player.y - 68, player.username || "Player", {
      fontFamily: "monospace",
      fontSize: "13px",
      fontStyle: "bold",
      color: "#fff6d8",
      stroke: "#17251e",
      strokeThickness: 4
    }).setOrigin(.5);
    layer.add([g, name]);
  }

  function drawProjectile(scene, layer, projectile) {
    const g = scene.add.graphics();
    const color = Phaser.Display.Color.HexStringToColor(projectile.color || "#f7c948").color;
    g.fillStyle(color, .95);
    if (projectile.type === "rocket" || projectile.type === "cannon") {
      g.fillRect(projectile.x - 10, projectile.y - 6, 20, 12);
      g.fillStyle(0xfff1a8, .88);
      g.fillCircle(projectile.x - Math.sign(projectile.vx || 1) * 10, projectile.y, 6);
    } else {
      g.fillCircle(projectile.x, projectile.y, projectile.radius || 8);
      g.fillStyle(0xffffff, .55);
      g.fillCircle(projectile.x - 3, projectile.y - 3, Math.max(2, (projectile.radius || 8) * .35));
    }
    layer.add(g);
  }

  function drawMine(scene, layer, mine) {
    const g = scene.add.graphics();
    g.fillStyle(0xff8c42, .24);
    g.fillCircle(mine.x, mine.y, mine.radius || 34);
    g.fillStyle(0x333333, 1);
    g.fillCircle(mine.x, mine.y, 12);
    g.fillStyle(0xf7c948, 1);
    g.fillRect(mine.x - 3, mine.y - 18, 6, 9);
    layer.add(g);
  }

  function drawEffect(scene, layer, effect) {
    const g = scene.add.graphics();
    const color = Phaser.Display.Color.HexStringToColor(effect.color || "#fff6d8").color;
    const age = Math.max(0, Number(effect.until || Date.now()) - Date.now());
    const alpha = clamp(age / 900, 0, 1);
    g.setAlpha(alpha);
    g.lineStyle(effect.type === "ultimate" ? 8 : 4, color, .9);
    if (effect.type === "slash" || effect.type === "heavy") {
      g.strokeCircle(effect.x, effect.y, effect.type === "heavy" ? 34 : 22);
    } else if (effect.type === "dash") {
      g.strokeRect(effect.x - 32, effect.y - 18, 64, 36);
    } else if (effect.type === "heal") {
      g.strokeCircle(effect.x, effect.y, 34);
    } else if (effect.type === "ko" || effect.type === "explosion" || effect.type === "ultimate") {
      g.strokeCircle(effect.x, effect.y, effect.type === "ultimate" ? 82 : 46);
    } else {
      g.strokeCircle(effect.x, effect.y, 24);
    }
    layer.add(g);
    if (effect.value) {
      const text = scene.add.text(effect.x, effect.y - 12 - (1 - alpha) * 22, String(effect.value), {
        fontFamily: "monospace",
        fontSize: "18px",
        fontStyle: "bold",
        color: "#fff6d8",
        stroke: "#17251e",
        strokeThickness: 5
      }).setOrigin(.5).setAlpha(alpha);
      layer.add(text);
    }
  }

  function getInputPayload() {
    const me = myPlayer();
    const keys = state.input.keys;
    const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
    let aimX = me ? state.input.pointerX - me.x : 1;
    let aimY = me ? state.input.pointerY - me.y : 0;
    const aimLen = Math.hypot(aimX, aimY) || 1;
    aimX /= aimLen;
    aimY /= aimLen;
    return {
      dx: clamp(dx, -1, 1),
      dy: clamp(dy, -1, 1),
      aimX: clamp(aimX, -1, 1),
      aimY: clamp(aimY, -1, 1),
      attack: state.input.attack || keys.has(" "),
      strong: state.input.strong,
      dash: keys.has("shift") || keys.has("q"),
      skill1: keys.has("q"),
      skill2: keys.has("e"),
      skill3: keys.has("r"),
      ultimate: keys.has("x")
    };
  }

  function sendInput(force = false) {
    if (!state.connected || !state.socket || !state.room || state.room.status !== "playing" || state.localTraining) return;
    const now = performance.now();
    if (!force && now - state.inputTimer < 45) return;
    state.inputTimer = now;
    state.socket.emit("adventure:input", { roomId: state.room.roomId, input: getInputPayload() });
  }

  function createRoom(targetSocketId = "") {
    if (!state.connected || !state.socket) {
      showToast("Faca login no album para jogar online.");
      return;
    }
    const bet = Number(els.betInput.value) || 10;
    state.localTraining = false;
    state.socket.emit("adventure:create", {
      bet,
      characterId: state.selectedCharacter,
      mapId: "forest",
      targetSocketId
    });
  }

  function joinRoom(roomId) {
    if (!state.connected || !state.socket) {
      showToast("Conecte com sua conta para aceitar.");
      return;
    }
    if (!roomId) return;
    state.localTraining = false;
    state.socket.emit("adventure:join", { roomId, characterId: state.selectedCharacter });
    hideInvite();
  }

  function leaveRoom() {
    if (state.localTraining) {
      state.localTraining = false;
      state.room = null;
      state.localProjectiles = [];
      state.localEffects = [];
      setCenter("Treino encerrado", "Abra uma sala ou desafie alguem online.", true);
      renderRoom(makeIdleRoom());
      return;
    }
    if (state.socket && state.room?.roomId) {
      state.socket.emit("adventure:leave", { roomId: state.room.roomId });
    }
    state.room = null;
    setCenter("Aventura PVP", "Escolha um personagem e abra uma sala.", true);
    updateHud();
  }

  function showInvite(roomId, fromUsername, bet) {
    state.pendingInviteRoomId = roomId;
    els.inviteText.textContent = fromUsername
      ? `${fromUsername} chamou voce para Aventura PVP apostando ${bet} creditos.`
      : "Escolha um personagem e entre na partida.";
    els.inviteBox.classList.remove("hidden");
  }

  function hideInvite() {
    els.inviteBox.classList.add("hidden");
  }

  function connectSocket() {
    if (!token) {
      updateConnectionLabel();
      setCenter("Modo offline", "Entre pelo album para jogar online. O treino contra bot ja funciona aqui.", true);
      return;
    }
    state.socket = io(SERVER_URL, { auth: { token } });
    state.socket.on("connect", () => {
      state.connected = true;
      state.user = { username: "Online" };
      updateConnectionLabel();
      if (!state.autoRequestHandled) {
        state.autoRequestHandled = true;
        const roomId = params.get("roomId");
        const joinId = params.get("join");
        const spectateId = params.get("spectate");
        const targetId = params.get("target");
        if (roomId) {
          state.socket.emit("adventure:resume", { roomId });
        } else if (spectateId) {
          state.socket.emit("adventure:spectate", { roomId: spectateId });
          showToast("Entrando como espectador.");
        } else if (joinId) {
          state.pendingInviteRoomId = joinId;
          showInvite(joinId, "", 0);
        } else if (targetId) {
          createRoom(targetId);
        }
      }
    });
    state.socket.on("disconnect", () => {
      state.connected = false;
      updateConnectionLabel();
    });
    state.socket.on("connect_error", () => {
      state.connected = false;
      updateConnectionLabel();
      showToast("Nao foi possivel conectar. Entre novamente pelo album.");
    });
    state.socket.on("online:list", renderOnlineList);
    state.socket.on("chat:history", (messages) => {
      state.chat = Array.isArray(messages) ? messages.slice(-80) : [];
      renderChat();
    });
    state.socket.on("chat:message", (message) => {
      state.chat.push(message);
      state.chat = state.chat.slice(-80);
      renderChat();
    });
    state.socket.on("adventure:created", (room) => {
      state.localTraining = false;
      renderRoom(room);
      showToast("Sala aberta. O convite apareceu para os players online.");
      window.history.replaceState(null, "", `/pvpAventura/?roomId=${encodeURIComponent(room.roomId)}`);
    });
    state.socket.on("adventure:invite", ({ roomId, fromUsername, bet }) => {
      showInvite(roomId, fromUsername, bet);
    });
    state.socket.on("adventure:launch", ({ room, url }) => {
      state.localTraining = false;
      if (url && !window.location.search.includes(room.roomId)) {
        window.history.replaceState(null, "", url);
      }
      renderRoom(room);
    });
    state.socket.on("adventure:update", (room) => {
      state.localTraining = false;
      renderRoom(room);
    });
    state.socket.on("adventure:finished", ({ room }) => {
      state.localTraining = false;
      renderRoom(room);
      showToast(room.message || "Partida encerrada.");
    });
    state.socket.on("adventure:cancelled", ({ message }) => {
      state.room = null;
      setCenter("Sala cancelada", message || "A partida foi cancelada.", true);
      showToast(message || "Sala cancelada.");
    });
    state.socket.on("adventure:error", (message) => {
      showToast(message || "Nao foi possivel jogar Aventura PVP.");
    });
  }

  function makeIdleRoom() {
    return {
      status: "idle",
      message: "Escolha um personagem e abra uma sala.",
      field: FIELD,
      map: mapTemplate(),
      players: [],
      projectiles: [],
      mines: [],
      effects: []
    };
  }

  function startTraining() {
    const meConfig = CHARACTERS[state.selectedCharacter];
    const botId = state.selectedCharacter === "blade" ? "stretch" : "blade";
    const botConfig = CHARACTERS[botId];
    state.localTraining = true;
    state.localProjectiles = [];
    state.localEffects = [];
    state.room = {
      roomId: "training",
      status: "playing",
      message: "Treino contra bot.",
      field: FIELD,
      map: mapTemplate(),
      gameLeftMs: 0,
      players: [
        makeLocalPlayer("voce", "Voce", state.selectedCharacter, meConfig, 236, FIELD.height / 2, true),
        makeLocalPlayer("bot", "Bot", botId, botConfig, FIELD.width - 236, FIELD.height / 2, false)
      ],
      projectiles: state.localProjectiles,
      mines: [],
      effects: state.localEffects
    };
    setCenter("", "", false);
    renderRoom(state.room);
  }

  function makeLocalPlayer(socketId, username, characterId, config, x, y, isMe) {
    return {
      socketId,
      username,
      characterId,
      characterName: config.name,
      color: config.color,
      accent: config.accent,
      hp: config.hp,
      maxHp: config.hp,
      energy: 100,
      ultimate: 0,
      alive: true,
      x,
      y,
      faceX: isMe ? 1 : -1,
      faceY: 0,
      cooldowns: { attack: 0, strong: 0, skill1: 0, skill2: 0, skill3: 0, ultimate: 0 },
      isMe,
      damageDone: 0
    };
  }

  function updateTraining(dt) {
    if (!state.room || state.room.status !== "playing") return;
    const me = myPlayer();
    const bot = enemyPlayer();
    if (!me || !bot || !me.alive || !bot.alive) return;
    const input = getInputPayload();
    localMove(me, input.dx, input.dy, dt);
    me.faceX = input.aimX || me.faceX;
    me.faceY = input.aimY || me.faceY;
    localCooldown(me, dt);
    localCooldown(bot, dt);
    if (input.attack) localAttack(me, bot, false);
    if (input.strong) localAttack(me, bot, true);
    if (input.dash || input.skill1) localDash(me);
    if (input.skill2 && me.cooldowns.skill2 <= 0 && me.energy >= 18) {
      me.energy -= 18;
      me.cooldowns.skill2 = 5200;
      me.hp = clamp(me.hp + 16, 0, me.maxHp);
      state.localEffects.push({ type: "heal", x: me.x, y: me.y, value: 16, color: me.accent, until: Date.now() + 600 });
    }

    const dx = me.x - bot.x;
    const dy = me.y - bot.y;
    const d = Math.hypot(dx, dy) || 1;
    bot.faceX = dx / d;
    bot.faceY = dy / d;
    localMove(bot, bot.faceX, bot.faceY, dt * .82);
    if (d < 82) localAttack(bot, me, false);

    state.localEffects = state.localEffects.filter((effect) => effect.until > Date.now());
    state.room.effects = state.localEffects;
    if (me.hp <= 0 || bot.hp <= 0) {
      state.room.status = "finished";
      state.room.message = bot.hp <= 0 ? "Voce venceu o treino." : "Bot venceu o treino.";
      setCenter("Treino encerrado", state.room.message, true);
    }
    renderRoom(state.room);
  }

  function localCooldown(player, dt) {
    Object.keys(player.cooldowns).forEach((key) => {
      player.cooldowns[key] = Math.max(0, player.cooldowns[key] - dt * 1000);
    });
    player.energy = clamp(player.energy + dt * 18, 0, 100);
  }

  function localMove(player, dx, dy, dt) {
    const config = CHARACTERS[player.characterId] || CHARACTERS.blade;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nextX = player.x + nx * config.speed * dt;
    const nextY = player.y + ny * config.speed * dt;
    if (!localBlocked(nextX, player.y)) player.x = nextX;
    if (!localBlocked(player.x, nextY)) player.y = nextY;
  }

  function localBlocked(x, y) {
    if (x < 18 || y < 18 || x > FIELD.width - 18 || y > FIELD.height - 18) return true;
    return (state.room?.map?.obstacles || []).some((rect) => {
      const cx = clamp(x, rect.x, rect.x + rect.w);
      const cy = clamp(y, rect.y, rect.y + rect.h);
      return Math.hypot(x - cx, y - cy) < 18;
    });
  }

  function localAttack(attacker, target, strong) {
    const key = strong ? "strong" : "attack";
    if (attacker.cooldowns[key] > 0 || attacker.energy < (strong ? 17 : 5)) return;
    const config = CHARACTERS[attacker.characterId] || CHARACTERS.blade;
    attacker.cooldowns[key] = strong ? 760 : 420;
    attacker.energy -= strong ? 17 : 5;
    const range = config.attack === "corte" ? (strong ? 90 : 68) : (strong ? 180 : 146);
    const damage = (config.attack === "corte" ? 12 : 9) + (strong ? 8 : 0);
    if (Math.hypot(target.x - attacker.x, target.y - attacker.y) <= range) {
      target.hp = Math.max(0, target.hp - damage);
      if (target.hp <= 0) target.alive = false;
      state.localEffects.push({ type: strong ? "heavy" : "slash", x: target.x, y: target.y - 22, value: damage, color: attacker.accent, until: Date.now() + 520 });
    } else {
      state.localEffects.push({ type: "slash", x: attacker.x + attacker.faceX * 34, y: attacker.y + attacker.faceY * 34, color: attacker.accent, until: Date.now() + 280 });
    }
  }

  function localDash(player) {
    if (player.cooldowns.skill1 > 0 || player.energy < 18) return;
    player.cooldowns.skill1 = 1550;
    player.energy -= 18;
    const nx = player.x + (player.faceX || 1) * 110;
    const ny = player.y + (player.faceY || 0) * 110;
    if (!localBlocked(nx, ny)) {
      player.x = nx;
      player.y = ny;
    }
    state.localEffects.push({ type: "dash", x: player.x, y: player.y, color: player.accent, until: Date.now() + 360 });
  }

  function setupInput() {
    const ignored = ["input", "textarea", "select"];
    document.addEventListener("keydown", (event) => {
      if (ignored.includes(String(event.target?.tagName || "").toLowerCase())) return;
      const key = String(event.key || "").toLowerCase();
      state.input.keys.add(key);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "q", "e", "r", "x"].includes(key)) {
        event.preventDefault();
      }
      sendInput(true);
    });
    document.addEventListener("keyup", (event) => {
      const key = String(event.key || "").toLowerCase();
      state.input.keys.delete(key);
      sendInput(true);
    });
    document.addEventListener("mousedown", (event) => {
      if (event.button === 0) state.input.attack = true;
      if (event.button === 2) state.input.strong = true;
      sendInput(true);
    });
    document.addEventListener("mouseup", (event) => {
      if (event.button === 0) state.input.attack = false;
      if (event.button === 2) state.input.strong = false;
      sendInput(true);
    });
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    window.setInterval(() => sendInput(false), 50);
  }

  function setupDomEvents() {
    els.characterGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-character]");
      if (!button) return;
      selectCharacter(button.dataset.character);
    });
    els.createRoomBtn.addEventListener("click", () => createRoom(""));
    els.trainingBtn.addEventListener("click", startTraining);
    els.leaveRoomBtn.addEventListener("click", leaveRoom);
    els.onlineList.addEventListener("click", (event) => {
      const challenge = event.target.closest("[data-challenge]");
      const spectate = event.target.closest("[data-spectate]");
      if (challenge) createRoom(challenge.dataset.challenge);
      if (spectate && state.socket) state.socket.emit("adventure:spectate", { roomId: spectate.dataset.spectate });
    });
    els.acceptInviteBtn.addEventListener("click", () => joinRoom(state.pendingInviteRoomId));
    els.rejectInviteBtn.addEventListener("click", () => {
      state.pendingInviteRoomId = "";
      hideInvite();
    });
    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = els.chatInput.value.trim();
      if (!text || !state.socket) return;
      state.socket.emit("chat:send", { text });
      els.chatInput.value = "";
    });
  }

  function bootstrap() {
    renderCharacters();
    setupDomEvents();
    setupInput();
    ensureGame();
    renderRoom(makeIdleRoom());
    connectSocket();
    updateConnectionLabel();
  }

  bootstrap();
}());
