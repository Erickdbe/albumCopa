"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRoomsModule } = require("../server/rooms");

class FakeSocket extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.username = id;
    this.broadcast = { emit() {} };
  }

  join() {}
  leave() {}
  to() {
    return { emit() {}, volatile: { emit() {} } };
  }
}

const sockets = new Map();
const io = {
  sockets: { sockets },
  to() { return { emit() {} }; },
  emit() {}
};
const rooms = createRoomsModule(io);
const host = new FakeSocket("host");
const guest = new FakeSocket("guest");
sockets.set(host.id, host);
sockets.set(guest.id, guest);
rooms.bindSocket(host);
rooms.bindSocket(guest);

host.emit("room:create", {
  username: "Host",
  classId: "sniper",
  settings: { mode: "ffa", mapId: "praia", maxPlayers: 4 }
});
const room = rooms.findRoomBySocket(host.id);
assert.ok(room, "room should be created");
guest.emit("room:join", { username: "Guest", roomId: room.roomId, classId: "rifle" });
host.emit("room:start");

const shooter = room.players.find((player) => player.socketId === host.id);
const target = room.players.find((player) => player.socketId === guest.id);
assert.ok(shooter && target, "both test players should be in the match");

function shoot(classId, hitZone) {
  shooter.classId = classId;
  shooter.alive = true;
  shooter.x = 0; shooter.y = 0; shooter.z = 0;
  shooter.lastShotAt.primary = 0;
  shooter.reloadUntil.primary = 0;
  shooter.chargeStartedAt = Date.now() - 2000;
  target.alive = true;
  target.health = 100;
  target.x = 0; target.y = 0; target.z = -5;
  host.emit("match:shoot", {
    slot: "primary",
    targetSocketId: target.socketId,
    hitZone,
    origin: { x: 0, y: 1.45, z: 0 },
    direction: { x: 0, y: 0, z: -1 }
  });
  return { health: target.health, alive: target.alive };
}

for (const classId of ["sniper", "archer", "crossbow"]) {
  const result = shoot(classId, "head");
  assert.equal(result.health, 0, `${classId} headshot should remove all health`);
  assert.equal(result.alive, false, `${classId} headshot should kill`);
}

const rifleHeadshot = shoot("rifle", "head");
assert.ok(rifleHeadshot.health > 0, "assault rifle headshot must not be an instant kill");
const sniperBodyShot = shoot("sniper", "body");
assert.ok(sniperBodyShot.health > 0, "sniper body shot must not be an instant kill");

host.emit("room:leave");
guest.emit("room:leave");
console.log("headshot rules validated");
