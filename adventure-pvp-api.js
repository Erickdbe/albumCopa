"use strict";

const FIELD = {
  width: 1280,
  height: 768,
  tile: 32,
  playerRadius: 18,
  projectileRadius: 8
};

const MAX_PLAYERS = 2;
const ROUND_MS = 150000;
const TICK_MS = 50;

const CHARACTER_IDS = ["blade", "stretch", "alchemist", "frost", "shadow", "robot"];

const CHARACTERS = {
  blade: {
    name: "Espadachim Aventureiro",
    color: "#2d8cff",
    accent: "#f7c948",
    speed: 222,
    maxHp: 120,
    attackRange: 64,
    attackDamage: 12,
    attackCooldown: 340,
    attackType: "melee"
  },
  stretch: {
    name: "Heroi Elastico",
    color: "#f6bd2b",
    accent: "#ff8c42",
    speed: 205,
    maxHp: 130,
    attackRange: 166,
    attackDamage: 10,
    attackCooldown: 430,
    attackType: "projectile"
  },
  alchemist: {
    name: "Alquimista Doce",
    color: "#f17cb0",
    accent: "#78d64b",
    speed: 198,
    maxHp: 104,
    attackRange: 360,
    attackDamage: 9,
    attackCooldown: 420,
    attackType: "projectile"
  },
  frost: {
    name: "Mago Gelado",
    color: "#8dd8ff",
    accent: "#f7f4dc",
    speed: 188,
    maxHp: 112,
    attackRange: 380,
    attackDamage: 10,
    attackCooldown: 470,
    attackType: "projectile"
  },
  shadow: {
    name: "Guerreira Sombria",
    color: "#37284f",
    accent: "#a970ff",
    speed: 230,
    maxHp: 108,
    attackRange: 72,
    attackDamage: 14,
    attackCooldown: 380,
    attackType: "melee"
  },
  robot: {
    name: "Robo Sucata",
    color: "#6f8794",
    accent: "#ff8c42",
    speed: 176,
    maxHp: 142,
    attackRange: 440,
    attackDamage: 13,
    attackCooldown: 610,
    attackType: "projectile"
  }
};

function setupAdventurePvp(options) {
  const {
    io,
    db,
    rooms,
    onlinePlayers,
    clampNumber,
    ensureSpectators,
    clearSpectator,
    roomSpectatorCount,
    emitSystemChat,
    broadcastOnlineList,
    safeUser,
    addExchangeWin,
    resetExchangeLosses
  } = options;

  function normalizeCharacter(value) {
    return CHARACTER_IDS.includes(value) ? value : "blade";
  }

  function makeMap(mapId = "forest") {
    return {
      id: mapId === "forest" ? "forest" : "forest",
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

  function makePlayer(socket, index, bet, characterId = "blade") {
    const id = normalizeCharacter(characterId);
    const config = CHARACTERS[id];
    return {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
      avatar: socket.avatar || "",
      characterId: id,
      characterName: config.name,
      color: config.color,
      accent: config.accent,
      bet,
      hp: config.maxHp,
      maxHp: config.maxHp,
      energy: 100,
      ultimate: 0,
      alive: true,
      disconnected: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      faceX: index === 0 ? 1 : -1,
      faceY: 0,
      input: { dx: 0, dy: 0, aimX: index === 0 ? 1 : -1, aimY: 0 },
      cooldowns: { attack: 0, strong: 0, skill1: 0, skill2: 0, skill3: 0, ultimate: 0 },
      shieldMs: 0,
      slowedMs: 0,
      invulnerableMs: 0,
      dashMs: 0,
      kills: 0,
      damageDone: 0
    };
  }

  function positionPlayers(room) {
    const spots = [
      { x: 236, y: FIELD.height / 2 },
      { x: FIELD.width - 236, y: FIELD.height / 2 }
    ];
    room.players.forEach((player, index) => {
      const spot = spots[index % spots.length];
      player.x = spot.x;
      player.y = spot.y;
      player.vx = 0;
      player.vy = 0;
      player.faceX = index === 0 ? 1 : -1;
      player.faceY = 0;
    });
  }

  function serialize(room, viewerSocketId = "") {
    const now = Date.now();
    const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
    return {
      roomId: room.roomId,
      hostSocketId: room.hostSocketId,
      hostUsername: room.hostUsername,
      bet: room.bet,
      pot: room.pot || 0,
      status: room.status,
      message: room.message,
      field: FIELD,
      map: room.map,
      characters: CHARACTERS,
      characterIds: CHARACTER_IDS,
      startedAt: room.startedAt || null,
      gameEndsAt: room.gameEndsAt || null,
      gameLeftMs: room.status === "playing" ? Math.max(0, (room.gameEndsAt || now) - now) : 0,
      winnerSocketId: room.winnerSocketId || null,
      isSpectator,
      spectatorCount: roomSpectatorCount(room),
      projectiles: room.projectiles || [],
      mines: room.mines || [],
      effects: (room.effects || []).filter(effect => Number(effect.until || 0) > now),
      players: room.players.map(player => ({
        socketId: player.socketId,
        userId: player.userId,
        username: player.username,
        avatar: player.avatar || "",
        characterId: player.characterId,
        characterName: player.characterName,
        color: player.color,
        accent: player.accent,
        hp: Math.max(0, Math.round(player.hp)),
        maxHp: player.maxHp,
        energy: Math.max(0, Math.round(player.energy)),
        ultimate: Math.max(0, Math.round(player.ultimate)),
        alive: Boolean(player.alive),
        disconnected: Boolean(player.disconnected),
        x: Math.round(player.x),
        y: Math.round(player.y),
        vx: Math.round(player.vx || 0),
        vy: Math.round(player.vy || 0),
        faceX: player.faceX || 1,
        faceY: player.faceY || 0,
        shieldMs: Math.max(0, Math.round(player.shieldMs || 0)),
        slowedMs: Math.max(0, Math.round(player.slowedMs || 0)),
        invulnerableMs: Math.max(0, Math.round(player.invulnerableMs || 0)),
        cooldowns: player.cooldowns,
        kills: player.kills || 0,
        damageDone: Math.round(player.damageDone || 0),
        isHost: player.socketId === room.hostSocketId,
        isMe: player.socketId === viewerSocketId
      }))
    };
  }

  function emitUpdate(room) {
    const targets = new Set(room.players.map(player => player.socketId));
    for (const spectatorId of room.spectators || []) targets.add(spectatorId);
    targets.forEach(socketId => {
      io.to(socketId).emit("adventure:update", serialize(room, socketId));
    });
  }

  function activePlayers(room) {
    return room.players.filter(player => !player.disconnected);
  }

  function findRoomBySocket(socketId) {
    for (const room of rooms.values()) {
      if (room.players.some(player => player.socketId === socketId)) return room;
    }
    return null;
  }

  function addEffect(room, effect) {
    if (!room.effects) room.effects = [];
    room.effects.push({
      id: `fx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      until: Date.now() + Number(effect.duration || 450),
      ...effect
    });
    while (room.effects.length > 60) room.effects.shift();
  }

  function setInput(player, input = {}) {
    const dx = clampNumber(input.dx, -1, 1);
    const dy = clampNumber(input.dy, -1, 1);
    const aimX = clampNumber(input.aimX, -1, 1);
    const aimY = clampNumber(input.aimY, -1, 1);
    player.input = {
      dx,
      dy,
      aimX,
      aimY,
      attack: Boolean(input.attack),
      strong: Boolean(input.strong),
      dash: Boolean(input.dash),
      skill1: Boolean(input.skill1),
      skill2: Boolean(input.skill2),
      skill3: Boolean(input.skill3),
      ultimate: Boolean(input.ultimate)
    };

    if (Math.hypot(aimX, aimY) > 0.15) {
      const len = Math.hypot(aimX, aimY) || 1;
      player.faceX = aimX / len;
      player.faceY = aimY / len;
    } else if (Math.hypot(dx, dy) > 0.15) {
      const len = Math.hypot(dx, dy) || 1;
      player.faceX = dx / len;
      player.faceY = dy / len;
    }
  }

  function circleRectCollides(x, y, radius, rect) {
    const cx = clampNumber(x, rect.x, rect.x + rect.w);
    const cy = clampNumber(y, rect.y, rect.y + rect.h);
    return Math.hypot(x - cx, y - cy) < radius;
  }

  function positionBlocked(room, x, y, radius = FIELD.playerRadius) {
    if (x < radius || y < radius || x > FIELD.width - radius || y > FIELD.height - radius) {
      return true;
    }
    return (room.map?.obstacles || []).some(rect => circleRectCollides(x, y, radius, rect));
  }

  function movePlayer(room, player, dt) {
    if (!player.alive || player.disconnected) return;
    const input = player.input || {};
    const len = Math.hypot(input.dx || 0, input.dy || 0) || 1;
    const nx = (input.dx || 0) / len;
    const ny = (input.dy || 0) / len;
    const config = CHARACTERS[player.characterId] || CHARACTERS.blade;
    const onMud = (room.map?.hazards || []).some(hazard => Math.hypot(player.x - hazard.x, player.y - hazard.y) < hazard.r);
    const slowFactor = (player.slowedMs > 0 || onMud) ? 0.58 : 1;
    const dashBoost = player.dashMs > 0 ? 1.8 : 1;
    const speed = config.speed * slowFactor * dashBoost;
    const nextX = player.x + nx * speed * dt;
    const nextY = player.y + ny * speed * dt;

    if (!positionBlocked(room, nextX, player.y)) player.x = nextX;
    if (!positionBlocked(room, player.x, nextY)) player.y = nextY;
  }

  function playersInCone(room, attacker, range, arc = 0.82) {
    const fx = attacker.faceX || 1;
    const fy = attacker.faceY || 0;
    return room.players.filter(target => {
      if (target.socketId === attacker.socketId || !target.alive || target.disconnected) return false;
      const dx = target.x - attacker.x;
      const dy = target.y - attacker.y;
      const dist = Math.hypot(dx, dy);
      if (dist > range + FIELD.playerRadius) return false;
      const dot = ((dx / (dist || 1)) * fx) + ((dy / (dist || 1)) * fy);
      return dot >= arc;
    });
  }

  function applyDamage(room, target, amount, attacker = null, source = "hit") {
    if (!target?.alive || target.disconnected || target.invulnerableMs > 0) return false;
    let finalDamage = Math.max(0, Number(amount || 0));
    if (target.shieldMs > 0) finalDamage = Math.ceil(finalDamage * 0.38);
    target.hp = Math.max(0, Number(target.hp || 0) - finalDamage);

    if (attacker && attacker.socketId !== target.socketId) {
      attacker.damageDone = Number(attacker.damageDone || 0) + finalDamage;
      attacker.ultimate = clampNumber(Number(attacker.ultimate || 0) + finalDamage * 0.52, 0, 100);
      target.ultimate = clampNumber(Number(target.ultimate || 0) + finalDamage * 0.24, 0, 100);
    }

    addEffect(room, {
      type: source,
      x: target.x,
      y: target.y - 26,
      value: finalDamage,
      color: attacker?.accent || "#fff9e8",
      duration: 520
    });

    if (target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
      if (attacker && attacker.socketId !== target.socketId) attacker.kills = Number(attacker.kills || 0) + 1;
      addEffect(room, { type: "ko", x: target.x, y: target.y, color: "#f05a48", duration: 900 });
    }
    return true;
  }

  function createProjectile(room, owner, options = {}) {
    const len = Math.hypot(owner.faceX || 1, owner.faceY || 0) || 1;
    const dirX = (owner.faceX || 1) / len;
    const dirY = (owner.faceY || 0) / len;
    const speed = Number(options.speed || 520);
    const projectile = {
      id: `pr-${room.projectileSeq++}`,
      ownerSocketId: owner.socketId,
      ownerUserId: owner.userId,
      x: owner.x + dirX * 24,
      y: owner.y + dirY * 24,
      vx: dirX * speed,
      vy: dirY * speed,
      radius: Number(options.radius || FIELD.projectileRadius),
      damage: Number(options.damage || 10),
      color: options.color || owner.accent || "#f7c948",
      type: options.type || "bolt",
      slowMs: Number(options.slowMs || 0),
      pull: Number(options.pull || 0),
      ttl: Number(options.ttl || 900)
    };
    room.projectiles.push(projectile);
    return projectile;
  }

  function tryAttack(room, player, strong = false) {
    if (!player.alive) return;
    const key = strong ? "strong" : "attack";
    if (player.cooldowns[key] > 0) return;
    const config = CHARACTERS[player.characterId] || CHARACTERS.blade;
    const energyCost = strong ? 17 : 5;
    if (player.energy < energyCost) return;
    player.energy -= energyCost;
    player.cooldowns[key] = strong ? 760 : config.attackCooldown;
    const damage = config.attackDamage + (strong ? 8 : 0);
    const range = config.attackRange + (strong ? 26 : 0);

    if (config.attackType === "melee") {
      playersInCone(room, player, range, strong ? 0.28 : 0.45)
        .forEach(target => applyDamage(room, target, damage, player, strong ? "heavy" : "slash"));
      addEffect(room, {
        type: strong ? "heavy" : "slash",
        x: player.x + (player.faceX || 1) * 34,
        y: player.y + (player.faceY || 0) * 34,
        color: player.accent,
        duration: strong ? 360 : 280
      });
      return;
    }

    createProjectile(room, player, {
      damage,
      color: player.accent,
      type: player.characterId === "robot" ? "cannon" : player.characterId === "frost" ? "ice" : "bolt",
      radius: player.characterId === "robot" || strong ? 12 : 8,
      speed: player.characterId === "robot" ? 430 : 560,
      slowMs: player.characterId === "frost" ? 850 : 0
    });
  }

  function useDash(room, player) {
    if (!player.alive || player.cooldowns.skill1 > 0 || player.energy < 18) return;
    player.energy -= 18;
    player.cooldowns.skill1 = 1550;
    player.invulnerableMs = Math.max(player.invulnerableMs || 0, 220);
    player.dashMs = Math.max(player.dashMs || 0, 210);
    const distance = player.characterId === "shadow" ? 150 : 112;
    const nextX = player.x + (player.faceX || 1) * distance;
    const nextY = player.y + (player.faceY || 0) * distance;
    if (!positionBlocked(room, nextX, nextY)) {
      player.x = nextX;
      player.y = nextY;
    }
    if (player.characterId !== "robot") {
      playersInCone(room, player, 92, 0.2)
        .forEach(target => applyDamage(room, target, player.characterId === "stretch" ? 9 : 16, player, "dash"));
    }
    if (player.characterId === "stretch") {
      createProjectile(room, player, { damage: 8, color: player.accent, type: "grab", radius: 10, speed: 620, pull: 70, ttl: 620 });
    }
    addEffect(room, { type: "dash", x: player.x, y: player.y, color: player.accent, duration: 360 });
  }

  function useSkill(room, player, key) {
    if (!player.alive || player.cooldowns[key] > 0) return;
    const fx = player.faceX || 1;
    const fy = player.faceY || 0;

    if (key === "skill2") {
      if (player.energy < 18) return;
      player.energy -= 18;
      player.cooldowns.skill2 = 5200;
      if (player.characterId === "alchemist") {
        player.hp = clampNumber(player.hp + 18, 0, player.maxHp);
        addEffect(room, { type: "heal", x: player.x, y: player.y, color: "#78d64b", value: 18, duration: 620 });
      } else if (player.characterId === "frost") {
        playersInCone(room, player, 150, -0.2).forEach(target => {
          target.slowedMs = Math.max(target.slowedMs || 0, 1800);
          applyDamage(room, target, 7, player, "ice");
        });
        addEffect(room, { type: "icewall", x: player.x + fx * 72, y: player.y + fy * 72, color: "#8dd8ff", duration: 900 });
      } else {
        player.shieldMs = Math.max(player.shieldMs || 0, player.characterId === "robot" ? 2600 : 1600);
        addEffect(room, { type: "shield", x: player.x, y: player.y, color: player.accent, duration: 760 });
      }
      return;
    }

    if (key === "skill3") {
      if (player.energy < 28) return;
      player.energy -= 28;
      player.cooldowns.skill3 = 6500;
      if (player.characterId === "robot") {
        room.mines.push({
          id: `mine-${Date.now()}`,
          ownerSocketId: player.socketId,
          x: player.x + fx * 42,
          y: player.y + fy * 42,
          radius: 34,
          damage: 22,
          ttl: 9000
        });
        addEffect(room, { type: "mine", x: player.x + fx * 42, y: player.y + fy * 42, color: player.accent, duration: 900 });
      } else if (player.characterId === "shadow") {
        createProjectile(room, player, { damage: 18, color: player.accent, type: "shadow", radius: 13, speed: 460, slowMs: 500, ttl: 1100 });
      } else if (player.characterId === "stretch") {
        createProjectile(room, player, { damage: 15, color: player.accent, type: "grab", radius: 12, speed: 520, pull: 96, ttl: 900 });
      } else {
        playersInCone(room, player, 132, -0.35)
          .forEach(target => applyDamage(room, target, 15, player, "burst"));
        addEffect(room, { type: "burst", x: player.x, y: player.y, color: player.accent, duration: 620 });
      }
      return;
    }

    if (key === "ultimate") {
      if (player.ultimate < 100) return;
      player.ultimate = 0;
      player.cooldowns.ultimate = 12000;
      if (player.characterId === "robot") {
        [-0.22, 0, 0.22].forEach(offset => {
          const angle = Math.atan2(fy, fx) + offset;
          const oldX = player.faceX;
          const oldY = player.faceY;
          player.faceX = Math.cos(angle);
          player.faceY = Math.sin(angle);
          createProjectile(room, player, { damage: 22, color: player.accent, type: "rocket", radius: 13, speed: 500, ttl: 1100 });
          player.faceX = oldX;
          player.faceY = oldY;
        });
      } else {
        const radius = player.characterId === "stretch" ? 176 : player.characterId === "blade" ? 148 : 180;
        room.players.filter(target => target.socketId !== player.socketId && target.alive)
          .filter(target => Math.hypot(target.x - player.x, target.y - player.y) < radius)
          .forEach(target => {
            if (player.characterId === "frost" || player.characterId === "stretch") {
              target.slowedMs = Math.max(target.slowedMs || 0, player.characterId === "frost" ? 2400 : 1100);
            }
            applyDamage(room, target, player.characterId === "alchemist" ? 24 : player.characterId === "frost" ? 26 : 32, player, "ultimate");
          });
        if (player.characterId === "alchemist") player.hp = clampNumber(player.hp + 32, 0, player.maxHp);
        if (player.characterId === "shadow") {
          player.invulnerableMs = Math.max(player.invulnerableMs || 0, 900);
          player.energy = 100;
        }
      }
      addEffect(room, { type: "ultimate", x: player.x, y: player.y, color: player.accent, duration: 1100 });
    }
  }

  function updateProjectiles(room, dt) {
    room.projectiles = (room.projectiles || []).filter(projectile => {
      projectile.ttl -= dt * 1000;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;

      if (projectile.ttl <= 0 || positionBlocked(room, projectile.x, projectile.y, projectile.radius)) {
        addEffect(room, { type: "spark", x: projectile.x, y: projectile.y, color: projectile.color, duration: 320 });
        return false;
      }

      const owner = room.players.find(player => player.socketId === projectile.ownerSocketId);
      const target = room.players.find(player =>
        player.socketId !== projectile.ownerSocketId
        && player.alive
        && !player.disconnected
        && Math.hypot(player.x - projectile.x, player.y - projectile.y) <= FIELD.playerRadius + projectile.radius
      );
      if (target) {
        if (projectile.slowMs) target.slowedMs = Math.max(target.slowedMs || 0, projectile.slowMs);
        if (projectile.pull && owner) {
          const dx = owner.x - target.x;
          const dy = owner.y - target.y;
          const len = Math.hypot(dx, dy) || 1;
          const nextX = target.x + (dx / len) * projectile.pull;
          const nextY = target.y + (dy / len) * projectile.pull;
          if (!positionBlocked(room, nextX, nextY)) {
            target.x = nextX;
            target.y = nextY;
          }
        }
        applyDamage(room, target, projectile.damage, owner, projectile.type || "projectile");
        return false;
      }
      return true;
    });
  }

  function updateMines(room, dt) {
    room.mines = (room.mines || []).filter(mine => {
      mine.ttl -= dt * 1000;
      if (mine.ttl <= 0) return false;
      const owner = room.players.find(player => player.socketId === mine.ownerSocketId);
      const target = room.players.find(player =>
        player.socketId !== mine.ownerSocketId
        && player.alive
        && !player.disconnected
        && Math.hypot(player.x - mine.x, player.y - mine.y) <= mine.radius + FIELD.playerRadius
      );
      if (target) {
        applyDamage(room, target, mine.damage, owner, "explosion");
        addEffect(room, { type: "explosion", x: mine.x, y: mine.y, color: "#ff8c42", duration: 720 });
        return false;
      }
      return true;
    });
  }

  function startRound(room, requestedBet = room.bet) {
    if (!room || room.status !== "waiting") return false;
    if (room.players.length < 2) {
      room.message = "Aguardando outro jogador entrar no Aventura PVP.";
      emitUpdate(room);
      return false;
    }

    const tableBet = clampNumber(requestedBet || room.bet || 10, 5, 50);
    for (const player of room.players) {
      const user = db.findUser("id", player.userId);
      if (!user || Number(user.bet_credits || 0) < tableBet) {
        room.message = `${player.username} nao tem creditos para ${tableBet}.`;
        emitUpdate(room);
        return false;
      }
    }

    room.matchId = db.createMatch(room.players[0].userId, room.players[1].userId, tableBet, tableBet).id;
    db.updateMatch(room.matchId, {
      game: "adventure",
      map_id: room.map.id,
      player1_character: room.players[0].characterId,
      player2_character: room.players[1].characterId
    });

    room.bet = tableBet;
    room.pot = 0;
    room.projectiles = [];
    room.mines = [];
    room.effects = [];
    room.projectileSeq = 1;
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      db.updateUser(player.userId, {
        bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
      });
      const config = CHARACTERS[player.characterId] || CHARACTERS.blade;
      player.bet = tableBet;
      player.hp = config.maxHp;
      player.maxHp = config.maxHp;
      player.energy = 100;
      player.ultimate = 0;
      player.alive = true;
      player.disconnected = false;
      player.cooldowns = { attack: 0, strong: 0, skill1: 0, skill2: 0, skill3: 0, ultimate: 0 };
      player.damageDone = 0;
      player.kills = 0;
      player.shieldMs = 0;
      player.slowedMs = 0;
      player.invulnerableMs = 0;
      player.dashMs = 0;
      room.pot += tableBet;
    });
    positionPlayers(room);
    room.status = "playing";
    room.startedAt = Date.now();
    room.gameEndsAt = room.startedAt + ROUND_MS;
    room.lastTick = Date.now();
    room.message = "Batalha iniciada. Use WASD, mouse, Q/E/R e X.";
    const participantIds = new Set(room.players.map(player => player.socketId));
    for (const invitedSocketId of room.invitedSocketIds || []) {
      if (!participantIds.has(invitedSocketId)) {
        io.to(invitedSocketId).emit("adventure:cancelled", { message: "Sala de Aventura PVP ja iniciou." });
      }
    }
    room.invitedSocketIds = new Set();
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = setInterval(() => tick(room), TICK_MS);
    room.players.forEach(player => {
      io.to(player.socketId).emit("adventure:launch", {
        room: serialize(room, player.socketId),
        url: `/pvpAventura/?roomId=${encodeURIComponent(room.roomId)}`
      });
    });
    emitUpdate(room);
    broadcastOnlineList();
    return true;
  }

  function finishRoom(room, reason = "") {
    if (!room || room.status === "finished") return;
    if (room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = null;
    }
    room.status = "finished";
    room.gameEndsAt = null;

    const alive = activePlayers(room).filter(player => player.alive);
    const ranked = room.players
      .slice()
      .sort((a, b) => Number(b.hp || 0) - Number(a.hp || 0) || Number(b.damageDone || 0) - Number(a.damageDone || 0));
    const winner = alive.length === 1 ? alive[0] : ranked[0]?.hp > ranked[1]?.hp ? ranked[0] : null;
    room.winnerSocketId = winner?.socketId || null;

    const p1 = room.players[0];
    const p2 = room.players[1];
    if (room.matchId) {
      db.updateMatch(room.matchId, {
        player1_score: p1?.userId === winner?.userId ? 1 : 0,
        player2_score: p2?.userId === winner?.userId ? 1 : 0,
        winner_id: winner?.userId || null,
        status: "finished",
        player1_damage: Math.round(p1?.damageDone || 0),
        player2_damage: Math.round(p2?.damageDone || 0),
        finished_at: new Date().toISOString()
      });
    }

    if (winner) {
      const user = db.findUser("id", winner.userId);
      if (user) {
        db.updateUser(winner.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(room.pot || 0)
        });
        addExchangeWin(winner.userId);
      }
      room.message = `${reason ? `${reason} ` : ""}${winner.username} venceu Aventura PVP e levou ${room.pot} creditos.`;
      emitSystemChat(`${winner.username} venceu uma partida de Aventura PVP.`, "adventure", { roomId: room.roomId, game: "adventure" });
    } else {
      room.players.forEach(player => {
        const user = db.findUser("id", player.userId);
        if (user) {
          db.updateUser(player.userId, {
            bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
          });
        }
      });
      room.message = `${reason ? `${reason} ` : ""}Empate no Aventura PVP. Apostas devolvidas.`;
    }

    resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

    const targets = new Set(room.players.map(player => player.socketId));
    for (const spectatorId of room.spectators || []) targets.add(spectatorId);
    targets.forEach(socketId => {
      const participant = room.players.find(player => player.socketId === socketId);
      io.to(socketId).emit("adventure:finished", {
        room: serialize(room, socketId),
        updatedUser: participant ? safeUser(db.findUser("id", participant.userId)) : null
      });
      const online = onlinePlayers.get(socketId);
      if (online && room.players.some(player => player.socketId === socketId)) {
        online.inGame = false;
        online.roomId = null;
        online.game = null;
      }
    });

    io.emit("ranking:update", { ranking: db.getRichestBetCreditUsers(10) });
    broadcastOnlineList();
    setTimeout(() => {
      const current = rooms.get(room.roomId);
      if (current?.status === "finished") rooms.delete(room.roomId);
    }, 30000);
  }

  function tick(room) {
    if (!room || room.status !== "playing") return;
    const now = Date.now();
    const dt = Math.min(0.08, Math.max(0.001, (now - (room.lastTick || now)) / 1000));
    room.lastTick = now;

    room.players.forEach(player => {
      ["attack", "strong", "skill1", "skill2", "skill3", "ultimate"].forEach(key => {
        player.cooldowns[key] = Math.max(0, Number(player.cooldowns[key] || 0) - dt * 1000);
      });
      player.shieldMs = Math.max(0, Number(player.shieldMs || 0) - dt * 1000);
      player.slowedMs = Math.max(0, Number(player.slowedMs || 0) - dt * 1000);
      player.invulnerableMs = Math.max(0, Number(player.invulnerableMs || 0) - dt * 1000);
      player.dashMs = Math.max(0, Number(player.dashMs || 0) - dt * 1000);
      player.energy = clampNumber(Number(player.energy || 0) + dt * 18, 0, 100);

      const input = player.input || {};
      if (input.attack) tryAttack(room, player, false);
      if (input.strong) tryAttack(room, player, true);
      if (input.dash || input.skill1) useDash(room, player);
      if (input.skill2) useSkill(room, player, "skill2");
      if (input.skill3) useSkill(room, player, "skill3");
      if (input.ultimate) useSkill(room, player, "ultimate");
      movePlayer(room, player, dt);
    });

    updateProjectiles(room, dt);
    updateMines(room, dt);
    room.effects = (room.effects || []).filter(effect => Number(effect.until || 0) > now);

    const alive = activePlayers(room).filter(player => player.alive);
    if (alive.length <= 1 || now >= Number(room.gameEndsAt || 0)) {
      finishRoom(room, now >= Number(room.gameEndsAt || 0) ? "Tempo esgotado." : "");
      return;
    }
    emitUpdate(room);
  }

  function cancelRoom(room, reason = "Sala de Aventura PVP cancelada.") {
    if (!room) return;
    if (room.tickTimer) clearInterval(room.tickTimer);
    const targets = new Set(room.players.map(player => player.socketId));
    for (const invitedSocketId of room.invitedSocketIds || []) targets.add(invitedSocketId);
    for (const spectatorId of room.spectators || []) targets.add(spectatorId);
    targets.forEach(socketId => {
      io.to(socketId).emit("adventure:cancelled", { message: reason });
      const online = onlinePlayers.get(socketId);
      if (online && online.roomId === room.roomId) {
        online.inGame = false;
        online.roomId = null;
        online.game = null;
      }
      const liveSocket = io.sockets.sockets.get(socketId);
      if (liveSocket) liveSocket.leave(room.roomId);
    });
    rooms.delete(room.roomId);
    broadcastOnlineList();
  }

  function removePlayer(room, socketId, reason = "") {
    if (!room) return;
    const player = room.players.find(item => item.socketId === socketId);
    if (!player) return;
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
    const online = onlinePlayers.get(socketId);
    if (online && online.roomId === room.roomId) {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
    if (room.status === "playing") {
      player.disconnected = true;
      player.alive = false;
      finishRoom(room, reason || `${player.username} saiu.`);
      return;
    }
    room.players = room.players.filter(item => item.socketId !== socketId);
    if (!room.players.length) {
      rooms.delete(room.roomId);
      broadcastOnlineList();
      return;
    }
    if (room.hostSocketId === socketId) {
      room.hostSocketId = room.players[0].socketId;
      room.hostUsername = room.players[0].username;
    }
    room.message = reason || `${player.username} saiu do Aventura PVP.`;
    emitUpdate(room);
    broadcastOnlineList();
  }

  function setOnline(socketId, roomId) {
    const online = onlinePlayers.get(socketId);
    if (online) {
      online.inGame = true;
      online.roomId = roomId;
      online.game = "adventure";
    }
  }

  function bindSocket(socket) {
    socket.on("adventure:create", ({ bet, characterId, mapId, targetSocketId }) => {
      const tableBet = clampNumber(bet || 10, 5, 50);
      const user = db.findUser("id", socket.userId);
      const online = onlinePlayers.get(socket.id);
      if (!user || Number(user.bet_credits || 0) < tableBet)
        return socket.emit("adventure:error", "Creditos de aposta insuficientes.");
      if (online?.inGame)
        return socket.emit("adventure:error", "Voce ja esta em uma partida.");

      const roomId = `adventure-${Date.now()}-${socket.id}`;
      const room = {
        roomId,
        hostSocketId: socket.id,
        hostUsername: socket.username,
        bet: tableBet,
        pot: 0,
        status: "waiting",
        startedAt: null,
        gameEndsAt: null,
        winnerSocketId: null,
        tickTimer: null,
        lastTick: Date.now(),
        map: makeMap(mapId),
        projectiles: [],
        mines: [],
        effects: [],
        projectileSeq: 1,
        spectators: new Set(),
        invitedSocketIds: new Set(),
        message: "Sala aberta. Aguardando outro aventureiro aceitar o desafio.",
        players: [makePlayer(socket, 0, tableBet, characterId)]
      };
      positionPlayers(room);
      rooms.set(roomId, room);
      socket.join(roomId);
      setOnline(socket.id, roomId);

      const target = targetSocketId ? onlinePlayers.get(targetSocketId) : null;
      if (targetSocketId && (!target || target.inGame || target.socketId === socket.id)) {
        cancelRoom(room, "Jogador indisponivel para o desafio.");
        return socket.emit("adventure:error", "Jogador indisponivel para o desafio.");
      }

      if (target) {
        room.invitedSocketIds.add(target.socketId);
        io.to(target.socketId).emit("adventure:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      } else {
        for (const [, targetPlayer] of onlinePlayers) {
          if (targetPlayer.socketId !== socket.id && !targetPlayer.inGame) {
            room.invitedSocketIds.add(targetPlayer.socketId);
            io.to(targetPlayer.socketId).emit("adventure:invite", { roomId, fromUsername: socket.username, bet: tableBet });
          }
        }
      }
      emitSystemChat(`${socket.username} abriu uma sala de Aventura PVP.`, "adventure", {
        roomId,
        game: "adventure",
        bet: tableBet,
        targetUsername: target?.username || ""
      });

      socket.emit("adventure:created", serialize(room, socket.id));
      emitUpdate(room);
      broadcastOnlineList();
    });

    socket.on("adventure:join", ({ roomId, characterId }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== "waiting")
        return socket.emit("adventure:error", "Sala de Aventura PVP indisponivel.");
      if (room.players.some(player => player.socketId === socket.id))
        return emitUpdate(room);
      if (room.players.length >= MAX_PLAYERS)
        return socket.emit("adventure:error", "Sala cheia.");

      const user = db.findUser("id", socket.userId);
      const online = onlinePlayers.get(socket.id);
      if (!user || Number(user.bet_credits || 0) < room.bet)
        return socket.emit("adventure:error", "Creditos de aposta insuficientes.");
      if (online?.inGame)
        return socket.emit("adventure:error", "Voce ja esta em uma partida.");

      room.players.push(makePlayer(socket, room.players.length, room.bet, characterId));
      if (room.invitedSocketIds) room.invitedSocketIds.delete(socket.id);
      positionPlayers(room);
      room.message = `${socket.username} entrou. A batalha vai comecar.`;
      socket.join(roomId);
      setOnline(socket.id, roomId);
      emitUpdate(room);
      broadcastOnlineList();
      startRound(room, room.bet);
    });

    socket.on("adventure:resume", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("adventure:cancelled", { message: "Sala de Aventura PVP encerrada." });
      const player = room.players.find(item => Number(item.userId) === Number(socket.userId));
      if (!player) return socket.emit("adventure:error", "Voce nao faz parte desta sala.");
      const oldSocketId = player.socketId;
      if (oldSocketId && oldSocketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) oldSocket.leave(room.roomId);
      }
      player.socketId = socket.id;
      player.avatar = socket.avatar || player.avatar || "";
      player.disconnected = false;
      if (player.userId === room.players[0]?.userId) {
        room.hostSocketId = socket.id;
        room.hostUsername = socket.username;
      }
      socket.join(room.roomId);
      setOnline(socket.id, room.roomId);
      emitUpdate(room);
      broadcastOnlineList();
    });

    socket.on("adventure:input", ({ roomId, input }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== "playing") return;
      const player = room.players.find(item => item.socketId === socket.id && !item.disconnected);
      if (!player) return;
      setInput(player, input);
    });

    socket.on("adventure:leave", ({ roomId }) => {
      const room = rooms.get(roomId) || findRoomBySocket(socket.id);
      if (!room) return;
      if (room.spectators?.has(socket.id)) {
        clearSpectator(room, socket.id);
        emitUpdate(room);
        broadcastOnlineList();
        return;
      }
      if (room.status === "waiting" && room.hostSocketId === socket.id) {
        cancelRoom(room, "O dono cancelou o Aventura PVP.");
        return;
      }
      removePlayer(room, socket.id, `${socket.username} saiu do Aventura PVP.`);
    });

    socket.on("adventure:spectate", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== "playing")
        return socket.emit("adventure:error", "Partida indisponivel para assistir.");
      if (room.players.some(player => player.socketId === socket.id && !player.disconnected))
        return emitUpdate(room);
      const online = onlinePlayers.get(socket.id);
      if (online?.inGame)
        return socket.emit("adventure:error", "Termine sua partida antes de assistir outra.");
      ensureSpectators(room).add(socket.id);
      socket.join(roomId);
      emitUpdate(room);
      broadcastOnlineList();
    });

    socket.on("adventure:unwatch", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      clearSpectator(room, socket.id);
      emitUpdate(room);
      broadcastOnlineList();
    });
  }

  return {
    bindSocket,
    emitUpdate,
    findRoomBySocket,
    cancelRoom,
    removePlayer,
    serialize,
    characters: CHARACTERS,
    characterIds: CHARACTER_IDS
  };
}

module.exports = { setupAdventurePvp };
