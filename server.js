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
  common: { chance: 73.7, duplicateChance: 0.46 },
  rare: { chance: 24, duplicateChance: 0.22 },
  legendary: { chance: 2.3, duplicateChance: 0.10 }
};
const RARITY_ORDER = ["common", "rare", "legendary"];
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

function loadDb() {
  ensureDbDir();
  if (!fs.existsSync(DB_FILE)) {
    saveDb({ users: [], matches: [], market_listings: [], nextUserId: 1, nextMatchId: 1, nextMarketId: 1 });
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

function getMarketPrice(rarity) {
  return MARKET_PRICES[rarity] || 0;
}

function refreshDailyAlbumCredits(user) {
  if (!user) return null;

  const today = todayKey();
  const currentCredits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : 0;

  if (!user.last_album_credit_day) {
    return db.updateUser(user.id, {
      credits: DAILY_ALBUM_CREDITS,
      last_album_credit_day: today
    });
  }

  if (user.last_album_credit_day !== today && currentCredits < DAILY_ALBUM_CREDITS) {
    return db.updateUser(user.id, {
      credits: DAILY_ALBUM_CREDITS,
      last_album_credit_day: today
    });
  }

  if (user.last_album_credit_day !== today) {
    return db.updateUser(user.id, {
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
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

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
      return res.status(400).json({ error: "Ganhe 2 partidas para liberar a troca." });
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
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    winnerSocketId: room.winnerSocketId || null,
    houseWon: Boolean(room.houseWon),
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

  room.players.forEach(player => {
    const updated = db.findUser("id", player.userId);
    io.to(player.socketId).emit("blackjack:finished", {
      table: serializeBlackjackRoom(room, player.socketId),
      updatedUser: safeUser(updated)
    });

    const online = onlinePlayers.get(player.socketId);
    if (online) { online.inGame = false; online.roomId = null; }
  });

  blackjackRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelBlackjackRoom(room, reason = "Mesa de 21 cancelada.") {
  if (!room) return;
  room.players.forEach(player => {
    io.to(player.socketId).emit("blackjack:cancelled", { message: reason });
    const online = onlinePlayers.get(player.socketId);
    if (online) { online.inGame = false; online.roomId = null; }
  });
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

  room.players.forEach(player => {
    io.to(player.socketId).emit("button:finished", {
      room: serializeButtonSoccerRoom(room, player.socketId),
      updatedUser: safeUser(db.findUser("id", player.userId))
    });
  });
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
    if (online) { online.inGame = false; online.roomId = null; }
  });
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
  if (online) { online.inGame = false; online.roomId = null; }

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
    roomId:   null
  });

  broadcastOnlineList();

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
    const cleanEmoji = String(emoji || "").slice(0, 12);
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

    const blackjackRoom = findBlackjackRoomBySocket(socket.id);
    if (blackjackRoom) {
      blackjackRoom.players.forEach(player => targets.add(player.socketId));
    }

    const horseRoom = findHorseRoomBySocket(socket.id);
    if (horseRoom) {
      horseRoom.players.forEach(player => targets.add(player.socketId));
    }

    if (p?.roomId) {
      const activeRoom = activeRooms.get(p.roomId);
      if (activeRoom) {
        targets.add(activeRoom.player1SocketId);
        targets.add(activeRoom.player2SocketId);
      }
    }

    targets.delete(socket.id);
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
    if (player) { player.inGame = true; player.roomId = roomId; }

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
    if (player) { player.inGame = true; player.roomId = roomId; }

    room.message = `${socket.username} entrou na mesa.`;
    emitBlackjackUpdate(room);
    broadcastOnlineList();
  });

  socket.on("blackjack:leave", ({ roomId }) => {
    const room = blackjackRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId === socket.id) {
      cancelBlackjackRoom(room, "O dono da mesa cancelou o 21.");
      return;
    }

    room.players = room.players.filter(player => player.socketId !== socket.id);
    socket.leave(roomId);
    const online = onlinePlayers.get(socket.id);
    if (online) { online.inGame = false; online.roomId = null; }
    room.message = `${socket.username} saiu da mesa.`;
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
      message: "Mesa aberta. Jogadores entram como botoes alternando times.",
      players: [makeButtonSoccerPlayer(socket, 0, tableBet)]
    };
    resetButtonSoccerPositions(room);
    buttonSoccerRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; }

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
    if (player) { player.inGame = true; player.roomId = roomId; }
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
    removeButtonSoccerPlayer(room, socket.id, `${socket.username} saiu da mesa.`);
    socket.leave(roomId);
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
      message: "Mesa aberta. Aguarde jogadores ou inicie a corrida.",
      players: [{ socketId: socket.id, userId: socket.userId, username: socket.username, avatar: socket.avatar || "", bet: tableBet, pickedHorse: null, joinedAt: Date.now() }]
    };
    horseRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; }

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
    if (player) { player.inGame = true; player.roomId = roomId; }
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

      room.players.forEach(p => {
        const updated = db.findUser("id", p.userId);
        io.to(p.socketId).emit("horse:finished", {
          room: serializeHorseRoom(room, p.socketId),
          updatedUser: safeUser(updated)
        });
        const online = onlinePlayers.get(p.socketId);
        if (online) { online.inGame = false; online.roomId = null; }
      });
      horseRooms.delete(roomId);
      broadcastOnlineList();
    }, 8000);
  });

  socket.on("horse:leave", ({ roomId }) => {
    const room = horseRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId === socket.id) {
      room.players.forEach(p => {
        io.to(p.socketId).emit("horse:cancelled", { message: "O dono cancelou a corrida." });
        const online = onlinePlayers.get(p.socketId);
        if (online) { online.inGame = false; online.roomId = null; }
      });
      horseRooms.delete(roomId);
      broadcastOnlineList();
      return;
    }
    room.players = room.players.filter(p => p.socketId !== socket.id);
    socket.leave(roomId);
    const online = onlinePlayers.get(socket.id);
    if (online) { online.inGame = false; online.roomId = null; }
    room.message = `${socket.username} saiu da corrida.`;
    emitHorseUpdate(room);
    broadcastOnlineList();
  });

  socket.on("disconnect", () => {
    console.log(`[-] ${socket.username} desconectado`);
    const player = onlinePlayers.get(socket.id);

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
        if (online) { online.inGame = false; online.roomId = null; }
      });
      horseRooms.delete(horseRoom.roomId);
    }

    const buttonRoom = findButtonSoccerRoomBySocket(socket.id);
    if (buttonRoom) {
      removeButtonSoccerPlayer(buttonRoom, socket.id, `${socket.username} desconectou.`);
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
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    bet: room.bet,
    status: room.status,
    message: room.message,
    horses: HORSES,
    finishOrder: room.status === "finished" ? room.finishOrder : null,
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
}

function findHorseRoomBySocket(socketId) {
  for (const room of horseRooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

function broadcastOnlineList() {
  const list = [];
  for (const [, p] of onlinePlayers) {
    const user = db.findUser("id", p.userId);
    p.avatar = user?.avatar || p.avatar || "";
    list.push({ socketId: p.socketId, username: p.username, inGame: p.inGame, avatar: p.avatar });
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
