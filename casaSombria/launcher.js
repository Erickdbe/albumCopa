const statusText = document.getElementById("statusText");
const launchGame = document.getElementById("launchGame");
const buildPanel = document.getElementById("buildPanel");
const buildCommands = document.getElementById("buildCommands");
let statusTimer = null;

function setStatus(message, isReady = false) {
  statusText.textContent = message;
  launchGame.disabled = !isReady;
}

function renderBuildCommands(commands) {
  buildPanel.hidden = false;
  buildCommands.textContent = Array.isArray(commands) && commands.length
    ? commands.join("\n")
    : "cmake -S casaSombria/casaSombria -B casaSombria/casaSombria/build \"-DCMAKE_POLICY_VERSION_MINIMUM=3.5\"\ncmake --build casaSombria/casaSombria/build --config Release";
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/casa-sombria/status", { cache: "no-store" });
    const data = await response.json();

    if (data.available) {
      buildPanel.hidden = true;
      setStatus("Executavel encontrado. Pode abrir o jogo.", true);
      if (statusTimer) clearInterval(statusTimer);
      return;
    }

    setStatus("Executavel ainda nao encontrado. Compile o projeto para habilitar o launcher.");
    renderBuildCommands(data.build);
  } catch (error) {
    setStatus("Nao consegui consultar o servidor local.");
    renderBuildCommands();
  }
}

statusTimer = setInterval(refreshStatus, 5000);

launchGame.addEventListener("click", async () => {
  launchGame.disabled = true;
  statusText.textContent = "Abrindo Casa Sombria...";

  try {
    const response = await fetch("/api/casa-sombria/launch", { method: "POST" });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Nao foi possivel abrir o jogo.");
    }

    setStatus("Jogo aberto em uma janela separada.", true);
  } catch (error) {
    setStatus(error.message || "Nao foi possivel abrir o jogo.");
    refreshStatus();
  }
});

refreshStatus();
