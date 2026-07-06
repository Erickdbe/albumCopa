"use strict";

const {
  CLASSES, CLASS_IDS,
  SECONDARY_WEAPONS,
  GRENADES, GRENADE_CHARGES_PER_LIFE,
  MAP_IDS,
  ARENA_HALF,
  MAP_HALF_SIZES,
  VEHICLE_SPAWNS,
  VEHICLE_STATS,
  normalizeSettings,
  pickSpawn,
  HEADSHOT_MULTIPLIER
} = require("./config");

const RESPAWN_MS = 3500;
const RANGE_TOLERANCE = 1.15;
const WORLD_TICK_MS = 50;
const WORLD_EVENT_TIME_SCALE = Math.max(0.02, Number(process.env.ARENA_EVENT_TIME_SCALE) || 1);
const EMOTES = {
  dance: { animation: "dance", speed: 1, durationMs: 6200 },
  dance_fast: { animation: "dance", speed: 1.35, durationMs: 4800 },
  dance_slow: { animation: "dance", speed: 0.72, durationMs: 7600 }
};

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

function approach(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

function makeVehicles(mapId) {
  return (VEHICLE_SPAWNS[mapId] || []).map((spawn) => {
    const stats = VEHICLE_STATS[spawn.type];
    return {
      ...spawn,
      health: stats.maxHealth,
      maxHealth: stats.maxHealth,
      speed: 0,
      driverId: null,
      destroyed: false,
      input: { throttle: 0, steer: 0, lift: 0 },
      lastFireAt: 0,
      lastRamAt: new Map()
    };
  });
}

function publicVehicle(vehicle) {
  return {
    id: vehicle.id, type: vehicle.type,
    x: vehicle.x, y: vehicle.y, z: vehicle.z, yaw: vehicle.yaw,
    speed: vehicle.speed, health: vehicle.health, maxHealth: vehicle.maxHealth,
    driverId: vehicle.driverId, destroyed: vehicle.destroyed
  };
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
      chargeStartedAt: 0,
      vehicleId: null,
      lastWorldForceAt: 0,
      lastEnvironmentHitAt: 0,
      lastEmoteAt: 0,
      emoteId: null,
      secondaryId: "pistol_common",
      pendingClassId: null,
      pendingSecondaryId: null
    };
  }

  function publicPlayer(p) {
    return {
      socketId: p.socketId, username: p.username, classId: p.classId, secondaryId: p.secondaryId, team: p.team,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      moving: p.moving, sprinting: p.sprinting, jumping: p.jumping, crouching: p.crouching,
      health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths, score: p.score,
      vehicleId: p.vehicleId || null
    };
  }

  function serializeRoom(room) {
    const mapVotes = Object.fromEntries(MAP_IDS.map((mapId) => [mapId, 0]));
    const playerVotes = {};
    room.mapVotes?.forEach((mapId, socketId) => {
      if (MAP_IDS.includes(mapId)) mapVotes[mapId] += 1;
      playerVotes[socketId] = mapId;
    });
    return {
      roomId: room.roomId,
      status: room.status,
      settings: room.settings,
      hostSocketId: room.players[0]?.socketId || null,
      players: room.players.map(publicPlayer),
      mapVotes,
      playerVotes,
      vehicles: (room.vehicles || []).map(publicVehicle),
      worldEvent: room.worldEvent || null,
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

  function selectVotedMap(room) {
    const counts = Object.fromEntries(MAP_IDS.map((mapId) => [mapId, 0]));
    room.mapVotes?.forEach((mapId) => {
      if (MAP_IDS.includes(mapId)) counts[mapId] += 1;
    });
    const highest = Math.max(...Object.values(counts));
    if (highest <= 0) return room.settings.mapId;
    const tied = MAP_IDS.filter((mapId) => counts[mapId] === highest);
    const hostVote = room.mapVotes?.get(room.players[0]?.socketId);
    return tied.includes(hostVote) ? hostVote : tied[0];
  }

  function respawnPlayer(room, player, emit = true) {
    if (player.vehicleId) {
      releaseVehicle(room, player, "respawn");
    }
    if (player.pendingClassId) player.classId = player.pendingClassId;
    if (player.pendingSecondaryId) player.secondaryId = player.pendingSecondaryId;
    player.pendingClassId = null;
    player.pendingSecondaryId = null;
    const spawn = pickSpawn(room.settings.mapId, room.settings.mode, player.team);
    player.x = spawn.x; player.y = spawn.y; player.z = spawn.z; player.yaw = spawn.yaw; player.pitch = 0;
    player.health = 100;
    player.alive = true;
    player.grenadeCharges = Object.fromEntries(Object.keys(GRENADES).map((id) => [id, GRENADE_CHARGES_PER_LIFE]));
    if (emit) {
      io.to(room.roomId).emit("match:respawn", {
        socketId: player.socketId, x: player.x, y: player.y, z: player.z, yaw: player.yaw, health: player.health,
        classId: player.classId, secondaryId: player.secondaryId, team: player.team
      });
      emitRoomUpdate(room);
    }
  }

  function endMatch(room, reason) {
    if (room.status !== "playing") return;
    room.status = "finished";
    if (room.timer) clearTimeout(room.timer);
    if (room.worldTimer) clearInterval(room.worldTimer);
    room.worldTimer = null;
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
      if (target.vehicleId) releaseVehicle(room, target, "death");
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
      io.to(room.roomId).emit("match:damage", {
        targetSocketId: target.socketId,
        health: target.health,
        byId: shooter?.socketId || null,
        damage,
        headshot: Boolean(isHeadshot)
      });
    }
  }

  function releaseVehicle(room, player, reason = "exit") {
    if (!player?.vehicleId) return null;
    const vehicle = room.vehicles?.find((item) => item.id === player.vehicleId);
    if (vehicle?.driverId === player.socketId) vehicle.driverId = null;
    player.vehicleId = null;
    if (vehicle) {
      player.x = vehicle.x + Math.cos(vehicle.yaw) * 2.2;
      player.y = Math.max(0, vehicle.y);
      player.z = vehicle.z - Math.sin(vehicle.yaw) * 2.2;
      io.to(room.roomId).emit("vehicle:occupied", { vehicleId: vehicle.id, driverId: null });
      io.to(room.roomId).volatile.emit("match:player-move", {
        socketId: player.socketId, x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
        moving: false, sprinting: false, jumping: false, crouching: false
      });
    }
    io.to(player.socketId).emit("vehicle:exited", { reason, x: player.x, y: player.y, z: player.z });
    return vehicle;
  }

  function damageVehicle(room, vehicle, amount, attacker = null) {
    if (!vehicle || vehicle.destroyed) return;
    vehicle.health = Math.max(0, vehicle.health - Math.max(0, Math.min(120, Number(amount) || 0)));
    io.to(room.roomId).emit("vehicle:damaged", {
      vehicleId: vehicle.id,
      health: vehicle.health,
      maxHealth: vehicle.maxHealth
    });
    if (vehicle.health > 0) return;

    vehicle.destroyed = true;
    vehicle.speed = 0;
    const driver = room.players.find((player) => player.socketId === vehicle.driverId);
    if (driver) {
      releaseVehicle(room, driver, "exploded");
      applyDamage(room, attacker, driver, 32, false);
      io.to(driver.socketId).emit("world:force", { x: 0, y: 11, z: 0, fallDamage: 7 });
    }
    vehicle.driverId = null;
    io.to(room.roomId).emit("vehicle:exploded", {
      vehicleId: vehicle.id, x: vehicle.x, y: vehicle.y, z: vehicle.z
    });
  }

  function eventForRoom(room, now) {
    const elapsed = Math.max(0, now - room.startedAt) / 1000 / WORLD_EVENT_TIME_SCALE;
    if (room.settings.mapId === "praia") {
      if (elapsed < 35) return null;
      const cycle = (elapsed - 35) % 105;
      if (cycle < 10) return { type: "tsunami", phase: "warning", progress: cycle / 10 };
      if (cycle < 22) return { type: "tsunami", phase: "surge", progress: (cycle - 10) / 12 };
      if (cycle < 37) return { type: "tsunami", phase: "flooded", progress: (cycle - 22) / 15 };
      if (cycle < 52) return { type: "tsunami", phase: "drain", progress: (cycle - 37) / 15 };
      return null;
    }
    if (room.settings.mapId === "floresta") {
      if (elapsed < 45) return null;
      const cycle = (elapsed - 45) % 120;
      if (cycle < 10) return { type: "tornado", phase: "warning", progress: cycle / 10 };
      if (cycle < 32) return { type: "tornado", phase: "active", progress: (cycle - 10) / 22 };
      if (cycle < 39) return { type: "tornado", phase: "recovery", progress: (cycle - 32) / 7 };
    }
    return null;
  }

  function applyWorldEventForces(room, event, now) {
    if (!event) return;
    if (event.type === "tsunami" && event.phase === "surge") {
      const half = MAP_HALF_SIZES.praia;
      const waveZ = half - (half * 2 - 8) * event.progress;
      room.players.forEach((player) => {
        if (!player.alive || now - player.lastWorldForceAt < 800 || Math.abs(player.z - waveZ) > 7) return;
        player.lastWorldForceAt = now;
        player.z = Math.max(-half + 2, player.z - 5);
        io.to(player.socketId).emit("world:force", { x: 0, y: 4.5, z: -13, fallDamage: 0 });
      });
      room.vehicles.forEach((vehicle) => {
        if (!vehicle.destroyed && Math.abs(vehicle.z - waveZ) < 8) vehicle.z -= 2.2;
      });
    }
    if (event.type === "tornado" && event.phase === "active") {
      const tornadoX = -70 + event.progress * 140;
      const tornadoZ = Math.sin(event.progress * Math.PI * 3) * 30;
      room.players.forEach((player) => {
        if (!player.alive || now - player.lastWorldForceAt < 1400) return;
        const distance = Math.hypot(player.x - tornadoX, player.z - tornadoZ);
        if (distance > 12) return;
        player.lastWorldForceAt = now;
        io.to(player.socketId).emit("world:force", {
          x: (tornadoX - player.x) * 0.8,
          y: 14,
          z: (tornadoZ - player.z) * 0.8,
          fallDamage: 5
        });
      });
      room.vehicles.forEach((vehicle) => {
        if (vehicle.destroyed || Math.hypot(vehicle.x - tornadoX, vehicle.z - tornadoZ) > 11) return;
        vehicle.y = Math.min(12, vehicle.y + 0.5);
        vehicle.yaw += 0.16;
      });
    }
  }

  function updateVehicles(room, delta, now) {
    const half = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
    room.vehicles.forEach((vehicle) => {
      if (vehicle.destroyed) return;
      const stats = VEHICLE_STATS[vehicle.type];
      const driver = room.players.find((player) => player.socketId === vehicle.driverId && player.alive);
      if (!driver && vehicle.driverId) vehicle.driverId = null;
      const input = driver ? vehicle.input : { throttle: 0, steer: 0, lift: 0 };

      if (vehicle.type === "cannon") {
        vehicle.yaw += input.steer * stats.turnSpeed * delta;
      } else {
        const targetSpeed = input.throttle * stats.maxSpeed;
        vehicle.speed = approach(vehicle.speed, targetSpeed, stats.acceleration * delta);
        if (!driver) vehicle.speed = approach(vehicle.speed, 0, stats.acceleration * 0.6 * delta);
        const steerStrength = Math.min(1, Math.abs(vehicle.speed) / Math.max(1, stats.maxSpeed * 0.35));
        vehicle.yaw += input.steer * stats.turnSpeed * steerStrength * delta * (vehicle.speed >= 0 ? 1 : -1);
        vehicle.x -= Math.sin(vehicle.yaw) * vehicle.speed * delta;
        vehicle.z -= Math.cos(vehicle.yaw) * vehicle.speed * delta;
      }

      if (vehicle.type === "plane") {
        vehicle.y = Math.max(3, Math.min(36, vehicle.y + input.lift * 12 * delta));
        if (driver && Math.abs(vehicle.speed) < 9) vehicle.speed = approach(vehicle.speed, 9, 8 * delta);
      } else if (vehicle.type === "jetski") {
        vehicle.y = 0.2;
      } else if (vehicle.type !== "cannon") {
        vehicle.y = Math.max(0, vehicle.y - 8 * delta);
      }

      vehicle.x = Math.max(-half + 3, Math.min(half - 3, vehicle.x));
      vehicle.z = Math.max(-half + 3, Math.min(half - 3, vehicle.z));
      if (vehicle.type === "jetski" && room.settings.mapId === "praia" && vehicle.z < 29) {
        vehicle.z = 29;
        vehicle.speed = Math.max(0, vehicle.speed * 0.45);
      }
      if (driver) {
        driver.x = vehicle.x;
        driver.y = vehicle.y;
        driver.z = vehicle.z;
        driver.yaw = vehicle.yaw;
      }

      if (Math.abs(vehicle.speed) > 7 && now % 250 < WORLD_TICK_MS) {
        room.players.forEach((target) => {
          if (!target.alive || target.socketId === vehicle.driverId || target.vehicleId) return;
          if (Math.hypot(target.x - vehicle.x, target.z - vehicle.z) > 2.4) return;
          const lastRam = vehicle.lastRamAt.get(target.socketId) || 0;
          if (now - lastRam < 1800) return;
          vehicle.lastRamAt.set(target.socketId, now);
          const driverPlayer = room.players.find((player) => player.socketId === vehicle.driverId) || null;
          applyDamage(room, driverPlayer, target, 9, false);
          io.to(target.socketId).emit("world:force", {
            x: -Math.sin(vehicle.yaw) * Math.abs(vehicle.speed) * 0.8,
            y: 9,
            z: -Math.cos(vehicle.yaw) * Math.abs(vehicle.speed) * 0.8,
            fallDamage: 6
          });
        });
      }
    });
  }

  function startWorldSystems(room) {
    if (room.worldTimer) clearInterval(room.worldTimer);
    room.startedAt = Date.now();
    room.vehicles = makeVehicles(room.settings.mapId);
    room.worldObjects = new Map();
    room.worldEvent = null;
    room.worldTick = 0;
    room.worldTimer = setInterval(() => {
      if (!rooms.has(room.roomId) || room.status !== "playing") return;
      const now = Date.now();
      const event = eventForRoom(room, now);
      room.worldEvent = event;
      updateVehicles(room, WORLD_TICK_MS / 1000, now);
      applyWorldEventForces(room, event, now);
      room.worldTick += 1;
      if (room.worldTick % 2 === 0) {
        io.to(room.roomId).volatile.emit("vehicle:state", room.vehicles.map(publicVehicle));
      }
      if (room.worldTick % 4 === 0) {
        io.to(room.roomId).emit("arena-world:event", event || { type: "none", phase: "idle", progress: 0 });
      }
    }, WORLD_TICK_MS);
  }

  function worldObjectMaxHealth(mapId, objectId) {
    if (mapId !== "cidade") return 0;
    if (/^city-lamp-\d+$/.test(objectId)) return 55;
    if (/^city-building-\d+-panel-\d+$/.test(objectId)) return 85;
    if (/^city-building-\d+-core$/.test(objectId)) return 280;
    if (/^city-barrier-\d+$/.test(objectId)) return 95;
    return 0;
  }

  function damageWorldObject(room, objectId, amount, position = {}) {
    const maxHealth = worldObjectMaxHealth(room.settings.mapId, objectId);
    if (!maxHealth) return;
    let object = room.worldObjects.get(objectId);
    if (!object) {
      object = {
        id: objectId, health: maxHealth, maxHealth,
        x: Number(position.x) || 0, z: Number(position.z) || 0
      };
      room.worldObjects.set(objectId, object);
    }
    object.health = Math.max(0, object.health - Math.max(0, Math.min(100, Number(amount) || 0)));
    const ratio = object.health / object.maxHealth;
    const state = {
      id: object.id,
      health: object.health,
      maxHealth: object.maxHealth,
      stage: ratio <= 0 ? 3 : ratio < 0.35 ? 2 : ratio < 0.7 ? 1 : 0,
      destroyed: object.health <= 0
    };
    io.to(room.roomId).emit("world:object-state", state);
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
    releaseVehicle(room, player, "disconnect");
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);

    room.players = room.players.filter((p) => p.socketId !== socketId);
    room.mapVotes?.delete(socketId);
    io.to(room.roomId).emit("room:player-left", { socketId, reason });

    if (!room.players.length) {
      if (room.timer) clearTimeout(room.timer);
      if (room.worldTimer) clearInterval(room.worldTimer);
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
        mapVotes: new Map(),
        vehicles: [],
        worldObjects: new Map(),
        worldEvent: null,
        worldTimer: null,
        timer: null,
        endsAt: null
      };
      const player = makePlayer(socket, classId);
      player.secondaryId = SECONDARY_WEAPONS[secondaryId] ? secondaryId : "pistol_common";
      room.players.push(player);
      room.mapVotes.set(socket.id, room.settings.mapId);
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
      room.mapVotes.set(socket.id, room.settings.mapId);
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

    socket.on("room:voteMap", ({ mapId } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "waiting" || !MAP_IDS.includes(mapId)) return;
      room.mapVotes.set(socket.id, mapId);
      emitRoomUpdate(room);
    });

    socket.on("player:setLoadout", ({ classId, secondaryId } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || room.status !== "playing" || !player || player.alive) return;
      if (classId) player.pendingClassId = normalizeClassId(classId);
      if (secondaryId && SECONDARY_WEAPONS[secondaryId]) player.pendingSecondaryId = secondaryId;
      socket.emit("player:loadoutPending", {
        classId: player.pendingClassId || player.classId,
        secondaryId: player.pendingSecondaryId || player.secondaryId
      });
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
      room.settings.mapId = selectVotedMap(room);
      if (!MAP_IDS.includes(room.settings.mapId)) room.settings.mapId = "praia";
      if (room.settings.mode === "teams") assignTeams(room);
      room.players.forEach((p) => {
        p.kills = 0; p.deaths = 0; p.score = 0;
        respawnPlayer(room, p, false);
      });
      room.status = "playing";
      room.endsAt = Date.now() + room.settings.durationMin * 60000;
      room.timer = setTimeout(() => endMatch(room, "time"), room.settings.durationMin * 60000);
      startWorldSystems(room);
      io.to(room.roomId).emit("match:start", serializeRoom(room));
      broadcastLobbyList();
    });

    socket.on("room:leave", () => removePlayer(socket.id, `${socket.username} saiu da sala.`));

    socket.on("vehicle:enter", ({ vehicleId } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((item) => item.socketId === socket.id);
      const vehicle = room.vehicles.find((item) => item.id === String(vehicleId || ""));
      if (!player || !player.alive || player.vehicleId || !vehicle || vehicle.destroyed || vehicle.driverId) return;
      const verticalDistance = Math.abs(player.y - vehicle.y);
      if (Math.hypot(player.x - vehicle.x, player.z - vehicle.z) > 4 || verticalDistance > 5) return;
      vehicle.driverId = socket.id;
      vehicle.input = { throttle: 0, steer: 0, lift: 0 };
      player.vehicleId = vehicle.id;
      if (player.emoteId) {
        player.emoteId = null;
        io.to(room.roomId).emit("match:emote-stop", { socketId: socket.id });
      }
      player.x = vehicle.x; player.y = vehicle.y; player.z = vehicle.z;
      player.moving = false; player.sprinting = false; player.jumping = false; player.crouching = false;
      io.to(room.roomId).emit("vehicle:occupied", { vehicleId: vehicle.id, driverId: socket.id });
      socket.emit("vehicle:entered", publicVehicle(vehicle));
    });

    socket.on("vehicle:exit", () => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (room && player) releaseVehicle(room, player);
    });

    socket.on("vehicle:input", (input = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      const vehicle = room?.vehicles.find((item) => item.id === player?.vehicleId && item.driverId === socket.id);
      if (!vehicle || vehicle.destroyed) return;
      const clampInput = (value) => Math.max(-1, Math.min(1, Number(value) || 0));
      vehicle.input = {
        throttle: clampInput(input.throttle),
        steer: clampInput(input.steer),
        lift: clampInput(input.lift)
      };
    });

    socket.on("vehicle:hit", ({ vehicleId, slot, pelletHits } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const attacker = room.players.find((item) => item.socketId === socket.id);
      const vehicle = room.vehicles.find((item) => item.id === String(vehicleId || ""));
      if (!attacker || !attacker.alive || !vehicle || vehicle.destroyed || vehicle.driverId === socket.id) return;
      const weapon = weaponFor(attacker, slot === "secondary" ? "secondary" : "primary");
      if (!weapon || distance3(attacker, vehicle) > weapon.range * RANGE_TOLERANCE + 5) return;
      const now = Date.now();
      if (now - attacker.lastEnvironmentHitAt < Math.max(55, weapon.fireRateMs * 0.7)) return;
      attacker.lastEnvironmentHitAt = now;
      const pellets = Math.max(1, Math.min(weapon.pellets || 1, Number(pelletHits) || 1));
      damageVehicle(room, vehicle, weapon.damage * pellets * 0.7, attacker);
    });

    socket.on("vehicle:fire", ({ vehicleId, targetSocketId, targetVehicleId, origin, direction } = {}) => {
      const room = findRoomBySocket(socket.id);
      const shooter = room?.players.find((item) => item.socketId === socket.id);
      const vehicle = room?.vehicles.find((item) => item.id === vehicleId && item.driverId === socket.id);
      if (!room || !shooter || !vehicle || vehicle.destroyed || !VEHICLE_STATS[vehicle.type]?.builtInWeapon) return;
      const now = Date.now();
      const cooldown = vehicle.type === "cannon" ? 2400 : 125;
      if (now - vehicle.lastFireAt < cooldown) return;
      vehicle.lastFireAt = now;
      const range = vehicle.type === "cannon" ? 140 : 120;
      const damage = vehicle.type === "cannon" ? 78 : 18;
      const target = room.players.find((item) => item.socketId === targetSocketId);
      if (target && target.alive && target.socketId !== shooter.socketId && distance3(vehicle, target) <= range) {
        applyDamage(room, shooter, target, damage, false);
      }
      const targetVehicle = room.vehicles.find((item) => item.id === targetVehicleId);
      if (targetVehicle && targetVehicle.id !== vehicle.id && distance3(vehicle, targetVehicle) <= range) {
        damageVehicle(room, targetVehicle, damage * 1.15, shooter);
      }
      io.to(room.roomId).emit("vehicle:fired", {
        vehicleId: vehicle.id,
        type: vehicle.type,
        origin: origin || { x: vehicle.x, y: vehicle.y + 1, z: vehicle.z },
        direction: direction || { x: 0, y: 0, z: -1 }
      });
    });

    socket.on("vehicle:launch-self", ({ vehicleId } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      const vehicle = room?.vehicles.find((item) => item.id === vehicleId && item.driverId === socket.id);
      if (!room || !player || !vehicle || vehicle.type !== "cannon") return;
      const yaw = vehicle.yaw;
      releaseVehicle(room, player, "launched");
      io.to(socket.id).emit("world:force", {
        x: -Math.sin(yaw) * 28,
        y: 22,
        z: -Math.cos(yaw) * 28,
        fallDamage: 8
      });
    });

    socket.on("world:hit", ({ id, damage, x, z } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || room.status !== "playing" || !player?.alive) return;
      if (Math.hypot(player.x - Number(x || 0), player.z - Number(z || 0)) > 145) return;
      damageWorldObject(room, String(id || ""), damage, { x, z });
    });

    socket.on("world:blast", ({ x, z, radius, damage } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const px = Number(x) || 0, pz = Number(z) || 0;
      const blastRadius = Math.max(1, Math.min(12, Number(radius) || 5));
      room.worldObjects.forEach((object) => {
        if (Math.hypot(object.x - px, object.z - pz) <= blastRadius) {
          damageWorldObject(room, object.id, Math.min(80, Number(damage) || 45), object);
        }
      });
    });

    socket.on("world:fall-damage", ({ damage } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || !player?.alive || player.vehicleId) return;
      applyDamage(room, null, player, Math.max(0, Math.min(10, Number(damage) || 0)), false);
    });

    socket.on("match:move", (state = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive || player.vehicleId) return;
      const mapHalf = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
      const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
      player.x = Math.max(-mapHalf, Math.min(mapHalf, num(state.x, player.x)));
      player.z = Math.max(-mapHalf, Math.min(mapHalf, num(state.z, player.z)));
      player.y = Math.max(0, Math.min(24, num(state.y, player.y)));
      player.yaw = num(state.yaw, player.yaw);
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, num(state.pitch, player.pitch)));
      player.moving = Boolean(state.moving);
      player.sprinting = Boolean(state.sprinting);
      player.jumping = Boolean(state.jumping);
      player.crouching = Boolean(state.crouching);
      if ((player.moving || player.jumping) && player.emoteId) {
        player.emoteId = null;
        io.to(room.roomId).emit("match:emote-stop", { socketId: socket.id });
      }
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

    socket.on("match:shoot", ({ slot, targetSocketId, hitZone, pelletHits, origin, direction, ballistics } = {}) => {
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
      if (now - (shooter.lastShotAt[slot] || 0) < fireRate * 0.88) return;

      shooter.lastShotAt[slot] = now;
      const fallbackOrigin = { x: shooter.x, y: shooter.y + 1.45, z: shooter.z };
      const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      let safeOrigin = {
        x: finite(origin?.x, fallbackOrigin.x),
        y: finite(origin?.y, fallbackOrigin.y),
        z: finite(origin?.z, fallbackOrigin.z)
      };
      if (distance3(safeOrigin, shooter) > 7) safeOrigin = fallbackOrigin;
      const safeDirection = {
        x: finite(direction?.x), y: finite(direction?.y), z: finite(direction?.z, -1)
      };
      const directionLength = Math.hypot(safeDirection.x, safeDirection.y, safeDirection.z) || 1;
      safeDirection.x /= directionLength;
      safeDirection.y /= directionLength;
      safeDirection.z /= directionLength;
      const safeBallistics = {
        speed: Math.max(30, Math.min(220, finite(ballistics?.speed, weapon.projectileSpeed || 95))),
        gravity: Math.max(-20, Math.min(0, finite(ballistics?.gravity, -9.8))),
        range: Math.max(2, Math.min(weapon.range, finite(ballistics?.range, weapon.range)))
      };
      socket.to(room.roomId).volatile.emit("match:shot-fired", {
        socketId: socket.id, slot, weaponId: weapon.id,
        origin: safeOrigin, direction: safeDirection, ballistics: safeBallistics
      });

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

    socket.on("match:emote", ({ emote } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((p) => p.socketId === socket.id);
      const profile = EMOTES[emote];
      if (!room || room.status !== "playing" || !player?.alive || player.vehicleId || !profile) return;
      const now = Date.now();
      if (now - player.lastEmoteAt < 1200) return;
      player.lastEmoteAt = now;
      player.emoteId = emote;
      io.to(room.roomId).emit("match:emote", { socketId: socket.id, emote, ...profile });
      setTimeout(() => {
        if (player.emoteId !== emote) return;
        player.emoteId = null;
        io.to(room.roomId).emit("match:emote-stop", { socketId: socket.id });
      }, profile.durationMs);
    });

    socket.on("match:emote-stop", () => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((p) => p.socketId === socket.id);
      if (!room || !player?.emoteId) return;
      player.emoteId = null;
      io.to(room.roomId).emit("match:emote-stop", { socketId: socket.id });
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
        room.vehicles.forEach((vehicle) => {
          const distance = Math.hypot(vehicle.x - point.x, vehicle.z - point.z);
          if (!vehicle.destroyed && distance <= grenade.radius + 2) {
            damageVehicle(room, vehicle, grenade.damage * Math.max(0.25, 1 - distance / (grenade.radius + 2)), thrower);
          }
        });
        room.worldObjects.forEach((object) => {
          if (Math.hypot(object.x - point.x, object.z - point.z) <= grenade.radius + 2) {
            damageWorldObject(room, object.id, grenade.damage, object);
          }
        });
      }

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
