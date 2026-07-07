"use strict";

const ARENA_HALF = 42;
const MOVE_SPEED = 7.4;
const TICK_MS = 50;
const MOVE_SEND_MS = 60;
const MATCH_MS = 6 * 60 * 1000;
const RESPAWN_MS = 2600;
const HERO_COOLDOWN_MS = 9000;

const HEROES = {
  archer: {
    id: "archer", name: "Arqueira", role: "Atiradora", model: "Rogue_Hooded.glb",
    color: "#8bd450", hp: 130, speed: 1.08, range: 19, damage: 24, fireRateMs: 520,
    projectile: "arrow",
    ability: { id: "arrow_rain", name: "Chuva de flechas", cooldownMs: 9000, range: 23, radius: 5, damage: 34 },
    support: false
  },
  knight: {
    id: "knight", name: "Cavaleiro", role: "Tanque", model: "Knight.glb",
    color: "#6aa8ff", hp: 220, speed: 0.9, range: 4.2, damage: 34, fireRateMs: 640,
    ability: { id: "shield_dash", name: "Investida", cooldownMs: 8500, range: 8, radius: 3.5, damage: 38 },
    support: false
  },
  mage: {
    id: "mage", name: "Mago", role: "Area", model: "Mage.glb",
    color: "#c98bff", hp: 145, speed: 0.95, range: 17, damage: 28, fireRateMs: 720,
    projectile: "magic",
    ability: { id: "meteor", name: "Meteoro", cooldownMs: 11500, range: 22, radius: 5.5, damage: 52 },
    support: false
  },
  barbarian: {
    id: "barbarian", name: "Barbaro", role: "Brutamontes", model: "Barbarian.glb",
    color: "#ff9f43", hp: 190, speed: 1, range: 4.6, damage: 38, fireRateMs: 580,
    ability: { id: "rage", name: "Furia", cooldownMs: 10000, durationMs: 4200, damageMul: 1.45 },
    support: false
  },
  rogue: {
    id: "rogue", name: "Ladina", role: "Assassina", model: "Rogue.glb",
    color: "#f5d76e", hp: 120, speed: 1.22, range: 5, damage: 31, fireRateMs: 390,
    ability: { id: "smoke_step", name: "Passo sombrio", cooldownMs: 9000, range: 10, damage: 26 },
    support: false
  },
  giant: {
    id: "giant", name: "Gigante", role: "Cerco", model: "Barbarian.glb",
    color: "#df7d5e", hp: 430, speed: 0.64, range: 7, damage: 85, fireRateMs: 980, towerDamageMul: 2.25,
    visualScale: 2.65,
    ability: { id: "stomp", name: "Pisao", cooldownMs: 12000, radius: 5, damage: 46 },
    support: true
  },
  balloon: {
    id: "balloon", name: "Balao", role: "Aereo", model: "balloon",
    color: "#e96d88", hp: 180, speed: 0.82, range: 8, damage: 72, fireRateMs: 1250, towerDamageMul: 1.6,
    projectile: "bomb",
    canCrossWater: true,
    visualScale: 1.15,
    ability: { id: "support_call", name: "Carta suporte", cooldownMs: 15000 },
    support: false,
    canCallSupport: true
  },
  bomber: {
    id: "bomber", name: "Bombardeiro", role: "Explosivo", model: "Mage.glb",
    color: "#f0c34a", hp: 118, speed: 0.96, range: 14, damage: 30, fireRateMs: 760,
    projectile: "bomb",
    ability: { id: "big_bomb", name: "Bomba grande", cooldownMs: 10500, range: 16, radius: 5, damage: 48 },
    support: true
  },
  healer: {
    id: "healer", name: "Curandeira", role: "Suporte", model: "Mage.glb",
    color: "#7de0c5", hp: 150, speed: 1, range: 14, damage: 16, fireRateMs: 620,
    projectile: "heal",
    ability: { id: "heal_wave", name: "Onda de cura", cooldownMs: 11000, radius: 8, heal: 52 },
    support: true
  },
  lancer: {
    id: "lancer", name: "Lanceiro", role: "Anti-aereo", model: "Knight.glb",
    color: "#a6d3ff", hp: 155, speed: 1.03, range: 15, damage: 22, fireRateMs: 480,
    projectile: "spear",
    ability: { id: "pierce", name: "Lancada perfurante", cooldownMs: 9500, range: 18, radius: 3, damage: 42 },
    support: true
  },
  skeleton: {
    id: "skeleton", name: "Esqueleto", role: "Enxame", model: "skeleton",
    color: "#e7edf0", hp: 82, speed: 1.24, range: 3.8, damage: 18, fireRateMs: 430,
    visualScale: 0.82,
    ability: { id: "bone_dash", name: "Corrida ossea", cooldownMs: 7500, range: 7, radius: 2.7, damage: 24 },
    support: true
  },
  skeletonArcher: {
    id: "skeletonArcher", name: "Arq. Esqueleto", role: "Atirador fragil", model: "skeleton_archer",
    color: "#cfd9ff", hp: 72, speed: 1.1, range: 16, damage: 17, fireRateMs: 560,
    projectile: "bone_arrow",
    visualScale: 0.8,
    ability: { id: "bone_volley", name: "Rajada ossea", cooldownMs: 9500, range: 18, radius: 3.4, damage: 30 },
    support: true
  },
  witch: {
    id: "witch", name: "Bruxa", role: "Invocadora", model: "Mage.glb",
    color: "#a36bff", hp: 138, speed: 0.94, range: 15, damage: 22, fireRateMs: 760,
    projectile: "magic",
    summons: { heroId: "skeleton", count: 3, intervalMs: 5000, ttlMs: 12000, hpMul: 0.52, damageMul: 0.62 },
    ability: { id: "curse", name: "Maldicao", cooldownMs: 11000, range: 17, radius: 4.8, damage: 39 },
    support: false
  }
};

const HERO_ORDER = ["archer", "knight", "mage", "barbarian", "rogue", "giant", "balloon", "bomber", "healer", "lancer", "skeleton", "skeletonArcher", "witch"];
const DEFAULT_DECK = ["archer", "knight", "mage", "barbarian", "rogue", "giant", "bomber", "lancer"];
const SUPPORT_ORDER = ["knight", "archer", "bomber", "healer", "lancer", "giant", "skeleton", "skeletonArcher"];

const TOWER_LAYOUT = [
  { id: "red-left", team: "red", kind: "side", x: -14, z: 29, hp: 520 },
  { id: "red-right", team: "red", kind: "side", x: 14, z: 29, hp: 520 },
  { id: "red-king", team: "red", kind: "king", x: 0, z: 37, hp: 850 },
  { id: "blue-left", team: "blue", kind: "side", x: -14, z: -29, hp: 520 },
  { id: "blue-right", team: "blue", kind: "side", x: 14, z: -29, hp: 520 },
  { id: "blue-king", team: "blue", kind: "king", x: 0, z: -37, hp: 850 }
];

function cleanDeckSelection(deck) {
  const unique = [];
  (Array.isArray(deck) ? deck : []).forEach((id) => {
    if (HEROES[id] && !unique.includes(id)) unique.push(id);
  });
  return unique.slice(0, 8);
}

function normalizeDeck(deck) {
  const unique = cleanDeckSelection(Array.isArray(deck) ? deck : DEFAULT_DECK);
  HERO_ORDER.forEach((id) => {
    if (unique.length < 8 && !unique.includes(id)) unique.push(id);
  });
  return unique.slice(0, 8);
}

module.exports = {
  ARENA_HALF,
  MOVE_SPEED,
  TICK_MS,
  MOVE_SEND_MS,
  MATCH_MS,
  RESPAWN_MS,
  HERO_COOLDOWN_MS,
  HEROES,
  HERO_ORDER,
  DEFAULT_DECK,
  SUPPORT_ORDER,
  TOWER_LAYOUT,
  cleanDeckSelection,
  normalizeDeck
};
