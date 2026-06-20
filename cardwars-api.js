const crypto = require("crypto");

function setupCardWarsApiRoutes({
  app,
  authMiddleware,
  jwt,
  jwtSecret,
  verifyToken,
  db,
  io,
  getCardWarsRooms,
  getOnlinePlayers
}) {
  const legacyMatches = new Map();

  function text(value, fallback = "", maxLength = 300000) {
    const result = value === undefined || value === null ? fallback : String(value);
    return result.slice(0, maxLength);
  }

  function int(value, fallback = 0, min = 0, max = 999999) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function apiSession(req) {
    const token = text(req.body?.album_session || req.query?.album_session, "", 4000).trim();
    const payload = verifyToken(token);
    return payload?.scope === "cardwars" ? payload : null;
  }

  function apiAuth(req, res, next) {
    const session = apiSession(req);
    if (!session) return res.status(401).json({ success: false, error: "Card Wars nao autenticado" });
    const user = db.findUser("id", Number(session.id));
    if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
    req.cardWarsSession = session;
    req.cardWarsUser = user;
    next();
  }

  function route(handler) {
    return (req, res, next) => {
      try {
        return handler(req, res, next);
      } catch (error) {
        console.error("[cardwars-api]", error);
        if (!res.headersSent) res.status(500).json({ success: false, error: "Erro interno do Card Wars" });
      }
    };
  }

  function buildProfile(user, source = {}) {
    const previous = user?.cardwars_profile || {};
    return {
      name: user.username,
      icon: text(source.icon, previous.icon || user.avatar || "", 200),
      deck: text(source.deck, previous.deck || "", 1000000),
      deck_rank: Number(source.deck_rank ?? previous.deck_rank ?? 0) || 0,
      landscapes: text(source.landscapes, previous.landscapes || "{\"landscape\":[]}", 20000),
      leader: text(source.leader, previous.leader || "Leader_Jake", 120),
      leader_level: int(source.leader_level, int(previous.leader_level, 1, 1, 100), 1, 100),
      level: int(source.level, int(previous.level, 1, 1, 100), 1, 100),
      trophies: int(previous.trophies, 0),
      wins: int(previous.wins, 0),
      losses: int(previous.losses, 0),
      win_streak: int(previous.win_streak, 0, 0, 999),
      history: Array.isArray(previous.history) ? previous.history.slice(-40) : [],
      updated_at: new Date().toISOString()
    };
  }

  function publicProfile(user) {
    const profile = user?.cardwars_profile;
    if (!profile) return null;
    return {
      name: user.username,
      icon: profile.icon || user.avatar || "",
      leader: profile.leader || "Leader_Jake",
      level: int(profile.leader_level || profile.level, 1, 1, 100),
      trophies: int(profile.trophies, 0)
    };
  }

  function leaderboardRows() {
    return db.getCardWarsPlayers()
      .sort((a, b) => Number(b.profile.trophies || 0) - Number(a.profile.trophies || 0))
      .map((entry, index) => ({
        rank: index + 1,
        prev_rank: index + 1,
        player_name: entry.username,
        icon: entry.profile.icon || entry.avatar || "",
        leader: entry.profile.leader || "Leader_Jake",
        leader_level: int(entry.profile.leader_level, 1, 1, 100),
        trophies: int(entry.profile.trophies, 0),
        wins: int(entry.profile.wins, 0),
        losses: int(entry.profile.losses, 0)
      }));
  }

  function findOpponent(session, userId) {
    const players = db.getCardWarsPlayers().filter(entry => Number(entry.id) !== Number(userId));
    if (!players.length) return null;

    if (session.roomId) {
      const room = getCardWarsRooms().get(session.roomId);
      const opponent = room?.players.find(player => Number(player.userId) !== Number(userId));
      if (opponent) return players.find(entry => Number(entry.id) === Number(opponent.userId)) || null;
    }

    const onlineIds = new Set();
    for (const [, online] of getOnlinePlayers()) {
      if (Number(online.userId) !== Number(userId)) onlineIds.add(Number(online.userId));
    }
    const onlineCandidates = players.filter(entry => onlineIds.has(Number(entry.id)));
    const candidates = onlineCandidates.length ? onlineCandidates : players;
    return candidates[Math.floor(Math.random() * candidates.length)] || null;
  }

  function notifyUser(userId, eventName, payload) {
    for (const [, online] of getOnlinePlayers()) {
      if (Number(online.userId) === Number(userId)) io.to(online.socketId).emit(eventName, payload);
    }
  }

  function currentRank(username) {
    const index = leaderboardRows().findIndex(row => row.player_name === username);
    return index >= 0 ? index + 1 : 0;
  }

  app.post("/api/cardwars/session", authMiddleware, route((req, res) => {
    const user = db.findUser("id", req.userId);
    if (!user) return res.status(404).json({ error: "Usuario nao encontrado" });

    const roomId = text(req.body?.roomId, "", 180);
    if (roomId) {
      const room = getCardWarsRooms().get(roomId);
      const isParticipant = room?.players.some(player => Number(player.userId) === Number(req.userId));
      if (!room || !isParticipant) return res.status(403).json({ error: "Sala de Card Wars invalida" });
    }

    const session = jwt.sign({
      id: user.id,
      username: user.username,
      roomId: roomId || null,
      scope: "cardwars"
    }, jwtSecret, { expiresIn: "6h" });

    res.setHeader("Cache-Control", "no-store");
    res.json({ session, username: user.username, roomId: roomId || null });
  }));

  app.get("/multiplayer/player/:playerId", apiAuth, route((req, res) => {
    const profile = publicProfile(req.cardWarsUser);
    if (!profile) return res.status(404).json({ success: false, error: "Perfil Card Wars nao criado" });
    res.json(profile);
  }));

  app.post("/multiplayer/new_player/", apiAuth, route((req, res) => {
    const profile = buildProfile(req.cardWarsUser, req.body || {});
    const updated = db.updateUser(req.cardWarsUser.id, { cardwars_profile: profile });
    res.json({ success: true, data: publicProfile(updated) });
  }));

  app.post("/multiplayer/update_player/", apiAuth, route((req, res) => {
    const profile = buildProfile(req.cardWarsUser, req.body || {});
    db.updateUser(req.cardWarsUser.id, { cardwars_profile: profile });
    res.json({ success: true });
  }));

  app.post("/multiplayer/update_deck/", apiAuth, route((req, res) => {
    const profile = buildProfile(req.cardWarsUser, req.body || {});
    db.updateUser(req.cardWarsUser.id, { cardwars_profile: profile });
    res.json({ success: true });
  }));

  app.post("/multiplayer/matchmake/find/", apiAuth, route((req, res) => {
    const ownProfile = req.cardWarsUser.cardwars_profile;
    if (!ownProfile?.deck) return res.status(409).json({ success: false, error: "Crie seu perfil multiplayer primeiro" });

    const opponent = findOpponent(req.cardWarsSession, req.cardWarsUser.id);
    if (!opponent?.profile?.deck) {
      return res.status(404).json({ success: false, error: "Oponente ainda nao configurou o deck" });
    }

    const matchId = `cw-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    legacyMatches.set(matchId, {
      matchId,
      roomId: req.cardWarsSession.roomId || null,
      challengerId: req.cardWarsUser.id,
      opponentId: opponent.id,
      status: "ready",
      createdAt: new Date().toISOString(),
      completedAt: null,
      loss: null
    });

    res.json({
      match_id: matchId,
      name: opponent.username,
      icon: opponent.profile.icon || opponent.avatar || "",
      landscapes: opponent.profile.landscapes || "{\"landscape\":[]}",
      leader: opponent.profile.leader || "Leader_Jake",
      leader_level: int(opponent.profile.leader_level, 1, 1, 100),
      wager_win: 10,
      wager_lose: 5,
      streak: int(ownProfile.win_streak, 0, 0, 999),
      streak_bonus: Math.min(20, int(ownProfile.win_streak, 0, 0, 999) * 2),
      expiration_date: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
  }));

  app.post("/multiplayer/matchmake/start/", apiAuth, route((req, res) => {
    const matchId = text(req.body?.match_id, "", 180);
    const match = legacyMatches.get(matchId);
    if (!match || Number(match.challengerId) !== Number(req.cardWarsUser.id)) {
      return res.status(404).type("text/plain").send("match not found");
    }
    const opponent = db.findUser("id", Number(match.opponentId));
    const deck = opponent?.cardwars_profile?.deck;
    if (!deck) return res.status(404).type("text/plain").send("deck not found");
    match.status = "playing";
    res.type("text/plain").send(deck);
  }));

  app.post("/multiplayer/matchmake/complete/", apiAuth, route((req, res) => {
    const matchId = text(req.body?.match_id, "", 180);
    const match = legacyMatches.get(matchId);
    if (!match || Number(match.challengerId) !== Number(req.cardWarsUser.id)) {
      return res.status(404).json({ success: false, error: "Partida nao encontrada" });
    }

    const currentUser = db.findUser("id", req.cardWarsUser.id);
    const currentProfile = buildProfile(currentUser);
    if (match.status === "completed") {
      return res.json({ success: true, data: { trophies: currentProfile.trophies } });
    }

    const loss = ["1", "true", "yes"].includes(String(req.body?.loss || "").toLowerCase());
    const opponent = db.findUser("id", Number(match.opponentId));
    const opponentProfile = opponent?.cardwars_profile ? buildProfile(opponent) : null;
    const trophyDelta = loss ? -5 : 10;
    currentProfile.trophies = Math.max(0, currentProfile.trophies + trophyDelta);
    currentProfile.wins += loss ? 0 : 1;
    currentProfile.losses += loss ? 1 : 0;
    currentProfile.win_streak = loss ? 0 : currentProfile.win_streak + 1;
    currentProfile.history.push({
      opponent_id: opponent?.id || null,
      opponent_name: opponent?.username || "?",
      opponent_icon: opponentProfile?.icon || opponent?.avatar || "",
      won: !loss,
      outcome: trophyDelta,
      date: new Date().toISOString()
    });
    currentProfile.history = currentProfile.history.slice(-40);
    db.updateUser(currentUser.id, { cardwars_profile: currentProfile });

    if (opponent && opponentProfile) {
      const defenderDelta = loss ? 5 : -5;
      opponentProfile.trophies = Math.max(0, opponentProfile.trophies + defenderDelta);
      opponentProfile.wins += loss ? 1 : 0;
      opponentProfile.losses += loss ? 0 : 1;
      opponentProfile.history.push({
        opponent_id: currentUser.id,
        opponent_name: currentUser.username,
        opponent_icon: currentProfile.icon || currentUser.avatar || "",
        won: loss,
        outcome: defenderDelta,
        date: new Date().toISOString()
      });
      opponentProfile.history = opponentProfile.history.slice(-40);
      db.updateUser(opponent.id, { cardwars_profile: opponentProfile });
    }

    match.status = "completed";
    match.completedAt = new Date().toISOString();
    match.loss = loss;
    notifyUser(match.opponentId, "cardwars:battle-result", {
      opponentUsername: currentUser.username,
      won: loss,
      message: loss
        ? `${currentUser.username} perdeu para o seu deck no Card Wars.`
        : `${currentUser.username} venceu o seu deck no Card Wars.`
    });
    res.json({ success: true, data: { trophies: currentProfile.trophies } });
  }));

  app.get("/multiplayer/active_leaderboard/globalrank/", apiAuth, route((req, res) => {
    res.json({ success: true, data: { rank: currentRank(req.cardWarsUser.username) } });
  }));

  app.get("/multiplayer/active_leaderboard/rank/", apiAuth, route((req, res) => {
    res.json({ success: true, data: { rank: currentRank(req.cardWarsUser.username) } });
  }));

  app.get("/multiplayer/active_leaderboard/", apiAuth, route((req, res) => {
    res.json({ success: true, data: leaderboardRows().slice(0, 50) });
  }));

  app.get("/multiplayer/active_leaderboard/:playerId", apiAuth, route((req, res) => {
    const rows = leaderboardRows();
    const index = rows.findIndex(row => row.player_name === req.cardWarsUser.username);
    res.json({ success: true, data: index >= 0 ? rows.slice(Math.max(0, index - 5), index + 6) : rows.slice(0, 10) });
  }));

  app.get("/multiplayer/player_record/:playerId", apiAuth, route((req, res) => {
    const user = req.cardWarsUser;
    const history = Array.isArray(user.cardwars_profile?.history) ? user.cardwars_profile.history : [];
    res.json({
      success: true,
      data: history.slice().reverse().map(entry => ({
        defender_name: entry.opponent_name || "?",
        defender_icon: entry.opponent_icon || "",
        attacker_name: user.username,
        attacker_icon: user.cardwars_profile?.icon || user.avatar || "",
        attacker_won: Boolean(entry.won),
        outcome: int(Math.abs(entry.outcome), 0),
        date: entry.date || new Date().toISOString()
      }))
    });
  }));

  app.get("/multiplayer/record/:target", apiAuth, route((req, res) => {
    const history = Array.isArray(req.cardWarsUser.cardwars_profile?.history)
      ? req.cardWarsUser.cardwars_profile.history
      : [];
    res.json({
      success: true,
      data: history.slice().reverse().map(entry => ({
        name: entry.opponent_name || "?",
        icon: entry.opponent_icon || "",
        outcome: int(Math.abs(entry.outcome), 0),
        won: Boolean(entry.won),
        date: entry.date || new Date().toISOString()
      }))
    });
  }));

  app.post("/multiplayer/record/recent/", apiAuth, route((req, res) => {
    const profile = req.cardWarsUser.cardwars_profile || {};
    res.json({
      success: true,
      data: {
        wins: int(profile.wins, 0),
        losses: int(profile.losses, 0),
        rank: currentRank(req.cardWarsUser.username)
      }
    });
  }));

  app.get("/multiplayer/tournament/expiration/", apiAuth, route((req, res) => {
    res.json({
      success: true,
      data: { tournament_id: 1, time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
    });
  }));
}

module.exports = { setupCardWarsApiRoutes };
