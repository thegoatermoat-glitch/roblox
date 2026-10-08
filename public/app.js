const $ = (id) => document.getElementById(id);
const session = localStorage.cp_session || (localStorage.cp_session = crypto.randomUUID());
let held = null;

const say = (t) => ($("msg").textContent = t);
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (localStorage.cp_admin) headers["x-admin-token"] = localStorage.cp_admin;
  const r = await fetch(path, { ...opts, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

async function loadGames() {
  try {
    const games = await api("/api/games");
    $("games").innerHTML = "";
    for (const g of games) {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `<img src="${g.image}" alt="${g.name} cover"><h3>${g.name}<span>${g.tag}</span></h3>`;
      const b = document.createElement("button");
      b.textContent = "Launch";
      b.disabled = g.free === 0 || !!held;
      b.onclick = () => join(g);
      const info = document.createElement("p");
      info.textContent = `${g.info} ${g.free} of ${g.total} phones free.`;
      card.append(b, info);
      $("games").append(card);
    }
  } catch (e) { say(e.message); }
}

async function join(g) {
  try {
    held = await api(`/api/games/${g.id}/join`, { method: "POST", body: JSON.stringify({ session }) });
    $("session").hidden = false;
    $("sessionTitle").textContent = `${g.name} (${g.tag}) is reserved`;
    $("sessionBody").textContent = `Open the phone named ${held.name} in your Foxphone app or web client. It is yours for ${held.expires_in_minutes} minutes.`;
    say(held.controllable ? "" : "This phone has no ADB config, so it is reserved only. Open it in the Foxphone app.");
    if (held.controllable) startPlay();
  } catch (e) { say(e.message); }
  loadGames();
}

$("release").onclick = async () => {
  if (!held) return;
  await api(`/api/pods/${held.pod_id}/release`, { method: "POST", body: JSON.stringify({ session }) });
  held = null; $("session").hidden = true; $("play").hidden = true; loadGames();
};

$("adminBtn").onclick = async () => {
  const t = localStorage.cp_admin || prompt("Admin token");
  if (!t) return;
  localStorage.cp_admin = t;
  try {
    const pods = await api("/api/pods");
    $("admin").hidden = false; $("pods").innerHTML = "";
    for (const p of pods) {
      const li = document.createElement("li");
      li.innerHTML = `<div>${p.name}<small>${p.game ?? "unassigned"}, ${p.online ? "online" : "offline"}, ${p.claimed ? "reserved" : "free"}</small></div>`;
      const b = document.createElement("button");
      b.textContent = "Reset";
      b.onclick = async () => {
        if (!confirm(`Reset ${p.name}? This wipes the phone.`)) return;
        try { await api(`/api/pods/${p.pod_id}/reset`, { method: "POST" }); say(`Reset submitted for ${p.name}.`); }
        catch (e) { say(e.message); }
      };
      li.append(b); $("pods").append(li);
    }
  } catch (e) { delete localStorage.cp_admin; say(e.message); }
};

loadGames();
setInterval(loadGames, 20000);

// Screen preview (screenshots, a few frames per second) and input.
function startPlay() {
  $("play").hidden = false;
  const loop = () => {
    if (!held?.controllable) return;
    const img = $("screen");
    img.onload = () => setTimeout(loop, 150);
    img.onerror = () => setTimeout(loop, 1000);
    img.src = `/api/pods/${held.pod_id}/frame?session=${session}&t=${Date.now()}`;
  };
  loop();
}
const send = (msg) => held?.controllable && fetch(`/api/pods/${held.pod_id}/input`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ session, ...msg }),
}).catch(() => {});

const keys = new Set();
const KEYMAP = { " ": "a", e: "b" };
addEventListener("keydown", (e) => {
  if (!held?.controllable || e.repeat) return;
  const k = e.key.toLowerCase();
  if ("wasd".includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); }
  else if (KEYMAP[k]) { send({ type: "tap", button: KEYMAP[k] }); e.preventDefault(); }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

let lastVec = "0,0", lastSent = 0;
const padDown = {};
function tick() {
  if (held?.controllable) {
    let x = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    let y = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0);
    const pad = (navigator.getGamepads?.() ?? []).find(Boolean);
    if (pad) {
      if (Math.abs(pad.axes[0]) > 0.2 || Math.abs(pad.axes[1]) > 0.2) { x = pad.axes[0]; y = pad.axes[1]; }
      [[0, "a"], [1, "b"]].forEach(([i, name]) => {
        const p = !!pad.buttons[i]?.pressed;
        if (p && !padDown[name]) send({ type: "tap", button: name });
        padDown[name] = p;
      });
    }
    const v = `${x.toFixed(1)},${y.toFixed(1)}`;
    if (v !== lastVec && Date.now() - lastSent > 70) { lastVec = v; lastSent = Date.now(); send({ type: "move", x, y }); }
  }
  requestAnimationFrame(tick);
}
tick();
