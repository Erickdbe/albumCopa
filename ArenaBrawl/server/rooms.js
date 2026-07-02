"use strict";

const {
  CLASSES, CLASS_IDS,
  SECONDARY_WEAPONS,
  GRENADES, GRENADE_CHARGES_PER_LIFE,
  MAP_IDS,
  ARENA_HALF,
  normalizeSettings,
  pickSpawn,
  HEADSHOT_MULTIPLIER
} = require("./config");

const RESPAWN_MS = 3500;
const RANGE_TOLERANCE = 1.15;

function normalizeClassId(value) {
  return CLASS_IDS.includes(value) ? value : "rifle";
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function distance3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function createRoomsModule(io) {
  const rooms = new Map();

  function findRoomBySocket(socketId) {
    for (const room of rooms.values()) {
      if (room.players.some((p) => p.socketId === socketId)) return room;
    }
    return null;
  }

  function publicRoomList() {
    return [...rooms.values()]
      .filter((room) => room.status === "waiting")
      .map((room) => ({
        roomId: room.roomId,
        hostName: room.players[0]?.username || "?",
        mapId: room.settings.mapId,
        mode: room.settings.mode,
        playerCount: room.players.length,
        maxPlayers: room.settings.maxPlayers,
        status: room.status
      }));
  }

  function broadcastLobbyList() {
    io.emit("lobby:rooms", publicRoomList());
  }

  function makePlayer(socket, className) {
    return {
      socketId: socket.id,
      username: socket.username,
      classId: normalizeClassId(className),
      team: null,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
      moving: false, sprinting: false, jumping: false, crouching: false,
      health: 100,
      alive: true,
      kills: 0,
      deaths: 0,
      score: 0,
      grenadeCharges: {},
      lastShotAt: { primary: 0, secondary: 0 },
      reloadUntil: { primary: 0, secondary: 0 },
      abilityActive: false,
      abilityExpiresAt: 0,
      abilityCooldownUntil: 0,
      blindedUntil: 0,
      chargeStartedAt: 0
    };
  }

  function publicPlayer(p) {
    return {
      socketId: p.socketId, username: p.username, classId: p.classId, team: p.team,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      moving: p.moving, sprinting: p.sprinting, jumping: p.jumping, crouching: p.crouching,
      health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths, score: p.score
    };
  }

  function serializeRoom(room) {
    return {
      roomId: room.roomId,
      status: room.status,
      settings: room.settings,
      hostSocketId: room.players[0]?.socketId || null,
      players: room.players.map(publicPlayer),
      endsAt: room.endsAt || null
    };
  }

  function emitRoomUpdate(room) {
    io.to(room.roomId).emit("room:update", serializeRoom(room));
  }

  function assignTeams(room) {
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);
    shuffled.forEach((p, i) => { p.team = i % 2 === 0 ? "red" : "blue"; });
  }

  function respawnPlayer(room, player) {
    const spawn = pickSpawn(room.settings.mapId, room.settings.mode, player.team);
    player.x = spawn.x; player.y = spawn.y; player.z = spawn.z; player.yaw = spawn.yaw; player.pitch = 0;
    player.health = 100;
    player.alive = true;
    player.grenadeCharges = Object.fromEntries(Object.keys(GRENADES).map((id) => [id, GRENADE_CHARGES_PER_LIFE]));
    io.to(room.roomId).emit("match:respawn", {
      socketId: player.socketId, x: player.x, y: player.y, z: player.z, yaw: player.yaw, health: player.health
    });
  }

  function endMatch(room, reason) {
    if (room.status !== "playing") return;
    room.status = "finished";
    if (room.timer) clearTimeout(room.timer);
    const results = [...room.players]
      .map(publicPlayer)
      .sort((a, b) => b.score - a.score);
    let teamScores = null;
    if (room.settings.mode === "teams") {
      teamScores = { red: 0, blue: 0 };
      room.players.forEach((p) => { teamScores[p.team] = (teamScores[p.team] || 0) + p.score; });
    }
    io.to(room.roomId).emit("match:end", { reason, results, teamScores });
    setTimeout(() => {
      if (!rooms.has(room.roomId)) return;
      room.status = "waiting";
      room.players.forEach((p) => {
        p.kills = 0; p.deaths = 0; p.score = 0; p.alive = true; p.health = 100; p.team = null;
      });
      emitRoomUpdate(room);
      broadcastLobbyList();
    }, 6000);
  }

  function checkScoreLimit(room) {
    if (room.settings.mode === "teams") {
      const teamScores = { red: 0, blue: 0 };
      room.players.forEach((p) => { teamScores[p.team] = (teamScores[p.team] || 0) + p.score; });
      if (teamScores.red >= room.settings.scoreLimit || teamScores.blue >= room.settings.scoreLimit) {
        endMatch(room, "score");
      }
    } else {
      if (room.players.some((p) => p.score >= room.settings.scoreLimit)) endMatch(room, "score");
    }
  }

  function applyDamage(room, shooter, target, rawDamage, isHeadshot) {
    if (!target.alive) return;
    const damage = Math.round(isHeadshot ? rawDamage * HEADSHOT_MULTIPLIER : rawDamage);
    target.health = Math.max(0, target.health - damage);
    if (target.health <= 0) {
      target.alive = false;
      target.deaths += 1;
      if (shooter && shooter.socketId !== target.socketId) {
        shooter.kills += 1;
        const friendlyFire = room.settings.mode === "teams" && shooter.team === target.team;
        shooter.score += friendlyFire ? -1 : 1;
      }
      io.to(room.roomId).emit("match:kill", {
        killerId: shooter?.socketId || null, killerName: shooter?.username || "Arena",
        victimId: target.socketId, victimName: target.username,
        headshot: isHeadshot
      });
      setTimeout(() => { if (rooms.has(room.roomId) && !target.disconnected) respawnPlayer(room, target); }, RESPAWN_MS);
      checkScoreLimit(room);
    } else {
      io.to(room.roomId).emit("match:damage", { targetSocketId: target.socketId, health: target.health, byId: shooter?.socketId || null });
    }
  }

  function weaponFor(player, slot) {
    if (slot === "secondary") return SECONDARY_WEAPONS[player.secondaryId] || null;
    return CLASSES[player.classId].primary;
  }

  function removePlayer(socketId, reason = "") {
    const room = findRoomBySocket(socketId);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socketId);
    if (!player) return;
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);

    room.players = room.players.filter((p) => p.socketId !== socketId);
    io.to(room.roomId).emit("room:player-left", { socketId, reason });

    if (!room.players.length) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(room.roomId);
    } else {
      emitRoomUpdate(room);
      if (room.status === "playing") checkScoreLimit(room);
    }
    broadcastLobbyList();
  }

  function bindSocket(socket) {
    socket.on("lobby:list", () => socket.emit("lobby:rooms", publicRoomList()));

    function createRoom({ username, settings, classId, secondaryId } = {}, inviteOnlinePlayers = false) {
      const existingRoom = findRoomBySocket(socket.id);
      if (existingRoom) {
        socket.emit("room:joined", serializeRoom(existingRoom));
        return existingRoom;
      }

      if (!socket.userId) {
        socket.username = String(username || "Jogador").slice(0, 18) || "Jogador";
      }

      const room = {
        roomId: makeRoomId(),
        status: "waiting",
        settings: normalizeSettings(settings),
        players: [],
        timer: null,
        endsAt: null
      };
      const player = makePlayer(socket, classId);
      player.secondaryId = SECONDARY_WEAPONS[secondaryId] ? secondaryId : "pistol_common";
      room.players.push(player);
      rooms.set(room.roomId, room);
      socket.join(room.roomId);

      socket.emit("room:joined", serializeRoom(room));
      if (inviteOnlinePlayers) {
        socket.broadcast.emit("arena-brawl:invite", {
          roomId: room.roomId,
          fromUsername: socket.username,
          maxPlayers: room.settings.maxPlayers
        });
      }
      broadcastLobbyList();
      return room;
    }

    socket.on("arena-brawl:open", (options = {}) => createRoom(options, true));

    socket.on("room:create", (options = {}) => createRoom(options, false));

    socket.on("room:join", ({ username, roomId, classId, secondaryId } = {}) => {
      const room = rooms.get(String(roomId || "").toUpperCase());
      if (!room || room.status !== "waiting") return socket.emit("room:error", "Sala indisponivel.");
      if (room.players.length >= room.settings.maxPlayers) return socket.emit("room:error", "Sala cheia.");
      if (findRoomBySocket(socket.id)) return socket.emit("room:error", "Voce ja esta em uma sala.");

      if (!socket.userId) {
        socket.username = String(username || "Jogador").slice(0, 18) || "Jogador";
      }
      const player = makePlayer(socket, classId);
      player.secondaryId = SECONDARY_WEAPONS[secondaryId] ? secondaryId : "pistol_common";
      room.players.push(player);
      socket.join(room.roomId);

      socket.emit("room:joined", serializeRoom(room));
      emitRoomUpdate(room);
      broadcastLobbyList();
    });

    socket.on("room:setClass", ({ classId, secondaryId } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "waiting") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;
      if (classId) player.classId = normalizeClassId(classId);
      if (secondaryId && SECONDARY_WEAPONS[secondaryId]) player.secondaryId = secondaryId;
      emitRoomUpdate(room);
    });

    socket.on("room:setSettings", ({ settings } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "waiting" || room.players[0]?.socketId !== socket.id) return;
      room.settings = normalizeSettings(settings);
      emitRoomUpdate(room);
      broadcastLobbyList();
    });

    socket.on("room:start", () => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "waiting" || room.players[0]?.socketId !== socket.id) return;
      if (!MAP_IDS.includes(room.settings.mapId)) room.settings.mapId = "praia";
      if (room.settings.mode === "teams") assignTeams(room);
      room.players.forEach((p) => {
        p.kills = 0; p.deaths = 0; p.score = 0;
        respawnPlayer(room, p);
      });
      room.status = "playing";
      room.endsAt = Date.now() + room.settings.durationMin * 60000;
      room.timer = setTimeout(() => endMatch(room, "time"), room.settings.durationMin * 60000);
      io.to(room.roomId).emit("match:start", serializeRoom(room));
      broadcastLobbyList();
    });

    socket.on("room:leave", () => removePlayer(socket.id, `${socket.username} saiu da sala.`));

    socket.on("match:move", (state = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
      player.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, num(state.x, player.x)));
      player.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, num(state.z, player.z)));
      player.y = Math.max(0, Math.min(24, num(state.y, player.y)));
      player.yaw = num(state.yaw, player.yaw);
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, num(state.pitch, player.pitch)));
      player.moving = Boolean(state.moving);
      player.sprinting = Boolean(state.sprinting);
      player.jumping = Boolean(state.jumping);
      player.crouching = Boolean(state.crouching);
      socket.to(room.roomId).volatile.emit("match:player-move", {
        socketId: socket.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
        moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching
      });
    });

    socket.on("match:charge-start", ({ slot } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const weapon = weaponFor(player, slot === "secondary" ? "secondary" : "primary");
      if (weapon?.chargeable) player.chargeStartedAt = Date.now();
    });

    socket.on("match:charge-cancel", () => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((p) => p.socketId === socket.id);
      if (player) player.chargeStartedAt = 0;
    });

    socket.on("match:shoot", ({ slot, targetSocketId, hitZone, pelletHits } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const shooter = room.players.find((p) => p.socketId === socket.id);
      if (!shooter || !shooter.alive) return;
      if (slot === "secondary" && !room.settings.secondaryEnabled) return;

      const weapon = weaponFor(shooter, slot === "secondary" ? "secondary" : "primary");
      if (!weapon) return;
      const now = Date.now();
      const isAbilityFireRate = shooter.abilityActive && now < shooter.abilityExpiresAt && CLASSES[shooter.classId].ability.id === abilityFireRateBoost(shooter.classId);
      const fireRate = isAbilityFireRate ? weapon.fireRateMs * 0.5 : weapon.fireRateMs;
      if (now < (shooter.reloadUntil[slot] || 0)) return;
      if (now - (shooter.lastShotAt[slot] || 0) < fireRate) return;

      shooter.lastShotAt[slot] = now;
      socket.to(room.roomId).volatile.emit("match:shot-fired", { socketId: socket.id, slot, weaponId: weapon.id });

      let chargeDamageMultiplier = 1;
      if (weapon.chargeable) {
        const elapsed = Math.max(0, now - Number(shooter.chargeStartedAt || now));
        const charge = Math.max(0, Math.min(1, elapsed / weapon.chargeMs));
        chargeDamageMultiplier = weapon.minChargeDamageMul + (1 - weapon.minChargeDamageMul) * charge;
        shooter.chargeStartedAt = 0;
      }

      if (!targetSocketId) return;
      const target = room.players.find((p) => p.socketId === targetSocketId);
      if (!target || target.socketId === shooter.socketId || !target.alive) return;

      const serverDist = distance3(shooter, target);
      if (serverDist > weapon.range * RANGE_TOLERANCE) return;

      const falloff = Math.max(0.6, 1 - Math.min(1, serverDist / weapon.range) * 0.4);
      const pellets = Math.max(1, Math.min(weapon.pellets || 1, Number(pelletHits) || 1));
      let piercingBonus = 1;
      if (shooter.abilityActive && now < shooter.abilityExpiresAt && CLASSES[shooter.classId]?.ability?.id === "disparo_perfurante") piercingBonus = 1;

      applyDamage(
        room,
        shooter,
        target,
        weapon.damage * falloff * pellets * piercingBonus * chargeDamageMultiplier,
        hitZone === "head"
      );
    });

    socket.on("match:reload", ({ slot } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const weapon = weaponFor(player, slot === "secondary" ? "secondary" : "primary");
      if (!weapon || weapon.kind === "melee") return;
      player.reloadUntil[slot === "secondary" ? "secondary" : "primary"] = Date.now() + weapon.reloadMs;
    });

    socket.on("match:ability", () => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const now = Date.now();
      if (now < player.abilityCooldownUntil) return;
      const ability = CLASSES[player.classId].ability;
      player.abilityActive = true;
      player.abilityExpiresAt = now + ability.durationMs;
      player.abilityCooldownUntil = now + ability.cooldownMs;
      io.to(room.roomId).emit("match:ability", { socketId: socket.id, abilityId: ability.id, durationMs: ability.durationMs });
      socket.emit("match:ability-state", { cooldownUntil: player.abilityCooldownUntil });
      if (ability.durationMs > 0) {
        setTimeout(() => { player.abilityActive = false; }, ability.durationMs);
      }
    });

    socket.on("match:grenadeThrow", ({ grenadeId, x, y, z, dirX, dirY, dirZ } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing" || !room.settings.grenadesEnabled) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive || !GRENADES[grenadeId]) return;
      const charges = player.grenadeCharges[grenadeId] || 0;
      if (charges <= 0) return;
      player.grenadeCharges[grenadeId] = charges - 1;
      socket.emit("match:grenade-ammo", { grenadeId, charges: player.grenadeCharges[grenadeId] });
      socket.to(room.roomId).volatile.emit("match:grenadeThrow", {
        socketId: socket.id, grenadeId,
        x: Number(x) || player.x, y: Number(y) || player.y + 1.2, z: Number(z) || player.z,
        dirX: Number(dirX) || 0, dirY: Number(dirY) || 0, dirZ: Number(dirZ) || -1
      });
    });

    socket.on("match:grenadeDetonate", ({ grenadeId, x, z } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const thrower = room.players.find((p) => p.socketId === socket.id);
      const grenade = GRENADES[grenadeId];
      if (!thrower || !grenade) return;
      const point = { x: Number(x) || thrower.x, y: 0, z: Number(z) || thrower.z };

      io.to(room.roomId).emit("match:grenadeDetonate", { grenadeId, x: point.x, z: point.z, byId: socket.id });

      if (grenade.damage > 0) {
        room.players.forEach((target) => {
          if (!target.alive) return;
          const d = distance3({ x: point.x, y: 0, z: point.z }, { x: target.x, y: 0, z: target.z });
          if (d > grenade.radius) return;
          const falloff = Math.max(0, 1 - d / grenade.radius);
          const dmg = grenade.minDamage + (grenade.damage - grenade.minDamage) * falloff;
          applyDamage(room, target.socketId === thrower.socketId ? null : thrower, target, dmg, false);
        });
      }
      if (grenade.id === "flash" || grenade.id === "smoke") {
        room.players.forEach((target) => {
          if (!target.alive) return;
          const d = distance3({ x: point.x, y: 0, z: point.z }, { x: target.x, y: 0, z: target.z });
          if (d > grenade.radius) return;
          if (grenade.id === "flash") {
            target.blindedUntil = Date.now() + grenade.blindMs;
            io.to(target.socketId).emit("match:blinded", { durationMs: grenade.blindMs });
          }
        });
      }
    });

    socket.on("disconnect", () => {
      const room = findRoomBySocket(socket.id);
      if (room) {
        if (room.status === "playing") {
          const player = room.players.find((p) => p.socketId === socket.id);
          if (player) player.disconnected = true;
        }
        removePlayer(socket.id, `${socket.username || "Jogador"} desconectou.`);
      }
    });
  }

  function abilityFireRateBoost(classId) {
    return classId === "smg" || classId === "gunslinger" || classId === "heavy" ? CLASSES[classId].ability.id : null;
  }

  return { bindSocket, findRoomBySocket, publicRoomList };
}

module.exports = { createRoomsModule };
