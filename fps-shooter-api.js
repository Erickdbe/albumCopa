"use strict";

const MAX_PLAYERS = 10;
const RESPAWN_MS = 3000;
const ARENA_HALF = 34;

const WEAPON_IDS = ["pistol", "rifle", "smg", "shotgun", "sniper"];

const WEAPONS = {
  pistol: {
    id: "pistol", name: "Pistola", category: "Secundaria",
    damage: 24, fireRateMs: 250, magSize: 12, reloadMs: 1100,
    spread: 0.01, pellets: 1, range: 60, speedMul: 1.05
  },
  rifle: {
    id: "rifle", name: "Rifle de Assalto", category: "Automatica",
    damage: 19, fireRateMs: 110, magSize: 30, reloadMs: 1700,
    spread: 0.02, pellets: 1, range: 70, speedMul: 1
  },
  smg: {
    id: "smg", name: "Submetralhadora", category: "Automatica",
    damage: 13, fireRateMs: 80, magSize: 35, reloadMs: 1500,
    spread: 0.035, pellets: 1, range: 45, speedMul: 1.12
  },
  shotgun: {
    id: "shotgun", name: "Escopeta", category: "Curta distancia",
    damage: 16, fireRateMs: 700, magSize: 6, reloadMs: 2200,
    spread: 0.09, pellets: 6, range: 22, speedMul: 0.95
  },
  sniper: {
    id: "sniper", name: "Sniper", category: "Precisao",
    damage: 95, fireRateMs: 1250, magSize: 5, reloadMs: 2400,
    spread: 0.002, pellets: 1, range: 120, speedMul: 0.9
  }
};

const SPAWN_POINTS = [
  { x: -24, y: 0, z: -24, yaw: 0.78 },
  { x: 24, y: 0, z: -24, yaw: -0.78 },
  { x: -24, y: 0, z: 24, yaw: 2.35 },
  { x: 24, y: 0, z: 24, yaw: -2.35 },
  { x: 0, y: 0, z: -28, yaw: 0 },
  { x: 0, y: 0, z: 28, yaw: Math.PI },
  { x: -28, y: 0, z: 0, yaw: Math.PI / 2 },
  { x: 28, y: 0, z: 0, yaw: -Math.PI / 2 }
];

function normalizeWeaponId(value) {
  return WEAPON_IDS.includes(value) ? value : "rifle";
}

function pickSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function damageFalloff(weapon, distance) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : weapon.range;
  const factor = 1 - Math.min(1, d / weapon.range) * 0.4;
  return Math.max(0.6, factor);
}

function setupFpsShooter(options) {
  const { io, db, rooms, onlinePlayers, broadcastOnlineList } = options;

  function makePlayer(socket, weaponId) {
    const spawn = pickSpawn();
    const weapon = normalizeWeaponId(weaponId);
    return {
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
      avatar: socket.avatar || "",
      x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, pitch: 0,
      moving: false, sprinting: false, jumping: false, crouching: false,
      health: 100,
      alive: true,
      kills: 0,
      deaths: 0,
      weaponId: weapon,
      ammo: WEAPONS[weapon].magSize,
      lastShotAt: 0,
      reloadUntil: 0,
      respawnTimer: null,
      disconnected: false
    };
  }

  function serializePlayer(player) {
    return {
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar,
      x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
      moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching,
      health: player.health,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      weaponId: player.weaponId
    };
  }

  function serializeRoom(room) {
    return {
      roomId: room.roomId,
      map: { id: "arena-alfa", spawnPoints: SPAWN_POINTS },
      weapons: WEAPONS,
      players: room.players.filter(p => !p.disconnected).map(serializePlayer)
    };
  }

  function findRoomBySocket(socketId) {
    for (const room of rooms.values()) {
      if (room.players.some(player => player.socketId === socketId)) return room;
    }
    return null;
  }

  function findOpenRoom() {
    for (const room of rooms.values()) {
      const activeCount = room.players.filter(p => !p.disconnected).length;
      if (activeCount < MAX_PLAYERS) return room;
    }
    return null;
  }

  function setOnline(socketId, roomId) {
    const online = onlinePlayers.get(socketId);
    if (online) {
      online.inGame = true;
      online.roomId = roomId;
      online.game = "fps";
    }
  }

  function clearOnline(socketId) {
    const online = onlinePlayers.get(socketId);
    if (online && online.game === "fps") {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
  }

  function scheduleRespawn(room, player) {
    if (player.respawnTimer) clearTimeout(player.respawnTimer);
    player.respawnTimer = setTimeout(() => {
      if (player.disconnected) return;
      const spawn = pickSpawn();
      player.x = spawn.x; player.y = spawn.y; player.z = spawn.z; player.yaw = spawn.yaw; player.pitch = 0;
      player.health = 100;
      player.alive = true;
      player.ammo = WEAPONS[player.weaponId].magSize;
      player.reloadUntil = 0;
      io.to(room.roomId).emit("fps:respawn", {
        socketId: player.socketId, x: player.x, y: player.y, z: player.z, yaw: player.yaw, health: player.health
      });
    }, RESPAWN_MS);
  }

  function removePlayer(socketId, reason = "") {
    const room = findRoomBySocket(socketId);
    if (!room) return;
    const player = room.players.find(item => item.socketId === socketId);
    if (!player) return;
    if (player.respawnTimer) clearTimeout(player.respawnTimer);
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
    clearOnline(socketId);
    room.players = room.players.filter(item => item.socketId !== socketId);
    io.to(room.roomId).emit("fps:player-left", { socketId, reason });
    if (!room.players.length) {
      rooms.delete(room.roomId);
    }
    broadcastOnlineList();
  }

  function bindSocket(socket) {
    socket.on("fps:quickplay", ({ weaponId } = {}) => {
      const online = onlinePlayers.get(socket.id);
      if (online?.inGame) return socket.emit("fps:error", "Voce ja esta em uma partida.");

      let room = findOpenRoom();
      if (!room) {
        room = { roomId: `fps-${Date.now()}-${socket.id}`, players: [] };
        rooms.set(room.roomId, room);
      }

      const player = makePlayer(socket, weaponId);
      room.players.push(player);
      socket.join(room.roomId);
      setOnline(socket.id, room.roomId);

      socket.emit("fps:joined", { ...serializeRoom(room), selfId: socket.id });
      socket.to(room.roomId).emit("fps:player-joined", serializePlayer(player));
      broadcastOnlineList();
    });

    socket.on("fps:move", (state = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const player = room.players.find(item => item.socketId === socket.id);
      if (!player || !player.alive) return;

      const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      player.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, num(state.x, player.x)));
      player.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, num(state.z, player.z)));
      player.y = Math.max(0, Math.min(20, num(state.y, player.y)));
      player.yaw = num(state.yaw, player.yaw);
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, num(state.pitch, player.pitch)));
      player.moving = Boolean(state.moving);
      player.sprinting = Boolean(state.sprinting);
      player.jumping = Boolean(state.jumping);
      player.crouching = Boolean(state.crouching);

      socket.to(room.roomId).volatile.emit("fps:player-move", {
        socketId: socket.id,
        x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
        moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching
      });
    });

    socket.on("fps:shoot", ({ targetSocketId, distance, pelletHits } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const shooter = room.players.find(item => item.socketId === socket.id);
      if (!shooter || !shooter.alive) return;

      const weapon = WEAPONS[shooter.weaponId];
      const now = Date.now();
      if (now < shooter.reloadUntil) return;
      if (now - shooter.lastShotAt < weapon.fireRateMs) return;
      if (shooter.ammo <= 0) return;

      shooter.lastShotAt = now;
      shooter.ammo -= 1;
      socket.to(room.roomId).volatile.emit("fps:shot-fired", { socketId: socket.id, weaponId: shooter.weaponId });
      socket.emit("fps:ammo", { ammo: shooter.ammo });

      if (!targetSocketId) return;
      const target = room.players.find(item => item.socketId === targetSocketId);
      if (!target || target.socketId === shooter.socketId || !target.alive) return;

      const falloff = damageFalloff(weapon, distance);
      const hits = Math.max(1, Math.min(weapon.pellets, Number(pelletHits) || 1));
      const damage = Math.round(weapon.damage * falloff * hits);
      target.health = Math.max(0, target.health - damage);

      if (target.health <= 0) {
        target.alive = false;
        target.deaths += 1;
        shooter.kills += 1;
        io.to(room.roomId).emit("fps:kill", {
          killerId: shooter.socketId, killerName: shooter.username,
          victimId: target.socketId, victimName: target.username,
          weaponId: shooter.weaponId
        });
        scheduleRespawn(room, target);
      } else {
        io.to(room.roomId).emit("fps:damage", { targetSocketId: target.socketId, health: target.health, byId: shooter.socketId });
      }
    });

    socket.on("fps:reload", () => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const player = room.players.find(item => item.socketId === socket.id);
      if (!player || !player.alive) return;
      const weapon = WEAPONS[player.weaponId];
      player.reloadUntil = Date.now() + weapon.reloadMs;
      player.ammo = weapon.magSize;
      setTimeout(() => {
        socket.emit("fps:ammo", { ammo: player.ammo });
      }, weapon.reloadMs);
    });

    socket.on("fps:switch-weapon", ({ weaponId } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const player = room.players.find(item => item.socketId === socket.id);
      if (!player) return;
      player.weaponId = normalizeWeaponId(weaponId);
      player.ammo = WEAPONS[player.weaponId].magSize;
      player.reloadUntil = 0;
      socket.to(room.roomId).emit("fps:player-weapon", { socketId: socket.id, weaponId: player.weaponId });
      socket.emit("fps:ammo", { ammo: player.ammo });
    });

    socket.on("fps:leave", () => removePlayer(socket.id, `${socket.username} saiu da arena.`));
  }

  return {
    bindSocket,
    removePlayer,
    findRoomBySocket,
    weapons: WEAPONS,
    weaponIds: WEAPON_IDS
  };
}

module.exports = { setupFpsShooter };
