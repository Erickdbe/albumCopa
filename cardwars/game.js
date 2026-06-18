"use strict";

const ASSET_BASE = "/CardWars-main/CardWars-main/Assets";
const BLUEPRINT_BASE = `${ASSET_BASE}/StreamingAssets/Blueprints`;
const CARDART_BASE = `${ASSET_BASE}/Resources/textures/cardart`;
const AUDIO_BASE = `${ASSET_BASE}/AudioClip`;
const TOKEN_BASE = `${ASSET_BASE}/Texture2D`;

const FACTIONS = ["Corn", "Cotton", "Plains", "Sand", "Swamp"];
const FACTION_NAMES = {
  Corn: "Corn",
  Cotton: "Cotton",
  Plains: "Plains",
  Sand: "Sand",
  Swamp: "Swamp",
  Universal: "Universal",
  Mixed: "Misto"
};
const FACTION_COLORS = {
  Corn: "linear-gradient(145deg, rgba(232,197,74,.56), rgba(143,179,84,.40))",
  Cotton: "linear-gradient(145deg, rgba(245,183,214,.48), rgba(142,202,213,.38))",
  Plains: "linear-gradient(145deg, rgba(168,213,126,.50), rgba(240,229,154,.40))",
  Sand: "linear-gradient(145deg, rgba(229,183,89,.54), rgba(214,122,80,.36))",
  Swamp: "linear-gradient(145deg, rgba(79,122,91,.52), rgba(93,87,128,.40))",
  Universal: "linear-gradient(145deg, rgba(216,218,207,.54), rgba(143,169,187,.36))"
};

const els = {};
const state = {
  loaded: false,
  sound: localStorage.getItem("cardwars:sound") === "on",
  catalog: [],
  creatures: [],
  buildings: [],
  spells: [],
  uid: 1,
  actor: "player",
  turn: 0,
  selectedCardUid: null,
  selectedLane: 0,
  selectedTargetLane: 0,
  busy: false,
  winner: null,
  player: null,
  cpu: null,
  log: []
};

const sounds = {
  creature: makeAudio("BMO_Play_Creature_3.wav"),
  building: makeAudio("BMO_Play_Building_1.wav"),
  spell: makeAudio("BMO_Play_Spell_1.wav"),
  hit: makeAudio("BMO_Hero_Damage_1.wav"),
  bell: makeAudio("Bell01.wav"),
  win: makeAudio("BMO_Win_1.wav"),
  lose: makeAudio("BMO_Lose_1.wav")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  wireEvents();
  els.soundBtn.setAttribute("aria-pressed", String(state.sound));
  els.soundBtn.textContent = state.sound ? "Som ligado" : "Som";

  try {
    await loadBlueprints();
    state.loaded = true;
    renderCatalog();
    startNewGame();
  } catch (error) {
    console.error(error);
    setStatus("Nao consegui carregar os blueprints do CardWars.");
  }
}

function cacheElements() {
  [
    "deckFaction",
    "newGameBtn",
    "soundBtn",
    "enemyLanes",
    "playerLanes",
    "turnBadge",
    "statusLine",
    "cpuHero",
    "playerHero",
    "cpuActions",
    "playerActions",
    "cpuDeck",
    "playerDeck",
    "cpuDiscard",
    "playerDiscard",
    "hand",
    "playCardBtn",
    "floopBtn",
    "battleBtn",
    "assetStats",
    "cardSearch",
    "catalogFilter",
    "catalog",
    "eventLog"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function wireEvents() {
  els.newGameBtn.addEventListener("click", startNewGame);
  els.deckFaction.addEventListener("change", () => {
    localStorage.setItem("cardwars:faction", els.deckFaction.value);
    startNewGame();
  });
  els.soundBtn.addEventListener("click", () => {
    state.sound = !state.sound;
    localStorage.setItem("cardwars:sound", state.sound ? "on" : "off");
    els.soundBtn.textContent = state.sound ? "Som ligado" : "Som";
    els.soundBtn.setAttribute("aria-pressed", String(state.sound));
    if (state.sound) playSound("bell");
  });
  els.playCardBtn.addEventListener("click", playSelectedCard);
  els.floopBtn.addEventListener("click", floopSelectedCreature);
  els.battleBtn.addEventListener("click", () => playerBattleAndPass());
  els.cardSearch.addEventListener("input", renderCatalog);
  els.catalogFilter.addEventListener("change", renderCatalog);

  const savedFaction = localStorage.getItem("cardwars:faction");
  if (savedFaction) els.deckFaction.value = savedFaction;
}

async function loadBlueprints() {
  const [creatures, buildings, spells] = await Promise.all([
    getJson(`${BLUEPRINT_BASE}/db_Creatures.json`),
    getJson(`${BLUEPRINT_BASE}/db_Buildings.json`),
    getJson(`${BLUEPRINT_BASE}/db_Spells.json`)
  ]);

  state.creatures = creatures
    .filter((card) => isPlayableBlueprint(card))
    .map((card) => normalizeCard(card, "creature"));
  state.buildings = buildings
    .filter((card) => isPlayableBlueprint(card))
    .map((card) => normalizeCard(card, "building"));
  state.spells = spells
    .filter((card) => isPlayableBlueprint(card))
    .map((card) => normalizeCard(card, "spell"));

  state.catalog = [...state.creatures, ...state.buildings, ...state.spells]
    .sort((a, b) => a.name.localeCompare(b.name));

  els.assetStats.innerHTML = `
    <span>${state.creatures.length} criaturas</span>
    <span>${state.buildings.length} predios</span>
    <span>${state.spells.length} spells</span>
  `;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

function isPlayableBlueprint(card) {
  if (!card || !card.ID || !card.SpriteName) return false;
  if (String(card.ID).includes("_GL_")) return false;
  if (String(card.Quality || "Standard") !== "Standard") return false;
  return Number.isFinite(Number(card.Cost || 0));
}

function normalizeCard(row, type) {
  const faction = normalizeFaction(row.Faction);
  const cost = clamp(Math.floor(Number(row.Cost || 0)), 0, 9);
  const rarity = clamp(Math.floor(Number(row.Rarity || 1)), 1, 5);
  const atk = Math.max(0, Math.floor(Number(row.ATK || 0)));
  const def = Math.max(0, Math.floor(Number(row.DEF || 0)));
  const script = String(row.ScriptName || "");

  return {
    id: String(row.ID),
    type,
    name: humanCardName(row),
    spriteName: String(row.SpriteName),
    faction,
    cost,
    rarity,
    atk,
    def,
    script,
    floopCost: Math.max(0, Math.floor(Number(row.FloopCost || 0))),
    val1: Number(row.val1 || 0) || 0,
    val2: Number(row.val2 || 0) || 0,
    audioName: String(row.AudioName || ""),
    desc: makeReadableDescription(row, type),
    art: getCardArtPath(row, type, faction),
    sprite: getBoardSpritePath(row, type)
  };
}

function normalizeFaction(value) {
  const text = String(value || "Universal");
  return FACTIONS.includes(text) ? text : "Universal";
}

function humanCardName(row) {
  const source = String(row.SpriteName || row.ID || "Card")
    .replace(/^Creature_GL_/, "Creature_")
    .replace(/^Building_XMAS_/, "Building_")
    .replace(/^Spell_XMAS_/, "Spell_")
    .replace(/^(Creature|Building|Spell)_/, "")
    .replace(/^GL_/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return source
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and");
}

function makeReadableDescription(row, type) {
  const script = String(row.ScriptName || "");
  const val1 = Number(row.val1 || 0) || 0;
  const val2 = Number(row.val2 || 0) || 0;

  if (type === "creature") {
    if (!script) return "Criatura pronta para ocupar uma lane.";
    if (/Heal/i.test(script)) return `Floop/efeito de cura ${val1 || val2 || 3}.`;
    if (/Draw|Card/i.test(script)) return `Floop/efeito ligado a cartas.`;
    if (/ATK|DEF|Bonus/i.test(script)) return `Floop/efeito de bonus ${val1 || ""}${val2 ? `/${val2}` : ""}.`;
    if (/Damage|Attack|Lower|Reduce/i.test(script)) return `Floop/efeito de pressao no alvo.`;
    if (/Destroy|Return|Move/i.test(script)) return "Floop/efeito de controle de lane.";
    return `Floop: ${script}.`;
  }

  if (type === "building") {
    if (/ATKDEF/i.test(script)) return `Predio de bonus ATK/DEF ${val1 || 0}/${val2 || val1 || 0}.`;
    if (/ATK/i.test(script)) return `Predio de bonus de ataque ${val1 || 1}.`;
    if (/DEF/i.test(script)) return `Predio de bonus de defesa ${val1 || 1}.`;
    if (/Heal/i.test(script)) return `Predio de cura ${val1 || 2}.`;
    return `Predio: ${script || "suporte de lane"}.`;
  }

  if (/Draw|Random|Shuffle/i.test(script)) return `Compre cartas.`;
  if (/Heal/i.test(script)) return `Cura uma criatura ou o heroi.`;
  if (/Drain/i.test(script)) return `Drena vida do inimigo.`;
  if (/Destroy|Return|Move/i.test(script)) return `Controla a lane alvo.`;
  if (/Attack|Damage|Reduce|Lower/i.test(script)) return `Causa dano ou reduz atributos.`;
  return `Spell: ${script || "efeito rapido"}.`;
}

function getCardArtPath(row, type, faction) {
  const file = `${encodeURIComponent(String(row.SpriteName))}.png`;
  if (type === "building") return `${CARDART_BASE}/buildings/${file}`;
  if (type === "spell") return `${CARDART_BASE}/spells/${file}`;
  return `${CARDART_BASE}/creatures/${String(faction || "Universal").toLowerCase()}/${file}`;
}

function getBoardSpritePath(row, type) {
  const raw = String(row.SpriteName || row.ID || "");
  const cleaned = raw
    .replace(/^Creature_/, "")
    .replace(/^Building_/, "")
    .replace(/^Spell_/, "")
    .replace(/^GL_/, "");
  const file = type === "spell" ? raw : cleaned;
  return `${TOKEN_BASE}/${encodeURIComponent(file)}.png`;
}

function startNewGame() {
  if (!state.loaded) return;

  const faction = els.deckFaction.value || "Mixed";
  const cpuFaction = pick(FACTIONS);
  state.uid = 1;
  state.actor = "player";
  state.turn = 0;
  state.selectedCardUid = null;
  state.selectedLane = 0;
  state.selectedTargetLane = 0;
  state.busy = false;
  state.winner = null;
  state.log = [];
  state.player = makeCombatant("Voce", faction);
  state.cpu = makeCombatant("CPU", cpuFaction);
  drawCards(state.player, 5);
  drawCards(state.cpu, 5);
  startTurn("player", { skipDraw: true });
  logEvent(`Partida aberta: ${FACTION_NAMES[faction]} contra ${FACTION_NAMES[cpuFaction]}.`);
  setStatus("Sua vez.");
  render();
}

function makeCombatant(name, faction) {
  const deck = buildDeck(faction);
  return {
    name,
    faction,
    hp: 45,
    maxHp: 45,
    actions: 0,
    nextActions: 2,
    deck,
    hand: [],
    discard: [],
    lanes: Array.from({ length: 4 }, (_, index) => ({
      id: index,
      landscape: faction === "Mixed" ? pick(FACTIONS) : (index % 3 === 0 ? pick(FACTIONS) : faction),
      creature: null,
      building: null
    }))
  };
}

function buildDeck(faction) {
  const factionMatch = (card) => faction === "Mixed" || card.faction === faction || card.faction === "Universal";
  const preferredCreatures = state.creatures.filter(factionMatch);
  const preferredBuildings = state.buildings.filter(factionMatch);
  const creatures = weightedPool(preferredCreatures.length ? preferredCreatures : state.creatures, 24);
  const spells = weightedPool(state.spells, 8);
  const buildings = weightedPool(preferredBuildings.length ? preferredBuildings : state.buildings, 8);
  return shuffle([...creatures, ...spells, ...buildings].map((card) => ({ ...card })));
}

function weightedPool(pool, count) {
  const available = pool.filter((card) => card.cost <= 5);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const roll = Math.random();
    let candidates = available;
    if (roll < 0.46) candidates = available.filter((card) => card.rarity <= 2);
    else if (roll < 0.82) candidates = available.filter((card) => card.rarity <= 4);
    if (!candidates.length) candidates = available;
    result.push(pick(candidates));
  }
  return result;
}

function startTurn(actor, options = {}) {
  state.actor = actor;
  const combatant = getCombatant(actor);
  if (actor === "player") state.turn += 1;

  combatant.actions = clamp(2 + Math.floor(state.turn / 2), 2, 7);
  combatant.nextActions = combatant.actions;
  resetCreatures(combatant);
  applyStartTurnBuildings(combatant);
  if (!options.skipDraw) drawCards(combatant, 1);

  if (actor === "player") {
    state.busy = false;
    state.selectedCardUid = combatant.hand[0]?.uid || null;
    setStatus("Sua vez.");
  } else {
    state.busy = true;
    setStatus("CPU pensando...");
  }
  render();
}

function resetCreatures(combatant) {
  combatant.lanes.forEach((lane) => {
    if (lane.creature) lane.creature.flooped = false;
  });
}

function applyStartTurnBuildings(combatant) {
  combatant.lanes.forEach((lane) => {
    const building = lane.building?.card;
    const creature = lane.creature;
    if (!building || !creature) return;
    if (/StartTurnHeal|Heal/i.test(building.script)) {
      healCreature(creature, building.val1 || 2);
      logEvent(`${combatant.name}: ${building.name} curou ${creature.card.name}.`);
    }
  });
}

function drawCards(combatant, amount) {
  for (let index = 0; index < amount; index += 1) {
    if (!combatant.deck.length) {
      if (!combatant.discard.length) return;
      combatant.deck = shuffle(combatant.discard.splice(0).map((card) => ({ ...card })));
      logEvent(`${combatant.name} reciclou o descarte.`);
    }
    const card = combatant.deck.shift();
    combatant.hand.push({ ...card, uid: state.uid++ });
  }
}

function playSelectedCard() {
  if (!canPlayerAct()) return;
  const card = state.player.hand.find((item) => item.uid === state.selectedCardUid);
  if (!card) {
    setStatus("Escolha uma carta da mao.");
    return;
  }
  playCardFromHand(state.player, state.cpu, card.uid, state.selectedLane, state.selectedTargetLane, "player");
  render();
}

function playCardFromHand(actor, enemy, uid, ownLaneIndex, targetLaneIndex, actorKey) {
  const handIndex = actor.hand.findIndex((item) => item.uid === uid);
  if (handIndex < 0) return false;
  const card = actor.hand[handIndex];
  if (actor.actions < card.cost) {
    if (actorKey === "player") setStatus("Acoes insuficientes.");
    return false;
  }

  const lane = actor.lanes[ownLaneIndex] || actor.lanes[0];
  const targetLane = enemy.lanes[targetLaneIndex] || enemy.lanes[0];

  if (card.type === "creature" && lane.creature) {
    if (actorKey === "player") setStatus("Essa lane ja tem criatura.");
    return false;
  }

  actor.actions -= card.cost;
  actor.hand.splice(handIndex, 1);

  if (card.type === "creature") {
    lane.creature = makeCreatureInstance(card);
    logEvent(`${actor.name} jogou ${card.name} na lane ${ownLaneIndex + 1}.`);
    playCardSound(card, "creature");
  } else if (card.type === "building") {
    if (lane.building) actor.discard.push(lane.building.card);
    lane.building = makeBuildingInstance(card);
    logEvent(`${actor.name} construiu ${card.name} na lane ${ownLaneIndex + 1}.`);
    playSound("building");
  } else {
    resolveSpell(card, actor, enemy, lane, targetLane);
    actor.discard.push(card);
    playSound("spell");
  }

  if (actorKey === "player") {
    state.selectedCardUid = actor.hand[0]?.uid || null;
  }
  checkWinner();
  return true;
}

function makeCreatureInstance(card) {
  return {
    card,
    atk: card.atk,
    def: card.def,
    maxDef: card.def,
    flooped: false
  };
}

function makeBuildingInstance(card) {
  return { card };
}

function resolveSpell(card, actor, enemy, ownLane, targetLane) {
  const script = card.script;
  const amount = Math.max(2, card.val1 || card.val2 || card.rarity + card.cost);
  const targetCreature = targetLane.creature;
  const ownCreature = ownLane.creature;

  if (/Draw|Random|Shuffle/i.test(script)) {
    const cards = clamp(card.val1 || 2, 1, 4);
    drawCards(actor, cards);
    logEvent(`${actor.name} usou ${card.name} e comprou ${cards}.`);
    return;
  }

  if (/DrainOpponentHealth/i.test(script)) {
    damageHero(enemy, amount);
    healHero(actor, amount);
    logEvent(`${actor.name} drenou ${amount} com ${card.name}.`);
    return;
  }

  if (/HealHero/i.test(script)) {
    healHero(actor, amount);
    logEvent(`${actor.name} recuperou ${amount} HP com ${card.name}.`);
    return;
  }

  if (/Heal/i.test(script)) {
    if (ownCreature) {
      healCreature(ownCreature, amount + 2);
      logEvent(`${actor.name} curou ${ownCreature.card.name} com ${card.name}.`);
    } else {
      healHero(actor, amount);
      logEvent(`${actor.name} curou o heroi com ${card.name}.`);
    }
    return;
  }

  if (/Destroy.*Building|MoveBuilding|BlockCardBuilding|Volcano/i.test(script)) {
    if (targetLane.building) {
      enemy.discard.push(targetLane.building.card);
      logEvent(`${actor.name} removeu ${targetLane.building.card.name} com ${card.name}.`);
      targetLane.building = null;
    } else {
      damageHero(enemy, amount);
      logEvent(`${actor.name} acertou o heroi com ${card.name}.`);
    }
    return;
  }

  if (/Return|Portal|Teleport|Door/i.test(script)) {
    if (targetCreature) {
      enemy.discard.push(targetCreature.card);
      logEvent(`${actor.name} mandou ${targetCreature.card.name} para descarte com ${card.name}.`);
      targetLane.creature = null;
    } else {
      damageHero(enemy, amount);
      logEvent(`${actor.name} abriu passagem para ${amount} de dano.`);
    }
    return;
  }

  if (/SwapATKDEF/i.test(script) && targetCreature) {
    const oldAtk = targetCreature.atk;
    targetCreature.atk = targetCreature.def;
    targetCreature.def = oldAtk;
    targetCreature.maxDef = Math.max(targetCreature.maxDef, targetCreature.def);
    logEvent(`${actor.name} inverteu ATK/DEF de ${targetCreature.card.name}.`);
    return;
  }

  if (/ReduceDEF|Attack|Damage|Lower|Destroy/i.test(script)) {
    if (targetCreature) {
      damageCreature(enemy, targetLane, amount + card.rarity, `${actor.name} usou ${card.name}`);
    } else {
      damageHero(enemy, amount + card.rarity);
      logEvent(`${actor.name} causou ${amount + card.rarity} no heroi com ${card.name}.`);
    }
    return;
  }

  if (ownCreature) {
    ownCreature.atk += Math.max(1, card.rarity);
    ownCreature.maxDef += Math.max(1, card.rarity);
    ownCreature.def += Math.max(1, card.rarity);
    logEvent(`${actor.name} fortaleceu ${ownCreature.card.name} com ${card.name}.`);
  } else {
    damageHero(enemy, amount);
    logEvent(`${actor.name} improvisou ${card.name} para ${amount} de dano.`);
  }
}

function floopSelectedCreature() {
  if (!canPlayerAct()) return;
  const lane = state.player.lanes[state.selectedLane];
  if (!lane?.creature) {
    setStatus("Selecione uma criatura sua.");
    return;
  }
  useFloop(state.player, state.cpu, lane, state.cpu.lanes[state.selectedTargetLane], "player");
  render();
}

function useFloop(actor, enemy, lane, targetLane, actorKey) {
  const creature = lane.creature;
  if (!creature || creature.flooped) {
    if (actorKey === "player") setStatus("Essa criatura ja floopou.");
    return false;
  }
  const cost = clamp(creature.card.floopCost || 1, 1, 5);
  if (actor.actions < cost) {
    if (actorKey === "player") setStatus("Acoes insuficientes para floop.");
    return false;
  }

  actor.actions -= cost;
  creature.flooped = true;
  const script = creature.card.script;
  const amount = Math.max(2, creature.card.val1 || creature.card.val2 || creature.card.rarity + 1);
  const targetCreature = targetLane?.creature;

  if (/Draw|Card/i.test(script)) {
    const cards = clamp(creature.card.val1 || 1, 1, 3);
    drawCards(actor, cards);
    logEvent(`${actor.name} floopou ${creature.card.name} e comprou ${cards}.`);
  } else if (/HealHero/i.test(script)) {
    healHero(actor, amount);
    logEvent(`${actor.name} floopou ${creature.card.name} para curar ${amount}.`);
  } else if (/Heal/i.test(script)) {
    healCreature(creature, amount + 2);
    logEvent(`${actor.name} floopou ${creature.card.name} e recuperou defesa.`);
  } else if (/Bonus|ATK|DEF/i.test(script) && !/Lower|Reduce|Damage|Attack/i.test(script)) {
    const atkGain = /ATK/i.test(script) ? Math.max(1, creature.card.val1 || 2) : 1;
    const defGain = /DEF/i.test(script) ? Math.max(1, creature.card.val2 || creature.card.val1 || 2) : 1;
    creature.atk += atkGain;
    creature.maxDef += defGain;
    creature.def += defGain;
    logEvent(`${actor.name} floopou ${creature.card.name}: +${atkGain}/+${defGain}.`);
  } else if (/Return|Destroy|Move/i.test(script) && targetCreature) {
    enemy.discard.push(targetCreature.card);
    targetLane.creature = null;
    logEvent(`${actor.name} floopou ${creature.card.name} e removeu ${targetCreature.card.name}.`);
  } else if (/LowerATK|Reduce/i.test(script) && targetCreature) {
    targetCreature.atk = Math.max(0, targetCreature.atk - amount);
    logEvent(`${actor.name} floopou ${creature.card.name} e reduziu ATK do alvo.`);
  } else if (/Action|MP/i.test(script)) {
    actor.actions += clamp(amount, 1, 4);
    logEvent(`${actor.name} floopou ${creature.card.name} e ganhou acoes.`);
  } else if (targetCreature) {
    damageCreature(enemy, targetLane, amount + Math.ceil(creature.atk / 3), `${actor.name} floopou ${creature.card.name}`);
  } else {
    damageHero(enemy, amount + Math.ceil(creature.atk / 3));
    logEvent(`${actor.name} floopou ${creature.card.name} no heroi.`);
  }

  playCardSound(creature.card, "spell");
  checkWinner();
  return true;
}

function playerBattleAndPass() {
  if (!canPlayerAct()) return;
  executeBattle(state.player, state.cpu);
  if (checkWinner()) {
    render();
    return;
  }
  state.busy = true;
  render();
  window.setTimeout(cpuTurn, 650);
}

function cpuTurn() {
  if (state.winner) return;
  startTurn("cpu");
  window.setTimeout(() => {
    runCpuPlays();
    executeBattle(state.cpu, state.player);
    if (!checkWinner()) {
      window.setTimeout(() => startTurn("player"), 700);
    }
    render();
  }, 650);
}

function runCpuPlays() {
  const cpu = state.cpu;
  const player = state.player;
  let guard = 0;

  while (guard < 8) {
    guard += 1;
    const move = chooseCpuMove(cpu, player);
    if (!move) break;
    playCardFromHand(cpu, player, move.card.uid, move.ownLane, move.targetLane, "cpu");
  }

  const floopLane = cpu.lanes
    .map((lane, index) => ({ lane, index }))
    .filter((item) => item.lane.creature && !item.lane.creature.flooped)
    .filter((item) => cpu.actions >= clamp(item.lane.creature.card.floopCost || 1, 1, 5))
    .sort((a, b) => b.lane.creature.card.rarity - a.lane.creature.card.rarity)[0];

  if (floopLane && Math.random() > 0.35) {
    useFloop(cpu, player, floopLane.lane, player.lanes[pickTargetLane(player)], "cpu");
  }
}

function chooseCpuMove(cpu, player) {
  const playable = cpu.hand
    .filter((card) => card.cost <= cpu.actions)
    .sort((a, b) => scoreCpuCard(b, cpu) - scoreCpuCard(a, cpu));

  for (const card of playable) {
    if (card.type === "creature") {
      const laneIndex = bestEmptyLaneForCpu(cpu, card);
      if (laneIndex >= 0) return { card, ownLane: laneIndex, targetLane: pickTargetLane(player) };
      continue;
    }

    if (card.type === "building") {
      const laneIndex = bestBuildingLaneForCpu(cpu);
      if (laneIndex >= 0) return { card, ownLane: laneIndex, targetLane: pickTargetLane(player) };
      continue;
    }

    return { card, ownLane: bestOwnLane(cpu), targetLane: pickTargetLane(player) };
  }

  return null;
}

function scoreCpuCard(card, cpu) {
  let score = card.cost * 4 + card.rarity;
  if (card.type === "creature") score += card.atk + card.def / 4;
  if (card.type === "building") score += cpu.lanes.some((lane) => lane.creature && !lane.building) ? 10 : 0;
  if (card.type === "spell") score += 8;
  return score;
}

function bestEmptyLaneForCpu(cpu, card) {
  let best = -1;
  let bestScore = -Infinity;
  cpu.lanes.forEach((lane, index) => {
    if (lane.creature) return;
    const match = lane.landscape === card.faction ? 4 : 0;
    const score = match + (lane.building ? 2 : 0) + Math.random();
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function bestBuildingLaneForCpu(cpu) {
  const lanes = cpu.lanes
    .map((lane, index) => ({ lane, index }))
    .filter((item) => !item.lane.building)
    .sort((a, b) => Number(Boolean(b.lane.creature)) - Number(Boolean(a.lane.creature)));
  return lanes[0]?.index ?? -1;
}

function bestOwnLane(actor) {
  const creatureLane = actor.lanes.findIndex((lane) => lane.creature);
  return creatureLane >= 0 ? creatureLane : 0;
}

function pickTargetLane(enemy) {
  const occupied = enemy.lanes
    .map((lane, index) => ({ lane, index }))
    .filter((item) => item.lane.creature)
    .sort((a, b) => b.lane.creature.atk - a.lane.creature.atk);
  return occupied[0]?.index ?? Math.floor(Math.random() * enemy.lanes.length);
}

function executeBattle(actor, enemy) {
  logEvent(`${actor.name} iniciou combate.`);
  actor.lanes.forEach((lane, index) => {
    const creature = lane.creature;
    if (!creature) return;
    const attack = getEffectiveAttack(lane);
    const targetLane = enemy.lanes[index];

    if (targetLane.creature) {
      damageCreature(enemy, targetLane, attack, `${creature.card.name} atacou`);
    } else {
      damageHero(enemy, attack);
      logEvent(`${creature.card.name} bateu direto: ${attack}.`);
    }
  });
  playSound("hit");
}

function getEffectiveAttack(lane) {
  if (!lane.creature) return 0;
  let value = lane.creature.atk;
  if (lane.creature.card.faction === lane.landscape) value += 1;
  if (lane.building) {
    const card = lane.building.card;
    if (/ATKDEF|ATK/i.test(card.script)) value += Math.max(1, card.val1 || 1);
  }
  return Math.max(0, value);
}

function getEffectiveDefense(lane) {
  if (!lane.creature) return 0;
  let value = lane.creature.def;
  if (lane.creature.card.faction === lane.landscape) value += 1;
  if (lane.building) {
    const card = lane.building.card;
    if (/ATKDEF/i.test(card.script)) value += Math.max(1, card.val2 || card.val1 || 1);
    else if (/DEF/i.test(card.script)) value += Math.max(1, card.val1 || 1);
  }
  return Math.max(0, value);
}

function damageCreature(owner, lane, amount, prefix) {
  if (!lane.creature) return;
  lane.creature.def -= amount;
  if (lane.creature.def <= 0) {
    owner.discard.push(lane.creature.card);
    logEvent(`${prefix}: ${lane.creature.card.name} caiu.`);
    lane.creature = null;
  } else {
    logEvent(`${prefix}: ${amount} de dano em ${lane.creature.card.name}.`);
  }
}

function healCreature(creature, amount) {
  creature.def = Math.min(creature.maxDef, creature.def + amount);
}

function damageHero(combatant, amount) {
  combatant.hp = Math.max(0, combatant.hp - amount);
}

function healHero(combatant, amount) {
  combatant.hp = Math.min(combatant.maxHp, combatant.hp + amount);
}

function checkWinner() {
  if (state.player.hp <= 0 || state.cpu.hp <= 0) {
    state.winner = state.player.hp > state.cpu.hp ? "player" : "cpu";
  }
  if (!state.winner && state.player.deck.length === 0 && state.player.hand.length === 0) state.winner = "cpu";
  if (!state.winner && state.cpu.deck.length === 0 && state.cpu.hand.length === 0) state.winner = "player";
  if (!state.winner) return false;

  state.busy = false;
  state.actor = "done";
  if (state.winner === "player") {
    setStatus("Vitoria. O Dweeb Cup ficou longe hoje.");
    logEvent("Voce venceu a partida.");
    playSound("win");
  } else {
    setStatus("Derrota. A CPU levou essa.");
    logEvent("CPU venceu a partida.");
    playSound("lose");
  }
  return true;
}

function render() {
  renderHud();
  renderLanes();
  renderHand();
  renderLog();
  renderControls();
  document.body.classList.toggle("is-thinking", state.busy);
}

function renderHud() {
  els.turnBadge.textContent = state.winner
    ? "Fim"
    : state.actor === "player"
      ? `Turno ${state.turn} | Voce`
      : `Turno ${state.turn} | CPU`;

  els.playerHero.textContent = `${state.player.hp} HP`;
  els.cpuHero.textContent = `${state.cpu.hp} HP`;
  els.playerActions.textContent = state.player.actions;
  els.cpuActions.textContent = state.cpu.actions;
  els.playerDeck.textContent = `${state.player.deck.length} deck`;
  els.cpuDeck.textContent = `${state.cpu.deck.length} deck`;
  els.playerDiscard.textContent = `${state.player.discard.length} descarte`;
  els.cpuDiscard.textContent = `${state.cpu.discard.length} descarte`;
}

function renderLanes() {
  els.enemyLanes.innerHTML = state.cpu.lanes.map((lane, index) => renderLane(lane, index, "enemy")).join("");
  els.playerLanes.innerHTML = state.player.lanes.map((lane, index) => renderLane(lane, index, "player")).join("");

  els.enemyLanes.querySelectorAll(".lane").forEach((laneEl) => {
    laneEl.addEventListener("click", () => {
      if (state.busy || state.winner) return;
      state.selectedTargetLane = Number(laneEl.dataset.index);
      render();
    });
  });
  els.playerLanes.querySelectorAll(".lane").forEach((laneEl) => {
    laneEl.addEventListener("click", () => {
      if (state.busy || state.winner) return;
      state.selectedLane = Number(laneEl.dataset.index);
      render();
    });
  });
}

function renderLane(lane, index, side) {
  const selectedClass = side === "player" && state.selectedLane === index ? " is-selected" : "";
  const targetClass = side === "enemy" && state.selectedTargetLane === index ? " is-targeted" : "";
  return `
    <article class="lane${selectedClass}${targetClass}" data-index="${index}" style="--lane-color:${FACTION_COLORS[lane.landscape] || FACTION_COLORS.Universal}">
      <div class="lane-head">
        <span>${escapeHtml(FACTION_NAMES[lane.landscape] || lane.landscape)}</span>
        <span>Lane ${index + 1}</span>
      </div>
      ${lane.creature ? renderBoardCard(lane.creature, lane) : `<div class="empty-slot">Vazia</div>`}
      ${lane.building ? renderBuilding(lane.building) : ""}
    </article>
  `;
}

function renderBoardCard(instance, lane) {
  const card = instance.card;
  const flooped = instance.flooped ? " is-flooped" : "";
  return `
    <div class="board-creature${flooped}" title="${escapeHtml(card.name)}">
      <span class="board-title">${escapeHtml(card.name)}</span>
      <div class="board-sprite">
        ${renderSpriteImage(card.sprite, card.art, card.name)}
        <span class="board-stats">
          <span class="stat-disc atk">${getEffectiveAttack(lane)}</span>
          <span class="stat-disc hp">${getEffectiveDefense(lane)}</span>
          <span class="stat-disc def">${instance.maxDef}</span>
        </span>
      </div>
    </div>
  `;
}

function renderBuilding(instance) {
  const card = instance.card;
  return `
    <div class="board-building" title="${escapeHtml(card.name)}">
      ${renderSpriteImage(card.sprite, card.art, card.name)}
    </div>
  `;
}

function renderHand() {
  if (!state.player.hand.length) {
    els.hand.innerHTML = `<div class="empty-slot">Mao vazia</div>`;
    return;
  }

  const total = state.player.hand.length;
  els.hand.innerHTML = state.player.hand.map((card, index) => {
    const selected = state.selectedCardUid === card.uid ? " is-selected" : "";
    const fan = total > 1 ? (index - (total - 1) / 2) * 6 : 0;
    return `
      <button class="hand-card ${card.type}${selected}" type="button" data-uid="${card.uid}" data-cost="${card.cost}" style="--fan:${fan}deg">
        <div class="card-art">${renderImage(card.art, card.name)}</div>
        <div class="card-title" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</div>
        <div class="card-meta">
          <span>${escapeHtml(typeLabel(card.type))}</span>
          <span class="stat-pills">
            <span class="pill cost">${card.cost}</span>
            ${card.type === "creature" ? `<span class="pill atk">${card.atk}</span><span class="pill def">${card.def}</span>` : `<span class="rarity r${card.rarity}">${card.rarity}</span>`}
          </span>
        </div>
        <div class="card-desc">${escapeHtml(card.desc)}</div>
      </button>
    `;
  }).join("");

  els.hand.querySelectorAll(".hand-card").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.busy || state.winner) return;
      state.selectedCardUid = Number(button.dataset.uid);
      render();
    });
  });
}

function renderControls() {
  const card = state.player.hand.find((item) => item.uid === state.selectedCardUid);
  const lane = state.player.lanes[state.selectedLane];
  const canAct = canPlayerAct();
  els.playCardBtn.disabled = !canAct || !card || card.cost > state.player.actions;
  els.floopBtn.disabled = !canAct || !lane?.creature || lane.creature.flooped || state.player.actions < clamp(lane.creature.card.floopCost || 1, 1, 5);
  els.battleBtn.disabled = !canAct;
}

function renderCatalog() {
  const query = els.cardSearch.value.trim().toLowerCase();
  const filter = els.catalogFilter.value;
  const list = state.catalog
    .filter((card) => filter === "all" || card.type === filter)
    .filter((card) => !query || `${card.name} ${card.faction} ${card.script}`.toLowerCase().includes(query))
    .slice(0, 90);

  els.catalog.innerHTML = list.map((card) => `
    <article class="catalog-item">
      ${renderImage(card.art, card.name)}
      <div class="catalog-name">
        <strong title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</strong>
        <span>${escapeHtml(typeLabel(card.type))} | ${escapeHtml(FACTION_NAMES[card.faction] || card.faction)} | custo ${card.cost}</span>
      </div>
      <span class="rarity r${card.rarity}">${card.rarity}</span>
    </article>
  `).join("") || `<div class="empty-slot">Nenhuma carta</div>`;
}

function renderLog() {
  els.eventLog.innerHTML = state.log.slice(-28).reverse().map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
}

function renderImage(src, alt) {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.replaceWith(document.getElementById('missingArtTemplate').content.firstElementChild.cloneNode(true))">`;
}

function renderSpriteImage(src, fallback, alt) {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'">`;
}

function canPlayerAct() {
  return state.loaded && !state.busy && !state.winner && state.actor === "player";
}

function getCombatant(actor) {
  return actor === "player" ? state.player : state.cpu;
}

function playCardSound(card, fallback) {
  if (card.audioName) {
    const audio = makeAudio(`${card.audioName}.wav`);
    playAudio(audio, () => playSound(fallback));
    return;
  }
  playSound(fallback);
}

function playSound(name) {
  playAudio(sounds[name]);
}

function playAudio(audio, onError) {
  if (!state.sound || !audio) return;
  try {
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise?.catch) promise.catch(() => onError?.());
  } catch {
    onError?.();
  }
}

function makeAudio(file) {
  const audio = new Audio(`${AUDIO_BASE}/${encodeURIComponent(file)}`);
  audio.preload = "auto";
  audio.volume = 0.42;
  return audio;
}

function typeLabel(type) {
  if (type === "creature") return "Criatura";
  if (type === "building") return "Predio";
  return "Spell";
}

function logEvent(message) {
  state.log.push(message);
  if (state.log.length > 80) state.log.shift();
}

function setStatus(message) {
  els.statusLine.textContent = message;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
