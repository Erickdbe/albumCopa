(function () {
    var params = new URLSearchParams(window.location.search);
    var roomId = params.get("room");
    if (!roomId) return;

    var token = localStorage.getItem("mp_token") || "";
    var socket = null;
    var session = null;
    var localUserId = null;
    var remotePlayers = {};
    var lastSentAt = 0;
    var lastLocalPosition = null;
    var startedOnline = false;

    function createOverlay() {
        var style = document.createElement("style");
        style.textContent = [
            "#cs16OnlineHud{position:fixed;left:16px;bottom:16px;z-index:20;min-width:260px;max-width:min(460px,calc(100vw - 32px));padding:10px 12px;color:#f4d33d;background:rgba(2,18,38,.82);border:1px solid rgba(244,211,61,.5);font:700 13px Segoe UI,Arial,sans-serif;pointer-events:none}",
            "#cs16OnlineHud strong{display:block;margin-bottom:4px;color:#fff}",
            "#cs16OnlineHud .score{display:flex;gap:10px;flex-wrap:wrap;margin-top:7px}",
            "#cs16OnlineHud .score span{padding:3px 6px;background:rgba(0,0,0,.28)}",
            "#cs16OnlineHud .warn{color:#ff9b88}"
        ].join("");
        document.head.appendChild(style);

        var hud = document.createElement("div");
        hud.id = "cs16OnlineHud";
        hud.innerHTML = "<strong>Counter-Strike Online</strong><div id='cs16OnlineStatus'>Conectando...</div><div class='score' id='cs16OnlineScore'></div>";
        document.body.appendChild(hud);
    }

    function setStatus(text, warn) {
        var el = document.getElementById("cs16OnlineStatus");
        if (!el) return;
        el.className = warn ? "warn" : "";
        el.textContent = text;
    }

    function updateScore(score) {
        var el = document.getElementById("cs16OnlineScore");
        if (!el || !score || !Array.isArray(score.players)) return;
        el.innerHTML = score.players.map(function (playerInfo) {
            var name = escapeHtml(playerInfo.username || "Player");
            var life = Math.max(0, Math.round(playerInfo.health || 0));
            return "<span>" + name + " " + (playerInfo.team === "terrorists" ? "TR" : "CT") + " | " +
                (playerInfo.kills || 0) + "/" + (playerInfo.deaths || 0) + " | " + life + "hp</span>";
        }).join("");
    }

    function waitForGameReady() {
        return new Promise(function (resolve) {
            var timer = setInterval(function () {
                if (window.globalScene && window.camera && window.player && window.guerilla && window.guerillaSkeleton && window.deagle) {
                    clearInterval(timer);
                    resolve();
                }
            }, 120);
        });
    }

    function connect() {
        if (!token) {
            setStatus("Sessao expirada. Volte ao Album e faca login.", true);
            return;
        }

        socket = io(window.location.origin, { auth: { token: token } });
        socket.on("connect", function () {
            setStatus("Entrando na sala...");
            socket.emit("cs16:resume", { roomId: roomId });
        });
        socket.on("connect_error", function () {
            setStatus("Nao foi possivel conectar no lobby do Album.", true);
        });
        socket.on("cs16:session", onSession);
        socket.on("cs16:state", onRemoteState);
        socket.on("cs16:shot", onRemoteShot);
        socket.on("cs16:hit", onHit);
        socket.on("cs16:respawn", onRespawn);
        socket.on("cs16:opponent-status", function (payload) {
            if (payload && payload.message) setStatus(payload.message);
        });
        socket.on("cs16:cancelled", function (payload) {
            setStatus((payload && payload.message) || "Partida encerrada.", true);
        });
        socket.on("cs16:error", function (message) {
            setStatus(message || "Erro na sala online.", true);
        });
    }

    function onSession(payload) {
        session = payload;
        localUserId = Number(payload.playerId);
        setStatus("Partida contra " + payload.opponentUsername + ".");
        updateScore(payload.score);
        startOnlineRound();
        (payload.players || []).forEach(function (playerInfo) {
            if (Number(playerInfo.userId) !== localUserId) ensureRemotePlayer(playerInfo);
        });
    }

    function startOnlineRound() {
        if (startedOnline) return;
        startedOnline = true;
        if (window.menuControlsPanel) menuControlsPanel.isVisible = false;
        if (!gameStarted && typeof startPlaying === "function") {
            try { startPlaying(); } catch (_) { gameStarted = true; }
        }
        gameStarted = true;
        respawn = true;
        if (session && session.role === "guest") {
            camera.position = new BABYLON.Vector3(1000, 54, -1200);
            camera.setTarget(new BABYLON.Vector3(0, 27, 0));
        }
        globalScene.registerBeforeRender(updateRemotePlayers);
        setInterval(sendLocalState, 55);
    }

    function ensureRemotePlayer(playerInfo) {
        var id = Number(playerInfo.userId);
        if (remotePlayers[id]) return remotePlayers[id];

        var mesh = guerilla.clone("cs16 remote " + id);
        mesh.setEnabled(true);
        mesh.position = new BABYLON.Vector3(0, 150, 0);
        mesh.skeleton = guerillaSkeleton.clone("cs16 remote skeleton " + id);
        mesh.checkCollisions = true;
        mesh.ellipsoid = new BABYLON.Vector3(15, 30, 15);
        mesh.cs16RemoteUserId = id;

        var weapon = deagle.clone("cs16 remote weapon " + id);
        weapon.setEnabled(true);
        weapon.scaling = new BABYLON.Vector3(.8, .8, .8);
        weapon.rotation.y += Math.PI / 2;
        weapon.rotation.z += Math.PI / 2;
        weapon.rotation.x += .1;
        weapon.position.x += 5;
        weapon.position.z += 1;
        weapon.position.y -= .1;
        weapon.cs16RemoteUserId = id;
        if (mesh.skeleton.bones[20]) weapon.attachToBone(mesh.skeleton.bones[20], mesh);

        var head = BABYLON.MeshBuilder.CreateBox("cs16 remote head " + id, { width: 15, height: 15, depth: 15 }, globalScene);
        head.visibility = false;
        head.cs16RemoteUserId = id;
        head.cs16Headshot = true;
        if (mesh.skeleton.bones[7]) head.attachToBone(mesh.skeleton.bones[7], mesh);
        head.parent = mesh;

        var label = makeNameLabel(playerInfo.username || "Player", playerInfo.team);
        label.parent = mesh;
        label.position.y = 74;

        remotePlayers[id] = {
            id: id,
            username: playerInfo.username || "Player",
            team: playerInfo.team,
            mesh: mesh,
            weapon: weapon,
            head: head,
            label: label,
            health: playerInfo.health || 100,
            target: null,
            activeAnim: null,
            activeAnimName: ""
        };
        animateRemote(remotePlayers[id], "idle");
        return remotePlayers[id];
    }

    function makeNameLabel(name, team) {
        var texture = new BABYLON.DynamicTexture("cs16 name " + name, { width: 512, height: 128 }, globalScene, true);
        var ctx = texture.getContext();
        ctx.clearRect(0, 0, 512, 128);
        ctx.fillStyle = team === "terrorists" ? "#f2ca52" : "#74b9ff";
        ctx.font = "bold 54px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(name.slice(0, 18), 256, 78);
        texture.update();

        var material = new BABYLON.StandardMaterial("cs16 name mat " + name, globalScene);
        material.diffuseTexture = texture;
        material.diffuseTexture.hasAlpha = true;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.backFaceCulling = false;

        var plane = BABYLON.MeshBuilder.CreatePlane("cs16 name label " + name, { width: 120, height: 30 }, globalScene);
        plane.material = material;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;
        return plane;
    }

    function onRemoteState(payload) {
        if (!payload || Number(payload.userId) === localUserId) return;
        var remote = ensureRemotePlayer(payload);
        remote.target = payload.state;
        remote.health = payload.state.health;
        remote.mesh.setEnabled(payload.state.alive !== false);
        remote.weapon.setEnabled(payload.state.alive !== false);
        remote.label.setEnabled(payload.state.alive !== false);
        animateRemote(remote, payload.state.moving ? "run" : "idle");
    }

    function updateRemotePlayers() {
        Object.keys(remotePlayers).forEach(function (id) {
            var remote = remotePlayers[id];
            if (!remote.target) return;
            var target = new BABYLON.Vector3(remote.target.x, remote.target.y - 64, remote.target.z);
            remote.mesh.position = BABYLON.Vector3.Lerp(remote.mesh.position, target, 0.35);
            remote.mesh.rotation.y = remote.target.ry + Math.PI;
            if (remote.target.shooting) flashRemoteShot(remote);
        });
    }

    function animateRemote(remote, name) {
        if (!remote || remote.activeAnimName === name) return;
        if (remote.activeAnim) remote.activeAnim.stop();
        remote.activeAnimName = name;
        if (name === "run") remote.activeAnim = globalScene.beginAnimation(remote.mesh.skeleton, 130, 165, true, 1.8);
        else if (name === "die") remote.activeAnim = globalScene.beginAnimation(remote.mesh.skeleton, 695, 749, false, 1);
        else remote.activeAnim = globalScene.beginAnimation(remote.mesh.skeleton, 0, 64, true);
    }

    function sendLocalState() {
        if (!socket || !socket.connected || !session || !gameStarted || !camera || playerDied) return;
        var now = performance.now();
        if (now - lastSentAt < 50) return;
        lastSentAt = now;
        var moving = false;
        if (lastLocalPosition) moving = BABYLON.Vector3.Distance(lastLocalPosition, camera.position) > 0.8;
        lastLocalPosition = camera.position.clone();
        socket.emit("cs16:state", {
            roomId: roomId,
            state: {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                rx: camera.rotation.x,
                ry: camera.rotation.y,
                health: player.health,
                moving: moving,
                shooting: Boolean(player.fireButtonOn),
                alive: !playerDied
            }
        });
    }

    function onRemoteShot(payload) {
        var remote = payload && remotePlayers[Number(payload.userId)];
        if (remote) flashRemoteShot(remote);
    }

    function flashRemoteShot(remote) {
        if (!remote || remote.flashUntil && remote.flashUntil > performance.now()) return;
        remote.flashUntil = performance.now() + 120;
        var light = new BABYLON.PointLight("cs16 shot flash " + remote.id, remote.mesh.position.add(new BABYLON.Vector3(0, 40, 0)), globalScene);
        light.diffuse = new BABYLON.Color3(1, .72, .25);
        light.intensity = 2.2;
        setTimeout(function () { light.dispose(); }, 80);
    }

    function onHit(payload) {
        if (!payload) return;
        updateScore(payload.score);
        if (Number(payload.targetUserId) === localUserId) {
            player.health = Math.max(0, payload.health);
            if (window.health) health.text = Math.floor(player.health) + "";
            if (payload.killed) {
                playerDied = true;
                gameStarted = false;
                player.fireButtonOn = false;
                camera.inputs.clear();
                setStatus("Voce morreu. Respawn em instantes...", true);
            }
            return;
        }
        var remote = remotePlayers[Number(payload.targetUserId)];
        if (remote) {
            remote.health = payload.health;
            if (payload.killed) {
                animateRemote(remote, "die");
                remote.weapon.setEnabled(false);
                remote.label.setEnabled(false);
            }
        }
    }

    function onRespawn(payload) {
        if (!payload) return;
        updateScore(payload.score);
        if (Number(payload.userId) === localUserId) {
            player.health = 100;
            if (window.health) health.text = "100";
            playerDied = false;
            gameStarted = true;
            camera.inputs.addMouse();
            camera.inputs.addKeyboard();
            camera.position = session && session.role === "guest"
                ? new BABYLON.Vector3(1000, 54, -1200)
                : new BABYLON.Vector3(-1000, 54, 1200);
            setStatus("Voce voltou para a partida.");
            return;
        }
        var remote = remotePlayers[Number(payload.userId)];
        if (remote) {
            remote.health = 100;
            remote.mesh.setEnabled(true);
            remote.weapon.setEnabled(true);
            remote.label.setEnabled(true);
            animateRemote(remote, "idle");
        }
    }

    function handleLocalShot(pickInfo) {
        if (!socket || !socket.connected || !session || !pickInfo) return;
        socket.emit("cs16:shot", {
            roomId: roomId,
            origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z, rx: 0, ry: 0 },
            direction: { x: 0, y: 0, z: 1, rx: camera.rotation.x, ry: camera.rotation.y }
        });
        var mesh = pickInfo.pickedMesh;
        var targetUserId = mesh && mesh.cs16RemoteUserId;
        if (!targetUserId && mesh && mesh.parent) targetUserId = mesh.parent.cs16RemoteUserId;
        if (!targetUserId) return;
        socket.emit("cs16:hit", {
            roomId: roomId,
            targetUserId: targetUserId,
            damage: mesh.cs16Headshot ? 100 : 34,
            headshot: Boolean(mesh.cs16Headshot)
        });
    }

    function patchPlayerShoot() {
        if (typeof Player === "undefined" || Player.prototype.__cs16OnlinePatched) return;
        var originalShoot = Player.prototype.shoot;
        Player.prototype.shoot = function () {
            if (this.isReloading) return originalShoot.apply(this, arguments);
            var width = this.scene.getEngine().getRenderWidth();
            var height = this.scene.getEngine().getRenderHeight();
            var pickInfo = this.scene.pick(width / 2, height / 2, function (mesh) {
                return mesh.name !== "player box";
            }, false, this.camera);
            var result = originalShoot.apply(this, arguments);
            handleLocalShot(pickInfo);
            return result;
        };
        Player.prototype.__cs16OnlinePatched = true;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (char) {
            return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
        });
    }

    createOverlay();
    patchPlayerShoot();
    waitForGameReady().then(connect);
})();
