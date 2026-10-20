#!/usr/bin/env python3
"""Grille météo de la carte de Mes Vagues.

Pression, vent et vagues sur l'Atlantique Nord (maille de 3°) et autour de la
Bretagne (maille de 0,5°), toutes les 6 heures sur 7 jours. Écrit data/synoptic.json.

Pour ménager le quota gratuit d'Open-Meteo, la grille déjà en ligne est
réutilisée si elle a moins de 5 h 30 (sauf avec la variable SYN_FORCE=1).
Uniquement la bibliothèque standard de Python.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "synoptic.json")
FORECAST = "https://api.open-meteo.com/v1/forecast"
MARINE = "https://marine-api.open-meteo.com/v1/marine"
STEP_HOURS = (2, 8, 14, 20)  # heures locales (Paris)
REUSE_HOURS = 5.5
GRIDS = {
    "atl": {"lat": [35 + 3 * i for i in range(11)], "lon": [-45 + 3 * j for j in range(19)]},
    "bzh": {"lat": [46 + 0.5 * i for i in range(8)], "lon": [-7 + 0.5 * j for j in range(12)]},
}
FIELDS = {  # nom dans le fichier : (API, variable Open-Meteo, décimales)
    "p": ("fc", "pressure_msl", 1), "ws": ("fc", "wind_speed_10m", 0), "wd": ("fc", "wind_direction_10m", 0),
    "hs": ("mr", "wave_height", 1), "wdir": ("mr", "wave_direction", 0), "wp": ("mr", "wave_period", 0),
}


def get_json(url, params, tries=3):
    query = urllib.parse.urlencode(params, safe=",")
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": "mes-vagues/1.0"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.load(resp)
            if isinstance(data, dict) and data.get("error"):
                raise RuntimeError(data.get("reason", "erreur Open-Meteo"))
            return data if isinstance(data, list) else [data]
        except Exception as exc:
            last = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Open-Meteo ne répond pas : {last}")


def reuse_previous(max_age=REUSE_HOURS):
    """Renvoie la grille en ligne si elle a moins de `max_age` heures."""
    try:
        with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
            site = json.load(f)["site"].rstrip("/") + "/"
        req = urllib.request.Request(site + "data/synoptic.json", headers={"User-Agent": "mes-vagues/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            prev = json.load(resp)
        age = (datetime.now(timezone.utc) - datetime.strptime(prev["gen"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).total_seconds() / 3600
        return prev if age < max_age else None
    except Exception:
        return None


def save(out):
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))


def main():
    prev = None if os.environ.get("SYN_FORCE") else reuse_previous()
    if prev:
        save(prev)
        print("grille météo récente réutilisée")
        return
    try:
        out = fetch()
    except RuntimeError as exc:  # Open-Meteo indisponible : on garde la dernière grille en ligne
        print(exc)
        prev = reuse_previous(max_age=48)
        if not prev:
            raise SystemExit("pas de grille météo disponible")
        save(prev)
        print("ancienne grille météo conservée")
        return
    save(out)
    print(f"grille météo : {len(out['steps'])} échéances")


def fetch():
    pts = [(g, la, lo) for g in ("atl", "bzh") for la in GRIDS[g]["lat"] for lo in GRIDS[g]["lon"]]
    common = {
        "latitude": ",".join(str(p[1]) for p in pts),
        "longitude": ",".join(str(p[2]) for p in pts),
        "forecast_days": 7,
        "timezone": "Europe/Paris",
    }
    resp = {"fc": get_json(FORECAST, {**common, "hourly": "pressure_msl,wind_speed_10m,wind_direction_10m"})}
    time.sleep(61)  # chaque requête compte pour ~300 appels : on reste sous 600 par minute
    try:
        resp["mr"] = get_json(MARINE, {**common, "hourly": "wave_height,wave_direction,wave_period"})
    except RuntimeError as exc:  # sans vagues, la carte garde pression et vent
        print(exc)
        resp["mr"] = None

    times = resp["fc"][0]["hourly"]["time"]
    idx = [i for i, t in enumerate(times) if int(t[11:13]) in STEP_HOURS]
    out = {"gen": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Open-Meteo (CC BY 4.0)", "steps": [times[i] for i in idx]}

    for g, grid in GRIDS.items():
        ks = [k for k, p in enumerate(pts) if p[0] == g]
        block = {"lat": grid["lat"], "lon": grid["lon"]}
        for name, (api, var, nd) in FIELDS.items():
            if resp[api] is None:
                continue
            rows = []
            for i in idx:
                row = []
                for k in ks:
                    vals = resp[api][k]["hourly"].get(var) or []
                    v = vals[i] if i < len(vals) else None
                    row.append(None if v is None else (round(v) if nd == 0 else round(v, nd)))
                rows.append(row)
            block[name] = rows
        out[g] = block

    return out


if __name__ == "__main__":
    main()
