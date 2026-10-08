import express from "express";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import * as adb from "./adb.js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://api.foxphone.com/public_api/v1";
const API_KEY = process.env.FOXPHONE_API_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CLAIM_MS = 30 * 60 * 1000;
const CACHE_MS = 15 * 1000; // API limit: 60 req/min per key, shared by all endpoints

// Games are found by phone name: any phone whose name contains the match text.
const GAMES = [
  { id: "roblox", name: "Roblox", match: "roblox", tag: "Modded", image: "/roblox.png", pkg: "com.roblox.client",
    info: "Reserves one Roblox phone for 30 minutes. Modded version." },
  { id: "terraria", name: "Terraria", match: "terraria", tag: "Modded", image: "/terraria.svg", pkg: "com.and.games505.TerrariaPaid",
    info: "Reserves one Terraria phone for 30 minutes. Modded version." },
  { id: "fortnite", name: "Fortnite", match: "fortnite", tag: "Normal", image: "/fortnite.png", pkg: "com.epicgames.fortnite",
    info: "Reserves one Fortnite phone for 30 minutes. Standard version." },
];

if (!API_KEY) console.warn("FOXPHONE_API_KEY is not set; Foxphone calls will fail.");

async function fox(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { "X-API-Key": API_KEY ?? "", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message || `Foxphone returned ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function listAll(kind) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const d = await fox("GET", `/${kind}?page_num=${page}&page_size=100`);
    const items = d[kind] ?? [];
    out.push(...items);
    if (out.length >= (d.total ?? 0) || items.length === 0) break;
  }
  return out;
}

let cache = { at: 0, phones: [] };
async function phones(force = false) {
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.phones;
  cache = { at: Date.now(), phones: await listAll("phones") };
  return cache.phones;
}

const claims = new Map(); // pod_id -> { session, expires }
const gameOf = (p) => GAMES.find((g) => p.name?.toLowerCase().includes(g.match));
function sweep() {
  for (const [id, c] of claims) if (c.expires < Date.now()) { claims.delete(id); adb.stopSession(id); }
}
const view = (p) => ({
  pod_id: p.pod_id,
  name: p.name,
  game: gameOf(p)?.id ?? null,
  online: p.online_status === 1,
  idle: p.operating_status === 0,
  raw_status: `online_status=${p.online_status}, operating_status=${p.operating_status}`,
  proxy_id: p.proxy_id,
  claimed: claims.has(p.pod_id),
  claim_minutes_left: claims.has(p.pod_id) ? Math.max(0, Math.round((claims.get(p.pod_id).expires - Date.now()) / 60000)) : 0,
});

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(e.status ?? 500).json({ error: e.message, details: e.data }));

const fails = new Map(); // ip -> { n, until }
function admin(req, res, next) {
  const f = fails.get(req.ip);
  if (f && f.until > Date.now() && f.n >= 5)
    return res.status(429).json({ error: "Too many wrong attempts. Try again in 10 minutes." });
  const given = Buffer.from(String(req.get("x-admin-token") ?? ""));
  const real = Buffer.from(String(ADMIN_TOKEN ?? ""));
  const ok = real.length > 0 && given.length === real.length && timingSafeEqual(given, real);
  if (!ok) {
    const n = f && f.until > Date.now() ? f.n + 1 : 1;
    fails.set(req.ip, { n, until: Date.now() + 10 * 60 * 1000 });
    return res.status(401).json({ error: "Wrong password." });
  }
  fails.delete(req.ip);
  next();
}

app.get("/api/games", wrap(async (_req, res) => {
  sweep();
  const list = await phones();
  res.json(GAMES.map((g) => {
    const pods = list.filter((p) => gameOf(p)?.id === g.id);
    const free = pods.filter((p) => p.online_status === 1 && p.operating_status === 0 && !claims.has(p.pod_id));
    return { id: g.id, name: g.name, tag: g.tag, image: g.image, info: g.info, match: g.match, total: pods.length,
      online: pods.filter((p) => p.online_status === 1).length, free: free.length, account_phones: list.length };
  }));
}));

// Claim a free phone for a game. Playing happens in the Foxphone app or web client.
app.post("/api/games/:id/join", wrap(async (req, res) => {
  sweep();
  const game = GAMES.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: "Unknown game." });
  const session = req.body?.session;
  if (!session) return res.status(400).json({ error: "session is required." });
  const list = await phones();
  const pod = list
    .filter((p) => gameOf(p)?.id === game.id && p.online_status === 1 && p.operating_status === 0 && !claims.has(p.pod_id))
    .sort((a, b) => adb.hasConfig(b.pod_id) - adb.hasConfig(a.pod_id))[0];
  if (!pod) return res.status(409).json({ error: `No free ${game.name} phone right now.` });
  claims.set(pod.pod_id, { session, expires: Date.now() + CLAIM_MS });
  let controllable = false;
  if (adb.hasConfig(pod.pod_id)) {
    try { await adb.startSession(pod.pod_id, game.id, game.pkg); controllable = true; }
    catch (e) { claims.delete(pod.pod_id); return res.status(502).json({ error: `Could not start ${game.name}: ${e.message}` }); }
  }
  res.json({ pod_id: pod.pod_id, name: pod.name, controllable, expires_in_minutes: CLAIM_MS / 60000 });
}));

app.post("/api/pods/:id/release", wrap(async (req, res) => {
  const c = claims.get(req.params.id);
  if (c && c.session === req.body?.session) { claims.delete(req.params.id); adb.stopSession(req.params.id); }
  res.json({ ok: true });
}));

app.get("/api/pods", admin, wrap(async (_req, res) => {
  sweep();
  res.json((await phones(true)).map(view));
}));

app.post("/api/pods/:id/reset", admin, wrap(async (req, res) => {
  const out = await fox("POST", "/phones/actions/reset", { pod_ids: [req.params.id] });
  claims.delete(req.params.id);
  adb.stopSession(req.params.id);
  cache.at = 0;
  res.json(out);
}));

app.post("/api/pods/:id/force-release", admin, wrap(async (req, res) => {
  claims.delete(req.params.id);
  adb.stopSession(req.params.id);
  res.json({ ok: true });
}));

app.get("/api/proxies", admin, wrap(async (_req, res) => res.json(await listAll("proxies"))));

app.post("/api/proxies/:proxyId/bind", admin, wrap(async (req, res) => {
  const ids = req.body?.pod_ids;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "pod_ids required." });
  const out = await fox("POST", `/proxies/${encodeURIComponent(req.params.proxyId)}/bind`, { pod_ids: ids });
  cache.at = 0;
  res.json(out);
}));

const owns = (req, id) => claims.get(id)?.session === (req.body?.session ?? req.query.session);

app.post("/api/pods/:id/input", wrap(async (req, res) => {
  if (!owns(req, req.params.id)) return res.status(403).json({ error: "You do not hold this phone." });
  adb.sendInput(req.params.id, req.body);
  res.json({ ok: true });
}));

app.get("/api/pods/:id/frame", wrap(async (req, res) => {
  if (!owns(req, req.params.id)) return res.status(403).json({ error: "You do not hold this phone." });
  res.type("png").send(await adb.frame(req.params.id));
}));

app.get("/healthz", (_req, res) => res.send("ok"));
app.listen(process.env.PORT || 3000, () => console.log("cloudplay running"));
