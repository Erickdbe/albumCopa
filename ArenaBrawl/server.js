"use strict";

// Arena Brawl - FPS multiplayer .io original de navegador.
// Stack: Node.js + Express + Socket.io + Three.js (sem build step no cliente).

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createRoomsModule } = require("./server/rooms");
const config = require("./server/config");

const PORT = process.env.PORT || 3300;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.use("/node_modules/three", express.static(path.join(__dirname, "node_modules/three")));
app.use("/ArenaBrawl/vendor/three", express.static(path.join(__dirname, "..", "node_modules", "three")));
app.use("/ArenaBrawl/vendor/postprocessing", express.static(path.join(__dirname, "..", "node_modules", "postprocessing")));

app.get("/config", (req, res) => {
  res.json({
    classes: config.CLASSES,
    secondaryWeapons: config.SECONDARY_WEAPONS,
    grenades: config.GRENADES,
    mapMeta: config.MAP_META,
    durations: config.MATCH_DURATIONS_MIN,
    scoreLimits: config.SCORE_LIMITS,
    defaultSettings: config.DEFAULT_SETTINGS
  });
});

const roomsModule = createRoomsModule(io);

io.on("connection", (socket) => {
  socket.username = "Jogador";
  roomsModule.bindSocket(socket);
});

server.listen(PORT, () => {
  console.log(`\n🎮  Arena Brawl rodando em http://localhost:${PORT}\n`);
});
