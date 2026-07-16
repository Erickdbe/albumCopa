"use strict";

// Config autoritativa do servidor. Espelhada em public/js/config.js para o cliente
// prever visualmente (sway, HUD, animações) — o dano/acerto real sempre é validado aqui.

const HEADSHOT_MULTIPLIER = 2;
const INSTANT_KILL_HEADSHOT_WEAPONS = new Set(["sniper_rifle", "bow", "crossbow"]);

// Classes jogaveis: arma principal + habilidade unica com cooldown.
const CLASSES = {
  sniper: {
    id: "sniper", name: "Sniper", color: "#4fd1ff",
    primary: { id: "sniper_rifle", name: "Rifle Sniper", damage: 90, fireRateMs: 1300, magSize: 5, reloadMs: 2300, spread: 0.001, range: 140, kind: "hitscan", speedMul: 0.85 },
    ability: { id: "gancho_reposicionamento", name: "Gancho de Reposicionamento", cooldownMs: 14000, durationMs: 900 }
  },
  archer: {
    id: "archer", name: "Arqueiro", color: "#8bd450",
    primary: { id: "bow", name: "Arco", damage: 55, fireRateMs: 750, magSize: 6, reloadMs: 1400, spread: 0.01, range: 90, kind: "projectile", projectileSpeed: 55, speedMul: 1.05, chargeable: true, chargeMs: 1100, minChargeDamageMul: 0.35 },
    ability: { id: "chuva_flechas", name: "Chuva de Flechas", cooldownMs: 18000, durationMs: 4200 }
  },
  crossbow: {
    id: "crossbow", name: "Besteiro", color: "#c98bff",
    primary: { id: "crossbow", name: "Besta", damage: 75, fireRateMs: 1100, magSize: 4, reloadMs: 2000, spread: 0.005, range: 100, kind: "projectile", projectileSpeed: 70, speedMul: 0.95 },
    ability: { id: "arpao_corrente", name: "Arpao de Corrente", cooldownMs: 16000, durationMs: 3200 }
  },
  smg: {
    id: "smg", name: "SMG", color: "#ffd23f",
    primary: { id: "smg", name: "Submetralhadora", damage: 14, fireRateMs: 75, magSize: 32, reloadMs: 1400, spread: 0.04, range: 40, kind: "hitscan", auto: true, speedMul: 1.2 },
    ability: { id: "sprint_tatico", name: "Sprint Tatico", cooldownMs: 15000, durationMs: 4000 }
  },
  rifle: {
    id: "rifle", name: "Fuzil", color: "#ff8c42",
    primary: { id: "assault_rifle", name: "Rifle de Assalto", damage: 20, fireRateMs: 105, magSize: 28, reloadMs: 1650, spread: 0.018, range: 65, kind: "hitscan", auto: true, speedMul: 1 },
    ability: { id: "adrenalina", name: "Adrenalina", cooldownMs: 16000, durationMs: 5000 }
  },
  heavy: {
    id: "heavy", name: "Metralhadora", color: "#ff5d5d",
    primary: { id: "heavy_mg", name: "Metralhadora Pesada", damage: 17, fireRateMs: 85, magSize: 60, reloadMs: 2600, spread: 0.03, range: 55, kind: "hitscan", auto: true, speedMul: 0.8 },
    ability: { id: "supressao", name: "Supressao", cooldownMs: 20000, durationMs: 5000 }
  },
  gunslinger: {
    id: "gunslinger", name: "Pistoleiro", color: "#f2f2f2",
    primary: { id: "heavy_pistol", name: "Pistola Pesada", damage: 55, fireRateMs: 380, magSize: 7, reloadMs: 1500, spread: 0.008, range: 55, kind: "hitscan", speedMul: 1.05 },
    ability: { id: "saque_rapido", name: "Saque Rapido", cooldownMs: 14000, durationMs: 4000 }
  }
};
const CLASS_IDS = Object.keys(CLASSES);

// Armas secundarias, disponiveis para qualquer classe (se a sala permitir).
const SECONDARY_WEAPONS = {
  pistol_common: { id: "pistol_common", name: "Pistola", damage: 18, fireRateMs: 220, magSize: 10, reloadMs: 1000, spread: 0.02, range: 35, kind: "hitscan" },
  mini_shotgun: { id: "mini_shotgun", name: "Mini Shotgun", damage: 10, pellets: 5, fireRateMs: 550, magSize: 4, reloadMs: 1800, spread: 0.11, range: 14, kind: "hitscan" },
  revolver: { id: "revolver", name: "Revolver", damage: 40, fireRateMs: 420, magSize: 6, reloadMs: 1600, spread: 0.012, range: 45, kind: "hitscan" },
  knife: { id: "knife", name: "Faca", damage: 65, fireRateMs: 500, magSize: 1, reloadMs: 0, spread: 0, range: 2.4, kind: "melee" },
  auto_pistol_weak: { id: "auto_pistol_weak", name: "Pistola Automatica", damage: 9, fireRateMs: 90, magSize: 18, reloadMs: 1200, spread: 0.03, range: 30, kind: "hitscan", auto: true }
};
const SECONDARY_IDS = Object.keys(SECONDARY_WEAPONS);

// Granadas, limitadas por vida (padrao 2 cargas).
const GRENADES = {
  explosive: { id: "explosive", name: "Explosiva", radius: 7, damage: 82, minDamage: 12, fuseMs: 1600, detonateOnImpact: false },
  smoke: { id: "smoke", name: "Fumaca", radius: 8, damage: 0, fuseMs: 900, durationMs: 7000, detonateOnImpact: false },
  flash: { id: "flash", name: "Flashbang", radius: 9, damage: 0, fuseMs: 900, blindMs: 3000, detonateOnImpact: false },
  molotov: { id: "molotov", name: "Molotov", radius: 6.5, damage: 26, minDamage: 8, fuseMs: 700, burnDamage: 9, burnTicks: 5, burnTickMs: 900, durationMs: 5200, detonateOnImpact: true },
  impact: { id: "impact", name: "Impacto", radius: 5.5, damage: 62, minDamage: 12, fuseMs: 0, detonateOnImpact: true }
};
const GRENADE_IDS = Object.keys(GRENADES);
const GRENADE_CHARGES_PER_LIFE = 2;

const MAP_IDS = ["mundo"];
const MAP_META = {
  mundo: { id: "mundo", name: "Mundo Unificado" },
  sketchbook: { id: "sketchbook", name: "Sketchbook" },
  praia: { id: "praia", name: "Praia" },
  cidade: { id: "cidade", name: "Cidade" },
  floresta: { id: "floresta", name: "Floresta" }
};

const MAP_HALF_SIZES = { mundo: 260, sketchbook: 190, praia: 128, cidade: 124, floresta: 168 };
const SKETCHBOOK_GROUND_Y = 5.35;
const SKETCHBOOK_PLAYABLE_AREAS = [
  { minX: -74, maxX: 74, minZ: -58, maxZ: 53 },
  { minX: -13, maxX: 13, minZ: 50, maxZ: 125 },
  { minX: -14, maxX: 14, minZ: 118, maxZ: 184 }
];

const VEHICLE_SPAWNS = {
  mundo: [
    { id: "world-humvee-a", type: "car", x: -238, y: 0.2, z: -92, yaw: 0 },
    { id: "world-humvee-b", type: "car", x: -102, y: 0.2, z: 52, yaw: Math.PI },
    { id: "world-bike-a", type: "motorcycle", x: -154, y: 0.2, z: -181, yaw: 0 },
    { id: "world-bike-b", type: "motorcycle", x: -50, y: 0.2, z: 24, yaw: Math.PI },
    { id: "world-quad", type: "quad", x: -23, y: 0.25, z: 82, yaw: -Math.PI / 2 },
    { id: "world-plane", type: "plane", x: -238, y: 0.35, z: 55, yaw: -Math.PI / 2 },
    { id: "world-helicopter", type: "helicopter", x: -180, y: 45.2, z: -195, yaw: Math.PI },
    { id: "world-jetski-a", type: "jetski", x: -62, y: 0.25, z: 224, yaw: Math.PI },
    { id: "world-jetski-b", type: "jetski", x: 54, y: 0.25, z: 230, yaw: Math.PI }
  ],
  sketchbook: [
    { id: "sketch-car-left", type: "car", x: -48, y: SKETCHBOOK_GROUND_Y, z: 30, yaw: Math.PI / 2 },
    { id: "sketch-car-right", type: "car", x: 48, y: SKETCHBOOK_GROUND_Y, z: -30, yaw: -Math.PI / 2 },
    { id: "sketch-plane", type: "plane", x: 0, y: SKETCHBOOK_GROUND_Y, z: 28, yaw: Math.PI },
    { id: "sketch-heli", type: "helicopter", x: -48, y: SKETCHBOOK_GROUND_Y + 0.85, z: -4, yaw: Math.PI / 2 }
  ],
  cidade: [
    { id: "city-car-red", type: "car", x: -52, y: 0, z: -8, yaw: Math.PI / 2 },
    { id: "city-car-blue", type: "car", x: 52, y: 0, z: 8, yaw: -Math.PI / 2 },
    { id: "city-bike-east", type: "motorcycle", x: 18, y: 0, z: 58, yaw: Math.PI },
    { id: "city-bike-west", type: "motorcycle", x: -18, y: 0, z: -58, yaw: 0 },
    { id: "city-quad-park", type: "quad", x: -72, y: 0, z: 42, yaw: Math.PI / 2 }
  ],
  floresta: [
    { id: "forest-plane", type: "plane", x: -100, y: 3, z: 0, yaw: -Math.PI / 2 },
    { id: "forest-helicopter", type: "helicopter", x: -80, y: 3, z: -30, yaw: Math.PI / 2 },
    { id: "forest-car-camp", type: "car", x: -60, y: 1, z: -70, yaw: 0 },
    { id: "forest-car-trail", type: "car", x: -100, y: 0.85, z: 10, yaw: Math.PI },
    { id: "forest-bike-trail", type: "motorcycle", x: -20, y: 1.8, z: -50, yaw: -0.35 },
    { id: "forest-quad-lodge", type: "quad", x: -50, y: 6.5, z: 70, yaw: 0.7 },
    { id: "forest-cannon-west", type: "cannon", x: -118, y: 4.7, z: -18, yaw: Math.PI / 2 },
    { id: "forest-cannon-east", type: "cannon", x: 118, y: 8.35, z: 18, yaw: -Math.PI / 2 }
  ],
  praia: [
    { id: "beach-jetski-a", type: "jetski", x: -34, y: 0.2, z: 82, yaw: Math.PI },
    { id: "beach-jetski-b", type: "jetski", x: 28, y: 0.2, z: 91, yaw: Math.PI },
    { id: "beach-quad", type: "quad", x: -62, y: 0, z: -24, yaw: Math.PI / 2 },
    { id: "beach-plane", type: "plane", x: 72, y: 7, z: 28, yaw: -Math.PI / 2 },
    { id: "beach-car-dunes", type: "car", x: 54, y: 0, z: -64, yaw: -0.7 }
  ]
};

const VEHICLE_STATS = {
  car: { maxHealth: 1200, maxSpeed: 19, acceleration: 15, turnSpeed: 1.8 },
  motorcycle: { maxHealth: 1200, maxSpeed: 25, acceleration: 19, turnSpeed: 2.25 },
  quad: { maxHealth: 1200, maxSpeed: 17, acceleration: 14, turnSpeed: 1.9 },
  jetski: { maxHealth: 1200, maxSpeed: 23, acceleration: 17, turnSpeed: 1.75 },
  plane: { maxHealth: 1200, maxSpeed: 34, acceleration: 11, turnSpeed: 1.15, builtInWeapon: true, bombCooldownMs: 25000 },
  helicopter: { maxHealth: 1200, maxSpeed: 28, acceleration: 10, turnSpeed: 1.45, builtInWeapon: true },
  cannon: { maxHealth: 1200, maxSpeed: 0, acceleration: 0, turnSpeed: 0.8, builtInWeapon: true }
};

const ARENA_HALF = 92;

// Pontos de spawn por mapa (compartilhado com public/js/maps.js no cliente).
const MAP_SPAWNS = {
  mundo: {
    ffa: [
      { x: -206, y: 0.2, z: 53, yaw: Math.PI },
      { x: -102, y: 0.2, z: 53, yaw: Math.PI },
      { x: -238, y: 0.2, z: -136, yaw: Math.PI / 2 },
      { x: -154, y: 0.2, z: -224, yaw: 0 },
      { x: -50, y: 0.2, z: -108, yaw: -Math.PI / 2 },
      { x: -32, y: 0.2, z: 62, yaw: -Math.PI / 2 },
      { x: -190, y: 0.2, z: 117, yaw: Math.PI },
      { x: 182, y: 0.2, z: 146, yaw: Math.PI }
    ],
    teams: {
      red: [
        { x: -238, y: 0.2, z: -136, yaw: Math.PI / 2 },
        { x: -206, y: 0.2, z: 53, yaw: Math.PI },
        { x: -154, y: 0.2, z: -224, yaw: 0 },
        { x: -50, y: 0.2, z: -108, yaw: -Math.PI / 2 }
      ],
      blue: [
        { x: -32, y: 0.2, z: 62, yaw: -Math.PI / 2 },
        { x: 182, y: 0.2, z: 146, yaw: Math.PI },
        { x: 78, y: 0.2, z: 145, yaw: Math.PI },
        { x: 235, y: 0.2, z: 154, yaw: Math.PI }
      ]
    }
  },
  sketchbook: {
    ffa: [
      { x: 0, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: 0 },
      { x: -36, y: SKETCHBOOK_GROUND_Y, z: 28, yaw: 1.9 },
      { x: 36, y: SKETCHBOOK_GROUND_Y, z: -28, yaw: -1.2 },
      { x: -40, y: SKETCHBOOK_GROUND_Y, z: -4, yaw: Math.PI / 2 },
      { x: 40, y: SKETCHBOOK_GROUND_Y, z: 4, yaw: -Math.PI / 2 },
      { x: -28, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: Math.PI / 2 },
      { x: 28, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: -Math.PI / 2 },
      { x: 0, y: SKETCHBOOK_GROUND_Y, z: 12, yaw: Math.PI }
    ],
    teams: {
      red: [
        { x: -40, y: SKETCHBOOK_GROUND_Y, z: -4, yaw: Math.PI / 2 },
        { x: -36, y: SKETCHBOOK_GROUND_Y, z: 28, yaw: 1.9 },
        { x: -28, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: Math.PI / 2 },
        { x: -48, y: SKETCHBOOK_GROUND_Y, z: 30, yaw: 1.45 }
      ],
      blue: [
        { x: 40, y: SKETCHBOOK_GROUND_Y, z: 4, yaw: -Math.PI / 2 },
        { x: 36, y: SKETCHBOOK_GROUND_Y, z: -28, yaw: -1.2 },
        { x: 28, y: SKETCHBOOK_GROUND_Y, z: 0, yaw: -Math.PI / 2 },
        { x: 48, y: SKETCHBOOK_GROUND_Y, z: -30, yaw: -1.7 }
      ]
    }
  },
  praia: {
    ffa: [
      { x: -76, y: 0, z: -66, yaw: 0.78 }, { x: 76, y: 0, z: -66, yaw: -0.78 },
      { x: -82, y: 0, z: 26, yaw: 2.1 }, { x: 82, y: 0, z: 30, yaw: -2.1 },
      { x: -18, y: 0, z: -86, yaw: 0.15 }, { x: 18, y: 0, z: 52, yaw: Math.PI },
      { x: -106, y: 0, z: -6, yaw: Math.PI / 2 }, { x: 106, y: 0, z: -4, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -82, y: 0, z: -66, yaw: 0.78 }, { x: -72, y: 0, z: -42, yaw: 0.6 }, { x: -48, y: 0, z: -84, yaw: 1 }, { x: -104, y: 0, z: -8, yaw: Math.PI / 2 }],
      blue: [{ x: 82, y: 0, z: 36, yaw: -2.35 }, { x: 72, y: 0, z: 18, yaw: -2.6 }, { x: 48, y: 0, z: 52, yaw: -2 }, { x: 104, y: 0, z: -6, yaw: -Math.PI / 2 }]
    }
  },
  cidade: {
    ffa: [
      { x: -84, y: 0, z: -84, yaw: 0.78 }, { x: 84, y: 0, z: -84, yaw: -0.78 },
      { x: -84, y: 0, z: 84, yaw: 2.35 }, { x: 84, y: 0, z: 84, yaw: -2.35 },
      { x: 0, y: 0, z: -102, yaw: 0 }, { x: 0, y: 0, z: 102, yaw: Math.PI },
      { x: -102, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 102, y: 0, z: 0, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -86, y: 0, z: -86, yaw: 0.78 }, { x: -86, y: 0, z: -58, yaw: 0.6 }, { x: -58, y: 0, z: -86, yaw: 1 }, { x: -102, y: 0, z: 0, yaw: Math.PI / 2 }],
      blue: [{ x: 86, y: 0, z: 86, yaw: -2.35 }, { x: 86, y: 0, z: 58, yaw: -2.6 }, { x: 58, y: 0, z: 86, yaw: -2 }, { x: 102, y: 0, z: 0, yaw: -Math.PI / 2 }]
    }
  },
  floresta: {
    ffa: [
      { x: -54, y: 0, z: -78, yaw: 0.62 }, { x: 54, y: 0, z: 78, yaw: -2.52 },
      { x: -76, y: 0, z: 34, yaw: 1.35 }, { x: 76, y: 0, z: -34, yaw: -1.8 },
      { x: 0, y: 0, z: -106, yaw: 0 }, { x: 0, y: 0, z: 106, yaw: Math.PI },
      { x: -102, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 102, y: 0, z: 0, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -64, y: 0, z: -72, yaw: 0.7 }, { x: -84, y: 0, z: -28, yaw: 1.2 }, { x: -38, y: 0, z: -92, yaw: 0.35 }, { x: -96, y: 0, z: 12, yaw: Math.PI / 2 }],
      blue: [{ x: 64, y: 0, z: 72, yaw: -2.45 }, { x: 84, y: 0, z: 28, yaw: -1.95 }, { x: 38, y: 0, z: 92, yaw: -2.8 }, { x: 96, y: 0, z: -12, yaw: -Math.PI / 2 }]
    }
  }
};

function pickSpawn(mapId, mode, team) {
  const map = MAP_SPAWNS[mapId] || MAP_SPAWNS.mundo;
  const list = mode === "teams" ? (map.teams[team === "blue" ? "blue" : "red"] || map.ffa) : map.ffa;
  return list[Math.floor(Math.random() * list.length)];
}

function pointInArea(area, x, z) {
  return x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;
}

function closestPointOnArea(area, x, z) {
  return {
    x: clamp(x, area.minX, area.maxX),
    z: clamp(z, area.minZ, area.maxZ)
  };
}

function constrainMapPosition(mapId, position = {}) {
  const x = Number(position.x) || 0;
  const z = Number(position.z) || 0;
  if (mapId !== "sketchbook") return { x, z, y: position.y };
  if (SKETCHBOOK_PLAYABLE_AREAS.some((area) => pointInArea(area, x, z))) {
    return { x, z, y: position.y };
  }

  let best = null;
  for (const area of SKETCHBOOK_PLAYABLE_AREAS) {
    const point = closestPointOnArea(area, x, z);
    const dist = Math.hypot(point.x - x, point.z - z);
    if (!best || dist < best.dist) best = { ...point, dist };
  }
  return {
    x: best?.x ?? 0,
    z: best?.z ?? 0,
    y: SKETCHBOOK_GROUND_Y
  };
}

const MATCH_DURATIONS_MIN = [3, 5, 10, 15];
const SCORE_LIMITS = [25, 50, 100, 200];
const MODES = ["ffa", "teams"];

const DEFAULT_SETTINGS = {
  durationMin: 10,
  scoreLimit: 50,
  mode: "ffa",
  moveSpeedMul: 1,
  jumpHeightMul: 1,
  grenadesEnabled: true,
  secondaryEnabled: true,
  maxPlayers: 16
};

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeSettings(input = {}) {
  return {
    durationMin: MATCH_DURATIONS_MIN.includes(Number(input.durationMin)) ? Number(input.durationMin) : DEFAULT_SETTINGS.durationMin,
    scoreLimit: SCORE_LIMITS.includes(Number(input.scoreLimit)) ? Number(input.scoreLimit) : DEFAULT_SETTINGS.scoreLimit,
    mode: MODES.includes(input.mode) ? input.mode : DEFAULT_SETTINGS.mode,
    moveSpeedMul: clamp(input.moveSpeedMul, 0.7, 1.4),
    jumpHeightMul: clamp(input.jumpHeightMul, 0.7, 1.6),
    grenadesEnabled: input.grenadesEnabled !== false,
    secondaryEnabled: input.secondaryEnabled !== false,
    maxPlayers: Math.round(clamp(input.maxPlayers, 2, 16)),
    mapId: MAP_IDS.includes(input.mapId) ? input.mapId : "mundo"
  };
}

module.exports = {
  HEADSHOT_MULTIPLIER,
  INSTANT_KILL_HEADSHOT_WEAPONS,
  CLASSES, CLASS_IDS,
  SECONDARY_WEAPONS, SECONDARY_IDS,
  GRENADES, GRENADE_IDS, GRENADE_CHARGES_PER_LIFE,
  MAP_IDS, MAP_META, MAP_SPAWNS, ARENA_HALF,
  MAP_HALF_SIZES, VEHICLE_SPAWNS, VEHICLE_STATS,
  SKETCHBOOK_GROUND_Y, SKETCHBOOK_PLAYABLE_AREAS, constrainMapPosition,
  MATCH_DURATIONS_MIN, SCORE_LIMITS, MODES,
  DEFAULT_SETTINGS,
  normalizeSettings,
  clamp,
  pickSpawn
};
