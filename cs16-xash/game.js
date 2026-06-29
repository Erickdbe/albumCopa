import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { Xash3D, Net } from "https://cdn.jsdelivr.net/npm/xash3d-fwgs@1.2.2/+esm";

const XASH_VERSION = "1.2.2";
const CS16_VERSION = "0.1.2";
const XASH_DIST = `https://cdn.jsdelivr.net/npm/xash3d-fwgs@${XASH_VERSION}/dist`;
const CS16_DIST = `https://cdn.jsdelivr.net/npm/cs16-client@${CS16_VERSION}/dist/cstrike`;
const LOCAL_GAME_ZIP_URL = "./local-valve.zip";
const CACHE_DB_NAME = "album-copa-cs16";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = "files";
const CACHE_MANIFEST_KEY = "__manifest__";
const ROOM_ID = new URLSearchParams(window.location.search).get("room");
const TOKEN = localStorage.getItem("mp_token") || "";

const setupView = document.getElementById("setupView");
const gameView = document.getElementById("gameView");
const canvas = document.getElementById("gameCanvas");
const statusText = document.getElementById("statusText");
const sourceActions = document.querySelector(".source-actions");
const openFolderButton = document.getElementById("openFolderButton");
const openZipButton = document.getElementById("openZipButton");
const folderInput = document.getElementById("folderInput");
const zipInput = document.getElementById("zipInput");
const loadStage = document.getElementById("loadStage");
const loadTitle = document.getElementById("loadTitle");
const loadPercent = document.getElementById("loadPercent");
const progressBar = document.getElementById("progressBar");
const progressTrack = loadStage.querySelector("[role='progressbar']");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");
const retryButton = document.getElementById("retryButton");
const fullscreenButton = document.getElementById("fullscreenButton");

let engine = null;
let lobbySocket = null;
let onlineSession = null;
let loading = false;
let dragDepth = 0;
let sessionSettled = false;
let resolveOnlineSession;
let rejectOnlineSession;

const onlineSessionReady = ROOM_ID
  ? new Promise((resolve, reject) => {
    resolveOnlineSession = resolve;
    rejectOnlineSession = reject;
  })
  : Promise.resolve(null);

openFolderButton.addEventListener("click", () => folderInput.click());
openZipButton.addEventListener("click", () => zipInput.click());
retryButton.addEventListener("click", resetLauncher);

folderInput.addEventListener("change", () => {
  const files = Array.from(folderInput.files || []);
  if (files.length) prepareFolder(files);
});

zipInput.addEventListener("change", () => {
  const file = zipInput.files?.[0];
  if (file) prepareZip(file);
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await gameView.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen indisponivel", error);
  }
});

document.querySelectorAll("[data-leave-cs16]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!ROOM_ID || !lobbySocket?.connected) return;
    event.preventDefault();
    lobbySocket.emit("cs16:leave", { roomId: ROOM_ID });
    window.setTimeout(() => { window.location.href = "/"; }, 120);
  });
});

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  setupView.classList.add("is-dragging");
});

window.addEventListener("dragover", (event) => event.preventDefault());

window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) setupView.classList.remove("is-dragging");
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  setupView.classList.remove("is-dragging");
  const file = Array.from(event.dataTransfer?.files || []).find((item) => item.name.toLowerCase().endsWith(".zip"));
  if (file) prepareZip(file);
  else showError("Solte um arquivo ZIP contendo as pastas valve e cstrike.");
});

window.addEventListener("beforeunload", () => {
  try {
    engine?.quit?.();
  } catch (_) {
    // The WASM runtime may already be stopped.
  }
});

if (ROOM_ID) connectOnlineRoom();
autoStartGameData();

async function connectOnlineRoom() {
  statusText.textContent = "Reconectando a partida online...";
  sourceActions.hidden = true;

  if (!TOKEN) {
    rejectSession(new Error("Sua sessao expirou. Volte ao Album e faca login novamente."));
    return;
  }

  try {
    await loadClassicScript("/socket.io/socket.io.js");
    if (typeof window.io !== "function") throw new Error("Socket.io nao ficou disponivel.");

    lobbySocket = window.io(window.location.origin, { auth: { token: TOKEN } });
    lobbySocket.on("connect", () => lobbySocket.emit("cs16:resume", { roomId: ROOM_ID }));
    lobbySocket.on("cs16:session", (session) => {
      if (session.roomId !== ROOM_ID) return;
      onlineSession = session;
      if (!loading) showManualSourceFallback();
      if (!sessionSettled) {
        sessionSettled = true;
        resolveOnlineSession(session);
      }
    });
    lobbySocket.on("cs16:opponent-status", ({ message }) => {
      if (!loading && message) statusText.textContent = message;
    });
    lobbySocket.on("cs16:cancelled", ({ message }) => {
      rejectSession(new Error(message || "A partida de Counter-Strike foi encerrada."));
    });
    lobbySocket.on("cs16:error", (message) => {
      rejectSession(new Error(message || "Nao foi possivel reassumir a sala de Counter-Strike."));
    });
    lobbySocket.on("connect_error", () => {
      rejectSession(new Error("Nao foi possivel conectar ao lobby do Album."));
    });
  } catch (error) {
    rejectSession(error);
  }
}

function rejectSession(error) {
  onlineSession = null;
  if (!sessionSettled) {
    sessionSettled = true;
    rejectOnlineSession?.(error);
  }
  showError(errorMessage(error));
}

async function prepareFolder(files) {
  if (loading) return;
  beginLoading("Lendo pasta do jogo");

  try {
    const candidates = files
      .map((file) => ({ file, path: normalizeGamePath(file.webkitRelativePath || file.name) }))
      .filter((entry) => entry.path);

    validateGameEntries(candidates.map((entry) => entry.path), files.map((file) => file.webkitRelativePath || file.name));

    const runtimeFiles = {};
    let loadedBytes = 0;
    const totalBytes = candidates.reduce((sum, entry) => sum + entry.file.size, 0) || 1;

    for (const entry of candidates) {
      runtimeFiles[`/rodir/${entry.path}`] = new Uint8Array(await entry.file.arrayBuffer());
      loadedBytes += entry.file.size;
      setProgress((loadedBytes / totalBytes) * 64, "Lendo arquivos do jogo");
      await yieldToBrowser();
    }

    await saveRuntimeFilesForNextOpen(runtimeFiles);
    await launch(runtimeFiles);
  } catch (error) {
    showError(errorMessage(error));
  }
}

async function prepareZip(file) {
  if (loading) return;
  beginLoading("Abrindo ZIP do jogo");

  try {
    await loadZipSource(file, { cache: true });
  } catch (error) {
    showError(errorMessage(error));
  }
}

async function autoStartGameData() {
  if (loading) return;

  if (!ROOM_ID) statusText.textContent = "Procurando cs16-server/valve.zip...";

  try {
    const probe = await fetch(LOCAL_GAME_ZIP_URL, { method: "HEAD", cache: "no-store" });
    if (!probe.ok) {
      const cachedFiles = await loadCachedRuntimeFiles();
      if (cachedFiles) {
        await launch(cachedFiles);
        return;
      }
      showManualSourceFallback();
      return;
    }

    beginLoading("Carregando cs16-server/valve.zip");
    const response = await fetch(LOCAL_GAME_ZIP_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Nao foi possivel ler cs16-server/valve.zip.");

    setProgress(18, "Lendo ZIP local");
    await loadZipSource(await response.blob(), { cache: false });
  } catch (error) {
    showError(`Nao consegui iniciar o Counter-Strike: ${errorMessage(error)}`);
  }
}

async function loadZipSource(source, options = {}) {
  const zip = await JSZip.loadAsync(source);
  const allPaths = Object.keys(zip.files);
  const candidates = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({ entry, path: normalizeGamePath(entry.name) }))
    .filter((entry) => entry.path);

  validateGameEntries(candidates.map((entry) => entry.path), allPaths);

  const runtimeFiles = {};
  for (let index = 0; index < candidates.length; index += 1) {
    const current = candidates[index];
    runtimeFiles[`/rodir/${current.path}`] = await current.entry.async("uint8array", (metadata) => {
      const fileFraction = Math.max(0, Math.min(1, Number(metadata.percent || 0) / 100));
      setProgress(((index + fileFraction) / candidates.length) * 64, "Extraindo arquivos do jogo");
    });
    await yieldToBrowser();
  }

  if (options.cache !== false) await saveRuntimeFilesForNextOpen(runtimeFiles);
  await launch(runtimeFiles);
}

async function saveRuntimeFilesForNextOpen(runtimeFiles) {
  if (!window.indexedDB) return;

  const fullPaths = Object.keys(runtimeFiles);
  const gamePaths = fullPaths.map((path) => path.replace(/^\/rodir\//, ""));
  if (!gamePaths.length) return;

  try {
    setProgress(64, "Salvando para abrir direto depois");
    const db = await openGameCache();
    const transaction = db.transaction(CACHE_STORE, "readwrite");
    const store = transaction.objectStore(CACHE_STORE);

    store.clear();
    store.put({
      path: CACHE_MANIFEST_KEY,
      files: gamePaths,
      savedAt: Date.now()
    });

    fullPaths.forEach((fullPath, index) => {
      store.put({
        path: gamePaths[index],
        data: runtimeFiles[fullPath]
      });
      if (index % 60 === 0) {
        setProgress(64 + (index / Math.max(1, fullPaths.length)) * 4, "Salvando para abrir direto depois");
      }
    });

    await transactionDone(transaction);
    db.close();
    setProgress(68, "Jogo salvo no navegador");
  } catch (error) {
    console.warn("Nao foi possivel salvar os arquivos do CS no navegador.", error);
  }
}

async function loadCachedRuntimeFiles() {
  if (!window.indexedDB) return null;

  try {
    const db = await openGameCache();
    const manifest = await idbGet(db, CACHE_STORE, CACHE_MANIFEST_KEY);
    const files = Array.isArray(manifest?.files) ? manifest.files : [];
    if (!files.length) {
      db.close();
      return null;
    }

    validateGameEntries(files, files);
    beginLoading("Carregando CS salvo no navegador");

    const runtimeFiles = {};
    for (let index = 0; index < files.length; index += 1) {
      const gamePath = files[index];
      const record = await idbGet(db, CACHE_STORE, gamePath);
      if (!record?.data) throw new Error(`Arquivo salvo ausente: ${gamePath}`);

      runtimeFiles[`/rodir/${gamePath}`] = record.data instanceof Uint8Array
        ? record.data
        : new Uint8Array(record.data);

      if (index % 40 === 0) {
        setProgress((index / Math.max(1, files.length)) * 64, "Carregando CS salvo no navegador");
        await yieldToBrowser();
      }
    }

    db.close();
    return runtimeFiles;
  } catch (error) {
    console.warn("Nao foi possivel carregar o CS salvo no navegador.", error);
    return null;
  }
}

function openGameCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "path" });
      }
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB indisponivel."));
    request.onsuccess = () => resolve(request.result);
  });
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onerror = () => reject(request.error || new Error("Falha ao ler cache do jogo."));
    request.onsuccess = () => resolve(request.result || null);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Falha ao salvar cache do jogo."));
    transaction.onabort = () => reject(transaction.error || new Error("Cache do jogo foi abortado."));
  });
}

function normalizeGamePath(rawPath) {
  const parts = String(rawPath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const rootIndex = parts.findIndex((part) => ["valve", "cstrike"].includes(part.toLowerCase()));
  if (rootIndex < 0) return null;
  parts[rootIndex] = parts[rootIndex].toLowerCase();
  return parts.slice(rootIndex).join("/");
}

function validateGameEntries(gamePaths, originalPaths) {
  const hasValve = gamePaths.some((path) => path.startsWith("valve/"));
  const hasCstrike = gamePaths.some((path) => path.startsWith("cstrike/"));
  if (hasValve && hasCstrike) return;

  const looksLikeSource = originalPaths.some((path) => /cs16-client-main|cmakelists\.txt|\.github\/workflows/i.test(path));
  if (looksLikeSource) {
    throw new Error("Esse ZIP e o codigo-fonte do cliente. Para jogar, selecione a instalacao do Counter-Strike que contenha as pastas valve e cstrike.");
  }

  const missing = [!hasValve && "valve", !hasCstrike && "cstrike"].filter(Boolean).join(" e ");
  throw new Error(`A origem selecionada nao contem a pasta ${missing}.`);
}

async function launch(runtimeFiles) {
  const session = await onlineSessionReady;
  if (ROOM_ID && !session?.serverUrl) throw new Error("O servidor dedicado do Counter-Strike nao esta configurado.");

  setProgress(70, session ? "Conectando ao servidor online" : "Carregando engine WebAssembly");
  const extrasResponse = await fetch(`${CS16_DIST}/extras.pk3`);
  if (!extrasResponse.ok) throw new Error("Nao foi possivel carregar os arquivos auxiliares do cliente.");
  const extras = new Uint8Array(await extrasResponse.arrayBuffer());

  const EngineClass = session ? Xash3DWebRTC : Xash3D;
  const xash = new EngineClass({
    multiplayerIP: session?.serverUrl || "",
    canvas,
    module: {
      arguments: ["-windowed", "-game", "cstrike", "+_vgui_menus", "0", "-ref", "webgl2"],
      locateFile: locateEngineFile,
      print: (message) => console.info(`[CS16] ${message}`),
      printErr: (message) => console.error(`[CS16] ${message}`)
    },
    libraries: {
      filesystem: `${XASH_DIST}/filesystem_stdio.wasm`,
      xash: `${XASH_DIST}/xash.wasm`,
      menu: `${CS16_DIST}/cl_dlls/menu_emscripten_wasm32.wasm`,
      client: `${CS16_DIST}/cl_dlls/client_emscripten_wasm32.wasm`,
      server: `${CS16_DIST}/dlls/cs_emscripten_wasm32.wasm`
    },
    dynamicLibraries: [
      "filesystem_stdio.wasm",
      "libref_webgl2.wasm",
      "cl_dlls/client_emscripten_wasm32.wasm",
      "cl_dlls/menu_emscripten_wasm32.wasm",
      "dlls/cs_emscripten_wasm32.wasm",
      "dlls/mp_emscripten_wasm32.wasm"
    ]
  });

  engine = xash;
  await xash.init();
  setProgress(82, "Montando sistema de arquivos");

  const paths = Object.keys(runtimeFiles);
  xash.em.FS.mkdirTree("/rodir");
  paths.forEach((path, index) => {
    xash.em.FS.mkdirTree(path.split("/").slice(0, -1).join("/"));
    xash.em.FS.writeFile(path, runtimeFiles[path]);
    delete runtimeFiles[path];
    if (index % 40 === 0) {
      setProgress(82 + (index / Math.max(1, paths.length)) * 15, "Montando sistema de arquivos");
    }
  });

  xash.em.FS.mkdirTree("/rodir/cstrike");
  xash.em.FS.writeFile("/rodir/cstrike/extras.pk3", extras);
  xash.em.FS.chdir("/rodir");
  xash.main();
  setProgress(100, session ? "Entrando na partida online" : "Iniciando Counter-Strike 1.6");
  window.setTimeout(showGame, 180);

  if (session) {
    const playerName = sanitizeConsoleValue(session.username || "AlbumPlayer");
    window.setTimeout(() => {
      xash.Cmd_ExecuteString(`name "${playerName}"`);
      xash.Cmd_ExecuteString("connect 127.0.0.1:8080");
    }, 1400);
  }
}

function locateEngineFile(path) {
  switch (path) {
    case "xash.wasm":
      return `${XASH_DIST}/xash.wasm`;
    case "filesystem_stdio.wasm":
      return `${XASH_DIST}/filesystem_stdio.wasm`;
    case "libref_webgl2.wasm":
      return `${XASH_DIST}/libref_webgl2.wasm`;
    case "cl_dlls/menu_emscripten_wasm32.wasm":
      return `${CS16_DIST}/cl_dlls/menu_emscripten_wasm32.wasm`;
    case "cl_dlls/client_emscripten_wasm32.wasm":
      return `${CS16_DIST}/cl_dlls/client_emscripten_wasm32.wasm`;
    case "dlls/cs_emscripten_wasm32.wasm":
    case "dlls/mp_emscripten_wasm32.wasm":
      return `${CS16_DIST}/dlls/cs_emscripten_wasm32.wasm`;
    default:
      return path;
  }
}

class Xash3DWebRTC extends Xash3D {
  constructor(options = {}) {
    super(options);
    this.multiplayerIP = options.multiplayerIP;
    this.net = new Net(this);
    this.ws = null;
    this.peer = null;
    this.channel = null;
  }

  async init() {
    await Promise.all([super.init(), this.connect()]);
  }

  initConnection(stream, resolve, reject) {
    if (this.peer) return;
    this.peer = new RTCPeerConnection();
    this.peer.onicecandidate = (event) => {
      if (!event.candidate || this.ws?.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ event: "candidate", data: event.candidate.toJSON() }));
    };
    stream?.getTracks?.().forEach((track) => this.peer.addTrack(track, stream));

    let channelsOpen = 0;
    this.peer.ondatachannel = (event) => {
      const dataChannel = event.channel;
      dataChannel.binaryType = "arraybuffer";
      if (dataChannel.label === "write") {
        dataChannel.onmessage = async (message) => {
          const buffer = message.data instanceof ArrayBuffer
            ? message.data
            : await message.data.arrayBuffer();
          this.net.incoming.enqueue({
            ip: [127, 0, 0, 1],
            port: 8080,
            data: new Int8Array(buffer)
          });
        };
      }
      dataChannel.onopen = () => {
        channelsOpen += 1;
        if (dataChannel.label === "read") this.channel = dataChannel;
        if (channelsOpen >= 2) resolve();
      };
    };
    this.peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.peer.connectionState)) {
        reject(new Error("A conexao WebRTC do Counter-Strike foi encerrada."));
      }
    };
  }

  async connect() {
    const endpoint = websocketEndpoint(this.multiplayerIP);
    let stream = null;
    try {
      stream = await navigator.mediaDevices?.getUserMedia?.({ audio: true });
    } catch (_) {
      console.info("Microfone nao autorizado; seguindo sem voz.");
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Tempo esgotado ao conectar no servidor do Counter-Strike.")), 20000);
      const finish = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      const fail = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };

      this.ws = new WebSocket(endpoint);
      this.ws.onerror = () => fail(new Error(`Nao foi possivel conectar em ${endpoint}.`));
      this.ws.onclose = () => {
        if (!this.channel) fail(new Error("Servidor WebRTC do Counter-Strike desconectou."));
      };
      this.ws.onmessage = async (event) => {
        this.initConnection(stream, finish, fail);
        const message = JSON.parse(event.data);
        const payload = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
        if (message.event === "offer") {
          await this.peer.setRemoteDescription(payload);
          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);
          this.ws.send(JSON.stringify({ event: "answer", data: answer }));
        }
        if (message.event === "candidate") await this.peer.addIceCandidate(payload);
      };
    });
  }

  sendto(packet) {
    if (this.channel?.readyState === "open") this.channel.send(packet.data);
  }
}

function websocketEndpoint(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Servidor WebRTC do Counter-Strike nao configurado.");
  const base = /^wss?:\/\//i.test(raw)
    ? raw
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${raw}`;
  return /\/websocket$/i.test(base) ? base : `${base}/websocket`;
}

function loadClassicScript(src) {
  const existing = document.querySelector(`script[data-runtime-src="${src}"]`);
  if (existing) return existing.dataset.loaded === "true"
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.runtimeSrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Nao foi possivel carregar o Socket.io.")), { once: true });
    document.head.append(script);
  });
}

function beginLoading(title) {
  loading = true;
  errorPanel.hidden = true;
  sourceActions.hidden = true;
  loadStage.hidden = false;
  statusText.textContent = onlineSession
    ? `Preparando partida contra ${onlineSession.opponentUsername}.`
    : "Preparando a partida local.";
  setProgress(2, title);
}

function setProgress(value, title) {
  const percent = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
  progressBar.style.width = `${percent}%`;
  progressTrack.setAttribute("aria-valuenow", String(percent));
  loadPercent.textContent = `${percent}%`;
  if (title) loadTitle.textContent = title;
}

function showGame() {
  loading = false;
  setupView.hidden = true;
  gameView.hidden = false;
  canvas.focus();
  window.dispatchEvent(new Event("resize"));
}

function showError(message) {
  loading = false;
  setupView.hidden = false;
  gameView.hidden = true;
  loadStage.hidden = true;
  sourceActions.hidden = true;
  errorText.textContent = message;
  errorPanel.hidden = false;
}

function showManualSourceFallback() {
  loading = false;
  setupView.hidden = false;
  gameView.hidden = true;
  loadStage.hidden = true;
  errorPanel.hidden = true;
  sourceActions.hidden = false;
  statusText.textContent = onlineSession
    ? `Partida online contra ${onlineSession.opponentUsername}. Nao achei cs16-server/valve.zip nem um CS salvo neste navegador. Selecione o ZIP/pasta uma vez para salvar e abrir direto depois.`
    : "Nao achei cs16-server/valve.zip nem um CS salvo neste navegador. Selecione o ZIP/pasta uma vez para salvar e abrir direto depois.";
  setProgress(0, "Preparando arquivos");
}

function resetLauncher() {
  if (ROOM_ID && sessionSettled && !onlineSession) {
    window.location.href = "/";
    return;
  }
  loading = false;
  folderInput.value = "";
  zipInput.value = "";
  loadStage.hidden = true;
  errorPanel.hidden = true;
  sourceActions.hidden = false;
  statusText.textContent = onlineSession
    ? `Partida online contra ${onlineSession.opponentUsername}. Selecione o ZIP/pasta uma vez para salvar e abrir direto depois.`
    : "Selecione o ZIP/pasta uma vez para salvar e abrir direto depois.";
  setProgress(0, "Preparando arquivos");
}

function sanitizeConsoleValue(value) {
  return String(value || "Player").replace(/[";\r\n]/g, "").slice(0, 32);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "Erro desconhecido.");
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
