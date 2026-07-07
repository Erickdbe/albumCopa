"use strict";

const {
  ARENA_HALF,
  MOVE_SPEED,
  TICK_MS,
  MATCH_MS,
  RESPAWN_MS,
  HERO_COOLDOWN_MS,
  HEROES,
  DEFAULT_DECK,
  SUPPORT_ORDER,
  TOWER_LAYOUT,
  normalizeDeck
} = require("./config");

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function createDeckHeroesModule(io, { onlinePlayers = new Map(), broadcastOnlineList = () => {} } = {}) {
  const rooms = new Map();

  function findRoomBySocket(socketId) {
    for (const room of rooms.values()) {
      if (room.players.some((player) => player.socketId === socketId)) return room;
    }
    return null;
  }

  function publicPlayer(player) {
    const hero = HEROES[player.heroId] || HEROES.archer;
    return {
      socketId: player.socketId,
      username: player.username,
      team: player.team,
      deck: player.deck,
      ready: player.ready,
      heroId: player.heroId,
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      hp: player.hp,
      maxHp: hero.hp,
      alive: player.alive,
      cooldowns: player.cooldowns,
      abilityCooldownUntil: player.abilityCooldownUntil,
      supportCooldownUntil: player.supportCooldownUntil,
      kills: player.kills,
      deaths: player.deaths
    };
  }

  function serializeRoom(room) {
    return {
      roomId: room.roomId,
      status: room.status,
      hostSocketId: room.players[0]?.socketId || null,
      players: room.players.map(publicPlayer),
      towers: room.towers,
      supports: room.supports,
      endsAt: room.endsAt || null,
      message: room.message || ""
    };
  }

  function emitRoom(room) {
    io.to(room.roomId).emit("deck-heroes:room", serializeRoom(room));
  }

  function setOnline(socketId, roomId) {
    const online = onlinePlayers.get(socketId);
    if (!online) return;
    online.inGame = true;
    online.roomId = roomId;
    online.game = "deck-heroes";
  }

  function clearOnline(socketId, roomId) {
    const online = onlinePlayers.get(socketId);
    if (!online || online.roomId !== roomId || online.game !== "deck-heroes") return;
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }

  function makePlayer(socket, deck = DEFAULT_DECK) {
    const cleanDeck = normalizeDeck(deck);
    const heroId = cleanDeck[0] || "archer";
    return {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username || "Jogador",
      team: null,
      deck: cleanDeck,
      ready: false,
      heroId,
      x: 0,
      z: 0,
      yaw: 0,
      hp: HEROES[heroId].hp,
      alive: true,
      cooldowns: {},
      abilityCooldownUntil: 0,
      supportCooldownUntil: 0,
      lastAttackAt: 0,
      kills: 0,
      deaths: 0
    };
  }

  function inviteOnline(room, socket) {
    for (const [, target] of onlinePlayers) {
      if (!target?.socketId || target.socketId === socket.id || target.inGame) continue;
      io.to(target.socketId).emit("deck-heroes:invite", {
        roomId: room.roomId,
        fromUsername: socket.username || "Jogador"
      });
    }
  }

  function createRoom(socket, { deck } = {}) {
    const existing = findRoomBySocket(socket.id);
    if (existing) {
      socket.emit("deck-heroes:joined", serializeRoom(existing));
      inviteOnline(existing, socket);
      return existing;
    }

    const room = {
      roomId: makeRoomId(),
      status: "waiting",
      players: [],
      towers: [],
      supports: [],
      message: "",
      tick: null,
      endsAt: null
    };
    const player = makePlayer(socket, deck);
    room.players.push(player);
    rooms.set(room.roomId, room);
    socket.join(room.roomId);
    setOnline(socket.id, room.roomId);
    socket.emit("deck-heroes:joined", serializeRoom(room));
    emitRoom(room);
    inviteOnline(room, socket);
    broadcastOnlineList();
    return room;
  }

  function joinRoom(socket, { roomId, deck } = {}) {
    const room = rooms.get(String(roomId || "").toUpperCase());
    if (!room || room.status !== "waiting") {
      socket.emit("deck-heroes:error", "Sala nao encontrada ou ja iniciou.");
      return null;
    }
    if (room.players.some((player) => player.socketId === socket.id)) {
      socket.emit("deck-heroes:joined", serializeRoom(room));
      return room;
    }
    if (room.players.length >= 6) {
      socket.emit("deck-heroes:error", "Sala cheia.");
      return null;
    }
    const existing = findRoomBySocket(socket.id);
    if (existing && existing.roomId !== room.roomId) leaveRoom(socket.id, "Mudou de sala.");

    const player = makePlayer(socket, deck);
    room.players.push(player);
    socket.join(room.roomId);
    setOnline(socket.id, room.roomId);
    socket.emit("deck-heroes:joined", serializeRoom(room));
    room.message = `${player.username} entrou na arena.`;
    emitRoom(room);
    broadcastOnlineList();
    return room;
  }

  function assignTeams(room) {
    room.players.forEach((player, index) => {
      player.team = index % 2 === 0 ? "blue" : "red";
      player.kills = 0;
      player.deaths = 0;
      player.cooldowns = {};
      player.abilityCooldownUntil = 0;
      player.supportCooldownUntil = 0;
      respawnPlayer(room, player, false);
    });
  }

  function respawnPlayer(room, player, emit = true) {
    const laneOffset = room.players.filter((item) => item.team === player.team).indexOf(player) - 1;
    const baseZ = player.team === "blue" ? -34 : 34;
    player.x = clamp(laneOffset * 7, -18, 18);
    player.z = baseZ;
    player.yaw = player.team === "blue" ? Math.PI : 0;
    player.alive = true;
    player.hp = HEROES[player.heroId]?.hp || HEROES.archer.hp;
    if (emit) emitRoom(room);
  }

  function startRoom(socket) {
    const room = findRoomBySocket(socket.id);
    if (!room || room.status !== "waiting" || room.players[0]?.socketId !== socket.id) return;
    if (room.players.length < 2 || room.players.length % 2 !== 0) {
      socket.emit("deck-heroes:error", "Precisa iniciar com 2, 4 ou 6 jogadores.");
      return;
    }
    room.status = "playing";
    room.towers = TOWER_LAYOUT.map((tower) => ({ ...tower, maxHp: tower.hp, alive: true }));
    room.supports = [];
    room.endsAt = Date.now() + MATCH_MS;
    assignTeams(room);
    room.message = "Partida iniciada.";
    emitRoom(room);
    startTick(room);
  }

  function endRoom(room, reason = "fim") {
    if (!room || room.status !== "playing") return;
    room.status = "finished";
    if (room.tick) clearInterval(room.tick);
    room.tick = null;
    const redKing = room.towers.find((tower) => tower.id === "red-king");
    const blueKing = room.towers.find((tower) => tower.id === "blue-king");
    let winner = null;
    if ((blueKing?.hp || 0) <= 0) winner = "red";
    else if ((redKing?.hp || 0) <= 0) winner = "blue";
    else {
      const redHp = room.towers.filter((tower) => tower.team === "red").reduce((sum, tower) => sum + Math.max(0, tower.hp), 0);
      const blueHp = room.towers.filter((tower) => tower.team === "blue").reduce((sum, tower) => sum + Math.max(0, tower.hp), 0);
      winner = redHp === blueHp ? "draw" : redHp > blueHp ? "red" : "blue";
    }
    io.to(room.roomId).emit("deck-heroes:end", { reason, winner, room: serializeRoom(room) });
    setTimeout(() => {
      room.status = "waiting";
      room.endsAt = null;
      room.towers = [];
      room.supports = [];
      room.players.forEach((player) => {
        player.team = null;
        player.ready = false;
        player.alive = true;
        player.cooldowns = {};
        player.hp = HEROES[player.heroId]?.hp || HEROES.archer.hp;
      });
      emitRoom(room);
    }, 4500);
  }

  function applyDamage(room, attacker, target, amount) {
    if (!target || !target.alive) return;
    target.hp = Math.max(0, target.hp - Math.max(1, Math.round(amount)));
    if (target.hp > 0) return;
    target.alive = false;
    if (target.kind) {
      if (target.kind === "king") endRoom(room, `${target.team} king caiu`);
      return;
    }
    if (target.ownerId) return;
    if (attacker && attacker.socketId !== target.socketId) attacker.kills += 1;
    target.deaths += 1;
    target.cooldowns[target.heroId] = Date.now() + HERO_COOLDOWN_MS;
    setTimeout(() => {
      if (!rooms.has(room.roomId) || room.status !== "playing") return;
      const available = target.deck.find((id) => Date.now() >= (target.cooldowns[id] || 0)) || target.deck[0];
      target.heroId = available;
      respawnPlayer(room, target, true);
    }, RESPAWN_MS);
  }

  function nearestEnemyTower(room, source) {
    return room.towers
      .filter((tower) => tower.alive && tower.team !== source.team)
      .sort((a, b) => distance(source, a) - distance(source, b))[0] || null;
  }

  function chooseAttackTarget(room, player, explicit = {}) {
    const hero = HEROES[player.heroId] || HEROES.archer;
    if (explicit.targetSocketId) {
      const target = room.players.find((item) => item.socketId === explicit.targetSocketId && item.team !== player.team && item.alive);
      if (target && distance(player, target) <= hero.range + 2) return target;
    }
    if (explicit.towerId) {
      const tower = room.towers.find((item) => item.id === explicit.towerId && item.team !== player.team && item.alive);
      if (tower && distance(player, tower) <= hero.range + 3) return tower;
    }
    const enemy = room.players
      .filter((item) => item.team !== player.team && item.alive && distance(player, item) <= hero.range)
      .sort((a, b) => distance(player, a) - distance(player, b))[0];
    if (enemy) return enemy;
    const tower = nearestEnemyTower(room, player);
    return tower && distance(player, tower) <= hero.range + 2 ? tower : null;
  }

  function attack(socket, payload = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || room.status !== "playing" || !player?.alive) return;
    const hero = HEROES[player.heroId] || HEROES.archer;
    const now = Date.now();
    if (now - player.lastAttackAt < hero.fireRateMs) return;
    player.lastAttackAt = now;
    const target = chooseAttackTarget(room, player, payload);
    if (!target) {
      io.to(room.roomId).emit("deck-heroes:attack", { from: socket.id, heroId: player.heroId, missed: true });
      return;
    }
    const rage = player.rageUntil && now < player.rageUntil ? 1.45 : 1;
    const towerMul = target.kind ? (hero.towerDamageMul || 1) : 1;
    applyDamage(room, player, target, hero.damage * rage * towerMul);
    io.to(room.roomId).emit("deck-heroes:attack", {
      from: socket.id,
      heroId: player.heroId,
      targetSocketId: target.socketId || null,
      towerId: target.id || null
    });
    emitRoom(room);
  }

  function castAbility(socket, payload = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || room.status !== "playing" || !player?.alive) return;
    const hero = HEROES[player.heroId] || HEROES.archer;
    const ability = hero.ability || {};
    const now = Date.now();
    if (now < player.abilityCooldownUntil) return;
    player.abilityCooldownUntil = now + (ability.cooldownMs || 9000);

    if (ability.id === "rage") {
      player.rageUntil = now + ability.durationMs;
    } else if (ability.id === "heal_wave") {
      room.players.forEach((ally) => {
        if (ally.team !== player.team || !ally.alive || distance(player, ally) > ability.radius) return;
        ally.hp = Math.min(HEROES[ally.heroId].hp, ally.hp + ability.heal);
      });
    } else if (ability.id === "smoke_step") {
      const forward = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
      player.x = clamp(player.x + forward.x * ability.range, -ARENA_HALF + 3, ARENA_HALF - 3);
      player.z = clamp(player.z + forward.z * ability.range, -ARENA_HALF + 3, ARENA_HALF - 3);
    } else if (ability.id !== "support_call") {
      const point = {
        x: clamp(payload.x, -ARENA_HALF, ARENA_HALF),
        z: clamp(payload.z, -ARENA_HALF, ARENA_HALF)
      };
      [...room.players, ...room.towers].forEach((target) => {
        if (target.team === player.team || !target.alive || distance(point, target) > (ability.radius || 4)) return;
        applyDamage(room, player, target, ability.damage || 35);
      });
    }
    io.to(room.roomId).emit("deck-heroes:ability", {
      socketId: socket.id,
      heroId: player.heroId,
      abilityId: ability.id,
      x: payload.x,
      z: payload.z
    });
    emitRoom(room);
  }

  function callSupport(socket, { heroId } = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || room.status !== "playing" || !player?.alive) return;
    if (room.players.length !== 2 || player.heroId !== "balloon") return;
    const now = Date.now();
    if (now < player.supportCooldownUntil) return;
    const supportHero = SUPPORT_ORDER.includes(heroId) ? heroId : "knight";
    player.supportCooldownUntil = now + 16000;
    const stats = HEROES[supportHero] || HEROES.knight;
    room.supports.push({
      id: `${socket.id}-${now}`,
      ownerId: socket.id,
      team: player.team,
      heroId: supportHero,
      x: player.x + (Math.random() - 0.5) * 3,
      z: player.z + (player.team === "blue" ? 2 : -2),
      hp: Math.round(stats.hp * 0.55),
      maxHp: Math.round(stats.hp * 0.55),
      alive: true,
      lastAttackAt: 0
    });
    io.to(room.roomId).emit("deck-heroes:support", { socketId: socket.id, heroId: supportHero });
    emitRoom(room);
  }

  function selectHero(socket, { heroId } = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !player || !HEROES[heroId] || !player.deck.includes(heroId)) return;
    const now = Date.now();
    if (room.status === "playing" && now < (player.cooldowns[heroId] || 0)) return;
    player.cooldowns[player.heroId] = room.status === "playing" ? now + HERO_COOLDOWN_MS * 0.45 : 0;
    player.heroId = heroId;
    player.hp = HEROES[heroId].hp;
    player.alive = true;
    player.abilityCooldownUntil = 0;
    io.to(room.roomId).emit("deck-heroes:hero", { socketId: socket.id, heroId });
    emitRoom(room);
  }

  function setDeck(socket, { deck } = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !player || room.status !== "waiting") return;
    player.deck = normalizeDeck(deck);
    if (!player.deck.includes(player.heroId)) player.heroId = player.deck[0];
    player.hp = HEROES[player.heroId].hp;
    emitRoom(room);
  }

  function setReady(socket, { ready } = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !player || room.status !== "waiting") return;
    player.ready = Boolean(ready);
    emitRoom(room);
  }

  function move(socket, state = {}) {
    const room = findRoomBySocket(socket.id);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || room.status !== "playing" || !player?.alive) return;
    const hero = HEROES[player.heroId] || HEROES.archer;
    const maxStep = MOVE_SPEED * hero.speed * 0.25;
    const nextX = clamp(state.x, -ARENA_HALF + 2, ARENA_HALF - 2);
    const nextZ = clamp(state.z, -ARENA_HALF + 2, ARENA_HALF - 2);
    if (Math.hypot(nextX - player.x, nextZ - player.z) <= maxStep + 0.7) {
      player.x = nextX;
      player.z = nextZ;
    }
    player.yaw = clamp(state.yaw, -Math.PI * 2, Math.PI * 2);
    socket.to(room.roomId).volatile.emit("deck-heroes:move", {
      socketId: socket.id,
      x: player.x,
      z: player.z,
      yaw: player.yaw
    });
  }

  function tickSupports(room) {
    const now = Date.now();
    room.supports.forEach((support) => {
      if (!support.alive) return;
      const hero = HEROES[support.heroId] || HEROES.knight;
      const targetPlayer = room.players
        .filter((player) => player.team !== support.team && player.alive && distance(support, player) <= hero.range)
        .sort((a, b) => distance(support, a) - distance(support, b))[0];
      const target = targetPlayer || nearestEnemyTower(room, support);
      if (!target) return;
      const d = distance(support, target);
      if (d > Math.max(3.2, hero.range * 0.72)) {
        const step = MOVE_SPEED * hero.speed * 0.45 * (TICK_MS / 1000);
        support.x += ((target.x - support.x) / d) * step;
        support.z += ((target.z - support.z) / d) * step;
      } else if (now - support.lastAttackAt > hero.fireRateMs * 1.2) {
        support.lastAttackAt = now;
        const owner = room.players.find((player) => player.socketId === support.ownerId);
        applyDamage(room, owner, target, hero.damage * 0.55);
      }
    });
    room.supports = room.supports.filter((support) => support.alive && support.hp > 0);
  }

  function towerFire(room) {
    const now = Date.now();
    room.towers.forEach((tower) => {
      if (!tower.alive || tower.hp <= 0) return;
      const target = [...room.players, ...room.supports]
        .filter((unit) => unit.team !== tower.team && unit.alive && distance(tower, unit) < 17)
        .sort((a, b) => distance(tower, a) - distance(tower, b))[0];
      if (!target || now - (tower.lastFireAt || 0) < 900) return;
      tower.lastFireAt = now;
      const attacker = room.players.find((player) => player.team === tower.team) || null;
      applyDamage(room, attacker, target, tower.kind === "king" ? 28 : 22);
      io.to(room.roomId).emit("deck-heroes:tower-fire", { towerId: tower.id, targetId: target.socketId || target.id });
    });
    room.towers.forEach((tower) => {
      if (tower.hp <= 0) tower.alive = false;
    });
  }

  function startTick(room) {
    if (room.tick) clearInterval(room.tick);
    let frame = 0;
    room.tick = setInterval(() => {
      if (!rooms.has(room.roomId) || room.status !== "playing") return;
      if (Date.now() >= room.endsAt) {
        endRoom(room, "tempo");
        return;
      }
      tickSupports(room);
      towerFire(room);
      frame += 1;
      if (frame % 3 === 0) io.to(room.roomId).volatile.emit("deck-heroes:state", serializeRoom(room));
    }, TICK_MS);
  }

  function leaveRoom(socketId, reason = "Saiu da sala.") {
    const room = findRoomBySocket(socketId);
    if (!room) return;
    const socket = io.sockets.sockets.get(socketId);
    if (socket) socket.leave(room.roomId);
    clearOnline(socketId, room.roomId);
    room.players = room.players.filter((player) => player.socketId !== socketId);
    if (!room.players.length) {
      if (room.tick) clearInterval(room.tick);
      rooms.delete(room.roomId);
    } else {
      room.message = reason;
      if (room.status === "playing" && room.players.length < 2) endRoom(room, "sem jogadores");
      else emitRoom(room);
    }
    broadcastOnlineList();
  }

  function bindSocket(socket) {
    socket.on("deck-heroes:open", (payload = {}) => createRoom(socket, payload));
    socket.on("deck-heroes:create", (payload = {}) => createRoom(socket, payload));
    socket.on("deck-heroes:join", (payload = {}) => joinRoom(socket, payload));
    socket.on("deck-heroes:setDeck", (payload = {}) => setDeck(socket, payload));
    socket.on("deck-heroes:ready", (payload = {}) => setReady(socket, payload));
    socket.on("deck-heroes:start", () => startRoom(socket));
    socket.on("deck-heroes:move", (payload = {}) => move(socket, payload));
    socket.on("deck-heroes:selectHero", (payload = {}) => selectHero(socket, payload));
    socket.on("deck-heroes:attack", (payload = {}) => attack(socket, payload));
    socket.on("deck-heroes:ability", (payload = {}) => castAbility(socket, payload));
    socket.on("deck-heroes:support", (payload = {}) => callSupport(socket, payload));
    socket.on("deck-heroes:leave", () => leaveRoom(socket.id));
    socket.on("disconnect", () => leaveRoom(socket.id, "Desconectou."));
  }

  return {
    bindSocket,
    removePlayer: leaveRoom
  };
}

module.exports = {
  createDeckHeroesModule
};
