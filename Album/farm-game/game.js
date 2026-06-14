(function () {
  const SERVER_URL = window.location.origin;
  const token = localStorage.getItem("mp_token");
  const canvas = document.getElementById("farmCanvas");
  const ctx = canvas.getContext("2d");
  const coinsLabel = document.getElementById("coinsLabel");
  const levelLabel = document.getElementById("levelLabel");
  const xpLabel = document.getElementById("xpLabel");
  const userLabel = document.getElementById("userLabel");
  const toolsPanel = document.getElementById("toolsPanel");
  const inventoryPanel = document.getElementById("inventoryPanel");
  const selectionPanel = document.getElementById("selectionPanel");
  const actionPanel = document.getElementById("actionPanel");
  const shopPanel = document.getElementById("shopPanel");
  const farmToast = document.getElementById("farmToast");
  const backAlbum = document.getElementById("backAlbum");
  const keys = new Set();
  const camera = { x: 0, y: 0, scale: 1 };
  const player = { x: 1690, y: 1260, speed: 270 };
  const state = {
    loaded: false,
    user: null,
    farm: null,
    world: null,
    catalog: null,
    selected: { type: "none" },
    resourceNodes: [],
    lastSaveAt: 0,
    toastTimer: 0
  };

  const itemLabels = {
    seed_turnip: "Semente nabo",
    seed_carrot: "Semente cenoura",
    seed_corn: "Semente milho",
    seed_grape: "Semente uva",
    seed_crystalBerry: "Semente cristal",
    fertilizer: "Adubo",
    feed: "Racao",
    wood: "Madeira",
    stone: "Pedra",
    copper: "Cobre",
    iron: "Ferro",
    gold: "Ouro",
    diamond: "Diamante",
    turnip: "Nabo",
    carrot: "Cenoura",
    corn: "Milho",
    grape: "Uva",
    crystalBerry: "Fruta cristal",
    egg: "Ovo",
    goatMilk: "Leite cabra",
    fishFillet: "File peixe",
    milk: "Leite",
    truffle: "Trufa",
    horsehair: "Crina rara"
  };

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    farmToast.textContent = message;
    farmToast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => farmToast.classList.remove("is-visible"), 2600);
  }

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };
  }

  async function loadState(silent = false) {
    if (!token) {
      userLabel.textContent = "Faca login no album antes de entrar na fazenda.";
      showToast("Volte ao album e faca login.");
      return;
    }

    const res = await fetch(`${SERVER_URL}/api/farm/state`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || "Nao foi possivel carregar a fazenda.");
      return;
    }
    applyState(data);
    if (!silent) showToast("Fazenda carregada. Progresso salvo no servidor.");
  }

  async function doAction(action, body = {}, silent = false) {
    const res = await fetch(`${SERVER_URL}/api/farm/action`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action, ...body })
    });
    const data = await res.json();
    if (!res.ok) {
      if (!silent) showToast(data.error || "Acao recusada.");
      return null;
    }
    applyState(data);
    if (!silent && data.message) showToast(data.message);
    return data;
  }

  function applyState(data) {
    state.loaded = true;
    state.user = data.user;
    state.farm = data.farm;
    state.world = data.world;
    state.catalog = data.catalog;
    if (data.farm?.position) {
      player.x = data.farm.position.x;
      player.y = data.farm.position.y;
    }
    if (!state.resourceNodes.length && data.world?.map) {
      state.resourceNodes = makeResourceNodes(data.world.map);
    }
    renderPanels();
  }

  function makeResourceNodes(map) {
    const types = ["tree", "tree", "tree", "stone", "stone", "copper", "iron", "gold", "diamond"];
    const nodes = [];
    for (let i = 0; i < 150; i += 1) {
      const rx = randomSeed(i * 13 + 4);
      const ry = randomSeed(i * 17 + 8);
      const rt = randomSeed(i * 19 + 12);
      let type = types[Math.floor(rt * types.length)];
      if (rt > 0.96) type = "diamond";
      else if (rt > 0.9) type = "gold";
      else if (rt > 0.78) type = "iron";
      const x = 120 + rx * (map.width - 240);
      const y = 120 + ry * (map.height - 240);
      const merchant = map.merchant;
      if (Math.hypot(x - merchant.x, y - merchant.y) < 260) continue;
      nodes.push({ id: `res-${i}`, type, x, y, r: type === "tree" ? 26 : 18 });
    }
    return nodes;
  }

  function randomSeed(seed) {
    const raw = Math.sin(seed * 999.17) * 10000;
    return raw - Math.floor(raw);
  }

  function renderPanels() {
    if (!state.farm) return;
    coinsLabel.textContent = state.farm.coins;
    levelLabel.textContent = state.farm.level;
    xpLabel.textContent = state.farm.xp;
    userLabel.textContent = `${state.user.username} em (${Math.round(player.x)}, ${Math.round(player.y)})`;

    const tools = state.farm.tools || {};
    toolsPanel.innerHTML = [
      ["Picareta", tools.pickaxe],
      ["Machado", tools.axe],
      ["Pa", tools.shovel],
      ["Espada", tools.sword],
      ["Arco", tools.bow ? "sim" : "nao"],
      ["Escudo", tools.shield ? "sim" : "nao"]
    ].map(([name, value]) => `<div class="chip">${name}<small>${value}</small></div>`).join("");

    const inventory = state.farm.inventory || {};
    const visibleItems = Object.entries(inventory).filter(([, amount]) => Number(amount) > 0);
    inventoryPanel.innerHTML = visibleItems.length
      ? visibleItems.map(([key, amount]) => `<div class="chip">${itemLabels[key] || key}<small>${amount}</small></div>`).join("")
      : `<div class="chip">Vazio<small>colete recursos</small></div>`;

    renderSelection();
    renderShop();
  }

  function renderShop() {
    const crops = state.catalog?.crops || {};
    const animals = state.catalog?.animals || {};
    const tools = state.farm?.tools || {};
    const tiers = state.catalog?.toolTiers || [];
    const costs = state.catalog?.toolUpgradeCosts || {};
    const cropButtons = Object.entries(crops).map(([key, crop]) => {
      return `<button class="farm-btn" type="button" data-shop-seed="${key}">${crop.name} ${crop.seedPrice}</button>`;
    }).join("");
    const animalButtons = Object.entries(animals).map(([key, animal]) => {
      return `<button class="farm-btn secondary" type="button" data-shop-animal="${key}">${animal.name} ${animal.price}</button>`;
    }).join("");
    const upgradeButtons = ["pickaxe", "axe", "shovel", "sword"].map((tool) => {
      const current = tools[tool] || "wood";
      const next = tiers[tiers.indexOf(current) + 1];
      if (!next) return "";
      const cost = Object.entries(costs[next] || {}).map(([key, amount]) => `${itemLabels[key] || key} ${amount}`).join(", ");
      return `<button class="farm-btn secondary" type="button" data-upgrade-tool="${tool}">Melhorar ${toolName(tool)}<small>${next}: ${cost}</small></button>`;
    }).join("");
    shopPanel.innerHTML = `
      <button class="farm-btn" type="button" data-action="buy-feed">Comprar racao x5</button>
      ${cropButtons}
      ${animalButtons}
      ${upgradeButtons}
    `;
    shopPanel.querySelectorAll("[data-shop-seed]").forEach(button => {
      button.addEventListener("click", () => doAction("buy_seed", { cropType: button.dataset.shopSeed, quantity: 1 }));
    });
    shopPanel.querySelectorAll("[data-shop-animal]").forEach(button => {
      button.addEventListener("click", () => {
        const land = selectedLand();
        if (!land) return showToast("Selecione um terreno seu para colocar o animal.");
        doAction("buy_animal", { landId: land.id, animalType: button.dataset.shopAnimal });
      });
    });
    shopPanel.querySelector("[data-action='buy-feed']").addEventListener("click", () => doAction("buy_feed", { quantity: 5 }));
    shopPanel.querySelectorAll("[data-upgrade-tool]").forEach(button => {
      button.addEventListener("click", () => doAction("upgrade_tool", { tool: button.dataset.upgradeTool }));
    });
  }

  function toolName(tool) {
    return {
      pickaxe: "picareta",
      axe: "machado",
      shovel: "pa",
      sword: "espada"
    }[tool] || tool;
  }

  function selectedLand() {
    if (state.selected.type !== "land") return null;
    return state.world.lands.find(land => land.id === state.selected.id) || null;
  }

  function renderSelection() {
    const selected = state.selected;
    actionPanel.innerHTML = "";
    if (selected.type === "merchant") {
      selectionPanel.innerHTML = `<strong>Comerciante central</strong><br>Venda produtos colhidos aqui. Plantas e produtos animais viram moedas.`;
      addAction("Vender tudo", () => doAction("sell_all"));
      return;
    }
    if (selected.type === "resource") {
      const resource = state.catalog.resources[selected.resourceType];
      selectionPanel.innerHTML = `<strong>${resource.name}</strong><br>Coleta com ${resource.tool === "axe" ? "machado" : "picareta"} ${resource.tier}+.<br>Rende ${resource.amount} ${itemLabels[resource.itemKey] || resource.itemKey}.`;
      addAction("Coletar", () => doAction("gather", { resourceType: selected.resourceType }));
      return;
    }

    const land = selectedLand();
    if (!land) {
      selectionPanel.textContent = "Clique em terreno, recurso ou comerciante.";
      return;
    }

    const owner = land.ownerUsername || "Sem dono";
    const crop = land.cropState;
    const animal = land.animalState;
    selectionPanel.innerHTML = `
      <strong>${land.id}</strong><br>
      Dono: ${owner}<br>
      Preco: ${land.price} moedas<br>
      ${crop ? `Plantacao: ${crop.name} (${crop.status}) ${Math.round((crop.progress || 0) * 100)}%<br>` : ""}
      ${animal ? `Animal: ${animal.name} ${animal.hungry ? "(com fome)" : "(alimentado)"} - producao ${animal.pending}<br>` : ""}
    `;

    if (!land.ownerId) {
      addAction(`Comprar ${land.price}`, () => doAction("buy_land", { landId: land.id }));
      return;
    }

    if (!land.crop && !land.animal && land.isMine) {
      Object.entries(state.catalog.crops).slice(0, 5).forEach(([key, cropDef]) => {
        addAction(`Plantar ${cropDef.name}`, () => doAction("plant", { landId: land.id, cropType: key }));
      });
      return;
    }

    if (crop) {
      if (land.isMine && crop.status === "needs_water") addAction("Regar", () => doAction("water", { landId: land.id }));
      if (land.isMine && !crop.fertilizedAt && !crop.rotten) addAction("Adubar", () => doAction("fertilize", { landId: land.id }));
      if (crop.ready || crop.rotten) addAction(crop.rotten ? "Remover podre" : land.isMine ? "Colher" : "Roubar", () => doAction("harvest", { landId: land.id }), crop.rotten ? "warn" : "");
    }

    if (animal) {
      if (land.isMine) addAction("Alimentar", () => doAction("feed_animal", { landId: land.id }));
      if (animal.pending > 0) addAction(land.isMine ? "Coletar produto" : "Roubar produto", () => doAction("collect_animal", { landId: land.id }), land.isMine ? "" : "warn");
    }
  }

  function addAction(label, handler, tone = "") {
    const button = document.createElement("button");
    button.className = `farm-btn ${tone}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    actionPanel.appendChild(button);
  }

  function update(dt) {
    if (!state.loaded || !state.world) return;
    const speed = player.speed * dt;
    let moved = false;
    if (keys.has("arrowleft") || keys.has("a")) { player.x -= speed; moved = true; }
    if (keys.has("arrowright") || keys.has("d")) { player.x += speed; moved = true; }
    if (keys.has("arrowup") || keys.has("w")) { player.y -= speed; moved = true; }
    if (keys.has("arrowdown") || keys.has("s")) { player.y += speed; moved = true; }
    player.x = Math.max(20, Math.min(state.world.map.width - 20, player.x));
    player.y = Math.max(20, Math.min(state.world.map.height - 20, player.y));
    camera.x = player.x - canvas.width / 2 / camera.scale;
    camera.y = player.y - canvas.height / 2 / camera.scale;
    camera.x = Math.max(0, Math.min(state.world.map.width - canvas.width / camera.scale, camera.x));
    camera.y = Math.max(0, Math.min(state.world.map.height - canvas.height / camera.scale, camera.y));
    if (moved && performance.now() - state.lastSaveAt > 5000) {
      state.lastSaveAt = performance.now();
      doAction("save_position", { x: Math.round(player.x), y: Math.round(player.y) }, true);
      renderPanels();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.world) {
      ctx.fillStyle = "#fff8e8";
      ctx.font = "900 24px Segoe UI";
      ctx.fillText("Carregando Fazenda Pixel...", 40, 60);
      return;
    }
    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    drawMap();
    state.world.lands.forEach(drawLand);
    state.resourceNodes.forEach(drawResource);
    drawMerchant();
    drawPlayer();
    ctx.restore();
  }

  function drawMap() {
    const map = state.world.map;
    ctx.fillStyle = "#4b9f4f";
    ctx.fillRect(0, 0, map.width, map.height);
    for (let y = 0; y < map.height; y += 32) {
      for (let x = 0; x < map.width; x += 32) {
        const alt = ((x / 32) + (y / 32)) % 2 === 0;
        ctx.fillStyle = alt ? "#55aa55" : "#47964b";
        ctx.fillRect(x, y, 32, 32);
      }
    }
    ctx.fillStyle = "#c79a54";
    ctx.fillRect(map.merchant.x - 36, 0, 72, map.height);
    ctx.fillRect(0, map.merchant.y - 36, map.width, 72);
    ctx.fillStyle = "#2e82b7";
    ctx.fillRect(2240, 1560, 470, 260);
    ctx.fillStyle = "rgba(255,255,255,.2)";
    ctx.fillRect(2260, 1580, 430, 36);
  }

  function drawLand(land) {
    const selected = state.selected.type === "land" && state.selected.id === land.id;
    ctx.fillStyle = land.ownerId ? land.isMine ? "#8b6f3e" : "#76543a" : "#6fb866";
    ctx.fillRect(land.x, land.y, land.w, land.h);
    ctx.strokeStyle = selected ? "#fff06a" : land.ownerId ? "#4c2f1e" : "#e7d58d";
    ctx.lineWidth = selected ? 6 : 3;
    ctx.strokeRect(land.x, land.y, land.w, land.h);
    for (let x = land.x + 16; x < land.x + land.w; x += 32) {
      ctx.strokeStyle = "rgba(70,43,22,.25)";
      ctx.beginPath();
      ctx.moveTo(x, land.y + 8);
      ctx.lineTo(x, land.y + land.h - 8);
      ctx.stroke();
    }
    if (land.cropState) drawCrop(land, land.cropState);
    if (land.animalState) drawAnimal(land, land.animalState);
    ctx.fillStyle = "#fff8e8";
    ctx.font = "900 13px Segoe UI";
    ctx.fillText(land.ownerUsername || `${land.price} moedas`, land.x + 10, land.y + 20);
  }

  function drawCrop(land, crop) {
    const rows = 3;
    const cols = 4;
    const h = Math.max(8, 34 * (crop.progress || 0));
    ctx.fillStyle = crop.rotten ? "#4f4b37" : crop.ready ? "#f4d35e" : "#2f8e49";
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = land.x + 42 + col * 34;
        const y = land.y + 52 + row * 28;
        ctx.fillRect(x, y + 24 - h, 12, h);
      }
    }
  }

  function drawAnimal(land, animal) {
    const x = land.x + land.w / 2;
    const y = land.y + land.h / 2 + 22;
    ctx.fillStyle = animal.hungry ? "#9b7257" : "#f1e4c8";
    ctx.fillRect(x - 26, y - 18, 52, 32);
    ctx.fillRect(x + 16, y - 34, 24, 24);
    ctx.fillStyle = "#1b2520";
    ctx.fillRect(x + 28, y - 25, 4, 4);
    if (animal.pending > 0) {
      ctx.fillStyle = "#fff06a";
      ctx.fillRect(x - 8, y - 50, 16, 16);
    }
  }

  function drawResource(node) {
    const selected = state.selected.type === "resource" && state.selected.id === node.id;
    ctx.save();
    ctx.translate(node.x, node.y);
    if (node.type === "tree") {
      ctx.fillStyle = "#6b3f21";
      ctx.fillRect(-6, 8, 12, 28);
      ctx.fillStyle = selected ? "#84d96e" : "#1d7a4c";
      ctx.fillRect(-22, -20, 44, 36);
      ctx.fillRect(-14, -38, 28, 28);
    } else {
      const colors = { stone: "#9aa2a3", copper: "#b87345", iron: "#849099", gold: "#d8ad3f", diamond: "#63d7ff" };
      ctx.fillStyle = selected ? "#fff8e8" : colors[node.type] || "#9aa2a3";
      ctx.fillRect(-18, -12, 36, 26);
      ctx.fillStyle = "rgba(0,0,0,.18)";
      ctx.fillRect(-10, -5, 20, 8);
    }
    ctx.restore();
  }

  function drawMerchant() {
    const m = state.world.map.merchant;
    ctx.fillStyle = "#f4d35e";
    ctx.fillRect(m.x - 74, m.y - 74, 148, 148);
    ctx.fillStyle = "#7d4f2b";
    ctx.fillRect(m.x - 60, m.y + 24, 120, 38);
    ctx.fillStyle = "#26322e";
    ctx.fillRect(m.x - 24, m.y - 30, 48, 58);
    ctx.fillStyle = "#f0c18d";
    ctx.fillRect(m.x - 18, m.y - 66, 36, 36);
    ctx.fillStyle = "#fff8e8";
    ctx.font = "900 18px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("COMERCIANTE", m.x, m.y - 92);
    ctx.textAlign = "left";
  }

  function drawPlayer() {
    ctx.fillStyle = "#25312d";
    ctx.fillRect(player.x - 13, player.y - 23, 26, 38);
    ctx.fillStyle = "#f0c18d";
    ctx.fillRect(player.x - 11, player.y - 44, 22, 22);
    ctx.fillStyle = "#fff8e8";
    ctx.fillRect(player.x - 16, player.y + 14, 12, 11);
    ctx.fillRect(player.x + 4, player.y + 14, 12, 11);
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((clientY - rect.top) / rect.height) * canvas.height;
    return {
      x: sx / camera.scale + camera.x,
      y: sy / camera.scale + camera.y
    };
  }

  function selectAt(point) {
    const merchant = state.world.map.merchant;
    if (Math.hypot(point.x - merchant.x, point.y - merchant.y) < merchant.radius) {
      state.selected = { type: "merchant" };
      renderSelection();
      return;
    }
    const land = state.world.lands.find(item => point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h);
    if (land) {
      state.selected = { type: "land", id: land.id };
      renderSelection();
      return;
    }
    const node = state.resourceNodes.find(item => Math.hypot(point.x - item.x, point.y - item.y) < item.r + 12);
    if (node) {
      state.selected = { type: "resource", id: node.id, resourceType: node.type };
      renderSelection();
      return;
    }
    state.selected = { type: "none" };
    renderSelection();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener("keydown", event => {
    keys.add(event.key.toLowerCase());
  });
  window.addEventListener("keyup", event => {
    keys.delete(event.key.toLowerCase());
  });
  canvas.addEventListener("click", event => {
    if (!state.world) return;
    selectAt(screenToWorld(event.clientX, event.clientY));
  });
  backAlbum.addEventListener("click", () => {
    window.location.href = "/";
  });

  window.setInterval(() => {
    if (state.loaded) loadState(true).catch(() => {});
  }, 15000);

  loadState().catch(err => showToast(err.message));
  requestAnimationFrame(loop);
})();
