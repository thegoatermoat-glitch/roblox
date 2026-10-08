const $ = (id) => document.getElementById(id);
const say = (t) => ($("msg").textContent = t);
let pw = sessionStorage.cp_admin || "";

async function api(path, method = "GET") {
  const r = await fetch(path, { method, headers: { "x-admin-token": pw } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

async function load() {
  const pods = await api("/api/pods");
  sessionStorage.cp_admin = pw;
  $("login").hidden = true; $("panel").hidden = false; say("");
  $("pods").innerHTML = "";
  if (!pods.length) $("pods").innerHTML = "<li>No phones found. Check the API key and phone names.</li>";
  for (const p of pods) {
    const li = document.createElement("li");
    const state = [p.game ?? "no game in name", p.online ? "online" : "offline",
      p.claimed ? `reserved, ${p.claim_minutes_left} min left` : "free", p.raw_status].join(", ");
    li.innerHTML = `<div>${p.name}<small>${state}</small></div>`;
    const box = document.createElement("div");
    box.className = "row-actions";
    const rel = document.createElement("button");
    rel.textContent = "Release"; rel.disabled = !p.claimed;
    rel.onclick = () => act(`/api/pods/${p.pod_id}/force-release`, `Released ${p.name}.`);
    const rst = document.createElement("button");
    rst.textContent = "Reset";
    rst.onclick = () => confirm(`Reset ${p.name}? This wipes the phone.`) &&
      act(`/api/pods/${p.pod_id}/reset`, `Reset submitted for ${p.name}.`);
    box.append(rel, rst); li.append(box); $("pods").append(li);
  }
}

async function act(path, ok) {
  try { await api(path, "POST"); await load(); say(ok); } catch (e) { say(e.message); }
}

$("login").onsubmit = async (e) => {
  e.preventDefault();
  pw = $("pw").value;
  try { await load(); } catch (err) { pw = ""; say(err.message); }
};
$("refresh").onclick = () => load().catch((e) => say(e.message));
$("logout").onclick = () => { sessionStorage.removeItem("cp_admin"); location.reload(); };
if (pw) load().catch(() => { pw = ""; });
