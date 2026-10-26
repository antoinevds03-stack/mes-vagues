#!/usr/bin/env node
/* Alertes de Mes Vagues, envoyées avec ntfy (https://ntfy.sh).
 *
 * Un canal par spot : « <prefix>-<id du spot> » (prefix dans config.json).
 * On s'abonne dans l'appli ntfy aux canaux de ses spots favoris.
 *
 * Pour chaque spot et chaque jour des 3 prochains jours, on cherche le meilleur
 * créneau de jour noté au moins `alerts.min` (même calcul que l'appli, mode
 * bodyboard) et on envoie :
 *   - « en vue »      : la première fois que le créneau apparaît ;
 *   - « c'est aujourd'hui » : le matin même (entre 7 h et 13 h), s'il tient toujours ;
 *   - « annulé »      : si la note retombe à min - 2 ou moins avant le jour J.
 * Rien n'est envoyé entre 22 h et 7 h : les alertes partent au premier passage après 7 h.
 * Ce qui a été envoyé est noté dans data/alerts_state.json pour ne rien répéter.
 *
 * Variables : ALERT_DRY=1 (affiche sans envoyer), ALERT_TEST=1 (envoie en plus un
 * message de test sur « <prefix>-test », même la nuit), MV_NOW=2026-10-16T09:30:00Z
 * (simule une autre heure). Node 18 ou plus, rien à installer.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const STATE_FILE = path.join(ROOT, "data", "alerts_state.json");
const DRY = !!process.env.ALERT_DRY, TEST = !!process.env.ALERT_TEST;

const cfg = read("config.json"), DATA = read("data/latest.json");
const spots = read("spots.json").filter(s => DATA.map && DATA.map[s.id]);  // spots qui ont des prévisions
const A = Object.assign({min: 7, maxLeadHours: 72, quietStart: 22, quietEnd: 7, dayOfStart: 7, dayOfEnd: 13, mode: "bb"}, cfg.alerts || {});
const NTFY = Object.assign({server: "https://ntfy.sh", prefix: "mesvagues"}, cfg.ntfy || {});
const site = (cfg.site || "").replace(/\/?$/, "/");

// moteur de l'appli (js/core.js), exécuté tel quel
const sb = {DATA, mode: A.mode, __NOW__: process.env.MV_NOW || null, console};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "core.js"), "utf8"), sb);
const core = vm.runInContext("({windowsFor, dayBest, windowDetail, hRange, dayWord, todayIdx, nowHours, f1, card, WIND_LABEL})", sb);

const now = process.env.MV_NOW ? new Date(process.env.MV_NOW) : new Date();
const today = core.todayIdx(), todayDate = DATA.days[today], hourNow = core.nowHours() - today * 24, parisHour = Math.floor(hourNow);
const quiet = A.quietStart > A.quietEnd ? (parisHour >= A.quietStart || parisHour < A.quietEnd) : (parisHour >= A.quietStart && parisHour < A.quietEnd);

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { state = {}; }
for (const k of Object.keys(state)) if (!todayDate || k.split("|")[1] < todayDate) delete state[k];  // jours passés

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const topic = id => `${NTFY.prefix}-${id}`;
const short = w => `${core.f1(w.x.hs)} m à ${Math.round(w.x.T)} s, vent ${core.card(w.x.wdir)} ${Math.round(w.x.ws)} km/h`;

async function send(msg){
  if (DRY) { console.log(`[simulation] ${msg.topic} · ${msg.title}\n             ${msg.message}`); return true; }
  try {
    const res = await fetch(NTFY.server.replace(/\/$/, "") + "/", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(msg)});
    if (!res.ok) { console.log(`ntfy ${res.status} pour ${msg.topic} : ${(await res.text()).slice(0, 200)}`); return false; }
    console.log(`envoyé · ${msg.topic} · ${msg.title}`);
    await new Promise(r => setTimeout(r, 400));
    return true;
  } catch (e) { console.log(`ntfy injoignable (${msg.topic}) : ${e.message}`); return false; }
}

// meilleur créneau par spot et par jour
const best = new Map();
for (const sp of spots){
  for (const w of core.windowsFor(sp, {min: A.min, maxLead: A.maxLeadHours})){
    const k = `${sp.id}|${w.date}`, cur = best.get(k);
    if (!cur || w.r > cur.w.r) best.set(k, {sp, w});
  }
}

const out = [];
for (const [k, {sp, w}] of best){
  const st = state[k], isToday = w.d === today, when = core.dayWord(w.d);
  const base = {topic: topic(sp.id), click: `${site}#${sp.id}`, tags: ["ocean"], priority: w.r >= 9 ? 4 : 3};
  const body = `${cap(when)} ${core.hRange(w)} · ${core.windowDetail(w)}`;
  if (!st || st.cancelled){
    out.push({k, msg: {...base, title: `${sp.name} : ${w.r}/10 ${when}`, message: body},
      next: {r: w.r, h0: w.h0, h1: w.h1, sent: now.toISOString(), dayOf: isToday}});
  } else if (isToday && !st.dayOf && parisHour >= A.dayOfStart && parisHour < A.dayOfEnd){
    out.push({k, msg: {...base, title: `C'est aujourd'hui : ${sp.name} ${w.r}/10`, message: `${cap(core.hRange(w))} · ${core.windowDetail(w)}`},
      next: {...st, r: w.r, h0: w.h0, h1: w.h1, dayOf: true}});
  }
}
// créneaux annoncés qui ne tiennent plus
for (const [k, st] of Object.entries(state)){
  if (st.cancelled || best.has(k)) continue;
  const [id, date] = k.split("|"), sp = spots.find(s => s.id === id), d = DATA.days.indexOf(date);
  if (!sp || d < 0) continue;
  if (d === today && (st.h1 ?? 24) < hourNow + 1.5) continue;  // créneau du jour déjà passé ou en cours
  const b = core.dayBest(sp, d);
  if (b && b.r > A.min - 2) continue;  // un peu en dessous du seuil : on ne dérange pas
  const when = core.dayWord(d);
  out.push({k, msg: {topic: topic(id), click: `${site}#${id}`, tags: ["warning"], priority: 3,
    title: `${sp.name} ${when} : finalement moins bien`,
    message: b ? `Plus que ${b.r}/10 au mieux (${short({x: b.x})}).` : "Plus de créneau intéressant ce jour-là."},
    next: {...st, cancelled: true}});
}

console.log(`${new Date(now).toISOString()} · ${parisHour} h à Paris · ${best.size} créneau(x) ≥ ${A.min}/10 · ${out.length} alerte(s) à envoyer${quiet ? " (heures calmes : envoi reporté)" : ""}`);

if (!quiet){
  for (const o of out.slice(0, 25)) if (await send(o.msg)) state[o.k] = o.next;
}

if (TEST){
  const fav = spots.filter(s => s.fav).map(s => s.id);
  const list = [...best.values()].sort((a, b) => a.w.d - b.w.d || b.w.r - a.w.r);
  const top = list.filter(o => fav.includes(o.sp.id)).concat(list.filter(o => !fav.includes(o.sp.id)))[0];
  await send({topic: topic("test"), title: "Mes Vagues : test des alertes", tags: ["white_check_mark"], click: site,
    message: top ? `Ça marche. Prochain créneau : ${top.sp.name} ${core.dayWord(top.w.d)} ${core.hRange(top.w)}, ${top.w.r}/10.`
                 : `Ça marche. Aucun créneau à ${A.min}/10 ou plus dans les 3 prochains jours.`});
}

if (!DRY){
  const sorted = Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(STATE_FILE, JSON.stringify(sorted, null, 1) + "\n");
}
