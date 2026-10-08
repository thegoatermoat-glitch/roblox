import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

const CONFIG_PATH = process.env.PHONES_CONFIG || "./phones.config.json";
let config = {};
try { config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
catch { console.warn(`No ${CONFIG_PATH} found: ADB launch and controls are off.`); }

const SAFE = /^[A-Za-z0-9._:-]+$/;
const ALLOWED_OVERLAYS = ["permissioncontroller", "packageinstaller"];
const sessions = new Map();

function adb(target, args, binary = false) {
  const full = target ? ["-s", target, ...args] : args;
  return new Promise((resolve, reject) =>
    execFile("adb", full, { timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" },
      (err, out, errOut) => err ? reject(new Error(String(errOut || err.message).trim())) : resolve(out)));
}

export const hasConfig = (podId) => !!config[podId];
function cfg(podId) {
  const c = config[podId];
  if (!c || !SAFE.test(c.adb || "")) throw new Error("No valid ADB config for this phone.");
  return c;
}

const launch = (t, pkg) =>
  adb(t, ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);

// Lock: every 2.5s check which app has focus and relaunch the game if something else does.
async function guard(s) {
  const out = await adb(s.target, ["shell", "dumpsys window | grep mCurrentFocus"]);
  if (!out.trim() || out.includes(s.pkg)) return;
  if (ALLOWED_OVERLAYS.some((o) => out.includes(o))) return;
  await launch(s.target, s.pkg);
}

export async function startSession(podId, gameId, defaultPkg) {
  const c = cfg(podId);
  const pkg = c.games?.[gameId] ?? defaultPkg;
  if (!pkg || !SAFE.test(pkg)) throw new Error(`No package configured for ${gameId}.`);
  stopSession(podId);
  await adb(null, ["connect", c.adb]);
  await launch(c.adb, pkg);
  const s = { target: c.adb, pkg, down: false, busy: false, q: [], last: null };
  s.timer = setInterval(() => guard(s).catch(() => {}), 2500);
  sessions.set(podId, s);
}

export function stopSession(podId) {
  const s = sessions.get(podId);
  if (!s) return;
  clearInterval(s.timer);
  sessions.delete(podId);
  adb(s.target, ["shell", "am", "force-stop", s.pkg]).catch(() => {});
}

const clamp = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
const n = (v) => String(Math.round(v));

async function run(s, c, j) {
  if (j.type === "tap") {
    const b = c.buttons?.[j.button];
    if (b) await adb(s.target, ["shell", "input", "tap", n(b.x), n(b.y)]);
    return;
  }
  const J = c.joystick;
  if (!J) return;
  const x = clamp(j.x), y = clamp(j.y);
  if (Math.hypot(x, y) < 0.15) {
    if (s.down) {
      await adb(s.target, ["shell", "input", "motionevent", "UP", n(s.last[0]), n(s.last[1])]);
      s.down = false;
    }
    return;
  }
  const tx = J.cx + x * J.r, ty = J.cy + y * J.r;
  if (!s.down) {
    await adb(s.target, ["shell", "input", "motionevent", "DOWN", n(J.cx), n(J.cy)]);
    s.down = true;
  }
  await adb(s.target, ["shell", "input", "motionevent", "MOVE", n(tx), n(ty)]);
  s.last = [tx, ty];
}

async function pump(s, c) {
  if (s.busy) return;
  s.busy = true;
  try { while (s.q.length) await run(s, c, s.q.shift()); }
  catch (e) { console.warn("input failed:", e.message); }
  finally { s.busy = false; }
}

// Moves are coalesced (latest wins); taps are always kept.
export function sendInput(podId, m) {
  const s = sessions.get(podId);
  if (!s) throw new Error("No active ADB session for this phone.");
  const job = m.type === "tap" ? { type: "tap", button: String(m.button) } : { type: "move", x: m.x, y: m.y };
  if (job.type === "move") {
    const i = s.q.findIndex((q) => q.type === "move");
    if (i >= 0) s.q[i] = job; else s.q.push(job);
  } else s.q.push(job);
  pump(s, config[podId]);
}

export const frame = (podId) => adb(cfg(podId).adb, ["exec-out", "screencap", "-p"], true);
