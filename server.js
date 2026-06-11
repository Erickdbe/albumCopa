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

// ─── Banco de dados JSON ───────────────────────────────────────────────────
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], matches: [], nextUserId: 1, nextMatchId: 1 }));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
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
      credits:          100,
      bet_credits:      50,
      stickers:         [],
      pending_stickers: [],
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
  res.sendFile(path.join(__dirname, "albumCopa.html"));
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

    const user = db.findUser("username", username.trim());
    if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Usuário ou senha inválidos" });

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
    const user = db.findUser("id", req.userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json(safeUser(user));
  } catch (err) {
    console.error("[me] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Salvar progresso ────────────────────────────────────────────────
app.post("/api/save", authMiddleware, (req, res) => {
  try {
    const { credits, bet_credits, stickers, pending_stickers } = req.body || {};
    db.updateUser(req.userId, {
      credits:          Number(credits)     || 0,
      bet_credits:      Number(bet_credits) || 0,
      stickers:         Array.isArray(stickers)         ? stickers         : [],
      pending_stickers: Array.isArray(pending_stickers) ? pending_stickers : []
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[save] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST: Histórico de partidas ───────────────────────────────────────────
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

io.use((socket, next) => {
  const token   = socket.handshake.auth.token;
  const payload = verifyToken(token);
  if (!payload) return next(new Error("Não autenticado"));
  socket.userId   = payload.id;
  socket.username = payload.username;
  next();
});

io.on("connection", (socket) => {
  console.log(`[+] ${socket.username} conectado`);

  onlinePlayers.set(socket.id, {
    socketId: socket.id,
    userId:   socket.userId,
    username: socket.username,
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

  // ── Jogo em tempo real ─────────────────────────────────────────────────
  socket.on("game:state", (state) => {
    const p = onlinePlayers.get(socket.id);
    if (p?.roomId) socket.to(p.roomId).emit("game:state", state);
  });

  socket.on("game:input", (inputs) => {
    const p = onlinePlayers.get(socket.id);
    if (p?.roomId) socket.to(p.roomId).emit("game:input", inputs);
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

  // ── Desconexão ─────────────────────────────────────────────────────────
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

function broadcastOnlineList() {
  const list = [];
  for (const [, p] of onlinePlayers) {
    list.push({ socketId: p.socketId, username: p.username, inGame: p.inGame });
  }
  io.emit("online:list", list);
}

// ─── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🏟️  Servidor Álbum da Copa rodando em http://localhost:${PORT}\n`);
});
