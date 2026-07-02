"use strict";

// Config autoritativa do servidor. Espelhada em public/js/config.js para o cliente
// prever visualmente (sway, HUD, animações) — o dano/acerto real sempre é validado aqui.

const HEADSHOT_MULTIPLIER = 2;

// Classes jogaveis: arma principal + habilidade unica com cooldown.
const CLASSES = {
  sniper: {
    id: "sniper", name: "Sniper", color: "#4fd1ff",
    primary: { id: "sniper_rifle", name: "Rifle Sniper", damage: 90, fireRateMs: 1300, magSize: 5, reloadMs: 2300, spread: 0.001, range: 140, kind: "hitscan", speedMul: 0.85 },
    ability: { id: "foco_letal", name: "Foco Letal", cooldownMs: 18000, durationMs: 4000 }
  },
  archer: {
    id: "archer", name: "Arqueiro", color: "#8bd450",
    primary: { id: "bow", name: "Arco", damage: 55, fireRateMs: 750, magSize: 6, reloadMs: 1400, spread: 0.01, range: 90, kind: "projectile", projectileSpeed: 55, speedMul: 1.05 },
    ability: { id: "flecha_explosiva", name: "Flecha Explosiva", cooldownMs: 14000, durationMs: 0 }
  },
  crossbow: {
    id: "crossbow", name: "Besteiro", color: "#c98bff",
    primary: { id: "crossbow", name: "Besta", damage: 75, fireRateMs: 1100, magSize: 4, reloadMs: 2000, spread: 0.005, range: 100, kind: "projectile", projectileSpeed: 70, speedMul: 0.95 },
    ability: { id: "disparo_perfurante", name: "Disparo Perfurante", cooldownMs: 16000, durationMs: 0 }
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
  explosive: { id: "explosive", name: "Explosiva", radius: 5, damage: 70, minDamage: 10, fuseMs: 1600, detonateOnImpact: false },
  smoke: { id: "smoke", name: "Fumaca", radius: 6, damage: 0, fuseMs: 900, durationMs: 6000, detonateOnImpact: false },
  flash: { id: "flash", name: "Flash", radius: 7, damage: 0, fuseMs: 900, blindMs: 2500, detonateOnImpact: false },
  impact: { id: "impact", name: "Impacto", radius: 4, damage: 55, minDamage: 10, fuseMs: 0, detonateOnImpact: true }
};
const GRENADE_IDS = Object.keys(GRENADES);
const GRENADE_CHARGES_PER_LIFE = 2;

const MAP_IDS = ["praia", "cidade", "floresta"];
const MAP_META = {
  praia: { id: "praia", name: "Praia" },
  cidade: { id: "cidade", name: "Cidade" },
  floresta: { id: "floresta", name: "Floresta" }
};

const ARENA_HALF = 38;

// Pontos de spawn por mapa (compartilhado com public/js/maps.js no cliente).
const MAP_SPAWNS = {
  praia: {
    ffa: [
      { x: -30, y: 0, z: -30, yaw: 0.78 }, { x: 30, y: 0, z: -30, yaw: -0.78 },
      { x: -30, y: 0, z: 30, yaw: 2.35 }, { x: 30, y: 0, z: 30, yaw: -2.35 },
      { x: 0, y: 0, z: -34, yaw: 0 }, { x: 0, y: 0, z: 34, yaw: Math.PI },
      { x: -34, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 34, y: 0, z: 0, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -32, y: 0, z: -32, yaw: 0.78 }, { x: -32, y: 0, z: -20, yaw: 0.6 }, { x: -20, y: 0, z: -32, yaw: 1 }, { x: -32, y: 0, z: 0, yaw: Math.PI / 2 }],
      blue: [{ x: 32, y: 0, z: 32, yaw: -2.35 }, { x: 32, y: 0, z: 20, yaw: -2.6 }, { x: 20, y: 0, z: 32, yaw: -2 }, { x: 32, y: 0, z: 0, yaw: -Math.PI / 2 }]
    }
  },
  cidade: {
    ffa: [
      { x: -28, y: 0, z: -28, yaw: 0.78 }, { x: 28, y: 0, z: -28, yaw: -0.78 },
      { x: -28, y: 0, z: 28, yaw: 2.35 }, { x: 28, y: 0, z: 28, yaw: -2.35 },
      { x: 0, y: 0, z: -32, yaw: 0 }, { x: 0, y: 0, z: 32, yaw: Math.PI },
      { x: -32, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 32, y: 0, z: 0, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -30, y: 0, z: -30, yaw: 0.78 }, { x: -30, y: 0, z: -18, yaw: 0.6 }, { x: -18, y: 0, z: -30, yaw: 1 }, { x: -30, y: 0, z: 0, yaw: Math.PI / 2 }],
      blue: [{ x: 30, y: 0, z: 30, yaw: -2.35 }, { x: 30, y: 0, z: 18, yaw: -2.6 }, { x: 18, y: 0, z: 30, yaw: -2 }, { x: 30, y: 0, z: 0, yaw: -Math.PI / 2 }]
    }
  },
  floresta: {
    ffa: [
      { x: -30, y: 0, z: -30, yaw: 0.78 }, { x: 30, y: 0, z: -30, yaw: -0.78 },
      { x: -30, y: 0, z: 30, yaw: 2.35 }, { x: 30, y: 0, z: 30, yaw: -2.35 },
      { x: 0, y: 0, z: -34, yaw: 0 }, { x: 0, y: 0, z: 34, yaw: Math.PI },
      { x: -34, y: 0, z: 0, yaw: Math.PI / 2 }, { x: 34, y: 0, z: 0, yaw: -Math.PI / 2 }
    ],
    teams: {
      red: [{ x: -32, y: 0, z: -32, yaw: 0.78 }, { x: -32, y: 0, z: -20, yaw: 0.6 }, { x: -20, y: 0, z: -32, yaw: 1 }, { x: -32, y: 0, z: 0, yaw: Math.PI / 2 }],
      blue: [{ x: 32, y: 0, z: 32, yaw: -2.35 }, { x: 32, y: 0, z: 20, yaw: -2.6 }, { x: 20, y: 0, z: 32, yaw: -2 }, { x: 32, y: 0, z: 0, yaw: -Math.PI / 2 }]
    }
  }
};

function pickSpawn(mapId, mode, team) {
  const map = MAP_SPAWNS[mapId] || MAP_SPAWNS.praia;
  const list = mode === "teams" ? (map.teams[team === "blue" ? "blue" : "red"] || map.ffa) : map.ffa;
  return list[Math.floor(Math.random() * list.length)];
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
  maxPlayers: 10
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
    mapId: MAP_IDS.includes(input.mapId) ? input.mapId : "praia"
  };
}

module.exports = {
  HEADSHOT_MULTIPLIER,
  CLASSES, CLASS_IDS,
  SECONDARY_WEAPONS, SECONDARY_IDS,
  GRENADES, GRENADE_IDS, GRENADE_CHARGES_PER_LIFE,
  MAP_IDS, MAP_META, MAP_SPAWNS, ARENA_HALF,
  MATCH_DURATIONS_MIN, SCORE_LIMITS, MODES,
  DEFAULT_SETTINGS,
  normalizeSettings,
  clamp,
  pickSpawn
};
