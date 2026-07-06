(function () {
  const token = localStorage.getItem("mp_token");
  if (!token) {
    window.location.replace("/");
    return;
  }

  function randomRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let value = "";
    for (let i = 0; i < 6; i++) value += chars[Math.floor(Math.random() * chars.length)];
    return value;
  }

  function tokenUsername() {
    try {
      const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(raw)).username || "Jogador";
    } catch (_) {
      return "Jogador";
    }
  }

  const params = new URLSearchParams(window.location.search);
  let roomId = String(params.get("room") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const isHost = !roomId || params.get("host") === "1";
  if (!roomId) roomId = randomRoomId();
  params.set("room", roomId);
  if (isHost) params.set("host", "1");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);

  window.RETRO_ROOM_ID = roomId;
  window.RETRO_AUTO_JOIN = true;
  window.RETRO_USERNAME = tokenUsername();
  window.RETRO_SOCKET = window.io({ auth: { token } });

  window.RETRO_SOCKET.on("connect", function () {
    if (isHost) window.RETRO_SOCKET.emit("retro-arena:open", { roomId });
    const status = document.getElementById("albumRoomStatus");
    if (status) status.textContent = `Sala ${roomId}`;
  });
  window.RETRO_SOCKET.on("connect_error", function () {
    const status = document.getElementById("albumRoomStatus");
    if (status) status.textContent = "Entre novamente no Album para jogar";
  });

  document.addEventListener("DOMContentLoaded", function () {
    const back = document.createElement("a");
    back.className = "album-back";
    back.href = "/Album/";
    back.title = "Voltar ao Album";
    back.setAttribute("aria-label", "Voltar ao Album");
    back.innerHTML = "&larr;";
    document.body.appendChild(back);

    const room = document.createElement("div");
    room.id = "albumRoomStatus";
    room.className = "album-room-status";
    room.textContent = `Conectando a sala ${roomId}`;
    document.body.appendChild(room);

    const playButton = document.getElementById("playbutton");
    if (playButton) playButton.textContent = `Entrar na sala ${roomId}`;
    const notice = document.getElementById("browsernotice");
    if (notice) notice.textContent = "Retro Arena online - ate 4 jogadores";
  });
})();
