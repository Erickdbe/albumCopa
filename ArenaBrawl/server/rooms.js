"use strict";

const {
  CLASSES, CLASS_IDS,
  SECONDARY_WEAPONS,
  GRENADES,
  MAP_IDS,
  ARENA_HALF,
  MAP_HALF_SIZES,
  VEHICLE_SPAWNS,
  VEHICLE_STATS,
  SKETCHBOOK_GROUND_Y,
  constrainMapPosition,
  normalizeSettings,
  pickSpawn,
  HEADSHOT_MULTIPLIER,
  INSTANT_KILL_HEADSHOT_WEAPONS
} = require("./config");

const RESPAWN_MS = 3500;
const RANGE_TOLERANCE = 1.15;
const WORLD_TICK_MS = 50;
const WORLD_EVENT_TIME_SCALE = Math.max(0.02, Number(process.env.ARENA_EVENT_TIME_SCALE) || 1);
const EMOTES = {
  dance: { animation: "dance", speed: 1, durationMs: 6200 },
  dance_fast: { animation: "dance_fast", speed: 1.35, durationMs: 4800 },
  dance_slow: { animation: "dance_slow", speed: 0.72, durationMs: 7600 }
};
const EMPTY_SLOT = "hands";
const SURVIVAL_PICKUP_RADIUS = 3.2;
const ZOMBIE_ATTACK_RADIUS = 1.12;
const ZOMBIE_ATTACK_MS = 1250;
const ZOMBIE_CHASE_RADIUS = { mundo: 170, alagado: 190, default: 145 };
const ZOMBIE_ROAM_RADIUS = { mundo: 54, alagado: 42, default: 36 };
const ZOMBIE_ROAM_SPEED = {
  basic: 1.05,
  ribcage: 1.18,
  chubby: 0.88,
  runner: 1.38,
  stalker: 1.28,
  brute: 0.94,
  drowned: 1.08
};
const ZOMBIE_KIND_STATS = {
  basic: { health: 115, waveBoost: 11, chaseSpeed: 2.55 },
  ribcage: { health: 95, waveBoost: 11, chaseSpeed: 2.9 },
  chubby: { health: 155, waveBoost: 18, chaseSpeed: 2.0 },
  runner: { health: 86, waveBoost: 9, chaseSpeed: 3.28 },
  stalker: { health: 105, waveBoost: 12, chaseSpeed: 3.0 },
  brute: { health: 188, waveBoost: 20, chaseSpeed: 2.18 },
  drowned: { health: 126, waveBoost: 12, chaseSpeed: 2.48 }
};
const MEDKIT_HEAL = 38;
const MEDKIT_MAX = 5;
const SURVIVAL_LOOT_CLEANUP_MS = 45000;
const SURVIVAL_LOOT_LIMITS = {
  mundo: { initialExtra: 30, maxActive: 58, maxWeapons: 32, respawnMs: 1150 },
  alagado: { initialExtra: 42, maxActive: 78, maxWeapons: 44, respawnMs: 950 },
  default: { initialExtra: 18, maxActive: 42, maxWeapons: 22, respawnMs: 1500 }
};
const PRIMARY_CLASS_BY_WEAPON_ID = Object.fromEntries(Object.values(CLASSES).map((classInfo) => [classInfo.primary.id, classInfo.id]));
const SURVIVAL_LOOT_SPAWNS = {
  mundo: [
    { id: "loot-rifle-city-edge", kind: "weapon", slot: "primary", weaponId: "assault_rifle", ammo: 28, x: -73, y: 0.2, z: 41 },
    { id: "loot-smg-forest-camp", kind: "weapon", slot: "primary", weaponId: "smg", ammo: 32, x: 52, y: 1.6, z: -24 },
    { id: "loot-sniper-ridge", kind: "weapon", slot: "primary", weaponId: "sniper_rifle", ammo: 5, x: 178, y: 4.2, z: -137 },
    { id: "loot-pistol-lake", kind: "weapon", slot: "secondary", weaponId: "pistol_common", ammo: 10, x: 104, y: 0.7, z: -38 },
    { id: "loot-revolver-road", kind: "weapon", slot: "secondary", weaponId: "revolver", ammo: 6, x: -189, y: 0.2, z: -69 },
    { id: "loot-primary-ammo-town", kind: "ammo", slot: "primary", ammo: 28, x: -218, y: 0.2, z: -176 },
    { id: "loot-primary-ammo-forest", kind: "ammo", slot: "primary", ammo: 32, x: 138, y: 2.1, z: 28 },
    { id: "loot-secondary-ammo-bridge", kind: "ammo", slot: "secondary", ammo: 12, x: 71, y: 0.6, z: 87 },
    { id: "loot-flash-shed", kind: "grenade", grenadeId: "flash", charges: 1, x: -47, y: 0.2, z: -226 },
    { id: "loot-molotov-woods", kind: "grenade", grenadeId: "molotov", charges: 1, x: 214, y: 3.4, z: -61 },
    { id: "loot-gas-city", kind: "fuel", amount: 35, x: -238, y: 0.2, z: 71 },
    { id: "loot-gas-forest", kind: "fuel", amount: 35, x: 91, y: 0.8, z: 69 }
  ],
  alagado: [
    { id: "flooded-loot-pistol-gate", kind: "weapon", slot: "secondary", weaponId: "pistol_common", ammo: 10, x: -22, y: 0.2, z: -166 },
    { id: "flooded-loot-rifle-village", kind: "weapon", slot: "primary", weaponId: "assault_rifle", ammo: 28, x: -106, y: 0.2, z: -84 },
    { id: "flooded-loot-smg-cabin", kind: "weapon", slot: "primary", weaponId: "smg", ammo: 32, x: 36, y: 0.2, z: -64 },
    { id: "flooded-loot-revolver-church", kind: "weapon", slot: "secondary", weaponId: "revolver", ammo: 6, x: -118, y: 0.2, z: 62 },
    { id: "flooded-loot-shotgun-greenhouse", kind: "weapon", slot: "secondary", weaponId: "mini_shotgun", ammo: 4, x: 126, y: 0.2, z: -82 },
    { id: "flooded-loot-sniper-mansion", kind: "weapon", slot: "primary", weaponId: "sniper_rifle", ammo: 5, x: 62, y: 0.2, z: 32 },
    { id: "flooded-loot-knife-pier", kind: "weapon", slot: "secondary", weaponId: "knife", ammo: 1, x: 108, y: 0.2, z: 82 },
    { id: "flooded-loot-primary-ammo-road", kind: "ammo", slot: "primary", ammo: 28, x: -6, y: 0.2, z: -126 },
    { id: "flooded-loot-primary-ammo-mansion", kind: "ammo", slot: "primary", ammo: 32, x: 42, y: 0.2, z: 52 },
    { id: "flooded-loot-primary-ammo-forest", kind: "ammo", slot: "primary", ammo: 28, x: -154, y: 0.2, z: 132 },
    { id: "flooded-loot-secondary-ammo-greenhouse", kind: "ammo", slot: "secondary", ammo: 12, x: 116, y: 0.2, z: -54 },
    { id: "flooded-loot-secondary-ammo-church", kind: "ammo", slot: "secondary", ammo: 10, x: -136, y: 0.2, z: 92 },
    { id: "flooded-loot-medkit-start", kind: "medkit", amount: 1, x: 18, y: 0.2, z: -156 },
    { id: "flooded-loot-medkit-cabin", kind: "medkit", amount: 1, x: 74, y: 0.2, z: -20 },
    { id: "flooded-loot-medkit-church", kind: "medkit", amount: 1, x: -108, y: 0.2, z: 108 },
    { id: "flooded-loot-medkit-mansion", kind: "medkit", amount: 1, x: 72, y: 0.2, z: 48 },
    { id: "flooded-loot-gas-gate", kind: "fuel", amount: 34, x: -16, y: 0.2, z: -144 },
    { id: "flooded-loot-gas-greenhouse", kind: "fuel", amount: 42, x: 104, y: 0.2, z: -44 },
    { id: "flooded-loot-gas-dock", kind: "fuel", amount: 30, x: 112, y: 0.2, z: 96 },
    { id: "flooded-loot-flash-village", kind: "grenade", grenadeId: "flash", charges: 1, x: -72, y: 0.2, z: -44 },
    { id: "flooded-loot-molotov-mansion", kind: "grenade", grenadeId: "molotov", charges: 1, x: 38, y: 0.2, z: 18 },
    { id: "flooded-loot-impact-swamp", kind: "grenade", grenadeId: "impact", charges: 1, x: 148, y: 0.2, z: 24 }
  ]
};
const SURVIVAL_ZOMBIE_SPAWNS = {
  mundo: [
    { id: "zombie-forest-01", kind: "basic", x: 88, y: 1.1, z: -78, yaw: 0.2 },
    { id: "zombie-forest-02", kind: "ribcage", x: 128, y: 1.7, z: -18, yaw: -0.8 },
    { id: "zombie-forest-03", kind: "chubby", x: 214, y: 3.8, z: -112, yaw: 1.4 },
    { id: "zombie-forest-04", kind: "runner", x: 104, y: 1.2, z: -126, yaw: -0.3 },
    { id: "zombie-forest-05", kind: "stalker", x: 184, y: 2.4, z: -66, yaw: 0.9 },
    { id: "zombie-lake-01", kind: "basic", x: 154, y: 0.8, z: -42, yaw: -2.1 },
    { id: "zombie-lake-02", kind: "drowned", x: 112, y: 0.8, z: 12, yaw: 2.1 },
    { id: "zombie-city-01", kind: "ribcage", x: -143, y: 0.2, z: -198, yaw: 0.4 },
    { id: "zombie-city-02", kind: "basic", x: -231, y: 0.2, z: -105, yaw: -1.2 },
    { id: "zombie-city-03", kind: "runner", x: -182, y: 0.2, z: -156, yaw: 1.9 },
    { id: "zombie-city-04", kind: "brute", x: -264, y: 0.2, z: -162, yaw: -2.4 },
    { id: "zombie-road-01", kind: "chubby", x: -54, y: 0.2, z: -112, yaw: 2.4 },
    { id: "zombie-road-02", kind: "stalker", x: -12, y: 0.2, z: -68, yaw: -0.7 },
    { id: "zombie-beach-01", kind: "basic", x: 43, y: 0.4, z: 154, yaw: Math.PI },
    { id: "zombie-beach-02", kind: "drowned", x: -28, y: 0.4, z: 188, yaw: 2.6 },
    { id: "zombie-beach-03", kind: "runner", x: 96, y: 0.4, z: 206, yaw: -2.2 }
  ],
  alagado: [
    { id: "flooded-zombie-road-01", kind: "basic", x: -20, y: 0.2, z: -124, yaw: 0.4 },
    { id: "flooded-zombie-road-02", kind: "ribcage", x: 22, y: 0.2, z: -116, yaw: -0.6 },
    { id: "flooded-zombie-road-03", kind: "runner", x: -44, y: 0.2, z: -146, yaw: 0.9 },
    { id: "flooded-zombie-road-04", kind: "drowned", x: 46, y: 0.2, z: -142, yaw: -1.3 },
    { id: "flooded-zombie-village-01", kind: "basic", x: -58, y: 0.2, z: -92, yaw: 1.2 },
    { id: "flooded-zombie-village-02", kind: "chubby", x: 28, y: 0.2, z: -86, yaw: -1.8 },
    { id: "flooded-zombie-village-03", kind: "ribcage", x: 78, y: 0.2, z: -98, yaw: 0.8 },
    { id: "flooded-zombie-village-04", kind: "runner", x: -84, y: 0.2, z: -54, yaw: 2.2 },
    { id: "flooded-zombie-village-05", kind: "stalker", x: 8, y: 0.2, z: -42, yaw: -2.5 },
    { id: "flooded-zombie-mansion-01", kind: "basic", x: 42, y: 0.2, z: 18, yaw: 2.4 },
    { id: "flooded-zombie-mansion-02", kind: "chubby", x: 82, y: 0.2, z: 64, yaw: -2.2 },
    { id: "flooded-zombie-mansion-03", kind: "brute", x: 18, y: 0.2, z: 54, yaw: 1.1 },
    { id: "flooded-zombie-mansion-04", kind: "stalker", x: 104, y: 0.2, z: 22, yaw: -0.9 },
    { id: "flooded-zombie-church-01", kind: "ribcage", x: -106, y: 0.2, z: 66, yaw: 1.7 },
    { id: "flooded-zombie-church-02", kind: "basic", x: -146, y: 0.2, z: 112, yaw: -2.8 },
    { id: "flooded-zombie-church-03", kind: "stalker", x: -118, y: 0.2, z: 134, yaw: 0.6 },
    { id: "flooded-zombie-greenhouse-01", kind: "basic", x: 128, y: 0.2, z: -58, yaw: -0.3 },
    { id: "flooded-zombie-greenhouse-02", kind: "basic", x: 156, y: 0.2, z: -88, yaw: 0.7 },
    { id: "flooded-zombie-greenhouse-03", kind: "runner", x: 176, y: 0.2, z: -38, yaw: -1.6 },
    { id: "flooded-zombie-swamp-01", kind: "basic", x: 112, y: 0.2, z: 88, yaw: -2.5 },
    { id: "flooded-zombie-swamp-02", kind: "chubby", x: 162, y: 0.2, z: 44, yaw: 2.2 },
    { id: "flooded-zombie-swamp-03", kind: "drowned", x: 146, y: 0.2, z: 112, yaw: -0.4 },
    { id: "flooded-zombie-swamp-04", kind: "drowned", x: 94, y: 0.2, z: 132, yaw: 2.8 },
    { id: "flooded-zombie-forest-01", kind: "basic", x: -176, y: 0.2, z: 22, yaw: 1.1 },
    { id: "flooded-zombie-forest-02", kind: "ribcage", x: -162, y: 0.2, z: 152, yaw: -1.4 },
    { id: "flooded-zombie-forest-03", kind: "runner", x: -196, y: 0.2, z: 92, yaw: 0.2 },
    { id: "flooded-zombie-forest-04", kind: "brute", x: -132, y: 0.2, z: 18, yaw: -2.1 }
  ]
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function lerp(value, target, amount) {
  return value + (target - value) * Math.max(0, Math.min(1, amount));
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
      input: { throttle: 0, steer: 0, lift: 0, pitch: 0, roll: 0, yaw: 0, brake: 0 },
      pitch: 0,
      roll: 0,
      steering: 0,
      enginePower: 0,
      verticalVelocity: 0,
      grounded: spawn.type !== "plane" && spawn.type !== "helicopter",
      groundY: spawn.y,
      lastGroundY: spawn.y,
      lastSpeed: 0,
      lastFireAt: 0,
      lastBombAt: 0,
      bombReadyAt: 0,
      lastRamAt: new Map()
    };
  });
}

function publicVehicle(vehicle) {
  return {
    id: vehicle.id, type: vehicle.type,
    x: vehicle.x, y: vehicle.y, z: vehicle.z, yaw: vehicle.yaw,
    pitch: vehicle.pitch || 0, roll: vehicle.roll || 0, enginePower: vehicle.enginePower || 0,
    speed: vehicle.speed, health: vehicle.health, maxHealth: vehicle.maxHealth,
    driverId: vehicle.driverId, destroyed: vehicle.destroyed,
    grounded: vehicle.grounded !== false, bombReadyAt: vehicle.bombReadyAt || 0
  };
}

function normalizeWeaponSlot(slot) {
  if (slot === "primary" || slot === "secondary") return slot;
  return EMPTY_SLOT;
}

function makeEmptyGrenades() {
  return Object.fromEntries(Object.keys(GRENADES).map((id) => [id, 0]));
}

function publicInventory(player) {
  return {
    primary: Boolean(player.inventory?.primary),
    secondary: Boolean(player.inventory?.secondary),
    grenades: { ...(player.grenadeCharges || {}) },
    fuel: Math.max(0, Math.round(Number(player.inventory?.fuel) || 0)),
    medkits: Math.max(0, Math.round(Number(player.inventory?.medkits) || 0))
  };
}

function publicAmmo(player) {
  return {
    primary: Math.max(0, Math.round(Number(player.ammo?.primary) || 0)),
    secondary: Math.max(0, Math.round(Number(player.ammo?.secondary) || 0))
  };
}

function publicLoot(loot) {
  return {
    id: loot.id,
    kind: loot.kind,
    slot: loot.slot || null,
    weaponId: loot.weaponId || null,
    grenadeId: loot.grenadeId || null,
    ammo: loot.ammo || 0,
    charges: loot.charges || 0,
    amount: loot.amount || 0,
    heal: loot.heal || 0,
    x: loot.x, y: loot.y, z: loot.z,
    active: loot.active !== false
  };
}

function publicZombie(zombie) {
  return {
    id: zombie.id,
    kind: zombie.kind || "basic",
    x: zombie.x, y: zombie.y, z: zombie.z,
    yaw: zombie.yaw || 0,
    health: zombie.health,
    maxHealth: zombie.maxHealth,
    alive: zombie.alive !== false,
    speedMul: zombie.speedMul || 1,
    moving: Boolean(zombie.moving)
  };
}

function makeSurvivalLoot(mapId) {
  return (SURVIVAL_LOOT_SPAWNS[mapId] || []).map((loot, index) => ({
    ...loot,
    id: loot.id || `${mapId}-loot-${index}`,
    active: true
  }));
}

function survivalLootConfig(mapId) {
  return SURVIVAL_LOOT_LIMITS[mapId] || SURVIVAL_LOOT_LIMITS.default;
}

function activeSurvivalLoot(room) {
  return (room.survivalLoot || []).filter((loot) => loot.active !== false);
}

function pickDynamicLootTemplate(mapId, activeWeaponCount, config, forceWeapon = false) {
  const templates = SURVIVAL_LOOT_SPAWNS[mapId] || [];
  if (!templates.length) return null;
  const weapons = templates.filter((loot) => loot.kind === "weapon");
  const support = templates.filter((loot) => loot.kind !== "weapon");
  const weaponFloor = Math.ceil(config.maxWeapons * 0.72);
  const shouldSpawnWeapon = weapons.length
    && activeWeaponCount < config.maxWeapons
    && (forceWeapon || activeWeaponCount < weaponFloor || Math.random() < 0.72);
  const pool = shouldSpawnWeapon ? weapons : (support.length ? support : weapons);
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function randomLootPosition(room, template) {
  const mapId = room.settings.mapId;
  const anchors = [
    ...(SURVIVAL_LOOT_SPAWNS[mapId] || []),
    ...(SURVIVAL_ZOMBIE_SPAWNS[mapId] || [])
  ];
  const half = MAP_HALF_SIZES[mapId] || ARENA_HALF;
  const existing = activeSurvivalLoot(room);
  const minPlayerDistance = mapId === "alagado" ? 16 : 18;
  const minLootDistance = mapId === "alagado" ? 5.4 : 6.8;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const anchor = anchors[Math.floor(Math.random() * anchors.length)] || template || { x: 0, y: 0.2, z: 0 };
    const angle = Math.random() * Math.PI * 2;
    const radius = 5 + Math.random() * (mapId === "alagado" ? 34 : 44);
    const x = clamp((Number(anchor.x) || 0) + Math.cos(angle) * radius, -half + 8, half - 8);
    const z = clamp((Number(anchor.z) || 0) + Math.sin(angle) * radius, -half + 8, half - 8);
    const constrained = constrainMapPosition(mapId, {
      x,
      y: Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : Number(template?.y) || 0.2,
      z
    });
    const tooCloseToPlayer = room.players.some((player) => (
      player.alive && Math.hypot(player.x - constrained.x, player.z - constrained.z) < minPlayerDistance
    ));
    if (tooCloseToPlayer) continue;
    const tooCloseToLoot = existing.some((loot) => Math.hypot(loot.x - constrained.x, loot.z - constrained.z) < minLootDistance);
    if (tooCloseToLoot) continue;
    return {
      x: constrained.x,
      y: Number.isFinite(Number(constrained.y)) ? Number(constrained.y) : Number(template?.y) || 0.2,
      z: constrained.z
    };
  }
  return null;
}

function spawnDynamicSurvivalLoot(room, now, forceWeapon = false) {
  const config = survivalLootConfig(room.settings.mapId);
  const activeLoot = activeSurvivalLoot(room);
  if (activeLoot.length >= config.maxActive) return false;
  const activeWeaponCount = activeLoot.filter((loot) => loot.kind === "weapon").length;
  const template = pickDynamicLootTemplate(room.settings.mapId, activeWeaponCount, config, forceWeapon);
  if (!template) return false;
  const position = randomLootPosition(room, template);
  if (!position) return false;
  room.lootSerial = (room.lootSerial || 0) + 1;
  room.survivalLoot.push({
    ...template,
    id: `${room.settings.mapId}-loot-random-${room.lootSerial}`,
    x: position.x,
    y: position.y,
    z: position.z,
    active: true,
    dynamic: true,
    spawnedAt: now
  });
  return true;
}

function seedExtraSurvivalLoot(room, now) {
  const config = survivalLootConfig(room.settings.mapId);
  for (let i = 0; i < config.initialExtra; i += 1) {
    spawnDynamicSurvivalLoot(room, now, i % 4 !== 3);
  }
  room.nextLootSpawnAt = now + Math.round(config.respawnMs * 0.75);
}

function updateSurvivalLootSpawns(room, now) {
  const config = survivalLootConfig(room.settings.mapId);
  room.survivalLoot = (room.survivalLoot || []).filter((loot) => (
    loot.active !== false || now - (loot.pickedAt || now) < SURVIVAL_LOOT_CLEANUP_MS
  ));
  if (activeSurvivalLoot(room).length >= config.maxActive) return false;
  if (!room.nextLootSpawnAt) room.nextLootSpawnAt = now + config.respawnMs;
  if (now < room.nextLootSpawnAt) return false;
  const spawned = spawnDynamicSurvivalLoot(room, now);
  const variance = 0.72 + Math.random() * 0.56;
  room.nextLootSpawnAt = now + Math.round((spawned ? config.respawnMs : 1200) * variance);
  return spawned;
}

function makeZombies(mapId) {
  const initialLimit = mapId === "alagado" ? 22 : 14;
  return (SURVIVAL_ZOMBIE_SPAWNS[mapId] || []).slice(0, initialLimit).map((zombie, index) => ({
    ...zombie,
    id: zombie.id || `${mapId}-zombie-${index}`,
    homeX: zombie.x,
    homeZ: zombie.z,
    ...zombieStats(zombie.kind, 1),
    alive: true,
    targetId: null,
    lastAttackAt: 0,
    roamTarget: null,
    nextRoamAt: 0,
    spawnSpeedMul: 1,
    speedMul: 1
  }));
}

function zombieStats(kind, wave = 1) {
  const stats = ZOMBIE_KIND_STATS[kind] || ZOMBIE_KIND_STATS.basic;
  const waveBoost = Math.max(0, wave - 1);
  return {
    health: Math.round(stats.health + waveBoost * stats.waveBoost),
    maxHealth: Math.round(stats.health + waveBoost * stats.waveBoost)
  };
}

function zombieKindStats(kind) {
  return ZOMBIE_KIND_STATS[kind] || ZOMBIE_KIND_STATS.basic;
}

function canSpawnZombieAt(room, spawn) {
  return room.players.every((player) => {
    if (!player.alive) return true;
    const dx = spawn.x - player.x;
    const dz = spawn.z - player.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 24) return false;
    const forwardX = -Math.sin(player.yaw || 0);
    const forwardZ = -Math.cos(player.yaw || 0);
    const dot = distance > 0 ? (dx / distance) * forwardX + (dz / distance) * forwardZ : 1;
    return !(distance < 54 && dot > 0.56);
  });
}

function spawnProgressiveZombie(room, now) {
  const pool = SURVIVAL_ZOMBIE_SPAWNS[room.settings.mapId] || [];
  if (!pool.length) return false;
  room.zombieSerial = (room.zombieSerial || 0) + 1;
  const start = room.zombieSerial % pool.length;
  let chosen = null;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length];
    if (canSpawnZombieAt(room, candidate)) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) return false;
  const wave = Math.max(1, room.survivalWave || 1);
  const stats = zombieStats(chosen.kind, wave);
  room.zombies.push({
    ...chosen,
    ...stats,
    id: `${room.settings.mapId}-zombie-wave-${wave}-${room.zombieSerial}`,
    homeX: chosen.x,
    homeZ: chosen.z,
    alive: true,
    targetId: null,
    lastAttackAt: 0,
    roamTarget: null,
    nextRoamAt: 0,
    spawnSpeedMul: 1 + Math.min(0.48, (wave - 1) * 0.045),
    speedMul: 1,
    spawnedAt: now
  });
  return true;
}

function updateZombieSpawns(room, now) {
  const pool = SURVIVAL_ZOMBIE_SPAWNS[room.settings.mapId] || [];
  if (!pool.length) return;
  room.zombies = (room.zombies || []).filter((zombie) => zombie.alive !== false || now - (zombie.deadAt || now) < 12000);
  const elapsed = Math.max(0, now - (room.startedAt || now));
  const wave = 1 + Math.floor(elapsed / 45000);
  room.survivalWave = Math.max(room.survivalWave || 1, wave);
  const maxActive = room.settings.mapId === "alagado"
    ? Math.min(42, 22 + room.survivalWave * 3)
    : Math.min(24, 14 + room.survivalWave * 2);
  const active = room.zombies.filter((zombie) => zombie.alive !== false).length;
  if (active >= maxActive) return;
  if (!room.nextZombieSpawnAt || now >= room.nextZombieSpawnAt) {
    const spawned = spawnProgressiveZombie(room, now);
    const baseInterval = room.settings.mapId === "alagado" ? 3600 : 5200;
    const interval = Math.max(1200, baseInterval - room.survivalWave * 300);
    room.nextZombieSpawnAt = now + (spawned ? interval : 1400);
  }
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
      moving: false, sprinting: false, jumping: false, crouching: false, prone: false, aiming: false, slot: EMPTY_SLOT,
      moveForward: 0, moveStrafe: 0,
      health: 100,
      alive: true,
      kills: 0,
      deaths: 0,
      score: 0,
      grenadeCharges: makeEmptyGrenades(),
      inventory: { primary: false, secondary: false, fuel: 0, medkits: 0 },
      ammo: { primary: 0, secondary: 0 },
      lastShotAt: { primary: 0, secondary: 0 },
      reloadUntil: { primary: 0, secondary: 0 },
      abilityActive: false,
      abilityExpiresAt: 0,
      abilityCooldownUntil: 0,
      blindedUntil: 0,
      chargeStartedAt: 0,
      vehicleId: null,
      lastWorldForceAt: 0,
      lastGrenadePrepareAt: 0,
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
      moving: p.moving, sprinting: p.sprinting, jumping: p.jumping, crouching: p.crouching, prone: p.prone,
      aiming: p.aiming, slot: normalizeWeaponSlot(p.slot),
      health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths, score: p.score,
      vehicleId: p.vehicleId || null,
      inventory: publicInventory(p),
      ammo: publicAmmo(p),
      grenadeCharges: { ...(p.grenadeCharges || {}) }
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
      survivalLoot: (room.survivalLoot || []).filter((loot) => loot.active !== false).map(publicLoot),
      zombies: (room.zombies || []).map(publicZombie),
      survivalWave: room.survivalWave || 1,
      worldEvent: room.worldEvent || null,
      worldTime: room.worldTime || null,
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

  function resetSurvivalLoadout(player) {
    player.slot = EMPTY_SLOT;
    player.aiming = false;
    player.inventory = {
      primary: false,
      secondary: false,
      fuel: Number(player.inventory?.fuel) || 0,
      medkits: Number(player.inventory?.medkits) || 0
    };
    player.ammo = { primary: 0, secondary: 0 };
    player.grenadeCharges = makeEmptyGrenades();
    player.reloadUntil = { primary: 0, secondary: 0 };
    player.lastShotAt = { primary: 0, secondary: 0 };
    player.chargeStartedAt = 0;
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
    player.moving = false;
    player.sprinting = false;
    player.jumping = false;
    player.crouching = false;
    player.prone = false;
    player.aiming = false;
    resetSurvivalLoadout(player);
    if (emit) {
      io.to(room.roomId).emit("match:respawn", {
        socketId: player.socketId, x: player.x, y: player.y, z: player.z, yaw: player.yaw, health: player.health,
        classId: player.classId, secondaryId: player.secondaryId, team: player.team,
        slot: player.slot, inventory: publicInventory(player), ammo: publicAmmo(player), grenadeCharges: { ...player.grenadeCharges }
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

  function applyDamage(room, shooter, target, rawDamage, isHeadshot, instantKill = false) {
    if (!target.alive) return;
    const damage = instantKill
      ? target.health
      : Math.round(isHeadshot ? rawDamage * HEADSHOT_MULTIPLIER : rawDamage);
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

  function grantSurvivalLoot(room, player, loot) {
    if (!loot || loot.active === false) return null;
    let consumed = false;

    if (loot.kind === "weapon") {
      if (loot.slot === "secondary" && SECONDARY_WEAPONS[loot.weaponId]) {
        player.secondaryId = loot.weaponId;
        player.inventory.secondary = true;
        player.ammo.secondary = Math.max(player.ammo.secondary || 0, loot.ammo || SECONDARY_WEAPONS[player.secondaryId].magSize);
        player.slot = "secondary";
        consumed = true;
      } else {
        const classId = PRIMARY_CLASS_BY_WEAPON_ID[loot.weaponId];
        if (!classId || !CLASSES[classId]) return null;
        player.classId = classId;
        player.inventory.primary = true;
        player.ammo.primary = Math.max(player.ammo.primary || 0, loot.ammo || CLASSES[player.classId].primary.magSize);
        player.slot = "primary";
        consumed = true;
      }
    } else if (loot.kind === "ammo") {
      const slot = loot.slot === "secondary" ? "secondary" : "primary";
      if (slot === "secondary" && player.inventory.secondary) {
        const maxAmmo = Math.max(SECONDARY_WEAPONS[player.secondaryId]?.magSize || 10, (loot.ammo || 10) * 3);
        player.ammo.secondary = Math.min(maxAmmo, (player.ammo.secondary || 0) + (loot.ammo || SECONDARY_WEAPONS[player.secondaryId]?.magSize || 10));
        consumed = true;
      } else if (slot === "primary" && player.inventory.primary) {
        const maxAmmo = Math.max(CLASSES[player.classId]?.primary?.magSize || 28, (loot.ammo || 28) * 3);
        player.ammo.primary = Math.min(maxAmmo, (player.ammo.primary || 0) + (loot.ammo || CLASSES[player.classId]?.primary?.magSize || 28));
        consumed = true;
      }
    } else if (loot.kind === "grenade" && GRENADES[loot.grenadeId]) {
      player.grenadeCharges[loot.grenadeId] = Math.min(3, (player.grenadeCharges[loot.grenadeId] || 0) + Math.max(1, loot.charges || 1));
      consumed = true;
    } else if (loot.kind === "fuel") {
      player.inventory.fuel = Math.min(100, (Number(player.inventory.fuel) || 0) + Math.max(1, loot.amount || 25));
      consumed = true;
    } else if (loot.kind === "medkit") {
      player.inventory.medkits = Math.min(MEDKIT_MAX, (Number(player.inventory.medkits) || 0) + Math.max(1, loot.amount || 1));
      consumed = true;
    }

    if (!consumed) return null;
    loot.active = false;
    loot.pickedAt = Date.now();
    return {
      picked: publicLoot(loot),
      slot: player.slot,
      inventory: publicInventory(player),
      ammo: publicAmmo(player),
      grenadeCharges: { ...(player.grenadeCharges || {}) },
      classId: player.classId,
      secondaryId: player.secondaryId
    };
  }

  function nearestAlivePlayer(room, zombie) {
    let target = null;
    let best = Infinity;
    room.players.forEach((player) => {
      if (!player.alive || player.vehicleId) return;
      const distance = Math.hypot(player.x - zombie.x, player.z - zombie.z);
      if (distance < best) {
        best = distance;
        target = player;
      }
    });
    return { target, distance: best };
  }

  function assignZombieRoamTarget(room, zombie, now) {
    const mapId = room.settings.mapId;
    const half = MAP_HALF_SIZES[mapId] || ARENA_HALF;
    const radius = ZOMBIE_ROAM_RADIUS[mapId] || ZOMBIE_ROAM_RADIUS.default;
    const homeX = Number.isFinite(Number(zombie.homeX)) ? Number(zombie.homeX) : Number(zombie.x) || 0;
    const homeZ = Number.isFinite(Number(zombie.homeZ)) ? Number(zombie.homeZ) : Number(zombie.z) || 0;
    const angle = Math.random() * Math.PI * 2;
    const distance = radius * (0.35 + Math.random() * 0.65);
    const point = constrainMapPosition(mapId, {
      x: clamp(homeX + Math.cos(angle) * distance, -half + 8, half - 8),
      y: zombie.y,
      z: clamp(homeZ + Math.sin(angle) * distance, -half + 8, half - 8)
    });
    zombie.roamTarget = { x: point.x, z: point.z };
    zombie.nextRoamAt = now + 3200 + Math.random() * 5600;
  }

  function updateZombieRoam(room, zombie, delta, now, speedMul) {
    if (!zombie.roamTarget || now >= (zombie.nextRoamAt || 0)) {
      assignZombieRoamTarget(room, zombie, now);
    }
    const target = zombie.roamTarget;
    const dx = target.x - zombie.x;
    const dz = target.z - zombie.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1.2) {
      assignZombieRoamTarget(room, zombie, now);
      zombie.moving = false;
      return;
    }
    const length = distance || 1;
    const speed = (ZOMBIE_ROAM_SPEED[zombie.kind] || ZOMBIE_ROAM_SPEED.basic) * speedMul;
    zombie.yaw = Math.atan2(-dx, -dz);
    zombie.x += (dx / length) * speed * delta;
    zombie.z += (dz / length) * speed * delta;
    zombie.moving = true;
  }

  function updateZombies(room, delta, now) {
    const zombies = room.zombies || [];
    if (!zombies.length) return;
    const night = room.worldTime?.phase === "night";
    const phaseSpeedMul = night ? 1.62 : 1;
    const chaseRadius = ZOMBIE_CHASE_RADIUS[room.settings.mapId] || ZOMBIE_CHASE_RADIUS.default;
    zombies.forEach((zombie) => {
      if (zombie.alive === false) return;
      const { target, distance } = nearestAlivePlayer(room, zombie);
      const speedMul = phaseSpeedMul * (Number(zombie.spawnSpeedMul) || 1);
      zombie.speedMul = speedMul;
      zombie.moving = false;
      if (!target || distance > chaseRadius) {
        zombie.targetId = null;
        updateZombieRoam(room, zombie, delta, now, speedMul);
        return;
      }
      zombie.targetId = target.socketId;
      zombie.roamTarget = null;
      const dx = target.x - zombie.x;
      const dz = target.z - zombie.z;
      const length = Math.hypot(dx, dz) || 1;
      zombie.yaw = Math.atan2(-dx, -dz);
      if (distance > ZOMBIE_ATTACK_RADIUS) {
        const baseSpeed = zombieKindStats(zombie.kind).chaseSpeed;
        zombie.x += (dx / length) * baseSpeed * speedMul * delta;
        zombie.z += (dz / length) * baseSpeed * speedMul * delta;
        zombie.moving = true;
      }
      const attackDistance = Math.hypot(target.x - zombie.x, target.z - zombie.z);
      if (attackDistance <= ZOMBIE_ATTACK_RADIUS && now - (zombie.lastAttackAt || 0) > ZOMBIE_ATTACK_MS / Math.max(1, speedMul)) {
        zombie.lastAttackAt = now;
        applyDamage(room, null, target, night ? 16 : 10, false);
        io.to(room.roomId).emit("survival:zombie-attack", {
          zombieId: zombie.id,
          targetSocketId: target.socketId,
          zombie: publicZombie(zombie)
        });
      }
    });
  }

  function releaseVehicle(room, player, reason = "exit") {
    if (!player?.vehicleId) return null;
    const vehicle = room.vehicles?.find((item) => item.id === player.vehicleId);
    if (vehicle?.driverId === player.socketId) vehicle.driverId = null;
    player.vehicleId = null;
    if (vehicle) {
      const exit = constrainMapPosition(room.settings.mapId, {
        x: vehicle.x + Math.cos(vehicle.yaw) * 2.2,
        y: Math.max(0, vehicle.y),
        z: vehicle.z - Math.sin(vehicle.yaw) * 2.2
      });
      player.x = exit.x;
      player.y = Math.max(0, Number.isFinite(Number(exit.y)) ? Number(exit.y) : vehicle.y);
      player.z = exit.z;
      io.to(room.roomId).emit("vehicle:occupied", { vehicleId: vehicle.id, driverId: null });
      io.to(room.roomId).volatile.emit("match:player-move", {
        socketId: player.socketId, x: player.x, y: player.y, z: player.z,
        yaw: player.yaw, pitch: player.pitch,
        moving: false, sprinting: false, jumping: false, crouching: false, prone: false, aiming: false, slot: normalizeWeaponSlot(player.slot),
        classId: player.classId, secondaryId: player.secondaryId, inventory: publicInventory(player)
      });
    }
    io.to(player.socketId).emit("vehicle:exited", { reason, x: player.x, y: player.y, z: player.z });
    return vehicle;
  }

  function damageVehicle(room, vehicle, amount, attacker = null) {
    if (!vehicle || vehicle.destroyed) return;
    vehicle.health = Math.max(0, vehicle.health - Math.max(0, Math.min(400, Number(amount) || 0)));
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
    if (room.settings.mapId === "mundo") {
      if (elapsed < 55) return null;
      const cycle = (elapsed - 55) % 190;
      if (cycle < 10) return { type: "tornado", phase: "warning", progress: cycle / 10 };
      if (cycle < 34) return { type: "tornado", phase: "active", progress: (cycle - 10) / 24 };
      if (cycle < 42) return { type: "tornado", phase: "recovery", progress: (cycle - 34) / 8 };
      if (cycle >= 104 && cycle < 114) return { type: "tsunami", phase: "warning", progress: (cycle - 104) / 10 };
      if (cycle < 128 && cycle >= 114) return { type: "tsunami", phase: "surge", progress: (cycle - 114) / 14 };
      if (cycle < 143 && cycle >= 128) return { type: "tsunami", phase: "flooded", progress: (cycle - 128) / 15 };
      if (cycle < 158 && cycle >= 143) return { type: "tsunami", phase: "drain", progress: (cycle - 143) / 15 };
      return null;
    }
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

  function worldTimeForRoom(room, now) {
    const lengthMs = room.settings.mapId === "mundo" ? 300000 : room.settings.mapId === "alagado" ? 270000 : room.settings.mapId === "cidade" ? 210000 : room.settings.mapId === "floresta" ? 240000 : 195000;
    const rawProgress = ((now - room.startedAt) % lengthMs) / lengthMs;
    const progress = (rawProgress + 0.44) % 1;
    const sun = Math.sin(progress * Math.PI * 2 - Math.PI * 0.42) * 0.5 + 0.5;
    const moon = 1 - sun;
    const phase = sun > 0.72 ? "day" : sun > 0.38 ? (progress < 0.55 ? "dawn" : "dusk") : "night";
    return {
      progress,
      phase,
      sun: Math.max(0, Math.min(1, sun)),
      moon: Math.max(0, Math.min(1, moon))
    };
  }

  function applyWorldEventForces(room, event, now) {
    if (!event) return;
    if (event.type === "tsunami" && event.phase === "surge") {
      const unified = room.settings.mapId === "mundo";
      const half = unified ? MAP_HALF_SIZES.mundo : MAP_HALF_SIZES.praia;
      const waveZ = unified ? half - 185 * event.progress : half - (half * 2 - 8) * event.progress;
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
      const unified = room.settings.mapId === "mundo";
      const tornadoX = unified ? 30 + event.progress * 230 : -134 + event.progress * 268;
      const tornadoZ = unified ? -190 + event.progress * 250 : Math.sin(event.progress * Math.PI * 3) * 62;
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

  function updateGroundVehicle(vehicle, stats, input, driver, delta, waterMode = false) {
    const throttle = clamp(input.throttle, -1, 1);
    const steerInput = clamp(input.steer, -1, 1);
    const brake = input.brake ? 1 : 0;
    const speedRatio = Math.min(1, Math.abs(vehicle.speed) / Math.max(1, stats.maxSpeed));
    const lowSpeedTorque = 1.15 - speedRatio * 0.45;
    const targetPower = driver ? Math.max(0.08, Math.abs(throttle)) : 0;

    vehicle.enginePower = approach(vehicle.enginePower || 0, targetPower, delta * (driver ? 2.6 : 0.8));
    vehicle.steering = lerp(vehicle.steering || 0, steerInput, delta * (waterMode ? 5.5 : 7.5));

    if (driver && throttle !== 0) {
      vehicle.speed += throttle * stats.acceleration * lowSpeedTorque * delta;
    } else {
      vehicle.speed = approach(vehicle.speed, 0, stats.acceleration * (waterMode ? 0.42 : 0.34) * delta);
    }
    if (brake) vehicle.speed = approach(vehicle.speed, 0, stats.acceleration * 1.8 * delta);
    if (input.collision) {
      vehicle.speed = Math.abs(vehicle.speed) > 8 ? -vehicle.speed * 0.08 : 0;
      vehicle.enginePower = Math.min(vehicle.enginePower, 0.18);
    }

    const drag = waterMode ? 0.985 : 0.992;
    vehicle.speed *= Math.pow(drag, delta * 60);
    vehicle.speed = clamp(vehicle.speed, -stats.maxSpeed * 0.42, stats.maxSpeed);

    const steeringAtSpeed = Math.min(1, Math.abs(vehicle.speed) / Math.max(1, stats.maxSpeed * 0.28));
    const reverseMul = vehicle.speed >= 0 ? 1 : -1;
    vehicle.yaw += vehicle.steering * stats.turnSpeed * steeringAtSpeed * reverseMul * delta;
    vehicle.x -= Math.sin(vehicle.yaw) * vehicle.speed * delta;
    vehicle.z -= Math.cos(vehicle.yaw) * vehicle.speed * delta;

    const acceleration = (vehicle.speed - (vehicle.lastSpeed || 0)) / Math.max(0.001, delta);
    const sampledGround = Number.isFinite(input.groundY)
      ? clamp(input.groundY, -2, 60)
      : Number.isFinite(vehicle.groundY) ? vehicle.groundY : vehicle.y;
    const aheadGround = Number.isFinite(input.groundAheadY) ? clamp(input.groundAheadY, -2, 60) : sampledGround;
    const behindGround = Number.isFinite(input.groundBehindY) ? clamp(input.groundBehindY, -2, 60) : sampledGround;
    const previousGround = Number.isFinite(vehicle.lastGroundY) ? vehicle.lastGroundY : sampledGround;
    const terrainVelocity = clamp((sampledGround - previousGround) / Math.max(0.001, delta), -12, 12);
    const contactY = sampledGround + (waterMode ? 0.2 : 0.06);
    const terrainPitch = Math.atan2(aheadGround - behindGround, 4.8);
    const wasGrounded = vehicle.grounded !== false;

    vehicle.groundY = sampledGround;
    vehicle.lastGroundY = sampledGround;
    if (!waterMode) {
      if (wasGrounded && contactY < vehicle.y - 0.34 && Math.abs(vehicle.speed) > 6.5) {
        vehicle.grounded = false;
        vehicle.verticalVelocity = Math.max(vehicle.verticalVelocity || 0, terrainVelocity * 0.72);
      }
      if (vehicle.grounded !== false) {
        const suspension = Math.min(1, delta * (Math.abs(vehicle.speed) > 5 ? 16 : 22));
        vehicle.y = lerp(vehicle.y, contactY, suspension);
        vehicle.verticalVelocity = clamp(terrainVelocity * 0.68, -4.5, 8.5);
      } else {
        vehicle.verticalVelocity = (vehicle.verticalVelocity || 0) - 18 * delta;
        vehicle.y += vehicle.verticalVelocity * delta;
        if (vehicle.y <= contactY) {
          const impactSpeed = Math.abs(Math.min(0, vehicle.verticalVelocity || 0));
          vehicle.y = contactY;
          vehicle.grounded = true;
          vehicle.verticalVelocity = impactSpeed > 8 ? Math.min(2.2, impactSpeed * 0.12) : 0;
          if (impactSpeed > 11) vehicle.speed *= 0.82;
        }
      }
    }
    const targetRoll = -vehicle.steering * steeringAtSpeed * (waterMode ? 0.18 : 0.26);
    const targetPitch = clamp(terrainPitch - acceleration * 0.012, -0.48, 0.42);
    vehicle.roll = lerp(vehicle.roll || 0, targetRoll, delta * 5.5);
    vehicle.pitch = lerp(vehicle.pitch || 0, vehicle.grounded === false ? clamp(targetPitch - (vehicle.verticalVelocity || 0) * 0.018, -0.48, 0.42) : targetPitch, delta * 4.5);
    vehicle.lastSpeed = vehicle.speed;
  }

  function updatePlaneVehicle(vehicle, stats, input, driver, delta) {
    if (!driver) {
      if (vehicle.type === "plane" && vehicle.y > 3.12) {
        vehicle.crashRollDirection ||= Math.random() < 0.5 ? -1 : 1;
        vehicle.enginePower = approach(vehicle.enginePower || 0.2, 0, delta * 0.35);
        vehicle.speed = approach(Math.max(7, vehicle.speed || stats.maxSpeed * 0.35), stats.maxSpeed * 0.28, stats.acceleration * delta * 0.18);
        vehicle.pitch = lerp(vehicle.pitch || 0, -0.5, delta * 1.35);
        vehicle.roll = lerp(vehicle.roll || 0, vehicle.crashRollDirection * 0.74, delta * 0.9);
        vehicle.yaw += Math.sin(vehicle.roll || 0) * stats.turnSpeed * 0.28 * delta;
        const forward = {
          x: -Math.sin(vehicle.yaw) * Math.cos(vehicle.pitch || 0),
          z: -Math.cos(vehicle.yaw) * Math.cos(vehicle.pitch || 0)
        };
        vehicle.x += forward.x * vehicle.speed * delta;
        vehicle.z += forward.z * vehicle.speed * delta;
        vehicle.verticalVelocity = (vehicle.verticalVelocity || -1.4) - 9.6 * delta;
        vehicle.y += vehicle.verticalVelocity * delta;
        if (vehicle.y <= 3) {
          const impactSpeed = Math.abs(vehicle.verticalVelocity || 0);
          vehicle.y = 3;
          vehicle.verticalVelocity = 0;
          vehicle.speed = Math.max(0, vehicle.speed * 0.18);
          vehicle.pitch = -0.18;
          vehicle.roll = clamp(vehicle.roll || 0, -0.55, 0.55);
          vehicle.pendingCrashDamage = impactSpeed > 8 ? 360 : 180;
        }
        vehicle.lastSpeed = vehicle.speed;
        return;
      }
      vehicle.enginePower = approach(vehicle.enginePower || 0, 0, delta * 0.8);
      vehicle.speed = approach(vehicle.speed || 0, 0, stats.acceleration * delta);
      vehicle.pitch = lerp(vehicle.pitch || 0, 0, delta * 2.4);
      vehicle.roll = lerp(vehicle.roll || 0, 0, delta * 2.4);
      vehicle.verticalVelocity = 0;
      vehicle.lastSpeed = vehicle.speed;
      return;
    }
    const throttle = clamp(input.throttle, -1, 1);
    const pitchInput = clamp(input.pitch || input.lift, -1, 1);
    const rollInput = clamp(input.roll || input.steer, -1, 1);
    const yawInput = clamp(input.yaw, -1, 1);
    const brake = input.brake ? 1 : 0;
    const targetEngine = clamp(0.58 + throttle * 0.42, 0.18, 1);

    vehicle.enginePower = approach(vehicle.enginePower || 0.35, targetEngine, delta * 0.72);
    const cruise = stats.maxSpeed * (0.34 + vehicle.enginePower * 0.66);
    vehicle.speed = approach(vehicle.speed, cruise, stats.acceleration * delta * (brake ? 1.7 : 0.72));
    if (brake) vehicle.speed = approach(vehicle.speed, stats.maxSpeed * 0.22, stats.acceleration * 1.2 * delta);

    const targetRoll = clamp(rollInput * 0.86 + yawInput * 0.18, -1.05, 1.05);
    vehicle.roll = lerp(vehicle.roll || 0, targetRoll, delta * 3.2);
    const targetPitch = clamp((vehicle.pitch || 0) + pitchInput * delta * 0.88, -0.62, 0.52);
    vehicle.pitch = lerp(vehicle.pitch || 0, targetPitch, delta * 4.2);

    const bankTurn = Math.sin(vehicle.roll || 0) * stats.turnSpeed * 0.78;
    vehicle.yaw += (yawInput * stats.turnSpeed * 0.55 + bankTurn) * delta;

    const forward = {
      x: -Math.sin(vehicle.yaw) * Math.cos(vehicle.pitch || 0),
      y: Math.sin(vehicle.pitch || 0),
      z: -Math.cos(vehicle.yaw) * Math.cos(vehicle.pitch || 0)
    };
    vehicle.x += forward.x * vehicle.speed * delta;
    vehicle.z += forward.z * vehicle.speed * delta;
    vehicle.verticalVelocity = lerp(vehicle.verticalVelocity || 0, forward.y * vehicle.speed * 0.82 + input.lift * 3.2, delta * 2.8);
    vehicle.y += vehicle.verticalVelocity * delta;

    if (vehicle.y <= 3) {
      vehicle.y = 3;
      vehicle.verticalVelocity = Math.max(0, vehicle.verticalVelocity || 0);
      vehicle.pitch = lerp(vehicle.pitch || 0, 0, delta * 2.2);
      vehicle.roll = lerp(vehicle.roll || 0, 0, delta * 1.8);
    }
    if (vehicle.y >= 44) {
      vehicle.y = 44;
      vehicle.verticalVelocity = Math.min(0, vehicle.verticalVelocity || 0);
      vehicle.pitch = Math.min(vehicle.pitch || 0, 0.15);
    }
    vehicle.lastSpeed = vehicle.speed;
  }

  function applyVehicleFuel(room, vehicle, driver, input, delta, now) {
    if (!driver || vehicle.type === "cannon") return input;
    const activeInput = Math.abs(Number(input.throttle) || 0) + Math.abs(Number(input.lift) || 0) + Math.abs(Number(input.pitch) || 0) * 0.35;
    if (activeInput <= 0.03) return input;
    const currentFuel = Math.max(0, Number(driver.inventory?.fuel) || 0);
    if (currentFuel <= 0) {
      if (now - (driver.lastFuelWarningAt || 0) > 1800) {
        driver.lastFuelWarningAt = now;
        io.to(driver.socketId).emit("survival:fuel-empty", { vehicleId: vehicle.id });
      }
      return { ...input, throttle: 0, lift: 0, pitch: 0, roll: input.roll || 0, yaw: input.yaw || 0 };
    }
    const burnRate = vehicle.type === "plane" || vehicle.type === "helicopter" ? 2.1 : vehicle.type === "jetski" ? 1.45 : 1.05;
    driver.inventory.fuel = Math.max(0, currentFuel - burnRate * activeInput * delta);
    if (now - (driver.lastFuelSyncAt || 0) > 900 || driver.inventory.fuel <= 0) {
      driver.lastFuelSyncAt = now;
      io.to(driver.socketId).emit("survival:inventory", {
        slot: driver.slot,
        inventory: publicInventory(driver),
        ammo: publicAmmo(driver),
        grenadeCharges: { ...(driver.grenadeCharges || {}) },
        classId: driver.classId,
        secondaryId: driver.secondaryId
      });
    }
    return input;
  }

  function updateVehicles(room, delta, now) {
    const half = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
    const groundY = room.settings.mapId === "sketchbook" ? SKETCHBOOK_GROUND_Y : 0;
    room.vehicles.forEach((vehicle) => {
      if (vehicle.destroyed) return;
      const stats = VEHICLE_STATS[vehicle.type];
      const driver = room.players.find((player) => player.socketId === vehicle.driverId && player.alive);
      if (!driver && vehicle.driverId) vehicle.driverId = null;
      let input = driver ? vehicle.input : { throttle: 0, steer: 0, lift: 0, pitch: 0, roll: 0, yaw: 0, brake: 0 };
      input = applyVehicleFuel(room, vehicle, driver, input, delta, now);

      if (vehicle.type === "cannon") {
        vehicle.yaw += input.steer * stats.turnSpeed * delta;
        vehicle.pitch = 0;
        vehicle.roll = 0;
      } else if (vehicle.type === "plane" || vehicle.type === "helicopter") {
        updatePlaneVehicle(vehicle, stats, input, driver, delta);
        if (vehicle.pendingCrashDamage) {
          const crashDamage = vehicle.pendingCrashDamage;
          vehicle.pendingCrashDamage = 0;
          damageVehicle(room, vehicle, crashDamage, null);
        }
      } else {
        updateGroundVehicle(vehicle, stats, input, driver, delta, vehicle.type === "jetski");
      }

      if (vehicle.type === "jetski") {
        vehicle.y = 0.2;
      }

      if (room.settings.mapId === "sketchbook") {
        const constrained = constrainMapPosition(room.settings.mapId, { x: vehicle.x, y: vehicle.y, z: vehicle.z });
        vehicle.x = constrained.x;
        vehicle.z = constrained.z;
        if (vehicle.type !== "plane" && vehicle.type !== "helicopter") vehicle.y = Math.max(groundY, Number(constrained.y) || vehicle.y);
      } else {
        vehicle.x = Math.max(-half + 3, Math.min(half - 3, vehicle.x));
        vehicle.z = Math.max(-half + 3, Math.min(half - 3, vehicle.z));
      }
      if (vehicle.type === "jetski" && (room.settings.mapId === "praia" || room.settings.mapId === "mundo") && vehicle.z < (room.settings.mapId === "mundo" ? 190 : 39)) {
        vehicle.z = room.settings.mapId === "mundo" ? 190 : 39;
        vehicle.speed = Math.max(0, vehicle.speed * 0.45);
      }
      if (driver) {
        driver.x = vehicle.x;
        driver.y = vehicle.y;
        driver.z = vehicle.z;
        driver.yaw = vehicle.yaw;
        driver.pitch = vehicle.pitch || 0;
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
    room.survivalLoot = makeSurvivalLoot(room.settings.mapId);
    room.lootSerial = room.survivalLoot.length;
    seedExtraSurvivalLoot(room, room.startedAt);
    room.zombies = makeZombies(room.settings.mapId);
    room.survivalWave = 1;
    room.zombieSerial = room.zombies.length;
    room.nextZombieSpawnAt = room.startedAt + 6500;
    room.worldEvent = null;
    room.worldTime = worldTimeForRoom(room, room.startedAt);
    room.worldTick = 0;
    room.worldTimer = setInterval(() => {
      if (!rooms.has(room.roomId) || room.status !== "playing") return;
      const now = Date.now();
      const event = eventForRoom(room, now);
      room.worldEvent = event;
      room.worldTime = worldTimeForRoom(room, now);
      updateVehicles(room, WORLD_TICK_MS / 1000, now);
      updateZombies(room, WORLD_TICK_MS / 1000, now);
      updateZombieSpawns(room, now);
      const lootChanged = updateSurvivalLootSpawns(room, now);
      applyWorldEventForces(room, event, now);
      room.worldTick += 1;
      io.to(room.roomId).volatile.emit("vehicle:state", room.vehicles.map(publicVehicle));
      if (lootChanged) io.to(room.roomId).emit("survival:loot", activeSurvivalLoot(room).map(publicLoot));
      if (room.worldTick % 4 === 0) {
        io.to(room.roomId).emit("arena-world:event", event || { type: "none", phase: "idle", progress: 0 });
      }
      if (room.worldTick % 10 === 0) {
        io.to(room.roomId).volatile.emit("arena-world:time", room.worldTime);
      }
      if (room.worldTick % 20 === 0) {
        io.to(room.roomId).volatile.emit("survival:status", {
          wave: room.survivalWave || 1,
          activeZombies: room.zombies.filter((zombie) => zombie.alive !== false).length
        });
      }
      io.to(room.roomId).emit("survival:zombies", room.zombies.map(publicZombie));
    }, WORLD_TICK_MS);
  }

  function worldObjectMaxHealth(mapId, objectId) {
    if (mapId === "mundo" && /^unified-bridge-(north|south)$/.test(objectId)) return 165;
    if (mapId === "floresta" && /^fantasy_bridge_destructible_\d+$/.test(objectId)) return 145;
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
    const normalizedSlot = normalizeWeaponSlot(slot);
    if (normalizedSlot === "secondary") {
      if (player.inventory && !player.inventory.secondary) return null;
      return SECONDARY_WEAPONS[player.secondaryId] || null;
    }
    if (normalizedSlot === "primary") {
      if (player.inventory && !player.inventory.primary) return null;
      return CLASSES[player.classId]?.primary || null;
    }
    return null;
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
        survivalLoot: [],
        zombies: [],
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
      if (!MAP_IDS.includes(room.settings.mapId)) room.settings.mapId = "mundo";
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
      player.moving = false; player.sprinting = false; player.jumping = false; player.crouching = false; player.prone = false; player.aiming = false;
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
      const groundSample = (value) => {
        if (value == null || value === "") return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(-2, Math.min(60, numeric)) : null;
      };
      vehicle.input = {
        throttle: clampInput(input.throttle),
        steer: clampInput(input.steer),
        lift: clampInput(input.lift),
        pitch: clampInput(input.pitch),
        roll: clampInput(input.roll),
        yaw: clampInput(input.yaw),
        brake: Boolean(input.brake),
        groundY: groundSample(input.groundY),
        groundAheadY: groundSample(input.groundAheadY),
        groundBehindY: groundSample(input.groundBehindY),
        collision: Boolean(input.collision)
      };
    });

    socket.on("vehicle:hit", ({ vehicleId, slot, pelletHits } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const attacker = room.players.find((item) => item.socketId === socket.id);
      const vehicle = room.vehicles.find((item) => item.id === String(vehicleId || ""));
      if (!attacker || !attacker.alive || !vehicle || vehicle.destroyed || vehicle.driverId === socket.id) return;
      const hitSlot = normalizeWeaponSlot(slot);
      if (hitSlot === EMPTY_SLOT) return;
      const weapon = weaponFor(attacker, hitSlot);
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

    socket.on("vehicle:bomb", ({ vehicleId, target } = {}) => {
      const room = findRoomBySocket(socket.id);
      const shooter = room?.players.find((item) => item.socketId === socket.id);
      const vehicle = room?.vehicles.find((item) => item.id === vehicleId && item.driverId === socket.id);
      const stats = vehicle ? VEHICLE_STATS[vehicle.type] : null;
      if (!room || room.status !== "playing" || !shooter?.alive || !vehicle || vehicle.destroyed || vehicle.type !== "plane") return;
      const now = Date.now();
      const cooldownMs = stats?.bombCooldownMs || 25000;
      if (now < (vehicle.bombReadyAt || 0)) return;

      const half = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
      const requestedX = Number(target?.x);
      const requestedY = Number(target?.y);
      const requestedZ = Number(target?.z);
      const targetPoint = {
        x: clamp(Number.isFinite(requestedX) ? requestedX : vehicle.x, -half + 2, half - 2),
        y: clamp(Number.isFinite(requestedY) ? requestedY : 0, -1, 55),
        z: clamp(Number.isFinite(requestedZ) ? requestedZ : vehicle.z, -half + 2, half - 2)
      };
      if (Math.hypot(targetPoint.x - vehicle.x, targetPoint.z - vehicle.z) > 90) return;

      const origin = { x: vehicle.x, y: vehicle.y - 0.45, z: vehicle.z };
      const flightMs = Math.round(clamp(Math.sqrt(2 * Math.max(1, origin.y - targetPoint.y) / 16) * 1000, 650, 2500));
      vehicle.lastBombAt = now;
      vehicle.bombReadyAt = now + cooldownMs;
      io.to(room.roomId).emit("vehicle:bomb-dropped", {
        vehicleId: vehicle.id,
        origin,
        target: targetPoint,
        flightMs
      });
      io.to(socket.id).emit("vehicle:bomb-cooldown", { vehicleId: vehicle.id, readyAt: vehicle.bombReadyAt });

      setTimeout(() => {
        if (rooms.get(room.roomId) !== room || room.status !== "playing") return;
        const currentShooter = room.players.find((item) => item.socketId === socket.id) || null;
        const radius = 16;
        io.to(room.roomId).emit("vehicle:bomb-exploded", {
          vehicleId: vehicle.id,
          x: targetPoint.x,
          y: targetPoint.y,
          z: targetPoint.z
        });
        room.players.forEach((player) => {
          if (!player.alive) return;
          const distance = Math.hypot(player.x - targetPoint.x, player.z - targetPoint.z);
          if (distance > radius) return;
          const falloff = Math.max(0, 1 - distance / radius);
          applyDamage(room, player.socketId === currentShooter?.socketId ? null : currentShooter, player, 32 + 98 * falloff, false);
        });
        room.vehicles.forEach((targetVehicle) => {
          if (targetVehicle.destroyed || targetVehicle.id === vehicle.id) return;
          const distance = Math.hypot(targetVehicle.x - targetPoint.x, targetVehicle.z - targetPoint.z);
          if (distance <= radius + 2) damageVehicle(room, targetVehicle, 140 + 320 * Math.max(0, 1 - distance / (radius + 2)), currentShooter);
        });
        room.worldObjects.forEach((object) => {
          if (Math.hypot(object.x - targetPoint.x, object.z - targetPoint.z) <= radius + 2) {
            damageWorldObject(room, object.id, 180, object);
          }
        });
      }, flightMs);
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

    socket.on("survival:pickup", ({ lootId } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || room.status !== "playing" || !player?.alive || player.vehicleId) return;
      const loot = (room.survivalLoot || []).find((item) => item.id === String(lootId || "") && item.active !== false);
      if (!loot) return;
      const distance = Math.hypot(player.x - loot.x, player.z - loot.z);
      if (distance > SURVIVAL_PICKUP_RADIUS || Math.abs((player.y || 0) - (loot.y || 0)) > 5) return;
      const result = grantSurvivalLoot(room, player, loot);
      if (!result) return;
      io.to(room.roomId).emit("survival:loot-picked", { lootId: loot.id, socketId: socket.id });
      socket.emit("survival:inventory", result);
      socket.to(room.roomId).volatile.emit("match:player-move", {
        socketId: socket.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
        moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching, prone: player.prone,
        aiming: player.aiming, slot: player.slot, classId: player.classId, secondaryId: player.secondaryId, inventory: publicInventory(player),
        moveForward: player.moveForward, moveStrafe: player.moveStrafe
      });
    });

    socket.on("survival:use-medkit", () => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || room.status !== "playing" || !player?.alive || player.vehicleId) return;
      if ((Number(player.inventory?.medkits) || 0) <= 0 || player.health >= 100) return;
      player.inventory.medkits = Math.max(0, (Number(player.inventory.medkits) || 0) - 1);
      player.health = Math.min(100, player.health + MEDKIT_HEAL);
      socket.emit("survival:healed", {
        health: player.health,
        slot: player.slot,
        inventory: publicInventory(player),
        ammo: publicAmmo(player),
        grenadeCharges: { ...(player.grenadeCharges || {}) },
        classId: player.classId,
        secondaryId: player.secondaryId
      });
      socket.to(room.roomId).volatile.emit("match:player-move", {
        socketId: socket.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
        moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching, prone: player.prone,
        aiming: player.aiming, slot: player.slot, classId: player.classId, secondaryId: player.secondaryId, inventory: publicInventory(player),
        moveForward: player.moveForward, moveStrafe: player.moveStrafe
      });
    });

    socket.on("survival:zombie-hit", ({ zombieId, slot, pelletHits } = {}) => {
      const room = findRoomBySocket(socket.id);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || room.status !== "playing" || !player?.alive) return;
      const hitSlot = normalizeWeaponSlot(slot);
      if (hitSlot === EMPTY_SLOT) return;
      const weapon = weaponFor(player, hitSlot);
      const zombie = (room.zombies || []).find((item) => item.id === String(zombieId || "") && item.alive !== false);
      if (!weapon || !zombie) return;
      if (Math.hypot(player.x - zombie.x, player.z - zombie.z) > weapon.range * RANGE_TOLERANCE + 8) return;
      const now = Date.now();
      if (now - (player.lastEnvironmentHitAt || 0) < Math.max(55, weapon.fireRateMs * 0.55)) return;
      player.lastEnvironmentHitAt = now;
      const pellets = Math.max(1, Math.min(weapon.pellets || 1, Number(pelletHits) || 1));
      zombie.health = Math.max(0, zombie.health - Math.round(weapon.damage * pellets));
      if (zombie.health <= 0) {
        zombie.alive = false;
        zombie.deadAt = now;
        player.score += 1;
        io.to(room.roomId).emit("survival:zombie-killed", { zombieId: zombie.id, byId: socket.id, zombies: room.zombies.map(publicZombie) });
        checkScoreLimit(room);
      } else {
        io.to(room.roomId).emit("survival:zombie-damaged", { zombieId: zombie.id, health: zombie.health, byId: socket.id });
      }
    });

    socket.on("match:move", (state = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive || player.vehicleId) return;
      const mapHalf = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
      const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
      const rawX = Math.max(-mapHalf, Math.min(mapHalf, num(state.x, player.x)));
      const rawZ = Math.max(-mapHalf, Math.min(mapHalf, num(state.z, player.z)));
      const rawY = Math.max(0, Math.min(24, num(state.y, player.y)));
      const constrained = constrainMapPosition(room.settings.mapId, { x: rawX, y: rawY, z: rawZ });
      player.x = constrained.x;
      player.z = constrained.z;
      player.y = Math.max(0, Math.min(24, num(constrained.y, rawY)));
      player.yaw = num(state.yaw, player.yaw);
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, num(state.pitch, player.pitch)));
      player.moving = Boolean(state.moving);
      player.sprinting = Boolean(state.sprinting);
      player.jumping = Boolean(state.jumping);
      player.crouching = Boolean(state.crouching);
      player.prone = Boolean(state.prone) && !player.jumping;
      if (player.prone) {
        player.crouching = false;
        player.sprinting = false;
      }
      const requestedSlot = normalizeWeaponSlot(state.slot);
      player.slot = weaponFor(player, requestedSlot) ? requestedSlot : EMPTY_SLOT;
      player.aiming = Boolean(state.aiming) && Boolean(weaponFor(player, player.slot));
      player.moveForward = Math.max(-1, Math.min(1, num(state.moveForward, 0)));
      player.moveStrafe = Math.max(-1, Math.min(1, num(state.moveStrafe, 0)));
      if ((player.moving || player.jumping) && player.emoteId) {
        player.emoteId = null;
        io.to(room.roomId).emit("match:emote-stop", { socketId: socket.id });
      }
      socket.to(room.roomId).volatile.emit("match:player-move", {
        socketId: socket.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch,
        moving: player.moving, sprinting: player.sprinting, jumping: player.jumping, crouching: player.crouching, prone: player.prone,
        aiming: player.aiming, slot: player.slot, classId: player.classId, secondaryId: player.secondaryId, inventory: publicInventory(player),
        moveForward: player.moveForward, moveStrafe: player.moveStrafe
      });
    });

    socket.on("match:charge-start", ({ slot } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const chargeSlot = normalizeWeaponSlot(slot);
      if (chargeSlot === EMPTY_SLOT) return;
      const weapon = weaponFor(player, chargeSlot);
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
      const shotSlot = normalizeWeaponSlot(slot);
      if (shotSlot === EMPTY_SLOT) return;
      if (shotSlot === "secondary" && !room.settings.secondaryEnabled) return;

      const weapon = weaponFor(shooter, shotSlot);
      if (!weapon) return;
      const now = Date.now();
      const isAbilityFireRate = shooter.abilityActive && now < shooter.abilityExpiresAt && CLASSES[shooter.classId].ability.id === abilityFireRateBoost(shooter.classId);
      const fireRate = isAbilityFireRate ? weapon.fireRateMs * 0.5 : weapon.fireRateMs;
      if (now < (shooter.reloadUntil[shotSlot] || 0)) return;
      if (now - (shooter.lastShotAt[shotSlot] || 0) < fireRate * 0.88) return;

      shooter.lastShotAt[shotSlot] = now;
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
        socketId: socket.id, slot: shotSlot, weaponId: weapon.id,
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
      const isHeadshot = hitZone === "head";
      const instantKillHeadshot = isHeadshot && INSTANT_KILL_HEADSHOT_WEAPONS.has(weapon.id);

      applyDamage(
        room,
        shooter,
        target,
        weapon.damage * falloff * pellets * piercingBonus * chargeDamageMultiplier,
        isHeadshot,
        instantKillHeadshot
      );
    });

    socket.on("match:reload", ({ slot } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const reloadSlot = normalizeWeaponSlot(slot);
      if (reloadSlot === EMPTY_SLOT) return;
      const weapon = weaponFor(player, reloadSlot);
      if (!weapon || weapon.kind === "melee") return;
      player.reloadUntil[reloadSlot] = Date.now() + weapon.reloadMs;
      socket.to(room.roomId).emit("match:reload-started", {
        socketId: socket.id,
        weaponId: weapon.id,
        slot: reloadSlot,
        durationMs: weapon.reloadMs
      });
    });

    socket.on("match:ability", (payload = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing") return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive) return;
      const now = Date.now();
      if (now < player.abilityCooldownUntil) return;
      const ability = CLASSES[player.classId].ability;
      const half = MAP_HALF_SIZES[room.settings.mapId] || ARENA_HALF;
      const pointFromPayload = () => ({
        x: clamp(payload?.target?.x, -half + 2, half - 2),
        y: clamp(payload?.target?.y, -1, 55),
        z: clamp(payload?.target?.z, -half + 2, half - 2)
      });
      let eventPayload = {};
      if (ability.id === "gancho_reposicionamento") {
        const target = pointFromPayload();
        const dx = target.x - player.x;
        const dz = target.z - player.z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal > 78 || target.y < player.y + 1.8) return;
        const nx = horizontal > 0.001 ? dx / horizontal : -Math.sin(player.yaw || 0);
        const nz = horizontal > 0.001 ? dz / horizontal : -Math.cos(player.yaw || 0);
        io.to(socket.id).emit("world:force", {
          x: nx * Math.min(26, horizontal * 0.95),
          y: Math.max(12, Math.min(24, target.y - player.y + 7)),
          z: nz * Math.min(26, horizontal * 0.95),
          fallDamage: 0
        });
        eventPayload = { target };
      } else if (ability.id === "chuva_flechas") {
        const target = pointFromPayload();
        if (Math.hypot(target.x - player.x, target.z - player.z) > 92) return;
        const radius = 7.5;
        const ticks = 8;
        const tickMs = 430;
        for (let tick = 1; tick <= ticks; tick++) {
          setTimeout(() => {
            if (rooms.get(room.roomId) !== room || room.status !== "playing") return;
            const archer = room.players.find((item) => item.socketId === socket.id) || null;
            room.players.forEach((targetPlayer) => {
              if (!targetPlayer.alive) return;
              const distance = Math.hypot(targetPlayer.x - target.x, targetPlayer.z - target.z);
              if (distance > radius) return;
              const falloff = Math.max(0.45, 1 - distance / radius);
              applyDamage(room, targetPlayer.socketId === archer?.socketId ? null : archer, targetPlayer, 8.5 * falloff, false);
            });
          }, 650 + tick * tickMs);
        }
        eventPayload = { target, radius, warningMs: 650 };
      } else if (ability.id === "arpao_corrente") {
        const target = room.players.find((item) => item.socketId === String(payload?.targetSocketId || ""));
        if (!target || !target.alive || target.socketId === socket.id || target.vehicleId) return;
        const dx = player.x - target.x;
        const dz = player.z - target.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 64) return;
        const nx = distance > 0.001 ? dx / distance : Math.sin(player.yaw || 0);
        const nz = distance > 0.001 ? dz / distance : Math.cos(player.yaw || 0);
        const heavyTarget = target.classId === "heavy";
        if (heavyTarget) {
          io.to(target.socketId).emit("match:harpoon-slow", { durationMs: ability.durationMs, strength: 0.42 });
        } else {
          io.to(target.socketId).emit("world:force", {
            x: nx * Math.min(21, distance * 0.86),
            y: 5.5,
            z: nz * Math.min(21, distance * 0.86),
            fallDamage: 0
          });
          io.to(target.socketId).emit("match:harpoon-slow", { durationMs: 1350, strength: 0.62 });
        }
        eventPayload = {
          targetSocketId: target.socketId,
          target: { x: target.x, y: target.y + 1.1, z: target.z },
          heavy: heavyTarget
        };
      }
      player.abilityActive = true;
      player.abilityExpiresAt = now + ability.durationMs;
      player.abilityCooldownUntil = now + ability.cooldownMs;
      io.to(room.roomId).emit("match:ability", { socketId: socket.id, abilityId: ability.id, durationMs: ability.durationMs, ...eventPayload });
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

    socket.on("match:grenadePrepare", ({ grenadeId } = {}) => {
      const room = findRoomBySocket(socket.id);
      if (!room || room.status !== "playing" || !room.settings.grenadesEnabled) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || !player.alive || !GRENADES[grenadeId] || (player.grenadeCharges[grenadeId] || 0) <= 0) return;
      const now = Date.now();
      if (now - player.lastGrenadePrepareAt < 650) return;
      player.lastGrenadePrepareAt = now;
      socket.to(room.roomId).emit("match:grenadePrepare", { socketId: socket.id, grenadeId });
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
      if (grenade.id === "molotov") {
        const burnTicks = Math.max(1, Math.min(8, grenade.burnTicks || 5));
        const tickMs = Math.max(350, Math.min(1500, grenade.burnTickMs || 900));
        for (let tick = 1; tick <= burnTicks; tick++) {
          setTimeout(() => {
            if (rooms.get(room.roomId) !== room || room.status !== "playing") return;
            const currentThrower = room.players.find((player) => player.socketId === socket.id) || null;
            room.players.forEach((target) => {
              if (!target.alive) return;
              const d = distance3({ x: point.x, y: 0, z: point.z }, { x: target.x, y: 0, z: target.z });
              if (d > grenade.radius) return;
              const falloff = Math.max(0.25, 1 - d / grenade.radius);
              applyDamage(room, target.socketId === currentThrower?.socketId ? null : currentThrower, target, grenade.burnDamage * falloff, false);
            });
          }, tick * tickMs);
        }
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
