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
const INITIAL_ALBUM_CREDITS = 80;
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
const LOAN_INTEREST_RATE = 1.5;
const MIN_LOAN_AMOUNT = 1;
const MAX_LOAN_AMOUNT = 999999;
const RARITY_SETTINGS = {
  common: { chance: 74.7, duplicateChance: 0.46 },
  rare: { chance: 24, duplicateChance: 0.22 },
  legendary: { chance: 1.3, duplicateChance: 0.10 }
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
    saveDb({ users: [], matches: [], market_listings: [], loans: [], nextUserId: 1, nextMatchId: 1, nextMarketId: 1, nextLoanId: 1 });
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
  if (!Array.isArray(data.loans)) {
    data.loans = [];
    changed = true;
  }
  data.loans.forEach((loan) => {
    if (loan && !loan.currency) {
      loan.currency = "bet_credits";
      changed = true;
    }
  });
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
  if (!Number.isFinite(Number(data.nextLoanId))) {
    data.nextLoanId = 1;
    changed = true;
  }
  if (deleteOverdueBorrowerAccounts(data)) {
    changed = true;
  }

  if (changed) saveDb(data);
  return data;
}

function deleteOverdueBorrowerAccounts(data) {
  if (!data || !Array.isArray(data.loans) || !Array.isArray(data.users)) return false;

  const today = todayKey();
  const now = new Date().toISOString();
  const overdueLoans = data.loans.filter(loan =>
    loan?.status === "active"
    && loan.due_day
    && String(loan.due_day) < today
  );
  const borrowerIds = new Set(overdueLoans
    .map(loan => Number(loan.borrower_id))
    .filter(Number.isFinite));

  if (!borrowerIds.size) return false;

  data.loans.forEach(loan => {
    const borrowerId = Number(loan.borrower_id);
    const lenderId = Number(loan.lender_id);
    if (loan.status === "active" && borrowerIds.has(borrowerId)) {
      loan.status = "defaulted";
      loan.defaulted_at = now;
      loan.default_reason = "Conta deletada por divida vencida.";
    } else if (loan.status === "requested" && (borrowerIds.has(borrowerId) || borrowerIds.has(lenderId))) {
      loan.status = "cancelled";
      loan.cancelled_at = now;
      loan.cancel_reason = "Conta envolvida em divida vencida.";
    }
  });

  data.users = data.users.filter(user => !borrowerIds.has(Number(user.id)));
  if (Array.isArray(data.market_listings)) {
    data.market_listings = data.market_listings.filter(listing => !borrowerIds.has(Number(listing.seller_id)));
  }

  return true;
}

function saveDb(db) {
  ensureDbDir();
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// Helpers de consulta (síncronos, thread-safe pelo event loop do Node)
function parseLoanAmount(value) {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount < MIN_LOAN_AMOUNT) {
    const error = new Error(`Valor minimo de emprestimo: ${MIN_LOAN_AMOUNT} credito de aposta.`);
    error.statusCode = 400;
    throw error;
  }
  if (amount > MAX_LOAN_AMOUNT) {
    const error = new Error(`Valor maximo de emprestimo: ${MAX_LOAN_AMOUNT} creditos de aposta.`);
    error.statusCode = 400;
    throw error;
  }
  return amount;
}

function calculateLoanTotal(principal) {
  return Math.ceil(Number(principal || 0) * LOAN_INTEREST_RATE);
}

function serializeLoanForUser(loan, userId) {
  const borrowerId = Number(loan.borrower_id);
  const lenderId = loan.lender_id === null || loan.lender_id === undefined ? null : Number(loan.lender_id);
  return {
    id: loan.id,
    borrower_id: borrowerId,
    borrower_name: loan.borrower_name || "",
    lender_id: lenderId,
    lender_name: loan.lender_name || "Casa",
    principal: Math.max(0, Number(loan.principal || 0) || 0),
    currency: loan.currency || "bet_credits",
    total_due: Math.max(0, Number(loan.total_due || 0) || 0),
    remaining_due: Math.max(0, Number(loan.remaining_due || 0) || 0),
    interest_rate: Number(loan.interest_rate || LOAN_INTEREST_RATE),
    status: loan.status || "active",
    due_day: loan.due_day || "",
    created_at: loan.created_at || "",
    paid_at: loan.paid_at || "",
    defaulted_at: loan.defaulted_at || "",
    direction: borrowerId === Number(userId) ? "borrowed" : "lent",
    is_house: !lenderId
  };
}

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
      credits:          INITIAL_ALBUM_CREDITS,
      bet_credits:      INITIAL_BET_CREDITS,
      exchange_wins:    0,
      bj_wins:          0,
      stickers:         [],
      duplicates:       {},
      pending_stickers: [],
      last_sale_day:    "",
      initial_album_credits_granted: INITIAL_ALBUM_CREDITS,
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
  getLoansForUser(userId) {
    const data = loadDb();
    return data.loans
      .filter(loan => Number(loan.borrower_id) === Number(userId) || Number(loan.lender_id) === Number(userId))
      .map(loan => serializeLoanForUser(loan, userId));
  },
  getRichestBetCreditUsers(limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    return loadDb().users
      .map(user => ({
        id: user.id,
        username: user.username,
        avatar: user.avatar || "",
        bet_credits: Math.max(0, Math.floor(Number(user.bet_credits || 0) || 0))
      }))
      .sort((a, b) => b.bet_credits - a.bet_credits || String(a.username || "").localeCompare(String(b.username || "")))
      .slice(0, safeLimit)
      .map((user, index) => ({ ...user, rank: index + 1 }));
  },
  createLoan({ borrowerId, lenderId = null, principal, lenderName = "Casa" }) {
    const data = loadDb();
    const borrower = data.users.find(user => Number(user.id) === Number(borrowerId));
    if (!borrower) {
      const error = new Error("Usuario que pediu emprestimo nao encontrado.");
      error.statusCode = 404;
      throw error;
    }

    const amount = parseLoanAmount(principal);
    const totalDue = calculateLoanTotal(amount);
    let lender = null;
    if (lenderId) {
      lender = data.users.find(user => Number(user.id) === Number(lenderId));
      if (!lender) {
        const error = new Error("Credor nao encontrado.");
        error.statusCode = 404;
        throw error;
      }
      if (Number(lender.bet_credits || 0) < amount) {
        const error = new Error("Creditos de aposta insuficientes para emprestar.");
        error.statusCode = 400;
        throw error;
      }
      lender.bet_credits = Number(lender.bet_credits || 0) - amount;
      lenderName = lender.username;
    }

    borrower.bet_credits = Number(borrower.bet_credits || 0) + amount;

    const loan = {
      id: data.nextLoanId++,
      borrower_id: borrower.id,
      borrower_name: borrower.username,
      lender_id: lender ? lender.id : null,
      lender_name: lender ? lender.username : lenderName,
      principal: amount,
      currency: "bet_credits",
      interest_rate: LOAN_INTEREST_RATE,
      total_due: totalDue,
      remaining_due: totalDue,
      status: "active",
      due_day: todayKey(),
      created_at: new Date().toISOString()
    };

    data.loans.push(loan);
    saveDb(data);
    return { loan, borrower, lender };
  },
  payLoan(borrowerId, loanId) {
    const data = loadDb();
    const loan = data.loans.find(item => Number(item.id) === Number(loanId));
    if (!loan || Number(loan.borrower_id) !== Number(borrowerId)) {
      const error = new Error("Emprestimo nao encontrado.");
      error.statusCode = 404;
      throw error;
    }
    if (loan.status !== "active") {
      const error = new Error("Esse emprestimo nao esta ativo.");
      error.statusCode = 400;
      throw error;
    }

    const borrower = data.users.find(user => Number(user.id) === Number(borrowerId));
    if (!borrower) {
      const error = new Error("Usuario devedor nao encontrado.");
      error.statusCode = 404;
      throw error;
    }

    const payment = Math.max(0, Math.ceil(Number(loan.remaining_due || loan.total_due || 0)));
    if (Number(borrower.bet_credits || 0) < payment) {
      const error = new Error(`Creditos de aposta insuficientes. Faltam ${payment - Number(borrower.bet_credits || 0)}.`);
      error.statusCode = 400;
      throw error;
    }

    borrower.bet_credits = Number(borrower.bet_credits || 0) - payment;
    let lender = null;
    if (loan.lender_id) {
      lender = data.users.find(user => Number(user.id) === Number(loan.lender_id));
      if (lender) lender.bet_credits = Number(lender.bet_credits || 0) + payment;
    }

    loan.remaining_due = 0;
    loan.status = "paid";
    loan.paid_at = new Date().toISOString();
    saveDb(data);
    return { loan, borrower, lender, payment };
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

function normalizeInitialAlbumCredits(user) {
  if (!user) return null;

  if (user.initial_album_credits_granted === INITIAL_ALBUM_CREDITS) {
    return user;
  }

  const currentCredits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : 0;
  return db.updateUser(user.id, {
    credits: Math.max(currentCredits, INITIAL_ALBUM_CREDITS),
    initial_album_credits_granted: INITIAL_ALBUM_CREDITS
  });
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
const chatHistory = [];

app.use(cors());
app.use(express.json());
app.get("/cardwars/Build/cardwars-unity.data.unityweb", (req, res, next) => {
  const partsDirectory = path.join(
    __dirname,
    "cardwars-unity",
    "Build",
    "cardwars-unity.data.parts"
  );

  let parts;
  try {
    parts = fs.readdirSync(partsDirectory)
      .filter((name) => /^cardwars-unity\.data\.unityweb\.gz\.part\d+$/.test(name))
      .sort()
      .map((name) => path.join(partsDirectory, name));
  } catch (error) {
    return next(error);
  }

  if (parts.length === 0) {
    return res.status(404).end();
  }

  let contentLength;
  try {
    contentLength = parts.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
  } catch (error) {
    return next(error);
  }

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Encoding", "gzip");
  res.setHeader("Content-Length", contentLength);
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (req.method === "HEAD") {
    return res.end();
  }

  let index = 0;
  let currentStream = null;

  const streamNextPart = () => {
    if (index >= parts.length) {
      res.end();
      return;
    }

    currentStream = fs.createReadStream(parts[index]);
    index += 1;
    currentStream.on("error", (error) => res.destroy(error));
    currentStream.on("end", streamNextPart);
    currentStream.pipe(res, { end: false });
  };

  res.on("close", () => {
    if (!res.writableEnded && currentStream) currentStream.destroy();
  });

  streamNextPart();
});
app.use("/cardwars", express.static(path.join(__dirname, "cardwars-unity"), {
  setHeaders(res, filePath) {
    if (!filePath.endsWith(".unityweb")) return;
    if (filePath.endsWith(".wasm.code.unityweb")) {
      res.setHeader("Content-Type", "application/wasm");
      return;
    }
    if (
      filePath.endsWith(".wasm.framework.unityweb") ||
      filePath.endsWith(".asm.code.unityweb") ||
      filePath.endsWith(".asm.framework.unityweb")
    ) {
      res.setHeader("Content-Type", "application/javascript");
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
  }
}));
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
  safe.loans = db.getLoansForUser(user.id);
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

function emitLoanRefresh(userIds, message = "") {
  const targetIds = new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter(Number.isFinite));
  if (!targetIds.size || typeof onlinePlayers === "undefined") return;

  for (const [, player] of onlinePlayers) {
    if (!targetIds.has(Number(player.userId))) continue;
    const fresh = db.findUser("id", player.userId);
    if (!fresh) continue;
    io.to(player.socketId).emit("loan:update", {
      user: safeUser(fresh),
      loans: db.getLoansForUser(player.userId),
      message
    });
  }
  io.emit("ranking:update", { ranking: db.getRichestBetCreditUsers(10) });
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

    user = normalizeUserProgress(normalizeInitialBetCredits(normalizeInitialAlbumCredits(refreshDailyAlbumCredits(user))));
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
    user = normalizeUserProgress(normalizeInitialBetCredits(normalizeInitialAlbumCredits(refreshDailyAlbumCredits(user))));
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

app.get("/api/loans", authMiddleware, (req, res) => {
  try {
    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });
    res.json({ loans: db.getLoansForUser(req.userId), user: safeUser(user) });
  } catch (err) {
    console.error("[loans:list] erro:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get("/api/ranking/richest", authMiddleware, (req, res) => {
  try {
    res.json({ ranking: db.getRichestBetCreditUsers(req.query?.limit || 10) });
  } catch (err) {
    console.error("[ranking:richest] erro:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/loans/house", authMiddleware, (req, res) => {
  try {
    const result = db.createLoan({
      borrowerId: req.userId,
      principal: req.body?.amount,
      lenderName: "Casa"
    });
    emitLoanRefresh([req.userId], `Emprestimo da casa aprovado: ${result.loan.principal} creditos de aposta.`);
    res.json({
      ok: true,
      loan: serializeLoanForUser(result.loan, req.userId),
      user: safeUser(result.borrower)
    });
  } catch (err) {
    console.error("[loans:house] erro:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/loans/pay", authMiddleware, (req, res) => {
  try {
    const result = db.payLoan(req.userId, req.body?.loanId);
    const ids = [req.userId];
    if (result.lender?.id) ids.push(result.lender.id);
    emitLoanRefresh(ids, `Emprestimo #${result.loan.id} pago: ${result.payment} creditos de aposta.`);
    res.json({
      ok: true,
      loan: serializeLoanForUser(result.loan, req.userId),
      user: safeUser(result.borrower)
    });
  } catch (err) {
    console.error("[loans:pay] erro:", err);
    res.status(err.statusCode || 500).json({ error: err.message });
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
const pendingLoanRequests = new Map();  // requestId -> pedido de emprestimo
const activeRooms        = new Map();   // roomId → detalhes da sala
const blackjackRooms     = new Map();   // roomId -> mesa de 21
const buttonSoccerRooms  = new Map();   // roomId -> futebol de botao
const headSoccerRooms    = new Map();   // roomId -> head soccer em sala
const slitherRooms       = new Map();   // roomId -> cobrinhas estilo slither
const crashRooms         = new Map();   // roomId -> crash do aviao
const artilleryRooms     = new Map();   // roomId -> artilharia por turnos
const relicRooms         = new Map();   // roomId -> caca as reliquias em arena
const pirateRooms        = new Map();   // roomId -> Pirate Bomb em plataforma
const cardWarsRooms      = new Map();   // roomId -> Card Wars Unity online shell
const horrorRooms        = new Map();   // roomId -> Casa Sombria cooperativo
const HORROR_MAX_PLAYERS = 4;
const CARD_WARS_RECONNECT_GRACE_MS = 30000;

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
  for (const room of artilleryRooms.values()) {
    if (clearSpectator(room, socketId)) emitArtilleryUpdate(room);
  }
  for (const room of relicRooms.values()) {
    if (clearSpectator(room, socketId)) emitRelicUpdate(room);
  }
  for (const room of pirateRooms.values()) {
    if (clearSpectator(room, socketId)) emitPirateUpdate(room);
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
    kickQueued: false,
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
    player.kickQueued = false;
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
    player.kickQueued = false;
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
    player.kickQueued = false;
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

  if (player.kickQueued && player.kickCooldown <= 0) {
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
    player.kickQueued = false;

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

const ARTILLERY_FIELD = {
  width: 1800,
  height: 720,
  groundBase: 548,
  playerRadius: 18,
  projectileRadius: 6,
  blastRadius: 86
};
const ARTILLERY_MAX_PLAYERS = 8;
const ARTILLERY_TURN_MS = 25000;
const ARTILLERY_POWER_SCALE = 10.2;
const ARTILLERY_COLORS = ["#f05a48", "#35a7ff", "#f7c948", "#8f7cff", "#37c978", "#ff8c42", "#e75eb7", "#f5f2df"];

function makeArtilleryTerrain() {
  const step = 40;
  const points = [];
  const count = Math.floor(ARTILLERY_FIELD.width / step);
  const phase = Math.random() * Math.PI * 2;
  for (let index = 0; index <= count; index += 1) {
    const x = index * step;
    const wave = Math.sin(index * 0.58 + phase) * 42 + Math.sin(index * 0.21 + phase * 0.7) * 28;
    const noise = (Math.random() - 0.5) * 26;
    points.push({
      x,
      y: clampNumber(ARTILLERY_FIELD.groundBase + wave + noise, 410, 646)
    });
  }
  return points;
}

function artilleryTerrainY(room, x) {
  const points = room.terrain || [];
  if (!points.length) return ARTILLERY_FIELD.groundBase;
  if (x <= points[0].x) return points[0].y;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (x <= next.x) {
      const ratio = (x - prev.x) / Math.max(1, next.x - prev.x);
      return prev.y + (next.y - prev.y) * ratio;
    }
  }
  return points[points.length - 1].y;
}

function artilleryWind() {
  return Math.round((Math.random() * 2 - 1) * 95);
}

function makeArtilleryPlayer(socket, index, bet) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    color: ARTILLERY_COLORS[index % ARTILLERY_COLORS.length],
    bet,
    hp: 100,
    alive: true,
    x: 0,
    y: 0,
    angle: index % 2 === 0 ? 44 : 136,
    power: 58,
    joinedAt: Date.now()
  };
}

function positionArtilleryPlayers(room) {
  const aliveSlots = Math.max(2, room.players.length);
  room.players.forEach((player, index) => {
    const x = 140 + ((ARTILLERY_FIELD.width - 280) * index) / Math.max(1, aliveSlots - 1);
    player.x = Math.round(x);
    player.y = Math.round(artilleryTerrainY(room, player.x) - ARTILLERY_FIELD.playerRadius);
    player.hp = 100;
    player.alive = true;
    player.angle = index < room.players.length / 2 ? 42 : 138;
    player.power = 58;
  });
}

function serializeArtilleryRoom(room, viewerSocketId) {
  const now = Date.now();
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: ARTILLERY_FIELD,
    terrain: room.terrain || [],
    wind: Number(room.wind || 0),
    turnSocketId: room.turnSocketId || null,
    turnEndsAt: room.turnEndsAt || null,
    turnLeftMs: room.status === "playing" ? Math.max(0, Number(room.turnEndsAt || now) - now) : 0,
    winnerSocketId: room.winnerSocketId || null,
    lastShot: room.lastShot || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      color: player.color,
      hp: Math.max(0, Math.round(Number(player.hp || 0))),
      alive: Boolean(player.alive),
      x: Math.round(Number(player.x || 0)),
      y: Math.round(Number(player.y || 0)),
      angle: Math.round(Number(player.angle || 0)),
      power: Math.round(Number(player.power || 0)),
      bet: player.bet,
      watchers: roomSpectatorCount(room),
      isTurn: player.socketId === room.turnSocketId,
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitArtilleryUpdate(room) {
  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("artillery:update", serializeArtilleryRoom(room, socketId));
  });
}

function findArtilleryRoomBySocket(socketId) {
  for (const room of artilleryRooms.values()) {
    if (room.players.some(player => player.socketId === socketId) || room.spectators?.has(socketId)) return room;
  }
  return null;
}

function artilleryAlivePlayers(room) {
  return room.players.filter(player => player.alive && Number(player.hp || 0) > 0);
}

function setArtilleryTurn(room, nextIndex = 0) {
  const alive = artilleryAlivePlayers(room);
  if (!alive.length) return;
  let index = ((nextIndex % room.players.length) + room.players.length) % room.players.length;
  for (let scan = 0; scan < room.players.length; scan += 1) {
    const candidate = room.players[index];
    if (candidate?.alive && Number(candidate.hp || 0) > 0) break;
    index = (index + 1) % room.players.length;
  }
  room.turnIndex = index;
  room.turnSocketId = room.players[index].socketId;
  room.turnEndsAt = Date.now() + ARTILLERY_TURN_MS;
  clearTimeout(room.turnTimer);
  room.turnTimer = setTimeout(() => {
    if (!artilleryRooms.has(room.roomId) || room.status !== "playing") return;
    const current = room.players.find(player => player.socketId === room.turnSocketId);
    room.message = `${current?.username || "Jogador"} perdeu o turno.`;
    advanceArtilleryTurn(room);
    emitArtilleryUpdate(room);
  }, ARTILLERY_TURN_MS + 250);
}

function advanceArtilleryTurn(room) {
  if (room.status !== "playing") return;
  const alive = artilleryAlivePlayers(room);
  if (alive.length <= 1) {
    finishArtilleryRoom(room);
    return;
  }
  room.wind = artilleryWind();
  setArtilleryTurn(room, (room.turnIndex || 0) + 1);
}

function carveArtilleryCrater(room, x, radius) {
  if (!Array.isArray(room.terrain)) return;
  room.terrain.forEach(point => {
    const dist = Math.abs(Number(point.x || 0) - x);
    if (dist > radius) return;
    const cut = Math.cos((dist / radius) * Math.PI / 2) * 34;
    point.y = clampNumber(Number(point.y || ARTILLERY_FIELD.groundBase) + cut, 390, ARTILLERY_FIELD.height - 34);
  });
  room.players.forEach(player => {
    if (player.alive) {
      player.y = Math.round(artilleryTerrainY(room, player.x) - ARTILLERY_FIELD.playerRadius);
    }
  });
}

function simulateArtilleryShot(room, shooter, angleDeg, power) {
  const angle = clampNumber(angleDeg, 0, 180);
  const shotPower = clampNumber(power, 18, 100);
  const rad = (angle * Math.PI) / 180;
  let x = Number(shooter.x || 0);
  let y = Number(shooter.y || 0) - ARTILLERY_FIELD.playerRadius - 6;
  let vx = Math.cos(rad) * (shotPower * ARTILLERY_POWER_SCALE);
  let vy = -Math.sin(rad) * (shotPower * ARTILLERY_POWER_SCALE);
  const gravity = 470;
  const windAccel = Number(room.wind || 0) * 0.55;
  const path = [];
  let impact = null;

  for (let step = 0; step < 420; step += 1) {
    const dt = 1 / 30;
    vx += windAccel * dt;
    vy += gravity * dt;
    x += vx * dt;
    y += vy * dt;

    if (step % 2 === 0) {
      path.push({ x: Math.round(x), y: Math.round(y) });
    }

    const hitPlayer = room.players.find(player => {
      if (!player.alive || player.socketId === shooter.socketId) return false;
      return Math.hypot(x - player.x, y - player.y) <= ARTILLERY_FIELD.playerRadius + ARTILLERY_FIELD.projectileRadius + 3;
    });

    if (hitPlayer) {
      impact = { x: Math.round(x), y: Math.round(y), targetSocketId: hitPlayer.socketId };
      break;
    }

    if (x < -80 || x > ARTILLERY_FIELD.width + 80 || y > ARTILLERY_FIELD.height + 80) {
      impact = { x: Math.round(clampNumber(x, 0, ARTILLERY_FIELD.width)), y: Math.round(clampNumber(y, 0, ARTILLERY_FIELD.height)) };
      break;
    }

    if (x >= 0 && x <= ARTILLERY_FIELD.width && y >= artilleryTerrainY(room, x)) {
      impact = { x: Math.round(x), y: Math.round(artilleryTerrainY(room, x)) };
      break;
    }
  }

  if (!impact) {
    impact = { x: Math.round(clampNumber(x, 0, ARTILLERY_FIELD.width)), y: Math.round(clampNumber(y, 0, ARTILLERY_FIELD.height)) };
  }

  const damages = [];
  room.players.forEach(player => {
    if (!player.alive) return;
    const dist = Math.hypot(impact.x - player.x, impact.y - player.y);
    if (dist > ARTILLERY_FIELD.blastRadius) return;
    const damage = Math.max(8, Math.round(72 * (1 - dist / ARTILLERY_FIELD.blastRadius)));
    player.hp = Math.max(0, Number(player.hp || 0) - damage);
    if (player.hp <= 0) player.alive = false;
    damages.push({
      socketId: player.socketId,
      username: player.username,
      damage,
      hp: Math.round(player.hp),
      eliminated: !player.alive
    });
  });

  carveArtilleryCrater(room, impact.x, ARTILLERY_FIELD.blastRadius * 0.78);

  return {
    id: ++room.shotSeq,
    shooterSocketId: shooter.socketId,
    shooterUsername: shooter.username,
    angle,
    power: shotPower,
    wind: Number(room.wind || 0),
    path,
    impact,
    damages,
    at: Date.now()
  };
}

function startArtilleryRound(room, requestedBet = room.bet) {
  const maxBet = room.players.length >= 3 ? 20 : 50;
  const tableBet = clampNumber(requestedBet, 5, maxBet);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitArtilleryUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitArtilleryUpdate(room);
      return false;
    }
  }

  room.players.forEach((player, index) => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    const fresh = makeArtilleryPlayer(io.sockets.sockets.get(player.socketId) || {
      id: player.socketId,
      userId: player.userId,
      username: player.username,
      avatar: player.avatar
    }, index, tableBet);
    Object.assign(player, fresh, { socketId: player.socketId, userId: player.userId, username: player.username, avatar: player.avatar || "" });
  });

  room.bet = tableBet;
  room.status = "playing";
  room.terrain = makeArtilleryTerrain();
  room.wind = artilleryWind();
  room.lastShot = null;
  room.shotSeq = 0;
  room.winnerSocketId = null;
  room.message = "Partida iniciada. Ajuste angulo e forca para derrubar os rivais.";
  positionArtilleryPlayers(room);
  setArtilleryTurn(room, 0);
  emitArtilleryUpdate(room);
  broadcastOnlineList();
  return true;
}

function finishArtilleryRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.status = "finished";
  room.turnSocketId = null;
  room.turnEndsAt = null;

  const alive = artilleryAlivePlayers(room);
  const winner = alive.length === 1 ? alive[0] : null;
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
    room.message = `${reason ? `${reason} ` : ""}${winner.username} venceu o Canhao Arena e levou ${totalPot} creditos.`;
  } else {
    room.players.forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
    room.message = `${reason ? `${reason} ` : ""}Canhao Arena terminou empatado. Apostas devolvidas.`;
  }
  resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

  const targets = new Set(room.players.map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    const participant = room.players.find(player => player.socketId === socketId);
    io.to(socketId).emit("artillery:finished", {
      room: serializeArtilleryRoom(room, socketId),
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

  artilleryRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelArtilleryRoom(room, reason = "Sala de Canhao Arena cancelada.") {
  if (!room) return;
  clearTimeout(room.turnTimer);

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
    io.to(socketId).emit("artillery:cancelled", { message: reason });
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

  artilleryRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeArtilleryPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) {
    clearSpectator(room, socketId);
    emitArtilleryUpdate(room);
    broadcastOnlineList();
    return;
  }

  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (room.status === "playing") {
    player.hp = 0;
    player.alive = false;
    resetExchangeWinStreak(player.userId);
    room.message = reason || `${player.username} saiu e perdeu a aposta.`;
    if (room.turnSocketId === socketId) advanceArtilleryTurn(room);
    if (artilleryAlivePlayers(room).length <= 1) {
      finishArtilleryRoom(room, room.message);
      return;
    }
    emitArtilleryUpdate(room);
    broadcastOnlineList();
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  if (!room.players.length) {
    artilleryRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  room.players.forEach((item, index) => { item.color = ARTILLERY_COLORS[index % ARTILLERY_COLORS.length]; });
  room.message = reason || `${player.username} saiu da sala.`;
  emitArtilleryUpdate(room);
  broadcastOnlineList();
}

const RELIC_FIELD = {
  width: 1320,
  height: 820,
  playerRadius: 18,
  relicRadius: 12,
  mineRadius: 18,
  portalRadius: 28
};
const RELIC_MAX_PLAYERS = 8;
const RELIC_GAME_MS = 90000;
const RELIC_TICK_MS = 1000 / 20;
const RELIC_COUNT = 18;
const RELIC_MINE_COUNT = 10;
const RELIC_PORTAL_COUNT = 4;
const RELIC_SPEED = 270;
const RELIC_COLORS = ["#35a7ff", "#f05a48", "#57d39b", "#f7c948", "#8f7cff", "#ff8c42", "#e75eb7", "#f5f2df"];
const RELIC_VALUES = [
  { value: 1, color: "#7dd3fc", radius: 10 },
  { value: 2, color: "#57d39b", radius: 12 },
  { value: 5, color: "#f7c948", radius: 15 }
];

function relicRandomPoint(margin = 64) {
  return {
    x: Math.round(margin + Math.random() * (RELIC_FIELD.width - margin * 2)),
    y: Math.round(margin + Math.random() * (RELIC_FIELD.height - margin * 2))
  };
}

function makeRelicItem() {
  const roll = Math.random();
  const type = roll > 0.92 ? RELIC_VALUES[2] : roll > 0.62 ? RELIC_VALUES[1] : RELIC_VALUES[0];
  const point = relicRandomPoint(74);
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    x: point.x,
    y: point.y,
    value: type.value,
    color: type.color,
    radius: type.radius
  };
}

function makeRelicMine() {
  const point = relicRandomPoint(96);
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    x: point.x,
    y: point.y,
    radius: RELIC_FIELD.mineRadius
  };
}

function makeRelicPortals() {
  const spots = [
    { x: 118, y: 122 },
    { x: RELIC_FIELD.width - 118, y: 122 },
    { x: 118, y: RELIC_FIELD.height - 122 },
    { x: RELIC_FIELD.width - 118, y: RELIC_FIELD.height - 122 }
  ];
  return spots.map((spot, index) => ({
    id: index,
    x: spot.x,
    y: spot.y,
    toId: index < 2 ? index + 2 : index - 2,
    color: index % 2 === 0 ? "#60d7ff" : "#c678dd"
  }));
}

function makeRelicPlayer(socket, index, bet) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    color: RELIC_COLORS[index % RELIC_COLORS.length],
    bet,
    score: 0,
    collected: 0,
    x: 0,
    y: 0,
    input: { x: 0, y: 0 },
    stunnedUntil: 0,
    invulnerableUntil: 0,
    portalCooldownUntil: 0,
    disconnected: false,
    joinedAt: Date.now()
  };
}

function positionRelicPlayers(room) {
  const spots = [
    { x: 150, y: 150 },
    { x: RELIC_FIELD.width - 150, y: RELIC_FIELD.height - 150 },
    { x: RELIC_FIELD.width - 150, y: 150 },
    { x: 150, y: RELIC_FIELD.height - 150 },
    { x: RELIC_FIELD.width / 2, y: 118 },
    { x: RELIC_FIELD.width / 2, y: RELIC_FIELD.height - 118 },
    { x: 118, y: RELIC_FIELD.height / 2 },
    { x: RELIC_FIELD.width - 118, y: RELIC_FIELD.height / 2 }
  ];
  room.players.forEach((player, index) => {
    const spot = spots[index % spots.length];
    player.x = spot.x;
    player.y = spot.y;
    player.input = { x: 0, y: 0 };
    player.stunnedUntil = 0;
    player.invulnerableUntil = 0;
    player.portalCooldownUntil = 0;
    player.score = 0;
    player.collected = 0;
    player.disconnected = false;
  });
}

function activeRelicPlayers(room) {
  return room.players.filter(player => !player.disconnected);
}

function serializeRelicRoom(room, viewerSocketId) {
  const now = Date.now();
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId && !player.disconnected);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: RELIC_FIELD,
    relics: room.relics || [],
    mines: room.mines || [],
    portals: room.portals || [],
    gameEndsAt: room.gameEndsAt || null,
    timeLeftMs: room.status === "playing" ? Math.max(0, Number(room.gameEndsAt || now) - now) : 0,
    winnerSocketId: room.winnerSocketId || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      color: player.color,
      score: Math.max(0, Math.round(Number(player.score || 0))),
      collected: Math.max(0, Math.round(Number(player.collected || 0))),
      x: Math.round(Number(player.x || 0)),
      y: Math.round(Number(player.y || 0)),
      stunnedMs: Math.max(0, Number(player.stunnedUntil || 0) - now),
      disconnected: Boolean(player.disconnected),
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitRelicUpdate(room) {
  const targets = new Set(activeRelicPlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("relic:update", serializeRelicRoom(room, socketId));
  });
}

function findRelicRoomBySocket(socketId) {
  for (const room of relicRooms.values()) {
    if (room.players.some(player => player.socketId === socketId && !player.disconnected) || room.spectators?.has(socketId)) return room;
  }
  return null;
}

function setRelicInput(player, input) {
  let x = Number(input?.x || 0);
  let y = Number(input?.y || 0);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  player.input = {
    x: clampNumber(x, -1, 1),
    y: clampNumber(y, -1, 1)
  };
}

function startRelicRound(room, requestedBet = room.bet) {
  const maxBet = room.players.length >= 3 ? 20 : 50;
  const tableBet = clampNumber(requestedBet, 5, maxBet);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitRelicUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitRelicUpdate(room);
      return false;
    }
  }

  room.players.forEach((player, index) => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    player.bet = tableBet;
    player.color = RELIC_COLORS[index % RELIC_COLORS.length];
  });

  room.bet = tableBet;
  room.pot = room.players.reduce((sum, player) => sum + Number(player.bet || tableBet || 0), 0);
  room.status = "playing";
  room.startedAt = Date.now();
  room.gameEndsAt = room.startedAt + RELIC_GAME_MS;
  room.winnerSocketId = null;
  room.relics = Array.from({ length: RELIC_COUNT }, () => makeRelicItem());
  room.mines = Array.from({ length: RELIC_MINE_COUNT }, () => makeRelicMine());
  room.portals = makeRelicPortals();
  room.message = "Partida iniciada. Pegue reliquias, use portais e evite as minas.";
  positionRelicPlayers(room);

  clearInterval(room.tickTimer);
  room.lastTick = Date.now();
  room.tickTimer = setInterval(() => tickRelicRoom(room), RELIC_TICK_MS);
  emitRelicUpdate(room);
  broadcastOnlineList();
  return true;
}

function tickRelicRoom(room) {
  if (!room || !relicRooms.has(room.roomId) || room.status !== "playing") return;

  const now = Date.now();
  const dt = Math.min((now - (room.lastTick || now)) / 1000, 0.08);
  room.lastTick = now;

  activeRelicPlayers(room).forEach(player => {
    const stunned = now < Number(player.stunnedUntil || 0);
    if (!stunned) {
      const input = player.input || { x: 0, y: 0 };
      player.x = clampNumber(Number(player.x || 0) + input.x * RELIC_SPEED * dt, RELIC_FIELD.playerRadius, RELIC_FIELD.width - RELIC_FIELD.playerRadius);
      player.y = clampNumber(Number(player.y || 0) + input.y * RELIC_SPEED * dt, RELIC_FIELD.playerRadius, RELIC_FIELD.height - RELIC_FIELD.playerRadius);
    }

    for (let index = room.relics.length - 1; index >= 0; index -= 1) {
      const relic = room.relics[index];
      if (Math.hypot(player.x - relic.x, player.y - relic.y) > RELIC_FIELD.playerRadius + Number(relic.radius || RELIC_FIELD.relicRadius)) continue;
      player.score = Math.max(0, Number(player.score || 0) + Number(relic.value || 1));
      player.collected = Math.max(0, Number(player.collected || 0) + 1);
      room.relics.splice(index, 1, makeRelicItem());
      if (Number(relic.value || 1) >= 5) {
        room.message = `${player.username} achou uma reliquia dourada.`;
      }
    }

    if (now > Number(player.invulnerableUntil || 0)) {
      const mine = room.mines.find(item => Math.hypot(player.x - item.x, player.y - item.y) <= RELIC_FIELD.playerRadius + Number(item.radius || RELIC_FIELD.mineRadius));
      if (mine) {
        player.score = Math.max(0, Number(player.score || 0) - 2);
        player.stunnedUntil = now + 850;
        player.invulnerableUntil = now + 1350;
        Object.assign(mine, makeRelicMine(), { id: mine.id });
        room.message = `${player.username} caiu em uma mina e perdeu 2 pontos.`;
      }
    }

    if (now > Number(player.portalCooldownUntil || 0)) {
      const portal = room.portals.find(item => Math.hypot(player.x - item.x, player.y - item.y) <= RELIC_FIELD.playerRadius + RELIC_FIELD.portalRadius);
      if (portal) {
        const target = room.portals.find(item => item.id === portal.toId);
        if (target) {
          const angle = Math.random() * Math.PI * 2;
          player.x = clampNumber(target.x + Math.cos(angle) * 48, RELIC_FIELD.playerRadius, RELIC_FIELD.width - RELIC_FIELD.playerRadius);
          player.y = clampNumber(target.y + Math.sin(angle) * 48, RELIC_FIELD.playerRadius, RELIC_FIELD.height - RELIC_FIELD.playerRadius);
          player.portalCooldownUntil = now + 1400;
        }
      }
    }
  });

  if (now >= Number(room.gameEndsAt || 0)) {
    finishRelicRoom(room, "Tempo encerrado.");
    return;
  }

  emitRelicUpdate(room);
}

function finishRelicRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearInterval(room.tickTimer);
  room.tickTimer = null;
  room.status = "finished";
  room.gameEndsAt = null;

  const ranked = activeRelicPlayers(room)
    .slice()
    .sort((a, b) => {
      if (Number(b.score || 0) !== Number(a.score || 0)) return Number(b.score || 0) - Number(a.score || 0);
      if (Number(b.collected || 0) !== Number(a.collected || 0)) return Number(b.collected || 0) - Number(a.collected || 0);
      return Number(a.joinedAt || 0) - Number(b.joinedAt || 0);
    });
  const winner = ranked[0] || null;
  room.winnerSocketId = winner?.socketId || null;

  const totalPot = Number(room.pot || 0) || room.players.reduce((sum, player) => sum + Number(player.bet || room.bet || 0), 0);
  if (winner) {
    const user = db.findUser("id", winner.userId);
    if (user) {
      db.updateUser(winner.userId, {
        bet_credits: Number(user.bet_credits || 0) + totalPot
      });
      addExchangeWin(winner.userId);
    }
    room.message = `${reason ? `${reason} ` : ""}${winner.username} venceu o Relic Rush com ${winner.score} pontos e levou ${totalPot} creditos.`;
  } else {
    room.message = `${reason ? `${reason} ` : ""}Relic Rush encerrado sem vencedor.`;
  }
  resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

  const targets = new Set(activeRelicPlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    const participant = room.players.find(player => player.socketId === socketId && !player.disconnected);
    io.to(socketId).emit("relic:finished", {
      room: serializeRelicRoom(room, socketId),
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

  relicRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelRelicRoom(room, reason = "Sala de Relic Rush cancelada.") {
  if (!room) return;
  clearInterval(room.tickTimer);

  if (room.status === "playing") {
    activeRelicPlayers(room).forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
  }

  const targets = new Set(activeRelicPlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("relic:cancelled", { message: reason });
    const participant = room.players.find(player => player.socketId === socketId && !player.disconnected);
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

  relicRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removeRelicPlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId && !item.disconnected);
  if (!player) {
    clearSpectator(room, socketId);
    emitRelicUpdate(room);
    broadcastOnlineList();
    return;
  }

  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (room.status === "playing") {
    player.disconnected = true;
    player.input = { x: 0, y: 0 };
    resetExchangeWinStreak(player.userId);
    room.message = reason || `${player.username} saiu e perdeu a exploracao.`;
    if (activeRelicPlayers(room).length <= 1) {
      finishRelicRoom(room, room.message);
      return;
    }
    emitRelicUpdate(room);
    broadcastOnlineList();
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  if (!room.players.length) {
    relicRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  room.players.forEach((item, index) => { item.color = RELIC_COLORS[index % RELIC_COLORS.length]; });
  room.message = reason || `${player.username} saiu da sala.`;
  emitRelicUpdate(room);
  broadcastOnlineList();
}

const PIRATE_FIELD = {
  width: 1600,
  height: 900,
  playerWidth: 42,
  playerHeight: 64,
  bombRadius: 28,
  explosionRadius: 132
};
const PIRATE_MAX_PLAYERS = 6;
const PIRATE_GAME_MS = 120000;
const PIRATE_TICK_MS = 1000 / 24;
const PIRATE_SPEED = 300;
const PIRATE_GRAVITY = 2100;
const PIRATE_JUMP = 760;
const PIRATE_MAX_FALL = 980;
const PIRATE_BOMB_FUSE_MS = 1850;
const PIRATE_BOMB_COOLDOWN_MS = 900;
const PIRATE_BOMB_THROW_X = 670;
const PIRATE_BOMB_THROW_Y = 430;
const PIRATE_BOMB_GRAVITY = 1550;
const PIRATE_BOMB_MAX_FALL = 860;
const PIRATE_BOMB_BOUNCE = 0.44;
const PIRATE_BOMB_FRICTION = 0.82;
const PIRATE_BOMB_REACT_COOLDOWN_MS = 850;
const PIRATE_THROW_ACTION_MS = 360;
const PIRATE_GRAB_RANGE = 82;
const PIRATE_KICK_RANGE = 102;
const PIRATE_ATTACK_RANGE = 86;
const PIRATE_ATTACK_COOLDOWN_MS = 520;
const PIRATE_ATTACK_ACTION_MS = 380;
const PIRATE_CARRY_OFFSET_X = 34;
const PIRATE_CARRY_OFFSET_Y = 78;
const PIRATE_COLORS = ["#60d7ff", "#ff6b7d", "#57d39b", "#f7c948", "#c678dd", "#ff9f43"];
const PIRATE_SKINS = [
  { key: "bomb-guy", name: "Bomb Guy", folder: "1-Player-Bomb Guy", bombReaction: "throw" },
  { key: "bald-pirate", name: "Bald Pirate", folder: "2-Enemy-Bald Pirate", bombReaction: "kick" },
  { key: "cucumber", name: "Cucumber", folder: "3-Enemy-Cucumber", bombReaction: "ignite" },
  { key: "big-guy", name: "Big Guy", folder: "4-Enemy-Big Guy", bombReaction: "kick" },
  { key: "captain", name: "Captain", folder: "5-Enemy-Captain", bombReaction: "kick" },
  { key: "whale", name: "Whale", folder: "6-Enemy-Whale", bombReaction: "swallow" }
];
const PIRATE_PLATFORMS = [
  { id: "floor", x: 0, y: 830, w: 1600, h: 70, tile: "floor" },
  { id: "left-low", x: 86, y: 668, w: 370, h: 34, tile: "wood" },
  { id: "right-low", x: 1144, y: 668, w: 370, h: 34, tile: "wood" },
  { id: "mid-low", x: 555, y: 704, w: 490, h: 34, tile: "wood-dark" },
  { id: "left-mid", x: 264, y: 520, w: 300, h: 34, tile: "wood-dark" },
  { id: "right-mid", x: 1036, y: 520, w: 300, h: 34, tile: "wood-dark" },
  { id: "center-high", x: 632, y: 386, w: 336, h: 34, tile: "wood" },
  { id: "left-high", x: 92, y: 350, w: 274, h: 34, tile: "wood" },
  { id: "right-high", x: 1234, y: 350, w: 274, h: 34, tile: "wood" },
  { id: "top-mid", x: 514, y: 214, w: 572, h: 34, tile: "wood-dark" }
];
const PIRATE_SPAWNS = [
  { x: 172, y: 830 },
  { x: 1428, y: 830 },
  { x: 362, y: 668 },
  { x: 1238, y: 668 },
  { x: 720, y: 704 },
  { x: 880, y: 704 }
];
const PIRATE_OBJECTS = [
  { id: "barrel-a", type: "barrel", x: 200, y: 786, w: 42, h: 44 },
  { id: "barrel-b", type: "barrel", x: 1348, y: 786, w: 42, h: 44 },
  { id: "barrel-c", type: "barrel", x: 675, y: 660, w: 42, h: 44 },
  { id: "barrel-d", type: "barrel", x: 930, y: 660, w: 42, h: 44 },
  { id: "skull-a", type: "skull", x: 110, y: 650, w: 19, h: 14 },
  { id: "skull-b", type: "skull", x: 1468, y: 650, w: 19, h: 14 },
  { id: "table-a", type: "table", x: 716, y: 182, w: 83, h: 32 },
  { id: "table-b", type: "table", x: 805, y: 182, w: 83, h: 32 }
];

function makePirateMap() {
  return {
    platforms: PIRATE_PLATFORMS.map(platform => ({ ...platform })),
    objects: PIRATE_OBJECTS.map(item => ({ ...item, alive: true }))
  };
}

function makePiratePlayer(socket, index, bet) {
  const skin = PIRATE_SKINS[index % PIRATE_SKINS.length];
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    color: PIRATE_COLORS[index % PIRATE_COLORS.length],
    skinIndex: index % PIRATE_SKINS.length,
    skinKey: skin.key,
    skinName: skin.name,
    skinFolder: skin.folder,
    bet,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    dir: index % 2 === 0 ? 1 : -1,
    lives: 3,
    kills: 0,
    deaths: 0,
    alive: true,
    grounded: false,
    action: "idle",
    actionUntil: 0,
    input: { left: false, right: false, jump: false, bomb: false, attack: false },
    jumpQueued: false,
    bombQueued: false,
    attackQueued: false,
    hitUntil: 0,
    invulnerableUntil: 0,
    bombCooldownUntil: 0,
    bombReactCooldownUntil: 0,
    attackCooldownUntil: 0,
    carryingBombId: null,
    disconnected: false,
    joinedAt: Date.now()
  };
}

function positionPiratePlayers(room) {
  room.players.forEach((player, index) => {
    const spawn = PIRATE_SPAWNS[index % PIRATE_SPAWNS.length];
    const skin = PIRATE_SKINS[index % PIRATE_SKINS.length];
    player.color = PIRATE_COLORS[index % PIRATE_COLORS.length];
    player.skinIndex = index % PIRATE_SKINS.length;
    player.skinKey = skin.key;
    player.skinName = skin.name;
    player.skinFolder = skin.folder;
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.dir = index % 2 === 0 ? 1 : -1;
    player.lives = 3;
    player.kills = 0;
    player.deaths = 0;
    player.alive = true;
    player.grounded = false;
    player.action = "idle";
    player.actionUntil = 0;
    player.input = { left: false, right: false, jump: false, bomb: false, attack: false };
    player.jumpQueued = false;
    player.bombQueued = false;
    player.attackQueued = false;
    player.hitUntil = 0;
    player.invulnerableUntil = 0;
    player.bombCooldownUntil = 0;
    player.bombReactCooldownUntil = 0;
    player.attackCooldownUntil = 0;
    player.carryingBombId = null;
    player.disconnected = false;
  });
}

function activePiratePlayers(room) {
  return room.players.filter(player => !player.disconnected);
}

function alivePiratePlayers(room) {
  return activePiratePlayers(room).filter(player => player.alive && Number(player.lives || 0) > 0);
}

function getPirateSkin(player) {
  return PIRATE_SKINS[Number(player?.skinIndex || 0)] || PIRATE_SKINS[0];
}

function serializePirateRoom(room, viewerSocketId) {
  const now = Date.now();
  const isSpectator = !room.players.some(player => player.socketId === viewerSocketId && !player.disconnected);
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    field: PIRATE_FIELD,
    map: room.map || makePirateMap(),
    bombs: (room.bombs || []).map(bomb => ({
      id: bomb.id,
      ownerSocketId: bomb.ownerSocketId,
      x: Math.round(Number(bomb.x || 0)),
      y: Math.round(Number(bomb.y || 0)),
      vx: Math.round(Number(bomb.vx || 0)),
      vy: Math.round(Number(bomb.vy || 0)),
      grounded: Boolean(bomb.grounded),
      carriedBySocketId: bomb.carriedBySocketId || null,
      fuseLeftMs: Math.max(0, Number(bomb.explodesAt || now) - now)
    })),
    explosions: (room.explosions || []).map(explosion => ({
      id: explosion.id,
      ownerSocketId: explosion.ownerSocketId,
      x: Math.round(Number(explosion.x || 0)),
      y: Math.round(Number(explosion.y || 0)),
      radius: explosion.radius,
      ageMs: Math.max(0, now - Number(explosion.createdAt || now)),
      leftMs: Math.max(0, Number(explosion.endsAt || now) - now)
    })),
    pickups: room.pickups || [],
    gameEndsAt: room.gameEndsAt || null,
    timeLeftMs: room.status === "playing" ? Math.max(0, Number(room.gameEndsAt || now) - now) : 0,
    winnerSocketId: room.winnerSocketId || null,
    isSpectator,
    spectatorCount: roomSpectatorCount(room),
    players: room.players.map((player, index) => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      color: player.color,
      skinIndex: player.skinIndex,
      skinKey: player.skinKey,
      skinName: player.skinName,
      skinFolder: player.skinFolder,
      x: Math.round(Number(player.x || 0)),
      y: Math.round(Number(player.y || 0)),
      vx: Math.round(Number(player.vx || 0)),
      vy: Math.round(Number(player.vy || 0)),
      dir: Number(player.dir || 1) >= 0 ? 1 : -1,
      lives: Math.max(0, Math.round(Number(player.lives || 0))),
      kills: Math.max(0, Math.round(Number(player.kills || 0))),
      deaths: Math.max(0, Math.round(Number(player.deaths || 0))),
      alive: Boolean(player.alive && Number(player.lives || 0) > 0),
      grounded: Boolean(player.grounded),
      action: player.action || "idle",
      invulnerableMs: Math.max(0, Number(player.invulnerableUntil || 0) - now),
      carryingBombId: player.carryingBombId || null,
      disconnected: Boolean(player.disconnected),
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      order: index
    }))
  };
}

function emitPirateUpdate(room) {
  const targets = new Set(activePiratePlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("pirate:update", serializePirateRoom(room, socketId));
  });
}

function findPirateRoomBySocket(socketId) {
  for (const room of pirateRooms.values()) {
    if (room.players.some(player => player.socketId === socketId && !player.disconnected) || room.spectators?.has(socketId)) return room;
  }
  return null;
}

function setPirateInput(player, input) {
  const next = {
    left: Boolean(input?.left),
    right: Boolean(input?.right),
    jump: Boolean(input?.jump),
    bomb: Boolean(input?.bomb),
    attack: Boolean(input?.attack || input?.kick)
  };
  if (next.jump && !player.input?.jump) player.jumpQueued = true;
  if (next.bomb && !player.input?.bomb) player.bombQueued = true;
  if (next.attack && !player.input?.attack) player.attackQueued = true;
  player.input = next;
}

function getPirateCarriedBomb(room, player) {
  if (!player?.carryingBombId) return null;
  const bomb = (room.bombs || []).find(item =>
    item.id === player.carryingBombId && item.carriedBySocketId === player.socketId
  );
  if (!bomb) player.carryingBombId = null;
  return bomb || null;
}

function syncPirateCarriedBomb(room, player, now) {
  const bomb = getPirateCarriedBomb(room, player);
  if (!bomb || !player.alive || player.disconnected) return null;

  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  bomb.ownerSocketId = player.socketId;
  bomb.ownerUserId = player.userId;
  bomb.x = clampNumber(Number(player.x || 0) + dir * PIRATE_CARRY_OFFSET_X, PIRATE_FIELD.bombRadius, PIRATE_FIELD.width - PIRATE_FIELD.bombRadius);
  bomb.y = clampNumber(Number(player.y || 0) - PIRATE_CARRY_OFFSET_Y, PIRATE_FIELD.bombRadius, PIRATE_FIELD.height - PIRATE_FIELD.bombRadius);
  bomb.vx = Number(player.vx || 0);
  bomb.vy = Number(player.vy || 0) * 0.16;
  bomb.grounded = false;
  bomb.armedAt = Math.max(Number(bomb.armedAt || now), now + 40);
  return bomb;
}

function dropPirateCarriedBomb(room, player, now, impulse = 0) {
  const bomb = getPirateCarriedBomb(room, player);
  player.carryingBombId = null;
  if (!bomb) return null;

  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  bomb.carriedBySocketId = null;
  bomb.x = clampNumber(Number(player.x || 0) + dir * 24, PIRATE_FIELD.bombRadius, PIRATE_FIELD.width - PIRATE_FIELD.bombRadius);
  bomb.y = clampNumber(Number(player.y || 0) - 50, PIRATE_FIELD.bombRadius, PIRATE_FIELD.height - PIRATE_FIELD.bombRadius);
  bomb.vx = dir * impulse + Number(player.vx || 0) * 0.35;
  bomb.vy = Math.min(Number(player.vy || 0), -120);
  bomb.grounded = false;
  bomb.armedAt = now + 140;
  return bomb;
}

function findPirateBombInReach(room, player, range = PIRATE_GRAB_RANGE, requireFront = false) {
  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  const bodyY = Number(player.y || 0) - PIRATE_FIELD.playerHeight / 2;
  return (room.bombs || [])
    .filter(bomb => !bomb.carriedBySocketId)
    .map(bomb => {
      const dx = Number(bomb.x || 0) - Number(player.x || 0);
      const dy = Number(bomb.y || 0) - bodyY;
      const inFront = dx * dir >= -18;
      const distance = Math.hypot(dx, dy);
      return { bomb, distance, inFront, dy };
    })
    .filter(item =>
      item.distance <= range
      && Math.abs(item.dy) <= 92
      && (!requireFront || item.inFront)
    )
    .sort((a, b) => {
      if (a.inFront !== b.inFront) return a.inFront ? -1 : 1;
      return a.distance - b.distance;
    })[0]?.bomb || null;
}

function grabPirateBomb(room, player, bomb, now, announce = true) {
  if (!player.alive || player.disconnected || !bomb || bomb.carriedBySocketId || getPirateCarriedBomb(room, player)) return false;

  bomb.carriedBySocketId = player.socketId;
  bomb.ownerSocketId = player.socketId;
  bomb.ownerUserId = player.userId;
  player.carryingBombId = bomb.id;
  player.action = "pick";
  player.actionUntil = now + 300;
  player.bombReactCooldownUntil = now + 260;
  syncPirateCarriedBomb(room, player, now);
  if (announce) room.message = `${player.username} pegou uma bomba.`;
  return true;
}

function throwPirateCarriedBomb(room, player, bomb, now, message = null) {
  const carried = bomb || getPirateCarriedBomb(room, player);
  if (!carried) return false;

  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  carried.carriedBySocketId = null;
  carried.ownerSocketId = player.socketId;
  carried.ownerUserId = player.userId;
  carried.x = clampNumber(Number(player.x || 0) + dir * 44, PIRATE_FIELD.bombRadius, PIRATE_FIELD.width - PIRATE_FIELD.bombRadius);
  carried.y = clampNumber(Number(player.y || 0) - 64, PIRATE_FIELD.bombRadius, PIRATE_FIELD.height - PIRATE_FIELD.bombRadius);
  carried.vx = dir * (PIRATE_BOMB_THROW_X + 140 + Math.min(220, Math.abs(Number(player.vx || 0)) * 0.5));
  carried.vy = -PIRATE_BOMB_THROW_Y;
  carried.grounded = false;
  carried.bounces = 0;
  carried.armedAt = now + 150;

  player.carryingBombId = null;
  player.bombCooldownUntil = Math.max(Number(player.bombCooldownUntil || 0), now + 260);
  player.bombReactCooldownUntil = now + PIRATE_BOMB_REACT_COOLDOWN_MS;
  player.action = "throw";
  player.actionUntil = now + PIRATE_THROW_ACTION_MS;
  room.message = message || `${player.username} arremessou a bomba.`;
  return true;
}

function kickPirateBomb(room, player, bomb, now, message = null) {
  if (!player.alive || player.disconnected || !bomb || bomb.carriedBySocketId) return false;

  const dir = Math.sign(Number(bomb.x || 0) - Number(player.x || 0)) || Number(player.dir || 1) || 1;
  bomb.ownerSocketId = player.socketId;
  bomb.ownerUserId = player.userId;
  bomb.vx = dir * (790 + Math.min(260, Math.abs(Number(player.vx || 0)) * 0.8));
  bomb.vy = -330;
  bomb.grounded = false;
  bomb.armedAt = now + 160;

  player.dir = dir >= 0 ? 1 : -1;
  player.action = "kick";
  player.actionUntil = now + PIRATE_ATTACK_ACTION_MS;
  player.bombReactCooldownUntil = now + PIRATE_BOMB_REACT_COOLDOWN_MS;
  room.message = message || `${player.username} chutou a bomba.`;
  return true;
}

function hitPiratePlayerMelee(room, attacker, target, now) {
  if (!attacker?.alive || !target?.alive || target.disconnected) return false;
  if (now < Number(target.invulnerableUntil || 0)) return false;

  const dir = Number(attacker.dir || 1) >= 0 ? 1 : -1;
  target.hitUntil = now + 360;
  target.invulnerableUntil = now + 540;
  target.vx = dir * 540;
  target.vy = -360;
  target.action = "hit";
  dropPirateCarriedBomb(room, target, now, 220);
  room.message = `${attacker.username} bateu em ${target.username}.`;
  return true;
}

function handlePirateAttack(room, player, now) {
  if (!player.alive || player.disconnected || now < Number(player.attackCooldownUntil || 0)) return false;

  player.attackCooldownUntil = now + PIRATE_ATTACK_COOLDOWN_MS;

  const carried = getPirateCarriedBomb(room, player);
  if (carried) return throwPirateCarriedBomb(room, player, carried, now, `${player.username} pegou e arremessou a bomba.`);

  const nearBomb = findPirateBombInReach(room, player, PIRATE_KICK_RANGE, true);
  if (nearBomb && kickPirateBomb(room, player, nearBomb, now, `${player.username} chutou a bomba.`)) return true;

  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  const bodyY = Number(player.y || 0) - PIRATE_FIELD.playerHeight / 2;
  const target = alivePiratePlayers(room)
    .filter(item => item.socketId !== player.socketId)
    .map(item => {
      const dx = Number(item.x || 0) - Number(player.x || 0);
      const dy = (Number(item.y || 0) - PIRATE_FIELD.playerHeight / 2) - bodyY;
      return { item, dx, dy, distance: Math.hypot(dx, dy) };
    })
    .filter(item => item.dx * dir > -8 && item.distance <= PIRATE_ATTACK_RANGE && Math.abs(item.dy) <= 70)
    .sort((a, b) => a.distance - b.distance)[0]?.item || null;

  player.action = "attack";
  player.actionUntil = now + PIRATE_ATTACK_ACTION_MS;
  if (target) return hitPiratePlayerMelee(room, player, target, now);
  return false;
}

function placePirateBomb(room, player, now) {
  if (!player.alive) return;

  const carried = getPirateCarriedBomb(room, player);
  if (carried) {
    throwPirateCarriedBomb(room, player, carried, now);
    return;
  }

  const nearBomb = findPirateBombInReach(room, player, PIRATE_GRAB_RANGE, false);
  if (nearBomb && grabPirateBomb(room, player, nearBomb, now)) return;

  if (now < Number(player.bombCooldownUntil || 0)) return;
  const activeBombs = (room.bombs || []).filter(bomb => bomb.ownerSocketId === player.socketId);
  if (activeBombs.length >= 2) return;
  const dir = Number(player.dir || 1) >= 0 ? 1 : -1;
  room.bombs.push({
    id: `bomb-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ownerSocketId: player.socketId,
    ownerUserId: player.userId,
    x: Math.round(Number(player.x || 0) + dir * 36),
    y: Math.round(Number(player.y || 0) - 48),
    vx: dir * PIRATE_BOMB_THROW_X + Number(player.vx || 0) * 0.25,
    vy: -PIRATE_BOMB_THROW_Y,
    radius: PIRATE_FIELD.bombRadius,
    grounded: false,
    bounces: 0,
    armedAt: now + 180,
    explodesAt: now + PIRATE_BOMB_FUSE_MS
  });
  player.bombCooldownUntil = now + PIRATE_BOMB_COOLDOWN_MS;
  player.action = "throw";
  player.actionUntil = now + PIRATE_THROW_ACTION_MS;
  room.message = `${player.username} lancou uma bomba.`;
}

function updatePiratePlayerPhysics(room, player, dt, now) {
  if (!player.alive || player.disconnected) return;

  const input = player.input || {};
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (move) player.dir = move > 0 ? 1 : -1;

  player.vx = move * PIRATE_SPEED;
  if (player.jumpQueued && player.grounded) {
    player.vy = -PIRATE_JUMP;
    player.grounded = false;
  }
  player.jumpQueued = false;

  player.vy = clampNumber(Number(player.vy || 0) + PIRATE_GRAVITY * dt, -PIRATE_JUMP, PIRATE_MAX_FALL);

  const prevY = Number(player.y || 0);
  player.x = clampNumber(Number(player.x || 0) + player.vx * dt, PIRATE_FIELD.playerWidth / 2, PIRATE_FIELD.width - PIRATE_FIELD.playerWidth / 2);
  player.y = Number(player.y || 0) + player.vy * dt;
  player.grounded = false;

  const platforms = room.map?.platforms || PIRATE_PLATFORMS;
  const halfWidth = PIRATE_FIELD.playerWidth / 2;
  const bottom = player.y;
  const prevBottom = prevY;
  const candidate = platforms
    .filter(platform => {
      const platformTop = Number(platform.y || 0);
      return player.vy >= 0
        && prevBottom <= platformTop + 6
        && bottom >= platformTop
        && player.x + halfWidth > Number(platform.x || 0)
        && player.x - halfWidth < Number(platform.x || 0) + Number(platform.w || 0);
    })
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0))[0];

  if (candidate) {
    player.y = Number(candidate.y || 0);
    player.vy = 0;
    player.grounded = true;
  }

  if (player.y > PIRATE_FIELD.height + 120) {
    damagePiratePlayer(room, player, null, now, 1, "caiu no porao");
    if (player.alive) {
      const spawn = PIRATE_SPAWNS[Math.max(0, room.players.indexOf(player)) % PIRATE_SPAWNS.length];
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
    }
  }

  syncPirateCarriedBomb(room, player, now);

  if (player.bombQueued) placePirateBomb(room, player, now);
  player.bombQueued = false;
  if (player.attackQueued) handlePirateAttack(room, player, now);
  player.attackQueued = false;

  syncPirateCarriedBomb(room, player, now);

  if (!player.alive) {
    player.action = "dead";
  } else if (now < Number(player.hitUntil || 0)) {
    player.action = "hit";
  } else if (now < Number(player.actionUntil || 0)) {
    player.action = player.action || "idle";
  } else if (!player.grounded && player.vy < -40) {
    player.action = "jump";
  } else if (!player.grounded && player.vy >= -40) {
    player.action = "fall";
  } else if (Math.abs(player.vx) > 10) {
    player.action = "run";
  } else {
    player.action = "idle";
  }
}

function updatePirateBombPhysics(room, bomb, dt, now) {
  if (bomb.carriedBySocketId) return;

  const radius = Number(bomb.radius || PIRATE_FIELD.bombRadius);
  const prevY = Number(bomb.y || 0);

  bomb.vy = clampNumber(Number(bomb.vy || 0) + PIRATE_BOMB_GRAVITY * dt, -PIRATE_BOMB_THROW_Y, PIRATE_BOMB_MAX_FALL);
  bomb.x = Number(bomb.x || 0) + Number(bomb.vx || 0) * dt;
  bomb.y = Number(bomb.y || 0) + Number(bomb.vy || 0) * dt;
  bomb.grounded = false;

  if (bomb.x < radius) {
    bomb.x = radius;
    bomb.vx = Math.abs(Number(bomb.vx || 0)) * 0.58;
  }
  if (bomb.x > PIRATE_FIELD.width - radius) {
    bomb.x = PIRATE_FIELD.width - radius;
    bomb.vx = -Math.abs(Number(bomb.vx || 0)) * 0.58;
  }

  const platforms = room.map?.platforms || PIRATE_PLATFORMS;
  const bottom = Number(bomb.y || 0) + radius;
  const prevBottom = prevY + radius;
  const candidate = platforms
    .filter(platform => {
      const platformTop = Number(platform.y || 0);
      return Number(bomb.vy || 0) >= 0
        && prevBottom <= platformTop + 8
        && bottom >= platformTop
        && Number(bomb.x || 0) + radius > Number(platform.x || 0)
        && Number(bomb.x || 0) - radius < Number(platform.x || 0) + Number(platform.w || 0);
    })
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0))[0];

  if (candidate) {
    bomb.y = Number(candidate.y || 0) - radius;
    if (Math.abs(Number(bomb.vy || 0)) > 150) {
      bomb.vy = -Math.abs(Number(bomb.vy || 0)) * PIRATE_BOMB_BOUNCE;
      bomb.bounces = Math.max(0, Number(bomb.bounces || 0) + 1);
    } else {
      bomb.vy = 0;
      bomb.grounded = true;
    }
    bomb.vx = Number(bomb.vx || 0) * PIRATE_BOMB_FRICTION;
    if (Math.abs(Number(bomb.vx || 0)) < 16) bomb.vx = 0;
  }

  if (bomb.y > PIRATE_FIELD.height + 120) {
    bomb.explodesAt = Math.min(Number(bomb.explodesAt || now), now + 40);
  }
}

function handlePirateBombReaction(room, bomb, now) {
  if (bomb.carriedBySocketId) return false;
  if (now < Number(bomb.armedAt || 0)) return false;

  for (const player of alivePiratePlayers(room)) {
    const bodyX = Number(player.x || 0);
    const bodyY = Number(player.y || 0) - PIRATE_FIELD.playerHeight / 2;
    const distance = Math.hypot(bodyX - Number(bomb.x || 0), bodyY - Number(bomb.y || 0));
    if (distance > Number(bomb.radius || PIRATE_FIELD.bombRadius) + 34) continue;
    if (now < Number(player.bombReactCooldownUntil || 0)) continue;
    if (bomb.ownerSocketId === player.socketId && now < Number(bomb.armedAt || 0) + 550) continue;

    const reaction = getPirateSkin(player).bombReaction;
    const dir = Math.sign(Number(bomb.x || 0) - bodyX) || Number(player.dir || 1) || 1;

    if (reaction === "swallow" && bomb.ownerSocketId !== player.socketId) {
      player.action = "swallow";
      player.actionUntil = now + 520;
      player.bombReactCooldownUntil = now + 1700;
      room.message = `${player.username} engoliu uma bomba inimiga.`;
      return true;
    }

    if (reaction === "ignite" && bomb.ownerSocketId !== player.socketId) {
      bomb.explodesAt = Math.min(Number(bomb.explodesAt || now), now + 620);
      bomb.vx = Number(bomb.vx || 0) + dir * 170;
      bomb.vy = Math.min(Number(bomb.vy || 0), -120);
      player.action = "ignite";
      player.actionUntil = now + 540;
      player.bombReactCooldownUntil = now + PIRATE_BOMB_REACT_COOLDOWN_MS;
      room.message = `${player.username} soprou o pavio da bomba.`;
      return false;
    }

    if (reaction === "throw" && bomb.ownerSocketId !== player.socketId) {
      if (grabPirateBomb(room, player, bomb, now, false)) {
        throwPirateCarriedBomb(room, player, bomb, now, `${player.username} pegou e arremessou a bomba de volta.`);
      }
      return false;
    }

    if (reaction === "kick") {
      kickPirateBomb(room, player, bomb, now, `${player.username} chutou a bomba de volta.`);
      return false;
    }
  }

  return false;
}

function damagePiratePlayer(room, player, ownerSocketId, now, amount = 1, reason = "explodiu") {
  if (!player || !player.alive || player.disconnected) return false;
  if (now < Number(player.invulnerableUntil || 0) && !String(reason).startsWith("caiu")) return false;

  player.lives = Math.max(0, Number(player.lives || 0) - amount);
  player.hitUntil = now + 420;
  player.invulnerableUntil = now + 1050;
  player.vy = -520;
  player.vx = clampNumber((player.x - (room.lastExplosionX || player.x)) * 5, -520, 520);
  dropPirateCarriedBomb(room, player, now, 260);

  if (player.lives <= 0) {
    player.alive = false;
    player.action = "dead";
    player.deaths = Math.max(0, Number(player.deaths || 0) + 1);
    const owner = room.players.find(item => item.socketId === ownerSocketId);
    if (owner && owner.socketId !== player.socketId) {
      owner.kills = Math.max(0, Number(owner.kills || 0) + 1);
    }
    room.message = `${player.username} ${reason} e foi eliminado.`;
  } else {
    player.action = "hit";
    room.message = `${player.username} tomou dano.`;
  }
  return true;
}

function explodePirateBomb(room, bomb, now) {
  room.lastExplosionX = Number(bomb.x || 0);
  const holder = room.players.find(player => player.carryingBombId === bomb.id);
  if (holder) holder.carryingBombId = null;
  const explosion = {
    id: `explosion-${bomb.id}`,
    ownerSocketId: bomb.ownerSocketId,
    ownerUserId: bomb.ownerUserId,
    x: Number(bomb.x || 0),
    y: Number(bomb.y || 0),
    radius: PIRATE_FIELD.explosionRadius,
    createdAt: now,
    endsAt: now + 520
  };
  room.explosions.push(explosion);

  activePiratePlayers(room).forEach(player => {
    if (!player.alive) return;
    const targetX = Number(player.x || 0);
    const targetY = Number(player.y || 0) - PIRATE_FIELD.playerHeight / 2;
    if (Math.hypot(targetX - explosion.x, targetY - explosion.y) <= explosion.radius) {
      damagePiratePlayer(room, player, bomb.ownerSocketId, now, 1, "foi pego pela bomba");
    }
  });

  (room.bombs || []).forEach(otherBomb => {
    if (otherBomb.id === bomb.id) return;
    if (Math.hypot(Number(otherBomb.x || 0) - explosion.x, Number(otherBomb.y || 0) - explosion.y) <= explosion.radius * 0.85) {
      otherBomb.explodesAt = Math.min(Number(otherBomb.explodesAt || now), now + 90);
      otherBomb.vx = (Number(otherBomb.x || 0) - explosion.x) * 3;
      otherBomb.vy = -260;
    }
  });

  const objects = room.map?.objects || [];
  objects.forEach(item => {
    if (!item.alive || item.type !== "barrel") return;
    const cx = Number(item.x || 0) + Number(item.w || 0) / 2;
    const cy = Number(item.y || 0) + Number(item.h || 0) / 2;
    if (Math.hypot(cx - explosion.x, cy - explosion.y) <= explosion.radius) {
      item.alive = false;
      if (Math.random() < 0.35) {
        room.pickups.push({
          id: `heart-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type: "heart",
          x: Math.round(cx),
          y: Math.round(cy),
          expiresAt: now + 9500
        });
      }
    }
  });
}

function tickPirateRoom(room) {
  if (!room || !pirateRooms.has(room.roomId) || room.status !== "playing") return;

  const now = Date.now();
  const dt = Math.min((now - (room.lastTick || now)) / 1000, 0.08);
  room.lastTick = now;

  activePiratePlayers(room).forEach(player => updatePiratePlayerPhysics(room, player, dt, now));

  for (let index = room.bombs.length - 1; index >= 0; index -= 1) {
    const bomb = room.bombs[index];
    updatePirateBombPhysics(room, bomb, dt, now);
    if (handlePirateBombReaction(room, bomb, now)) {
      room.bombs.splice(index, 1);
      continue;
    }
    if (now >= Number(bomb.explodesAt || 0)) {
      room.bombs.splice(index, 1);
      explodePirateBomb(room, bomb, now);
    }
  }
  room.explosions = (room.explosions || []).filter(explosion => now < Number(explosion.endsAt || 0));

  for (let index = room.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = room.pickups[index];
    if (now >= Number(pickup.expiresAt || 0)) {
      room.pickups.splice(index, 1);
      continue;
    }
    const player = alivePiratePlayers(room).find(item => Math.hypot(item.x - pickup.x, (item.y - 34) - pickup.y) <= 46);
    if (player) {
      player.lives = Math.min(3, Number(player.lives || 0) + 1);
      room.pickups.splice(index, 1);
      room.message = `${player.username} pegou um coracao.`;
    }
  }

  const alive = alivePiratePlayers(room);
  if (alive.length <= 1) {
    finishPirateRoom(room, alive.length === 1 ? "Ultimo pirata de pe." : "Todo mundo explodiu.");
    return;
  }

  if (now >= Number(room.gameEndsAt || 0)) {
    finishPirateRoom(room, "Tempo encerrado.");
    return;
  }

  emitPirateUpdate(room);
}

function pickPirateWinner(room) {
  const alive = alivePiratePlayers(room);
  if (alive.length === 1) return alive[0];
  if (alive.length > 1 && Date.now() >= Number(room.gameEndsAt || 0)) {
    return alive.slice().sort((a, b) => {
      if (Number(b.lives || 0) !== Number(a.lives || 0)) return Number(b.lives || 0) - Number(a.lives || 0);
      if (Number(b.kills || 0) !== Number(a.kills || 0)) return Number(b.kills || 0) - Number(a.kills || 0);
      if (Number(a.deaths || 0) !== Number(b.deaths || 0)) return Number(a.deaths || 0) - Number(b.deaths || 0);
      return Number(a.joinedAt || 0) - Number(b.joinedAt || 0);
    })[0] || null;
  }
  return null;
}

function startPirateRound(room, requestedBet = room.bet) {
  const maxBet = room.players.length >= 3 ? 20 : 50;
  const tableBet = clampNumber(requestedBet, 5, maxBet);
  if (room.players.length < 2) {
    room.message = "Precisa de pelo menos 2 jogadores para iniciar.";
    emitPirateUpdate(room);
    return false;
  }

  for (const player of room.players) {
    const user = db.findUser("id", player.userId);
    if (!user || Number(user.bet_credits || 0) < tableBet) {
      room.message = `${player.username} nao tem creditos para ${tableBet}.`;
      emitPirateUpdate(room);
      return false;
    }
  }

  room.players.forEach(player => {
    const user = db.findUser("id", player.userId);
    db.updateUser(player.userId, {
      bet_credits: Math.max(0, Number(user.bet_credits || 0) - tableBet)
    });
    player.bet = tableBet;
  });

  room.bet = tableBet;
  room.pot = room.players.reduce((sum, player) => sum + Number(player.bet || tableBet || 0), 0);
  room.status = "playing";
  room.startedAt = Date.now();
  room.gameEndsAt = room.startedAt + PIRATE_GAME_MS;
  room.winnerSocketId = null;
  room.map = makePirateMap();
  room.bombs = [];
  room.explosions = [];
  room.pickups = [];
  room.message = "A batalha comecou. Pegue, arremesse, chute e sobreviva.";
  positionPiratePlayers(room);

  clearInterval(room.tickTimer);
  room.lastTick = Date.now();
  room.tickTimer = setInterval(() => tickPirateRoom(room), PIRATE_TICK_MS);
  emitPirateUpdate(room);
  broadcastOnlineList();
  return true;
}

function finishPirateRoom(room, reason = "") {
  if (!room || room.status === "finished") return;

  clearInterval(room.tickTimer);
  room.tickTimer = null;
  room.status = "finished";
  room.gameEndsAt = null;

  const winner = pickPirateWinner(room);
  room.winnerSocketId = winner?.socketId || null;
  const totalPot = Number(room.pot || 0) || room.players.reduce((sum, player) => sum + Number(player.bet || room.bet || 0), 0);

  if (winner) {
    const user = db.findUser("id", winner.userId);
    if (user) {
      db.updateUser(winner.userId, {
        bet_credits: Number(user.bet_credits || 0) + totalPot
      });
      addExchangeWin(winner.userId);
    }
    room.message = `${reason ? `${reason} ` : ""}${winner.username} venceu Pirate Bomb e levou ${totalPot} creditos.`;
  } else {
    activePiratePlayers(room).forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
    room.message = `${reason ? `${reason} ` : ""}Pirate Bomb terminou empatado. Apostas devolvidas.`;
  }
  resetExchangeLosses(room.players.map(player => player.userId), winner ? [winner.userId] : []);

  const targets = new Set(activePiratePlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    const participant = room.players.find(player => player.socketId === socketId && !player.disconnected);
    io.to(socketId).emit("pirate:finished", {
      room: serializePirateRoom(room, socketId),
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

  pirateRooms.delete(room.roomId);
  broadcastOnlineList();
}

function cancelPirateRoom(room, reason = "Sala de Pirate Bomb cancelada.") {
  if (!room) return;
  clearInterval(room.tickTimer);

  if (room.status === "playing") {
    activePiratePlayers(room).forEach(player => {
      const user = db.findUser("id", player.userId);
      if (user) {
        db.updateUser(player.userId, {
          bet_credits: Number(user.bet_credits || 0) + Number(player.bet || room.bet || 0)
        });
      }
    });
  }

  const targets = new Set(activePiratePlayers(room).map(player => player.socketId));
  for (const spectatorId of room.spectators || []) targets.add(spectatorId);
  targets.forEach(socketId => {
    io.to(socketId).emit("pirate:cancelled", { message: reason });
    const participant = room.players.find(player => player.socketId === socketId && !player.disconnected);
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

  pirateRooms.delete(room.roomId);
  broadcastOnlineList();
}

function removePiratePlayer(room, socketId, reason = "") {
  const player = room.players.find(item => item.socketId === socketId && !item.disconnected);
  if (!player) {
    clearSpectator(room, socketId);
    emitPirateUpdate(room);
    broadcastOnlineList();
    return;
  }

  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  if (room.status === "playing") {
    player.disconnected = true;
    player.alive = false;
    player.lives = 0;
    player.input = { left: false, right: false, jump: false, bomb: false, attack: false };
    resetExchangeWinStreak(player.userId);
    room.message = reason || `${player.username} saiu e perdeu a batalha.`;
    if (alivePiratePlayers(room).length <= 1) {
      finishPirateRoom(room, room.message);
      return;
    }
    emitPirateUpdate(room);
    broadcastOnlineList();
    return;
  }

  room.players = room.players.filter(item => item.socketId !== socketId);
  if (!room.players.length) {
    pirateRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }
  positionPiratePlayers(room);
  room.message = reason || `${player.username} saiu da sala.`;
  emitPirateUpdate(room);
  broadcastOnlineList();
}

function makeHorrorRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!horrorRooms.has(code)) return code;
  }
  return `H${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

function serializeHorrorRoom(room, viewerSocketId) {
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    status: room.status,
    message: room.message || "",
    state: room.state || {},
    players: room.players.map(player => ({
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar || "",
      isHost: player.socketId === room.hostSocketId,
      isMe: player.socketId === viewerSocketId,
      x: Number(player.x || 0),
      z: Number(player.z || 0),
      yaw: Number(player.yaw || 0),
      pitch: Number(player.pitch || 0),
      crouching: Boolean(player.crouching),
      hiding: Boolean(player.hiding),
      hasKey: Boolean(player.hasKey),
      hasFuse: Boolean(player.hasFuse),
      hasTool: Boolean(player.hasTool),
      alive: player.alive !== false,
      escaped: Boolean(player.escaped)
    }))
  };
}

function emitHorrorUpdate(room) {
  if (!room) return;
  room.players.forEach(player => {
    io.to(player.socketId).emit("horror:update", serializeHorrorRoom(room, player.socketId));
  });
}

function findHorrorRoomBySocket(socketId) {
  for (const room of horrorRooms.values()) {
    if (room.players.some(player => player.socketId === socketId)) return room;
  }
  return null;
}

function removeHorrorPlayer(room, socketId, reason = "") {
  if (!room) return;
  const player = room.players.find(item => item.socketId === socketId);
  if (!player) return;

  room.players = room.players.filter(item => item.socketId !== socketId);
  const liveSocket = io.sockets.sockets.get(socketId);
  if (liveSocket) liveSocket.leave(room.roomId);

  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === room.roomId) {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }

  if (!room.players.length) {
    horrorRooms.delete(room.roomId);
    broadcastOnlineList();
    return;
  }

  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
    io.to(room.hostSocketId).emit("horror:host");
  }

  room.message = reason || `${player.username} saiu da casa.`;
  emitHorrorUpdate(room);
  broadcastOnlineList();
}

function makeCardWarsPlayer(socket, role) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    avatar: socket.avatar || "",
    role,
    disconnected: false,
    lastSeenAt: Date.now()
  };
}

function cardWarsUrl(room, player, extra = {}) {
  const params = new URLSearchParams({
    online: "1",
    roomId: room.roomId,
    role: player.role || "player"
  });
  const opponent = room.players.find(item => item.userId !== player.userId);
  if (opponent?.username) params.set("opponent", opponent.username);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  return `/cardwars/?${params.toString()}`;
}

function serializeCardWarsRoom(room, viewerSocketId = "") {
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    hostUsername: room.hostUsername,
    bet: room.bet,
    status: room.status,
    message: room.message,
    players: room.players.map(player => ({
      socketId: player.socketId,
      userId: player.userId,
      username: player.username,
      avatar: player.avatar || "",
      role: player.role,
      disconnected: Boolean(player.disconnected),
      isHost: player.role === "host",
      isMe: player.socketId === viewerSocketId
    }))
  };
}

function emitCardWarsUpdate(room) {
  room.players.forEach(player => {
    if (!player.disconnected && player.socketId) {
      io.to(player.socketId).emit("cardwars:update", serializeCardWarsRoom(room, player.socketId));
    }
  });
}

function emitCardWarsLaunch(room) {
  room.players.forEach(player => {
    if (!player.disconnected && player.socketId) {
      io.to(player.socketId).emit("cardwars:launch", {
        room: serializeCardWarsRoom(room, player.socketId),
        url: cardWarsUrl(room, player)
      });
    }
  });
}

function setOnlineCardWars(socketId, roomId) {
  const online = onlinePlayers.get(socketId);
  if (online) {
    online.inGame = true;
    online.roomId = roomId;
    online.game = "cardwars";
  }
}

function clearOnlineCardWars(socketId, roomId) {
  const online = onlinePlayers.get(socketId);
  if (online && online.roomId === roomId && online.game === "cardwars") {
    online.inGame = false;
    online.roomId = null;
    online.game = null;
  }
}

function findCardWarsRoomBySocket(socketId) {
  for (const room of cardWarsRooms.values()) {
    if (room.players.some(player => player.socketId === socketId)) return room;
  }
  return null;
}

function cancelCardWarsRoom(room, reason = "Sala de Card Wars cancelada.") {
  if (!room) return;
  if (room.reconnectTimer) {
    clearTimeout(room.reconnectTimer);
    room.reconnectTimer = null;
  }
  room.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit("cardwars:cancelled", { message: reason });
      clearOnlineCardWars(player.socketId, room.roomId);
      const liveSocket = io.sockets.sockets.get(player.socketId);
      if (liveSocket) liveSocket.leave(room.roomId);
    }
  });
  cardWarsRooms.delete(room.roomId);
  broadcastOnlineList();
}

function scheduleCardWarsReconnectCleanup(room) {
  if (!room || room.reconnectTimer) return;
  room.reconnectTimer = setTimeout(() => {
    room.reconnectTimer = null;
    const current = cardWarsRooms.get(room.roomId);
    if (!current) return;
    const missing = current.players.some(player => player.disconnected);
    if (missing) {
      cancelCardWarsRoom(current, "Um jogador saiu do Card Wars online.");
    }
  }, CARD_WARS_RECONNECT_GRACE_MS);
}

function markCardWarsDisconnected(room, socketId, reason = "Jogador reconectando ao Card Wars.") {
  const player = room?.players.find(item => item.socketId === socketId);
  if (!player) return;
  clearOnlineCardWars(socketId, room.roomId);
  if (room.status === "waiting" || room.players.length < 2) {
    cancelCardWarsRoom(room, reason);
    return;
  }
  player.disconnected = true;
  player.lastSeenAt = Date.now();
  room.message = reason;
  emitCardWarsUpdate(room);
  scheduleCardWarsReconnectCleanup(room);
  broadcastOnlineList();
}

function resumeCardWarsPlayer(room, socket) {
  const player = room?.players.find(item => item.userId === socket.userId);
  if (!player) return null;
  if (room.reconnectTimer) {
    clearTimeout(room.reconnectTimer);
    room.reconnectTimer = null;
  }
  const previousSocketId = player.socketId;
  if (previousSocketId && previousSocketId !== socket.id) {
    clearOnlineCardWars(previousSocketId, room.roomId);
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) previousSocket.leave(room.roomId);
  }
  player.socketId = socket.id;
  player.avatar = socket.avatar || player.avatar || "";
  player.disconnected = false;
  player.lastSeenAt = Date.now();
  if (player.role === "host") {
    room.hostSocketId = socket.id;
    room.hostUsername = socket.username;
  }
  socket.join(room.roomId);
  setOnlineCardWars(socket.id, room.roomId);
  room.message = `${socket.username} esta no Card Wars online.`;
  emitCardWarsUpdate(room);
  broadcastOnlineList();
  return player;
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
  socket.on("loan:request", ({ toSocketId, amount }) => {
    try {
      const requestedAmount = parseLoanAmount(amount);
      const lender = onlinePlayers.get(toSocketId);
      if (!lender) return socket.emit("loan:error", "Jogador indisponivel para emprestar.");
      if (Number(lender.userId) === Number(socket.userId)) {
        return socket.emit("loan:error", "Voce nao pode pedir emprestado para si mesmo.");
      }

      const borrower = db.findUser("id", socket.userId);
      if (!borrower) return socket.emit("loan:error", "Usuario nao encontrado.");

      const requestId = `loan-${socket.id}-${Date.now()}`;
      pendingLoanRequests.set(requestId, {
        requestId,
        fromSocketId: socket.id,
        fromUserId: socket.userId,
        fromUsername: socket.username,
        toSocketId,
        toUserId: lender.userId,
        toUsername: lender.username,
        amount: requestedAmount,
        createdAt: Date.now()
      });

      io.to(toSocketId).emit("loan:received", {
        requestId,
        fromSocketId: socket.id,
        fromUsername: socket.username,
        requestedAmount
      });
      socket.emit("loan:sent", { requestId, toUsername: lender.username, requestedAmount });
    } catch (err) {
      socket.emit("loan:error", err.message);
    }
  });

  socket.on("loan:accept", ({ requestId, amount }) => {
    const request = pendingLoanRequests.get(requestId);
    if (!request || request.toSocketId !== socket.id) {
      return socket.emit("loan:error", "Pedido de emprestimo expirado.");
    }

    try {
      const approvedAmount = parseLoanAmount(amount || request.amount);
      const result = db.createLoan({
        borrowerId: request.fromUserId,
        lenderId: socket.userId,
        principal: approvedAmount
      });
      pendingLoanRequests.delete(requestId);

      emitLoanRefresh([request.fromUserId, socket.userId], `${socket.username} emprestou ${approvedAmount} creditos de aposta para ${request.fromUsername}.`);
      io.to(request.fromSocketId).emit("loan:approved", {
        requestId,
        fromUsername: socket.username,
        amount: approvedAmount,
        totalDue: result.loan.total_due,
        user: safeUser(result.borrower)
      });
      socket.emit("loan:accepted", {
        requestId,
        toUsername: request.fromUsername,
        amount: approvedAmount,
        totalDue: result.loan.total_due,
        user: safeUser(result.lender)
      });
    } catch (err) {
      socket.emit("loan:error", err.message);
    }
  });

  socket.on("loan:reject", ({ requestId }) => {
    const request = pendingLoanRequests.get(requestId);
    if (!request || request.toSocketId !== socket.id) return;
    pendingLoanRequests.delete(requestId);
    io.to(request.fromSocketId).emit("loan:rejected", { requestId, username: socket.username });
  });

  socket.on("loan:cancel", ({ requestId }) => {
    const request = pendingLoanRequests.get(requestId);
    if (!request || request.fromSocketId !== socket.id) return;
    pendingLoanRequests.delete(requestId);
    io.to(request.toSocketId).emit("loan:cancelled", { requestId, username: socket.username });
  });

  socket.on("horror:create", () => {
    const current = onlinePlayers.get(socket.id);
    if (current?.inGame) return socket.emit("horror:error", "Voce ja esta em uma partida.");

    const roomId = makeHorrorRoomCode();
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      status: "playing",
      message: `${socket.username} entrou na casa.`,
      state: { teamHasKey: false, teamHasFuse: false, teamHasTool: false, teamEscaped: false, monster: null },
      players: [{
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
        avatar: socket.avatar || "",
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        crouching: false,
        hiding: false,
        hasKey: false,
        hasFuse: false,
        hasTool: false,
        alive: true,
        escaped: false
      }]
    };

    horrorRooms.set(roomId, room);
    socket.join(roomId);
    if (current) { current.inGame = true; current.roomId = roomId; current.game = "horror"; }

    socket.emit("horror:joined", serializeHorrorRoom(room, socket.id));
    emitHorrorUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horror:join", ({ roomId }) => {
    const code = String(roomId || "").trim().toUpperCase();
    const room = horrorRooms.get(code);
    if (!room || room.status !== "playing") return socket.emit("horror:error", "Sala indisponivel.");
    if (room.players.length >= HORROR_MAX_PLAYERS) return socket.emit("horror:error", "Sala cheia.");

    const current = onlinePlayers.get(socket.id);
    if (current?.inGame) return socket.emit("horror:error", "Voce ja esta em uma partida.");

    if (!room.players.some(player => player.socketId === socket.id)) {
      room.players.push({
        socketId: socket.id,
        userId: socket.userId,
        username: socket.username,
        avatar: socket.avatar || "",
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        crouching: false,
        hiding: false,
        hasKey: Boolean(room.state?.teamHasKey),
        hasFuse: Boolean(room.state?.teamHasFuse),
        hasTool: Boolean(room.state?.teamHasTool),
        alive: true,
        escaped: false
      });
    }

    socket.join(code);
    if (current) { current.inGame = true; current.roomId = code; current.game = "horror"; }
    room.message = `${socket.username} entrou na casa.`;

    socket.emit("horror:joined", serializeHorrorRoom(room, socket.id));
    emitHorrorUpdate(room);
    broadcastOnlineList();
  });

  socket.on("horror:player", (state = {}) => {
    const room = findHorrorRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(item => item.socketId === socket.id);
    if (!player) return;

    player.x = Number.isFinite(Number(state.x)) ? Number(state.x) : player.x;
    player.z = Number.isFinite(Number(state.z)) ? Number(state.z) : player.z;
    player.yaw = Number.isFinite(Number(state.yaw)) ? Number(state.yaw) : player.yaw;
    player.pitch = Number.isFinite(Number(state.pitch)) ? Number(state.pitch) : player.pitch;
    player.crouching = Boolean(state.crouching);
    player.hiding = Boolean(state.hiding);
    player.hasKey = Boolean(state.hasKey);
    player.hasFuse = Boolean(state.hasFuse);
    player.hasTool = Boolean(state.hasTool);
    player.alive = state.alive !== false;
    player.escaped = Boolean(state.escaped);

    socket.to(room.roomId).volatile.emit("horror:player", {
      socketId: socket.id,
      username: socket.username,
      avatar: socket.avatar || "",
      x: player.x,
      z: player.z,
      yaw: player.yaw,
      pitch: player.pitch,
      crouching: player.crouching,
      hiding: player.hiding,
      hasKey: player.hasKey,
      hasFuse: player.hasFuse,
      hasTool: player.hasTool,
      alive: player.alive,
      escaped: player.escaped
    });
  });

  socket.on("horror:host-state", (state = {}) => {
    const room = findHorrorRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    room.state = {
      teamHasKey: Boolean(state.teamHasKey),
      teamHasFuse: Boolean(state.teamHasFuse),
      teamHasTool: Boolean(state.teamHasTool),
      teamEscaped: Boolean(state.teamEscaped),
      monster: state.monster && typeof state.monster === "object" ? {
        x: Number(state.monster.x) || 0,
        z: Number(state.monster.z) || 0,
        fx: Number(state.monster.fx) || 0,
        fz: Number(state.monster.fz) || -1,
        state: String(state.monster.state || "patrol")
      } : null
    };
    socket.to(room.roomId).volatile.emit("horror:host-state", room.state);
  });

  socket.on("horror:event", (event = {}) => {
    const room = findHorrorRoomBySocket(socket.id);
    if (!room) return;
    const type = String(event.type || "").slice(0, 32);
    const payload = {
      type,
      fromSocketId: socket.id,
      x: Number.isFinite(Number(event.x)) ? Number(event.x) : null,
      z: Number.isFinite(Number(event.z)) ? Number(event.z) : null,
      intensity: Number.isFinite(Number(event.intensity)) ? Number(event.intensity) : null,
      label: String(event.label || "").slice(0, 80),
      targetSocketId: event.targetSocketId ? String(event.targetSocketId) : null
    };

    if (type === "key") room.state.teamHasKey = true;
    if (type === "escape-item" && payload.label === "fuse") room.state.teamHasFuse = true;
    if (type === "escape-item" && payload.label === "tool") room.state.teamHasTool = true;
    if (type === "escape") room.state.teamEscaped = true;

    socket.to(room.roomId).emit("horror:event", payload);
  });

  socket.on("horror:leave", () => {
    const room = findHorrorRoomBySocket(socket.id);
    if (room) removeHorrorPlayer(room, socket.id, `${socket.username} saiu da casa.`);
  });

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

    const artilleryRoom = findArtilleryRoomBySocket(socket.id);
    if (artilleryRoom) {
      artilleryRoom.players.forEach(player => targets.add(player.socketId));
      for (const spectatorId of artilleryRoom.spectators || []) targets.add(spectatorId);
    }

    const relicRoom = findRelicRoomBySocket(socket.id);
    if (relicRoom) {
      activeRelicPlayers(relicRoom).forEach(player => targets.add(player.socketId));
      for (const spectatorId of relicRoom.spectators || []) targets.add(spectatorId);
    }

    const pirateRoom = findPirateRoomBySocket(socket.id);
    if (pirateRoom) {
      activePiratePlayers(pirateRoom).forEach(player => targets.add(player.socketId));
      for (const spectatorId of pirateRoom.spectators || []) targets.add(spectatorId);
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
    if (!p?.roomId) return;
    if (state?.p1kick) {
      socket.to(p.roomId).emit("game:state", state);
    } else {
      socket.volatile.to(p.roomId).emit("game:state", state);
    }
  });

  socket.on("game:input", (inputs) => {
    const p = onlinePlayers.get(socket.id);
    if (!p?.roomId) return;
    if (inputs?.kick) {
      socket.to(p.roomId).emit("game:input", inputs);
    } else {
      socket.volatile.to(p.roomId).emit("game:input", inputs);
    }
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
    const kickPressed = Boolean(inputs?.kick);
    player.inputs = {
      left: Boolean(inputs?.left),
      right: Boolean(inputs?.right),
      up: Boolean(inputs?.up || inputs?.jump),
      down: Boolean(inputs?.down),
      jump: Boolean(inputs?.jump),
      kick: false
    };
    if (kickPressed) player.kickQueued = true;
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
  socket.on("artillery:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("artillery:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("artillery:error", "Voce ja esta em uma partida.");

    const roomId = `artillery-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      terrain: makeArtilleryTerrain(),
      wind: 0,
      turnIndex: 0,
      turnSocketId: null,
      turnEndsAt: null,
      turnTimer: null,
      shotSeq: 0,
      lastShot: null,
      spectators: new Set(),
      winnerSocketId: null,
      message: "Sala aberta. Entre, ajuste angulo e forca, e derrube os rivais.",
      players: [makeArtilleryPlayer(socket, 0, tableBet)]
    };
    artilleryRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "artillery"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("artillery:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitArtilleryUpdate(room);
    broadcastOnlineList();
  });

  socket.on("artillery:join", ({ roomId }) => {
    const room = artilleryRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("artillery:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitArtilleryUpdate(room);
    if (room.players.length >= ARTILLERY_MAX_PLAYERS)
      return socket.emit("artillery:error", `Sala cheia (max. ${ARTILLERY_MAX_PLAYERS} jogadores).`);

    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("artillery:error", `Esta sala teria ${room.players.length + 1} jogadores. Aposta maxima: ${maxBet} creditos.`);
    }

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("artillery:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("artillery:error", "Voce ja esta em uma partida.");

    room.players.push(makeArtilleryPlayer(socket, room.players.length, room.bet));
    room.message = `${socket.username} entrou no Canhao Arena.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "artillery"; }
    emitArtilleryUpdate(room);
    broadcastOnlineList();
  });

  socket.on("artillery:start", ({ roomId }) => {
    const room = artilleryRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("artillery:error", "So o dono da sala pode iniciar.");
    startArtilleryRound(room, room.bet);
  });

  socket.on("artillery:shoot", ({ roomId, angle, power }) => {
    const room = artilleryRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    if (room.turnSocketId !== socket.id)
      return socket.emit("artillery:error", "Aguarde sua vez.");
    if (Date.now() > Number(room.turnEndsAt || 0)) {
      room.message = `${socket.username} perdeu o turno.`;
      advanceArtilleryTurn(room);
      emitArtilleryUpdate(room);
      return;
    }

    const shooter = room.players.find(player => player.socketId === socket.id && player.alive);
    if (!shooter) return;
    clearTimeout(room.turnTimer);
    shooter.angle = clampNumber(angle, 0, 180);
    shooter.power = clampNumber(power, 18, 100);
    room.lastShot = simulateArtilleryShot(room, shooter, shooter.angle, shooter.power);
    const hits = room.lastShot.damages.filter(item => item.damage > 0);
    room.message = hits.length
      ? `${shooter.username} causou dano em ${hits.map(item => item.username).join(", ")}.`
      : `${shooter.username} errou o disparo.`;

    if (artilleryAlivePlayers(room).length <= 1) {
      finishArtilleryRoom(room);
      return;
    }

    advanceArtilleryTurn(room);
    emitArtilleryUpdate(room);
  });

  socket.on("artillery:leave", ({ roomId }) => {
    const room = artilleryRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitArtilleryUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (room.status === "waiting" && room.hostSocketId === socket.id) {
      cancelArtilleryRoom(room, "O dono cancelou o Canhao Arena.");
      return;
    }
    removeArtilleryPlayer(room, socket.id, `${socket.username} saiu do Canhao Arena.`);
  });

  socket.on("artillery:spectate", ({ roomId }) => {
    const room = artilleryRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("artillery:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitArtilleryUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("artillery:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitArtilleryUpdate(room);
    broadcastOnlineList();
  });

  socket.on("artillery:unwatch", ({ roomId }) => {
    const room = artilleryRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitArtilleryUpdate(room);
    broadcastOnlineList();
  });

  // Relic Rush
  socket.on("relic:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("relic:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("relic:error", "Voce ja esta em uma partida.");

    const roomId = `relic-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      pot: tableBet,
      status: "waiting",
      gameEndsAt: null,
      winnerSocketId: null,
      tickTimer: null,
      lastTick: Date.now(),
      relics: [],
      mines: [],
      portals: makeRelicPortals(),
      spectators: new Set(),
      message: "Sala aberta. Entre na expedicao e colete reliquias.",
      players: [makeRelicPlayer(socket, 0, tableBet)]
    };
    positionRelicPlayers(room);
    relicRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "relic"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("relic:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitRelicUpdate(room);
    broadcastOnlineList();
  });

  socket.on("relic:join", ({ roomId }) => {
    const room = relicRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("relic:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitRelicUpdate(room);
    if (room.players.length >= RELIC_MAX_PLAYERS)
      return socket.emit("relic:error", `Sala cheia (max. ${RELIC_MAX_PLAYERS} jogadores).`);

    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("relic:error", `Esta sala teria ${room.players.length + 1} jogadores. Aposta maxima: ${maxBet} creditos.`);
    }

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("relic:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("relic:error", "Voce ja esta em uma partida.");

    room.players.push(makeRelicPlayer(socket, room.players.length, room.bet));
    positionRelicPlayers(room);
    room.message = `${socket.username} entrou no Relic Rush.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "relic"; }
    emitRelicUpdate(room);
    broadcastOnlineList();
  });

  socket.on("relic:start", ({ roomId }) => {
    const room = relicRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("relic:error", "So o dono da sala pode iniciar.");
    startRelicRound(room, room.bet);
  });

  socket.on("relic:input", ({ roomId, input }) => {
    const room = relicRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id && !item.disconnected);
    if (!player) return;
    setRelicInput(player, input);
  });

  socket.on("relic:leave", ({ roomId }) => {
    const room = relicRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitRelicUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (room.status === "waiting" && room.hostSocketId === socket.id) {
      cancelRelicRoom(room, "O dono cancelou o Relic Rush.");
      return;
    }
    removeRelicPlayer(room, socket.id, `${socket.username} saiu do Relic Rush.`);
  });

  socket.on("relic:spectate", ({ roomId }) => {
    const room = relicRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("relic:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id && !player.disconnected))
      return emitRelicUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("relic:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitRelicUpdate(room);
    broadcastOnlineList();
  });

  socket.on("relic:unwatch", ({ roomId }) => {
    const room = relicRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitRelicUpdate(room);
    broadcastOnlineList();
  });

  // Pirate Bomb
  socket.on("pirate:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("pirate:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("pirate:error", "Voce ja esta em uma partida.");

    const roomId = `pirate-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      pot: tableBet,
      status: "waiting",
      gameEndsAt: null,
      winnerSocketId: null,
      tickTimer: null,
      lastTick: Date.now(),
      map: makePirateMap(),
      bombs: [],
      explosions: [],
      pickups: [],
      spectators: new Set(),
      message: "Sala aberta. Entre no conves e prepare as bombas.",
      players: [makePiratePlayer(socket, 0, tableBet)]
    };
    positionPiratePlayers(room);
    pirateRooms.set(roomId, room);
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "pirate"; }

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("pirate:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    emitPirateUpdate(room);
    broadcastOnlineList();
  });

  socket.on("pirate:join", ({ roomId }) => {
    const room = pirateRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("pirate:error", "Sala indisponivel.");
    if (room.players.some(player => player.socketId === socket.id))
      return emitPirateUpdate(room);
    if (room.players.length >= PIRATE_MAX_PLAYERS)
      return socket.emit("pirate:error", `Sala cheia (max. ${PIRATE_MAX_PLAYERS} jogadores).`);

    const maxBet = room.players.length >= 2 ? 20 : 50;
    if (room.bet > maxBet) {
      return socket.emit("pirate:error", `Esta sala teria ${room.players.length + 1} jogadores. Aposta maxima: ${maxBet} creditos.`);
    }

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("pirate:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("pirate:error", "Voce ja esta em uma partida.");

    room.players.push(makePiratePlayer(socket, room.players.length, room.bet));
    positionPiratePlayers(room);
    room.message = `${socket.username} entrou no Pirate Bomb.`;
    socket.join(roomId);
    if (player) { player.inGame = true; player.roomId = roomId; player.game = "pirate"; }
    emitPirateUpdate(room);
    broadcastOnlineList();
  });

  socket.on("pirate:start", ({ roomId }) => {
    const room = pirateRooms.get(roomId);
    if (!room || room.status !== "waiting") return;
    if (room.hostSocketId !== socket.id)
      return socket.emit("pirate:error", "So o dono da sala pode iniciar.");
    startPirateRound(room, room.bet);
  });

  socket.on("pirate:input", ({ roomId, input }) => {
    const room = pirateRooms.get(roomId);
    if (!room || room.status !== "playing") return;
    const player = room.players.find(item => item.socketId === socket.id && !item.disconnected);
    if (!player) return;
    setPirateInput(player, input);
  });

  socket.on("pirate:leave", ({ roomId }) => {
    const room = pirateRooms.get(roomId);
    if (!room) return;
    if (room.spectators?.has(socket.id)) {
      clearSpectator(room, socket.id);
      emitPirateUpdate(room);
      broadcastOnlineList();
      return;
    }
    if (room.status === "waiting" && room.hostSocketId === socket.id) {
      cancelPirateRoom(room, "O dono cancelou o Pirate Bomb.");
      return;
    }
    removePiratePlayer(room, socket.id, `${socket.username} saiu do Pirate Bomb.`);
  });

  socket.on("pirate:spectate", ({ roomId }) => {
    const room = pirateRooms.get(roomId);
    if (!room || room.status !== "playing")
      return socket.emit("pirate:error", "Partida indisponivel para assistir.");
    if (room.players.some(player => player.socketId === socket.id && !player.disconnected))
      return emitPirateUpdate(room);
    const online = onlinePlayers.get(socket.id);
    if (online?.inGame)
      return socket.emit("pirate:error", "Termine sua partida antes de assistir outra.");
    ensureSpectators(room).add(socket.id);
    socket.join(roomId);
    emitPirateUpdate(room);
    broadcastOnlineList();
  });

  socket.on("pirate:unwatch", ({ roomId }) => {
    const room = pirateRooms.get(roomId);
    if (!room) return;
    clearSpectator(room, socket.id);
    emitPirateUpdate(room);
    broadcastOnlineList();
  });

  socket.on("cardwars:create", ({ bet }) => {
    const tableBet = clampNumber(bet || 10, 5, 50);
    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < tableBet)
      return socket.emit("cardwars:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("cardwars:error", "Voce ja esta em uma partida.");

    const roomId = `cardwars-${Date.now()}-${socket.id}`;
    const room = {
      roomId,
      hostSocketId: socket.id,
      hostUsername: socket.username,
      bet: tableBet,
      status: "waiting",
      reconnectTimer: null,
      message: "Sala aberta. Aguardando outro jogador entrar no Card Wars.",
      players: [makeCardWarsPlayer(socket, "host")]
    };
    cardWarsRooms.set(roomId, room);
    socket.join(roomId);
    setOnlineCardWars(socket.id, roomId);

    for (const [, target] of onlinePlayers) {
      if (target.socketId !== socket.id && !target.inGame) {
        io.to(target.socketId).emit("cardwars:invite", { roomId, fromUsername: socket.username, bet: tableBet });
      }
    }

    socket.emit("cardwars:created", serializeCardWarsRoom(room, socket.id));
    emitCardWarsUpdate(room);
    broadcastOnlineList();
  });

  socket.on("cardwars:join", ({ roomId }) => {
    const room = cardWarsRooms.get(roomId);
    if (!room || room.status !== "waiting")
      return socket.emit("cardwars:error", "Sala de Card Wars indisponivel.");
    if (room.players.some(player => player.userId === socket.userId)) {
      resumeCardWarsPlayer(room, socket);
      return;
    }
    if (room.players.length >= 2)
      return socket.emit("cardwars:error", "Sala de Card Wars cheia.");

    const user = db.findUser("id", socket.userId);
    const player = onlinePlayers.get(socket.id);
    if (!user || Number(user.bet_credits || 0) < room.bet)
      return socket.emit("cardwars:error", "Creditos de aposta insuficientes.");
    if (player?.inGame)
      return socket.emit("cardwars:error", "Voce ja esta em uma partida.");

    room.players.push(makeCardWarsPlayer(socket, "guest"));
    room.status = "playing";
    room.message = `${socket.username} entrou. Abrindo Card Wars online.`;
    socket.join(roomId);
    setOnlineCardWars(socket.id, roomId);
    emitCardWarsUpdate(room);
    broadcastOnlineList();
    emitCardWarsLaunch(room);
  });

  socket.on("cardwars:resume", ({ roomId }) => {
    const room = cardWarsRooms.get(roomId);
    if (!room) return socket.emit("cardwars:cancelled", { message: "Sala de Card Wars encerrada." });
    const player = resumeCardWarsPlayer(room, socket);
    if (!player) return socket.emit("cardwars:error", "Voce nao faz parte desta sala de Card Wars.");
    socket.emit("cardwars:update", serializeCardWarsRoom(room, socket.id));
  });

  socket.on("cardwars:leave", ({ roomId }) => {
    const room = cardWarsRooms.get(roomId) || findCardWarsRoomBySocket(socket.id);
    if (!room) return;
    cancelCardWarsRoom(room, `${socket.username} saiu do Card Wars online.`);
  });

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

    const artilleryRoom = findArtilleryRoomBySocket(socket.id);
    if (artilleryRoom) {
      if (artilleryRoom.status === "waiting" && artilleryRoom.hostSocketId === socket.id) {
        cancelArtilleryRoom(artilleryRoom, `${socket.username} cancelou o Canhao Arena.`);
      } else {
        removeArtilleryPlayer(artilleryRoom, socket.id, `${socket.username} desconectou do Canhao Arena.`);
      }
    }

    const relicRoom = findRelicRoomBySocket(socket.id);
    if (relicRoom) {
      if (relicRoom.status === "waiting" && relicRoom.hostSocketId === socket.id) {
        cancelRelicRoom(relicRoom, `${socket.username} cancelou o Relic Rush.`);
      } else {
        removeRelicPlayer(relicRoom, socket.id, `${socket.username} desconectou do Relic Rush.`);
      }
    }

    const pirateRoom = findPirateRoomBySocket(socket.id);
    if (pirateRoom) {
      if (pirateRoom.status === "waiting" && pirateRoom.hostSocketId === socket.id) {
        cancelPirateRoom(pirateRoom, `${socket.username} cancelou o Pirate Bomb.`);
      } else {
        removePiratePlayer(pirateRoom, socket.id, `${socket.username} desconectou do Pirate Bomb.`);
      }
    }

    const cardWarsRoom = findCardWarsRoomBySocket(socket.id);
    if (cardWarsRoom) {
      markCardWarsDisconnected(cardWarsRoom, socket.id, `${socket.username} reconectando ao Card Wars.`);
    }

    const horrorRoom = findHorrorRoomBySocket(socket.id);
    if (horrorRoom) {
      removeHorrorPlayer(horrorRoom, socket.id, `${socket.username} desconectou da Casa Sombria.`);
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

    for (const [id, request] of pendingLoanRequests) {
      if (request.fromSocketId === socket.id || request.toSocketId === socket.id) {
        const notifySid = request.fromSocketId === socket.id ? request.toSocketId : request.fromSocketId;
        io.to(notifySid).emit("loan:cancelled", { requestId: id, username: socket.username });
        pendingLoanRequests.delete(id);
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
  if (game === "artillery") return artilleryRooms.get(roomId) || null;
  if (game === "relic") return relicRooms.get(roomId) || null;
  if (game === "pirate") return pirateRooms.get(roomId) || null;
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
    if (!user) continue;
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
