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

// ─── Config ────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET || "albumcopa_secret_mude_em_producao";
const SALT_ROUNDS = 10;
const DB_FILE     = path.join(__dirname, "db.json");
const DAILY_ALBUM_CREDITS = 30;
const INITIAL_BET_CREDITS = 350;
const MARKET_PRICES = {
  common: 10,
  rare: 20,
  legendary: 30
};

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// ─── Banco de dados JSON ───────────────────────────────────────────────────
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], matches: [], market_listings: [], nextUserId: 1, nextMatchId: 1, nextMarketId: 1 }));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
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
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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
  if (!user.duplicates || Array.isArray(user.duplicates) || typeof user.duplicates !== "object") {
    fields.duplicates = {};
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
    const { credits, bet_credits, stickers, duplicates, pending_stickers } = req.body || {};
    const fields = {
      credits:          Number(credits)     || 0,
      bet_credits:      Number(bet_credits) || 0,
      stickers:         Array.isArray(stickers)         ? stickers         : [],
      duplicates:       duplicates && typeof duplicates === "object" && !Array.isArray(duplicates) ? duplicates : {},
      pending_stickers: Array.isArray(pending_stickers) ? pending_stickers : []
    };
    db.updateUser(req.userId, fields);
    res.json({ ok: true });
  } catch (err) {
    console.error("[save] erro:", err);
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
    const { stickerId, rarity, code, name, image } = req.body || {};
    const id = Number(stickerId);
    const price = getMarketPrice(rarity);
    if (!id || !price) return res.status(400).json({ error: "Figurinha invalida para venda." });

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
      rarity,
      price,
      code: String(code || `FIG-${String(id).padStart(2, "0")}`),
      name: String(name || "Figurinha"),
      image: String(image || ""),
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

    const updatedSeller = safeUser(db.findUser("id", listing.seller_id));
    for (const [, player] of onlinePlayers) {
      if (player.userId === listing.seller_id) {
        io.to(player.socketId).emit("market:sold", {
          listing,
          updatedUser: updatedSeller
        });
      }
    }

    res.json({ ok: true, user: safeUser(db.findUser("id", req.userId)) });
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
  socket.on("game:taunt", ({ emoji }) => {
    const p = onlinePlayers.get(socket.id);
    if (p?.roomId) socket.to(p.roomId).emit("game:taunt", { emoji, from: socket.username });
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
  console.log(`\n🏟️  Servidor Álbum da Copa rodando em http://localhost:${PORT}\n`);
});
