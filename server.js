/**
 * Servidor Álbum da Copa — Multiplayer + Auth + Persistência
 * Stack: Node.js · Express · Socket.io · JSON file storage · JWT
 * Sem dependências nativas — funciona em qualquer versão do Node
 */

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const fs         = require("fs");
const path       = require("path");
const crypto     = require("crypto");

function loadLocalEnv() {
  const envFile = path.join(__dirname, ".env");
  if (!fs.existsSync(envFile)) return;

  fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) return;

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

loadLocalEnv();

function resolveConfiguredPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

// ─── Config ────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || "albumcopa_secret_mude_em_producao";
const SALT_ROUNDS = 10;
const DB_PATH_CONFIGURED = Boolean(process.env.DB_FILE || process.env.DATA_DIR);
const DATA_DIR    = process.env.DATA_DIR ? resolveConfiguredPath(process.env.DATA_DIR) : null;
const DB_FILE     = process.env.DB_FILE
  ? resolveConfiguredPath(process.env.DB_FILE)
  : path.join(DATA_DIR || __dirname, "db.json");
const DB_BACKUP_DIR = process.env.DB_BACKUP_DIR
  ? resolveConfiguredPath(process.env.DB_BACKUP_DIR)
  : path.join(path.dirname(DB_FILE), "backups");
const MAX_DB_BACKUPS = Math.max(1, Number(process.env.MAX_DB_BACKUPS || 20));
const DAILY_ALBUM_CREDITS = 30;
const INITIAL_BET_CREDITS = 550;
const PACK_COST = 15;
const PACK_SIZE = 3;
const MAX_STICKER_ID = 62;
const MARKET_PRICES = {
  common: 10,
  rare: 20,
  legendary: 30
};
const RARITY_SETTINGS = {
  common: { chance: 74.7, duplicateChance: 0.46 },
  rare: { chance: 24, duplicateChance: 0.22 },
  legendary: { chance: 1.3, duplicateChance: 0.10 }
};
const RARITY_ORDER = ["common", "rare", "legendary"];
const FARM_MAP = {
  width: 3200,
  height: 2400,
  tile: 32,
  merchant: { x: 1600, y: 1200, radius: 190 }
};
const FARM_ROTTEN_MS = 2 * 60 * 60 * 1000;
const FARM_FEED_MS = 4 * 60 * 60 * 1000;
const FARM_TOOL_TIERS = ["wood", "copper", "iron", "gold", "diamond"];
const FARM_TOOL_UPGRADE_COSTS = {
  copper: { wood: 8, copper: 6 },
  iron: { wood: 10, copper: 4, iron: 8 },
  gold: { iron: 10, gold: 6 },
  diamond: { gold: 8, diamond: 4 }
};
const FARM_CROPS = {
  turnip: { name: "Nabo", rarity: "common", seedKey: "seed_turnip", itemKey: "turnip", seedPrice: 4, sellPrice: 9, growMs: 90 * 1000, yield: 2 },
  carrot: { name: "Cenoura", rarity: "common", seedKey: "seed_carrot", itemKey: "carrot", seedPrice: 6, sellPrice: 13, growMs: 120 * 1000, yield: 2 },
  corn: { name: "Milho", rarity: "rare", seedKey: "seed_corn", itemKey: "corn", seedPrice: 18, sellPrice: 42, growMs: 12 * 60 * 1000, yield: 3 },
  grape: { name: "Uva", rarity: "rare", seedKey: "seed_grape", itemKey: "grape", seedPrice: 28, sellPrice: 72, growMs: 24 * 60 * 1000, yield: 3 },
  crystalBerry: { name: "Fruta Cristal", rarity: "legendary", seedKey: "seed_crystalBerry", itemKey: "crystalBerry", seedPrice: 80, sellPrice: 240, growMs: 60 * 60 * 1000, yield: 2 }
};
const FARM_ANIMALS = {
  chicken: { name: "Galinha", rarity: "common", price: 45, feedCost: 1, itemKey: "egg", itemName: "Ovo", sellPrice: 8, produceMs: 2 * 60 * 1000, yield: 1 },
  goat: { name: "Cabra", rarity: "common", price: 90, feedCost: 1, itemKey: "goatMilk", itemName: "Leite de cabra", sellPrice: 18, produceMs: 8 * 60 * 1000, yield: 1 },
  fish: { name: "Peixe", rarity: "rare", price: 140, feedCost: 1, itemKey: "fishFillet", itemName: "File de peixe", sellPrice: 32, produceMs: 18 * 60 * 1000, yield: 1 },
  cow: { name: "Vaca", rarity: "rare", price: 220, feedCost: 2, itemKey: "milk", itemName: "Leite", sellPrice: 44, produceMs: 30 * 60 * 1000, yield: 1, fertilizer: 1 },
  pig: { name: "Porco", rarity: "rare", price: 180, feedCost: 2, itemKey: "truffle", itemName: "Trufa", sellPrice: 36, produceMs: 22 * 60 * 1000, yield: 1, fertilizer: 1 },
  horse: { name: "Cavalo", rarity: "legendary", price: 430, feedCost: 2, itemKey: "horsehair", itemName: "Crina rara", sellPrice: 95, produceMs: 60 * 60 * 1000, yield: 1, fertilizer: 2 }
};
const FARM_RESOURCES = {
  tree: { name: "Arvore", itemKey: "wood", amount: 4, tool: "axe", tier: "wood", xp: 1 },
  stone: { name: "Pedra", itemKey: "stone", amount: 3, tool: "pickaxe", tier: "wood", xp: 1 },
  copper: { name: "Cobre", itemKey: "copper", amount: 2, tool: "pickaxe", tier: "wood", xp: 2 },
  iron: { name: "Ferro", itemKey: "iron", amount: 2, tool: "pickaxe", tier: "copper", xp: 3 },
  gold: { name: "Ouro", itemKey: "gold", amount: 1, tool: "pickaxe", tier: "iron", xp: 5 },
  diamond: { name: "Diamante", itemKey: "diamond", amount: 1, tool: "pickaxe", tier: "gold", xp: 9 }
};
const SERVER_STICKER_OVERRIDES = {
  55: { name: "Fabinho Cocorico", image: "assets/album-copa/figurinhas/fabinho%20cocorico.png" },
  56: { name: "Juiz", rarity: "rare", image: "assets/album-copa/figurinhas/Juiz.png" },
  57: { name: "Cascao Lendaria", rarity: "legendary", image: "assets/album-copa/figurinhas/Casc%C3%A3o%20lend%C3%A1ria.png" },
  58: { name: "Pablo Gaucho", rarity: "legendary", image: "assets/album-copa/figurinhas/Pablo%20Gaucho%20lend%C3%A1ria.png" },
  59: { name: "Pablo Jackson", rarity: "legendary", image: "assets/album-copa/figurinhas/Pablo%20Jackson%20Lend%C3%A1ria.png" },
  60: { name: "Pablo Neymar", rarity: "legendary", image: "assets/album-copa/figurinhas/Pablo%20neymar%20lend%C3%A1ria.png" },
  61: { name: "Pablo Tiro Certo", rarity: "rare", image: "assets/album-copa/figurinhas/Pablo%20tiro%20certo.png" },
  62: { name: "Pablo Vitar", rarity: "legendary", image: "assets/album-copa/figurinhas/Pablo%20Vitar%20lend%C3%A1ria.png" }
};

function defaultStickerRarity(stickerId) {
  const itemIndex = (stickerId - 1) % 9;
  if (itemIndex === 8) return "legendary";
  if (itemIndex === 2 || itemIndex === 5) return "rare";
  return "common";
}

function getServerSticker(stickerId) {
  const id = Number(stickerId);
  if (!Number.isInteger(id) || id < 1 || id > MAX_STICKER_ID) return null;

  const override = SERVER_STICKER_OVERRIDES[id] || {};
  return {
    id,
    code: `FIG-${String(id).padStart(2, "0")}`,
    name: override.name || `Figurinha ${String(id).padStart(2, "0")}`,
    image: override.image || `assets/album-copa/figurinhas/figurinha-${String(id).padStart(2, "0")}.png`,
    rarity: override.rarity || defaultStickerRarity(id)
  };
}

function getServerStickers() {
  return Array.from({ length: MAX_STICKER_ID }, (_, index) => getServerSticker(index + 1));
}

function normalizeStickerList(stickers) {
  if (!Array.isArray(stickers)) return [];

  const seen = new Set();
  return stickers.reduce((list, item) => {
    const id = Number(item?.id);
    if (!getServerSticker(id) || seen.has(id)) return list;
    if (!(item.unlocked || item.collected)) return list;

    seen.add(id);
    list.push({ id, unlocked: true });
    return list;
  }, []);
}

function normalizeDuplicateMap(duplicates) {
  if (!duplicates || Array.isArray(duplicates) || typeof duplicates !== "object") return {};

  return Object.entries(duplicates).reduce((map, [key, value]) => {
    const id = Number(key);
    const count = Math.floor(Number(value));
    if (getServerSticker(id) && count > 0) {
      map[id] = Math.min(count, 999);
    }
    return map;
  }, {});
}

function pickPackRarity() {
  const roll = Math.random() * 100;
  let accumulated = 0;

  for (const rarity of RARITY_ORDER) {
    accumulated += RARITY_SETTINGS[rarity].chance;
    if (roll < accumulated) return rarity;
  }

  return "common";
}

function pickServerStickerForRarity(rarity, ownedIds, usedIds) {
  const pool = getServerStickers().filter(sticker => sticker.rarity === rarity && !usedIds.has(sticker.id));
  const candidates = pool.length ? pool : getServerStickers().filter(sticker => sticker.rarity === rarity);
  const owned = candidates.filter(sticker => ownedIds.has(sticker.id));
  const locked = candidates.filter(sticker => !ownedIds.has(sticker.id));
  const shouldRepeat = owned.length && Math.random() < RARITY_SETTINGS[rarity].duplicateChance;

  if (shouldRepeat) return owned[Math.floor(Math.random() * owned.length)];
  if (locked.length) return locked[Math.floor(Math.random() * locked.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// ─── Banco de dados JSON ───────────────────────────────────────────────────
function ensureDbDir() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

let lastBackupDate = "";

function pruneDbBackups() {
  if (!fs.existsSync(DB_BACKUP_DIR)) return;

  const backups = fs.readdirSync(DB_BACKUP_DIR)
    .filter(name => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();

  while (backups.length > MAX_DB_BACKUPS) {
    const oldBackup = backups.shift();
    fs.unlinkSync(path.join(DB_BACKUP_DIR, oldBackup));
  }
}

function backupDbIfNeeded() {
  const date = todayKey();
  if (lastBackupDate === date || !fs.existsSync(DB_FILE)) return;

  fs.mkdirSync(DB_BACKUP_DIR, { recursive: true });
  const backupFile = path.join(DB_BACKUP_DIR, `db-${date}.json`);
  if (!fs.existsSync(backupFile)) {
    fs.copyFileSync(DB_FILE, backupFile);
    pruneDbBackups();
  }
  lastBackupDate = date;
}

function makeFarmLands() {
  const lands = [];
  const cols = 6;
  const rows = 4;
  const width = 210;
  const height = 160;
  const gap = 34;
  const startX = 700;
  const startY = 360;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      lands.push({
        id: `land-${index + 1}`,
        x: startX + col * (width + gap),
        y: startY + row * (height + gap),
        w: width,
        h: height,
        price: 70 + Math.floor(index / 3) * 18,
        ownerId: null,
        crop: null,
        animal: null,
        buildings: [],
        storage: {}
      });
    }
  }

  return lands;
}

function makeDefaultFarmWorld() {
  return {
    version: 1,
    map: FARM_MAP,
    lands: makeFarmLands(),
    created_at: new Date().toISOString()
  };
}

function loadDb() {
  ensureDbDir();
  if (!fs.existsSync(DB_FILE)) {
    saveDb({ users: [], matches: [], market_listings: [], farm_world: makeDefaultFarmWorld(), nextUserId: 1, nextMatchId: 1, nextMarketId: 1 });
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  backupDbIfNeeded();
  let changed = false;

  if (!Array.isArray(data.users)) {
    data.users = [];
    changed = true;
  }
  if (!Array.isArray(data.matches)) {
    data.matches = [];
    changed = true;
  }
  if (!Array.isArray(data.market_listings)) {
    data.market_listings = [];
    changed = true;
  }
  if (!data.farm_world || !Array.isArray(data.farm_world.lands)) {
    data.farm_world = makeDefaultFarmWorld();
    changed = true;
  }
  if (!Number.isFinite(Number(data.nextUserId))) {
    data.nextUserId = 1;
    changed = true;
  }
  if (!Number.isFinite(Number(data.nextMatchId))) {
    data.nextMatchId = 1;
    changed = true;
  }
  if (!Number.isFinite(Number(data.nextMarketId))) {
    data.nextMarketId = 1;
    changed = true;
  }

  if (changed) saveDb(data);
  return data;
}

function saveDb(db) {
  ensureDbDir();
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// Helpers de consulta (síncronos, thread-safe pelo event loop do Node)
const db = {
  findUser(field, value) {
    return loadDb().users.find(u => u[field] === value) || null;
  },
  createUser(username, password_hash) {
    const data = loadDb();
    const user = {
      id:               data.nextUserId++,
      username,
      password_hash,
      avatar:           "",
      credits:          DAILY_ALBUM_CREDITS,
      bet_credits:      INITIAL_BET_CREDITS,
      exchange_wins:    0,
      bj_wins:          0,
      stickers:         [],
      duplicates:       {},
      pending_stickers: [],
      farm:             makeDefaultFarmState(),
      last_sale_day:    "",
      initial_bet_credits_granted: INITIAL_BET_CREDITS,
      last_album_credit_day: todayKey(),
      created_at:       new Date().toISOString()
    };
    data.users.push(user);
    saveDb(data);
    return user;
  },
  updateUser(id, fields) {
    const data = loadDb();
    const idx  = data.users.findIndex(u => u.id === id);
    if (idx === -1) return null;
    Object.assign(data.users[idx], fields);
    saveDb(data);
    return data.users[idx];
  },
  createMatch(player1_id, player2_id, player1_bet, player2_bet) {
    const data  = loadDb();
    const match = {
      id:            data.nextMatchId++,
      player1_id,
      player2_id,
      player1_bet,
      player2_bet,
      player1_score: 0,
      player2_score: 0,
      winner_id:     null,
      status:        "active",
      created_at:    new Date().toISOString()
    };
    data.matches.push(match);
    saveDb(data);
    return match;
  },
  updateMatch(id, fields) {
    const data = loadDb();
    const idx  = data.matches.findIndex(m => m.id === id);
    if (idx === -1) return null;
    Object.assign(data.matches[idx], fields);
    saveDb(data);
    return data.matches[idx];
  },
  getMatchesForUser(userId) {
    const data    = loadDb();
    const userMap = {};
    data.users.forEach(u => { userMap[u.id] = u.username; });
    return data.matches
      .filter(m => m.player1_id === userId || m.player2_id === userId)
      .slice(-20)
      .map(m => ({
        ...m,
        player1_name: userMap[m.player1_id] || "?",
        player2_name: userMap[m.player2_id] || "?",
        winner_name:  m.winner_id ? (userMap[m.winner_id] || "?") : null
      }));
  }
};

function normalizeUserProgress(user) {
  if (!user) return null;

  const fields = {};
  const normalizedStickers = normalizeStickerList(user.stickers);
  const currentStickers = Array.isArray(user.stickers) ? user.stickers : [];
  if (JSON.stringify(normalizedStickers) !== JSON.stringify(currentStickers)) {
    fields.stickers = normalizedStickers;
  }

  const normalizedDuplicates = normalizeDuplicateMap(user.duplicates);
  if (JSON.stringify(normalizedDuplicates) !== JSON.stringify(user.duplicates || {})) {
    fields.duplicates = normalizedDuplicates;
  }
  if (!Number.isFinite(Number(user.exchange_wins))) {
    fields.exchange_wins = Math.max(0, Number(user.bj_wins || 0) || 0);
  }
  if (!Number.isFinite(Number(user.bj_wins))) {
    fields.bj_wins = Math.max(0, Number(user.exchange_wins || 0) || 0);
  }
  if (typeof user.last_sale_day !== "string") {
    fields.last_sale_day = "";
  }

  return Object.keys(fields).length ? db.updateUser(user.id, fields) : user;
}

function addExchangeWin(userId) {
  const user = normalizeUserProgress(db.findUser("id", userId));
  if (!user) return null;

  const wins = Math.max(0, Number(user.exchange_wins || 0) || 0) + 1;
  return db.updateUser(userId, {
    exchange_wins: wins,
    bj_wins: wins
  });
}

function resetExchangeWinStreak(userId) {
  const user = normalizeUserProgress(db.findUser("id", userId));
  if (!user) return null;

  if (!Number(user.exchange_wins || 0) && !Number(user.bj_wins || 0)) return user;
  return db.updateUser(userId, {
    exchange_wins: 0,
    bj_wins: 0
  });
}

function resetExchangeLosses(participantIds, winnerIds = []) {
  const winners = new Set(winnerIds.map(Number).filter(Number.isFinite));
  const seen = new Set();

  participantIds.map(Number).filter(Number.isFinite).forEach((userId) => {
    if (seen.has(userId)) return;
    seen.add(userId);
    if (!winners.has(userId)) resetExchangeWinStreak(userId);
  });
}

function getMarketPrice(rarity) {
  return MARKET_PRICES[rarity] || 0;
}

function refreshDailyAlbumCredits(user) {
  if (!user) return null;

  const today = todayKey();
  const currentCredits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : 0;

  if (!user.last_album_credit_day) {
    return db.updateUser(user.id, {
      credits: currentCredits + DAILY_ALBUM_CREDITS,
      last_album_credit_day: today
    });
  }

  if (user.last_album_credit_day !== today) {
    return db.updateUser(user.id, {
      credits: currentCredits + DAILY_ALBUM_CREDITS,
      last_album_credit_day: today
    });
  }

  return user;
}

function normalizeInitialBetCredits(user) {
  if (!user) return null;

  if (user.initial_bet_credits_granted === INITIAL_BET_CREDITS) {
    return user;
  }

  const currentBetCredits = Number.isFinite(Number(user.bet_credits)) ? Number(user.bet_credits) : 0;
  return db.updateUser(user.id, {
    bet_credits: Math.max(currentBetCredits, INITIAL_BET_CREDITS),
    initial_bet_credits_granted: INITIAL_BET_CREDITS
  });
}

// ─── App ───────────────────────────────────────────────────────────────────
function makeDefaultFarmState() {
  return {
    coins: 90,
    xp: 0,
    level: 1,
    position: { x: FARM_MAP.merchant.x + 90, y: FARM_MAP.merchant.y + 60 },
    tools: {
      pickaxe: "wood",
      axe: "wood",
      shovel: "wood",
      sword: "wood",
      bow: false,
      shield: false
    },
    inventory: {
      seed_turnip: 4,
      seed_carrot: 2,
      fertilizer: 1,
      feed: 5,
      wood: 0,
      stone: 0,
      copper: 0,
      iron: 0,
      gold: 0,
      diamond: 0
    },
    storage: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function clampFarmNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeFarmState(farm) {
  const base = makeDefaultFarmState();
  const next = farm && typeof farm === "object" ? farm : {};
  return {
    ...base,
    ...next,
    position: {
      x: clampFarmNumber(next.position?.x, 0, FARM_MAP.width, base.position.x),
      y: clampFarmNumber(next.position?.y, 0, FARM_MAP.height, base.position.y)
    },
    tools: { ...base.tools, ...(next.tools || {}) },
    inventory: { ...base.inventory, ...(next.inventory || {}) },
    storage: { ...(next.storage || {}) },
    updated_at: next.updated_at || base.updated_at
  };
}

function ensureFarmData(data, user) {
  let changed = false;
  if (!data.farm_world || !Array.isArray(data.farm_world.lands)) {
    data.farm_world = makeDefaultFarmWorld();
    changed = true;
  }

  data.farm_world.map = FARM_MAP;
  data.farm_world.lands.forEach((land, index) => {
    if (!land.id) {
      land.id = `land-${index + 1}`;
      changed = true;
    }
    if (!land.storage || typeof land.storage !== "object") land.storage = {};
    if (!Array.isArray(land.buildings)) land.buildings = [];
  });

  if (user) {
    const normalized = normalizeFarmState(user.farm);
    if (JSON.stringify(normalized) !== JSON.stringify(user.farm || {})) {
      user.farm = normalized;
      changed = true;
    }
  }

  return changed;
}

function farmToolRank(tier) {
  return Math.max(0, FARM_TOOL_TIERS.indexOf(tier));
}

function farmHasToolTier(farm, tool, requiredTier) {
  const current = tool === "axe" ? farm.tools.axe : farm.tools.pickaxe;
  return farmToolRank(current) >= farmToolRank(requiredTier);
}

function farmDistance(a, b) {
  return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0));
}

function computeFarmCrop(crop, now = Date.now()) {
  if (!crop || !FARM_CROPS[crop.type]) return null;
  const catalog = FARM_CROPS[crop.type];
  const plantedAt = Number(crop.plantedAt || now);
  const wateredAt = Number(crop.wateredAt || 0);
  const speed = crop.fertilizedAt ? 0.65 : 1;
  const growMs = Math.max(1000, Math.floor(catalog.growMs * speed));
  const readyAt = wateredAt ? wateredAt + growMs : plantedAt + growMs;
  const rottenAt = readyAt + FARM_ROTTEN_MS;
  const progress = wateredAt
    ? clampFarmNumber((now - wateredAt) / growMs, 0, 1, 0)
    : Math.min(0.12, clampFarmNumber((now - plantedAt) / catalog.growMs, 0, 0.12, 0));
  const rotten = Boolean(wateredAt && now >= rottenAt);
  const ready = Boolean(wateredAt && now >= readyAt && !rotten);
  const status = rotten ? "rotten" : ready ? "ready" : wateredAt ? "growing" : "needs_water";

  return {
    ...crop,
    name: catalog.name,
    rarity: catalog.rarity,
    itemKey: catalog.itemKey,
    sellPrice: catalog.sellPrice,
    yield: catalog.yield,
    progress,
    ready,
    rotten,
    status,
    readyAt,
    rottenAt,
    remainingMs: Math.max(0, readyAt - now)
  };
}

function computeFarmAnimal(animal, now = Date.now()) {
  if (!animal || !FARM_ANIMALS[animal.type]) return null;
  const catalog = FARM_ANIMALS[animal.type];
  const fedUntil = Number(animal.fedUntil || 0);
  const lastProducedAt = Number(animal.lastProducedAt || animal.boughtAt || now);
  const productiveUntil = Math.min(now, fedUntil);
  const pending = fedUntil > now || productiveUntil > lastProducedAt
    ? Math.max(0, Math.floor((productiveUntil - lastProducedAt) / catalog.produceMs))
    : 0;

  return {
    ...animal,
    name: catalog.name,
    rarity: catalog.rarity,
    itemKey: catalog.itemKey,
    itemName: catalog.itemName,
    sellPrice: catalog.sellPrice,
    yield: catalog.yield,
    fertilizer: catalog.fertilizer || 0,
    pending,
    hungry: fedUntil <= now,
    fedUntil,
    nextProduceAt: fedUntil > now ? lastProducedAt + catalog.produceMs : null
  };
}

function buildFarmPayload(data, user) {
  const now = Date.now();
  const userMap = {};
  data.users.forEach(item => {
    userMap[item.id] = item.username;
  });

  return {
    user: { id: user.id, username: user.username, avatar: user.avatar || "" },
    farm: normalizeFarmState(user.farm),
    world: {
      map: FARM_MAP,
      lands: data.farm_world.lands.map(land => ({
        ...land,
        ownerUsername: land.ownerId ? (userMap[land.ownerId] || "?") : "",
        isMine: land.ownerId === user.id,
        cropState: computeFarmCrop(land.crop, now),
        animalState: computeFarmAnimal(land.animal, now)
      }))
    },
    catalog: {
      crops: FARM_CROPS,
      animals: FARM_ANIMALS,
      resources: FARM_RESOURCES,
      toolTiers: FARM_TOOL_TIERS,
      toolUpgradeCosts: FARM_TOOL_UPGRADE_COSTS
    },
    now
  };
}

function addFarmItem(farm, key, amount) {
  farm.inventory[key] = Math.max(0, Number(farm.inventory[key] || 0) + amount);
}

function spendFarmItem(farm, key, amount) {
  const current = Math.max(0, Number(farm.inventory[key] || 0));
  if (current < amount) return false;
  farm.inventory[key] = current - amount;
  return true;
}

function findFarmLand(world, landId) {
  return world.lands.find(land => land.id === String(landId));
}

function itemLabelsForServer(itemKey) {
  return {
    wood: "madeira",
    stone: "pedra",
    copper: "cobre",
    iron: "ferro",
    gold: "ouro",
    diamond: "diamante",
    fertilizer: "adubo",
    feed: "racao"
  }[itemKey] || itemKey;
}

function runFarmAction(data, user, action, body) {
  const farm = user.farm;
  const world = data.farm_world;
  const now = Date.now();
  let message = "Acao salva.";

  if (action === "save_position") {
    farm.position = {
      x: clampFarmNumber(body.x, 0, FARM_MAP.width, farm.position.x),
      y: clampFarmNumber(body.y, 0, FARM_MAP.height, farm.position.y)
    };
    message = "Posicao salva.";
  } else if (action === "buy_land") {
    const land = findFarmLand(world, body.landId);
    if (!land) throw new Error("Terreno nao encontrado.");
    if (land.ownerId) throw new Error("Este terreno ja tem dono.");
    if (farm.coins < land.price) throw new Error("Moedas insuficientes para comprar este terreno.");
    farm.coins -= land.price;
    land.ownerId = user.id;
    message = "Terreno comprado e salvo.";
  } else if (action === "buy_seed") {
    const crop = FARM_CROPS[body.cropType];
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(body.quantity || 1))));
    if (!crop) throw new Error("Semente invalida.");
    const cost = crop.seedPrice * quantity;
    if (farm.coins < cost) throw new Error("Moedas insuficientes para comprar sementes.");
    farm.coins -= cost;
    addFarmItem(farm, crop.seedKey, quantity);
    message = `${quantity} sementes compradas.`;
  } else if (action === "buy_feed") {
    const quantity = Math.max(1, Math.min(30, Math.floor(Number(body.quantity || 5))));
    const cost = quantity * 3;
    if (farm.coins < cost) throw new Error("Moedas insuficientes para comprar racao.");
    farm.coins -= cost;
    addFarmItem(farm, "feed", quantity);
    message = `${quantity} racoes compradas.`;
  } else if (action === "plant") {
    const land = findFarmLand(world, body.landId);
    const crop = FARM_CROPS[body.cropType];
    if (!land || land.ownerId !== user.id) throw new Error("Voce precisa ser dono do terreno para plantar.");
    if (!crop) throw new Error("Plantacao invalida.");
    if (land.crop) throw new Error("Este terreno ja tem plantacao.");
    if (land.animal) throw new Error("Este terreno esta ocupado por animal.");
    if (!spendFarmItem(farm, crop.seedKey, 1)) throw new Error("Voce nao tem essa semente.");
    land.crop = { type: body.cropType, ownerId: user.id, plantedAt: now, wateredAt: null, fertilizedAt: null };
    farm.xp += 1;
    message = `${crop.name} plantado. Regue para crescer.`;
  } else if (action === "water") {
    const land = findFarmLand(world, body.landId);
    if (!land || land.ownerId !== user.id || !land.crop) throw new Error("Nao ha plantacao sua para regar.");
    const state = computeFarmCrop(land.crop, now);
    if (state?.rotten) throw new Error("Esta plantacao ja apodreceu.");
    land.crop.wateredAt = now;
    message = "Terra regada. Crescimento iniciado.";
  } else if (action === "fertilize") {
    const land = findFarmLand(world, body.landId);
    if (!land || land.ownerId !== user.id || !land.crop) throw new Error("Nao ha plantacao sua para adubar.");
    if (land.crop.fertilizedAt) throw new Error("Esta plantacao ja foi adubada.");
    if (!spendFarmItem(farm, "fertilizer", 1)) throw new Error("Voce nao tem adubo.");
    land.crop.fertilizedAt = now;
    message = "Adubo aplicado. A plantacao vai crescer mais rapido.";
  } else if (action === "harvest") {
    const land = findFarmLand(world, body.landId);
    if (!land || !land.crop) throw new Error("Nao ha plantacao para colher.");
    const state = computeFarmCrop(land.crop, now);
    if (!state?.ready && !state?.rotten) throw new Error("A plantacao ainda nao esta pronta.");
    if (state.rotten) {
      land.crop = null;
      message = "A plantacao estava podre e foi removida.";
    } else {
      addFarmItem(farm, state.itemKey, state.yield);
      if (land.ownerId === user.id) farm.xp += 3;
      land.crop = null;
      message = land.ownerId === user.id
        ? `${state.name} colhido. Venda no comerciante central.`
        : `${state.name} roubado de uma fazenda rival.`;
    }
  } else if (action === "buy_animal") {
    const land = findFarmLand(world, body.landId);
    const animal = FARM_ANIMALS[body.animalType];
    if (!land || land.ownerId !== user.id) throw new Error("Voce precisa ser dono do terreno para criar animal.");
    if (!animal) throw new Error("Animal invalido.");
    if (land.crop || land.animal) throw new Error("Este terreno ja esta ocupado.");
    if (farm.coins < animal.price) throw new Error("Moedas insuficientes para comprar este animal.");
    farm.coins -= animal.price;
    land.animal = { type: body.animalType, ownerId: user.id, boughtAt: now, fedUntil: 0, lastProducedAt: now };
    farm.xp += 4;
    message = `${animal.name} comprado. Alimente para produzir.`;
  } else if (action === "feed_animal") {
    const land = findFarmLand(world, body.landId);
    if (!land || land.ownerId !== user.id || !land.animal) throw new Error("Nao ha animal seu nesse terreno.");
    const animal = FARM_ANIMALS[land.animal.type];
    if (!spendFarmItem(farm, "feed", animal.feedCost)) throw new Error("Racao insuficiente.");
    const base = Math.max(now, Number(land.animal.fedUntil || 0));
    land.animal.fedUntil = base + FARM_FEED_MS;
    if (!land.animal.lastProducedAt) land.animal.lastProducedAt = now;
    message = `${animal.name} alimentado. Ele vai produzir enquanto estiver alimentado.`;
  } else if (action === "collect_animal") {
    const land = findFarmLand(world, body.landId);
    if (!land || !land.animal) throw new Error("Nao ha producao animal aqui.");
    const state = computeFarmAnimal(land.animal, now);
    if (!state?.pending) throw new Error(state?.hungry ? "O animal esta com fome e nao produziu." : "Nada pronto ainda.");
    const total = state.pending * state.yield;
    addFarmItem(farm, state.itemKey, total);
    if (state.fertilizer) addFarmItem(farm, "fertilizer", state.pending * state.fertilizer);
    land.animal.lastProducedAt = Number(land.animal.lastProducedAt || now) + state.pending * FARM_ANIMALS[land.animal.type].produceMs;
    if (land.ownerId === user.id) farm.xp += 2 * state.pending;
    message = land.ownerId === user.id
      ? `${state.itemName} coletado.`
      : `${state.itemName} roubado de uma fazenda rival.`;
  } else if (action === "gather") {
    const resource = FARM_RESOURCES[body.resourceType];
    if (!resource) throw new Error("Recurso invalido.");
    if (!farmHasToolTier(farm, resource.tool, resource.tier)) {
      throw new Error(`Precisa de ${resource.tool === "axe" ? "machado" : "picareta"} ${resource.tier} ou melhor.`);
    }
    addFarmItem(farm, resource.itemKey, resource.amount);
    farm.xp += resource.xp;
    message = `${resource.name} coletado.`;
  } else if (action === "upgrade_tool") {
    const tool = String(body.tool || "");
    if (!["pickaxe", "axe", "shovel", "sword"].includes(tool)) throw new Error("Ferramenta invalida.");
    const currentTier = farm.tools[tool] || "wood";
    const currentIndex = FARM_TOOL_TIERS.indexOf(currentTier);
    if (currentIndex < 0 || currentIndex >= FARM_TOOL_TIERS.length - 1) throw new Error("Ferramenta ja esta no nivel maximo.");
    const nextTier = FARM_TOOL_TIERS[currentIndex + 1];
    const cost = FARM_TOOL_UPGRADE_COSTS[nextTier] || {};
    Object.entries(cost).forEach(([itemKey, amount]) => {
      if (Number(farm.inventory[itemKey] || 0) < amount) {
        throw new Error(`Faltam recursos para ${nextTier}: ${itemLabelsForServer(itemKey)} x${amount}.`);
      }
    });
    Object.entries(cost).forEach(([itemKey, amount]) => spendFarmItem(farm, itemKey, amount));
    farm.tools[tool] = nextTier;
    farm.xp += 8 + currentIndex * 4;
    message = `${tool} melhorada para ${nextTier}.`;
  } else if (action === "sell_all") {
    if (farmDistance(farm.position, FARM_MAP.merchant) > FARM_MAP.merchant.radius + 80) {
      throw new Error("Venda apenas no comerciante do centro.");
    }
    let total = 0;
    Object.values(FARM_CROPS).forEach(crop => {
      const amount = Math.max(0, Number(farm.inventory[crop.itemKey] || 0));
      if (amount) {
        total += amount * crop.sellPrice;
        farm.inventory[crop.itemKey] = 0;
      }
    });
    Object.values(FARM_ANIMALS).forEach(animal => {
      const amount = Math.max(0, Number(farm.inventory[animal.itemKey] || 0));
      if (amount) {
        total += amount * animal.sellPrice;
        farm.inventory[animal.itemKey] = 0;
      }
    });
    if (!total) throw new Error("Voce nao tem produtos para vender.");
    farm.coins += total;
    message = `Venda feita: +${total} moedas.`;
  } else {
    throw new Error("Acao de fazenda invalida.");
  }

  farm.level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, farm.xp)) / 2) + 1);
  farm.updated_at = new Date(now).toISOString();
  return { message };
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
const chatHistory = [];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rota raiz → abre o álbum
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Album", "index.html"));
});

// ─── Helpers JWT ───────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function safeUser(user) {
  if (!user) return null;
  user = normalizeUserProgress(user);
  const { password_hash, ...safe } = user;
  return safe;
}

function cleanChatText(value, maxLength = 220) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function emitChatMessage(message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...message
  };

  chatHistory.push(entry);
  while (chatHistory.length > 80) chatHistory.shift();
  io.emit("chat:message", entry);
  return entry;
}

function emitSystemChat(text, kind = "system", extra = {}) {
  const cleanText = cleanChatText(text, 260);
  if (!cleanText) return null;
  return emitChatMessage({
    type: "system",
    kind,
    text: cleanText,
    ...extra
  });
}

// ─── REST: Registro ────────────────────────────────────────────────────────
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Usuário e senha obrigatórios" });

    const user_clean = username.trim();
    if (user_clean.length < 3 || user_clean.length > 20)
      return res.status(400).json({ error: "Usuário: 3 a 20 caracteres" });
    if (!/^[a-zA-Z0-9 _-]+$/.test(user_clean))
      return res.status(400).json({ error: "Usuário: só letras, números, espaço, _ ou -" });
    if (password.length < 6)
      return res.status(400).json({ error: "Senha mínimo 6 caracteres" });

    if (db.findUser("username", user_clean))
      return res.status(409).json({ error: "Usuário já existe" });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = db.createUser(user_clean, hash);
    console.log(`[register] novo usuário: ${user_clean}`);
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (err) {
    console.error("[register] erro:", err);
    res.status(500).json({ error: "Erro interno ao criar conta: " + err.message });
  }
});

// ─── REST: Login ───────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "Usuário e senha obrigatórios" });

    let user = db.findUser("username", username.trim());
    if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Usuário ou senha inválidos" });

    user = normalizeUserProgress(normalizeInitialBetCredits(refreshDailyAlbumCredits(user)));
    console.log(`[login] ${user.username}`);
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (err) {
    console.error("[login] erro:", err);
    res.status(500).json({ error: "Erro interno ao fazer login: " + err.message });
  }
});

// ─── Middleware de autenticação ────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token   = (req.headers.authorization || "").replace("Bearer ", "");
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Não autenticado" });
  req.userId = payload.id;
  next();
}

// ─── REST: Perfil ──────────────────────────────────────────────────────────
app.get("/api/me", authMiddleware, (req, res) => {
  try {
    let user = db.findUser("id", req.userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    user = normalizeUserProgress(normalizeInitialBetCredits(refreshDailyAlbumCredits(user)));
    res.json(safeUser(user));
  } catch (err) {
    console.error("[me] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Salvar progresso ────────────────────────────────────────────────
app.post("/api/save", authMiddleware, (req, res) => {
  try {
    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });
    res.json({ ok: true, user: safeUser(user) });
  } catch (err) {
    console.error("[save] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/farm/state", authMiddleware, (req, res) => {
  try {
    const data = loadDb();
    const user = data.users.find(item => item.id === req.userId);
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });
    const changed = ensureFarmData(data, user);
    if (changed) saveDb(data);
    res.json(buildFarmPayload(data, user));
  } catch (err) {
    console.error("[farm:state] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/farm/action", authMiddleware, (req, res) => {
  try {
    const { action, ...body } = req.body || {};
    const data = loadDb();
    const user = data.users.find(item => item.id === req.userId);
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });
    ensureFarmData(data, user);
    const result = runFarmAction(data, user, String(action || ""), body);
    saveDb(data);
    res.json({ ok: true, ...result, ...buildFarmPayload(data, user) });
  } catch (err) {
    console.error("[farm:action] erro:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/pack/open", authMiddleware, (req, res) => {
  try {
    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });

    const credits = Math.max(0, Number(user.credits || 0) || 0);
    if (credits < PACK_COST) {
      return res.status(400).json({ error: "Creditos insuficientes para comprar pacote." });
    }

    const stickers = normalizeStickerList(user.stickers);
    const duplicates = normalizeDuplicateMap(user.duplicates);
    const ownedIds = new Set(stickers.map(sticker => Number(sticker.id)));
    const usedIds = new Set();
    const packItems = [];

    for (let i = 0; i < PACK_SIZE; i += 1) {
      const rarity = pickPackRarity();
      const sticker = pickServerStickerForRarity(rarity, ownedIds, usedIds);
      if (!sticker) return res.status(500).json({ error: "Falha ao sortear figurinha." });

      const isDuplicate = ownedIds.has(sticker.id);
      usedIds.add(sticker.id);

      if (isDuplicate) {
        duplicates[sticker.id] = Math.max(0, Number(duplicates[sticker.id] || 0) || 0) + 1;
      } else {
        stickers.push({ id: sticker.id, unlocked: true });
        ownedIds.add(sticker.id);
      }

      packItems.push({
        stickerId: sticker.id,
        code: sticker.code,
        name: sticker.name,
        image: sticker.image,
        rarity: sticker.rarity,
        isDuplicate
      });
    }

    const updated = db.updateUser(req.userId, {
      credits: credits - PACK_COST,
      stickers,
      duplicates,
      pending_stickers: []
    });

    const legendaryItems = packItems.filter(item => item.rarity === "legendary" && !item.isDuplicate);
    if (legendaryItems.length) {
      const names = legendaryItems.map(item => item.name || item.code).join(", ");
      emitSystemChat(`${updated.username} tirou lendaria no pacote: ${names}.`, "legendary", {
        userId: updated.id,
        username: updated.username,
        stickers: legendaryItems.map(item => ({
          stickerId: item.stickerId,
          code: item.code,
          name: item.name,
          rarity: item.rarity
        }))
      });
    }

    res.json({ ok: true, packItems, user: safeUser(updated) });
  } catch (err) {
    console.error("[pack:open] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Avatar ─────────────────────────────────────────────────────────
app.post("/api/avatar", authMiddleware, (req, res) => {
  try {
    const { avatar } = req.body || {};
    // avatar is a base64 data URI, max ~20KB (80x80 JPEG)
    if (!avatar || typeof avatar !== "string") return res.status(400).json({ error: "Avatar inválido" });
    if (avatar.length > 30000) return res.status(400).json({ error: "Imagem muito grande (max 80x80)" });
    db.updateUser(req.userId, { avatar });
    const updated = db.findUser("id", req.userId);

    if (typeof onlinePlayers !== "undefined") {
      for (const [, player] of onlinePlayers) {
        if (player.userId === req.userId) {
          player.avatar = avatar;
          const liveSocket = io.sockets.sockets.get(player.socketId);
          if (liveSocket) liveSocket.avatar = avatar;
        }
      }
      broadcastOnlineList();
    }

    res.json({ ok: true, user: safeUser(updated) });
  } catch (err) {
    console.error("[avatar] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Histórico de partidas ───────────────────────────────────────────
app.post("/api/exchange-credits", authMiddleware, (req, res) => {
  try {
    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });

    const exchangeWins = Math.max(0, Number(user.exchange_wins || 0) || 0);
    const betCredits = Math.max(0, Number(user.bet_credits || 0) || 0);
    if (exchangeWins < 2) {
      return res.status(400).json({ error: "Ganhe 2 partidas seguidas para liberar a troca." });
    }
    if (betCredits < 10) {
      return res.status(400).json({ error: "Voce precisa de 10 creditos de aposta." });
    }

    const updated = db.updateUser(req.userId, {
      bet_credits: betCredits - 10,
      credits: Math.max(0, Number(user.credits || 0) || 0) + 10,
      exchange_wins: exchangeWins - 2,
      bj_wins: Math.max(0, exchangeWins - 2)
    });
    res.json({ ok: true, user: safeUser(updated) });
  } catch (err) {
    console.error("[exchange] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/market", authMiddleware, (req, res) => {
  try {
    const data = loadDb();
    const userMap = {};
    data.users.forEach(user => {
      userMap[user.id] = {
        username: user.username,
        avatar: user.avatar || ""
      };
    });

    const listings = data.market_listings
      .filter(item => item.status === "active")
      .slice(-80)
      .reverse()
      .map(item => ({
        ...item,
        seller_username: userMap[item.seller_id]?.username || "?",
        seller_avatar: userMap[item.seller_id]?.avatar || ""
      }));

    const user = normalizeUserProgress(db.findUser("id", req.userId));
    res.json({
      listings,
      today: todayKey(),
      canListToday: user?.last_sale_day !== todayKey()
    });
  } catch (err) {
    console.error("[market:list] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/market/list", authMiddleware, (req, res) => {
  try {
    const { stickerId } = req.body || {};
    const id = Number(stickerId);
    const sticker = getServerSticker(id);
    if (!sticker) return res.status(400).json({ error: "Figurinha invalida para venda." });

    const price = getMarketPrice(sticker.rarity);
    if (!price) return res.status(400).json({ error: "Figurinha invalida para venda." });

    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });

    const today = todayKey();
    if (user.last_sale_day === today) {
      return res.status(400).json({ error: "Voce ja anunciou uma figurinha hoje." });
    }

    const duplicates = { ...(user.duplicates || {}) };
    const currentCount = Math.max(0, Number(duplicates[id] || 0) || 0);
    if (currentCount < 1) {
      return res.status(400).json({ error: "Voce nao tem essa figurinha repetida." });
    }
    duplicates[id] = currentCount - 1;
    if (duplicates[id] <= 0) delete duplicates[id];

    const data = loadDb();
    const listing = {
      id: data.nextMarketId++,
      seller_id: req.userId,
      sticker_id: id,
      rarity: sticker.rarity,
      price,
      code: sticker.code,
      name: sticker.name,
      image: sticker.image,
      status: "active",
      created_day: today,
      created_at: new Date().toISOString()
    };
    data.market_listings.push(listing);

    const userIndex = data.users.findIndex(item => item.id === req.userId);
    if (userIndex !== -1) {
      data.users[userIndex].duplicates = duplicates;
      data.users[userIndex].last_sale_day = today;
    }
    saveDb(data);

    emitSystemChat(`${user.username} anunciou ${listing.code} - ${listing.name} na loja por ${listing.price} creditos.`, "market", {
      userId: user.id,
      username: user.username,
      listingId: listing.id,
      stickerId: listing.sticker_id,
      price: listing.price
    });

    res.json({ ok: true, listing, user: safeUser(db.findUser("id", req.userId)) });
  } catch (err) {
    console.error("[market:create] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/market/buy", authMiddleware, (req, res) => {
  try {
    const listingId = Number(req.body?.listingId);
    const data = loadDb();
    const listing = data.market_listings.find(item => item.id === listingId && item.status === "active");
    if (!listing) return res.status(404).json({ error: "Anuncio indisponivel." });
    if (listing.seller_id === req.userId) {
      return res.status(400).json({ error: "Voce nao pode comprar seu proprio anuncio." });
    }

    const buyerIndex = data.users.findIndex(user => user.id === req.userId);
    const sellerIndex = data.users.findIndex(user => user.id === listing.seller_id);
    if (buyerIndex === -1 || sellerIndex === -1) {
      return res.status(404).json({ error: "Usuario nao encontrado." });
    }

    const buyer = normalizeUserProgress(data.users[buyerIndex]);
    const seller = normalizeUserProgress(data.users[sellerIndex]);
    if (Number(buyer.credits || 0) < listing.price) {
      return res.status(400).json({ error: "Creditos do album insuficientes." });
    }

    const buyerStickers = Array.isArray(buyer.stickers) ? [...buyer.stickers] : [];
    const owned = buyerStickers.find(item => Number(item.id) === listing.sticker_id);
    const buyerDuplicates = { ...(buyer.duplicates || {}) };

    if (owned && (owned.unlocked || owned.collected)) {
      buyerDuplicates[listing.sticker_id] = Math.max(0, Number(buyerDuplicates[listing.sticker_id] || 0) || 0) + 1;
    } else if (owned) {
      owned.unlocked = true;
    } else {
      buyerStickers.push({ id: listing.sticker_id, unlocked: true });
    }

    data.users[buyerIndex] = {
      ...buyer,
      credits: Number(buyer.credits || 0) - listing.price,
      stickers: buyerStickers,
      duplicates: buyerDuplicates
    };
    data.users[sellerIndex] = {
      ...seller,
      credits: Number(seller.credits || 0) + listing.price
    };
    listing.status = "sold";
    listing.sold_to_id = req.userId;
    listing.sold_at = new Date().toISOString();

    saveDb(data);

    const buyerNotice = {
      username: data.users[buyerIndex]?.username || "?",
      avatar: data.users[buyerIndex]?.avatar || ""
    };
    const sellerNotice = {
      username: data.users[sellerIndex]?.username || "?",
      avatar: data.users[sellerIndex]?.avatar || ""
    };
    const updatedSeller = safeUser(db.findUser("id", listing.seller_id));
    for (const [, player] of onlinePlayers) {
      if (player.userId === listing.seller_id) {
        io.to(player.socketId).emit("market:sold", {
          listing,
          buyer: buyerNotice,
          updatedUser: updatedSeller
        });
      }
    }

    res.json({
      ok: true,
      listing,
      seller: sellerNotice,
      user: safeUser(db.findUser("id", req.userId))
    });
  } catch (err) {
    console.error("[market:buy] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/matches", authMiddleware, (req, res) => {
  try {
    res.json(db.getMatchesForUser(req.userId));
  } catch (err) {
    console.error("[matches] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Tratamento global de erros assíncronos ────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[express] erro não tratado:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// ─── Socket.io ─────────────────────────────────────────────────────────────
const onlinePlayers      = new Map();   // socketId → info
const pendingChallenges  = new Map();   // challengeId → detalhes
const activeRooms        = new Map();   // roomId → detalhes da sala
const blackjackRooms     = new Map();   // roomId -> mesa de 21
const buttonSoccerRooms  = new Map();   // roomId -> futebol de botao
const headSoccerRooms    = new Map();   // roomId -> head soccer em sala
const slitherRooms       = new Map();   // roomId -> cobrinhas estilo slither
const crashRooms         = new Map();   // roomId -> crash do aviao

function ensureSpectators(room) {
  if (!room.spectators) room.spectators = new Set();
  return room.spectators;
}

function roomSpectatorCount(room) {
  return room?.spectators?.size || 0;
}

function clearSpectator(room, socketId) {
  if (!room?.spectators) return false;
  const removed = room.spectators.delete(socketId);
  const liveSocket = io.sockets.sockets.get(socketId);
  if (removed && liveSocket) liveSocket.leave(room.roomId);
  return removed;
}

function clearSocketFromSpectatorRooms(socketId) {
  for (const room of blackjackRooms.values()) {
    if (clearSpectator(room, socketId)) emitBlackjackUpdate(room);
  }
  for (const room of buttonSoccerRooms.values()) {
    if (clearSpectator(room, socketId)) emitButtonSoccerUpdate(room);
  }
  for (const room of headSoccerRooms.values()) {
    if (clearSpectator(room, socketId)) emitHeadSoccerUpdate(room);
  }
  for (const room of slitherRooms.values()) {
    if (clearSpectator(room, socketId)) {
      clearSlitherWatcher(room, socketId);
      emitSlitherUpdate(room);
    }
  }
  for (const room of horseRooms.values()) {
    if (clearSpectator(room, socketId)) emitHorseUpdate(room);
  }
  for (const room of crashRooms.values()) {
    if (clearSpectator(room, socketId)) emitCrashUpdate(room);
  }
}

io.use((socket, next) => {
  const token   = socket.handshake.auth.token;
  const payload = verifyToken(token);
  if (!payload) return next(new Error("Não autenticado"));
  socket.userId   = payload.id;
  socket.username = payload.username;
  socket.avatar   = db.findUser("id", payload.id)?.avatar || "";
  next();
});

function makeDeck(numDecks = 6) {
  // Usa múltiplos baralhos (padrão de cassino) para distribuição mais aleatória
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  for (let d = 0; d < numDecks; d++) {
    suits.forEach(suit => ranks.forEach(rank => deck.push({ rank, suit })));
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (!card) return 0;
  if (card.rank === "A") return 11;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handTotal(cards) {
  let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = cards.filter(card => card.rank === "A").length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function drawBlackjackCard(room) {
  if (!room.deck.length) room.deck = makeDeck();
  return room.deck.pop();
}

function serializeBlackjackRoom(room, viewerSocketId) {
  const revealDealer = room.status === "finished";
  const dealerCards = revealDealer ? room.dealerCards : room.dealerCards.map((card, index) => index === 0 ? card : null);
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    winnerSocketId: room.winnerSocketId || null,
    houseWon: Boolean(room.houseWon),
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    dealerCards,
    dealerTotal: revealDealer ? handTotal(room.dealerCards) : null,
    players: room.players.map((player, index) => {
      const total = handTotal(player.cards);
      return {
        socketId: player.socketId,
        username: player.username,
        avatar: player.avatar || "",
        cards: player.cards,
        total,
        status: player.status,
        busted: total > 21,
        isHost: player.socketId === room.hostSocketId,
        isMe: player.socketId === viewerSocketId,
        order: index
      };
    })
  };
}

function emitBlackjackUpdate(room) {
  room.players.forEach(player => {
    io.to(player.socketId).emit("blackjack:update", serializeBlackjackRoom(room, player.socketId));
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("blackjack:update", serializeBlackjackRoom(room, spectatorId));
  }
}

function allBlackjackPlayersDone(room) {
  return room.players.every(player => player.status === "stand" || player.status === "bust");
}

function finishBlackjackRoom(room) {
  if (!room || room.status === "finished") return;

  room.status = "finished";
  room.players.forEach(player => {
    const total = handTotal(player.cards);
    if (total > 21) player.status = "bust";
    else if (player.status !== "bust") player.status = "stand";
  });

  const hasLivePlayer = room.players.some(player => handTotal(player.cards) <= 21);
  if (hasLivePlayer) {
    while (handTotal(room.dealerCards) < 17) {
      room.dealerCards.push(drawBlackjackCard(room));
    }
  }

  const dealerTotal = handTotal(room.dealerCards);
  const dealerBust = dealerTotal > 21;
  const eligible = room.players
    .map((player, index) => ({ player, index, total: handTotal(player.cards) }))
    .filter(item => item.total <= 21 && (dealerBust || item.total > dealerTotal))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (a.player.cards.length !== b.player.cards.length) return a.player.cards.length - b.player.cards.length;
      return a.index - b.index;
    });

  let winner = null;
  let tiebreaker = null;

  if (eligible.length > 1 && eligible[0].total === eligible[1].total) {
    // Tie! Each tied player draws one more card
    const topTotal = eligible[0].total;
    const tied = eligible.filter(e => e.total === topTotal);
    tied.forEach(e => {
      e.tieCard = drawBlackjackCard(room);
      e.player.cards.push(e.tieCard); // add to hand for display
    });
    // Highest tiebreak card wins; if still tied, first to join wins
    tied.sort((a, b) => cardValue(b.tieCard) - cardValue(a.tieCard));
    winner = tied[0].player;
    tiebreaker = `Desempate: ${tied.map(e => `${e.player.username} tirou ${e.tieCard.rank}`).join(', ')}.`;
  } else {
    winner = eligible[0]?.player || null;
  }

  room.winnerSocketId = winner?.socketId || null;
  room.houseWon = !winner;
  room.message = tiebreaker
    ? `${tiebreaker} ${winner.username} vence!`
    : winner
      ? `${winner.username} venceu a mesa com ${handTotal(winner.cards)} pontos.`
      : `A casa venceu com ${dealerBust ? "estouro dos jogadores" : `${dealerTotal} pontos`}.`;

  const totalPot = room.players.reduce((sum, player) => sum + player.bet, 0);
  room.players.forEach(player => {
    const user = db.findUser("id", player.userId);
    if (!user) return;

    const delta = winner && winner.userId === player.userId
      ? totalPot - player.bet
      : -player.bet;
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) + delta)
    });
  });

  if (winner?.userId) {
    addExchangeWin(winner.userId);
  }
  resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

  room.players.forEach(player => {
    const updated = db.findUser("id", player.userId);
    io.to(player.socketId).emit("blackjack:finished", {
      table: serializeBlackjackRoom(room, player.socketId),
      updatedUser: safeUser(updated)
    });

    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
  });

  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("blackjack:finished", {
      table: serializeBlackjackRoom(room, spectatorId),
      updatedUser: null
    });
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }

  blackjackRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelBlackjackRoom(room, reason = "Mesa de 21 cancelada.") {
  if (!room) return;
  room.players.forEach(player => {
    io.to(player.socketId).emit("blackjack:cancelled", { message: reason });
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("blackjack:cancelled", { message: reason });
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }
  blackjackRooms.delete(room.roomId);
  broadcastOnlineList();
}

function findBlackjackRoomBySocket(socketId) {
  for (const room of blackjackRooms.values()) {
    if (room.players.some(player => player.socketId === socketId)) return room;
  }
  return null;
}

const BUTTON_SOCCER_FIELD = {
  width: 1180,
  height: 680,
  goalWidth: 190,
  buttonRadius: 25,
  ballRadius: 12,
  padding: 42
};
const BUTTON_SOCCER_MAX_PLAYERS = 8;
const BUTTON_SOCCER_TURN_MS = 10000;
const BUTTON_SOCCER_GAME_MS = 180000;
const BUTTON_SOCCER_COLORS = ["#d84545", "#f6f0df", "#c73552", "#ffffff", "#e4572e", "#d7f7ff", "#b52f48", "#f7f7d7"];

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function buttonTeamName(team) {
  return team === "red" ? "Vermelhos" : "Brancos";
}

function buttonGoalYRange() {
  const middle = BUTTON_SOCCER_FIELD.height / 2;
  return {
    top: middle - BUTTON_SOCCER_FIELD.goalWidth / 2,
    bottom: middle + BUTTON_SOCCER_FIELD.goalWidth / 2
  };
}

function distributeButtonY(index, total) {
  const margin = 118;
  if (total <= 1) return BUTTON_SOCCER_FIELD.height / 2;
  return margin + ((BUTTON_SOCCER_FIELD.height - margin * 2) * index) / (total - 1);
}

function resetButtonSoccerPositions(room) {
  const reds = room.players.filter(player => player.team === "red");
  const whites = room.players.filter(player => player.team === "white");

  reds.forEach((player, index) => {
    player.x = 260 + (index % 2) * 82;
    player.y = distributeButtonY(index, reds.length);
    player.vx = 0;
    player.vy = 0;
  });
  whites.forEach((player, index) => {
    player.x = BUTTON_SOCCER_FIELD.width - 260 - (index % 2) * 82;
    player.y = distributeButtonY(index, whites.length);
    player.vx = 0;
    player.vy = 0;
  });

  room.ball = {
    x: BUTTON_SOCCER_FIELD.width / 2,
    y: BUTTON_SOCCER_FIELD.height / 2,
    vx: 0,
    vy: 0
  };
}

function makeButtonSoccerPlayer(socket, index, bet) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    team: index % 2 === 0 ? "red" : "white",
    color: BUTTON_SOCCER_COLORS[index % BUTTON_SOCCER_COLORS.length],
    bet,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ready: false,
    voteBet: bet,
    joinedAt: Date.now()
  };
}

function serializeButtonSoccerRoom(room, viewerSocketId) {
  const now = Date.now();
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: BUTTON_SOCCER_FIELD,
    scores: room.scores,
    ball: room.ball,
    turnSocketId: room.turnSocketId || null,
    turnEndsAt: room.turnEndsAt || null,
    turnLeftMs: room.status === "playing" ? Math.max(0, (room.turnEndsAt || now) - now) : 0,
    gameEndsAt: room.gameEndsAt || null,
    gameLeftMs: room.status === "playing" ? Math.max(0, (room.gameEndsAt || now) - now) : 0,
    winnerTeam: room.winnerTeam || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    lastGoal: room.lastGoal || null,
    lastShot: room.lastShot || null,
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      team: player.team,
      teamName: buttonTeamName(player.team),
      color: player.color,
      x: player.x,
      y: player.y,
      ready: Boolean(player.ready),
      voteBet: player.voteBet,
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      isTurn: player.socketId === room.turnSocketId,
      order: index
    }))
  };
}

function emitButtonSoccerUpdate(room) {
  room.players.forEach(player => {
    io.to(player.socketId).emit("button:update", serializeButtonSoccerRoom(room, player.socketId));
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("button:update", serializeButtonSoccerRoom(room, spectatorId));
  }
}

function scheduleButtonTurnTimeout(room) {
  clearTimeout(room.turnTimer);
  if (room.status !== "playing") return;
  room.turnTimer = setTimeout(() => {
    if (!buttonSoccerRooms.has(room.roomId) || room.status !== "playing") return;
    const current = room.players.find(player => player.socketId === room.turnSocketId);
    room.message = `${current?.username || "Jogador"} perdeu o turno.`;
    advanceButtonTurn(room);
    emitButtonSoccerUpdate(room);
  }, BUTTON_SOCCER_TURN_MS + 250);
}

function setButtonTurn(room, nextIndex = 0) {
  if (!room.players.length) return;
  room.turnIndex = ((nextIndex % room.players.length) + room.players.length) % room.players.length;
  room.turnSocketId = room.players[room.turnIndex].socketId;
  room.turnEndsAt = Date.now() + BUTTON_SOCCER_TURN_MS;
  scheduleButtonTurnTimeout(room);
}

function advanceButtonTurn(room) {
  if (room.status !== "playing") return;
  if (Date.now() >= room.gameEndsAt) {
    finishButtonSoccerRoom(room, "Tempo encerrado.");
    return;
  }
  setButtonTurn(room, (room.turnIndex || 0) + 1);
}

function pickButtonReplayBet(room) {
  const votes = room.players
    .map(player => clampNumber(player.voteBet || room.bet, 5, 50))
    .sort((a, b) => a - b);
  const counts = votes.reduce((map, bet) => {
    map[bet] = (map[bet] || 0) + 1;
    return map;
  }, {});
  return Number(Object.keys(counts).sort((a, b) => {
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return Number(a) - Number(b);
  })[0] || room.bet);
}

function startButtonSoccerRound(room, requestedBet = room.bet) {
  const tableBet = clampNumber(requestedBet, 5, 50);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitButtonSoccerUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitButtonSoccerUpdate(room);
      return false;
    }
  }

  room.players.forEach(player => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    player.bet = tableBet;
    player.ready = false;
    player.voteBet = tableBet;
  });

  room.bet = tableBet;
  room.pot = room.players.reduce((sum, player) => sum + Number(player.bet || tableBet || 0), 0);
  room.status = "playing";
  room.scores = { red: 0, white: 0 };
  room.winnerTeam = null;
  room.startedAt = Date.now();
  room.gameEndsAt = room.startedAt + BUTTON_SOCCER_GAME_MS;
  room.lastGoal = null;
  room.lastShot = null;
  room.shotSeq = 0;
  room.goalSeq = 0;
  room.message = "Partida iniciada. Cada jogador tem 10 segundos por tacada.";
  resetButtonSoccerPositions(room);
  setButtonTurn(room, 0);

  clearTimeout(room.gameTimer);
  room.gameTimer = setTimeout(() => {
    if (!buttonSoccerRooms.has(room.roomId) || room.status !== "playing") return;
    finishButtonSoccerRoom(room, "Tempo encerrado.");
  }, BUTTON_SOCCER_GAME_MS + 300);

  emitButtonSoccerUpdate(room);
  broadcastOnlineList();
  return true;
}

function finishButtonSoccerRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearTimeout(room.turnTimer);
  clearTimeout(room.gameTimer);

  room.status = "finished";
  room.turnSocketId = null;
  room.turnEndsAt = null;
  room.gameEndsAt = null;
  room.players.forEach(player => { player.ready = false; player.voteBet = room.bet; });

  let winnerTeam = null;
  if (room.scores.red > room.scores.white) winnerTeam = "red";
  if (room.scores.white > room.scores.red) winnerTeam = "white";
  room.winnerTeam = winnerTeam;

  const totalPot = Number(room.pot || 0) || room.players.reduce((sum, player) => sum + Number(player.bet || room.bet || 0), 0);
  if (winnerTeam) {
    const winners = room.players.filter(player => player.team === winnerTeam);
    const share = winners.length ? Math.floor(totalPot / winners.length) : 0;
    winners.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + share
        });
        addExchangeWin(player.userId);
      }
    });
    room.message = `${reason ? `${reason} ` : ""}${buttonTeamName(winnerTeam)} venceram por ${room.scores.red} x ${room.scores.white}.`;
  } else {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
    room.message = `${reason ? `${reason} ` : ""}Empate em ${room.scores.red} x ${room.scores.white}. Apostas devolvidas.`;
  }
  resetExchangeLosses(
    room.players.map(player => player.userId),
    winnerTeam ? room.players.filter(player => player.team === winnerTeam).map(player => player.userId) : []
  );

  room.players.forEach(player => {
    io.to(player.socketId).emit("button:finished", {
      room: serializeButtonSoccerRoom(room, player.socketId),
      updatedUser: safeUser(db.findUser("id", player.userId))
    });
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("button:finished", {
      room: serializeButtonSoccerRoom(room, spectatorId),
      updatedUser: null
    });
  }
  broadcastOnlineList();
}

function cancelButtonSoccerRoom(room, reason = "Mesa de futebol de botao cancelada.") {
  if (!room) return;

  clearTimeout(room.turnTimer);
  clearTimeout(room.gameTimer);

  if (room.status === "playing") {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
  }

  room.players.forEach(player => {
    io.to(player.socketId).emit("button:cancelled", { message: reason });
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("button:cancelled", { message: reason });
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }
  buttonSoccerRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeButtonSoccerPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) return;

  if (room.status === "playing") {
    cancelButtonSoccerRoom(room, reason || `${player.username} saiu da partida.`);
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }

  if (!room.players.length) {
    buttonSoccerRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  room.players.forEach((item, index) => {
    item.team = index % 2 === 0 ? "red" : "white";
    item.color = BUTTON_SOCCER_COLORS[index % BUTTON_SOCCER_COLORS.length];
  });
  resetButtonSoccerPositions(room);
  room.message = reason || `${player.username} saiu da mesa.`;
  emitButtonSoccerUpdate(room);
  broadcastOnlineList();
}

function findButtonSoccerRoomBySocket(socketId) {
  for (const room of buttonSoccerRooms.values()) {
    if (room.players.some(player => player.socketId === socketId)) return room;
  }
  return null;
}

function checkButtonGoal(ball) {
  const goal = buttonGoalYRange();
  const inGoalY = ball.y >= goal.top && ball.y <= goal.bottom;
  if (ball.x <= -BUTTON_SOCCER_FIELD.ballRadius && inGoalY) return "white";
  if (ball.x >= BUTTON_SOCCER_FIELD.width + BUTTON_SOCCER_FIELD.ballRadius && inGoalY) return "red";
  return null;
}

function resolveButtonBounds(obj, radius, allowGoalExit = false) {
  const goal = buttonGoalYRange();
  const inGoalY = allowGoalExit && obj.y >= goal.top && obj.y <= goal.bottom;
  if (obj.y < radius) { obj.y = radius; obj.vy = Math.abs(obj.vy) * 0.78; }
  if (obj.y > BUTTON_SOCCER_FIELD.height - radius) {
    obj.y = BUTTON_SOCCER_FIELD.height - radius;
    obj.vy = -Math.abs(obj.vy) * 0.78;
  }
  if (obj.x < radius && !inGoalY) { obj.x = radius; obj.vx = Math.abs(obj.vx) * 0.78; }
  if (obj.x > BUTTON_SOCCER_FIELD.width - radius && !inGoalY) {
    obj.x = BUTTON_SOCCER_FIELD.width - radius;
    obj.vx = -Math.abs(obj.vx) * 0.78;
  }
}

function simulateButtonSoccerShot(room, player, angle, power) {
  const maxPower = clampNumber(power, 0.05, 1);
  const shotAngle = Number.isFinite(Number(angle)) ? Number(angle) : 0;
  const active = {
    x: player.x,
    y: player.y,
    vx: Math.cos(shotAngle) * (520 + maxPower * 1520),
    vy: Math.sin(shotAngle) * (520 + maxPower * 1520)
  };
  const ball = { ...room.ball };
  const path = [];
  let goalTeam = null;

  for (let step = 0; step < 420; step += 1) {
    active.x += active.vx / 60;
    active.y += active.vy / 60;
    ball.x += ball.vx / 60;
    ball.y += ball.vy / 60;

    resolveButtonBounds(active, BUTTON_SOCCER_FIELD.buttonRadius, false);
    resolveButtonBounds(ball, BUTTON_SOCCER_FIELD.ballRadius, true);

    room.players.forEach(other => {
      if (other.socketId === player.socketId) return;
      const dx = active.x - other.x;
      const dy = active.y - other.y;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = BUTTON_SOCCER_FIELD.buttonRadius * 2;
      if (dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        active.x = other.x + nx * minDist;
        active.y = other.y + ny * minDist;
        const dot = active.vx * nx + active.vy * ny;
        active.vx = (active.vx - 1.65 * dot * nx) * 0.62;
        active.vy = (active.vy - 1.65 * dot * ny) * 0.62;
        other.x = clampNumber(other.x - nx * 3, BUTTON_SOCCER_FIELD.buttonRadius, BUTTON_SOCCER_FIELD.width - BUTTON_SOCCER_FIELD.buttonRadius);
        other.y = clampNumber(other.y - ny * 3, BUTTON_SOCCER_FIELD.buttonRadius, BUTTON_SOCCER_FIELD.height - BUTTON_SOCCER_FIELD.buttonRadius);
      }
    });

    const dx = ball.x - active.x;
    const dy = ball.y - active.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = BUTTON_SOCCER_FIELD.buttonRadius + BUTTON_SOCCER_FIELD.ballRadius;
    if (dist < minDist) {
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = active.x + nx * minDist;
      ball.y = active.y + ny * minDist;
      const impact = Math.max(260, Math.hypot(active.vx, active.vy) * (0.72 + maxPower * 0.35));
      ball.vx = nx * impact + active.vx * 0.18;
      ball.vy = ny * impact + active.vy * 0.18;
      active.vx *= 0.58;
      active.vy *= 0.58;
    }

    active.vx *= 0.982;
    active.vy *= 0.982;
    ball.vx *= 0.989;
    ball.vy *= 0.989;

    if (step % 4 === 0) {
      path.push({
        button: { x: Math.round(active.x), y: Math.round(active.y) },
        ball: { x: Math.round(ball.x), y: Math.round(ball.y) }
      });
    }

    goalTeam = checkButtonGoal(ball);
    if (goalTeam) break;

    if (step > 80 && Math.hypot(active.vx, active.vy) < 14 && Math.hypot(ball.vx, ball.vy) < 18) break;
  }

  player.x = clampNumber(active.x, BUTTON_SOCCER_FIELD.buttonRadius, BUTTON_SOCCER_FIELD.width - BUTTON_SOCCER_FIELD.buttonRadius);
  player.y = clampNumber(active.y, BUTTON_SOCCER_FIELD.buttonRadius, BUTTON_SOCCER_FIELD.height - BUTTON_SOCCER_FIELD.buttonRadius);
  room.ball = {
    x: clampNumber(ball.x, -BUTTON_SOCCER_FIELD.ballRadius, BUTTON_SOCCER_FIELD.width + BUTTON_SOCCER_FIELD.ballRadius),
    y: clampNumber(ball.y, BUTTON_SOCCER_FIELD.ballRadius, BUTTON_SOCCER_FIELD.height - BUTTON_SOCCER_FIELD.ballRadius),
    vx: 0,
    vy: 0
  };

  room.shotSeq = (room.shotSeq || 0) + 1;
  room.lastShot = {
    id: room.shotSeq,
    playerSocketId: player.socketId,
    path
  };

  if (goalTeam) {
    room.scores[goalTeam] += 1;
    room.goalSeq = (room.goalSeq || 0) + 1;
    room.lastGoal = {
      id: room.goalSeq,
      team: goalTeam,
      teamName: buttonTeamName(goalTeam),
      scorer: player.username,
      at: Date.now()
    };
    room.message = `Gol dos ${buttonTeamName(goalTeam)}!`;
    resetButtonSoccerPositions(room);
  } else {
    room.message = `${player.username} bateu na bola.`;
  }

  return goalTeam;
}

const HEAD_SOCCER_FIELD = {
  width: 1500,
  height: 675,
  pitchTop: 0,
  ground: 675,
  playerGround: 337,
  goalTop: 250,
  goalBottom: 425,
  goalWidth: 54,
  playerRadius: 32,
  ballRadius: 15
};
const HEAD_SOCCER_MAX_PLAYERS = 8;
const HEAD_SOCCER_GAME_MS = 180000;
const HEAD_SOCCER_TICK_MS = 1000 / 30;
const HEAD_SOCCER_GOALS_TO_WIN = 3;
const HEAD_SOCCER_BLUE_FOLDERS = ["Blue", "Green", "Special", "Blue"];
const HEAD_SOCCER_RED_FOLDERS = ["Red", "White", "Special", "Red"];
const HEAD_SOCCER_TEAM_COLORS = {
  blue: "#2f8fd8",
  red: "#d84545"
};

function headSoccerTeamName(team) {
  return team === "blue" ? "Azuis" : "Vermelhos";
}

function headSoccerSpritePath(folder, pose) {
  return `kenney_sports-pack/PNG/${folder}/character${folder}%20(${pose}).png`;
}

function makeHeadSoccerPlayer(socket, index, bet) {
  const team = index % 2 === 0 ? "blue" : "red";
  const teamIndex = Math.floor(index / 2);
  const folders = team === "blue" ? HEAD_SOCCER_BLUE_FOLDERS : HEAD_SOCCER_RED_FOLDERS;
  const folder = folders[teamIndex % folders.length];
  const pose = (teamIndex % 12) + 1;

  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    team,
    side: team === "blue" ? 1 : -1,
    color: HEAD_SOCCER_TEAM_COLORS[team],
    sprite: headSoccerSpritePath(folder, pose),
    bet,
    x: 0,
    y: HEAD_SOCCER_FIELD.playerGround,
    vx: 0,
    vy: 0,
    radius: HEAD_SOCCER_FIELD.playerRadius,
    faceX: team === "blue" ? 1 : -1,
    faceY: 0,
    inputs: { left: false, right: false, up: false, down: false, jump: false, kick: false },
    kickTimer: 0,
    kickCooldown: 0,
    joinedAt: Date.now()
  };
}

function assignHeadSoccerTeams(room) {
  room.players.forEach((player, index) => {
    const team = index % 2 === 0 ? "blue" : "red";
    const teamIndex = Math.floor(index / 2);
    const folders = team === "blue" ? HEAD_SOCCER_BLUE_FOLDERS : HEAD_SOCCER_RED_FOLDERS;
    const folder = folders[teamIndex % folders.length];
    player.team = team;
    player.side = team === "blue" ? 1 : -1;
    player.color = HEAD_SOCCER_TEAM_COLORS[team];
    player.sprite = headSoccerSpritePath(folder, (teamIndex % 12) + 1);
  });
}

function resetHeadSoccerPositions(room) {
  const blue = room.players.filter(player => player.team === "blue");
  const red = room.players.filter(player => player.team === "red");
  const spots = [
    { x: 360, y: 338 },
    { x: 235, y: 220 },
    { x: 235, y: 455 },
    { x: 505, y: 338 },
    { x: 405, y: 150 },
    { x: 405, y: 525 },
    { x: 620, y: 245 },
    { x: 620, y: 430 }
  ];

  blue.forEach((player, index) => {
    const spot = spots[index % spots.length];
    player.x = spot.x;
    player.y = spot.y;
    player.vx = 0;
    player.vy = 0;
    player.faceX = 1;
    player.faceY = 0;
    player.kickTimer = 0;
    player.kickCooldown = 0;
  });

  red.forEach((player, index) => {
    const spot = spots[index % spots.length];
    player.x = HEAD_SOCCER_FIELD.width - spot.x;
    player.y = spot.y;
    player.vx = 0;
    player.vy = 0;
    player.faceX = -1;
    player.faceY = 0;
    player.kickTimer = 0;
    player.kickCooldown = 0;
  });

  room.ball = {
    x: HEAD_SOCCER_FIELD.width / 2,
    y: HEAD_SOCCER_FIELD.height / 2,
    vx: (Math.random() > 0.5 ? 1 : -1) * 120,
    vy: (Math.random() - 0.5) * 70,
    radius: HEAD_SOCCER_FIELD.ballRadius
  };
}

function serializeHeadSoccerRoom(room, viewerSocketId) {
  const now = Date.now();
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: HEAD_SOCCER_FIELD,
    scores: room.scores,
    ball: room.ball,
    gameEndsAt: room.gameEndsAt || null,
    gameLeftMs: room.status === "playing" ? Math.max(0, (room.gameEndsAt || now) - now) : 0,
    winnerTeam: room.winnerTeam || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      team: player.team,
      teamName: headSoccerTeamName(player.team),
      side: player.side,
      color: player.color,
      sprite: player.sprite,
      x: Math.round(player.x),
      y: Math.round(player.y),
      vx: Math.round(player.vx),
      vy: Math.round(player.vy),
      radius: player.radius,
      faceX: Number.isFinite(player.faceX) ? player.faceX : player.side,
      faceY: Number.isFinite(player.faceY) ? player.faceY : 0,
      kickTimer: player.kickTimer,
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitHeadSoccerUpdate(room) {
  room.players.forEach(player => {
    io.to(player.socketId).emit("head:update", serializeHeadSoccerRoom(room, player.socketId));
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("head:update", serializeHeadSoccerRoom(room, spectatorId));
  }
}

function startHeadSoccerRound(room, requestedBet = room.bet) {
  const maxBet = room.players.length >= 3 ? 20 : 50;
  const tableBet = clampNumber(requestedBet, 5, maxBet);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitHeadSoccerUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitHeadSoccerUpdate(room);
      return false;
    }
  }

  room.players.forEach(player => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    player.bet = tableBet;
    player.inputs = { left: false, right: false, up: false, down: false, jump: false, kick: false };
  });

  room.bet = tableBet;
  room.status = "playing";
  room.scores = { blue: 0, red: 0 };
  room.winnerTeam = null;
  room.startedAt = Date.now();
  room.gameEndsAt = room.startedAt + HEAD_SOCCER_GAME_MS;
  room.lastTick = Date.now();
  room.message = "Partida iniciada. Cada pessoa controla um jogador.";
  resetHeadSoccerPositions(room);

  clearInterval(room.tickTimer);
  room.tickTimer = setInterval(() => tickHeadSoccerRoom(room), HEAD_SOCCER_TICK_MS);

  emitHeadSoccerUpdate(room);
  broadcastOnlineList();
  return true;
}

function updateHeadSoccerPlayer(player, dt) {
  const acceleration = 3000;
  const maxSpeed = 430;
  const inputs = player.inputs || {};

  player.kickTimer = Math.max(0, Number(player.kickTimer || 0) - dt);
  player.kickCooldown = Math.max(0, Number(player.kickCooldown || 0) - dt);

  let ax = (inputs.right ? 1 : 0) - (inputs.left ? 1 : 0);
  let ay = (inputs.down ? 1 : 0) - ((inputs.up || inputs.jump) ? 1 : 0);
  const inputLength = Math.hypot(ax, ay);
  if (inputLength > 0) {
    ax /= inputLength;
    ay /= inputLength;
    player.faceX = ax;
    player.faceY = ay;
    player.vx += ax * acceleration * dt;
    player.vy += ay * acceleration * dt;
  } else {
    player.vx *= 0.84;
    player.vy *= 0.84;
  }

  const speed = Math.hypot(player.vx, player.vy);
  if (speed > maxSpeed) {
    player.vx = (player.vx / speed) * maxSpeed;
    player.vy = (player.vy / speed) * maxSpeed;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  player.x = clampNumber(player.x, 72, HEAD_SOCCER_FIELD.width - 72);
  player.y = clampNumber(player.y, 52, HEAD_SOCCER_FIELD.height - 52);
}

function resolveHeadSoccerPlayerCollisions(room) {
  for (let i = 0; i < room.players.length; i += 1) {
    for (let j = i + 1; j < room.players.length; j += 1) {
      const a = room.players[i];
      const b = room.players[j];
      const ax = a.x;
      const ay = a.y;
      const bx = b.x;
      const by = b.y;
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy) || 1;
      const minDist = a.radius + b.radius - 6;
      if (dist >= minDist) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const push = (minDist - dist) / 2;
      a.x -= nx * push;
      b.x += nx * push;
      a.y -= ny * push;
      b.y += ny * push;
      const avx = a.vx;
      const avy = a.vy;
      a.vx = b.vx * 0.38;
      a.vy = b.vy * 0.38;
      b.vx = avx * 0.38;
      b.vy = avy * 0.38;
      a.x = clampNumber(a.x, 72, HEAD_SOCCER_FIELD.width - 72);
      b.x = clampNumber(b.x, 72, HEAD_SOCCER_FIELD.width - 72);
      a.y = clampNumber(a.y, 52, HEAD_SOCCER_FIELD.height - 52);
      b.y = clampNumber(b.y, 52, HEAD_SOCCER_FIELD.height - 52);
    }
  }
}

function collideHeadSoccerBallWithPlayer(room, player) {
  const ball = room.ball;
  const headX = player.x;
  const headY = player.y;
  const dx = ball.x - headX;
  const dy = ball.y - headY;
  const minDist = ball.radius + player.radius;
  const dist = Math.hypot(dx, dy) || 1;

  if (dist < minDist) {
    const nx = dx / dist;
    const ny = dy / dist;
    ball.x = headX + nx * minDist;
    ball.y = headY + ny * minDist;
    ball.vx = nx * 380 + player.vx * 0.48;
    ball.vy = ny * 380 + player.vy * 0.48;
  }

  if (player.inputs?.kick && player.kickCooldown <= 0) {
    let dirX = Number(player.faceX || player.side || 1);
    let dirY = Number(player.faceY || 0);
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLength;
    dirY /= dirLength;
    const ballDirX = ball.x - player.x;
    const ballDirY = ball.y - player.y;
    const ballDirLength = Math.hypot(ballDirX, ballDirY) || 1;
    const dot = (ballDirX / ballDirLength) * dirX + (ballDirY / ballDirLength) * dirY;
    if (dot > 0.22) {
      dirX = ballDirX / ballDirLength;
      dirY = ballDirY / ballDirLength;
    }

    const footX = player.x + dirX * (player.radius + 18);
    const footY = player.y + dirY * (player.radius + 18);
    const footDx = ball.x - footX;
    const footDy = ball.y - footY;
    const footDist = Math.hypot(footDx, footDy) || 1;
    const inFront = (ball.x - player.x) * dirX + (ball.y - player.y) * dirY > -12;

    player.kickTimer = 0.24;
    player.kickCooldown = 0.28;

    if (inFront && footDist < ball.radius + player.radius + 50) {
      ball.x = footX + dirX * (ball.radius + 10);
      ball.y = footY + dirY * (ball.radius + 10);
      ball.vx = dirX * 980 + player.vx * 0.22;
      ball.vy = dirY * 980 + player.vy * 0.22;
    }
  }
}

function updateHeadSoccerBall(room, dt) {
  const ball = room.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.vx *= 0.986;
  ball.vy *= 0.986;

  if (ball.y - ball.radius < 18) {
    ball.y = 18 + ball.radius;
    ball.vy *= -0.78;
  }

  if (ball.y + ball.radius > HEAD_SOCCER_FIELD.height - 18) {
    ball.y = HEAD_SOCCER_FIELD.height - 18 - ball.radius;
    ball.vy *= -0.78;
  }

  room.players.forEach(player => collideHeadSoccerBallWithPlayer(room, player));

  if (ball.x - ball.radius <= 12 && ball.y > HEAD_SOCCER_FIELD.goalTop && ball.y < HEAD_SOCCER_FIELD.goalBottom) {
    return "red";
  }

  if (ball.x + ball.radius >= HEAD_SOCCER_FIELD.width - 12 && ball.y > HEAD_SOCCER_FIELD.goalTop && ball.y < HEAD_SOCCER_FIELD.goalBottom) {
    return "blue";
  }

  if (ball.x - ball.radius < 12 || ball.x + ball.radius > HEAD_SOCCER_FIELD.width - 12) {
    ball.x = clampNumber(ball.x, 12 + ball.radius, HEAD_SOCCER_FIELD.width - 12 - ball.radius);
    ball.vx *= -0.76;
  }

  return null;
}

function scoreHeadSoccerGoal(room, team) {
  room.scores[team] = Number(room.scores[team] || 0) + 1;
  room.message = `Gol dos ${headSoccerTeamName(team)}!`;

  if (room.scores[team] >= HEAD_SOCCER_GOALS_TO_WIN) {
    finishHeadSoccerRoom(room, "Placar maximo atingido.");
    return true;
  }

  resetHeadSoccerPositions(room);
  return false;
}

function tickHeadSoccerRoom(room) {
  if (!room || !headSoccerRooms.has(room.roomId) || room.status !== "playing") return;

  const now = Date.now();
  const dt = Math.min((now - (room.lastTick || now)) / 1000, 0.05);
  room.lastTick = now;

  room.players.forEach(player => updateHeadSoccerPlayer(player, dt));
  resolveHeadSoccerPlayerCollisions(room);
  const scoringTeam = updateHeadSoccerBall(room, dt);

  if (scoringTeam && scoreHeadSoccerGoal(room, scoringTeam)) return;

  if (now >= Number(room.gameEndsAt || 0)) {
    finishHeadSoccerRoom(room, "Tempo encerrado.");
    return;
  }

  emitHeadSoccerUpdate(room);
}

function finishHeadSoccerRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearInterval(room.tickTimer);
  room.tickTimer = null;
  room.status = "finished";
  room.gameEndsAt = null;

  let winnerTeam = null;
  if (room.scores.blue > room.scores.red) winnerTeam = "blue";
  if (room.scores.red > room.scores.blue) winnerTeam = "red";
  room.winnerTeam = winnerTeam;

  const totalPot = room.players.reduce((sum, player) => sum + Number(player.bet || room.bet || 0), 0);
  if (winnerTeam) {
    const winners = room.players.filter(player => player.team === winnerTeam);
    const share = winners.length ? Math.floor(totalPot / winners.length) : 0;
    winners.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + share
        });
        addExchangeWin(player.userId);
      }
    });
    room.message = `${reason ? `${reason} ` : ""}${headSoccerTeamName(winnerTeam)} venceram por ${room.scores.blue} x ${room.scores.red}.`;
  } else {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
    room.message = `${reason ? `${reason} ` : ""}Empate em ${room.scores.blue} x ${room.scores.red}. Apostas devolvidas.`;
  }
  resetExchangeLosses(
    room.players.map(player => player.userId),
    winnerTeam ? room.players.filter(player => player.team === winnerTeam).map(player => player.userId) : []
  );

  room.players.forEach(player => {
    io.to(player.socketId).emit("head:finished", {
      room: serializeHeadSoccerRoom(room, player.socketId),
      updatedUser: safeUser(db.findUser("id", player.userId))
    });
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
    const liveSocket = io.sockets.sockets.get(player.socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });

  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("head:finished", {
      room: serializeHeadSoccerRoom(room, spectatorId),
      updatedUser: null
    });
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }

  headSoccerRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelHeadSoccerRoom(room, reason = "Mesa de Head Soccer cancelada.") {
  if (!room) return;

  clearInterval(room.tickTimer);

  if (room.status === "playing") {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
  }

  room.players.forEach(player => {
    io.to(player.socketId).emit("head:cancelled", { message: reason });
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
    const liveSocket = io.sockets.sockets.get(player.socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });

  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("head:cancelled", { message: reason });
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }

  headSoccerRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeHeadSoccerPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) return;

  if (room.status === "playing") {
    cancelHeadSoccerRoom(room, reason || `${player.username} saiu da partida.`);
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }

  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (!room.players.length) {
    headSoccerRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }

  assignHeadSoccerTeams(room);
  resetHeadSoccerPositions(room);
  room.message = reason || `${player.username} saiu da mesa.`;
  emitHeadSoccerUpdate(room);
  broadcastOnlineList();
}

function findHeadSoccerRoomBySocket(socketId) {
  for (const room of headSoccerRooms.values()) {
    if (room.players.some(player => player.socketId === socketId)) return room;
  }
  return null;
}

const SLITHER_FIELD = {
  width: 2200,
  height: 1500,
  snakeRadius: 13,
  pelletRadius: 5
};
const SLITHER_MAX_PLAYERS = 8;
const SLITHER_TICK_MS = 1000 / 20;
const SLITHER_START_LENGTH = 230;
const SLITHER_SEGMENT_SPACING = 9;
const SLITHER_SPEED = 172;
const SLITHER_BOOST_MULTIPLIER = 1.62;
const SLITHER_BOOST_COST_PER_SEC = 22;
const SLITHER_MIN_BOOST_LENGTH = SLITHER_START_LENGTH + 28;
const SLITHER_TURN_RATE = Math.PI * 2.15;
const SLITHER_FOOD_COUNT = 145;
const SLITHER_LIVES = 2;
const SLITHER_GROWTH_PER_PELLET = 7.5;
const SLITHER_RESPAWN_MS = 1800;
const SLITHER_COLORS = ["#7c8cff", "#ff6b7d", "#57d39b", "#f6c453", "#c678dd", "#60d7ff", "#ff9f43", "#f8f0df"];

function normalizeAngle(angle) {
  let value = Number(angle) || 0;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function randomSlitherPoint(margin = 120) {
  return {
    x: margin + Math.random() * (SLITHER_FIELD.width - margin * 2),
    y: margin + Math.random() * (SLITHER_FIELD.height - margin * 2)
  };
}

function makeSlitherBody(x, y, angle, targetLength = SLITHER_START_LENGTH) {
  const points = [];
  const count = Math.max(8, Math.round(targetLength / SLITHER_SEGMENT_SPACING));
  for (let i = 0; i < count; i += 1) {
    points.push({
      x: x - Math.cos(angle) * i * SLITHER_SEGMENT_SPACING,
      y: y - Math.sin(angle) * i * SLITHER_SEGMENT_SPACING
    });
  }
  return points;
}

function makeSlitherPellet(x = null, y = null, value = 1) {
  const point = x === null || y === null ? randomSlitherPoint(48) : { x, y };
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    x: Math.round(point.x),
    y: Math.round(point.y),
    value,
    color: SLITHER_COLORS[Math.floor(Math.random() * SLITHER_COLORS.length)]
  };
}

function makeSlitherPlayer(socket, index, bet) {
  const point = randomSlitherPoint(220);
  const angle = Math.random() * Math.PI * 2;
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    color: SLITHER_COLORS[index % SLITHER_COLORS.length],
    bet,
    alive: true,
    eliminated: false,
    deaths: 0,
    pelletsEaten: 0,
    targetLength: SLITHER_START_LENGTH,
    angle,
    targetAngle: angle,
    boosting: false,
    body: makeSlitherBody(point.x, point.y, angle),
    respawnAt: 0,
    joinedAt: Date.now()
  };
}

function fillSlitherPellets(room) {
  while (room.pellets.length < SLITHER_FOOD_COUNT) {
    room.pellets.push(makeSlitherPellet());
  }
}

function ensureSlitherWatchMap(room) {
  if (!room.watchingBySocket) room.watchingBySocket = new Map();
  return room.watchingBySocket;
}

function pickSlitherWatchTarget(room, excludedSocketId = "") {
  return room.players.find(player => player.socketId !== excludedSocketId && player.alive && !player.eliminated)
    || room.players.find(player => player.socketId !== excludedSocketId && !player.eliminated)
    || room.players.find(player => player.socketId !== excludedSocketId)
    || null;
}

function canSocketWatchSlither(room, socketId) {
  const participant = room.players.find(player => player.socketId === socketId);
  if (participant) return !participant.alive || participant.eliminated;
  return Boolean(room.spectators?.has(socketId));
}

function setSlitherWatcher(room, watcherSocketId, targetSocketId) {
  if (!room || !canSocketWatchSlither(room, watcherSocketId)) return false;
  const target = room.players.find(player => player.socketId === targetSocketId && !player.eliminated)
    || pickSlitherWatchTarget(room, watcherSocketId);
  const watching = ensureSlitherWatchMap(room);
  if (!target) {
    watching.delete(watcherSocketId);
    return false;
  }
  watching.set(watcherSocketId, target.socketId);
  return true;
}

function clearSlitherWatcher(room, socketId) {
  const watching = ensureSlitherWatchMap(room);
  watching.delete(socketId);
  for (const [watcherSocketId, targetSocketId] of watching) {
    if (targetSocketId === socketId) {
      const nextTarget = pickSlitherWatchTarget(room, watcherSocketId);
      if (nextTarget) watching.set(watcherSocketId, nextTarget.socketId);
      else watching.delete(watcherSocketId);
    }
  }
}

function getSlitherWatcherCounts(room) {
  const counts = {};
  const watching = ensureSlitherWatchMap(room);
  for (const [watcherSocketId, targetSocketId] of watching) {
    if (!canSocketWatchSlither(room, watcherSocketId)) {
      watching.delete(watcherSocketId);
      continue;
    }
    const target = room.players.find(player => player.socketId === targetSocketId && !player.eliminated);
    if (!target) {
      watching.delete(watcherSocketId);
      continue;
    }
    counts[target.socketId] = (counts[target.socketId] || 0) + 1;
  }
  return counts;
}

function serializeSlitherRoom(room, viewerSocketId) {
  const now = Date.now();
  const watcherCounts = getSlitherWatcherCounts(room);
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: SLITHER_FIELD,
    pellets: room.pellets,
    winnerSocketId: room.winnerSocketId || null,
    startedAt: room.startedAt || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      color: player.color,
      alive: Boolean(player.alive),
      eliminated: Boolean(player.eliminated),
      lives: Math.max(0, SLITHER_LIVES - Number(player.deaths || 0)),
      length: Math.round(player.targetLength),
      boosting: Boolean(player.boosting),
      watchers: watcherCounts[player.socketId] || 0,
      pelletsEaten: player.pelletsEaten || 0,
      respawnLeftMs: !player.alive && !player.eliminated ? Math.max(0, Number(player.respawnAt || now) - now) : 0,
      body: (player.body || []).filter((_, bodyIndex) => bodyIndex % 2 === 0),
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitSlitherUpdate(room) {
  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("slither:update", serializeSlitherRoom(room, socketId));
  });
}

function findSlitherRoomBySocket(socketId) {
  for (const room of slitherRooms.values()) {
    if (room.players.some(player => player.socketId === socketId) || room.spectators?.has(socketId)) return room;
  }
  return null;
}

function getSlitherLiveContenders(room) {
  return room.players.filter(player => !player.eliminated);
}

function dropSlitherPellets(room, player) {
  const body = Array.isArray(player.body) ? player.body : [];
  const drops = Math.min(Math.max(0, Number(player.pelletsEaten || 0)), 120);
  if (!body.length || drops <= 0) return;

  for (let i = 0; i < drops; i += 1) {
    const point = body[Math.floor((i / Math.max(1, drops - 1)) * (body.length - 1))] || body[0];
    const jitter = 18;
    const x = clampNumber(point.x + (Math.random() - 0.5) * jitter, 20, SLITHER_FIELD.width - 20);
    const y = clampNumber(point.y + (Math.random() - 0.5) * jitter, 20, SLITHER_FIELD.height - 20);
    room.pellets.push(makeSlitherPellet(x, y, 1));
  }
}

function respawnSlitherPlayer(room, player) {
  const point = randomSlitherPoint(220);
  const angle = Math.random() * Math.PI * 2;
  player.alive = true;
  player.eliminated = false;
  player.pelletsEaten = 0;
  player.targetLength = SLITHER_START_LENGTH;
  player.angle = angle;
  player.targetAngle = angle;
  player.boosting = false;
  player.body = makeSlitherBody(point.x, point.y, angle);
  player.respawnAt = 0;
  clearSlitherWatcher(room, player.socketId);
  room.message = `${player.username} voltou para a partida.`;
}

function killSlitherPlayer(room, player, reason = "bateu em uma cobra") {
  if (!player || !player.alive || player.eliminated) return;

  player.alive = false;
  player.boosting = false;
  player.deaths = Math.min(SLITHER_LIVES, Number(player.deaths || 0) + 1);
  dropSlitherPellets(room, player);
  player.pelletsEaten = 0;

  if (player.deaths >= SLITHER_LIVES) {
    player.eliminated = true;
    player.respawnAt = 0;
    setSlitherWatcher(room, player.socketId, pickSlitherWatchTarget(room, player.socketId)?.socketId);
    room.message = `${player.username} ${reason} e foi eliminado.`;
  } else {
    player.respawnAt = Date.now() + SLITHER_RESPAWN_MS;
    room.message = `${player.username} ${reason}. Renasce em instantes.`;
  }
}

function startSlitherRound(room, requestedBet = room.bet) {
  const maxBet = room.players.length >= 3 ? 20 : 50;
  const tableBet = clampNumber(requestedBet, 5, maxBet);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitSlitherUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitSlitherUpdate(room);
      return false;
    }
  }

  room.players.forEach((player, index) => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    const fresh = makeSlitherPlayer(io.sockets.sockets.get(player.socketId) || {
      id: player.socketId,
      userId: player.userId,
      username: player.username,
      avatar: player.avatar
    }, index, tableBet);
    Object.assign(player, fresh, { socketId: player.socketId, userId: player.userId, username: player.username, avatar: player.avatar || "" });
  });

  room.bet = tableBet;
  room.status = "playing";
  room.startedAt = Date.now();
  room.winnerSocketId = null;
  room.watchingBySocket = new Map();
  room.pellets = [];
  room.message = "Partida iniciada. Coma bolinhas, cresca e faca a cabeca dos rivais bater no seu corpo.";
  fillSlitherPellets(room);

  clearInterval(room.tickTimer);
  room.lastTick = Date.now();
  room.tickTimer = setInterval(() => tickSlitherRoom(room), SLITHER_TICK_MS);
  emitSlitherUpdate(room);
  broadcastOnlineList();
  return true;
}

function finishSlitherRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearInterval(room.tickTimer);
  room.tickTimer = null;
  room.status = "finished";

  const contenders = getSlitherLiveContenders(room);
  const winner = contenders.length === 1 ? contenders[0] : null;
  room.winnerSocketId = winner?.socketId || null;

  const totalPot = room.players.reduce((sum, player) => sum + Number(player.bet || room.bet || 0), 0);
  if (winner) {
    const user = db.findUser("id", winner.userId);
    if (user) {
      db.updateUser(winner.userId, {
        bet_credits: Number(user.bet_credits || 0) + totalPot
      });
      addExchangeWin(winner.userId);
    }
    room.message = `${reason ? `${reason} ` : ""}${winner.username} venceu o Slither e levou ${totalPot} creditos.`;
  } else {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
    room.message = `${reason ? `${reason} ` : ""}Slither encerrado sem vencedor. Apostas devolvidas.`;
  }
  resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    const participant = room.players.find(player => player.socketId === socketId);
    io.to(socketId).emit("slither:finished", {
      room: serializeSlitherRoom(room, socketId),
      updatedUser: participant ? safeUser(db.findUser("id", participant.userId)) : null
    });
  });

  room.players.forEach(player => {
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
    const liveSocket = io.sockets.sockets.get(player.socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });
  for (const spectatorId of room.spectators || []) {
    const liveSocket = io.sockets.sockets.get(spectatorId);
    if (liveSocket) liveSocket.leave(room.roomId);
  }

  slitherRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelSlitherRoom(room, reason = "Sala de Slither cancelada.") {
  if (!room) return;

  clearInterval(room.tickTimer);
  if (room.status === "playing") {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
  }

  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("slither:cancelled", { message: reason });
    const online = onlinePlayers.get(socketId);
    if (online && online.roomId === room.roomId && room.players.some(player => player.socketId === socketId)) {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });

  slitherRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeSlitherPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) {
    clearSpectator(room, socketId);
    clearSlitherWatcher(room, socketId);
    emitSlitherUpdate(room);
    broadcastOnlineList();
    return;
  }

  if (room.status === "playing") {
    if (player.alive && !player.eliminated) {
      player.deaths = SLITHER_LIVES - 1;
      killSlitherPlayer(room, player, reason || "saiu da partida");
    }

    room.players = room.players.filter(item => item.socketId !== socketId);
    clearSlitherWatcher(room, socketId);
    const online = onlinePlayers.get(socketId);
    if (online && online.roomId === room.roomId) {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);

    if (room.hostSocketId === socketId && room.players.length) {
      room.hostSocketId = room.players[0].socketId;
      room.hostUsername = room.players[0].username;
    }

    if (!room.players.length) {
      slitherRooms.delete(room.roomId);
      broadcastOnlineList();
      return;
    }

    if (getSlitherLiveContenders(room).length <= 1) {
      finishSlitherRoom(room, reason || `${player.username} saiu da partida.`);
      return;
    }
    emitSlitherUpdate(room);
    broadcastOnlineList();
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  clearSlitherWatcher(room, socketId);
  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (!room.players.length) {
    slitherRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  room.players.forEach((item, index) => { item.color = SLITHER_COLORS[index % SLITHER_COLORS.length]; });
  room.message = reason || `${player.username} saiu da sala.`;
  emitSlitherUpdate(room);
  broadcastOnlineList();
}

function tickSlitherRoom(room) {
  if (!room || !slitherRooms.has(room.roomId) || room.status !== "playing") return;

  const now = Date.now();
  const dt = Math.min((now - (room.lastTick || now)) / 1000, 0.08);
  room.lastTick = now;

  room.players.forEach(player => {
    if (!player.alive && !player.eliminated && now >= Number(player.respawnAt || 0)) {
      respawnSlitherPlayer(room, player);
    }
  });

  const alivePlayers = room.players.filter(player => player.alive && !player.eliminated);
  alivePlayers.forEach(player => {
    const diff = normalizeAngle(Number(player.targetAngle || player.angle) - Number(player.angle || 0));
    const maxTurn = SLITHER_TURN_RATE * dt;
    player.angle = normalizeAngle(Number(player.angle || 0) + clampNumber(diff, -maxTurn, maxTurn));
    const canBoost = Boolean(player.boosting) && Number(player.targetLength || 0) > SLITHER_MIN_BOOST_LENGTH;
    if (player.boosting && !canBoost) {
      player.boosting = false;
    }
    if (canBoost) {
      player.targetLength = Math.max(SLITHER_START_LENGTH, Number(player.targetLength || SLITHER_START_LENGTH) - SLITHER_BOOST_COST_PER_SEC * dt);
    }

    const head = player.body[0] || randomSlitherPoint(220);
    const speed = SLITHER_SPEED * (canBoost ? SLITHER_BOOST_MULTIPLIER : 1);
    const nextHead = {
      x: clampNumber(head.x + Math.cos(player.angle) * speed * dt, 16, SLITHER_FIELD.width - 16),
      y: clampNumber(head.y + Math.sin(player.angle) * speed * dt, 16, SLITHER_FIELD.height - 16)
    };
    player.body.unshift(nextHead);
    const maxPoints = Math.max(10, Math.round(Number(player.targetLength || SLITHER_START_LENGTH) / SLITHER_SEGMENT_SPACING));
    if (player.body.length > maxPoints) player.body.length = maxPoints;

    for (let i = room.pellets.length - 1; i >= 0; i -= 1) {
      const pellet = room.pellets[i];
      if (Math.hypot(nextHead.x - pellet.x, nextHead.y - pellet.y) <= SLITHER_FIELD.snakeRadius + SLITHER_FIELD.pelletRadius + 4) {
        room.pellets.splice(i, 1);
        player.pelletsEaten += Number(pellet.value || 1);
        player.targetLength += SLITHER_GROWTH_PER_PELLET * Number(pellet.value || 1);
      }
    }
  });

  alivePlayers.forEach(player => {
    const head = player.body[0];
    if (!head || !player.alive) return;

    for (const other of room.players) {
      if (!other.alive || other.eliminated || other.socketId === player.socketId) continue;
      const body = other.body || [];
      for (let i = 5; i < body.length; i += 2) {
        const point = body[i];
        if (Math.hypot(head.x - point.x, head.y - point.y) <= SLITHER_FIELD.snakeRadius * 1.6) {
          killSlitherPlayer(room, player, `bateu na cobra de ${other.username}`);
          break;
        }
      }
      if (!player.alive) break;
    }
  });

  fillSlitherPellets(room);

  if (getSlitherLiveContenders(room).length <= 1) {
    finishSlitherRoom(room);
    return;
  }

  emitSlitherUpdate(room);
}

const CRASH_TICK_MS = 100;
const CRASH_MAX_MULTIPLIER = 300;
const CRASH_RATE = 0.075;
const CRASH_HOUSE_EDGE = 0.76;

function crashRandomFloat() {
  return crypto.randomInt(1, 1_000_000) / 1_000_000;
}

function makeCrashPoint() {
  const roll = crashRandomFloat();
  const raw = CRASH_HOUSE_EDGE / Math.max(0.000001, 1 - roll);
  return Math.min(CRASH_MAX_MULTIPLIER, Math.max(1, Math.floor(raw * 100) / 100));
}

function makeCrashPlayer(socket, bet) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    bet,
    status: "waiting",
    cashoutMultiplier: null,
    payout: 0,
    joinedAt: Date.now()
  };
}

function getCrashMultiplier(room) {
  if (room.status !== "playing") return Number(room.multiplier || 1);
  const elapsed = Math.max(0, Date.now() - Number(room.startedAt || Date.now())) / 1000;
  return Math.min(CRASH_MAX_MULTIPLIER, Math.max(1, Math.exp(elapsed * CRASH_RATE)));
}

function serializeCrashRoom(room, viewerSocketId) {
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  const multiplier = room.status === "playing" ? getCrashMultiplier(room) : Number(room.multiplier || 1);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    multiplier: Math.min(CRASH_MAX_MULTIPLIER, Number(multiplier.toFixed(2))),
    maxMultiplier: CRASH_MAX_MULTIPLIER,
    crashPoint: room.status === "finished" ? room.crashPoint : null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    cashouts: room.cashouts || [],
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      bet: player.bet,
      status: player.status,
      cashoutMultiplier: player.cashoutMultiplier,
      payout: player.payout || 0,
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitCrashUpdate(room) {
  room.players.forEach(player => {
    io.to(player.socketId).emit("crash:update", serializeCrashRoom(room, player.socketId));
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("crash:update", serializeCrashRoom(room, spectatorId));
  }
}

function findCrashRoomBySocket(socketId) {
  for (const room of crashRooms.values()) {
    if (room.players.some(player => player.socketId === socketId) || room.spectators?.has(socketId)) return room;
  }
  return null;
}

function unresolvedCrashPlayers(room) {
  return room.players.filter(player => player.status === "flying");
}

function finishCrashRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearInterval(room.tickTimer);
  room.tickTimer = null;
  room.status = "finished";
  room.multiplier = Number(Math.min(room.crashPoint || getCrashMultiplier(room), CRASH_MAX_MULTIPLIER).toFixed(2));

  let houseWins = 0;
  room.players.forEach(player => {
    if (player.status === "flying") {
      player.status = "crashed";
      houseWins += Number(player.bet || room.bet || 0);
    }
  });
  resetExchangeLosses(
    room.players.filter(player => player.status === "crashed").map(player => player.userId),
    []
  );

  room.message = reason || (houseWins > 0
    ? `Crash em ${room.multiplier.toFixed(2)}x. A casa ficou com ${houseWins} creditos.`
    : `Crash em ${room.multiplier.toFixed(2)}x. Todo mundo que sacou saiu vivo.`);

  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    const participant = room.players.find(player => player.socketId === socketId);
    io.to(socketId).emit("crash:finished", {
      room: serializeCrashRoom(room, socketId),
      updatedUser: participant ? safeUser(db.findUser("id", participant.userId)) : null
    });
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });

  room.players.forEach(player => {
    const online = onlinePlayers.get(player.socketId);
    if (online && online.roomId === room.roomId) {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
  });

  crashRooms.delete(room.roomId);
  broadcastOnlineList();
}

function startCrashRound(room) {
  if (!room || room.status !== "waiting") return false;
  if (!room.players.length) return false;

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < Number(player.bet || room.bet || 0)) {
      room.message = `${player.username} nao tem creditos para apostar.`;
      emitCrashUpdate(room);
      return false;
    }
  }

  room.players.forEach(player => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - Number(player.bet || room.bet || 0))
    });
    player.status = "flying";
    player.cashoutMultiplier = null;
    player.payout = 0;
  });

  room.status = "playing";
  room.crashPoint = makeCrashPoint();
  room.multiplier = 1;
  room.startedAt = Date.now();
  room.cashouts = [];
  room.message = "O aviao decolou. Saque antes do crash.";
  clearInterval(room.tickTimer);
  room.tickTimer = setInterval(() => tickCrashRoom(room), CRASH_TICK_MS);
  emitCrashUpdate(room);
  broadcastOnlineList();
  return true;
}

function cashoutCrashPlayer(room, socket) {
  if (!room || room.status !== "playing") return;
  const player = room.players.find(item => item.socketId === socket.id);
  if (!player || player.status !== "flying") return;

  const multiplier = Math.min(getCrashMultiplier(room), CRASH_MAX_MULTIPLIER);
  if (multiplier >= Number(room.crashPoint || CRASH_MAX_MULTIPLIER)) return;

  const payout = Math.max(0, Math.floor(Number(player.bet || room.bet || 0) * multiplier));
  player.status = "cashed";
  player.cashoutMultiplier = Number(multiplier.toFixed(2));
  player.payout = payout;

  const user = db.findUser("id", player.userId);
  if (user) {
    db.updateUser(player.userId, {
      bet_credits: Number(user.bet_credits || 0) + payout
    });
    addExchangeWin(player.userId);
  }

  const cashout = {
    id: `${player.socketId}-${Date.now()}`,
    socketId: player.socketId,
    username: player.username,
    multiplier: player.cashoutMultiplier,
    payout,
    at: Date.now()
  };
  room.cashouts.push(cashout);
  if (room.cashouts.length > 12) room.cashouts.shift();
  room.message = `${player.username} sacou em ${player.cashoutMultiplier.toFixed(2)}x e levou ${payout} creditos.`;
  emitCrashUpdate(room);
}

function tickCrashRoom(room) {
  if (!room || !crashRooms.has(room.roomId) || room.status !== "playing") return;

  const multiplier = getCrashMultiplier(room);
  room.multiplier = Number(Math.min(multiplier, CRASH_MAX_MULTIPLIER).toFixed(2));

  if (room.multiplier >= Number(room.crashPoint || CRASH_MAX_MULTIPLIER)) {
    finishCrashRoom(room);
    return;
  }

  emitCrashUpdate(room);
}

function cancelCrashRoom(room, reason = "Sala de Crash cancelada.") {
  if (!room) return;
  clearInterval(room.tickTimer);

  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("crash:cancelled", { message: reason });
    const participant = room.players.find(player => player.socketId === socketId);
    if (participant) {
      const online = onlinePlayers.get(socketId);
      if (online && online.roomId === room.roomId) {
        online.inGame = false;
        online.roomId = null;
        online.game = null;
      }
    }
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
  });

  crashRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeCrashPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) {
    clearSpectator(room, socketId);
    emitCrashUpdate(room);
    broadcastOnlineList();
    return;
  }

  if (room.status === "playing") {
    if (player.status === "flying") {
      player.status = "crashed";
      resetExchangeWinStreak(player.userId);
      room.message = reason || `${player.username} saiu e perdeu a aposta.`;
    }
    const online = onlinePlayers.get(socketId);
    if (online && online.roomId === room.roomId) {
      online.inGame = false;
      online.roomId = null;
      online.game = null;
    }
    const liveSocket = io.sockets.sockets.get(socketId);
    if (liveSocket) liveSocket.leave(room.roomId);
    emitCrashUpdate(room);
    broadcastOnlineList();
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (!room.players.length) {
    crashRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  room.message = reason || `${player.username} saiu da sala.`;
  emitCrashUpdate(room);
  broadcastOnlineList();
}

io.on("connection", (socket) => {
  console.log(`[+] ${socket.username} conectado`);
  const connectedUser = normalizeUserProgress(db.findUser("id", socket.userId));
  socket.avatar = connectedUser?.avatar || socket.avatar || "";

  onlinePlayers.set(socket.id, {
    socketId: socket.id,
    userId:   socket.userId,
    username: socket.username,
    avatar:   socket.avatar,
    inGame:   false,
    roomId:   null,
    game:     null
  });

  socket.emit("chat:history", chatHistory);
  broadcastOnlineList();

  socket.on("chat:send", ({ text }) => {
    const cleanText = cleanChatText(text);
    if (!cleanText) return;

    emitChatMessage({
      type: "user",
      userId: socket.userId,
      username: socket.username,
      avatar: socket.avatar || "",
      text: cleanText
    });
  });

  // ── Desafio ────────────────────────────────────────────────────────────
  socket.on("challenge:send", ({ toSocketId, myBet }) => {
    const opponent = onlinePlayers.get(toSocketId);
    if (!opponent || opponent.inGame)
      return socket.emit("challenge:error", "Jogador indisponível");

    const user = db.findUser("id", socket.userId);
    if (!user || user.bet_credits < myBet)
      return socket.emit("challenge:error", "Créditos de aposta insuficientes");

    const challengeId = `${socket.id}-${Date.now()}`;
    pendingChallenges.set(challengeId, {
      challengeId,
      fromSocketId: socket.id,
      fromUsername: socket.username,
      toSocketId,
      fromBet:      myBet
    });

    io.to(toSocketId).emit("challenge:received", {
      challengeId,
      fromUsername: socket.username,
      fromBet:      myBet
    });
    socket.emit("challenge:sent", { challengeId, toUsername: opponent.username });
  });

  socket.on("challenge:accept", ({ challengeId, myBet }) => {
    const ch = pendingChallenges.get(challengeId);
    if (!ch) return socket.emit("challenge:error", "Desafio expirado");

    const user = db.findUser("id", socket.userId);
    if (!user || user.bet_credits < myBet)
      return socket.emit("challenge:error", "Créditos de aposta insuficientes");

    pendingChallenges.delete(challengeId);

    const p1     = onlinePlayers.get(ch.fromSocketId);
    const match  = db.createMatch(p1?.userId || 0, socket.userId, ch.fromBet, myBet);
    const roomId = `room-${match.id}`;

    [ch.fromSocketId, socket.id].forEach(sid => {
      const p = onlinePlayers.get(sid);
      if (p) { p.inGame = true; p.roomId = roomId; }
    });

    activeRooms.set(roomId, {
      roomId,
      matchId:         match.id,
      player1SocketId: ch.fromSocketId,
      player2SocketId: socket.id,
      player1Bet:      ch.fromBet,
      player2Bet:      myBet
    });

    const fromSocket = io.sockets.sockets.get(ch.fromSocketId);
    if (fromSocket) fromSocket.join(roomId);
    socket.join(roomId);

    io.to(ch.fromSocketId).emit("game:start", {
      roomId, matchId: match.id, role: "host",
      opponentUsername: socket.username,
      myBet: ch.fromBet, opponentBet: myBet
    });
    io.to(socket.id).emit("game:start", {
      roomId, matchId: match.id, role: "guest",
      opponentUsername: ch.fromUsername,
      myBet, opponentBet: ch.fromBet
    });

    broadcastOnlineList();
  });

  socket.on("challenge:reject", ({ challengeId }) => {
    const ch = pendingChallenges.get(challengeId);
    if (ch) {
      pendingChallenges.delete(challengeId);
      io.to(ch.fromSocketId).emit("challenge:rejected", { username: socket.username });
    }
  });

  socket.on("challenge:cancel", ({ challengeId }) => {
    const ch = pendingChallenges.get(challengeId);
    if (ch && ch.fromSocketId === socket.id) {
      pendingChallenges.delete(challengeId);
      io.to(ch.toSocketId).emit("challenge:cancelled", { username: socket.username });
    }
  });

  // ── Emoji Taunts ───────────────────────────────────────────────────────
  socket.on("game:taunt", ({ emoji, x, y, game }) => {
    const p = onlinePlayers.get(socket.id);
    const cleanEmoji = Array.from(String(emoji || "").trim()).filter(char => char.trim()).slice(0, 4).join("");
    if (!cleanEmoji) return;

    const payload = {
      emoji: cleanEmoji,
      from: socket.username,
      fromSocketId: socket.id,
      game: String(game || ""),
      x: Number.isFinite(Number(x)) ? Number(x) : null,
      y: Number.isFinite(Number(y)) ? Number(y) : null
    };
    const targets = new Set();

    const buttonRoom = findButtonSoccerRoomBySocket(socket.id);
    if (buttonRoom) {
      buttonRoom.players.forEach(player => targets.add(player.socketId));
    }

    const headRoom = findHeadSoccerRoomBySocket(socket.id);
    if (headRoom) {
      headRoom.players.forEach(player => targets.add(player.socketId));
    }

    const blackjackRoom = findBlackjackRoomBySocket(socket.id);
    if (blackjackRoom) {
      blackjackRoom.players.forEach(player => targets.add(player.socketId));
    }

    const horseRoom = findHorseRoomBySocket(socket.id);
    if (horseRoom) {
      horseRoom.players.forEach(player => targets.add(player.socketId));
    }

    const slitherRoom = findSlitherRoomBySocket(socket.id);
    if (slitherRoom) {
      slitherRoom.players.forEach(player => targets.add(player.socketId));
      for (const spectatorId of slitherRoom.spectators || []) targets.add(spectatorId);
    }

    const crashRoom = findCrashRoomBySocket(socket.id);
    if (crashRoom) {
      crashRoom.players.forEach(player => targets.add(player.socketId));
      for (const spectatorId of crashRoom.spectators || []) targets.add(spectatorId);
    }

    if (p?.roomId) {
      const activeRoom = activeRooms.get(p.roomId);
      if (activeRoom) {
        targets.add(activeRoom.player1SocketId);
        targets.add(activeRoom.player2SocketId);
      }
    }

    if (targets.size) {
      targets.forEach(targetSocketId => io.to(targetSocketId).emit("game:taunt", payload));
    } else if (p?.roomId) {
      socket.to(p.roomId).emit("game:taunt", payload);
    }
  });

  // ── Jogo em tempo real ─────────────────────────────────────────────────
  socket.on("game:state", (state) => {
    const p = onlinePlayers.get(socket.id);
    if (p?.roomId) socket.volatile.to(p.roomId).emit("game:state", state);
  });

  socket.on("game:input", (inputs) => {
    const p = onlinePlayers.get(socket.id);
    if (p?.roomId) socket.volatile.to(p.roomId).emit("game:input", inputs);
  });

  socket.on("game:goal", ({ scorer, scores, roomId }) => {
    const room = activeRooms.get(roomId);
    if (room) socket.to(roomId).emit("game:goal", { scorer, scores });
  });

  socket.on("game:end", ({ roomId, player1Score, player2Score }) => {
    const room = activeRooms.get(roomId);
    if (!room) return;

    const p1 = onlinePlayers.get(room.player1SocketId);
    const p2 = onlinePlayers.get(room.player2SocketId);

    let winnerId = null;
    if (player1Score > player2Score) winnerId = p1?.userId;
    else if (player2Score > player1Score) winnerId = p2?.userId;

    db.updateMatch(room.matchId, {
      player1_score: player1Score,
      player2_score: player2Score,
      winner_id:     winnerId,
      status:        "finished"
    });

    // Transfere créditos de aposta
    const totalPot = room.player1Bet + room.player2Bet;
    if (winnerId) {
      const loserId = winnerId === p1?.userId ? p2?.userId : p1?.userId;
      const winnerBet = winnerId === p1?.userId ? room.player1Bet : room.player2Bet;
      const loserBet  = totalPot - winnerBet;

      const winner = db.findUser("id", winnerId);
      if (winner) db.updateUser(winnerId, { bet_credits: winner.bet_credits + totalPot - winnerBet });
      // (o vencedor já tinha a aposta descontada no frontend; recebe o pote inteiro - já foi descontado)
      const loser = db.findUser("id", loserId);
      if (loser) db.updateUser(loserId, { bet_credits: Math.max(0, loser.bet_credits - loserBet) });
    }

    if (winnerId) {
      addExchangeWin(winnerId);
    }
    resetExchangeLosses([p1?.userId, p2?.userId], winnerId ? [winnerId] : []);

    // Envia resultado com saldo atualizado para cada jogador
    [[room.player1SocketId, p1?.userId], [room.player2SocketId, p2?.userId]].forEach(([sid, uid]) => {
      if (!sid || !uid) return;
      const updated = db.findUser("id", uid);
      io.to(sid).emit("game:result", {
        player1Score, player2Score, winnerId,
        updatedUser: safeUser(updated)
      });
    });

    // Libera jogadores
    [room.player1SocketId, room.player2SocketId].forEach(sid => {
      const p = onlinePlayers.get(sid);
      if (p) { p.inGame = false; p.roomId = null; }
    });
    activeRooms.delete(roomId);
    broadcastOnlineList();
  });

  // ── Blackjack ───────────────────────────────────────────────────────────
  // Head Soccer em sala
  socket.on("head:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("head:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("head:error", "Voce ja esta em uma partida.");

    const roomId = `head-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      scores: { blue: 0, red: 0 },
      ball: {
        x: HEAD_SOCCER_FIELD.width / 2,
        y: HEAD_SOCCER_FIELD.height / 2,
        vx: 0,
        vy: 0,
        radius: HEAD_SOCCER_FIELD.ballRadius
      },
      gameEndsAt: null,
      winnerTeam: null,
      tickTimer: null,
      lastTick: Date.now(),
      spectators: new Set(),
      message: "Sala aberta. Cada pessoa que entrar vira um jogador.",
      players: [makeHeadSoccerPlayer(socket, 0, tableBet)]
    };
    resetHeadSoccerPositions(room);
    headSoccerRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "head"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("head:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitHeadSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("head:join", ({ roomId }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("head:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitHeadSoccerUpdate(room);
    if (room.players.length >= HEAD_SOCCER_MAX_PLAYERS)
      return socket.emit("head:error", `Sala cheia (max. ${HEAD_SOCCER_MAX_PLAYERS} jogadores).`);

    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("head:error", `Esta sala teria ${room.players.length + 1} jogadores. Aposta maxima: ${maxBet} creditos.`);
    }

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("head:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("head:error", "Voce ja esta em uma partida.");

    room.players.push(makeHeadSoccerPlayer(socket, room.players.length, room.bet));
    resetHeadSoccerPositions(room);
    room.message = `${socket.username} entrou no Head Soccer.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "head"; }
    emitHeadSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("head:start", ({ roomId }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("head:error", "So o dono da sala pode iniciar.");
    startHeadSoccerRound(room, room.bet);
  });

  socket.on("head:input", ({ roomId, inputs }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player) return;
    player.inputs = {
      left: Boolean(inputs?.left),
      right: Boolean(inputs?.right),
      up: Boolean(inputs?.up || inputs?.jump),
      down: Boolean(inputs?.down),
      jump: Boolean(inputs?.jump),
      kick: Boolean(inputs?.kick)
    };
  });

  socket.on("head:leave", ({ roomId }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitHeadSoccerUpdate(room);
      broadcastOnlineList();
      return;
    }
    removeHeadSoccerPlayer(room, socket.id, `${socket.username} saiu da sala.`);
  });

  socket.on("head:spectate", ({ roomId }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("head:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitHeadSoccerUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("head:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitHeadSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("head:unwatch", ({ roomId }) => {
    const room = headSoccerRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitHeadSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:create", ({ bet }) => {
    const tableBet = Math.max(5, Math.min(50, Number(bet) || 10));
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || user.bet_credits < tableBet)
      return socket.emit("blackjack:error", "Créditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("blackjack:error", "Você já está em uma partida.");

    const roomId = `bj-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      deck: [],
      dealerCards: [],
      winnerSocketId: null,
      houseWon: false,
      spectators: new Set(),
      message: "Mesa aberta. Aguarde jogadores entrarem ou comece contra a casa.",
      players: [{
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
        avatar: socket.avatar || "",
        bet: tableBet,
        cards: [],
        status: "waiting",
        joinedAt: Date.now()
      }]
    };

    blackjackRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "blackjack"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("blackjack:invite", {
          roomId,
          fromUsername: socket.username,
          bet: tableBet
        });
      }
    }

    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:join", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("blackjack:error", "Mesa indisponível.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitBlackjackUpdate(room);

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || user.bet_credits < room.bet)
      return socket.emit("blackjack:error", "Créditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("blackjack:error", "Você já está em uma partida.");

    // Feature 4: Bet cap for 3+ players
    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("blackjack:error", `Esta mesa tem ${room.players.length + 1} jogadores. Aposta máxima é ${maxBet} créditos.`);
    }

    room.players.push({
      socketId: socket.id,
      userId: socket.userId,
      username: socket.username,
      avatar: socket.avatar || "",
      bet: room.bet,
      cards: [],
      status: "waiting",
      joinedAt: Date.now()
    });
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "blackjack"; }

    room.message = `${socket.username} entrou na mesa.`;
    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:leave", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (room?.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitBlackjackUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId === socket.id) {
      cancelBlackjackRoom(room, "O dono da mesa cancelou o 21.");
      return;
    }

    room.players = room.players.filter(player => player.socketId !== socket.id);
    socket.leave(roomId);
    const online = onlinePlayers.get(socket.id);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
    room.message = `${socket.username} saiu da mesa.`;
    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:spectate", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("blackjack:error", "Mesa indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitBlackjackUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("blackjack:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:unwatch", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:start", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("blackjack:error", "Só o dono da mesa pode começar.");

    room.status = "playing";
    room.deck = makeDeck();
    room.dealerCards = [drawBlackjackCard(room), drawBlackjackCard(room)];
    room.message = "Mesa em andamento. Peça carta ou pare.";
    room.players.forEach(player => {
      player.cards = [drawBlackjackCard(room), drawBlackjackCard(room)];
      player.status = handTotal(player.cards) === 21 ? "stand" : "playing";
    });

    emitBlackjackUpdate(room);
    if (allBlackjackPlayersDone(room)) finishBlackjackRoom(room);
  });

  socket.on("blackjack:hit", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player || player.status !== "playing") return;

    player.cards.push(drawBlackjackCard(room));
    const total = handTotal(player.cards);
    if (total > 21) player.status = "bust";
    if (total === 21) player.status = "stand";
    room.message = `${player.username} pediu carta.`;

    emitBlackjackUpdate(room);
    if (allBlackjackPlayersDone(room)) finishBlackjackRoom(room);
  });

  socket.on("blackjack:stand", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player || player.status !== "playing") return;

    player.status = "stand";
    room.message = `${player.username} parou.`;

    emitBlackjackUpdate(room);
    if (allBlackjackPlayersDone(room)) finishBlackjackRoom(room);
  });

  // Futebol de Botao
  socket.on("button:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("button:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("button:error", "Voce ja esta em uma partida.");

    const roomId = `button-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      scores: { red: 0, white: 0 },
      ball: { x: BUTTON_SOCCER_FIELD.width / 2, y: BUTTON_SOCCER_FIELD.height / 2, vx: 0, vy: 0 },
      turnIndex: 0,
      turnSocketId: null,
      turnEndsAt: null,
      gameEndsAt: null,
      winnerTeam: null,
      lastGoal: null,
      lastShot: null,
      shotSeq: 0,
      goalSeq: 0,
      spectators: new Set(),
      message: "Mesa aberta. Jogadores entram como botoes alternando times.",
      players: [makeButtonSoccerPlayer(socket, 0, tableBet)]
    };
    resetButtonSoccerPositions(room);
    buttonSoccerRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "button"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("button:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitButtonSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("button:join", ({ roomId }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("button:error", "Mesa indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitButtonSoccerUpdate(room);
    if (room.players.length >= BUTTON_SOCCER_MAX_PLAYERS)
      return socket.emit("button:error", `Mesa cheia (max. ${BUTTON_SOCCER_MAX_PLAYERS} jogadores).`);

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("button:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("button:error", "Voce ja esta em uma partida.");

    room.players.push(makeButtonSoccerPlayer(socket, room.players.length, room.bet));
    resetButtonSoccerPositions(room);
    room.message = `${socket.username} entrou como botao.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "button"; }
    emitButtonSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("button:start", ({ roomId }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("button:error", "So o dono da mesa pode iniciar.");
    startButtonSoccerRound(room, room.bet);
  });

  socket.on("button:shoot", ({ roomId, angle, power }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    if (room.turnSocketId !== socket.id)
      return socket.emit("button:error", "Aguarde sua vez.");

    if (Date.now() > Number(room.turnEndsAt || 0)) {
      const current = room.players.find(player => player.socketId === socket.id);
      room.message = `${current?.username || "Jogador"} perdeu o turno.`;
      advanceButtonTurn(room);
      emitButtonSoccerUpdate(room);
      return;
    }

    const player = room.players.find(item => item.socketId === socket.id);
    if (!player) return;
    clearTimeout(room.turnTimer);

    const goalTeam = simulateButtonSoccerShot(room, player, angle, power);
    if (goalTeam && room.scores[goalTeam] >= 3) {
      finishButtonSoccerRoom(room, "Placar maximo atingido.");
      return;
    }

    if (Date.now() >= room.gameEndsAt) {
      finishButtonSoccerRoom(room, "Tempo encerrado.");
      return;
    }

    advanceButtonTurn(room);
    if (room.status === "playing") emitButtonSoccerUpdate(room);
  });

  socket.on("button:ready", ({ roomId, bet }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room || room.status !== "finished") return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player) return;

    player.ready = true;
    player.voteBet = clampNumber(bet || room.bet, 5, 50);
    room.message = `${socket.username} esta pronto para revanche.`;

    if (room.players.length >= 2 && room.players.every(item => item.ready)) {
      const nextBet = pickButtonReplayBet(room);
      startButtonSoccerRound(room, nextBet);
      return;
    }

    emitButtonSoccerUpdate(room);
  });

  socket.on("button:leave", ({ roomId }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitButtonSoccerUpdate(room);
      broadcastOnlineList();
      return;
    }
    removeButtonSoccerPlayer(room, socket.id, `${socket.username} saiu da mesa.`);
    socket.leave(roomId);
  });

  socket.on("button:spectate", ({ roomId }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("button:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitButtonSoccerUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("button:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitButtonSoccerUpdate(room);
    broadcastOnlineList();
  });

  socket.on("button:unwatch", ({ roomId }) => {
    const room = buttonSoccerRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitButtonSoccerUpdate(room);
    broadcastOnlineList();
  });

  // Slither
  socket.on("slither:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("slither:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("slither:error", "Voce ja esta em uma partida.");

    const roomId = `slither-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      pot: tableBet,
      status: "waiting",
      message: "Sala aberta. Cada jogador tem 2 vidas.",
      pellets: [],
      spectators: new Set(),
      watchingBySocket: new Map(),
      winnerSocketId: null,
      tickTimer: null,
      lastTick: Date.now(),
      players: [makeSlitherPlayer(socket, 0, tableBet)]
    };
    fillSlitherPellets(room);
    slitherRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "slither"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("slither:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitSlitherUpdate(room);
    broadcastOnlineList();
  });

  socket.on("slither:join", ({ roomId }) => {
    const room = slitherRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("slither:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitSlitherUpdate(room);
    if (room.players.length >= SLITHER_MAX_PLAYERS)
      return socket.emit("slither:error", `Sala cheia (max. ${SLITHER_MAX_PLAYERS} jogadores).`);

    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("slither:error", `Esta sala teria ${room.players.length + 1} jogadores. Aposta maxima: ${maxBet} creditos.`);
    }

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("slither:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("slither:error", "Voce ja esta em uma partida.");

    room.players.push(makeSlitherPlayer(socket, room.players.length, room.bet));
    room.message = `${socket.username} entrou no Slither.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "slither"; }
    emitSlitherUpdate(room);
    broadcastOnlineList();
  });

  socket.on("slither:start", ({ roomId }) => {
    const room = slitherRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("slither:error", "So o dono da sala pode iniciar.");
    startSlitherRound(room, room.bet);
  });

  socket.on("slither:input", ({ roomId, angle, boost }) => {
    const room = slitherRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player || player.eliminated) return;
    if (Number.isFinite(Number(angle))) {
      player.targetAngle = normalizeAngle(Number(angle));
    }
    player.boosting = Boolean(boost) && player.alive && Number(player.targetLength || 0) > SLITHER_MIN_BOOST_LENGTH;
  });

  socket.on("slither:leave", ({ roomId }) => {
    const room = slitherRooms.get(roomId);
    if (!room) return;
    removeSlitherPlayer(room, socket.id, `${socket.username} saiu da sala.`);
    socket.leave(roomId);
  });

  socket.on("slither:spectate", ({ roomId }) => {
    const room = slitherRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("slither:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitSlitherUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("slither:error", "Termine sua partida antes de assistir outra.");
    room.spectators.add(socket.id);
    socket.join(roomId);
    setSlitherWatcher(room, socket.id, pickSlitherWatchTarget(room, socket.id)?.socketId);
    emitSlitherUpdate(room);
    broadcastOnlineList();
  });

  socket.on("slither:watching", ({ roomId, targetSocketId }) => {
    const room = slitherRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    if (!setSlitherWatcher(room, socket.id, targetSocketId)) return;
    emitSlitherUpdate(room);
    broadcastOnlineList();
  });

  socket.on("slither:unwatch", ({ roomId }) => {
    const room = slitherRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    clearSlitherWatcher(room, socket.id);
    emitSlitherUpdate(room);
    broadcastOnlineList();
  });

  // Crash
  socket.on("crash:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("crash:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("crash:error", "Voce ja esta em uma partida.");

    const roomId = `crash-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      multiplier: 1,
      crashPoint: null,
      startedAt: null,
      tickTimer: null,
      cashouts: [],
      spectators: new Set(),
      message: "Sala aberta. Entre no aviao e saque antes do crash.",
      players: [makeCrashPlayer(socket, tableBet)]
    };
    crashRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "crash"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("crash:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitCrashUpdate(room);
    broadcastOnlineList();
  });

  socket.on("crash:join", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("crash:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitCrashUpdate(room);

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < Number(room.bet || 0))
      return socket.emit("crash:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("crash:error", "Voce ja esta em uma partida.");

    room.players.push(makeCrashPlayer(socket, room.bet));
    room.message = `${socket.username} entrou no aviao.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "crash"; }
    emitCrashUpdate(room);
    broadcastOnlineList();
  });

  socket.on("crash:start", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("crash:error", "So o dono da sala pode iniciar.");
    startCrashRound(room);
  });

  socket.on("crash:cashout", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room) return;
    cashoutCrashPlayer(room, socket);
  });

  socket.on("crash:leave", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitCrashUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (room.status === "waiting" && room.hostSocketId === socket.id) {
      cancelCrashRoom(room, "O dono cancelou o Crash.");
      return;
    }
    removeCrashPlayer(room, socket.id, `${socket.username} saiu do Crash.`);
  });

  socket.on("crash:spectate", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("crash:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitCrashUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("crash:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitCrashUpdate(room);
    broadcastOnlineList();
  });

  socket.on("crash:unwatch", ({ roomId }) => {
    const room = crashRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitCrashUpdate(room);
    broadcastOnlineList();
  });

  // ── Corrida de Cavalos ─────────────────────────────────────────────────
  socket.on("horse:create", ({ bet }) => {
    const tableBet = Math.max(5, Math.min(50, Number(bet) || 10));
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || user.bet_credits < tableBet)
      return socket.emit("horse:error", "Créditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("horse:error", "Você já está em uma partida.");

    const roomId = `horse-${Date.now()}-${socket.id}`;
    const room = {
      roomId, hostSocketId: socket.id, hostUsername: socket.username,
      bet: tableBet, status: "waiting", finishOrder: null,
      spectators: new Set(),
      message: "Mesa aberta. Aguarde jogadores ou inicie a corrida.",
      players: [{ socketId: socket.id, userId: socket.userId, username: socket.username, avatar: socket.avatar || "", bet: tableBet, pickedHorse: null, joinedAt: Date.now() }]
    };
    horseRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "horse"; }

    // Notify others
    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("horse:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horse:join", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("horse:error", "Corrida indisponível.");
    if (room.players.some(p => p.socketId === socket.id))
      return emitHorseUpdate(room);
    if (room.players.length >= 5)
      return socket.emit("horse:error", "Mesa cheia (máx. 5 jogadores).");

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || user.bet_credits < room.bet)
      return socket.emit("horse:error", "Créditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("horse:error", "Você já está em uma partida.");

    room.players.push({ socketId: socket.id, userId: socket.userId, username: socket.username, avatar: socket.avatar || "", bet: room.bet, pickedHorse: null, joinedAt: Date.now() });
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "horse"; }
    room.message = `${socket.username} entrou na corrida.`;
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horse:pick", ({ roomId, horseId }) => {
    const room = horseRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    player.pickedHorse = Number(horseId);
    room.message = `${socket.username} escolheu o cavalo ${HORSES.find(h => h.id === player.pickedHorse)?.name}.`;
    emitHorseUpdate(room);
  });

  socket.on("horse:start", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("horse:error", "Só o dono pode iniciar.");
    if (room.players.some(p => p.pickedHorse === null))
      return socket.emit("horse:error", "Todos devem escolher um cavalo antes de largar.");

    room.status = "racing";
    room.finishOrder = makeFinishOrder();
    room.message = "Largaram! 🏇";

    // Descontar apostas antecipadamente
    room.players.forEach(p => {
      const u = db.findUser("id", p.userId);
      if (u) db.updateUser(p.userId, { bet_credits: Math.max(0, (u.bet_credits || 0) - p.bet) });
    });

    emitHorseUpdate(room);

    // Finalizar após 8 segundos (tempo da animação no cliente)
    setTimeout(() => {
      if (!horseRooms.has(roomId)) return;
      room.status = "finished";
      const winnerHorseId = room.finishOrder[0];
      const winners = room.players.filter(p => p.pickedHorse === winnerHorseId);
      const totalPot = room.players.reduce((s, p) => s + p.bet, 0);

      if (winners.length > 0) {
        const share = Math.floor(totalPot / winners.length);
        winners.forEach(w => {
          const u = db.findUser("id", w.userId);
          if (u) {
            db.updateUser(w.userId, { bet_credits: (u.bet_credits || 0) + share });
            addExchangeWin(w.userId);
          }
        });
        room.message = `🏆 ${HORSES.find(h=>h.id===winnerHorseId).name} venceu! ${winners.map(w=>w.username).join(', ')} ganhou${winners.length>1?` (dividido)`:""}!`;
      } else {
        room.message = `🏆 ${HORSES.find(h=>h.id===winnerHorseId).name} venceu! Ninguém apostou nele.`;
      }
      resetExchangeLosses(room.players.map(p => p.userId), winners.map(w => w.userId));

      room.players.forEach(p => {
        const updated = db.findUser("id", p.userId);
        io.to(p.socketId).emit("horse:finished", {
          room: serializeHorseRoom(room, p.socketId),
          updatedUser: safeUser(updated)
        });
        const online = onlinePlayers.get(p.socketId);
        if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
      });
      for (const spectatorId of room.spectators || []) {
        io.to(spectatorId).emit("horse:finished", {
          room: serializeHorseRoom(room, spectatorId),
          updatedUser: null
        });
        const liveSocket = io.sockets.sockets.get(spectatorId);
        if (liveSocket) liveSocket.leave(room.roomId);
      }
      horseRooms.delete(roomId);
      broadcastOnlineList();
    }, 8000);
  });

  socket.on("horse:leave", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (room?.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitHorseUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId === socket.id) {
      room.players.forEach(p => {
        io.to(p.socketId).emit("horse:cancelled", { message: "O dono cancelou a corrida." });
        const online = onlinePlayers.get(p.socketId);
        if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
      });
      for (const spectatorId of room.spectators || []) {
        io.to(spectatorId).emit("horse:cancelled", { message: "O dono cancelou a corrida." });
        const liveSocket = io.sockets.sockets.get(spectatorId);
        if (liveSocket) liveSocket.leave(room.roomId);
      }
      horseRooms.delete(roomId);
      broadcastOnlineList();
      return;
    }
    room.players = room.players.filter(p => p.socketId !== socket.id);
    socket.leave(roomId);
    const online = onlinePlayers.get(socket.id);
    if (online && online.roomId === room.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
    room.message = `${socket.username} saiu da corrida.`;
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horse:spectate", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (!room || room.status !== "racing")
      return socket.emit("horse:error", "Corrida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitHorseUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("horse:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horse:unwatch", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("disconnect", () => {
    console.log(`[-] ${socket.username} desconectado`);
    const player = onlinePlayers.get(socket.id);
    clearSocketFromSpectatorRooms(socket.id);

    if (player?.roomId) {
      const room = activeRooms.get(player.roomId);
      if (room) {
        const otherSid = room.player1SocketId === socket.id
          ? room.player2SocketId
          : room.player1SocketId;
        io.to(otherSid).emit("game:opponent_disconnected");
        db.updateMatch(room.matchId, { status: "cancelled" });
        const other = onlinePlayers.get(otherSid);
        if (other) { other.inGame = false; other.roomId = null; }
        activeRooms.delete(player.roomId);
      }
    }

    const horseRoom = findHorseRoomBySocket(socket.id);
    if (horseRoom && (horseRoom.status === "waiting" || horseRoom.hostSocketId === socket.id)) {
      horseRoom.players.forEach(p => {
        io.to(p.socketId).emit("horse:cancelled", { message: `${socket.username} desconectou.` });
        const online = onlinePlayers.get(p.socketId);
        if (online && online.roomId === horseRoom.roomId) { online.inGame = false; online.roomId = null; online.game = null; }
      });
      horseRooms.delete(horseRoom.roomId);
    }

    const buttonRoom = findButtonSoccerRoomBySocket(socket.id);
    if (buttonRoom) {
      removeButtonSoccerPlayer(buttonRoom, socket.id, `${socket.username} desconectou.`);
    }

    const headRoom = findHeadSoccerRoomBySocket(socket.id);
    if (headRoom) {
      removeHeadSoccerPlayer(headRoom, socket.id, `${socket.username} desconectou.`);
    }

    const slitherRoom = findSlitherRoomBySocket(socket.id);
    if (slitherRoom) {
      removeSlitherPlayer(slitherRoom, socket.id, `${socket.username} desconectou.`);
    }

    const crashRoom = findCrashRoomBySocket(socket.id);
    if (crashRoom) {
      if (crashRoom.status === "waiting" && crashRoom.hostSocketId === socket.id) {
        cancelCrashRoom(crashRoom, `${socket.username} cancelou o Crash.`);
      } else {
        removeCrashPlayer(crashRoom, socket.id, `${socket.username} desconectou do Crash.`);
      }
    }

    const blackjackRoom = findBlackjackRoomBySocket(socket.id);
    if (blackjackRoom) {
      const participant = blackjackRoom.players.find(item => item.socketId === socket.id);
      if (blackjackRoom.status === "waiting" || blackjackRoom.hostSocketId === socket.id) {
        cancelBlackjackRoom(blackjackRoom, `${socket.username} saiu da mesa de 21.`);
      } else if (participant) {
        participant.status = "bust";
        blackjackRoom.message = `${socket.username} desconectou e perdeu a rodada.`;
        if (allBlackjackPlayersDone(blackjackRoom)) finishBlackjackRoom(blackjackRoom);
        else emitBlackjackUpdate(blackjackRoom);
      }
    }

    for (const [id, ch] of pendingChallenges) {
      if (ch.fromSocketId === socket.id || ch.toSocketId === socket.id) {
        const notifySid = ch.fromSocketId === socket.id ? ch.toSocketId : ch.fromSocketId;
        io.to(notifySid).emit("challenge:cancelled", { username: socket.username });
        pendingChallenges.delete(id);
      }
    }

    onlinePlayers.delete(socket.id);
    broadcastOnlineList();
  });
});

// ── Corrida de Cavalos ──────────────────────────────────────────────────────
const HORSES = [
  { id: 1, name: "Trovão",     color: "#e74c3c" },
  { id: 2, name: "Relâmpago",  color: "#f39c12" },
  { id: 3, name: "Tempestade", color: "#2ecc71" },
  { id: 4, name: "Cometa",     color: "#3498db" },
  { id: 5, name: "Furacão",    color: "#9b59b6" }
];
const horseRooms = new Map();

function makeFinishOrder() {
  const order = [1,2,3,4,5];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function serializeHorseRoom(room, viewerSocketId) {
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    bet: room.bet,
    status: room.status,
    message: room.message,
    horses: HORSES,
    finishOrder: room.status === "finished" ? room.finishOrder : null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map(p => ({
      socketId: p.socketId,
      username: p.username,
      avatar: p.avatar || "",
      pickedHorse: p.pickedHorse,
      isHost: p.socketId === room.hostSocketId,
      isMe: p.socketId === viewerSocketId
    }))
  };
}

function emitHorseUpdate(room) {
  room.players.forEach(p => {
    io.to(p.socketId).emit("horse:update", serializeHorseRoom(room, p.socketId));
  });
  for (const spectatorId of room.spectators || []) {
    io.to(spectatorId).emit("horse:update", serializeHorseRoom(room, spectatorId));
  }
}

function findHorseRoomBySocket(socketId) {
  for (const room of horseRooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

function getSpectatableRoom(game, roomId) {
  if (!roomId) return null;
  if (game === "blackjack") return blackjackRooms.get(roomId) || null;
  if (game === "button") return buttonSoccerRooms.get(roomId) || null;
  if (game === "head") return headSoccerRooms.get(roomId) || null;
  if (game === "slither") return slitherRooms.get(roomId) || null;
  if (game === "horse") return horseRooms.get(roomId) || null;
  if (game === "crash") return crashRooms.get(roomId) || null;
  return null;
}

function isRoomSpectatable(game, room) {
  if (!room) return false;
  if (game === "horse") return room.status === "racing";
  return room.status === "playing";
}

function getRoomWatcherCountForPlayer(game, room, socketId) {
  if (!room) return 0;
  if (game === "slither") {
    const counts = getSlitherWatcherCounts(room);
    return counts[socketId] || 0;
  }
  return isRoomSpectatable(game, room) ? roomSpectatorCount(room) : 0;
}

function broadcastOnlineList() {
  const list = [];
  for (const [, p] of onlinePlayers) {
    const user = db.findUser("id", p.userId);
    p.avatar = user?.avatar || p.avatar || "";
    const gameRoom = getSpectatableRoom(p.game, p.roomId);
    list.push({
      socketId: p.socketId,
      username: p.username,
      inGame: p.inGame,
      avatar: p.avatar,
      game: p.game || null,
      roomId: p.roomId || null,
      spectatable: isRoomSpectatable(p.game, gameRoom),
      watcherCount: getRoomWatcherCountForPlayer(p.game, gameRoom, p.socketId)
    });
  }
  io.emit("online:list", list);
}

// ─── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[db] Dados em: ${DB_FILE}`);
  console.log(`[db] Backups em: ${DB_BACKUP_DIR}`);
  if (!DB_PATH_CONFIGURED && process.env.NODE_ENV === "production") {
    console.warn("[db] AVISO: configure DB_FILE ou DATA_DIR em um volume persistente para nao perder dados no deploy.");
  }
  console.log(`\n🏟️  Servidor Álbum da Copa rodando em http://localhost:${PORT}\n`);
});
