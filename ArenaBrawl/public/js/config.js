// Espelho cliente de server/config.js. O servidor sempre valida o dano real;
// estes valores servem para HUD, previsao visual de tiro e cadencia.
export const HEADSHOT_MULTIPLIER = 2;

export const CLASSES = {
  sniper: {
    id: "sniper", name: "Sniper", color: "#4fd1ff", desc: "Dano altissimo, cadencia baixa, alcance longo.",
    primary: { id: "sniper_rifle", name: "Rifle Sniper", damage: 90, fireRateMs: 1300, magSize: 5, reloadMs: 2300, spread: 0.001, range: 140, kind: "hitscan", speedMul: 0.85 },
    ability: { id: "foco_letal", name: "Foco Letal", desc: "Zoom, mira estavel e realce de inimigos distantes.", cooldownMs: 18000, durationMs: 4000 }
  },
  archer: {
    id: "archer", name: "Arqueiro", color: "#8bd450", desc: "Disparo silencioso, flechas com trajetoria.",
    primary: { id: "bow", name: "Arco", damage: 55, fireRateMs: 750, magSize: 6, reloadMs: 1400, spread: 0.01, range: 90, kind: "projectile", projectileSpeed: 55, speedMul: 1.05, chargeable: true, chargeMs: 1100, minChargeDamageMul: 0.35 },
    ability: { id: "flecha_explosiva", name: "Flecha Explosiva", desc: "Proximo disparo explode em area.", cooldownMs: 14000, durationMs: 0 }
  },
  crossbow: {
    id: "crossbow", name: "Besteiro", color: "#c98bff", desc: "Mais lento, dano e precisao maiores.",
    primary: { id: "crossbow", name: "Besta", damage: 75, fireRateMs: 1100, magSize: 4, reloadMs: 2000, spread: 0.005, range: 100, kind: "projectile", projectileSpeed: 70, speedMul: 0.95 },
    ability: { id: "disparo_perfurante", name: "Disparo Perfurante", desc: "Atravessa o primeiro inimigo.", cooldownMs: 16000, durationMs: 0 }
  },
  smg: {
    id: "smg", name: "SMG", color: "#ffd23f", desc: "Cadencia alta, dano baixo, mobilidade otima.",
    primary: { id: "smg", name: "Submetralhadora", damage: 14, fireRateMs: 75, magSize: 32, reloadMs: 1400, spread: 0.04, range: 40, kind: "hitscan", auto: true, speedMul: 1.2 },
    ability: { id: "sprint_tatico", name: "Sprint Tatico", desc: "Aumenta muito a velocidade.", cooldownMs: 15000, durationMs: 4000 }
  },
  rifle: {
    id: "rifle", name: "Fuzil", color: "#ff8c42", desc: "Equilibrado em dano, alcance e cadencia.",
    primary: { id: "assault_rifle", name: "Rifle de Assalto", damage: 20, fireRateMs: 105, magSize: 28, reloadMs: 1650, spread: 0.018, range: 65, kind: "hitscan", auto: true, speedMul: 1 },
    ability: { id: "adrenalina", name: "Adrenalina", desc: "Reduz recuo, recarrega mais rapido.", cooldownMs: 16000, durationMs: 5000 }
  },
  heavy: {
    id: "heavy", name: "Metralhadora", color: "#ff5d5d", desc: "Muitos tiros, dano medio, mais lento.",
    primary: { id: "heavy_mg", name: "Metralhadora Pesada", damage: 17, fireRateMs: 85, magSize: 60, reloadMs: 2600, spread: 0.03, range: 55, kind: "hitscan", auto: true, speedMul: 0.8 },
    ability: { id: "supressao", name: "Supressao", desc: "Cadencia maior, porem mais lento.", cooldownMs: 20000, durationMs: 5000 }
  },
  gunslinger: {
    id: "gunslinger", name: "Pistoleiro", color: "#f2f2f2", desc: "Dano alto, pouca municao, exige precisao.",
    primary: { id: "heavy_pistol", name: "Pistola Pesada", damage: 55, fireRateMs: 380, magSize: 7, reloadMs: 1500, spread: 0.008, range: 55, kind: "hitscan", speedMul: 1.05 },
    ability: { id: "saque_rapido", name: "Saque Rapido", desc: "Dispara e recarrega mais rapido.", cooldownMs: 14000, durationMs: 4000 }
  }
};
export const CLASS_ORDER = ["rifle", "smg", "sniper", "heavy", "gunslinger", "archer", "crossbow"];

export const SECONDARY_WEAPONS = {
  pistol_common: { id: "pistol_common", name: "Pistola", damage: 18, fireRateMs: 220, magSize: 10, reloadMs: 1000, spread: 0.02, range: 35, kind: "hitscan" },
  mini_shotgun: { id: "mini_shotgun", name: "Mini Shotgun", damage: 10, pellets: 5, fireRateMs: 550, magSize: 4, reloadMs: 1800, spread: 0.11, range: 14, kind: "hitscan" },
  revolver: { id: "revolver", name: "Revolver", damage: 40, fireRateMs: 420, magSize: 6, reloadMs: 1600, spread: 0.012, range: 45, kind: "hitscan" },
  knife: { id: "knife", name: "Faca", damage: 65, fireRateMs: 500, magSize: 1, reloadMs: 0, spread: 0, range: 2.4, kind: "melee" },
  auto_pistol_weak: { id: "auto_pistol_weak", name: "Pistola Automatica", damage: 9, fireRateMs: 90, magSize: 18, reloadMs: 1200, spread: 0.03, range: 30, kind: "hitscan", auto: true }
};
export const SECONDARY_ORDER = ["pistol_common", "revolver", "mini_shotgun", "auto_pistol_weak", "knife"];

export const GRENADES = {
  explosive: { id: "explosive", name: "Explosiva", radius: 5, fuseMs: 1600, color: 0x333333 },
  smoke: { id: "smoke", name: "Fumaca", radius: 6, fuseMs: 900, durationMs: 6000, color: 0xaaaaaa },
  flash: { id: "flash", name: "Flash", radius: 7, fuseMs: 900, color: 0xffffff },
  impact: { id: "impact", name: "Impacto", radius: 4, fuseMs: 0, color: 0x883333 }
};
export const GRENADE_ORDER = ["explosive", "smoke", "flash", "impact"];
export const GRENADE_CHARGES_PER_LIFE = 2;

export const MAP_META = {
  mundo: { id: "mundo", name: "Mundo Unificado", sky: 0x91c9ee, ground: 0x4f723f },
  sketchbook: { id: "sketchbook", name: "Sketchbook", sky: 0xb7d6e6, ground: 0xd9d2bf },
  praia: { id: "praia", name: "Praia", sky: 0x8fd6ff, ground: 0xe8d68a },
  cidade: { id: "cidade", name: "Cidade", sky: 0x9fb0c2, ground: 0x6b6f75 },
  floresta: { id: "floresta", name: "Floresta", sky: 0x9fd1ff, ground: 0x3f5c34 }
};
export const MAP_ORDER = ["mundo"];

export const MAP_HALF_SIZES = { mundo: 260, sketchbook: 190, praia: 128, cidade: 124, floresta: 168 };
export const SKETCHBOOK_GROUND_Y = 5.35;

export const VEHICLE_SPAWNS = {
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

export const VEHICLE_STATS = {
  car: { name: "Carro", maxHealth: 1200, maxSpeed: 19 },
  motorcycle: { name: "Moto", maxHealth: 1200, maxSpeed: 25 },
  quad: { name: "Quadriciclo", maxHealth: 1200, maxSpeed: 17 },
  jetski: { name: "Jetski", maxHealth: 1200, maxSpeed: 23 },
  plane: { name: "Aviao", maxHealth: 1200, maxSpeed: 34, builtInWeapon: true, bombCooldownMs: 25000 },
  helicopter: { name: "Helicoptero", maxHealth: 1200, maxSpeed: 28, builtInWeapon: true },
  cannon: { name: "Canhao", maxHealth: 1200, maxSpeed: 0, builtInWeapon: true }
};

export const MATCH_DURATIONS_MIN = [3, 5, 10, 15];
export const SCORE_LIMITS = [25, 50, 100, 200];

export const ARENA_HALF = 92;
export const EYE_HEIGHT = 1.7;
export const GRAVITY = -22;
export const WALK_SPEED = 6.4;
export const SPRINT_MUL = 1.55;
export const CROUCH_MUL = 0.5;
export const MOVE_SEND_MS = 60;
