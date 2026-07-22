const BRASFOOT_PUBLIC_LEAGUE_ID = "album-copa-brasfoot";
const BRASFOOT_ALLOWED_FORMATIONS = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "4-4-1-1", "3-4-3"];
const BRASFOOT_MENTALITIES = ["defensive", "balanced", "offensive"];
const BRASFOOT_DEFAULT_CLUBS = [
  ["Litoral FC", "LIT", "Arena Litoral"],
  ["Vila Verde", "VVE", "Estadio da Vila"],
  ["Atletico Album", "ALB", "Estadio das Figurinhas"],
  ["Real Baixada", "RBA", "Campo da Baixada"],
  ["Uniao Praiana", "UPR", "Parque Praiano"],
  ["Nacional Norte", "NNO", "Estadio Nacional"],
  ["Estrela Azul", "EAZ", "Arena Azul"],
  ["Serrano SC", "SER", "Vale Serrano"],
  ["Porto Clube", "POR", "Cais do Porto"],
  ["Cidade Alta", "CAL", "Municipal Alta"],
  ["Ferroviario Sul", "FSU", "Estacao Sul"],
  ["Santa Arena", "SAR", "Campo Santa Arena"]
];
const BRASFOOT_PLAYER_FIRST_NAMES = [
  "Rafael", "Caio", "Bruno", "Diego", "Lucas", "Andre", "Marcos", "Igor", "Leandro", "Vitor",
  "Matheus", "Renan", "Thiago", "Felipe", "Daniel", "Gustavo", "Pablo", "Cesar"
];
const BRASFOOT_PLAYER_LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Costa", "Pereira", "Almeida", "Rocha", "Moura", "Barros", "Lima",
  "Ribeiro", "Cardoso", "Teixeira", "Nunes", "Araujo", "Vieira", "Campos", "Souza"
];
const BRASFOOT_POSITIONS = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "GK", "CB", "CM", "RW", "LW", "ST"];

function brasfootDefaultTactic(formation = "4-4-2") {
  return {
    formation,
    mentality: "balanced",
    pressing: 50,
    width: 50,
    tempo: 50
  };
}

function nextBrasfootId(state, key, prefix) {
  const current = Math.max(1, Math.floor(Number(state[key] || 1)));
  state[key] = current + 1;
  return `${prefix}-${current}`;
}

function createBrasfootLeague(state, options = {}) {
  const now = new Date().toISOString();
  const clubCount = Math.max(2, Math.min(40, Math.floor(Number(options.clubCount || BRASFOOT_DEFAULT_CLUBS.length))));
  const league = {
    id: options.id || nextBrasfootId(state, "nextLeagueId", "bf-league"),
    name: String(options.name || "Liga Brasfoot Album Copa").trim(),
    country: String(options.country || "Brazil").trim(),
    tier: Math.max(1, Math.floor(Number(options.tier || 1))),
    isPrivate: Boolean(options.isPrivate),
    ownerId: options.ownerId == null ? null : String(options.ownerId),
    createdAt: now
  };
  state.leagues.push(league);

  for (let i = 0; i < clubCount; i += 1) {
    const template = BRASFOOT_DEFAULT_CLUBS[i % BRASFOOT_DEFAULT_CLUBS.length];
    const suffix = i >= BRASFOOT_DEFAULT_CLUBS.length ? ` ${Math.floor(i / BRASFOOT_DEFAULT_CLUBS.length) + 1}` : "";
    const clubId = nextBrasfootId(state, "nextClubId", "bf-club");
    const reputation = 48 + ((i * 7) % 45);
    state.clubs.push({
      id: clubId,
      userId: null,
      leagueId: league.id,
      name: `${template[0]}${suffix}`,
      shortName: `${template[1]}${suffix ? String(i + 1).slice(-1) : ""}`.slice(0, 5),
      stadiumName: template[2],
      stadiumCapacity: 12000 + (i * 1800),
      balance: 900000 + (reputation * 18000),
      reputation,
      formation: "4-4-2",
      tacticStyle: brasfootDefaultTactic("4-4-2"),
      createdAt: now
    });

    for (let p = 0; p < BRASFOOT_POSITIONS.length; p += 1) {
      const overall = Math.max(45, Math.min(90, reputation - 12 + ((p * 5 + i * 3) % 24)));
      const potential = Math.min(94, overall + 4 + ((p + i) % 9));
      state.players.push({
        id: nextBrasfootId(state, "nextPlayerId", "bf-player"),
        clubId,
        name: `${BRASFOOT_PLAYER_FIRST_NAMES[(i + p) % BRASFOOT_PLAYER_FIRST_NAMES.length]} ${BRASFOOT_PLAYER_LAST_NAMES[(i * 2 + p) % BRASFOOT_PLAYER_LAST_NAMES.length]}`,
        position: BRASFOOT_POSITIONS[p],
        overall,
        potential,
        morale: 70 + ((i + p) % 25),
        fitness: 76 + ((i * 3 + p) % 20),
        marketValue: 90000 + overall * 14000 + potential * 6500,
        createdAt: now
      });
    }
  }

  return league;
}

function ensureBrasfootData(data) {
  let changed = false;
  if (!data.brasfoot || typeof data.brasfoot !== "object" || Array.isArray(data.brasfoot)) {
    data.brasfoot = {};
    changed = true;
  }

  const state = data.brasfoot;
  ["leagues", "clubs", "players", "listings", "bids"].forEach((key) => {
    if (!Array.isArray(state[key])) {
      state[key] = [];
      changed = true;
    }
  });
  ["nextLeagueId", "nextClubId", "nextPlayerId", "nextListingId", "nextBidId"].forEach((key) => {
    if (!Number.isFinite(Number(state[key]))) {
      state[key] = 1;
      changed = true;
    }
  });

  state.clubs.forEach((club) => {
    if (club && club.userId === undefined) {
      club.userId = null;
      changed = true;
    }
    if (club && !BRASFOOT_ALLOWED_FORMATIONS.includes(club.formation)) {
      club.formation = "4-4-2";
      changed = true;
    }
    if (club && (!club.tacticStyle || typeof club.tacticStyle !== "object")) {
      club.tacticStyle = brasfootDefaultTactic(club.formation);
      changed = true;
    }
  });

  if (!state.leagues.some((league) => league && league.id === BRASFOOT_PUBLIC_LEAGUE_ID)) {
    createBrasfootLeague(state, {
      id: BRASFOOT_PUBLIC_LEAGUE_ID,
      name: "Liga Brasfoot Album Copa",
      country: "Brazil",
      tier: 1,
      clubCount: BRASFOOT_DEFAULT_CLUBS.length
    });
    changed = true;
  }

  return changed;
}

function serializeUser(user) {
  return {
    id: String(user.id),
    email: `${String(user.username || "usuario").replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase()}@album.local`,
    username: user.username || `Usuario ${user.id}`
  };
}

function serializeLeague(league) {
  return {
    id: league.id,
    name: league.name,
    country: league.country || "Brazil",
    tier: Math.max(1, Math.floor(Number(league.tier || 1))),
    isPrivate: Boolean(league.isPrivate)
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    overall: Math.max(1, Math.floor(Number(player.overall || 1))),
    potential: Math.max(1, Math.floor(Number(player.potential || player.overall || 1))),
    morale: Math.max(0, Math.floor(Number(player.morale || 0))),
    fitness: Math.max(0, Math.floor(Number(player.fitness || 0))),
    marketValue: String(Math.max(0, Math.floor(Number(player.marketValue || 0))))
  };
}

function serializeClub(club, state, includePlayers = false) {
  const payload = {
    id: club.id,
    userId: club.userId == null ? null : String(club.userId),
    leagueId: club.leagueId || null,
    name: club.name,
    shortName: club.shortName,
    stadiumName: club.stadiumName || "Estadio Municipal",
    stadiumCapacity: Math.max(1000, Math.floor(Number(club.stadiumCapacity || 1000))),
    balance: String(Math.max(0, Math.floor(Number(club.balance || 0)))),
    reputation: Math.max(1, Math.floor(Number(club.reputation || 1))),
    formation: BRASFOOT_ALLOWED_FORMATIONS.includes(club.formation) ? club.formation : "4-4-2",
    tacticStyle: club.tacticStyle || brasfootDefaultTactic(club.formation)
  };

  if (includePlayers) {
    payload.players = state.players.filter((player) => player.clubId === club.id).map(serializePlayer);
  }

  return payload;
}

function findClubById(state, clubId) {
  return state.clubs.find((club) => club && club.id === String(clubId || "")) || null;
}

function findClubByUser(state, userId) {
  return state.clubs.find((club) => club && String(club.userId || "") === String(userId)) || null;
}

function findLeagueById(state, leagueId) {
  return state.leagues.find((league) => league && league.id === String(leagueId || "")) || null;
}

function refreshListings(state) {
  let changed = false;
  const now = Date.now();
  state.listings.forEach((listing) => {
    if (listing.status === "OPEN" && Date.parse(listing.endsAt || "") <= now) {
      listing.status = "EXPIRED";
      changed = true;
    }
  });
  return changed;
}

function serializeListing(listing, state, includeBids = false) {
  const player = state.players.find((item) => item.id === listing.playerId);
  const sellerClub = state.clubs.find((item) => item.id === listing.sellerClubId);
  if (!player || !sellerClub) return null;

  const payload = {
    id: listing.id,
    status: listing.status || "OPEN",
    startingPrice: String(Math.max(0, Math.floor(Number(listing.startingPrice || 0)))),
    buyNowPrice: listing.buyNowPrice == null ? null : String(Math.max(0, Math.floor(Number(listing.buyNowPrice || 0)))),
    currentBid: listing.currentBid == null ? null : String(Math.max(0, Math.floor(Number(listing.currentBid || 0)))),
    currentBidderClubId: listing.currentBidderClubId || null,
    endsAt: listing.endsAt,
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      overall: Math.max(1, Math.floor(Number(player.overall || 1))),
      potential: Math.max(1, Math.floor(Number(player.potential || player.overall || 1)))
    },
    sellerClub: {
      id: sellerClub.id,
      name: sellerClub.name,
      shortName: sellerClub.shortName
    }
  };

  if (includeBids) {
    payload.bids = state.bids
      .filter((bid) => bid.listingId === listing.id)
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .map((bid) => {
        const bidderClub = state.clubs.find((club) => club.id === bid.bidderClubId);
        return {
          id: bid.id,
          amount: String(Math.max(0, Math.floor(Number(bid.amount || 0)))),
          createdAt: bid.createdAt,
          bidderClub: {
            id: bidderClub?.id || bid.bidderClubId,
            name: bidderClub?.name || "Clube"
          }
        };
      });
  }

  return payload;
}

function parseUsername(body) {
  const raw = String(body?.username || body?.email || "").trim();
  return raw.includes("@") ? raw.split("@")[0].trim() : raw;
}

function setupBrasfootFallbackApi({
  app,
  authMiddleware,
  bcrypt,
  signToken,
  db,
  loadDb,
  saveDb,
  normalizeUserProgress,
  saltRounds
}) {
  function withState(mutator, shouldSave = false) {
    const data = loadDb();
    const seeded = ensureBrasfootData(data);
    const result = mutator(data.brasfoot, data);
    if (seeded || shouldSave) saveDb(data);
    return result;
  }

  function getAuthedUser(req, res) {
    const user = normalizeUserProgress(db.findUser("id", req.userId));
    if (!user) {
      res.status(404).json({ error: "Usuario nao encontrado" });
      return null;
    }
    return user;
  }

  function ensureRoomLeague(roomId, ownerId = null, ownerUsername = "") {
    const cleanRoomId = String(roomId || "").trim();
    if (!cleanRoomId || !cleanRoomId.startsWith("brasfoot-")) return null;

    return withState((state) => {
      const existing = findLeagueById(state, cleanRoomId);
      if (existing) return existing;
      return createBrasfootLeague(state, {
        id: cleanRoomId,
        name: ownerUsername ? `Sala de ${ownerUsername}` : "Sala Brasfoot Online",
        country: "Brazil",
        tier: 1,
        isPrivate: true,
        ownerId,
        clubCount: 12
      });
    }, true);
  }

  app.post("/api/brasfoot/auth/register", async (req, res) => {
    try {
      const username = parseUsername(req.body);
      const { password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "Usuario e senha obrigatorios" });
      if (username.length < 3 || username.length > 20) return res.status(400).json({ error: "Usuario: 3 a 20 caracteres" });
      if (!/^[a-zA-Z0-9 _-]+$/.test(username)) return res.status(400).json({ error: "Usuario: use letras, numeros, espaco, _ ou -" });
      if (String(password).length < 6) return res.status(400).json({ error: "Senha minimo 6 caracteres" });
      if (db.findUser("username", username)) return res.status(409).json({ error: "Usuario ja existe" });

      const hash = await bcrypt.hash(String(password), saltRounds);
      const user = db.createUser(username, hash);
      res.status(201).json({ token: signToken(user), user: serializeUser(user) });
    } catch (err) {
      console.error("[brasfoot:register] erro:", err);
      res.status(500).json({ error: "Erro interno ao criar conta" });
    }
  });

  app.post("/api/brasfoot/auth/login", async (req, res) => {
    try {
      const username = parseUsername(req.body);
      const { password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "Usuario e senha obrigatorios" });
      const user = db.findUser("username", username);
      const ok = user ? await bcrypt.compare(String(password), user.password_hash) : false;
      if (!user || !ok) return res.status(401).json({ error: "Usuario ou senha invalidos" });
      res.json({ token: signToken(user), user: serializeUser(user) });
    } catch (err) {
      console.error("[brasfoot:login] erro:", err);
      res.status(500).json({ error: "Erro interno ao fazer login" });
    }
  });

  app.get("/api/brasfoot/auth/me", authMiddleware, (req, res) => {
    const user = getAuthedUser(req, res);
    if (!user) return;
    res.json({ user: serializeUser(user) });
  });

  app.get("/api/brasfoot/leagues", (_req, res) => {
    try {
      const data = loadDb();
      const changed = ensureBrasfootData(data) || refreshListings(data.brasfoot);
      if (changed) saveDb(data);
      res.json({
        leagues: data.brasfoot.leagues
          .filter((league) => !league.isPrivate)
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map(serializeLeague)
      });
    } catch (err) {
      console.error("[brasfoot:leagues] erro:", err);
      res.status(500).json({ error: "Erro ao carregar ligas" });
    }
  });

  app.post("/api/brasfoot/leagues", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const name = String(req.body?.name || "").trim();
      const clubCount = Math.floor(Number(req.body?.clubCount || 10));
      if (name.length < 3) return res.status(400).json({ error: "name must be at least 3 characters" });
      if (!Number.isInteger(clubCount) || clubCount < 2 || clubCount > 40) {
        return res.status(400).json({ error: "clubCount must be an integer between 2 and 40" });
      }

      const league = withState((state) => createBrasfootLeague(state, {
        name,
        country: "Brazil",
        tier: 1,
        isPrivate: true,
        ownerId: user.id,
        clubCount
      }), true);

      res.status(201).json({
        id: league.id,
        name: league.name,
        country: league.country,
        clubCount
      });
    } catch (err) {
      console.error("[brasfoot:create-league] erro:", err);
      res.status(500).json({ error: "Erro ao criar sala" });
    }
  });

  app.get("/api/brasfoot/leagues/:leagueId", (req, res) => {
    try {
      const leagueId = String(req.params.leagueId || "");
      const league = leagueId.startsWith("brasfoot-")
        ? ensureRoomLeague(leagueId)
        : withState((state) => findLeagueById(state, leagueId));
      if (!league) return res.status(404).json({ error: "League not found" });
      res.json(serializeLeague(league));
    } catch (err) {
      console.error("[brasfoot:league] erro:", err);
      res.status(500).json({ error: "Erro ao carregar liga" });
    }
  });

  app.get("/api/brasfoot/leagues/:leagueId/clubs", (req, res) => {
    try {
      const leagueId = String(req.params.leagueId || "");
      if (leagueId.startsWith("brasfoot-")) ensureRoomLeague(leagueId);
      const payload = withState((state) => ({
        clubs: state.clubs
          .filter((club) => club.leagueId === leagueId)
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((club) => ({
            id: club.id,
            name: club.name,
            shortName: club.shortName,
            reputation: Math.max(1, Math.floor(Number(club.reputation || 1))),
            isClaimed: club.userId != null
          }))
      }));
      res.json(payload);
    } catch (err) {
      console.error("[brasfoot:league-clubs] erro:", err);
      res.status(500).json({ error: "Erro ao carregar clubes" });
    }
  });

  app.get("/api/brasfoot/leagues/:leagueId/standings", (req, res) => {
    try {
      const leagueId = String(req.params.leagueId || "");
      const payload = withState((state) => ({
        seasonId: `${leagueId}-season`,
        standings: state.clubs
          .filter((club) => club.leagueId === leagueId)
          .sort((a, b) => Number(b.reputation || 0) - Number(a.reputation || 0))
          .map((club, index) => ({
            clubId: club.id,
            clubName: club.name,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            points: Math.max(0, 20 - index)
          }))
      }));
      res.json(payload);
    } catch (err) {
      console.error("[brasfoot:standings] erro:", err);
      res.status(500).json({ error: "Erro ao carregar tabela" });
    }
  });

  app.get("/api/brasfoot/clubs/mine", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        const club = findClubByUser(state, user.id);
        return club ? serializeClub(club, state, true) : null;
      });
      if (!payload) return res.status(404).json({ error: "You do not manage a club yet" });
      res.json(payload);
    } catch (err) {
      console.error("[brasfoot:mine] erro:", err);
      res.status(500).json({ error: "Erro ao carregar clube" });
    }
  });

  app.get("/api/brasfoot/clubs/:clubId", (req, res) => {
    try {
      const payload = withState((state) => {
        const club = findClubById(state, req.params.clubId);
        return club ? serializeClub(club, state, true) : null;
      });
      if (!payload) return res.status(404).json({ error: "Club not found" });
      res.json(payload);
    } catch (err) {
      console.error("[brasfoot:club] erro:", err);
      res.status(500).json({ error: "Erro ao carregar clube" });
    }
  });

  app.post("/api/brasfoot/clubs/:clubId/claim", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        const club = findClubById(state, req.params.clubId);
        if (!club) return { status: 404, error: "Club not found" };
        const mine = findClubByUser(state, user.id);
        if (mine && mine.id !== club.id) return { status: 409, error: "You already manage a club" };
        if (club.userId != null && String(club.userId) !== String(user.id)) {
          return { status: 409, error: "Club already has an owner" };
        }
        club.userId = String(user.id);
        return { club: serializeClub(club, state, true) };
      }, true);
      if (payload.error) return res.status(payload.status).json({ error: payload.error });
      res.json(payload.club);
    } catch (err) {
      console.error("[brasfoot:claim] erro:", err);
      res.status(500).json({ error: "Erro ao reivindicar clube" });
    }
  });

  app.patch("/api/brasfoot/clubs/:clubId", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        const club = findClubById(state, req.params.clubId);
        if (!club) return { status: 404, error: "Club not found" };
        if (String(club.userId || "") !== String(user.id)) return { status: 403, error: "You do not own this club" };

        const { formation, tacticStyle } = req.body || {};
        if (formation !== undefined) {
          if (typeof formation !== "string" || !BRASFOOT_ALLOWED_FORMATIONS.includes(formation)) {
            return { status: 400, error: `formation must be one of: ${BRASFOOT_ALLOWED_FORMATIONS.join(", ")}` };
          }
          club.formation = formation;
        }
        if (tacticStyle !== undefined) {
          const merged = {
            ...brasfootDefaultTactic(club.formation),
            ...(club.tacticStyle || {}),
            ...tacticStyle,
            formation: club.formation
          };
          if (!BRASFOOT_MENTALITIES.includes(merged.mentality)) {
            return { status: 400, error: `tacticStyle.mentality must be one of: ${BRASFOOT_MENTALITIES.join(", ")}` };
          }
          for (const key of ["pressing", "width", "tempo"]) {
            const value = Number(merged[key]);
            if (!Number.isInteger(value) || value < 0 || value > 100) {
              return { status: 400, error: "tacticStyle.pressing/width/tempo must be integers 0-100" };
            }
            merged[key] = value;
          }
          club.tacticStyle = merged;
        }
        if (!club.tacticStyle) club.tacticStyle = brasfootDefaultTactic(club.formation);
        return { club: serializeClub(club, state, true) };
      }, true);
      if (payload.error) return res.status(payload.status).json({ error: payload.error });
      res.json(payload.club);
    } catch (err) {
      console.error("[brasfoot:update-club] erro:", err);
      res.status(500).json({ error: "Erro ao salvar tatica" });
    }
  });

  app.get("/api/brasfoot/market/listings", (req, res) => {
    try {
      const data = loadDb();
      const changed = ensureBrasfootData(data) || refreshListings(data.brasfoot);
      if (changed) saveDb(data);
      const status = String(req.query.status || "OPEN");
      const sellerClubId = typeof req.query.sellerClubId === "string" ? req.query.sellerClubId : "";
      res.json({
        listings: data.brasfoot.listings
          .filter((listing) => listing.status === status)
          .filter((listing) => !sellerClubId || listing.sellerClubId === sellerClubId)
          .sort((a, b) => Date.parse(a.endsAt || "") - Date.parse(b.endsAt || ""))
          .map((listing) => serializeListing(listing, data.brasfoot))
          .filter(Boolean)
      });
    } catch (err) {
      console.error("[brasfoot:market-list] erro:", err);
      res.status(500).json({ error: "Erro ao carregar mercado" });
    }
  });

  app.get("/api/brasfoot/market/listings/:id", (req, res) => {
    try {
      const payload = withState((state) => {
        const listing = state.listings.find((item) => item.id === req.params.id);
        return listing ? serializeListing(listing, state, true) : null;
      });
      if (!payload) return res.status(404).json({ error: "Listing not found" });
      res.json(payload);
    } catch (err) {
      console.error("[brasfoot:market-item] erro:", err);
      res.status(500).json({ error: "Erro ao carregar listagem" });
    }
  });

  app.post("/api/brasfoot/market/listings", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        const sellerClub = findClubByUser(state, user.id);
        if (!sellerClub) return { status: 404, error: "You do not manage a club yet" };
        const playerId = String(req.body?.playerId || "");
        const player = state.players.find((item) => item.id === playerId);
        if (!player || player.clubId !== sellerClub.id) return { status: 403, error: "You do not own this player" };
        if (state.listings.some((item) => item.playerId === playerId && item.status === "OPEN")) {
          return { status: 409, error: "This player already has an open listing" };
        }
        const startingPrice = Number(req.body?.startingPrice);
        const buyNowPrice = req.body?.buyNowPrice === undefined || req.body?.buyNowPrice === null ? null : Number(req.body.buyNowPrice);
        const durationHours = Math.floor(Number(req.body?.durationHours));
        if (!Number.isFinite(startingPrice) || startingPrice <= 0) return { status: 400, error: "startingPrice must be a positive number" };
        if (buyNowPrice != null && (!Number.isFinite(buyNowPrice) || buyNowPrice < startingPrice)) {
          return { status: 400, error: "buyNowPrice must be a number >= startingPrice" };
        }
        if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168) {
          return { status: 400, error: "durationHours must be an integer between 1 and 168" };
        }
        const listing = {
          id: nextBrasfootId(state, "nextListingId", "bf-listing"),
          status: "OPEN",
          playerId,
          sellerClubId: sellerClub.id,
          startingPrice: Math.floor(startingPrice),
          buyNowPrice: buyNowPrice == null ? null : Math.floor(buyNowPrice),
          currentBid: null,
          currentBidderClubId: null,
          endsAt: new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString()
        };
        state.listings.push(listing);
        return { listing: serializeListing(listing, state) };
      }, true);
      if (payload.error) return res.status(payload.status).json({ error: payload.error });
      res.status(201).json(payload.listing);
    } catch (err) {
      console.error("[brasfoot:market-create] erro:", err);
      res.status(500).json({ error: "Erro ao listar jogador" });
    }
  });

  app.post("/api/brasfoot/market/listings/:id/bids", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        refreshListings(state);
        const listing = state.listings.find((item) => item.id === req.params.id);
        if (!listing) return { status: 404, error: "Listing not found" };
        if (listing.status !== "OPEN") return { status: 409, error: "Listing is not open" };
        const bidderClub = findClubByUser(state, user.id);
        if (!bidderClub) return { status: 404, error: "You do not manage a club yet" };
        if (bidderClub.id === listing.sellerClubId) return { status: 400, error: "You cannot bid on your own listing" };
        const amount = Math.floor(Number(req.body?.amount));
        const currentPrice = Number(listing.currentBid || listing.startingPrice || 0);
        if (!Number.isFinite(amount) || amount <= currentPrice) {
          return { status: 400, error: `Bid must be greater than the current price (${currentPrice})` };
        }
        if (Number(bidderClub.balance || 0) < amount) return { status: 400, error: "Insufficient balance" };
        listing.currentBid = amount;
        listing.currentBidderClubId = bidderClub.id;
        state.bids.push({
          id: nextBrasfootId(state, "nextBidId", "bf-bid"),
          listingId: listing.id,
          bidderClubId: bidderClub.id,
          amount,
          createdAt: new Date().toISOString()
        });

        if (listing.buyNowPrice != null && amount >= Number(listing.buyNowPrice)) {
          const sellerClub = findClubById(state, listing.sellerClubId);
          const player = state.players.find((item) => item.id === listing.playerId);
          if (sellerClub && player) {
            sellerClub.balance = Number(sellerClub.balance || 0) + amount;
            bidderClub.balance = Number(bidderClub.balance || 0) - amount;
            player.clubId = bidderClub.id;
            listing.status = "SOLD";
          }
        }

        return { listing: serializeListing(listing, state) };
      }, true);
      if (payload.error) return res.status(payload.status).json({ error: payload.error });
      res.json(payload.listing);
    } catch (err) {
      console.error("[brasfoot:market-bid] erro:", err);
      res.status(500).json({ error: "Erro ao dar lance" });
    }
  });

  app.delete("/api/brasfoot/market/listings/:id", authMiddleware, (req, res) => {
    try {
      const user = getAuthedUser(req, res);
      if (!user) return;
      const payload = withState((state) => {
        const listing = state.listings.find((item) => item.id === req.params.id);
        if (!listing) return { status: 404, error: "Listing not found" };
        const club = findClubByUser(state, user.id);
        if (!club || club.id !== listing.sellerClubId) return { status: 403, error: "You do not own this listing" };
        if (listing.currentBid != null) return { status: 409, error: "Cannot cancel a listing that already has bids" };
        listing.status = "CANCELLED";
        return { ok: true };
      }, true);
      if (payload.error) return res.status(payload.status).json({ error: payload.error });
      res.status(204).send();
    } catch (err) {
      console.error("[brasfoot:market-delete] erro:", err);
      res.status(500).json({ error: "Erro ao cancelar listagem" });
    }
  });

  return { ensureRoomLeague };
}

module.exports = { setupBrasfootFallbackApi };
