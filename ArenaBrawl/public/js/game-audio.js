let context = null;
let master = null;
let noiseBuffer = null;
let engine = null;

function audioContext() {
  if (context) return context;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  context = new AudioContext();
  master = context.createGain();
  master.gain.value = 0.48;
  master.connect(context.destination);
  noiseBuffer = context.createBuffer(1, context.sampleRate * 0.45, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return context;
}

export function unlockAudio() {
  const ctx = audioContext();
  if (ctx?.state === "suspended") ctx.resume();
}

function outputFor(position, maxDistance = 90) {
  const ctx = audioContext();
  if (!ctx || !position) return master;
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 3;
  panner.maxDistance = maxDistance;
  panner.rolloffFactor = 1.25;
  panner.positionX.value = Number(position.x) || 0;
  panner.positionY.value = Number(position.y) || 0;
  panner.positionZ.value = Number(position.z) || 0;
  panner.connect(master);
  return panner;
}

function noiseBurst({ duration = 0.12, gain = 0.2, frequency = 1200, position = null } = {}) {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const volume = ctx.createGain();
  source.buffer = noiseBuffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(frequency, ctx.currentTime);
  volume.gain.setValueAtTime(gain, ctx.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(filter).connect(volume).connect(outputFor(position));
  source.start();
  source.stop(ctx.currentTime + duration);
}

function tone({ from = 160, to = 70, duration = 0.1, gain = 0.12, type = "square", position = null } = {}) {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);
  volume.gain.setValueAtTime(gain, ctx.currentTime);
  volume.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  oscillator.connect(volume).connect(outputFor(position));
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration);
}

export function playWeaponSound(weaponId, position = null) {
  const shotgun = weaponId === "mini_shotgun";
  const sniper = weaponId === "sniper_rifle";
  const heavy = weaponId === "heavy_mg";
  const bow = weaponId === "bow" || weaponId === "crossbow";
  const knife = weaponId === "knife";
  if (knife) {
    noiseBurst({ duration: 0.11, gain: 0.09, frequency: 2500, position });
    return;
  }
  if (bow) {
    tone({ from: weaponId === "bow" ? 460 : 260, to: 85, duration: 0.16, gain: 0.08, type: "triangle", position });
    noiseBurst({ duration: 0.08, gain: 0.035, frequency: 3700, position });
    return;
  }
  noiseBurst({
    duration: sniper ? 0.28 : shotgun ? 0.24 : heavy ? 0.13 : 0.095,
    gain: sniper ? 0.42 : shotgun ? 0.38 : heavy ? 0.25 : 0.2,
    frequency: sniper ? 1250 : shotgun ? 850 : heavy ? 1050 : 1700,
    position
  });
  tone({
    from: sniper ? 145 : shotgun ? 110 : heavy ? 125 : 190,
    to: 45,
    duration: sniper ? 0.22 : shotgun ? 0.18 : 0.09,
    gain: sniper ? 0.32 : shotgun ? 0.27 : heavy ? 0.17 : 0.12,
    position
  });
}

export function playImpactSound(position = null, hard = true) {
  noiseBurst({ duration: hard ? 0.085 : 0.14, gain: hard ? 0.1 : 0.055, frequency: hard ? 2800 : 900, position });
  if (hard) tone({ from: 510, to: 180, duration: 0.045, gain: 0.035, type: "triangle", position });
}

export function playExplosionSound(position = null) {
  noiseBurst({ duration: 0.42, gain: 0.5, frequency: 720, position });
  tone({ from: 105, to: 28, duration: 0.48, gain: 0.42, type: "sine", position });
}

export function playReloadSound() {
  tone({ from: 640, to: 380, duration: 0.055, gain: 0.045, type: "square" });
  setTimeout(() => tone({ from: 420, to: 720, duration: 0.07, gain: 0.04, type: "square" }), 120);
}

export function playFootstep(position = null, sprinting = false) {
  noiseBurst({ duration: 0.075, gain: sprinting ? 0.075 : 0.05, frequency: 520, position });
  tone({ from: 82, to: 55, duration: 0.07, gain: sprinting ? 0.045 : 0.028, type: "sine", position });
}

export function updateAudioListener(camera) {
  const ctx = audioContext();
  if (!ctx || !camera) return;
  const position = camera.position;
  const q = camera.quaternion;
  const forward = {
    x: -2 * (q.x * q.z + q.w * q.y),
    y: -2 * (q.y * q.z - q.w * q.x),
    z: -(1 - 2 * (q.x * q.x + q.y * q.y))
  };
  const up = { x: 0, y: 1, z: 0 };
  if (ctx.listener.positionX) {
    ctx.listener.positionX.value = position.x;
    ctx.listener.positionY.value = position.y;
    ctx.listener.positionZ.value = position.z;
    ctx.listener.forwardX.value = forward.x;
    ctx.listener.forwardY.value = forward.y;
    ctx.listener.forwardZ.value = forward.z;
    ctx.listener.upX.value = up.x;
    ctx.listener.upY.value = up.y;
    ctx.listener.upZ.value = up.z;
  } else {
    ctx.listener.setPosition(position.x, position.y, position.z);
    ctx.listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

export function updateVehicleEngine(active, speed = 0) {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  if (!active) {
    if (engine) {
      engine.volume.gain.setTargetAtTime(0.001, ctx.currentTime, 0.08);
      engine.oscillator.stop(ctx.currentTime + 0.35);
      engine = null;
    }
    return;
  }
  if (!engine) {
    const oscillator = ctx.createOscillator();
    const volume = ctx.createGain();
    oscillator.type = "sawtooth";
    volume.gain.value = 0.001;
    oscillator.connect(volume).connect(master);
    oscillator.start();
    engine = { oscillator, volume };
  }
  engine.oscillator.frequency.setTargetAtTime(58 + Math.min(34, Math.abs(speed)) * 3.4, ctx.currentTime, 0.06);
  engine.volume.gain.setTargetAtTime(0.035 + Math.min(1, Math.abs(speed) / 24) * 0.045, ctx.currentTime, 0.08);
}
