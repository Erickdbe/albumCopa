const netcodes = require("./RetroArena/public/js/netplay-server");

const ROOM_TTL_MS = 20 * 60 * 1000;
const ROOM_PATTERN = /^[A-Z0-9]{3,8}$/;
const eventName = (code) => `retro-arena:net:${code}`;

function normalizeRoomId(value) {
  const roomId = String(value || "").trim().toUpperCase();
  return ROOM_PATTERN.test(roomId) ? roomId : "";
}

function createRetroArenaModule(io) {
  const lobbies = new Map();
  const socketRooms = new Map();
  const netplayServer = new netcodes.NetplayServer({
    logLevel: 0,
    roomTimeLimit: ROOM_TTL_MS,
    netcodes,
    sendToPlayer(socket, type, data) {
      socket.emit(eventName(type), data);
    }
  });

  function bindSocket(socket) {
    socket.on("retro-arena:open", ({ roomId } = {}) => {
      const normalized = normalizeRoomId(roomId);
      if (!normalized) return socket.emit("retro-arena:error", "Codigo de sala invalido.");

      const current = lobbies.get(normalized);
      if (!current || current.hostUserId === socket.userId) {
        const sameHostConnection = current?.hostSocketId === socket.id;
        lobbies.set(normalized, {
          roomId: normalized,
          hostUserId: socket.userId,
          hostUsername: socket.username,
          hostSocketId: socket.id,
          hostJoined: Boolean(sameHostConnection && current?.hostJoined),
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      socket.emit("retro-arena:ready", { roomId: normalized, isHost: true });
      for (const client of io.sockets.sockets.values()) {
        if (client.userId === socket.userId) continue;
        client.emit("retro-arena:invite", {
          roomId: normalized,
          fromUsername: socket.username,
          maxPlayers: 4
        });
      }
    });

    socket.on(eventName(netcodes.NETCODE_JOINROOM), (data = []) => {
      const roomId = normalizeRoomId(data[0]);
      if (!roomId) return socket.emit("retro-arena:error", "Sala invalida.");

      let lobby = lobbies.get(roomId);
      if (!lobby) {
        lobby = {
          roomId,
          hostUserId: socket.userId,
          hostUsername: socket.username,
          hostSocketId: socket.id,
          hostJoined: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        lobbies.set(roomId, lobby);
      }

      if (lobby.hostSocketId && !io.sockets.sockets.has(lobby.hostSocketId)) lobby.hostJoined = false;
      if (!lobby.hostJoined && lobby.hostUserId !== socket.userId) return;
      if (lobby.hostUserId === socket.userId) {
        lobby.hostJoined = true;
        lobby.hostSocketId = socket.id;
      }
      lobby.updatedAt = Date.now();

      const setup = data[2] && typeof data[2] === "object" ? data[2] : null;
      if (!setup || !Object.keys(setup).length) return;
      const joined = netplayServer.joinRoom(
        roomId,
        String(socket.username || "Jogador").slice(0, 12),
        setup,
        socket.id,
        socket
      );
      if (joined === "ok" || joined === "errorAlreadyJoined") socketRooms.set(socket.id, roomId);
    });

    socket.on(eventName(netcodes.NETCODE_LEAVEROOM), () => {
      netplayServer.leaveRoom(socket.id);
      socketRooms.delete(socket.id);
    });
    socket.on(eventName(netcodes.NETCODE_SETCONFIRM), (data) => {
      netplayServer.setConfirm(socket.id, Boolean(data));
    });
    socket.on(eventName(netcodes.NETCODE_FREEZEROOM), (data) => {
      const lobby = lobbies.get(socketRooms.get(socket.id));
      if (!lobby || lobby.hostSocketId !== socket.id) return;
      netplayServer.freezeRoom(socket.id, data && typeof data === "object" ? data : {});
    });
    socket.on(eventName(netcodes.NETCODE_UPDATESETUP), (data) => {
      const lobby = lobbies.get(socketRooms.get(socket.id));
      if (!lobby || lobby.hostSocketId !== socket.id) return;
      netplayServer.updateSetup(socket.id, data && typeof data === "object" ? data : {});
    });
    socket.on(eventName(netcodes.NETCODE_BROADCAST), (data) => {
      if (!Array.isArray(data)) return;
      netplayServer.broadcast(socket.id, netcodes.NETCODE_DATA, data);
    });
    socket.on(eventName(netcodes.NETCODE_SENDEVENT), (data = []) => {
      if (!Array.isArray(data) || typeof data[0] !== "string") return;
      netplayServer.send(data[0], netcodes.NETCODE_EVENT, data[1]);
    });
    socket.on("disconnect", () => {
      netplayServer.leaveRoom(socket.id);
      socketRooms.delete(socket.id);
      for (const lobby of lobbies.values()) {
        if (lobby.hostSocketId !== socket.id) continue;
        lobby.hostSocketId = null;
        lobby.hostJoined = false;
        lobby.updatedAt = Date.now();
      }
    });
  }

  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [roomId, lobby] of lobbies) {
      if (lobby.updatedAt < cutoff) lobbies.delete(roomId);
    }
  }, 60_000);
  cleanupTimer.unref?.();

  return { bindSocket };
}

module.exports = { createRetroArenaModule };
