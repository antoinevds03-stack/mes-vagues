/* Mes Vagues — moteur de calcul partagé par l'appli (navigateur) et le script d'alertes (Node).
   Utilise les variables globales DATA (prévisions) et mode ("bb" ou "surf") définies par l'appelant. */
const HOURS = [5,8,11,14,17,20];
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
const DAY_S = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const DAY_L = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
const WIND_LABEL = {glassy:"Glassy", offshore:"Offshore", "side-off":"Side-off", cross:"Cross", "side-on":"Side-on", onshore:"Onshore"};
const STAGE_LABEL = {low:"marée basse", mid:"mi-marée", high:"marée haute"};
const ORDER = ["low","mid","high"];
const MODEL_LABEL = {meteofrance_wave:"Météo-France (MFWAM)", ecmwf_wam:"ECMWF", ncep_gfswave016:"GFS (NOAA)", dwd_gwam:"DWD"};

const n360 = d => ((d % 360) + 360) % 360;
const card = d => COMPASS[Math.round(n360(d) / 22.5) % 16];
const angDiff = (a, b) => { const d = n360(a - b); return d > 180 ? 360 - d : d; };
const f1 = v => v.toLocaleString("fr-FR", {minimumFractionDigits:1, maximumFractionDigits:1});
const hm = t => { const h = n360(t * 15) / 15; let H = Math.floor(h), M = Math.round((h - H) * 60); if (M === 60) { H = (H + 1) % 24; M = 0; } return String(H).padStart(2,"0") + ":" + String(M).padStart(2,"0"); };
const dayDate = d => { const [y,m,dd] = DATA.days[d].split("-").map(Number); return new Date(Date.UTC(y, m-1, dd)); };
const dayShort = d => DAY_S[dayDate(d).getUTCDay()];
const dayNum = d => dayDate(d).getUTCDate();
const getS = id => { const m = DATA.map[id]; return Object.assign({}, DATA.cells[m[0]], DATA.winds[m[1]]); };

const _now = () => (typeof __NOW__ !== "undefined" && __NOW__) ? new Date(__NOW__) : new Date();
function nowHours(){
  const s = _now().toLocaleString("sv-SE", {timeZone:"Europe/Paris"});
  const [dp, tp] = s.split(" "); const [y,m,d] = dp.split("-").map(Number); const [H,M] = tp.split(":").map(Number);
  return (Date.UTC(y,m-1,d) - dayDate(0).getTime()) / 36e5 + H + M/60;
}
function sunOf(S, d){
  const [a,b] = (S.sun[d] || "08:00-19:00").split("-");
  const p = x => { const [h,m] = x.split(":").map(Number); return h + m/60; };
  return [p(a), p(b)];
}

/* ---------- marée ---------- */
function tideAt(H, x){
  const k = Math.floor(x), u = x - k, g = j => H[Math.max(0, Math.min(H.length-1, j))] ?? 0;
  const p0 = g(k-1), p1 = g(k), p2 = g(k+1), p3 = g(k+2);
  return .5 * ((2*p1) + (-p0+p2)*u + (2*p0-5*p1+4*p2-p3)*u*u + (-p0+3*p1-3*p2+p3)*u*u*u);
}
function extrema(H){
  const out = [];
  for (let k = 1; k < H.length-1; k++){
    const a = H[k-1], b = H[k], c = H[k+1];
    if (a == null || b == null || c == null) continue;
    const isMax = b >= a && b > c, isMin = b <= a && b < c;
    if (!isMax && !isMin) continue;
    const A = (a + c - 2*b)/2, B = (c - a)/2;
    const off = A ? Math.max(-.5, Math.min(.5, -B/(2*A))) : 0;
    out.push({t: k + off, h: A ? b - B*B/(4*A) : b, hi: isMax});
  }
  return out;
}
function tideStage(S, ext, t){
  let prev = null, next = null;
  for (const e of ext) { if (e.t <= t) prev = e; else { next = e; break; } }
  if (!prev || !next) return null;
  const lo = Math.min(prev.h, next.h), hi = Math.max(prev.h, next.h), h = tideAt(S.tide, t);
  const p = hi > lo ? (h - lo) / (hi - lo) : .5;
  return {stage: p < 1/3 ? "low" : p < 2/3 ? "mid" : "high", rising: next.hi, next};
}
const tidePref = sp => (mode === "bb" && sp.bbTide) ? sp.bbTide : sp.tide;
function tideFactor(sp, ts){
  const pref = tidePref(sp);
  if (!pref || !ts) return 1;
  const i = ORDER.indexOf(ts.stage), d = Math.min(...pref.ok.map(o => Math.abs(ORDER.indexOf(o) - i)));
  let f = d === 0 ? 1 : d === 1 ? .85 : .7;
  if (pref.rising) f *= ts.rising ? 1.05 : .93;
  return f;
}

/* ---------- note /10 ---------- */
function sizeScore(h){ if (h < .3) return 0; if (h < .6) return (h-.3)*10; if (h < 1) return 3 + (h-.6)*7.5; if (h < 2) return 6 + (h-1)*2.5; if (h < 3) return 8.5 - (h-2); return Math.max(3, 7.5 - (h-3)*1.5); }
// profil bodyboard : 0,6-1,8 m idéal, 10-12 s parfait
function sizeBB(h){ if (h < .3) return 0; if (h < .6) return (h-.3)/.3*4; if (h < 1) return 4 + (h-.6)/.4*4; if (h < 1.8) return 8 + (h-1)/.8*1.5; if (h < 2.5) return 9.5 - (h-1.8)/.7*2.5; if (h < 3.5) return 7 - (h-2.5)*3; return 3.5; }
function periodBB(T){ return T < 7 ? .45 : T < 8 ? .65 : T < 10 ? .85 : T <= 12.5 ? 1.05 : T < 14 ? 1 : .9; }
function periodFactor(T){ return T < 6 ? .45 : T < 8 ? .65 : T < 10 ? .85 : T < 12 ? 1 : 1.1; }
function windState(ws, dir, face){ if (ws <= 5) return "glassy"; const d = angDiff(dir, face); if (d <= 35) return "onshore"; if (d <= 70) return "side-on"; if (d <= 110) return "cross"; if (d <= 145) return "side-off"; return "offshore"; }
function windFactor(st, ws){
  let f = {glassy:1.15, offshore:1.15, "side-off":1, cross: ws <= 12 ? .85 : .65, "side-on": ws <= 12 ? .75 : .45, onshore: ws <= 10 ? .7 : ws <= 20 ? .4 : .25}[st];
  if (st !== "glassy") { if (ws > 35) f *= .7; else if (ws > 25) f *= .85; }
  return f;
}
// vent progressif selon l'angle avec l'axe de la plage (0 = onshore, 180 = offshore)
const WIND_CURVE = [[0, .25], [35, .35], [70, .55], [100, .8], [130, 1], [180, 1.15]];
function lerpPts(pts, x){ for (let k = 1; k < pts.length; k++) if (x <= pts[k][0]) { const [x0, y0] = pts[k-1], [x1, y1] = pts[k]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; }
const inSector = (d, a, b) => { d = n360(d); a = n360(a); b = n360(b); return a <= b ? d >= a && d <= b : d >= a || d <= b; };
// abri local : le vent venant de ce secteur est ralenti sur le spot (falaises, pointe…)
function shelterOf(sp, dir){ const z = (sp.shelter || []).find(s => inSector(dir, s.from, s.to)); return z ? z.f : 1; }
function windFactorC(ws, dir, face){
  let f = lerpPts(WIND_CURVE, angDiff(dir, face));
  const light = Math.max(0, Math.min(1, (15 - ws) / 10));   // vent faible : la direction compte moins
  f += (1.15 - f) * light * .8;
  return f * (1 - Math.max(0, Math.min(.3, (ws - 22) / 45))); // vent fort : pénalité
}
function exposure(dir, ideal){ const d = angDiff(dir, ideal); return d <= 25 ? 1 : d <= 50 ? .85 : d <= 75 ? .6 : .3; }
// houle qui arrive presque parallèle à la plage, ou de derrière une pointe : elle rentre mal
function incidence(dir, face){ const a = angDiff(dir, face); return a <= 60 ? 1 : a <= 75 ? .85 : a <= 90 ? .6 : .35; }
/* ---------- comparaison des modèles ---------- */
function modelsAt(id, i){
  const cid = DATA.map[id][0], cell = DATA.cells[cid], out = [];
  if (cell.hs[i] != null) out.push({m:"meteofrance_wave", hs: cell.hs[i]/10, tp: cell.wp[i] != null ? cell.wp[i]/10 : null, dir: cell.wd[i]});
  const mc = DATA.models && DATA.models.cells[cid];
  if (mc) for (const m of Object.keys(mc)) { const v = mc[m]; if (v.hs[i] != null) out.push({m, hs: v.hs[i]/10, tp: v.tp[i], dir: v.dir[i]}); }
  return out;
}
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n-1)/2] : (s[n/2-1] + s[n/2]) / 2) : null; };
// DWD compte pour moitié : même famille de physique (WAM) que MFWAM et ECMWF
const MODEL_W = {meteofrance_wave:1, ecmwf_wam:1, ncep_gfswave016:1, dwd_gwam:.5};
const wOf = x => MODEL_W[x.m] ?? 1;
function wMedian(pairs){
  const s = [...pairs].sort((a, b) => a.v - b.v), tot = s.reduce((t, e) => t + e.w, 0); let acc = 0;
  for (const e of s) { acc += e.w; if (acc >= tot / 2) return e.v; }
  return s.length ? s[s.length - 1].v : null;
}
function circMean(ds){ let x = 0, y = 0; ds.forEach(d => { x += Math.cos(d * Math.PI / 180); y += Math.sin(d * Math.PI / 180); }); return n360(Math.atan2(y, x) * 180 / Math.PI); }
const LEVELS = ["low", "mid", "high"];
function consensus(list, lead = 0){
  if (!list.length) return null;
  const med = wMedian(list.map(x => ({v: x.hs, w: wOf(x)})));
  const tol = Math.max(.25 * med, .2), agree = list.filter(x => Math.abs(x.hs - med) <= tol);
  const share = agree.length / list.length, notes = [];
  let lvl = list.length < 2 ? 1 : share >= .75 ? 2 : share >= .5 ? 1 : 0;
  const dirs = agree.map(x => x.dir).filter(v => v != null);
  if (dirs.length > 1) { const cm = circMean(dirs); if (Math.max(...dirs.map(d => angDiff(d, cm))) > 30) { lvl = Math.max(0, lvl - 1); notes.push("directions différentes"); } }
  const tps = agree.map(x => x.tp).filter(v => v != null);
  if (tps.length > 1) { const tm = median(tps); if (Math.max(...tps) - Math.min(...tps) > Math.max(3, .3 * tm)) { lvl = Math.max(0, lvl - 1); notes.push("périodes différentes"); } }
  const far = lead > 144;
  if (lead > 96) { lvl = Math.min(lvl, 1); notes.push(far ? "échéance lointaine, simple tendance" : "à plus de 4 jours"); }
  const tpl = list.filter(x => x.tp != null);
  return {med, tp: tpl.length ? wMedian(tpl.map(x => ({v: x.tp, w: wOf(x)}))) : null, agree, n: list.length, conf: LEVELS[lvl], far, notes, list};
}

function slot(ctx, c){
  const {S, sp, ext} = ctx, i = c.i;
  if (S.hs[i] == null) return null;
  const cons = consensus(modelsAt(sp.id, i), c.t - (ctx.now ?? nowHours()));
  const hs = cons ? cons.med : S.hs[i]/10, sh = (S.sh[i] ?? 0)/10, T = cons && cons.tp ? cons.tp : (S.wp[i] ?? 80)/10, ws = S.ws[i] ?? 0, wdir = S.wdir[i] ?? 0;
  const shel = shelterOf(sp, wdir), wsEff = ws * shel;
  const st = windState(wsEff, wdir, sp.face);
  const dir = sh >= .3 ? S.sd[i] : S.wd[i];
  const exp = exposure(dir, sp.ideal) * incidence(dir, sp.face);
  const ts = tideStage(S, ext, c.t), tf = tideFactor(sp, ts);
  const r = Math.max(0, Math.min(10, Math.round((mode === "bb" ? sizeBB(hs) * periodBB(T) : sizeScore(hs) * periodFactor(T)) * windFactorC(wsEff, wdir, sp.face) * exp * tf)));
  const energy = Math.round(1.9625 * hs * hs * T * T);
  return {hs, sh, T, ws, wdir, st, exp, ts, tf, r, energy, dir, cons, shel};
}
const rk = r => r <= 1 ? "k0" : r <= 3 ? "k1" : r <= 5 ? "k2" : r <= 7 ? "k3" : "k4";
const ek = e => e < 150 ? "e1" : e < 400 ? "e2" : e < 800 ? "e3" : e < 1500 ? "e4" : e < 3000 ? "e5" : "e6";

function wetsuit(t){
  if (t >= 20) return "shorty ou combi 3/2"; if (t >= 17) return "combi 3/2"; if (t >= 14) return "combi 4/3";
  if (t >= 12) return "combi 5/4 et chaussons"; return "combi 5/4 ou 6/5, chaussons, gants, cagoule";
}
function wxLabel(c){
  if (c === 0) return "Ciel dégagé"; if (c <= 2) return "Éclaircies"; if (c === 3) return "Couvert"; if (c === 45 || c === 48) return "Brouillard";
  if (c >= 51 && c <= 57) return "Bruine"; if (c >= 61 && c <= 67) return "Pluie"; if (c >= 80 && c <= 82) return "Averses";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "Neige"; if (c >= 95) return "Orage"; return "—";
}

/* ---------- colonnes ---------- */
function buildCols(S){
  const out = [], nowT = nowHours();
  for (let i = 0; i < DATA.days.length * 6; i++){
    const d = Math.floor(i/6), h = HOURS[i % 6], t = d*24 + h;
    const [sr, ss] = sunOf(S, d);
    if (h < sr - 1.6 || h > ss + 1) continue;
    out.push({i, d, h, t, night: h < sr || h > ss});
  }
  const present = [...new Set(out.map(c => c.d))];
  let keep = present.filter(d => out.some(c => c.d === d && c.t >= nowT - 1.5));
  if (!keep.length) keep = present;
  const res = out.filter(c => keep.includes(c.d));
  res.forEach((c, k) => { c.first = k === 0 || res[k-1].d !== c.d; c.past = c.t < nowT - 1.5; c.now = Math.abs(c.t - nowT) <= 1.5; });
  return res;
}
const ctxFor = sp => { const S = getS(sp.id); return {S, sp, ext: extrema(S.tide), now: nowHours()}; };

/* ---------- textes ---------- */
const GOOD_MIN = 7;
const DIR_WORD = {N:"nord", NNE:"nord-nord-est", NE:"nord-est", ENE:"est-nord-est", E:"est", ESE:"est-sud-est", SE:"sud-est", SSE:"sud-sud-est",
  S:"sud", SSO:"sud-sud-ouest", SO:"sud-ouest", OSO:"ouest-sud-ouest", O:"ouest", ONO:"ouest-nord-ouest", NO:"nord-ouest", NNO:"nord-nord-ouest"};
const dirWord = d => DIR_WORD[card(d)];
const deDir = d => { const w = dirWord(d); return /^[eo]/.test(w) ? "d'" + w : "de " + w; };
const dir8 = d => ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"][Math.round(n360(d) / 45) % 8];
const versDir = d => { const w = dir8(d); return /^[eo]/.test(w) ? "l'" + w : "le " + w; };
const listFr = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1];
const todayIdx = () => Math.floor(nowHours() / 24);
function dayWord(d){
  const t = todayIdx();
  if (d === t) return "aujourd'hui";
  if (d === t + 1) return "demain";
  return `${DAY_L[dayDate(d).getUTCDay()]} ${dayNum(d)}`;
}
function whenTxt(d, h){
  const w = dayWord(d), today = w === "aujourd'hui";
  if (h < 5) return `${w} vers ${h}h`;
  if (h <= 8) return today ? "ce matin" : `${w} matin`;
  if (h >= 20) return today ? "ce soir" : `${w} soir`;
  return `${w} ${{11: "en fin de matinée", 14: "en début d'après-midi", 17: "en fin d'après-midi"}[h] || "vers " + h + "h"}`;
}
const hRange = w => w.h0 === w.h1 ? `vers ${w.h0}h` : `de ${w.h0}h à ${w.h1}h`;

/* ---------- créneaux favorables ---------- */
function isDaylight(S, d, h){ const [sr, ss] = sunOf(S, d); return h >= sr - .75 && h <= ss + .25; }
// blocs de créneaux de jour consécutifs dont la note atteint `min`
function windowsFor(sp, opt = {}){
  const min = opt.min ?? GOOD_MIN, maxLead = opt.maxLead ?? 96, ctx = ctxFor(sp), out = [];
  let cur = null;
  for (const c of buildCols(ctx.S)){
    const lead = c.t - ctx.now;
    if (c.past || lead > maxLead || !isDaylight(ctx.S, c.d, c.h)) { cur = null; continue; }
    const x = slot(ctx, c);
    if (!x || x.r < min) { cur = null; continue; }
    if (cur && cur.d === c.d && c.h - cur.h1 <= 3) { cur.h1 = c.h; if (x.r > cur.r) Object.assign(cur, {r: x.r, x, c}); }
    else { cur = {spot: sp.id, name: sp.name, d: c.d, date: DATA.days[c.d], h0: c.h, h1: c.h, r: x.r, x, c, lead}; out.push(cur); }
  }
  return out;
}
// meilleure note de jour d'un spot pour un jour donné
function dayBest(sp, d){
  const ctx = ctxFor(sp); let best = null;
  for (const c of buildCols(ctx.S)){
    if (c.d !== d || c.past || !isDaylight(ctx.S, c.d, c.h)) continue;
    const x = slot(ctx, c);
    if (x && (!best || x.r > best.r)) best = {r: x.r, x, c};
  }
  return best;
}
function windowDetail(w){
  const x = w.x, parts = [`vagues ${f1(x.hs)} m à ${Math.round(x.T)} s`, `vent ${card(x.wdir)} ${Math.round(x.ws)} km/h (${WIND_LABEL[x.st].toLowerCase()})`];
  if (x.ts) parts.push(`${STAGE_LABEL[x.ts.stage]} ${x.ts.rising ? "montante" : "descendante"}`);
  if (x.cons && x.cons.n > 1) parts.push(x.cons.conf === "high" ? "modèles d'accord" : x.cons.conf === "mid" ? "modèles assez d'accord" : "modèles en désaccord");
  return parts.join(" · ");
}

/* ---------- tendance : tempête, accalmie, créneau à viser ---------- */
function regionSeries(spots){
  const ctxs = spots.map(ctxFor), n = DATA.days.length * HOURS.length, out = [];
  for (let i = 0; i < n; i++){
    const d = Math.floor(i / HOURS.length), h = HOURS[i % HOURS.length], t = d * 24 + h;
    const p = {i, d, h, t, hs: 0, ws: 0, gu: 0, T: 0, ok: 0};
    for (const ctx of ctxs){
      const S = ctx.S; if (S.hs[i] == null) continue;
      const cons = consensus(modelsAt(ctx.sp.id, i), t - ctx.now), hs = cons ? cons.med : S.hs[i] / 10;
      if (hs > p.hs) { p.hs = hs; p.T = cons && cons.tp ? cons.tp : (S.wp[i] ?? 0) / 10; }
      p.ws = Math.max(p.ws, S.ws[i] ?? 0); p.gu = Math.max(p.gu, S.gu[i] ?? 0); p.ok++;
    }
    out.push(p);
  }
  return out;
}
const isStorm = p => p.hs >= 4 || p.gu >= 80 || p.ws >= 50;
const isRough = p => p.hs >= 2.8 || p.ws >= 35 || p.gu >= 60;
const isCalm = p => p.hs <= 2.5 && p.ws <= 30 && p.gu <= 50;
// regroupe les créneaux difficiles en épisodes (moins de 9 h d'écart, nuit comprise)
function episodes(pts){
  const out = [];
  for (const p of pts){
    const e = out[out.length - 1];
    if (e && p.t - e.end.t <= 9) { e.pts.push(p); e.end = p; } else out.push({pts: [p], start: p, end: p});
  }
  for (const e of out){
    e.pk = e.pts.reduce((a, b) => (b.hs > a.hs ? b : a));
    e.ws = Math.max(...e.pts.map(p => p.ws)); e.gu = Math.max(...e.pts.map(p => p.gu));
  }
  return out;
}
function trendFor(allSpots, favSpots){
  const now = nowHours(), res = {level: "calm", lines: [], calm: null, windows: []};
  const ser = regionSeries(allSpots).filter(p => p.ok && p.t >= now - 1.5 && p.t - now <= 120);
  if (!ser.length) return res;
  const storm = ser.filter(isStorm), rough = ser.filter(isRough);
  if (storm.length || rough.length){
    // tempête : on décrit chaque épisode (3 au plus) ; mer agitée : un seul bloc, du premier créneau au pic
    const bad = storm.length ? isStorm : isRough, all = ser.filter(bad);
    const eps = storm.length ? episodes(all).slice(0, 3) : [{start: all[0], end: all.reduce((a, b) => (b.hs > a.hs ? b : a)), pk: all.reduce((a, b) => (b.hs > a.hs ? b : a)),
      ws: Math.max(...all.map(p => p.ws)), gu: Math.max(...all.map(p => p.gu))}];
    const e0 = eps[0];
    res.level = storm.length ? "storm" : "rough";
    const start = storm.length
      ? (bad(ser[0]) ? "Tempête en cours" : `Tempête attendue ${whenTxt(e0.start.d, e0.start.h)}`)
      : (bad(ser[0]) ? "Mer agitée en ce moment" : `Mer agitée à partir de ${whenTxt(e0.start.d, e0.start.h)}`);
    res.lines.push(`${start} : jusqu'à ${f1(e0.pk.hs)} m de vagues ${whenTxt(e0.pk.d, e0.pk.h)}, vent jusqu'à ${Math.round(e0.ws)} km/h, rafales à ${Math.round(e0.gu)} km/h.`);
    let top = e0.pk.hs;
    for (let k = 1; k < eps.length; k++){
      const e = eps[k], prev = eps[k - 1];
      const lull = ser.find(p => p.t > prev.end.t && p.t < e.start.t && isCalm(p));
      if (lull) res.lines.push(`Répit ${whenTxt(lull.d, lull.h)} : vagues autour de ${f1(lull.hs)} m, vent ${Math.round(lull.ws)} km/h.`);
      const peak = whenTxt(e.pk.d, e.pk.h), from = whenTxt(e.start.d, e.start.h);
      if (e.pk.hs >= top * 1.2) res.lines.push(`Encore plus fort ${peak} : jusqu'à ${f1(e.pk.hs)} m de vagues, vent ${Math.round(e.ws)} km/h, rafales à ${Math.round(e.gu)} km/h.`);
      else {
        const what = (e.gu >= 80 || e.ws >= 50) ? "Nouveau coup de vent" : "Nouvelle grosse houle";
        res.lines.push(`${what} ${from} : jusqu'à ${f1(e.pk.hs)} m${peak === from ? "" : " " + peak}, vent ${Math.round(e.ws)} km/h, rafales à ${Math.round(e.gu)} km/h.`);
      }
      top = Math.max(top, e.pk.hs);
    }
    const last = eps[eps.length - 1], after = ser.filter(p => p.t > last.end.t);
    for (let k = 0; k < after.length; k++){
      if (isCalm(after[k]) && (k + 1 >= after.length || isCalm(after[k + 1]))) { res.calm = after[k]; break; }
    }
    if (res.calm){
      const c = res.calm;
      res.lines.push(`Ça se calme à partir de ${whenTxt(c.d, c.h)} : vagues autour de ${f1(c.hs)} m, vent ${Math.round(c.ws)} km/h.`);
      const again = ser.find(p => p.t > c.t && isRough(p));
      if (again) res.lines.push(`Nouvelle dégradation ${whenTxt(again.d, again.h)}.`);
    } else res.lines.push(`Pas d'accalmie nette d'ici ${dayWord(ser[ser.length - 1].d)}.`);
  } else {
    const lo = Math.min(...ser.map(p => p.hs)), hi = Math.max(...ser.map(p => p.hs));
    res.lines.push(`Pas de tempête en vue : vagues entre ${f1(lo)} et ${f1(hi)} m sur les prochains jours.`);
  }
  const wins = favSpots.flatMap(sp => windowsFor(sp)).sort((a, b) => a.c.t - b.c.t || b.r - a.r);
  res.windows = wins;
  if (wins.length){
    const pick = (res.calm && wins.find(w => w.c.t >= res.calm.t)) || wins.reduce((a, b) => (b.r > a.r ? b : a));
    res.lines.push(`Créneau à viser : ${pick.name}, ${dayWord(pick.d)} ${hRange(pick)} (${pick.r}/10).`);
  } else {
    res.lines.push(`Aucun créneau à ${GOOD_MIN}/10 ou plus ${favSpots.length < allSpots.length ? "sur tes spots favoris " : ""}dans les 4 prochains jours.`);
  }
  return res;
}

/* ---------- carte : lecture de la situation météo ---------- */
const BZH = [47.8, -4.0];
const PLACES = [
  ["au large de Terre-Neuve", 47, -48], ["au sud du Groenland", 59, -42], ["au sud de l'Islande", 60.5, -20], ["près de l'Islande", 64, -19],
  ["entre le Groenland et l'Islande", 65, -30], ["au milieu de l'Atlantique", 50, -32], ["au nord des Açores", 43, -28], ["près des Açores", 38, -27], ["à l'ouest du Portugal", 40, -16],
  ["au large de la Galice", 43.5, -11], ["dans le golfe de Gascogne", 45.5, -5], ["au large de la Bretagne", 48, -9],
  ["à l'entrée de la Manche", 49.5, -5.5], ["sur la Manche", 50.2, -1], ["au sud-ouest de l'Irlande", 50.5, -14],
  ["à l'ouest de l'Irlande", 53.5, -16], ["sur l'Irlande", 53.3, -8], ["au nord-ouest de l'Écosse", 59, -10],
  ["sur les îles Britanniques", 54.5, -3], ["sur la mer du Nord", 56, 3], ["sur la Scandinavie", 61, 9],
  ["sur la France", 46.5, 2.5], ["sur l'Espagne", 40, -4], ["sur l'Allemagne", 51, 9], ["au large du Maroc", 33, -12]
];
function distKm(a, b){
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}
function bearingTo(a, b){
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return n360(Math.atan2(y, x) / r);
}
function placeOf(lat, lon){
  let best = null;
  for (const [ph, la, lo] of PLACES){ const d = distKm([lat, lon], [la, lo]); if (!best || d < best.d) best = {ph, d}; }
  return best.ph;
}
const stepHours = (SYN, a, b) => (Date.parse(SYN.steps[b] + "Z") - Date.parse(SYN.steps[a] + "Z")) / 36e5;
// dépressions (L) et anticyclones (H) repérés sur la grille de pression
function synSystems(SYN, s){
  const G = SYN.atl, P = G.p && G.p[s];
  if (!P) return [];
  const nla = G.lat.length, nlo = G.lon.length, raw = [];
  const at = (a, b) => (a < 0 || b < 0 || a >= nla || b >= nlo) ? null : P[a * nlo + b];
  const fit = (m, c, p) => { if (m == null || p == null) return 0; const den = m - 2 * c + p; return den ? Math.max(-.5, Math.min(.5, .5 * (m - p) / den)) : 0; };
  for (let a = 0; a < nla; a++) for (let b = 0; b < nlo; b++){
    const v = at(a, b); if (v == null) continue;
    const edge = !a || !b || a === nla - 1 || b === nlo - 1;
    let lo = true, hi = true;
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++){
      if (!da && !db) continue;
      const w = at(a + da, b + db); if (w == null) continue;
      if (w <= v) lo = false; if (w >= v) hi = false;
    }
    // au bord de la grille, on ne garde que les creux marqués (le centre peut être juste au-delà)
    if (edge ? !(lo && v <= 1000) : !((lo && v <= 1012) || (hi && v >= 1020))) continue;
    raw.push({type: lo ? "L" : "H", p: v, edge,
      lat: G.lat[a] + fit(at(a - 1, b), v, at(a + 1, b)) * (G.lat[1] - G.lat[0]),
      lon: G.lon[b] + fit(at(a, b - 1), v, at(a, b + 1)) * (G.lon[1] - G.lon[0])});
  }
  const out = [];
  for (const type of ["L", "H"]){
    raw.filter(x => x.type === type).sort((x, y) => type === "L" ? x.p - y.p : y.p - x.p)
      .forEach(x => { if (!out.some(o => o.type === type && distKm([o.lat, o.lon], [x.lat, x.lon]) < 700)) out.push(x); });
  }
  return out.map(x => Object.assign(x, {place: placeOf(x.lat, x.lon), dist: distKm(BZH, [x.lat, x.lon]), brg: bearingTo(BZH, [x.lat, x.lon])}));
}
// vent et vagues près des côtes bretonnes
function synLocal(SYN, s){
  const G = SYN.bzh; if (!G || !G.ws || !G.ws[s]) return null;
  const nlo = G.lon.length, rad = Math.PI / 180;
  let u = 0, v = 0, n = 0, sum = 0, hs = 0, wx = 0, wy = 0; const wp = [];
  for (let a = 0; a < G.lat.length; a++) for (let b = 0; b < nlo; b++){
    if (distKm(BZH, [G.lat[a], G.lon[b]]) > 130) continue;
    const k = a * nlo + b, ws = G.ws[s][k], wd = G.wd[s][k];
    if (ws != null && wd != null){ u += Math.sin(wd * rad); v += Math.cos(wd * rad); sum += ws; n++; }
    const h = G.hs && G.hs[s][k];
    if (h != null){
      hs = Math.max(hs, h);
      const dw = G.wdir && G.wdir[s][k]; if (dw != null){ wx += Math.sin(dw * rad); wy += Math.cos(dw * rad); }
      const p = G.wp && G.wp[s][k]; if (p != null) wp.push(p);
    }
  }
  if (!n) return null;
  return {ws: sum / n, wd: n360(Math.atan2(u, v) / rad), hs, swDir: (wx || wy) ? n360(Math.atan2(wx, wy) / rad) : null, wp: wp.length ? median(wp) : null};
}
function synMaxWaves(SYN, s){
  const G = SYN.atl, H = G.hs && G.hs[s]; if (!H) return null;
  let best = -1;
  H.forEach((h, k) => { if (h != null && (best < 0 || h > H[best])) best = k; });
  if (best < 0) return null;
  const nlo = G.lon.length, lat = G.lat[Math.floor(best / nlo)], lon = G.lon[best % nlo];
  return {hs: H[best], lat, lon, place: placeOf(lat, lon), dist: distKm(BZH, [lat, lon])};
}
const mainLow = sys => { const ls = sys.filter(x => x.type === "L" && x.dist < 3000); return ls.length ? ls.reduce((a, b) => (b.p + b.dist / 150 < a.p + a.dist / 150 ? b : a)) : null; };
function motionOf(SYN, s, sy){
  let s2 = s; while (s2 < SYN.steps.length - 1 && stepHours(SYN, s, s2) < 12) s2++;
  if (s2 === s) return null;
  let m = null;
  for (const x of synSystems(SYN, s2)){
    if (x.type !== sy.type) continue;
    const d = distKm([sy.lat, sy.lon], [x.lat, x.lon]);
    if (d < 1200 && (!m || d < m.d)) m = {x, d};
  }
  return m ? {km: m.d, brg: bearingTo([sy.lat, sy.lon], [m.x.lat, m.x.lon]), dp: m.x.p - sy.p} : null;
}
// quel système explique le vent observé ? (rotation antihoraire autour des dépressions, horaire autour des anticyclones)
function windCause(sys, wd){
  let best = null;
  for (const s of sys){
    if (s.dist > 2500) continue;
    const pred = n360(s.type === "L" ? s.brg - 110 : s.brg + 70), err = angDiff(pred, wd), score = err + s.dist / 50;
    if (!best || score < best.score) best = {s, err, score};
  }
  return best && best.err <= 50 ? best.s : null;
}
function spotsEffect(stepTime, spots){
  const d = DATA.days.indexOf(stepTime.slice(0, 10)), h = +stepTime.slice(11, 13), k = HOURS.indexOf(h);
  if (d < 0 || k < 0) return null;
  const i = d * HOURS.length + k, good = [], bad = [];
  for (const sp of spots){
    const x = slot(ctxFor(sp), {i, d, h, t: d * 24 + h});
    if (x) (["offshore", "side-off", "glassy"].includes(x.st) ? good : bad).push(sp.name);
  }
  if (!good.length && !bad.length) return null;
  if (!good.length) return "Vent mal orienté sur tous les spots.";
  if (!bad.length) return "Vent bien orienté (offshore ou side-off) sur tous les spots.";
  if (good.length >= bad.length) return `Vent bien orienté sur la plupart des spots, sauf ${listFr(bad.slice(0, 3))}${bad.length > 3 ? "…" : ""}.`;
  return `Vent bien orienté seulement pour ${listFr(good.slice(0, 3))}${good.length > 3 ? "…" : ""}.`;
}
function synText(SYN, s, spots){
  const sys = synSystems(SYN, s), loc = synLocal(SYN, s), lines = [];
  const low = mainLow(sys), high = sys.filter(x => x.type === "H" && x.dist < 2500).sort((a, b) => a.dist - b.dist)[0] || null;
  if (low){
    const mv = low.edge ? null : motionOf(SYN, s, low), verbs = [];  // au bord de la carte, le déplacement n'est pas fiable
    if (mv && mv.dp <= -4) verbs.push("se creuse"); else if (mv && mv.dp >= 4) verbs.push("se comble");
    if (mv) verbs.push(mv.km < 150 ? "reste presque immobile" : `file vers ${versDir(mv.brg)}`);
    lines.push(`Dépression de ${Math.round(low.p)} hPa ${low.place}${low.edge ? " (au bord de la carte)" : ""}${verbs.length ? ", qui " + verbs.join(" et ") : ""}.`);
  }
  if (high && (!low || high.dist < low.dist + 500)) lines.push(`Anticyclone de ${Math.round(high.p)} hPa ${high.place}.`);
  if (loc){
    const cause = windCause(sys, loc.wd);
    let t = `Sur la Bretagne, vent ${deDir(loc.wd)} à ${Math.round(loc.ws)} km/h`;
    if (cause) t += `, car elle est sur le flanc ${dir8(cause.brg + 180)} ${cause.type === "L" ? "de la dépression" : "de l'anticyclone"}${cause !== low && cause !== high ? " " + cause.place : ""}`;
    lines.push(t + ".");
    if (loc.hs){
      let t2 = `Vagues jusqu'à ${f1(loc.hs)} m au large de la Bretagne`;
      if (loc.swDir != null) t2 += `, houle ${deDir(loc.swDir)}${loc.wp ? " de " + Math.round(loc.wp) + " s" : ""}`;
      if (low && loc.swDir != null && angDiff(loc.swDir, low.brg) <= 45) t2 += ", levée par cette dépression";
      lines.push(t2 + ".");
      const mx = synMaxWaves(SYN, s);
      if (mx && mx.hs >= loc.hs + 2 && mx.dist > 300) lines.push(`Les plus grosses vagues de la carte (${f1(mx.hs)} m) sont ${mx.place}.`);
    }
  }
  const ef = spotsEffect(SYN.steps[s], spots);
  if (ef) lines.push(ef);
  return lines;
}
